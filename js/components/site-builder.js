/* ==========================================================================
   Editor visual de la web (constructor por bloques)
   --------------------------------------------------------------------------
   Pantalla completa con la lista de bloques a la izquierda y la web real a la
   derecha (index.html?preview=1 en un iframe del mismo sitio, en escritorio o
   celular). Los cambios se ven al instante en la vista previa y solo llegan a
   la web al pulsar "Guardar y publicar" (tenants.web_page, migración 21).

   Lo abren:
     - el superadministrador: consola → negocio → Diseñar web
       (además decide si el negocio puede editar su web: tenants.web_editor)
     - el administrador del negocio con Configuración: CRM → Configuración →
       Diseño de la web (si el superadministrador lo permite)
   La base vuelve a comprobar ambos permisos (tenants_guard).

   Seguridad: ningún texto escrito aquí se arma dentro de un onclick; los
   botones llevan data-sb y un solo listener decide. Todo texto va con esc().
   ========================================================================== */
const SiteBuilder = {
  st: null,

  esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); },
  // Palabras del rubro de ESE negocio (la consola maneja varios)
  fmt(s) { return (typeof UI !== 'undefined' && UI.vFor && this.st) ? UI.vFor(this.st.tenant, s) : String(s || ''); },
  isSA() { return !!(typeof Auth !== 'undefined' && Auth.user && Auth.user.role === 'SUPERADMIN'); },

  /* ¿Puede el usuario actual diseñar la web de este negocio? */
  canEdit(t) {
    if (!t || typeof Auth === 'undefined' || !Auth.user) return false;
    if (this.isSA()) return true;
    return Auth.user.role === 'ADMIN' && Auth.user.tenantId === t.id && t.webEditor !== false && Auth.can('settings');
  },

  open(tenant, opts) {
    const t = tenant;
    if (!t) return;
    if (!this.canEdit(t)) {
      const msg = t.webEditor === false ? 'El superadministrador desactivó la edición de la web para este negocio.' : 'No tienes permiso para diseñar la web de este negocio.';
      if (typeof UI !== 'undefined') UI.toast(msg, 'error');
      return;
    }
    if (this.st) this.close(true);
    const saved = typeof SiteBlocks !== 'undefined' ? SiteBlocks.normalize(t.webPage) : null;
    const fresh = !SiteBlocks.active(saved);
    this.st = {
      tenant: t, opts: opts || {}, saved, fresh,
      page: fresh ? SiteBlocks.template({ site: (t.crmConfig && t.crmConfig.site) || {}, solo: false }) : JSON.parse(JSON.stringify(saved)),
      editor: t.webEditor !== false,
      selected: null, view: 'list', device: 'desktop', dirty: false, saving: false, ready: false, info: null
    };
    const E = this.esc.bind(this);
    const root = document.createElement('div');
    root.className = 'sb-root';
    root.id = 'sb-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Diseñar web de ' + t.name);
    const src = Routes.web(t.slug, null, { preview: 1 });
    root.innerHTML =
      '<header class="sb-top">' +
        '<div class="sb-top-id"><span class="sb-kicker">Diseñar web</span><strong>' + E(t.name) + '</strong></div>' +
        '<div class="sb-devices" role="group" aria-label="Tamaño de la vista previa">' +
          '<button type="button" class="sb-dev is-on" data-sb="device" data-v="desktop" aria-pressed="true">' + ic('dashboard') + '<span>Escritorio</span></button>' +
          '<button type="button" class="sb-dev" data-sb="device" data-v="mobile" aria-pressed="false">' + ic('phone') + '<span>Celular</span></button>' +
        '</div>' +
        '<div class="sb-top-actions">' +
          '<span class="sb-status" id="sb-status" role="status" aria-live="polite"></span>' +
          '<a class="sb-btn sb-btn-ghost" href="' + E(Routes.web(t.slug)) + '" target="_blank" rel="noopener">' + ic('external') + '<span>Ver web</span></a>' +
          '<button type="button" class="sb-btn sb-btn-ghost" data-sb="close">' + ic('x') + '<span>Cerrar</span></button>' +
          '<button type="button" class="sb-btn sb-btn-primary" data-sb="save" id="sb-save">' + ic('check') + '<span>Guardar y publicar</span></button>' +
        '</div>' +
      '</header>' +
      '<div class="sb-body">' +
        '<aside class="sb-panel" id="sb-panel" aria-label="Bloques"></aside>' +
        '<main class="sb-stage"><div class="sb-frame" id="sb-frame-wrap" data-device="desktop">' +
          '<iframe id="sb-frame" title="Vista previa de la web" src="' + E(src) + '"></iframe>' +
          '<div class="sb-loading" id="sb-loading">Cargando la vista previa…</div>' +
        '</div></main>' +
      '</div>';
    document.body.appendChild(root);
    document.documentElement.classList.add('sb-open');

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);
    this._onMsg = (e) => this.onMessage(e);
    this._onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.crm-modal-backdrop.is-open, .crm-modal-backdrop[style*="flex"]')) this.close(); };
    this._onUnload = (e) => { if (this.st && this.st.dirty) { e.preventDefault(); e.returnValue = ''; } };
    root.addEventListener('click', this._onClick);
    root.addEventListener('input', this._onInput);
    root.addEventListener('change', this._onInput);
    window.addEventListener('message', this._onMsg);
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('beforeunload', this._onUnload);
    this.renderPanel();
    this.updateSave();
  },

  async close(force) {
    if (!this.st) return;
    if (!force && this.st.dirty) {
      const ok = await UI.confirm({ title: '¿Salir sin guardar?', message: 'Los cambios que no guardaste se perderán. La web sigue como estaba.', confirmText: 'Salir sin guardar', danger: true });
      if (!ok) return;
    }
    const root = document.getElementById('sb-root');
    if (root) root.remove();
    document.documentElement.classList.remove('sb-open');
    window.removeEventListener('message', this._onMsg);
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('beforeunload', this._onUnload);
    this.st = null;
  },

  /* ---------------- Vista previa ---------------- */
  frame() { const f = document.getElementById('sb-frame'); return f && f.contentWindow; },
  post(msg) {
    const w = this.frame();
    if (!w || !this.st || !this.st.ready) return;
    try { w.postMessage(Object.assign({ rlBuilder: true }, msg), location.origin); } catch (e) { /* vista previa cerrada */ }
  },
  pushPreview() {
    clearTimeout(this._pushT);
    this._pushT = setTimeout(() => {
      if (this.st) this.post({ cmd: 'page', page: this.st.page, selected: this.st.selected });
    }, 90);
  },
  onMessage(e) {
    if (!this.st || e.origin !== location.origin || !e.data || !e.data.rlBuilder) return;
    const w = this.frame();
    if (w && e.source !== w) return;
    if (e.data.cmd === 'ready') {
      this.st.ready = true;
      this.st.info = e.data.info || {};
      // Diseño inicial: con una sola persona, "Galería" en vez de "Equipo"
      if (this.st.fresh && !this.st.dirty && this.st.info.solo) {
        this.st.page.blocks.forEach(b => { if (b.type === 'equipo') b.type = 'galeria'; });
      }
      const ld = document.getElementById('sb-loading');
      if (ld) ld.hidden = true;
      this.post({ cmd: 'page', page: this.st.page, selected: this.st.selected });
      this.renderPanel();
    } else if (e.data.cmd === 'pick') {
      const id = String(e.data.id || '');
      if (this.block(id)) { this.st.selected = id; this.st.view = 'block'; this.renderPanel(); this.post({ cmd: 'select', id, scroll: false }); }
    }
  },

  /* ---------------- Datos ---------------- */
  block(id) { return this.st && this.st.page.blocks.find(b => b.id === id); },
  touch(structural) {
    this.st.dirty = true;
    this.updateSave();
    if (structural) this.renderPanel();
    this.pushPreview();
  },
  updateSave() {
    const b = document.getElementById('sb-save');
    if (!b || !this.st) return;
    b.disabled = this.st.saving;
    b.classList.toggle('is-dirty', this.st.dirty);
    const s = document.getElementById('sb-status');
    if (s) s.textContent = this.st.saving ? 'Guardando…' : (this.st.dirty ? 'Cambios sin publicar' : '');
  },
  status(msg) { const s = document.getElementById('sb-status'); if (s) s.textContent = msg || ''; },

  /* ---------------- Panel ---------------- */
  renderPanel() {
    const el = document.getElementById('sb-panel');
    if (!el || !this.st) return;
    const v = this.st.view;
    el.innerHTML = v === 'add' ? this.addHTML() : (v === 'block' && this.block(this.st.selected) ? this.blockFormHTML(this.block(this.st.selected)) : this.listHTML());
    if (v !== 'block' && v !== 'add') this.st.view = 'list';
    this.bindDrag();
  },

  listHTML() {
    const E = this.esc.bind(this), st = this.st, T = SiteBlocks.TYPES;
    const rows = st.page.blocks.map((b, i) => {
      const def = T[b.type];
      const name = (b.title && b.title.trim()) || this.fmt(def.def.title || '') || def.label;
      const hidden = b.show === false;
      return '<li class="sb-row' + (st.selected === b.id ? ' is-sel' : '') + (hidden ? ' is-off' : '') + '" draggable="true" data-id="' + E(b.id) + '">' +
        '<span class="sb-grip" aria-hidden="true">⋮⋮</span>' +
        '<button type="button" class="sb-row-main" data-sb="edit" data-id="' + E(b.id) + '">' +
          '<span class="sb-row-ic" aria-hidden="true">' + ic(def.icon) + '</span>' +
          '<span class="sb-row-txt"><strong>' + E(def.label) + '</strong><span>' + E(name === def.label ? def.desc : name) + '</span></span>' +
        '</button>' +
        '<span class="sb-row-tools">' +
          '<button type="button" class="sb-icon" data-sb="up" data-id="' + E(b.id) + '" aria-label="Subir ' + E(def.label) + '"' + (i === 0 ? ' disabled' : '') + '>' + ic('chevronLeft') + '</button>' +
          '<button type="button" class="sb-icon" data-sb="down" data-id="' + E(b.id) + '" aria-label="Bajar ' + E(def.label) + '"' + (i === st.page.blocks.length - 1 ? ' disabled' : '') + '>' + ic('chevronRight') + '</button>' +
          '<button type="button" class="sb-icon" data-sb="toggle" data-id="' + E(b.id) + '" aria-pressed="' + (!hidden) + '" aria-label="' + (hidden ? 'Mostrar ' : 'Ocultar ') + E(def.label) + '">' + ic(hidden ? 'lock' : 'eye') + '</button>' +
        '</span>' +
      '</li>';
    }).join('');
    const info = st.info;
    const notes = [];
    if (st.fresh) notes.push('Este es tu Inicio actual convertido en bloques. La web no cambia hasta que pulses <strong>Guardar y publicar</strong>.');
    if (info && !info.services) notes.push('Aún no hay ' + E(this.fmt('{servicePlural}')) + ' activos en el CRM: el bloque de ' + E(this.fmt('{servicePlural}')) + ' mostrará un aviso.');
    if (info && !info.contact) notes.push('Para el bloque de contacto, completa dirección, teléfono u horario en CRM → Configuración.');
    return '<div class="sb-pad">' +
      '<h2 class="sb-h">Bloques del Inicio</h2>' +
      '<p class="sb-hint">Toca un bloque para editarlo, o tócalo en la vista previa. Arrástralos o usa las flechas para ordenarlos. ' +
        E(this.fmt('Los {servicePlural}, el equipo, las fotos y los datos de contacto salen del CRM: si los cambias allí, la web se actualiza sola.')) + '</p>' +
      notes.map(n => '<p class="sb-note">' + n + '</p>').join('') +
      '<ol class="sb-list" id="sb-list">' + rows + '</ol>' +
      (st.page.blocks.length < SiteBlocks.MAX_BLOCKS ? '<button type="button" class="sb-btn sb-btn-add" data-sb="add">' + ic('plus') + '<span>Agregar bloque</span></button>' : '') +
      '<div class="sb-foot">' +
        (this.isSA() ? '<label class="sb-check"><input type="checkbox" data-sb-editor ' + (st.editor ? 'checked' : '') + ' /><span>El negocio puede diseñar su web desde su CRM</span></label>' : '') +
        (SiteBlocks.active(st.saved) ? '<button type="button" class="sb-link-danger" data-sb="reset">' + ic('refresh') + 'Volver al diseño de siempre</button>' : '') +
      '</div>' +
    '</div>';
  },

  addHTML() {
    const E = this.esc.bind(this), T = SiteBlocks.TYPES;
    const hasHero = this.st.page.blocks.some(b => b.type === 'portada');
    return '<div class="sb-pad">' +
      '<button type="button" class="sb-back" data-sb="back">' + ic('arrowLeft') + 'Bloques</button>' +
      '<h2 class="sb-h">Agregar bloque</h2>' +
      '<div class="sb-types">' + SiteBlocks.ORDER.map(k => {
        const off = k === 'portada' && hasHero;
        return '<button type="button" class="sb-type" data-sb="insert" data-type="' + k + '"' + (off ? ' disabled title="Ya tienes una portada"' : '') + '>' +
          '<span class="sb-row-ic" aria-hidden="true">' + ic(T[k].icon) + '</span><strong>' + E(T[k].label) + '</strong><span>' + E(this.fmt(T[k].desc)) + '</span></button>';
      }).join('') + '</div></div>';
  },

  seg(name, opts, cur) {
    const E = this.esc.bind(this);
    return '<div class="sb-seg" role="radiogroup">' + opts.map(([k, l]) =>
      '<label class="sb-seg-opt' + (k === cur ? ' is-on' : '') + '"><input type="radio" name="sb-' + name + '" value="' + E(k) + '" data-sb-field="' + name + '"' + (k === cur ? ' checked' : '') + ' /><span>' + E(l) + '</span></label>').join('') + '</div>';
  },

  blockFormHTML(b) {
    const E = this.esc.bind(this), T = SiteBlocks.TYPES[b.type], M = SiteBlocks.MAX;
    const def = (k) => this.fmt(T.def[k] || '');
    const f = [];
    const field = (k, label, opts) => {
      const o = opts || {};
      const val = b[k] == null ? '' : b[k];
      const ph = o.ph != null ? o.ph : def(k);
      const id = 'sb-f-' + k;
      const input = o.area
        ? '<textarea id="' + id + '" class="sb-input" rows="' + (o.rows || 3) + '" maxlength="' + M[k] + '" data-sb-field="' + k + '" placeholder="' + E(ph) + '">' + E(val) + '</textarea>'
        : '<input id="' + id + '" class="sb-input" type="text" maxlength="' + M[k] + '" data-sb-field="' + k + '" value="' + E(val) + '" placeholder="' + E(ph) + '" />';
      return '<div class="sb-field"><label class="sb-lbl" for="' + id + '">' + E(label) + '</label>' + input + (o.hint ? '<p class="sb-hint">' + E(o.hint) + '</p>' : '') + '</div>';
    };
    const btnField = (k, label, dest) => {
      const on = b[k] !== '';
      const id = 'sb-f-' + k;
      return '<div class="sb-field"><label class="sb-check"><input type="checkbox" data-sb-btn="' + k + '"' + (on ? ' checked' : '') + ' /><span>' + E(label) + '</span></label>' +
        (on ? '<input id="' + id + '" class="sb-input" type="text" maxlength="' + M[k] + '" data-sb-field="' + k + '" value="' + E(b[k] || '') + '" placeholder="' + E(def(k)) + '" aria-label="Texto del botón" />' +
          '<p class="sb-hint">Lleva a ' + E(dest) + '.</p>' : '') + '</div>';
    };

    f.push('<div class="sb-field"><span class="sb-lbl">Estilo</span>' + this.seg('style', T.styles, b.style || T.styles[0][0]) + '</div>');
    const heroPhotoBg = b.type === 'portada' && (b.style || 'foto-fondo') === 'foto-fondo' && b.image;
    if (!heroPhotoBg) f.push('<div class="sb-field"><span class="sb-lbl">Fondo</span>' + this.seg('bg', SiteBlocks.BGS, b.bg || (b.type === 'reservar' ? 'marca' : 'normal')) + '</div>');

    if (T.fields.includes('eyebrow')) f.push(field('eyebrow', 'Texto pequeño sobre el título'));
    if (T.fields.includes('title')) f.push(field('title', 'Título', b.type === 'portada' ? { ph: this.st.tenant.name } : null));
    if (T.fields.includes('text')) f.push(field('text', b.type === 'texto' ? 'Texto' : 'Descripción', { area: true, rows: b.type === 'texto' ? 7 : 3, hint: b.type === 'texto' ? 'Deja una línea en blanco para separar párrafos.' : '' }));

    if (T.fields.includes('image') && !(b.type === 'texto' && b.style === 'solo-texto') && !(b.type === 'portada' && b.style === 'centrado')) {
      f.push('<div class="sb-field"><span class="sb-lbl">Foto</span>' +
        (b.image ? '<div class="sb-img"><img src="' + E(b.image) + '" alt="" /></div>' : '<p class="sb-hint">' + (b.type === 'portada' ? 'Sin foto se usa el color o la ilustración del negocio.' : 'Sin foto, el texto ocupa todo el ancho.') + '</p>') +
        '<div class="sb-img-actions">' +
          '<label class="sb-btn sb-btn-ghost sb-file">' + ic('upload') + '<span>' + (b.image ? 'Cambiar foto' : 'Subir foto') + '</span><input type="file" accept="image/png,image/jpeg,image/webp" data-sb-upload class="sr-only" /></label>' +
          (b.image ? '<button type="button" class="sb-btn sb-btn-ghost" data-sb="noimg">' + ic('trash') + '<span>Quitar</span></button>' : '') +
        '</div><p class="sb-hint">JPG, PNG o WebP. Se ajusta sola al tamaño de la web.</p></div>');
    }

    if (T.fields.includes('cat')) {
      const cats = (this.st.info && this.st.info.categories) || [];
      const cur = b.cat || '';
      const list = cur && !cats.includes(cur) ? cats.concat([cur]) : cats;
      f.push('<div class="sb-field"><label class="sb-lbl" for="sb-f-cat">Qué ' + E(this.fmt('{servicePlural}')) + ' mostrar</label>' +
        '<select id="sb-f-cat" class="sb-input" data-sb-field="cat"><option value="">Todos</option>' +
        list.map(c => '<option value="' + E(c) + '"' + (c === cur ? ' selected' : '') + '>Solo la categoría ' + E(c) + '</option>').join('') + '</select>' +
        (cats.length ? '' : '<p class="sb-hint">Las categorías se ponen en CRM → ' + E(this.fmt('{ServicePlural}')) + '.</p>') + '</div>');
    }
    if (T.fields.includes('limit')) {
      const cur = b.limit || T.def.limit;
      f.push('<div class="sb-field"><label class="sb-lbl" for="sb-f-limit">Cuántos mostrar como máximo</label>' +
        '<select id="sb-f-limit" class="sb-input" data-sb-field="limit">' + [1, 2, 3, 4, 5, 6, 8, 9, 10, 12, 16, 24].map(n => '<option value="' + n + '"' + (n === cur ? ' selected' : '') + '>' + n + '</option>').join('') + '</select></div>');
    }
    if (T.fields.includes('items')) f.push(this.itemsHTML(b));
    if (T.fields.includes('map')) f.push('<div class="sb-field"><label class="sb-check"><input type="checkbox" data-sb-map' + (b.map !== false ? ' checked' : '') + ' /><span>Botón "Cómo llegar" (abre Google Maps con la dirección)</span></label></div>');
    if (b.type === 'contacto') f.push('<p class="sb-hint">La dirección, el teléfono y el horario se cambian en CRM → Configuración.</p>');

    const dest = { portada: 'Reservar', servicios: 'la página de ' + this.fmt('{servicePlural}'), equipo: 'la página del equipo', galeria: 'la galería', reservar: 'Reservar', texto: 'Reservar' }[b.type];
    if (T.fields.includes('btn')) f.push(btnField('btn', b.type === 'servicios' || b.type === 'equipo' || b.type === 'galeria' ? 'Mostrar el botón "Ver todos"' : 'Mostrar botón principal', dest || 'Reservar'));
    if (T.fields.includes('btn2')) f.push(btnField('btn2', 'Mostrar segundo botón', b.type === 'portada' ? 'la página de ' + this.fmt('{servicePlural}') : 'Mi ' + this.fmt('{appointment}')));

    return '<div class="sb-pad">' +
      '<button type="button" class="sb-back" data-sb="back">' + ic('arrowLeft') + 'Bloques</button>' +
      '<h2 class="sb-h"><span class="sb-row-ic" aria-hidden="true">' + ic(T.icon) + '</span>' + E(T.label) + '</h2>' +
      '<p class="sb-hint">' + E(this.fmt(T.desc)) + ' Los campos vacíos usan el texto sugerido (en gris).</p>' +
      f.join('') +
      '<div class="sb-block-actions">' +
        '<button type="button" class="sb-btn sb-btn-ghost" data-sb="toggle" data-id="' + E(b.id) + '">' + ic(b.show === false ? 'eye' : 'lock') + '<span>' + (b.show === false ? 'Mostrar en la web' : 'Ocultar en la web') + '</span></button>' +
        (b.type !== 'portada' && this.st.page.blocks.length < SiteBlocks.MAX_BLOCKS ? '<button type="button" class="sb-btn sb-btn-ghost" data-sb="dup" data-id="' + E(b.id) + '">' + ic('plus') + '<span>Duplicar</span></button>' : '') +
        '<button type="button" class="sb-btn sb-btn-danger" data-sb="del" data-id="' + E(b.id) + '">' + ic('trash') + '<span>Eliminar</span></button>' +
      '</div>' +
    '</div>';
  },

  itemsHTML(b) {
    const E = this.esc.bind(this), M = SiteBlocks.MAX;
    const items = Array.isArray(b.items) && b.items.length ? b.items : null;
    if (!items) {
      return '<div class="sb-field"><span class="sb-lbl">Puntos</span><p class="sb-hint">Se muestran los puntos sugeridos (atención con cita, precios claros, reserva en un minuto y WhatsApp).</p>' +
        '<button type="button" class="sb-btn sb-btn-ghost" data-sb="items-custom">' + ic('edit') + '<span>Escribir mis propios puntos</span></button></div>';
    }
    return '<div class="sb-field"><span class="sb-lbl">Puntos (hasta 6)</span><ol class="sb-items">' + items.map((it, i) =>
      '<li class="sb-item">' +
        '<div class="sb-item-row"><select class="sb-input sb-item-ic" data-sb-item="' + i + '" data-k="icon" aria-label="Ícono del punto ' + (i + 1) + '">' +
          SiteBlocks.ICON_CHOICES.map(n => '<option value="' + n + '"' + (n === (it.icon || 'checkCircle') ? ' selected' : '') + '>' + E(this.ICON_NAMES[n] || n) + '</option>').join('') + '</select>' +
          '<button type="button" class="sb-icon" data-sb="item-del" data-i="' + i + '" aria-label="Quitar punto ' + (i + 1) + '">' + ic('trash') + '</button></div>' +
        '<input class="sb-input" type="text" maxlength="' + M.itemTitle + '" data-sb-item="' + i + '" data-k="title" value="' + E(it.title || '') + '" placeholder="Título" aria-label="Título del punto ' + (i + 1) + '" />' +
        '<textarea class="sb-input" rows="2" maxlength="' + M.itemText + '" data-sb-item="' + i + '" data-k="text" placeholder="Texto" aria-label="Texto del punto ' + (i + 1) + '">' + E(it.text || '') + '</textarea>' +
      '</li>').join('') + '</ol>' +
      (items.length < 6 ? '<button type="button" class="sb-btn sb-btn-ghost" data-sb="item-add">' + ic('plus') + '<span>Agregar punto</span></button>' : '') + '</div>';
  },
  ICON_NAMES: { clock: 'Reloj', tag: 'Precio', calendar: 'Calendario', whatsapp: 'WhatsApp', checkCircle: 'Visto bueno', star: 'Estrella', sparkles: 'Brillo', user: 'Persona', users: 'Equipo', shield: 'Escudo', zap: 'Rayo', pin: 'Ubicación', phone: 'Teléfono', search: 'Lupa', image: 'Imagen', camera: 'Cámara', scissors: 'Tijeras', droplet: 'Gota', sun: 'Sol', store: 'Local' },

  /* ---------------- Eventos ---------------- */
  onClick(e) {
    const btn = e.target.closest('[data-sb]');
    if (!btn || !this.st || btn.disabled) return;
    const act = btn.getAttribute('data-sb'), id = btn.getAttribute('data-id');
    const st = this.st, list = st.page.blocks;
    const idx = id ? list.findIndex(b => b.id === id) : -1;
    switch (act) {
      case 'close': this.close(); break;
      case 'save': this.save(); break;
      case 'device': {
        st.device = btn.getAttribute('data-v') === 'mobile' ? 'mobile' : 'desktop';
        document.getElementById('sb-frame-wrap').setAttribute('data-device', st.device);
        document.querySelectorAll('#sb-root .sb-dev').forEach(b => { const on = b.getAttribute('data-v') === st.device; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on); });
        break;
      }
      case 'edit': st.selected = id; st.view = 'block'; this.renderPanel(); this.post({ cmd: 'select', id }); break;
      case 'back': st.view = 'list'; this.renderPanel(); break;
      case 'add': st.view = 'add'; this.renderPanel(); break;
      case 'insert': {
        const type = btn.getAttribute('data-type');
        const b = SiteBlocks.create(type);
        // La portada va arriba; lo demás, después del bloque elegido (o al final)
        const sel = list.findIndex(x => x.id === st.selected);
        const at = type === 'portada' ? 0 : (sel >= 0 ? sel + 1 : list.length);
        list.splice(at, 0, b);
        st.selected = b.id; st.view = 'block';
        this.touch(true);
        setTimeout(() => this.post({ cmd: 'select', id: b.id }), 250);
        break;
      }
      case 'up': case 'down': {
        const to = act === 'up' ? idx - 1 : idx + 1;
        if (idx < 0 || to < 0 || to >= list.length) break;
        list.splice(to, 0, list.splice(idx, 1)[0]);
        st.selected = id;
        this.touch(true);
        setTimeout(() => this.post({ cmd: 'select', id }), 150);
        break;
      }
      case 'toggle': if (idx >= 0) { if (list[idx].show === false) delete list[idx].show; else list[idx].show = false; this.touch(true); } break;
      case 'dup': if (idx >= 0) {
        const copy = JSON.parse(JSON.stringify(list[idx]));
        copy.id = SiteBlocks.newId();
        list.splice(idx + 1, 0, copy);
        st.selected = copy.id;
        this.touch(true);
      } break;
      case 'del': if (idx >= 0) this.remove(idx); break;
      case 'noimg': { const b = this.block(st.selected); if (b) { delete b.image; this.touch(true); } break; }
      case 'items-custom': { const b = this.block(st.selected); if (b) { b.items = SiteBlocks.DEFAULT_ITEMS(!st.info || st.info.waEnabled).map(x => Object.assign({}, x, { text: this.fmt(x.text), title: this.fmt(x.title) })); this.touch(true); } break; }
      case 'item-add': { const b = this.block(st.selected); if (b && b.items && b.items.length < 6) { b.items.push({ icon: 'star', title: '', text: '' }); this.touch(true); } break; }
      case 'item-del': { const b = this.block(st.selected); if (b && b.items) { b.items.splice(Number(btn.getAttribute('data-i')), 1); if (!b.items.length) delete b.items; this.touch(true); } break; }
      case 'reset': this.resetDesign(); break;
    }
  },

  async remove(idx) {
    const b = this.st.page.blocks[idx];
    const ok = await UI.confirm({ title: '¿Eliminar el bloque ' + SiteBlocks.TYPES[b.type].label + '?', message: 'Se quita del diseño. Los datos del CRM no se tocan. Si te arrepientes, cierra sin guardar.', confirmText: 'Eliminar', danger: true });
    if (!ok || !this.st) return;
    this.st.page.blocks.splice(idx, 1);
    this.st.selected = null; this.st.view = 'list';
    this.touch(true);
  },

  onInput(e) {
    const el = e.target;
    if (!this.st) return;
    const b = this.block(this.st.selected);
    if (el.hasAttribute('data-sb-editor')) { this.st.editor = el.checked; this.st.dirty = true; this.updateSave(); return; }
    if (el.hasAttribute('data-sb-upload')) { if (e.type === 'change') this.upload(el); return; }
    if (!b) return;
    if (el.hasAttribute('data-sb-field')) {
      const k = el.getAttribute('data-sb-field');
      if (el.type === 'radio') {
        if (!el.checked) return;
        b[k] = el.value;
        this.touch(true);           // cambia qué campos se ven (p. ej. foto)
        return;
      }
      if (k === 'limit') b.limit = parseInt(el.value, 10) || undefined;
      else if (k === 'cat') { if (el.value) b.cat = el.value; else delete b.cat; }
      else if (el.value === '' && k !== 'btn' && k !== 'btn2') delete b[k];
      else if (k === 'btn' || k === 'btn2') { if (el.value.trim()) b[k] = el.value; else delete b[k]; }
      else b[k] = el.value;
      this.touch(false);
      return;
    }
    if (el.hasAttribute('data-sb-btn')) {
      const k = el.getAttribute('data-sb-btn');
      if (el.checked) delete b[k]; else b[k] = '';
      this.touch(true);
      return;
    }
    if (el.hasAttribute('data-sb-map')) { if (el.checked) delete b.map; else b.map = false; this.touch(false); return; }
    if (el.hasAttribute('data-sb-item')) {
      const i = Number(el.getAttribute('data-sb-item')), k = el.getAttribute('data-k');
      if (b.items && b.items[i]) { b.items[i][k] = el.value; this.touch(false); }
    }
  },

  /* Arrastrar para ordenar (escritorio). Las flechas hacen lo mismo con teclado o táctil. */
  bindDrag() {
    const panel = document.getElementById('sb-panel');
    if (!panel || panel._sbDrag) return;
    panel._sbDrag = true;
    let dragId = null;
    panel.addEventListener('dragstart', (e) => {
      const li = e.target.closest('.sb-row');
      if (!li) return;
      dragId = li.getAttribute('data-id');
      li.classList.add('is-drag');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', dragId); } catch (x) { /* navegador antiguo */ }
    });
    panel.addEventListener('dragover', (e) => {
      const li = e.target.closest('.sb-row');
      if (!dragId || !li) return;
      e.preventDefault();
      panel.querySelectorAll('.sb-row').forEach(r => r.classList.remove('drop-before', 'drop-after'));
      const r = li.getBoundingClientRect();
      li.classList.add(e.clientY < r.top + r.height / 2 ? 'drop-before' : 'drop-after');
    });
    panel.addEventListener('drop', (e) => {
      const li = e.target.closest('.sb-row');
      if (!dragId || !li || !this.st) return;
      e.preventDefault();
      const list = this.st.page.blocks;
      const from = list.findIndex(b => b.id === dragId);
      const r = li.getBoundingClientRect();
      const before = e.clientY < r.top + r.height / 2;
      const moved = list.splice(from, 1)[0];
      let to = list.findIndex(b => b.id === li.getAttribute('data-id'));
      if (to < 0) { list.splice(from, 0, moved); return; }
      if (!before) to++;
      list.splice(to, 0, moved);
      dragId = null;
      this.touch(true);
    });
    panel.addEventListener('dragend', () => {
      dragId = null;
      panel.querySelectorAll('.sb-row').forEach(r => r.classList.remove('is-drag', 'drop-before', 'drop-after'));
    });
  },

  async upload(input) {
    const file = input.files && input.files[0];
    const b = this.block(this.st.selected);
    if (!file || !b) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 12 * 1024 * 1024) { UI.toast('Usa una foto JPG, PNG o WebP de hasta 12 MB.', 'error'); return; }
    this.status('Subiendo foto…');
    try {
      const big = b.type === 'portada';
      const dataUrl = await readAndCompressImage(file, big ? 1920 : 1280, 0.84);
      const url = await DB.uploadImage(dataUrl, this.st.tenant.id);
      if (!SiteBlocks.IMG_RE.test(url || '') || url.length > 1000) throw new Error('El enlace de la foto no es válido.');
      if (!this.st) return;
      b.image = url;
      this.touch(true);
      this.status('Foto lista. Recuerda guardar.');
    } catch (err) {
      this.status('');
      UI.toast(DB.errorText ? DB.errorText(err) : String(err.message || err), 'error');
    }
  },

  /* ---------------- Guardar ---------------- */
  errMsg(error) {
    const m = String((error && (error.message || error.details)) || error || '');
    if (/web_page|web_editor/.test(m) && /column|columna|schema cache/i.test(m)) return 'Falta aplicar la migración 21 en Supabase (constructor de la web). Pídele al superadministrador que la ejecute.';
    if (/42501|permiso|solo el superadministrador|El diseño de la web/i.test(m)) return m || 'No tienes permiso para guardar el diseño.';
    return typeof DB !== 'undefined' && DB.errorText ? DB.errorText(error) : m;
  },

  async write(patch) {
    const t = this.st.tenant;
    const { data, error } = await DB.client().from('tenants').update(patch).eq('id', t.id).select('id');
    if (error) throw error;
    if (!data || !data.length) throw new Error('No tienes permiso para guardar el diseño de este negocio.');
  },

  async save() {
    const st = this.st;
    if (!st || st.saving) return;
    const page = SiteBlocks.normalize(st.page) || { blocks: [] };
    if (!page.blocks.some(b => b.show !== false)) { UI.toast('Deja al menos un bloque visible, o usa "Volver al diseño de siempre".', 'error'); return; }
    st.saving = true; this.updateSave();
    try {
      const patch = { web_page: page };
      if (this.isSA() && st.editor !== (st.tenant.webEditor !== false)) patch.web_editor = st.editor;
      await this.write(patch);
      st.tenant.webPage = page;
      st.tenant.hasWebPage = true;
      if ('web_editor' in patch) st.tenant.webEditor = patch.web_editor;
      st.saved = JSON.parse(JSON.stringify(page));
      st.page = JSON.parse(JSON.stringify(page));
      st.fresh = false; st.dirty = false;
      this.renderPanel();
      UI.toast('Diseño publicado. Ya se ve en la web.');
      if (st.opts.onSaved) st.opts.onSaved(st.tenant);
    } catch (err) {
      UI.toast(this.errMsg(err), 'error');
    } finally {
      if (this.st) { this.st.saving = false; this.updateSave(); }
    }
  },

  async resetDesign() {
    const ok = await UI.confirm({ title: '¿Volver al diseño de siempre?', message: 'La web vuelve a mostrar el Inicio de siempre y se borra este diseño por bloques. Los datos del CRM no se tocan.', confirmText: 'Volver al de siempre', danger: true });
    if (!ok || !this.st) return;
    const st = this.st;
    st.saving = true; this.updateSave();
    try {
      await this.write({ web_page: null });
      st.tenant.webPage = null;
      UI.toast('Listo: la web volvió al diseño de siempre.');
      if (st.opts.onSaved) st.opts.onSaved(st.tenant);
      this.close(true);
    } catch (err) {
      UI.toast(this.errMsg(err), 'error');
      if (this.st) { this.st.saving = false; this.updateSave(); }
    }
  }
};
