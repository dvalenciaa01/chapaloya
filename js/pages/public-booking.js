const PublicBooking = {
  selectedBarberFilter: 'ALL',

  /* Captcha de Cloudflare Turnstile (solo si está configurado en js/config.js) */
  initCaptcha() {
    const key = (window.RESERVALOPE_CONFIG || {}).turnstileSiteKey;
    const box = document.getElementById('pb-captcha');
    if (!key || !box || this.captchaWidget != null) return;
    const sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true;
    sc.onload = () => {
      this.captchaWidget = window.turnstile.render(box, {
        sitekey: key, language: 'es',
        callback: (t) => { this.captchaToken = t; },
        'expired-callback': () => { this.captchaToken = ''; },
        'error-callback': () => { this.captchaToken = ''; }
      });
    };
    document.head.appendChild(sc);
  },

  esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  },

  jsArg(str) {
    return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  },

  fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d)) return iso;
    const txt = d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  },

  /* ---------------- Barberos ---------------- */
  setBarberFilter(barberId) {
    this.selectedBarberFilter = barberId;
    this.renderBarbersShowcase();
  },

  renderBarbersShowcase() {
    const profiles = DB.state.barberProfiles;
    const activeWalkIns = DB.state.walkIns.filter(w => w.status !== 'FINALIZADO');

    const filterEl = document.getElementById('pub-barber-filter-bar');
    if (filterEl) {
      const chip = (id, label, count) => {
        const on = this.selectedBarberFilter === id;
        return '<button type="button" class="filter-chip' + (on ? ' active' : '') + '" aria-pressed="' + on + '" onclick="PublicBooking.setBarberFilter(\'' + this.jsArg(id) + '\')">' +
          this.esc(label) + '<span class="filter-count">' + count + '</span></button>';
      };
      filterEl.innerHTML = chip('ALL', 'Todos', profiles.length) +
        profiles.map(bp => chip(bp.id, bp.name, bp.works.length)).join('');
    }

    const listEl = document.getElementById('pub-barbers-showcase-list');
    if (!listEl) return;
    if (!profiles.length) {
      listEl.innerHTML = '<div class="empty-state">' + ic('users') + '<strong>Pronto conocerás a nuestro equipo</strong>Estamos preparando los perfiles y trabajos de nuestros barberos.</div>';
      return;
    }

    const filtered = this.selectedBarberFilter === 'ALL'
      ? profiles
      : profiles.filter(bp => bp.id === this.selectedBarberFilter);

    listEl.innerHTML = filtered.map(bp => {
      const isWorking = activeWalkIns.some(w => w.barber === bp.name && w.status === 'EN_SILLON');
      const pill = isWorking
        ? '<span class="live-pill working">En sillón ahora</span>'
        : '<span class="live-pill available">Disponible para reservar</span>';
      const specs = (bp.specialties || []).map(sp => '<span class="specialty-pill">' + this.esc(sp) + '</span>').join('');

      const works = bp.works.length
        ? '<div class="works-gallery-grid">' + bp.works.map(w =>
            '<button type="button" class="work-photo-card" onclick="PublicBooking.openWork(\'' + this.jsArg(bp.id) + '\', \'' + this.jsArg(w.id) + '\')" aria-label="Ampliar: ' + this.esc(w.title) + '">' +
              '<span class="work-photo-img-box"><img src="' + this.esc(w.image) + '" alt="' + this.esc(w.title) + '" loading="lazy" /><span class="work-zoom">' + ic('zoom') + '</span></span>' +
              '<span class="work-photo-caption"><span class="work-photo-title">' + this.esc(w.title) + '</span></span>' +
            '</button>'
          ).join('') + '</div>'
        : '<div class="empty-state">' + ic('image') + '<strong>Aún sin fotos</strong>Muy pronto verás aquí los trabajos de ' + this.esc(bp.name) + '.</div>';

      return '<article class="barber-showcase-block reveal">' +
        '<div class="barber-profile-header">' +
          '<div class="barber-portrait-frame"><img src="' + this.esc(bp.photo) + '" alt="Retrato de ' + this.esc(bp.name) + '" loading="lazy" /></div>' +
          '<div class="barber-profile-info">' +
            pill +
            '<h2 class="barber-name-heading">' + this.esc(bp.name) + '</h2>' +
            '<p class="barber-role-text">' + this.esc(bp.role || 'Maestro barbero') + '</p>' +
            (specs ? '<div class="barber-specs"><span class="barber-specs-label">Especialidades</span><div class="specialty-tags-wrap">' + specs + '</div></div>' : '') +
            '<div class="barber-cta-group">' +
              '<button type="button" class="btn-golden" onclick="PublicBooking.bookWithBarber(\'' + this.jsArg(bp.name) + '\')">' + ic('calendar') + 'Reservar con ' + this.esc(bp.name) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="barber-works-section">' +
          '<div class="works-head"><h3>Trabajos realizados</h3><span class="works-count">' + bp.works.length + ' fotos</span></div>' +
          works +
        '</div>' +
      '</article>';
    }).join('');

    if (typeof SiteUI !== 'undefined') SiteUI.observeReveal(listEl);
  },

  renderHomeBarbers() {
    const el = document.getElementById('pub-home-barbers');
    if (!el) return;
    const section = el.closest('section');
    if (section) section.hidden = !DB.state.barberProfiles.length;
    el.innerHTML = DB.state.barberProfiles.slice(0, 4).map(bp =>
      '<article class="team-card reveal">' +
        '<div class="team-photo"><img src="' + this.esc(bp.photo) + '" alt="Retrato de ' + this.esc(bp.name) + '" loading="lazy" /></div>' +
        '<div class="team-body">' +
          '<h3>' + this.esc(bp.name) + '</h3>' +
          '<p>' + this.esc(bp.role || 'Maestro barbero') + '</p>' +
          '<button type="button" class="team-link" onclick="PublicBooking.bookWithBarber(\'' + this.jsArg(bp.name) + '\')">Reservar ' + ic('arrowRight') + '</button>' +
        '</div>' +
      '</article>'
    ).join('');
  },

  bookWithBarber(barberName) {
    const barSel = document.getElementById('pb-barber');
    if (barSel) {
      barSel.value = barberName;
      this.refreshTimes();
    } else {
      AppRouter.goPublic('reservar', { barber: barberName });
    }
  },

  openWork(barberId, workId) {
    const bp = DB.state.barberProfiles.find(b => b.id === barberId);
    const w = bp && bp.works.find(x => x.id === workId);
    if (w) this.openLightbox(w.image, w.title, bp.name);
  },

  openLightbox(imgSrc, title, barberName) {
    const html = '<div class="crm-modal-header">' +
        '<div>' +
          '<span class="eyebrow-golden">Trabajo de ' + this.esc(barberName) + '</span>' +
          '<h3 style="font-size:1.5rem; margin-top:4px;">' + this.esc(title) + '</h3>' +
        '</div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button>' +
      '</div>' +
      '<div class="lightbox-frame"><img src="' + this.esc(imgSrc) + '" alt="' + this.esc(title) + '" /></div>' +
      '<div style="display:flex; justify-content:flex-end; margin-top:16px;">' +
        '<button type="button" class="btn-golden" onclick="PublicBooking.bookWithBarber(\'' + this.jsArg(barberName) + '\')">' + ic('calendar') + 'Quiero este corte</button>' +
      '</div>';
    if (typeof ModalComponent !== 'undefined') ModalComponent.open(html, { wide: true });
  },

  /* ---------------- Servicios ---------------- */
  serviceCard(s, cur) {
    const featured = s.featured;
    return '<article class="service-card' + (featured ? ' is-featured' : '') + ' reveal">' +
      '<div class="service-card-top">' +
        '<span class="service-icon">' + ic('scissors') + '</span>' +
        '<span class="service-cat">' + this.esc(s.category || 'Servicio') + '</span>' +
      '</div>' +
      '<h3 class="service-name">' + this.esc(s.name) + '</h3>' +
      '<p class="service-desc">' + this.esc(s.desc || '') + '</p>' +
      '<div class="service-foot">' +
        '<div class="service-meta">' +
          '<span class="service-price">' + this.esc(cur) + ' ' + this.esc(s.price) + '</span>' +
          '<span class="service-duration">' + ic('clock') + this.esc(s.duration) + ' min</span>' +
        '</div>' +
        '<button type="button" class="service-cta" onclick="PublicBooking.preselectService(\'' + this.jsArg(s.id) + '\')" aria-label="Reservar ' + this.esc(s.name) + '">' +
          'Reservar ' + ic('arrowRight') +
        '</button>' +
      '</div>' +
    '</article>';
  },

  renderPublicViews() {
    const cur = DB.state.settings.currency;
    const ordered = DB.state.services.slice().sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    const srvHTML = ordered.map(s => this.serviceCard(s, cur)).join('');

    // En Inicio: destacado (2 columnas) + 4 servicios = 2 filas completas
    const homeServicesEl = document.getElementById('pub-home-services');
    if (homeServicesEl) homeServicesEl.innerHTML = ordered.slice(0, 5).map(s => this.serviceCard(s, cur)).join('');
    const allServicesEl = document.getElementById('pub-all-services');
    if (allServicesEl) allServicesEl.innerHTML = srvHTML;

    this.renderHomeBarbers();
    this.renderBarbersShowcase();

    const srvSel = document.getElementById('pb-service');
    const barSel = document.getElementById('pb-barber');
    const dateInp = document.getElementById('pb-date');
    const timeSel = document.getElementById('pb-time');

    if (srvSel && barSel && dateInp && timeSel) {
      const form = srvSel.closest('form');
      if (!DB.state.barberProfiles.length || !DB.state.services.length) {
        if (form && !form.dataset.emptyShown) {
          form.dataset.emptyShown = '1';
          form.innerHTML = '<div class="lookup-empty">' + ic('calendar') + '<strong>Reservas en línea aún no disponibles</strong>' +
            '<span>Esta barbería todavía está configurando sus servicios y barberos. Escríbenos o llámanos para agendar.</span></div>';
        }
        return;
      }
      const currentSrvVal = srvSel.value;
      srvSel.innerHTML = DB.state.services.map(s =>
        '<option value="' + this.esc(s.name) + '" data-price="' + s.price + '">' + this.esc(s.name) + ' — ' + this.esc(cur) + ' ' + s.price + '</option>'
      ).join('');
      if (currentSrvVal) srvSel.value = currentSrvVal;

      const currentBarVal = barSel.value;
      barSel.innerHTML = DB.getBarberNames().map(b => '<option value="' + this.esc(b) + '">' + this.esc(b) + '</option>').join('');
      if (currentBarVal && DB.getBarberNames().includes(currentBarVal)) barSel.value = currentBarVal;

      dateInp.min = DB.todayISO();
      this.refreshTimes();
    }

    if (typeof SiteUI !== 'undefined') SiteUI.observeReveal();
  },

  /* Horarios: se bloquean los días pasados, las horas que ya pasaron hoy y las ocupadas */
  refreshTimes(autoAdvance) {
    const barSel = document.getElementById('pb-barber');
    const dateInp = document.getElementById('pb-date');
    const timeSel = document.getElementById('pb-time');
    if (!barSel || !dateInp || !timeSel) return;
    const note = document.getElementById('pb-date-note');
    const setNote = (txt) => { if (note) { note.textContent = txt || ''; note.hidden = !txt; } };

    const today = DB.todayISO();
    const barber = barSel.value;
    dateInp.min = today;
    dateInp.max = DB.maxBookDate();
    let msg = '';
    if (dateInp.value && dateInp.value > dateInp.max) {
      msg = 'Solo se puede reservar hasta ' + DB.tenant.schedule.maxDays + ' días adelante. Te mostramos el primer día disponible.';
      dateInp.value = '';
    }

    // Fecha vacía o pasada (escrita a mano o por un calendario antiguo) → hoy
    if (!dateInp.value || DB.isPastDate(dateInp.value)) {
      if (dateInp.value) msg = 'No puedes reservar en una fecha pasada. Te mostramos el primer día disponible.';
      dateInp.value = DB.firstBookableDate(barber);
    }
    // Hoy ya sin horarios libres → siguiente día con disponibilidad
    if (!DB.freeSlots(dateInp.value, barber).length && (autoAdvance !== false)) {
      const next = DB.firstBookableDate(barber);
      if (next !== dateInp.value) {
        const closed = !DB.slotsFor(dateInp.value, barber).length;
        msg = closed
          ? (dateInp.value === today ? 'Hoy ' : 'Ese día ') + barber + ' no atiende. Te mostramos el ' + this.fmtDate(next).toLowerCase() + '.'
          : dateInp.value === today
            ? 'Hoy ya no quedan horarios con ' + barber + '. Te mostramos el ' + this.fmtDate(next).toLowerCase() + '.'
            : 'Ese día no quedan horarios con ' + barber + '. Te mostramos el ' + this.fmtDate(next).toLowerCase() + '.';
        dateInp.value = next;
      }
    }
    setNote(msg);

    const prev = timeSel.value;
    const date = dateInp.value;
    let firstFree = null;
    const slots = DB.slotsFor(date, barber);
    if (!slots.length && !msg) msg = barber + ' no tiene horarios disponibles por ahora. Prueba con otro barbero.';
    setNote(msg);
    timeSel.innerHTML = slots.map(t => {
      const st = DB.slotState(date, t, barber);
      if (st === 'free' && !firstFree) firstFree = t;
      const label = st === 'past' ? ' · Ya pasó' : (st === 'busy' ? ' · Ocupado' : '');
      return '<option value="' + t + '"' + (st !== 'free' ? ' disabled' : '') + '>' + t + label + '</option>';
    }).join('');

    const prevOpt = prev && timeSel.querySelector('option[value="' + prev + '"]');
    if (prevOpt && !prevOpt.disabled) timeSel.value = prev;
    else if (firstFree) timeSel.value = firstFree;
    else timeSel.value = '';

    this.updateSummary();
  },

  applyPreselections(params) {
    if (!params) return;
    const srvSel = document.getElementById('pb-service');
    const barSel = document.getElementById('pb-barber');

    if (params.serviceId && srvSel) {
      const s = DB.state.services.find(x => x.id === params.serviceId);
      if (s) srvSel.value = s.name;
    }
    if (params.barberName && barSel && DB.getBarberNames().includes(params.barberName)) {
      barSel.value = params.barberName;
    }
    this.refreshTimes();
  },

  preselectService(srvId) {
    const srvSel = document.getElementById('pb-service');
    if (srvSel) {
      const s = DB.state.services.find(x => x.id === srvId);
      if (s) {
        srvSel.value = s.name;
        this.updateSummary();
      }
    } else {
      AppRouter.goPublic('reservar', { service: srvId });
    }
  },

  updateSummary() {
    const srvSel = document.getElementById('pb-service');
    const barSel = document.getElementById('pb-barber');
    const dateInp = document.getElementById('pb-date');
    const timeSel = document.getElementById('pb-time');
    if (!srvSel || !barSel || !dateInp || !timeSel) return;

    const cur = DB.state.settings.currency;
    const srvObj = DB.state.services.find(s => s.name === srvSel.value) || DB.state.services[0];
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    set('pb-sum-srv', srvObj ? srvObj.name : '—');
    set('pb-sum-bar', barSel.value || '—');
    set('pb-sum-dt', this.fmtDate(dateInp.value) + (timeSel.value ? ' · ' + timeSel.value : ''));
    set('pb-sum-dur', srvObj ? srvObj.duration + ' min' : '—');
    set('pb-sum-price', srvObj ? (cur + ' ' + srvObj.price) : (cur + ' 0'));
  },

  clearPhoneError() {
    const inp = document.getElementById('pb-phone');
    const err = document.getElementById('pb-phone-error');
    if (inp) inp.removeAttribute('aria-invalid');
    if (err) err.classList.remove('is-visible');
  },

  async submit(e) {
    e.preventDefault();
    if (this.sending) return;
    const name = document.getElementById('pb-name').value.trim();
    const phoneInp = document.getElementById('pb-phone');
    const phone = phoneInp.value.replace(/\D/g, '');
    const service = document.getElementById('pb-service').value;
    const barber = document.getElementById('pb-barber').value;
    const date = document.getElementById('pb-date').value;
    const time = document.getElementById('pb-time').value;
    const notes = document.getElementById('pb-notes').value.trim();
    const waEl = document.getElementById('pb-wa');
    const waOptIn = !!(waEl && waEl.checked);
    const fb = document.getElementById('pb-feedback');
    const showError = (msg) => {
      fb.innerHTML = '<div class="alert alert-error">' + ic('alert') + '<span>' + this.esc(msg) + '</span></div>';
      fb.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    if (name.length < 2) { showError('Escribe tu nombre.'); document.getElementById('pb-name').focus(); return; }
    if (!/^9\d{8}$/.test(phone)) {
      phoneInp.setAttribute('aria-invalid', 'true');
      const err = document.getElementById('pb-phone-error');
      if (err) err.classList.add('is-visible');
      else showError('El celular debe tener 9 dígitos y empezar con 9.');
      phoneInp.focus();
      return;
    }
    this.clearPhoneError();

    // Validación de horario en pantalla (el servidor la repite)
    const slotError = DB.validateBooking(date, time, barber);
    if (slotError) { showError(slotError); this.refreshTimes(); return; }

    const srvObj = DB.state.services.find(s => s.name === service);
    const barberObj = DB.state.barberProfiles.find(b => b.name === barber);
    if (!srvObj || !barberObj) { showError('Selecciona un servicio y un barbero.'); return; }

    const btn = e.target.querySelector('button[type="submit"]');
    this.sending = true;
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    let res;
    try {
      res = await DB.reservar({ serviceId: srvObj.id, barberId: barberObj.id, date, time, name, phone, notes, waOptIn, captcha: this.captchaToken || '' });
    } catch (ex) {
      showError(ex.message || 'No se pudo registrar la reserva. Inténtalo de nuevo.');
      try { await DB.refreshBusy(); } catch (e2) { /* sin conexión */ }
      this.refreshTimes();
      return;
    } finally {
      this.sending = false;
      if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
      if (window.turnstile && this.captchaWidget != null) { this.captchaToken = ''; try { window.turnstile.reset(this.captchaWidget); } catch (e3) { /* sin captcha */ } }
    }

    const code = res && res.code ? res.code : '';
    fb.innerHTML = '<div class="alert alert-success" role="status">' + ic('checkCircle') +
      '<div><strong style="display:block; font-size:1rem; margin-bottom:2px;">¡Reserva registrada!</strong>' +
      'Te esperamos el ' + this.esc(this.fmtDate(date).toLowerCase()) + ' a las ' + this.esc(time) + ' con ' + this.esc(barber) + '.' +
      (code ? '<span style="display:block; margin-top:8px;">Tu código de reserva es <strong style="font-size:1.15rem; letter-spacing:0.08em;">' + this.esc(code) + '</strong>. Guárdalo: lo necesitas para consultar tu cita.</span>' : '') +
      (waOptIn ? '<span style="display:block; margin-top:4px;">Te enviaremos la confirmación por WhatsApp.</span>' : '') +
      '<div class="alert-links">' +
        '<a href="consultar-cita.html">Consultar mi cita ' + ic('arrowRight') + '</a>' +
      '</div></div>' +
    '</div>';

    document.getElementById('pb-name').value = '';
    phoneInp.value = '';
    document.getElementById('pb-notes').value = '';
    if (waEl) waEl.checked = false;
    try { await DB.refreshBusy(); } catch (e4) { /* sin conexión */ }
    this.renderPublicViews();
    fb.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  /* ---------------- Consulta de cita ---------------- */
  async lookup(e) {
    if (e) e.preventDefault();
    const phoneInp = document.getElementById('pub-query-phone');
    const codeInp = document.getElementById('pub-query-code');
    const box = document.getElementById('pub-query-res');
    if (!phoneInp || !codeInp || !box) return;
    const phone = phoneInp.value.replace(/\D/g, '');
    const code = codeInp.value.trim().toUpperCase();
    if (!/^9\d{8}$/.test(phone) || code.length < 4) {
      box.innerHTML = '<div class="alert alert-error">' + ic('alert') + '<span>Escribe tu celular (9 dígitos) y el código de reserva que recibiste al reservar.</span></div>';
      (phone ? codeInp : phoneInp).focus();
      return;
    }
    let matches;
    try {
      matches = await DB.consultarCita(phone, code);
    } catch (ex) {
      box.innerHTML = '<div class="alert alert-error">' + ic('alert') + '<span>' + this.esc(DB.errorText(ex)) + '</span></div>';
      return;
    }
    if (!matches.length) {
      box.innerHTML = '<div class="lookup-empty">' + ic('search') +
        '<strong>No encontramos una cita con esos datos</strong>' +
        '<span>Revisa el celular y el código, o agenda una nueva cita.</span>' +
        '<a class="btn-black btn-xs" href="reservar.html">Reservar cita</a></div>';
      return;
    }
    box.innerHTML = matches.map(a =>
      '<div class="lookup-result">' +
        '<div class="lookup-date"><span>' + this.esc(a.time) + '</span></div>' +
        '<div class="lookup-info">' +
          '<strong>' + this.esc(this.fmtDate(a.date)) + '</strong>' +
          '<span>' + this.esc(a.service) + ' · con ' + this.esc(a.barber) + '</span>' +
          '<span class="lookup-name">' + ic('user') + this.esc(a.customerName) + ' · Código ' + this.esc(a.code) + '</span>' +
        '</div>' +
        '<span class="st-badge st-' + this.esc(a.status) + '">' + this.esc(DB.statusLabel(a.status)) + '</span>' +
      '</div>'
    ).join('');
  }
};
