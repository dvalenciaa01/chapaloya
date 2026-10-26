/* ==========================================================================
   CRM personalizable por negocio (tenants.crm_config)
   --------------------------------------------------------------------------
   Lo edita SOLO el superadministrador desde la consola (Personalizar CRM).
   Administradores y personal lo ven aplicado, no lo cambian (la base lo
   impide en tenants_guard y lo valida con private.crm_config_valida).
   Forma (todas las claves opcionales; {} = el CRM de siempre):
     modules       { dashboard, appointments, walkin, customers, services,
                     staff, sales, reports, whatsapp, audit } → false oculta
     fields        { appointments|customers|services|staff: { campo: {show, required} } }
     customFields  { customers: [...], appointments: [...] } campos propios
     lists         { appointments: { columns: ['client', …, 'x:clave'] } }
     theme         { mode, primary, accent, font, density, radius, logoInNav }
     site          { heroTitle, heroSubtitle, heroImage } portada de la web
   API: CrmConfig.of(tenant) · field(entity, key) · module(key) · custom(entity)
        apptColumns() · validate(cfg) · normalize(cfg) · compact(cfg)
        themeVars(tenant, cfg) · applyTheme(tenant) · applyThemeTo(el, tenant, cfg)
   ========================================================================== */
(function (global) {
  'use strict';

  const MODULES = [
    { key: 'dashboard', label: 'Panel principal', tab: 'dashboard' },
    { key: 'appointments', label: '{AppointmentPlural}', tab: 'appointments' },
    { key: 'walkin', label: 'Cola walk-in', tab: 'walkins' },
    { key: 'customers', label: '{ClientPlural}', tab: 'customers' },
    { key: 'services', label: '{ServicePlural}', tab: 'services' },
    { key: 'staff', label: '{StaffPlural} y portafolio', tab: 'barbers' },
    { key: 'sales', label: 'Ventas', tab: 'sales' },
    { key: 'reports', label: 'Reportes', tab: 'reports' },
    { key: 'whatsapp', label: 'WhatsApp', tab: 'whatsapp' },
    { key: 'audit', label: 'Historial', tab: 'audit' }
  ];

  // Permiso → módulo (un módulo apagado apaga sus permisos para todos)
  const PERM_MODULE = {
    'dashboard.view': 'dashboard',
    'appointments.view': 'appointments', 'appointments.create': 'appointments', 'appointments.status': 'appointments', 'appointments.delete': 'appointments',
    'walkins.view': 'walkin', 'walkins.create': 'walkin', 'walkins.status': 'walkin',
    'customers.view': 'customers', 'customers.manage': 'customers',
    'services.manage': 'services', 'barbers.manage': 'staff',
    'sales.view': 'sales', 'reports.view': 'reports', 'audit.view': 'audit'
  };

  /* Campos estándar: show por defecto y si admite "obligatorio" */
  const FIELDS = {
    appointments: [
      { key: 'phone', label: 'Celular', show: true, required: false, canRequire: true },
      { key: 'notes', label: 'Notas', show: true },
      { key: 'price', label: 'Precio', show: true },
      { key: 'source', label: 'Origen (web / CRM)', show: true }
    ],
    customers: [
      { key: 'phone', label: 'Celular', show: true, required: true, canRequire: true },
      { key: 'email', label: 'Correo', show: false },
      { key: 'birthdate', label: 'Fecha de nacimiento', show: false },
      { key: 'document', label: 'Documento (DNI / CE / RUC)', show: false },
      { key: 'address', label: 'Dirección', show: false },
      { key: 'notes', label: 'Observaciones', show: true }
    ],
    services: [
      { key: 'category', label: 'Categoría', show: true },
      { key: 'description', label: 'Descripción', show: true },
      { key: 'duration', label: 'Duración', show: true },
      { key: 'featured', label: 'Destacado', show: true }
    ],
    staff: [
      { key: 'role', label: 'Cargo / título', show: true },
      { key: 'photo', label: 'Foto', show: true },
      { key: 'bio', label: 'Especialidades', show: true },
      { key: 'gallery', label: 'Fotos de trabajos', show: true }
    ]
  };
  const ENTITY_LABEL = { appointments: '{AppointmentPlural}', customers: '{ClientPlural}', services: '{ServicePlural}', staff: '{StaffPlural}' };

  const TYPES = [
    { key: 'text', label: 'Texto corto' }, { key: 'textarea', label: 'Texto largo' },
    { key: 'number', label: 'Número' }, { key: 'date', label: 'Fecha' },
    { key: 'select', label: 'Lista de opciones' }, { key: 'checkbox', label: 'Casilla (sí / no)' }
  ];
  const KEY_RE = /^[a-z][a-z0-9_]{1,29}$/;
  const HEX_RE = /^#[0-9a-fA-F]{6}$/;
  const MAX_CUSTOM = 12;

  // Columnas posibles de la lista de citas (más 'x:<clave>' de los campos propios)
  const APPT_COLUMNS = [
    { key: 'client', label: '{Client}' }, { key: 'phone', label: 'Celular', field: 'phone' },
    { key: 'service', label: '{Service}' }, { key: 'staff', label: '{Staff}' },
    { key: 'date', label: 'Fecha' }, { key: 'time', label: 'Hora' },
    { key: 'price', label: 'Precio', field: 'price' }, { key: 'status', label: 'Estado' },
    { key: 'source', label: 'Origen', field: 'source' }, { key: 'notes', label: 'Notas', field: 'notes' }
  ];
  const DEFAULT_COLUMNS = ['client', 'service', 'staff', 'date', 'time', 'price', 'status'];
  const MAX_COLUMNS = 12;

  const THEME_DEFAULT = { mode: 'dark', primary: null, accent: null, font: 'barlow', density: 'comfortable', radius: 'soft', logoInNav: true };
  const THEME_ENUM = { mode: ['dark', 'light', 'auto'], font: ['barlow', 'inter', 'jakarta', 'system'], density: ['comfortable', 'compact'], radius: ['sharp', 'soft', 'round'] };
  const FONTS = {
    // La clave 'barlow' se conserva porque la base de datos valida esta lista
    // (migración 12); hoy es la fuente de la marca: Urbanist, como la landing.
    barlow: { label: 'Urbanist (de la marca)', display: "'Urbanist', system-ui, sans-serif", body: "'Urbanist', system-ui, -apple-system, 'Segoe UI', sans-serif" },
    inter: { label: 'Inter', display: "'Inter', system-ui, sans-serif", body: "'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif",
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' },
    jakarta: { label: 'Plus Jakarta Sans', display: "'Plus Jakarta Sans', system-ui, sans-serif", body: "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif",
      href: 'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap' },
    system: { label: 'Del sistema', display: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", body: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" }
  };

  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const badText = (s) => /[<>"]/.test(s);

  /* ---------------- Color ---------------- */
  function rgb(hex) {
    const h = String(hex || '').replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
  }
  function lum(hex) {
    const c = rgb(hex); if (!c) return 0;
    const ch = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  function mix(a, b, t) {
    const x = rgb(a), y = rgb(b); if (!x || !y) return a;
    const m = (p, q) => Math.round(p + (q - p) * t).toString(16).padStart(2, '0');
    return '#' + m(x.r, y.r) + m(x.g, y.g) + m(x.b, y.b);
  }
  /* Acerca el color hacia "toward" (negro o blanco) hasta lograr el contraste mínimo con todos los fondos */
  function ensure(hex, bgs, toward, min) {
    let c = hex;
    const ok = (col) => bgs.every(b => contrast(col, b) >= min);
    for (let i = 1; i <= 20 && !ok(c); i++) c = mix(hex, toward, i * 0.05);
    return c.toUpperCase();
  }

  /* ---------------- Normalización ---------------- */
  function defaults() {
    const modules = {}; MODULES.forEach(m => { modules[m.key] = true; });
    const fields = {};
    Object.keys(FIELDS).forEach(e => {
      fields[e] = {};
      FIELDS[e].forEach(f => { fields[e][f.key] = f.canRequire ? { show: f.show, required: !!f.required } : { show: f.show }; });
    });
    return { modules, fields, customFields: { customers: [], appointments: [] }, lists: { appointments: { columns: null } },
      theme: Object.assign({}, THEME_DEFAULT), site: { heroTitle: '', heroSubtitle: '', heroImage: '' } };
  }

  function normCustom(list, entity) {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(f => {
      if (!isObj(f) || out.length >= MAX_CUSTOM) return;
      const key = String(f.key || '');
      const label = String(f.label || '').trim();
      const type = TYPES.some(t => t.key === f.type) ? f.type : null;
      if (!KEY_RE.test(key) || seen.has(key) || !label || label.length > 40 || badText(label) || !type) return;
      const x = { key, label, type, required: f.required === true, showInList: f.showInList === true };
      if (type === 'select') {
        const opts = (Array.isArray(f.options) ? f.options : []).map(o => String(o == null ? '' : o).trim()).filter(o => o && o.length <= 40 && !badText(o));
        if (!opts.length) return;
        x.options = Array.from(new Set(opts)).slice(0, 20);
      }
      if (entity === 'appointments') x.public = f.public === true;
      seen.add(key);
      out.push(x);
    });
    return out;
  }

  function normalize(raw) {
    const c = isObj(raw) ? raw : {};
    const d = defaults();
    if (isObj(c.modules)) MODULES.forEach(m => { if (typeof c.modules[m.key] === 'boolean') d.modules[m.key] = c.modules[m.key]; });
    if (isObj(c.fields)) {
      Object.keys(FIELDS).forEach(e => {
        const src = c.fields[e];
        if (!isObj(src)) return;
        FIELDS[e].forEach(f => {
          const v = src[f.key];
          if (!isObj(v)) return;
          if (typeof v.show === 'boolean') d.fields[e][f.key].show = v.show;
          if (f.canRequire && typeof v.required === 'boolean') d.fields[e][f.key].required = v.required;
        });
      });
    }
    if (isObj(c.customFields)) {
      d.customFields.customers = normCustom(c.customFields.customers, 'customers');
      d.customFields.appointments = normCustom(c.customFields.appointments, 'appointments');
    }
    if (isObj(c.lists) && isObj(c.lists.appointments) && Array.isArray(c.lists.appointments.columns)) {
      const keys = new Set(d.customFields.appointments.map(f => f.key));
      const cols = [];
      c.lists.appointments.columns.forEach(k => {
        k = String(k || '');
        const ok = APPT_COLUMNS.some(x => x.key === k) || (/^x:/.test(k) && keys.has(k.slice(2)));
        if (ok && !cols.includes(k) && cols.length < MAX_COLUMNS) cols.push(k);
      });
      d.lists.appointments.columns = cols.length ? cols : null;
    }
    if (isObj(c.theme)) {
      const t = c.theme;
      Object.keys(THEME_ENUM).forEach(k => { if (THEME_ENUM[k].includes(t[k])) d.theme[k] = t[k]; });
      ['primary', 'accent'].forEach(k => { if (HEX_RE.test(String(t[k] || ''))) d.theme[k] = String(t[k]).toUpperCase(); });
      if (typeof t.logoInNav === 'boolean') d.theme.logoInNav = t.logoInNav;
    }
    if (isObj(c.site)) {
      const s = c.site;
      if (typeof s.heroTitle === 'string' && s.heroTitle.trim().length <= 80) d.site.heroTitle = s.heroTitle.trim();
      if (typeof s.heroSubtitle === 'string' && s.heroSubtitle.trim().length <= 200) d.site.heroSubtitle = s.heroSubtitle.trim();
      if (typeof s.heroImage === 'string' && /^https:\/\/[^\s"'<>]+$/.test(s.heroImage.trim()) && s.heroImage.trim().length <= 500) d.site.heroImage = s.heroImage.trim();
    }
    return d;
  }

  /* Deja solo lo que difiere de los valores por defecto (lo que se guarda) */
  function compact(full) {
    const n = normalize(full);
    const d = defaults();
    const out = {};
    const mods = {};
    MODULES.forEach(m => { if (n.modules[m.key] !== d.modules[m.key]) mods[m.key] = n.modules[m.key]; });
    if (Object.keys(mods).length) out.modules = mods;
    const fields = {};
    Object.keys(FIELDS).forEach(e => {
      const ent = {};
      FIELDS[e].forEach(f => {
        const a = n.fields[e][f.key], b = d.fields[e][f.key];
        const x = {};
        if (a.show !== b.show) x.show = a.show;
        if (f.canRequire && a.required !== b.required) x.required = a.required;
        if (Object.keys(x).length) ent[f.key] = x;
      });
      if (Object.keys(ent).length) fields[e] = ent;
    });
    if (Object.keys(fields).length) out.fields = fields;
    const cf = {};
    ['customers', 'appointments'].forEach(e => { if (n.customFields[e].length) cf[e] = n.customFields[e]; });
    if (Object.keys(cf).length) out.customFields = cf;
    if (n.lists.appointments.columns) out.lists = { appointments: { columns: n.lists.appointments.columns } };
    const th = {};
    Object.keys(THEME_DEFAULT).forEach(k => { if (n.theme[k] !== THEME_DEFAULT[k]) th[k] = n.theme[k]; });
    if (Object.keys(th).length) out.theme = th;
    const site = {};
    ['heroTitle', 'heroSubtitle', 'heroImage'].forEach(k => { if (n.site[k]) site[k] = n.site[k]; });
    if (Object.keys(site).length) out.site = site;
    return out;
  }

  /* Valida una configuración (la que arma el editor). Devuelve una lista de errores en español. */
  function validate(cfg) {
    const errs = [];
    const c = isObj(cfg) ? cfg : {};
    if (cfg != null && !isObj(cfg)) return ['La configuración debe ser un objeto.'];
    if (JSON.stringify(c).length > 32000) errs.push('La configuración es demasiado grande.');
    ['customers', 'appointments'].forEach(e => {
      const list = isObj(c.customFields) ? c.customFields[e] : null;
      if (list == null) return;
      const name = e === 'customers' ? 'fichas' : 'citas';
      if (!Array.isArray(list)) { errs.push('Los campos propios de ' + name + ' deben ser una lista.'); return; }
      if (list.length > MAX_CUSTOM) errs.push('Máximo ' + MAX_CUSTOM + ' campos propios en ' + name + '.');
      const seen = new Set();
      list.forEach((f, i) => {
        const n = '“' + ((f && f.label) || 'Campo ' + (i + 1)) + '”';
        if (!isObj(f)) { errs.push('Campo ' + (i + 1) + ' no válido.'); return; }
        if (!KEY_RE.test(String(f.key || ''))) errs.push(n + ': la clave debe empezar con letra y usar solo minúsculas, números y _ (2 a 30).');
        else if (seen.has(f.key)) errs.push(n + ': la clave “' + f.key + '” está repetida.');
        seen.add(f.key);
        const lbl = String(f.label || '').trim();
        if (!lbl || lbl.length > 40 || badText(lbl)) errs.push('Campo ' + (i + 1) + ': el nombre debe tener de 1 a 40 caracteres, sin < > ".');
        if (!TYPES.some(t => t.key === f.type)) errs.push(n + ': tipo no válido.');
        if (f.type === 'select') {
          const o = Array.isArray(f.options) ? f.options : [];
          if (!o.length || o.length > 20) errs.push(n + ': agrega de 1 a 20 opciones.');
          if (o.some(x => typeof x !== 'string' || !x.trim() || x.length > 40 || badText(x))) errs.push(n + ': cada opción debe tener de 1 a 40 caracteres, sin < > ".');
        } else if (f.options != null && f.type !== 'select') errs.push(n + ': solo las listas llevan opciones.');
        if (f.public && e !== 'appointments') errs.push(n + ': solo los campos de citas pueden ser públicos.');
      });
    });
    const cols = isObj(c.lists) && isObj(c.lists.appointments) ? c.lists.appointments.columns : null;
    if (cols != null) {
      if (!Array.isArray(cols) || !cols.length || cols.length > MAX_COLUMNS) errs.push('La lista de citas debe tener de 1 a ' + MAX_COLUMNS + ' columnas.');
      else {
        const keys = new Set((((c.customFields || {}).appointments) || []).map(f => f && f.key));
        cols.forEach(k => {
          if (!(APPT_COLUMNS.some(x => x.key === k) || (/^x:/.test(k) && keys.has(String(k).slice(2))))) errs.push('Columna desconocida en la lista de citas: ' + k + '.');
        });
        if (new Set(cols).size !== cols.length) errs.push('Hay columnas repetidas en la lista de citas.');
      }
    }
    if (isObj(c.theme)) {
      const t = c.theme;
      Object.keys(THEME_ENUM).forEach(k => { if (t[k] != null && !THEME_ENUM[k].includes(t[k])) errs.push('Apariencia: valor no válido para ' + k + '.'); });
      ['primary', 'accent'].forEach(k => { if (t[k] != null && !HEX_RE.test(String(t[k]))) errs.push('Apariencia: el color debe tener el formato #RRGGBB.'); });
    }
    if (isObj(c.site)) {
      const s = c.site;
      if (s.heroTitle != null && String(s.heroTitle).length > 80) errs.push('Web: el título de portada admite hasta 80 caracteres.');
      if (s.heroSubtitle != null && String(s.heroSubtitle).length > 200) errs.push('Web: el subtítulo admite hasta 200 caracteres.');
      if (s.heroImage && !(/^https:\/\/[^\s"'<>]+$/.test(String(s.heroImage)) && String(s.heroImage).length <= 500)) errs.push('Web: la imagen debe ser un enlace https:// (hasta 500 caracteres).');
    }
    return errs;
  }

  /* ---------------- Tema ---------------- */
  function paletteOf(t) {
    if (typeof TenantBrand !== 'undefined' && TenantBrand.paletteOf) return TenantBrand.paletteOf(t);
    const p = (t && isObj(t.palette)) ? t.palette : {};
    return { primary: HEX_RE.test(p.primary || '') ? p.primary : '#000000', secondary: HEX_RE.test(p.secondary || '') ? p.secondary : '#D79848', tertiary: HEX_RE.test(p.tertiary || '') ? p.tertiary : '#FFFFFF' };
  }
  function prefersDark() {
    try { return !global.matchMedia || global.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return true; }
  }

  /* Variables CSS del tema. Devuelve { mode, vars, attrs, checks, notes, font }.
     checks: contrastes resultantes; notes: avisos (color ajustado para que se lea). */
  function themeVars(tenant, cfg, opts) {
    const th = (cfg || normalize(tenant && tenant.crmConfig)).theme;
    const o = opts || {};
    const pal = paletteOf(tenant);
    const mode = th.mode === 'auto' ? ((o.prefersDark != null ? o.prefersDark : prefersDark()) ? 'dark' : 'light') : th.mode;
    let bg, fg;
    const ink = {};
    if (mode === 'light') {
      bg = '#FFFFFF';
      fg = (lum(pal.primary) < 0.03 && contrast(pal.primary, '#FFFFFF') >= 12) ? pal.primary : '#16181B';
      [['--ink-950', 0], ['--ink-900', 0.045], ['--ink-850', 0], ['--ink-800', 0.03], ['--ink-750', 0.07], ['--ink-700', 0.1], ['--ink-600', 0.16]]
        .forEach(([k, a]) => { ink[k] = mix(bg, fg, a); });
    } else {
      bg = lum(pal.primary) < 0.2 ? pal.primary : '#0B0B0B';
      fg = contrast(pal.tertiary, bg) >= 7 ? pal.tertiary : '#FFFFFF';
      [['--ink-950', 0], ['--ink-900', 0.04], ['--ink-850', 0.07], ['--ink-800', 0.09], ['--ink-750', 0.12], ['--ink-700', 0.15], ['--ink-600', 0.2]]
        .forEach(([k, a]) => { ink[k] = mix(bg, fg, a); });
    }
    const page = ink['--ink-900'];
    const surfaces = [bg, page, ink['--ink-850'], ink['--ink-800']];
    const toward = mode === 'light' ? '#000000' : '#FFFFFF';
    const wantP = th.primary || pal.secondary;
    const wantA = th.accent || wantP;
    const primary = ensure(wantP, surfaces, toward, 4.5);
    const accent = ensure(wantA, surfaces, toward, 4.5);
    const notes = [];
    if (primary.toUpperCase() !== String(wantP).toUpperCase()) notes.push({ key: 'primary', from: wantP, to: primary, ratio: Math.min(...surfaces.map(s => contrast(wantP, s))) });
    if (th.accent && accent.toUpperCase() !== String(wantA).toUpperCase()) notes.push({ key: 'accent', from: wantA, to: accent, ratio: Math.min(...surfaces.map(s => contrast(wantA, s))) });
    const P = rgb(bg), T = rgb(fg), Y = rgb(primary), A = rgb(accent);
    const rgba = (c, a) => 'rgba(' + c.r + ', ' + c.g + ', ' + c.b + ', ' + a + ')';
    const font = FONTS[th.font] || FONTS.barlow;
    const loMix = mode === 'light' ? 0.32 : 0.36;
    const vars = Object.assign({
      '--black': bg, '--white': fg,
      '--bg-rgb': P.r + ', ' + P.g + ', ' + P.b, '--fg-rgb': T.r + ', ' + T.g + ', ' + T.b,
      '--on-dark-hi': fg, '--on-dark-md': mix(fg, bg, 0.17), '--on-dark-lo': mix(fg, bg, loMix),
      '--on-light-hi': bg, '--on-light-md': mix(bg, fg, 0.24), '--on-light-lo': mix(bg, fg, 0.36),
      '--line-dark': rgba(T, mode === 'light' ? 0.12 : 0.10), '--line-dark-strong': rgba(T, mode === 'light' ? 0.22 : 0.18),
      '--line-light': rgba(P, 0.10), '--line-light-strong': rgba(P, 0.22),
      '--yellow': primary, '--yellow-hover': mix(primary, mode === 'light' ? '#000000' : '#FFFFFF', mode === 'light' ? 0.12 : 0.22),
      '--yellow-press': mix(primary, '#000000', 0.12),
      '--yellow-soft': rgba(Y, 0.12), '--yellow-line': rgba(Y, 0.45),
      '--crm-accent': accent, '--crm-accent-soft': rgba(A, 0.12),
      '--success-text': mode === 'light' ? '#166534' : '#4ADE80', '--danger-text': mode === 'light' ? '#B91C1C' : '#F87171',
      '--warn-text': mode === 'light' ? '#92400E' : '#FBBF24',
      '--font-display': font.display, '--font-body': font.body,
      '--shadow-lg': mode === 'light' ? '0 18px 48px rgba(15, 23, 42, 0.16)' : '0 24px 60px rgba(0, 0, 0, 0.55)',
      '--shadow-md': mode === 'light' ? '0 8px 24px rgba(15, 23, 42, 0.10)' : '0 10px 30px rgba(0, 0, 0, 0.35)',
      // Alias (se declaran también aquí para que una vista previa con su propio tema los herede bien)
      '--golden': primary, '--golden-bright': mix(primary, '#FFFFFF', 0.22), '--golden-dim': rgba(Y, 0.12), '--border-golden': rgba(Y, 0.45),
      '--text-white': fg, '--text-grey': mix(fg, bg, loMix), '--text-light': mix(fg, bg, 0.17),
      '--border-subtle': rgba(T, mode === 'light' ? 0.12 : 0.10), '--border-med': rgba(T, mode === 'light' ? 0.22 : 0.18)
    }, ink);
    vars['--bg-deep'] = ink['--ink-950']; vars['--bg-main'] = ink['--ink-900']; vars['--bg-elevated'] = ink['--ink-850'];
    vars['--bg-card'] = ink['--ink-800']; vars['--bg-input'] = ink['--ink-950'];
    const checks = [
      { key: 'text', label: 'Texto sobre el fondo', ratio: contrast(fg, page) },
      { key: 'muted', label: 'Texto secundario', ratio: contrast(vars['--on-dark-lo'], page) },
      { key: 'button', label: 'Texto de los botones', ratio: contrast(bg, primary) },
      { key: 'accent', label: 'Acento sobre tarjetas', ratio: contrast(accent, ink['--ink-850']) }
    ].map(c => Object.assign(c, { ok: c.ratio >= 4.5 }));
    return { mode, vars, checks, notes, font: th.font, attrs: { mode, density: th.density, radius: th.radius, font: th.font, logo: th.logoInNav ? 'on' : 'off' } };
  }

  function loadFont(key) {
    const f = FONTS[key];
    if (!f || !f.href || !global.document) return;
    const id = 'crm-font-' + key;
    if (document.getElementById(id)) return;
    const l = document.createElement('link');
    l.id = id; l.rel = 'stylesheet'; l.href = f.href;
    document.head.appendChild(l);
  }

  function applyThemeTo(el, tenant, cfg, opts) {
    const r = themeVars(tenant, cfg, opts);
    Object.keys(r.vars).forEach(k => el.style.setProperty(k, r.vars[k]));
    el.setAttribute('data-crm-mode', r.attrs.mode);
    el.setAttribute('data-crm-density', r.attrs.density);
    el.setAttribute('data-crm-radius', r.attrs.radius);
    el.setAttribute('data-crm-font', r.attrs.font);
    loadFont(r.font);
    return r;
  }

  const CrmConfig = {
    MODULES, FIELDS, TYPES, APPT_COLUMNS, DEFAULT_COLUMNS, MAX_COLUMNS, MAX_CUSTOM, FONTS, THEME_DEFAULT, ENTITY_LABEL, KEY_RE,
    contrast, mix, lum,
    defaults, normalize, compact, validate, themeVars, applyThemeTo, loadFont,

    _cache: { raw: undefined, cfg: null },
    // Configuración normalizada del negocio (por defecto, el activo)
    of(tenant) {
      const t = tenant === undefined ? (typeof DB !== 'undefined' ? DB.tenant : null) : tenant;
      const raw = t ? t.crmConfig : null;
      const key = JSON.stringify(raw || {});
      if (this._cache.raw === key) return this._cache.cfg;
      const cfg = normalize(raw);
      this._cache = { raw: key, cfg };
      return cfg;
    },
    module(key) { const m = this.of().modules; return m[key] !== false; },
    tabAllowed(tab) {
      const m = MODULES.find(x => x.tab === tab);
      return !m || this.module(m.key);
    },
    permAllowed(perm) {
      const mod = PERM_MODULE[perm];
      return !mod || this.module(mod);
    },
    // { show, required } de un campo estándar
    field(entity, key) {
      const f = (this.of().fields[entity] || {})[key];
      if (!f) return { show: true, required: false };
      return { show: f.show !== false, required: f.show !== false && !!f.required };
    },
    show(entity, key) { return this.field(entity, key).show; },
    custom(entity) { return this.of().customFields[entity] || []; },
    site() { return this.of().site; },

    /* Columnas efectivas de la lista de citas (sin las de campos ocultos ni claves que ya no existen) */
    apptColumns(cfg) {
      const c = cfg || this.of();
      const custom = c.customFields.appointments;
      const keys = new Set(custom.map(f => f.key));
      let cols = c.lists.appointments.columns;
      if (!cols) cols = DEFAULT_COLUMNS.concat(custom.filter(f => f.showInList).map(f => 'x:' + f.key));
      const showF = (k) => !c.fields.appointments[k] || c.fields.appointments[k].show !== false;
      const out = cols.filter(k => {
        if (/^x:/.test(k)) return keys.has(k.slice(2));
        const def = APPT_COLUMNS.find(x => x.key === k);
        return def && (!def.field || showF(def.field));
      });
      return out.length ? out : ['client', 'date', 'time', 'status'];
    },

    /* ---------------- Campos propios: formulario, lectura y validación ---------------- */
    inputHTML(prefix, f, value) {
      const E = (v) => (typeof UI !== 'undefined' ? UI.esc(v) : String(v == null ? '' : v));
      const id = prefix + f.key;
      const req = f.required ? ' <span class="req">*</span>' : '';
      const v = value == null ? '' : value;
      const lbl = '<label class="field-lbl" for="' + id + '">' + E(f.label) + req + '</label>';
      const common = ' id="' + id + '" class="input-dark" data-cf="' + E(f.key) + '"' + (f.required ? ' aria-required="true"' : '');
      let ctl;
      if (f.type === 'textarea') ctl = '<textarea' + common + ' maxlength="500" rows="3">' + E(v) + '</textarea>';
      else if (f.type === 'number') ctl = '<input type="number" step="any" inputmode="decimal"' + common + ' value="' + E(v) + '" />';
      else if (f.type === 'date') ctl = '<input type="date"' + common + ' value="' + E(v) + '" />';
      else if (f.type === 'select') {
        ctl = '<select' + common + '><option value="">' + (f.required ? 'Elige una opción' : '—') + '</option>' +
          (f.options || []).map(o => '<option value="' + E(o) + '"' + (o === v ? ' selected' : '') + '>' + E(o) + '</option>').join('') + '</select>';
      } else if (f.type === 'checkbox') {
        return '<div class="cf-field cf-check"><label class="check-line"><input type="checkbox" id="' + id + '" data-cf="' + E(f.key) + '"' + (v === true ? ' checked' : '') + ' /> <span>' + E(f.label) + req + '</span></label></div>';
      } else ctl = '<input type="text" maxlength="500"' + common + ' value="' + E(v) + '" />';
      return '<div class="cf-field' + (f.type === 'textarea' ? ' cf-wide' : '') + '">' + lbl + ctl + '</div>';
    },
    formHTML(entity, prefix, extra) {
      const list = this.custom(entity);
      if (!list.length) return '';
      const x = isObj(extra) ? extra : {};
      return '<div class="form-grid-2 cf-grid">' + list.map(f => this.inputHTML(prefix, f, x[f.key])).join('') + '</div>';
    },
    /* Lee y valida. Devuelve { extra, error }. "base" conserva las claves que no son de la configuración actual. */
    readForm(entity, prefix, base) {
      const out = Object.assign({}, isObj(base) ? base : {});
      for (const f of this.custom(entity)) {
        const el = global.document.getElementById(prefix + f.key);
        if (!el) continue;
        let v;
        if (f.type === 'checkbox') {
          v = !!el.checked;
          if (f.required && !v) return { error: 'Marca “' + f.label + '”.' };
          if (v) out[f.key] = true; else delete out[f.key];
          continue;
        }
        v = String(el.value == null ? '' : el.value).trim();
        if (!v) {
          if (f.required) return { error: 'Completa “' + f.label + '”.' };
          delete out[f.key];
          continue;
        }
        if (v.length > 500) return { error: '“' + f.label + '” admite hasta 500 caracteres.' };
        if (f.type === 'number') {
          const n = Number(v.replace(',', '.'));
          if (!isFinite(n)) return { error: '“' + f.label + '” debe ser un número.' };
          out[f.key] = n;
        } else if (f.type === 'date') {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T12:00:00Z'))) return { error: '“' + f.label + '” debe ser una fecha válida.' };
          out[f.key] = v;
        } else if (f.type === 'select') {
          if (!(f.options || []).includes(v)) return { error: 'Elige una opción válida en “' + f.label + '”.' };
          out[f.key] = v;
        } else out[f.key] = v;
      }
      if (JSON.stringify(out).length > 8000) return { error: 'Los datos adicionales son demasiado largos.' };
      return { extra: out };
    },
    // Texto para mostrar un valor de campo propio
    display(f, v) {
      if (v == null || v === '') return '';
      if (f.type === 'checkbox') return v === true ? 'Sí' : 'No';
      if (f.type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const p = v.split('-'); return p[2] + '/' + p[1] + '/' + p[0]; }
      return String(v);
    },

    /* ---------------- Aplicar al CRM ---------------- */
    applyTheme(tenant) {
      if (!global.document) return null;
      const t = tenant === undefined ? (typeof DB !== 'undefined' ? DB.tenant : null) : tenant;
      if (!t) return null;
      const html = document.documentElement;
      const r = applyThemeTo(html, t, this.of(t));
      html.style.colorScheme = r.mode;
      html.setAttribute('data-crm-logo', t.logo && !r.attrs.logo.startsWith('on') ? 'off' : 'on');
      const txt = document.getElementById('crm-brand-text');
      if (txt) txt.textContent = t.name || '';
      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta) meta.setAttribute('content', r.vars['--black']);
      if (!this._mq && global.matchMedia) {
        try {
          this._mq = global.matchMedia('(prefers-color-scheme: dark)');
          this._mq.addEventListener('change', () => { if (this.of().theme.mode === 'auto') this.applyTheme(); });
        } catch (e) { /* sin matchMedia */ }
      }
      this.last = r;
      return r;
    }
  };

  global.CrmConfig = CrmConfig;
})(typeof window !== 'undefined' ? window : globalThis);
