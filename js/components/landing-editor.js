/* ==========================================================================
   Reservalope · Editor de la landing (consola → Landing, migración 29)
   --------------------------------------------------------------------------
   Pantalla completa con la misma apariencia que el editor de webs de los
   negocios (css/pages/site-builder.css): a la izquierda los textos por
   sección, a la derecha la landing real en un marco (?editar=1).
   La landing (js/core/landing-content.js) le manda la lista de campos con su
   texto de fábrica; el editor le devuelve el borrador en cada tecla, y al
   pulsar "Guardar y publicar" se guarda en public.landing_contenido (solo lo
   que cambió). Solo el superadministrador.
   ========================================================================== */
const LandingEditor = {
  st: null,
  // Carpeta del bucket media para fotos y videos de la landing (el superadmin
  // puede subir a cualquier carpeta con forma de uuid; ver migración 5)
  FOLDER: '00000000-0000-4000-8000-00000000a11d',
  MAX_VIDEO: 50 * 1024 * 1024,

  esc(s) { return UI.esc(s); },

  /* ---------------- Abrir / cerrar ---------------- */
  async open() {
    if (!(Auth.user && Auth.user.role === 'SUPERADMIN')) return Guard.deny('Solo el superadministrador puede editar la landing.');
    if (this.st) return;
    const { data, error } = await DB.client().from('landing_contenido').select('contenido, updated_at').eq('id', 1).maybeSingle();
    if (error) return UI.toast(this.errMsg(error), 'error');
    const saved = this.normalize((data && data.contenido) || {});
    this.st = {
      saved, draft: JSON.parse(JSON.stringify(saved)),
      fields: [], byKey: {}, sections: [], seo: { title: '', description: '' },
      view: 'list', sec: null, device: 'desktop', ready: false, saving: false
    };
    const E = this.esc.bind(this);
    const root = document.createElement('div');
    root.className = 'sb-root le-root';
    root.id = 'le-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    root.setAttribute('aria-label', 'Editar la landing de Reservalope');
    root.innerHTML =
      '<header class="sb-top">' +
        '<div class="sb-top-id"><span class="sb-kicker">Editar landing</span><strong>reservalope.com</strong></div>' +
        '<div class="sb-devices" role="group" aria-label="Tamaño de la vista previa">' +
          '<button type="button" class="sb-dev is-on" data-le="device" data-v="desktop" aria-pressed="true">' + ic('dashboard') + '<span>Escritorio</span></button>' +
          '<button type="button" class="sb-dev" data-le="device" data-v="mobile" aria-pressed="false">' + ic('phone') + '<span>Celular</span></button>' +
        '</div>' +
        '<div class="sb-top-actions">' +
          '<span class="sb-status" id="le-status" role="status" aria-live="polite"></span>' +
          '<a class="sb-btn sb-btn-ghost" href="' + E(Routes.home()) + '" target="_blank" rel="noopener">' + ic('external') + '<span>Ver landing</span></a>' +
          '<button type="button" class="sb-btn sb-btn-ghost" data-le="close">' + ic('x') + '<span>Cerrar</span></button>' +
          '<button type="button" class="sb-btn sb-btn-primary" data-le="save" id="le-save">' + ic('check') + '<span>Guardar y publicar</span></button>' +
        '</div>' +
      '</header>' +
      '<div class="sb-body">' +
        '<aside class="sb-panel" id="le-panel" aria-label="Textos de la landing"></aside>' +
        '<main class="sb-stage"><div class="sb-frame" id="le-frame-wrap" data-device="desktop">' +
          '<iframe id="le-frame" title="Vista previa de la landing" src="' + E(Routes.home() + '?editar=1') + '"></iframe>' +
          '<div class="sb-loading" id="le-loading">Cargando la vista previa…</div>' +
        '</div></main>' +
      '</div>';
    document.body.appendChild(root);
    document.documentElement.classList.add('sb-open');

    this._onClick = (e) => this.onClick(e);
    this._onInput = (e) => this.onInput(e);
    this._onFocus = (e) => { const k = e.target.closest && e.target.closest('[data-key]'); if (k) this.post({ type: 'lc:focus', key: k.getAttribute('data-key') }); };
    this._onMsg = (e) => this.onMessage(e);
    this._onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.crm-modal-backdrop.is-open, .crm-modal-backdrop[style*="flex"]')) this.close(); };
    this._onUnload = (e) => { if (this.dirty()) { e.preventDefault(); e.returnValue = ''; } };
    root.addEventListener('click', this._onClick);
    root.addEventListener('input', this._onInput);
    root.addEventListener('change', this._onInput);
    root.addEventListener('focusin', this._onFocus);
    window.addEventListener('message', this._onMsg);
    document.addEventListener('keydown', this._onKey);
    window.addEventListener('beforeunload', this._onUnload);
    this.renderPanel();
    this.updateSave();
  },

  async close(force) {
    if (!this.st) return;
    if (!force && this.dirty()) {
      const ok = await UI.confirm({ title: '¿Salir sin guardar?', message: 'Los cambios que no guardaste se perderán. La landing sigue como estaba.', confirmText: 'Salir sin guardar', danger: true });
      if (!ok) return;
    }
    const root = document.getElementById('le-root');
    if (root) root.remove();
    document.documentElement.classList.remove('sb-open');
    window.removeEventListener('message', this._onMsg);
    document.removeEventListener('keydown', this._onKey);
    window.removeEventListener('beforeunload', this._onUnload);
    this.st = null;
    if (typeof Reservalope !== 'undefined' && Reservalope.pane === 'landing') Reservalope.renderLanding(true);
  },

  /* ---------------- Contenido ---------------- */
  normalize(c) {
    const o = { text: {}, media: {}, hidden: [], seo: {} };
    if (!c || typeof c !== 'object') return o;
    if (c.text && typeof c.text === 'object') Object.keys(c.text).forEach(k => { if (typeof c.text[k] === 'string') o.text[k] = c.text[k]; });
    if (c.media && typeof c.media === 'object') Object.keys(c.media).forEach(k => {
      const m = c.media[k] || {}, x = {};
      if (this.okUrl(m.src)) x.src = m.src;
      if (this.okUrl(m.poster)) x.poster = m.poster;
      if (x.src || x.poster) o.media[k] = x;
    });
    if (Array.isArray(c.hidden)) o.hidden = c.hidden.filter(x => typeof x === 'string');
    if (c.seo && typeof c.seo === 'object') ['title', 'description'].forEach(k => { if (typeof c.seo[k] === 'string' && c.seo[k].trim()) o.seo[k] = c.seo[k]; });
    return o;
  },

  okUrl(u) { return typeof u === 'string' && u.length <= 600 && /^https:\/\/[^\s"<>]+$/.test(u); },

  // Lo que se guarda: sin textos iguales al de fábrica ni partes vacías
  pack(d) {
    const out = { v: 1 };
    const text = {};
    Object.keys(d.text).forEach(k => {
      const f = this.st.byKey[k];
      if (f && d.text[k] === f.value) return;
      text[k] = d.text[k].slice(0, 2000);
    });
    if (Object.keys(text).length) out.text = text;
    if (Object.keys(d.media).length) out.media = d.media;
    if (d.hidden.length) out.hidden = [...new Set(d.hidden)].sort();
    const seo = {};
    ['title', 'description'].forEach(k => { const v = (d.seo[k] || '').trim(); if (v) seo[k] = v.slice(0, 300); });
    if (Object.keys(seo).length) out.seo = seo;
    return out;
  },

  dirty() { return !!(this.st && this.st.ready && JSON.stringify(this.pack(this.st.draft)) !== JSON.stringify(this.pack(this.st.saved))); },

  value(f) {
    const d = this.st.draft;
    if (f.kind === 'video') return Object.assign({}, f.value, d.media[f.key] || {});
    return typeof d.text[f.key] === 'string' ? d.text[f.key] : f.value;
  },
  changed(f) {
    const d = this.st.draft;
    return f.kind === 'video' ? !!d.media[f.key] : (typeof d.text[f.key] === 'string' && d.text[f.key] !== f.value);
  },
  isHidden(id) { return this.st.draft.hidden.indexOf(id) >= 0; },

  /* ---------------- Vista previa ---------------- */
  frame() { const f = document.getElementById('le-frame'); return f && f.contentWindow; },
  post(msg) { const w = this.frame(); if (w && this.st && this.st.ready) w.postMessage(msg, location.origin); },
  push() { this.post({ type: 'lc:apply', content: this.pack(this.st.draft) }); this.updateSave(); },

  onMessage(e) {
    if (!this.st || e.origin !== location.origin || e.source !== this.frame() || !e.data) return;
    const m = e.data;
    if (m.type === 'lc:ready') {
      this.st.fields = Array.isArray(m.fields) ? m.fields : [];
      this.st.byKey = {};
      this.st.fields.forEach(f => { this.st.byKey[f.key] = f; });
      this.st.sections = Array.isArray(m.sections) ? m.sections : [];
      this.st.seo = m.seo || this.st.seo;
      this.st.ready = true;
      const l = document.getElementById('le-loading');
      if (l) l.remove();
      this.push();
      this.renderPanel();
    } else if (m.type === 'lc:pick') {
      const f = this.st.byKey[m.key];
      if (!f) return;
      this.st.view = 'sec';
      this.st.sec = f.sec;
      this.renderPanel();
      const box = document.querySelector('#le-panel [data-key="' + CSS.escape(f.key) + '"]');
      if (box) {
        box.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const inp = box.querySelector('textarea, input[type="text"]');
        if (inp) inp.focus({ preventScroll: true });
        box.classList.add('le-flash');
        setTimeout(() => box.classList.remove('le-flash'), 1200);
      }
    }
  },

  /* ---------------- Panel ---------------- */
  SLOT: {
    eyebrow: 'Texto pequeño de arriba', title: 'Título', title2: 'Título, segunda línea', lead: 'Descripción',
    text: 'Texto', note: 'Nota', link: 'Enlace', btn: 'Botón', cta1: 'Botón principal', cta2: 'Botón secundario',
    q: 'Pregunta', a: 'Respuesta', dur: 'Duración', video: 'Video'
  },
  label(f) {
    if (f.hint) return f.hint;
    const slot = f.key.split('.').pop();
    let m;
    if ((m = slot.match(/^link(\d+)$/))) return 'Enlace ' + m[1];
    if ((m = slot.match(/^check(\d+)$/))) return 'Punto con ✓ ' + m[1];
    if ((m = slot.match(/^col(\d+)$/))) return 'Título de la columna ' + m[1];
    return this.SLOT[slot] || slot;
  },

  secChanges(s) {
    const d = this.st.draft;
    let n = this.st.fields.filter(f => f.sec === s.id && this.changed(f)).length;
    n += s.items.filter(i => this.isHidden(i)).length;
    return n;
  },

  renderPanel() {
    const p = document.getElementById('le-panel');
    if (!p || !this.st) return;
    const st = this.st, E = this.esc.bind(this);
    if (!st.ready) {
      p.innerHTML = '<div class="sb-pad"><h2 class="sb-h">Landing</h2><p class="sb-hint">Cargando los textos de la landing…</p></div>';
      return;
    }
    let h = '<div class="sb-pad">';
    if (st.view === 'list') {
      h += '<h2 class="sb-h">Landing</h2>' +
        '<p class="sb-hint">Toca un texto en la vista previa para cambiarlo, o elige una sección. Los cambios se ven al instante a la derecha y se publican al pulsar <strong>Guardar y publicar</strong>.</p>' +
        '<ul class="sb-list">';
      st.sections.forEach(s => {
        const off = !s.fixed && this.isHidden(s.id);
        const n = this.secChanges(s);
        h += '<li class="sb-row' + (off ? ' is-off' : '') + '">' +
          '<button type="button" class="sb-row-main" data-le="open" data-v="' + E(s.id) + '"><span class="sb-row-txt"><strong>' + E(s.name) + '</strong>' +
          '<span>' + (off ? 'Oculta en la landing' : n ? n + (n === 1 ? ' cambio' : ' cambios') : 'Texto original') + '</span></span></button>' +
          (s.fixed ? '' : '<span class="sb-row-tools"><button type="button" class="sb-icon" data-le="eye" data-v="' + E(s.id) + '" aria-pressed="' + !off + '" aria-label="' + (off ? 'Mostrar ' : 'Ocultar ') + E(s.name) + '" title="' + (off ? 'Mostrar' : 'Ocultar') + '">' + ic(off ? 'lock' : 'eye') + '</button></span>') +
          '</li>';
      });
      const seoN = Object.keys(st.draft.seo).filter(k => (st.draft.seo[k] || '').trim()).length;
      h += '<li class="sb-row"><button type="button" class="sb-row-main" data-le="seo"><span class="sb-row-txt"><strong>Google y pestaña del navegador</strong><span>' +
        (seoN ? 'Cambiado' : 'Texto original') + '</span></span></button></li></ul>' +
        '<div class="sb-foot"><p class="sb-hint">La animación de la portada, la demo de reservas y el formulario siguen como están; aquí se cambian sus textos.</p>' +
        '<button type="button" class="sb-link-danger" data-le="reset-all">' + ic('refresh') + 'Volver toda la landing al texto original</button></div>';
    } else if (st.view === 'seo') {
      h += '<button type="button" class="sb-back" data-le="back">' + ic('arrowLeft') + 'Secciones</button>' +
        '<h2 class="sb-h">Google y pestaña del navegador</h2>' +
        '<p class="sb-hint">Lo que se ve en la pestaña y en los resultados de Google o al compartir el enlace. Déjalo vacío para usar el original.</p>' +
        '<div class="sb-field"><label class="sb-lbl" for="le-seo-title">Título</label><input type="text" class="sb-input" id="le-seo-title" data-le="seo-in" data-v="title" maxlength="300" placeholder="' + E(st.seo.title) + '" value="' + E(st.draft.seo.title || '') + '"></div>' +
        '<div class="sb-field"><label class="sb-lbl" for="le-seo-desc">Descripción</label><textarea class="sb-input" id="le-seo-desc" rows="4" data-le="seo-in" data-v="description" maxlength="300" placeholder="' + E(st.seo.description) + '">' + E(st.draft.seo.description || '') + '</textarea></div>';
    } else {
      const s = st.sections.find(x => x.id === st.sec) || st.sections[0];
      if (!s) { st.view = 'list'; return this.renderPanel(); }
      const fs = st.fields.filter(f => f.sec === s.id);
      h += '<button type="button" class="sb-back" data-le="back">' + ic('arrowLeft') + 'Secciones</button>' +
        '<h2 class="sb-h">' + E(s.name) + '</h2>';
      if (!s.fixed) {
        h += '<label class="sb-check le-show"><input type="checkbox" data-le="show" data-v="' + E(s.id) + '"' + (this.isHidden(s.id) ? '' : ' checked') + '> Mostrar esta sección en la landing</label>';
      }
      if (fs.some(f => f.hl)) h += '<p class="sb-note">En los títulos, lo que escribas entre <strong>*asteriscos*</strong> se ve resaltado, como la segunda parte del título original.</p>';
      h += fs.filter(f => !f.item).map(f => this.fieldHTML(f)).join('');
      if (s.items.length) {
        h += '<ul class="sb-items le-items">' + s.items.map((id, i) => {
          const off = this.isHidden(id);
          return '<li class="sb-item' + (off ? ' is-off' : '') + '" data-key="' + E(id) + '">' +
            '<div class="sb-item-row le-item-head"><strong>' + E(s.itemName + ' ' + (i + 1)) + '</strong>' +
            '<label class="sb-check"><input type="checkbox" data-le="show" data-v="' + E(id) + '"' + (off ? '' : ' checked') + '> Mostrar</label></div>' +
            fs.filter(f => f.item === id).map(f => this.fieldHTML(f)).join('') +
          '</li>';
        }).join('') + '</ul>';
      }
      h += '<div class="sb-block-actions"><button type="button" class="sb-btn sb-btn-danger" data-le="reset-sec" data-v="' + E(s.id) + '">' + ic('refresh') + 'Volver esta sección al original</button></div>';
    }
    p.innerHTML = h + '</div>';
  },

  fieldHTML(f) {
    const E = this.esc.bind(this);
    const id = 'le-f-' + f.key.replace(/[^a-z0-9]/gi, '-');
    const v = this.value(f);
    const restore = this.changed(f) ? '<button type="button" class="sb-link le-restore" data-le="restore" data-v="' + E(f.key) + '">Original</button>' : '';
    if (f.kind === 'video') {
      return '<div class="sb-field" data-key="' + E(f.key) + '">' +
        '<div class="sb-lbl-row"><span class="sb-lbl">' + E(this.label(f)) + '</span>' + restore + '</div>' +
        '<div class="sb-img"><video src="' + E(v.src) + '"' + (v.poster ? ' poster="' + E(v.poster) + '"' : '') + ' preload="metadata" controls playsinline muted></video></div>' +
        '<div class="sb-img-actions">' +
          '<label class="sb-btn sb-file">' + ic('upload') + 'Cambiar video<input type="file" hidden accept="video/mp4,video/webm" data-le="file" data-what="src" data-v="' + E(f.key) + '"></label>' +
          '<label class="sb-btn sb-file">' + ic('image') + 'Cambiar portada<input type="file" hidden accept="image/jpeg,image/png,image/webp" data-le="file" data-what="poster" data-v="' + E(f.key) + '"></label>' +
        '</div>' +
        '<p class="sb-hint">Video MP4 o WebM de hasta 50 MB. La portada es la imagen que se ve antes de reproducir.</p>' +
      '</div>';
    }
    const slot = f.key.split('.').pop();
    const long = f.long || v.length > 60 || ['lead', 'text', 'a', 'note'].indexOf(slot) >= 0;
    return '<div class="sb-field" data-key="' + E(f.key) + '">' +
      '<div class="sb-lbl-row"><label class="sb-lbl" for="' + id + '">' + E(this.label(f)) + '</label>' + restore + '</div>' +
      (long
        ? '<textarea class="sb-input" id="' + id + '" rows="' + Math.min(8, Math.max(2, Math.ceil(v.length / 44))) + '" maxlength="2000" data-le="text" data-v="' + E(f.key) + '">' + E(v) + '</textarea>'
        : '<input type="text" class="sb-input" id="' + id + '" maxlength="2000" data-le="text" data-v="' + E(f.key) + '" value="' + E(v) + '">') +
    '</div>';
  },

  /* ---------------- Eventos ---------------- */
  onInput(e) {
    const t = e.target, act = t.getAttribute && t.getAttribute('data-le');
    if (!act || !this.st) return;
    const d = this.st.draft, k = t.getAttribute('data-v');
    if (act === 'text' && e.type === 'input') {
      const f = this.st.byKey[k];
      if (!f) return;
      if (t.value === f.value) delete d.text[k]; else d.text[k] = t.value;
      this.push();
      const row = t.closest('.sb-field');
      const has = row && row.querySelector('.le-restore');
      if (row && !!has !== this.changed(f)) {
        if (has) has.remove();
        else row.querySelector('.sb-lbl-row').insertAdjacentHTML('beforeend', '<button type="button" class="sb-link le-restore" data-le="restore" data-v="' + this.esc(k) + '">Original</button>');
      }
    } else if (act === 'seo-in' && e.type === 'input') {
      d.seo[k] = t.value;
      this.push();
    } else if (act === 'show' && e.type === 'change') {
      this.setHidden(k, !t.checked);
      const it = t.closest('.sb-item');
      if (it) it.classList.toggle('is-off', !t.checked);
      this.post({ type: 'lc:focus', key: k });
    } else if (act === 'file' && e.type === 'change') {
      const file = t.files && t.files[0];
      t.value = '';
      if (file) this.upload(k, t.getAttribute('data-what'), file);
    }
  },

  setHidden(id, off) {
    const d = this.st.draft;
    d.hidden = d.hidden.filter(x => x !== id);
    if (off) d.hidden.push(id);
    this.push();
  },

  async onClick(e) {
    const b = e.target.closest('[data-le]');
    if (!b || !this.st || b.tagName === 'INPUT' || b.tagName === 'TEXTAREA') return;
    const act = b.getAttribute('data-le'), v = b.getAttribute('data-v');
    const st = this.st;
    switch (act) {
      case 'close': this.close(); break;
      case 'save': this.save(); break;
      case 'device':
        st.device = v;
        document.getElementById('le-frame-wrap').setAttribute('data-device', v);
        document.querySelectorAll('#le-root .sb-dev').forEach(x => { const on = x.getAttribute('data-v') === v; x.classList.toggle('is-on', on); x.setAttribute('aria-pressed', on); });
        break;
      case 'open': st.view = 'sec'; st.sec = v; this.renderPanel(); this.post({ type: 'lc:focus', key: v }); document.getElementById('le-panel').scrollTop = 0; break;
      case 'seo': st.view = 'seo'; this.renderPanel(); break;
      case 'back': st.view = 'list'; this.renderPanel(); break;
      case 'eye': this.setHidden(v, !this.isHidden(v)); this.renderPanel(); if (!this.isHidden(v)) this.post({ type: 'lc:focus', key: v }); break;
      case 'restore':
        delete st.draft.text[v];
        delete st.draft.media[v];
        this.push();
        this.renderPanel();
        break;
      case 'reset-sec': {
        const ok = await UI.confirm({ title: '¿Volver la sección al original?', message: 'Sus textos y videos vuelven a los de fábrica y se muestran todos sus puntos. Se publica al guardar.', confirmText: 'Volver al original', danger: true });
        if (!ok || !this.st) return;
        const s = st.sections.find(x => x.id === v);
        st.fields.filter(f => f.sec === v).forEach(f => { delete st.draft.text[f.key]; delete st.draft.media[f.key]; });
        if (s) st.draft.hidden = st.draft.hidden.filter(x => s.items.indexOf(x) < 0);
        this.push();
        this.renderPanel();
        break;
      }
      case 'reset-all': {
        const ok = await UI.confirm({ title: '¿Volver toda la landing al original?', message: 'Todos los textos, videos y secciones vuelven a los de fábrica. Se publica al guardar.', confirmText: 'Volver al original', danger: true });
        if (!ok || !this.st) return;
        st.draft = { text: {}, media: {}, hidden: [], seo: {} };
        this.push();
        this.renderPanel();
        break;
      }
    }
  },

  /* ---------------- Fotos y videos ---------------- */
  async upload(key, what, file) {
    try {
      let url;
      if (what === 'src') {
        if (!/^video\/(mp4|webm)$/.test(file.type)) throw new Error('El video debe ser MP4 o WebM.');
        if (file.size > this.MAX_VIDEO) throw new Error('El video pesa más de 50 MB. Comprímelo o recórtalo e inténtalo de nuevo.');
        this.status('Subiendo video…');
        url = await DB.uploadVideo(file, this.FOLDER);
      } else {
        if (!/^image\//.test(file.type)) throw new Error('Elige una imagen JPG, PNG o WebP.');
        this.status('Subiendo imagen…');
        const dataUrl = await readAndCompressImage(file, 1600, 0.84);
        url = await DB.uploadImage(dataUrl, this.FOLDER);
      }
      if (!this.st) return;
      if (!this.okUrl(url)) throw new Error('El enlace del archivo no es válido.');
      const m = Object.assign({}, this.st.draft.media[key] || {});
      m[what] = url;
      this.st.draft.media[key] = m;
      this.push();
      this.renderPanel();
      this.status(what === 'src' ? 'Video listo. Recuerda guardar.' : 'Imagen lista. Recuerda guardar.');
    } catch (err) {
      this.status('');
      UI.toast(this.errMsg(err), 'error');
    }
  },

  /* ---------------- Guardar ---------------- */
  status(t) { const s = document.getElementById('le-status'); if (s) s.textContent = t || ''; },

  updateSave() {
    const b = document.getElementById('le-save');
    if (!b || !this.st) return;
    const d = this.dirty();
    b.disabled = this.st.saving || !this.st.ready || !d;
    b.classList.toggle('is-dirty', d);
    if (d) this.status('Cambios sin publicar');
    else if (/sin publicar/.test((document.getElementById('le-status') || {}).textContent || '')) this.status('');
  },

  errMsg(error) {
    const m = String((error && (error.message || error.details)) || error || '');
    if (/landing_contenido/.test(m) && /relation|does not exist|schema cache|PGRST205|42P01/i.test(m + ' ' + (error && error.code))) return 'Falta ejecutar la migración 29 (supabase/migrations/20261112000029_landing_editable.sql) en el SQL Editor de Supabase.';
    if (/landing_contenido_valido/.test(m)) return 'Algún texto o enlace no es válido (muy largo o con un enlace que no empieza con https://).';
    return (typeof DB !== 'undefined' && DB.errorText) ? DB.errorText(error) : m;
  },

  async save() {
    const st = this.st;
    if (!st || st.saving || !this.dirty()) return;
    st.saving = true;
    this.updateSave();
    this.status('Publicando…');
    const contenido = this.pack(st.draft);
    try {
      const { data, error } = await DB.client().from('landing_contenido').update({ contenido }).eq('id', 1).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('No se guardó: solo el superadministrador puede cambiar la landing, o falta la fila de la migración 29.');
      if (!this.st) return;
      st.saved = this.normalize(contenido);
      DB.log && DB.log('Editó la landing', Object.keys(contenido.text || {}).length + ' textos cambiados', { tenantId: null });
      this.status('Publicado');
      UI.toast('Landing publicada. Ya se ve en reservalope.com.');
    } catch (err) {
      this.status('');
      UI.toast(this.errMsg(err), 'error');
    } finally {
      if (this.st) { st.saving = false; this.updateSave(); }
    }
  }
};
