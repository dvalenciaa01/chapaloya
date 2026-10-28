/* ==========================================================================
   Capa de datos · Supabase (producción)
   --------------------------------------------------------------------------
   Mantiene la MISMA forma de datos que la demo para que las pantallas no
   cambien:
     DB.root  = { tenants[], users[], data{ [tenantId]: state }, audit[] }
     DB.state = datos de la barbería ACTIVA (barberProfiles, services,
                customers, appointments, walkIns, settings)
     DB.tenant = barbería activa
   Diferencias con la demo:
     - Se carga desde Supabase al abrir la página (DB.init / initConsole /
       initPublic son asíncronos).
     - DB.save() / DB.persist() envían a Supabase SOLO lo que cambió
       (comparando con la última copia recibida). Si el servidor rechaza un
       cambio (horario ocupado, sin permiso…), se avisa y se recargan los datos.
       DB.save() devuelve una promesa con true (guardado) o false (rechazado):
       las pantallas muestran "guardado" solo con true.
     - Guardar y recargar van en UNA sola cola (_chain): una recarga nunca
       pisa un guardado en curso, y la recarga en tiempo real se aplaza (no se
       descarta) mientras hay cambios por enviar.
     - Los borrados NO se deducen comparando copias: solo se borra lo que una
       acción pidió explícitamente con DB.markDeleted().
     - Las reglas de seguridad viven en la base de datos (RLS y triggers),
       no aquí: este archivo solo organiza los datos para la interfaz.
   ========================================================================== */
