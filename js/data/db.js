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
  _lastWrite: 0,

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

  /* ---------------- Utilidades de fecha y texto (iguales a la demo) ---------------- */
  todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },
  nowTimeStr() {
    const d = new Date();
    return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
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

  // Mensaje entendible para un error de Supabase
  errorText(err) {
    const m = String((err && (err.message || err.error_description || err.error)) || err || '');
    if (/row-level security|permission denied|42501/i.test(m)) return 'No tienes permiso para guardar este cambio.';
    if (/customers_tenant_id_phone_key/i.test(m)) return 'Ya existe un cliente con ese celular.';
    if (/schedule_exceptions_tenant_id_barber_id_date_key/i.test(m)) return 'Ya hay una fecha especial para ese día.';
    if (/schedule_valid|ranges_check/i.test(m)) return 'El horario no es válido: revisa que cada tramo empiece antes de terminar.';
    if (/appointments_no_double_booking|duplicate key/i.test(m)) return 'Ese horario ya está ocupado. Elige otro.';
    if (/Failed to fetch|NetworkError|network/i.test(m)) return 'Sin conexión con el servidor. Revisa tu internet e inténtalo de nuevo.';
    if (/JWT|token|session/i.test(m)) return 'Tu sesión expiró. Vuelve a ingresar.';
    return m || 'No se pudo guardar el cambio.';
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
      createdAt: r.created_at, whatsapp: r.whatsapp || null
    };
  },
  tenantRow(t) {
    return {
      slug: t.slug, name: t.name, owner_name: t.ownerName || '', owner_email: t.ownerEmail || '',
      owner_phone: t.ownerPhone || '', logo_url: t.logo || null,
      palette: t.palette || this.DEFAULT_PALETTE, address: t.address || '', phone: t.phone || '',
      hours: t.hours || '', city: t.city || '', currency: t.currency || 'S/',
      plan: t.plan || 'PRO', plan_fee: Number(t.planFee) || 0, subscription_end: t.subscriptionEnd || null,
      status: t.status || 'ACTIVE', schedule: this.normSchedule(t.schedule)
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
    customers: {
      table: 'customers',
      from(r) { return { id: r.id, name: r.name, phone: r.phone || '—', notes: r.notes || '' }; },
      logical(c) { return { name: c.name, phone: DB.cleanPhone(c.phone), notes: c.notes || '' }; },
      columns(l) { return Object.assign({}, l); }
    },
    appointments: {
      table: 'appointments',
      from(r) {
        return { id: r.id, code: r.code, customerName: r.customer_name, phone: r.phone || '',
          service: r.service_name, barber: r.barber_name, date: r.date, time: DB.hhmm(r.time),
          price: Number(r.price), status: r.status, source: r.source, notes: r.notes || '',
          waOptIn: !!r.wa_opt_in, createdAt: r.created_at, completedAt: r.completed_at };
      },
      logical(a) {
        return { customerName: a.customerName, phone: DB.cleanPhone(a.phone), service: a.service || '',
          barber: a.barber, date: a.date, time: DB.hhmm(a.time), price: Number(a.price) || 0,
          status: a.status, notes: a.notes || '', waOptIn: !!a.waOptIn };
      },
      columns(l, tid) {
        const c = {};
        if ('customerName' in l) c.customer_name = l.customerName;
        if ('phone' in l) c.phone = l.phone;
        if ('service' in l) { c.service_id = DB.serviceIdByName(tid, l.service); c.service_name = l.service; }
        if ('barber' in l) c.barber_id = DB.barberIdByName(tid, l.barber);
        if ('date' in l) c.date = l.date;
        if ('time' in l) c.time = l.time;
        if ('price' in l) c.price = l.price;
        if ('status' in l) c.status = l.status;
        if ('notes' in l) c.notes = l.notes;
        if ('waOptIn' in l) c.wa_opt_in = l.waOptIn;
        return c;
      },
      insertExtra(a, tid) {
        const phone = DB.cleanPhone(a.phone);
        const st = DB.root.data[tid];
        const cust = phone && st ? st.customers.find(c => DB.cleanPhone(c.phone) === phone && DB.isUuid(c.id)) : null;
        return { source: a.source === 'WEB' ? 'WEB' : 'CRM', customer_id: cust ? cust.id : null };
      }
    },
    walkins: {
      table: 'walk_ins',
      from(r) {
        return { id: r.id, customerName: r.customer_name, service: r.service_name, barber: r.barber_name,
          price: Number(r.price), status: r.status, date: r.date, addedAt: DB.hhmm(r.added_at),
          finishedAt: r.finished_at, notes: r.notes || '' };
      },
      logical(w) {
        return { customerName: w.customerName, service: w.service || '', barber: w.barber || '',
          price: Number(w.price) || 0, status: w.status, date: w.date || DB.todayISO(),
          addedAt: /^\d{2}:\d{2}$/.test(w.addedAt || '') ? w.addedAt : null, finishedAt: w.finishedAt || null, notes: w.notes || '' };
      },
      columns(l, tid) {
        const c = {};
        if ('customerName' in l) c.customer_name = l.customerName;
        if ('service' in l) { c.service_id = DB.serviceIdByName(tid, l.service); c.service_name = l.service; }
        if ('barber' in l) { c.barber_id = l.barber ? DB.barberIdByName(tid, l.barber) : null; c.barber_name = l.barber; }
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
    const root = { tenants: tRes.data.map(r => this.fromTenant(r)), users: pRes.data.map(r => this.fromProfile(r)), data: {}, audit: [] };
    this.root = root;
    this._snapTenants = new Map(root.tenants.map(t => [t.id, JSON.stringify(this.tenantRow(t))]));
    const ids = root.tenants.map(t => t.id);
    root.tenants.forEach(t => { root.data[t.id] = this.emptyState(t); this._snap[t.id] = this.emptySnap(); });
    if (ids.length) await this.loadTenantData(ids);
    await this.loadAudit();
    return root;
  },

  emptySnap() { const s = {}; this.ORDER.forEach(k => { s[k] = new Map(); }); return s; },

  async loadTenantData(ids) {
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
      const t = this.tenantById(tid);
      if (!t) return;
      const st = this.root.data[tid] || this.emptyState(t);
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
      this.sanitize(st);
      this.root.data[tid] = st;
      this._snap[tid] = this.snapshotOf(tid);
    });
    if (this.tenant) this.useTenant(this.tenant.id);
  },

  async loadAudit() {
    const u = (typeof Auth !== 'undefined') ? Auth.user : null;
    if (!u || !(u.role === 'SUPERADMIN' || (u.role === 'ADMIN' && u.grants && u.grants.audit))) { this.root.audit = []; return; }
    const rows = await this.fetchRows('audit_log', null, { order: 'ts', asc: false, max: this.AUDIT_MAX });
    this.root.audit = rows.map(r => this.fromAudit(r));
    this.sanitize(this.root.audit);
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
    if (!t) throw new Error('No hay barberías registradas todavía.');
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

  /* Web pública: la barbería la define el enlace (?b=slug) */
  async initPublic() {
    this.mode = 'public';
    const cfg = window.RESERVALOPE_CONFIG || {};
    let slug = null;
    try { slug = new URLSearchParams(window.location.search).get('b'); } catch (e) { slug = null; }
    if (!slug) { try { slug = sessionStorage.getItem(this.PUBLIC_SLUG_KEY); } catch (e) { slug = null; } }
    if (!slug) slug = cfg.defaultSlug || null;
    if (!slug) return { ok: false, slug: null, tenant: null };

    const sb = this.client();
    const { data, error } = await sb.rpc('web_barberia', { p_slug: slug });
    if (error) throw error;
    if (!data) return { ok: false, slug, tenant: null };

    const r = data.tenant;
    const t = this.fromTenant({
      id: r.id, slug: r.slug, name: r.name, logo_url: r.logo_url, palette: r.palette, address: r.address,
      phone: r.phone, hours: r.hours, city: r.city, currency: r.currency, timezone: r.timezone,
      time_slots: r.time_slots, schedule: r.schedule, status: 'ACTIVE'
    });
    this.root = { tenants: [t], users: [], data: {}, audit: [] };
    const st = this.emptyState(t);
    st.services = (data.services || []).map(s => ({ id: s.id, name: s.name, category: s.category || '', price: Number(s.price), duration: s.duration_min, desc: s.description || '', featured: !!s.featured }));
    st.barberProfiles = (data.barbers || []).map(b => ({
      id: b.id, name: b.name, role: b.role_title || '', photo: b.photo_url || '', specialties: b.specialties || [],
      works: (b.works || []).map(w => ({ id: w.id, title: w.title || '', image: w.image_url })), inChair: !!b.in_chair,
      schedule: this.normWeek(b.schedule)
    }));
    st.scheduleExceptions = (data.exceptions || []).map(e => this.SPECS.exceptions.from(e));
    st.walkIns = st.barberProfiles.filter(b => b.inChair).map(b => ({ id: 'live-' + b.id, barber: b.name, status: 'EN_SILLON' }));
    this.root.data[t.id] = st;
    this.sanitize(st);
    this.useTenant(t.id);
    await this.refreshBusy();
    try { sessionStorage.setItem(this.PUBLIC_SLUG_KEY, t.slug); } catch (e) { /* sin almacenamiento */ }
    return { ok: true, slug: t.slug, tenant: t };
  },

  // Web pública: horarios ocupados (sin datos de clientes) para bloquearlos en el formulario
  async refreshBusy() {
    if (this.mode !== 'public' || !this.tenant) return;
    const { data, error } = await this.client().rpc('web_ocupados', { p_slug: this.tenant.slug, p_days: this.tenant.schedule.maxDays });
    if (error) throw error;
    const byId = {};
    this.state.barberProfiles.forEach(b => { byId[b.id] = b.name; });
    this.state.appointments = (data || []).map((r, i) => ({ id: 'busy-' + i, barber: byId[r.barber_id] || '', date: r.date, time: this.hhmm(r.time), status: 'PROGRAMADA' }));
  },

  // Web pública: enviar la reserva (Edge Function "reservar": captcha + crear_reserva)
  async reservar(p) {
    const { data, error } = await this.client().functions.invoke('reservar', {
      body: { slug: this.tenant.slug, service_id: p.serviceId, barber_id: p.barberId, date: p.date, time: p.time,
        name: p.name, phone: p.phone, notes: p.notes || '', wa_opt_in: !!p.waOptIn, captcha: p.captcha || '' }
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
  snapshotOf(tid) {
    const snap = this.emptySnap();
    const cur = this.collect(tid);
    this.ORDER.forEach(k => cur[k].forEach((v, id) => snap[k].set(id, JSON.stringify(v.logical))));
    return snap;
  },

  // Recorre los datos de una barbería. Asigna un id definitivo (UUID) a lo nuevo.
  collect(tid) {
    const st = this.root.data[tid];
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

  save() {
    if (this.state && this.tenant) this.state.settings.shopName = this.tenant.name;
    const p = this.persist();
    const crmShopEl = document.getElementById('crm-sidebar-shopname');
    if (crmShopEl && this.tenant) crmShopEl.textContent = this.tenant.name;
    return p;
  },

  // Encola un envío de cambios. Varias llamadas seguidas se agrupan en uno.
  persist() {
    if (!this.root || this.mode === 'public') return Promise.resolve();
    this.sanitize(this.root);
    if (this.state && this.tenant) this.pref('quick:' + this.tenant.id, this.state.settings.showQuickStart !== false);
    if (this._pending) return this._chain;
    this._pending = true;
    this._chain = this._chain.then(() => new Promise(r => setTimeout(r, 0))).then(() => {
      this._pending = false;
      return this.sync();
    });
    return this._chain;
  },

  whenSaved() { return this._chain; },

  async sync() {
    const sb = this.client();
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
          Object.assign(t, this.fromTenant(data));
          this._snapTenants.set(t.id, JSON.stringify(this.tenantRow(t)));
          if (!this._snap[t.id]) this._snap[t.id] = this.emptySnap();
        } else if (before !== JSON.stringify(row)) {
          const prev = JSON.parse(before);
          const patch = {};
          Object.keys(row).forEach(k => { if (JSON.stringify(row[k]) !== JSON.stringify(prev[k])) patch[k] = row[k]; });
          const { error } = await sb.from('tenants').update(patch).eq('id', t.id);
          if (error) throw error;
          this._snapTenants.set(t.id, JSON.stringify(row));
        }
      }
      // 2. Datos de cada barbería cargada
      for (const tid of Object.keys(this.root.data)) {
        await this.syncTenant(tid);
      }
      this._lastWrite = Date.now();
    } catch (err) {
      console.error('[DB] Error al guardar', err);
      this.notify(this.errorText(err), 'error');
      await this.reload();
    }
  },

  async syncTenant(tid) {
    const sb = this.client();
    const S = this.SPECS;
    if (!this._snap[tid]) this._snap[tid] = this.emptySnap();
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
        if (k === 'appointments' && rows.some(r => !r.barber_id)) throw new Error('Selecciona un barbero válido para la cita.');
        const { data, error } = await sb.from(spec.table).insert(rows).select();
        if (error) throw error;
        this.applyReturned(k, inserts, data, tid);
      }
      for (const u of updates) {
        const patch = spec.columns(u.changed, tid);
        const { data, error } = await sb.from(spec.table).update(patch).eq('id', u.v.rec.id).select();
        if (error) throw error;
        if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
        this.applyReturned(k, [u.v], data, tid);
      }
      // Borrados: barberos y servicios se desactivan (conservan el historial)
      for (const id of Array.from(snap[k].keys())) {
        if (cur[k].has(id)) continue;
        if (spec.soft) {
          const { error } = await sb.from(spec.table).update({ active: false }).eq('id', id);
          if (error) throw error;
          if (k === 'barbers') {
            await sb.from('profiles').update({ barber_id: null }).eq('barber_id', id);
            this.root.users.forEach(u => { if (u.barberId === id) u.barberId = null; });
          }
        } else {
          const { error } = await sb.from(spec.table).delete().eq('id', id);
          if (error) throw error;
        }
        snap[k].delete(id);
      }
    }
  },

  // Tras guardar: copiar lo que calculó el servidor (código, nombres, precio) y actualizar la copia
  applyReturned(k, items, rows, tid) {
    const spec = this.SPECS[k];
    const snap = this._snap[tid][k];
    const byId = {};
    (rows || []).forEach(r => { byId[r.id] = r; });
    items.forEach(v => {
      const r = byId[v.rec.id];
      if (r && (k === 'appointments' || k === 'walkins')) {
        const fresh = spec.from(r);
        ['code', 'service', 'barber', 'price', 'createdAt', 'completedAt'].forEach(f => { if (f in fresh) v.rec[f] = fresh[f]; });
        this.sanitize(v.rec);
      }
      const logical = k === 'works' ? v.logical : spec.logical(v.rec);
      snap.set(v.rec.id, JSON.stringify(logical));
    });
  },

  // Vuelve a leer todo del servidor y repinta la página
  async reload() {
    const activeId = this.tenant ? this.tenant.id : null;
    try {
      if (this.mode === 'public') await this.refreshBusy();
      else {
        await this.loadAll();
        if (activeId) this.useTenant(activeId);
      }
    } catch (e) {
      console.error('[DB] Error al recargar', e);
      this.notify(this.errorText(e), 'error');
      return;
    }
    if (typeof this.onReload === 'function') {
      try { this.onReload(); } catch (e) { console.error(e); }
    }
  },

  // Tiempo real: si otra persona (o la web) crea o cambia una cita, se recarga
  subscribe() {
    if (this._channel) return;
    try {
      const reload = () => {
        clearTimeout(this._rtTimer);
        this._rtTimer = setTimeout(() => {
          if (this._pending || Date.now() - this._lastWrite < 2500) return;
          this.reload();
        }, 1200);
      };
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

  /* ---------------- Sanitización (igual que la demo) ----------------
     Los nombres se usan dentro de atributos onclick: se neutralizan comillas
     y < > para que ningún texto pueda inyectar código. */
  SAFE_KEYS: ['photo', 'image', 'src', 'logo', 'refImg', 'clientImg', 'passHash'],
  sanitize(node) {
    if (Array.isArray(node)) {
      node.forEach((v, i) => {
        if (typeof v === 'string') node[i] = this.cleanText(v, false);
        else if (v && typeof v === 'object') this.sanitize(v);
      });
      return node;
    }
    if (node && typeof node === 'object') {
      Object.keys(node).forEach(k => {
        const v = node[k];
        if (typeof v === 'string') node[k] = this.cleanText(v, this.SAFE_KEYS.includes(k));
        else if (v && typeof v === 'object' && !(v instanceof Date)) this.sanitize(v);
      });
    }
    return node;
  },
  cleanText(v, isAsset) {
    if (isAsset) return v.replace(/["'<>`]/g, '');
    return v.replace(/[<>`]/g, '').replace(/'/g, '’').replace(/"/g, '”').replace(/\\/g, '/');
  },

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
  rangesSlots(ranges, interval) {
    const out = [];
    this.normRanges(ranges).forEach(r => {
      for (let m = this.toMinutes(r[0]); m + interval <= this.toMinutes(r[1]); m += interval) out.push(this.fromMinutes(m));
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
  // Horas de inicio disponibles para un barbero (por nombre) en una fecha. Sin barbero = horario de la barbería.
  slotsFor(date, barberName) {
    if (!this.tenant || !date) return [];
    const sch = this.tenant.schedule || this.normSchedule(null);
    const dow = this.dayOfWeek(date);
    const shopExc = this.exceptionFor(date, null);
    let slots = this.rangesSlots(shopExc ? shopExc.ranges : sch.week[dow], sch.interval);
    const b = barberName ? (this.state.barberProfiles || []).find(x => x.name === barberName) : null;
    if (b) {
      const bExc = this.exceptionFor(date, b.id);
      const ranges = bExc ? bExc.ranges : (b.schedule ? (b.schedule.week[dow] || []) : null);
      if (ranges) slots = slots.filter(t => this.slotFits(t, sch.interval, ranges));
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

  nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); },
  toMinutes(t) { const p = String(t || '0:0').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); },
  isPastDate(date) { return !date || date < this.todayISO(); },
  isPastSlot(date, time) {
    if (this.isPastDate(date)) return true;
    return date === this.todayISO() && this.toMinutes(time) <= this.nowMinutes();
  },
  isBusySlot(date, time, barber, excludeId) {
    return this.state.appointments.some(a =>
      a.id !== excludeId && a.date === date && a.time === time && a.barber === barber && a.status !== 'CANCELADA');
  },
  slotState(date, time, barber, excludeId) {
    if (this.isPastSlot(date, time)) return 'past';
    if (barber && this.isBusySlot(date, time, barber, excludeId)) return 'busy';
    return 'free';
  },
  freeSlots(date, barber) { return this.slotsFor(date, barber).filter(t => this.slotState(date, t, barber) === 'free'); },
  firstBookableDate(barber) {
    const last = this.maxBookDate();
    for (let d = this.todayISO(); d <= last; d = this.addDays(d, 1)) {
      if (this.freeSlots(d, barber).length) return d;
    }
    return this.todayISO();
  },
  validateBooking(date, time, barber, excludeId) {
    if (!date || !time) return 'Selecciona fecha y hora.';
    if (this.isPastDate(date)) return 'No se puede reservar en una fecha que ya pasó.';
    if (!this.slotsFor(date, barber).includes(time)) return (barber || 'La barbería') + ' no atiende en ese horario. Elige otro de la lista.';
    if (this.isPastSlot(date, time)) return 'Ese horario ya pasó. Elige uno más tarde.';
    if (this.isBusySlot(date, time, barber, excludeId)) return 'Ese horario ya está ocupado para ' + barber + '.';
    return '';
  },

  /* ---------------- Alcance por usuario ---------------- */
  linkedBarberName() {
    const u = (typeof Auth !== 'undefined') ? Auth.user : null;
    if (!u || u.role !== 'STAFF' || !u.barberId || !this.state) return null;
    const bp = this.state.barberProfiles.find(b => b.id === u.barberId);
    return bp ? bp.name : null;
  },
  visibleAppointments() {
    const own = this.linkedBarberName();
    return own ? this.state.appointments.filter(a => a.barber === own) : this.state.appointments;
  },
  assignableBarbers() {
    const own = this.linkedBarberName();
    return own ? [own] : this.getBarberNames();
  },
  getBarberNames() { return this.state.barberProfiles.map(b => b.name); },

  statusLabel(status) {
    const map = {
      PROGRAMADA: 'Programada', CONFIRMADA_WSP: 'Confirmada', COMPLETADA: 'Completada', CANCELADA: 'Cancelada',
      NO_ASISTIO: 'No asistió', EN_SILLON: 'En sillón', ESPERANDO: 'En espera', FINALIZADO: 'Finalizado'
    };
    return map[status] || status;
  },

  ensureCustomer(name, phone, notes = '') {
    if (!name) return;
    const cleanName = name.trim();
    const p = this.cleanPhone(phone);
    const existing = this.state.customers.find(c =>
      c.name.toLowerCase() === cleanName.toLowerCase() || (p && this.cleanPhone(c.phone) === p));
    if (existing) {
      if (notes) existing.notes = notes;
    } else {
      this.state.customers.unshift({ id: this.uid(), name: cleanName, phone: p || '—', notes: notes || 'Registrado automáticamente' });
    }
  },

  /* Catálogo base para una barbería nueva */
  templateData(tenantName) {
    const base = [
      { name: 'Corte de Cabello + Barba', category: 'Paquetes', price: 45, duration: 45, desc: 'Corte degradado completo con perfilado de barba y toalla caliente.' },
      { name: 'Paquete Grooming Premium', category: 'Paquetes', price: 72, duration: 60, desc: 'Corte, barba, lavado capilar, toalla caliente y estilizado.' },
      { name: 'Corte Clásico / Fade', category: 'Cortes', price: 32, duration: 30, desc: 'Corte clásico o degradado limpio con acabado mate.' },
      { name: 'Perfilado de Barba', category: 'Barba', price: 20, duration: 20, desc: 'Simetría, rebaje y delineado con navaja.' },
      { name: 'Lavado & Spa Capilar', category: 'Cuidado', price: 15, duration: 15, desc: 'Lavado refrescante, masaje capilar y secado.' }
    ];
    return {
      settings: { shopName: tenantName || 'Nueva barbería', ownerName: '', currency: 'S/', showQuickStart: true },
      barberProfiles: [],
      services: base.map(s => Object.assign({ id: this.uid() }, s)),
      customers: [], appointments: [], walkIns: []
    };
  }
};
