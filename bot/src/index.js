// ==========================================================================
// Bot de WhatsApp de Reservalope
// --------------------------------------------------------------------------
// 1. Atiende los pedidos del CRM: "Vincular WhatsApp" (publica el QR) y
//    "Desvincular" (tabla wa_sessions, columna requested_action).
// 2. Cada BOT_POLL_SECONDS toma de wa_outbox los mensajes que ya vencieron
//    (avisos a la barbería, confirmaciones, recordatorios) y los envía con
//    el WhatsApp de cada barbería. Cada barbería tiene su propio turno de
//    envío, con su propia pausa anti-spam: una barbería con mucha cola no
//    retrasa a las demás.
// 3. Las respuestas de los clientes (CONFIRMAR, CANCELAR, REPROGRAMAR,
//    MI CITA, el menú al saludar, AVISAME, BAJA) se pasan a la base, que hace
//    el cambio y deja en la cola el mensaje de respuesta.
// 4. Cada BOT_CAMPAIGN_MINUTES pide a la base que programe los "te
//    extrañamos" de los negocios que los encendieron (bot_campanas).
//
// Solo puede haber un bot por carpeta (candado bot.lock): un segundo bot
// sale sin conectarse, porque dos bots con la misma sesión se expulsan
// entre sí de WhatsApp.
// ==========================================================================
import { existsSync, readdirSync, unlinkSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import pino from 'pino';
import { botDir, EXIT, loadConfig } from './config.js';
import { hasLinkedSession } from './auth-state.js';
import { TenantSession } from './session.js';
import {
  acquireLock, backoffMs, createJournal, createRateLimiter, groupByTenant, RotatingFile, sleep
} from './util.js';

// --------------------------------------------------------------------------
// Candado de instancia única (antes de leer la configuración o conectar nada)
// --------------------------------------------------------------------------
const lock = acquireLock(join(botDir, 'bot.lock'));
if (!lock.ok) {
  const pid = lock.holder && lock.holder.pid;
  console.error(`Ya hay un bot de Reservalope encendido en esta computadora${pid ? ` (proceso ${pid})` : ''}.`);
  console.error('No se abre otro: dos bots a la vez desconectan el WhatsApp de los negocios.');
  process.exit(EXIT.OTRA_INSTANCIA);
}
process.on('exit', () => lock.release());

const config = loadConfig();

// --------------------------------------------------------------------------
// Registro: consola (si hay ventana) y logs/bot.log con rotación
// --------------------------------------------------------------------------
const streams = [{ level: 'trace', stream: new RotatingFile(join(config.logDir, 'bot.log')) }];
if (config.logConsole) streams.push({ level: 'trace', stream: process.stdout });
const out = pino.multistream(streams);
const log = pino({ level: config.logLevel }, out);
const waLog = pino({ level: 'warn' }, out).child({ origen: 'baileys' });

const db = createClient(config.supabaseUrl, config.supabaseSecretKey, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const sessions = new Map();          // tenant_id → TenantSession
const workers = new Map();           // tenant_id → turno de envío en curso
const journal = createJournal(config.journalFile);
const inboundLimiter = createRateLimiter({
  max: config.inboundMax, windowMs: config.inboundWindowMinutes * 60000
});
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const startedAt = Date.now();
let stopping = false;
let signalStop;
const stopSignal = new Promise((r) => { signalStop = r; });
// Pausa que se corta al apagar el bot
const pause = (ms) => Promise.race([sleep(ms), stopSignal]);

// Un mensaje tomado de la cola vuelve a tomarse en la base a los 10 min si
// sigue "enviando". Si el turno de una barbería lo retiene más de esto, se
// devuelve a la cola en vez de enviarlo, para no duplicarlo.
const HOLD_MAX_MS = 7 * 60 * 1000;

function sessionFor(tenantId) {
  let s = sessions.get(tenantId);
  if (!s) {
    s = new TenantSession({
      tenantId, config, db, log, waLog, inboundLimiter,
      onInbound: () => kickOutbox(),
      onOpen: () => kickOutbox()
    });
    sessions.set(tenantId, s);
  }
  return s;
}

// --------------------------------------------------------------------------
// Al arrancar: reconectar las barberías que ya estaban vinculadas
// --------------------------------------------------------------------------
async function restoreSessions() {
  let dirs = [];
  try { dirs = readdirSync(config.sessionsDir); } catch { /* aún no hay sesiones */ }
  const restored = new Set();
  for (const id of dirs.filter(isUuid)) {
    if (await hasLinkedSession(join(config.sessionsDir, id), config.sessionKey)) {
      log.info({ barberia: id }, 'Reconectando sesión guardada');
      restored.add(id);
      await sessionFor(id).start();
    }
  }
  return restored;
}

// Estados que quedaron de la vez anterior y ya no son ciertos: un QR que nadie
// va a poder escanear, o "Conectado" sin sesión guardada en esta máquina.
async function cleanStaleStatus(restored) {
  const { data, error } = await db.from('wa_sessions')
    .select('tenant_id, status, requested_action').in('status', ['WAITING_QR', 'CONNECTED']);
  if (error) { log.error({ err: error.message }, 'No se pudo revisar wa_sessions al arrancar'); return; }
  for (const r of data || []) {
    if (restored.has(r.tenant_id) || r.requested_action === 'LINK') continue;
    const last_error = r.status === 'WAITING_QR'
      ? 'El bot se reinició antes de escanear el QR. Pulsa "Vincular WhatsApp" de nuevo.'
      : 'El bot no tiene guardada la sesión de este WhatsApp (se borró la carpeta sessions, cambió BOT_SESSION_KEY o el bot está en otra computadora). Pulsa "Vincular WhatsApp".';
    const { error: e } = await db.from('wa_sessions').update({ status: 'DISCONNECTED', qr: null, last_error })
      .eq('tenant_id', r.tenant_id).eq('status', r.status);
    if (e) log.error({ barberia: r.tenant_id, err: e.message }, 'No se pudo limpiar el estado');
    else log.info({ barberia: r.tenant_id, antes: r.status }, 'Estado anterior sin sesión: queda desconectado');
  }
}

// --------------------------------------------------------------------------
// Pedidos del CRM (Vincular / Desvincular)
// --------------------------------------------------------------------------
async function clearRequest(r) {
  const { error } = await db.from('wa_sessions').update({ requested_action: null })
    .eq('tenant_id', r.tenant_id).eq('requested_action', r.requested_action);
  if (error) log.error({ barberia: r.tenant_id, err: error.message }, 'No se pudo marcar el pedido como atendido');
  return !error;
}

async function handleLink(r) {
  const s = sessionFor(r.tenant_id);
  if (s.connected) {
    if (await clearRequest(r)) await s.setStatus({ status: 'CONNECTED', qr: null, last_error: null });
    return;
  }
  const linked = await s.hasLinkedSession();
  if (linked && s.running) {
    // Hay una sesión vinculada reconectándose (por ejemplo, el bot acaba de
    // encender y alguien pulsó Vincular mientras estaba apagado). Nunca se
    // borra: se espera el primer intento y, si conecta, queda "Conectado".
    if (!s.firstAttemptDone && Date.now() - s.startedAt < 60000) return;   // se revisa en 5 s
    if (await clearRequest(r)) {
      await s.setStatus({ status: 'DISCONNECTED', qr: null,
        last_error: 'Este WhatsApp sigue vinculado y el bot se está reconectando. Si no conecta en unos minutos, pulsa "Desvincular" y vuelve a vincular.' });
    }
    return;
  }
  if (!(await clearRequest(r))) return;
  if (linked && (s.stopReason === null || s.stopReason === 'retries' || s.stopReason === 'replaced')) {
    // La sesión sigue siendo válida: reconectar sin borrarla
    log.info({ barberia: r.tenant_id }, 'Reconectando WhatsApp vinculado');
    s.retries = 0;
    await s.setStatus({ status: 'DISCONNECTED', qr: null, last_error: 'Reconectando…' });
    await s.start({ linking: true });
    return;
  }
  log.info({ barberia: r.tenant_id }, 'Vinculando WhatsApp');
  await s.setStatus({ status: 'WAITING_QR', qr: null, last_error: null });
  await s.start({ fresh: true });
}

async function handleLogout(r) {
  const s = sessionFor(r.tenant_id);
  // Si la sesión se está conectando, esperar el primer intento: así el
  // dispositivo también se quita de "Dispositivos vinculados" del celular
  if (s.running && !s.connected && !s.firstAttemptDone && Date.now() - s.startedAt < 60000) return;
  if (!(await clearRequest(r))) return;
  log.info({ barberia: r.tenant_id }, 'Desvinculando WhatsApp');
  await cancelTenantQueue(r.tenant_id, 'WhatsApp desvinculado');
  await s.logout();
  sessions.delete(r.tenant_id);
}

async function handleRequests() {
  const { data, error } = await db.from('wa_sessions')
    .select('tenant_id, requested_action, updated_at').not('requested_action', 'is', null);
  if (error) { log.error({ err: error.message }, 'No se pudo leer wa_sessions'); return; }
  for (const r of data || []) {
    if (stopping) return;
    if (r.requested_action === 'LINK') await handleLink(r);
    else if (r.requested_action === 'LOGOUT') await handleLogout(r);
  }
}

// --------------------------------------------------------------------------
// Resultado de cada envío (bot_marcar), con reintentos y diario local
// --------------------------------------------------------------------------
async function callMark(entry) {
  const args = entry.ok
    ? { p_id: entry.id, p_ok: true }
    : { p_id: entry.id, p_ok: false, p_error: entry.error || 'Error' };
  try {
    const { error } = await db.rpc('bot_marcar', args);
    return error ? error.message : null;
  } catch (e) {
    return String(e.message || e);
  }
}

async function markResult(id, ok, error = null) {
  const entry = { id, ok, error };
  const tries = stopping ? 1 : 3;
  let err = null;
  for (let i = 0; i < tries; i++) {
    err = await callMark(entry);
    if (!err) return true;
    if (i < tries - 1) await sleep(backoffMs(i, 1000, 8000));
  }
  // Se guarda en disco y se aplica antes de tomar mensajes nuevos
  log.error({ id, enviado: ok, err }, 'No se pudo guardar el resultado del envío; queda en el diario local');
  try { journal.add(entry); } catch (e) { log.error({ err: e.message }, 'No se pudo escribir el diario local'); }
  return false;
}

// Aplica los resultados pendientes. true = diario vacío, se puede seguir.
async function flushJournal() {
  for (const entry of journal.list()) {
    const err = await callMark(entry);
    if (err) {
      log.warn({ pendientes: journal.size(), err }, 'Aún no se pueden guardar resultados pendientes; no se toman mensajes nuevos');
      return false;
    }
    journal.remove(entry.id);
    log.info({ id: entry.id }, 'Resultado pendiente guardado');
  }
  return true;
}

// --------------------------------------------------------------------------
// Cola de mensajes
// --------------------------------------------------------------------------
let dispatching = false;
let dispatchAgain = false;
let outboxTimer = null;

function kickOutbox(ms = 1500) {
  if (stopping) return;
  clearTimeout(outboxTimer);
  outboxTimer = setTimeout(() => runOutbox().catch((e) =>
    log.error({ err: e.message }, 'Error en la cola de mensajes')), ms);
}

async function release(id) {
  // Devolver a la cola sin gastar un intento (la barbería se desconectó o el bot se apaga)
  try {
    const { data } = await db.from('wa_outbox').select('attempts').eq('id', id).single();
    const { error } = await db.from('wa_outbox').update({
      status: 'PENDING', locked_at: null, attempts: Math.max(0, ((data && data.attempts) || 1) - 1)
    }).eq('id', id).eq('status', 'SENDING');
    if (error) log.warn({ id, err: error.message }, 'No se pudo devolver el mensaje a la cola');
  } catch (e) {
    log.warn({ id, err: e.message }, 'No se pudo devolver el mensaje a la cola');
  }
}

// Al desvincular: lo que estaba en cola para esa barbería ya no se envía
async function cancelTenantQueue(tenantId, reason) {
  const w = workers.get(tenantId);
  const ids = [];
  if (w) {
    w.cancelled = true;
    ids.push(...w.queue.splice(0).map((i) => i.m.id));
  }
  if (ids.length) {
    const { error } = await db.from('wa_outbox').update({ status: 'CANCELLED', locked_at: null, last_error: reason })
      .in('id', ids);
    if (error) log.error({ barberia: tenantId, err: error.message }, 'No se pudieron cancelar los mensajes tomados');
  }
  const { error } = await db.from('wa_outbox').update({ status: 'CANCELLED', last_error: reason })
    .eq('tenant_id', tenantId).eq('status', 'PENDING');
  if (error) log.error({ barberia: tenantId, err: error.message }, 'No se pudieron cancelar los mensajes pendientes');
}

// Recordatorios y confirmaciones de citas que ya empezaron
async function expiredReminders(rows) {
  const isClient = (m) => (m.kind === 'REMINDER' || m.kind === 'CLIENT_CONFIRM') && m.appointment_id;
  const ids = [...new Set(rows.filter(isClient).map((m) => m.appointment_id))];
  if (!ids.length) return new Set();
  const { data, error } = await db.from('appointments').select('id, starts_at').in('id', ids);
  if (error) { log.error({ err: error.message }, 'No se pudo revisar la hora de las citas'); return new Set(); }
  const past = new Set((data || []).filter((a) => new Date(a.starts_at) <= new Date()).map((a) => a.id));
  return new Set(rows.filter((m) => isClient(m) && past.has(m.appointment_id)).map((m) => m.id));
}

// Turno de envío de una barbería: sus mensajes de a uno, con pausa entre ellos
async function runWorker(tenantId, w) {
  const { minDelaySeconds: a, maxDelaySeconds: b } = config;
  while (w.queue.length) {
    const item = w.queue.shift();
    const m = item.m;
    const s = sessions.get(tenantId);
    if (stopping || !s || !s.connected || Date.now() - item.takenAt > HOLD_MAX_MS) {
      await release(m.id);
      continue;
    }
    w.current = m.id;
    let ok = true;
    let err = null;
    try {
      await s.send(m.recipient, m.body);
    } catch (e) {
      ok = false;
      err = String((e && e.message) || e);
    }
    w.current = null;
    if (!ok && w.cancelled) {
      // Se desvinculó mientras se enviaba
      await db.from('wa_outbox').update({ status: 'CANCELLED', locked_at: null, last_error: 'WhatsApp desvinculado' }).eq('id', m.id);
      continue;
    }
    if (!ok && err === 'WhatsApp desconectado') {
      // No llegó a enviarse: vuelve a la cola sin gastar intento
      await release(m.id);
      continue;
    }
    await markResult(m.id, ok, err);
    if (ok) log.info({ barberia: tenantId, tipo: m.kind }, 'Mensaje enviado');
    else log.warn({ barberia: tenantId, tipo: m.kind, err }, 'No se pudo enviar');
    if (w.queue.length && !stopping) await pause((a + Math.random() * (b - a)) * 1000);
  }
}

function startWorker(tenantId, items, maybeMore) {
  const w = { queue: items, current: null, cancelled: false, promise: null };
  workers.set(tenantId, w);
  w.promise = runWorker(tenantId, w)
    .catch((e) => log.error({ barberia: tenantId, err: e.message }, 'Error en el envío del negocio'))
    .finally(() => {
      if (workers.get(tenantId) === w) workers.delete(tenantId);
      if (maybeMore && !w.cancelled) kickOutbox(500);       // puede quedar más en la cola
    });
}

async function runOutbox() {
  if (stopping) return;
  if (dispatching) { dispatchAgain = true; return; }
  dispatching = true;
  try {
    do {
      dispatchAgain = false;
      if (!(await flushJournal())) break;
      // Solo barberías conectadas y sin un turno de envío en curso
      const idle = [...sessions.values()]
        .filter((s) => s.connected && !workers.has(s.tenantId)).map((s) => s.tenantId);
      if (!idle.length) break;
      const limit = Math.min(100, config.batchPerTenant * idle.length);
      const { data: rows, error } = await db.rpc('bot_tomar_mensajes', { p_limit: limit, p_tenants: idle });
      if (error) { log.error({ err: error.message }, 'bot_tomar_mensajes falló'); break; }
      if (!rows || !rows.length) break;
      const takenAt = Date.now();
      const expired = await expiredReminders(rows);
      for (const [tenantId, list] of groupByTenant(rows)) {
        const items = [];
        for (const m of list) {
          if (expired.has(m.id)) {
            // El bot estuvo apagado y la cita ya pasó: el recordatorio ya no sirve
            await db.from('wa_outbox').update({ status: 'CANCELLED', locked_at: null, last_error: 'La cita ya pasó' }).eq('id', m.id);
            continue;
          }
          items.push({ m, takenAt });
        }
        if (stopping || !items.length) {
          await Promise.allSettled(items.map((i) => release(i.m.id)));
          continue;
        }
        if (workers.has(tenantId)) workers.get(tenantId).queue.push(...items);   // no debería pasar
        else startWorker(tenantId, items, list.length >= config.batchPerTenant);
      }
    } while (dispatchAgain && !stopping);
  } finally {
    dispatching = false;
  }
}

// --------------------------------------------------------------------------
// "Te extrañamos": la base elige a quién y cuándo (tope diario, de 10 a 18 h)
// --------------------------------------------------------------------------
let campaignsMissing = false;
async function campaigns() {
  if (campaignsMissing) return;
  const ids = [...sessions.values()].filter((s) => s.connected).map((s) => s.tenantId);
  if (!ids.length) return;
  const { data, error } = await db.rpc('bot_campanas', { p_tenants: ids });
  if (error) {
    if (error.code === 'PGRST202') {
      campaignsMissing = true;
      log.warn('Falta la migración 17 en Supabase: no se programan los "te extrañamos"');
    } else {
      log.error({ err: error.message }, 'bot_campanas falló');
    }
    return;
  }
  if (data) log.info({ programados: data }, 'Mensajes "te extrañamos" programados');
}

// --------------------------------------------------------------------------
// Latido: el CRM sabe que el bot está encendido
// --------------------------------------------------------------------------
async function heartbeat() {
  if (!lock.touch()) {
    log.fatal('Otro bot tomó el candado de esta carpeta; este se apaga');
    await shutdown('candado', EXIT.OTRA_INSTANCIA);
    return;
  }
  inboundLimiter.prune();
  for (const s of sessions.values()) { s.humanRecent.prune(); s.sentIds.prune(); }
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
  const server = createServer((req, res) => {
    const list = [...sessions.values()].map((s) => ({
      barberia: s.tenantId, conectado: s.connected, enCola: (workers.get(s.tenantId) || { queue: [] }).queue.length
    }));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, pid: process.pid, desde: new Date(startedAt).toISOString(),
      pendientesDeMarcar: journal.size(), sesiones: list }));
  });
  // Puerto ocupado por otro programa: el bot sigue funcionando sin esta página
  server.on('error', (e) => log.warn({ err: e.message, puerto: config.healthPort },
    'No se pudo abrir el puerto de salud; el bot sigue sin él (cambia BOT_HEALTH_PORT o pon 0)'));
  server.listen(config.healthPort, '127.0.0.1');
  server.unref();
}

