/* ==========================================================================
   Administración: usuarios, permisos, barberías, historial y cuenta
   ========================================================================== */
const AdminUI = {
  auditLimit: 200,

  init() {
    this.renderHeader();
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('user-dropdown');
      const btn = document.getElementById('user-menu-btn');
      if (menu && !menu.hidden && !menu.contains(e.target) && btn && !btn.contains(e.target)) this.toggleUserMenu(false);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.toggleUserMenu(false); });
  },

  renderAll() {
    this.renderUsers();
    this.renderTenants();
    this.renderAudit();
  },

  initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('') || '?';
  },

  roleBadge(role) {
    const cls = role === 'SUPERADMIN' ? 'role-super' : (role === 'ADMIN' ? 'role-admin' : 'role-staff');
    return '<span class="role-badge ' + cls + '">' + UI.esc(Auth.ROLE_LABEL[role] || role) + '</span>';
  },

  /* ---------------- Encabezado: usuario y barbería ---------------- */
  renderHeader() {
    const u = Auth.user;
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    set('user-avatar', this.initials(u.name));
    set('user-name', u.name);
    set('user-role', Auth.ROLE_LABEL[u.role]);
    set('user-email', u.email);
    set('crm-sidebar-role', Auth.ROLE_LABEL[u.role] + (DB.linkedBarberName() ? ' · ' + DB.linkedBarberName() : ''));

    const sw = document.getElementById('tenant-switcher');
    if (sw && u.role === 'SUPERADMIN' && DB.tenant) {
      sw.innerHTML = DB.load().tenants.map(t =>
        '<option value="' + UI.esc(t.id) + '"' + (t.id === DB.tenant.id ? ' selected' : '') + '>' +
        UI.esc(t.name) + (t.status !== 'ACTIVE' ? ' (suspendida)' : '') + '</option>'
      ).join('');
    }
  },

  toggleUserMenu(force) {
    const menu = document.getElementById('user-dropdown');
    const btn = document.getElementById('user-menu-btn');
    if (!menu || !btn) return;
    const open = typeof force === 'boolean' ? force : menu.hidden;
    menu.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  },

  switchTenant(tenantId) {
    if (!Auth.switchTenant(tenantId)) return;
    const t = DB.tenantById(tenantId);
    DB.log('Cambió de barbería', 'Ahora administra: ' + t.name, { tenantId });
    window.location.href = 'crm.html?tab=dashboard';
  },

  /* ---------------- Cuenta: cambiar contraseña ---------------- */
  openChangePassword() {
    this.toggleUserMenu(false);
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Mi cuenta</span><h3>Cambiar contraseña</h3></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="AdminUI.saveChangePassword(event)" novalidate>' +
        '<div class="form-stack">' +
          '<div><label class="field-lbl" for="cp-current">Contraseña actual</label><input type="password" id="cp-current" class="input-dark" autocomplete="current-password" required /></div>' +
          '<div><label class="field-lbl" for="cp-new">Nueva contraseña</label><input type="password" id="cp-new" class="input-dark" autocomplete="new-password" required />' +
            '<span class="field-hint">Mínimo 8 caracteres, con letras y números.</span></div>' +
          '<div><label class="field-lbl" for="cp-new2">Repetir nueva contraseña</label><input type="password" id="cp-new2" class="input-dark" autocomplete="new-password" required /></div>' +
        '</div>' +
        '<div class="form-error" id="cp-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="ModalComponent.close()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + 'Guardar</button></div>' +
      '</form>'
    );
  },

  async saveChangePassword(e) {
    e.preventDefault();
    const err = document.getElementById('cp-error');
    err.textContent = '';
    const cur = document.getElementById('cp-current').value;
    const n1 = document.getElementById('cp-new').value;
    const n2 = document.getElementById('cp-new2').value;
    const v = Auth.validatePassword(n1);
    if (v) { err.textContent = v; return; }
    if (n1 !== n2) { err.textContent = 'Las contraseñas nuevas no coinciden.'; return; }
    const res = await Auth.changeOwnPassword(n1, cur);
    if (!res.ok) { err.textContent = res.error; return; }
    DB.log('Cambió su contraseña', 'Cambio voluntario desde Mi cuenta.');
    ModalComponent.close();
    UI.toast('Contraseña actualizada.');
  },

  /* ==================================================================
     USUARIOS
     ================================================================== */
  visibleUsers() {
    const me = Auth.user;
    const all = DB.load().users;
    if (me.role === 'SUPERADMIN') {
      const f = (document.getElementById('usr-filter-tenant') || {}).value || 'ALL';
      return all.filter(u => f === 'ALL' || (f === 'NONE' ? !u.tenantId : u.tenantId === f));
    }
    if (me.role === 'ADMIN') return all.filter(u => u.tenantId === me.tenantId && (u.role === 'STAFF' || u.id === me.id));
    return [];
  },

  userStatus(u) {
    if (!u.active) return '<span class="st-badge st-CANCELADA">Desactivado</span>';
    if (u.lockedUntil && u.lockedUntil > Date.now()) return '<span class="st-badge st-CANCELADA">Bloqueado</span>';
    if (u.mustChangePassword) return '<span class="st-badge st-PROGRAMADA">Contraseña temporal</span>';
    return '<span class="st-badge st-COMPLETADA">Activo</span>';
  },

  renderUsers() {
    const tbody = document.getElementById('users-tbody');
    if (!tbody || !Auth.can('users.manage')) return;
    const me = Auth.user;

    const ft = document.getElementById('usr-filter-tenant');
    if (ft && me.role === 'SUPERADMIN') {
      const cur = ft.value || (DB.tenant ? DB.tenant.id : 'ALL');
      ft.innerHTML = '<option value="ALL">Todas las barberías</option><option value="NONE">Superadministradores</option>' +
        DB.load().tenants.map(t => '<option value="' + UI.esc(t.id) + '">' + UI.esc(t.name) + '</option>').join('');
      ft.value = cur;
    }
    const q = ((document.getElementById('usr-search') || {}).value || '').trim().toLowerCase();
    const list = this.visibleUsers().filter(u => !q || (u.name + ' ' + u.email).toLowerCase().includes(q));

    const sub = document.getElementById('users-lead');
    if (sub) sub.textContent = me.role === 'SUPERADMIN'
      ? 'Crea administradores y personal para cualquier barbería, y define qué módulos puede usar cada administrador.'
      : 'Crea y administra las cuentas del personal de ' + (DB.tenant ? DB.tenant.name : 'tu barbería') + '. Solo tendrán acceso a esta barbería.';

    if (!list.length) {
      tbody.innerHTML = '<tr class="is-empty"><td colspan="7"><div class="empty-state">' + ic('users') + '<strong>Sin usuarios</strong>Crea el primero con “Nuevo usuario”.</div></td></tr>';
      return;
    }

    tbody.innerHTML = list.map(u => {
      const t = u.tenantId ? DB.tenantById(u.tenantId) : null;
      const st = u.tenantId ? DB.load().data[u.tenantId] : null;
      const bp = (u.barberId && st) ? st.barberProfiles.find(b => b.id === u.barberId) : null;
      const isMe = u.id === me.id;
      const manage = Auth.canManageUser(u) && !isMe;
      const actions = [];
      if (manage) actions.push('<button type="button" class="btn-dark btn-xs" onclick="AdminUI.openUserModal(\'' + u.id + '\')">' + ic('edit') + 'Editar</button>');
      if (manage && u.role === 'ADMIN' && me.role === 'SUPERADMIN') actions.push('<button type="button" class="btn-dark btn-xs" onclick="AdminUI.openPermissions(\'' + u.id + '\')">' + ic('shield') + 'Permisos</button>');
      if (manage) actions.push('<button type="button" class="btn-dark btn-xs" onclick="AdminUI.resetPassword(\'' + u.id + '\')" title="Restablecer contraseña">' + ic('refresh') + 'Clave</button>');
      if (manage) actions.push(u.active
        ? '<button type="button" class="btn-danger btn-xs" onclick="AdminUI.toggleActive(\'' + u.id + '\')">Desactivar</button>'
        : '<button type="button" class="btn-golden btn-xs" onclick="AdminUI.toggleActive(\'' + u.id + '\')">Activar</button>');
      if (isMe) actions.push('<span class="text-grey" style="font-size:0.8rem;">Tu cuenta</span>');

      return '<tr>' +
        '<td data-label="Usuario"><div class="user-cell"><span class="user-avatar sm">' + UI.esc(this.initials(u.name)) + '</span><div><strong>' + UI.esc(u.name) + '</strong><br/><span class="text-grey" style="font-size:0.8rem;">' + UI.esc(u.email) + '</span></div></div></td>' +
        '<td data-label="Rol">' + this.roleBadge(u.role) + '</td>' +
        '<td data-label="Barbería">' + (t ? UI.esc(t.name) : '<span class="text-grey">Todas</span>') + '</td>' +
        '<td data-label="Barbero">' + (u.role === 'STAFF' ? (bp ? UI.esc(bp.name) : '<span class="text-grey">Sin vínculo</span>') : '<span class="text-grey">—</span>') + '</td>' +
        '<td data-label="Estado">' + this.userStatus(u) + '</td>' +
        '<td data-label="Último acceso">' + (u.lastLoginAt ? UI.esc(UI.fmtDateTime(u.lastLoginAt)) : '<span class="text-grey">Nunca</span>') + '</td>' +
        '<td data-label="Acciones"><div class="row-actions user-actions">' + actions.join('') + '</div></td>' +
      '</tr>';
    }).join('');
  },

  barberOptions(tenantId, selected) {
    const st = DB.load().data[tenantId];
    const list = st ? st.barberProfiles : [];
    return '<option value="">Sin vínculo — ve todas las citas (ej. recepción)</option>' +
      list.map(b => '<option value="' + UI.esc(b.id) + '"' + (b.id === selected ? ' selected' : '') + '>' + UI.esc(b.name) + '</option>').join('');
  },

  openUserModal(editId) {
    const me = Auth.user;
    const u = editId ? Auth.findById(editId) : null;
    if (u && !Auth.canManageUser(u)) return Guard.deny();
    const isSuper = me.role === 'SUPERADMIN';
    const role = u ? u.role : (isSuper ? 'ADMIN' : 'STAFF');
    const fallbackTenant = DB.tenant ? DB.tenant.id : ((DB.activeTenants()[0] || DB.load().tenants[0]) || {}).id;
    const tenantId = u ? (u.tenantId || fallbackTenant) : fallbackTenant;

    const roleField = isSuper
      ? '<div><label class="field-lbl" for="m-us-role">Rol <span class="req">*</span></label><select id="m-us-role" class="input-dark" onchange="AdminUI.onUserRoleChange()"' + (u && u.id === me.id ? ' disabled' : '') + '>' +
          ['ADMIN', 'STAFF', 'SUPERADMIN'].map(r => '<option value="' + r + '"' + (r === role ? ' selected' : '') + '>' + Auth.ROLE_LABEL[r] + '</option>').join('') +
        '</select></div>'
      : '<input type="hidden" id="m-us-role" value="STAFF" />';

    const tenantField = isSuper
      ? '<div id="m-us-tenant-wrap"><label class="field-lbl" for="m-us-tenant">Barbería <span class="req">*</span></label><select id="m-us-tenant" class="input-dark" onchange="AdminUI.onUserTenantChange()">' +
          DB.load().tenants.map(t => '<option value="' + UI.esc(t.id) + '"' + (t.id === tenantId ? ' selected' : '') + '>' + UI.esc(t.name) + '</option>').join('') +
        '</select></div>'
      : '<input type="hidden" id="m-us-tenant" value="' + UI.esc(me.tenantId) + '" />';

    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">' + (u ? 'Editar usuario' : 'Nuevo usuario') + '</span><h3>' + (u ? UI.esc(u.name) : (isSuper ? 'Crear cuenta' : 'Crear cuenta del personal')) + '</h3></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="AdminUI.saveUser(event, ' + (u ? '\'' + u.id + '\'' : 'null') + ')" novalidate>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-us-name">Nombre completo <span class="req">*</span></label><input type="text" id="m-us-name" class="input-dark" value="' + UI.esc(u ? u.name : '') + '" required /></div>' +
          '<div><label class="field-lbl" for="m-us-email">Correo (usuario de acceso) <span class="req">*</span></label><input type="email" id="m-us-email" class="input-dark" value="' + UI.esc(u ? u.email : '') + '" autocomplete="off" required /></div>' +
          roleField + tenantField +
          '<div id="m-us-barber-wrap" style="grid-column:1 / -1;"><label class="field-lbl" for="m-us-barber">Barbero vinculado</label><select id="m-us-barber" class="input-dark">' + this.barberOptions(tenantId, u ? u.barberId : null) + '</select>' +
            '<span class="field-hint">Si lo vinculas, este usuario solo verá sus propias citas.</span></div>' +
        '</div>' +
        (u ? '' : '<p class="form-note">' + ic('lock') + 'Se generará una <strong>contraseña temporal</strong> que deberá cambiar en su primer ingreso.</p>') +
        '<div class="form-error" id="m-us-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="ModalComponent.close()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + (u ? 'Guardar cambios' : 'Crear usuario') + '</button></div>' +
      '</form>'
    );
    this.onUserRoleChange();
  },

  onUserRoleChange() {
    const role = (document.getElementById('m-us-role') || {}).value;
    const bw = document.getElementById('m-us-barber-wrap');
    const tw = document.getElementById('m-us-tenant-wrap');
    if (bw) bw.style.display = role === 'STAFF' ? '' : 'none';
    if (tw) tw.style.display = role === 'SUPERADMIN' ? 'none' : '';
  },

  onUserTenantChange() {
    const tid = document.getElementById('m-us-tenant').value;
    document.getElementById('m-us-barber').innerHTML = this.barberOptions(tid, null);
  },

  async saveUser(e, editId) {
    e.preventDefault();
    const me = Auth.user;
    const err = document.getElementById('m-us-error');
    err.textContent = '';
    const name = document.getElementById('m-us-name').value.trim();
    const email = document.getElementById('m-us-email').value.trim().toLowerCase();
    let role = document.getElementById('m-us-role').value;
    let tenantId = document.getElementById('m-us-tenant').value;
    const barberId = role === 'STAFF' ? (document.getElementById('m-us-barber').value || null) : null;

    // Reglas de negocio (también las vuelve a validar el servidor)
    if (me.role === 'ADMIN') { role = 'STAFF'; tenantId = me.tenantId; }
    if (me.role !== 'SUPERADMIN' && me.role !== 'ADMIN') return Guard.deny();
    if (!name) { err.textContent = 'Escribe el nombre.'; return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { err.textContent = 'Escribe un correo válido.'; return; }
    const dup = Auth.findByEmail(email);
    if (dup && dup.id !== editId) { err.textContent = 'Ya existe un usuario con ese correo.'; return; }
    if (role !== 'SUPERADMIN' && !DB.tenantById(tenantId)) { err.textContent = 'Selecciona una barbería.'; return; }

    const btn = e.target.querySelector('button[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      if (editId) {
        const u = Auth.findById(editId);
        if (!u || !Auth.canManageUser(u)) return Guard.deny();
        const patch = { name, email, barberId };
        if (me.role === 'SUPERADMIN' && u.id !== me.id) { patch.role = role; patch.tenantId = role === 'SUPERADMIN' ? null : tenantId; }
        const res = await Auth.updateUser(editId, patch);
        DB.log('Editó un usuario', name + ' (' + email + ') · ' + Auth.ROLE_LABEL[res.user.role], { tenantId: res.user.tenantId });
        ModalComponent.close();
        UI.toast('Usuario actualizado.');
        this.renderUsers();
        return;
      }
      const res = await Auth.createUser({ name, email, role, tenantId, barberId });
      this.renderUsers();
      this.showCredentials(res.user, res.temp, 'Usuario creado');
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  showCredentials(user, temp, title) {
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">' + UI.esc(title) + '</span><h3>Entrega estos datos a ' + UI.esc(user.name) + '</h3></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<div class="cred-box">' +
        '<div><span>Correo</span><strong>' + UI.esc(user.email) + '</strong></div>' +
        '<div><span>Contraseña temporal</span><strong class="cred-pass">' + UI.esc(temp) + '</strong></div>' +
      '</div>' +
      '<p class="form-note">' + ic('alert') + 'Esta contraseña se muestra <strong>solo una vez</strong>. Al ingresar, el sistema le pedirá crear una nueva.</p>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn-dark" onclick="UI.copy(\'' + UI.arg('Correo: ' + user.email + '\nContraseña temporal: ' + temp) + '\', \'Datos copiados.\')">' + ic('file') + 'Copiar datos</button>' +
        '<button type="button" class="btn-golden" onclick="ModalComponent.close()">Listo</button>' +
      '</div>'
    );
  },

  resetPassword(id) {
    const u = Auth.findById(id);
    if (!u || !Auth.canManageUser(u) || u.id === Auth.user.id) return Guard.deny();
    UI.confirm({
      title: 'Restablecer contraseña',
      message: 'Se generará una contraseña temporal para ' + u.name + '. Su contraseña actual dejará de funcionar y deberá crear una nueva al ingresar.',
      confirmText: 'Restablecer'
    }).then(async ok => {
      if (!ok) return;
      try {
        const res = await Auth.resetPassword(id);
        this.renderUsers();
        this.showCredentials(res.user, res.temp, 'Contraseña restablecida');
      } catch (ex) { UI.toast(ex.message, 'error'); }
    });
  },

  toggleActive(id) {
    const u = Auth.findById(id);
    if (!u || !Auth.canManageUser(u) || u.id === Auth.user.id) return Guard.deny();
    if (u.active && u.role === 'SUPERADMIN') {
      const others = DB.load().users.filter(x => x.role === 'SUPERADMIN' && x.active && x.id !== u.id);
      if (!others.length) return UI.toast('Debe quedar al menos un superadministrador activo.', 'error');
    }
    const activating = !u.active;
    UI.confirm({
      title: activating ? 'Activar usuario' : 'Desactivar usuario',
      message: activating
        ? u.name + ' podrá volver a ingresar al CRM.'
        : u.name + ' ya no podrá ingresar. Su historial se conserva y puedes reactivarlo cuando quieras.',
      confirmText: activating ? 'Activar' : 'Desactivar',
      danger: !activating
    }).then(async ok => {
      if (!ok) return;
      try {
        await Auth.updateUser(id, { active: activating });
        DB.log(activating ? 'Activó un usuario' : 'Desactivó un usuario', u.name + ' (' + u.email + ')', { tenantId: u.tenantId });
        this.renderUsers();
        UI.toast(activating ? 'Usuario activado.' : 'Usuario desactivado.');
      } catch (ex) { UI.toast(ex.message, 'error'); }
    });
  },

  /* ---------------- Permisos por módulo (solo superadmin → administradores) ---------------- */
  openPermissions(id) {
    const u = Auth.findById(id);
    if (!u || u.role !== 'ADMIN' || Auth.user.role !== 'SUPERADMIN') return Guard.deny();
    const g = u.grants || {};
    const base = ['Panel principal', 'Citas (ver, crear, cambiar estado, eliminar)', 'Walk-in', 'Servicios', 'Barberos y portafolio', 'Usuarios del personal de su barbería'];
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Permisos de administrador</span><h3>' + UI.esc(u.name) + '</h3></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="AdminUI.savePermissions(event, \'' + u.id + '\')">' +
        '<p class="perm-section-title">Incluido siempre</p>' +
        '<ul class="perm-base">' + base.map(b => '<li>' + ic('check') + UI.esc(b) + '</li>').join('') + '</ul>' +
        '<p class="perm-section-title">Módulos que puedes otorgar</p>' +
        '<div class="perm-list">' + Auth.GRANTABLE.map(m =>
          '<label class="perm-toggle"><input type="checkbox" id="perm-' + m.key + '"' + (g[m.key] ? ' checked' : '') + ' />' +
          '<span class="perm-switch" aria-hidden="true"></span>' +
          '<span class="perm-text"><strong>' + UI.esc(m.label) + '</strong><small>' + UI.esc(m.hint) + '</small></span></label>'
        ).join('') + '</div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="ModalComponent.close()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + 'Guardar permisos</button></div>' +
      '</form>'
    );
  },

  async savePermissions(e, id) {
    e.preventDefault();
    const u = Auth.findById(id);
    if (!u || u.role !== 'ADMIN' || Auth.user.role !== 'SUPERADMIN') return Guard.deny();
    const before = Object.assign({}, u.grants || {});
    const g = Object.assign({}, before);
    Auth.GRANTABLE.forEach(m => { g[m.key] = document.getElementById('perm-' + m.key).checked; });
    try {
      await Auth.updateUser(id, { grants: g });
    } catch (ex) { UI.toast(ex.message, 'error'); return; }
    const changes = Auth.GRANTABLE.filter(m => !!before[m.key] !== g[m.key]).map(m => (g[m.key] ? '+' : '−') + m.label);
    DB.log('Cambió permisos de un administrador', u.name + ': ' + (changes.length ? changes.join(', ') : 'sin cambios'), { tenantId: u.tenantId });
    ModalComponent.close();
    UI.toast('Permisos actualizados. Se aplican en su próximo ingreso o al recargar.');
    this.renderUsers();
  },

  /* ==================================================================
     BARBERÍAS (solo superadmin)
     ================================================================== */
  renderTenants() {
    const grid = document.getElementById('tenants-grid');
    if (!grid || !Auth.can('tenants.manage')) return;
    const root = DB.load();
    grid.innerHTML = root.tenants.map(t => {
      const st = root.data[t.id] || {};
      const users = root.users.filter(u => u.tenantId === t.id);
      const active = t.status === 'ACTIVE';
      const isCurrent = DB.tenant && DB.tenant.id === t.id;
      return '<article class="tenant-card' + (active ? '' : ' is-suspended') + '" style="--t-accent:' + UI.esc(t.accent || '#D79848') + ';">' +
        '<div class="tenant-card-brand">' + TenantBrand.logoHTML(t, 'tenant-logo') + '</div>' +
        '<div class="tenant-card-body">' +
          '<div class="tenant-card-top"><h3>' + UI.esc(t.name) + '</h3>' +
            (active ? '<span class="st-badge st-COMPLETADA">Activa</span>' : '<span class="st-badge st-CANCELADA">Suspendida</span>') + '</div>' +
          '<a class="tenant-link" href="index.html?b=' + encodeURIComponent(t.slug) + '" target="_blank" rel="noopener">' + ic('external') + 'index.html?b=' + UI.esc(t.slug) + '</a>' +
          '<ul class="tenant-stats">' +
            '<li><strong>' + (st.barberProfiles || []).length + '</strong>barberos</li>' +
            '<li><strong>' + users.length + '</strong>usuarios</li>' +
            '<li><strong>' + (st.appointments || []).length + '</strong>citas</li>' +
          '</ul>' +
          '<p class="tenant-meta">' + ic('pin') + UI.esc(t.address || 'Sin dirección') + ' · ' + UI.esc(t.phone || 'Sin teléfono') + '</p>' +
          '<div class="row-actions">' +
            (isCurrent ? '<span class="tenant-current">' + ic('checkCircle') + 'Estás aquí</span>' : '<button type="button" class="btn-golden btn-xs" onclick="AdminUI.switchTenant(\'' + t.id + '\')">' + ic('arrowRight') + 'Entrar al CRM</button>') +
            '<button type="button" class="btn-dark btn-xs" onclick="AdminUI.openTenantModal(\'' + t.id + '\')">' + ic('edit') + 'Editar</button>' +
            (active
              ? '<button type="button" class="btn-danger btn-xs" onclick="AdminUI.toggleTenant(\'' + t.id + '\')">Suspender</button>'
              : '<button type="button" class="btn-golden btn-xs" onclick="AdminUI.toggleTenant(\'' + t.id + '\')">Reactivar</button>') +
          '</div>' +
        '</div>' +
      '</article>';
    }).join('');
  },

  openTenantModal(editId) {
    if (!Auth.can('tenants.manage')) return Guard.deny();
    const t = editId ? DB.tenantById(editId) : null;
    const v = (k, d) => UI.esc(t && t[k] != null && t[k] !== '' ? t[k] : (d || ''));
    const pal = t ? TenantBrand.paletteOf(t) : Object.assign({}, TenantBrand.DEFAULT_PALETTE);
    const plan = t ? t.plan : 'PRO';
    this._tenantLogo = t ? (t.logo || '') : '';
    const colorRow = (key, label, hint) =>
      '<div class="palette-row">' +
        '<label class="field-lbl" for="m-tn-' + key + '">' + label + '</label>' +
        '<div class="color-field"><input type="color" id="m-tn-' + key + '" value="' + UI.esc(pal[key]) + '" oninput="AdminUI.onPaletteInput(\'' + key + '\')" aria-describedby="m-tn-' + key + '-hint" />' +
        '<input type="text" id="m-tn-' + key + '-hex" class="input-dark" value="' + UI.esc(pal[key].toUpperCase()) + '" maxlength="7" aria-label="' + label + ' en hexadecimal" oninput="AdminUI.onPaletteInput(\'' + key + '\', true)" /></div>' +
        '<span class="field-hint" id="m-tn-' + key + '-hint">' + hint + '</span>' +
      '</div>';

    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">' + (t ? 'Editar barbería' : 'Nueva barbería') + '</span><h3>' + (t ? UI.esc(t.name) : 'Datos, marca y suscripción') + '</h3></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="AdminUI.saveTenant(event, ' + (t ? '\'' + t.id + '\'' : 'null') + ')" novalidate>' +
        '<p class="perm-section-title">Identidad</p>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-tn-name">Nombre de la barbería <span class="req">*</span></label><input type="text" id="m-tn-name" class="input-dark" value="' + v('name') + '" oninput="AdminUI.onTenantNameInput()" required /></div>' +
          '<div><label class="field-lbl" for="m-tn-slug">Enlace público <span class="req">*</span></label>' +
            '<div class="input-prefix"><span>?b=</span><input type="text" id="m-tn-slug" class="input-dark" value="' + v('slug') + '" data-touched="' + (t ? '1' : '') + '" oninput="this.dataset.touched=\'1\'" required /></div>' +
            '<span class="field-hint">Solo minúsculas, números y guiones.</span></div>' +
          '<div><label class="field-lbl" for="m-tn-owner">Propietario</label><input type="text" id="m-tn-owner" class="input-dark" value="' + v('ownerName') + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-currency">Moneda</label><select id="m-tn-currency" class="input-dark">' +
            ['S/', '$', '€'].map(c => '<option value="' + c + '"' + ((t ? t.currency : 'S/') === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
        '</div>' +

        '<p class="perm-section-title">Paleta de colores</p>' +
        '<div class="palette-grid">' +
          '<div class="palette-fields">' +
            colorRow('primary', 'Primario · fondo', 'Color dominante (60%): fondos, encabezado y pie. Debe ser oscuro.') +
            colorRow('secondary', 'Secundario · acento', 'Botones, enlaces y destacados (10%).') +
            colorRow('tertiary', 'Terciario · texto', 'Textos y secciones claras (30%). Debe ser claro.') +
          '</div>' +
          '<div class="palette-preview" id="m-tn-preview" aria-label="Vista previa de la paleta">' +
            '<div class="pp-header"><span class="pp-logo">' + (t ? UI.esc(t.name) : 'Tu barbería') + '</span><span class="pp-cta">Reservar</span></div>' +
            '<div class="pp-hero"><span class="pp-eyebrow">Servicios</span><strong>Estilo impecable</strong><small>Cortes, barba y grooming.</small><span class="pp-btn">Reservar cita</span></div>' +
            '<div class="pp-light"><strong>Corte clásico</strong><small>S/ 32 · 30 min</small></div>' +
          '</div>' +
        '</div>' +
        '<ul class="palette-checks" id="m-tn-checks"></ul>' +

        '<p class="perm-section-title">Logo</p>' +
        '<div class="logo-upload"><div class="logo-preview" id="m-tn-logo-preview">' + (t ? TenantBrand.logoHTML(t, 'tenant-logo') : '<span class="brand-wordmark">Sin logo</span>') + '</div>' +
          '<div class="logo-actions"><button type="button" class="btn-dark btn-xs" onclick="document.getElementById(\'m-tn-logo-file\').click()">' + ic('upload') + 'Subir</button>' +
          '<button type="button" class="btn-dark btn-xs" onclick="AdminUI.clearTenantLogo()">Quitar</button></div>' +
          '<input type="file" id="m-tn-logo-file" accept="image/*" hidden onchange="AdminUI.onTenantLogo(this)" /></div>' +
        '<span class="field-hint">Ideal horizontal, con fondo del color primario o transparente. Sin logo se muestra el nombre.</span>' +

        '<p class="perm-section-title">Contacto público (web)</p>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-tn-address">Dirección</label><input type="text" id="m-tn-address" class="input-dark" value="' + v('address') + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-phone">Teléfono / WhatsApp</label><input type="tel" id="m-tn-phone" class="input-dark" value="' + v('phone') + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-hours">Horario</label><input type="text" id="m-tn-hours" class="input-dark" value="' + v('hours', 'Citas de 9:00 a 20:00') + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-city">Ciudad</label><input type="text" id="m-tn-city" class="input-dark" value="' + v('city', 'Lima, Perú') + '" /></div>' +
        '</div>' +

        '<p class="perm-section-title">Suscripción y contacto del dueño (privado)</p>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-tn-plan">Plan</label><select id="m-tn-plan" class="input-dark" onchange="AdminUI.onPlanChange()">' +
            Object.keys(DB.PLANS).map(k => '<option value="' + k + '"' + (plan === k ? ' selected' : '') + '>' + DB.PLANS[k].label + '</option>').join('') + '</select></div>' +
          '<div><label class="field-lbl" for="m-tn-fee">Monto mensual (S/)</label><input type="number" id="m-tn-fee" class="input-dark" min="0" step="1" value="' + v('planFee', DB.PLANS[plan].fee) + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-end">Vence el</label><input type="date" id="m-tn-end" class="input-dark" value="' + v('subscriptionEnd', DB.addDays(DB.todayISO(), 30)) + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-oemail">Correo del dueño</label><input type="email" id="m-tn-oemail" class="input-dark" value="' + v('ownerEmail') + '" /></div>' +
          '<div><label class="field-lbl" for="m-tn-ophone">Teléfono del dueño</label><input type="tel" id="m-tn-ophone" class="input-dark" value="' + v('ownerPhone') + '" /></div>' +
        '</div>' +

        '<div class="form-error" id="m-tn-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="ModalComponent.close()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + (t ? 'Guardar cambios' : 'Crear barbería') + '</button></div>' +
      '</form>',
      { wide: true }
    );
    this.updatePalettePreview();
  },

  onTenantNameInput() {
    const slug = document.getElementById('m-tn-slug');
    if (slug && !slug.dataset.touched) slug.value = DB.slugify(document.getElementById('m-tn-name').value);
    const logo = document.querySelector('#m-tn-preview .pp-logo');
    if (logo) logo.textContent = document.getElementById('m-tn-name').value || 'Tu barbería';
  },

  onPlanChange() {
    const plan = document.getElementById('m-tn-plan').value;
    document.getElementById('m-tn-fee').value = DB.PLANS[plan].fee;
  },

  onPaletteInput(key, fromHex) {
    const color = document.getElementById('m-tn-' + key);
    const hex = document.getElementById('m-tn-' + key + '-hex');
    if (fromHex) {
      const v = hex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(v)) color.value = v;
    } else {
      hex.value = color.value.toUpperCase();
    }
    this.updatePalettePreview();
  },

  readPalette() {
    const get = (k) => {
      const hx = (document.getElementById('m-tn-' + k + '-hex') || {}).value || '';
      return (/^#[0-9a-fA-F]{6}$/.test(hx.trim()) ? hx.trim() : document.getElementById('m-tn-' + k).value).toUpperCase();
    };
    return { primary: get('primary'), secondary: get('secondary'), tertiary: get('tertiary') };
  },

  updatePalettePreview() {
    const p = this.readPalette();
    const box = document.getElementById('m-tn-preview');
    if (box) {
      box.style.setProperty('--pp-bg', p.primary);
      box.style.setProperty('--pp-accent', p.secondary);
      box.style.setProperty('--pp-text', p.tertiary);
      box.style.setProperty('--pp-muted', TenantBrand.mix(p.tertiary, p.primary, 0.36));
      box.style.setProperty('--pp-surface', TenantBrand.mix(p.primary, p.tertiary, 0.07));
    }
    const res = TenantBrand.checkPalette(p);
    const list = document.getElementById('m-tn-checks');
    if (list) {
      const order = TenantBrand.luminance(p.primary) < TenantBrand.luminance(p.tertiary);
      list.innerHTML =
        '<li class="' + (order ? 'is-ok' : 'is-bad') + '">' + ic(order ? 'checkCircle' : 'alert') + 'Primario más oscuro que el terciario</li>' +
        res.checks.map(c => '<li class="' + (c.ok ? 'is-ok' : 'is-bad') + '">' + ic(c.ok ? 'checkCircle' : 'alert') + c.label + ': <strong>' + c.ratio.toFixed(1) + ':1</strong> (mín. ' + c.min + ':1)</li>').join('');
    }
    return res;
  },

  async onTenantLogo(input) {
    const f = input.files && input.files[0];
    if (!f) return;
    const data = await readAndCompressImage(f, 640, 0.85);
    if (!data) return UI.toast('No se pudo leer la imagen.', 'error');
    this._tenantLogo = data;
    document.getElementById('m-tn-logo-preview').innerHTML = '<img class="tenant-logo" src="' + data + '" alt="Vista previa del logo" />';
  },

  clearTenantLogo() {
    this._tenantLogo = '';
    document.getElementById('m-tn-logo-preview').innerHTML = '<span class="brand-wordmark">Sin logo</span>';
  },

  async saveTenant(e, editId) {
    e.preventDefault();
    if (!Auth.can('tenants.manage')) return Guard.deny();
    const err = document.getElementById('m-tn-error');
    const g = (id) => document.getElementById(id).value.trim();
    const name = g('m-tn-name');
    const slug = DB.slugify(g('m-tn-slug'));
    const palette = this.readPalette();
    if (!name) { err.textContent = 'Escribe el nombre de la barbería.'; return; }
    if (!slug) { err.textContent = 'Escribe un enlace público válido.'; return; }
    const dup = DB.tenantBySlug(slug);
    if (dup && dup.id !== editId) { err.textContent = 'Ese enlace ya lo usa otra barbería.'; return; }
    const pc = TenantBrand.checkPalette(palette);
    if (!pc.ok) { err.textContent = pc.error; return; }
    const oemail = g('m-tn-oemail');
    if (oemail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(oemail)) { err.textContent = 'El correo del dueño no es válido.'; return; }
    const fee = Number(g('m-tn-fee'));
    if (!isFinite(fee) || fee < 0) { err.textContent = 'El monto mensual debe ser 0 o más.'; return; }

    const fields = {
      name, slug, palette, accent: palette.secondary,
      ownerName: g('m-tn-owner'),
      currency: document.getElementById('m-tn-currency').value,
      address: g('m-tn-address'), phone: g('m-tn-phone'), hours: g('m-tn-hours'), city: g('m-tn-city'),
      logo: this._tenantLogo || '',
      plan: document.getElementById('m-tn-plan').value, planFee: fee,
      subscriptionEnd: g('m-tn-end') || DB.addDays(DB.todayISO(), 30),
      ownerEmail: oemail, ownerPhone: g('m-tn-ophone')
    };
    const root = DB.load();
    if (editId) {
      const t = DB.tenantById(editId);
      Object.assign(t, fields);
      if (root.data[t.id]) { root.data[t.id].settings.shopName = t.name; root.data[t.id].settings.currency = t.currency; }
      await DB.persist();
      DB.log('Editó una barbería', t.name + ' (?b=' + t.slug + ') · plan ' + DB.PLANS[t.plan].label + ' · vence ' + t.subscriptionEnd, { tenantId: t.id });
      ModalComponent.close();
      UI.toast('Barbería actualizada.');
      if (DB.tenant && DB.tenant.id === t.id) TenantBrand.applyCrm(t);
      this.renderHeader();
      this.renderTenants();
      return;
    }
    const t = Object.assign({ id: DB.uid(), status: 'ACTIVE', createdAt: new Date().toISOString(), timeSlots: DB.DEFAULT_SLOTS.slice() }, fields);
    root.tenants.push(t);
    root.data[t.id] = DB.templateData(t.name);
    root.data[t.id].settings.currency = t.currency;
    await DB.persist();
    if (!DB.tenantById(t.id)) return; // el servidor la rechazó (ya se mostró el motivo)
    DB.log('Creó una barbería', t.name + ' (?b=' + t.slug + ') · plan ' + DB.PLANS[t.plan].label, { tenantId: t.id });
    ModalComponent.close();
    this.renderHeader();
    this.renderTenants();
    UI.confirm({
      title: 'Barbería creada',
      message: t.name + ' ya existe con un catálogo de servicios base. Siguiente paso recomendado: crear su administrador.',
      confirmText: 'Crear administrador'
    }).then(ok => {
      if (!ok) return;
      this.openUserModal(null);
      const r = document.getElementById('m-us-role'); if (r) r.value = 'ADMIN';
      const tn = document.getElementById('m-us-tenant'); if (tn) { tn.value = t.id; this.onUserTenantChange(); }
      this.onUserRoleChange();
    });
  },

  toggleTenant(id) {
    if (!Auth.can('tenants.manage')) return Guard.deny();
    const t = DB.tenantById(id);
    const suspending = t.status === 'ACTIVE';
    UI.confirm({
      title: suspending ? 'Suspender barbería' : 'Reactivar barbería',
      message: suspending
        ? 'Su web pública mostrará “no disponible” y sus administradores y personal no podrán ingresar. Los datos se conservan.'
        : 'Su web pública y sus usuarios volverán a funcionar.',
      confirmText: suspending ? 'Suspender' : 'Reactivar',
      danger: suspending
    }).then(ok => {
      if (!ok) return;
      t.status = suspending ? 'SUSPENDED' : 'ACTIVE';
      DB.persist();
      DB.log(suspending ? 'Suspendió una barbería' : 'Reactivó una barbería', t.name, { tenantId: t.id });
      this.renderHeader();
      this.renderTenants();
      UI.toast(suspending ? 'Barbería suspendida.' : 'Barbería reactivada.');
    });
  },

  /* ==================================================================
     HISTORIAL DE ACTIVIDAD
     ================================================================== */
  auditScope() {
    const me = Auth.user;
    const all = DB.load().audit;
    if (me.role === 'SUPERADMIN') {
      const f = (document.getElementById('aud-tenant') || {}).value || 'ALL';
      return all.filter(a => f === 'ALL' || (f === 'NONE' ? !a.tenantId : a.tenantId === f));
    }
    return all.filter(a => a.tenantId === me.tenantId);
  },

  renderAudit(more) {
    const tbody = document.getElementById('audit-tbody');
    if (!tbody || !Auth.can('audit.view')) return;
    if (more) this.auditLimit += 200; else if (more === false) this.auditLimit = 200;
    const me = Auth.user;

    const ft = document.getElementById('aud-tenant');
    if (ft && me.role === 'SUPERADMIN' && !ft.dataset.ready) {
      ft.innerHTML = '<option value="ALL">Todas las barberías</option><option value="NONE">Sistema / sin barbería</option>' +
        DB.load().tenants.map(t => '<option value="' + UI.esc(t.id) + '">' + UI.esc(t.name) + '</option>').join('');
      ft.dataset.ready = '1';
    }
    const scope = this.auditScope();
    const fa = document.getElementById('aud-action');
    if (fa) {
      const cur = fa.value || 'ALL';
      const actions = Array.from(new Set(scope.map(a => a.action))).sort();
      fa.innerHTML = '<option value="ALL">Todas las acciones</option>' + actions.map(a => '<option>' + UI.esc(a) + '</option>').join('');
      fa.value = actions.includes(cur) ? cur : 'ALL';
    }
    const q = ((document.getElementById('aud-search') || {}).value || '').trim().toLowerCase();
    const act = fa ? fa.value : 'ALL';
    const from = (document.getElementById('aud-from') || {}).value || '';

    const list = scope.filter(a => {
      if (act !== 'ALL' && a.action !== act) return false;
      if (from && a.ts.slice(0, 10) < from) return false;
      if (q && !(a.userName + ' ' + a.detail + ' ' + a.action + ' ' + a.tenantName).toLowerCase().includes(q)) return false;
      return true;
    });

    const count = document.getElementById('audit-count');
    if (count) count.textContent = list.length + (list.length === 1 ? ' registro' : ' registros');

    if (!list.length) {
      tbody.innerHTML = '<tr class="is-empty"><td colspan="5"><div class="empty-state">' + ic('file') + '<strong>Sin registros</strong>No hay actividad con esos filtros.</div></td></tr>';
    } else {
      const roleLbl = (r) => r === 'PUBLIC' ? 'Cliente' : (r === 'SYSTEM' ? 'Sistema' : (Auth.ROLE_LABEL[r] || r));
      tbody.innerHTML = list.slice(0, this.auditLimit).map(a =>
        '<tr>' +
          '<td data-label="Fecha" style="white-space:nowrap;">' + UI.esc(UI.fmtDateTime(a.ts)) + '</td>' +
          '<td data-label="Usuario"><strong>' + UI.esc(a.userName) + '</strong><br/><span class="text-grey" style="font-size:0.78rem;">' + UI.esc(roleLbl(a.role)) + '</span></td>' +
          '<td data-label="Barbería">' + UI.esc(a.tenantName || '—') + '</td>' +
          '<td data-label="Acción"><span class="audit-action">' + UI.esc(a.action) + '</span></td>' +
          '<td data-label="Detalle">' + UI.esc(a.detail) + '</td>' +
        '</tr>'
      ).join('');
    }
    const moreBtn = document.getElementById('audit-more');
    if (moreBtn) moreBtn.hidden = list.length <= this.auditLimit;
  },

  exportAuditCSV() {
    if (!Auth.can('audit.view')) return Guard.deny();
    const rows = [['Fecha', 'Usuario', 'Rol', 'Barbería', 'Acción', 'Detalle']].concat(
      this.auditScope().map(a => [a.ts, a.userName, a.role, a.tenantName, a.action, a.detail])
    );
    const csv = rows.map(r => r.map(v => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"').join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'historial-' + DB.todayISO() + '.csv';
    a.click();
    DB.log('Exportó el historial', rows.length - 1 + ' registros');
  }
};
