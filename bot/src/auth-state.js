// ==========================================================================
// Sesión de WhatsApp guardada en disco, cifrada (AES-256-GCM con BOT_SESSION_KEY)
// --------------------------------------------------------------------------
// Igual que useMultiFileAuthState de Baileys, pero quien copie la carpeta
// de sesiones sin la clave no puede usar el WhatsApp de la barbería.
// ==========================================================================
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys';

function encrypt(key, text) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]);
}

function decrypt(key, buf) {
  const d = createDecipheriv('aes-256-gcm', key, buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8');
}

export async function useEncryptedAuthState(folder, key) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const locks = new Map();
  // Cada archivo se lee y escribe de a uno (Baileys escribe en paralelo)
  const withLock = (file, fn) => {
    const prev = locks.get(file) || Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    locks.set(file, next);
    return next;
  };
  const fileOf = (name) => join(folder, name.replace(/\//g, '__').replace(/:/g, '-') + '.enc');

  const write = (name, data) => withLock(name, () =>
    writeFile(fileOf(name), encrypt(key, JSON.stringify(data, BufferJSON.replacer)), { mode: 0o600 }));
  const read = (name) => withLock(name, async () => {
    try {
      return JSON.parse(decrypt(key, await readFile(fileOf(name))), BufferJSON.reviver);
    } catch {
      return null;
    }
  });
  const remove = (name) => withLock(name, () => unlink(fileOf(name)).catch(() => {}));

  const creds = (await read('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const out = {};
          await Promise.all(ids.map(async (id) => {
            let v = await read(`${type}-${id}`);
            if (type === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            out[id] = v;
          }));
          return out;
        },
        set: async (data) => {
          const tasks = [];
          for (const type in data) {
            for (const id in data[type]) {
              const v = data[type][id];
              tasks.push(v ? write(`${type}-${id}`, v) : remove(`${type}-${id}`));
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: () => write('creds', creds)
  };
}

// ¿Hay una sesión guardada y vinculada en esta carpeta?
export async function hasLinkedSession(folder, key) {
  try {
    const creds = JSON.parse(decrypt(key, await readFile(join(folder, 'creds.enc'))), BufferJSON.reviver);
    return !!(creds && creds.me && creds.me.id);
  } catch {
    return false;
  }
}

export async function wipeSession(folder) {
  await rm(folder, { recursive: true, force: true });
}
