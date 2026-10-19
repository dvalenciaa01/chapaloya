// ==========================================================================
// Edge Function · reservar
// --------------------------------------------------------------------------
// La web pública envía aquí la reserva. Se verifica el captcha de Cloudflare
// Turnstile y luego se llama a public.crear_reserva con la secret key.
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TURNSTILE_SECRET_KEY  clave secreta de Turnstile (obligatoria en producción)
//   ALLOW_NO_CAPTCHA      "true" solo en el proyecto de pruebas, mientras no haya captcha
// ==========================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

async function captchaOk(token: string, ip: string | null): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) return Deno.env.get('ALLOW_NO_CAPTCHA') === 'true';
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const out = await r.json().catch(() => ({}));
  return out.success === true;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  const url = Deno.env.get('SUPABASE_URL')!;
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_KEY');
  if (!url || !secret) return json(500, { error: 'Falta configurar la clave del servidor (SERVICE_KEY).' });

  const b = await req.json().catch(() => ({}));
  const ip = req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for');
  if (!(await captchaOk(String(b.captcha || ''), ip))) {
    return json(400, { error: 'No pudimos verificar que no eres un robot. Recarga la página e inténtalo de nuevo.' });
  }

  const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await sb.rpc('crear_reserva', {
    p_slug: String(b.slug || ''),
    p_service_id: b.service_id || null,
    p_barber_id: b.barber_id || null,
    p_date: b.date || null,
    p_time: b.time || null,
    p_name: String(b.name || ''),
    p_phone: String(b.phone || ''),
    p_notes: String(b.notes || ''),
    p_wa_opt_in: b.wa_opt_in === true,
  });
  if (error) return json(400, { error: error.message });
  return json(200, { ok: true, reserva: data });
});
