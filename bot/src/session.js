// ==========================================================================
// Una sesión de WhatsApp por barbería
// --------------------------------------------------------------------------
// Vincula el número con un QR (que el CRM muestra), mantiene la conexión,
// envía mensajes y pasa a la base de datos las respuestas de los clientes.
//
// Cada start() abre un socket nuevo y sube `gen`: los eventos y reconexiones
// pendientes de un socket anterior se descartan, así un "Vincular" que llega
// mientras se reconecta no deja dos sockets abiertos con la misma sesión.
// ==========================================================================
import { join } from 'node:path';
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, isJidGroup, isLidUser,
  isPnUser, jidDecode, makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { hasLinkedSession, useEncryptedAuthState, wipeSession } from './auth-state.js';
import { backoffMs, sleep } from './util.js';

let waVersion = null;
async function currentVersion(log) {
  if (waVersion) return waVersion;
  try {
    const { version } = await fetchLatestBaileysVersion();
    waVersion = version;
  } catch (e) {
    log.warn({ err: e.message }, 'No se pudo consultar la versión de WhatsApp Web; se usa la que trae Baileys');
  }
  return waVersion;
}

// Cierres que no se arreglan reconectando: se detiene la sesión y el CRM
// muestra el motivo. wipe = borrar la sesión guardada (ya no sirve).
export const FINAL_CLOSE = {
  [DisconnectReason.loggedOut]: {
    reason: 'logout', status: 'LOGGED_OUT', wipe: true,
    error: 'Se cerró la sesión desde el celular. Vuelve a vincular.'
  },
  [DisconnectReason.connectionReplaced]: {
    reason: 'replaced', status: 'DISCONNECTED', wipe: false,
    error: 'Esta sesión se abrió en otro bot. Deja un solo bot encendido y pulsa "Vincular WhatsApp".'
  },
  [DisconnectReason.forbidden]: {
    reason: 'banned', status: 'DISCONNECTED', wipe: false,
    error: 'WhatsApp bloqueó este número. Revísalo en el celular; si lo recuperas, vuelve a vincular.'
  },
  [DisconnectReason.badSession]: {
    reason: 'bad', status: 'LOGGED_OUT', wipe: true,
    error: 'Sesión dañada: vuelve a vincular WhatsApp.'
  },
  [DisconnectReason.multideviceMismatch]: {
    reason: 'mismatch', status: 'DISCONNECTED', wipe: false,
    error: 'WhatsApp rechazó este dispositivo vinculado. Actualiza WhatsApp en el celular y vuelve a vincular.'
  }
};

export class TenantSession {
  constructor({ tenantId, config, db, log, waLog, onInbound, onOpen, inboundLimiter }) {
    this.tenantId = tenantId;
    this.config = config;
    this.db = db;
    this.log = log.child({ barberia: tenantId });
    this.waLog = waLog;
    this.onInbound = onInbound || (() => {});
    this.onOpen = onOpen || (() => {});
    this.inboundLimiter = inboundLimiter || null;
    this.folder = join(config.sessionsDir, tenantId);
    this.sock = null;
    this.gen = 0;              // sube con cada start(); invalida sockets y reconexiones anteriores
    this.connected = false;
    this.stopped = true;
    this.stopReason = null;    // por qué se detuvo (ver FINAL_CLOSE, 'retries', 'qr', 'invalid')
    this.linking = false;      // se pidió vincular desde el CRM (se acepta mostrar QR)
    this.retries = 0;
    this.firstAttemptDone = false;   // terminó el primer intento de conexión tras start()
    this.startedAt = 0;
  }

  // Hay un socket abierto o reconectándose
  get running() { return !this.stopped; }

  hasLinkedSession() { return hasLinkedSession(this.folder, this.config.sessionKey); }

  async setStatus(fields) {
    const row = Object.assign({ tenant_id: this.tenantId, last_seen_at: new Date().toISOString() }, fields);
    const { error } = await this.db.from('wa_sessions').upsert(row, { onConflict: 'tenant_id' });
    if (error) this.log.error({ err: error.message }, 'No se pudo actualizar wa_sessions');
  }

