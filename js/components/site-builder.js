/* ==========================================================================
   Editor visual de la web (constructor por bloques)
   --------------------------------------------------------------------------
   Pantalla completa con la lista de bloques a la izquierda y la web real a la
   derecha (index.html?preview=1 en un iframe del mismo sitio, en escritorio o
   celular). Los cambios se ven al instante en la vista previa y solo llegan a
   la web al pulsar "Guardar y publicar" (tenants.web_page, migración 21).
   Desde la migración 22 también: letra y colores de toda la web (page.theme),
   color de fondo por bloque, bloques de Video y Fotos, y video de fondo en la
   portada. Fotos y videos se suben al bucket "media" de Supabase.
   Desde la 23: formato de cada texto (botón "Formato" junto a cada campo:
   letra, tamaño, grosor, cursiva, alineación, color y color del botón).
   Desde la 24: quitar cualquier texto del bloque ("" = no se muestra) y
   agregar cuadros de texto extra (b.extras) con su propio formato.

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
      selected: null, fmtOpen: null, view: 'list', device: 'desktop', dirty: false, saving: false, ready: false, info: null
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
    if (this.st.img && this.st.img.url) URL.revokeObjectURL(this.st.img.url);
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
      if (this.block(id) && (this.st.selected !== id || this.st.view !== 'block')) {
        if (this.st.selected !== id) this.st.fmtOpen = null;
        this.st.selected = id; this.st.view = 'block'; this.renderPanel(); this.post({ cmd: 'select', id, scroll: false });
      }
    } else if (e.data.cmd === 'act') {
      this.fromPreview(String(e.data.act || ''), String(e.data.id || ''), String(e.data.x || ''));
    } else if (e.data.cmd === 'xpos') {
      this.placeExtra(String(e.data.id || ''), String(e.data.x || ''), e.data.pos, !!e.data.mobile);
    } else if (e.data.cmd === 'move') {
      this.moveBlock(String(e.data.id || ''), String(e.data.target || ''), !!e.data.after);
    } else if (e.data.cmd === 'text' || e.data.cmd === 'textdone') {
      this.applyText(String(e.data.key || ''), String(e.data.value == null ? '' : e.data.value), e.data.cmd === 'textdone');
    } else if (e.data.cmd === 'fmtset') {
      this.applyFmtFromPreview(String(e.data.key || ''), String(e.data.k || ''), String(e.data.v == null ? '' : e.data.v));
    } else if (e.data.cmd === 'fmtmore') {
      const r = this.edTarget(String(e.data.key || ''));
      if (r) { this.st.selected = r.b.id; this.st.view = 'block'; this.st.fmtOpen = r.fslot; this.renderPanel(); this.scrollPanelTo('[data-slot="' + r.fslot + '"]'); }
    }
  },

  /* ---------------- Edición sobre la página (lo que llega de la vista previa) ---------------- */
  // Acciones de la barra del bloque y del "+": las mismas que los botones del panel
  fromPreview(act, id, xid) {
    if (!['up', 'down', 'dup', 'toggle', 'del', 'addafter', 'xadd', 'xdel'].includes(act) || !this.block(id)) return;
    if (act === 'xadd') { this.addFreeText(id); return; }
    if (act === 'xdel') {
      const b = this.block(id), i = (b.extras || []).findIndex(x => x.id === xid);
      if (i < 0) return;
      b.extras.splice(i, 1);
      if (!b.extras.length) delete b.extras;
      this.st.selected = id; this.st.view = 'block';
      this.touch(true);
      return;
    }
    if (act === 'addafter') {
      this.st.selected = id; this.st.view = 'add'; this.renderPanel();
      const p = document.getElementById('sb-panel'); if (p) { p.scrollTop = 0; const f = p.querySelector('.sb-type'); if (f) f.focus(); }
      return;
    }
    const el = document.createElement('button');
    el.setAttribute('data-sb', act);
    el.setAttribute('data-id', id);
    this.onClick({ target: el });
    if (act === 'dup' || act === 'toggle') setTimeout(() => this.st && this.post({ cmd: 'select', id: this.st.selected, scroll: false }), 150);
  },
  /* Cuadros de texto en posición libre (migración 28) */
  // Nuevo cuadro arriba a la izquierda del bloque, listo para escribir y arrastrar
  addFreeText(id) {
    const b = this.block(id);
    if (!b || (b.extras || []).length >= SiteBlocks.MAX_EXTRAS) return;
    const n = (b.extras || []).filter(x => x.pos).length;
    const pos = { x: Math.min(60, 8 + n * 6), y: Math.min(70, 12 + n * 8), w: 36 };
    b.extras = (b.extras || []).concat([{ id: SiteBlocks.newId(), kind: 'subtitulo', text: 'Tu texto aquí', pos }]);
    this.st.selected = id; this.st.view = 'block';
    this.touch(true);
    setTimeout(() => this.st && this.post({ cmd: 'select', id, scroll: false }), 150);
  },
  // Lo que se soltó en la vista previa: posición de computadora o de celular
  placeExtra(id, xid, pos, mobile) {
    const b = this.block(id), x = b && (b.extras || []).find(e => e.id === xid);
    const p = SiteBlocks.normPos(pos);
    if (!x || !p) return;
    if (mobile && x.pos) x.mpos = p;
    else x.pos = p;
    this.st.selected = id;
    this.touch(this.st.view === 'block');
    setTimeout(() => this.st && this.post({ cmd: 'select', id, scroll: false }), 150);
  },
  moveBlock(id, target, after) {
    const list = this.st.page.blocks;
    const from = list.findIndex(b => b.id === id);
    if (from < 0 || id === target || list.findIndex(b => b.id === target) < 0) return;
    const [b] = list.splice(from, 1);
    const to = list.findIndex(x => x.id === target) + (after ? 1 : 0);
    list.splice(to, 0, b);
    this.st.selected = id;
    this.touch(true);
    setTimeout(() => this.st && this.post({ cmd: 'select', id, scroll: false }), 150);
  },
  // "<bloque>|<campo>" → { b, slot, fslot }
  edTarget(key) {
    const i = key.indexOf('|');
    if (i < 1) return null;
    const b = this.block(key.slice(0, i)), slot = key.slice(i + 1);
    if (!b) return null;
    const m = /^item:(\d+):(title|text)$/.exec(slot);
    if (m) return { b, slot, item: Number(m[1]), k: m[2], fslot: m[2] === 'title' ? 'itemTitle' : 'itemText' };
    if (/^x:/.test(slot)) return this.extraOf(b, slot) ? { b, slot, fslot: slot } : null;
    if (!['eyebrow', 'title', 'text', 'btn', 'btn2'].includes(slot)) return null;
    return { b, slot, fslot: slot };
  },
  applyText(key, value, done) {
    const r = this.edTarget(key);
    if (!r) return;
    const { b, slot } = r, M = SiteBlocks.MAX;
    let field = null;
    if (r.item != null) {
      // Ventajas sin personalizar: se copian las de siempre (las que se ven) para editarlas
      if (!Array.isArray(b.items) || !b.items.length) {
        const wa = !this.st.info || this.st.info.waEnabled;
        b.items = SiteBlocks.DEFAULT_ITEMS(wa).slice(0, 4).map(x => Object.assign({}, x, { title: this.fmt(x.title), text: this.fmt(x.text) }));
      }
      const it = b.items[r.item];
      if (!it) return;
      it[r.k] = value.slice(0, r.k === 'title' ? M.itemTitle : M.itemText);
      field = '[data-sb-item="' + r.item + '"][data-k="' + r.k + '"]';
    } else if (/^x:/.test(slot)) {
      const x = this.extraOf(b, slot);
      x.text = value.slice(0, M.text);
      field = '[data-sb-extra="' + (b.extras || []).indexOf(x) + '"][data-k="text"]';
    } else {
      b[slot] = value.slice(0, M[slot]);
      field = '[data-sb-field="' + slot + '"]';
    }
    this.st.dirty = true;
    this.updateSave();
    // El panel muestra el mismo texto (sin redibujarlo, para no perder nada)
    const panel = document.getElementById('sb-panel');
    const inp = panel && this.st.selected === b.id && panel.querySelector(field);
    if (inp && document.activeElement !== inp) inp.value = r.item != null ? b.items[r.item][r.k] : (/^x:/.test(slot) ? this.extraOf(b, slot).text : b[slot]);
    // Al terminar con el texto vacío se redibuja (ese texto queda quitado, como en el panel)
    if (done && !value.trim()) this.touch(true);
  },
  applyFmtFromPreview(key, k, v) {
    const r = this.edTarget(key);
    if (!r || !['bold', 'italic', 'size', 'align', 'color'].includes(k)) return;
    this.setFmt(r.b, r.fslot, k, v);
    this.st.dirty = true;
    this.updateSave();
    if (this.st.selected === r.b.id && this.st.view === 'block') this.renderPanel();
    this.post({ cmd: 'fmtapply', key, fmt: this.fmtGet(r.b, r.fslot) });
  },
  scrollPanelTo(sel) {
    const p = document.getElementById('sb-panel');
    const el = p && p.querySelector(sel);
    if (el) { el.scrollIntoView({ block: 'center' }); if (el.focus) el.focus(); }
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
    el.innerHTML = v === 'add' ? this.addHTML() : v === 'theme' ? this.themeHTML() : v === 'img' ? this.imgHTML()
      : (v === 'block' && this.block(this.st.selected) ? this.blockFormHTML(this.block(this.st.selected)) : this.listHTML());
    if (v !== 'block' && v !== 'add' && v !== 'theme' && v !== 'img') this.st.view = 'list';
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
      '<p class="sb-hint">Escribe directamente sobre la página: haz clic en cualquier texto para cambiarlo y en un bloque para moverlo, duplicarlo u ocultarlo. Con el <strong>+</strong> entre bloques agregas uno nuevo. ' +
        E(this.fmt('Los {servicePlural}, el equipo, las fotos y los datos de contacto salen del CRM: si los cambias allí, la web se actualiza sola.')) + '</p>' +
      notes.map(n => '<p class="sb-note">' + n + '</p>').join('') +
      '<button type="button" class="sb-type sb-theme-btn" data-sb="theme">' +
        '<span class="sb-row-ic" aria-hidden="true">' + ic('sliders') + '</span><strong>Letra y colores</strong>' +
        '<span>' + E(this.themeSummary()) + '</span></button>' +
      '<button type="button" class="sb-type sb-theme-btn sb-img-btn" data-sb="img">' +
        '<span class="sb-row-ic" aria-hidden="true">' + ic('image') + '</span><strong>Copiar colores de una imagen</strong>' +
        '<span>Sube la captura de una web y se copian sus colores y fondos, sin costo.</span></button>' +
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
      const fk = SiteBlocks.FMT_SLOTS[k] ? k : null;
      const removable = ['eyebrow', 'title', 'text'].includes(k);
      if (removable && b[k] === '') {
        return '<div class="sb-field sb-field-off"><div class="sb-lbl-row"><span class="sb-lbl">' + E(label) + '</span>' +
          '<button type="button" class="sb-fmt-btn" data-sb="txt-restore" data-k="' + k + '">' + ic('plus') + 'Volver a poner</button></div>' +
          '<p class="sb-hint">Quitado: este texto no se muestra en la web.</p></div>';
      }
      return '<div class="sb-field"><div class="sb-lbl-row"><label class="sb-lbl" for="' + id + '">' + E(label) + '</label>' +
        '<span class="sb-lbl-tools">' + (fk ? this.fmtBtn(b, fk, label) : '') +
        (removable ? '<button type="button" class="sb-icon" data-sb="txt-remove" data-k="' + k + '" aria-label="Quitar ' + E(label.toLowerCase()) + '" title="Quitar este texto">' + ic('trash') + '</button>' : '') + '</span></div>' +
        (fk ? this.fmtPanel(b, fk, label) : '') + input + (o.hint ? '<p class="sb-hint">' + E(o.hint) + '</p>' : '') + '</div>';
    };
    const btnField = (k, label, dest) => {
      const on = T.def[k] === '' ? !!(b[k] && b[k].trim()) : b[k] !== '';
      const id = 'sb-f-' + k;
      return '<div class="sb-field"><div class="sb-lbl-row"><label class="sb-check"><input type="checkbox" data-sb-btn="' + k + '"' + (on ? ' checked' : '') + ' /><span>' + E(label) + '</span></label>' +
        (on ? this.fmtBtn(b, k, 'el botón') : '') + '</div>' + (on ? this.fmtPanel(b, k, 'el botón') : '') +
        (on ? '<input id="' + id + '" class="sb-input" type="text" maxlength="' + M[k] + '" data-sb-field="' + k + '" value="' + E(b[k] || '') + '" placeholder="' + E(def(k)) + '" aria-label="Texto del botón" />' +
          '<p class="sb-hint">Lleva a ' + E(dest) + '.</p>' : '') + '</div>';
    };

    f.push('<div class="sb-field"><span class="sb-lbl">Estilo</span>' + this.seg('style', T.styles, b.style || T.styles[0][0]) + '</div>');
    const heroPhotoBg = b.type === 'portada' && (b.style || 'foto-fondo') === 'foto-fondo' && b.image;
    const heroVideoBg = b.type === 'portada' && (b.style || 'foto-fondo') === 'foto-fondo' && (SiteBlocks.videoInfo(b.video) || {}).kind === 'file';
    if (!heroPhotoBg && !heroVideoBg) {
      const bg = b.bg || (b.type === 'reservar' ? 'marca' : 'normal');
      f.push('<div class="sb-field"><span class="sb-lbl">Fondo</span>' + this.seg('bg', SiteBlocks.BGS, bg) +
        (bg === 'color' ? '<label class="sb-color"><input type="color" data-sb-bgcolor value="' + E(SiteBlocks.HEX_RE.test(b.bgColor || '') ? b.bgColor : '#F4EEE6') + '" /><span>Elegir el color</span><code>' + E((b.bgColor || '').toUpperCase()) + '</code></label>' +
          '<p class="sb-hint">Los textos se ponen blancos u oscuros solos, según el color.</p>' : '') +
      '</div>');
    }

    if (T.fields.includes('eyebrow')) f.push(field('eyebrow', 'Texto pequeño sobre el título'));
    if (T.fields.includes('title')) f.push(field('title', 'Título', b.type === 'portada' ? { ph: this.st.tenant.name } : null));
    if (T.fields.includes('text')) f.push(field('text', b.type === 'texto' ? 'Texto' : 'Descripción', { area: true, rows: b.type === 'texto' ? 7 : 3, hint: b.type === 'texto' ? 'Deja una línea en blanco para separar párrafos.' : '' }));
    if (T.fields.includes('text')) f.push(this.extrasHTML(b));

    if (T.fields.includes('video') && b.type === 'video') f.push(this.videoFieldHTML(b));
    if (T.fields.includes('poster') && (SiteBlocks.videoInfo(b.video) || {}).kind === 'file') {
      f.push(this.imageFieldHTML(b, 'poster', 'Imagen de portada del video', 'Se ve antes de darle play. Opcional.'));
    }
    if (T.fields.includes('image') && !(b.type === 'texto' && b.style === 'solo-texto') && !(b.type === 'portada' && b.style === 'centrado')) {
      f.push(this.imageFieldHTML(b, 'image', 'Foto', b.type === 'portada' ? 'Sin foto se usa el color o la ilustración del negocio.' : 'Sin foto, el texto ocupa todo el ancho.'));
    }
    if (b.type === 'portada' && (b.style || 'foto-fondo') === 'foto-fondo') f.push(this.heroVideoHTML(b));
    if (T.fields.includes('images')) f.push(this.photosFieldHTML(b));

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

  /* ---------------- Formato de cada texto ---------------- */
  FMT_SIZE_NAMES: [['xs', 'Más pequeño'], ['s', 'Pequeño'], ['', 'Normal'], ['l', 'Grande'], ['xl', 'Más grande'], ['xxl', 'Enorme']],
  fmtBtn(b, slot, what, text) {
    const E = this.esc.bind(this);
    const open = this.st.fmtOpen === slot, set = !!this.fmtGet(b, slot);
    return '<button type="button" class="sb-fmt-btn' + (open ? ' is-open' : '') + (set ? ' is-set' : '') + '" data-sb="fmt" data-slot="' + slot + '" aria-expanded="' + open + '" aria-label="Formato de ' + E(what) + '">' +
      '<span class="sb-fmt-aa" aria-hidden="true">Aa</span>' + E(text || 'Formato') + (set ? '<span class="sb-fmt-dot" aria-hidden="true"></span>' : '') + '</button>';
  },
  fmtPanel(b, slot, what) {
    if (this.st.fmtOpen !== slot) return '';
    const E = this.esc.bind(this), F = SiteBlocks.FONTS;
    const f = this.fmtGet(b, slot) || {};
    const isBtn = slot === 'btn' || slot === 'btn2';
    const sel = (k, label, opts, cur) => '<label class="sb-fmt-f"><span>' + label + '</span><select class="sb-input" data-sb-fmt="' + slot + '" data-k="' + k + '">' +
      opts.map(([v, l]) => '<option value="' + E(v) + '"' + (v === cur ? ' selected' : '') + '>' + E(l) + '</option>').join('') + '</select></label>';
    const color = (k, label, cur, def) => '<div class="sb-fmt-c"><label class="sb-color"><input type="color" data-sb-fmt="' + slot + '" data-k="' + k + '" value="' + E(cur || def) + '" />' +
      '<span>' + label + '</span><code>' + (cur ? E(cur.toUpperCase()) : 'Como está') + '</code></label>' +
      (cur ? '<button type="button" class="sb-back" data-sb="fmt-unset" data-slot="' + slot + '" data-k="' + k + '">' + ic('refresh') + 'Quitar</button>' : '') + '</div>';
    const bold = f.bold === true ? 'b' : (f.bold === false ? 'n' : '');
    return '<div class="sb-fmt" role="group" aria-label="Formato de ' + E(what) + '"><div class="sb-fmt-grid">' +
      sel('font', 'Letra', [['', 'Como está']].concat(Object.keys(F).map(k => [k, F[k].label])), f.font || '') +
      sel('size', 'Tamaño', this.FMT_SIZE_NAMES, f.size || '') +
      sel('bold', 'Grosor', [['', 'Como está'], ['n', 'Normal'], ['b', 'Negrita']], bold) +
      (isBtn || slot === 'eyebrow' ? '' : sel('align', 'Alineación', [['', 'Como está'], ['left', 'Izquierda'], ['center', 'Centro'], ['right', 'Derecha']], f.align || '')) +
      '</div>' +
      '<label class="sb-check sb-fmt-it"><input type="checkbox" data-sb-fmt="' + slot + '" data-k="italic"' + (f.italic === true ? ' checked' : '') + ' /><span>Cursiva</span></label>' +
      color('color', isBtn ? 'Color del texto' : 'Color', f.color, '#111418') +
      (isBtn ? color('bg', 'Color del botón', f.bg, '#3B82F6') : '') +
      (Object.keys(f).length ? '<button type="button" class="sb-link-danger" data-sb="fmt-clear" data-slot="' + slot + '">' + ic('x') + 'Quitar todo el formato</button>' : '') +
    '</div>';
  },
  // Formato de un texto del bloque (slot) o de un cuadro extra ("x:<id>")
  extraOf(b, slot) { return /^x:/.test(slot) ? (b.extras || []).find(x => x.id === slot.slice(2)) || null : null; },
  fmtGet(b, slot) {
    if (/^x:/.test(slot)) { const x = this.extraOf(b, slot); return (x && x.fmt) || null; }
    return (b.fmt && b.fmt[slot]) || null;
  },
  fmtPut(b, slot, f) {
    const has = f && Object.keys(f).length;
    if (/^x:/.test(slot)) {
      const x = this.extraOf(b, slot);
      if (x) { if (has) x.fmt = f; else delete x.fmt; }
      return;
    }
    const fm = Object.assign({}, b.fmt || {});
    if (has) fm[slot] = f; else delete fm[slot];
    if (Object.keys(fm).length) b.fmt = fm; else delete b.fmt;
  },
  setFmt(b, slot, k, v) {
    if (!SiteBlocks.FMT_SLOTS[slot] && !this.extraOf(b, slot)) return;
    if (k === 'bg' && slot !== 'btn' && slot !== 'btn2') return;
    const f = Object.assign({}, this.fmtGet(b, slot) || {});
    if (k === 'bold') { if (v === 'b') f.bold = true; else if (v === 'n') f.bold = false; else delete f.bold; }
    else if (k === 'italic') { if (v) f.italic = true; else delete f.italic; }
    else if (k === 'color' || k === 'bg') { if (SiteBlocks.HEX_RE.test(v || '')) f[k] = v.toUpperCase(); else delete f[k]; }
    else if (['font', 'size', 'align'].includes(k)) { if (v) f[k] = v; else delete f[k]; }
    this.fmtPut(b, slot, f);
  },

  /* ---------------- Cuadros de texto extra ---------------- */
  extrasHTML(b) {
    const E = this.esc.bind(this), list = b.extras || [];
    const kinds = SiteBlocks.EXTRA_KINDS;
    return '<div class="sb-field"><span class="sb-lbl">Cuadros de texto extra</span>' +
      (list.length ? '<ol class="sb-items">' + list.map((x, i) => {
        const slot = 'x:' + x.id, n = i + 1;
        return '<li class="sb-item"><div class="sb-item-row">' +
          '<select class="sb-input" data-sb-extra="' + i + '" data-k="kind" aria-label="Tipo del cuadro ' + n + '">' +
            kinds.map(([k, l]) => '<option value="' + k + '"' + (k === x.kind ? ' selected' : '') + '>' + E(l) + '</option>').join('') + '</select>' +
          this.fmtBtn(b, slot, 'el cuadro de texto ' + n, ' ') +
          '<button type="button" class="sb-icon" data-sb="extra-move" data-i="' + i + '" data-d="-1" aria-label="Subir el cuadro ' + n + '"' + (i === 0 ? ' disabled' : '') + '>' + ic('chevronLeft') + '</button>' +
          '<button type="button" class="sb-icon" data-sb="extra-move" data-i="' + i + '" data-d="1" aria-label="Bajar el cuadro ' + n + '"' + (i === list.length - 1 ? ' disabled' : '') + '>' + ic('chevronRight') + '</button>' +
          '<button type="button" class="sb-icon" data-sb="extra-del" data-i="' + i + '" aria-label="Quitar el cuadro ' + n + '">' + ic('trash') + '</button>' +
          '</div>' + this.fmtPanel(b, slot, 'el cuadro de texto ' + n) +
          '<textarea class="sb-input" rows="' + (x.kind === 'parrafo' ? 4 : 2) + '" maxlength="' + SiteBlocks.MAX.text + '" data-sb-extra="' + i + '" data-k="text" placeholder="Escribe aquí…" aria-label="Texto del cuadro ' + n + '">' + E(x.text || '') + '</textarea>' +
          '<label class="sb-check"><input type="checkbox" data-sb-extra="' + i + '" data-k="free"' + (x.pos ? ' checked' : '') + ' /><span>Posición libre (moverlo a cualquier lugar)</span></label>' +
          (x.pos ? '<p class="sb-hint">Arrástralo desde su asa en la vista previa y estira su borde derecho para el ancho. En la vista Celular puedes acomodarlo aparte.' +
            (x.mpos ? ' <button type="button" class="sb-link" data-sb="extra-mreset" data-i="' + i + '">Usar en celular la misma posición</button>' : '') + '</p>' : '') +
        '</li>';
      }).join('') + '</ol>' : '<p class="sb-hint">Agrega títulos o párrafos debajo de los textos del bloque, cada uno con su propio formato. Con «T+» en la barra del bloque (vista previa) agregas uno que puedes mover a cualquier lugar.</p>') +
      (list.length < SiteBlocks.MAX_EXTRAS ? '<button type="button" class="sb-btn sb-btn-ghost" data-sb="extra-add">' + ic('plus') + '<span>Agregar cuadro de texto</span></button>' : '') +
    '</div>';
  },

  /* ---------------- Fotos y videos ---------------- */
  imageFieldHTML(b, k, label, emptyHint) {
    const E = this.esc.bind(this), v = b[k];
    return '<div class="sb-field"><span class="sb-lbl">' + E(label) + '</span>' +
      (v ? '<div class="sb-img"><img src="' + E(v) + '" alt="" /></div>' : '<p class="sb-hint">' + E(emptyHint) + '</p>') +
      '<div class="sb-img-actions">' +
        '<label class="sb-btn sb-btn-ghost sb-file">' + ic('upload') + '<span>' + (v ? 'Cambiar foto' : 'Subir foto') + '</span><input type="file" accept="image/png,image/jpeg,image/webp" data-sb-upload data-k="' + k + '" class="sr-only" /></label>' +
        (v ? '<button type="button" class="sb-btn sb-btn-ghost" data-sb="nomedia" data-k="' + k + '">' + ic('trash') + '<span>Quitar</span></button>' : '') +
      '</div><p class="sb-hint">JPG, PNG o WebP. Se ajusta sola al tamaño de la web.</p></div>';
  },

  videoUploadHTML(b, label) {
    return '<label class="sb-btn sb-btn-ghost sb-file">' + ic('upload') + '<span>' + label + '</span>' +
      '<input type="file" accept="video/mp4,video/webm" data-sb-upload data-k="video" class="sr-only" /></label>' +
      (b.video ? '<button type="button" class="sb-btn sb-btn-ghost" data-sb="nomedia" data-k="video">' + ic('trash') + '<span>Quitar video</span></button>' : '');
  },

  videoFieldHTML(b) {
    const E = this.esc.bind(this);
    const info = SiteBlocks.videoInfo(b.video);
    const file = info && info.kind === 'file';
    let show = '';
    if (file) show = '<div class="sb-img"><video src="' + E(info.src) + '" muted controls playsinline preload="metadata"></video></div>';
    else if (info) show = '<p class="sb-note">Video de ' + (/vimeo/.test(info.src) ? 'Vimeo' : 'YouTube') + ' listo. Se ve en la vista previa.</p>';
    else if (b.video) show = '<p class="sb-note sb-note-warn">Ese enlace no es de YouTube ni de Vimeo. Copia el enlace del video desde el botón "Compartir".</p>';
    return '<div class="sb-field"><span class="sb-lbl">Video</span>' + show +
      '<div class="sb-img-actions">' + this.videoUploadHTML(b, file ? 'Cambiar video' : 'Subir video') + '</div>' +
      '<p class="sb-hint">MP4 o WebM de hasta 50 MB (unos 30 a 60 segundos en buena calidad).</p></div>' +
      '<div class="sb-field"><label class="sb-lbl" for="sb-f-video">O pega un enlace de YouTube o Vimeo</label>' +
      '<input id="sb-f-video" class="sb-input" type="url" inputmode="url" maxlength="1000" data-sb-field="video" value="' + E(file ? '' : (b.video || '')) + '" placeholder="https://www.youtube.com/watch?v=…" /></div>';
  },

  heroVideoHTML(b) {
    const E = this.esc.bind(this);
    const info = SiteBlocks.videoInfo(b.video);
    const file = info && info.kind === 'file';
    return '<div class="sb-field"><span class="sb-lbl">Video de fondo (opcional)</span>' +
      (file ? '<div class="sb-img"><video src="' + E(info.src) + '" muted loop autoplay playsinline preload="metadata"></video></div>' : '') +
      '<div class="sb-img-actions">' + this.videoUploadHTML(b, file ? 'Cambiar video' : 'Subir video') + '</div>' +
      '<p class="sb-hint">Se reproduce sin sonido y en bucle detrás del título. Usa un video corto (MP4 o WebM, hasta 50 MB). La foto se ve mientras carga.</p></div>';
  },

  photosFieldHTML(b) {
    const E = this.esc.bind(this);
    const imgs = Array.isArray(b.images) ? b.images : [];
    const max = SiteBlocks.MAX_IMAGES;
    return '<div class="sb-field"><span class="sb-lbl">Fotos (' + imgs.length + ' de ' + max + ')</span>' +
      (imgs.length ? '<ol class="sb-thumbs">' + imgs.map((u, i) =>
        '<li><img src="' + E(u) + '" alt="Foto ' + (i + 1) + '" />' +
          '<span class="sb-thumb-tools">' +
            '<button type="button" class="sb-icon" data-sb="img-move" data-i="' + i + '" data-d="-1" aria-label="Mover la foto ' + (i + 1) + ' antes"' + (i === 0 ? ' disabled' : '') + '>' + ic('chevronLeft') + '</button>' +
            '<button type="button" class="sb-icon" data-sb="img-del" data-i="' + i + '" aria-label="Quitar la foto ' + (i + 1) + '">' + ic('trash') + '</button>' +
            '<button type="button" class="sb-icon" data-sb="img-move" data-i="' + i + '" data-d="1" aria-label="Mover la foto ' + (i + 1) + ' después"' + (i === imgs.length - 1 ? ' disabled' : '') + '>' + ic('chevronRight') + '</button>' +
          '</span></li>').join('') + '</ol>' : '<p class="sb-hint">Aún no hay fotos: sin fotos, este bloque no se ve en la web.</p>') +
      (imgs.length < max ? '<div class="sb-img-actions"><label class="sb-btn sb-btn-ghost sb-file">' + ic('upload') + '<span>Subir fotos</span>' +
        '<input type="file" accept="image/png,image/jpeg,image/webp" multiple data-sb-upload data-k="images" class="sr-only" /></label></div>' : '') +
      '<p class="sb-hint">Puedes elegir varias a la vez. JPG, PNG o WebP; se ajustan solas al tamaño de la web.</p></div>';
  },

  /* ---------------- Letra y colores de toda la web ---------------- */
  /* ---------------- Copiar colores y fondos de una imagen (sin IA, sin costo) ----------------
     Todo pasa en el navegador: la imagen no se sube a ningún lado.
     1. Se reduce la imagen y se mira fila por fila cuál es su color de fondo.
     2. Las filas seguidas con el mismo fondo forman "franjas" (secciones del
        modelo, de arriba abajo). Una franja con muchos colores = foto.
     3. De todos los píxeles salen el color principal (el oscuro más usado) y
        el de los botones (el color vivo más usado).
     4. Al aplicar: colores en "Letra y colores", y el fondo de cada franja al
        bloque que está en el mismo lugar (el orden de los bloques no cambia).
        La letra se elige a mano (una imagen no dice qué letra es).
     Lo aplicado se ve en la vista previa y llega a la web solo con "Guardar y
     publicar". "Deshacer" vuelve a como estaba. */
  IMG_FONTS: [
    ['', 'No cambiar la letra'],
    ['dm-serif|dm-sans', 'Elegante (títulos con serifa)'],
    ['bodoni|jost', 'De revista (serifa fina y alta)'],
    ['cormorant|figtree', 'Fina y delicada'],
    ['fraunces|source-sans', 'Cálida'],
    ['urbanist|urbanist', 'Moderna (sin serifa)'],
    ['outfit|dm-sans', 'Limpia'],
    ['big-shoulders|inter-tight', 'Deportiva'],
    ['fredoka|nunito', 'Redondeada']
  ],
  imgState() { if (!this.st.img) this.st.img = { font: '' }; return this.st.img; },

  imgHTML() {
    const E = this.esc.bind(this), m = this.imgState(), page = this.st.page, an = m.an;
    const sw = (c, label) => '<span class="sb-img-sw"><i style="background:' + E(c) + '"></i>' + E(label) + '<code>' + E(c.toUpperCase()) + '</code></span>';
    return '<div class="sb-pad">' +
      '<button type="button" class="sb-back" data-sb="back">' + ic('arrowLeft') + 'Bloques</button>' +
      '<h2 class="sb-h"><span class="sb-row-ic" aria-hidden="true">' + ic('image') + '</span>Copiar colores de una imagen</h2>' +
      '<p class="sb-hint">Sube la captura de una web que te guste (mejor de la página entera). Se copian sus colores y el fondo de cada sección, de arriba abajo, sobre los bloques que ya tienes. ' +
        'La imagen no se sube a internet y no tiene costo. El contenido no cambia.</p>' +
      '<div class="sb-field"><span class="sb-lbl">Imagen del modelo</span>' +
        '<label class="sb-img-drop' + (m.url ? ' has-img' : '') + '">' +
          (m.url ? '<img src="' + E(m.url) + '" alt="Imagen del modelo" />' : '<span>' + ic('image') + 'Elegir imagen (PNG, JPG o WEBP)</span>') +
          '<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-sb-img-file />' +
        '</label>' +
        (m.url ? '<p class="sb-hint">' + E(m.name || '') + ' · Toca la imagen para cambiarla.</p>' : '') +
      '</div>' +
      (m.error ? '<p class="sb-note sb-note-warn" role="alert">' + E(m.error) + '</p>' : '') +
      (an ? '<div class="sb-field"><span class="sb-lbl">Lo que encontré</span>' +
          '<div class="sb-img-sws">' + (an.primary ? sw(an.primary, 'Principal') : '') + (an.accent ? sw(an.accent, 'Botones') : '') +
        (!an.primary || !an.accent ? '<span class="sb-hint">' + (!an.accent ? 'No hay un color vivo claro para los botones: queda el del negocio. ' : '') + (!an.primary ? 'No hay un color oscuro claro: el principal queda como está.' : '') + '</span>' : '') + '</div>' +
          '<div class="sb-img-bands" aria-label="Fondos de las secciones, de arriba abajo">' + an.bands.map(b =>
            '<span style="flex:' + Math.max(1, Math.round(b.share * 100)) + ';background:' + (b.photo ? 'repeating-linear-gradient(45deg,#3a3f46 0 6px,#2a2e33 6px 12px)' : E(b.color)) + '" title="' + (b.photo ? 'Foto' : E(b.color)) + '"></span>').join('') + '</div>' +
          '<p class="sb-hint">' + an.bands.length + ' secciones de arriba abajo (las rayadas son fotos). Se aplican en orden a tus bloques.</p></div>' +
        '<div class="sb-field"><label class="sb-lbl" for="sb-img-font">Letra</label>' +
          '<select id="sb-img-font" class="sb-input" data-sb-img-font>' + this.IMG_FONTS.map(f => '<option value="' + f[0] + '"' + (m.font === f[0] ? ' selected' : '') + '>' + E(f[1]) + '</option>').join('') + '</select>' +
          '<p class="sb-hint">Elige la que más se parezca a la del modelo. Luego puedes afinarla en "Letra y colores".</p></div>' +
        '<button type="button" class="sb-btn sb-btn-primary sb-img-run" data-sb="img-apply">' + ic('check') + '<span>Aplicar a la vista previa</span></button>' : '') +
      (m.applied ? '<p class="sb-note" role="status"><strong>Listo: ya está en la vista previa.</strong> Revísalo en escritorio y celular y ajusta lo que quieras. La web no cambia hasta que pulses <strong>Guardar y publicar</strong>.' +
          (m.applied.skipped ? '<br>No usé ' + m.applied.skipped + ' color(es) porque no se leían bien con el texto.' : '') + '</p>' +
        (m.before ? '<button type="button" class="sb-back" data-sb="img-undo">' + ic('refresh') + 'Deshacer (volver a como estaba)</button>' : '') : '') +
      (page.css ? '<div class="sb-foot"><button type="button" class="sb-link-danger" data-sb="css-off">' + ic('x') + 'Quitar el estilo propio de esta web</button></div>' : '') +
    '</div>';
  },

  async imgPick(file) {
    const m = this.imgState();
    m.error = ''; m.an = null; m.applied = null;
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { m.error = 'Elige una imagen PNG, JPG o WEBP.'; this.renderPanel(); return; }
    if (m.url) URL.revokeObjectURL(m.url);
    m.name = file.name; m.url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => {
        const i = new Image();
        i.onload = () => ok(i);
        i.onerror = () => bad(new Error('No pude leer la imagen.'));
        i.src = m.url;
      });
      m.an = this.imgAnalyze(img);
    } catch (err) {
      m.error = (err && err.message) || 'No pude leer la imagen.';
    }
    if (this.st && this.st.img === m) this.renderPanel();
  },

  /* Colores (0-255) → utilidades */
  _hex(r, g, b) { return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase(); },
  _lum(r, g, b) { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); },
  _sat(r, g, b) { const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; },
  _dist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); },

  imgAnalyze(img) {
    const W = 160;
    const H = Math.max(1, Math.min(4000, Math.round(img.naturalHeight * W / img.naturalWidth)));
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#FFFFFF'; g.fillRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const Q = v => v >> 4;                       // 16 niveles por canal
    const key = (r, gg, b) => (Q(r) << 8) | (Q(gg) << 4) | Q(b);
    const all = new Map();                        // clave → [n, r, g, b] (sumas)
    // 1. Fondo de cada fila: el color más repetido y qué parte de la fila ocupa
    const rows = [];
    for (let y = 0; y < H; y++) {
      const cnt = new Map();
      for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, r = px[i], gg = px[i + 1], b = px[i + 2], k = key(r, gg, b);
        const e = cnt.get(k) || [0, 0, 0, 0]; e[0]++; e[1] += r; e[2] += gg; e[3] += b; cnt.set(k, e);
        const a = all.get(k) || [0, 0, 0, 0]; a[0]++; a[1] += r; a[2] += gg; a[3] += b; all.set(k, a);
      }
      let best = null;
      cnt.forEach(e => { if (!best || e[0] > best[0]) best = e; });
      rows.push({ c: [best[1] / best[0], best[2] / best[0], best[3] / best[0]], share: best[0] / W });
    }
    // 2. Franjas: filas seguidas con el mismo fondo; una fila con poco de un solo color es foto
    let bands = [];
    rows.forEach(r => {
      const photo = r.share < 0.45;
      const last = bands[bands.length - 1];
      if (last && last.photo === photo && (photo || this._dist(last.c, r.c) < 30)) {
        last.n++;
        if (!photo) last.c = last.c.map((v, j) => v + (r.c[j] - v) / last.n);
      } else bands.push({ c: r.c.slice(), n: 1, photo });
    });
    // Franjas muy delgadas (líneas, textos sueltos) se unen a la anterior
    const minRows = Math.max(3, Math.round(H * 0.025));
    const merged = [];
    bands.forEach(b => {
      const last = merged[merged.length - 1];
      if (last && (b.n < minRows || (!b.photo && !last.photo && this._dist(last.c, b.c) < 30))) { last.n += b.n; return; }
      merged.push(b);
    });
    if (merged.length > 1 && merged[0].n < minRows) { merged[1].n += merged[0].n; merged.shift(); }
    // La primera franja delgada de arriba es el menú: no es una sección
    let nav = null;
    if (merged.length > 2 && merged[0].n < H * 0.08 && !merged[0].photo) nav = merged.shift();
    // Una foto en medio de la página (tarjetas, galería) es parte de su sección, no un fondo.
    // Solo la primera franja (la portada) puede ser foto.
    const secs = [];
    merged.forEach((b, i) => {
      const last = secs[secs.length - 1];
      if (b.photo && i > 0 && last) { last.n += b.n; return; }
      if (last && !last.photo && !b.photo && this._dist(last.c, b.c) < 30) { last.n += b.n; return; }
      secs.push(Object.assign({}, b));
    });
    // La última franja oscura es el pie de página (la web ya lo pinta con el color principal)
    let foot = null;
    if (secs.length > 2) {
      const l = secs[secs.length - 1];
      if (!l.photo && this._lum(...l.c) < 0.08) foot = secs.pop();
    }
    const used = secs.reduce((n, b) => n + b.n, 0) || 1;
    bands = secs.slice(0, 24).map(b => ({ color: b.photo ? null : this._hex(b.c[0], b.c[1], b.c[2]), c: b.c, photo: b.photo, share: b.n / used }));
    // 3. Paleta: el oscuro más usado y el color vivo más usado
    const colors = [];
    all.forEach(a => { colors.push({ n: a[0], c: [a[1] / a[0], a[2] / a[0], a[3] / a[0]] }); });
    colors.sort((a, b) => b.n - a.n);
    const total = W * H;
    const vivid = colors.find(x => x.n > total * 0.002 && this._sat(...x.c) > 0.35 && Math.max(...x.c) > 90);
    const darkBar = [nav, foot].find(x => x && this._lum(...x.c) < 0.08);
    let dark = darkBar ? { c: darkBar.c } : colors.find(x => x.n > total * 0.003 && this._lum(...x.c) < 0.06);
    // Sin color vivo o sin oscuro claro, ese color no se cambia
    return { primary: dark ? this._hex(...dark.c) : null, accent: vivid ? this._hex(...vivid.c) : null, bands };
  },

  imgApply() {
    const st = this.st, m = this.imgState(), an = m.an;
    if (!an) return;
    const before = JSON.parse(JSON.stringify(st.page));
    let skipped = 0;
    const th = Object.assign({}, st.page.theme || {});
    if (an.primary) th.primary = an.primary;
    if (an.accent) th.accent = an.accent;
    if (m.font) { const f = m.font.split('|'); th.fontTitle = f[0]; th.fontBody = f[1]; }
    st.page.theme = th;
    const chk = this.themeCheck();
    if (chk && !chk.ok) {
      // Sin el principal (suele ser el que falla); si igual no se lee, los del negocio
      delete th.primary; skipped++;
      const chk2 = this.themeCheck();
      if (chk2 && !chk2.ok) { delete th.accent; skipped++; }
    }
    const prim = th.primary ? [parseInt(th.primary.slice(1, 3), 16), parseInt(th.primary.slice(3, 5), 16), parseInt(th.primary.slice(5, 7), 16)] : null;
    const blocks = st.page.blocks.filter(b => b.show !== false);
    // Cada bloque toma la sección del modelo que está a la misma altura (en proporción).
    // Una sección de color que no le tocó a ningún bloque pasa al bloque más cercano.
    // La portada se queda con la primera sección; el resto se reparte en las demás.
    const heroFirst = blocks.length > 1 && blocks[0].type === 'portada' && an.bands.length > 1;
    const off = heroFirst ? 1 : 0;
    const rest = an.bands.slice(off), tot = rest.reduce((n, b) => n + b.share, 0) || 1;
    const N = blocks.length - off, starts = [];
    rest.reduce((y, b) => { starts.push(y); return y + b.share / tot; }, 0);
    const at = pos => { let k = 0; starts.forEach((y, j) => { if (y <= pos) k = j; }); return k + off; };
    const pick = blocks.map((b, i) => (heroFirst && i === 0 ? 0 : at((i - off + 0.5) / N)));
    an.bands.forEach((band, j) => {
      if (band.photo || pick.includes(j) || (this._lum(...band.c) > 0.9 && this._sat(...band.c) < 0.06)) return;
      if (j < off) return;
      const mid = starts[j - off] + band.share / tot / 2;
      let best = -1, bd = 2;
      blocks.forEach((b, i) => {
        if (b.type === 'portada' || i < off) return;
        const d = Math.abs((i - off + 0.5) / N - mid);
        if (d < bd) { bd = d; best = i; }
      });
      if (best >= 0) pick[best] = j;
    });
    blocks.forEach((b, i) => {
      const band = an.bands[pick[i]];
      if (!band) return;
      if (b.type === 'portada') return;            // la portada sigue con su foto o su estilo
      if (band.photo) { b.bg = 'normal'; delete b.bgColor; return; }
      const [r, g, bl] = band.c;
      if (this._lum(r, g, bl) > 0.9 && this._sat(r, g, bl) < 0.06) { b.bg = 'normal'; delete b.bgColor; }
      else if (prim && this._dist(prim, band.c) < 40) { b.bg = 'marca'; delete b.bgColor; }
      else { b.bg = 'color'; b.bgColor = band.color; }
    });
    m.before = before;
    m.applied = { skipped };
    this.touch(true);
  },

  imgUndo() {
    const m = this.imgState();
    if (!m.before) return;
    this.st.page = m.before;
    m.before = null; m.applied = null;
    this.touch(true);
  },

  basePalette() {
    const tb = typeof TenantBrand !== 'undefined' ? TenantBrand : null;
    return tb ? tb.paletteOf(this.st.tenant) : { primary: '#111418', secondary: '#E4E7EB', tertiary: '#FFFFFF' };
  },
  // Paleta con los colores del constructor encima; null si no se puede revisar
  themeCheck() {
    const tb = typeof TenantBrand !== 'undefined' ? TenantBrand : null;
    const th = this.st.page.theme || {};
    if (!tb || (!th.primary && !th.accent)) return null;
    const base = this.basePalette();
    return tb.checkPalette({ primary: th.primary || base.primary, secondary: th.accent || base.secondary, tertiary: base.tertiary });
  },
  themeSummary() {
    const th = this.st.page.theme || {}, F = SiteBlocks.FONTS;
    const name = (k) => F[k].label.replace(/ \(.*\)$/, '');
    const font = th.fontTitle || th.fontBody ? 'Letra: ' + [th.fontTitle ? name(th.fontTitle) : 'la del rubro', th.fontBody ? name(th.fontBody) : 'la del rubro'].join(' y ') : 'Letra del rubro';
    return font + ' · ' + (th.primary || th.accent ? 'colores propios' : 'colores del negocio');
  },

  themeHTML() {
    const E = this.esc.bind(this), F = SiteBlocks.FONTS;
    const th = this.st.page.theme || {};
    const base = this.basePalette();
    const fontSel = (k, label, hint, filter) => '<div class="sb-field"><label class="sb-lbl" for="sb-t-' + k + '">' + label + '</label>' +
      '<select id="sb-t-' + k + '" class="sb-input" data-sb-theme="' + k + '"><option value="">La del rubro (como está ahora)</option>' +
      Object.keys(F).filter(filter).map(f => '<option value="' + f + '"' + (th[k] === f ? ' selected' : '') + ' style="font-family:' + E(F[f].family) + '">' + E(F[f].label) + '</option>').join('') +
      '</select><p class="sb-hint">' + hint + '</p></div>';
    const color = (k, label, hint, cur) => '<div class="sb-field"><span class="sb-lbl">' + label + '</span>' +
      '<label class="sb-color"><input type="color" data-sb-theme="' + k + '" value="' + E(cur) + '" /><span>' + (th[k] ? 'Color elegido' : 'El del negocio') + '</span><code>' + E(cur.toUpperCase()) + '</code></label>' +
      (th[k] ? '<button type="button" class="sb-back" data-sb="theme-reset" data-k="' + k + '">' + ic('refresh') + 'Usar el del negocio</button>' : '') +
      '<p class="sb-hint">' + hint + '</p></div>';
    const chk = this.themeCheck();
    return '<div class="sb-pad">' +
      '<button type="button" class="sb-back" data-sb="back">' + ic('arrowLeft') + 'Bloques</button>' +
      '<h2 class="sb-h"><span class="sb-row-ic" aria-hidden="true">' + ic('sliders') + '</span>Letra y colores</h2>' +
      '<p class="sb-hint">Cambia toda la web (Inicio, reservar, ' + E(this.fmt('{servicePlural}')) + ', galería y Mi ' + E(this.fmt('{appointment}')) + '). El CRM no cambia.</p>' +
      fontSel('fontTitle', 'Letra de los títulos', 'Para los títulos grandes y los nombres.', f => !F[f].body) +
      fontSel('fontBody', 'Letra de los textos', 'Para párrafos, botones y formularios. Mejor una sencilla.', f => !F[f].title) +
      color('primary', 'Color principal', 'Se usa en el menú, las franjas de color de marca y los textos. Conviene uno oscuro.', th.primary || base.primary) +
      color('accent', 'Color de los botones', 'Los botones para reservar y los detalles.', th.accent || base.secondary) +
      (chk && !chk.ok ? '<p class="sb-note sb-note-warn" role="alert">' + E(chk.error) + ' Elige otro color para poder publicar.</p>' : '') +
    '</div>';
  },

  itemsHTML(b) {
    const E = this.esc.bind(this), M = SiteBlocks.MAX;
    const items = Array.isArray(b.items) && b.items.length ? b.items : null;
    const fmtPair = '<div class="sb-lbl-row sb-fmt-pair"><span class="sb-hint">Formato de todos los puntos:</span>' + this.fmtBtn(b, 'itemTitle', 'los títulos de los puntos', 'Títulos') + this.fmtBtn(b, 'itemText', 'los textos de los puntos', 'Textos') + '</div>' +
      this.fmtPanel(b, 'itemTitle', 'los títulos de los puntos') + this.fmtPanel(b, 'itemText', 'los textos de los puntos');
    if (!items) {
      return '<div class="sb-field"><span class="sb-lbl">Puntos</span><p class="sb-hint">Se muestran los puntos sugeridos (atención con cita, precios claros, reserva en un minuto y WhatsApp).</p>' + fmtPair +
        '<button type="button" class="sb-btn sb-btn-ghost" data-sb="items-custom">' + ic('edit') + '<span>Escribir mis propios puntos</span></button></div>';
    }
    return '<div class="sb-field"><span class="sb-lbl">Puntos (hasta 6)</span>' + fmtPair +
      '<ol class="sb-items">' + items.map((it, i) =>
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
      case 'edit': st.selected = id; st.view = 'block'; st.fmtOpen = null; this.renderPanel(); this.post({ cmd: 'select', id }); break;
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
      case 'nomedia': { const b = this.block(st.selected), k = btn.getAttribute('data-k'); if (b && ['image', 'poster', 'video'].includes(k)) { delete b[k]; this.touch(true); } break; }
      case 'img-del': { const b = this.block(st.selected); if (b && b.images) { b.images.splice(Number(btn.getAttribute('data-i')), 1); if (!b.images.length) delete b.images; this.touch(true); } break; }
      case 'img-move': {
        const b = this.block(st.selected), i = Number(btn.getAttribute('data-i')), j = i + Number(btn.getAttribute('data-d'));
        if (b && b.images && j >= 0 && j < b.images.length) { b.images.splice(j, 0, b.images.splice(i, 1)[0]); this.touch(true); }
        break;
      }
      case 'theme': st.view = 'theme'; this.renderPanel(); break;
      case 'img': st.view = 'img'; this.renderPanel(); break;
      case 'img-apply': this.imgApply(); break;
      case 'img-undo': this.imgUndo(); break;
      case 'css-off': delete st.page.css; this.touch(true); break;
      case 'fmt': { const sl = btn.getAttribute('data-slot'); st.fmtOpen = st.fmtOpen === sl ? null : sl; this.renderPanel(); break; }
      case 'fmt-unset': { const b = this.block(st.selected); if (b) { this.setFmt(b, btn.getAttribute('data-slot'), btn.getAttribute('data-k'), ''); this.touch(true); } break; }
      case 'fmt-clear': { const b = this.block(st.selected); if (b) { this.fmtPut(b, btn.getAttribute('data-slot'), null); this.touch(true); } break; }
      case 'txt-remove': { const b = this.block(st.selected), k = btn.getAttribute('data-k'); if (b && ['eyebrow', 'title', 'text'].includes(k)) { b[k] = ''; if (st.fmtOpen === k) st.fmtOpen = null; this.touch(true); } break; }
      case 'txt-restore': { const b = this.block(st.selected), k = btn.getAttribute('data-k'); if (b && ['eyebrow', 'title', 'text'].includes(k)) { delete b[k]; this.touch(true); } break; }
      case 'extra-add': {
        const b = this.block(st.selected);
        if (b && (b.extras || []).length < SiteBlocks.MAX_EXTRAS) { b.extras = (b.extras || []).concat([{ id: SiteBlocks.newId(), kind: 'parrafo', text: '' }]); this.touch(true); }
        break;
      }
      case 'extra-mreset': { const b = this.block(st.selected), x = b && (b.extras || [])[Number(btn.getAttribute('data-i'))]; if (x) { delete x.mpos; this.touch(true); } break; }
      case 'extra-del': { const b = this.block(st.selected); if (b && b.extras) { b.extras.splice(Number(btn.getAttribute('data-i')), 1); if (!b.extras.length) delete b.extras; this.touch(true); } break; }
      case 'extra-move': {
        const b = this.block(st.selected), i = Number(btn.getAttribute('data-i')), j = i + Number(btn.getAttribute('data-d'));
        if (b && b.extras && j >= 0 && j < b.extras.length) { b.extras.splice(j, 0, b.extras.splice(i, 1)[0]); this.touch(true); }
        break;
      }
      case 'theme-reset': this.setTheme(btn.getAttribute('data-k'), ''); this.touch(true); break;
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
    if (el.hasAttribute('data-sb-img-file')) { if (e.type === 'change') this.imgPick(el.files && el.files[0]); return; }
    if (el.hasAttribute('data-sb-img-font')) { if (e.type === 'change') this.imgState().font = this.IMG_FONTS.some(f => f[0] === el.value) ? el.value : ''; return; }
    if (el.hasAttribute('data-sb-theme')) {
      // El selector de color manda "input" mientras se arrastra: el panel se redibuja al soltar
      if (el.tagName === 'SELECT' && e.type !== 'change') return;
      this.setTheme(el.getAttribute('data-sb-theme'), el.value);
      this.touch(e.type === 'change');
      return;
    }
    if (!b) return;
    if (el.hasAttribute('data-sb-fmt')) {
      const k = el.getAttribute('data-k');
      if ((el.tagName === 'SELECT' || el.type === 'checkbox') && e.type !== 'change') return;
      this.setFmt(b, el.getAttribute('data-sb-fmt'), k, el.type === 'checkbox' ? el.checked : el.value);
      this.touch(e.type === 'change');
      return;
    }
    if (el.hasAttribute('data-sb-extra')) {
      const x = (b.extras || [])[Number(el.getAttribute('data-sb-extra'))], k = el.getAttribute('data-k');
      if (!x) return;
      if (k === 'kind') { if (e.type !== 'change') return; x.kind = el.value; this.touch(true); return; }
      if (k === 'free') {
        if (e.type !== 'change') return;
        if (el.checked) { const n = (b.extras || []).filter(e2 => e2.pos).length; x.pos = { x: Math.min(60, 8 + n * 6), y: Math.min(70, 12 + n * 8), w: 36 }; }
        else { delete x.pos; delete x.mpos; }
        this.touch(true);
        return;
      }
      if (k === 'text') { x.text = el.value; this.touch(false); }
      return;
    }
    if (el.hasAttribute('data-sb-bgcolor')) {
      if (!SiteBlocks.HEX_RE.test(el.value)) return;
      b.bgColor = el.value.toUpperCase();
      this.touch(e.type === 'change');
      return;
    }
    if (el.hasAttribute('data-sb-field')) {
      const k = el.getAttribute('data-sb-field');
      if (el.type === 'radio') {
        if (!el.checked) return;
        b[k] = el.value;
        if (k === 'bg') {
          if (el.value === 'color') { if (!SiteBlocks.HEX_RE.test(b.bgColor || '')) b.bgColor = '#F4EEE6'; }
          else delete b.bgColor;
        }
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
      if (SiteBlocks.TYPES[b.type].def[k] === '') {
        // Bloques sin botón por defecto (Video, Fotos): al activarlo se propone un texto
        if (el.checked) b[k] = this.fmt('Reservar {appointment}'); else delete b[k];
      } else if (el.checked) delete b[k]; else b[k] = '';
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

  setTheme(k, v) {
    if (!['fontTitle', 'fontBody', 'primary', 'accent'].includes(k)) return;
    const th = Object.assign({}, this.st.page.theme || {});
    if (!v) delete th[k];
    else th[k] = (k === 'primary' || k === 'accent') ? String(v).toUpperCase() : v;
    if (Object.keys(th).length) this.st.page.theme = th; else delete this.st.page.theme;
  },

  /* Sube fotos (comprimidas en el navegador) o un video (tal cual) al bucket "media" */
  async upload(input) {
    const files = Array.from(input.files || []);
    const b = this.block(this.st.selected);
    const k = input.getAttribute('data-k') || 'image';
    if (!files.length || !b) return;
    const tenantId = this.st.tenant.id;
    try {
      if (k === 'video') {
        const file = files[0];
        if (!/^video\/(mp4|webm)$/.test(file.type)) { UI.toast('Usa un video MP4 o WebM.', 'error'); return; }
        if (file.size > this.MAX_VIDEO) { UI.toast('El video pesa ' + Math.round(file.size / 1048576) + ' MB: el máximo es 50 MB. Prueba con uno más corto o en menor calidad.', 'error'); return; }
        this.status('Subiendo video… (puede tardar un poco)');
        const url = await this.uploadFile(file, tenantId);
        if (!this.st) return;
        b.video = url;
        this.touch(true);
        this.status('Video listo. Recuerda guardar.');
        return;
      }
      const ok = files.filter(f => /^image\/(png|jpeg|webp)$/.test(f.type) && f.size <= 12 * 1024 * 1024);
      if (ok.length < files.length) UI.toast('Algunas fotos no se subieron: usa JPG, PNG o WebP de hasta 12 MB.', 'error');
      if (k === 'images') {
        const room = SiteBlocks.MAX_IMAGES - (b.images ? b.images.length : 0);
        const list = ok.slice(0, Math.max(0, room));
        if (ok.length > list.length) UI.toast('Caben ' + SiteBlocks.MAX_IMAGES + ' fotos por bloque: se suben las primeras ' + list.length + '.', 'info');
        for (let i = 0; i < list.length; i++) {
          this.status('Subiendo foto ' + (i + 1) + ' de ' + list.length + '…');
          const url = await this.uploadPhoto(list[i], 1600, tenantId);
          if (!this.st) return;
          b.images = (b.images || []).concat([url]);
          this.touch(true);
        }
        if (list.length) this.status(list.length === 1 ? 'Foto lista. Recuerda guardar.' : 'Fotos listas. Recuerda guardar.');
        return;
      }
      if (!ok.length) return;
      this.status('Subiendo foto…');
      const url = await this.uploadPhoto(ok[0], b.type === 'portada' ? 1920 : 1280, tenantId);
      if (!this.st) return;
      b[k] = url;
      this.touch(true);
      this.status('Foto lista. Recuerda guardar.');
    } catch (err) {
      this.status('');
      UI.toast(this.errMsg(err), 'error');
    }
  },
  MAX_VIDEO: 50 * 1024 * 1024,

  async uploadPhoto(file, maxW, tenantId) {
    const dataUrl = await readAndCompressImage(file, maxW, 0.84);
    const url = await DB.uploadImage(dataUrl, tenantId);
    if (!SiteBlocks.IMG_RE.test(url || '') || url.length > 1000) throw new Error('El enlace de la foto no es válido.');
    return url;
  },

  async uploadFile(file, tenantId) {
    const ext = file.type === 'video/webm' ? 'webm' : 'mp4';
    const path = tenantId + '/' + DB.uid() + '.' + ext;
    const sto = DB.client().storage.from('media');
    const { error } = await sto.upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    const url = sto.getPublicUrl(path).data.publicUrl;
    if (!SiteBlocks.IMG_RE.test(url || '') || url.length > 1000) throw new Error('El enlace del video no es válido.');
    return url;
  },

  /* ---------------- Guardar ---------------- */
  errMsg(error) {
    const m = String((error && (error.message || error.details)) || error || '');
    if (/web_page|web_editor/.test(m) && /column|columna|schema cache/i.test(m)) return 'Falta aplicar la migración 21 en Supabase (constructor de la web). Pídele al superadministrador que la ejecute.';
    // Letra, colores, Video, Fotos o color de fondo con la base aún en la migración 21
    const free = !!(this.st && this.st.page.blocks.some(b => (b.extras || []).some(x => x.pos)));
    if (free && /tenants_web_page_valida|check constraint/i.test(m)) return 'La base aún no acepta cuadros de texto en posición libre: falta aplicar la migración 28 en Supabase. Pídele al superadministrador que la ejecute.';
    if (/tenants_web_page_valida|check constraint/i.test(m)) return 'La base aún no acepta letra, colores, fotos ni videos: falta aplicar la migración 22 en Supabase. Pídele al superadministrador que la ejecute.';
    if (/mime type|invalid_mime_type|not supported/i.test(m) && /video/i.test(m)) return 'Aún no se pueden subir videos: falta aplicar la migración 22 en Supabase. Pídele al superadministrador que la ejecute.';
    if (/exceeded the maximum allowed size|payload too large|413|entity too large/i.test(m)) return 'El archivo es demasiado grande para subirlo. Prueba con uno más liviano (videos hasta 50 MB).';
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
    const chk = this.themeCheck();
    if (chk && !chk.ok) { UI.toast('Los colores elegidos no se leen bien: ' + chk.error + ' Cámbialos en "Letra y colores".', 'error'); return; }
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
