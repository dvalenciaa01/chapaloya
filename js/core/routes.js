/* ==========================================================================
   Direcciones de cada negocio
   --------------------------------------------------------------------------
   En los dominios de PRETTY_HOSTS (Cloudflare Pages, ver _redirects):
     /<enlace>/               web del negocio
     /crm/<enlace>/           CRM del negocio (/crm/<enlace>/ingresar = login)
     /admin                   consola de Reservalope
   En cualquier otro sitio (GitHub Pages, servidor local) siguen
   index.html?b=<enlace> y login.html?b=<enlace>.
   No depende de ningún otro archivo: se puede cargar en el <head>.
   ========================================================================== */
const Routes = {
  // Dominios con direcciones limpias. Un valor que empieza con "." vale para
  // sus subdominios. Los de :8788 son `wrangler pages dev` (pruebas locales).
  PRETTY_HOSTS: ['reservalope.com', 'www.reservalope.com', '.pages.dev', 'localhost:8788', '127.0.0.1:8788'],

  // Primeros tramos que usa el sitio: ningún negocio puede llamarse así
  // (la base de datos también lo impide: migración 13)
  RESERVED: ['admin', 'api', 'assets', 'barberos', 'bot', 'consultar-cita', 'crm', 'css', 'docs', 'index',
    'ingresar', 'js', 'landing', 'login', 'privacidad', 'reservalope', 'reservar', 'servicios', 'supabase', 'www'],

  pretty() {
    const h = location.hostname, hp = location.host;
    return this.PRETTY_HOSTS.some(x => x.charAt(0) === '.' ? h.endsWith(x) : (h === x || hp === x));
  },

  isSlug(s) {
    return typeof s === 'string' && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length >= 2 && s.length <= 40 &&
      !this.RESERVED.includes(s);
  },

  // Enlace del negocio que trae la dirección (/<enlace>/… o /crm/<enlace>/…)
  pathSlug() {
    if (!this.pretty()) return null;
    const seg = location.pathname.split('/').filter(Boolean);
    const s = seg[0] === 'crm' ? seg[1] : seg[0];
    return this.isSlug(s) ? s : null;
  },

  // ?a=1&b=2 a partir de un objeto (sin los vacíos)
  query(params) {
    const q = new URLSearchParams();
    Object.keys(params || {}).forEach(k => { if (params[k] != null && params[k] !== '') q.set(k, params[k]); });
    const s = q.toString();
    return s ? '?' + s : '';
  },

  home() { return this.pretty() ? '/' : 'landing/'; },
  admin() { return this.pretty() ? '/admin' : 'reservalope.html'; },

  // Web del negocio; page = 'servicios.html', etc. (vacío = inicio)
  web(slug, page, params) {
    const p = page && page !== 'index.html' ? page : '';
    if (this.pretty()) return '/' + slug + '/' + p + this.query(params);
    return (p || 'index.html') + this.query(Object.assign({ b: slug }, params));
  },

  crm(slug, params) {
    if (this.pretty() && slug) return '/crm/' + slug + '/' + this.query(params);
    return 'crm.html' + this.query(params);
  },

  login(slug, params) {
    if (this.pretty() && slug) return '/crm/' + slug + '/ingresar' + this.query(params);
    return 'login.html' + this.query(Object.assign({ b: slug || '' }, params));
  },

  // Para mostrar: con direcciones limpias, completa y sin https://; si no, tal cual
  display(url) {
    return this.pretty() ? new URL(url, location.href).href.replace(/^https?:\/\//, '') : url;
  }
};
