/* ==========================================================================
   CRM del negocio
   --------------------------------------------------------------------------
   Reglas de esta pantalla:
     - Las palabras del rubro (barbero/doctor, cliente/paciente, servicio/
       consulta…) salen de Vocab (js/core/vocab.js) con UI.v(); los nombres
       internos (barbers, barberId, EN_SILLON) no cambian.
     - Todo texto que viene de la base (nombres, notas, servicios…) se pinta
       con UI.esc(). Los onclick solo llevan ids (UUID), nunca nombres.
     - Barberos y servicios se eligen y comparan por id (barberId/serviceId);
       el nombre se usa solo para mostrar.
     - "Guardado" solo se muestra cuando DB.save() confirma (true). Si el
       servidor rechaza, DB ya avisó el motivo y recargó los datos.
     - Las acciones que el Guard registra en el historial devuelven true
       cuando terminaron bien (el historial solo anota lo que se guardó).
   ========================================================================== */
const CRM = {
  currentTab: 'dashboard',
  apptQuickFilter: 'TODAY',
  apptLimit: 60,
  custLimit: 60,
  PHOTO_PLACEHOLDER: 'assets/icons/barbero-sin-foto.svg',

  // Formularios con cambios sin guardar: una recarga en tiempo real no los repinta
  setDirty: false,
  schDirty: false,
  waDirty: false,

  esc(v) { return UI.esc(v); },
  // Texto del rubro ya escapado para pegar en HTML
  vx(s) { return UI.esc(UI.v(s)); },
  cur() { return UI.esc(DB.state.settings.currency || 'S/'); },
  photo(src) { return UI.esc(src || this.PHOTO_PLACEHOLDER); },

  switchTab(tabId) {
    this.currentTab = tabId;
    document.querySelectorAll('.crm-nav-btn').forEach(b => {
      b.classList.toggle('active', b.getAttribute('data-crm') === tabId);
    });
    document.querySelectorAll('.crm-pane').forEach(p => p.classList.remove('active-pane'));
    const target = document.getElementById('crm-pane-' + tabId);
    if (target) target.classList.add('active-pane');
    const activeBtn = document.querySelector('.crm-nav-btn.active');
    if (activeBtn && window.innerWidth <= 980) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
    this.renderAll();
  },

  renderAll() {
    if (!DB.tenant || !DB.state) return;
    this.applyCrmConfig();
    this.applyVocab();
    this.bindDirtyGuards();
    const today = DB.todayISO();
    const dateLbl = document.getElementById('crm-current-date-label');
    if (dateLbl) dateLbl.textContent = 'Fecha: ' + today;

    const badgeAppts = document.getElementById('badge-nav-appts');
    if (badgeAppts) badgeAppts.textContent = DB.visibleAppointments().filter(a => a.date === today).length;

    const badgeWalkins = document.getElementById('badge-nav-walkins');
    if (badgeWalkins) badgeWalkins.textContent = this.todayQueue().length;

    const badgeBarbers = document.getElementById('badge-nav-barbers');
    if (badgeBarbers) badgeBarbers.textContent = DB.state.barberProfiles.length;

    this.renderSubscriptionBanner();
    this.renderBarberLiveStatus();
    this.renderDashboard();
    this.renderBarbersPortfolioManager();
    this.populateApptFilterDropdowns();
    this.renderAppointments();
    this.renderWalkIns();
    this.renderSales();
    this.renderCustomers();
    this.renderServices();
    this.renderReports();
    this.renderSettings();
    if (typeof AdminUI !== 'undefined') AdminUI.renderAll();
  },

  /* ---------- CRM personalizable (crm_config): tema, módulos y campos ----------
     Lo define el superadministrador en la consola; aquí solo se aplica. */
  cfg() { return CrmConfig.of(DB.tenant); },
  fshow(entity, key) { return CrmConfig.field(entity, key).show; },
  freq(entity, key) { return CrmConfig.field(entity, key).required; },
  applyCrmConfig() {
    CrmConfig.applyTheme(DB.tenant);
    const wa = CrmConfig.module('whatsapp');
    ['wa-card'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = !wa; });
    document.querySelectorAll('.wsp-float-btn, #wsp-modal').forEach(el => { el.hidden = !wa; });
    const link = document.getElementById('set-crm-custom-link');
    if (link) link.href = 'reservalope.html#negocio/' + encodeURIComponent(DB.tenant.id) + '/crm';
  },
  // Valor de un campo propio listo para pintar (escapado)
  cfx(f, extra) { return UI.esc(CrmConfig.display(f, (extra || {})[f.key])); },
  // Descarga un CSV (con BOM para Excel; UI.csv neutraliza fórmulas)
  downloadCSV(rows, name) {
    const blob = new Blob(['\ufeff' + UI.csv(rows)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    this.lastCSV = { name, rows };
  },

  /* ---------- Rubro: fija las palabras del negocio activo y repinta las marcadas ---------- */
  applyVocab() {
    if (window.Vocab && DB.tenant) Vocab.set(DB.tenant);
    UI.applyVocab(document);
  },

  /* ---------- M17: aviso de suscripción vencida o por vencer ---------- */
  renderSubscriptionBanner() {
    const box = document.getElementById('crm-sub-banner');
    if (!box) return;
    const u = Auth.user;
    const s = (typeof Analytics !== 'undefined') ? Analytics.subscriptionState(DB.tenant) : { key: 'ok' };
    if (!u || u.role === 'STAFF' || (s.key !== 'expired' && s.key !== 'soon')) { box.hidden = true; box.innerHTML = ''; return; }
    const end = DB.tenant.subscriptionEnd;
    let txt;
    if (s.key === 'soon') {
      txt = 'La suscripción de Reservalope vence el ' + end + '. Renuévala para que la web siga recibiendo reservas.';
    } else if (-s.days > 7) {
      txt = 'La suscripción venció el ' + end + ': la web ya no recibe reservas en línea. El CRM y las citas existentes siguen funcionando. Contacta a Reservalope para renovarla.';
    } else {
      txt = 'La suscripción venció el ' + end + '. La web seguirá recibiendo reservas hasta el ' + DB.addDays(end, 7) + '; después se bloquearán las reservas en línea. Contacta a Reservalope para renovarla.';
    }
    box.className = 'crm-banner ' + (s.key === 'soon' ? 'is-warn' : 'is-bad');
    box.innerHTML = ic('alert') + '<span>' + UI.esc(txt) + '</span>';
    box.hidden = false;
  },

  /* ---------- M13: marcar formularios con cambios sin guardar ---------- */
  bindDirtyGuards() {
    const mark = (e) => {
      const id = (e.target && e.target.id) || '';
      if (/^set-(owner-name|currency|address|phone|hours|city|lead)$/.test(id)) this.setDirty = true;
      else if (id.indexOf('set-sch-') === 0 || id.indexOf('set-sch-on-') === 0) this.schDirty = true;
      else if (id.indexOf('wa-') === 0 && id !== 'wa-test-num') this.waDirty = true;
    };
    // Configuración, Horario de atención y WhatsApp son apartados separados
    ['settings', 'schedule', 'whatsapp'].forEach(tab => {
      const pane = document.getElementById('crm-pane-' + tab);
      if (!pane || pane.dataset.dirtyBound) return;
      pane.dataset.dirtyBound = '1';
      pane.addEventListener('input', mark);
      pane.addEventListener('change', mark);
      pane.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('#set-sch-week .sch-copy')) this.schDirty = true; });
    });
  },

  /* ---------- Barberos y portafolio ---------- */
  renderBarbersPortfolioManager() {
    const container = document.getElementById('crm-barbers-portfolio-grid');
    if (!container) return;
    const E = (v) => UI.esc(v);
    const F = (k) => this.fshow('staff', k);
    container.innerHTML = DB.state.barberProfiles.map(bp => {
      const specs = (bp.specialties || []).map(sp =>
        '<span class="specialty-pill" style="padding:3px 9px; font-size:0.68rem;">' + E(sp) + '</span>'
      ).join('');
      const thumbs = (bp.works || []).map(w =>
        '<div class="crm-work-thumb" title="' + E(w.title) + '">' +
          '<img src="' + E(w.image) + '" alt="' + E(w.title) + '" />' +
          '<button type="button" class="crm-work-thumb-del" onclick="CRM.deleteHaircutPhoto(\'' + E(bp.id) + '\',\'' + E(w.id) + '\')" aria-label="Eliminar foto">' + ic('x') + '</button>' +
          '<div class="crm-work-thumb-lbl">' + E(w.title) + '</div>' +
        '</div>'
      ).join('');

      return '<div class="crm-item-card">' +
        '<div>' +
          '<div style="display:flex; gap:16px; align-items:center; padding-bottom:14px; border-bottom:1px solid var(--border-subtle); margin-bottom:14px;">' +
            (F('photo') ? '<img src="' + this.photo(bp.photo) + '" alt="' + E(bp.name) + '" style="width:74px; height:74px; object-fit:cover; border:2px solid var(--golden); flex-shrink:0;" />' : '') +
            '<div style="flex:1; min-width:0;">' +
              '<h3 style="font-size:1.3rem; overflow-wrap:anywhere;">' + E(bp.name) + '</h3>' +
              (F('role') ? '<div style="font-size:0.78rem; color:var(--text-grey); margin-bottom:8px;">' + E(bp.role || Vocab.T('staff')) + '</div>' : '') +
              '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
                (F('gallery') ? '<button class="btn-golden btn-xs" onclick="CRM.openAddHaircutPhotoModal(\'' + E(bp.id) + '\')">' + ic('camera') + 'Subir foto de trabajo</button>' : '') +
                '<button class="btn-dark btn-xs" onclick="CRM.openBarberProfileModal(\'' + E(bp.id) + '\')">' + ic('edit') + 'Editar perfil</button>' +
                '<button class="btn-danger btn-xs" onclick="CRM.deleteBarberProfile(\'' + E(bp.id) + '\')" aria-label="Eliminar">' + ic('trash') + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          (F('bio') ? '<div style="margin-bottom:14px;">' +
            '<span class="field-lbl" style="font-size:0.68rem; color:var(--text-grey);">ESPECIALIDADES:</span>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">' + specs + '</div>' +
          '</div>' : '') +
          (F('gallery') ? '<div>' +
            '<span class="field-lbl" style="font-size:0.68rem; color:var(--golden);">FOTOS DE TRABAJOS REALIZADOS (' + (bp.works || []).length + '):</span>' +
            '<div class="crm-work-thumbs">' + thumbs + '</div>' +
          '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  },

  openBarberProfileModal(editId = null) {
    const bp = editId ? DB.state.barberProfiles.find(x => x.id === editId) : null;
    const E = (v) => UI.esc(v);
    const modalTitle = this.vx(bp ? 'Editar {staff}' : 'Nuev{o:staff} {staff}').toUpperCase();
    const bName = bp ? bp.name : '';
    const bRole = bp ? bp.role : Vocab.T('staff');
    const barberia = Vocab.type() === 'barberia';
    const bSpecs = bp ? (bp.specialties || []).join(', ') : '';
    const bPhoto = bp ? bp.photo : '';
    const bSchedule = bp ? bp.schedule : null;
    const shopSchedule = DB.tenant.schedule || DB.normSchedule(null);
    const F = (k) => this.fshow('staff', k);
    const hid = (k) => (F(k) ? '' : ' hidden');

    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">' + modalTitle + '</h3><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveBarberProfileModal(event, \'' + E(editId || '') + '\')">' +
        '<div class="form-grid-2" style="margin-bottom:12px;">' +
          '<div><label class="field-lbl" for="m-bp-name">' + this.vx('Nombre {del:staff} {staff} *').toUpperCase() + '</label><input type="text" id="m-bp-name" class="input-dark" value="' + E(bName) + '" maxlength="60" required /></div>' +
          '<div' + hid('role') + '><label class="field-lbl" for="m-bp-role">CARGO / TÍTULO</label><input type="text" id="m-bp-role" class="input-dark" value="' + E(bRole) + '" maxlength="60" /></div>' +
        '</div>' +
        '<div style="margin-bottom:12px;"' + hid('bio') + '>' +
          '<label class="field-lbl" for="m-bp-specs">ESPECIALIDADES (SEPARADAS POR COMA)</label>' +
          '<input type="text" id="m-bp-specs" class="input-dark" value="' + E(bSpecs) + '" placeholder="' + (barberia ? 'Ej. Skin fade, Perfilado de barba' : this.vx('Ej. {Service} general, Primera {appointment}')) + '" />' +
        '</div>' +
        '<div style="margin-bottom:12px;"' + hid('photo') + '>' +
          '<label class="field-lbl">' + this.vx('Foto {del:staff} {staff}').toUpperCase() + '</label>' +
          '<div class="upload-dropzone" onclick="document.getElementById(\'m-bp-file\').click()">' +
            '<span style="color:var(--golden); font-family:var(--font-display); font-weight:700; letter-spacing:0.04em; text-transform:uppercase; font-size:0.82rem;">' + ic('upload') + ' ' + this.vx('Seleccionar foto {del:staff} {staff}') + '</span>' +
            '<input type="file" id="m-bp-file" accept="image/*" style="display:none;" onchange="CRM.previewUploadedImage(this, \'m-bp-preview\')" />' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:16px;"' + hid('photo') + '>' +
          '<img id="m-bp-preview" src="' + this.photo(bPhoto) + '" data-current="' + E(bPhoto) + '" alt="' + this.vx('Foto {del:staff} {staff}') + '" style="width:68px; height:68px; object-fit:cover; border:1px solid var(--golden);" />' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
          '<label class="field-lbl" for="m-bp-sch-mode">DÍAS Y HORAS DE TRABAJO</label>' +
          '<select id="m-bp-sch-mode" class="input-dark sch-mode" onchange="document.getElementById(\'m-bp-sch-box\').hidden = this.value !== \'custom\'">' +
            '<option value="shop"' + (bSchedule ? '' : ' selected') + '>' + this.vx('Igual que el horario {del:business} {business}') + '</option>' +
            '<option value="custom"' + (bSchedule ? ' selected' : '') + '>Personalizado</option>' +
          '</select>' +
          '<div id="m-bp-sch-box"' + (bSchedule ? '' : ' hidden') + '>' +
            ScheduleEditor.html('m-bp-sch', (bSchedule || shopSchedule).week) +
            '<p class="sch-help">' + this.vx('Solo se ofrecen las horas que también estén dentro del horario {del:business} {business}') + ' (' + E(ScheduleEditor.summary(shopSchedule.week)) + ').</p>' +
          '</div>' +
          '<p class="form-error" id="m-bp-error" role="alert"></p>' +
        '</div>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button>' +
          '<button type="submit" class="btn-golden">' + this.vx('Guardar {staff}') + '</button>' +
        '</div>' +
      '</form>'
    );
  },

  async previewUploadedImage(fileInput, previewImgId) {
    const file = fileInput.files[0];
    if (!file) return;
    const compressed = await readAndCompressImage(file, 720, 0.8);
    if (compressed) {
      const imgEl = document.getElementById(previewImgId);
      imgEl.src = compressed;
      imgEl.setAttribute('data-uploaded', compressed);
    }
  },

  async saveBarberProfileModal(e, editId) {
    e.preventDefault();
    const errEl = document.getElementById('m-bp-error');
    const name = document.getElementById('m-bp-name').value.trim();
    const role = document.getElementById('m-bp-role').value.trim();
    const specialties = document.getElementById('m-bp-specs').value.split(',').map(s => s.trim()).filter(Boolean);
    const previewEl = document.getElementById('m-bp-preview');
    const finalPhoto = previewEl.getAttribute('data-uploaded') || previewEl.getAttribute('data-current') || '';
    if (!name) { errEl.textContent = UI.v('Escribe el nombre {del:staff} {staff}.'); return false; }
    const dup = DB.state.barberProfiles.find(b => b.name.trim().toLowerCase() === name.toLowerCase() && b.id !== editId);
    if (dup) { errEl.textContent = UI.v('Ya hay {un:staff} {staff} con ese nombre. Usa un nombre distinto (por ejemplo, con su apellido).'); return false; }
    let schedule = null;
    if (document.getElementById('m-bp-sch-mode').value === 'custom') {
      const res = ScheduleEditor.read('m-bp-sch');
      if (res.error) { errEl.textContent = res.error; return false; }
      schedule = { week: res.week };
    }

    if (editId) {
      const b = DB.state.barberProfiles.find(x => x.id === editId);
      if (!b) return false;
      Object.assign(b, { name, role, specialties, photo: finalPhoto, schedule });
    } else {
      DB.state.barberProfiles.push({ id: DB.uid(), name, role, photo: finalPhoto, specialties, works: [], schedule });
    }
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v(editId ? '{Staff} actualizad{o:staff}.' : '{Staff} agregad{o:staff}.'));
    return ok;
  },

  openAddHaircutPhotoModal(barberId) {
    const bp = DB.state.barberProfiles.find(x => x.id === barberId);
    if (!bp) return;
    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">SUBIR TRABAJO REALIZADO POR ' + UI.esc(bp.name.toUpperCase()) + '</h3><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveHaircutPhotoModal(event, \'' + UI.esc(bp.id) + '\')">' +
        '<div style="margin-bottom:14px;"><label class="field-lbl" for="m-wkphoto-title">TÍTULO DEL TRABAJO *</label><input type="text" id="m-wkphoto-title" class="input-dark" placeholder="' + (Vocab.type() === 'barberia' ? 'Ej. Mid Fade + Barba Conectada' : 'Ej. Antes y después') + '" maxlength="60" required /></div>' +
        '<div style="margin-bottom:14px;">' +
          '<div class="upload-dropzone" onclick="document.getElementById(\'m-wkphoto-file\').click()">' +
            '<span style="color:var(--golden); font-family:var(--font-display); font-weight:700; letter-spacing:0.04em; text-transform:uppercase; font-size:0.84rem;">' + ic('camera') + ' Seleccionar fotografía del trabajo</span>' +
            '<input type="file" id="m-wkphoto-file" accept="image/*" style="display:none;" onchange="CRM.previewUploadedImage(this, \'m-wkphoto-preview\')" />' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:16px;"><img id="m-wkphoto-preview" src="' + this.photo('') + '" alt="Vista previa" style="width:90px; height:90px; object-fit:cover; border:1px solid var(--golden);" /></div>' +
        '<p class="form-error" id="m-wkphoto-error" role="alert"></p>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">Publicar foto</button></div>' +
      '</form>'
    );
  },

  async saveHaircutPhotoModal(e, barberId) {
    e.preventDefault();
    const bp = DB.state.barberProfiles.find(x => x.id === barberId);
    if (!bp) return false;
    const title = document.getElementById('m-wkphoto-title').value.trim();
    const finalImg = document.getElementById('m-wkphoto-preview').getAttribute('data-uploaded');
    if (!finalImg) { document.getElementById('m-wkphoto-error').textContent = 'Selecciona la foto del trabajo.'; return false; }
    bp.works.unshift({ id: DB.uid(), title, image: finalImg });
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast('Foto publicada en el portafolio.');
    return ok;
  },

  async deleteHaircutPhoto(barberId, workId) {
    const bp = DB.state.barberProfiles.find(x => x.id === barberId);
    if (!bp) return false;
    bp.works = bp.works.filter(w => w.id !== workId);
    DB.markDeleted('works', workId);
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast('Foto eliminada.');
    return ok;
  },

  async deleteBarberProfile(barberId) {
    if (DB.state.barberProfiles.length <= 1) {
      UI.toast(UI.v('Debe quedar al menos {un:staff} {staff} en {el:business} {business}.'), 'error');
      return false;
    }
    DB.state.barberProfiles = DB.state.barberProfiles.filter(x => x.id !== barberId);
    DB.markDeleted('barbers', barberId);
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v('{Staff} eliminad{o:staff}.'));
    return ok;
  },

  /* ---------- Walk-in de hoy (M18: los de otros días no cuentan "en atención") ---------- */
  todayQueue() {
    const today = DB.todayISO();
    return DB.state.walkIns.filter(w => w.status !== 'FINALIZADO' && (w.date || today) === today);
  },

  renderBarberLiveStatus() {
    const activeWalkIns = this.todayQueue();
    let workingCount = 0;
    const E = (v) => UI.esc(v);

    const cardsHTML = DB.state.barberProfiles.map(bp => {
      const mine = (w) => (w.barberId ? w.barberId === bp.id : w.barber === bp.name);
      const inChair = activeWalkIns.find(w => mine(w) && w.status === 'EN_SILLON');
      const waiting = activeWalkIns.filter(w => mine(w) && w.status === 'ESPERANDO');
      if (inChair) workingCount++;
      const pCls = inChair ? 'working' : 'available';
      const pTxt = inChair ? 'Trabajando' : 'Disponible';
      const subTxt = inChair ? ('Con ' + inChair.customerName) : (waiting.length + ' en espera');
      return '<div class="barber-status-card">' +
        '<img src="' + this.photo(bp.photo) + '" alt="' + E(bp.name) + '" class="barber-mini-avatar" />' +
        '<div>' +
          '<div class="title-font" style="font-size:1rem;">' + E(bp.name) + '</div>' +
          '<span class="live-pill ' + pCls + '">' + pTxt + '</span>' +
          '<div style="font-size:0.74rem; color:var(--text-grey);">' + E(subTxt) + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    const summaryEl = document.getElementById('barber-live-summary-txt');
    if (summaryEl) summaryEl.textContent = workingCount + ' trabajando • ' + (DB.state.barberProfiles.length - workingCount) + ' disponibles';
    const dashLiveEl = document.getElementById('dashboard-barber-live');
    if (dashLiveEl) dashLiveEl.innerHTML = cardsHTML;
    const walkinLiveEl = document.getElementById('walkin-barber-live');
    if (walkinLiveEl) walkinLiveEl.innerHTML = cardsHTML;
  },

  /* ---------- Panel principal: qué tarjetas y secciones se ven ----------
     Lo elige el administrador en Configuración → Panel principal y vale para
     todo el negocio (tenants.crm_prefs.dashboard.cards, migración 15). Sin la
     columna en la base, la elección se guarda en este navegador. */
  DASH_ITEMS: [
    { key: 'appts_today', kind: 'kpi', label: '{AppointmentPlural} de hoy', def: true },
    { key: 'pending', kind: 'kpi', label: 'Pendientes hoy' },
    { key: 'sales_total', kind: 'kpi', label: 'Ventas completadas', finance: true, def: true },
    { key: 'queue', kind: 'kpi', label: 'Cola walk-in', def: true },
    { key: 'in_service', kind: 'kpi', label: '{InServiceShort} ahora' },
    { key: 'ticket', kind: 'kpi', label: 'Ticket promedio', finance: true, def: true },
    { key: 'rev7', kind: 'kpi', label: 'Ingresos 7 días', finance: true, def: true },
    { key: 'customers', kind: 'kpi', label: 'Total {clientPlural}', perm: 'customers.view', def: true },
    { key: 'walkins_done', kind: 'kpi', label: 'Walk-in atendidos' },
    { key: 'top_service', kind: 'kpi', label: '{Service} más pedid{o:service}', def: true },
    { key: 'staff_active', kind: 'kpi', label: '{StaffPlural} activ{os:staff}', def: true },
    { key: 'quick', kind: 'section', label: 'Inicio rápido', def: true },
    { key: 'live', kind: 'section', label: '{StaffPlural} en vivo', def: true },
    { key: 'upcoming', kind: 'section', label: 'Próximas {appointmentPlural} de hoy', def: true },
    { key: 'queue_list', kind: 'section', label: 'Cola de espera actual', def: true }
  ],
  dashAllowed(d) {
    if (d.finance && !Auth.can('finance.view')) return false;
    if (d.perm && !Auth.can(d.perm)) return false;
    return true;
  },
  dashShown() {
    const t = DB.tenant;
    const valid = (l) => Array.isArray(l) ? l.filter(k => this.DASH_ITEMS.some(d => d.key === k)) : null;
    let list = null;
    if (t && t.hasCrmPrefs) list = valid(((t.crmPrefs || {}).dashboard || {}).cards);
    else if (t) list = valid(DB.pref('dashCards:' + t.id));
    return list || this.DASH_ITEMS.filter(d => d.def).map(d => d.key);
  },

  renderDashSetting() {
    const box = document.getElementById('dash-cards-list');
    if (!box || this.dashDirty) return;
    const shown = this.dashShown();
    const group = (kind, title) => '<fieldset class="dash-group"><legend>' + title + '</legend>' +
      this.DASH_ITEMS.filter(d => d.kind === kind).map(d =>
        '<label class="check-line"><input type="checkbox" id="dash-' + d.key + '" value="' + d.key + '"' + (shown.includes(d.key) ? ' checked' : '') +
        ' onchange="CRM.dashDirty = true" />' + this.vx(d.label) +
        (d.finance ? ' <small>(solo con Ventas)</small>' : '') + '</label>').join('') + '</fieldset>';
    box.innerHTML = group('kpi', 'Tarjetas de indicadores') + group('section', 'Secciones');
    const note = document.getElementById('dash-cards-note');
    if (note) note.hidden = !(DB.tenant && !DB.tenant.hasCrmPrefs);
  },

  async saveDashCards() {
    const t = DB.tenant;
    const cards = Array.from(document.querySelectorAll('#dash-cards-list input[type="checkbox"]:checked')).map(x => x.value);
    const before = this.dashShown();
    this.dashDirty = false;
    if (JSON.stringify(before) === JSON.stringify(cards)) { UI.toast('No hay cambios por guardar.', 'info'); return false; }
    if (!t.hasCrmPrefs) {
      DB.pref('dashCards:' + t.id, cards);
      this.renderAll();
      UI.toast('Panel guardado en este navegador.');
      return true;
    }
    t.crmPrefs = Object.assign({}, t.crmPrefs, { dashboard: Object.assign({}, (t.crmPrefs || {}).dashboard, { cards }) });
    const ok = await DB.save();
    if (!ok) { this.renderAll(); return false; }
    const names = (l) => l.map(k => UI.v((this.DASH_ITEMS.find(d => d.key === k) || {}).label || k)).join(', ') || 'ninguna';
    DB.log('Cambió el panel principal', 'Antes: ' + names(before) + ' · Ahora: ' + names(cards));
    this.renderAll();
    UI.toast('Panel principal guardado. Así lo verá todo el equipo.');
    return true;
  },

  renderDashboard() {
    const cur = this.cur();
    const today = DB.todayISO();
    const E = (v) => UI.esc(v);

    const todayAppts = DB.visibleAppointments().filter(a => a.date === today);
    const completedAppts = DB.state.appointments.filter(a => a.status === 'COMPLETADA');
    const finishedWalkIns = DB.state.walkIns.filter(w => w.status === 'FINALIZADO');
    const totalRevAll = completedAppts.reduce((s, a) => s + Number(a.price), 0) + finishedWalkIns.reduce((s, w) => s + Number(w.price), 0);
    const totalDone = completedAppts.length + finishedWalkIns.length;
    const weekFrom = DB.addDays(today, -6);
    const weekRev = completedAppts.filter(a => a.date >= weekFrom && a.date <= today).reduce((s, a) => s + Number(a.price), 0) +
      finishedWalkIns.filter(w => (w.date || today) >= weekFrom && (w.date || today) <= today).reduce((s, w) => s + Number(w.price), 0);
    const queue = this.todayQueue();

    // Tarjetas de indicadores: las que el negocio eligió (Configuración → Panel principal)
    // y que esta persona puede ver (las de dinero, solo con el módulo Ventas)
    const own = DB.linkedBarberName();
    const svcCount = {};
    DB.state.appointments.forEach(a => { if (a.status !== 'CANCELADA') svcCount[a.service] = (svcCount[a.service] || 0) + 1; });
    const topService = Object.entries(svcCount).sort((x, y) => y[1] - x[1])[0];
    const kpi = (label, val, sub, style) => '<div class="crm-kpi-card"><div class="crm-kpi-label">' + label.toUpperCase() + '</div><div class="crm-kpi-val"' + (style ? ' style="' + style + '"' : '') + '>' + val + '</div><div class="crm-kpi-sub">' + sub + '</div></div>';
    const CARD = {
      appts_today: () => kpi(this.vx(own ? 'Mis {appointmentPlural} de hoy' : '{AppointmentPlural} de hoy'), todayAppts.length, own ? 'Asignadas a ' + E(own) : 'Sincronizadas con la web'),
      pending: () => kpi('Pendientes hoy', todayAppts.filter(a => this.isVigente(a)).length, 'Programadas o confirmadas'),
      sales_total: () => kpi('Ventas completadas', cur + totalRevAll, totalDone + ' completadas (acumulado)'),
      queue: () => kpi('Cola walk-in', queue.length, this.vx('En espera y {inServiceShort} hoy')),
      in_service: () => kpi(this.vx('{InServiceShort}'), queue.filter(w => w.status === 'EN_SILLON').length, 'Atendiéndose ahora', 'color:var(--golden);'),
      ticket: () => kpi('Ticket promedio', cur + (totalDone ? Math.round(totalRevAll / totalDone) : 0), 'Por venta completada', 'color:var(--golden);'),
      rev7: () => kpi('Ingresos 7 días', cur + weekRev, 'Citas + walk-in de la última semana'),
      customers: () => kpi(this.vx('Total {clientPlural}'), DB.state.customers.length, 'En cartera CRM'),
      walkins_done: () => kpi('Walk-in atendidos', finishedWalkIns.length, 'Acumulado'),
      top_service: () => kpi(this.vx('{Service} más pedid{o:service}'), E(topService ? topService[0] : '—'), topService ? topService[1] + ' ' + this.vx('{appointmentPlural}') : this.vx('Sin {appointmentPlural} aún'), 'font-size:1.25rem;'),
      staff_active: () => kpi(this.vx('{StaffPlural} activ{os:staff}'), DB.state.barberProfiles.length, 'Con portafolio activo', 'color:var(--golden);')
    };
    const shown = this.dashShown();
    const kpiEl = document.getElementById('dashboard-kpis');
    if (kpiEl) {
      const cards = this.DASH_ITEMS.filter(d => d.kind === 'kpi' && shown.includes(d.key) && this.dashAllowed(d)).map(d => CARD[d.key]());
      kpiEl.innerHTML = cards.join('');
      kpiEl.hidden = !cards.length;
    }
    document.querySelectorAll('#crm-pane-dashboard [data-dash]').forEach(el => {
      const key = el.getAttribute('data-dash');
      el.hidden = !shown.includes(key) || (key === 'quick' && !DB.state.settings.showQuickStart);
    });
    const split = document.getElementById('dashboard-lists');
    if (split) {
      const vis = Array.from(split.children).filter(c => !c.hidden).length;
      split.hidden = !vis;
      split.classList.toggle('is-single', vis === 1);
    }

    const upcomingToday = todayAppts.filter(a => a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP')
      .sort((x, y) => (x.time < y.time ? -1 : 1));
    const upcomingEl = document.getElementById('dashboard-upcoming-list');
    if (upcomingEl) {
      upcomingEl.innerHTML = upcomingToday.map(a =>
        '<div class="crm-list-item">' +
          '<div>' +
            '<strong>' + E(a.time) + ' - ' + E(a.customerName) + '</strong>' +
            '<div style="font-size:0.78rem; color:var(--text-grey);">' + E(a.service) + ' • ' + E(a.barber) + '</div>' +
          '</div>' +
          '<span class="st-badge st-' + E(a.status) + '">' + E(DB.statusLabel(a.status)) + '</span>' +
        '</div>'
      ).join('') || '<div class="empty-state">' + ic('calendar') + '<strong>' + this.vx('Sin {appointmentPlural} pendientes') + '</strong>' + this.vx('No hay más {appointmentPlural} para hoy.') + '</div>';
    }

    const queueEl = document.getElementById('dashboard-queue-list');
    if (queueEl) {
      queueEl.innerHTML = queue.map(w =>
        '<div class="crm-list-item">' +
          '<div>' +
            '<strong>' + E(w.customerName) + '</strong>' +
            '<div style="font-size:0.78rem; color:var(--text-grey);">' + E(w.service) + ' • ' + E(w.barber) + '</div>' +
          '</div>' +
        '</div>'
      ).join('') || '<div class="empty-state">' + ic('hourglass') + '<strong>Cola vacía</strong>Nadie esperando en este momento.</div>';
    }
  },

  toggleQuickStart(show) {
    DB.state.settings.showQuickStart = show;
    DB.pref('quick:' + DB.tenant.id, show !== false);
    this.renderDashboard();
  },

  /* ---------- Citas ---------- */
  populateApptFilterDropdowns() {
    const bSel = document.getElementById('flt-appt-barber');
    if (bSel) {
      const curB = bSel.value || 'ALL';
      bSel.innerHTML = '<option value="ALL">' + (DB.linkedBarberId() ? this.vx('Mis {appointmentPlural}') : this.vx('Tod{os:staff} l{os:staff} {staffPlural}')) + '</option>' +
        DB.assignableBarbers().map(b => '<option value="' + UI.esc(b.id) + '">' + UI.esc(b.name) + '</option>').join('');
      bSel.value = bSel.querySelector('option[value="' + curB + '"]') ? curB : 'ALL';
    }
    const sSel = document.getElementById('flt-appt-service');
    if (sSel) {
      const curS = sSel.value || 'ALL';
      sSel.innerHTML = '<option value="ALL">' + this.vx('Tod{os:service} l{os:service} {servicePlural}') + '</option>' +
        DB.state.services.map(s => '<option value="' + UI.esc(s.id) + '">' + UI.esc(s.name) + '</option>').join('');
      sSel.value = sSel.querySelector('option[value="' + curS + '"]') ? curS : 'ALL';
    }
  },

  showMoreAppts() {
    this.apptLimit = (this.apptLimit || 60) + 60;
    this.renderAppointments();
  },

  setApptTab(tab) {
    this.apptQuickFilter = tab;
    this.apptLimit = 60;
    document.querySelectorAll('#appt-quick-tabs button').forEach(b => b.classList.toggle('active', b.getAttribute('data-atab') === tab));
    this.renderAppointments();
  },

  clearApptFilters() {
    document.getElementById('flt-appt-q').value = '';
    document.getElementById('flt-appt-barber').value = 'ALL';
    document.getElementById('flt-appt-service').value = 'ALL';
    document.getElementById('flt-appt-date').value = '';
    document.getElementById('flt-appt-status').value = 'ALL';
    this.setApptTab('ALL');
  },

  /* A2: qué se puede hacer con una cita según su estado.
       Vigente (Programada / Confirmada): Confirmar (si aún no empieza y no está
         confirmada), Reprogramar, Completar y No asistió (solo si ya empezó),
         Cancelar.
       Completada ↔ No asistió: solo administradores (corrección).
       Cancelada: es final (solo se puede eliminar, si hay permiso). */
  isVigente(a) { return a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP'; },
  hasStarted(a) { return DB.isPastSlot(a.date, a.time); },
  apptActions(a) {
    const out = [];
    const admin = !!(Auth.user && (Auth.user.role === 'ADMIN' || Auth.user.role === 'SUPERADMIN'));
    if (this.isVigente(a)) {
      const started = this.hasStarted(a);
      if (a.status === 'PROGRAMADA' && !started) out.push({ key: 'CONFIRMADA_WSP', label: 'Confirmar' });
      out.push({ key: 'RESCHEDULE', label: 'Reprogramar' });
      if (started) {
        out.push({ key: 'COMPLETADA', label: 'Completar' });
        out.push({ key: 'NO_ASISTIO', label: 'No asistió' });
      }
      out.push({ key: 'CANCELADA', label: 'Cancelar' });
    } else if (admin && a.status === 'COMPLETADA') {
      out.push({ key: 'NO_ASISTIO', label: 'Cambiar a No asistió' });
    } else if (admin && a.status === 'NO_ASISTIO') {
      out.push({ key: 'COMPLETADA', label: 'Cambiar a Completada' });
    }
    return out;
  },

  /* Citas que cumplen los filtros de la pestaña Citas (orden por fecha y hora) */
  apptFiltered() {
    const today = DB.todayISO();
    const q = (document.getElementById('flt-appt-q')?.value || '').trim().toLowerCase();
    const fBarber = document.getElementById('flt-appt-barber')?.value || 'ALL';
    const fService = document.getElementById('flt-appt-service')?.value || 'ALL';
    const fDate = document.getElementById('flt-appt-date')?.value || '';
    const fStatus = document.getElementById('flt-appt-status')?.value || 'ALL';
    const customs = CrmConfig.custom('appointments');
    const list = DB.visibleAppointments().filter(a => {
      if (this.apptQuickFilter === 'TODAY' && a.date !== today) return false;
      if (this.apptQuickFilter === 'UPCOMING' && (a.date < today || !this.isVigente(a))) return false;
      if (['COMPLETADA', 'CANCELADA', 'NO_ASISTIO'].includes(this.apptQuickFilter) && a.status !== this.apptQuickFilter) return false;
      if (fBarber !== 'ALL' && a.barberId !== fBarber) return false;
      if (fService !== 'ALL' && a.serviceId !== fService) return false;
      if (fDate && a.date !== fDate) return false;
      if (fStatus !== 'ALL' && a.status !== fStatus) return false;
      const ex = customs.map(f => CrmConfig.display(f, (a.extra || {})[f.key])).join(' ');
      const hay = (a.customerName + ' ' + a.phone + ' ' + a.barber + ' ' + a.service + ' ' + (a.code || '') + ' ' + ex).toLowerCase();
      if (q && !hay.includes(q)) return false;
      return true;
    });
    // Orden por fecha y hora: hoy/próximas ascendente; el resto, lo más reciente primero
    const asc = this.apptQuickFilter === 'TODAY' || this.apptQuickFilter === 'UPCOMING';
    list.sort((x, y) => {
      const kx = x.date + ' ' + x.time, ky = y.date + ' ' + y.time;
      if (kx === ky) return 0;
      return asc ? (kx < ky ? -1 : 1) : (kx < ky ? 1 : -1);
    });
    return list;
  },

  /* Columnas de la lista de citas según crm_config (lists.appointments.columns y campos visibles) */
  apptColumnDefs() {
    const customs = CrmConfig.custom('appointments');
    const E = (v) => UI.esc(v);
    return CrmConfig.apptColumns().map(k => {
      if (k.indexOf('x:') === 0) {
        const f = customs.find(x => x.key === k.slice(2));
        return { key: k, label: f.label, custom: f };
      }
      const def = CrmConfig.APPT_COLUMNS.find(x => x.key === k);
      return { key: k, label: UI.v(def.label) };
    }).map(c => Object.assign(c, { th: E(c.label) }));
  },

  apptCell(c, a, cols, cur) {
    const E = (v) => UI.esc(v);
    switch (c.key) {
      case 'client': {
        const phoneUnder = this.fshow('appointments', 'phone') && !cols.some(x => x.key === 'phone');
        return '<a href="#" class="appt-open" onclick="CRM.openApptDetail(\'' + E(a.id) + '\'); return false;" title="Ver la ficha"><strong>' + E(a.customerName) + '</strong></a>' +
          (phoneUnder || a.code ? '<br/><span style="font-size:0.76rem; color:var(--text-grey);">' + (phoneUnder ? E(a.phone || '—') : '') + (a.code ? (phoneUnder ? ' · ' : '') + E(a.code) : '') + '</span>' : '');
      }
      case 'phone': return E(a.phone || '—');
      case 'service': return E(a.service);
      case 'staff': return E(a.barber);
      case 'date': return E(a.date);
      case 'time': return '<strong>' + E(a.time) + '</strong>';
      case 'price': return '<strong>' + cur + E(a.price) + '</strong>';
      case 'status': return '<span class="st-badge st-' + E(a.status) + '">' + E(DB.statusLabel(a.status)) + '</span>';
      case 'source': return a.source === 'WEB' ? 'Web' : 'CRM';
      case 'notes': return E(String(a.notes || '').slice(0, 120)) || '—';
      default: return c.custom ? (this.cfx(c.custom, a.extra) || '—') : '';
    }
  },

  renderAppointments() {
    const agenda = this.apptView() === 'agenda';
    const agendaEl = document.getElementById('appt-agenda-view');
    const listEl = document.getElementById('appt-list-view');
    if (agendaEl) agendaEl.hidden = !agenda;
    if (listEl) listEl.hidden = agenda;
    if (agenda) { this.renderAgenda(); return; }
    const tbody = document.getElementById('crm-appts-tbody');
    if (!tbody) return;
    const E = (v) => UI.esc(v);
    const cur = this.cur();
    const cols = this.apptColumnDefs();
    const thead = document.getElementById('crm-appts-thead');
    if (thead) thead.innerHTML = '<tr>' + cols.map(c => '<th scope="col"' + (c.custom ? ' data-cf="' + E(c.custom.key) + '"' : '') + '>' + c.th + '</th>').join('') + '<th scope="col">Acciones</th></tr>';

    let list = this.apptFiltered();
    const total = list.length;
    this.apptLimit = this.apptLimit || 60;
    list = list.slice(0, this.apptLimit);
    const moreBtn = document.getElementById('appt-more');
    if (moreBtn) {
      moreBtn.hidden = total <= this.apptLimit;
      moreBtn.textContent = 'Mostrar más (' + (total - list.length) + ' restantes)';
    }

    if (!list.length) {
      tbody.innerHTML = '<tr class="is-empty"><td colspan="' + (cols.length + 1) + '"><div class="empty-state">' + ic('calendar') + '<strong>' + this.vx('Sin {appointmentPlural} para este filtro') + '</strong>Prueba con otra pestaña o limpia los filtros.</div></td></tr>';
      return;
    }
    tbody.innerHTML = list.map(a => {
      const acts = this.apptActions(a).map(x => x.key === 'RESCHEDULE'
        ? '<button type="button" class="btn-dark btn-xs" onclick="CRM.openRescheduleModal(\'' + E(a.id) + '\')">' + ic('calendar') + 'Reprogramar</button>'
        : '<button type="button" class="' + (x.key === 'CANCELADA' || x.key === 'NO_ASISTIO' ? 'btn-dark' : 'btn-golden') + ' btn-xs" data-act="' + x.key + '" onclick="CRM.setApptStatus(\'' + E(a.id) + '\',\'' + x.key + '\')">' + E(x.label) + '</button>'
      ).join('');
      const hint = this.isVigente(a) && !this.hasStarted(a) ? '<span class="appt-hint">' + this.vx('Completar / No asistió: desde la hora de {el:appointment} {appointment}') + '</span>' : '';
      return '<tr data-appt="' + E(a.id) + '">' +
        cols.map(c => '<td data-label="' + c.th + '"' + (c.custom ? ' data-cf="' + E(c.custom.key) + '"' : '') + '>' + this.apptCell(c, a, cols, cur) + '</td>').join('') +
        '<td data-label="Acciones">' +
          '<div class="appt-actions" style="display:flex; gap:6px; flex-wrap:wrap;">' + acts +
            (Auth.can('appointments.delete') ? '<button type="button" class="btn-danger btn-xs" onclick="CRM.deleteAppt(\'' + E(a.id) + '\')" aria-label="' + this.vx('Eliminar {appointment}') + '">' + ic('trash') + '</button>' : '') +
          '</div>' + hint +
        '</td>' +
      '</tr>';
    }).join('');
  },

  /* ---------- Vista agenda: un día, una columna por profesional ----------
     La vista la elige el negocio en Configuración (tenants.appt_view, migración 14).
     Sin la columna en la base, la elección se guarda en este navegador. */
  AGENDA_HOUR_PX: 100,
  AGENDA_NEW_MIN: 30,      // minutos que una reserva recién creada se resalta como "Nueva reserva"
  agendaDate: '',
  apptView() {
    const t = DB.tenant;
    if (!t) return 'agenda';
    if (t.hasApptView) return t.apptView === 'lista' ? 'lista' : 'agenda';
    return DB.pref('apptView:' + t.id) === 'lista' ? 'lista' : 'agenda';
  },

  async saveApptView(view) {
    const t = DB.tenant;
    view = view === 'lista' ? 'lista' : 'agenda';
    if (!t || this.apptView() === view) return false;
    const label = { agenda: 'Agenda del día', lista: 'Lista' };
    const before = this.apptView();
    if (!t.hasApptView) {
      DB.pref('apptView:' + t.id, view);
      this.renderAll();
      UI.toast('Vista guardada en este navegador.');
      return true;
    }
    t.apptView = view;
    const ok = await DB.save();
    if (!ok) { this.renderAll(); return false; }
    DB.log('Cambió la vista de citas', 'Antes: ' + label[before] + ' · Ahora: ' + label[view]);
    this.renderAll();
    UI.toast(UI.v('Vista de {appointmentPlural} guardada: ') + label[view] + '.');
    return true;
  },

  renderApptViewSetting() {
    const view = this.apptView();
    document.querySelectorAll('input[name="appt-view"]').forEach(r => { r.checked = r.value === view; });
    const note = document.getElementById('appt-view-note');
    if (note) {
      const local = DB.tenant && !DB.tenant.hasApptView;
      note.hidden = !local;
      note.textContent = local ? 'Por ahora la elección se guarda solo en este navegador. Para que valga para todo el equipo falta ejecutar la migración 14 en Supabase.' : '';
    }
  },

  agendaGo(date) {
    this.agendaDate = /^\d{4}-\d{2}-\d{2}$/.test(date || '') ? date : '';
    this.renderAgenda();
  },
  agendaShift(n) {
    this.agendaGo(DB.addDays(this.agendaDate || DB.todayISO(), n));
  },

  fmtAgendaDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    const sameYear = iso.slice(0, 4) === DB.todayISO().slice(0, 4);
    const s = d.toLocaleDateString('es-PE', Object.assign({ weekday: 'long', day: 'numeric', month: 'long' }, sameYear ? {} : { year: 'numeric' }));
    return UI.cap(s.replace(',', ''));
  },

  // Tramos de atención del negocio en esa fecha (fecha especial o semana)
  agendaRanges(date) {
    const sch = DB.tenant.schedule || DB.normSchedule(null);
    const exc = DB.exceptionFor(date, null);
    return DB.normRanges(exc ? exc.ranges : sch.week[DB.dayOfWeek(date)]);
  },

  isNewAppt(a) {
    const t = Date.parse(a.createdAt || '');
    return !isNaN(t) && Date.now() - t < this.AGENDA_NEW_MIN * 60000 && this.isVigente(a);
  },

  renderAgenda() {
    const grid = document.getElementById('agenda-grid');
    if (!grid || !DB.state) return;
    const E = (v) => UI.esc(v);
    const today = DB.todayISO();
    if (this.agendaDate === today) this.agendaDate = '';
    const date = this.agendaDate || today;
    const isToday = date === today;

    const dateIn = document.getElementById('agenda-date');
    if (dateIn) dateIn.value = date;
    const title = document.getElementById('agenda-date-title');
    if (title) title.textContent = this.fmtAgendaDate(date);
    const live = document.getElementById('agenda-live');
    if (live) live.hidden = !isToday;
    const todayBtn = document.getElementById('agenda-today-btn');
    if (todayBtn) todayBtn.classList.toggle('active', isToday);

    // Filtro de profesional (el personal vinculado solo se ve a sí mismo)
    const all = DB.assignableBarbers();
    const sel = document.getElementById('agenda-staff');
    if (sel) {
      const cur = sel.value || 'ALL';
      sel.innerHTML = (all.length > 1 ? '<option value="ALL">' + this.vx('Tod{os:staff} l{os:staff} {staffPlural}') + '</option>' : '') +
        all.map(b => '<option value="' + E(b.id) + '">' + E(b.name) + '</option>').join('');
      sel.value = sel.querySelector('option[value="' + cur + '"]') ? cur : (sel.options[0] ? sel.options[0].value : '');
      sel.closest('.agenda-filter').hidden = all.length < 2;
    }
    const fStaff = sel && sel.value && sel.value !== 'ALL' ? sel.value : null;

    const dayAll = DB.visibleAppointments().filter(a => a.date === date);
    const cancelled = dayAll.filter(a => a.status === 'CANCELADA').length;
    let appts = dayAll.filter(a => a.status !== 'CANCELADA' && (!fStaff || a.barberId === fStaff));

    const cols = (fStaff ? all.filter(b => b.id === fStaff) : all).map(b => ({ id: b.id, name: b.name }));
    const known = new Set(cols.map(c => c.id));
    const orphans = appts.filter(a => !known.has(a.barberId));
    if (orphans.length && !fStaff) cols.push({ id: '', name: UI.v('Sin {staff}'), orphan: true });

    const sub = document.getElementById('agenda-sub');
    if (sub) {
      const n = appts.length;
      sub.textContent = n + ' ' + (n === 1 ? Vocab.t('appointment') : Vocab.t('appointmentPlural')) +
        (cancelled ? ' · ' + cancelled + ' cancelad' + (cancelled === 1 ? UI.v('{o:appointment}') : UI.v('{os:appointment}')) : '');
    }

    if (!cols.length) {
      grid.innerHTML = '<div class="empty-state">' + ic('users') + '<strong>' + this.vx('Aún no hay {staffPlural}') + '</strong>' + this.vx('Agrega {un:staff} {staff} para ver su agenda.') + '</div>';
      return;
    }

    // Rango de horas: horario del negocio ampliado con las citas que caen fuera
    const ranges = this.agendaRanges(date);
    const span = (a) => { const s = DB.toMinutes(a.time); return [s, s + DB.apptDuration(a)]; };
    let lo = Infinity, hi = -Infinity;
    ranges.forEach(r => { lo = Math.min(lo, DB.toMinutes(r[0])); hi = Math.max(hi, DB.toMinutes(r[1])); });
    appts.forEach(a => { const [s, e] = span(a); lo = Math.min(lo, s); hi = Math.max(hi, e); });
    if (!isFinite(lo)) { lo = 9 * 60; hi = 18 * 60; }
    lo = Math.floor(lo / 60) * 60;
    hi = Math.min(24 * 60, Math.max(lo + 60, Math.ceil(hi / 60) * 60));
    const H = this.AGENDA_HOUR_PX;
    const y = (m) => (m - lo) / 60 * H;
    const height = y(hi);

    const hours = [];
    for (let m = lo; m <= hi; m += 60) hours.push('<span class="agenda-hour" style="top:' + y(m) + 'px">' + DB.fromMinutes(m) + '</span>');

    // Horas fuera de atención (antes de abrir, descansos y después de cerrar)
    const off = [];
    let cursor = lo;
    ranges.forEach(r => {
      const s = DB.toMinutes(r[0]), e = DB.toMinutes(r[1]);
      if (s > cursor) off.push([cursor, s]);
      cursor = Math.max(cursor, e);
    });
    if (cursor < hi) off.push([cursor, hi]);
    const offHTML = off.map(o => '<span class="agenda-off" style="top:' + y(o[0]) + 'px;height:' + (y(o[1]) - y(o[0])) + 'px"></span>').join('');

    const nowM = DB.nowMinutes();
    const nowHTML = isToday && nowM >= lo && nowM <= hi
      ? '<span class="agenda-now" style="top:' + y(nowM) + 'px"><span class="sr-only">Hora actual ' + DB.fromMinutes(nowM) + '</span></span>' : '';

    const cur = this.cur();
    // Tarjeta según su alto: completa (nombre, servicio y hora), compacta (nombre y hora) o en una línea
    const card = (a, lane, lanes) => {
      const [s, e] = span(a);
      const h = Math.max(y(e) - y(s) - 6, 38);
      const isNew = this.isNewAppt(a);
      const size = h >= 84 ? 'full' : (h >= 50 ? 'compact' : 'short');
      const range = E(a.time) + '–' + DB.fromMinutes(Math.min(e, 1439));
      const st = a.status !== 'PROGRAMADA' ? ' · ' + E(DB.statusLabel(a.status)) : '';
      const price = this.fshow('appointments', 'price') ? ' · ' + cur + E(a.price) : '';
      const style = 'top:' + (y(s) + 3) + 'px;height:' + h + 'px' + (lanes > 1 ? ';left:calc(' + (lane * 100 / lanes) + '% + 4px);width:calc(' + (100 / lanes) + '% - 8px)' : '');
      let body;
      if (isNew) {
        body = '<span class="agenda-card-flag">Nueva reserva</span>' +
          (size === 'full' ? '<span class="agenda-card-meta">' + E(a.customerName) + ' · ' + E(a.service) + '</span><span class="agenda-card-time">' + range + ' · ' + E(a.barber) + '</span>'
            : '<span class="agenda-card-time">' + E(a.customerName) + ' · ' + E(a.time) + '</span>');
      } else if (size === 'full') {
        body = '<strong class="agenda-card-name">' + E(a.customerName) + '</strong><span class="agenda-card-meta">' + E(a.service) + price + '</span><span class="agenda-card-time">' + range + st + '</span>';
      } else if (size === 'compact') {
        body = '<strong class="agenda-card-name">' + E(a.customerName) + '</strong><span class="agenda-card-time">' + range + st + '</span>';
      } else {
        body = '<strong class="agenda-card-name">' + E(a.customerName) + '</strong><span class="agenda-card-time">' + E(a.time) + '</span>';
      }
      return '<button type="button" class="agenda-card ag-' + E(a.status) + (isNew ? ' is-new' : '') + ' is-' + size + '" style="' + style + '"' +
        ' onclick="CRM.openApptDetail(\'' + E(a.id) + '\')"' +
        ' title="' + E(a.time + ' · ' + a.customerName + ' · ' + a.service + ' · ' + DB.statusLabel(a.status)) + '"' +
        ' aria-label="' + E((isNew ? 'Nueva reserva · ' : '') + a.time + ' · ' + a.customerName + ' · ' + a.service + ' · ' + DB.statusLabel(a.status)) + '">' + body + '</button>';
    };

    // Cada columna: citas en orden; si dos se cruzan (casos raros) se reparten a lo ancho
    const colHTML = cols.map(c => {
      const list = appts.filter(a => c.orphan ? !known.has(a.barberId) : a.barberId === c.id)
        .sort((x, z) => DB.toMinutes(x.time) - DB.toMinutes(z.time));
      const laneEnd = [];
      const placed = list.map(a => {
        const [s, e] = span(a);
        let lane = laneEnd.findIndex(end => end <= s);
        if (lane < 0) { lane = laneEnd.length; laneEnd.push(e); } else laneEnd[lane] = e;
        return { a, lane };
      });
      const lanes = Math.max(1, laneEnd.length);
      const off = !c.orphan && DB.slotsFor(date, c.id).length === 0;
      return { c, html: placed.map(p => card(p.a, p.lane, lanes)).join(''), n: list.length, off };
    });

    grid.innerHTML =
      '<div class="agenda-grid" style="--agenda-cols:' + cols.length + ';--agenda-hour:' + H + 'px">' +
        '<div class="agenda-corner"></div>' +
        colHTML.map(x => '<div class="agenda-col-head' + (x.c.orphan ? ' is-orphan' : '') + '"><span class="agenda-col-name">' + E(x.c.name) + '</span>' +
          '<span class="agenda-col-count">' + (x.off && !x.n ? 'No atiende' : x.n + ' ' + (x.n === 1 ? Vocab.t('appointment') : Vocab.t('appointmentPlural'))) + '</span></div>').join('') +
        '<div class="agenda-times" style="height:' + height + 'px">' + hours.join('') + '</div>' +
        '<div class="agenda-layer" style="height:' + height + 'px">' + offHTML + nowHTML + '</div>' +
        colHTML.map((x, i) => '<div class="agenda-col' + (x.off ? ' is-off' : '') + '" style="grid-column:' + (i + 2) + ';height:' + height + 'px">' + x.html + '</div>').join('') +
      '</div>';

    // Al abrir hoy, la hora actual queda a la vista
    if (isToday && this.currentTab === 'appointments' && this._agendaScrolled !== date) {
      this._agendaScrolled = date;
      const now = grid.querySelector('.agenda-now');
      if (now) setTimeout(() => {
        const r = now.getBoundingClientRect();
        if (r.top > window.innerHeight - 80) window.scrollBy({ top: r.top - window.innerHeight / 2, behavior: 'smooth' });
      }, 60);
    }
    this.startAgendaClock();
  },

  // Línea de la hora actual y resaltado de "Nueva reserva" al día, sin recargar datos
  startAgendaClock() {
    if (this._agendaClock) return;
    this._agendaClock = setInterval(() => {
      const overlay = document.getElementById('crm-modal-overlay');
      if (this.currentTab !== 'appointments' || this.apptView() !== 'agenda' || document.hidden) return;
      if (overlay && overlay.classList.contains('open')) return;
      this.renderAgenda();
    }, 60000);
  },

  /* ---------- Ficha de la cita: datos, notas y campos propios (el personal también los edita) ---------- */
  openApptDetail(id) {
    const a = DB.state.appointments.find(x => x.id === id);
    if (!a) return;
    const E = (v) => UI.esc(v);
    const canEdit = Auth.can('appointments.status');
    const row = (k, v) => '<div><dt>' + E(k) + '</dt><dd>' + v + '</dd></div>';
    const facts = [
      row(Vocab.T('client'), E(a.customerName)),
      this.fshow('appointments', 'phone') ? row('Celular', E(a.phone || '—')) : '',
      row(Vocab.T('service'), E(a.service)),
      row(Vocab.T('staff'), E(a.barber)),
      row('Fecha y hora', E(a.date) + ' · ' + E(a.time)),
      this.fshow('appointments', 'price') ? row('Precio', this.cur() + E(a.price)) : '',
      row('Estado', '<span class="st-badge st-' + E(a.status) + '">' + E(DB.statusLabel(a.status)) + '</span>'),
      this.fshow('appointments', 'source') ? row('Origen', a.source === 'WEB' ? 'Web' : 'CRM') : '',
      a.code ? row('Código', E(a.code)) : ''
    ].join('');
    const notes = this.fshow('appointments', 'notes')
      ? '<div class="cf-field cf-wide"><label class="field-lbl" for="m-ad-notes">Notas</label><textarea id="m-ad-notes" class="input-dark" rows="3" maxlength="500"' + (canEdit ? '' : ' disabled') + '>' + E(a.notes || '') + '</textarea></div>' : '';
    const custom = CrmConfig.formHTML('appointments', 'm-ad-x-', a.extra);
    const editable = notes || custom;
    // Lo que se puede hacer con la cita (en la vista agenda la ficha es el único lugar)
    const acts = Auth.can('appointments.status') ? this.apptActions(a).map(x => x.key === 'RESCHEDULE'
      ? '<button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal(); CRM.openRescheduleModal(\'' + E(a.id) + '\')">' + ic('calendar') + 'Reprogramar</button>'
      : '<button type="button" class="' + (x.key === 'CANCELADA' || x.key === 'NO_ASISTIO' ? 'btn-dark' : 'btn-golden') + ' btn-xs" onclick="CRM.closeModal(); CRM.setApptStatus(\'' + E(a.id) + '\',\'' + x.key + '\')">' + E(x.label) + '</button>'
    ).join('') : '';
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">' + this.vx('Ficha de {el:appointment} {appointment}') + '</span><h3>' + E(a.customerName) + '</h3></div><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveApptDetail(event, \'' + E(a.id) + '\')" novalidate>' +
        '<dl class="appt-facts">' + facts + '</dl>' +
        (notes ? '<div class="form-grid-2 cf-grid">' + notes + '</div>' : '') + custom +
        '<div class="form-error" id="m-ad-error" role="alert"></div>' +
        (acts ? '<div class="appt-detail-actions">' + acts + '</div>' : '') +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cerrar</button>' +
          (editable && canEdit ? '<button type="submit" class="btn-golden">' + ic('check') + 'Guardar datos</button>' : '') + '</div>' +
      '</form>'
    );
    if (!canEdit) document.querySelectorAll('#crm-modal-content [data-cf]').forEach(el => { el.disabled = true; });
  },

  async saveApptDetail(e, id) {
    if (e && e.preventDefault) e.preventDefault();
    const a = DB.state.appointments.find(x => x.id === id);
    const err = document.getElementById('m-ad-error');
    if (!a) return false;
    const res = CrmConfig.readForm('appointments', 'm-ad-x-', a.extra);
    if (res.error) { err.textContent = res.error; return false; }
    const notesEl = document.getElementById('m-ad-notes');
    const notes = notesEl ? notesEl.value.trim().slice(0, 500) : (a.notes || '');
    if (notes === (a.notes || '') && JSON.stringify(DB.normExtra(res.extra)) === JSON.stringify(DB.normExtra(a.extra))) {
      this.closeModal(); UI.toast('No hay cambios por guardar.', 'info'); return false;
    }
    a.notes = notes;
    a.extra = DB.normExtra(res.extra);
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v('Datos de {el:appointment} {appointment} guardados.'));
    return ok;
  },

  /* CSV de las citas filtradas (columnas visibles + todos los campos propios) */
  exportApptsCSV() {
    const F = (k) => this.fshow('appointments', k);
    const customs = CrmConfig.custom('appointments');
    const cols = [
      ['Código', a => a.code || ''], [Vocab.T('client'), a => a.customerName],
      F('phone') ? ['Celular', a => a.phone || ''] : null,
      [Vocab.T('service'), a => a.service], [Vocab.T('staff'), a => a.barber], ['Fecha', a => a.date], ['Hora', a => a.time],
      F('price') ? ['Precio', a => Number(a.price) || 0] : null,
      ['Estado', a => DB.statusLabel(a.status)],
      F('source') ? ['Origen', a => (a.source === 'WEB' ? 'Web' : 'CRM')] : null,
      F('notes') ? ['Notas', a => a.notes || ''] : null
    ].filter(Boolean).concat(customs.map(f => [f.label, a => CrmConfig.display(f, (a.extra || {})[f.key])]));
    const list = this.apptFiltered();
    const rows = [cols.map(c => c[0])].concat(list.map(a => cols.map(c => c[1](a))));
    this.downloadCSV(rows, DB.tenant.slug + '-' + DB.slugify(Vocab.t('appointmentPlural')) + '-' + DB.todayISO() + '.csv');
    UI.toast('CSV descargado (' + list.length + ').');
    return true;
  },

  async setApptStatus(id, status) {
    const a = DB.state.appointments.find(x => x.id === id);
    if (!a) return false;
    if (!this.apptActions(a).some(x => x.key === status)) {
      UI.toast('Esa acción no está disponible para una cita ' + DB.statusLabel(a.status).toLowerCase() +
        (this.isVigente(a) && !this.hasStarted(a) ? ' que aún no empieza' : '') + '.', 'error');
      return false;
    }
    a.status = status;
    if (status === 'COMPLETADA') a.completedAt = new Date().toISOString();
    this.renderAll();
    const ok = await DB.save();
    this.renderAll();
    if (ok) {
      const msg = { CONFIRMADA_WSP: UI.v('{Appointment} confirmad{o:appointment}.'), COMPLETADA: UI.v('{Appointment} completad{o:appointment}.'), NO_ASISTIO: UI.v('{Appointment} marcad{o:appointment} como "No asistió".'), CANCELADA: UI.v('{Appointment} cancelad{o:appointment}. El horario quedó libre.') };
      UI.toast(msg[status] || 'Estado actualizado.');
    }
    return ok;
  },

  async deleteAppt(id) {
    if (!DB.state.appointments.some(a => a.id === id)) return false;
    DB.state.appointments = DB.state.appointments.filter(a => a.id !== id);
    DB.markDeleted('appointments', id);
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v('{Appointment} eliminad{o:appointment}.'));
    return ok;
  },

  /* ---------- Reprogramar: fecha, hora y barbero (la cita misma no ocupa su horario) ---------- */
  slotStateOf(date, time, barberName, excludeId, duration) {
    return DB.slotState(date, time, barberName, excludeId, duration);
  },

  openRescheduleModal(id) {
    const a = DB.state.appointments.find(x => x.id === id);
    if (!a) return;
    if (!this.apptActions(a).some(x => x.key === 'RESCHEDULE')) { UI.toast('Solo se reprograman citas programadas o confirmadas.', 'error'); return; }
    const E = (v) => UI.esc(v);
    const barbers = DB.assignableBarbers();
    const own = DB.linkedBarberId();
    // M12: el personal no cambia de barbero, servicio ni precio
    const barbOptions = barbers.map(b => '<option value="' + E(b.id) + '"' + (b.id === a.barberId ? ' selected' : '') + '>' + E(b.name) + '</option>').join('');
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Agenda</span><h3>' + this.vx('Reprogramar {appointment}') + '</h3></div><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<p class="form-note">' + E(a.customerName) + ' · ' + E(a.service) + ' · ahora: ' + E(a.date) + ' ' + E(a.time) + ' con ' + E(a.barber) + '</p>' +
      '<form onsubmit="CRM.saveReschedule(event, \'' + E(a.id) + '\')" novalidate>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-rp-barber">' + E(Vocab.T('staff')) + '</label><select id="m-rp-barber" class="input-dark" onchange="CRM.refreshRescheduleSlots(\'' + E(a.id) + '\')"' + (own ? ' disabled' : '') + '>' + barbOptions + '</select></div>' +
          '<div><label class="field-lbl" for="m-rp-date">Fecha</label><input type="date" id="m-rp-date" class="input-dark" min="' + DB.todayISO() + '" max="' + DB.maxBookDate() + '" value="' + E(a.date < DB.todayISO() ? DB.todayISO() : a.date) + '" onchange="CRM.refreshRescheduleSlots(\'' + E(a.id) + '\')" required /></div>' +
          '<div><label class="field-lbl" for="m-rp-time">Hora</label><select id="m-rp-time" class="input-dark" required></select></div>' +
        '</div>' +
        (a.status === 'CONFIRMADA_WSP' ? '<p class="field-hint">' + this.vx('Al reprogramarla vuelve a "Programada": el {client} tendrá que confirmar de nuevo.') + '</p>' : '') +
        '<p class="field-hint" id="m-rp-note"></p>' +
        '<div class="form-error" id="m-rp-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + 'Guardar cambio</button></div>' +
      '</form>'
    );
    this.refreshRescheduleSlots(a.id, a.time);
  },

  refreshRescheduleSlots(id, prefer) {
    const a = DB.state.appointments.find(x => x.id === id);
    const timeSel = document.getElementById('m-rp-time');
    const dateEl = document.getElementById('m-rp-date');
    if (!a || !timeSel || !dateEl) return;
    const b = DB.barberById(document.getElementById('m-rp-barber').value);
    const name = b ? b.name : '';
    const svc = DB.serviceById(a.serviceId);
    const duration = svc ? svc.duration : undefined;
    const date = dateEl.value;
    const prev = prefer || timeSel.value;
    const slots = date ? DB.slotsFor(date, name, duration) : [];
    let first = null;
    timeSel.innerHTML = slots.map(t => {
      const st = this.slotStateOf(date, t, name, a.id, duration);
      if (st === 'free' && !first) first = t;
      return '<option value="' + t + '"' + (st !== 'free' ? ' disabled' : '') + '>' + t + (st === 'past' ? ' · Ya pasó' : st === 'busy' ? ' · Ocupado' : '') + '</option>';
    }).join('');
    const po = prev && timeSel.querySelector('option[value="' + prev + '"]');
    timeSel.value = (po && !po.disabled) ? prev : (first || '');
    const note = document.getElementById('m-rp-note');
    if (note) note.textContent = !slots.length ? (name || UI.v('{El:business} {business}')) + ' no atiende ese día. Elige otra fecha.' : (!first ? 'No quedan horarios libres ese día.' : '');
  },

  async saveReschedule(e, id) {
    e.preventDefault();
    const a = DB.state.appointments.find(x => x.id === id);
    const err = document.getElementById('m-rp-error');
    if (!a) return false;
    const b = DB.barberById(document.getElementById('m-rp-barber').value);
    const date = document.getElementById('m-rp-date').value;
    const time = document.getElementById('m-rp-time').value;
    if (!b) { err.textContent = UI.v('Elige {un:staff} {staff}.'); return false; }
    if (b.id === a.barberId && date === a.date && time === a.time) { err.textContent = UI.v('Elige otra fecha, hora o {staff}.'); return false; }
    const rsvc = DB.serviceById(a.serviceId);
    const slotError = DB.validateBooking(date, time, b.name, a.id, rsvc ? rsvc.duration : undefined);
    if (slotError) { err.textContent = slotError; this.refreshRescheduleSlots(id); return false; }
    a.date = date; a.time = time;
    a.barberId = b.id; a.barber = b.name;
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v('{Appointment} reprogramad{o:appointment} para el ') + date + ' a las ' + time + ' con ' + b.name + '.');
    return ok;
  },

  /* ---------- Walk-in ---------- */
  renderWalkIns() {
    const activeGrid = document.getElementById('walkin-active-grid');
    if (!activeGrid) return;
    const E = (v) => UI.esc(v);
    const cur = this.cur();
    const today = DB.todayISO();
    const active = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO');
    const finished = DB.state.walkIns.filter(w => w.status === 'FINALIZADO' && w.date === today);

    activeGrid.innerHTML = active.map(w => {
      const stLabel = w.status === 'EN_SILLON' ? this.vx('{InServiceShort}') : 'En espera';
      const old = (w.date || today) !== today;
      const chairBtn = w.status === 'ESPERANDO' && !old
        ? '<button type="button" class="btn-dark btn-xs" onclick="CRM.setWalkInStatus(\'' + E(w.id) + '\',\'EN_SILLON\')">' + this.vx('{InServiceShort}') + '</button>'
        : '';
      return '<div class="crm-item-card">' +
        '<div>' +
          '<h3 style="font-size:1.15rem;">' + E(w.customerName) + '</h3>' +
          '<span class="st-badge st-' + E(w.status) + '" style="margin:4px 0 10px;">' + stLabel + '</span>' +
          (old ? '<p class="text-warn" style="font-size:0.78rem;">Quedó abierto del ' + E(w.date) + ': finalízalo.</p>' : '') +
          '<p style="font-size:0.83rem; line-height:1.65; color:var(--text-light); margin-bottom:14px;">' +
            E(w.service) + ' - <strong>' + cur + E(w.price) + '</strong><br/>' +
            E(Vocab.T('staff')) + ': <strong>' + E(w.barber) + '</strong> • Agregado: ' + E(w.addedAt) +
          '</p>' +
        '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid var(--border-subtle); padding-top:12px;">' +
          chairBtn +
          '<button type="button" class="btn-dark btn-xs" onclick="CRM.setWalkInStatus(\'' + E(w.id) + '\',\'FINALIZADO\')">Finalizar</button>' +
        '</div>' +
      '</div>';
    }).join('');

    document.getElementById('walkin-finished-count').textContent = finished.length + ' completados';
    document.getElementById('walkin-finished-list').innerHTML = finished.map(w =>
      '<div class="crm-list-item">' +
        '<div><strong>' + E(w.customerName) + '</strong> — ' + E(w.service) + ' (' + cur + E(w.price) + ')</div>' +
        '<span class="st-badge st-COMPLETADA">Finalizado</span>' +
      '</div>'
    ).join('');
  },

  async setWalkInStatus(id, status) {
    const w = DB.state.walkIns.find(x => x.id === id);
    if (!w) return false;
    w.status = status;
    if (status === 'FINALIZADO') { w.finishedAt = new Date().toISOString(); if (!w.date) w.date = DB.todayISO(); }
    this.renderAll();
    const ok = await DB.save();
    this.renderAll();
    return ok;
  },

  /* ---------- Ventas ---------- */
  renderSales() {
    const salesKpis = document.getElementById('sales-kpis-grid');
    if (!salesKpis) return;
    const E = (v) => UI.esc(v);
    const cur = this.cur();
    const today = DB.todayISO();
    const doneAppts = DB.state.appointments.filter(a => a.status === 'COMPLETADA');
    const doneWalks = DB.state.walkIns.filter(w => w.status === 'FINALIZADO');
    const allSales = [
      ...doneAppts.map(a => ({ date: a.date, time: a.time || '', customer: a.customerName, service: a.service, barber: a.barber, source: Vocab.T('appointment') + (a.source === 'WEB' ? ' web' : ' CRM'), price: Number(a.price) })),
      ...doneWalks.map(w => ({ date: w.date || today, time: w.addedAt || '', customer: w.customerName, service: w.service, barber: w.barber, source: 'Walk-In', price: Number(w.price) }))
    ];
    const totalRev = allSales.reduce((s, x) => s + x.price, 0);
    const avgTicket = allSales.length ? Math.round(totalRev / allSales.length) : 0;

    salesKpis.innerHTML =
      '<div class="crm-kpi-card"><div class="crm-kpi-label">INGRESOS ACUMULADOS</div><div class="crm-kpi-val">' + cur + totalRev + '</div><div class="crm-kpi-sub">Desde el inicio · por periodo en Reportes</div></div>' +
      '<div class="crm-kpi-card"><div class="crm-kpi-label">' + this.vx('{ClientPlural} atendidos').toUpperCase() + '</div><div class="crm-kpi-val">' + allSales.length + '</div><div class="crm-kpi-sub">Citas + Walk-ins</div></div>' +
      '<div class="crm-kpi-card"><div class="crm-kpi-label">TICKET PROMEDIO</div><div class="crm-kpi-val">' + cur + avgTicket + '</div><div class="crm-kpi-sub">Por atención</div></div>';

    const byBarber = {};
    const byService = {};
    allSales.forEach(s => {
      byBarber[s.barber] = (byBarber[s.barber] || 0) + s.price;
      byService[s.service] = (byService[s.service] || 0) + s.price;
    });
    const bars = (obj) => {
      const max = Math.max(...Object.values(obj), 1);
      return Object.entries(obj).sort((x, y) => y[1] - x[1]).map(([k, val]) =>
        '<div class="bar-row"><div class="bar-header"><span>' + E(k) + '</span><span>' + cur + val + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + Math.round((val / max) * 100) + '%;"></div></div></div>'
      ).join('') || '<p>Sin ventas aún.</p>';
    };
    document.getElementById('sales-by-barber-bars').innerHTML = bars(byBarber);
    document.getElementById('sales-by-service-bars').innerHTML = bars(byService);

    allSales.sort((x, y) => ((y.date + ' ' + y.time) > (x.date + ' ' + x.time) ? 1 : -1));
    const L = { client: E(Vocab.T('client')), service: E(Vocab.T('service')), staff: E(Vocab.T('staff')) };
    const src = this.fshow('appointments', 'source');
    const sh = document.getElementById('sales-recent-thead');
    if (sh) sh.innerHTML = '<tr><th scope="col">Fecha</th><th scope="col">' + L.client + '</th><th scope="col">' + L.service + '</th><th scope="col">' + L.staff + '</th>' + (src ? '<th scope="col">Origen</th>' : '') + '<th scope="col">Ingreso</th></tr>';
    document.getElementById('sales-recent-tbody').innerHTML = allSales.slice(0, 60).map(s =>
      '<tr><td data-label="Fecha">' + E(s.date) + (s.time ? ' ' + E(s.time) : '') + '</td><td data-label="' + L.client + '"><strong>' + E(s.customer) + '</strong></td><td data-label="' + L.service + '">' + E(s.service) + '</td><td data-label="' + L.staff + '">' + E(s.barber) + '</td>' + (src ? '<td data-label="Origen"><span class="st-badge st-EN_SILLON">' + E(s.source) + '</span></td>' : '') + '<td data-label="Ingreso"><strong style="color:var(--golden);">' + cur + s.price + '</strong></td></tr>'
    ).join('');
  },

  /* ---------- Clientes (B15: paginado con "Ver más") ---------- */
  renderCustomers(resetPage) {
    const custGrid = document.getElementById('crm-customers-grid');
    if (!custGrid) return;
    if (resetPage) this.custLimit = 60;
    const E = (v) => UI.esc(v);
    const q = (document.getElementById('cust-search-q')?.value || '').trim().toLowerCase();
    const F = (k) => this.fshow('customers', k);
    const customs = CrmConfig.custom('customers');
    const listed = customs.filter(f => f.showInList);
    const STD = [['email', 'Correo'], ['birthdate', 'Nacimiento'], ['document', 'Documento'], ['address', 'Dirección']].filter(([k]) => F(k));
    const list = DB.state.customers.filter(c => {
      const hay = (c.name + ' ' + c.phone + ' ' + c.notes + ' ' + (c.email || '') + ' ' + (c.document || '') + ' ' +
        customs.map(f => CrmConfig.display(f, (c.extra || {})[f.key])).join(' ')).toLowerCase();
      return !q || hay.includes(q);
    });
    const canEdit = Auth.can('customers.manage');
    custGrid.innerHTML = list.slice(0, this.custLimit).map(c => {
      const facts = STD.filter(([k]) => c[k]).map(([k, l]) => [l, k === 'birthdate' ? Reports.fmtDate(c[k]) : c[k]])
        .concat(listed.map(f => [f.label, CrmConfig.display(f, (c.extra || {})[f.key])]).filter(x => x[1]));
      return '<div class="crm-item-card" data-customer="' + E(c.id) + '">' +
        '<div>' +
          '<h3 style="font-size:1.15rem; margin-bottom:4px; overflow-wrap:anywhere;">' + E(c.name) + '</h3>' +
          (F('phone') ? '<div style="color:var(--golden); font-size:0.82rem; font-weight:700; margin-bottom:10px;">' + ic('phone') + ' ' + E(c.phone) + '</div>' : '') +
          (facts.length ? '<dl class="cust-facts">' + facts.map(([l, v]) => '<div><dt>' + E(l) + '</dt><dd>' + E(v) + '</dd></div>').join('') + '</dl>' : '') +
          (F('notes') ? '<p style="font-size:0.8rem; line-height:1.5; margin-bottom:12px;">' + E(c.notes || 'Sin observaciones') + '</p>' : '') +
        '</div>' +
        (canEdit ? '<div class="row-actions"><button type="button" class="btn-dark btn-xs" onclick="CRM.openCustomerModal(\'' + E(c.id) + '\')">' + ic('edit') + 'Editar ficha</button></div>' : '') +
      '</div>';
    }).join('') || '<div class="empty-state" style="grid-column:1/-1;">' + ic('users') + '<strong>' + this.vx('Sin {clientPlural}') + '</strong>' + (q ? 'Nadie coincide con la búsqueda.' : this.vx('Se agregan al registrar {appointmentPlural} con celular.')) + '</div>';
    const more = document.getElementById('cust-more');
    if (more) {
      more.hidden = list.length <= this.custLimit;
      more.textContent = 'Ver más (' + Math.max(0, list.length - this.custLimit) + ' restantes)';
    }
    const count = document.getElementById('cust-count');
    if (count) count.textContent = list.length + ' ' + Vocab.t(list.length === 1 ? 'client' : 'clientPlural');
  },

  showMoreCustomers() {
    this.custLimit += 60;
    this.renderCustomers();
  },

  /* ---------- Servicios ---------- */
  renderServices() {
    const srvGrid = document.getElementById('crm-services-grid');
    if (!srvGrid) return;
    const cur = this.cur();
    if (!DB.state.services.length) {
      srvGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">' + ic('tag') + '<strong>' + this.vx('Sin {servicePlural}') + '</strong>' + this.vx('Agrega {el:service} primer{o:service} con “Agregar {service}”.') + '</div>';
      return;
    }
    const F = (k) => this.fshow('services', k);
    srvGrid.innerHTML = DB.state.services.map(s =>
      '<div class="crm-item-card service-admin-card">' +
        '<div>' +
          '<div class="service-admin-top"><span class="service-admin-cat">' + (F('category') ? UI.esc(s.category || 'General') : '') + '</span>' +
            (s.featured && F('featured') ? '<span class="crm-nav-new">Destacado</span>' : '') + '</div>' +
          '<h3 style="font-size:1.25rem; margin:6px 0 8px;">' + UI.esc(s.name) + '</h3>' +
          '<div class="service-admin-meta"><strong>' + cur + ' ' + UI.esc(s.price) + '</strong>' + (F('duration') ? '<span>' + ic('clock') + UI.esc(s.duration) + ' min</span>' : '') + '</div>' +
          (F('description') ? '<p style="font-size:0.85rem; line-height:1.5; margin-top:10px;">' + UI.esc(s.desc || 'Sin descripción') + '</p>' : '') +
        '</div>' +
        '<div class="row-actions">' +
          '<button type="button" class="btn-dark btn-xs" onclick="CRM.openServiceModal(\'' + UI.esc(s.id) + '\')">' + ic('edit') + 'Editar</button>' +
          '<button type="button" class="btn-danger btn-xs" onclick="CRM.deleteService(\'' + UI.esc(s.id) + '\')">' + ic('trash') + 'Eliminar</button>' +
        '</div>' +
      '</div>'
    ).join('');
  },

  openServiceModal(editId) {
    const s = editId ? DB.state.services.find(x => x.id === editId) : null;
    if (editId && !s) return;
    const cats = Array.from(new Set(DB.state.services.map(x => x.category).filter(Boolean)));
    const v = (k, d) => UI.esc(s && s[k] != null ? s[k] : d);
    const hid = (k) => (this.fshow('services', k) ? '' : ' hidden');
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Catálogo</span><h3>' + this.vx(s ? 'Editar {service}' : 'Agregar {service}') + '</h3></div><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveServiceModal(event' + (s ? ', \'' + UI.esc(s.id) + '\'' : '') + ')" novalidate>' +
        '<div class="form-grid-2">' +
          '<div style="grid-column:1/-1;"><label class="field-lbl" for="m-sv-name">' + this.vx('Nombre {del:service} {service}') + ' <span class="req">*</span></label><input type="text" id="m-sv-name" class="input-dark" value="' + v('name', '') + '" maxlength="60" required /></div>' +
          '<div' + hid('category') + '><label class="field-lbl" for="m-sv-cat">Categoría</label><input type="text" id="m-sv-cat" class="input-dark" list="m-sv-cats" value="' + v('category', Vocab.type() === 'barberia' ? 'Cortes' : 'General') + '" maxlength="30" />' +
            '<datalist id="m-sv-cats">' + cats.map(c => '<option value="' + UI.esc(c) + '"></option>').join('') + '</datalist></div>' +
          '<div><label class="field-lbl" for="m-sv-price">Precio (' + this.cur() + ') <span class="req">*</span></label><input type="number" id="m-sv-price" class="input-dark" min="0" step="1" inputmode="numeric" value="' + v('price', '45') + '" required /></div>' +
          // Duración a mano, en minutos (la base acepta de 5 a 480)
          '<div' + hid('duration') + '><label class="field-lbl" for="m-sv-duration">Duración (minutos) <span class="req">*</span></label><input type="number" id="m-sv-duration" class="input-dark" min="5" max="480" step="1" inputmode="numeric" placeholder="Ej.: 40" value="' + v('duration', '') + '" required />' +
            '<span class="field-hint">De 5 a 480 minutos (8 horas).</span></div>' +
          '<div style="grid-column:1/-1;"' + hid('description') + '><label class="field-lbl" for="m-sv-desc">Descripción <span class="text-grey" style="font-weight:400;">(se muestra en la web)</span></label><textarea id="m-sv-desc" class="input-dark" maxlength="220">' + v('desc', '') + '</textarea></div>' +
        '</div>' +
        (s ? '<p class="form-note">' + ic('alert') + 'Si cambias el nombre o el precio, se actualizarán las citas futuras pendientes. Las citas pasadas conservan sus datos originales.</p>' : '') +
        '<div class="form-error" id="m-sv-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + (s ? 'Guardar cambios' : this.vx('Agregar {service}')) + '</button></div>' +
      '</form>'
    );
  },

  async saveServiceModal(e, editId) {
    e.preventDefault();
    const err = document.getElementById('m-sv-error');
    const name = document.getElementById('m-sv-name').value.trim();
    const category = document.getElementById('m-sv-cat').value.trim() || 'General';
    const price = Number(document.getElementById('m-sv-price').value);
    // Si el superadmin ocultó el campo, se conserva la duración que tenía (o 30, la de la base)
    const durRaw = document.getElementById('m-sv-duration').value.trim();
    const prevDur = editId ? Number((DB.state.services.find(x => x.id === editId) || {}).duration) || 30 : 30;
    const duration = this.fshow('services', 'duration') ? Number(durRaw) : prevDur;
    const desc = document.getElementById('m-sv-desc').value.trim();
    if (!name) { err.textContent = UI.v('Escribe el nombre {del:service} {service}.'); return false; }
    if (!isFinite(price) || price < 0) { err.textContent = 'Escribe un precio válido (0 o más).'; return false; }
    if (!durRaw && this.fshow('services', 'duration')) { err.textContent = UI.v('Escribe cuántos minutos dura {el:service} {service}.'); return false; }
    if (!Number.isInteger(duration) || duration < 5 || duration > 480) { err.textContent = 'La duración debe ser un número entero de minutos, entre 5 y 480.'; return false; }
    const dup = DB.state.services.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== editId);
    if (dup) { err.textContent = UI.v('Ya existe {un:service} {service} con ese nombre.'); return false; }

    if (editId) {
      const s = DB.state.services.find(x => x.id === editId);
      if (!s) return false;
      const today = DB.todayISO();
      let updated = 0;
      DB.state.appointments.forEach(a => {
        if (a.serviceId === s.id && a.date >= today && this.isVigente(a)) {
          a.service = name; a.price = price; updated++;
        }
      });
      Object.assign(s, { name, category, price, duration, desc });
      this.closeModal();
      const ok = await DB.save();
      this.renderAll();
      if (ok) UI.toast(UI.v('{Service} actualizad{o:service}') + (updated ? ' (' + updated + ' cita' + (updated === 1 ? '' : 's') + ' futura' + (updated === 1 ? '' : 's') + ' ajustada' + (updated === 1 ? '' : 's') + ').' : '.'));
      return ok;
    }
    DB.state.services.push({ id: DB.uid(), name, category, price, duration, desc: desc || '' });
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v('{Service} agregad{o:service} al catálogo.'));
    return ok;
  },

  deleteService(id) {
    const s = DB.state.services.find(x => x.id === id);
    if (!s) return;
    if (DB.state.services.length <= 1) { UI.toast(UI.v('Debe quedar al menos {un:service} {service} en el catálogo.'), 'error'); return; }
    const today = DB.todayISO();
    const future = DB.state.appointments.filter(a => a.serviceId === s.id && a.date >= today && this.isVigente(a)).length;
    UI.confirm({
      title: UI.v('Eliminar {service}'),
      message: '“' + s.name + '” dejará de mostrarse en la web y en el CRM.' + (future ? ' Ojo: tiene ' + future + ' cita(s) futura(s); ' + UI.v('se mantendrán con su precio actual, pero {el:service} {service} ya no podrá elegirse en nuevas reservas.') : '') + ' El historial de ventas se conserva.',
      confirmText: 'Eliminar', danger: true
    }).then(async ok => {
      if (!ok) return;
      DB.state.services = DB.state.services.filter(x => x.id !== id);
      DB.markDeleted('services', id);
      const saved = await DB.save();
      this.renderAll();
      if (!saved) return;
      DB.log(UI.v('Eliminó {un:service} {service}'), s.name + ' · ' + DB.state.settings.currency + ' ' + s.price + (future ? ' · ' + future + ' cita(s) futura(s) conservadas' : ''));
      UI.toast(UI.v('{Service} eliminad{o:service}.'));
    });
  },

  /* ---------- Reportes ---------- */
  renderReports() {
    const root = document.getElementById('crm-reports-root');
    if (!root || !DB.tenant) return;
    ReportBuilder.mount(root, {
      mode: 'crm',
      tenantId: DB.tenant.id,
      money: Auth.can('finance.view'),
      customers: Auth.can('customers.view'),   // M11: sin el módulo Clientes no hay teléfonos ni cartera
      canExport: () => Auth.can('reports.view')
    });
  },

  /* ---------- Configuración ---------- */
  renderSettings() {
    const t = DB.tenant;
    if (!t) return;
    if (this.setTenant !== t.id) { this.setTenant = t.id; this.setDirty = false; this.schDirty = false; this.dashDirty = false; }
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    if (!this.setDirty) {
      set('set-owner-name', t.ownerName);
      set('set-currency', t.currency || 'S/');
      set('set-address', t.address);
      set('set-phone', t.phone);
      set('set-hours', t.hours);
      set('set-city', t.city);
      set('set-lead', String(t.leadMinutes == null ? 15 : t.leadMinutes));
    }
    const nameEl = document.getElementById('set-tenant-name');
    if (nameEl) nameEl.textContent = t.name;
    const linkEl = document.getElementById('set-public-link');
    if (linkEl) { linkEl.href = Routes.web(t.slug); linkEl.textContent = Routes.display(Routes.web(t.slug)); }
    this.renderRubro();
    this.renderApptViewSetting();
    this.renderDashSetting();
    this.renderSchedule();
    this.renderExceptions();
    this.renderWhatsApp();
  },

  /* ---------- Rubro del negocio y palabras personalizadas ----------
     Se guarda en tenants.business_type y tenants.labels (solo las palabras
     que el negocio cambió; vacío = la del rubro). */
  LABEL_FIELDS: [
    ['staff', 'Quien atiende (singular)'], ['staffPlural', 'Quien atiende (plural)'],
    ['client', 'Quien reserva (singular)'], ['clientPlural', 'Quien reserva (plural)'],
    ['service', 'Lo que se ofrece (singular)'], ['servicePlural', 'Lo que se ofrece (plural)'],
    ['appointment', 'La reserva (singular, p. ej. turno)'], ['appointmentPlural', 'La reserva (plural, p. ej. turnos)'],
    ['inService', 'Estado de atención sin cita']
  ],

  renderRubro() {
    const sel = document.getElementById('set-rubro');
    if (!sel || !window.Vocab || !DB.tenant) return;
    if (this.rubroTenant !== DB.tenant.id) { this.rubroTenant = DB.tenant.id; this.rubroDirty = false; }
    if (this.rubroDirty) return;   // cambios sin guardar: no se repinta
    const t = DB.tenant;
    const type = Vocab.PRESETS[t.businessType] ? t.businessType : Vocab.DEFAULT_TYPE;
    sel.innerHTML = (Vocab.TYPES || Object.keys(Vocab.PRESETS)).map(k =>
      '<option value="' + UI.esc(k) + '"' + (k === type ? ' selected' : '') + '>' + UI.esc(Vocab.PRESETS[k].label) + '</option>').join('');
    const labels = t.labels || {};
    const grid = document.getElementById('set-labels-grid');
    if (grid) {
      grid.innerHTML = this.LABEL_FIELDS.map(([k, lbl]) =>
        '<div><label class="field-lbl" for="set-lbl-' + k + '">' + UI.esc(lbl) + '</label>' +
        '<input type="text" id="set-lbl-' + k + '" class="input-dark" maxlength="40" value="' + UI.esc(labels[k] || '') + '" oninput="CRM.onRubroChange()" /></div>').join('');
    }
    const box = document.getElementById('set-labels-box');
    if (box && Object.keys(labels).length) box.open = true;
    const err = document.getElementById('set-rubro-error');
    if (err) err.textContent = '';
    this.onRubroChange(true);
  },

  // Lee el formulario: { type, labels } (labels solo con las palabras escritas)
  readRubro() {
    const type = (document.getElementById('set-rubro') || {}).value || Vocab.DEFAULT_TYPE;
    const labels = {};
    this.LABEL_FIELDS.forEach(([k]) => {
      const el = document.getElementById('set-lbl-' + k);
      const v = el ? el.value.trim() : '';
      if (v) labels[k] = v;
    });
    return { type, labels };
  },

  // Al cambiar el rubro: placeholders con las palabras del preset y vista previa
  onRubroChange(initial) {
    if (!window.Vocab) return;
    if (initial !== true) this.rubroDirty = true;
    const { type, labels } = this.readRubro();
    const p = Vocab.PRESETS[type] || Vocab.PRESETS[Vocab.DEFAULT_TYPE];
    this.LABEL_FIELDS.forEach(([k]) => {
      const el = document.getElementById('set-lbl-' + k);
      if (el) el.placeholder = p[k] || '';
    });
    const w = Object.assign({}, p, labels);
    const prev = document.getElementById('set-rubro-preview');
    if (prev) {
      const cap = (s) => String(s).charAt(0).toLocaleUpperCase('es-PE') + String(s).slice(1);
      prev.textContent = cap(w.staffPlural) + ' · ' + cap(w.clientPlural) + ' · ' + cap(w.servicePlural) + ' · ' + cap(w.inService);
    }
  },

  async saveRubro() {
    const err = document.getElementById('set-rubro-error');
    if (err) err.textContent = '';
    const { type, labels } = this.readRubro();
    if (!Vocab.PRESETS[type]) { if (err) err.textContent = 'Elige un rubro de la lista.'; return false; }
    const bad = Object.keys(labels).find(k => labels[k].length > 40 || /[<>"]/.test(labels[k]));
    if (bad) { if (err) err.textContent = 'Las palabras deben tener hasta 40 caracteres y no llevar los signos < > ".'; return false; }
    const t = DB.tenant;
    const before = Vocab.label(t.businessType) + (Object.keys(t.labels || {}).length ? ' (personalizado)' : '');
    if (t.businessType === type && JSON.stringify(t.labels || {}) === JSON.stringify(labels)) {
      this.rubroDirty = false;
      UI.toast('No hay cambios por guardar.', 'info');
      return false;
    }
    t.businessType = type;
    t.labels = labels;
    const ok = await DB.save();
    if (!ok) return false;
    this.rubroDirty = false;
    DB.log('Cambió el rubro del negocio', 'Antes: ' + before + ' · Ahora: ' + Vocab.label(type) +
      (Object.keys(labels).length ? ' · palabras: ' + Object.keys(labels).map(k => k + '=' + labels[k]).join(', ') : ''));
    this.renderAll();
    UI.toast('Rubro guardado. Las palabras ya se ven en el CRM y en la web.');
    return true;
  },

  /* ---------- WhatsApp: vincular, mensajes y recordatorios ---------- */
  WA_KIND: { SHOP_NEW: 'Aviso de reserva', SHOP_CANCEL: 'Aviso de cancelación', SHOP_RESCHEDULE: 'Aviso de cambio',
    CLIENT_CONFIRM: 'Confirmación', CLIENT_CANCEL: 'Cancelación al cliente', CLIENT_RESCHEDULE: 'Cambio al cliente',
    REMINDER: 'Recordatorio', REPLY: 'Respuesta', TEST: 'Prueba' },
  WA_STATUS: { PENDING: ['Programado', 'PROGRAMADA'], SENDING: ['Enviando', 'PROGRAMADA'], SENT: ['Enviado', 'COMPLETADA'],
    FAILED: ['Falló', 'CANCELADA'], CANCELLED: ['Anulado', 'NO_ASISTIO'] },
  // Textos que se ofrecen si el negocio aún no tiene la plantilla (la base trae los mismos por defecto).
  // {negocio} y {profesional} son los recomendados; {barberia} y {barbero} siguen funcionando.
  WA_TPL_FALLBACK: {
    clientCancel: '{cliente}, tu cita en {negocio} del {fecha} a las {hora} fue cancelada. Si quieres otra fecha, reserva de nuevo o escríbenos.',
    clientReschedule: '{cliente}, tu cita en {negocio} cambió: ahora es el {fecha} a las {hora} con {profesional}. Código {codigo}.'
  },
  WA_QR_TTL: 2 * 60 * 1000,      // un QR de WhatsApp no sirve después de ~2 min
  WA_STALE: 3 * 60 * 1000,       // sin latido del bot en 3 min = bot apagado

  waConfig() {
    const c = (DB.tenant && DB.tenant.whatsapp) || {};
    return Object.assign({ enabled: false, notifyTo: [], templates: {}, reminders: [], quietHours: {} }, c);
  },

  renderWhatsApp() {
    const card = document.getElementById('wa-card');
    if (!card || !DB.tenant) return;
    if (this.waTenant !== DB.tenant.id) { this.waTenant = DB.tenant.id; this.waDirty = false; this.waSession = null; this.waHistory = []; this.waLastFetch = 0; }
    if (!this.waDirty) {
      const c = this.waConfig();
      const tp = c.templates || {};
      document.getElementById('wa-enabled').checked = !!c.enabled;
      document.getElementById('wa-notify').value = (c.notifyTo || []).join(', ');
      document.getElementById('wa-quiet-from').value = (c.quietHours && c.quietHours.from) || '';
      document.getElementById('wa-quiet-to').value = (c.quietHours && c.quietHours.to) || '';
      document.getElementById('wa-tpl-confirm').value = tp.clientConfirm || '';
      const cc = document.getElementById('wa-tpl-ccancel');
      if (cc) cc.value = tp.clientCancel != null ? tp.clientCancel : this.WA_TPL_FALLBACK.clientCancel;
      const cr = document.getElementById('wa-tpl-cresched');
      if (cr) cr.value = tp.clientReschedule != null ? tp.clientReschedule : this.WA_TPL_FALLBACK.clientReschedule;
      this.waReminders = (c.reminders || []).map(r => Object.assign({}, r));
      this.renderWaReminders();
      // Plantillas antiguas con {barbero}/{barberia}: se avisa que siguen funcionando
      const legacy = document.getElementById('wa-vars-legacy');
      if (legacy) {
        const old = /\{barber(o|ia)\}/.test(JSON.stringify([tp, c.reminders || []]));
        legacy.hidden = !old;
        legacy.textContent = old ? ' Tus textos usan variables antiguas: {barbero} equivale a {profesional} y {barberia} a {negocio}; siguen funcionando.' : '';
      }
      document.getElementById('wa-error').textContent = '';
      // Lo que hay en pantalla al abrir: se guarda solo lo que cambie respecto de esto
      this.waBase = this.readWaForm();
    }
    this.renderWaSession();
    this.waPoll();
  },

  renderWaReminders() {
    const box = document.getElementById('wa-reminders');
    if (!box) return;
    const rems = this.waReminders || [];
    box.innerHTML = rems.length ? rems.map((r, i) =>
      '<div class="wa-rem">' +
        '<div><label class="field-lbl" for="wa-rem-h-' + i + '">Horas antes de la cita</label>' +
          '<input type="number" id="wa-rem-h-' + i + '" class="input-dark" min="0.5" max="168" step="0.5" inputmode="decimal" value="' +
          UI.esc(Number(r.offsetMinutes) / 60) + '" />' +
          '<label class="check-line wa-rem-only"><input type="checkbox" id="wa-rem-c-' + i + '"' + (r.onlyIfNotConfirmed ? ' checked' : '') + ' />' +
          '<span>' + this.vx('Solo si el {client} no confirmó') + '</span></label></div>' +
        '<div><label class="field-lbl" for="wa-rem-t-' + i + '">Mensaje</label>' +
          '<textarea id="wa-rem-t-' + i + '" class="input-dark" rows="3" maxlength="600">' + UI.esc(r.template || '') + '</textarea></div>' +
        '<div><span class="field-lbl">&nbsp;</span><button type="button" class="btn-dark" onclick="CRM.waRemoveReminder(' + i + ')" aria-label="Quitar recordatorio"><i data-icon="trash"></i></button></div>' +
      '</div>').join('')
      : '<p class="sch-exc-empty">Sin recordatorios.</p>';
    Icons.hydrate(box);
  },

  // Copia lo escrito en pantalla antes de agregar o quitar un recordatorio
  readWaReminders() {
    return (this.waReminders || []).map((r, i) => {
      const h = document.getElementById('wa-rem-h-' + i);
      const t = document.getElementById('wa-rem-t-' + i);
      const c = document.getElementById('wa-rem-c-' + i);
      return Object.assign({}, r, {
        offsetMinutes: h ? Math.round(parseFloat(String(h.value).replace(',', '.')) * 60) : r.offsetMinutes,
        template: t ? t.value.trim() : r.template,
        onlyIfNotConfirmed: c ? !!c.checked : !!r.onlyIfNotConfirmed
      });
    });
  },

  // Formulario completo (sin validar), con la misma forma que whatsapp en la base
  readWaForm() {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
    const nums = g('wa-notify').split(/[,;\n]/).map(s => s.replace(/\D/g, '')).filter(Boolean);
    const qf = g('wa-quiet-from'), qt = g('wa-quiet-to');
    return {
      enabled: !!(document.getElementById('wa-enabled') || {}).checked,
      notifyTo: nums.map(n => n.slice(-9)),
      quietHours: qf || qt ? { from: qf, to: qt } : {},
      reminders: this.readWaReminders(),
      templates: { clientConfirm: g('wa-tpl-confirm').trim(), clientCancel: g('wa-tpl-ccancel').trim(), clientReschedule: g('wa-tpl-cresched').trim() }
    };
  },

  waAddReminder() {
    this.waReminders = this.readWaReminders();
    if (this.waReminders.length >= 5) { UI.toast('Máximo 5 recordatorios por cita.', 'error'); return; }
    this.waReminders.push({ id: 'r' + Date.now().toString(36), offsetMinutes: 180, onlyIfNotConfirmed: false,
      template: '{cliente}, te recordamos tu cita {cuando} a las {hora} con {profesional}. ¡Te esperamos en {negocio}!' });
    this.waDirty = true;
    this.renderWaReminders();
  },

  waRemoveReminder(i) {
    this.waReminders = this.readWaReminders();
    this.waReminders.splice(i, 1);
    this.waDirty = true;
    this.renderWaReminders();
  },

  /* Guarda SOLO lo que se editó: vuelve a leer la configuración actual de la
     base y le aplica los cambios (no reenvía una copia vieja completa que
     podría pisar lo que cambió otra persona o el servidor). */
  async saveWhatsApp() {
    const err = document.getElementById('wa-error');
    err.textContent = '';
    const form = this.readWaForm();
    const bad = form.notifyTo.find(n => !/^9\d{8}$/.test(n));
    const rawBad = document.getElementById('wa-notify').value.split(/[,;\n]/).map(s => s.replace(/\D/g, '')).filter(Boolean).find(n => !/^(51)?9\d{8}$/.test(n));
    if (bad || rawBad) { err.textContent = 'El número ' + (rawBad || bad) + ' no es un celular válido (9 dígitos, empieza con 9).'; return false; }
    for (const r of form.reminders) {
      if (!(r.offsetMinutes >= 30 && r.offsetMinutes <= 10080)) { err.textContent = 'Cada recordatorio debe salir entre media hora y 7 días antes de la cita.'; return false; }
      if (!r.template) { err.textContent = 'Escribe el mensaje de cada recordatorio.'; return false; }
    }
    if (!form.templates.clientConfirm) { err.textContent = 'Escribe el mensaje que se envía al reservar.'; return false; }
    // clientCancel / clientReschedule vacíos = ese aviso al cliente no se envía
    const qh = form.quietHours;
    const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (qh.from || qh.to) {
      if (!hhmm.test(qh.from || '') || !hhmm.test(qh.to || '')) { err.textContent = 'Completa las dos horas de silencio con el formato HH:MM (por ejemplo 22:00 y 08:00), o deja ambas vacías.'; return false; }
      if (qh.from === qh.to) { err.textContent = 'Las horas de silencio deben ser distintas.'; return false; }
    }

    // ¿Qué cambió respecto de lo que se mostró al abrir?
    const base = this.waBase || {};
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const patch = {};
    ['enabled', 'notifyTo', 'quietHours', 'reminders'].forEach(k => { if (!same(form[k], base[k])) patch[k] = form[k]; });
    const tplPatch = {};
    Object.keys(form.templates).forEach(k => { if (!same(form.templates[k], (base.templates || {})[k])) tplPatch[k] = form.templates[k]; });
    if (!Object.keys(patch).length && !Object.keys(tplPatch).length) {
      this.waDirty = false;
      UI.toast('No hay cambios por guardar.', 'info');
      return false;
    }

    let next;
    try {
      const sb = DB.client();
      const { data: row, error: e1 } = await sb.from('tenants').select('whatsapp').eq('id', DB.tenant.id).single();
      if (e1) throw e1;
      const current = (row && row.whatsapp && typeof row.whatsapp === 'object') ? row.whatsapp : {};
      next = Object.assign({}, current, patch);
      if (Object.keys(tplPatch).length) next.templates = Object.assign({}, current.templates || {}, tplPatch);
      const { data, error } = await sb.from('tenants').update({ whatsapp: next }).eq('id', DB.tenant.id).select('whatsapp');
      if (error) throw error;
      if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
      next = data[0].whatsapp || next;
    } catch (e) {
      if (DB.isAuthError(e)) { DB.sessionLost('expired'); return false; }
      err.textContent = DB.errorText(e);
      return false;
    }
    DB.tenant.whatsapp = next;
    this.waDirty = false;
    const changed = Object.keys(patch).concat(Object.keys(tplPatch).map(k => 'plantilla ' + k));
    DB.log('Cambió la configuración de WhatsApp', (next.enabled ? 'Activado' : 'Desactivado') + ' · cambió: ' + changed.join(', ') + ' · ' + (next.reminders || []).length + ' recordatorio(s) · avisos a ' + ((next.notifyTo || []).join(', ') || 'nadie'));
    this.renderWhatsApp();
    const linked = this.waSession && this.waSession.status === 'CONNECTED';
    UI.toast(!next.enabled ? 'Guardado. Los mensajes automáticos están APAGADOS.'
      : (!linked ? 'Guardado. Los mensajes saldrán cuando vincules el WhatsApp.' : 'Configuración de WhatsApp guardada.'));
    return true;
  },

  async waRequest(action) {
    if (action === 'LOGOUT') {
      const ok = await UI.confirm({ title: 'Desvincular WhatsApp',
        message: UI.v('Dejarán de salir los mensajes de {este:business} {business} hasta que lo vuelvas a vincular.'), confirmText: 'Desvincular', danger: true });
      if (!ok) return;
    }
    try {
      const { error } = await DB.client().rpc('wa_solicitar', { p_accion: action, p_tenant_id: DB.tenant.id });
      if (error) throw error;
    } catch (e) { UI.toast(DB.errorText(e), 'error'); return; }
    this.waRequestedAt = Date.now();
    this.waQrSrc = null; this.waQrAt = 0;
    this.waSession = Object.assign({}, this.waSession, { requested_action: action, qr: null, last_error: null,
      status: action === 'LINK' ? 'WAITING_QR' : (this.waSession && this.waSession.status) || 'DISCONNECTED' });
    this.renderWaSession();
    this.waPoll(true);
  },

  async waTest() {
    const n = document.getElementById('wa-test-num').value.replace(/\D/g, '');
    if (!/^9\d{8}$/.test(n)) { UI.toast('Escribe un celular de 9 dígitos que empiece con 9.', 'error'); return; }
    try {
      const { error } = await DB.client().rpc('wa_enviar_prueba', { p_numero: n, p_tenant_id: DB.tenant.id });
      if (error) throw error;
    } catch (e) { UI.toast(DB.errorText(e), 'error'); return; }
    UI.toast(this.waSession && this.waSession.status === 'CONNECTED'
      ? 'Mensaje de prueba en camino. Llega en menos de un minuto.' : 'Mensaje en cola: saldrá cuando el WhatsApp esté vinculado.');
    this.waPoll(true);
  },

  // Estado del WhatsApp y últimos envíos: se consultan solo con el apartado WhatsApp abierto
  waPoll(now) {
    clearTimeout(this.waTimer);
    if (this.currentTab !== 'whatsapp' || !DB.tenant) return;
    const s = this.waSession;
    const waiting = s && (s.requested_action || s.status === 'WAITING_QR');
    const due = now ? 0 : (this.waLastFetch || 0) + (waiting ? 3000 : 20000) - Date.now();
    this.waTimer = setTimeout(() => this.waFetch(), Math.max(400, due));
  },

  async waFetch() {
    if (this.currentTab !== 'whatsapp' || !DB.tenant) return;
    const tid = DB.tenant.id;
    this.waLastFetch = Date.now();
    try {
      const sb = DB.client();
      const [ses, hist, outs] = await Promise.all([
        sb.from('wa_sessions').select('*').eq('tenant_id', tid).maybeSingle(),
        sb.from('wa_outbox').select('kind, recipient, body, status, send_at, sent_at, last_error')
          .eq('tenant_id', tid).order('created_at', { ascending: false }).limit(12),
        sb.from('wa_opt_outs').select('phone, created_at').eq('tenant_id', tid).order('created_at', { ascending: false }).limit(100)
      ]);
      if (!DB.tenant || DB.tenant.id !== tid) return;
      if (!ses.error) this.waSession = ses.data;
      if (!hist.error) this.waHistory = hist.data || [];
      this.waOptOuts = outs.error ? null : (outs.data || []);
    } catch (e) { /* sin conexión: se reintenta */ }
    this.renderWaSession();
    this.waPoll();
  },

  /* Estado del vínculo (A7/B2):
       - Vinculado y bot vivo → Conectado.
       - Vinculado pero el bot no late → "Bot apagado: enciende el bot". NO se
         ofrece "Vincular" (un pedido pendiente borraría la sesión buena).
       - QR de más de ~2 min o con el bot apagado → el QR expiró.
       - Se muestra el último error concreto que dejó el bot. */
  waState(s) {
    const now = Date.now();
    const seen = s.last_seen_at ? Date.parse(s.last_seen_at) : 0;
    const stale = !seen || now - seen > this.WA_STALE;
    if (s.qr && s.qr !== this.waQrSrc) { this.waQrSrc = s.qr; this.waQrAt = now; }
    if (!s.qr) { this.waQrSrc = null; this.waQrAt = 0; }
    const qrAge = s.qr_at ? now - Date.parse(s.qr_at) : (this.waQrAt ? now - this.waQrAt : 0);
    const qrExpired = !!s.qr && (qrAge > this.WA_QR_TTL || stale);
    const noBot = !!(s.requested_action && this.waRequestedAt && now - this.waRequestedAt > 20000);
    const lastSeen = seen ? new Date(seen).toLocaleString('es-PE') : '';
    const st = { label: 'Sin vincular', cls: 'PROGRAMADA', showQr: false, link: true, logout: false,
      text: UI.v('Pulsa "Vincular WhatsApp" y escanea el código con el celular {del:business} {business}: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.') };
    if (s.status === 'CONNECTED' && !stale) {
      Object.assign(st, { label: 'Conectado', cls: 'CONFIRMADA_WSP', link: false, logout: true,
        text: 'Conectado al número +' + (s.phone || '') + '. Los mensajes salen solos.' });
    } else if (s.status === 'CONNECTED') {
      Object.assign(st, { label: 'Bot apagado', cls: 'CANCELADA', link: false, logout: true,
        text: 'Bot apagado: enciende el bot. El WhatsApp sigue vinculado' + (s.phone ? ' al +' + s.phone : '') + ' (no hace falta volver a vincular). ' +
          (lastSeen ? 'Última señal: ' + lastSeen + '. ' : '') + 'Los mensajes esperan en cola.' });
    } else if (s.status === 'WAITING_QR' || s.requested_action === 'LINK') {
      if (qrExpired) {
        Object.assign(st, { label: 'QR vencido', cls: 'NO_ASISTIO', link: true, logout: false,
          text: stale ? 'El código QR expiró y el bot no responde. Enciende el bot y vuelve a pulsar "Vincular WhatsApp".'
            : 'El código QR expiró. Pulsa "Vincular WhatsApp" para generar uno nuevo.' });
      } else if (s.qr) {
        Object.assign(st, { label: 'Esperando escaneo', cls: 'PROGRAMADA', showQr: true, link: false, logout: true,
          text: UI.v('Abre WhatsApp en el celular {del:business} {business} → Dispositivos vinculados → Vincular un dispositivo, y escanea este código (vence en unos 2 minutos).') });
      } else if (noBot || (seen && stale)) {
        Object.assign(st, { label: 'Bot apagado', cls: 'CANCELADA', link: true, logout: false,
          text: 'Bot apagado: enciende el bot para generar el código QR' + (lastSeen ? ' (última señal: ' + lastSeen + ')' : '') + '.' });
      } else {
        Object.assign(st, { label: 'Generando QR', cls: 'PROGRAMADA', link: false, logout: false, text: 'Generando el código QR…' });
      }
    } else if (s.status === 'LOGGED_OUT') {
      Object.assign(st, { label: 'Desvinculado', cls: 'NO_ASISTIO' });
    }
    st.error = s.last_error && !(s.status === 'CONNECTED' && !stale) ? s.last_error : '';
    return st;
  },

  renderWaSession() {
    const s = this.waSession || { status: 'DISCONNECTED' };
    const badge = document.getElementById('wa-status');
    const msg = document.getElementById('wa-link-msg');
    const qr = document.getElementById('wa-qr');
    if (!badge || !msg || !qr) return;
    const st = this.waState(s);
    badge.className = 'st-badge st-' + st.cls;
    badge.textContent = st.label;
    msg.innerHTML = UI.esc(st.text) + (st.error ? '<span class="wa-last-error"><strong>Último error:</strong> ' + UI.esc(st.error) + '</span>' : '');
    qr.hidden = !st.showQr;
    if (st.showQr && qr.dataset.src !== s.qr) {
      qr.dataset.src = s.qr;
      qr.innerHTML = /^data:image\/(png|jpeg|gif|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(s.qr || '')
        ? '<img alt="Código QR para vincular WhatsApp" src="' + UI.esc(s.qr) + '" />' : '';
    }
    if (!st.showQr) { qr.innerHTML = ''; qr.dataset.src = ''; }
    document.getElementById('wa-btn-logout').hidden = !st.logout;
    document.getElementById('wa-btn-link').hidden = !st.link;

    // Aviso: vinculado pero con los mensajes automáticos apagados (fácil de olvidar)
    const warn = document.getElementById('wa-warn');
    if (warn) {
      const c = this.waConfig();
      const linked = s.status === 'CONNECTED';
      warn.hidden = !(linked && !c.enabled);
      warn.innerHTML = warn.hidden ? '' : ic('alert') + '<span>El WhatsApp está vinculado pero los mensajes automáticos están <strong>apagados</strong>: no saldrán confirmaciones ni recordatorios. Marca “Enviar mensajes automáticos por WhatsApp” y pulsa Guardar.</span>';
    }

    this.renderWaOptOuts();

    const hist = document.getElementById('wa-history');
    const rows = this.waHistory || [];
    hist.innerHTML = rows.length ? rows.map(m => {
      const sx = this.WA_STATUS[m.status] || [m.status, 'PROGRAMADA'];
      const when = new Date(m.sent_at || m.send_at).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      const to = String(m.recipient || '').replace(/^51(?=9\d{8}$)/, '');
      return '<div class="sch-exc-item"><div><strong>' + UI.esc(this.WA_KIND[m.kind] || m.kind) + ' · ' + UI.esc(to) + '</strong>' +
        '<span class="wa-hist-body">' + UI.esc(String(m.body || '').slice(0, 140)) + '</span>' +
        ((m.status === 'FAILED' || m.status === 'CANCELLED') && m.last_error ? '<span>' + (m.status === 'FAILED' ? 'Error: ' : 'Motivo: ') + UI.esc(m.last_error) + '</span>' : '') + '</div>' +
        '<div><span class="st-badge st-' + UI.esc(sx[1]) + '">' + UI.esc(sx[0]) + '</span><span style="display:block; margin-top:4px;">' + UI.esc(when) + '</span></div></div>';
    }).join('') : '<p class="sch-exc-empty">Todavía no hay envíos.</p>';
  },

  /* Clientes (pacientes…) que pidieron no recibir mensajes (respondieron BAJA).
     Quitar un número de la lista vuelve a permitir los mensajes a esa persona. */
  renderWaOptOuts() {
    const box = document.getElementById('wa-optouts');
    if (!box) return;
    const rows = this.waOptOuts;
    if (rows == null) { box.innerHTML = '<p class="sch-exc-empty">No se pudo leer la lista.</p>'; return; }
    box.innerHTML = rows.length ? rows.map(r => {
      const p = String(r.phone || '');
      const shown = p.replace(/^51(?=9\d{8}$)/, '');
      return '<div class="sch-exc-item"><div><strong>' + UI.esc(shown) + '</strong><span>Desde el ' + UI.esc(UI.fmtDateTime(r.created_at)) + '</span></div>' +
        '<div><button type="button" class="btn-dark btn-xs" onclick="CRM.waRemoveOptOut(\'' + UI.arg(p) + '\')">Quitar</button></div></div>';
    }).join('') : '<p class="sch-exc-empty">Nadie pidió dejar de recibir mensajes.</p>';
  },

  async waRemoveOptOut(phone) {
    const ok = await UI.confirm({ title: 'Volver a enviar mensajes',
      message: UI.v('El {client} ') + String(phone).replace(/^51/, '') + ' pidió no recibir mensajes. Quítalo de la lista solo si te lo pidió.', confirmText: 'Quitar de la lista' });
    if (!ok) return false;
    try {
      const { data, error } = await DB.client().from('wa_opt_outs').delete().eq('tenant_id', DB.tenant.id).eq('phone', phone).select('phone');
      if (error) throw error;
      if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
    } catch (e) {
      if (DB.isAuthError(e)) { DB.sessionLost('expired'); return false; }
      UI.toast(DB.errorText(e), 'error');
      return false;
    }
    this.waOptOuts = (this.waOptOuts || []).filter(r => r.phone !== phone);
    this.renderWaOptOuts();
    DB.log('Quitó un número de la lista de baja de WhatsApp', String(phone));
    UI.toast('Número quitado de la lista de baja.');
    return true;
  },

  /* ---------- Horario de atención del negocio ---------- */
  renderSchedule() {
    const iv = document.getElementById('set-sch-interval');
    if (!iv || this.schDirty) return;   // M13: no se repinta con cambios sin guardar
    const sch = DB.tenant.schedule || DB.normSchedule(null);
    iv.innerHTML = DB.INTERVALS.map(m => '<option value="' + m + '"' + (m === sch.interval ? ' selected' : '') + '>' +
      (m < 60 ? m + ' minutos' : (m === 60 ? '1 hora' : (m / 60).toString().replace('.', ',') + ' horas')) + '</option>').join('');
    document.getElementById('set-sch-maxdays').value = sch.maxDays;
    document.getElementById('set-sch-week').innerHTML = ScheduleEditor.html('set-sch', sch.week);
    document.getElementById('set-sch-error').textContent = '';
  },

  async saveSchedule() {
    const err = document.getElementById('set-sch-error');
    const res = ScheduleEditor.read('set-sch');
    if (res.error) { err.textContent = res.error; return false; }
    const maxDays = parseInt(document.getElementById('set-sch-maxdays').value, 10);
    if (!(maxDays >= 1 && maxDays <= 365)) { err.textContent = 'Los días para reservar deben estar entre 1 y 365.'; return false; }
    err.textContent = '';
    const t = DB.tenant;
    const before = ScheduleEditor.summary(t.schedule.week) + ' · cada ' + t.schedule.interval + ' min';
    t.schedule = { interval: Number(document.getElementById('set-sch-interval').value), maxDays, week: res.week };
    const ok = await DB.save();
    if (!ok) return false;
    this.schDirty = false;
    DB.log('Cambió el horario de atención', 'Antes: ' + before + ' · Ahora: ' + ScheduleEditor.summary(res.week) + ' · cada ' + t.schedule.interval + ' min');
    this.renderAll();
    UI.toast('Horario guardado. La web ya muestra los nuevos horarios.');
    return true;
  },

  /* ---------- Fechas especiales ---------- */
  exceptionWho(e) {
    if (!e.barberId) return UI.v('Tod{o:business} {el:business} {business}');
    const b = DB.state.barberProfiles.find(x => x.id === e.barberId);
    return b ? b.name : UI.v('{Staff} eliminad{o:staff}');
  },

  renderExceptions() {
    const who = document.getElementById('set-exc-who');
    const list = document.getElementById('set-exc-list');
    if (!who || !list) return;
    const prevWho = who.value;
    who.innerHTML = '<option value="">' + this.vx('Tod{o:business} {el:business} {business}') + '</option>' +
      DB.state.barberProfiles.map(b => '<option value="' + UI.esc(b.id) + '">' + UI.esc(b.name) + '</option>').join('');
    if (prevWho && DB.isUuid(prevWho) && who.querySelector('option[value="' + prevWho + '"]')) who.value = prevWho;
    const dateEl = document.getElementById('set-exc-date');
    dateEl.min = DB.todayISO();
    if (!dateEl.value) dateEl.value = DB.todayISO();
    const items = (DB.state.scheduleExceptions || []).filter(e => e.date >= DB.todayISO())
      .sort((a, b) => a.date.localeCompare(b.date) || this.exceptionWho(a).localeCompare(this.exceptionWho(b), 'es'));
    if (!items.length) { list.innerHTML = '<p class="sch-exc-empty">No hay fechas especiales próximas.</p>'; return; }
    list.innerHTML = '<div class="sch-exc-list">' + items.map(e =>
      '<div class="sch-exc-item">' +
        '<div><strong>' + UI.esc(this.fmtLongDate(e.date)) + ' · ' + UI.esc(this.exceptionWho(e)) + '</strong>' +
        '<span>' + (e.ranges.length ? 'Atiende ' + UI.esc(e.ranges.map(r => r[0] + ' a ' + r[1]).join(' y ')) : 'No se atiende') +
          (e.note ? ' · ' + UI.esc(e.note) : '') + '</span></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="CRM.deleteException(\'' + UI.esc(e.id) + '\')" aria-label="Quitar fecha especial">' + ic('trash') + 'Quitar</button>' +
      '</div>').join('') + '</div>';
  },

  fmtLongDate(iso) {
    const d = new Date(iso + 'T12:00:00');
    const m = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return DB.DAY_NAMES[d.getDay()] + ' ' + d.getDate() + ' de ' + m[d.getMonth()];
  },

  toggleExceptionHours() {
    const box = document.getElementById('set-exc-hours');
    if (box) box.hidden = document.getElementById('set-exc-kind').value !== 'hours';
  },

  async addException() {
    const err = document.getElementById('set-exc-error');
    const date = document.getElementById('set-exc-date').value;
    const barberId = document.getElementById('set-exc-who').value || null;
    const kind = document.getElementById('set-exc-kind').value;
    const note = document.getElementById('set-exc-note').value.trim().slice(0, 80);
    if (!date || date < DB.todayISO()) { err.textContent = 'Elige una fecha de hoy en adelante.'; return false; }
    let ranges = [];
    if (kind === 'hours') {
      const f = document.getElementById('set-exc-from').value;
      const t = document.getElementById('set-exc-to').value;
      if (!f || !t || f >= t) { err.textContent = 'La hora de inicio debe ser antes de la de cierre.'; return false; }
      ranges = [[f, t]];
    }
    const list = DB.state.scheduleExceptions || (DB.state.scheduleExceptions = []);
    if (list.some(e => e.date === date && (e.barberId || null) === barberId)) {
      err.textContent = 'Ya hay una fecha especial ese día para ' + (barberId ? this.exceptionWho({ barberId }) : UI.v('tod{o:business} {el:business} {business}')) + '. Quítala primero.';
      return false;
    }
    const affected = DB.visibleAppointments().filter(a => a.date === date && this.isVigente(a) &&
      (!barberId || a.barberId === barberId) && !(ranges.length && DB.slotFits(a.time, DB.tenant.schedule.interval, ranges)));
    err.textContent = '';
    list.push({ id: DB.uid(), barberId, date, ranges, note });
    const ok = await DB.save();
    this.renderAll();
    if (!ok) return false;
    DB.log('Agregó una fecha especial', date + ' · ' + this.exceptionWho({ barberId }) + ' · ' + (ranges.length ? ranges[0].join('–') : 'No se atiende') + (note ? ' · ' + note : ''));
    document.getElementById('set-exc-note').value = '';
    UI.toast(affected.length
      ? 'Fecha guardada. Ojo: ya hay ' + affected.length + ' cita(s) agendada(s) fuera de ese horario; revísalas en Citas.'
      : 'Fecha especial guardada.', affected.length ? 'error' : undefined);
    return false; // ya se registró arriba (con el detalle de la fecha)
  },

  async deleteException(id) {
    const list = DB.state.scheduleExceptions || [];
    const i = list.findIndex(e => e.id === id);
    if (i < 0) return false;
    const e = list[i];
    list.splice(i, 1);
    DB.markDeleted('exceptions', id);
    const ok = await DB.save();
    this.renderAll();
    if (ok) DB.log('Quitó una fecha especial', e.date + ' · ' + this.exceptionWho(e));
    return false; // registrado arriba
  },

  async saveSettings() {
    const t = DB.tenant;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const errEl = document.getElementById('set-error');
    if (errEl) errEl.textContent = '';
    const leadRaw = g('set-lead');
    const lead = leadRaw === '' ? 15 : Number(leadRaw);
    if (!Number.isInteger(lead) || lead < 0 || lead > 1440) {
      if (errEl) errEl.textContent = 'La anticipación mínima debe ser un número entero de minutos entre 0 y 1440.';
      return false;
    }
    const before = [t.ownerName, t.currency, t.address, t.phone, t.hours, t.city, (t.leadMinutes == null ? 15 : t.leadMinutes) + ' min'].join(' | ');
    t.leadMinutes = lead;
    t.ownerName = g('set-owner-name');
    t.currency = g('set-currency') || 'S/';
    t.address = g('set-address');
    t.phone = g('set-phone');
    t.hours = g('set-hours');
    t.city = g('set-city');
    DB.state.settings.currency = t.currency;
    DB.state.settings.ownerName = t.ownerName;
    const ok = await DB.save();
    if (!ok) return false;
    this.setDirty = false;
    DB.log('Actualizó la configuración', 'Antes: ' + before + ' · Ahora: ' + [t.ownerName, t.currency, t.address, t.phone, t.hours, t.city, t.leadMinutes + ' min'].join(' | '));
    this.renderAll();
    UI.toast('Configuración guardada.');
    return true;
  },

  exportJSON() {
    const payload = { barberia: DB.tenant, datos: DB.state, exportado: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = DB.tenant.slug + '-respaldo-' + DB.todayISO() + '.json';
    a.click();
    return true;
  },

  closeModal() { ModalComponent.close(); },

  /* ---------- Agregar cita ---------- */
  openAppointmentModal() {
    const cur = this.cur();
    if (!DB.state.services.length || !DB.state.barberProfiles.length) {
      UI.toast(UI.v('Primero registra al menos {un:service} {service} y {un:staff} {staff}.'), 'error');
      return;
    }
    const E = (v) => UI.esc(v);
    const showPrice = this.fshow('appointments', 'price');
    const srvOptions = DB.state.services.map(s => '<option value="' + E(s.id) + '">' + E(s.name) + (showPrice ? ' (' + cur + E(s.price) + ')' : '') + '</option>').join('');
    const ph = CrmConfig.field('appointments', 'phone');
    const showNotes = this.fshow('appointments', 'notes');
    const barbers = DB.assignableBarbers();
    const own = DB.linkedBarberId();
    const barbOptions = barbers.map(b => '<option value="' + E(b.id) + '">' + E(b.name) + '</option>').join('');
    const firstDate = DB.firstBookableDate(barbers[0].name, (DB.state.services[0] || {}).duration);
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Agenda</span><h3>' + this.vx('Agregar {appointment}') + '</h3></div><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveAppointmentModal(event)" novalidate>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-ap-name">' + E(Vocab.T('client')) + ' <span class="req">*</span></label><input type="text" id="m-ap-name" class="input-dark" maxlength="80" required /></div>' +
          (ph.show ? '<div><label class="field-lbl" for="m-ap-phone">Celular' + (ph.required ? ' <span class="req">*</span>' : '') + '</label><input type="tel" id="m-ap-phone" class="input-dark" inputmode="tel" maxlength="16" placeholder="987 654 321"' + (ph.required ? ' required' : '') + ' /></div>' : '') +
          '<div><label class="field-lbl" for="m-ap-service">' + E(Vocab.T('service')) + '</label><select id="m-ap-service" class="input-dark" onchange="CRM.refreshApptSlots()">' + srvOptions + '</select></div>' +
          '<div><label class="field-lbl" for="m-ap-barber">' + E(Vocab.T('staff')) + '</label><select id="m-ap-barber" class="input-dark" onchange="CRM.refreshApptSlots()"' + (own ? ' disabled' : '') + '>' + barbOptions + '</select></div>' +
          '<div><label class="field-lbl" for="m-ap-date">Fecha</label><input type="date" id="m-ap-date" class="input-dark" min="' + DB.todayISO() + '" value="' + E(firstDate) + '" onchange="CRM.refreshApptSlots()" required /></div>' +
          '<div><label class="field-lbl" for="m-ap-time">Hora</label><select id="m-ap-time" class="input-dark" required></select></div>' +
          (showNotes ? '<div style="grid-column:1/-1;"><label class="field-lbl" for="m-ap-notes">Notas</label><textarea id="m-ap-notes" class="input-dark" rows="2" maxlength="500"></textarea></div>' : '') +
        '</div>' +
        CrmConfig.formHTML('appointments', 'm-ap-x-', {}) +
        (ph.show && CrmConfig.module('whatsapp') ? '<label class="check-line" style="display:flex; gap:8px; align-items:flex-start; margin-top:12px;"><input type="checkbox" id="m-ap-wa" style="margin-top:3px;" />' +
          '<span>' + this.vx('El {client} acepta recibir la confirmación y los recordatorios por WhatsApp') + '</span></label>' : '') +
        (showPrice ? '<p class="field-hint">' + this.vx('El precio es el {del:service} {service} en el catálogo.') + '</p>' : '') +
        '<p class="field-hint" id="m-ap-note" style="margin-top:10px;"></p>' +
        '<div class="form-error" id="m-ap-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + this.vx('Guardar {appointment}') + '</button></div>' +
      '</form>'
    );
    this.refreshApptSlots();
  },

  /* Días pasados, horas que ya pasaron y horarios ocupados quedan bloqueados */
  refreshApptSlots() {
    const dateInp = document.getElementById('m-ap-date');
    const timeSel = document.getElementById('m-ap-time');
    const b = DB.barberById((document.getElementById('m-ap-barber') || {}).value);
    const barber = b ? b.name : '';
    const svc = DB.serviceById((document.getElementById('m-ap-service') || {}).value);
    const duration = svc ? svc.duration : undefined;
    const note = document.getElementById('m-ap-note');
    if (!dateInp || !timeSel) return;
    let msg = '';
    if (!dateInp.value || DB.isPastDate(dateInp.value)) {
      if (dateInp.value) msg = 'La fecha ya pasó; se cambió al primer día disponible.';
      dateInp.value = DB.firstBookableDate(barber, duration);
    }
    if (!DB.freeSlots(dateInp.value, barber, duration).length) {
      const next = DB.firstBookableDate(barber, duration);
      if (next !== dateInp.value) {
        msg = (DB.slotsFor(dateInp.value, barber, duration).length ? 'No quedan horarios ese día para ' : 'Ese día no atiende ') + barber + '; se muestra el ' + next + '.';
        dateInp.value = next;
      }
    }
    const prev = timeSel.value;
    let first = null;
    const slots = DB.slotsFor(dateInp.value, barber, duration);
    if (!slots.length) msg = msg || (barber + ' no tiene horarios disponibles en los próximos días. ' + UI.v('Revisa su horario en {StaffPlural}.'));
    timeSel.innerHTML = slots.map(t => {
      const st = this.slotStateOf(dateInp.value, t, barber, undefined, duration);
      if (st === 'free' && !first) first = t;
      return '<option value="' + t + '"' + (st !== 'free' ? ' disabled' : '') + '>' + t + (st === 'past' ? ' · Ya pasó' : st === 'busy' ? ' · Ocupado' : '') + '</option>';
    }).join('');
    const po = prev && timeSel.querySelector('option[value="' + prev + '"]');
    timeSel.value = (po && !po.disabled) ? prev : (first || '');
    if (note) note.textContent = msg;
  },

  async saveAppointmentModal(e) {
    e.preventDefault();
    const err = document.getElementById('m-ap-error');
    const name = document.getElementById('m-ap-name').value.trim();
    const srv = DB.serviceById(document.getElementById('m-ap-service').value);
    const b = DB.barberById(document.getElementById('m-ap-barber').value);
    const date = document.getElementById('m-ap-date').value;
    const time = document.getElementById('m-ap-time').value;
    if (!name) { err.textContent = UI.v('Escribe el nombre {del:client} {client}.'); return false; }
    const phEl = document.getElementById('m-ap-phone');
    let phone = phEl ? phEl.value.replace(/\D/g, '') : '';
    if (/^519\d{8}$/.test(phone)) phone = phone.slice(2);
    if (!phone && phEl && CrmConfig.field('appointments', 'phone').required) { err.textContent = UI.v('Escribe el celular {del:client} {client}.'); return false; }
    if (phone && !/^9\d{8}$/.test(phone)) { err.textContent = 'El celular debe tener 9 dígitos y empezar con 9.'; return false; }
    const cf = CrmConfig.readForm('appointments', 'm-ap-x-', {});
    if (cf.error) { err.textContent = cf.error; return false; }
    const notesEl = document.getElementById('m-ap-notes');
    const waOptIn = !!(document.getElementById('m-ap-wa') || {}).checked;
    if (waOptIn && !phone) { err.textContent = UI.v('Para enviar WhatsApp escribe el celular {del:client} {client}.'); return false; }
    if (!srv || !b) { err.textContent = UI.v('Elige {el:service} {service} y {el:staff} {staff}.'); return false; }
    const slotError = DB.validateBooking(date, time, b.name, undefined, srv.duration);
    if (slotError) { err.textContent = slotError; this.refreshApptSlots(); return false; }

    // M14: el cliente se identifica SOLO por celular (lo resuelve el servidor)
    let customerId = null;
    if (phone) {
      try { customerId = await DB.ensureCustomer(name, phone); }
      catch (ex) { console.warn('[CRM] No se pudo registrar el cliente', ex); }
    }
    const payload = {
      id: DB.uid(), customerName: name, phone, waOptIn, customerId,
      serviceId: srv.id, service: srv.name, barberId: b.id, barber: b.name, date, time,
      price: srv.price, status: 'PROGRAMADA', source: 'CRM', createdAt: new Date().toISOString(),
      notes: notesEl ? notesEl.value.trim().slice(0, 500) : '', extra: DB.normExtra(cf.extra)
    };
    DB.state.appointments.unshift(payload);
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(UI.v('{Appointment} registrad{o:appointment} para el ') + date + ' a las ' + time + '.');
    return ok;
  },

  /* ---------- Walk-in ---------- */
  openWalkInModal() {
    if (!DB.state.services.length || !DB.state.barberProfiles.length) {
      UI.toast(UI.v('Primero registra al menos {un:service} {service} y {un:staff} {staff}.'), 'error');
      return;
    }
    const E = (v) => UI.esc(v);
    const srvOptions = DB.state.services.map(s => '<option value="' + E(s.id) + '">' + E(s.name) + '</option>').join('');
    const barbOptions = DB.state.barberProfiles.map(b => '<option value="' + E(b.id) + '"' + (b.id === DB.linkedBarberId() ? ' selected' : '') + '>' + E(b.name) + '</option>').join('');
    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">AGREGAR WALK-IN</h3><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveWalkInModal(event)">' +
        '<div style="margin-bottom:12px;"><label class="field-lbl" for="m-wk-name">' + this.vx('Nombre {del:client} {client} *').toUpperCase() + '</label><input type="text" id="m-wk-name" class="input-dark" maxlength="80" required /></div>' +
        '<div style="margin-bottom:12px;"><label class="field-lbl" for="m-wk-service">' + E(Vocab.T('service')).toUpperCase() + '</label><select id="m-wk-service" class="input-dark">' + srvOptions + '</select></div>' +
        '<div style="margin-bottom:18px;"><label class="field-lbl" for="m-wk-barber">' + E(Vocab.T('staff')).toUpperCase() + '</label><select id="m-wk-barber" class="input-dark">' + barbOptions + '</select></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">Guardar walk-in</button></div>' +
      '</form>'
    );
  },

  async saveWalkInModal(e) {
    e.preventDefault();
    const srv = DB.serviceById(document.getElementById('m-wk-service').value);
    const b = DB.barberById(document.getElementById('m-wk-barber').value);
    const name = document.getElementById('m-wk-name').value.trim();
    if (!name || !srv || !b) return false;
    DB.state.walkIns.unshift({
      id: DB.uid(), customerName: name,
      serviceId: srv.id, service: srv.name, barberId: b.id, barber: b.name,
      price: srv.price, status: 'ESPERANDO', addedAt: DB.nowTimeStr(), date: DB.todayISO(), notes: ''
    });
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast('Walk-in agregado a la cola.');
    return ok;
  },

  /* ---------- Ficha de cliente: alta y edición (M14: por celular, sin duplicados) ----------
     Los campos visibles y obligatorios salen de crm_config (fields.customers y
     customFields.customers). Correo, nacimiento, documento y dirección van en
     sus columnas; los campos propios, en customers.extra. */
  CUST_STD: [
    { key: 'email', label: 'Correo', type: 'email', max: 120, ph: 'nombre@correo.com' },
    { key: 'birthdate', label: 'Fecha de nacimiento', type: 'date' },
    { key: 'document', label: 'Documento (DNI / CE / RUC)', type: 'text', max: 20, ph: '12345678' },
    { key: 'address', label: 'Dirección', type: 'text', max: 160 }
  ],

  openCustomerModal(editId) {
    const c = editId ? DB.state.customers.find(x => x.id === editId) : null;
    if (editId && !c) return;
    const E = (v) => UI.esc(v);
    const ph = CrmConfig.field('customers', 'phone');
    const val = (k) => E(c && c[k] && c[k] !== '—' ? c[k] : '');
    const std = this.CUST_STD.filter(f => this.fshow('customers', f.key)).map(f =>
      '<div' + (f.key === 'address' ? ' style="grid-column:1/-1;"' : '') + '><label class="field-lbl" for="m-cu-' + f.key + '">' + E(f.label) + '</label>' +
      '<input type="' + f.type + '" id="m-cu-' + f.key + '" class="input-dark" value="' + val(f.key) + '"' + (f.max ? ' maxlength="' + f.max + '"' : '') +
        (f.ph ? ' placeholder="' + E(f.ph) + '"' : '') + (f.type === 'date' ? ' min="1900-01-01" max="' + DB.todayISO() + '"' : '') + (f.type === 'email' ? ' inputmode="email" autocomplete="off"' : '') + ' /></div>').join('');
    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">' + this.vx(c ? 'Editar {client}' : 'Agregar {client}').toUpperCase() + '</h3><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveCustomerModal(event' + (c ? ', \'' + E(c.id) + '\'' : '') + ')" novalidate>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-cu-name">NOMBRE *</label><input type="text" id="m-cu-name" class="input-dark" maxlength="80" value="' + val('name') + '" required /></div>' +
          (ph.show ? '<div><label class="field-lbl" for="m-cu-phone">CELULAR' + (ph.required ? ' *' : '') + '</label><input type="tel" id="m-cu-phone" class="input-dark" inputmode="tel" maxlength="16" placeholder="987 654 321" value="' + val('phone') + '"' + (ph.required ? ' required' : '') + ' /></div>' : '') +
          std +
          (this.fshow('customers', 'notes') ? '<div style="grid-column:1/-1;"><label class="field-lbl" for="m-cu-notes">Observaciones</label><textarea id="m-cu-notes" class="input-dark" rows="2" maxlength="500">' + val('notes') + '</textarea></div>' : '') +
        '</div>' +
        CrmConfig.formHTML('customers', 'm-cu-x-', c ? c.extra : {}) +
        '<div class="form-error" id="m-cu-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">Guardar</button></div>' +
      '</form>'
    );
  },

  /* Lee y valida el formulario de la ficha. Devuelve { data } o { error }. */
  readCustomerForm(c) {
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : null; };
    const name = g('m-cu-name') || '';
    if (!name) return { error: UI.v('Escribe el nombre {del:client} {client}.') };
    const data = { name };
    const phRaw = g('m-cu-phone');
    if (phRaw !== null) {
      let phone = phRaw.replace(/\D/g, '');
      if (/^519\d{8}$/.test(phone)) phone = phone.slice(2);
      if (!phone && CrmConfig.field('customers', 'phone').required) return { error: 'El celular debe tener 9 dígitos y empezar con 9.' };
      if (phone && !/^9\d{8}$/.test(phone)) return { error: 'El celular debe tener 9 dígitos y empezar con 9.' };
      data.phone = phone;
    }
    if (name.length < 2) return { error: 'El nombre debe tener al menos 2 letras.' };
    const email = g('m-cu-email');
    if (email !== null) {
      if (email && (email.length > 120 || !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email))) return { error: 'El correo no es válido.' };
      data.email = email;
    }
    const bd = g('m-cu-birthdate');
    if (bd !== null) {
      if (bd && (!/^\d{4}-\d{2}-\d{2}$/.test(bd) || bd < '1900-01-01' || bd > DB.todayISO())) return { error: 'La fecha de nacimiento no es válida.' };
      data.birthdate = bd;
    }
    const doc = g('m-cu-document');
    if (doc !== null) {
      if (doc && !/^[A-Za-z0-9-]{1,20}$/.test(doc)) return { error: 'El documento admite hasta 20 letras, números o guiones.' };
      data.document = doc;
    }
    const addr = g('m-cu-address');
    if (addr !== null) {
      if (addr.length > 160) return { error: 'La dirección admite hasta 160 caracteres.' };
      data.address = addr;
    }
    const notes = g('m-cu-notes');
    if (notes !== null) data.notes = notes.slice(0, 500);
    const cf = CrmConfig.readForm('customers', 'm-cu-x-', c ? c.extra : {});
    if (cf.error) return { error: cf.error };
    data.extra = DB.normExtra(cf.extra);
    return { data };
  },

  async saveCustomerModal(e, editId) {
    if (e && e.preventDefault) e.preventDefault();
    const err = document.getElementById('m-cu-error');
    const cur = editId ? DB.state.customers.find(x => x.id === editId) : null;
    if (editId && !cur) return false;
    const res = this.readCustomerForm(cur);
    if (res.error) { err.textContent = res.error; return false; }
    const d = res.data;
    const phone = d.phone;
    if (phone) {
      const existing = DB.state.customers.find(c => DB.cleanPhone(c.phone) === phone && c.id !== editId);
      if (existing) { err.textContent = UI.v('Ya existe {un:client} {client} con ese celular: ') + existing.name + '.'; return false; }
    }
    // Edición: se cambian los datos en memoria y DB.save() envía solo lo que cambió
    if (cur) {
      Object.assign(cur, d, 'phone' in d ? { phone: d.phone || '—' } : {});
      this.closeModal();
      const ok = await DB.save();
      this.renderAll();
      if (ok) UI.toast(UI.v('Ficha {del:client} {client} guardada.'));
      return ok;
    }
    let id = null;
    if (phone) {
      // M14: con celular la ficha la crea (o encuentra) el servidor
      try { id = await DB.ensureCustomer(d.name, phone); }
      catch (ex) { err.textContent = DB.errorText(ex); return false; }
      if (!id) { err.textContent = UI.v('No se pudo registrar {el:client} {client}.'); return false; }
    }
    let c = id ? DB.state.customers.find(x => x.id === id) : null;
    const renamed = c && c.name !== d.name;
    if (!c) {
      c = { id: id || DB.uid(), name: d.name, phone: phone || '—', notes: '', email: '', birthdate: '', document: '', address: '', extra: {} };
      DB.state.customers.unshift(c);
    }
    // Datos adicionales (no se renombra una ficha que ya existía con ese celular)
    const extraData = Object.assign({}, d);
    delete extraData.name; delete extraData.phone;
    Object.assign(c, extraData);
    this.closeModal();
    const ok = await DB.save();
    this.renderAll();
    if (ok) UI.toast(renamed ? 'Ese celular ya era de ' + c.name + ' (no se cambió el nombre).' : UI.v('{Client} registrad{o:client}.'));
    return ok;
  },

  /* CSV de la cartera (campos visibles + campos propios) */
  exportCustomersCSV() {
    const F = (k) => this.fshow('customers', k);
    const q = (document.getElementById('cust-search-q')?.value || '').trim().toLowerCase();
    const customs = CrmConfig.custom('customers');
    const cols = [[Vocab.T('client'), c => c.name]]
      .concat(F('phone') ? [['Celular', c => (c.phone === '—' ? '' : c.phone)]] : [])
      .concat(this.CUST_STD.filter(f => F(f.key)).map(f => [f.label, c => c[f.key] || '']))
      .concat(F('notes') ? [['Observaciones', c => c.notes || '']] : [])
      .concat(customs.map(f => [f.label, c => CrmConfig.display(f, (c.extra || {})[f.key])]));
    const list = DB.state.customers.filter(c => !q || cols.map(x => x[1](c)).join(' ').toLowerCase().includes(q));
    const rows = [cols.map(c => c[0])].concat(list.map(c => cols.map(x => x[1](c))));
    this.downloadCSV(rows, DB.tenant.slug + '-' + DB.slugify(Vocab.t('clientPlural')) + '-' + DB.todayISO() + '.csv');
    UI.toast('CSV descargado (' + list.length + ').');
    return true;
  }
};
