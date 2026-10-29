// ==========================================================================
// Utilidades del bot (sin dependencias de WhatsApp ni de Supabase)
// --------------------------------------------------------------------------
// - Espera creciente entre reintentos.
// - Límite de mensajes recibidos por remitente.
// - Candado de instancia única (bot.lock).
// - Diario local de resultados de envío que no se pudieron guardar.
// - Archivo de registro que rota por tamaño y por día.
// Todo se prueba con test/util.test.js.
// ==========================================================================
import {
  closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readdirSync,
  renameSync, unlinkSync, utimesSync, statSync, writeFileSync, writeSync
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --------------------------------------------------------------------------
// Espera exponencial: base, 2·base, 4·base… hasta cap (en ms)
// --------------------------------------------------------------------------
export function backoffMs(attempt, base = 2000, cap = 300000) {
  const n = Math.max(0, Math.min(30, attempt | 0));
  return Math.min(cap, base * 2 ** n);
}

// --------------------------------------------------------------------------
// Límite por remitente: como máximo `max` mensajes cada `windowMs`.
// hit(clave) devuelve true si el mensaje entra en el límite.
// --------------------------------------------------------------------------
export function createRateLimiter({ max, windowMs, now = () => Date.now() }) {
  const hits = new Map();   // clave → [marcas de tiempo]
  return {
    hit(key) {
      const t = now();
      const list = (hits.get(key) || []).filter((x) => t - x < windowMs);
      const ok = list.length < max;
      if (ok) list.push(t);
      hits.set(key, list);
      return ok;
    },
    // Olvidar remitentes sin actividad reciente (para no crecer sin fin)
    prune() {
      const t = now();
      for (const [k, list] of hits) {
        if (!list.some((x) => t - x < windowMs)) hits.delete(k);
      }
    },
    size: () => hits.size
  };
}

// --------------------------------------------------------------------------
// Marcas que vencen: recuerda una clave durante `ttlMs` (y como máximo
// `max` claves, olvidando las más viejas). Sirve para saber si el negocio
// escribió a mano a un cliente hace poco y qué mensajes envió el propio bot.
// --------------------------------------------------------------------------
export function createRecent({ ttlMs, max = 5000, now = () => Date.now() }) {
  const marks = new Map();   // clave → marca de tiempo (en orden de llegada)
  return {
    add(key) {
      marks.delete(key);
      marks.set(key, now());
      while (marks.size > max) marks.delete(marks.keys().next().value);
    },
    has(key) {
      const t = marks.get(key);
      if (t === undefined) return false;
      if (now() - t < ttlMs) return true;
      marks.delete(key);
      return false;
    },
    prune() {
      const t = now();
      for (const [k, x] of marks) {
        if (t - x >= ttlMs) marks.delete(k);
      }
    },
    size: () => marks.size
  };
}

// --------------------------------------------------------------------------
// Agrupa los mensajes tomados de la cola por barbería, sin cambiar su orden
// --------------------------------------------------------------------------
export function groupByTenant(rows) {
  const out = new Map();
  for (const r of rows || []) {
    if (!out.has(r.tenant_id)) out.set(r.tenant_id, []);
    out.get(r.tenant_id).push(r);
  }
  return out;
}

// --------------------------------------------------------------------------
// Candado de instancia única
// --------------------------------------------------------------------------
// El archivo guarda el pid del bot que lo tiene. El dueño lo "toca" cada
// 30 s; si el pid ya no existe, o el archivo lleva más de staleMs sin
// tocarse (Windows reutiliza los pid), se considera abandonado.
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';     // existe, pero es de otro usuario (p. ej. el servicio)
  }
}

export function readLock(file) {
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    return { pid: Number(data.pid), startedAt: data.startedAt || null, mtimeMs: statSync(file).mtimeMs };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    // Archivo a medio escribir o dañado: tratarlo como abandonado si es viejo
    try { return { pid: 0, startedAt: null, mtimeMs: statSync(file).mtimeMs }; } catch { return null; }
  }
}

export function lockIsStale(lock, { now = Date.now(), staleMs = 120000, alive = pidAlive } = {}) {
  if (!lock) return true;
  if (lock.pid === process.pid) return false;
  if (!alive(lock.pid)) return true;
  return now - lock.mtimeMs > staleMs;
}

