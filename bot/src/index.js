// ==========================================================================
// Bot de WhatsApp de Reservalope
// --------------------------------------------------------------------------
// 1. Atiende los pedidos del CRM: "Vincular WhatsApp" (publica el QR) y
//    "Desvincular" (tabla wa_sessions, columna requested_action).
// 2. Cada BOT_POLL_SECONDS toma de wa_outbox los mensajes que ya vencieron
//    (avisos a la barbería, confirmaciones, recordatorios) y los envía con
//    el WhatsApp de cada barbería, espaciados para no parecer spam.
// 3. Las respuestas de los clientes (CONFIRMAR, BAJA) se pasan a la base,
//    que confirma la cita y deja en la cola el mensaje de respuesta.
// ==========================================================================
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import { config } from './config.js';
import { hasLinkedSession } from './auth-state.js';
import { TenantSession } from './session.js';

const log = pino({ level: config.logLevel });
const waLog = pino({ level: 'warn' }).child({ origen: 'baileys' });
const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const sessions = new Map();          // tenant_id → TenantSession
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
let stopping = false;

function sessionFor(tenantId) {
  let s = sessions.get(tenantId);
  if (!s) {
    s = new TenantSession({ tenantId, config, db, log, waLog, onInbound: () => kickOutbox() });
    sessions.set(tenantId, s);
  }
  return s;
}

// --------------------------------------------------------------------------
// Al arrancar: reconectar las barberías que ya estaban vinculadas
// --------------------------------------------------------------------------
async function restoreSessions() {
  let dirs = [];
  try { dirs = await readdir(config.sessionsDir); } catch { /* aún no hay sesiones */ }
  for (const id of dirs.filter(isUuid)) {
    if (await hasLinkedSession(join(config.sessionsDir, id), config.sessionKey)) {
      log.info({ barberia: id }, 'Reconectando sesión guardada');
      await sessionFor(id).start();
    }
  }
}

// --------------------------------------------------------------------------
// Pedidos del CRM (Vincular / Desvincular)
// --------------------------------------------------------------------------
async function handleRequests() {
  const { data, error } = await db.from('wa_sessions')
    .select('tenant_id, requested_action').not('requested_action', 'is', null);
  if (error) { log.error({ err: error.message }, 'No se pudo leer wa_sessions'); return; }
  for (const r of data || []) {
    // Marcar el pedido como atendido antes de actuar, para no repetirlo
    await db.from('wa_sessions').update({ requested_action: null })
      .eq('tenant_id', r.tenant_id).eq('requested_action', r.requested_action);
    const s = sessionFor(r.tenant_id);
    if (r.requested_action === 'LINK') {
      if (s.connected) {
        await s.setStatus({ status: 'CONNECTED', qr: null, last_error: null });
        continue;
      }
      log.info({ barberia: r.tenant_id }, 'Vinculando WhatsApp');
      await s.setStatus({ status: 'WAITING_QR', qr: null, last_error: null });
      await s.start({ fresh: true });
    } else if (r.requested_action === 'LOGOUT') {
      log.info({ barberia: r.tenant_id }, 'Desvinculando WhatsApp');
      await s.logout();
      sessions.delete(r.tenant_id);
    }
  }
}

// --------------------------------------------------------------------------
// Cola de mensajes
// --------------------------------------------------------------------------
let outboxBusy = false;
let outboxAgain = false;
let outboxTimer = null;

function kickOutbox() {
  clearTimeout(outboxTimer);
  outboxTimer = setTimeout(runOutbox, 1500);
}

async function release(id) {
  // Devolver a la cola sin gastar un intento (la barbería se desconectó)
  const { data } = await db.from('wa_outbox').select('attempts').eq('id', id).single();
  await db.from('wa_outbox').update({
    status: 'PENDING', locked_at: null, attempts: Math.max(0, ((data && data.attempts) || 1) - 1)
  }).eq('id', id);
}

async function runOutbox() {
  if (stopping) return;
  if (outboxBusy) { outboxAgain = true; return; }
  outboxBusy = true;
  try {
    do {
      outboxAgain = false;
      const ready = [...sessions.values()].filter((s) => s.connected).map((s) => s.tenantId);
      if (!ready.length) break;
      const { data: rows, error } = await db.rpc('bot_tomar_mensajes', { p_limit: 20, p_tenants: ready });
      if (error) { log.error({ err: error.message }, 'bot_tomar_mensajes falló'); break; }
      for (const m of rows || []) {
        if (stopping) { await release(m.id); continue; }
        const s = sessions.get(m.tenant_id);
        if (!s || !s.connected) { await release(m.id); continue; }
        try {
          await s.send(m.recipient, m.body);
          await db.rpc('bot_marcar', { p_id: m.id, p_ok: true });
          log.info({ barberia: m.tenant_id, tipo: m.kind }, 'Mensaje enviado');
        } catch (e) {
          await db.rpc('bot_marcar', { p_id: m.id, p_ok: false, p_error: String(e.message || e) });
          log.warn({ barberia: m.tenant_id, tipo: m.kind, err: e.message }, 'No se pudo enviar');
        }
        const { minDelaySeconds: a, maxDelaySeconds: b } = config;
        await sleep((a + Math.random() * (b - a)) * 1000);
      }
      if ((rows || []).length === 20) outboxAgain = true;   // quedan más
    } while (outboxAgain && !stopping);
  } catch (e) {
    log.error({ err: e.message }, 'Error en la cola de mensajes');
  } finally {
    outboxBusy = false;
  }
}

// --------------------------------------------------------------------------
// Latido: el CRM sabe que el bot está encendido
// --------------------------------------------------------------------------
async function heartbeat() {
  const ids = [...sessions.values()].filter((s) => s.connected).map((s) => s.tenantId);
  if (!ids.length) return;
  const { error } = await db.from('wa_sessions').update({ last_seen_at: new Date().toISOString() }).in('tenant_id', ids);
  if (error) log.error({ err: error.message }, 'No se pudo registrar el latido');
}

// --------------------------------------------------------------------------
// Salud (solo local): curl http://127.0.0.1:8080
// --------------------------------------------------------------------------
function startHealthServer() {
  if (!config.healthPort) return;
  createServer((req, res) => {
    const list = [...sessions.values()].map((s) => ({ barberia: s.tenantId, conectado: s.connected }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, sesiones: list }));
  }).listen(config.healthPort, '127.0.0.1');
}

function every(seconds, fn) {
  const loop = async () => {
    if (stopping) return;
    try { await fn(); } catch (e) { log.error({ err: e.message }, 'Error en tarea periódica'); }
    setTimeout(loop, seconds * 1000);
  };
  loop();
}

async function main() {
  const { error } = await db.from('wa_sessions').select('tenant_id').limit(1);
  if (error) {
    log.fatal({ err: error.message }, 'No se pudo conectar con Supabase. Revisa SUPABASE_URL y SUPABASE_SECRET_KEY.');
    process.exit(1);
  }
  log.info('Bot de Reservalope iniciado');
  startHealthServer();
  await restoreSessions();
  every(5, handleRequests);
  every(config.pollSeconds, runOutbox);
  every(30, heartbeat);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  log.info('Apagando el bot…');
  for (const s of sessions.values()) await s.close();
  setTimeout(() => process.exit(0), 500);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main();
