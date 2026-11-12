// ==========================================================================
// Edge Function · disenar-con-imagen
// --------------------------------------------------------------------------
// "Copiar diseño de una imagen" (Diseñar web → consola). Recibe la captura de
// una web modelo y le pide a Claude que arme el diseño de la web del negocio
// con ese aspecto: letras, colores, orden y estilo de los bloques y un estilo
// propio (css, migración 31). El contenido sale SOLO de lo que el negocio ya
// tiene (web_barberia): no se inventan servicios, fotos, precios ni datos.
//
// No guarda nada: devuelve el diseño y el editor lo muestra en la vista
// previa; se publica solo si el superadministrador pulsa "Guardar y publicar".
//
// Solo SUPERADMIN (cada generación cuesta dinero).
// Secretos: ANTHROPIC_API_KEY (console.anthropic.com). Opcional:
// DISENO_IA_MODELO para cambiar de modelo sin tocar el código.
//
// POST JSON con el token del usuario en Authorization:
//   { tenant_id, images: [{ data (base64 sin "data:"), media_type }] (1 a 6:
//     una captura larga llega cortada en partes, de arriba abajo), notes?,
//     page (diseño actual), skeleton (HTML de la vista previa sin textos),
//     catalog { types: {tipo: [estilos]}, fonts: {clave: nombre} } }
// Responde un texto que puede empezar con espacios (para que la conexión no
// se corte mientras Claude trabaja) y termina con una línea JSON:
//   { ok: true, design: { theme, blocks, css, omitted }, usage }  o  { error }
// ==========================================================================
import { createClient } from 'npm:@supabase/supabase-js@2.117.2';
import Anthropic from 'npm:@anthropic-ai/sdk@1.8.0';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MEDIA = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_B64 = 7_000_000; // ~5 MB por parte
const MAX_IMAGES = 6;
const MAX_SKELETON = 60_000;

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const cut = (s: unknown, n: number) => {
  const v = typeof s === 'string' ? s.trim() : '';
  return v.length > n ? v.slice(0, n) + '…' : v;
};

// Lo que el negocio tiene, en corto (sin enlaces largos ni datos internos)
function resumen(w: any) {
  const t = w?.tenant || {};
  const site = w?.site || {};
  const services = (w?.services || []).map((s: any) => ({
    nombre: s.name, categoria: s.category || null, precio: s.price, desde: !!s.price_from,
    minutos: s.duration_min, descripcion: cut(s.description, 160) || null,
    tiene_foto: !!(s.image_url || (Array.isArray(s.media) && s.media.length)),
  }));
  const team = (w?.barbers || []).map((b: any) => ({
    nombre: b.name, cargo: b.role_title || null, tiene_foto: !!b.photo_url,
    trabajos_en_galeria: Array.isArray(b.works) ? b.works.length : 0,
  }));
  return {
    negocio: t.name, rubro: w?.business_type || t.business_type, ciudad: t.city || null,
    direccion: t.address || null, telefono: t.phone || null, horario: t.hours || null,
    tiene_logo: !!t.logo_url, whatsapp: !!w?.wa_enabled,
    portada_actual: { titulo: site.heroTitle || null, subtitulo: site.heroSubtitle || null, tiene_foto: !!site.heroImage },
    servicios: services,
    equipo: team,
    fotos_en_galeria: team.reduce((n: number, b: any) => n + b.trabajos_en_galeria, 0),
  };
}

// Diseño actual sin enlaces (Claude solo necesita saber qué hay)
function bloquesActuales(page: any) {
  const blocks = Array.isArray(page?.blocks) ? page.blocks : [];
  return blocks.slice(0, 24).map((b: any) => ({
    type: b.type, style: b.style || null, bg: b.bg || null, bgColor: b.bgColor || null,
    eyebrow: b.eyebrow ?? null, title: b.title ?? null, text: cut(b.text, 400) || (b.text === '' ? '' : null),
    btn: b.btn ?? null, btn2: b.btn2 ?? null,
    items: Array.isArray(b.items) ? b.items.map((i: any) => ({ title: i.title || null, text: cut(i.text, 120) || null })) : undefined,
    tiene_foto: !!b.image, tiene_video: !!b.video, fotos_propias: Array.isArray(b.images) ? b.images.length : 0,
    oculto: b.show === false,
  }));
}