// Intenta tomar el candado. Devuelve { ok: true, release, touch } o
// { ok: false, holder } si otro bot lo tiene.
export function acquireLock(file, { staleMs = 120000, alive = pidAlive } = {}) {
  const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() });
  for (let i = 0; i < 3; i++) {
    try {
      const fd = openSync(file, 'wx');
      writeSync(fd, body);
      closeSync(fd);
      let released = false;
      const mine = () => { const l = readLock(file); return !!l && l.pid === process.pid; };
      return {
        ok: true,
        // Devuelve false si otro proceso se quedó con el candado (no debería pasar)
        touch() {
          if (released) return false;
          if (!mine()) return false;
          const t = new Date();
          try { utimesSync(file, t, t); } catch { /* sin acceso: seguir */ }
          return true;
        },
        release() {
          if (released) return;
          released = true;
          try { if (mine()) unlinkSync(file); } catch { /* ya no está */ }
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const holder = readLock(file);
      if (holder && !lockIsStale(holder, { staleMs, alive })) return { ok: false, holder };
      // Abandonado: borrarlo y volver a intentar
      try { unlinkSync(file); } catch { /* otro lo borró antes */ }
    }
  }
  return { ok: false, holder: readLock(file) };
}

// --------------------------------------------------------------------------
// Diario de resultados de envío pendientes de guardar en la base
// --------------------------------------------------------------------------
// Si bot_marcar falla incluso tras reintentar, el resultado (enviado o no)
// queda aquí y se aplica antes de tomar mensajes nuevos: así un mensaje ya
// enviado no se vuelve a tomar y enviar dos veces.
export function createJournal(file) {
  let entries = [];
  try {
    const data = JSON.parse(readFileSync(file, 'utf8'));
    if (Array.isArray(data)) entries = data.filter((e) => e && typeof e.id === 'string');
  } catch { /* no existe o está dañado: empezar vacío */ }

  const save = () => {
    if (!entries.length) {
      try { unlinkSync(file); } catch { /* no existía */ }
      return;
    }
    const tmp = file + '.tmp';
    writeFileSync(tmp, JSON.stringify(entries, null, 1), { mode: 0o600 });
    renameSync(tmp, file);
  };

  return {
    list: () => entries.slice(),
    size: () => entries.length,
    has: (id) => entries.some((e) => e.id === id),
    add(entry) {
      entries = entries.filter((e) => e.id !== entry.id);
      entries.push({ id: entry.id, ok: !!entry.ok, error: entry.error || null, at: new Date().toISOString() });
      save();
    },
    remove(id) {
      const before = entries.length;
      entries = entries.filter((e) => e.id !== id);
      if (entries.length !== before) save();
    }
  };
}

// --------------------------------------------------------------------------
// Archivo de registro con rotación
// --------------------------------------------------------------------------
// Escribe en logs/bot.log. Al pasar de maxBytes o al cambiar el día, el
// archivo se renombra a bot-AAAA-MM-DD[-n].log y se empieza uno nuevo. Se
// guardan los `keep` más recientes. La escritura es síncrona para que un
// error fatal quede registrado antes de salir.
const dayOf = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export class RotatingFile {
  constructor(file, { maxBytes = 5 * 1024 * 1024, keep = 10, now = () => new Date() } = {}) {
    this.file = file;
    this.maxBytes = maxBytes;
    this.keep = keep;
    this.now = now;
    mkdirSync(dirname(file), { recursive: true });
    this.open();
  }

  open() {
    this.fd = openSync(this.file, 'a', 0o600);
    const st = fstatSync(this.fd);
    this.size = st.size;
    this.day = st.size ? dayOf(st.mtime) : dayOf(this.now());
  }

  rotate() {
    try { closeSync(this.fd); } catch { /* ya cerrado */ }
    const dir = dirname(this.file);
    const stem = basename(this.file).replace(/\.log$/, '');
    let target = join(dir, `${stem}-${this.day}.log`);
    for (let n = 1; existsSync(target); n++) target = join(dir, `${stem}-${this.day}-${n}.log`);
    try { renameSync(this.file, target); } catch { /* si falla, se sigue en el mismo archivo */ }
    // Borrar los más antiguos
    try {
      const old = readdirSync(dir)
        .filter((f) => f.startsWith(stem + '-') && f.endsWith('.log'))
        .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      for (const { f } of old.slice(this.keep)) unlinkSync(join(dir, f));
    } catch { /* no es crítico */ }
    this.open();
  }

  write(chunk) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    const today = dayOf(this.now());
    if (this.size > 0 && (this.size + buf.length > this.maxBytes || today !== this.day)) this.rotate();
    this.day = today;
    try {
      writeSync(this.fd, buf);
      this.size += buf.length;
    } catch { /* disco lleno o sin permiso: no tumbar el bot por el registro */ }
    return true;
  }
}
