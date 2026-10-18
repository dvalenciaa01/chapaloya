const CRM = {
  currentTab: 'dashboard',
  apptQuickFilter: 'TODAY',

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
    const today = DB.todayISO();
    const dateLbl = document.getElementById('crm-current-date-label');
    if (dateLbl) dateLbl.textContent = 'Fecha: ' + today;

    const badgeAppts = document.getElementById('badge-nav-appts');
    if (badgeAppts) badgeAppts.textContent = DB.visibleAppointments().filter(a => a.date === today).length;

    const badgeWalkins = document.getElementById('badge-nav-walkins');
    if (badgeWalkins) badgeWalkins.textContent = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO').length;

    const badgeBarbers = document.getElementById('badge-nav-barbers');
    if (badgeBarbers) badgeBarbers.textContent = DB.state.barberProfiles.length;

    if (typeof AIAdvisor !== 'undefined') {
      AIAdvisor.populateHeaderSelectors();
    }
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

  renderBarbersPortfolioManager() {
    const container = document.getElementById('crm-barbers-portfolio-grid');
    if (!container) return;

    container.innerHTML = DB.state.barberProfiles.map(bp => {
      const specs = (bp.specialties || []).map(sp =>
        '<span class="specialty-pill" style="padding:3px 9px; font-size:0.68rem;">' + sp + '</span>'
      ).join('');
      const thumbs = bp.works.map(w =>
        '<div class="crm-work-thumb" title="' + w.title + '">' +
          '<img src="' + w.image + '" alt="' + w.title + '" />' +
          '<button type="button" class="crm-work-thumb-del" onclick="CRM.deleteHaircutPhoto(\'' + bp.id + '\',\'' + w.id + '\')" aria-label="Eliminar foto">' + ic('x') + '</button>' +
          '<div class="crm-work-thumb-lbl">' + w.title + '</div>' +
        '</div>'
      ).join('');

      return '<div class="crm-item-card">' +
        '<div>' +
          '<div style="display:flex; gap:16px; align-items:center; padding-bottom:14px; border-bottom:1px solid var(--border-subtle); margin-bottom:14px;">' +
            '<img src="' + bp.photo + '" alt="' + bp.name + '" style="width:74px; height:74px; object-fit:cover; border:2px solid var(--golden); flex-shrink:0;" />' +
            '<div style="flex:1;">' +
              '<h3 style="font-size:1.3rem;">' + bp.name + '</h3>' +
              '<div style="font-size:0.78rem; color:var(--text-grey); margin-bottom:8px;">' + (bp.role || 'Maestro Barbero') + '</div>' +
              '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
                '<button class="btn-golden btn-xs" onclick="CRM.openAddHaircutPhotoModal(\'' + bp.id + '\')">' + ic('camera') + 'Subir foto de corte</button>' +
                '<button class="btn-dark btn-xs" onclick="CRM.openBarberProfileModal(\'' + bp.id + '\')">' + ic('edit') + 'Editar perfil</button>' +
                '<button class="btn-danger btn-xs" onclick="CRM.deleteBarberProfile(\'' + bp.id + '\')" aria-label="Eliminar">' + ic('trash') + '</button>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="margin-bottom:14px;">' +
            '<span class="field-lbl" style="font-size:0.68rem; color:var(--text-grey);">ESPECIALIDADES:</span>' +
            '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:6px;">' + specs + '</div>' +
          '</div>' +
          '<div>' +
            '<span class="field-lbl" style="font-size:0.68rem; color:var(--golden);">FOTOS DE CORTES REALIZADOS (' + bp.works.length + '):</span>' +
            '<div class="crm-work-thumbs">' + thumbs + '</div>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  },

  openBarberProfileModal(editId = null) {
    const bp = editId ? DB.state.barberProfiles.find(x => x.id === editId) : null;
    const modalTitle = bp ? 'EDITAR BARBERO' : 'NUEVO BARBERO';
    const bName = bp ? bp.name : '';
    const bRole = bp ? bp.role : 'Master Barber';
    const bSpecs = bp ? (bp.specialties || []).join(', ') : 'Asesoría de Imagen + IA, Skin Fade, Afeitado Royal';
    const bPhoto = bp ? bp.photo : 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80';

    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">' + modalTitle + '</h3><button class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveBarberProfileModal(event, \'' + (editId || '') + '\')">' +
        '<div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:12px;">' +
          '<div><label class="field-lbl">NOMBRE DEL BARBERO *</label><input type="text" id="m-bp-name" class="input-dark" value="' + bName + '" required /></div>' +
          '<div><label class="field-lbl">CARGO / TÍTULO</label><input type="text" id="m-bp-role" class="input-dark" value="' + bRole + '" /></div>' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label class="field-lbl">ESPECIALIDADES (SEPARADAS POR COMA) *</label>' +
          '<input type="text" id="m-bp-specs" class="input-dark" value="' + bSpecs + '" required />' +
        '</div>' +
        '<div style="margin-bottom:12px;">' +
          '<label class="field-lbl">SUBIR FOTO DEL BARBERO DESDE TU DISPOSITIVO</label>' +
          '<div class="upload-dropzone" onclick="document.getElementById(\'m-bp-file\').click()">' +
            '<span style="color:var(--golden); font-family:var(--font-display); font-weight:700; letter-spacing:0.04em; text-transform:uppercase; font-size:0.82rem;">' + ic('upload') + ' Seleccionar foto del barbero</span>' +
            '<input type="file" id="m-bp-file" accept="image/*" style="display:none;" onchange="CRM.previewUploadedImage(this, \'m-bp-preview\')" />' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:16px;">' +
          '<img id="m-bp-preview" src="' + bPhoto + '" style="width:68px; height:68px; object-fit:cover; border:1px solid var(--golden);" />' +
        '</div>' +
        '<div style="display:flex; justify-content:flex-end; gap:10px;">' +
          '<button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button>' +
          '<button type="submit" class="btn-golden">Guardar Barbero</button>' +
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
    const name = document.getElementById('m-bp-name').value.trim();
    const role = document.getElementById('m-bp-role').value.trim();
    const specialties = document.getElementById('m-bp-specs').value.split(',').map(s => s.trim()).filter(Boolean);
    const previewEl = document.getElementById('m-bp-preview');
    const finalPhoto = previewEl.getAttribute('data-uploaded') || previewEl.src;

    if (editId) {
      const i = DB.state.barberProfiles.findIndex(x => x.id === editId);
      if (i > -1) {
        DB.state.barberProfiles[i].name = name;
        DB.state.barberProfiles[i].role = role;
        DB.state.barberProfiles[i].specialties = specialties;
        DB.state.barberProfiles[i].photo = finalPhoto;
      }
    } else {
      DB.state.barberProfiles.push({ id: 'bp-' + Date.now(), name, role, photo: finalPhoto, specialties, works: [] });
    }
    DB.save();
    this.closeModal();
    this.renderAll();
  },

  openAddHaircutPhotoModal(barberId) {
    const bp = DB.state.barberProfiles.find(x => x.id === barberId);
    if (!bp) return;
    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">SUBIR CORTE REALIZADO POR ' + bp.name.toUpperCase() + '</h3><button class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveHaircutPhotoModal(event, \'' + bp.id + '\')">' +
        '<div style="margin-bottom:14px;"><label class="field-lbl">NOMBRE DEL CORTE *</label><input type="text" id="m-wkphoto-title" class="input-dark" placeholder="Ej. Mid Fade + Barba Conectada" required /></div>' +
        '<div style="margin-bottom:14px;">' +
          '<div class="upload-dropzone" onclick="document.getElementById(\'m-wkphoto-file\').click()">' +
            '<span style="color:var(--golden); font-family:var(--font-display); font-weight:700; letter-spacing:0.04em; text-transform:uppercase; font-size:0.84rem;">' + ic('camera') + ' Seleccionar fotografía del corte</span>' +
            '<input type="file" id="m-wkphoto-file" accept="image/*" style="display:none;" onchange="CRM.previewUploadedImage(this, \'m-wkphoto-preview\')" />' +
          '</div>' +
        '</div>' +
        '<div style="margin-bottom:16px;"><img id="m-wkphoto-preview" src="https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=500&q=80" style="width:90px; height:90px; object-fit:cover; border:1px solid var(--golden);" /></div>' +
        '<div style="display:flex; justify-content:flex-end; gap:10px;"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">Publicar Corte</button></div>' +
      '</form>'
    );
  },

  saveHaircutPhotoModal(e, barberId) {
    e.preventDefault();
    const bp = DB.state.barberProfiles.find(x => x.id === barberId);
    if (!bp) return;
    const title = document.getElementById('m-wkphoto-title').value.trim();
    const previewEl = document.getElementById('m-wkphoto-preview');
    const finalImg = previewEl.getAttribute('data-uploaded') || previewEl.src;
    bp.works.unshift({ id: 'wk-' + Date.now(), title, image: finalImg });
    DB.save();
    this.closeModal();
    this.renderAll();
  },

  deleteHaircutPhoto(barberId, workId) {
    const bp = DB.state.barberProfiles.find(x => x.id === barberId);
    if (!bp) return;
    bp.works = bp.works.filter(w => w.id !== workId);
    DB.save();
    this.renderAll();
  },

  deleteBarberProfile(barberId) {
    if (DB.state.barberProfiles.length <= 1) {
      UI.toast('Debe quedar al menos un barbero en la barbería.', 'error');
      return;
    }
    DB.state.barberProfiles = DB.state.barberProfiles.filter(x => x.id !== barberId);
    // El personal vinculado a este barbero queda sin vínculo (verá todas las citas)
    DB.load().users.forEach(u => { if (u.barberId === barberId) u.barberId = null; });
    DB.save();
    this.renderAll();
  },

  renderBarberLiveStatus() {
    const activeWalkIns = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO');
    let workingCount = 0;

    const cardsHTML = DB.state.barberProfiles.map(bp => {
      const inChair = activeWalkIns.find(w => w.barber === bp.name && w.status === 'EN_SILLON');
      const waiting = activeWalkIns.filter(w => w.barber === bp.name && w.status === 'ESPERANDO');
      if (inChair) workingCount++;

      const pCls = inChair ? 'working' : 'available';
      const pTxt = inChair ? 'Trabajando' : 'Disponible';
      const subTxt = inChair ? ('Con ' + inChair.customerName) : (waiting.length + ' en espera');

      return '<div class="barber-status-card">' +
        '<img src="' + bp.photo + '" alt="' + bp.name + '" class="barber-mini-avatar" />' +
        '<div>' +
          '<div class="title-font" style="font-size:1rem;">' + bp.name + '</div>' +
          '<span class="live-pill ' + pCls + '">' + pTxt + '</span>' +
          '<div style="font-size:0.74rem; color:var(--text-grey);">' + subTxt + '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    const summaryEl = document.getElementById('barber-live-summary-txt');
    if (summaryEl) {
      summaryEl.textContent = workingCount + ' trabajando • ' + (DB.state.barberProfiles.length - workingCount) + ' disponibles';
    }

    const dashLiveEl = document.getElementById('dashboard-barber-live');
    if (dashLiveEl) dashLiveEl.innerHTML = cardsHTML;

    const walkinLiveEl = document.getElementById('walkin-barber-live');
    if (walkinLiveEl) walkinLiveEl.innerHTML = cardsHTML;
  },

  renderDashboard() {
    const cur = DB.state.settings.currency;
    const today = DB.todayISO();
    const quickBox = document.getElementById('quick-start-box');
    if (quickBox) quickBox.style.display = DB.state.settings.showQuickStart ? 'block' : 'none';

    const todayAppts = DB.visibleAppointments().filter(a => a.date === today);
    const completedAppts = DB.state.appointments.filter(a => a.status === 'COMPLETADA');
    const finishedWalkIns = DB.state.walkIns.filter(w => w.status === 'FINALIZADO');
    const totalRevAll = completedAppts.reduce((s, a) => s + Number(a.price), 0) + finishedWalkIns.reduce((s, w) => s + Number(w.price), 0);
    const totalDone = completedAppts.length + finishedWalkIns.length;
    const weekFrom = DB.addDays(today, -6);
    const weekRev = completedAppts.filter(a => a.date >= weekFrom && a.date <= today).reduce((s, a) => s + Number(a.price), 0) +
      finishedWalkIns.filter(w => (w.date || today) >= weekFrom && (w.date || today) <= today).reduce((s, w) => s + Number(w.price), 0);

    const kpi1 = document.getElementById('dashboard-kpis-row1');
    const showFinance = Auth.can('finance.view');
    if (kpi1 && !showFinance) {
      // Personal / administradores sin módulo de Ventas: sin cifras de ingresos
      const own = DB.linkedBarberName();
      const pending = todayAppts.filter(a => a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP').length;
      const queue = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO');
      kpi1.innerHTML =
        '<div class="crm-kpi-card"><div class="crm-kpi-label">' + (own ? 'MIS CITAS DE HOY' : 'CITAS DE HOY') + '</div><div class="crm-kpi-val">' + todayAppts.length + '</div><div class="crm-kpi-sub">' + (own ? 'Asignadas a ' + own : 'De toda la barbería') + '</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">PENDIENTES HOY</div><div class="crm-kpi-val">' + pending + '</div><div class="crm-kpi-sub">Programadas o confirmadas</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">EN ESPERA</div><div class="crm-kpi-val">' + queue.filter(w => w.status === 'ESPERANDO').length + '</div><div class="crm-kpi-sub">Walk-in en cola</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">EN SILLÓN</div><div class="crm-kpi-val" style="color:var(--golden);">' + queue.filter(w => w.status === 'EN_SILLON').length + '</div><div class="crm-kpi-sub">Atendiéndose ahora</div></div>';
      const kpi2h = document.getElementById('dashboard-kpis-row2');
      if (kpi2h) kpi2h.innerHTML = '';
    }
    if (kpi1 && showFinance) {
      kpi1.innerHTML =
        '<div class="crm-kpi-card"><div class="crm-kpi-label">CITAS DE HOY</div><div class="crm-kpi-val">' + todayAppts.length + '</div><div class="crm-kpi-sub">Sincronizadas con la web</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">VENTAS COMPLETADAS</div><div class="crm-kpi-val">' + cur + totalRevAll + '</div><div class="crm-kpi-sub">' + totalDone + ' completadas</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">COLA WALK-IN</div><div class="crm-kpi-val">' + DB.state.walkIns.filter(w => w.status !== 'FINALIZADO').length + '</div><div class="crm-kpi-sub">En espera y en sillón</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">ASESORÍAS IA</div><div class="crm-kpi-val" style="color:var(--golden);">' + DB.state.aiConsultations.length + '</div><div class="crm-kpi-sub">Diagnósticos realizados</div></div>';
    }

    const kpi2 = document.getElementById('dashboard-kpis-row2');
    if (kpi2 && showFinance) {
      kpi2.innerHTML =
        '<div class="crm-kpi-card"><div class="crm-kpi-label">INGRESOS 7 DÍAS</div><div class="crm-kpi-val">' + cur + weekRev + '</div><div class="crm-kpi-sub">Citas + walk-in de la última semana</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">TOTAL CLIENTES</div><div class="crm-kpi-val">' + DB.state.customers.length + '</div><div class="crm-kpi-sub">En cartera CRM</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">SERVICIO DESTACADO</div><div class="crm-kpi-val" style="font-size:1.25rem;">Asesoría Imagen + IA</div><div class="crm-kpi-sub">Visagismo Corte + Barba</div></div>' +
        '<div class="crm-kpi-card"><div class="crm-kpi-label">BARBEROS ACTIVOS</div><div class="crm-kpi-val" style="color:var(--golden);">' + DB.state.barberProfiles.length + '</div><div class="crm-kpi-sub">Con portafolio activo</div></div>';
    }

    const upcomingToday = todayAppts.filter(a => a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP');
    const upcomingEl = document.getElementById('dashboard-upcoming-list');
    if (upcomingEl) {
      upcomingEl.innerHTML = upcomingToday.map(a =>
        '<div class="crm-list-item">' +
          '<div>' +
            '<strong>' + a.time + ' - ' + a.customerName + '</strong>' +
            '<div style="font-size:0.78rem; color:var(--text-grey);">' + a.service + ' • ' + a.barber + '</div>' +
          '</div>' +
          '<button class="btn-dark btn-xs" onclick="AIAdvisor.openForClient(\'' + a.customerName + '\',\'' + a.phone + '\',\'' + a.barber + '\')">' + ic('sparkles') + 'Iniciar IA</button>' +
        '</div>'
      ).join('') || '<div class="empty-state">' + ic('calendar') + '<strong>Sin citas pendientes</strong>No hay más citas programadas para hoy.</div>';
    }

    const activeQueue = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO');
    const queueEl = document.getElementById('dashboard-queue-list');
    if (queueEl) {
      queueEl.innerHTML = activeQueue.map(w =>
        '<div class="crm-list-item">' +
          '<div>' +
            '<strong>' + w.customerName + '</strong>' +
            '<div style="font-size:0.78rem; color:var(--text-grey);">' + w.service + ' • ' + w.barber + '</div>' +
          '</div>' +
          '<button class="btn-dark btn-xs" onclick="AIAdvisor.openForClient(\'' + w.customerName + '\',\'\',\'' + w.barber + '\')">' + ic('sparkles') + 'Abrir IA</button>' +
        '</div>'
      ).join('') || '<div class="empty-state">' + ic('hourglass') + '<strong>Cola vacía</strong>Nadie esperando en este momento.</div>';
    }
  },

  toggleQuickStart(show) {
    DB.state.settings.showQuickStart = show;
    DB.save();
    this.renderDashboard();
  },

  populateApptFilterDropdowns() {
    const bSel = document.getElementById('flt-appt-barber');
    if (bSel) {
      const curB = bSel.value || 'ALL';
      bSel.innerHTML = '<option value="ALL">' + (DB.linkedBarberName() ? 'Mis citas' : 'Todos los barberos') + '</option>' + DB.assignableBarbers().map(b => '<option value="' + b + '">' + b + '</option>').join('');
      bSel.value = curB;
    }

    const sSel = document.getElementById('flt-appt-service');
    if (sSel) {
      const curS = sSel.value || 'ALL';
      sSel.innerHTML = '<option value="ALL">Todos los servicios</option>' + DB.state.services.map(s => '<option value="' + s.name + '">' + s.name + '</option>').join('');
      sSel.value = curS;
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

  renderAppointments() {
    const tbody = document.getElementById('crm-appts-tbody');
    if (!tbody) return;

    const cur = DB.state.settings.currency;
    const today = DB.todayISO();
    const q = (document.getElementById('flt-appt-q')?.value || '').trim().toLowerCase();
    const fBarber = document.getElementById('flt-appt-barber')?.value || 'ALL';
    const fService = document.getElementById('flt-appt-service')?.value || 'ALL';
    const fDate = document.getElementById('flt-appt-date')?.value || '';
    const fStatus = document.getElementById('flt-appt-status')?.value || 'ALL';

    let list = DB.visibleAppointments().filter(a => {
      if (this.apptQuickFilter === 'TODAY' && a.date !== today) return false;
      if (this.apptQuickFilter === 'UPCOMING' && (a.date < today || (a.status !== 'PROGRAMADA' && a.status !== 'CONFIRMADA_WSP'))) return false;
      if (['COMPLETADA', 'CANCELADA', 'NO_ASISTIO'].includes(this.apptQuickFilter) && a.status !== this.apptQuickFilter) return false;
      if (fBarber !== 'ALL' && a.barber !== fBarber) return false;
      if (fService !== 'ALL' && a.service !== fService) return false;
      if (fDate && a.date !== fDate) return false;
      if (fStatus !== 'ALL' && a.status !== fStatus) return false;
      const hay = (a.customerName + ' ' + a.phone + ' ' + a.barber + ' ' + a.service).toLowerCase();
      if (q && !hay.includes(q)) return false;
      return true;
    });

    // Orden: hoy/próximas ascendente; el resto, lo más reciente primero
    const asc = this.apptQuickFilter === 'TODAY' || this.apptQuickFilter === 'UPCOMING';
    list.sort((x, y) => {
      const kx = x.date + ' ' + x.time, ky = y.date + ' ' + y.time;
      return asc ? (kx < ky ? -1 : 1) : (kx < ky ? 1 : -1);
    });
    const total = list.length;
    this.apptLimit = this.apptLimit || 60;
    list = list.slice(0, this.apptLimit);
    const moreBtn = document.getElementById('appt-more');
    if (moreBtn) {
      moreBtn.hidden = total <= this.apptLimit;
      moreBtn.textContent = 'Mostrar más (' + (total - list.length) + ' restantes)';
    }

    if (!list.length) {
      tbody.innerHTML = '<tr class="is-empty"><td colspan="8"><div class="empty-state">' + ic('calendar') + '<strong>Sin citas para este filtro</strong>Prueba con otra pestaña o limpia los filtros.</div></td></tr>';
      return;
    }
    tbody.innerHTML = list.map(a =>
      '<tr>' +
        '<td data-label="Cliente"><strong>' + a.customerName + '</strong><br/><span style="font-size:0.76rem; color:var(--text-grey);">' + (a.phone || '—') + '</span></td>' +
        '<td data-label="Servicio">' + a.service + '</td>' +
        '<td data-label="Barbero">' + a.barber + '</td>' +
        '<td data-label="Fecha">' + a.date + '</td>' +
        '<td data-label="Hora"><strong>' + a.time + '</strong></td>' +
        '<td data-label="Precio"><strong>' + cur + a.price + '</strong></td>' +
        '<td data-label="Estado"><span class="st-badge st-' + a.status + '">' + DB.statusLabel(a.status) + '</span></td>' +
        '<td data-label="Acciones">' +
          '<div style="display:flex; gap:6px; flex-wrap:wrap;">' +
            '<button class="btn-dark btn-xs" onclick="AIAdvisor.openForClient(\'' + a.customerName + '\',\'' + a.phone + '\',\'' + a.barber + '\')">' + ic('sparkles') + 'Asesoría IA</button>' +
            '<button class="btn-dark btn-xs" onclick="CRM.setApptStatus(\'' + a.id + '\',\'COMPLETADA\')">Completar</button>' +
            '<button class="btn-dark btn-xs" onclick="CRM.setApptStatus(\'' + a.id + '\',\'CANCELADA\')">Cancelar</button>' +
            '<button class="btn-danger btn-xs" onclick="CRM.deleteAppt(\'' + a.id + '\')" aria-label="Eliminar">' + ic('trash') + '</button>' +
          '</div>' +
        '</td>' +
      '</tr>'
    ).join('');
  },

  setApptStatus(id, status) {
    const item = DB.state.appointments.find(a => a.id === id);
    if (item) {
      item.status = status;
      if (status === 'COMPLETADA') item.completedAt = new Date().toISOString();
      DB.save(); this.renderAll();
    }
  },

  deleteAppt(id) {
    DB.state.appointments = DB.state.appointments.filter(a => a.id !== id);
    DB.save();
    this.renderAll();
  },

  renderWalkIns() {
    const activeGrid = document.getElementById('walkin-active-grid');
    if (!activeGrid) return;

    const cur = DB.state.settings.currency;
    const active = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO');
    const finished = DB.state.walkIns.filter(w => w.status === 'FINALIZADO' && w.date === DB.todayISO());

    activeGrid.innerHTML = active.map(w => {
      const stLabel = w.status === 'EN_SILLON' ? 'En Sillón' : 'En Espera';
      const chairBtn = w.status === 'ESPERANDO'
        ? '<button class="btn-dark btn-xs" onclick="CRM.setWalkInStatus(\'' + w.id + '\',\'EN_SILLON\')">En Sillón</button>'
        : '';

      return '<div class="crm-item-card">' +
        '<div>' +
          '<h3 style="font-size:1.15rem;">' + w.customerName + '</h3>' +
          '<span class="st-badge st-' + w.status + '" style="margin:4px 0 10px;">' + stLabel + '</span>' +
          '<p style="font-size:0.83rem; line-height:1.65; color:var(--text-light); margin-bottom:14px;">' +
            w.service + ' - <strong>' + cur + w.price + '</strong><br/>' +
            'Barbero: <strong>' + w.barber + '</strong> • Agregado: ' + w.addedAt +
          '</p>' +
        '</div>' +
        '<div style="display:flex; gap:8px; flex-wrap:wrap; border-top:1px solid var(--border-subtle); padding-top:12px;">' +
          '<button class="btn-golden btn-xs" onclick="AIAdvisor.openForClient(\'' + w.customerName + '\',\'\',\'' + w.barber + '\')">' + ic('sparkles') + 'Iniciar asesoría IA</button>' +
          chairBtn +
          '<button class="btn-dark btn-xs" onclick="CRM.setWalkInStatus(\'' + w.id + '\',\'FINALIZADO\')">Finalizar</button>' +
        '</div>' +
      '</div>';
    }).join('');

    document.getElementById('walkin-finished-count').textContent = finished.length + ' completados';
    document.getElementById('walkin-finished-list').innerHTML = finished.map(w =>
      '<div class="crm-list-item">' +
        '<div><strong>' + w.customerName + '</strong> — ' + w.service + ' (' + cur + w.price + ')</div>' +
        '<span class="st-badge st-COMPLETADA">Finalizado</span>' +
      '</div>'
    ).join('');
  },

  setWalkInStatus(id, status) {
    const w = DB.state.walkIns.find(x => x.id === id);
    if (w) {
      w.status = status;
      if (status === 'FINALIZADO') { w.date = DB.todayISO(); w.finishedAt = new Date().toISOString(); }
      DB.save(); this.renderAll();
    }
  },

  renderSales() {
    const salesKpis = document.getElementById('sales-kpis-grid');
    if (!salesKpis) return;

    const cur = DB.state.settings.currency;
    const today = DB.todayISO();
    const doneAppts = DB.state.appointments.filter(a => a.status === 'COMPLETADA');
    const doneWalks = DB.state.walkIns.filter(w => w.status === 'FINALIZADO');
    const allSales = [
      ...doneAppts.map(a => ({ date: a.date, customer: a.customerName, service: a.service, barber: a.barber, source: 'Cita Web/CRM', price: Number(a.price) })),
      ...doneWalks.map(w => ({ date: w.date || today, customer: w.customerName, service: w.service, barber: w.barber, source: 'Walk-In', price: Number(w.price) }))
    ];
    const totalRev = allSales.reduce((s, x) => s + x.price, 0);
    const avgTicket = allSales.length ? Math.round(totalRev / allSales.length) : 0;

    salesKpis.innerHTML =
      '<div class="crm-kpi-card"><div class="crm-kpi-label">INGRESOS FILTRADOS</div><div class="crm-kpi-val">' + cur + totalRev + '</div><div class="crm-kpi-sub">Total acumulado</div></div>' +
      '<div class="crm-kpi-card"><div class="crm-kpi-label">CLIENTES ATENDIDOS</div><div class="crm-kpi-val">' + allSales.length + '</div><div class="crm-kpi-sub">Citas + Walk-ins</div></div>' +
      '<div class="crm-kpi-card"><div class="crm-kpi-label">TICKET PROMEDIO</div><div class="crm-kpi-val">' + cur + avgTicket + '</div><div class="crm-kpi-sub">Por atención</div></div>';

    const byBarber = {};
    const byService = {};
    allSales.forEach(s => {
      byBarber[s.barber] = (byBarber[s.barber] || 0) + s.price;
      byService[s.service] = (byService[s.service] || 0) + s.price;
    });

    const maxB = Math.max(...Object.values(byBarber), 1);
    document.getElementById('sales-by-barber-bars').innerHTML = Object.entries(byBarber).map(([b, val]) => {
      const pct = Math.round((val / maxB) * 100);
      return '<div class="bar-row"><div class="bar-header"><span>' + b + '</span><span>' + cur + val + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('') || '<p>Sin ventas aún.</p>';

    const maxS = Math.max(...Object.values(byService), 1);
    document.getElementById('sales-by-service-bars').innerHTML = Object.entries(byService).map(([s, val]) => {
      const pct = Math.round((val / maxS) * 100);
      return '<div class="bar-row"><div class="bar-header"><span>' + s + '</span><span>' + cur + val + '</span></div><div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;"></div></div></div>';
    }).join('') || '<p>Sin ventas aún.</p>';

    allSales.sort((x, y) => (x.date < y.date ? 1 : -1));
    document.getElementById('sales-recent-tbody').innerHTML = allSales.slice(0, 60).map(s =>
      '<tr><td data-label="Fecha">' + s.date + '</td><td data-label="Cliente"><strong>' + s.customer + '</strong></td><td data-label="Servicio">' + s.service + '</td><td data-label="Barbero">' + s.barber + '</td><td data-label="Origen"><span class="st-badge st-EN_SILLON">' + s.source + '</span></td><td data-label="Ingreso"><strong style="color:var(--golden);">' + cur + s.price + '</strong></td></tr>'
    ).join('');
  },

  renderCustomers() {
    const custGrid = document.getElementById('crm-customers-grid');
    if (!custGrid) return;

    const q = (document.getElementById('cust-search-q')?.value || '').trim().toLowerCase();
    const list = DB.state.customers.filter(c => {
      const hay = (c.name + ' ' + c.phone + ' ' + c.notes).toLowerCase();
      return !q || hay.includes(q);
    });
    custGrid.innerHTML = list.slice(0, 60).map(c =>
      '<div class="crm-item-card">' +
        '<div>' +
          '<h3 style="font-size:1.15rem; margin-bottom:4px;">' + c.name + '</h3>' +
          '<div style="color:var(--golden); font-size:0.82rem; font-weight:700; margin-bottom:10px;">' + ic('phone') + ' ' + c.phone + '</div>' +
          '<p style="font-size:0.8rem; line-height:1.5; margin-bottom:12px;">' + (c.notes || 'Sin observaciones') + '</p>' +
        '</div>' +
        '<div style="display:flex; gap:8px;">' +
          '<button class="btn-golden btn-xs" onclick="AIAdvisor.openForClient(\'' + c.name + '\',\'' + c.phone + '\',\'' + (DB.assignableBarbers()[0] || '') + '\')">' + ic('sparkles') + 'Nueva asesoría IA</button>' +
        '</div>' +
      '</div>'
    ).join('');
  },

  renderServices() {
    const srvGrid = document.getElementById('crm-services-grid');
    if (!srvGrid) return;
    const cur = DB.state.settings.currency;
    if (!DB.state.services.length) {
      srvGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;">' + ic('tag') + '<strong>Sin servicios</strong>Agrega el primero con “Agregar servicio”.</div>';
      return;
    }
    srvGrid.innerHTML = DB.state.services.map(s =>
      '<div class="crm-item-card service-admin-card">' +
        '<div>' +
          '<div class="service-admin-top"><span class="service-admin-cat">' + UI.esc(s.category || 'General') + '</span>' +
            (s.id === 's-ia' ? '<span class="crm-nav-new">Destacado</span>' : '') + '</div>' +
          '<h3 style="font-size:1.25rem; margin:6px 0 8px;">' + UI.esc(s.name) + '</h3>' +
          '<div class="service-admin-meta"><strong>' + UI.esc(cur) + ' ' + s.price + '</strong><span>' + ic('clock') + s.duration + ' min</span></div>' +
          '<p style="font-size:0.85rem; line-height:1.5; margin-top:10px;">' + UI.esc(s.desc || 'Sin descripción') + '</p>' +
        '</div>' +
        '<div class="row-actions">' +
          '<button type="button" class="btn-dark btn-xs" onclick="CRM.openServiceModal(\'' + s.id + '\')">' + ic('edit') + 'Editar</button>' +
          '<button type="button" class="btn-danger btn-xs" onclick="CRM.deleteService(\'' + s.id + '\')">' + ic('trash') + 'Eliminar</button>' +
        '</div>' +
      '</div>'
    ).join('');
  },

  openServiceModal(editId) {
    const s = editId ? DB.state.services.find(x => x.id === editId) : null;
    if (editId && !s) return;
    const cats = Array.from(new Set(DB.state.services.map(x => x.category).filter(Boolean)));
    const durations = [15, 20, 30, 45, 60, 75, 90, 120];
    const v = (k, d) => UI.esc(s && s[k] != null ? s[k] : d);
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Catálogo</span><h3>' + (s ? 'Editar servicio' : 'Agregar servicio') + '</h3></div><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveServiceModal(event' + (s ? ', \'' + s.id + '\'' : '') + ')" novalidate>' +
        '<div class="form-grid-2">' +
          '<div style="grid-column:1/-1;"><label class="field-lbl" for="m-sv-name">Nombre del servicio <span class="req">*</span></label><input type="text" id="m-sv-name" class="input-dark" value="' + v('name', '') + '" maxlength="60" required /></div>' +
          '<div><label class="field-lbl" for="m-sv-cat">Categoría</label><input type="text" id="m-sv-cat" class="input-dark" list="m-sv-cats" value="' + v('category', 'Cortes') + '" maxlength="30" />' +
            '<datalist id="m-sv-cats">' + cats.map(c => '<option value="' + UI.esc(c) + '"></option>').join('') + '</datalist></div>' +
          '<div><label class="field-lbl" for="m-sv-price">Precio (' + UI.esc(DB.state.settings.currency) + ') <span class="req">*</span></label><input type="number" id="m-sv-price" class="input-dark" min="0" step="1" inputmode="numeric" value="' + v('price', '45') + '" required /></div>' +
          '<div><label class="field-lbl" for="m-sv-duration">Duración</label><select id="m-sv-duration" class="input-dark">' +
            durations.map(d => '<option value="' + d + '"' + ((s ? s.duration : 45) === d ? ' selected' : '') + '>' + d + ' minutos</option>').join('') + '</select></div>' +
          '<div style="grid-column:1/-1;"><label class="field-lbl" for="m-sv-desc">Descripción <span class="text-grey" style="font-weight:400;">(se muestra en la web)</span></label><textarea id="m-sv-desc" class="input-dark" maxlength="220">' + v('desc', '') + '</textarea></div>' +
        '</div>' +
        (s ? '<p class="form-note">' + ic('alert') + 'Si cambias el nombre o el precio, se actualizarán las citas futuras pendientes. Las citas pasadas conservan sus datos originales.</p>' : '') +
        '<div class="form-error" id="m-sv-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + (s ? 'Guardar cambios' : 'Agregar servicio') + '</button></div>' +
      '</form>'
    );
  },

  saveServiceModal(e, editId) {
    e.preventDefault();
    const err = document.getElementById('m-sv-error');
    const name = document.getElementById('m-sv-name').value.trim();
    const category = document.getElementById('m-sv-cat').value.trim() || 'General';
    const price = Number(document.getElementById('m-sv-price').value);
    const duration = Number(document.getElementById('m-sv-duration').value) || 45;
    const desc = document.getElementById('m-sv-desc').value.trim();
    if (!name) { err.textContent = 'Escribe el nombre del servicio.'; return; }
    if (!isFinite(price) || price < 0) { err.textContent = 'Escribe un precio válido (0 o más).'; return; }
    const dup = DB.state.services.find(x => x.name.toLowerCase() === name.toLowerCase() && x.id !== editId);
    if (dup) { err.textContent = 'Ya existe un servicio con ese nombre.'; return; }

    if (editId) {
      const s = DB.state.services.find(x => x.id === editId);
      if (!s) return;
      const oldName = s.name;
      const today = DB.todayISO();
      let updated = 0;
      DB.state.appointments.forEach(a => {
        if (a.service === oldName && a.date >= today && (a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP')) {
          a.service = name; a.price = price; updated++;
        }
      });
      Object.assign(s, { name, category, price, duration, desc });
      DB.save();
      this.closeModal();
      this.renderAll();
      UI.toast('Servicio actualizado' + (updated ? ' (' + updated + ' cita' + (updated === 1 ? '' : 's') + ' futura' + (updated === 1 ? '' : 's') + ' ajustada' + (updated === 1 ? '' : 's') + ').' : '.'));
      return;
    }
    DB.state.services.push({ id: 's-' + Date.now(), name, category, price, duration, desc: desc || 'Servicio personalizado.' });
    DB.save();
    this.closeModal();
    this.renderAll();
    UI.toast('Servicio agregado al catálogo.');
  },

  deleteService(id) {
    const s = DB.state.services.find(x => x.id === id);
    if (!s) return;
    if (DB.state.services.length <= 1) { UI.toast('Debe quedar al menos un servicio en el catálogo.', 'error'); return; }
    const today = DB.todayISO();
    const future = DB.state.appointments.filter(a => a.service === s.name && a.date >= today && (a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP')).length;
    UI.confirm({
      title: 'Eliminar servicio',
      message: '“' + s.name + '” dejará de mostrarse en la web y en el CRM.' + (future ? ' Ojo: tiene ' + future + ' cita(s) futura(s); se mantendrán con su precio actual, pero el servicio ya no podrá elegirse en nuevas reservas.' : '') + ' El historial de ventas se conserva.',
      confirmText: 'Eliminar', danger: true
    }).then(ok => {
      if (!ok) return;
      DB.state.services = DB.state.services.filter(x => x.id !== id);
      DB.save();
      DB.log('Eliminó un servicio', s.name + ' · ' + DB.state.settings.currency + ' ' + s.price + (future ? ' · ' + future + ' cita(s) futura(s) conservadas' : ''));
      this.renderAll();
      UI.toast('Servicio eliminado.');
    });
  },

  renderReports() {
    const root = document.getElementById('crm-reports-root');
    if (!root || !DB.tenant) return;
    ReportBuilder.mount(root, {
      mode: 'crm',
      tenantId: DB.tenant.id,
      money: Auth.can('finance.view'),
      canExport: () => Auth.can('reports.view')
    });
  },

  renderSettings() {
    const t = DB.tenant;
    const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    set('set-owner-name', t.ownerName);
    set('set-currency', t.currency || 'S/');
    set('set-address', t.address);
    set('set-phone', t.phone);
    set('set-hours', t.hours);
    set('set-city', t.city);
    const nameEl = document.getElementById('set-tenant-name');
    if (nameEl) nameEl.textContent = t.name;
    const linkEl = document.getElementById('set-public-link');
    if (linkEl) { linkEl.href = 'index.html?b=' + encodeURIComponent(t.slug); linkEl.textContent = 'index.html?b=' + t.slug; }
  },

  saveSettings() {
    const t = DB.tenant;
    const g = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const before = [t.ownerName, t.currency, t.address, t.phone, t.hours, t.city].join(' | ');
    t.ownerName = g('set-owner-name');
    t.currency = g('set-currency') || 'S/';
    t.address = g('set-address');
    t.phone = g('set-phone');
    t.hours = g('set-hours');
    t.city = g('set-city');
    DB.state.settings.currency = t.currency;
    DB.state.settings.ownerName = t.ownerName;
    DB.save();
    DB.log('Actualizó la configuración', 'Antes: ' + before + ' · Ahora: ' + [t.ownerName, t.currency, t.address, t.phone, t.hours, t.city].join(' | '));
    this.renderAll();
    UI.toast('Configuración guardada.');
  },

  exportJSON() {
    const payload = { barberia: DB.tenant, datos: DB.state, exportado: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = DB.tenant.slug + '-respaldo-' + DB.todayISO() + '.json';
    a.click();
  },

  /* Solo superadmin: reemplaza los datos de la barbería ACTIVA por los de demostración */
  reloadDemoData() {
    UI.confirm({
      title: 'Cargar datos de demostración',
      message: 'Se reemplazarán los barberos, servicios, citas, walk-in, clientes y asesorías de ' + DB.tenant.name + ' por datos de ejemplo. Los usuarios del personal quedarán sin barbero vinculado.',
      confirmText: 'Reemplazar datos', danger: true
    }).then(ok => {
      if (!ok) return;
      const root = DB.load();
      root.data[DB.tenant.id] = DB.getDemoData();
      root.users.forEach(u => { if (u.tenantId === DB.tenant.id) u.barberId = null; });
      DB.useTenant(DB.tenant.id);
      DB.save();
      DB.log('Cargó datos de demostración', DB.tenant.name);
      this.renderAll();
      UI.toast('Datos de demostración cargados.');
    });
  },

  /* Solo superadmin: borra TODO el sistema (barberías, usuarios, datos e historial) */
  factoryReset() {
    UI.confirm({
      title: 'Restablecer todo el sistema',
      message: 'Se borrarán TODAS las barberías, usuarios, citas e historial guardados en este navegador y se volverá a la configuración inicial de la demo. No se puede deshacer.',
      confirmText: 'Borrar todo', danger: true
    }).then(ok => {
      if (!ok) return;
      try {
        localStorage.removeItem(DB.KEY);
        localStorage.removeItem(DB.LEGACY_KEY);
        localStorage.removeItem(Auth.SESSION_KEY);
      } catch (e) {}
      window.location.replace('login.html?msg=' + encodeURIComponent('Sistema restablecido. Ingresa con las cuentas iniciales.'));
    });
  },

  closeModal() { ModalComponent.close(); },

  openAppointmentModal() {
    const cur = DB.state.settings.currency;
    if (!DB.state.services.length || !DB.state.barberProfiles.length) {
      UI.toast('Primero registra al menos un servicio y un barbero.', 'error');
      return;
    }
    const srvOptions = DB.state.services.map(s => '<option value="' + UI.esc(s.name) + '" data-price="' + s.price + '">' + UI.esc(s.name) + ' (' + cur + s.price + ')</option>').join('');
    const barbers = DB.assignableBarbers();
    const barbOptions = barbers.map(b => '<option value="' + UI.esc(b) + '">' + UI.esc(b) + '</option>').join('');
    const firstDate = DB.firstBookableDate(barbers[0]);
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Agenda</span><h3>Agregar cita</h3></div><button type="button" class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveAppointmentModal(event)" novalidate>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="m-ap-name">Cliente <span class="req">*</span></label><input type="text" id="m-ap-name" class="input-dark" required /></div>' +
          '<div><label class="field-lbl" for="m-ap-phone">Teléfono</label><input type="tel" id="m-ap-phone" class="input-dark" inputmode="numeric" maxlength="9" /></div>' +
          '<div><label class="field-lbl" for="m-ap-service">Servicio</label><select id="m-ap-service" class="input-dark">' + srvOptions + '</select></div>' +
          '<div><label class="field-lbl" for="m-ap-barber">Barbero</label><select id="m-ap-barber" class="input-dark" onchange="CRM.refreshApptSlots()">' + barbOptions + '</select></div>' +
          '<div><label class="field-lbl" for="m-ap-date">Fecha</label><input type="date" id="m-ap-date" class="input-dark" min="' + DB.todayISO() + '" value="' + firstDate + '" onchange="CRM.refreshApptSlots()" required /></div>' +
          '<div><label class="field-lbl" for="m-ap-time">Hora</label><select id="m-ap-time" class="input-dark" required></select></div>' +
        '</div>' +
        '<p class="field-hint" id="m-ap-note" style="margin-top:10px;"></p>' +
        '<div class="form-error" id="m-ap-error" role="alert"></div>' +
        '<div class="modal-actions"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">' + ic('check') + 'Guardar cita</button></div>' +
      '</form>'
    );
    this.refreshApptSlots();
  },

  /* Días pasados, horas que ya pasaron y horarios ocupados quedan bloqueados */
  refreshApptSlots() {
    const dateInp = document.getElementById('m-ap-date');
    const timeSel = document.getElementById('m-ap-time');
    const barber = (document.getElementById('m-ap-barber') || {}).value;
    const note = document.getElementById('m-ap-note');
    if (!dateInp || !timeSel) return;
    let msg = '';
    if (!dateInp.value || DB.isPastDate(dateInp.value)) {
      if (dateInp.value) msg = 'La fecha ya pasó; se cambió al primer día disponible.';
      dateInp.value = DB.firstBookableDate(barber);
    }
    if (!DB.freeSlots(dateInp.value, barber).length) {
      const next = DB.firstBookableDate(barber);
      if (next !== dateInp.value) {
        msg = 'No quedan horarios ese día para ' + barber + '; se muestra el ' + next + '.';
        dateInp.value = next;
      }
    }
    const prev = timeSel.value;
    let first = null;
    timeSel.innerHTML = DB.TIME_SLOTS.map(t => {
      const st = DB.slotState(dateInp.value, t, barber);
      if (st === 'free' && !first) first = t;
      return '<option value="' + t + '"' + (st !== 'free' ? ' disabled' : '') + '>' + t + (st === 'past' ? ' · Ya pasó' : st === 'busy' ? ' · Ocupado' : '') + '</option>';
    }).join('');
    const po = prev && timeSel.querySelector('option[value="' + prev + '"]');
    timeSel.value = (po && !po.disabled) ? prev : (first || '');
    if (note) note.textContent = msg;
  },

  saveAppointmentModal(e) {
    e.preventDefault();
    const err = document.getElementById('m-ap-error');
    const name = document.getElementById('m-ap-name').value.trim();
    const srvName = document.getElementById('m-ap-service').value;
    const barber = document.getElementById('m-ap-barber').value;
    const date = document.getElementById('m-ap-date').value;
    const time = document.getElementById('m-ap-time').value;
    if (!name) { err.textContent = 'Escribe el nombre del cliente.'; return; }
    const slotError = DB.validateBooking(date, time, barber);
    if (slotError) { err.textContent = slotError; this.refreshApptSlots(); return; }
    const srvObj = DB.state.services.find(s => s.name === srvName);
    const payload = {
      id: 'a-' + Date.now(),
      customerName: name,
      phone: document.getElementById('m-ap-phone').value.trim(),
      service: srvName,
      barber, date, time,
      price: srvObj ? srvObj.price : 0,
      status: 'PROGRAMADA',
      source: 'CRM',
      createdAt: new Date().toISOString(),
      notes: ''
    };
    DB.state.appointments.unshift(payload);
    DB.ensureCustomer(payload.customerName, payload.phone);
    DB.save();
    this.closeModal();
    this.renderAll();
    UI.toast('Cita registrada para el ' + date + ' a las ' + time + '.');
  },

  openWalkInModal() {
    const srvOptions = DB.state.services.map(s => '<option value="' + s.name + '">' + s.name + '</option>').join('');
    const barbOptions = DB.getBarberNames().map(b => '<option value="' + b + '">' + b + '</option>').join('');
    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">AGREGAR WALK-IN</h3><button class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveWalkInModal(event)">' +
        '<div style="margin-bottom:12px;"><label class="field-lbl">NOMBRE DEL CLIENTE *</label><input type="text" id="m-wk-name" class="input-dark" required /></div>' +
        '<div style="margin-bottom:12px;"><label class="field-lbl">SERVICIO</label><select id="m-wk-service" class="input-dark">' + srvOptions + '</select></div>' +
        '<div style="margin-bottom:18px;"><label class="field-lbl">BARBERO</label><select id="m-wk-barber" class="input-dark">' + barbOptions + '</select></div>' +
        '<div style="display:flex; justify-content:flex-end; gap:10px;"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">Guardar Walk-In</button></div>' +
      '</form>'
    );
  },

  saveWalkInModal(e) {
    e.preventDefault();
    const srvName = document.getElementById('m-wk-service').value;
    const srvObj = DB.state.services.find(s => s.name === srvName);
    DB.state.walkIns.unshift({
      id: 'w-' + Date.now(),
      customerName: document.getElementById('m-wk-name').value.trim(),
      service: srvName,
      barber: document.getElementById('m-wk-barber').value,
      price: srvObj ? srvObj.price : 45,
      status: 'ESPERANDO',
      addedAt: DB.nowTimeStr(),
      date: DB.todayISO(),
      notes: ''
    });
    DB.save();
    this.closeModal();
    this.renderAll();
  },

  openCustomerModal() {
    ModalComponent.open(
      '<div class="crm-modal-header"><h3 style="font-size:1.25rem;">AGREGAR CLIENTE</h3><button class="btn-dark btn-xs" onclick="CRM.closeModal()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<form onsubmit="CRM.saveCustomerModal(event)">' +
        '<div style="margin-bottom:12px;"><label class="field-lbl">NOMBRE *</label><input type="text" id="m-cu-name" class="input-dark" required /></div>' +
        '<div style="margin-bottom:18px;"><label class="field-lbl">CELULAR *</label><input type="text" id="m-cu-phone" class="input-dark" required /></div>' +
        '<div style="display:flex; justify-content:flex-end; gap:10px;"><button type="button" class="btn-dark" onclick="CRM.closeModal()">Cancelar</button><button type="submit" class="btn-golden">Guardar</button></div>' +
      '</form>'
    );
  },

  saveCustomerModal(e) {
    e.preventDefault();
    DB.ensureCustomer(document.getElementById('m-cu-name').value, document.getElementById('m-cu-phone').value);
    DB.save();
    this.closeModal();
    this.renderAll();
  },

};