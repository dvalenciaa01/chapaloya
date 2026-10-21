/* ==========================================================================
   Vocabulario por rubro: las palabras visibles cambian según el tipo de
   negocio (barbería, consultorio, spa...). Los nombres internos (tablas
   barbers, campos barberId, archivos barberos.html) NO cambian.
   Se carga antes que tenant-brand.js en todas las páginas.
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---------------- Presets por rubro ----------------
     Todas las palabras en minúscula (T() capitaliza). business es el
     sustantivo común del local; staff el que atiende; client el que reserva. */
  const PRESETS = {
    barberia: {
      label: 'Barbería', icon: 'scissors',
      business: 'barbería', businessArticle: 'la',
      staff: 'barbero', staffPlural: 'barberos', staffArticle: 'el',
      service: 'servicio', servicePlural: 'servicios',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en sillón ahora', walkIn: 'walk-in'
    },
    salon: {
      label: 'Salón de belleza', icon: 'comb',
      business: 'salón', businessArticle: 'el',
      staff: 'estilista', staffPlural: 'estilistas', staffArticle: 'el',
      service: 'servicio', servicePlural: 'servicios',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'atendiendo ahora', walkIn: 'sin cita'
    },
    spa: {
      label: 'Spa y estética', icon: 'leaf',
      business: 'spa', businessArticle: 'el',
      staff: 'especialista', staffPlural: 'especialistas', staffArticle: 'el',
      service: 'tratamiento', servicePlural: 'tratamientos',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en cabina ahora', walkIn: 'sin cita'
    },
    unas: {
      label: 'Uñas / nail bar', icon: 'sparkles',
      business: 'nail bar', businessArticle: 'el',
      staff: 'manicurista', staffPlural: 'manicuristas', staffArticle: 'la',
      service: 'servicio', servicePlural: 'servicios',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'atendiendo ahora', walkIn: 'sin cita'
    },
    consultorio: {
      label: 'Consultorio médico', icon: 'stethoscope',
      business: 'consultorio', businessArticle: 'el',
      staff: 'doctor', staffPlural: 'doctores', staffArticle: 'el',
      service: 'consulta', servicePlural: 'consultas',
      client: 'paciente', clientPlural: 'pacientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en consulta ahora', walkIn: 'sin cita'
    },
    dental: {
      label: 'Clínica dental', icon: 'tooth',
      business: 'clínica', businessArticle: 'la',
      staff: 'odontólogo', staffPlural: 'odontólogos', staffArticle: 'el',
      service: 'tratamiento', servicePlural: 'tratamientos',
      client: 'paciente', clientPlural: 'pacientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en consulta ahora', walkIn: 'sin cita'
    },
    psicologia: {
      label: 'Psicología y terapia', icon: 'heart',
      business: 'consultorio', businessArticle: 'el',
      staff: 'terapeuta', staffPlural: 'terapeutas', staffArticle: 'el',
      service: 'sesión', servicePlural: 'sesiones',
      client: 'paciente', clientPlural: 'pacientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en sesión ahora', walkIn: 'sin cita'
    },
    veterinaria: {
      label: 'Veterinaria', icon: 'paw',
      business: 'veterinaria', businessArticle: 'la',
      staff: 'veterinario', staffPlural: 'veterinarios', staffArticle: 'el',
      service: 'servicio', servicePlural: 'servicios',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en consulta ahora', walkIn: 'sin cita'
    },
    tatuajes: {
      label: 'Estudio de tatuajes', icon: 'needle',
      business: 'estudio', businessArticle: 'el',
      staff: 'tatuador', staffPlural: 'tatuadores', staffArticle: 'el',
      service: 'servicio', servicePlural: 'servicios',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'en sesión ahora', walkIn: 'sin cita'
    },
    fitness: {
      label: 'Entrenador / estudio fitness', icon: 'dumbbell',
      business: 'estudio', businessArticle: 'el',
      staff: 'entrenador', staffPlural: 'entrenadores', staffArticle: 'el',
      service: 'sesión', servicePlural: 'sesiones',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'entrenando ahora', walkIn: 'sin cita'
    },
    otro: {
      label: 'Otro', icon: 'calendar',
      business: 'negocio', businessArticle: 'el',
      staff: 'profesional', staffPlural: 'profesionales', staffArticle: 'el',
      service: 'servicio', servicePlural: 'servicios',
      client: 'cliente', clientPlural: 'clientes',
      appointment: 'cita', appointmentPlural: 'citas',
      inService: 'atendiendo ahora', walkIn: 'sin cita'
    }
  };

  /* Orden para selectores (Configuración del CRM, consola) */
  const TYPES = ['barberia', 'salon', 'spa', 'unas', 'consultorio', 'dental',
    'psicologia', 'veterinaria', 'tatuajes', 'fitness', 'otro'];

  /* Claves que el negocio puede sobrescribir en tenants.labels
     (la misma lista valida la base de datos en la migración 11) */
  const KEYS = ['business', 'businessArticle', 'staff', 'staffPlural', 'staffArticle',
    'service', 'servicePlural', 'client', 'clientPlural', 'appointment',
    'appointmentPlural', 'inService', 'walkIn'];

  const DEFAULT_TYPE = 'barberia';

  /* ---------------- Íconos del rubro (SVG inline, trazo 24x24) ---------------- */
  const ICONS = {
    scissors: '<circle cx="6" cy="6" r="3"/><path d="M8.12 8.12 12 12"/><path d="M20 4 8.12 15.88"/><circle cx="6" cy="18" r="3"/><path d="M14.8 14.8 20 20"/>',
    comb: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10"/><path d="M8 9v8"/><path d="M11 9v10"/><path d="M14 9v8"/><path d="M17 9v10"/><path d="M20 9v8"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    sparkles: '<path d="M9.94 15.5A2 2 0 0 0 8.5 14.06l-6.14-1.58a.5.5 0 0 1 0-.96L8.5 9.94A2 2 0 0 0 9.94 8.5l1.58-6.14a.5.5 0 0 1 .96 0L14.06 8.5A2 2 0 0 0 15.5 9.94l6.14 1.58a.5.5 0 0 1 0 .96L15.5 14.06a2 2 0 0 0-1.44 1.44l-1.58 6.14a.5.5 0 0 1-.96 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    stethoscope: '<path d="M4.8 2.3A.3.3 0 1 0 5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 6 6 6 6 0 0 0 6-6V4a2 2 0 0 0-2-2h-1a.2.2 0 1 0 .3.3"/><path d="M8 15v1a6 6 0 0 0 6 6 6 6 0 0 0 6-6v-4"/><circle cx="20" cy="10" r="2"/>',
    tooth: '<path d="M7 3c-2.5 0-4 2-4 4.5 0 2 .8 3.4 1.5 4.6.6 1.1.9 2.5 1.1 4.2L6 20c.2 1.2 1.8 1.3 2.2.1l1.2-4c.3-1 1.1-1.6 2.6-1.6s2.3.6 2.6 1.6l1.2 4c.4 1.2 2 1.1 2.2-.1l.4-3.7c.2-1.7.5-3.1 1.1-4.2.7-1.2 1.5-2.6 1.5-4.6C21 5 19.5 3 17 3c-1.8 0-3 1-5 1S8.8 3 7 3Z"/>',
    heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    paw: '<circle cx="11" cy="4" r="2"/><circle cx="18" cy="8" r="2"/><circle cx="20" cy="16" r="2"/><path d="M9 10a5 5 0 0 1 5 5v3.5a3.5 3.5 0 0 1-6.84 1.045Q6.52 17.48 4.46 16.84A3.5 3.5 0 0 1 5.5 10Z"/>',
    needle: '<path d="m18 2 4 4"/><path d="m17 7 3-3"/><path d="M19 9 8.7 19.3c-1 1-2.5 1-3.4 0l-.6-.6c-1-1-1-2.5 0-3.4L15 5"/><path d="m9 11 4 4"/><path d="m5 19-3 3"/><path d="m14 4 6 6"/>',
    dumbbell: '<path d="M14.4 14.4 9.6 9.6"/><path d="M18.657 21.485a2 2 0 1 1-2.829-2.828l-1.767 1.768a2 2 0 1 1-2.829-2.829l6.364-6.364a2 2 0 1 1 2.829 2.829l-1.768 1.767a2 2 0 1 1 2.828 2.829z"/><path d="m21.5 21.5-1.4-1.4"/><path d="M3.9 3.9 2.5 2.5"/><path d="M6.404 12.768a2 2 0 1 1-2.829-2.829l1.768-1.767a2 2 0 1 1-2.828-2.829l2.828-2.828a2 2 0 1 1 2.829 2.828l1.767-1.768a2 2 0 1 1 2.829 2.829z"/>',
    calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>'
  };

  /* ---------------- Estado activo ---------------- */
  let activeType = DEFAULT_TYPE;
  let active = Object.assign({}, PRESETS[DEFAULT_TYPE]);

  function normType(t) {
    const k = String(t || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRESETS, k) ? k : null;
  }

  /* Solo se aceptan claves conocidas con texto 1..40 sin < > " (igual que la BD) */
  function cleanLabels(labels) {
    const out = {};
    if (!labels || typeof labels !== 'object' || Array.isArray(labels)) return out;
    KEYS.forEach(k => {
      const v = labels[k];
      if (typeof v !== 'string') return;
      const s = v.trim();
      if (s.length < 1 || s.length > 40 || /[<>"]/.test(s)) return;
      out[k] = s;
    });
    return out;
  }

  function cap(s) {
    s = String(s == null ? '' : s);
    return s ? s.charAt(0).toLocaleUpperCase('es-PE') + s.slice(1) : s;
  }

  function lookup(key) {
    if (Object.prototype.hasOwnProperty.call(active, key)) return String(active[key]);
    return null;
  }

  /* ---------------- API pública ---------------- */
  const Vocab = {
    PRESETS: PRESETS,
    TYPES: TYPES,
    KEYS: KEYS,
    DEFAULT_TYPE: DEFAULT_TYPE,
    ICONS: ICONS,

    /* Fija el vocabulario a partir del negocio. Acepta businessType/business_type
       y labels (objeto o texto JSON). Sin dato: preset 'barberia' (compatibilidad). */
    set(tenant) {
      tenant = tenant || {};
      const type = normType(tenant.businessType != null ? tenant.businessType : tenant.business_type) || DEFAULT_TYPE;
      let labels = tenant.labels;
      if (typeof labels === 'string') { try { labels = JSON.parse(labels); } catch (e) { labels = null; } }
      activeType = type;
      active = Object.assign({}, PRESETS[type], cleanLabels(labels));
      try { if (global.document && global.document.documentElement) global.document.documentElement.setAttribute('data-rubro', type); } catch (e) { /* sin DOM */ }
      return Vocab;
    },

    type() { return activeType; },
    label(type) { const p = PRESETS[normType(type) || activeType]; return p ? p.label : ''; },
    preset(type) { return Object.assign({}, PRESETS[normType(type) || DEFAULT_TYPE]); },
    current() { return Object.assign({}, active); },

    /* Palabra tal cual (minúscula, salvo que el negocio la haya escrito distinto) */
    t(key) {
      const v = lookup(key);
      return v == null ? String(key) : v;
    },

    /* Palabra con mayúscula inicial */
    T(key) { return cap(Vocab.t(key)); },

    /* Clave con mayúscula inicial ("Staff") = palabra capitalizada */
    word(key) {
      key = String(key || '');
      if (lookup(key) != null) return Vocab.t(key);
      const low = key.charAt(0).toLowerCase() + key.slice(1);
      if (key !== low && lookup(low) != null) return Vocab.T(low);
      return null;
    },

    /* 'Elige tu {staff}' → 'Elige tu barbero'; {Staff} → 'Barbero'.
       Las llaves desconocidas se dejan intactas. */
    fmt(str) {
      return String(str == null ? '' : str).replace(/\{([A-Za-z]+)\}/g, (m, k) => {
        const w = Vocab.word(k);
        return w == null ? m : w;
      });
    },

    /* Ícono del rubro como <svg>, mismo formato que ic() de js/utils/icons.js */
    icon(extraClass, type) {
      const name = (PRESETS[normType(type) || activeType] || PRESETS.otro).icon;
      const p = ICONS[name] || ICONS.calendar;
      return '<svg class="ic' + (extraClass ? ' ' + extraClass : '') + '" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + p + '</svg>';
    },

    /* Reemplaza textos marcados:
         <span data-v="staff"></span>        → barbero
         <span data-v="Staff"></span>        → Barbero
         <h2 data-v-fmt="Elige tu {staff}">  → plantilla con fmt()
         <input data-v-attr="placeholder:client;title:Staff">
         <span data-v-icon></span>           → ícono del rubro */
    apply(root) {
      root = root || (global.document || null);
      if (!root || typeof root.querySelectorAll !== 'function') return;
      root.querySelectorAll('[data-v]').forEach(el => {
        const w = Vocab.word(el.getAttribute('data-v'));
        if (w != null) el.textContent = w;
      });
      root.querySelectorAll('[data-v-fmt]').forEach(el => {
        el.textContent = Vocab.fmt(el.getAttribute('data-v-fmt'));
      });
      root.querySelectorAll('[data-v-attr]').forEach(el => {
        String(el.getAttribute('data-v-attr') || '').split(';').forEach(pair => {
          const i = pair.indexOf(':');
          if (i < 1) return;
          const attr = pair.slice(0, i).trim();
          const spec = pair.slice(i + 1).trim();
          if (!attr || !spec) return;
          /* Si trae llaves es plantilla; si no, es una clave suelta */
          const val = spec.indexOf('{') >= 0 ? Vocab.fmt(spec) : Vocab.word(spec);
          if (val != null) el.setAttribute(attr, val);
        });
      });
      root.querySelectorAll('[data-v-icon]').forEach(el => {
        el.innerHTML = Vocab.icon(el.getAttribute('data-v-icon') || '');
      });
    }
  };

  global.Vocab = Vocab;
})(typeof window !== 'undefined' ? window : globalThis);
