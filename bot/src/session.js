// ==========================================================================
// Una sesión de WhatsApp por barbería
// --------------------------------------------------------------------------
// Vincula el número con un QR (que el CRM muestra), mantiene la conexión,
// envía mensajes y pasa a la base de datos las respuestas de los clientes.
// ==========================================================================
import { join } from 'node:path';
import makeWASocket, {
  Browsers, DisconnectReason, fetchLatestBaileysVersion, isJidGroup, isLidUser,
  isPnUser, jidDecode, makeCacheableSignalKeyStore
} from '@whiskeysockets/baileys';
import QRCode from 'qrcode';
import { useEncryptedAuthState, wipeSession } from './auth-state.js';

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class TenantSession {
  constructor({ tenantId, config, db, log, waLog, onInbound }) {
    this.tenantId = tenantId;
    this.config = config;
    this.db = db;
    this.log = log.child({ barberia: tenantId });
    this.waLog = waLog;
    this.onInbound = onInbound;
    this.folder = join(config.sessionsDir, tenantId);
    this.sock = null;
    this.connected = false;
    this.stopped = false;
    this.linking = false;      // se pidió vincular desde el CRM (se acepta mostrar QR)
    this.retries = 0;
  }

  async setStatus(fields) {
    const row = Object.assign({ tenant_id: this.tenantId, last_seen_at: new Date().toISOString() }, fields);
    const { error } = await this.db.from('wa_sessions').upsert(row, { onConflict: 'tenant_id' });
    if (error) this.log.error({ err: error.message }, 'No se pudo actualizar wa_sessions');
  }

  // fresh = borrar la sesión anterior y pedir un QR nuevo
  async start({ fresh = false } = {}) {
    if (fresh) {
      await this.close();
      await wipeSession(this.folder);
      this.linking = true;
      this.retries = 0;
    }
    this.stopped = false;
    const { state, saveCreds } = await useEncryptedAuthState(this.folder, this.config.sessionKey);
    const version = await currentVersion(this.log);
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
    sock.ev.on('connection.update', (u) => this.onConnection(sock, state, u).catch((e) =>
      this.log.error({ err: e.message }, 'Error al procesar el estado de la conexión')));
    sock.ev.on('messages.upsert', (ev) => this.onMessages(sock, ev).catch((e) =>
      this.log.error({ err: e.message }, 'Error al procesar un mensaje recibido')));
  }

  async onConnection(sock, state, { connection, lastDisconnect, qr }) {
    if (sock !== this.sock) return;            // eventos de un socket ya reemplazado
    if (qr) {
      if (!this.linking) {
        // La sesión guardada ya no sirve y nadie pidió vincular: no dejar un QR colgado
        this.log.warn('La sesión guardada no es válida; hay que volver a vincular desde el CRM');
        this.stopped = true;
        sock.end(undefined);
        await this.setStatus({ status: 'DISCONNECTED', qr: null, last_error: 'Vuelve a vincular WhatsApp desde el CRM.' });
        return;
      }
      const img = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
      await this.setStatus({ status: 'WAITING_QR', qr: img, last_error: null });
      this.log.info('QR listo para escanear desde el CRM');
      return;
    }

    if (connection === 'open') {
      this.connected = true;
      this.linking = false;
      this.retries = 0;
      const phone = (jidDecode(sock.user && sock.user.id) || {}).user || null;
      await this.setStatus({ status: 'CONNECTED', phone, qr: null, last_error: null });
      this.log.info({ phone }, 'WhatsApp conectado');
      return;
    }

    if (connection === 'close') {
      this.connected = false;
      if (this.stopped) return;
      const code = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output
        ? lastDisconnect.error.output.statusCode : 0;
      const linked = !!(state.creds.me && state.creds.me.id);
      this.log.warn({ code }, 'Conexión cerrada');

      if (code === DisconnectReason.loggedOut) {
        this.stopped = true;
        await wipeSession(this.folder);
        await this.setStatus({ status: 'LOGGED_OUT', phone: null, qr: null,
          last_error: 'Se cerró la sesión desde el celular. Vuelve a vincular.' });
        return;
      }
      if (code === DisconnectReason.connectionReplaced) {
        this.stopped = true;
        await this.setStatus({ status: 'DISCONNECTED', qr: null,
          last_error: 'Esta sesión se abrió en otro bot. Deja un solo bot encendido y vuelve a vincular.' });
        return;
      }
      if (!linked && code !== DisconnectReason.restartRequired) {
        // El QR venció sin que lo escanearan
        this.stopped = true;
        this.linking = false;
        await this.setStatus({ status: 'DISCONNECTED', qr: null,
          last_error: 'El código QR venció. Pulsa "Vincular WhatsApp" de nuevo.' });
        return;
      }
      // Reconectar (515 llega justo después de escanear el QR: es normal)
      this.retries += 1;
      const wait = code === DisconnectReason.restartRequired ? 0 : Math.min(60000, 2000 * 2 ** Math.min(this.retries, 5));
      if (this.retries > 1) await this.setStatus({ status: 'DISCONNECTED', last_error: 'Reconectando…' });
      await sleep(wait);
      if (!this.stopped) await this.start();
    }
  }

  // Número (9XXXXXXXX con prefijo) de quien escribió, aunque WhatsApp mande un LID
  async senderNumber(sock, key) {
    const candidates = [key.remoteJid, key.remoteJidAlt];
    for (const jid of candidates) {
      if (jid && isPnUser(jid)) return jidDecode(jid).user;
    }
    if (key.remoteJid && isLidUser(key.remoteJid)) {
      try {
        const pn = await sock.signalRepository.lidMapping.getPNForLID(key.remoteJid);
        if (pn) return jidDecode(pn).user;
      } catch { /* sin mapeo */ }
    }
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
      const { data, error } = await this.db.rpc('bot_respuesta', { p_tenant_id: this.tenantId, p_from: from, p_text: text });
      if (error) { this.log.error({ err: error.message }, 'bot_respuesta falló'); continue; }
      if (data) {
        this.log.info('Respuesta del cliente procesada');
        this.onInbound();
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
    await sock.sendMessage(jid, { text: body });
  }

  async logout() {
    this.stopped = true;
    this.linking = false;
    try { if (this.sock && this.connected) await this.sock.logout(); } catch { /* ya estaba cerrada */ }
    await this.close();
    await wipeSession(this.folder);
    await this.setStatus({ status: 'LOGGED_OUT', phone: null, qr: null, last_error: null });
  }

  async close() {
    this.stopped = true;
    this.connected = false;
    if (this.sock) {
      try { this.sock.end(undefined); } catch { /* ya cerrada */ }
      this.sock = null;
    }
  }
}
