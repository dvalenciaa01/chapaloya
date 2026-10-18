/* ==========================================================================
   Autenticación, sesión, roles y permisos (DEMO en navegador)
   --------------------------------------------------------------------------
   Roles:
     SUPERADMIN → todo el sistema, todas las barberías.
     ADMIN      → solo su barbería. Base: citas, walk-in, servicios, barberos
                  y portafolio, usuarios del personal. Módulos extra solo si
                  el superadmin se los otorga (ver GRANTABLE).
     STAFF      → personal: panel, citas (ver/crear/cambiar estado),
                  walk-in (ver/crear/avanzar) y Asesoría IA. Si está vinculado
                  a un barbero, solo ve sus propias citas.
   Seguridad de cuentas: contraseñas con sal + hash iterado, bloqueo tras
   5 intentos fallidos (15 min), cambio obligatorio de contraseña temporal,
   sesión con expiración (8 h) e inactividad (60 min).
   NOTA: sin servidor, esto ordena el uso pero no es una barrera de seguridad
   real; en producción la verificación debe hacerse en el backend.
   ========================================================================== */
const Auth = {
  SESSION_KEY: 'BARBERSUITE_SESSION',
  SESSION_HOURS: 8,
  IDLE_MINUTES: 60,
  MAX_ATTEMPTS: 5,
  LOCK_MINUTES: 15,
  HASH_ROUNDS: 4000,
  user: null,
  session: null,

  ROLE_LABEL: { SUPERADMIN: 'Superadministrador', ADMIN: 'Administrador', STAFF: 'Personal' },

  // Módulos que el superadmin puede otorgar o quitar a cada administrador
  GRANTABLE: [
    { key: 'sales', label: 'Ventas', hint: 'Ingresos, ticket promedio y ventas por barbero.' },
    { key: 'customers', label: 'Clientes', hint: 'Cartera de clientes y su historial.' },
    { key: 'reports', label: 'Reportes', hint: 'Reportes con filtros, exportables a PDF y Excel.' },
    { key: 'settings', label: 'Configuración', hint: 'Datos públicos de la barbería y respaldo.' },
    { key: 'ai', label: 'Asesoría IA', hint: 'Estación de visagismo del barbero.' },
    { key: 'audit', label: 'Historial de actividad', hint: 'Registro de acciones de su barbería.' }
  ],

  BASE: {
    ADMIN: [
      'dashboard.view',
      'appointments.view', 'appointments.create', 'appointments.status', 'appointments.delete',
      'walkins.view', 'walkins.create', 'walkins.status',
      'services.manage', 'barbers.manage', 'users.manage'
    ],
    STAFF: [
      'dashboard.view',
      'appointments.view', 'appointments.create', 'appointments.status',
      'walkins.view', 'walkins.create', 'walkins.status',
      'ai.use'
    ]
  },

  GRANT_MAP: {
    sales: ['sales.view', 'finance.view'],
    customers: ['customers.view', 'customers.manage'],
    reports: ['reports.view'],
    settings: ['settings.manage'],
    ai: ['ai.use'],
    audit: ['audit.view']
  },

  TAB_PERM: {
    'dashboard': 'dashboard.view',
    'ai-advisor': 'ai.use',
    'appointments': 'appointments.view',
    'walkins': 'walkins.view',
    'barbers': 'barbers.manage',
    'sales': 'sales.view',
    'customers': 'customers.view',
    'services': 'services.manage',
    'reports': 'reports.view',
    'settings': 'settings.manage',
    'users': 'users.manage',
    'tenants': 'tenants.manage',
    'audit': 'audit.view'
  },

  defaultGrants() {
    const g = {};
    this.GRANTABLE.forEach(m => { g[m.key] = true; });
    return g;
  },

  /* ---------------- Hash de contraseñas (SHA-256 iterado con sal) ---------------- */
  sha256(ascii) {
    // Implementación compacta de SHA-256 (funciona en file://, http y https)
    const rightRotate = (v, a) => (v >>> a) | (v << (32 - a));
    const maxWord = Math.pow(2, 32);
    let result = '';
    const words = [];
    const asciiBitLength = ascii.length * 8;
    let hash = this._h || [];
    let k = this._k || [];
    if (!this._k) {
      const isComposite = {};
      for (let candidate = 2; hash.length < 64; candidate++) {
        if (!isComposite[candidate]) {
          for (let i = 0; i < 313; i += candidate) isComposite[i] = candidate;
          hash.push((Math.pow(candidate, 0.5) * maxWord) | 0);
          k.push((Math.pow(candidate, 1 / 3) * maxWord) | 0);
        }
      }
      this._h = hash.slice(0, 8); this._k = k;
    }
    hash = this._h.slice(0, 8); k = this._k;
    ascii += '\x80';
    while (ascii.length % 64 - 56) ascii += '\x00';
    for (let i = 0; i < ascii.length; i++) {
      const j = ascii.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i) % 4) * 8;
    }
    words[words.length] = ((asciiBitLength / maxWord) | 0);
    words[words.length] = (asciiBitLength);
    for (let j = 0; j < words.length;) {
      const w = words.slice(j, j += 16);
      const oldHash = hash;
      hash = hash.slice(0, 8);
      for (let i = 0; i < 64; i++) {
        const w15 = w[i - 15], w2 = w[i - 2];
        const a = hash[0], e = hash[4];
        const temp1 = hash[7]
          + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
          + ((e & hash[5]) ^ ((~e) & hash[6]))
          + k[i]
          + (w[i] = (i < 16) ? w[i] : (
            w[i - 16]
            + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
            + w[i - 7]
            + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
          ) | 0);
        const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
          + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
        hash.length = 8;
      }
      for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
    }
    for (let i = 0; i < 8; i++) {
      for (let j = 3; j + 1; j--) {
        const b = (hash[i] >> (j * 8)) & 255;
        result += ((b < 16) ? 0 : '') + b.toString(16);
      }
    }
    return result;
  },

  utf8(str) { return unescape(encodeURIComponent(str)); },

  hashPassword(password, salt) {
    let h = this.sha256(this.utf8(salt + ':' + password));
    for (let i = 0; i < this.HASH_ROUNDS; i++) h = this.sha256(h + salt);
    return 'v1$' + this.HASH_ROUNDS + '$' + salt + '$' + h;
  },

  verifyPassword(password, stored) {
    const parts = String(stored || '').split('$');
    if (parts.length !== 4) return false;
    const rounds = parseInt(parts[1], 10), salt = parts[2];
    let h = this.sha256(this.utf8(salt + ':' + password));
    for (let i = 0; i < rounds; i++) h = this.sha256(h + salt);
    return h === parts[3];
  },

  randomHex(bytes) {
    const a = new Uint8Array(bytes);
    (window.crypto || window.msCrypto).getRandomValues(a);
    return Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
  },

  tempPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    const a = new Uint8Array(10);
    window.crypto.getRandomValues(a);
    let p = Array.from(a, b => chars[b % chars.length]).join('');
    return p.slice(0, 4) + '-' + p.slice(4, 8) + p.slice(8) + '7';
  },

  validatePassword(pw) {
    if (!pw || pw.length < 8) return 'Debe tener al menos 8 caracteres.';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Debe combinar letras y números.';
    return '';
  },

  /* ---------------- Usuarios ---------------- */
  findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return DB.load().users.find(u => u.email === e) || null;
  },

  findById(id) { return DB.load().users.find(u => u.id === id) || null; },

  createUser(data) {
    const root = DB.load();
    const email = String(data.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Correo no válido.');
    if (this.findByEmail(email)) throw new Error('Ya existe un usuario con ese correo.');
    const salt = this.randomHex(16);
    const user = {
      id: DB.uid('u'),
      email,
      name: String(data.name || '').trim() || email,
      role: data.role,
      tenantId: data.role === 'SUPERADMIN' ? null : data.tenantId,
      barberId: data.role === 'STAFF' ? (data.barberId || null) : null,
      grants: data.role === 'ADMIN' ? (data.grants || this.defaultGrants()) : null,
      passHash: this.hashPassword(data.password, salt),
      active: true,
      mustChangePassword: data.mustChangePassword !== false,
      failedAttempts: 0,
      lockedUntil: 0,
      createdAt: new Date().toISOString(),
      lastLoginAt: null
    };
    root.users.push(user);
    DB.persist();
    return user;
  },

  setPassword(user, password, mustChange) {
    const salt = this.randomHex(16);
    user.passHash = this.hashPassword(password, salt);
    user.mustChangePassword = !!mustChange;
    user.failedAttempts = 0;
    user.lockedUntil = 0;
    DB.persist();
  },

  /* Cuentas iniciales de la demo (solo la primera vez) */
  seedIfNeeded() {
    const root = DB.load();
    let created = false;
    if (!root.users.length) {
      const golden = root.tenants.find(t => t.id === 't-golden') || root.tenants[0];
      const st = root.data[golden.id];
      const carlos = st && st.barberProfiles ? st.barberProfiles.find(b => b.name === 'Carlos') : null;
      this.createUser({ email: 'superadmin@demo.pe', name: 'Superadministrador', role: 'SUPERADMIN', password: 'Super2026' });
      this.createUser({ email: 'admin@golden.pe', name: 'Administrador Golden', role: 'ADMIN', tenantId: golden.id, password: 'Admin2026' });
      this.createUser({ email: 'carlos@golden.pe', name: 'Carlos', role: 'STAFF', tenantId: golden.id, barberId: carlos ? carlos.id : null, password: 'Staff2026' });
      DB.log('Sistema inicializado', 'Se crearon las cuentas iniciales de la demo.', { actorName: 'Sistema', actorRole: 'SYSTEM', tenantId: null });
      created = true;
    }
    // Cuentas de la barbería de ejemplo (Navaja Norte)
    const nn = DB.tenantBySlug('navaja-norte');
    if (root.demoSeed && root.demoSeed.usersPending && nn) {
      if (!this.findByEmail('admin@navajanorte.pe')) {
        const u = this.createUser({ email: 'admin@navajanorte.pe', name: 'Ricardo Salas', role: 'ADMIN', tenantId: nn.id, password: 'Admin2026' });
        u.grants = { sales: true, customers: true, reports: true, settings: true, ai: false, audit: false };
      }
      if (!this.findByEmail('luis@navajanorte.pe')) {
        this.createUser({ email: 'luis@navajanorte.pe', name: 'Luis', role: 'STAFF', tenantId: nn.id, barberId: 'bp-nn-1', password: 'Staff2026' });
      }
      root.demoSeed.usersPending = false;
      DB.persist();
      created = true;
    }
    return created;
  },

  /* ---------------- Login / sesión ---------------- */
  login(email, password) {
    const user = this.findByEmail(email);
    const generic = 'Correo o contraseña incorrectos.';
    if (!user) return { ok: false, error: generic };

    const tenantOf = user.tenantId ? DB.tenantById(user.tenantId) : null;
    const logOpts = { actorId: user.id, actorName: user.name, actorRole: user.role, tenantId: user.tenantId };

    if (user.lockedUntil && user.lockedUntil > Date.now()) {
      const min = Math.ceil((user.lockedUntil - Date.now()) / 60000);
      return { ok: false, error: 'Cuenta bloqueada temporalmente por intentos fallidos. Intenta en ' + min + ' min o pide a tu administrador que restablezca tu contraseña.' };
    }

    if (!this.verifyPassword(password, user.passHash)) {
      user.failedAttempts = (user.failedAttempts || 0) + 1;
      let msg = generic;
      if (user.failedAttempts >= this.MAX_ATTEMPTS) {
        user.lockedUntil = Date.now() + this.LOCK_MINUTES * 60000;
        user.failedAttempts = 0;
        msg = 'Demasiados intentos fallidos. La cuenta quedó bloqueada ' + this.LOCK_MINUTES + ' minutos.';
        DB.log('Cuenta bloqueada', 'Bloqueo automático por ' + this.MAX_ATTEMPTS + ' intentos fallidos.', logOpts);
      } else {
        const left = this.MAX_ATTEMPTS - user.failedAttempts;
        msg = generic + ' Te quedan ' + left + (left === 1 ? ' intento.' : ' intentos.');
        DB.log('Intento de acceso fallido', 'Contraseña incorrecta.', logOpts);
      }
      DB.persist();
      return { ok: false, error: msg };
    }

    if (!user.active) return { ok: false, error: 'Tu usuario está desactivado. Contacta a tu administrador.' };
    if (user.role !== 'SUPERADMIN' && (!tenantOf || tenantOf.status !== 'ACTIVE')) {
      return { ok: false, error: 'La barbería asociada a tu cuenta está suspendida. Contacta al superadministrador.' };
    }

    user.failedAttempts = 0;
    user.lockedUntil = 0;
    user.lastLoginAt = new Date().toISOString();
    const tenantId = user.tenantId || (DB.activeTenants()[0] || DB.load().tenants[0]).id;
    this.session = { userId: user.id, tenantId, exp: Date.now() + this.SESSION_HOURS * 3600000, lastActive: Date.now() };
    this.writeSession();
    this.user = user;
    DB.log('Inicio de sesión', 'Acceso al CRM.', Object.assign({}, logOpts, { tenantId: user.tenantId }));
    return { ok: true, user };
  },

  writeSession() {
    try { localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.session)); } catch (e) {}
  },

  readSession() {
    try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch (e) { return null; }
  },

  logout(reason) {
    if (this.user) DB.log('Cierre de sesión', reason || 'Salida manual.');
    try { localStorage.removeItem(this.SESSION_KEY); } catch (e) {}
    this.user = null;
    this.session = null;
    const q = reason ? '?msg=' + encodeURIComponent(reason) : '';
    window.location.replace('login.html' + q);
  },

  /* Verifica la sesión al abrir el CRM. Devuelve el usuario o redirige al login. */
  requireSession() {
    DB.load();
    const s = this.readSession();
    const fail = (msg) => {
      try { localStorage.removeItem(this.SESSION_KEY); } catch (e) {}
      const tab = new URLSearchParams(window.location.search).get('tab');
      window.location.replace('login.html?' + (msg ? 'msg=' + encodeURIComponent(msg) + '&' : '') + (tab ? 'tab=' + encodeURIComponent(tab) : ''));
      return null;
    };
    if (!s || !s.userId) return fail('');
    if (Date.now() > s.exp) return fail('Tu sesión expiró. Vuelve a ingresar.');
    if (Date.now() - (s.lastActive || 0) > this.IDLE_MINUTES * 60000) return fail('Sesión cerrada por inactividad.');
    const user = this.findById(s.userId);
    if (!user || !user.active) return fail('Tu usuario ya no tiene acceso.');
    if (user.mustChangePassword) return fail('Debes cambiar tu contraseña temporal.');
    if (user.role !== 'SUPERADMIN') {
      const t = DB.tenantById(user.tenantId);
      if (!t || t.status !== 'ACTIVE') return fail('La barbería asociada a tu cuenta está suspendida.');
      s.tenantId = user.tenantId; // un admin/personal nunca puede cambiar de barbería
    } else if (!DB.tenantById(s.tenantId)) {
      s.tenantId = DB.load().tenants[0].id;
    }
    this.user = user;
    this.session = s;
    this.touch();
    this.watchActivity();
    return user;
  },

  touch() {
    if (!this.session) return;
    this.session.lastActive = Date.now();
    this.writeSession();
  },

  watchActivity() {
    let last = 0;
    const onAct = () => { const n = Date.now(); if (n - last > 30000) { last = n; this.touch(); } };
    ['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => window.addEventListener(ev, onAct, { passive: true }));
    setInterval(() => {
      const s = this.readSession();
      if (!s || Date.now() > s.exp) return this.logout('Tu sesión expiró. Vuelve a ingresar.');
      if (Date.now() - (s.lastActive || 0) > this.IDLE_MINUTES * 60000) this.logout('Sesión cerrada por inactividad.');
    }, 60000);
  },

  activeTenantId() { return this.session ? this.session.tenantId : null; },

  switchTenant(tenantId) {
    if (!this.user || this.user.role !== 'SUPERADMIN') return false;
    if (!DB.tenantById(tenantId)) return false;
    this.session.tenantId = tenantId;
    this.writeSession();
    return true;
  },

  /* ---------------- Permisos ---------------- */
  permissionsOf(user) {
    if (!user) return [];
    if (user.role === 'SUPERADMIN') return ['*'];
    const base = (this.BASE[user.role] || []).slice();
    if (user.role === 'ADMIN') {
      const g = user.grants || {};
      Object.keys(this.GRANT_MAP).forEach(k => { if (g[k]) base.push(...this.GRANT_MAP[k]); });
    }
    return base;
  },

  can(perm, user) {
    const u = user || this.user;
    if (!u) return false;
    if (u.role === 'SUPERADMIN') return true;
    return this.permissionsOf(u).includes(perm);
  },

  canTab(tab) {
    const perm = this.TAB_PERM[tab];
    return perm ? this.can(perm) : false;
  },

  /* ¿Puede el usuario actual administrar a este otro usuario? */
  canManageUser(target) {
    const me = this.user;
    if (!me || !target) return false;
    if (me.role === 'SUPERADMIN') return true;
    if (me.role === 'ADMIN') return target.role === 'STAFF' && target.tenantId === me.tenantId;
    return false;
  }
};