  // fresh = borrar la sesión anterior y pedir un QR nuevo
  // linking = se acepta mostrar un QR (lo pidió el CRM)
  async start({ fresh = false, linking = fresh } = {}) {
    const gen = ++this.gen;
    this.endSocket();
    if (fresh) {
      await wipeSession(this.folder);
      this.retries = 0;
    }
    if (gen !== this.gen) return;            // otro start() empezó mientras tanto
    if (linking) this.linking = true;
    this.stopped = false;
    this.stopReason = null;
    if (this.retries === 0) { this.firstAttemptDone = false; this.startedAt = Date.now(); }

    const { state, saveCreds } = await useEncryptedAuthState(this.folder, this.config.sessionKey);
    const version = await currentVersion(this.log);
    if (gen !== this.gen || this.stopped) return;

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, this.waLog) },
      logger: this.waLog,
      browser: Browsers.ubuntu('Reservalope'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false
    });
    this.sock = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => this.onConnection(sock, gen, state, u).catch((e) =>
      this.log.error({ err: e.message }, 'Error al procesar el estado de la conexión')));
    sock.ev.on('messages.upsert', (ev) => this.onMessages(sock, ev).catch((e) =>
      this.log.error({ err: e.message }, 'Error al procesar un mensaje recibido')));
  }

  // Cierra el socket actual sin tocar el estado (sus eventos ya no cuentan)
  endSocket() {
    const sock = this.sock;
    this.sock = null;
    this.connected = false;
    if (sock) {
      try { sock.end(undefined); } catch { /* ya cerrada */ }
    }
  }

  async stopWith(reason, status) {
    this.stopped = true;
    this.stopReason = reason;
    this.linking = false;
    this.firstAttemptDone = true;
    this.endSocket();
    if (status) await this.setStatus(status);
  }

  async onConnection(sock, gen, state, { connection, lastDisconnect, qr }) {
    if (sock !== this.sock || gen !== this.gen) return;   // eventos de un socket ya reemplazado
    if (qr) {
      if (!this.linking) {
        // La sesión guardada ya no sirve y nadie pidió vincular: no dejar un QR colgado
        this.log.warn('La sesión guardada no es válida; hay que volver a vincular desde el CRM');
        await this.stopWith('invalid', { status: 'DISCONNECTED', qr: null,
          last_error: 'La sesión guardada ya no es válida. Pulsa "Vincular WhatsApp".' });
        return;
      }
      const img = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      if (gen !== this.gen || this.stopped) return;
      await this.setStatus({ status: 'WAITING_QR', qr: img, last_error: null });
      this.log.info('QR listo para escanear desde el CRM');
      return;
    }

    if (connection === 'open') {
      this.connected = true;
      this.linking = false;
      this.retries = 0;
      this.firstAttemptDone = true;
      const phone = (jidDecode(sock.user && sock.user.id) || {}).user || null;
      await this.setStatus({ status: 'CONNECTED', phone, qr: null, last_error: null });
      this.log.info({ phone }, 'WhatsApp conectado');
      this.onOpen(this);
      return;
    }

    if (connection === 'close') {
      this.connected = false;
      if (this.stopped) return;
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode : 0;
      const linked = !!(state.creds.me && state.creds.me.id);
      this.log.warn({ code }, 'Conexión cerrada');

      const final = FINAL_CLOSE[code];
      if (final) {
        this.log.error({ code, motivo: final.reason }, final.error);
        await this.stopWith(final.reason, null);
        if (final.wipe) await wipeSession(this.folder);
        await this.setStatus({ status: final.status, qr: null, last_error: final.error,
          ...(final.wipe ? { phone: null } : {}) });
        return;
      }
      if (!linked && code !== DisconnectReason.restartRequired) {
        // El QR venció sin que lo escanearan
        await this.stopWith('qr', { status: 'DISCONNECTED', qr: null,
          last_error: 'El código QR venció. Pulsa "Vincular WhatsApp" de nuevo.' });
        return;
      }
      // Reconectar (515 llega justo después de escanear el QR: es normal)
      this.firstAttemptDone = true;
      this.retries += 1;
      if (this.retries > this.config.maxReconnects) {
        this.log.error({ intentos: this.retries - 1 }, 'Se agotaron los intentos de reconexión');
        await this.stopWith('retries', { status: 'DISCONNECTED', qr: null,
          last_error: 'No se pudo reconectar con WhatsApp tras muchos intentos. Revisa el internet del bot y pulsa "Vincular WhatsApp" (no se pierde la vinculación).' });
        return;
      }
      const wait = code === DisconnectReason.restartRequired ? 0 : backoffMs(this.retries, 2000, 300000);
      if (this.retries > 1) await this.setStatus({ status: 'DISCONNECTED', qr: null, last_error: 'Reconectando…' });
      await sleep(wait);
      if (gen === this.gen && !this.stopped) await this.start({ linking: this.linking });
    }
  }

  // Número (9XXXXXXXX con prefijo) de quien escribió, aunque WhatsApp mande un LID
  async senderNumber(sock, key) {
    const candidates = [key.remoteJid, key.remoteJidAlt, key.senderPn];
    for (const jid of candidates) {
      if (jid && isPnUser(jid)) return jidDecode(jid).user;
    }
    const lids = [key.remoteJid, key.remoteJidAlt].filter((j) => j && isLidUser(j));
    for (const lid of lids) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(lid);
        if (pn) return jidDecode(pn).user;
      } catch (e) {
        this.log.debug({ err: e.message }, 'Fallo al consultar el mapeo LID');
      }
    }
    // Registrar estos casos (B4) para saber cuántos CONFIRMAR se pierden
    this.log.warn({ jid: key.remoteJid, alt: key.remoteJidAlt || null },
      'No se pudo saber el número de quien escribió (ID privado de WhatsApp); su respuesta se ignora');
    return null;
  }

  async onMessages(sock, { messages, type }) {
    if (type !== 'notify') return;
    for (const m of messages) {
      const key = m.key || {};
      if (key.fromMe || !key.remoteJid || isJidGroup(key.remoteJid) || key.remoteJid === 'status@broadcast') continue;
      const msg = m.message || {};
      const text = msg.conversation || (msg.extendedTextMessage && msg.extendedTextMessage.text) || '';
      if (!text || text.length > 60) continue;          // solo respuestas cortas (CONFIRMAR, BAJA…)
      const from = await this.senderNumber(sock, key);
      if (!from) continue;
      // Límite por remitente: alguien que escribe "baja" 50 veces no llena la cola
      if (this.inboundLimiter && !this.inboundLimiter.hit(`${this.tenantId}:${from}`)) {
        this.log.warn({ remitente: from.slice(-4) }, 'Demasiados mensajes seguidos de este número; se ignora');
        continue;
      }
      const { data, error } = await this.db.rpc('bot_respuesta', { p_tenant_id: this.tenantId, p_from: from, p_text: text });
      if (error) { this.log.error({ err: error.message }, 'bot_respuesta falló'); continue; }
      if (data) {
        this.log.info('Respuesta del cliente procesada');
        this.onInbound(this);
      }
    }
  }

  async send(recipient, body) {
    const sock = this.sock;
    if (!sock || !this.connected) throw new Error('WhatsApp desconectado');
    let jid = recipient;
    if (!recipient.includes('@')) {
      const [r] = (await sock.onWhatsApp(recipient)) || [];
      if (!r || !r.exists) throw new Error('Ese número no tiene WhatsApp');
      jid = r.jid;
    }
    // Simular que se escribe: los envíos se ven más naturales
    try {
      await sock.sendPresenceUpdate('composing', jid);
      await sleep(1000 + Math.min(4000, body.length * 25));
      await sock.sendPresenceUpdate('paused', jid);
    } catch { /* no es crítico */ }
    if (sock !== this.sock || !this.connected) throw new Error('WhatsApp desconectado');
    await sock.sendMessage(jid, { text: body });
  }

  async logout() {
    this.gen++;
    const sock = this.sock;
    try { if (sock && this.connected) await sock.logout(); } catch { /* ya estaba cerrada */ }
    await this.stopWith('logout', null);
    await wipeSession(this.folder);
    await this.setStatus({ status: 'LOGGED_OUT', phone: null, qr: null, last_error: null });
  }

  async close() {
    this.gen++;
    this.stopped = true;
    this.endSocket();
  }
}
