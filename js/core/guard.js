/* ==========================================================================
   Guard: aplica permisos y auditoría sobre el CRM existente
   --------------------------------------------------------------------------
   1. Envuelve cada acción (crear cita, borrar barbero, etc.) con una
      verificación de permiso y la registra en el historial.
   2. Oculta en pantalla los botones y módulos que el usuario no puede usar.
   3. Elimina del DOM los paneles a los que no tiene acceso (no quedan datos
      ocultos en la página).
   Todas las reglas están aquí para poder auditarlas en un solo lugar.
   ========================================================================== */
const Guard = {
  DOM_RULES: [
    ['[onclick*="CRM.openAppointmentModal"]', 'appointments.create'],
    ['[onclick*="CRM.setApptStatus"]', 'appointments.status'],
    ['[onclick*="CRM.deleteAppt"]', 'appointments.delete'],
    ['[onclick*="CRM.openWalkInModal"]', 'walkins.create'],
    ['[onclick*="CRM.setWalkInStatus"]', 'walkins.status'],
    ['[onclick*="CRM.openBarberProfileModal"], [onclick*="CRM.openAddHaircutPhotoModal"], [onclick*="CRM.deleteHaircutPhoto"], [onclick*="CRM.deleteBarberProfile"]', 'barbers.manage'],
    ['[onclick*="CRM.openServiceModal"], [onclick*="CRM.deleteService"]', 'services.manage'],
    ['[onclick*="CRM.openCustomerModal"]', 'customers.manage'],
    ['[onclick*="CRM.reloadDemoData"], [onclick*="CRM.factoryReset"]', 'system.reset'],
    ['[onclick*="CRM.exportJSON"]', 'settings.manage']
  ],

  deny(msg) {
    UI.toast(msg || 'No tienes permiso para realizar esta acción.', 'error');
  },

  /* Envuelve obj[name]: verifica permiso → (confirma) → ejecuta → registra */
  wrap(obj, name, perm, describe, confirmOpts) {
    const orig = obj[name];
    if (typeof orig !== 'function') return;
    obj[name] = function (...args) {
      const allowed = typeof perm === 'function' ? perm.apply(obj, args) : Auth.can(perm);
      if (!allowed) {
        const ev = args[0];
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        Guard.deny();
        return undefined;
      }
      let info = null;
      try { info = describe ? describe.apply(obj, args) : null; } catch (e) { info = null; }
      const run = () => {
        const res = orig.apply(obj, args);
        const finish = () => { if (info && info.action) DB.log(info.action, info.detail || ''); };
        if (res && typeof res.then === 'function') return res.then(r => { finish(); return r; });
        finish();
        return res;
      };
      if (confirmOpts) {
        const opts = typeof confirmOpts === 'function' ? confirmOpts.apply(obj, args) : confirmOpts;
        return UI.confirm(opts).then(ok => (ok ? run() : undefined));
      }
      return run();
    };
  },

  val(id) { const el = document.getElementById(id); return el ? String(el.value || '').trim() : ''; },
  appt(id) { return DB.state.appointments.find(a => a.id === id); },
  walk(id) { return DB.state.walkIns.find(w => w.id === id); },
  barber(id) { return DB.state.barberProfiles.find(b => b.id === id); },

  // Personal vinculado: solo puede operar sobre sus propias citas
  ownsAppt(id) {
    const a = this.appt(id);
    if (!a) return false;
    const own = DB.linkedBarberName();
    return !own || a.barber === own;
  },

  install() {
    const G = this;

    /* ---- Navegación entre módulos ---- */
    const origSwitch = CRM.switchTab.bind(CRM);
    CRM.switchTab = function (tabId) {
      let tab = tabId;
      if (!Auth.canTab(tab) || !document.getElementById('crm-pane-' + tab)) {
        if (tab && tab !== 'dashboard') G.deny('No tienes acceso al módulo solicitado.');
        tab = G.firstAllowedTab();
      }
      return origSwitch(tab);
    };

    /* ---- Citas ---- */
    G.wrap(CRM, 'openAppointmentModal', 'appointments.create');
    G.wrap(CRM, 'saveAppointmentModal', () => {
      if (!Auth.can('appointments.create')) return false;
      const own = DB.linkedBarberName();
      return !own || G.val('m-ap-barber') === own;
    }, () => ({
      action: 'Creó una cita',
      detail: G.val('m-ap-name') + ' · ' + G.val('m-ap-service') + ' · ' + G.val('m-ap-barber') + ' · ' + G.val('m-ap-date') + ' ' + G.val('m-ap-time')
    }));
    G.wrap(CRM, 'setApptStatus', (id) => Auth.can('appointments.status') && G.ownsAppt(id), (id, status) => {
      const a = G.appt(id);
      return { action: 'Cambió el estado de una cita', detail: (a ? a.customerName + ' (' + a.date + ' ' + a.time + '): ' + DB.statusLabel(a.status) : id) + ' → ' + DB.statusLabel(status) };
    });
    G.wrap(CRM, 'deleteAppt', (id) => Auth.can('appointments.delete') && G.ownsAppt(id), (id) => {
      const a = G.appt(id);
      return { action: 'Eliminó una cita', detail: a ? a.customerName + ' · ' + a.service + ' · ' + a.date + ' ' + a.time : id };
    }, (id) => {
      const a = G.appt(id);
      return { title: 'Eliminar cita', message: 'Se eliminará la cita de ' + (a ? a.customerName + ' (' + a.date + ' ' + a.time + ')' : 'este cliente') + '. Esta acción no se puede deshacer.', confirmText: 'Eliminar', danger: true };
    });

    /* ---- Walk-in ---- */
    G.wrap(CRM, 'openWalkInModal', 'walkins.create');
    G.wrap(CRM, 'saveWalkInModal', 'walkins.create', () => ({
      action: 'Registró un walk-in', detail: G.val('m-wk-name') + ' · ' + G.val('m-wk-service') + ' · ' + G.val('m-wk-barber')
    }));
    G.wrap(CRM, 'setWalkInStatus', 'walkins.status', (id, status) => {
      const w = G.walk(id);
      return { action: 'Actualizó un walk-in', detail: (w ? w.customerName + ': ' + DB.statusLabel(w.status) : id) + ' → ' + DB.statusLabel(status) };
    });

    /* ---- Barberos y portafolio ---- */
    G.wrap(CRM, 'openBarberProfileModal', 'barbers.manage');
    G.wrap(CRM, 'saveBarberProfileModal', 'barbers.manage', (e, editId) => ({
      action: editId ? 'Editó un barbero' : 'Creó un barbero', detail: G.val('m-bp-name') + ' · ' + G.val('m-bp-role')
    }));
    G.wrap(CRM, 'openAddHaircutPhotoModal', 'barbers.manage');
    G.wrap(CRM, 'saveHaircutPhotoModal', 'barbers.manage', (e, barberId) => {
      const b = G.barber(barberId);
      return { action: 'Publicó una foto de corte', detail: (b ? b.name : '') + ' · ' + G.val('m-wkphoto-title') };
    });
    G.wrap(CRM, 'deleteHaircutPhoto', 'barbers.manage', (barberId, workId) => {
      const b = G.barber(barberId);
      const w = b ? b.works.find(x => x.id === workId) : null;
      return { action: 'Eliminó una foto de corte', detail: (b ? b.name : '') + ' · ' + (w ? w.title : workId) };
    }, { title: 'Eliminar foto', message: 'La foto dejará de verse en el portafolio público.', confirmText: 'Eliminar', danger: true });
    G.wrap(CRM, 'deleteBarberProfile', 'barbers.manage', (id) => {
      const b = G.barber(id);
      return { action: 'Eliminó un barbero', detail: b ? b.name : id };
    }, (id) => {
      const b = G.barber(id);
      const linked = DB.load().users.filter(u => u.barberId === id).length;
      return {
        title: 'Eliminar barbero',
        message: 'Se eliminará a ' + (b ? b.name : 'este barbero') + ' y su portafolio.' + (linked ? ' ' + linked + ' usuario(s) del personal quedarán sin barbero vinculado y verán todas las citas.' : ''),
        confirmText: 'Eliminar', danger: true
      };
    });

    /* ---- Servicios, clientes, configuración ---- */
    G.wrap(CRM, 'openServiceModal', 'services.manage');
    G.wrap(CRM, 'saveServiceModal', 'services.manage', (e, editId) => {
      const before = editId ? DB.state.services.find(x => x.id === editId) : null;
      const now = G.val('m-sv-name') + ' · ' + DB.state.settings.currency + ' ' + G.val('m-sv-price') + ' · ' + G.val('m-sv-duration') + ' min';
      return before
        ? { action: 'Editó un servicio', detail: before.name + ' (' + DB.state.settings.currency + ' ' + before.price + ') → ' + now }
        : { action: 'Creó un servicio', detail: now };
    });
    G.wrap(CRM, 'deleteService', 'services.manage');
    G.wrap(CRM, 'refreshApptSlots', 'appointments.create');
    G.wrap(CRM, 'openCustomerModal', 'customers.manage');
    G.wrap(CRM, 'saveCustomerModal', 'customers.manage', () => ({ action: 'Registró un cliente', detail: G.val('m-cu-name') + ' · ' + G.val('m-cu-phone') }));
    G.wrap(CRM, 'saveSettings', 'settings.manage');
    G.wrap(CRM, 'saveSchedule', 'settings.manage');
    G.wrap(CRM, 'addException', 'settings.manage');
    G.wrap(CRM, 'deleteException', 'settings.manage', null, (id) => {
      const e = (DB.state.scheduleExceptions || []).find(x => x.id === id);
      return { title: 'Quitar fecha especial', message: e ? 'El ' + CRM.fmtLongDate(e.date) + ' volverá al horario semanal de ' + CRM.exceptionWho(e).toLowerCase().replace('toda la barbería', 'la barbería') + '.' : 'La fecha volverá al horario semanal.', confirmText: 'Quitar', danger: true };
    });
    G.wrap(CRM, 'exportJSON', 'settings.manage', () => ({ action: 'Exportó un respaldo', detail: 'Datos de ' + DB.tenant.name }));
    G.wrap(CRM, 'reloadDemoData', 'system.reset');
    G.wrap(CRM, 'factoryReset', 'system.reset');

    /* ---- Renders de módulos restringidos: no se generan si no hay permiso ---- */
    [['renderSales', 'sales.view'], ['renderCustomers', 'customers.view'], ['renderReports', 'reports.view'],
     ['renderSettings', 'settings.manage'], ['renderBarbersPortfolioManager', 'barbers.manage'], ['renderServices', 'services.manage']]
      .forEach(([fn, perm]) => {
        const o = CRM[fn];
        if (typeof o === 'function') CRM[fn] = function (...a) { return Auth.can(perm) ? o.apply(CRM, a) : undefined; };
      });

    /* ---- Paneles sin permiso: se quitan del DOM ---- */
    document.querySelectorAll('.crm-pane').forEach(p => {
      const tab = p.id.replace('crm-pane-', '');
      if (!Auth.canTab(tab)) p.remove();
    });

    G.applyDom(document);
    const mo = new MutationObserver(() => {
      if (G._queued) return;
      G._queued = true;
      requestAnimationFrame(() => { G._queued = false; G.applyDom(document); });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  },

  firstAllowedTab() {
    const order = ['dashboard', 'appointments', 'walkins', 'barbers', 'services', 'users', 'tenants'];
    return order.find(t => Auth.canTab(t) && document.getElementById('crm-pane-' + t)) || 'dashboard';
  },

  hide(el, hidden) {
    if (hidden) { el.classList.add('perm-hidden'); el.setAttribute('aria-hidden', 'true'); }
    else if (el.classList.contains('perm-hidden')) { el.classList.remove('perm-hidden'); el.removeAttribute('aria-hidden'); }
  },

  applyDom(root) {
    const scope = root || document;
    this.DOM_RULES.forEach(([sel, perm]) => {
      scope.querySelectorAll(sel).forEach(el => this.hide(el, !Auth.can(perm)));
    });
    scope.querySelectorAll('[onclick*="CRM.switchTab("]').forEach(el => {
      const m = (el.getAttribute('onclick') || '').match(/CRM\.switchTab\('([^']+)'\)/);
      if (m) this.hide(el, !Auth.canTab(m[1]));
    });
    scope.querySelectorAll('[data-perm]').forEach(el => this.hide(el, !Auth.can(el.getAttribute('data-perm'))));
    scope.querySelectorAll('[data-role]').forEach(el => {
      const roles = el.getAttribute('data-role').split(',');
      this.hide(el, !(Auth.user && roles.includes(Auth.user.role)));
    });

    // Grupos del menú lateral sin opciones visibles
    const nav = document.querySelector('.crm-nav-list');
    if (nav) {
      let currentGroup = null, visibleInGroup = false;
      const close = () => { if (currentGroup) this.hide(currentGroup, !visibleInGroup); };
      Array.from(nav.children).forEach(ch => {
        if (ch.classList.contains('crm-nav-group')) { close(); currentGroup = ch; visibleInGroup = false; }
        else if (!ch.classList.contains('perm-hidden')) visibleInGroup = true;
      });
      close();
    }

    // Contenedores de acciones que quedaron vacíos
    scope.querySelectorAll('.crm-topbar-actions, .quick-actions, .btn-row').forEach(box => {
      const any = Array.from(box.children).some(c => !c.classList.contains('perm-hidden'));
      this.hide(box, !any);
    });
  }
};
