/* ==========================================================================
   Secciones con el nombre que les dio el negocio (Cloudflare Pages Function)
   --------------------------------------------------------------------------
   Atiende /<enlace>/<nombre> (dos tramos). Si <nombre> es una sección del
   negocio (crm_config.site.sections, o las de siempre), entrega directamente
   la página de esa sección SIN cambiar la dirección:
     /ale-sanchez/galeria  → página del equipo, si así se llama esa sección
     /ale-sanchez/modelos  → servicios con la categoría Modelos
   y marca <body data-section="<nombre>"> para que la página sepa cuál es.
   Así la barra de direcciones nunca muestra /barberos ni /servicios?cat=…
   En cualquier otro caso (páginas del sitio, archivos, errores) sigue como
   siempre: next() aplica _redirects y _headers.
   Sin esta función (GitHub Pages, servidor local) lo resuelve el navegador:
   TenantBrand.applyAddress.
   ========================================================================== */
import '../../js/core/vocab.js';

// Mismos valores públicos que js/config.js (la seguridad la dan las reglas RLS)
const SUPABASE_URL = 'https://cdsstbykktdkhhxtcsnx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hqJty101OjD4pHM7S8WLnA_pdzq2L6O';
const TTL = 60;                                   // segundos que se recuerda la configuración

// Igual que Routes.RESERVED y Routes.sectionSlug (js/core/routes.js)
const RESERVED = ['admin', 'api', 'assets', 'barberos', 'bot', 'consultar-cita', 'crm', 'css', 'docs', 'galeria', 'index',
  'ingresar', 'js', 'landing', 'login', 'privacidad', 'reservalope', 'reservar', 'servicios', 'supabase', 'www'];
const isSlug = (s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length >= 2 && s.length <= 40 && !RESERVED.includes(s);
const sectionSlug = (label) => String(label || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

// Tipo de sección → página del sitio (igual que TenantBrand.SECTION_PAGES)
const PAGE_OF = { servicios: 'servicios', equipo: 'barberos', galeria: 'galeria', 'mi-cita': 'consultar-cita', reservar: 'reservar' };
const slugOf = (sec) => sectionSlug(sec.label) || PAGE_OF[sec.type];

/* Las configuradas o las de siempre (igual que TenantBrand.effectiveSections) */
function effectiveSections(info) {
  if (Array.isArray(info.sections) && info.sections.length) return info.sections;
  const V = globalThis.Vocab.set({ business_type: info.businessType, labels: info.labels });
  const layout = info.layout || (info.businessType === 'unas' ? 'boutique' : 'clasico');
  const solo = layout === 'boutique' && info.staff === 1;
  return [
    { type: 'servicios', label: V.fmt('{ServicePlural}') },
    { type: 'equipo', label: solo ? 'Galería' : 'Equipo' },
    { type: 'mi-cita', label: V.fmt('Mi {appointment}') },
    { type: 'reservar', label: V.fmt('Reservar {appointment}') }
  ];
}

const memory = new Map();                         // por instancia: slug → { at, info }

async function loadInfo(slug, ctx) {
  const hit = memory.get(slug);
  if (hit && Date.now() - hit.at < TTL * 1000) return hit.info;
  const cacheKey = new Request('https://secciones.reservalope.internal/' + slug);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    const c = await cache.match(cacheKey);
    if (c) { const info = await c.json(); memory.set(slug, { at: Date.now(), info }); return info; }
  }
  const env = ctx.env || {};
  const base = env.SUPABASE_URL || SUPABASE_URL, key = env.SUPABASE_KEY || SUPABASE_KEY;   // variables opcionales del proyecto
  const r = await fetch(base + '/rest/v1/rpc/web_barberia', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: key, Authorization: 'Bearer ' + key },
    body: JSON.stringify({ p_slug: slug })
  });
  if (!r.ok) return null;
  const d = await r.json();
  if (!d || !d.tenant) return null;
  const site = d.site || {};
  const info = {
    sections: Array.isArray(site.sections) ? site.sections.filter(x => x && typeof x === 'object' && typeof x.label === 'string') : null,
    layout: site.layout === 'clasico' || site.layout === 'boutique' ? site.layout : null,
    businessType: d.business_type || null,
    labels: d.labels || null,
    staff: Array.isArray(d.barbers) ? d.barbers.length : 0
  };
  memory.set(slug, { at: Date.now(), info });
  if (cache) {
    const put = cache.put(cacheKey, new Response(JSON.stringify(info), { headers: { 'Cache-Control': 'max-age=' + TTL, 'Content-Type': 'application/json' } }));
    if (ctx.waitUntil) ctx.waitUntil(put); else await put;
  }
  return info;
}

export async function onRequest(ctx) {
  const { request, params, env } = ctx;
  const slug = String(params.slug || ''), name = String(params.page || '');
  // Con ?cat= ya es la dirección de una página real (servicios?cat=Modelos): la resuelve el navegador
  const hasCat = new URL(request.url).searchParams.has('cat');
  if ((request.method !== 'GET' && request.method !== 'HEAD') || hasCat || !isSlug(slug) || !/^[a-z0-9-]+$/.test(name) || name === 'privacidad') {
    return ctx.next();
  }
  let sec = null;
  try {
    const info = await loadInfo(slug, ctx);
    if (info) sec = effectiveSections(info).find(x => x && x.type !== 'inicio' && PAGE_OF[x.type] && slugOf(x) === name) || null;
  } catch (e) {
    sec = null;                                   // sin datos: como siempre
  }
  if (!sec) return ctx.next();

  // Página real de la sección, pasando por _redirects y _headers como cualquier otra
  const url = new URL(request.url);
  url.pathname = '/' + slug + '/' + PAGE_OF[sec.type];
  const res = await env.ASSETS.fetch(new Request(url.toString(), request));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('text/html')) return ctx.next();
  return new HTMLRewriter()
    .on('body', { element(el) { el.setAttribute('data-section', name); } })
    .transform(res);
}