function schema(types: Record<string, string[]>, fonts: string[]) {
  const nstr = { type: ['string', 'null'] };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['theme', 'blocks', 'css', 'omitted'],
    properties: {
      theme: {
        type: 'object', additionalProperties: false,
        required: ['fontTitle', 'fontBody', 'primary', 'accent'],
        properties: {
          fontTitle: { type: ['string', 'null'], enum: [...fonts, null] },
          fontBody: { type: ['string', 'null'], enum: [...fonts, null] },
          primary: { type: 'string' },
          accent: { type: 'string' },
        },
      },
      blocks: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['type', 'style', 'bg', 'bgColor', 'eyebrow', 'title', 'text', 'btn', 'btn2'],
          properties: {
            type: { type: 'string', enum: Object.keys(types) },
            style: { type: 'string', enum: [...new Set(Object.values(types).flat())] },
            bg: { type: 'string', enum: ['normal', 'suave', 'marca', 'color'] },
            bgColor: nstr, eyebrow: nstr, title: nstr, text: nstr, btn: nstr, btn2: nstr,
          },
        },
      },
      css: { type: 'string' },
      omitted: { type: 'array', items: { type: 'string' } },
    },
  };
}

const SYSTEM = `Eres diseñador web de Reservalope, una plataforma de reservas en línea para negocios de servicios (salones, barberías, spas, consultorios). Te dan la captura de una web modelo y los datos reales de un negocio. Tu trabajo: que la página de inicio del negocio se vea lo más parecida posible al modelo (colores, tipografías, orden de secciones, fondos, espaciados, bordes, botones, tarjetas, encabezado y pie), usando SOLO el contenido que el negocio ya tiene.

Reglas de contenido (obligatorias):
- No inventes nada: ni servicios, precios, fotos, testimonios, ofertas, descuentos, premios, años de experiencia, redes sociales ni datos de contacto. Lo que el modelo tenga y el negocio no, se deja fuera y lo anotas en "omitted" (frases cortas en español, p. ej. "Testimonios de clientes").
- Los servicios, el equipo y la galería NO se escriben: los bloques "servicios", "equipo" y "galeria" los muestran solos desde el CRM. No agregues un bloque "equipo" ni "galeria" si el negocio no tiene equipo o fotos.
- Textos de cada bloque: null = dejar el texto actual del negocio; "" = no mostrar ese texto. Solo puedes escribir textos nuevos si son títulos o etiquetas cortas y neutras de sección (p. ej. "Nuestros servicios", "Galería", "Visítanos", "Reservar cita") o si reordenas o acortas textos que el negocio ya tiene. Escribe en español.
- Usa solo tipos de bloque y estilos del catálogo. Cada bloque debe usar un estilo de su propio tipo. Solo un bloque "portada" y debe ir primero. Incluye siempre un bloque "reservar" o un botón para reservar en la portada.

Diseño:
- theme.fontTitle / fontBody: elige del catálogo la letra más parecida a la del modelo (títulos y textos). theme.primary y theme.accent: colores #RRGGBB del modelo. primary = color principal (menú, franjas "marca", títulos y textos destacados; conviene oscuro y que se lea sobre blanco). accent = color de los botones para reservar y los detalles. Si el modelo usa un color claro (p. ej. rosa pastel) para fondos, ponlo como bgColor de los bloques o en el css, no como primary.
- bg de cada bloque: "normal" (claro), "suave" (gris o tono muy claro), "marca" (fondo del color primary con texto claro) o "color" con bgColor #RRGGBB. Con "color" el texto se pone claro u oscuro solo.
- css: hoja de estilo propia que se aplica encima de la web para acercarla al modelo. Usa los nombres de clase que aparecen en el "esqueleto" (HTML real de la página) y estas convenciones: cada bloque es <section class="blk blk-<tipo> blk-st-<estilo> blk-bg-<fondo>">; los textos del bloque llevan clases como .blk-eyebrow, .blk-title, .blk-text dentro de .container. Puedes ajustar tamaños, mayúsculas, espaciado entre letras, márgenes, bordes, radios, sombras, colores de fondo y de texto, botones (.btn), encabezado y pie del sitio.
  Prohibido en el css: url(), @import, @font-face, image-set(), el carácter "<" y barras invertidas. Nada de fuentes externas: solo las del catálogo (las variables --font-display y --font-body ya las aplican). No ocultes los botones de reservar ni la navegación. Debe verse bien en celular (usa @media (max-width: 640px) cuando haga falta). Máximo unas 400 líneas.
  Mantén contraste legible (texto oscuro sobre claro o claro sobre oscuro).
Responde solo con el JSON pedido.`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json(405, { error: 'Método no permitido.' });

  // ---------- Comprobaciones (antes de empezar a responder) ----------
  let body: any, tenant: any, web: any;
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_KEY');
    if (!secret) throw new HttpError(500, 'Falta la clave de servicio de Supabase.');
    if (!Deno.env.get('ANTHROPIC_API_KEY')) {
      throw new HttpError(503, 'Falta configurar la clave de Claude (secreto ANTHROPIC_API_KEY en Supabase).');
    }
    const sb = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) throw new HttpError(401, 'Inicia sesión de nuevo.');
    const { data: who, error: whoErr } = await sb.auth.getUser(token);
    if (whoErr || !who?.user) throw new HttpError(401, 'Inicia sesión de nuevo.');
    const { data: me } = await sb.from('profiles').select('role, active').eq('id', who.user.id).maybeSingle();
    if (!me || me.active === false || me.role !== 'SUPERADMIN') {
      throw new HttpError(403, 'Solo el superadministrador puede copiar un diseño desde una imagen.');
    }

    body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object') throw new HttpError(400, 'Solicitud no válida.');
    if (typeof body.tenant_id !== 'string') throw new HttpError(400, 'Falta el negocio.');
    const imgs = body.images;
    if (!Array.isArray(imgs) || !imgs.length || imgs.length > MAX_IMAGES) throw new HttpError(400, 'Falta la imagen del modelo.');
    for (const im of imgs) {
      if (!im || !MEDIA.includes(im.media_type)) throw new HttpError(400, 'La imagen debe ser PNG, JPG, WEBP o GIF.');
      if (typeof im.data !== 'string' || !im.data || im.data.length > MAX_IMAGE_B64 || !/^[A-Za-z0-9+/=]+$/.test(im.data)) {
        throw new HttpError(400, 'La imagen no es válida o pesa demasiado.');
      }
    }
    const types = body.catalog?.types, fonts = body.catalog?.fonts;
    if (!types || typeof types !== 'object' || !fonts || typeof fonts !== 'object') throw new HttpError(400, 'Falta el catálogo de bloques.');
    for (const [k, v] of Object.entries(types)) {
      if (!/^[a-z-]{2,20}$/.test(k) || !Array.isArray(v) || !v.every((s) => typeof s === 'string' && /^[a-z-]{2,30}$/.test(s))) {
        throw new HttpError(400, 'Catálogo de bloques no válido.');
      }
    }
    if (!Object.keys(fonts).every((k) => /^[a-z-]{2,30}$/.test(k))) throw new HttpError(400, 'Catálogo de letras no válido.');

    const { data: tn } = await sb.from('tenants').select('id, slug, name').eq('id', body.tenant_id).maybeSingle();
    if (!tn) throw new HttpError(404, 'No encontré ese negocio.');
    tenant = tn;
    const { data: w, error: wErr } = await sb.rpc('web_barberia', { p_slug: tn.slug });
    if (wErr || !w) throw new HttpError(500, 'No pude leer los datos del negocio.');
    web = w;
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    console.error('[disenar-con-imagen]', err);
    return json(status, { error: err instanceof HttpError ? err.message : 'Error inesperado.' });
  }

  // ---------- Llamada a Claude (respuesta en streaming para no cortar la conexión) ----------
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(' ')); } catch { /* cerrado */ } }, 5000);
      const end = (obj: unknown) => {
        clearInterval(ping);
        try { ctrl.enqueue(enc.encode('\n' + JSON.stringify(obj) + '\n')); ctrl.close(); } catch { /* cerrado */ }
      };
      try {
        const client = new Anthropic(); // lee ANTHROPIC_API_KEY
        const types = body.catalog.types as Record<string, string[]>;
        const fonts = body.catalog.fonts as Record<string, string>;
        const skeleton = typeof body.skeleton === 'string' ? body.skeleton.slice(0, MAX_SKELETON) : '';
        const datos = {
          negocio: resumen(web),
          diseno_actual: bloquesActuales(body.page),
          catalogo: {
            bloques: types,
            letras: fonts,
          },
          indicaciones_del_usuario: cut(body.notes, 1000) || null,
        };
        const msg = await client.beta.messages.stream({
          model: Deno.env.get('DISENO_IA_MODELO') || 'claude-opus-5-5',
          max_tokens: 48000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: SYSTEM,
          output_config: { effort: 'high', format: { type: 'json_schema', schema: schema(types, Object.keys(fonts)) } },
          messages: [{
            role: 'user',
            content: [
              ...body.images.map((im: any) => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
              { type: 'text', text: (body.images.length > 1 ? 'Estas ' + body.images.length + ' imágenes son partes de la misma web modelo, en orden de arriba abajo.' : 'Esta es la web modelo.') + ' Datos del negocio "' + tenant.name + '" y catálogo:\n' + JSON.stringify(datos) },
              { type: 'text', text: 'Esqueleto HTML de la página de inicio actual del negocio (clases reales, textos recortados):\n' + skeleton },
              { type: 'text', text: 'Arma el diseño del negocio para que se vea como la web modelo, siguiendo las reglas.' },
            ],
          }],
        } as any).finalMessage();

        if (msg.stop_reason === 'refusal') { end({ error: 'Claude no pudo procesar esta imagen. Prueba con otra captura.' }); return; }
        if (msg.stop_reason === 'max_tokens') { end({ error: 'El diseño salió demasiado largo. Prueba con una captura más corta.' }); return; }
        const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
        let design: any;
        try { design = JSON.parse(text); } catch { end({ error: 'Claude devolvió un diseño incompleto. Inténtalo de nuevo.' }); return; }
        end({ ok: true, design, usage: { input: msg.usage?.input_tokens, output: msg.usage?.output_tokens, model: msg.model } });
      } catch (err: any) {
        console.error('[disenar-con-imagen] claude', err);
        const st = err?.status;
        const m = st === 401 ? 'La clave de Claude no es válida. Revísala en Supabase (ANTHROPIC_API_KEY).'
          : st === 400 && /credit|balance/i.test(String(err?.message)) ? 'La cuenta de Claude no tiene saldo. Carga saldo en console.anthropic.com.'
          : st === 429 ? 'Claude está ocupado o se llegó al límite de uso. Espera un minuto e inténtalo de nuevo.'
          : st === 529 || st >= 500 ? 'Claude no responde en este momento. Inténtalo en unos minutos.'
          : 'No pude generar el diseño. Inténtalo de nuevo.';
        end({ error: m });
      }
    },
  });
  return new Response(stream, { headers: { ...CORS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
});
