/* ==========================================================================
   Capa de datos multi-barbería (DEMO en navegador)
   --------------------------------------------------------------------------
   Estructura guardada en localStorage (clave DB.KEY):
     root = {
       version, tenants[]  → barberías (marca, contacto, estado)
       users[]             → cuentas (rol, barbería, barbero vinculado, permisos)
       data{ [tenantId] }  → datos operativos de cada barbería
       audit[]             → historial de actividad
     }
   DB.state  = datos de la barbería ACTIVA (lo que usan CRM, IA y la web).
   DB.tenant = registro de la barbería activa.

   IMPORTANTE: al ser una demo sin servidor, estos datos viven solo en este
   navegador y pueden ser modificados por quien tenga acceso al equipo.
   Para producción, esta capa se reemplaza por un backend (API + base de datos)
   manteniendo los mismos métodos.
   ========================================================================== */
const DB = {
  KEY: 'BARBERSUITE_DEMO_V1',
  LEGACY_KEY: 'GOLDEN_AI_VISAGISMO_CRM_DB_V3',
  PUBLIC_SLUG_KEY: 'BARBERSUITE_PUBLIC_SLUG',
  AUDIT_MAX: 3000,
  root: null,
  state: null,
  tenant: null,

  // Horarios reservables (web y CRM usan la misma lista)
  TIME_SLOTS: ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00'],

  // Planes de suscripción (montos sugeridos, editables por barbería)
  PLANS: {
    BASICO: { label: 'Básico', fee: 79 },
    PRO: { label: 'Pro', fee: 149 },
    PREMIUM: { label: 'Premium', fee: 249 }
  },

  DEFAULT_PALETTE: { primary: '#000000', secondary: '#D79848', tertiary: '#FFFFFF' },

  todayISO() {
    const d = new Date();
    const yr = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dy = String(d.getDate()).padStart(2, '0');
    return yr + '-' + mo + '-' + dy;
  },

  nowTimeStr() {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return hh + ':' + mm;
  },

  uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  },

  slugify(text) {
    return String(text || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 40);
  },

  getDemoData() {
    const today = this.todayISO();
    return {
      settings: {
        shopName: 'GOLDEN',
        ownerName: 'Administrador Golden',
        currency: 'S/',
        showQuickStart: true
      },
      barberProfiles: [
        {
          id: 'bp-1',
          name: 'Carlos',
          role: 'Master Barber • Especialista en Visagismo IA & Fade',
          photo: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=600&q=80',
          specialties: ['Asesoría de Imagen + IA', 'Degradados / Skin Fade', 'Visagismo a Tijera', 'Perfilado a Navaja'],
          works: [
            { id: 'wk-101', title: 'Mid Drop Fade + Textura', image: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80' },
            { id: 'wk-102', title: 'Skin Fade Alto + Barba', image: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80' },
            { id: 'wk-103', title: 'Crop Francés Texturizado', image: 'https://images.unsplash.com/photo-1517832607067-4db24a2ae47c?auto=format&fit=crop&w=600&q=80' }
          ]
        },
        {
          id: 'bp-2',
          name: 'Marco',
          role: 'Senior Barber • Especialista en Barba & Navaja',
          photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80',
          specialties: ['Afeitado Royal con Toalla Caliente', 'Esculpido de Barba', 'Corte Ejecutivo Clásico'],
          works: [
            { id: 'wk-201', title: 'Perfilado Geométrico + Ritual Barba', image: 'https://images.unsplash.com/photo-1621607512214-68297480165e?auto=format&fit=crop&w=600&q=80' },
            { id: 'wk-202', title: 'Afeitado Tradicional + Pompadour', image: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=600&q=80' }
          ]
        },
        {
          id: 'bp-3',
          name: 'Jay',
          role: 'Master Stylist • Tendencias & Colorimetría',
          photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80',
          specialties: ['Taper Fade Moderno', 'Camuflaje de Canas', 'Mullet & Burst Fade'],
          works: [
            { id: 'wk-301', title: 'Burst Fade + Diseño Lateral', image: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=600&q=80' }
          ]
        },
        {
          id: 'bp-4',
          name: 'Rafael',
          role: 'Senior Barber • Sastrería Capilar',
          photo: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=600&q=80',
          specialties: ['Corte Clásico a Tijera', 'Side Part Ejecutivo', 'Spa Facial & Capilar'],
          works: [
            { id: 'wk-401', title: 'Corte Ejecutivo Side Part', image: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80' }
          ]
        }
      ],
      services: [
        { id: 's-ia', name: 'Asesoría de Imagen + IA (Corte + Barba)', category: 'Experiencia IA VIP', price: 85, duration: 60, desc: 'Cuestionario diagnóstico, escaneo de facciones con fotos en el sillón, 4 propuestas generadas por IA + ejecución de corte y barba.' },
        { id: 's1', name: 'Corte de Cabello + Barba', category: 'Paquetes', price: 45, duration: 45, desc: 'Corte degradado completo con perfilado de barba y toalla caliente.' },
        { id: 's2', name: 'Paquete Grooming Premium', category: 'Paquetes', price: 72, duration: 60, desc: 'Corte, barba, lavado capilar, toalla caliente y estilizado.' },
        { id: 's3', name: 'Corte Clásico / Fade', category: 'Cortes', price: 32, duration: 30, desc: 'Corte clásico o degradado limpio con acabado mate.' },
        { id: 's4', name: 'Perfilado de Barba', category: 'Barba', price: 20, duration: 20, desc: 'Simetría, rebaje y delineado con navaja.' },
        { id: 's5', name: 'Lavado & Spa Capilar', category: 'Cuidado', price: 15, duration: 15, desc: 'Lavado refrescante, masaje capilar y secado.' }
      ],
      appointments: [
        { id: 'a0', customerName: 'Sebastián Alvarado', phone: '987654321', service: 'Asesoría de Imagen + IA (Corte + Barba)', barber: 'Carlos', date: today, time: '10:30', price: 85, status: 'PROGRAMADA', notes: 'Desea diagnóstico IA de corte y barba' },
        { id: 'a1', customerName: 'Marcus Lee', phone: '987111222', service: 'Corte de Cabello + Barba', barber: 'Carlos', date: today, time: '12:00', price: 45, status: 'PROGRAMADA', notes: 'Degradado medio' },
        { id: 'a2', customerName: 'Diego Ramírez', phone: '912345678', service: 'Paquete Grooming Premium', barber: 'Marco', date: today, time: '15:00', price: 72, status: 'COMPLETADA', notes: 'Bebida café espresso' }
      ],
      walkIns: [
        { id: 'w1', customerName: 'Sam Patel', service: 'Asesoría de Imagen + IA (Corte + Barba)', barber: 'Carlos', price: 85, status: 'ESPERANDO', addedAt: '10:05 AM', notes: 'Quiere ver 4 opciones IA con su barba actual.' },
        { id: 'w2', customerName: 'Jordan Blake', service: 'Perfilado de Barba', barber: 'Marco', price: 20, status: 'EN_SILLON', addedAt: '10:25 AM', notes: 'Barba cuadrada' }
      ],
      customers: [
        { id: 'c1', name: 'Sebastián Alvarado', phone: '987654321', notes: 'Cliente Asesoría IA • Rostro Cuadrado con Barba' },
        { id: 'c2', name: 'Marcus Lee', phone: '987111222', notes: 'Prefiere corte con Carlos' },
        { id: 'c3', name: 'Diego Ramírez', phone: '912345678', notes: 'Cliente VIP mensual' }
      ],
      aiConsultations: []
    };
  },

  /* Datos iniciales para una barbería nueva: catálogo de servicios base, sin personal */
  templateData(tenantName) {
    const demo = this.getDemoData();
    return {
      settings: { shopName: tenantName || 'Nueva barbería', ownerName: '', currency: 'S/', showQuickStart: true },
      barberProfiles: [],
      services: demo.services.map(s => Object.assign({}, s)),
      customers: [],
      appointments: [],
      walkIns: [],
      aiConsultations: []
    };
  },

  addDays(iso, n) {
    const d = new Date(iso + 'T12:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  },

  defaultTenant() {
    return {
      id: 't-golden',
      slug: 'golden',
      name: 'Golden Barbería',
      ownerName: 'Administrador Golden',
      logo: 'assets/icons/logo-golden-header.jpg',
      accent: '#D79848',
      palette: { primary: '#000000', secondary: '#D79848', tertiary: '#FFFFFF' },
      plan: 'PRO',
      planFee: 149,
      subscriptionEnd: this.addDays(this.todayISO(), 25),
      ownerEmail: '',
      ownerPhone: '',
      address: 'Av. La Marina',
      phone: '+51 999 999 999',
      hours: 'Citas de 9:00 a 20:00',
      city: 'Lima, Perú',
      currency: 'S/',
      status: 'ACTIVE',
      createdAt: new Date().toISOString()
    };
  },

  emptyRoot() {
    return { version: 1, createdAt: new Date().toISOString(), tenants: [], users: [], data: {}, audit: [] };
  },

  /* ---------------- Carga y migración ---------------- */
  load() {
    if (this.root) return this.root;
    let root = null;
    try {
      const raw = localStorage.getItem(this.KEY);
      root = raw ? JSON.parse(raw) : null;
    } catch (e) { root = null; }

    if (!root || !Array.isArray(root.tenants) || !root.tenants.length) {
      root = this.emptyRoot();
      const t = this.defaultTenant();
      root.tenants.push(t);
      // Migración: si existía la versión anterior (una sola barbería), se conservan sus datos
      let legacy = null;
      try { legacy = JSON.parse(localStorage.getItem(this.LEGACY_KEY) || 'null'); } catch (e) { legacy = null; }
      root.data[t.id] = (legacy && Array.isArray(legacy.barberProfiles)) ? legacy : this.getDemoData();
      this.root = root;
      this.persist();
    }
    ['tenants', 'users', 'audit'].forEach(k => { if (!Array.isArray(root[k])) root[k] = []; });
    if (!root.data) root.data = {};
    this.root = root;
    let changed = false;
    root.tenants.forEach(t => { if (this.normalizeTenant(t)) changed = true; });
    Object.keys(root.data).forEach(id => { if (this.migrateRecords(root.data[id])) changed = true; });
    if (typeof DemoSeed !== 'undefined' && DemoSeed.run(root)) changed = true;
    if (changed) this.persist();
    return root;
  },

  /* Completa campos nuevos en barberías antiguas. Devuelve true si cambió algo. */
  normalizeTenant(t) {
    let ch = false;
    if (!t.palette) { t.palette = Object.assign({}, this.DEFAULT_PALETTE, { secondary: t.accent || this.DEFAULT_PALETTE.secondary }); ch = true; }
    if (t.accent !== t.palette.secondary) { t.accent = t.palette.secondary; ch = true; }
    if (!t.plan) { t.plan = 'PRO'; ch = true; }
    if (t.planFee == null) { t.planFee = (this.PLANS[t.plan] || this.PLANS.PRO).fee; ch = true; }
    if (!t.subscriptionEnd) { t.subscriptionEnd = this.addDays(this.todayISO(), 30); ch = true; }
    ['ownerEmail', 'ownerPhone'].forEach(k => { if (t[k] == null) { t[k] = ''; ch = true; } });
    if (!t.createdAt) { t.createdAt = new Date().toISOString(); ch = true; }
    return ch;
  },

  /* Citas: origen (WEB/CRM) y fechas de creación/atención. Walk-in: fecha. */
  migrateRecords(s) {
    if (!s) return false;
    let ch = false;
    (s.appointments || []).forEach(a => {
      if (!a.source) { a.source = /web/i.test(a.notes || '') ? 'WEB' : 'CRM'; ch = true; }
      if (!a.createdAt) { a.createdAt = (a.date || this.todayISO()) + 'T' + (a.time || '09:00') + ':00'; ch = true; }
      if (a.status === 'COMPLETADA' && !a.completedAt) { a.completedAt = (a.date || this.todayISO()) + 'T' + (a.time || '09:00') + ':00'; ch = true; }
    });
    (s.walkIns || []).forEach(w => {
      if (!w.date) { w.date = this.todayISO(); ch = true; }
    });
    (s.aiConsultations || []).forEach(c => { if (!c.date) { c.date = this.todayISO(); ch = true; } });
    return ch;
  },

  /* ---------------- Horarios ---------------- */
  nowMinutes() { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); },
  toMinutes(t) { const p = String(t || '0:0').split(':'); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); },

  isPastDate(date) { return !date || date < this.todayISO(); },

  // Un horario ya pasó si la fecha es anterior a hoy, o si es hoy y la hora ya llegó
  isPastSlot(date, time) {
    if (this.isPastDate(date)) return true;
    return date === this.todayISO() && this.toMinutes(time) <= this.nowMinutes();
  },

  isBusySlot(date, time, barber, excludeId) {
    return this.state.appointments.some(a =>
      a.id !== excludeId && a.date === date && a.time === time && a.barber === barber && a.status !== 'CANCELADA'
    );
  },

  slotState(date, time, barber, excludeId) {
    if (this.isPastSlot(date, time)) return 'past';
    if (barber && this.isBusySlot(date, time, barber, excludeId)) return 'busy';
    return 'free';
  },

  freeSlots(date, barber) {
    return this.TIME_SLOTS.filter(t => this.slotState(date, t, barber) === 'free');
  },

  // Primer día (desde hoy) con al menos un horario libre para ese barbero
  firstBookableDate(barber) {
    let d = this.todayISO();
    for (let i = 0; i < 60; i++) {
      if (this.freeSlots(d, barber).length) return d;
      d = this.addDays(d, 1);
    }
    return this.todayISO();
  },

  /* Validación única para crear citas (web y CRM). Devuelve '' o el error. */
  validateBooking(date, time, barber, excludeId) {
    if (!date || !time) return 'Selecciona fecha y hora.';
    if (this.isPastDate(date)) return 'No se puede reservar en una fecha que ya pasó.';
    if (!this.TIME_SLOTS.includes(time)) return 'Selecciona un horario de la lista.';
    if (this.isPastSlot(date, time)) return 'Ese horario ya pasó. Elige uno más tarde.';
    if (this.isBusySlot(date, time, barber, excludeId)) return 'Ese horario ya está ocupado para ' + barber + '.';
    return '';
  },

  tenantById(id) { return this.load().tenants.find(t => t.id === id) || null; },
  tenantBySlug(slug) { return this.load().tenants.find(t => t.slug === slug) || null; },
  activeTenants() { return this.load().tenants.filter(t => t.status === 'ACTIVE'); },

  normalizeState(s, tenant) {
    ['barberProfiles', 'services', 'customers', 'appointments', 'walkIns', 'aiConsultations'].forEach(k => {
      if (!Array.isArray(s[k])) s[k] = [];
    });
    if (!s.settings) s.settings = {};
    s.settings.shopName = tenant.name;
    s.settings.currency = tenant.currency || s.settings.currency || 'S/';
    if (typeof s.settings.showQuickStart === 'undefined') s.settings.showQuickStart = true;
    s.barberProfiles.forEach(bp => { if (!Array.isArray(bp.works)) bp.works = []; if (!Array.isArray(bp.specialties)) bp.specialties = []; });
    return s;
  },

  useTenant(tenantId) {
    const root = this.load();
    const t = this.tenantById(tenantId) || root.tenants[0];
    if (!root.data[t.id]) root.data[t.id] = this.templateData(t.name);
    this.tenant = t;
    this.state = this.normalizeState(root.data[t.id], t);
    return t;
  },

  /* CRM: la barbería la define la sesión (Auth). */
  init(tenantId) {
    this.load();
    this.useTenant(tenantId || this.root.tenants[0].id);
    this.save();
  },

  /* Web pública: la barbería la define el enlace (?b=slug). */
  initPublic() {
    this.load();
    let slug = null;
    try { slug = new URLSearchParams(window.location.search).get('b'); } catch (e) { slug = null; }
    if (!slug) { try { slug = sessionStorage.getItem(this.PUBLIC_SLUG_KEY); } catch (e) { slug = null; } }
    let t = slug ? this.tenantBySlug(slug) : (this.activeTenants()[0] || null);
    if (!t || t.status !== 'ACTIVE') return { ok: false, slug, tenant: t };
    try { sessionStorage.setItem(this.PUBLIC_SLUG_KEY, t.slug); } catch (e) {}
    this.useTenant(t.id);
    return { ok: true, slug: t.slug, tenant: t };
  },

  /* ---------------- Persistencia ---------------- */
  // Neutraliza texto peligroso (inyección de HTML/JS) en todos los campos de texto.
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
        else if (v && typeof v === 'object') this.sanitize(v);
      });
    }
    return node;
  },
  // Campos de imagen/URL: solo se quitan comillas y < > (no alteran base64 ni URLs válidas).
  // Campos de texto: se quitan < > y las comillas pasan a tipográficas (’ ”) para que
  // ningún nombre pueda romper el HTML ni los atributos onclick.
  cleanText(v, isAsset) {
    if (isAsset) return v.replace(/["'<>`]/g, '');
    return v.replace(/[<>`]/g, '').replace(/'/g, '\u2019').replace(/"/g, '\u201D').replace(/\\/g, '/');
  },

  persist() {
    if (!this.root) return;
    this.sanitize(this.root);
    if (this.root.audit.length > this.AUDIT_MAX) this.root.audit.length = this.AUDIT_MAX;
    try {
      localStorage.setItem(this.KEY, JSON.stringify(this.root));
    } catch (e) {
      console.error(e);
      if (typeof UI !== 'undefined') UI.toast('No hay espacio para guardar. Reduce fotos o exporta un respaldo.', 'error');
    }
  },

  save() {
    if (this.state && this.tenant) {
      this.state.settings.shopName = this.tenant.name;
    }
    this.persist();
    const crmShopEl = document.getElementById('crm-sidebar-shopname');
    if (crmShopEl && this.tenant) crmShopEl.textContent = this.tenant.name;
  },

  /* ---------------- Historial de actividad ---------------- */
  log(action, detail, opts) {
    const o = opts || {};
    const root = this.load();
    const u = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user : null;
    const tenantId = (o.tenantId !== undefined) ? o.tenantId : (this.tenant ? this.tenant.id : null);
    const t = tenantId ? this.tenantById(tenantId) : null;
    root.audit.unshift({
      id: this.uid('log'),
      ts: new Date().toISOString(),
      tenantId: tenantId,
      tenantName: t ? t.name : '—',
      userId: o.actorId || (u ? u.id : null),
      userName: o.actorName || (u ? u.name : 'Sistema'),
      role: o.actorRole || (u ? u.role : 'SYSTEM'),
      action: action,
      detail: detail || ''
    });
    this.persist();
  },

  /* ---------------- Alcance por usuario ---------------- */
  linkedBarberName() {
    const u = (typeof Auth !== 'undefined') ? Auth.user : null;
    if (!u || u.role !== 'STAFF' || !u.barberId || !this.state) return null;
    const bp = this.state.barberProfiles.find(b => b.id === u.barberId);
    return bp ? bp.name : null;
  },

  // Personal vinculado a un barbero: solo ve SUS citas. Sin vínculo (ej. recepción): todas.
  visibleAppointments() {
    const own = this.linkedBarberName();
    return own ? this.state.appointments.filter(a => a.barber === own) : this.state.appointments;
  },

  assignableBarbers() {
    const own = this.linkedBarberName();
    return own ? [own] : this.getBarberNames();
  },

  getBarberNames() {
    return this.state.barberProfiles.map(b => b.name);
  },

  statusLabel(status) {
    const map = {
      PROGRAMADA: 'Programada',
      CONFIRMADA_WSP: 'Confirmada',
      COMPLETADA: 'Completada',
      CANCELADA: 'Cancelada',
      NO_ASISTIO: 'No asistió',
      EN_SILLON: 'En sillón',
      ESPERANDO: 'En espera',
      FINALIZADO: 'Finalizado'
    };
    return map[status] || status;
  },

  ensureCustomer(name, phone, notes = '') {
    if (!name) return;
    const cleanName = name.trim();
    const existing = this.state.customers.find(c =>
      c.name.toLowerCase() === cleanName.toLowerCase() || (phone && c.phone === phone)
    );
    if (existing) {
      if (notes) existing.notes = notes;
    } else {
      this.state.customers.unshift({
        id: 'c-' + Date.now(),
        name: cleanName,
        phone: phone || '—',
        notes: notes || 'Registrado automáticamente'
      });
    }
  }
};
