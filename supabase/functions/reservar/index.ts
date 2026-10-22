// ==========================================================================
// Edge Function · reservar
// --------------------------------------------------------------------------
// La web pública envía aquí la reserva. Se verifica el captcha de Cloudflare
// Turnstile y luego se llama a public.crear_reserva con la secret key.
// Los campos propios del negocio llegan en "extra" (objeto { clave: valor }).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TURNSTILE_SECRET_KEY  clave secreta de Turnstile (obligatoria en producción)
//   TURNSTILE_HOSTNAMES   opcional: dominios permitidos, separados por comas
//                         (p. ej. "reservalope.com,www.reservalope.com"). Si está,
//                         el captcha debe haberse resuelto en uno de ellos (B10).
//   ALLOW_NO_CAPTCHA      "true" solo en el proyecto de pruebas, mientras no haya captcha
//
// Los errores de la base se devuelven en español; un error técnico nunca se
// muestra tal cual al cliente (M5).
// ==========================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;
const GENERIC = 'No pudimos registrar tu reserva. Inténtalo de nuevo en unos minutos.';

type Captcha = { ok: true } | { ok: false; error: string };

async function verifyCaptcha(token: string, ip: string | null): Promise<Captcha> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) {
    return Deno.env.get('ALLOW_NO_CAPTCHA') === 'true'
      ? { ok: true }
      : { ok: false, error: 'Las reservas en línea no están configuradas todavía. Escríbenos para reservar.' };
  }
  if (!token) return { ok: false, error: 'Completa la verificación de seguridad antes de reservar.' };
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  let out: Record<string, unknown> = {};
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    out = await r.json().catch(() => ({}));
  } catch (_e) {
    return { ok: false, error: 'No pudimos verificar que no eres un robot. Inténtalo de nuevo.' };
  }
  if (out.success !== true) {
    return { ok: false, error: 'No pudimos verificar que no eres un robot. Recarga la página e inténtalo de nuevo.' };
  }
  const allowed = (Deno.env.get('TURNSTILE_HOSTNAMES') || '')
    .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length && !allowed.includes(String(out.hostname || '').toLowerCase())) {
    return { ok: false, error: 'No pudimos verificar que no eres un robot. Recarga la página e inténtalo de nuevo.' };
  }
  return { ok: true };
}

// Mensajes que la base escribe para el cliente (raise exception … errcode 22023/23505)
function friendly(error: { code?: string; message?: string }): string {
  const code = String(error.code || '');
  const msg = String(error.message || '');
  if ((code === '22023' || code === '23505') && msg && !/violates|constraint|duplicate key|syntax|invalid input/i.test(msg)) {
    return msg;
  }
  if (code === '23505') return 'Ese horario acaba de ser tomado. Elige otro.';
  return GENERIC;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_KEY');
  if (!url || !secret) return json(500, { error: 'Falta configurar la clave del servidor (SERVICE_KEY).' });

  const b = await req.json().catch(() => null);
  if (!b || typeof b !== 'object') return json(400, { error: 'Solicitud no válida. Recarga la página.' });

  const ip = req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
  const cap = await verifyCaptcha(String(b.captcha || ''), ip);
  if (!cap.ok) return json(400, { error: cap.error });

  // Validación de forma (para que la base no responda con errores técnicos)
  const slug = String(b.slug || '').trim().toLowerCase();
  if (!slug) return json(400, { error: 'No encontramos este negocio.' });
  if (!b.service_id || !UUID_RE.test(String(b.service_id))) return json(400, { error: 'Elige un servicio.' });
  if (!b.barber_id || !UUID_RE.test(String(b.barber_id))) return json(400, { error: 'Elige un profesional.' });
  if (!DATE_RE.test(String(b.date || '')) || !TIME_RE.test(String(b.time || ''))) {
    return json(400, { error: 'Elige la fecha y la hora de tu cita.' });
  }
  const name = String(b.name || '').trim();
  if (name.length < 2 || name.length > 80) return json(400, { error: 'Tu nombre debe tener entre 2 y 80 letras.' });
  const notes = String(b.notes || '').trim();
  if (notes.length > 300) return json(400, { error: 'Las notas no pueden pasar de 300 caracteres.' });
  // Campos propios del negocio (booking_fields de web_barberia). La base valida
  // cada uno contra la configuración del negocio; aquí solo la forma.
  const extra = b.extra == null ? {} : b.extra;
  if (typeof extra !== 'object' || Array.isArray(extra) || JSON.stringify(extra).length > 8192) {
    return json(400, { error: 'Revisa los datos de tu reserva e inténtalo de nuevo.' });
  }

  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc('crear_reserva', {
    p_slug: slug,
    p_service_id: String(b.service_id),
    p_barber_id: String(b.barber_id),
    p_date: String(b.date),
    p_time: String(b.time),
    p_name: name,
    p_phone: String(b.phone || ''),
    p_notes: notes,
    p_wa_opt_in: b.wa_opt_in === true,
    p_extra: extra,
  });
  if (error) {
    const msg = friendly(error);
    if (msg === GENERIC) console.error('crear_reserva', error.code, error.message);
    return json(400, { error: msg });
  }
  return json(200, { ok: true, reserva: data });
});
