/* Utilidades de interfaz: avisos (toast), confirmaciones y escape de texto */
const UI = {
  esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  /* CSV / Excel: un texto que empieza con = + - @ (o tab / retorno) se
     interpreta como fórmula al abrir el archivo. Se le antepone ' para que
     quede como texto. Los números (incluidos negativos como "-5.0") no se tocan. */
  safeText(v) {
    const s = v == null ? '' : String(v);
    if (typeof v === 'number') return s;
    if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+([.,]\d+)?%?$/.test(s)) return "'" + s;
    return s;
  },
  csvCell(v) { return '"' + this.safeText(v).replace(/"/g, '""') + '"'; },
  csv(rows) { return rows.map(r => r.map(v => this.csvCell(v)).join(',')).join('\r\n'); },

  /* ---------------- Vocabulario del rubro (js/core/vocab.js) ----------------
     UI.v('Nuev{o:staff} {staff}') → "Nuevo barbero" / "Nueva manicurista".
     Además de las llaves de Vocab.fmt ({staff}, {Client}, {servicePlural}…)
     acepta concordancia con el artículo de una palabra (staff, business):
       {o:k} o/a · {os:k} os/as · {el:k} el/la · {El:k} El/La · {del:k} del/de la
       {al:k} al/a la · {un:k} un/una · {Un:k} Un/Una · {este:k} este/esta
     y {inServiceShort} / {InServiceShort}: el estado de atención sin "ahora"
     ("En sillón", "En consulta"). Los nombres internos no cambian. */
  GENDER: {
    o: ['o', 'a'], os: ['os', 'as'], el: ['el', 'la'], El: ['El', 'La'], del: ['del', 'de la'],
    al: ['al', 'a la'], un: ['un', 'una'], Un: ['Un', 'Una'], este: ['este', 'esta'], Este: ['Este', 'Esta']
  },
  v(str) {
    let s = String(str == null ? '' : str);
    const V = window.Vocab;
    if (!V) return s.replace(/\{(\w+):\w+\}/g, (m, f) => (this.GENDER[f] || [''])[0]).replace(/\{(\w+)\}/g, '$1');
    s = s.replace(/\{(\w+):(\w+)\}/g, (m, form, key) => {
      const g = this.GENDER[form];
      if (!g) return m;
      // Sin artículo en el vocabulario (service, client): se deduce por la terminación
      const art = V.t(key + 'Article');
      const fem = art === 'la' || (art !== 'el' && /(a|ión|ad|ud)$/i.test(V.t(key)));
      return g[fem ? 1 : 0];
    });
    s = s.replace(/\{([Ii])nServiceShort\}/g, (m, c) => {
      const w = V.t('inService').replace(/\s+ahora$/i, '');
      return c === 'I' ? w.charAt(0).toLocaleUpperCase('es-PE') + w.slice(1) : w;
    });
    return V.fmt(s);
  },
  // Igual que v(), pero con las palabras de OTRO negocio (consola, permisos, reportes)
  // sin cambiar el vocabulario activo de la página. tenant null = palabras genéricas.
  vFor(tenant, str) {
    const V = window.Vocab;
    if (!V) return this.v(str);
    const prev = { businessType: V.type(), labels: V.current() };
    V.set(tenant || { businessType: 'otro' });
    try { return this.v(str); } finally { V.set(prev); }
  },
  // Palabras de un negocio (objeto con staff, client, service…); null = genéricas
  wordsFor(tenant) {
    const V = window.Vocab;
    if (!V) return {};
    const prev = { businessType: V.type(), labels: V.current() };
    V.set(tenant || { businessType: 'otro' });
    try { return V.current(); } finally { V.set(prev); }
  },
  cap(s) { s = String(s == null ? '' : s); return s.charAt(0).toLocaleUpperCase('es-PE') + s.slice(1); },
  // Pinta los textos marcados del rubro: data-v / data-v-fmt / data-v-attr (Vocab) y data-vx (UI.v)
  applyVocab(root) {
    const r = root || document;
    if (window.Vocab) window.Vocab.apply(r);
    r.querySelectorAll('[data-vx]').forEach(el => { el.textContent = this.v(el.getAttribute('data-vx')); });
    r.querySelectorAll('[data-vx-attr]').forEach(el => {
      String(el.getAttribute('data-vx-attr') || '').split(';').forEach(pair => {
        const i = pair.indexOf(':');
        if (i > 0) el.setAttribute(pair.slice(0, i).trim(), this.v(pair.slice(i + 1).trim()));
      });
    });
  },

  // Para meter texto dentro de onclick="Fn('...')"
  arg(str) {
    return String(str == null ? '' : str).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
  },

  toast(message, type) {
    let wrap = document.getElementById('ui-toasts');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'ui-toasts';
      wrap.className = 'ui-toasts';
      wrap.setAttribute('role', 'status');
      wrap.setAttribute('aria-live', 'polite');
      document.body.appendChild(wrap);
    }
    const el = document.createElement('div');
    const kind = type || 'success';
    el.className = 'ui-toast is-' + kind;
    const icon = kind === 'error' ? 'alert' : (kind === 'info' ? 'alert' : 'checkCircle');
    el.innerHTML = (typeof ic === 'function' ? ic(icon) : '') + '<span>' + this.esc(message) + '</span>';
    wrap.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
      el.classList.remove('is-in');
      setTimeout(() => el.remove(), 300);
    }, kind === 'error' ? 5200 : 3400);
  },

  /* Confirmación accesible con el modal del sistema. Devuelve una promesa. */
  confirm(opts) {
    const o = Object.assign({ title: '¿Confirmar?', message: '', confirmText: 'Confirmar', danger: false }, opts || {});
    return new Promise(resolve => {
      UI._confirmResolve = (v) => { UI._confirmResolve = null; ModalComponent.close(); resolve(v); };
      ModalComponent.open(
        '<div class="crm-modal-header"><h3 style="font-size:1.35rem;">' + this.esc(o.title) + '</h3>' +
          '<button type="button" class="btn-dark btn-xs" onclick="UI._confirmResolve(false)" aria-label="Cerrar">' + ic('x') + '</button></div>' +
        '<p style="margin-bottom:22px;">' + this.esc(o.message) + '</p>' +
        '<div class="modal-actions">' +
          '<button type="button" class="btn-dark" onclick="UI._confirmResolve(false)">Cancelar</button>' +
          '<button type="button" class="' + (o.danger ? 'btn-danger' : 'btn-golden') + '" onclick="UI._confirmResolve(true)">' + this.esc(o.confirmText) + '</button>' +
        '</div>'
      );
    });
  },

  fmtDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: 'numeric' }) + ' · ' +
      d.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  },

  copy(text, okMsg) {
    const done = () => this.toast(okMsg || 'Copiado al portapapeles.');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, () => this._fallbackCopy(text, done));
    } else {
      this._fallbackCopy(text, done);
    }
  },

  _fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { this.toast('No se pudo copiar. Selecciona el texto manualmente.', 'error'); }
    ta.remove();
  }
};