function every(seconds, fn) {
  const loop = async () => {
    if (stopping) return;
    try { await fn(); } catch (e) { log.error({ err: e.message }, 'Error en tarea periódica'); }
    if (!stopping) setTimeout(loop, seconds * 1000);
  };
  loop();
}

// desinstalar-servicio.bat deja un archivo bot.stop para apagar el bot con calma
function checkStopFile() {
  if (!existsSync(config.stopFile)) return;
  try { unlinkSync(config.stopFile); } catch { /* ya no está */ }
  shutdown('bot.stop');
}

async function main() {
  if (existsSync(config.stopFile)) {
    try { unlinkSync(config.stopFile); } catch { /* sin acceso */ }
  }
  const { error } = await db.from('wa_sessions').select('tenant_id').limit(1);
  if (error) {
    log.fatal({ err: error.message }, 'No se pudo conectar con Supabase. Revisa SUPABASE_URL y SUPABASE_SECRET_KEY.');
    finish(EXIT.ERROR);
    return;
  }
  log.info({ pid: process.pid, env: config.envFile, registro: join(config.logDir, 'bot.log') }, 'Bot de Reservalope iniciado');
  if (journal.size()) log.warn({ pendientes: journal.size() }, 'Hay resultados de envío pendientes de guardar');
  startHealthServer();
  const restored = await restoreSessions();
  await cleanStaleStatus(restored);
  every(5, handleRequests);
  every(config.pollSeconds, runOutbox);
  every(30, heartbeat);
  every(3, checkStopFile);
  setTimeout(() => every(config.campaignMinutes * 60, campaigns), 60000);   // tras reconectar
}

