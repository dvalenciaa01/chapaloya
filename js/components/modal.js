const ModalComponent = {
  lastFocus: null,

  open(htmlContent, opts = {}) {
    const contentEl = document.getElementById('crm-modal-content');
    const overlayEl = document.getElementById('crm-modal-overlay');
    if (!contentEl || !overlayEl) return;
    this.lastFocus = document.activeElement;
    contentEl.innerHTML = htmlContent;
    contentEl.classList.toggle('is-wide', !!opts.wide);
    contentEl.setAttribute('role', 'dialog');
    contentEl.setAttribute('aria-modal', 'true');
    overlayEl.classList.add('open');
    document.body.style.overflow = 'hidden';
    const focusable = contentEl.querySelector('input, select, textarea, button');
    if (focusable) setTimeout(() => focusable.focus(), 30);
  },

  close() {
    const overlayEl = document.getElementById('crm-modal-overlay');
    if (overlayEl) overlayEl.classList.remove('open');
    document.body.style.overflow = '';
    if (this.lastFocus && typeof this.lastFocus.focus === 'function') this.lastFocus.focus();
  }
};

document.addEventListener('keydown', (e) => {
  const overlayEl = document.getElementById('crm-modal-overlay');
  if (e.key === 'Escape' && overlayEl && overlayEl.classList.contains('open')) ModalComponent.close();
});
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'crm-modal-overlay') ModalComponent.close();
});