const DB = {
  PUBLIC_SLUG_KEY: 'BARBERSUITE_PUBLIC_SLUG',
  ACTIVE_TENANT_KEY: 'RESERVALOPE_ACTIVE_TENANT',
  PREFS_KEY: 'RESERVALOPE_PREFS',
  KEY: 'RESERVALOPE_PREFS',          // compatibilidad con código antiguo
  LEGACY_KEY: 'BARBERSUITE_DEMO_V1',  // datos de la demo (ya no se usan)
  AUDIT_MAX: 3000,
  PAGE: 1000,                         // Supabase devuelve como máximo 1000 filas por consulta

  root: null,
  state: null,
  tenant: null,
  mode: null,          // 'crm' | 'console' | 'public'
  sb: null,
  onReload: null,      // la página define qué volver a pintar tras recargar
  _snap: {},           // última copia recibida del servidor, por barbería
  _snapTenants: new Map(),
  _knownBarbers: {},   // barberos (incluidos inactivos) por barbería: nombre ↔ id
  _knownServices: {},  // servicios (incluidos ocultos) por barbería: nombre ↔ id
  _chain: Promise.resolve(),
  _pending: false,
  _pendingPromise: null,
  _syncing: false,
  _lastSyncOk: true,
  _lastWrite: 0,
  _gen: 0,             // generación de la copia del servidor (cambia en cada recarga)
  _deletes: {},        // borrados pedidos explícitamente: { [tenantId]: { [colección]: Set(ids) } }
  _sessionLost: false,

  DEFAULT_SLOTS: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'],
  TIME_SLOTS: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'],

  // Horario semanal que recibe cada barbería (igual que private.default_schedule() en la migración 6).
  // week: 0 = domingo … 6 = sábado; cada día es una lista de tramos [desde, hasta]; [] = cerrado.
  DEFAULT_SCHEDULE: {
    interval: 30, maxDays: 60,
    week: { 0: [['09:00', '13:00'], ['14:00', '20:30']], 1: [['09:00', '13:00'], ['14:00', '20:30']],
            2: [['09:00', '13:00'], ['14:00', '20:30']], 3: [['09:00', '13:00'], ['14:00', '20:30']],
            4: [['09:00', '13:00'], ['14:00', '20:30']], 5: [['09:00', '13:00'], ['14:00', '20:30']],
            6: [['09:00', '13:00'], ['14:00', '20:30']] }
  },
  INTERVALS: [10, 15, 20, 30, 45, 60, 90, 120],
  DAY_NAMES: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],

  PLANS: {
    BASICO: { label: 'Básico', fee: 79 },
    PRO: { label: 'Pro', fee: 149 },
    PREMIUM: { label: 'Premium', fee: 249 }
  },

  DEFAULT_PALETTE: { primary: '#000000', secondary: '#D79848', tertiary: '#FFFFFF' },

  /* ---------------- Fecha y hora de la BARBERÍA ----------------
     "Hoy" y "ahora" se calculan en la zona horaria de la barbería
     (DB.tenant.timezone; por defecto America/Lima), no en la del aparato
     del cliente: un turista con el celular en hora de Madrid ve los mismos
     horarios que alguien en Lima.
     En la web pública, además, se corrige el reloj del aparato con la hora
     del servidor (web_barberia.server_now): _clockOffset = servidor − aparato. */
  DEFAULT_TZ: 'America/Lima',
  _clockOffset: 0,
  _tzFmt: {},
  timeZone() {
    const tz = (this.tenant && this.tenant.timezone) || this.DEFAULT_TZ;
    return this._fmtFor(tz) ? tz : this.DEFAULT_TZ;
  },
  _fmtFor(tz) {
    if (this._tzFmt[tz] !== undefined) return this._tzFmt[tz];
    let f = null;
    try {
      f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    } catch (e) { f = null; } // zona no válida → se usa America/Lima
    this._tzFmt[tz] = f;
    return f;
  },
  // Partes de la fecha/hora actual en la zona de la barbería: { date: 'AAAA-MM-DD', h, m }
  nowParts() {
    const now = new Date(Date.now() + (this._clockOffset || 0));
    const f = this._fmtFor(this.timeZone());
    if (!f) {
      return { date: now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0'),
        h: now.getHours(), m: now.getMinutes() };
    }
    const p = {};
    f.formatToParts(now).forEach(x => { p[x.type] = x.value; });
    return { date: p.year + '-' + p.month + '-' + p.day, h: parseInt(p.hour, 10) % 24, m: parseInt(p.minute, 10) };
  },
  todayISO() { return this.nowParts().date; },
  nowTimeStr() {
    const n = this.nowParts();
    return String(n.h).padStart(2, '0') + ':' + String(n.m).padStart(2, '0');
  },
  uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
    return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
  },
  isUuid(v) { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '')); },
  slugify(text) {
    return String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
  },
  addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  hhmm(t) { return t ? String(t).slice(0, 5) : ''; },
  // Campos propios (extra jsonb): objeto plano con las claves en orden (para comparar copias)
  normExtra(v) {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out = {};
    Object.keys(v).sort().forEach(k => { const x = v[k]; if (x !== null && x !== undefined && x !== '') out[k] = x; });
    return out;
  },
  cleanPhone(p) { const d = String(p || '').replace(/\D/g, ''); return /^[0-9]{9,15}$/.test(d) ? d : null; },

  /* ---------------- Cliente de Supabase ---------------- */
  client() {
    if (this.sb) return this.sb;
    const c = window.RESERVALOPE_CONFIG || {};
    if (!window.supabase || !c.supabaseUrl || !c.supabaseKey) {
      throw new Error('Falta la configuración de Supabase (js/config.js).');
    }
    this.sb = window.supabase.createClient(c.supabaseUrl, c.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'reservalope-auth' }
    });
    return this.sb;
  },

  /* Texto con las palabras del rubro (js/core/vocab.js). En el CRM usa UI.v
     (con concordancia); en la web pública, Vocab.fmt; sin Vocab, genérico. */
  vt(str) {
    if (typeof UI !== 'undefined' && UI.v) return UI.v(str);
    const hasV = typeof Vocab !== 'undefined';
    const s = String(str).replace(/\{(\w+):\w+\}/g, (m, f) => ({ o: 'o', os: 'os', el: 'el', El: 'El', del: 'del', al: 'al', un: 'un', Un: 'Un', este: 'este', Este: 'Este' }[f] || ''))
      .replace(/\{([Ii])nServiceShort\}/g, (m, c) => {
        const w = hasV ? Vocab.t('inService').replace(/\s+ahora$/i, '') : 'en atención';
        return c === 'I' ? w.charAt(0).toUpperCase() + w.slice(1) : w;
      });
    if (hasV) return Vocab.fmt(s);
    return s.replace(/\{(\w+)\}/g, '$1');
  },

  // Mensaje entendible para un error de Supabase
  errorText(err) {
    const m = String((err && (err.message || err.error_description || err.error)) || err || '');
    // Reglas del servidor (citas, clientes, WhatsApp): ya vienen redactadas en español
    const code = err && err.code;
    if ((code === '22023' || code === 'P0001' || code === '23505') && m && !/duplicate key|violates|constraint/i.test(m)) return m;
    if (/row-level security|permission denied|42501/i.test(m)) return 'No tienes permiso para guardar este cambio.';
    if (/customers_tenant_id_phone_key/i.test(m)) return this.vt('Ya existe {un:client} {client} con ese celular.');
    if (/schedule_exceptions_tenant_id_barber_id_date_key/i.test(m)) return 'Ya hay una fecha especial para ese día.';
    if (/schedule_valid|ranges_check/i.test(m)) return 'El horario no es válido: revisa que cada tramo empiece antes de terminar.';
    if (/appointments_no_double_booking/i.test(m)) return 'Ese horario ya está ocupado. Elige otro.';
    if (/duplicate key/i.test(m)) return 'Ese registro ya existe.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    if (/JWT|token|session/i.test(m)) return 'Tu sesión expiró. Vuelve a ingresar.';
    return m || 'No se pudo guardar el cambio.';
  },

  // ¿El error indica que la sesión ya no vale (token vencido, 401)?
  isAuthError(err) {
    if (!err) return false;
    const st = Number(err.status || err.statusCode || (err.context && err.context.status) || 0);
    if (st === 401) return true;
    if (err.code === 'PGRST301' || err.code === 'PGRST302') return true;
    const m = String(err.message || err.error_description || err.error || err || '');
    return /JWT expired|jwt|invalid claim|not authenticated|Auth session missing|refresh token/i.test(m);
  },

  // Sesión perdida (token vencido, usuario desactivado, barbería suspendida…):
  // se cierra la sesión y el login muestra el aviso según el código.
  // Códigos: expired · idle · inactive · noprofile · temp · suspended · noaccess · logout
  sessionLost(code) {
    if (this._sessionLost) return;
    this._sessionLost = true;
    console.warn('[DB] Sesión cerrada:', code);
    if (typeof Auth !== 'undefined' && Auth.logout) Auth.logout(code || 'expired');
  },

  /* ---------------- Preferencias locales (no son datos del negocio) ---------------- */
  pref(key, value) {
    let all = {};
    try { all = JSON.parse(localStorage.getItem(this.PREFS_KEY) || '{}') || {}; } catch (e) { all = {}; }
    if (value === undefined) return all[key];
    all[key] = value;
    try { localStorage.setItem(this.PREFS_KEY, JSON.stringify(all)); } catch (e) { /* sin almacenamiento */ }
    return value;
  },

  /* ==================================================================
     CONVERSIÓN fila de Supabase ↔ objeto de la interfaz
     ================================================================== */
  fromTenant(r) {
    const palette = Object.assign({}, this.DEFAULT_PALETTE, r.palette || {});
    return {
      id: r.id, slug: r.slug, name: r.name,
      ownerName: r.owner_name || '', ownerEmail: r.owner_email || '', ownerPhone: r.owner_phone || '',
      logo: r.logo_url || '', palette, accent: palette.secondary,
      address: r.address || '', phone: r.phone || '', hours: r.hours || '', city: r.city || '',
      currency: r.currency || 'S/', timezone: r.timezone || 'America/Lima',
      timeSlots: Array.isArray(r.time_slots) && r.time_slots.length ? r.time_slots.map(x => this.hhmm(x)) : this.DEFAULT_SLOTS.slice(),
      schedule: this.normSchedule(r.schedule),
      plan: r.plan || 'PRO', planFee: r.plan_fee == null ? 0 : Number(r.plan_fee),
      subscriptionEnd: r.subscription_end || '', status: r.status || 'ACTIVE',
      createdAt: r.created_at, whatsapp: r.whatsapp || null,
      // Rubro (migración 11): define las palabras visibles. Sin dato = barbería.
      businessType: r.business_type || 'barberia',
      labels: (r.labels && typeof r.labels === 'object' && !Array.isArray(r.labels)) ? r.labels : {}
    };
  },
  // Datos de la barbería que solo usa el CRM / la consola (fromTenant es compartido con la web pública)
  fromTenantCrm(r) {
    const t = this.fromTenant(r);
    const lead = parseInt(r.booking_lead_minutes, 10);
    t.leadMinutes = isNaN(lead) ? 15 : Math.min(1440, Math.max(0, lead));
    // CRM personalizable (migración 12): lo edita solo el superadministrador desde la consola.
    // No va en tenantRow: se guarda aparte (Reservalope.saveCrmConfig), nunca con DB.save().
    t.crmConfig = (r.crm_config && typeof r.crm_config === 'object' && !Array.isArray(r.crm_config)) ? r.crm_config : {};
    // Vista de la pestaña Citas (migración 14). Sin la columna, la elección queda en este navegador.
    t.hasApptView = 'appt_view' in r;
    t.apptView = r.appt_view === 'lista' ? 'lista' : 'agenda';
    return t;
  },
  tenantRow(t) {
    const row = this.tenantRowBase(t);
    if (t.leadMinutes != null && !isNaN(Number(t.leadMinutes))) row.booking_lead_minutes = Math.min(1440, Math.max(0, Math.round(Number(t.leadMinutes))));
    if (t.hasApptView) row.appt_view = t.apptView === 'lista' ? 'lista' : 'agenda';
    return row;
  },
  tenantRowBase(t) {
    return {
      slug: t.slug, name: t.name, owner_name: t.ownerName || '', owner_email: t.ownerEmail || '',
      owner_phone: t.ownerPhone || '', logo_url: t.logo || null,
      palette: t.palette || this.DEFAULT_PALETTE, address: t.address || '', phone: t.phone || '',
      hours: t.hours || '', city: t.city || '', currency: t.currency || 'S/',
      plan: t.plan || 'PRO', plan_fee: Number(t.planFee) || 0, subscription_end: t.subscriptionEnd || null,
      status: t.status || 'ACTIVE', schedule: this.normSchedule(t.schedule),
      business_type: t.businessType || 'barberia', labels: t.labels || {}
    };
  },
  fromProfile(r) {
    return {
      id: r.id, email: r.email, name: r.name || r.email, role: r.role,
      tenantId: r.tenant_id || null, barberId: r.barber_id || null,
      grants: r.role === 'ADMIN' ? (r.grants || {}) : null,
      active: !!r.active, mustChangePassword: !!r.must_change_password,
      lastLoginAt: r.last_login_at || null, createdAt: r.created_at,
      failedAttempts: 0, lockedUntil: 0
    };
  },
  fromAudit(r) {
    const t = r.tenant_id ? this.tenantById(r.tenant_id) : null;
    return {
      id: r.id, ts: r.ts, tenantId: r.tenant_id, tenantName: t ? t.name : '—',
      userId: r.user_id, userName: r.user_name, role: r.role, action: r.action, detail: r.detail || ''
    };
  },

  // Cada colección: tabla, cómo leerla y cómo compararla/escribirla.
  // "logical" = campos que se comparan; "columns" = cómo se escriben esos campos.
  SPECS: {
    barbers: {
      table: 'barbers', soft: true,
      from(r, works) {
        return { id: r.id, name: r.name, role: r.role_title || '', photo: r.photo_url || '',
          specialties: r.specialties || [], works: works || [], schedule: DB.normWeek(r.schedule) };
      },
      logical(b) { return { name: b.name, role: b.role || '', photo: b.photo || '', specialties: b.specialties || [], schedule: b.schedule ? { week: DB.normWeek(b.schedule).week } : null }; },
      columns(l) {
        const c = {};
        if ('name' in l) c.name = l.name;
        if ('role' in l) c.role_title = l.role;
        if ('photo' in l) c.photo_url = l.photo || null;
        if ('specialties' in l) c.specialties = l.specialties;
        if ('schedule' in l) c.schedule = l.schedule;
        return c;
      }
    },
    // Fechas especiales: feriados, días con otro horario o el día libre de un barbero
    exceptions: {
      table: 'schedule_exceptions',
      from(r) { return { id: r.id, barberId: r.barber_id || null, date: r.date, ranges: DB.normRanges(r.ranges), note: r.note || '' }; },
      logical(e) { return { barberId: e.barberId || null, date: e.date, ranges: DB.normRanges(e.ranges), note: e.note || '' }; },
      columns(l) {
        const c = {};
        if ('barberId' in l) c.barber_id = l.barberId;
        if ('date' in l) c.date = l.date;
        if ('ranges' in l) c.ranges = l.ranges;
        if ('note' in l) c.note = l.note;
        return c;
      }
    },
    works: {
      table: 'barber_works',
      from(r) { return { id: r.id, title: r.title || '', image: r.image_url }; },
      logical(w) { return { title: w.title || '', image: w.image || '', barberId: w._barberId }; },
      columns(l) {
        const c = {};
        if ('title' in l) c.title = l.title;
        if ('image' in l) c.image_url = l.image;
        if ('barberId' in l) c.barber_id = l.barberId;
        return c;
      }
    },
    services: {
      table: 'services', soft: true,
      from(r) { return { id: r.id, name: r.name, category: r.category || '', price: Number(r.price), duration: r.duration_min, desc: r.description || '', featured: !!r.featured }; },
      logical(s) { return { name: s.name, category: s.category || '', price: Number(s.price) || 0, duration: Number(s.duration) || 30, desc: s.desc || '', featured: !!s.featured }; },
      columns(l) {
        const c = {};
        if ('name' in l) c.name = l.name;
        if ('category' in l) c.category = l.category;
        if ('price' in l) c.price = l.price;
        if ('duration' in l) c.duration_min = l.duration;
        if ('desc' in l) c.description = l.desc;
        if ('featured' in l) c.featured = l.featured;
        return c;
      }
    },
    // email, birthdate, document, address y extra: migración 12 (CRM personalizable)
    customers: {
      table: 'customers',
      from(r) {
        return { id: r.id, name: r.name, phone: r.phone || '—', notes: r.notes || '',
          email: r.email || '', birthdate: r.birthdate || '', document: r.document || '', address: r.address || '',
          extra: DB.normExtra(r.extra) };
      },
      logical(c) {
        return { name: c.name, phone: DB.cleanPhone(c.phone), notes: c.notes || '',
          email: c.email || null, birthdate: c.birthdate || null, document: c.document || null, address: c.address || null,
          extra: DB.normExtra(c.extra) };
      },
      columns(l) { return Object.assign({}, l); }
    },
    appointments: {
      table: 'appointments',
      from(r) {
        return { id: r.id, code: r.code, customerName: r.customer_name, phone: r.phone || '',
          service: r.service_name, serviceId: r.service_id || null, barber: r.barber_name, barberId: r.barber_id || null,
          date: r.date, time: DB.hhmm(r.time),
          price: Number(r.price), status: r.status, source: r.source, notes: r.notes || '',
          waOptIn: !!r.wa_opt_in, createdAt: r.created_at, completedAt: r.completed_at,
          durationMin: r.duration_min != null ? Number(r.duration_min) : undefined,
          extra: DB.normExtra(r.extra) };
      },
      // Barbero y servicio se comparan y guardan por id (los nombres los pone el servidor)
      logical(a) {
        return { customerName: a.customerName, phone: DB.cleanPhone(a.phone), serviceId: a.serviceId || null,
          service: a.service || '', barberId: a.barberId || null, date: a.date, time: DB.hhmm(a.time), price: Number(a.price) || 0,
          status: a.status, notes: a.notes || '', waOptIn: !!a.waOptIn, extra: DB.normExtra(a.extra) };
      },
      columns(l) {
        const c = {};
        if ('customerName' in l) c.customer_name = l.customerName;
        if ('phone' in l) c.phone = l.phone;
        if ('serviceId' in l) c.service_id = l.serviceId;
        if ('service' in l) c.service_name = l.service;
        if ('barberId' in l) c.barber_id = l.barberId;
        if ('date' in l) c.date = l.date;
        if ('time' in l) c.time = l.time;
        if ('price' in l) c.price = l.price;
        if ('status' in l) c.status = l.status;
        if ('notes' in l) c.notes = l.notes;
        if ('waOptIn' in l) c.wa_opt_in = l.waOptIn;
        if ('extra' in l) c.extra = l.extra;
        return c;
      },
      insertExtra(a, tid) {
        let custId = DB.isUuid(a.customerId) ? a.customerId : null;
        if (!custId) {
          const phone = DB.cleanPhone(a.phone);
          const st = DB.root.data[tid];
          const cust = phone && st ? st.customers.find(c => DB.cleanPhone(c.phone) === phone && DB.isUuid(c.id)) : null;
          custId = cust ? cust.id : null;
        }
        return { source: a.source === 'WEB' ? 'WEB' : 'CRM', customer_id: custId };
      }
    },
    walkins: {
      table: 'walk_ins',
      from(r) {
        return { id: r.id, customerName: r.customer_name, service: r.service_name, serviceId: r.service_id || null,
          barber: r.barber_name, barberId: r.barber_id || null,
          price: Number(r.price), status: r.status, date: r.date, addedAt: DB.hhmm(r.added_at),
          finishedAt: r.finished_at, notes: r.notes || '' };
      },
      logical(w) {
        return { customerName: w.customerName, serviceId: w.serviceId || null, service: w.service || '',
          barberId: w.barberId || null, barber: w.barber || '',
          price: Number(w.price) || 0, status: w.status, date: w.date || DB.todayISO(),
          addedAt: /^\d{2}:\d{2}$/.test(w.addedAt || '') ? w.addedAt : null, finishedAt: w.finishedAt || null, notes: w.notes || '' };
      },
      columns(l) {
        const c = {};
        if ('customerName' in l) c.customer_name = l.customerName;
        if ('serviceId' in l) c.service_id = l.serviceId;
        if ('service' in l) c.service_name = l.service;
        if ('barberId' in l) c.barber_id = l.barberId;
        if ('barber' in l) c.barber_name = l.barber;
        if ('price' in l) c.price = l.price;
        if ('status' in l) c.status = l.status;
        if ('date' in l) c.date = l.date;
        if ('addedAt' in l && l.addedAt) c.added_at = l.addedAt;
        if ('finishedAt' in l) c.finished_at = l.finishedAt;
        if ('notes' in l) c.notes = l.notes;
        return c;
      }
    }
  },
  ORDER: ['barbers', 'works', 'exceptions', 'services', 'customers', 'appointments', 'walkins'],

  barberIdByName(tid, name) {
    const st = this.root.data[tid];
    const live = st ? st.barberProfiles.find(b => b.name === name) : null;
    if (live) return live.id;
    const k = (this._knownBarbers[tid] || []).find(b => b.name === name);
    return k ? k.id : null;
  },
  serviceIdByName(tid, name) {
    const st = this.root.data[tid];
    const live = st ? st.services.find(s => s.name === name) : null;
    if (live) return live.id;
    const k = (this._knownServices[tid] || []).find(s => s.name === name);
    return k ? k.id : null;
  },

  /* ==================================================================
     LECTURA
     ================================================================== */
  // Lee todas las filas (en páginas de 1000) de una tabla, filtrando por barbería
  async fetchRows(table, tenantIds, opts) {
    const o = opts || {};
    const out = [];
    for (let from = 0; ; from += this.PAGE) {
      let q = this.client().from(table).select(o.select || '*');
      if (tenantIds) q = q.in('tenant_id', tenantIds);
      if (o.filter) q = o.filter(q);
      q = q.order(o.order || 'id', { ascending: o.asc !== false }).range(from, from + this.PAGE - 1);
      const { data, error } = await q;
      if (error) throw error;
      out.push(...data);
      if (data.length < this.PAGE || (o.max && out.length >= o.max)) break;
    }
    return o.max ? out.slice(0, o.max) : out;
  },

  emptyState(t) {
    return {
      settings: { shopName: t.name, ownerName: t.ownerName, currency: t.currency || 'S/', showQuickStart: this.pref('quick:' + t.id) !== false },
      barberProfiles: [], services: [], customers: [], appointments: [], walkIns: [],
      scheduleExceptions: []
    };
  },

  // Carga barberías, usuarios, datos de cada barbería e historial que el usuario puede ver
  async loadAll() {
    const sb = this.client();
    const [tRes, pRes] = await Promise.all([
      sb.from('tenants').select('*').order('created_at'),
      sb.from('profiles').select('*').order('created_at')
    ]);
    if (tRes.error) throw tRes.error;
    if (pRes.error) throw pRes.error;
    // Todo se arma en una copia nueva y se cambia de una sola vez al final:
    // mientras llegan los datos, la pantalla sigue usando la copia anterior.
    const root = { tenants: tRes.data.map(r => this.fromTenantCrm(r)), users: pRes.data.map(r => this.fromProfile(r)), data: {}, audit: [] };
    const snaps = {};
    const ids = root.tenants.map(t => t.id);
    root.tenants.forEach(t => { root.data[t.id] = this.emptyState(t); snaps[t.id] = this.emptySnap(); });
    if (ids.length) await this.loadTenantData(ids, root, snaps);
    root.audit = await this.loadAudit(root);
    this.root = root;
    this._snap = snaps;
    this._snapTenants = new Map(root.tenants.map(t => [t.id, JSON.stringify(this.tenantRow(t))]));
    this._deletes = {};
    this._gen++;
    if (this.tenant) this.useTenant(this.tenant.id);
    return root;
  },

  emptySnap() { const s = {}; this.ORDER.forEach(k => { s[k] = new Map(); }); return s; },

  async loadTenantData(ids, root, snaps) {
    const today = this.todayISO();
    const [barbers, works, services, customers, appts, walks, excs] = await Promise.all([
      this.fetchRows('barbers', ids),
      this.fetchRows('barber_works', ids, { order: 'created_at', asc: false }),
      this.fetchRows('services', ids, { order: 'sort' }),
      this.fetchRows('customers', ids, { order: 'created_at', asc: false }),
      this.fetchRows('appointments', ids, { order: 'starts_at', asc: false }),
      this.fetchRows('walk_ins', ids, { order: 'created_at', asc: false }),
      // Si aún no se ejecutó la migración 6, la página sigue funcionando sin fechas especiales
      this.fetchRows('schedule_exceptions', ids, { order: 'date', filter: q => q.gte('date', today) })
        .catch(e => { console.warn('[DB] Fechas especiales no disponibles (¿falta la migración 6?)', e); return []; })
    ]);
    const S = this.SPECS;
    ids.forEach(tid => {
      const t = root.tenants.find(x => x.id === tid);
      if (!t) return;
      const st = root.data[tid] || this.emptyState(t);
      const mine = (rows) => rows.filter(r => r.tenant_id === tid);
      const tb = mine(barbers).sort((a, b) => (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)));
      const tw = mine(works);
      const ts = mine(services).sort((a, b) => (a.sort - b.sort) || String(a.created_at).localeCompare(String(b.created_at)));
      this._knownBarbers[tid] = tb.map(b => ({ id: b.id, name: b.name }));
      this._knownServices[tid] = ts.map(s => ({ id: s.id, name: s.name }));
      st.barberProfiles = tb.filter(b => b.active).map(b => S.barbers.from(b, tw.filter(w => w.barber_id === b.id).map(w => S.works.from(w))));
      st.services = ts.filter(s => s.active).map(r => S.services.from(r));
      st.customers = mine(customers).map(r => S.customers.from(r));
      st.appointments = mine(appts).map(r => S.appointments.from(r));
      st.walkIns = mine(walks).map(r => S.walkins.from(r));
      st.scheduleExceptions = mine(excs).map(r => S.exceptions.from(r));
      st.settings.shopName = t.name;
      st.settings.currency = t.currency;
      st.settings.ownerName = t.ownerName;
      root.data[tid] = st;
      snaps[tid] = this.snapshotOf(tid, root);
    });
  },

  async loadAudit(root) {
    const u = (typeof Auth !== 'undefined') ? Auth.user : null;
    if (!u || !(u.role === 'SUPERADMIN' || (u.role === 'ADMIN' && u.grants && u.grants.audit))) return [];
    const rows = await this.fetchRows('audit_log', null, { order: 'ts', asc: false, max: this.AUDIT_MAX });
    const names = {};
    ((root || this.root || {}).tenants || []).forEach(t => { names[t.id] = t.name; });
    return rows.map(r => Object.assign(this.fromAudit(r), { tenantName: r.tenant_id ? (names[r.tenant_id] || '—') : '—' }));
  },

  load() {
    if (!this.root) this.root = { tenants: [], users: [], data: {}, audit: [] };
    return this.root;
  },

  /* ---------------- Barbería activa ---------------- */
  tenantById(id) { return this.load().tenants.find(t => t.id === id) || null; },
  tenantBySlug(slug) { return this.load().tenants.find(t => t.slug === slug) || null; },
  activeTenants() { return this.load().tenants.filter(t => t.status === 'ACTIVE'); },

  useTenant(tenantId) {
    const root = this.load();
    const t = this.tenantById(tenantId) || root.tenants[0] || null;
    if (!t) { this.tenant = null; this.state = null; return null; }
    if (!root.data[t.id]) root.data[t.id] = this.emptyState(t);
    this.tenant = t;
    this.state = root.data[t.id];
    this.TIME_SLOTS = (t.timeSlots && t.timeSlots.length) ? t.timeSlots.slice() : this.DEFAULT_SLOTS.slice();
    return t;
  },

  /* CRM: carga lo que el usuario puede ver y activa su barbería */
  async init(tenantId) {
    this.mode = 'crm';
    await this.loadAll();
    const t = this.useTenant(tenantId);
    if (!t) throw new Error('No hay negocios registrados todavía.');
    this.subscribe();
    return t;
  },

  /* Consola Reservalope (superadmin): todas las barberías */
  async initConsole() {
    this.mode = 'console';
    await this.loadAll();
    this.tenant = null;
    this.state = null;
    this.subscribe();
  },

  /* Web pública: la barbería la define el enlace (?b=slug o /<enlace>/ con direcciones limpias) */
  async initPublic() {
    this.mode = 'public';
    const cfg = window.RESERVALOPE_CONFIG || {};
    let slug = null;
    try { slug = new URLSearchParams(window.location.search).get('b'); } catch (e) { slug = null; }
    if (!slug) slug = Routes.pathSlug();
    if (!slug) { try { slug = sessionStorage.getItem(this.PUBLIC_SLUG_KEY); } catch (e) { slug = null; } }
    if (!slug) slug = cfg.defaultSlug || null;
    if (!slug) return { ok: false, slug: null, tenant: null };

    const sb = this.client();
    const t0 = Date.now();
    const { data, error } = await sb.rpc('web_barberia', { p_slug: slug });
    if (error) throw error;
    if (!data || !data.tenant) return { ok: false, slug, tenant: null };

    // Campos nuevos (migración de correcciones QA). Pueden venir en la raíz o en
    // "tenant"; si la base es antigua y no los envía, la página sigue como antes.
    const r = data.tenant;
    const pick = (k) => (data[k] !== undefined && data[k] !== null) ? data[k] : r[k];

    // Reloj: diferencia entre el servidor y este aparato (a mitad del viaje de ida y vuelta)
    const serverNow = Date.parse(pick('server_now') || '');
    this._clockOffset = isNaN(serverNow) ? 0 : serverNow - Math.round((t0 + Date.now()) / 2);

    const t = this.fromTenant({
      id: r.id, slug: r.slug, name: r.name, logo_url: r.logo_url, palette: r.palette, address: r.address,
      phone: r.phone, hours: r.hours, city: r.city, currency: r.currency, timezone: pick('timezone'),
      time_slots: r.time_slots, schedule: r.schedule, status: 'ACTIVE'
    });
    const lead = parseInt(pick('lead_minutes'), 10);
    t.leadMinutes = isNaN(lead) ? 0 : Math.min(1440, Math.max(0, lead));
    t.waEnabled = pick('wa_enabled') !== false;      // sin dato (base antigua) = como antes
    t.accepting = pick('accepting') !== false;
    // Rubro del negocio (migración 11): palabras visibles de la web (js/core/vocab.js)
    t.businessType = pick('business_type') || 'barberia';
    const labels = pick('labels');
    t.labels = (labels && typeof labels === 'object' && !Array.isArray(labels)) ? labels : {};
    // Campos propios de la cita que el negocio pide al reservar (migración 12, crm_config).
    // Sin dato (base antigua) = ninguno. Se descarta lo que no tenga forma válida.
    t.bookingFields = this.normBookingFields(pick('booking_fields'));
    // Portada personalizable (título, subtítulo, imagen); sin dato = diseño de siempre
    t.site = this.normSite(pick('site'));
    this.root = { tenants: [t], users: [], data: {}, audit: [] };
    const st = this.emptyState(t);
    st.services = (data.services || []).map(s => ({ id: s.id, name: s.name, category: s.category || '', price: Number(s.price), duration: Number(s.duration_min) || 0, desc: s.description || '', featured: !!s.featured }));
    st.barberProfiles = (data.barbers || []).map(b => ({
      id: b.id, name: b.name, role: b.role_title || '', photo: b.photo_url || '', specialties: b.specialties || [],
      works: (b.works || []).map(w => ({ id: w.id, title: w.title || '', image: w.image_url })), inChair: !!b.in_chair,
      schedule: this.normWeek(b.schedule)
    }));
    st.scheduleExceptions = (data.exceptions || []).map(e => this.SPECS.exceptions.from(e));
    // "En sillón ahora": la base lo calcula; aquí se fecha con hoy para que solo cuente el día actual
    const today = this.todayISO();
    st.walkIns = st.barberProfiles.filter(b => b.inChair).map(b => ({ id: 'live-' + b.id, barber: b.name, barberId: b.id, date: today, status: 'EN_SILLON' }));
    this.root.data[t.id] = st;
    this.sanitize(st);
    this.useTenant(t.id);
    await this.refreshBusy();
    try { sessionStorage.setItem(this.PUBLIC_SLUG_KEY, t.slug); } catch (e) { /* sin almacenamiento */ }
    return { ok: true, slug: t.slug, tenant: t };
  },

  // site de web_barberia → { heroTitle, heroSubtitle, heroImage } (solo lo que tenga forma válida)
  normSite(site) {
    const out = {};
    if (!site || typeof site !== 'object' || Array.isArray(site)) return out;
    const txt = (v, max) => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, max) : '';
    const title = txt(site.heroTitle, 80), sub = txt(site.heroSubtitle, 200), img = txt(site.heroImage, 1000);
    if (title) out.heroTitle = title;
    if (sub) out.heroSubtitle = sub;
    if (img && /^https:\/\/[^\s"'<>()]+$/i.test(img)) out.heroImage = img;   // solo https, sin caracteres que rompan el atributo
    return out;
  },

  // booking_fields de web_barberia → [{ key, label, type, options, required }]
  BOOKING_FIELD_TYPES: ['text', 'textarea', 'number', 'date', 'select', 'checkbox'],
  normBookingFields(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    return list.filter(f => f && typeof f === 'object' && typeof f.key === 'string' && /^[a-z][a-z0-9_]{1,29}$/.test(f.key) &&
        !seen.has(f.key) && seen.add(f.key) && this.BOOKING_FIELD_TYPES.includes(f.type))
      .map(f => ({
        key: f.key,
        label: String(f.label || f.key).slice(0, 40),
        type: f.type,
        options: f.type === 'select' && Array.isArray(f.options) ? f.options.map(o => String(o)).filter(Boolean).slice(0, 20) : [],
        required: f.required === true
      }))
      .filter(f => f.type !== 'select' || f.options.length)
      .slice(0, 12);
  },

  // Web pública: horarios ocupados (sin datos de clientes) para bloquearlos en el formulario.
  // Cada fila trae su duración (duration_min); sin ella (base antigua) se asume un turno.
  async refreshBusy() {
    if (this.mode !== 'public' || !this.tenant) return;
    const { data, error } = await this.client().rpc('web_ocupados', { p_slug: this.tenant.slug, p_days: this.tenant.schedule.maxDays });
    if (error) throw error;
    const byId = {};
    this.state.barberProfiles.forEach(b => { byId[b.id] = b.name; });
    this.state.appointments = (data || []).map((r, i) => ({
      id: 'busy-' + i, barberId: r.barber_id || null, barber: byId[r.barber_id] || '', date: r.date, time: this.hhmm(r.time),
      durationMin: Number(r.duration_min) || 0, status: 'PROGRAMADA'
    }));
    this._busyAt = Date.now();
  },

  // Web pública: enviar la reserva (Edge Function "reservar": captcha + crear_reserva)
  async reservar(p) {
    const { data, error } = await this.client().functions.invoke('reservar', {
      body: { slug: this.tenant.slug, service_id: p.serviceId, barber_id: p.barberId, date: p.date, time: p.time,
        name: p.name, phone: p.phone, notes: p.notes || '', wa_opt_in: !!p.waOptIn, captcha: p.captcha || '',
        extra: (p.extra && typeof p.extra === 'object') ? p.extra : {} }
    });
    if (error) throw new Error(await this.functionError(error));
    if (!data || data.error) throw new Error((data && data.error) || 'No se pudo registrar la reserva.');
    return data.reserva;
  },

  // Web pública: "Mi cita" con celular + código
  async consultarCita(phone, code) {
    const { data, error } = await this.client().rpc('web_consultar_cita', { p_slug: this.tenant.slug, p_phone: phone, p_code: code });
    if (error) throw error;
    return (data || []).map(r => ({ code: r.code, date: r.date, time: r.time, service: r.service_name, barber: r.barber_name, status: r.status, customerName: r.customer_name }));
  },

  async functionError(error) {
    try {
      if (error && error.context && typeof error.context.json === 'function') {
        const body = await error.context.json();
        if (body && body.error) return body.error;
      }
    } catch (e) { /* respuesta sin JSON */ }
    return this.errorText(error);
  },

  /* ==================================================================
     ESCRITURA: guardar = enviar solo lo que cambió
     ================================================================== */
  // Copia "lógica" de los datos de una barbería, para comparar después
  snapshotOf(tid, root) {
    const snap = this.emptySnap();
    const cur = this.collect(tid, root);
    this.ORDER.forEach(k => cur[k].forEach((v, id) => snap[k].set(id, JSON.stringify(v.logical))));
    return snap;
  },

  // Recorre los datos de una barbería. Asigna un id definitivo (UUID) a lo nuevo.
  collect(tid, root) {
    const st = (root || this.root).data[tid];
    const S = this.SPECS;
    const out = {};
    this.ORDER.forEach(k => { out[k] = new Map(); });
    if (!st) return out;
    const fix = (rec) => { if (!this.isUuid(rec.id)) rec.id = this.uid(); return rec; };
    (st.barberProfiles || []).forEach(b => {
      fix(b);
      out.barbers.set(b.id, { rec: b, logical: S.barbers.logical(b) });
      (b.works || []).forEach(w => { fix(w); w._barberId = b.id; out.works.set(w.id, { rec: w, logical: S.works.logical(w) }); delete w._barberId; });
    });
    (st.scheduleExceptions || []).forEach(e => { fix(e); out.exceptions.set(e.id, { rec: e, logical: S.exceptions.logical(e) }); });
    (st.services || []).forEach(s => { fix(s); out.services.set(s.id, { rec: s, logical: S.services.logical(s) }); });
    (st.customers || []).forEach(c => { fix(c); out.customers.set(c.id, { rec: c, logical: S.customers.logical(c) }); });
    (st.appointments || []).forEach(a => { fix(a); out.appointments.set(a.id, { rec: a, logical: S.appointments.logical(a) }); });
    (st.walkIns || []).forEach(w => { fix(w); out.walkins.set(w.id, { rec: w, logical: S.walkins.logical(w) }); });
    return out;
  },

  /* Borrado explícito: la acción de la pantalla quita el registro de la lista
     Y llama a markDeleted. Nunca se borra algo solo porque "falta" en la copia
     local (por ejemplo, tras una recarga a medias). */
  markDeleted(kind, id, tenantId) {
    const tid = tenantId || (this.tenant && this.tenant.id);
    if (!tid || !id || !this.SPECS[kind]) return;
    const d = this._deletes[tid] || (this._deletes[tid] = {});
    (d[kind] || (d[kind] = new Set())).add(id);
  },

  // Guarda los cambios. Devuelve una promesa: true = el servidor los aceptó.
  save() {
    if (this.state && this.tenant) this.state.settings.shopName = this.tenant.name;
    const p = this.persist();
    const crmShopEl = document.getElementById('crm-sidebar-shopname');
    if (crmShopEl && this.tenant) crmShopEl.textContent = this.tenant.name;
    return p;
  },

  // Encola un envío de cambios. Varias llamadas seguidas se agrupan en uno.
  persist() {
    if (!this.root || this.mode === 'public') return Promise.resolve(true);
    if (this.state && this.tenant) this.pref('quick:' + this.tenant.id, this.state.settings.showQuickStart !== false);
    if (this._pending) return this._pendingPromise;
    this._pending = true;
    this._pendingPromise = this._chain = this._chain
      .then(() => new Promise(r => setTimeout(r, 0)))
      .then(() => {
        // Una recarga anterior en la cola ya pudo enviar estos cambios (ver _reload)
        if (!this._pending) return this._lastSyncOk;
        this._pending = false;
        return this.sync();
      });
    return this._pendingPromise;
  },

  whenSaved() { return this._chain; },

  // Envía los cambios. Devuelve true si todo se guardó; si no, avisa, recarga y devuelve false.
  async sync() {
    const sb = this.client();
    this._syncing = true;
    try {
      // 1. Barberías (alta y edición)
      for (const t of this.root.tenants) {
        if (!this.isUuid(t.id)) {
          const old = t.id; t.id = this.uid();
          if (this.root.data[old]) { this.root.data[t.id] = this.root.data[old]; delete this.root.data[old]; }
        }
        if (/^data:image\//.test(t.logo || '')) t.logo = await this.uploadImage(t.logo, t.id);
        const row = this.tenantRow(t);
        const before = this._snapTenants.get(t.id);
        if (before === undefined) {
          const { data, error } = await sb.from('tenants').insert(Object.assign({ id: t.id }, row)).select().single();
          if (error) throw error;
          Object.assign(t, this.fromTenantCrm(data));
          this._snapTenants.set(t.id, JSON.stringify(this.tenantRow(t)));
          if (!this._snap[t.id]) this._snap[t.id] = this.emptySnap();
        } else if (before !== JSON.stringify(row)) {
          const prev = JSON.parse(before);
          const patch = {};
          Object.keys(row).forEach(k => { if (JSON.stringify(row[k]) !== JSON.stringify(prev[k])) patch[k] = row[k]; });
          const { data, error } = await sb.from('tenants').update(patch).eq('id', t.id).select('id');
          if (error) throw error;
          if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
          this._snapTenants.set(t.id, JSON.stringify(row));
        }
      }
      // 2. Datos de cada barbería cargada
      for (const tid of Object.keys(this.root.data)) {
        await this.syncTenant(tid);
      }
      this._lastWrite = Date.now();
      this._lastSyncOk = true;
      return true;
    } catch (err) {
      console.error('[DB] Error al guardar', err);
      this._lastSyncOk = false;
      this._lastWrite = Date.now();
      if (this.isAuthError(err)) { this.sessionLost('expired'); return false; }
      this.notify(this.errorText(err), 'error');
      await this._reload(true);
      return false;
    } finally {
      this._syncing = false;
    }
  },

  async syncTenant(tid) {
    const sb = this.client();
    const S = this.SPECS;
    if (!this._snap[tid]) this._snap[tid] = this.emptySnap();
    const gen = this._gen;
    const snap = this._snap[tid];
    // Fotos nuevas (base64) → Storage; en la base solo se guarda el enlace
    const st = this.root.data[tid];
    for (const b of (st ? st.barberProfiles : [])) {
      if (/^data:image\//.test(b.photo || '')) b.photo = await this.uploadImage(b.photo, tid);
      for (const w of (b.works || [])) {
        if (/^data:image\//.test(w.image || '')) w.image = await this.uploadImage(w.image, tid);
      }
    }
    const cur = this.collect(tid);
    const dels = this._deletes[tid] || {};

    for (const k of this.ORDER) {
      const spec = S[k];
      const inserts = [];
      const updates = [];
      cur[k].forEach((v, id) => {
        const now = JSON.stringify(v.logical);
        const before = snap[k].get(id);
        if (before === undefined) inserts.push(v);
        else if (before !== now) {
          const prev = JSON.parse(before);
          const changed = {};
          Object.keys(v.logical).forEach(f => { if (JSON.stringify(v.logical[f]) !== JSON.stringify(prev[f])) changed[f] = v.logical[f]; });
          updates.push({ v, changed });
        }
      });

      if (inserts.length) {
        const rows = inserts.map(v => Object.assign(
          { id: v.rec.id, tenant_id: tid },
          spec.columns(v.logical, tid),
          spec.insertExtra ? spec.insertExtra(v.rec, tid) : {}
        ));
        if (k === 'appointments' && rows.some(r => !r.barber_id)) throw new Error(this.vt('Selecciona {un:staff} {staff} válid{o:staff} para la cita.'));
        const { data, error } = await sb.from(spec.table).insert(rows).select();
        if (error) throw error;
        this.applyReturned(k, inserts, data, tid, gen);
      }
      for (const u of updates) {
        const patch = spec.columns(u.changed, tid);
        const { data, error } = await sb.from(spec.table).update(patch).eq('id', u.v.rec.id).select();
        if (error) throw error;
        if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
        this.applyReturned(k, [u.v], data, tid, gen);
      }
      // Borrados: SOLO los pedidos con markDeleted. Barberos y servicios se
      // desactivan (conservan el historial); lo demás se borra de verdad.
      const want = dels[k] ? Array.from(dels[k]) : [];
      for (const id of want) {
        if (cur[k].has(id)) { dels[k].delete(id); continue; }   // volvió a la lista: no se borra
        if (snap[k].has(id)) {
          if (spec.soft) {
            const { data, error } = await sb.from(spec.table).update({ active: false }).eq('id', id).select('id');
            if (error) throw error;
            if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
            if (k === 'barbers') {
              await sb.from('profiles').update({ barber_id: null }).eq('barber_id', id);
              this.root.users.forEach(u => { if (u.barberId === id) u.barberId = null; });
            }
          } else {
            const { data, error } = await sb.from(spec.table).delete().eq('id', id).select('id');
            if (error) throw error;
            if (!data || !data.length) throw new Error('No tienes permiso para borrar este registro.');
          }
          if (gen === this._gen) snap[k].delete(id);
        }
        dels[k].delete(id);
      }
    }
  },

  // Tras guardar: copiar lo que calculó el servidor (código, nombres, precio) y actualizar la copia.
  // Si entretanto llegó una recarga (otra generación), lo devuelto ya no aplica y se descarta.
  applyReturned(k, items, rows, tid, gen) {
    if (gen !== undefined && gen !== this._gen) return;
    const spec = this.SPECS[k];
    const snap = this._snap[tid][k];
    const byId = {};
    (rows || []).forEach(r => { byId[r.id] = r; });
    items.forEach(v => {
      const r = byId[v.rec.id];
      if (r && (k === 'appointments' || k === 'walkins')) {
        const fresh = spec.from(r);
        // status: el servidor revierte CONFIRMADA_WSP → PROGRAMADA al reprogramar
        ['code', 'status', 'service', 'serviceId', 'barber', 'barberId', 'price', 'durationMin', 'createdAt', 'completedAt'].forEach(f => { if (f in fresh) v.rec[f] = fresh[f]; });
      }
      const logical = k === 'works' ? v.logical : spec.logical(v.rec);
      snap.set(v.rec.id, JSON.stringify(logical));
    });
  },

  // Vuelve a leer todo del servidor y repinta la página. Va en la misma cola que
  // los guardados: nunca corre a la vez que un envío.
  reload() {
    this._chain = this._chain.then(() => this._reload(false));
    return this._chain;
  },

  async _reload(fromSync) {
    if (this._sessionLost) return false;
    // Si hay cambios esperando su turno detrás de esta recarga, se envían antes
    // (si no, la recarga los pisaría).
    if (!fromSync && this.mode !== 'public' && this._pending) {
      this._pending = false;
      const ok = await this.sync();
      if (!ok) return false;   // sync ya avisó y recargó
    }
    const activeId = this.tenant ? this.tenant.id : null;
    try {
      if (this.mode === 'public') await this.refreshBusy();
      else {
        await this.loadAll();
        if (activeId) this.useTenant(activeId);
      }
    } catch (e) {
      console.error('[DB] Error al recargar', e);
      if (this.isAuthError(e)) { this.sessionLost('expired'); return false; }
      this.notify(this.errorText(e), 'error');
      return false;
    }
    if (this.mode !== 'public' && !this.checkAccess()) return false;
    if (typeof this.onReload === 'function') {
      try { this.onReload(); } catch (e) { console.error(e); }
    }
    return true;
  },

  // Tras recargar: ¿el usuario sigue existiendo, activo y con su barbería activa?
  checkAccess() {
    const u = (typeof Auth !== 'undefined') ? Auth.user : null;
    if (!u) return true;
    const me = this.root.users.find(x => x.id === u.id);
    if (!me) { this.sessionLost('noprofile'); return false; }
    if (!me.active) { this.sessionLost('inactive'); return false; }
    if (me.mustChangePassword) { this.sessionLost('temp'); return false; }
    if (this.mode === 'crm') {
      if (!this.tenant) { this.sessionLost(u.role === 'SUPERADMIN' ? 'noaccess' : 'suspended'); return false; }
      if (u.role !== 'SUPERADMIN' && this.tenant.status !== 'ACTIVE') { this.sessionLost('suspended'); return false; }
    }
    return true;
  },

  // Tiempo real: si otra persona (o la web) crea o cambia una cita, se recarga.
  // Mientras hay un guardado en curso (o recién hecho) la recarga se APLAZA, no se descarta.
  subscribe() {
    if (this._channel) return;
    try {
      const later = (ms) => { clearTimeout(this._rtTimer); this._rtTimer = setTimeout(tick, ms); };
      const tick = () => {
        if (this._sessionLost) return;
        if (this._pending || this._syncing) return later(1500);
        const since = Date.now() - this._lastWrite;
        if (since < 2500) return later(2500 - since);
        this.reload();
      };
      const reload = () => later(1200);
      this._channel = this.client().channel('reservalope-cambios')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'walk_ins' }, reload)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'schedule_exceptions' }, reload)
        .subscribe();
    } catch (e) { console.warn('[DB] Tiempo real no disponible', e); }
  },

  notify(msg, type) {
    if (typeof UI !== 'undefined' && UI.toast) UI.toast(msg, type);
    else console.warn(msg);
  },

  /* ---------------- Fotos: se suben a Storage y se guarda el enlace ---------------- */
  async uploadImage(dataUrl, tenantId) {
    if (!dataUrl || !/^data:image\//.test(dataUrl)) return dataUrl;
    const blob = await (await fetch(dataUrl)).blob();
    const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
    const path = tenantId + '/' + this.uid() + '.' + ext;
    const { error } = await this.client().storage.from('media').upload(path, blob, { contentType: blob.type, upsert: false });
    if (error) throw new Error('No se pudo subir la imagen: ' + this.errorText(error));
    return this.client().storage.from('media').getPublicUrl(path).data.publicUrl;
  },

  /* ---------------- Texto seguro ----------------
     Los datos se guardan TAL CUAL los escribe el usuario ("D'Leo" sigue
     siendo "D'Leo"). La protección contra inyección de código está al
     MOSTRARLOS: toda pantalla escapa el texto con UI.esc() y no arma
     onclick con nombres (solo con ids UUID).
     sanitize() se conserva vacío para no romper llamadas antiguas: ya no
     modifica nada (antes reescribía comillas y provocaba UPDATEs fantasma). */
  sanitize(node) { return node; },

  /* ---------------- Historial de actividad ---------------- */
  log(action, detail, opts) {
    if (this.mode === 'public') return;              // la web registra en el servidor
    const o = opts || {};
    const u = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user : null;
    if (!u) return;
    const tenantId = (o.tenantId !== undefined) ? o.tenantId : (this.tenant ? this.tenant.id : null);
    const t = tenantId ? this.tenantById(tenantId) : null;
    this.load().audit.unshift({
      id: 'local-' + Date.now(), ts: new Date().toISOString(), tenantId, tenantName: t ? t.name : '—',
      userId: u.id, userName: u.name, role: u.role, action, detail: detail || ''
    });
    this.client().rpc('registrar_actividad', { p_action: action, p_detail: detail || '', p_tenant_id: tenantId })
      .then(({ error }) => { if (error) console.warn('[DB] Historial', error.message); });
  },

  /* ---------------- Horarios ----------------
     Mismo cálculo que private.horario_slots() en la base de datos (migración 6):
       barbería  = su fecha especial, o su horario semanal
       barbero   = su fecha especial, o su horario semanal propio (si tiene)
       resultado = horarios de la barbería que caben en el horario del barbero
     La base de datos vuelve a validar cada cita: esto solo arma las listas. */
  normRanges(v) {
    const ok = (x) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(x || ''));
    return (Array.isArray(v) ? v : [])
      .filter(r => Array.isArray(r) && r.length === 2 && ok(r[0]) && ok(r[1]) && r[0] < r[1])
      .map(r => [r[0], r[1]]).slice(0, 3);
  },
  normWeek(v) {
    if (!v || typeof v !== 'object' || !v.week || typeof v.week !== 'object') return null;
    const week = {};
    for (let d = 0; d < 7; d++) week[d] = this.normRanges(v.week[d]);
    return { week };
  },
  normSchedule(v) {
    const base = this.DEFAULT_SCHEDULE;
    const s = (v && typeof v === 'object') ? v : {};
    const interval = this.INTERVALS.includes(Number(s.interval)) ? Number(s.interval) : base.interval;
    const maxDays = Math.min(365, Math.max(1, parseInt(s.maxDays, 10) || base.maxDays));
    const week = (this.normWeek(s) || this.normWeek(base)).week;
    return { interval, maxDays, week };
  },
  dayOfWeek(iso) { return new Date(iso + 'T12:00:00').getDay(); },
  fromMinutes(m) { return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); },
  /* Horas de inicio cada "interval" minutos dentro de cada tramo. "length" es lo
     que debe caber desde el inicio hasta el fin del tramo (por defecto, un turno):
     con un servicio de 60 min y turnos de 30, en un tramo 14:00–20:30 la última
     hora es 19:30. Los descansos son el hueco entre tramos, así que nada los invade. */
  rangesSlots(ranges, interval, length) {
    const out = [];
    const len = Math.max(Number(length) || 0, interval);
    this.normRanges(ranges).forEach(r => {
      for (let m = this.toMinutes(r[0]); m + len <= this.toMinutes(r[1]); m += interval) out.push(this.fromMinutes(m));
    });
    return Array.from(new Set(out)).sort();
  },
  slotFits(time, interval, ranges) {
    const m = this.toMinutes(time);
    return this.normRanges(ranges).some(r => m >= this.toMinutes(r[0]) && m + interval <= this.toMinutes(r[1]));
  },
  exceptionFor(date, barberId) {
    return ((this.state && this.state.scheduleExceptions) || []).find(e => e.date === date && (e.barberId || null) === (barberId || null)) || null;
  },
  // Barbero por id (preferido) o por nombre (compatibilidad con pantallas antiguas)
  barberOf(ref) {
    if (!ref || !this.state) return null;
    const list = this.state.barberProfiles || [];
    return list.find(b => b.id === ref) || list.find(b => b.name === ref) || null;
  },
  // Minutos que ocupa el servicio elegido (0 = un turno)
  serviceDuration(ref) {
    if (!ref || !this.state) return 0;
    const s = (this.state.services || []).find(x => x.id === ref || x.name === ref);
    return s ? (Number(s.duration) || 0) : 0;
  },
  // Duración de una cita ya registrada: la suya, la de su servicio o un turno
  apptDuration(a) {
    const own = Number(a.durationMin || a.duration_min || a.duration) || 0;
    if (own > 0) return own;
    const bySrv = this.serviceDuration(a.serviceId) || this.serviceDuration(a.service);
    if (bySrv > 0) return bySrv;
    return (this.tenant && this.tenant.schedule ? this.tenant.schedule.interval : 30);
  },
  /* Horas de inicio disponibles para un barbero en una fecha.
     barber: id o nombre (sin barbero = horario de la barbería).
     durationMin (opcional): duración del servicio elegido; la cita debe terminar
     antes del cierre y del descanso. Sin duración se exige un turno, como antes. */
  slotsFor(date, barber, durationMin) {
    if (!this.tenant || !date) return [];
    const sch = this.tenant.schedule || this.normSchedule(null);
    const len = Math.max(sch.interval, Number(durationMin) || 0);
    const dow = this.dayOfWeek(date);
    const shopExc = this.exceptionFor(date, null);
    let slots = this.rangesSlots(shopExc ? shopExc.ranges : sch.week[dow], sch.interval, len);
    const b = this.barberOf(barber);
    if (b) {
      const bExc = this.exceptionFor(date, b.id);
      const ranges = bExc ? bExc.ranges : (b.schedule ? (b.schedule.week[dow] || []) : null);
      if (ranges) slots = slots.filter(t => this.slotFits(t, len, ranges));
    }
    return slots;
  },
  maxBookDate() { return this.addDays(this.todayISO(), (this.tenant && this.tenant.schedule ? this.tenant.schedule.maxDays : 60)); },
  // Promedio de horarios por día de la semana (para calcular la ocupación en reportes)
  avgDailySlots(t) {
    const sch = (t && t.schedule) || this.normSchedule(null);
    let n = 0;
    for (let d = 0; d < 7; d++) n += this.rangesSlots(sch.week[d], sch.interval).length;
    return n / 7;
  },

  nowMinutes() { const n = this.nowParts(); return n.h * 60 + n.m; },
  toMinutes(t) { const p = String(t || '0:0').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); },
  daysBetweenISO(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); },
  isPastDate(date) { return !date || date < this.todayISO(); },
  isPastSlot(date, time) {
    if (this.isPastDate(date)) return true;
    return date === this.todayISO() && this.toMinutes(time) <= this.nowMinutes();
  },
  // Web pública: la cita debe pedirse con "lead_minutes" de anticipación (puede cruzar la medianoche)
  isTooSoon(date, time) {
    const lead = (this.mode === 'public' && this.tenant) ? (Number(this.tenant.leadMinutes) || 0) : 0;
    if (!lead) return false;
    const diff = this.daysBetweenISO(this.todayISO(), date) * 1440 + this.toMinutes(time) - this.nowMinutes();
    return diff < lead;
  },
  sameBarber(a, b, ref) {
    if (b) return a.barberId ? a.barberId === b.id : a.barber === b.name;
    return a.barber === ref || (!!a.barberId && a.barberId === ref);
  },
  // Ocupado si el rango [inicio, inicio + duración) se cruza con otra cita vigente del barbero
  isBusySlot(date, time, barber, excludeId, durationMin) {
    const b = this.barberOf(barber);
    const interval = this.tenant && this.tenant.schedule ? this.tenant.schedule.interval : 30;
    const s = this.toMinutes(time);
    const e = s + (Number(durationMin) > 0 ? Number(durationMin) : interval);
    return (this.state.appointments || []).some(a => {
      if (a.id === excludeId || a.date !== date || a.status === 'CANCELADA' || !this.sameBarber(a, b, barber)) return false;
      const as = this.toMinutes(a.time);
      return as < e && s < as + this.apptDuration(a);
    });
  },
  // 'past' | 'soon' (sin la anticipación mínima, solo web) | 'busy' | 'free'
  slotState(date, time, barber, excludeId, durationMin) {
    if (this.isPastSlot(date, time)) return 'past';
    if (this.isTooSoon(date, time)) return 'soon';
    if (barber && this.isBusySlot(date, time, barber, excludeId, durationMin)) return 'busy';
    return 'free';
  },
  freeSlots(date, barber, durationMin) {
    return this.slotsFor(date, barber, durationMin).filter(t => this.slotState(date, t, barber, null, durationMin) === 'free');
  },
  // Primer día con horario libre desde "fromDate" (o hoy); null si no hay ninguno hasta el máximo
  nextBookableDate(barber, durationMin, fromDate) {
    const today = this.todayISO();
    const last = this.maxBookDate();
    for (let d = (fromDate && fromDate > today) ? fromDate : today; d <= last; d = this.addDays(d, 1)) {
      if (this.freeSlots(d, barber, durationMin).length) return d;
    }
    return null;
  },
  firstBookableDate(barber, durationMin, fromDate) {
    return this.nextBookableDate(barber, durationMin, fromDate) || this.nextBookableDate(barber, durationMin) || this.todayISO();
  },
  validateBooking(date, time, barber, excludeId, durationMin) {
    if (!date || !time) return 'Selecciona fecha y hora.';
    if (this.isPastDate(date)) return 'No se puede reservar en una fecha que ya pasó.';
    const who = (this.barberOf(barber) || {}).name || barber || this.vt('{El:business} {business}');
    if (!this.slotsFor(date, barber).includes(time)) return who + ' no atiende en ese horario. Elige otro de la lista.';
    if (!this.slotsFor(date, barber, durationMin).includes(time)) return this.vt('{Este:service} {service} no termina antes del cierre o del descanso. Elige una hora más temprana.');
    if (this.isPastSlot(date, time)) return 'Ese horario ya pasó. Elige uno más tarde.';
    if (this.isTooSoon(date, time)) return 'Reserva con al menos ' + this.tenant.leadMinutes + ' minutos de anticipación. Elige una hora más tarde.';
    if (this.isBusySlot(date, time, barber, excludeId, durationMin)) return 'Ese horario ya está ocupado para ' + who + '.';
    return '';
  },

  /* ---------------- Alcance por usuario ----------------
     El personal vinculado a un barbero solo ve y opera SUS citas. Se compara
     por id (barberId): renombrar al barbero no le quita sus citas. */
  linkedBarberId() {
    const u = (typeof Auth !== 'undefined') ? Auth.user : null;
    if (!u || u.role !== 'STAFF' || !u.barberId || !this.state) return null;
    return this.state.barberProfiles.some(b => b.id === u.barberId) ? u.barberId : null;
  },
  linkedBarberName() {
    const id = this.linkedBarberId();
    const bp = id ? this.state.barberProfiles.find(b => b.id === id) : null;
    return bp ? bp.name : null;
  },
  visibleAppointments() {
    const own = this.linkedBarberId();
    return own ? this.state.appointments.filter(a => a.barberId === own) : this.state.appointments;
  },
  // Barberos que el usuario puede asignar: [{ id, name }]
  assignableBarbers() {
    const own = this.linkedBarberId();
    const list = this.state.barberProfiles.map(b => ({ id: b.id, name: b.name }));
    return own ? list.filter(b => b.id === own) : list;
  },
  getBarberNames() { return this.state.barberProfiles.map(b => b.name); },
  barberById(id) { return (this.state && this.state.barberProfiles.find(b => b.id === id)) || null; },
  serviceById(id) { return (this.state && this.state.services.find(s => s.id === id)) || null; },

  statusLabel(status) {
    const map = {
      PROGRAMADA: 'Programada', CONFIRMADA_WSP: 'Confirmada', COMPLETADA: 'Completada', CANCELADA: 'Cancelada',
      NO_ASISTIO: 'No asistió', EN_SILLON: this.vt('{InServiceShort}'), ESPERANDO: 'En espera', FINALIZADO: 'Finalizado'
    };
    return map[status] || status;
  },

  /* Cliente por celular (único por barbería). Lo crea el servidor con la RPC
     cliente_asegurar: busca SOLO por teléfono, no renombra a uno existente y
     devuelve su id. Sin celular válido no se crea ficha. Devuelve el id o null. */
  async ensureCustomer(name, phone) {
    const cleanName = String(name || '').trim();
    const p = this.cleanPhone(phone);
    if (!cleanName || !p || !this.tenant) return null;
    const known = this.state.customers.find(c => this.cleanPhone(c.phone) === p && this.isUuid(c.id));
    if (known) return known.id;
    // p_tenant_id es obligatorio para el superadministrador; para el resto debe ser su barbería
    const { data, error } = await this.client().rpc('cliente_asegurar', { p_name: cleanName, p_phone: p, p_tenant_id: this.tenant.id });
    if (error) {
      if (this.isAuthError(error)) this.sessionLost('expired');
      throw error;
    }
    const id = typeof data === 'string' ? data : (data && (data.id || data.cliente_asegurar)) || null;
    if (!this.isUuid(id)) return null;
    // Solo quien ve la cartera de clientes la tiene en memoria
    const canSee = typeof Auth === 'undefined' || Auth.can('customers.view');
    if (canSee && !this.state.customers.some(c => c.id === id)) {
      const rec = { id, name: cleanName, phone: p, notes: '', email: '', birthdate: '', document: '', address: '', extra: {} };
      this.state.customers.unshift(rec);
      // Ya existe en el servidor: se anota en la copia para no insertarlo otra vez
      const snap = this._snap[this.tenant.id] || (this._snap[this.tenant.id] = this.emptySnap());
      snap.customers.set(id, JSON.stringify(this.SPECS.customers.logical(rec)));
    }
    return id;
  },

  /* Catálogo base para un negocio nuevo (el de barbería solo si es barbería) */
  templateData(tenantName, businessType) {
    const generic = [
      { name: 'Atención general', category: 'General', price: 50, duration: 30, desc: 'Primera atención o control.' },
      { name: 'Atención extendida', category: 'General', price: 80, duration: 60, desc: 'Sesión completa con más tiempo.' }
    ];
    const base = businessType && businessType !== 'barberia' ? generic : [
      { name: 'Corte de Cabello + Barba', category: 'Paquetes', price: 45, duration: 45, desc: 'Corte degradado completo con perfilado de barba y toalla caliente.' },
      { name: 'Paquete Grooming Premium', category: 'Paquetes', price: 72, duration: 60, desc: 'Corte, barba, lavado capilar, toalla caliente y estilizado.' },
      { name: 'Corte Clásico / Fade', category: 'Cortes', price: 32, duration: 30, desc: 'Corte clásico o degradado limpio con acabado mate.' },
      { name: 'Perfilado de Barba', category: 'Barba', price: 20, duration: 20, desc: 'Simetría, rebaje y delineado con navaja.' },
      { name: 'Lavado & Spa Capilar', category: 'Cuidado', price: 15, duration: 15, desc: 'Lavado refrescante, masaje capilar y secado.' }
    ];
    return {
      settings: { shopName: tenantName || 'Nuevo negocio', ownerName: '', currency: 'S/', showQuickStart: true },
      barberProfiles: [],
      services: base.map(s => Object.assign({ id: this.uid() }, s)),
      customers: [], appointments: [], walkIns: []
    };
  }
};
