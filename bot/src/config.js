// ==========================================================================
// Configuración del bot (variables de entorno, ver bot/.env.example)
// ==========================================================================
import { resolve } from 'node:path';

// Node 20.12+ lee el archivo .env sin paquetes extra
try { process.loadEnvFile(resolve(process.cwd(), '.env')); } catch { /* sin .env: se usan las variables del sistema */ }

function num(name, def, min, max) {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v)) return def;
  return Math.min(max, Math.max(min, v));
}

function required(name) {
  const v = (process.env[name] || '').trim();
  if (!v) {
    console.error(`Falta la variable ${name}. Revisa el archivo .env (ver .env.example).`);
    process.exit(1);
  }
  return v;
}

const sessionKey = required('BOT_SESSION_KEY');
if (!/^[0-9a-f]{64}$/i.test(sessionKey)) {
  console.error('BOT_SESSION_KEY debe tener 64 caracteres hexadecimales. Genérala con:');
  console.error('  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  process.exit(1);
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseSecretKey: required('SUPABASE_SECRET_KEY'),
  sessionKey: Buffer.from(sessionKey, 'hex'),
  sessionsDir: resolve(process.env.BOT_SESSIONS_DIR || 'sessions'),
  pollSeconds: num('BOT_POLL_SECONDS', 30, 5, 600),
  minDelaySeconds: num('BOT_MIN_DELAY_SECONDS', 8, 1, 120),
  maxDelaySeconds: num('BOT_MAX_DELAY_SECONDS', 20, 1, 300),
  healthPort: num('BOT_HEALTH_PORT', 8080, 0, 65535),
  logLevel: process.env.BOT_LOG_LEVEL || 'info'
};
if (config.maxDelaySeconds < config.minDelaySeconds) config.maxDelaySeconds = config.minDelaySeconds;