// --------------------------------------------------------------------------
// Apagado: devolver a la cola lo tomado y cerrar las sesiones
// --------------------------------------------------------------------------
function finish(code) {
  lock.release();
  // Dar tiempo a que se escriba el registro
  setTimeout(() => process.exit(code), 200);
}

async function shutdown(signal, code = EXIT.OK) {
  if (stopping) return;
  stopping = true;
  signalStop();
  clearTimeout(outboxTimer);
  log.info({ motivo: signal }, 'Apagando el bot…');
  // Windows da unos 10 s al cerrar la ventana: salir sí o sí antes
  setTimeout(() => finish(code), 8000).unref();
  const queued = [];
  try {
    for (const w of workers.values()) queued.push(...w.queue.splice(0));
    await Promise.allSettled(queued.map((i) => release(i.m.id)));
    // Esperar el mensaje que se está enviando ahora
    await Promise.race([Promise.allSettled([...workers.values()].map((w) => w.promise)), sleep(6000)]);
    for (const s of sessions.values()) {
      const waitingQr = s.linking && !s.connected;
      await s.close();
      // Un QR que ya nadie va a atender no debe quedar en el CRM
      if (waitingQr) {
        await s.setStatus({ status: 'DISCONNECTED', qr: null,
          last_error: 'El bot se apagó antes de escanear el QR. Pulsa "Vincular WhatsApp" de nuevo.' });
      }
    }
  } catch (e) {
    log.error({ err: e.message }, 'Error al apagar');
  }
  log.info({ devueltosALaCola: queued.length }, 'Bot apagado');
  finish(code);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => shutdown(sig));
if (process.platform === 'win32') process.on('SIGBREAK', () => shutdown('SIGBREAK'));

process.on('unhandledRejection', (e) => log.error({ err: e && e.message ? e.message : String(e) }, 'Promesa rechazada sin manejar'));
process.on('uncaughtException', (e) => {
  log.fatal({ err: e.message, stack: e.stack }, 'Error inesperado; el bot se reinicia');
  lock.release();
  process.exit(EXIT.ERROR);
});

main().catch((e) => {
  log.fatal({ err: e.message }, 'No se pudo iniciar el bot');
  finish(EXIT.ERROR);
});
