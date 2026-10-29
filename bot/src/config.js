// ==========================================================================
// Configuración del bot (variables de entorno, ver bot/.env.example)
// --------------------------------------------------------------------------
// De dónde se leen las variables (el primero que exista):
//   1. El archivo indicado en BOT_ENV_FILE.
//   2. %ProgramData%\Reservalope\bot.env (Windows: fuera de la carpeta del
//      bot, para que no viaje con ella si alguien la copia).
//   3. bot/.env (junto a este programa).
// Las variables ya definidas en el sistema mandan sobre las del archivo.
// ==========================================================================
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Carpeta bot/ (no depende de desde dónde se lance node)
export const botDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Códigos de salida que entienden iniciar.bat y servicio.bat
export const EXIT = {
  OK: 0,              // apagado normal (Ctrl+C, desinstalar-servicio.bat): no reiniciar
  ERROR: 1,           // error inesperado o Supabase caído: reiniciar en unos segundos
  CONFIG: 2,          // falta configuración: reiniciar no sirve
  OTRA_INSTANCIA: 3   // ya hay otro bot encendido en esta carpeta
};

export function envCandidates(env = process.env) {
  const list = [];
  if (env.BOT_ENV_FILE) list.push({ path: resolve(botDir, env.BOT_ENV_FILE), required: true });
  if (env.ProgramData || env.PROGRAMDATA) {
    list.push({ path: join(env.ProgramData || env.PROGRAMDATA, 'Reservalope', 'bot.env'), required: false });
  }
  list.push({ path: join(botDir, '.env'), required: false });
  return list;
}

function fail(lines) {
  for (const l of [].concat(lines)) console.error(l);
  process.exit(EXIT.CONFIG);
}

// Carga el primer archivo de variables que exista. Devuelve su ruta (o null).
function loadEnv() {
  for (const c of envCandidates()) {
    if (!existsSync(c.path)) {
      if (c.required) fail(`BOT_ENV_FILE apunta a ${c.path}, pero ese archivo no existe.`);
      continue;
    }
    try {
      process.loadEnvFile(c.path);
      return c.path;
    } catch (e) {
      if (e.code === 'EACCES' || e.code === 'EPERM') {
        fail([
          `No hay permiso para leer ${c.path}.`,
          'Si instalaste el bot como servicio (instalar-servicio.bat), ya está encendido solo: no hace falta iniciar.bat.',
          'Para volver a usar iniciar.bat, ejecuta primero desinstalar-servicio.bat como administrador.'
        ]);
      }
      fail(`No se pudo leer ${c.path}: ${e.message}`);
    }
  }
  return null;
}

function num(name, def, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function required(name) {
  const v = (process.env[name] || '').trim();
  if (!v) fail(`Falta la variable ${name}. Revisa el archivo .env (ver .env.example).`);
  return v;
}

export function loadConfig() {
  const envFile = loadEnv();
  const sessionKey = required('BOT_SESSION_KEY');
  if (!/^[0-9a-f]{64}$/i.test(sessionKey)) {
    fail([
      'BOT_SESSION_KEY debe tener 64 caracteres hexadecimales. Genérala con:',
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"'
    ]);
  }
  const config = {
    envFile,
    botDir,
    supabaseUrl: required('SUPABASE_URL'),
    supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
    sessionKey: Buffer.from(sessionKey, 'hex'),
    sessionsDir: resolve(botDir, process.env.BOT_SESSIONS_DIR || 'sessions'),
    logDir: resolve(botDir, process.env.BOT_LOG_DIR || 'logs'),
    logConsole: process.env.BOT_LOG_CONSOLE !== '0',
    journalFile: join(botDir, 'marcados-pendientes.json'),
    stopFile: join(botDir, 'bot.stop'),
    pollSeconds: num('BOT_POLL_SECONDS', 30, 5, 600),
    minDelaySeconds: num('BOT_MIN_DELAY_SECONDS', 8, 1, 120),
    maxDelaySeconds: num('BOT_MAX_DELAY_SECONDS', 20, 1, 300),
    batchPerTenant: num('BOT_BATCH_PER_TENANT', 5, 1, 20),
    inboundMax: num('BOT_INBOUND_MAX', 5, 1, 100),
    inboundWindowMinutes: num('BOT_INBOUND_WINDOW_MINUTES', 10, 1, 1440),
    maxReconnects: num('BOT_MAX_RECONNECTS', 40, 1, 1000),
    // Si el negocio escribió a mano a un cliente en estas horas, el bot no le manda el menú al saludar
    humanQuietHours: num('BOT_HUMAN_QUIET_HOURS', 6, 0, 72),
    // Cada cuántos minutos se programan los "te extrañamos" (bot_campanas)
    campaignMinutes: num('BOT_CAMPAIGN_MINUTES', 10, 1, 120),
    healthPort: num('BOT_HEALTH_PORT', 8080, 0, 65535),
    logLevel: process.env.BOT_LOG_LEVEL || 'info'
  };
  if (config.maxDelaySeconds < config.minDelaySeconds) config.maxDelaySeconds = config.minDelaySeconds;
  return config;
}
