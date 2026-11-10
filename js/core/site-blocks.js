/* ==========================================================================
   Constructor visual: el Inicio de la web armado con bloques
   --------------------------------------------------------------------------
   tenants.web_page = { blocks: [ { id, type, show, style, bg, ...textos } ] }
   (migración 21). Lo diseña el superadministrador (consola → Diseñar web) o el
   administrador del negocio (CRM → Configuración → Diseño de la web) con el
   editor de js/components/site-builder.js; este archivo lo comparten la web
   (dibuja los bloques) y el editor (tipos, estilos, valores por defecto).

   Los bloques NO copian datos del CRM: "Servicios", "Equipo", "Galería" y
   "Contacto" solo dicen cómo mostrarlos; los datos salen en vivo de
   web_barberia (DB.state). Los botones solo llevan a las páginas del sitio
   (reservar, servicios, equipo, galería, Mi cita): no se puede poner un
   enlace cualquiera. Todo texto del negocio pasa por esc() al dibujarse.

   Sin diseño guardado (web_page null o sin bloques) la web es la de siempre.

   Textos: un campo que no está = texto por defecto (con las palabras del
   rubro, p. ej. "Nuestros {servicePlural}"). Un botón con texto "" = oculto.
   ========================================================================== */
(function (global) {
  'use strict';

  const ICON_CHOICES = ['clock', 'tag', 'calendar', 'whatsapp', 'checkCircle', 'star', 'sparkles', 'user', 'users',
    'shield', 'zap', 'pin', 'phone', 'search', 'image', 'camera', 'scissors', 'droplet', 'sun', 'store'];

  /* Tipos de bloque. fields = lo que se edita (en ese orden); def = textos por
     defecto ({palabras} del rubro); styles = [clave, nombre]. */
  const TYPES = {
    portada: {
      label: 'Portada', icon: 'image', desc: 'Título grande, texto, foto y botones para reservar.',
      styles: [['foto-fondo', 'Foto de fondo'], ['foto-lado', 'Foto al costado'], ['centrado', 'Centrado']],
      fields: ['eyebrow', 'title', 'text', 'image', 'btn', 'btn2'],
      def: { eyebrow: '{Business}', title: '', text: 'Reserva tu {appointment} en línea, sin llamadas ni esperas.', btn: 'Reservar {appointment}', btn2: 'Ver {servicePlural}' }
    },
    servicios: {
      label: 'Servicios', icon: 'tag', desc: 'Los servicios del CRM con precio y duración (todos o de una categoría).',
      styles: [['tarjetas', 'Tarjetas'], ['lista', 'Lista']],
      fields: ['eyebrow', 'title', 'text', 'cat', 'limit', 'btn'],
      def: { eyebrow: '{ServicePlural}', title: 'Lo que ofrecemos', text: 'Precios claros y duración estimada. Elige {service} y reserva en un minuto.', btn: 'Ver todos', limit: 6 }
    },
    equipo: {
      label: 'Equipo', icon: 'users', desc: 'Quienes atienden, con su foto y un botón para reservar con cada uno.',
      styles: [['tarjetas', 'Tarjetas'], ['circulos', 'Fotos redondas']],
      fields: ['eyebrow', 'title', 'text', 'limit', 'btn'],
      def: { eyebrow: '{StaffPlural}', title: 'Nuestro equipo', text: 'Conoce a quienes te atenderán y reserva con quien prefieras.', btn: 'Conocer al equipo', limit: 4 }
    },
    galeria: {
      label: 'Galería', icon: 'camera', desc: 'Fotos de trabajos que el equipo sube en el CRM.',
      styles: [['cuadricula', 'Cuadrícula'], ['mosaico', 'Mosaico']],
      fields: ['eyebrow', 'title', 'text', 'limit', 'btn'],
      def: { eyebrow: 'Galería', title: 'Nuestros trabajos', text: '', btn: 'Ver galería', limit: 8 }
    },
    ventajas: {
      label: 'Ventajas', icon: 'checkCircle', desc: 'Tres a seis puntos con ícono: por qué elegirte.',
      styles: [['columnas', 'Columnas'], ['lista', 'Lista']],
      fields: ['eyebrow', 'title', 'text', 'items'],
      def: { eyebrow: '¿Por qué elegirnos?', title: 'Más que un {business}', text: '' }
    },
    reservar: {
      label: 'Llamado a reservar', icon: 'calendar', desc: 'Franja con un botón grande para reservar.',
      styles: [['franja', 'Franja'], ['tarjeta', 'Tarjeta']],
      fields: ['title', 'text', 'btn', 'btn2'],
      def: { title: '¿Listo para reservar tu {appointment}?', text: 'Elige {service}, {staff} y horario. Recibes tu código al instante.', btn: 'Reservar {appointment}', btn2: 'Consultar mi {appointment}' }
    },
    contacto: {
      label: 'Contacto y horario', icon: 'pin', desc: 'Dirección, teléfono, WhatsApp y horario de Configuración.',
      styles: [['columnas', 'Columnas'], ['tarjeta', 'Tarjeta']],
      fields: ['eyebrow', 'title', 'text', 'map'],
      def: { eyebrow: 'Contacto', title: 'Visítanos', text: '' }
    },
    texto: {
      label: 'Texto con foto', icon: 'edit', desc: 'Sobre nosotros, promociones o cualquier mensaje, con una foto.',
      styles: [['foto-izquierda', 'Foto a la izquierda'], ['foto-derecha', 'Foto a la derecha'], ['solo-texto', 'Solo texto']],
      fields: ['eyebrow', 'title', 'text', 'image', 'btn'],
      def: { eyebrow: '', title: 'Sobre nosotros', text: '', btn: '' }
    }
  };
  const ORDER = ['portada', 'servicios', 'equipo', 'galeria', 'ventajas', 'reservar', 'contacto', 'texto'];
  const BGS = [['normal', 'Claro'], ['suave', 'Suave'], ['marca', 'Color de marca']];
  // Límites (iguales a private.web_page_valida, migración 21)
  const MAX = { eyebrow: 60, title: 120, text: 1500, btn: 30, btn2: 30, cat: 40, itemTitle: 60, itemText: 240 };
  const MAX_BLOCKS = 24;
  const IMG_RE = /^https:\/\/[^\s"'<>()\\]+$/;

  const DEFAULT_ITEMS = (wa) => [
    { icon: 'user', title: 'Atención con cita', text: 'Sin esperas: tu horario queda reservado solo para ti.' },
    { icon: 'tag', title: 'Precios claros', text: 'Ves el precio y la duración de cada {service} antes de reservar.' },
    { icon: 'sparkles', title: 'Reserva en un minuto', text: 'Elige {service}, {staff} y horario desde tu celular.' },
    wa ? { icon: 'whatsapp', title: 'Recordatorio por WhatsApp', text: 'Te avisamos antes de tu {appointment} para que no se te pase.' }
       : { icon: 'search', title: 'Consulta tu {appointment}', text: 'Con tu código la revisas cuando quieras.' }
  ];

  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);
  const newId = () => {
    let s = '';
    const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 8; i++) s += a.charAt(Math.floor(Math.random() * a.length));
    return s;
  };

  /* Deja un diseño con la forma exacta que acepta la base (lo que no la tenga se descarta) */
  function normalize(page) {
    if (!page || typeof page !== 'object' || !Array.isArray(page.blocks)) return null;
    const ids = new Set();
    let hero = false;
    const blocks = [];
    page.blocks.forEach(b => {
      if (!b || typeof b !== 'object' || !TYPES[b.type] || blocks.length >= MAX_BLOCKS) return;
      if (b.type === 'portada') { if (hero) return; hero = true; }
      const T = TYPES[b.type];
      let id = typeof b.id === 'string' && /^[a-z0-9]{4,16}$/.test(b.id) ? b.id : newId();
      while (ids.has(id)) id = newId();
      ids.add(id);
      const o = { id, type: b.type };
      if (b.show === false) o.show = false;
      if (T.styles.some(s => s[0] === b.style)) o.style = b.style;
      if (BGS.some(s => s[0] === b.bg)) o.bg = b.bg;
      ['eyebrow', 'title', 'text', 'cat'].forEach(k => {
        if (!T.fields.includes(k)) return;
        const v = str(b[k], MAX[k]);
        if (v != null && v.trim()) o[k] = v;
      });
      // Botones: "" = oculto (se guarda), sin dato = texto por defecto
      ['btn', 'btn2'].forEach(k => {
        if (!T.fields.includes(k)) return;
        const v = str(b[k], MAX[k]);
        if (v != null) o[k] = v.trim() ? v : '';
      });
      if (T.fields.includes('image') && typeof b.image === 'string' && b.image.length <= 1000 && IMG_RE.test(b.image.trim())) o.image = b.image.trim();
      if (T.fields.includes('limit') && Number.isInteger(b.limit) && b.limit >= 1 && b.limit <= 24) o.limit = b.limit;
      if (T.fields.includes('map') && typeof b.map === 'boolean') o.map = b.map;
      if (T.fields.includes('items') && Array.isArray(b.items)) {
        o.items = b.items.slice(0, 6).filter(it => it && typeof it === 'object').map(it => {
          const x = {};
          if (typeof it.icon === 'string' && /^[A-Za-z]{1,24}$/.test(it.icon)) x.icon = it.icon;
          const t = str(it.title, MAX.itemTitle), d = str(it.text, MAX.itemText);
          if (t && t.trim()) x.title = t;
          if (d && d.trim()) x.text = d;
          return x;
        });
      }
      blocks.push(o);
    });
    return { blocks };
  }

  /* Diseño inicial: el Inicio de siempre convertido en bloques (con la portada
     de la consola si tiene título, subtítulo o foto) */
  function template(opts) {
    const o = opts || {};
    const site = o.site || {};
    const hero = { id: newId(), type: 'portada', style: site.heroImage ? 'foto-fondo' : 'foto-lado' };
    if (site.heroTitle) hero.title = site.heroTitle;
    if (site.heroSubtitle) hero.text = site.heroSubtitle;
    if (site.heroImage) hero.image = site.heroImage;
    const blocks = [hero, { id: newId(), type: 'servicios' }];
    if (o.solo) blocks.push({ id: newId(), type: 'galeria', bg: 'suave' });
    else blocks.push({ id: newId(), type: 'equipo', bg: 'suave' });
    blocks.push({ id: newId(), type: 'ventajas' });
    blocks.push({ id: newId(), type: 'reservar', bg: 'marca' });
    blocks.push({ id: newId(), type: 'contacto', bg: 'suave' });
    return { blocks };
  }

  function create(type) {
    const b = { id: newId(), type };
    if (type === 'ventajas') b.items = DEFAULT_ITEMS(true).slice(0, 3).map(x => Object.assign({}, x));
    if (type === 'reservar') b.bg = 'marca';
    if (type === 'texto') b.text = 'Cuéntales a tus clientes quiénes son, qué los hace distintos o una promoción del mes.';
    return b;
  }

  /* ======================= Dibujo en la web pública ======================= */
  // PublicBooking, TenantBrand y SiteUI son const globales (no viven en window)
  const PB = () => (typeof PublicBooking !== 'undefined' ? PublicBooking : null);
  const TB = () => (typeof TenantBrand !== 'undefined' ? TenantBrand : null);
  const SU = () => (typeof SiteUI !== 'undefined' ? SiteUI : null);
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const fmt = (s) => (typeof Vocab !== 'undefined' ? Vocab.fmt(s) : String(s || ''));
  const icon = (n) => (typeof global.ic === 'function' ? global.ic(n) : '');
  const href = (page) => (PB() ? PB().href(page) : page);
  const secOff = (type) => !!(PB() && PB().secOff(type));
  // Texto del bloque o el de por defecto
  const txt = (b, k) => (b[k] != null && (k === 'btn' || k === 'btn2' || String(b[k]).trim()) ? b[k] : fmt(TYPES[b.type].def[k] || ''));
  // Párrafos: una línea en blanco separa párrafos; un salto simple, <br>
  const paras = (s, cls) => String(s || '').split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
    .map(p => '<p' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');

  function head(b, link, linkLabel) {
    const eb = txt(b, 'eyebrow'), title = txt(b, 'title'), text = txt(b, 'text');
    if (!eb && !title && !text && !link) return '';
    return '<div class="section-head blk-head reveal"><div>' +
      (eb ? '<span class="eyebrow">' + esc(eb) + '</span>' : '') +
      (title ? '<h2>' + esc(title) + '</h2>' : '') +
      (text ? paras(text) : '') +
      '</div>' +
      (link && linkLabel ? '<a class="btn btn-outline" href="' + esc(href(link)) + '">' + esc(linkLabel) + ' ' + icon('arrowRight') + '</a>' : '') +
    '</div>';
  }

  function heroHTML(b, t) {
    const style = b.style || 'foto-fondo';
    const title = (b.title && b.title.trim()) ? b.title : (t.name || '');
    const img = b.image || '';
    const eb = txt(b, 'eyebrow');
    const btn = txt(b, 'btn'), btn2 = txt(b, 'btn2');
    const city = t.city ? ' · ' + t.city : '';
    const body = '<div class="blk-hero-copy reveal">' +
      (eb ? '<span class="blk-kicker">' + esc(eb + city) + '</span>' : '') +
      '<h1 class="blk-hero-title">' + esc(title) + '</h1>' +
      paras(txt(b, 'text'), 'blk-hero-lead') +
      ((btn || (btn2 && !secOff('servicios'))) ? '<div class="blk-actions">' +
        (btn ? '<a class="btn btn-accent btn-lg" href="' + esc(href('reservar.html')) + '">' + icon('calendar') + '<span>' + esc(btn) + '</span></a>' : '') +
        (btn2 && !secOff('servicios') ? '<a class="btn btn-outline btn-lg" href="' + esc(href('servicios.html')) + '"><span>' + esc(btn2) + '</span></a>' : '') +
      '</div>' : '') +
    '</div>';
    if (style === 'foto-lado') {
      const boutique = document.documentElement.getAttribute('data-layout') === 'boutique' && PB() && PB().artSVG;
      const art = img
        ? '<img src="' + esc(img) + '" alt="" loading="eager" decoding="async" />'
        : (boutique ? '<div class="blk-hero-illus">' + PB().artSVG('hero') + '</div>'
          : '<div class="blk-hero-mark" aria-hidden="true">' + (PB() ? PB().rubroIcon() : '') + '</div>');
      return '<div class="container blk-hero-split">' + body + '<div class="blk-hero-media' + (img ? ' has-photo' : '') + '">' + art + '</div></div>';
    }
    return (style === 'foto-fondo' && img ? '<img class="blk-hero-bg" src="' + esc(img) + '" alt="" decoding="async" fetchpriority="high" />' : '') +
      '<div class="container blk-hero-inner">' + body + '</div>';
  }

  function servicesHTML(b) {
    const st = DB.state, cur = st.settings.currency;
    const cat = String(b.cat || '').trim().toLowerCase();
    let list = st.services.slice().sort((a, c) => (c.featured ? 1 : 0) - (a.featured ? 1 : 0));
    if (cat) list = list.filter(s => String(s.category || '').trim().toLowerCase() === cat);
    const lim = b.limit || TYPES.servicios.def.limit;
    const shown = list.slice(0, lim);
    const more = cat ? 'servicios.html?cat=' + encodeURIComponent(b.cat.trim()) : 'servicios.html';
    const btn = list.length > 0 && !secOff('servicios') ? txt(b, 'btn') : '';
    let body;
    if (!shown.length) {
      body = '<div class="empty-state">' + (PB() ? PB().rubroIcon() : '') + '<strong>Pronto verás novedades aquí</strong>Mientras tanto, puedes reservar tu ' + esc(fmt('{appointment}')) + ' en línea.</div>';
    } else if (b.style === 'lista') {
      body = '<ul class="blk-srv-list">' + shown.map(s =>
        '<li class="reveal">' +
          (s.image ? '<img class="blk-srv-thumb" src="' + esc(s.image) + '" alt="" loading="lazy" decoding="async" />' : '<span class="blk-srv-thumb is-icon" aria-hidden="true">' + (PB() ? PB().rubroIcon() : '') + '</span>') +
          '<div class="blk-srv-info"><strong>' + esc(s.name) + '</strong>' +
            (s.desc ? '<span>' + esc(s.desc) + '</span>' : '') +
            (s.duration ? '<em>' + icon('clock') + esc(s.duration) + ' min</em>' : '') +
          '</div>' +
          '<div class="blk-srv-side"><span class="blk-srv-price">' + esc(cur) + ' ' + esc(s.price) + '</span>' +
            '<button type="button" class="btn btn-solid btn-sm" data-pb-action="service" data-id="' + esc(s.id) + '">Reservar<span class="sr-only"> ' + esc(s.name) + '</span></button></div>' +
        '</li>').join('') + '</ul>';
    } else {
      const boutique = document.documentElement.getAttribute('data-layout') === 'boutique';
      body = boutique
        ? '<div class="bq-services blk-srv-grid">' + shown.map((s, i) => PB().boutiqueServiceCard(s, cur, i)).join('') + '</div>'
        : '<div class="services-grid blk-srv-grid">' + shown.map(s => PB().serviceCard(s, cur)).join('') + '</div>';
    }
    return '<div class="container">' + head(b, more, btn) + body + '</div>';
  }

  function teamHTML(b) {
    const list = DB.state.barberProfiles;
    if (!list.length) return '';
    const lim = b.limit || TYPES.equipo.def.limit;
    const btn = !secOff('equipo') ? txt(b, 'btn') : '';
    const P = PB();
    const cards = list.slice(0, lim).map(bp =>
      '<article class="team-card blk-team-card reveal">' +
        '<div class="team-photo">' + P.photoHTML(bp) + '</div>' +
        '<div class="team-body">' +
          '<h3>' + esc(bp.name) + '</h3>' +
          '<p>' + esc(bp.role || fmt('{Staff}')) + '</p>' +
          '<button type="button" class="btn btn-outline btn-sm team-link" data-pb-action="book" data-id="' + esc(bp.id) + '">Reservar con ' + esc(bp.name) + ' ' + icon('arrowRight') + '</button>' +
        '</div>' +
      '</article>').join('');
    return '<div class="container">' + head(b, 'barberos.html', btn) + '<div class="team-grid blk-team">' + cards + '</div></div>';
  }

  function galleryHTML(b) {
    const works = [];
    DB.state.barberProfiles.forEach(bp => bp.works.forEach(w => works.push({ bp, w })));
    if (!works.length) return '';
    const lim = b.limit || TYPES.galeria.def.limit;
    const off = secOff('galeria') && secOff('equipo');
    const btn = !off && works.length ? txt(b, 'btn') : '';
    const shots = works.slice(0, lim).map(({ bp, w }) =>
      '<button type="button" class="blk-shot reveal" data-pb-action="work" data-id="' + esc(bp.id) + '" data-work="' + esc(w.id) + '">' +
        '<img src="' + esc(w.image) + '" alt="' + esc(w.title || ('Trabajo de ' + bp.name)) + '" loading="lazy" decoding="async" />' +
      '</button>').join('');
    return '<div class="container">' + head(b, secOff('galeria') ? 'barberos.html' : 'galeria.html', btn) + '<div class="blk-gallery">' + shots + '</div></div>';
  }

  function perksHTML(b, t) {
    const items = (Array.isArray(b.items) && b.items.length ? b.items : DEFAULT_ITEMS(t.waEnabled).slice(0, 4))
      .filter(it => it.title || it.text);
    return '<div class="container">' + head(b) +
      '<ul class="blk-perks">' + items.map(it =>
        '<li class="reveal"><span class="blk-perk-ic" aria-hidden="true">' + icon(ICON_CHOICES.includes(it.icon) ? it.icon : 'checkCircle') + '</span>' +
          '<div>' + (it.title ? '<strong>' + esc(fmt(it.title)) + '</strong>' : '') + (it.text ? '<p>' + esc(fmt(it.text)) + '</p>' : '') + '</div></li>').join('') +
      '</ul></div>';
  }

  function ctaHTML(b) {
    const title = txt(b, 'title'), btn = txt(b, 'btn');
    const btn2 = secOff('mi-cita') ? '' : txt(b, 'btn2');
    return '<div class="container"><div class="blk-cta-inner reveal">' +
      '<div>' + (title ? '<h2>' + esc(title) + '</h2>' : '') + paras(txt(b, 'text')) + '</div>' +
      ((btn || btn2) ? '<div class="blk-actions">' +
        (btn ? '<a class="btn btn-accent btn-lg" href="' + esc(href('reservar.html')) + '">' + icon('calendar') + '<span>' + esc(btn) + '</span></a>' : '') +
        (btn2 ? '<a class="btn btn-outline btn-lg" href="' + esc(href('consultar-cita.html')) + '"><span>' + esc(btn2) + '</span></a>' : '') +
      '</div>' : '') +
    '</div></div>';
  }

  function waUrl(phone) {
    let d = String(phone || '').replace(/\D/g, '');
    if (/^9\d{8}$/.test(d)) d = '51' + d;
    return /^\d{9,15}$/.test(d) ? 'https://wa.me/' + d : '';
  }

  function contactHTML(b, t) {
    const rows = [];
    if (t.address) rows.push(['pin', 'Dirección', esc(t.address) + (t.city ? '<br><span class="blk-muted">' + esc(t.city) + '</span>' : '')]);
    if (t.phone) {
      const tel = String(t.phone).replace(/[^\d+]/g, '');
      rows.push(['phone', 'Teléfono', '<a href="tel:' + esc(tel) + '">' + esc(t.phone) + '</a>']);
      const wa = waUrl(t.phone);
      if (wa) rows.push(['whatsapp', 'WhatsApp', '<a href="' + esc(wa) + '" target="_blank" rel="noopener">Escríbenos</a>']);
    }
    if (t.hours) rows.push(['clock', 'Horario', esc(t.hours)]);
    if (!rows.length) return '';
    const map = b.map !== false && t.address
      ? '<a class="btn btn-outline" href="https://www.google.com/maps/search/?api=1&amp;query=' + esc(encodeURIComponent(t.address + (t.city ? ', ' + t.city : ''))) + '" target="_blank" rel="noopener">' + icon('pin') + '<span>Cómo llegar</span></a>'
      : '';
    return '<div class="container">' + head(b) +
      '<div class="blk-contact reveal"><ul class="blk-contact-list">' + rows.map(([ic, k, v]) =>
        '<li><span class="blk-perk-ic" aria-hidden="true">' + icon(ic) + '</span><div><span class="blk-muted">' + k + '</span><div>' + v + '</div></div></li>').join('') +
      '</ul>' + (map ? '<div class="blk-actions">' + map + '</div>' : '') + '</div></div>';
  }

  function textHTML(b) {
    const style = b.style || 'foto-izquierda';
    const img = style !== 'solo-texto' && b.image ? b.image : '';
    const btn = txt(b, 'btn');
    const eb = txt(b, 'eyebrow'), title = txt(b, 'title');
    const copy = '<div class="blk-text-copy reveal">' +
      (eb ? '<span class="eyebrow">' + esc(eb) + '</span>' : '') +
      (title ? '<h2>' + esc(title) + '</h2>' : '') + paras(txt(b, 'text')) +
      (btn ? '<div class="blk-actions"><a class="btn btn-solid" href="' + esc(href('reservar.html')) + '"><span>' + esc(btn) + '</span>' + icon('arrowRight') + '</a></div>' : '') +
    '</div>';
    return '<div class="container"><div class="blk-text' + (img ? ' has-photo' : '') + '">' +
      (img ? '<div class="blk-text-media reveal"><img src="' + esc(img) + '" alt="" loading="lazy" decoding="async" /></div>' : '') + copy + '</div></div>';
  }

  const RENDER = { portada: heroHTML, servicios: servicesHTML, equipo: teamHTML, galeria: galleryHTML, ventajas: perksHTML, reservar: ctaHTML, contacto: contactHTML, texto: textHTML };

  function blockHTML(b, t, preview) {
    let inner = '';
    try { inner = RENDER[b.type](b, t); } catch (e) { console.error('[SiteBlocks]', b.type, e); inner = ''; }
    // Un bloque sin datos (equipo o galería vacíos) no se ve en la web; en la vista previa, un aviso
    if (!inner) {
      if (!preview) return '';
      inner = '<div class="container"><p class="blk-empty-note">' + esc(TYPES[b.type].label) + ': aún no hay datos en el CRM para mostrar aquí. En la web este bloque no se verá hasta que los haya.</p></div>';
    }
    const bg = b.type === 'portada' ? (b.style === 'foto-fondo' && b.image ? 'marca' : (b.bg || 'normal')) : (b.bg || (b.type === 'reservar' ? 'marca' : 'normal'));
    const cls = ['blk', 'blk-' + b.type, 'blk-st-' + (b.style || TYPES[b.type].styles[0][0]), 'blk-bg-' + bg];
    if (bg === 'marca') cls.push('on-brand');
    if (b.type === 'portada' && b.image && (b.style || 'foto-fondo') === 'foto-fondo') cls.push('has-photo');
    return '<section class="' + cls.join(' ') + '" data-blk="' + esc(b.id) + '">' + inner + '</section>';
  }

  const SiteBlocks = {
    TYPES, ORDER, BGS, MAX, MAX_BLOCKS, ICON_CHOICES, IMG_RE,
    DEFAULT_ITEMS, normalize, template, create, newId,

    // ¿Tiene un diseño por bloques que dibujar?
    active(page) { return !!(page && Array.isArray(page.blocks) && page.blocks.length); },

    /* Dibuja el Inicio con bloques (index.html). Devuelve true si lo hizo. */
    render(page, opts) {
      const root = document.getElementById('pub-blocks');
      const home = document.getElementById('pub-inicio');
      if (!root || !home || typeof DB === 'undefined' || !DB.tenant) return false;
      const preview = !!(opts && opts.preview);
      const on = this.active(page);
      home.classList.toggle('has-blocks', on);
      root.hidden = !on;
      if (!on) { root.innerHTML = ''; return false; }
      const t = DB.tenant;
      root.innerHTML = page.blocks.filter(b => b.show !== false || preview)
        .map(b => {
          const h = blockHTML(b, t, preview);
          return b.show === false ? h.replace('<section class="', '<section class="blk-hidden ') : h;
        }).join('');
      if (TB() && t.slug) TB().rewriteLinks(t.slug, root);
      if (SU() && SU().observeReveal) SU().observeReveal(root);
      return true;
    },

    /* ---------------- Vista previa dentro del editor (iframe, mismo origen) ----------------
       index.html?preview=1 dentro del editor: recibe el diseño sin guardar,
       lo dibuja, marca el bloque elegido y avisa cuál se tocó. Los enlaces
       no navegan (es una vista previa). */
    isPreview() {
      try { return global.parent !== global && new URLSearchParams(location.search).get('preview') === '1'; } catch (e) { return false; }
    },
    initPreview() {
      if (!this.isPreview() || this._previewOn) return;
      this._previewOn = true;
      document.documentElement.classList.add('blk-preview');
      const send = (msg) => { try { global.parent.postMessage(Object.assign({ rlBuilder: true }, msg), location.origin); } catch (e) { /* sin editor */ } };
      global.addEventListener('message', (e) => {
        if (e.origin !== location.origin || !e.data || !e.data.rlBuilder) return;
        if (e.data.cmd === 'page') {
          this.render(normalize(e.data.page) || { blocks: [] }, { preview: true });
          this.select(e.data.selected, false);
        } else if (e.data.cmd === 'select') {
          this.select(e.data.id, e.data.scroll !== false);
        }
      });
      document.addEventListener('click', (e) => {
        const a = e.target.closest('a, button, form');
        if (a) e.preventDefault();
        const blk = e.target.closest('[data-blk]');
        if (blk) send({ cmd: 'pick', id: blk.getAttribute('data-blk') });
      }, true);
      document.addEventListener('submit', (e) => e.preventDefault(), true);
      // Datos del CRM que el editor usa (categorías de servicios, cuántos hay del equipo)
      const st = DB.state;
      send({
        cmd: 'ready',
        info: {
          categories: Array.from(new Set(st.services.map(s => String(s.category || '').trim()).filter(Boolean))),
          services: st.services.length, staff: st.barberProfiles.length,
          works: st.barberProfiles.reduce((n, b) => n + b.works.length, 0),
          solo: !!(PB() && PB().isSolo()), waEnabled: !!DB.tenant.waEnabled,
          contact: !!(DB.tenant.address || DB.tenant.phone || DB.tenant.hours)
        }
      });
    },
    select(id, scroll) {
      const root = document.getElementById('pub-blocks');
      if (!root) return;
      root.querySelectorAll('.blk-selected').forEach(el => el.classList.remove('blk-selected'));
      if (!id) return;
      const el = root.querySelector('[data-blk="' + String(id).replace(/[^a-z0-9]/g, '') + '"]');
      if (!el) return;
      el.classList.add('blk-selected');
      el.querySelectorAll('.reveal').forEach(r => r.classList.add('is-visible'));
      if (scroll) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  global.SiteBlocks = SiteBlocks;
})(typeof window !== 'undefined' ? window : globalThis);
