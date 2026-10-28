/* ==========================================================================
   Autenticación, sesión, roles y permisos · Supabase Auth (producción)
   --------------------------------------------------------------------------
   Roles:
     SUPERADMIN    → el sistema completo, todas las barberías.
     ADMINISTRADOR → solo su barbería. Base: citas, walk-in, servicios, barberos
                     y portafolio, usuarios del personal. Módulos extra solo si
                     el superadmin se los otorga (ver GRANTABLE).
     STAFF         → personal: panel, citas (ver/crear/cambiar estado) y walk-in.
                     Si está vinculado a un barbero, solo ve sus propias citas.
   Seguridad:
     - Contraseñas: las guarda y verifica Supabase Auth (nunca este código).
     - Intentos fallidos: Supabase Auth limita los intentos por IP.
     - Permisos: los aplica la base de datos (RLS). Lo de aquí solo decide
       qué botones y módulos se muestran.
     - Contraseñas olvidadas: las restablece el superadministrador (o el
       administrador, para su personal) con una contraseña temporal.
     - Sesión: máximo 8 h y cierre tras 60 min sin actividad.
   ========================================================================== */
const Auth = {
  SESSION_KEY: 'BARBERSUITE_SESSION',   // datos locales de la sesión (inicio y actividad); el mismo nombre lo revisan crm.html y reservalope.html al abrir
  SESSION_HOURS: 8,
  IDLE_MINUTES: 60,
  MAX_ATTEMPTS: 'Límite de Supabase Auth',
  LOCK_MINUTES: 'variable',
  user: null,
  session: null,

  ROLE_LABEL: { SUPERADMIN: 'Superadministrador', ADMIN: 'Administrador', STAFF: 'Personal' },

  // Módulos que el superadmin puede otorgar o quitar a cada administrador.
  // label y hint son plantillas del rubro (se pintan con UI.v / UI.vFor).
  GRANTABLE: [
    { key: 'sales', label: 'Ventas', hint: 'Ingresos, ticket promedio y ventas por {staff}.' },
    { key: 'customers', label: '{ClientPlural}', hint: 'Cartera de {clientPlural} y su historial.' },
    { key: 'reports', label: 'Reportes', hint: 'Reportes con filtros, exportables a PDF y Excel.' },
    { key: 'settings', label: 'Configuración', hint: 'Datos públicos {del:business} {business}, rubro, horario de atención y WhatsApp.' },
    { key: 'audit', label: 'Historial de actividad', hint: 'Registro de acciones de su {business}.' }
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
      'walkins.view', 'walkins.create', 'walkins.status'
    ]
  },

  GRANT_MAP: {
    sales: ['sales.view', 'finance.view'],
    customers: ['customers.view', 'customers.manage'],
    reports: ['reports.view'],
    settings: ['settings.manage'],
    audit: ['audit.view']
  },

  // Permisos que NO existen en producción (vaciar los datos, cargar datos demo)
  DISABLED: ['system.reset'],

  TAB_PERM: {
    'dashboard': 'dashboard.view',
    'appointments': 'appointments.view',
    'walkins': 'walkins.view',
    'barbers': 'barbers.manage',
    'sales': 'sales.view',
    'customers': 'customers.view',
    'services': 'services.manage',
    'reports': 'reports.view',
    'settings': 'settings.manage',
    'schedule': 'settings.manage',
    'whatsapp': 'settings.manage',
    'users': 'users.manage',
    'tenants': 'tenants.manage',
    'audit': 'audit.view'
  },

  defaultGrants() {
    const g = {};
    this.GRANTABLE.forEach(m => { g[m.key] = m.key !== 'audit'; }); // Historial: oculto hasta que el superadmin lo habilite
    return g;
  },

  validatePassword(pw) {
    if (!pw || pw.length < 8) return 'Debe tener al menos 8 caracteres.';
    if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Debe combinar letras y números.';
    return '';
  },

  sb() { return DB.client(); },

  /* ---------------- Usuarios (lista cargada por la capa de datos) ---------------- */
  findByEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    return DB.load().users.find(u => u.email === e) || null;
  },
  findById(id) { return DB.load().users.find(u => u.id === id) || null; },

  async fetchProfile(userId) {
    const { data, error } = await this.sb().from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw error;
    return data ? DB.fromProfile(data) : null;
  },

  async tenantStatus(tenantId) {
    if (!tenantId) return null;
    const { data } = await this.sb().from('tenants').select('status').eq('id', tenantId).maybeSingle();
    return data ? data.status : null;
  },

  /* ---------------- Login / sesión ---------------- */
  async login(email, password) {
    const generic = 'Correo o contraseña incorrectos.';
    let res;
    try {
      res = await this.sb().auth.signInWithPassword({ email: String(email || '').trim().toLowerCase(), password });
    } catch (e) {
      return { ok: false, error: DB.errorText(e) };
    }
    if (res.error) {
      const m = String(res.error.message || '');
      if (/banned/i.test(m)) return { ok: false, error: 'Tu usuario está desactivado. Contacta a tu administrador.' };
      if (res.error.status === 429 || /rate limit|too many/i.test(m)) return { ok: false, error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' };
      if (/Failed to fetch|network/i.test(m)) return { ok: false, error: DB.errorText(res.error) };
      return { ok: false, error: generic };
    }
    const authUser = res.data.user;
    let user;
    try { user = await this.fetchProfile(authUser.id); } catch (e) { user = null; }
    if (!user) {
      await this.sb().auth.signOut();
      return { ok: false, error: 'Tu cuenta no tiene un perfil asignado. Contacta al superadministrador.' };
    }
    if (!user.active) {
      await this.sb().auth.signOut();
      return { ok: false, error: 'Tu usuario está desactivado. Contacta a tu administrador.' };
    }
    // Con contraseña temporal la base niega cualquier acceso salvo leer el propio perfil
    // (ni siquiera la barbería): primero se cambia la clave y luego se verifica
    // la barbería al abrir el CRM (requireSession).
    if (!user.mustChangePassword && user.role !== 'SUPERADMIN' && (await this.tenantStatus(user.tenantId)) !== 'ACTIVE') {
      await this.sb().auth.signOut();
      return { ok: false, error: 'El negocio asociado a tu cuenta está suspendido. Contacta al superadministrador.' };
    }
    this.user = user;
    const now = Date.now();
    this.session = { userId: user.id, tenantId: user.tenantId || this.readSession()?.tenantId || null, loginAt: now, exp: now + this.SESSION_HOURS * 3600000, lastActive: now };
    this.writeSession();
    DB.mode = DB.mode || 'crm';
    if (!user.mustChangePassword) {
      this.sb().from('profiles').update({ last_login_at: new Date().toISOString() }).eq('id', user.id).then(() => {});
      DB.log('Inicio de sesión', 'Acceso al sistema.', { tenantId: user.tenantId });
    }
    return { ok: true, user };
  },

  /* Avisos del login: solo se envían CÓDIGOS (login.html?msg=código). La
     página de ingreso traduce cada código a su texto; nunca muestra texto
     libre de la URL. Códigos: expired · idle · noaccess · temp · suspended ·
     error · logout. Alias internos: inactive y noprofile → noaccess. */
  MSG_CODES: ['expired', 'idle', 'noaccess', 'temp', 'suspended', 'error', 'logout'],
  MSG_ALIAS: { inactive: 'noaccess', noprofile: 'noaccess' },
  msgCode(code) {
    const c = this.MSG_ALIAS[code] || code;
    return this.MSG_CODES.includes(c) ? c : '';
  },
  /* Enlace de ingreso de cada negocio (login.html?b=enlace): se recuerda para que, al
     cerrar sesión o expirar, el equipo vuelva a su login con marca. Sin él, el login
     usa la marca de Reservalope (ingreso del superadministrador). */
  LOGIN_BRAND_KEY: 'RESERVALOPE_LOGIN_BRAND',
  loginUrl(code) {
    const c = this.msgCode(code);
    let tab = '';
    try { tab = new URLSearchParams(window.location.search).get('tab') || ''; } catch (e) { tab = ''; }
    let brand = '';
    // En la consola de Reservalope (reservalope.html o su dirección limpia) el login es el del superadministrador
    try { brand = /\/(reservalope(\.html)?|admin)\/?$/.test(window.location.pathname) ? '' : (Routes.pathSlug() || localStorage.getItem(this.LOGIN_BRAND_KEY) || ''); } catch (e) { brand = ''; }
    if (!/^[a-z0-9-]{1,60}$/.test(brand)) brand = '';
    return Routes.login(brand, { msg: c, tab: tab });
  },

  writeSession() {
    try { localStorage.setItem(this.SESSION_KEY, JSON.stringify(this.session)); } catch (e) { /* sin almacenamiento */ }
  },
  readSession() {
    try { return JSON.parse(localStorage.getItem(this.SESSION_KEY) || 'null'); } catch (e) { return null; }
  },

  // reason: código del aviso (ver MSG_CODES). Sin código = salida manual.
  async logout(reason) {
    const code = this.msgCode(reason) || 'logout';
    if (this.user && code !== 'expired' && reason !== 'inactive' && reason !== 'noprofile') {
      DB.log('Cierre de sesión', code === 'idle' ? 'Cierre por inactividad.' : (code === 'logout' ? 'Salida manual.' : 'Sesión cerrada (' + code + ').'));
    }
    try { await this.sb().auth.signOut(); } catch (e) { /* sin conexión */ }
    try { localStorage.removeItem(this.SESSION_KEY); } catch (e) { /* sin almacenamiento */ }
    this.user = null;
    this.session = null;
    window.location.replace(this.loginUrl(code));
  },

  /* Verifica la sesión al abrir el CRM o Reservalope. Devuelve el usuario o redirige al login. */
  async requireSession() {
    const fail = async (code) => {
      try { await this.sb().auth.signOut(); } catch (e) { /* sin conexión */ }
      try { localStorage.removeItem(this.SESSION_KEY); } catch (e) { /* sin almacenamiento */ }
      window.location.replace(this.loginUrl(code));
      return null;
    };
    const { data } = await this.sb().auth.getSession();
    const s = this.readSession();
    if (!data || !data.session) return fail(s ? 'expired' : '');
    if (!s || s.userId !== data.session.user.id) return fail('');
    if (Date.now() > s.exp) return fail('expired');
    if (Date.now() - (s.lastActive || 0) > this.IDLE_MINUTES * 60000) return fail('idle');
    let user;
    try { user = await this.fetchProfile(s.userId); } catch (e) { return fail(DB.isAuthError(e) ? 'expired' : 'error'); }
    if (!user) return fail('noprofile');
    if (!user.active) return fail('inactive');
    if (user.mustChangePassword) return fail('temp');
    if (user.role !== 'SUPERADMIN') {
      if ((await this.tenantStatus(user.tenantId)) !== 'ACTIVE') return fail('suspended');
      s.tenantId = user.tenantId; // un administrador o personal nunca puede cambiar de barbería
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
      if (!s || Date.now() > s.exp) return this.logout('expired');
      if (Date.now() - (s.lastActive || 0) > this.IDLE_MINUTES * 60000) this.logout('idle');
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

  /* ---------------- Contraseña propia ---------------- */
  // Primer ingreso (contraseña temporal) o cambio voluntario desde "Mi cuenta"
  async changeOwnPassword(newPassword, currentPassword) {
    const v = this.validatePassword(newPassword);
    if (v) return { ok: false, error: v };
    const sb = this.sb();
    const { data: sess } = await sb.auth.getSession();
    if (!sess || !sess.session) return { ok: false, error: 'Tu sesión expiró. Vuelve a ingresar.' };
    if (currentPassword !== undefined) {
      if (currentPassword === newPassword) return { ok: false, error: 'La nueva contraseña debe ser distinta a la actual.' };
      const check = await sb.auth.signInWithPassword({ email: sess.session.user.email, password: currentPassword });
      if (check.error) return { ok: false, error: 'La contraseña actual no es correcta.' };
    }
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) {
      const m = String(error.message || '');
      if (/different|same/i.test(m)) return { ok: false, error: 'La nueva contraseña debe ser distinta a la temporal.' };
      if (/weak|short|characters/i.test(m)) return { ok: false, error: 'La contraseña es muy débil. Usa al menos 8 caracteres con letras y números.' };
      return { ok: false, error: DB.errorText(error) };
    }
    // Solo el servidor puede quitar la marca de "contraseña temporal": la RPC
    // comprueba que la clave realmente cambió. Hasta entonces la base niega
    // cualquier acceso (salvo leer el propio perfil), así que no se sigue sin ella.
    const wasTemp = !this.user || this.user.mustChangePassword || currentPassword === undefined;
    if (wasTemp) {
      const upd = await sb.rpc('perfil_contrasena_cambiada');
      if (upd.error) {
        return { ok: false, error: 'Tu contraseña se cambió, pero el sistema aún no habilitó tu cuenta (' + DB.errorText(upd.error) + '). Vuelve a ingresar con la nueva contraseña.' };
      }
    }
    if (this.user) this.user.mustChangePassword = false;
    return { ok: true };
  },

  /* ---------------- Administración de usuarios (Edge Function) ---------------- */
  async adminCall(payload) {
    const { data, error } = await this.sb().functions.invoke('admin-usuarios', { body: payload });
    if (error) throw new Error(await DB.functionError(error));
    if (!data || data.error) throw new Error((data && data.error) || 'No se pudo completar la acción.');
    const u = DB.fromProfile(data.user);
    const list = DB.load().users;
    const i = list.findIndex(x => x.id === u.id);
    if (i > -1) list[i] = u; else list.push(u);
    return { user: u, temp: data.temp_password || null };
  },
  createUser(data) {
    return this.adminCall({ action: 'create', name: data.name, email: data.email, role: data.role, tenant_id: data.tenantId || null, barber_id: data.barberId || null });
  },
  resetPassword(userId) { return this.adminCall({ action: 'reset_password', user_id: userId }); },
  updateUser(userId, patch) {
    const p = { action: 'update', user_id: userId };
    if ('name' in patch) p.name = patch.name;
    if ('email' in patch) p.email = patch.email;
    if ('role' in patch) p.role = patch.role;
    if ('tenantId' in patch) p.tenant_id = patch.tenantId;
    if ('barberId' in patch) p.barber_id = patch.barberId;
    if ('active' in patch) p.active = patch.active;
    if ('grants' in patch) p.grants = patch.grants;
    return this.adminCall(p);
  },

  /* ---------------- Permisos ---------------- */
  featureOn(perm) {
    return !this.DISABLED.includes(perm);
  },

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
    if (!u || !this.featureOn(perm)) return false;
    // Módulo oculto por el superadministrador en este negocio (crm_config.modules): no existe para nadie
    if (window.CrmConfig && typeof DB !== 'undefined' && DB.tenant && !CrmConfig.permAllowed(perm)) return false;
    if (u.role === 'SUPERADMIN') return true;
    return this.permissionsOf(u).includes(perm);
  },

  canTab(tab) {
    const perm = this.TAB_PERM[tab];
    if (window.CrmConfig && typeof DB !== 'undefined' && DB.tenant && !CrmConfig.tabAllowed(tab)) return false;
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
