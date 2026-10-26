/* ==========================================================================
   Web pública: servicios, equipo, formulario de reserva y "Mi cita"
   --------------------------------------------------------------------------
   Las palabras que dependen del rubro (barbero/doctor/especialista,
   servicio/consulta/tratamiento...) salen de js/core/vocab.js: v(), V(), vf().
   Seguridad: ningún texto del negocio (nombres del equipo, servicios,
   títulos de fotos) se pone dentro de un onclick. Los botones generados
   llevan data-pb-action + data-id (el UUID) y un único listener delegado
   decide qué hacer. Todo texto que va al HTML pasa por esc().
   ========================================================================== */
const PublicBooking = {
  selectedBarberFilter: 'ALL',
  REFRESH_MS: 60000,        // disponibilidad: se vuelve a pedir cada minuto con la página abierta
  captchaRequired: false,
  captchaToken: '',
  captchaWidget: null,
  sending: false,

  /* ---------------- Vocabulario del rubro ---------------- */
  // Sin vocab.js (no debería pasar) se usan las palabras genéricas
  V_DEFAULT: { business: 'negocio', businessArticle: 'el', staff: 'profesional', staffPlural: 'profesionales', staffArticle: 'el',
    service: 'servicio', servicePlural: 'servicios', client: 'cliente', appointment: 'cita', appointmentPlural: 'citas', inService: 'atendiendo ahora' },
  v(key) { return typeof Vocab !== 'undefined' ? Vocab.t(key) : (this.V_DEFAULT[key] || key); },
  V(key) { const w = this.v(key); return w.charAt(0).toUpperCase() + w.slice(1); },
  vf(str) {
    if (typeof Vocab !== 'undefined') return Vocab.fmt(str);
    return String(str).replace(/\{([A-Za-z]+)\}/g, (m, k) => (/^[A-Z]/.test(k) ? this.V(k.charAt(0).toLowerCase() + k.slice(1)) : this.v(k)));
  },
  // "esta barbería" / "este consultorio" / "esta manicurista"
  dem(key) { return (this.v(key + 'Article') === 'la' ? 'esta ' : 'este ') + this.v(key); },
  Dem(key) { const w = this.dem(key); return w.charAt(0).toUpperCase() + w.slice(1); },
  rubroIcon() { return typeof Vocab !== 'undefined' ? Vocab.icon() : ic('calendar'); },

  /* ---------------- Utilidades ---------------- */
  esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  // Enlace interno conservando el negocio (?b=slug)
  href(page) {
    const slug = DB.tenant ? DB.tenant.slug : null;
    return (typeof TenantBrand !== 'undefined' && slug) ? TenantBrand.withSlug(page, slug) : page;
  },

  fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'T12:00:00');
    if (isNaN(d)) return iso;
    const txt = d.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  },

  /* Celular peruano: solo dígitos; se aceptan espacios, guiones y el prefijo +51 / 0051 */
  normPhone(v) {
    let d = String(v || '').replace(/\D/g, '');
    if (d.length === 13 && d.startsWith('0051')) d = d.slice(4);
    if (d.length === 11 && d.startsWith('51')) d = d.slice(2);
    return d;
  },

  barberName(id) { const b = DB.barberOf(id); return b ? b.name : ''; },

  photoHTML(bp, cls) {
    if (bp.photo) return '<img src="' + this.esc(bp.photo) + '" alt="Retrato de ' + this.esc(bp.name) + '" loading="lazy" />';
    // Iniciales sin tratamientos ("Dra. Ana Ríos" → "AR")
    const words = String(bp.name || '').trim().split(/\s+/).filter(w => w && !/^(dr|dra|lic|mg|mtro|mtra|sr|sra|srta|prof)\.?$/i.test(w));
    const ini = (words.slice(0, 2).map(w => w.charAt(0)).join('') || '?').toUpperCase();
    return '<span class="photo-fallback' + (cls ? ' ' + cls : '') + '" role="img" aria-label="' + this.esc(bp.name) + '">' + this.esc(ini) + '</span>';
  },

  /* ---------------- Acciones de botones generados (delegación) ---------------- */
  bindActions() {
    if (this._actionsBound) return;
    this._actionsBound = true;
    document.addEventListener('click', (e) => {
      const el = e.target && e.target.closest ? e.target.closest('[data-pb-action]') : null;
      if (!el) return;
      const id = el.getAttribute('data-id') || '';
      switch (el.getAttribute('data-pb-action')) {
        case 'filter': this.setBarberFilter(id); break;
        case 'work': this.openWork(id, el.getAttribute('data-work') || ''); break;
        case 'book':
          if (typeof ModalComponent !== 'undefined' && el.closest('#crm-modal-content')) ModalComponent.close();
          this.bookWithBarber(id);
          break;
        case 'service': this.preselectService(id); break;
        case 'copy-code': this.copyCode(el); break;
        case 'close': if (typeof ModalComponent !== 'undefined') ModalComponent.close(); break;
      }
    });
    // "Mi cita": formulario de consulta (sin onsubmit en el HTML)
    document.addEventListener('submit', (e) => {
      if (e.target && e.target.classList && e.target.classList.contains('lookup-form')) this.lookup(e);
    });
  },

  /* ---------------- Captcha de Cloudflare Turnstile ----------------
     Con clave configurada, "Confirmar reserva" queda desactivado hasta tener
     el token. Si el script no carga (bloqueador, sin red), se avisa. */
  initCaptcha() {
    const key = (window.RESERVALOPE_CONFIG || {}).turnstileSiteKey;
    const box = document.getElementById('pb-captcha');
    if (!box || this.captchaWidget != null || this._captchaStarted) return;
    if (!key || !DB.tenant || DB.tenant.accepting === false) { this.updateSubmitState(); return; }
    this._captchaStarted = true;
    this.captchaRequired = true;
    this.updateSubmitState();
    const fail = () => {
      if (this.captchaWidget != null) return;
      this.setCaptchaNote('No se pudo cargar la verificación de seguridad. Si usas un bloqueador de anuncios, desactívalo para esta página y recárgala.');
    };
    const sc = document.createElement('script');
    sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    sc.async = true;
    sc.onerror = fail;
    sc.onload = () => {
      if (!window.turnstile) return fail();
      try {
        this.captchaWidget = window.turnstile.render(box, {
          sitekey: key, language: 'es',
          callback: (t) => { this.captchaToken = t; this.setCaptchaNote(''); this.updateSubmitState(); },
          'expired-callback': () => { this.captchaToken = ''; this.setCaptchaNote('La verificación expiró. Vuelve a marcarla para continuar.'); this.updateSubmitState(); },
          'error-callback': () => { this.captchaToken = ''; this.setCaptchaNote('La verificación de seguridad falló. Recarga la página e inténtalo de nuevo.'); this.updateSubmitState(); }
        });
      } catch (e) { fail(); }
    };
    document.head.appendChild(sc);
    setTimeout(() => { if (!window.turnstile) fail(); }, 15000);
  },

  setCaptchaNote(txt) {
    const el = document.getElementById('pb-captcha-note');
    if (!el) return;
    el.textContent = txt || '';
    el.hidden = !txt;
  },

  updateSubmitState() {
    const btn = document.querySelector('.booking-form-card button[type="submit"]');
    if (!btn) return;
    const blocked = this.sending || (this.captchaRequired && !this.captchaToken);
    btn.disabled = blocked;
    btn.title = (!this.sending && this.captchaRequired && !this.captchaToken) ? 'Completa la verificación de seguridad' : '';
  },

  /* ---------------- Equipo (tabla barbers) ---------------- */
  setBarberFilter(barberId) {
    this.selectedBarberFilter = barberId;
    this.renderBarbersShowcase();
  },

  // "Atendiendo ahora" (inService del rubro): solo walk-in de HOY (un walk-in de otro día sin cerrar no cuenta)
  isInChair(bp) {
    const today = DB.todayISO();
    return (DB.state.walkIns || []).some(w => w.status === 'EN_SILLON' && (!w.date || w.date === today) &&
      (w.barberId ? w.barberId === bp.id : w.barber === bp.name));
  },

  renderBarbersShowcase() {
    const profiles = DB.state.barberProfiles;

    const filterEl = document.getElementById('pub-barber-filter-bar');
    if (filterEl) {
      const chip = (id, label, count) => {
        const on = this.selectedBarberFilter === id;
        return '<button type="button" class="filter-chip' + (on ? ' active' : '') + '" aria-pressed="' + on + '" data-pb-action="filter" data-id="' + this.esc(id) + '">' +
          this.esc(label) + '<span class="filter-count">' + count + '</span></button>';
      };
      filterEl.innerHTML = chip('ALL', 'Todos', profiles.length) +
        profiles.map(bp => chip(bp.id, bp.name, bp.works.length)).join('');
    }

    const listEl = document.getElementById('pub-barbers-showcase-list');
    if (!listEl) return;
    if (!profiles.length) {
      listEl.innerHTML = '<div class="empty-state">' + ic('users') + '<strong>Pronto conocerás a nuestro equipo</strong>Estamos preparando los perfiles de quienes te atenderán.</div>';
      return;
    }

    const filtered = this.selectedBarberFilter === 'ALL'
      ? profiles
      : profiles.filter(bp => bp.id === this.selectedBarberFilter);

    listEl.innerHTML = filtered.map(bp => {
      const pill = this.isInChair(bp)
        ? '<span class="live-pill working">' + this.esc(this.V('inService')) + '</span>'
        : '<span class="live-pill available">Disponible para reservar</span>';
      const specs = (bp.specialties || []).map(sp => '<span class="specialty-pill">' + this.esc(sp) + '</span>').join('');

      // Galería solo si hay fotos (en un consultorio lo normal es no tener)
      const works = bp.works.length
        ? '<div class="works-gallery-grid">' + bp.works.map(w =>
            '<button type="button" class="work-photo-card" data-pb-action="work" data-id="' + this.esc(bp.id) + '" data-work="' + this.esc(w.id) + '" aria-label="Ampliar: ' + this.esc(w.title) + '">' +
              '<span class="work-photo-img-box"><img src="' + this.esc(w.image) + '" alt="' + this.esc(w.title) + '" loading="lazy" /><span class="work-zoom">' + ic('zoom') + '</span></span>' +
              '<span class="work-photo-caption"><span class="work-photo-title">' + this.esc(w.title) + '</span></span>' +
            '</button>'
          ).join('') + '</div>'
        : '';

      return '<article class="barber-showcase-block reveal">' +
        '<div class="barber-profile-header">' +
          '<div class="barber-portrait-frame">' + this.photoHTML(bp) + '</div>' +
          '<div class="barber-profile-info">' +
            pill +
            '<h2 class="barber-name-heading">' + this.esc(bp.name) + '</h2>' +
            '<p class="barber-role-text">' + this.esc(bp.role || this.V('staff')) + '</p>' +
            (specs ? '<div class="barber-specs"><span class="barber-specs-label">Especialidades</span><div class="specialty-tags-wrap">' + specs + '</div></div>' : '') +
            '<div class="barber-cta-group">' +
              '<button type="button" class="btn btn-solid" data-pb-action="book" data-id="' + this.esc(bp.id) + '">' + ic('calendar') + 'Reservar con ' + this.esc(bp.name) + '</button>' +
            '</div>' +
          '</div>' +
        '</div>' +
        (works
          ? '<div class="barber-works-section">' +
              '<div class="works-head"><h3>Galería de trabajos</h3><span class="works-count">' + bp.works.length + (bp.works.length === 1 ? ' foto' : ' fotos') + '</span></div>' +
              works +
            '</div>'
          : '') +
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
        '<div class="team-photo">' + this.photoHTML(bp) + '</div>' +
        '<div class="team-body">' +
          '<h3>' + this.esc(bp.name) + '</h3>' +
          '<p>' + this.esc(bp.role || this.V('staff')) + '</p>' +
          '<button type="button" class="btn btn-outline btn-sm team-link" data-pb-action="book" data-id="' + this.esc(bp.id) + '">Reservar con ' + this.esc(bp.name) + ' ' + ic('arrowRight') + '</button>' +
        '</div>' +
      '</article>'
    ).join('');
  },

  bookWithBarber(barberId) {
    const barSel = document.getElementById('pb-barber');
    const bp = DB.barberOf(barberId);
    if (!bp) return;
    if (barSel) {
      barSel.value = bp.id;
      this.onSelectionChange();
      barSel.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      AppRouter.goPublic('reservar', { barber: bp.id });
    }
  },

  openWork(barberId, workId) {
    const bp = DB.state.barberProfiles.find(b => b.id === barberId);
    const w = bp && bp.works.find(x => x.id === workId);
    if (w) this.openLightbox(w.image, w.title, bp);
  },

  openLightbox(imgSrc, title, bp) {
    const html = '<div class="crm-modal-header">' +
        '<div>' +
          '<span class="eyebrow">Trabajo de ' + this.esc(bp.name) + '</span>' +
          '<h3>' + this.esc(title) + '</h3>' +
        '</div>' +
        '<button type="button" class="btn btn-outline btn-icon" data-pb-action="close" aria-label="Cerrar">' + ic('x') + '</button>' +
      '</div>' +
      '<div class="lightbox-frame"><img src="' + this.esc(imgSrc) + '" alt="' + this.esc(title) + '" /></div>' +
      '<div class="modal-actions">' +
        '<button type="button" class="btn btn-solid" data-pb-action="book" data-id="' + this.esc(bp.id) + '">' + ic('calendar') + 'Reservar con ' + this.esc(bp.name) + '</button>' +
      '</div>';
    if (typeof ModalComponent !== 'undefined') ModalComponent.open(html, { wide: true });
  },

  /* ---------------- Portada personalizable (site de web_barberia) ----------------
     Título, subtítulo e imagen de fondo que el negocio define en la consola.
     Sin dato se queda el diseño de siempre (nombre del negocio y texto genérico).
     Con imagen: se pinta como fondo decorativo (alt vacío) bajo una capa oscura
     y el texto pasa a blanco para mantener contraste ≥ 4.5:1 sobre cualquier foto. */
  renderHero() {
    const hero = document.querySelector('section.hero');
    const site = DB.tenant && DB.tenant.site;
    if (!hero || !site) return;
    const title = document.getElementById('hero-title');
    if (title && site.heroTitle) title.textContent = site.heroTitle;
    const sub = hero.querySelector('.hero-sub');
    if (sub && site.heroSubtitle) { sub.removeAttribute('data-v-fmt'); sub.textContent = site.heroSubtitle; }
    let img = hero.querySelector('img.hero-bg');
    if (site.heroImage) {
      if (!img) {
        img = document.createElement('img');
        img.className = 'hero-bg';
        img.alt = '';
        img.setAttribute('aria-hidden', 'true');
        img.loading = 'lazy';
        img.decoding = 'async';
        hero.insertBefore(img, hero.firstChild);
      }
      if (img.getAttribute('src') !== site.heroImage) img.src = site.heroImage;
      hero.classList.add('has-image');
    } else if (img) {
      img.remove();
      hero.classList.remove('has-image');
    }
  },

  /* ---------------- Servicios ---------------- */
  serviceCard(s, cur) {
    const featured = s.featured;
    return '<article class="service-card' + (featured ? ' is-featured' : '') + ' reveal">' +
      '<div class="service-card-top">' +
        '<span class="service-icon">' + this.rubroIcon() + '</span>' +
        '<span class="service-cat">' + this.esc(s.category || this.V('service')) + '</span>' +
        (featured ? '<span class="service-badge">Destacado</span>' : '') +
      '</div>' +
      '<h3 class="service-name">' + this.esc(s.name) + '</h3>' +
      (s.desc ? '<p class="service-desc">' + this.esc(s.desc) + '</p>' : '') +
      '<div class="service-foot">' +
        '<div class="service-meta">' +
          '<span class="service-price">' + this.esc(cur) + ' ' + this.esc(s.price) + '</span>' +
          (s.duration ? '<span class="service-duration">' + ic('clock') + this.esc(s.duration) + ' min</span>' : '') +
        '</div>' +
        '<button type="button" class="btn btn-solid btn-sm service-cta" data-pb-action="service" data-id="' + this.esc(s.id) + '" aria-label="Reservar ' + this.esc(s.name) + '">' +
          'Reservar ' + ic('arrowRight') +
        '</button>' +
      '</div>' +
    '</article>';
  },

  renderPublicViews() {
    this.bindActions();
    const cur = DB.state.settings.currency;
    const ordered = DB.state.services.slice().sort((a, b) => (b.featured ? 1 : 0) - (a.featured ? 1 : 0));
    const srvHTML = ordered.map(s => this.serviceCard(s, cur)).join('');

    // En Inicio: destacado (2 columnas) + 4 servicios = 2 filas completas
    const homeServicesEl = document.getElementById('pub-home-services');
    if (homeServicesEl) homeServicesEl.innerHTML = ordered.slice(0, 5).map(s => this.serviceCard(s, cur)).join('');
    const allServicesEl = document.getElementById('pub-all-services');
    if (allServicesEl) allServicesEl.innerHTML = srvHTML;

    this.renderHero();
    this.renderHomeBarbers();
    this.renderBarbersShowcase();
    this.renderBookingForm();

    if (typeof SiteUI !== 'undefined') SiteUI.observeReveal();
  },

  /* ---------------- Formulario de reserva ---------------- */
  formNotice(form, title, text) {
    if (!form || form.dataset.noticeShown) return;
    form.dataset.noticeShown = '1';
    const phone = DB.tenant && DB.tenant.phone;
    form.innerHTML = '<div class="lookup-empty">' + ic('calendar') + '<strong>' + this.esc(title) + '</strong>' +
      '<span>' + this.esc(text) + '</span>' +
      (phone ? '<a class="btn btn-solid btn-sm" href="' + this.esc(TenantBrand.telHref(phone)) + '">' + ic('phone') + 'Llamar al ' + this.esc(phone) + '</a>' : '') +
      '</div>';
  },

  renderBookingForm() {
    const srvSel = document.getElementById('pb-service');
    const barSel = document.getElementById('pb-barber');
    const dateInp = document.getElementById('pb-date');
    const timeSel = document.getElementById('pb-time');
    if (!srvSel || !barSel || !dateInp || !timeSel) return;
    const form = srvSel.closest('form');

    // Negocio que no está recibiendo reservas (suspendido o suscripción vencida)
    if (DB.tenant && DB.tenant.accepting === false) {
      this.formNotice(form, 'Reservas en línea pausadas', this.Dem('business') + ' no está recibiendo reservas en línea por ahora. Llámanos o escríbenos para agendar.');
      return;
    }
    if (!DB.state.barberProfiles.length || !DB.state.services.length) {
      this.formNotice(form, 'Reservas en línea aún no disponibles', this.Dem('business') + ' todavía está configurando sus ' + this.v('servicePlural') + ' y su equipo. Escríbenos o llámanos para agendar.');
      return;
    }
    this.bindForm(form);

    const cur = DB.state.settings.currency;
    const currentSrvVal = srvSel.value;
    srvSel.innerHTML = DB.state.services.map(s =>
      '<option value="' + this.esc(s.id) + '">' + this.esc(s.name) + ' — ' + this.esc(cur) + ' ' + this.esc(s.price) +
      (s.duration ? ' · ' + this.esc(s.duration) + ' min' : '') + '</option>'
    ).join('');
    if (currentSrvVal && DB.state.services.some(s => s.id === currentSrvVal)) srvSel.value = currentSrvVal;

    const currentBarVal = barSel.value;
    barSel.innerHTML = DB.state.barberProfiles.map(b => '<option value="' + this.esc(b.id) + '">' + this.esc(b.name) + '</option>').join('');
    if (currentBarVal && DB.barberOf(currentBarVal)) barSel.value = currentBarVal;

    dateInp.min = DB.todayISO();
    this.renderExtraFields();
    this.refreshTimes();
    this.updateSubmitState();
  },

  /* ---------------- Campos propios del negocio (booking_fields) ----------------
     El negocio (desde la consola, crm_config) puede pedir datos extra al reservar:
     texto, texto largo, número, fecha, lista o casilla. Se validan aquí con las
     mismas reglas que la base (crear_reserva las repite) y se envían como "extra". */
  extraFields() { return (DB.tenant && Array.isArray(DB.tenant.bookingFields)) ? DB.tenant.bookingFields : []; },
  EXTRA_MAX: 500,

  extraFieldHTML(f) {
    const id = 'pb-x-' + f.key;
    const err = '<span class="field-error" id="' + id + '-error">' + ic('alert') + '<span class="field-error-text"></span></span>';
    const req = f.required ? '<span class="req" aria-hidden="true">*</span>' : ' <span class="opt">(opcional)</span>';
    const attrs = ' id="' + id + '" data-extra="' + this.esc(f.key) + '" aria-describedby="' + id + '-error"' + (f.required ? ' required aria-required="true"' : '');
    if (f.type === 'checkbox') {
      return '<div class="field field-wide extra-check">' +
        '<label class="check-line" for="' + id + '"><input type="checkbox"' + attrs + ' /><span>' + this.esc(f.label) + req + '</span></label>' + err + '</div>';
    }
    let ctrl;
    if (f.type === 'textarea') ctrl = '<textarea class="input" rows="3" maxlength="' + this.EXTRA_MAX + '"' + attrs + '></textarea>';
    else if (f.type === 'select') ctrl = '<select class="input"' + attrs + '><option value="">Elige una opción</option>' +
      f.options.map(o => '<option value="' + this.esc(o) + '">' + this.esc(o) + '</option>').join('') + '</select>';
    else if (f.type === 'number') ctrl = '<input type="number" class="input" inputmode="decimal" step="any"' + attrs + ' />';
    else if (f.type === 'date') ctrl = '<input type="date" class="input"' + attrs + ' />';
    else ctrl = '<input type="text" class="input" maxlength="' + this.EXTRA_MAX + '"' + attrs + ' />';
    return '<div class="field' + (f.type === 'textarea' ? ' field-wide' : '') + '">' +
      '<label class="field-lbl" for="' + id + '">' + this.esc(f.label) + req + '</label>' + ctrl + err + '</div>';
  },

  renderExtraFields() {
    const box = document.getElementById('pb-extra');
    if (!box) return;
    const fields = this.extraFields();
    const sig = fields.map(f => f.key + ':' + f.type).join('|');
    if (box.dataset.sig === sig && (sig || box.hidden)) return;   // ya pintados: se conservan los valores
    box.dataset.sig = sig;
    box.hidden = !fields.length;
    box.innerHTML = fields.map(f => this.extraFieldHTML(f)).join('');
    if (!box.dataset.bound) {
      box.dataset.bound = '1';
      const onEdit = (e) => {
        const el = e.target && e.target.closest ? e.target.closest('[data-extra]') : null;
        if (el) this.setExtraError(el, '');
        this.updateSummary();
      };
      box.addEventListener('input', onEdit);
      box.addEventListener('change', onEdit);
    }
  },

  setExtraError(el, msg) {
    const err = document.getElementById(el.id + '-error');
    if (msg) el.setAttribute('aria-invalid', 'true'); else el.removeAttribute('aria-invalid');
    if (!err) return;
    const txt = err.querySelector('.field-error-text');
    if (txt) txt.textContent = msg || '';
    err.classList.toggle('is-visible', !!msg);
  },

  // Lee y valida los campos propios → { extra, errors: [{ el, msg }] }
  readExtra() {
    const extra = {}, errors = [];
    this.extraFields().forEach(f => {
      const el = document.getElementById('pb-x-' + f.key);
      if (!el) return;
      const fail = (msg) => errors.push({ el, msg });
      if (f.type === 'checkbox') {
        if (f.required && !el.checked) return fail('Marca esta casilla para continuar.');
        extra[f.key] = !!el.checked;
        return;
      }
      if (f.type === 'number' && el.validity && el.validity.badInput) return fail('Escribe un número válido.');
      const v = String(el.value || '').trim();
      if (!v) { if (f.required) fail(f.type === 'select' ? 'Elige una opción.' : 'Completa este campo.'); return; }
      if (f.type === 'number') {
        const n = Number(v);
        if (!isFinite(n)) return fail('Escribe un número válido.');
        extra[f.key] = n;
      } else if (f.type === 'date') {
        const d = new Date(v + 'T12:00:00');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(d) || d.toISOString().slice(0, 10) !== v) return fail('Elige una fecha válida.');
        extra[f.key] = v;
      } else if (f.type === 'select') {
        if (!f.options.includes(v)) return fail('Elige una opción de la lista.');
        extra[f.key] = v;
      } else {
        if (v.length > this.EXTRA_MAX) return fail('Máximo ' + this.EXTRA_MAX + ' caracteres.');
        extra[f.key] = v;
      }
    });
    return { extra, errors };
  },

  // Filas del resumen con los campos propios que ya tienen valor
  extraSummaryHTML() {
    return this.extraFields().map(f => {
      const el = document.getElementById('pb-x-' + f.key);
      if (!el) return '';
      let val;
      if (f.type === 'checkbox') val = el.checked ? 'Sí' : '';
      else {
        val = String(el.value || '').trim();
        if (val && f.type === 'date') val = this.fmtDate(val);
        if (val.length > 80) val = val.slice(0, 77) + '…';
      }
      return val ? '<div class="booking-summary-row"><span>' + this.esc(f.label) + '</span><strong>' + this.esc(val) + '</strong></div>' : '';
    }).join('');
  },

  resetExtra() {
    this.extraFields().forEach(f => {
      const el = document.getElementById('pb-x-' + f.key);
      if (!el) return;
      if (f.type === 'checkbox') el.checked = false; else el.value = '';
      this.setExtraError(el, '');
    });
  },

  // Listeners del formulario (una sola vez) y refresco periódico de la disponibilidad
  bindForm(form) {
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    form.addEventListener('submit', (e) => this.submit(e));
    ['pb-service', 'pb-barber', 'pb-date'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => this.onSelectionChange());
    });
    const timeSel = document.getElementById('pb-time');
    if (timeSel) timeSel.addEventListener('change', () => this.updateSummary());
    const phone = document.getElementById('pb-phone');
    if (phone) {
      phone.addEventListener('input', () => this.clearPhoneError());
      phone.addEventListener('blur', () => {
        const d = this.normPhone(phone.value);
        if (/^9\d{8}$/.test(d)) phone.value = d;
      });
    }
    if (!this._timer) {
      this._timer = setInterval(() => { if (document.visibilityState !== 'hidden') this.refreshAvailability(); }, this.REFRESH_MS);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - (DB._busyAt || 0) > this.REFRESH_MS / 2) this.refreshAvailability();
      });
    }
  },

  // Cambio de servicio, profesional o fecha: se repinta al instante y se piden las horas ocupadas al servidor
  onSelectionChange() {
    this.refreshTimes();
    clearTimeout(this._busyDebounce);
    this._busyDebounce = setTimeout(() => this.refreshAvailability(), 250);
  },

  async refreshAvailability() {
    if (!document.getElementById('pb-time') || this.sending) return;
    const timeSel = document.getElementById('pb-time');
    const before = timeSel.value;
    try { await DB.refreshBusy(); } catch (e) { /* sin conexión: se mantiene la última lista */ }
    this.refreshTimes(undefined, true);
    if (before && timeSel.value !== before) {
      const note = document.getElementById('pb-date-note');
      if (note && note.hidden) { note.textContent = 'La hora ' + before + ' ya no está disponible. Elige otra.'; note.hidden = false; }
    }
  },

  selectedDuration() {
    const srvSel = document.getElementById('pb-service');
    return srvSel ? DB.serviceDuration(srvSel.value) : 0;
  },

  /* Horarios: se bloquean los días pasados, las horas que ya pasaron (o sin la
     anticipación mínima), las ocupadas y las que no alcanzan para la duración
     del servicio antes del cierre o del descanso. */
  refreshTimes(autoAdvance, keepNote) {
    const barSel = document.getElementById('pb-barber');
    const dateInp = document.getElementById('pb-date');
    const timeSel = document.getElementById('pb-time');
    if (!barSel || !dateInp || !timeSel) return;
    const note = document.getElementById('pb-date-note');
    // keepNote: refresco en segundo plano; no borra el aviso que el cliente está leyendo
    const setNote = (txt) => { if (note && (txt || !keepNote)) { note.textContent = txt || ''; note.hidden = !txt; } };

    const today = DB.todayISO();
    const barber = barSel.value;
    const who = this.barberName(barber) || this.dem('staff');
    const dur = this.selectedDuration();
    dateInp.min = today;
    dateInp.max = DB.maxBookDate();
    let msg = '';
    if (dateInp.value && dateInp.value > dateInp.max) {
      msg = 'Solo se puede reservar hasta ' + DB.tenant.schedule.maxDays + ' días adelante. Te mostramos el primer día disponible.';
      dateInp.value = '';
    }

    // Fecha vacía o pasada (escrita a mano o por un calendario antiguo) → primer día libre desde hoy
    if (!dateInp.value || DB.isPastDate(dateInp.value)) {
      if (dateInp.value) msg = 'No puedes reservar en una fecha pasada. Te mostramos el primer día disponible.';
      dateInp.value = DB.firstBookableDate(barber, dur);
    }
    // Día elegido cerrado o lleno → el siguiente día libre DESPUÉS de esa fecha
    const chosen = dateInp.value;
    if (!DB.freeSlots(chosen, barber, dur).length && (autoAdvance !== false)) {
      const next = DB.nextBookableDate(barber, dur, DB.addDays(chosen, 1)) || DB.nextBookableDate(barber, dur);
      if (next && next !== chosen) {
        const closed = !DB.slotsFor(chosen, barber).length;
        const day = chosen === today ? 'Hoy' : 'Ese día';
        msg = (closed
          ? day + ' ' + who + ' no atiende.'
          : (chosen === today ? 'Hoy ya no quedan horarios con ' : 'Ese día no quedan horarios con ') + who + '.') +
          ' Te mostramos el ' + this.fmtDate(next).toLowerCase() + '.';
        dateInp.value = next;
      }
    }

    const prev = timeSel.value;
    const date = dateInp.value;
    let firstFree = null;
    const slots = DB.slotsFor(date, barber, dur);
    if (!DB.freeSlots(date, barber, dur).length && !msg) msg = who.charAt(0).toUpperCase() + who.slice(1) + ' no tiene horarios disponibles por ahora. Prueba cambiando de ' + this.v('staff') + ' o de ' + this.v('service') + '.';
    setNote(msg);
    const labels = { past: ' · Ya pasó', soon: ' · Muy pronto', busy: ' · Ocupado' };
    timeSel.innerHTML = slots.map(t => {
      const st = DB.slotState(date, t, barber, null, dur);
      if (st === 'free' && !firstFree) firstFree = t;
      return '<option value="' + t + '"' + (st !== 'free' ? ' disabled' : '') + '>' + t + (labels[st] || '') + '</option>';
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
    if (!srvSel || !barSel) return;

    if (params.serviceId) {
      const s = DB.state.services.find(x => x.id === params.serviceId);
      if (s) srvSel.value = s.id;
    }
    // ?barber= trae el id; los enlaces antiguos traían el nombre
    const bp = params.barberName ? DB.barberOf(params.barberName) : null;
    if (bp) barSel.value = bp.id;
    this.refreshTimes();
  },

  preselectService(srvId) {
    const srvSel = document.getElementById('pb-service');
    if (srvSel) {
      const s = DB.state.services.find(x => x.id === srvId);
      if (s) {
        srvSel.value = s.id;
        this.onSelectionChange();
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
    const srvObj = DB.state.services.find(s => s.id === srvSel.value) || DB.state.services[0];
    const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };

    set('pb-sum-srv', srvObj ? srvObj.name : '—');
    set('pb-sum-bar', this.barberName(barSel.value) || '—');
    set('pb-sum-dt', this.fmtDate(dateInp.value) + (timeSel.value ? ' · ' + timeSel.value : ''));
    set('pb-sum-dur', srvObj && srvObj.duration ? srvObj.duration + ' min' : '—');
    set('pb-sum-price', srvObj ? (cur + ' ' + srvObj.price) : (cur + ' 0'));
    const sumExtra = document.getElementById('pb-sum-extra');
    if (sumExtra) sumExtra.innerHTML = this.extraSummaryHTML();
    this.renderPickers();
  },

  /* Selectores en chips ({service}, {staff} y horas). El <select> sigue siendo la
     fuente de verdad (lo llenan renderBookingForm y refreshTimes, lo lee submit);
     los chips solo lo muestran y, al pulsarlos, cambian su valor y disparan 'change'.
     Se repintan aquí porque todo cambio de selección termina en updateSummary. */
  PICKERS: [['pb-service', 'pick-chips'], ['pb-barber', 'pick-chips'], ['pb-time', 'pick-slots']],
  renderPickers() {
    const cur = DB.state.settings.currency;
    this.PICKERS.forEach(([id, cls]) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      let box = document.getElementById(id + '-pick');
      if (!box) {
        box = document.createElement('div');
        box.id = id + '-pick';
        box.className = cls;
        box.setAttribute('role', 'group');
        box.setAttribute('aria-labelledby', id + '-lbl');
        sel.classList.add('pick-native');
        sel.setAttribute('tabindex', '-1');
        sel.setAttribute('aria-hidden', 'true');
        sel.after(box);
        box.addEventListener('click', (e) => {
          const b = e.target.closest('button[data-val]');
          if (!b || b.disabled || sel.value === b.dataset.val) return;
          sel.value = b.dataset.val;
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      // Las horas ocupadas o pasadas no se ofrecen (el <select> las conserva deshabilitadas)
      const opts = [...sel.options].filter(o => o.value && !(id === 'pb-time' && o.disabled));
      if (!opts.length) {
        box.innerHTML = id === 'pb-time' ? '<p class="pick-empty">No hay horas libres este día. Prueba con otra fecha.</p>' : '';
        return;
      }
      box.innerHTML = opts.map(o => {
        const on = o.value === sel.value;
        let label = this.esc(o.textContent);
        if (id === 'pb-service') {
          const s = DB.state.services.find(x => x.id === o.value);
          if (s) label = '<span class="pick-name">' + this.esc(s.name) + '</span><span class="pick-meta">' + this.esc(cur) + ' ' + this.esc(s.price) + (s.duration ? ' · ' + this.esc(s.duration) + ' min' : '') + '</span>';
        }
        return '<button type="button" class="pick' + (on ? ' is-on' : '') + '" data-val="' + this.esc(o.value) + '" aria-pressed="' + on + '"' + (o.disabled ? ' disabled' : '') + '>' + label + '</button>';
      }).join('');
    });
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
    const form = e.currentTarget || e.target;
    const name = document.getElementById('pb-name').value.trim();
    const phoneInp = document.getElementById('pb-phone');
    const phone = this.normPhone(phoneInp.value);
    const serviceId = document.getElementById('pb-service').value;
    const barberId = document.getElementById('pb-barber').value;
    const date = document.getElementById('pb-date').value;
    const time = document.getElementById('pb-time').value;
    const notes = document.getElementById('pb-notes').value.trim();
    const waEl = document.getElementById('pb-wa');
    const waOn = !(DB.tenant && DB.tenant.waEnabled === false);
    const waOptIn = waOn && !!(waEl && waEl.checked);
    const fb = document.getElementById('pb-feedback');
    const showError = (msg) => {
      fb.innerHTML = '<div class="alert alert-error">' + ic('alert') + '<span>' + this.esc(msg) + '</span></div>';
      fb.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };

    if (DB.tenant && DB.tenant.accepting === false) { showError(this.Dem('business') + ' no está recibiendo reservas en línea por ahora.'); return; }
    if (name.length < 2) { showError('Escribe tu nombre.'); document.getElementById('pb-name').focus(); return; }
    if (name.length > 80) { showError('El nombre puede tener como máximo 80 caracteres.'); document.getElementById('pb-name').focus(); return; }
    if (!/^9\d{8}$/.test(phone)) {
      phoneInp.setAttribute('aria-invalid', 'true');
      const err = document.getElementById('pb-phone-error');
      if (err) err.classList.add('is-visible');
      else showError('El celular debe tener 9 dígitos y empezar con 9.');
      phoneInp.focus();
      return;
    }
    phoneInp.value = phone;
    this.clearPhoneError();
    if (notes.length > 300) { showError('Las notas pueden tener como máximo 300 caracteres.'); document.getElementById('pb-notes').focus(); return; }

    // Campos propios del negocio: el error se muestra debajo de cada campo
    const { extra, errors: extraErrors } = this.readExtra();
    if (extraErrors.length) {
      extraErrors.forEach(x => this.setExtraError(x.el, x.msg));
      extraErrors[0].el.focus();
      return;
    }

    const srvObj = DB.state.services.find(s => s.id === serviceId);
    const barberObj = DB.barberOf(barberId);
    if (!srvObj || !barberObj) { showError(this.vf('Elige {service} y {staff}.')); return; }

    // Validación de horario en pantalla (el servidor la repite)
    const slotError = DB.validateBooking(date, time, barberObj.id, null, Number(srvObj.duration) || 0);
    if (slotError) { showError(slotError); this.refreshTimes(); return; }

    if (this.captchaRequired && !this.captchaToken) { showError('Completa la verificación de seguridad antes de confirmar.'); return; }

    const btn = form.querySelector('button[type="submit"]');
    this.sending = true;
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    let res;
    try {
      res = await DB.reservar({ serviceId: srvObj.id, barberId: barberObj.id, date, time, name, phone, notes, waOptIn, extra, captcha: this.captchaToken || '' });
    } catch (ex) {
      // El servidor ya devuelve el motivo en español (horario ocupado, límite de citas…)
      showError((ex && ex.message) || 'No se pudo registrar la reserva. Inténtalo de nuevo.');
      try { await DB.refreshBusy(); } catch (e2) { /* sin conexión */ }
      this.refreshTimes();
      return;
    } finally {
      this.sending = false;
      if (btn) btn.classList.remove('is-busy');
      if (window.turnstile && this.captchaWidget != null) { this.captchaToken = ''; try { window.turnstile.reset(this.captchaWidget); } catch (e3) { /* sin captcha */ } }
      this.updateSubmitState();
    }

    const code = res && res.code ? String(res.code) : '';
    fb.innerHTML = '<div class="alert alert-success" role="status">' + ic('checkCircle') +
      '<div><strong style="display:block; font-size:1rem; margin-bottom:2px;">¡Reserva registrada!</strong>' +
      'Te esperamos el ' + this.esc(this.fmtDate(date).toLowerCase()) + ' a las ' + this.esc(time) + ' con ' + this.esc(barberObj.name) + '.' +
      (code
        ? '<div class="booking-code"><span class="booking-code-label">Tu código de reserva</span>' +
            '<strong class="booking-code-value" id="pb-code">' + this.esc(code) + '</strong>' +
            '<button type="button" class="booking-code-copy" data-pb-action="copy-code" data-code="' + this.esc(code) + '">' + ic('file') + '<span>Copiar código</span></button>' +
          '</div>' +
          '<span class="booking-code-hint">Guárdalo o toma una captura de esta pantalla: lo necesitas junto con tu celular para consultar tu ' + this.esc(this.v('appointment')) + '.</span>'
        : '') +
      (waOptIn ? '<span style="display:block; margin-top:4px;">Te enviaremos la confirmación por WhatsApp.</span>' : '') +
      '<div class="alert-links">' +
        '<a href="' + this.esc(this.href('consultar-cita.html')) + '">Consultar mi ' + this.esc(this.v('appointment')) + ' ' + ic('arrowRight') + '</a>' +
      '</div></div>' +
    '</div>';

    document.getElementById('pb-name').value = '';
    phoneInp.value = '';
    document.getElementById('pb-notes').value = '';
    this.resetExtra();
    if (waEl) waEl.checked = false;
    try { await DB.refreshBusy(); } catch (e4) { /* sin conexión */ }
    this.renderPublicViews();
    fb.scrollIntoView({ behavior: 'smooth', block: 'center' });
  },

  // Copiar el código de reserva (con alternativa para navegadores sin portapapeles)
  async copyCode(btn) {
    const code = btn.getAttribute('data-code') || '';
    const label = btn.querySelector('span') || btn;
    let ok = false;
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(code); ok = true; }
    } catch (e) { ok = false; }
    if (!ok) {
      const el = document.getElementById('pb-code');
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        ok = document.execCommand('copy');
      } catch (e) { ok = false; }
    }
    label.textContent = ok ? 'Copiado' : 'Mantén presionado el código para copiarlo';
    setTimeout(() => { label.textContent = 'Copiar código'; }, 2500);
  },

  /* ---------------- Consulta de cita ---------------- */
  async lookup(e) {
    if (e) e.preventDefault();
    const phoneInp = document.getElementById('pub-query-phone');
    const codeInp = document.getElementById('pub-query-code');
    const box = document.getElementById('pub-query-res');
    if (!phoneInp || !codeInp || !box) return;
    const phone = this.normPhone(phoneInp.value);
    const code = codeInp.value.trim().toUpperCase();
    if (!/^9\d{8}$/.test(phone) || code.length < 4) {
      box.innerHTML = '<div class="alert alert-error">' + ic('alert') + '<span>Escribe tu celular (9 dígitos) y el código de reserva que recibiste al reservar.</span></div>';
      (/^9\d{8}$/.test(phone) ? codeInp : phoneInp).focus();
      return;
    }
    phoneInp.value = phone;
    let matches;
    try {
      matches = await DB.consultarCita(phone, code);
    } catch (ex) {
      box.innerHTML = '<div class="alert alert-error">' + ic('alert') + '<span>' + this.esc(DB.errorText(ex)) + '</span></div>';
      return;
    }
    if (!matches.length) {
      box.innerHTML = '<div class="lookup-empty">' + ic('search') +
        '<strong>' + this.esc(this.vf('No encontramos tu {appointment} con esos datos')) + '</strong>' +
        '<span>Revisa el celular y el código, o haz una nueva reserva.</span>' +
        '<a class="btn btn-solid btn-sm" href="' + this.esc(this.href('reservar.html')) + '">Reservar ' + this.esc(this.v('appointment')) + '</a></div>';
      return;
    }
    box.innerHTML = matches.map(a =>
      '<div class="lookup-result">' +
        '<div class="lookup-date"><span>' + this.esc(DB.hhmm(a.time)) + '</span></div>' +
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
