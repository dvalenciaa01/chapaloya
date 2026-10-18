/* Utilidades de interfaz: avisos (toast), confirmaciones y escape de texto */
const UI = {
  esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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
