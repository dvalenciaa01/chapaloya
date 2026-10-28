/* ==========================================================================
   Marca por negocio: color, logo, datos de contacto, vocabulario del rubro
   (js/core/vocab.js) y enlace ?b=slug
   ========================================================================== */
const TenantBrand = {
  /* ---------------- Color ---------------- */
  hexToRgb(hex) {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  },

  luminance(hex) {
    const c = this.hexToRgb(hex);
    if (!c) return 0;
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  },

  contrast(a, b) {
    const l1 = this.luminance(a), l2 = this.luminance(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  },

  mix(hex, target, amount) {
    const a = this.hexToRgb(hex), b = this.hexToRgb(target);
    if (!a || !b) return hex;
    const m = (x, y) => Math.round(x + (y - x) * amount).toString(16).padStart(2, '0');
    return '#' + m(a.r, b.r) + m(a.g, b.g) + m(a.b, b.b);
  },

  applyAccent(hex) {
    const c = this.hexToRgb(hex);
    if (!c) return;
    const s = document.documentElement.style;
    s.setProperty('--yellow', hex);
    s.setProperty('--yellow-hover', this.mix(hex, '#FFFFFF', 0.22));
    s.setProperty('--yellow-press', this.mix(hex, '#000000', 0.12));
    s.setProperty('--yellow-soft', 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', 0.12)');
    s.setProperty('--yellow-line', 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', 0.45)');
  },

  /* Paleta de 3 colores: primario (fondo), secundario (acento), terciario (texto).
     Los tonos intermedios (superficies, textos secundarios, bordes) se derivan
     mezclando primario y terciario, igual que en la paleta original de Golden. */
  DEFAULT_PALETTE: { primary: '#000000', secondary: '#D79848', tertiary: '#FFFFFF' },

  // Solo se aceptan colores #RRGGBB: cualquier otro valor (p. ej. texto inyectado por API) se descarta (C1)
  isHex(v) { return /^#[0-9a-fA-F]{6}$/.test(String(v || '')); },

  paletteOf(t) {
    const p = (t && t.palette && typeof t.palette === 'object') ? t.palette : {};
    const pick = (...vals) => vals.find(v => this.isHex(v));
    return {
      primary: pick(p.primary) || this.DEFAULT_PALETTE.primary,
      secondary: pick(p.secondary, t && t.accent) || this.DEFAULT_PALETTE.secondary,
      tertiary: pick(p.tertiary) || this.DEFAULT_PALETTE.tertiary
    };
  },

  /* Valida una paleta. Devuelve { ok, checks:[{label, ratio, min, ok}], error } */
  checkPalette(p) {
    const textC = this.contrast(p.tertiary, p.primary);
    const accC = this.contrast(p.secondary, p.primary);
    const checks = [
      { key: 'text', label: 'Textos sobre el fondo', ratio: textC, min: 7, ok: textC >= 7 },
      { key: 'accent', label: 'Botones (acento sobre fondo)', ratio: accC, min: 4.5, ok: accC >= 4.5 }
    ];
    let error = '';
    if (this.luminance(p.primary) >= this.luminance(p.tertiary)) error = 'El primario es el color de FONDO y debe ser más oscuro que el terciario (textos).';
    else if (!checks[0].ok) error = 'El texto (terciario) no contrasta lo suficiente con el fondo (primario). Se necesita 7:1.';
    else if (!checks[1].ok) error = 'El acento (secundario) no contrasta lo suficiente con el fondo. Se necesita 4.5:1.';
    return { ok: !error, checks, error };
  },

  applyPalette(pal) {
    const p = Object.assign({}, this.DEFAULT_PALETTE, pal || {});
    const P = this.hexToRgb(p.primary), T = this.hexToRgb(p.tertiary);
    if (!P || !T) return;
    const s = document.documentElement.style;
    const set = (k, v) => s.setProperty(k, v);
    const rgba = (c, a) => 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
    set('--black', p.primary);
    set('--white', p.tertiary);
    set('--bg-rgb', P.r + ', ' + P.g + ', ' + P.b);
    set('--fg-rgb', T.r + ', ' + T.g + ', ' + T.b);
    [['--ink-950', 0], ['--ink-900', 0.04], ['--ink-850', 0.07], ['--ink-800', 0.09], ['--ink-750', 0.12], ['--ink-700', 0.15], ['--ink-600', 0.2]]
      .forEach(([k, a]) => set(k, this.mix(p.primary, p.tertiary, a)));
    set('--on-dark-hi', p.tertiary);
    set('--on-dark-md', this.mix(p.tertiary, p.primary, 0.17));
    set('--on-dark-lo', this.mix(p.tertiary, p.primary, 0.36));
    set('--on-light-hi', p.primary);
    set('--on-light-md', this.mix(p.primary, p.tertiary, 0.24));
    set('--on-light-lo', this.mix(p.primary, p.tertiary, 0.36));
    set('--line-dark', rgba(T, 0.10));
    set('--line-dark-strong', rgba(T, 0.18));
    set('--line-light', rgba(P, 0.10));
    set('--line-light-strong', rgba(P, 0.22));
    this.applyAccent(p.secondary);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.primary);
  },

  /* ---------------- Logo ---------------- */
  logoHTML(t, cls) {
    if (t && t.logo) {
      return '<img class="' + (cls || 'brand-img') + '" src="' + UIx.esc(t.logo) + '" alt="' + UIx.esc(t.name) + '" />';
    }
    return '<span class="brand-wordmark">' + UIx.esc(t ? t.name : 'Reservas en línea') + '</span>';
  },

  swapLogos(t) {
    document.querySelectorAll('img.brand-img, .brand-wordmark[data-brand-slot]').forEach(el => {
      const lg = el.classList.contains('brand-img-lg') || el.classList.contains('is-lg');
      if (t.logo) {
        if (el.tagName === 'IMG') { el.src = t.logo; el.alt = t.name; }
        else el.outerHTML = '<img class="brand-img' + (lg ? ' brand-img-lg' : '') + '" src="' + UIx.esc(t.logo) + '" alt="' + UIx.esc(t.name) + '" />';
      } else {
        el.outerHTML = '<span class="brand-wordmark' + (lg ? ' is-lg' : '') + '" data-brand-slot="1">' + UIx.esc(t.name) + '</span>';
      }
    });
    document.querySelectorAll('img.brand-img').forEach(img => { this.markLogoShape(img); this.cleanLogo(img); });
  },

  /* Logo con fondo liso: donde está cargado js/utils/image-compressor.js (CRM y
     consola) se muestra con el fondo transparente. Mientras se limpia, el logo
     espera oculto (como mucho un instante); si no se puede, queda el original. */
  cleanLogo(img) {
    if (typeof cleanLogoURL !== 'function' || !img.src || img.dataset.clean === img.src) return;
    const src = img.src;
    img.classList.add('is-cleaning');
    const done = () => img.classList.remove('is-cleaning');
    const timer = setTimeout(done, 1500);
    cleanLogoURL(src).then(out => {
      clearTimeout(timer);
      if (out && img.src === src) { img.src = out; img.dataset.clean = out; this.markLogoShape(img); }
      done();
    });
  },

  /* Forma del logo (data-shape): los cuadrados o altos se muestran algo más
     grandes que los horizontales, para que todos pesen lo mismo a la vista */
  markLogoShape(img) {
    const set = () => {
      if (img.naturalWidth && img.naturalHeight) img.dataset.shape = img.naturalWidth / img.naturalHeight < 1.6 ? 'compact' : 'wide';
    };
    if (img.complete) set(); else img.addEventListener('load', set, { once: true });
  },

  /* ---------------- Textos y enlaces ---------------- */
  telHref(phone) {
    let digits = String(phone || '').replace(/[^\d+]/g, '');
    if (/^9\d{8}$/.test(digits)) digits = '+51' + digits;      // celular peruano sin prefijo
    return digits ? 'tel:' + digits : '#';
  },

  setMeta(sel, attr, value) {
    let el = document.querySelector(sel);
    if (!el) {
      const m = /\[(name|property)="([^"]+)"\]/.exec(sel);
      if (!m) return;
      el = document.createElement('meta');
      el.setAttribute(m[1], m[2]);
      document.head.appendChild(el);
    }
    el.setAttribute(attr, value);
  },

  fillTexts(t) {
    const values = {
      name: t.name, address: t.address, phone: t.phone, hours: t.hours, city: t.city, owner: t.ownerName,
      year: String(new Date().getFullYear())
    };
    document.querySelectorAll('[data-t]').forEach(el => {
      const key = el.getAttribute('data-t');
      const val = values[key];
      const row = el.closest('[data-t-row]');
      if (!val) { if (row) row.hidden = true; return; }
      if (row) row.hidden = false;
      el.textContent = val;
      if (key === 'phone' && el.tagName === 'A') el.setAttribute('href', this.telHref(val));
    });
    // Títulos de pestaña: "Algo | Reservas en línea" → "Algo | <nombre>"
    const parts = document.title.split('|');
    document.title = parts.length > 1 ? parts[0].trim() + ' | ' + t.name : t.name;
    // Vista previa al compartir (para quien ejecute JS; el HTML base es neutro)
    const desc = document.querySelector('meta[name="description"]');
    this.setMeta('meta[property="og:title"]', 'content', document.title);
    if (desc) this.setMeta('meta[property="og:description"]', 'content', t.name + ': ' + desc.getAttribute('content'));
    if (t.logo) {
      // Hay dos íconos (SVG y PNG): ambos pasan al logo del negocio
      document.querySelectorAll('link[rel="icon"]').forEach(icon => { icon.setAttribute('href', t.logo); icon.removeAttribute('type'); icon.removeAttribute('sizes'); });
    }
  },

  /* WhatsApp: lo que promete avisos por WhatsApp (data-wa-only) se oculta si el
     negocio no lo tiene activo; data-wa-off es el texto alternativo. */
  applyWhatsApp(t) {
    const on = t.waEnabled !== false;
    document.querySelectorAll('[data-wa-only]').forEach(el => { el.hidden = !on; });
    document.querySelectorAll('[data-wa-off]').forEach(el => { el.hidden = on; });
    if (!on) {
      const cb = document.getElementById('pb-wa');
      if (cb) cb.checked = false;
    }
  },

  // Los textos de marca se ocultan hasta saber qué negocio es (sin mostrar otra marca mientras carga)
  brandReady() { document.documentElement.classList.remove('brand-pending'); },

  withSlug(href, slug) {
    if (!href || !slug) return href;
    if (/^(https?:|mailto:|tel:|#|javascript:)/i.test(href)) return href;
    // Con direcciones limpias el negocio ya va en la ruta y las páginas sin .html (/<enlace>/servicios)
    if (Routes.pretty() && Routes.pathSlug() === slug) return /^(crm|login|reservalope)\.html/.test(href) ? href : Routes.clean(href);
    if (!/\.html(\?|#|$)/.test(href)) return href;
    if (/^(crm|login)\.html/.test(href)) return href;
    if (/[?&]b=/.test(href)) return href;
    const [base, hash] = href.split('#');
    return base + (base.includes('?') ? '&' : '?') + 'b=' + encodeURIComponent(slug) + (hash ? '#' + hash : '');
  },

  rewriteLinks(slug, root) {
    (root || document).querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href');
      const n = this.withSlug(h, slug);
      if (n !== h) a.setAttribute('href', n);
    });
  },

  /* Palabras del rubro (barbero/doctor/especialista...): el HTML trae las
     genéricas y aquí se cambian por las del negocio (data-v, data-v-fmt,
     data-v-attr, data-v-icon). Sin vocab.js la página queda con las genéricas. */
  applyVocab(t, root) {
    if (typeof Vocab === 'undefined') return;
    Vocab.set(t);
    Vocab.apply(root || document);
  },

  /* Estilo por rubro (css/pages/rubros.css usa html[data-rubro]): cada rubro
     tiene su propia tipografía y solo se descarga la del negocio activo. */
  RUBRO_FONTS: ['barberia', 'salon', 'spa', 'unas', 'consultorio', 'dental', 'psicologia', 'veterinaria', 'tatuajes', 'fitness'],
  applyRubroFonts() {
    const type = typeof Vocab !== 'undefined' ? Vocab.type() : null;
    if (!type || !this.RUBRO_FONTS.includes(type) || document.getElementById('rubro-fonts')) return;
    const link = document.createElement('link');
    link.id = 'rubro-fonts';
    link.rel = 'stylesheet';
    link.href = 'css/fonts/rubro-' + type + '.css';
    document.head.appendChild(link);
  },

  /* ---------------- Aplicación ---------------- */
  applyPublic(t) {
    this.applyPalette(this.paletteOf(t));
    this.applyVocab(t);
    this.applyRubroFonts();
    this.swapLogos(t);
    this.fillTexts(t);
    this.applyWhatsApp(t);
    this.rewriteLinks(t.slug);
    this.brandReady();
    const wspName = document.querySelector('.wsp-head-id strong');
    if (wspName) wspName.textContent = t.name;
    document.querySelectorAll('.brand-logo').forEach(a => a.setAttribute('aria-label', t.name + ', ir al inicio'));
  },

  applyCrm(t) {
    this.applyPalette(this.paletteOf(t));
    this.swapLogos(t);
    const pub = document.getElementById('crm-public-link');
    if (pub) pub.setAttribute('href', Routes.web(t.slug));
    const brand = document.getElementById('crm-brand-link');
    if (brand) brand.setAttribute('href', Routes.web(t.slug));
    const side = document.getElementById('crm-sidebar-shopname');
    if (side) side.textContent = t.name;
    document.title = 'CRM | ' + t.name;
    // /crm/<otro-enlace>/ abierto con la sesión de este negocio: corregir la dirección
    const ps = Routes.pathSlug();
    if (ps && ps !== t.slug && location.pathname.indexOf('/crm/') === 0) {
      history.replaceState(null, '', Routes.crm(t.slug) + location.search + location.hash);
    }
  },

  showUnavailable(info) {
    const main = document.getElementById('main');
    const suspended = info && info.tenant && info.tenant.status !== 'ACTIVE';
    const html =
      '<section class="unavailable">' +
        '<div class="container">' +
          '<span class="unavailable-icon">' + (typeof ic === 'function' ? ic(suspended ? 'lock' : 'search') : '') + '</span>' +
          '<h1>' + (suspended ? 'Reservas no disponibles' : 'No encontramos este negocio') + '</h1>' +
          '<p>' + (suspended
            ? 'Este negocio no está recibiendo reservas en línea por el momento.'
            : 'Revisa el enlace que te compartieron. Debe tener la forma <strong>' + (Routes.pretty() ? location.host + '/nombre-del-negocio' : 'index.html?b=nombre-del-negocio') + '</strong>.') + '</p>' +
        '</div>' +
      '</section>';
    if (main) main.innerHTML = html;
    document.querySelectorAll('.site-nav, .header-actions .header-cta, .wsp-float-btn, .site-footer .footer-grid > div:not(.footer-brand)').forEach(el => { el.hidden = true; });
    document.querySelectorAll('img.brand-img').forEach(el => { el.outerHTML = '<span class="brand-wordmark" data-brand-slot="1">Reservas en línea</span>'; });
    document.title = suspended ? 'Reservas no disponibles' : 'Negocio no encontrado';
    this.brandReady();
  }
};

/* Escape mínimo propio (la web pública no carga ui.js) */
const UIx = {
  esc(str) {
    return String(str == null ? '' : str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
};
