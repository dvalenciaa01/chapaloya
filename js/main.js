window.addEventListener('DOMContentLoaded', () => {
  const activePage = document.body.getAttribute('data-page');
  if (activePage === 'login') return; // lo maneja js/pages/login.js

  /* ---------------- CRM: requiere sesión ---------------- */
  if (activePage === 'crm') {
    const user = Auth.requireSession();
    if (!user) return; // redirigido al login
    DB.init(Auth.activeTenantId());
    TenantBrand.applyCrm(DB.tenant);

    const navParams = AppRouter.consumeNavParams();
    sessionStorage.removeItem('GOLDEN_CRM_TARGET_TAB');

    Guard.install();
    AdminUI.init();
    WhatsAppBot.init();
    if (Auth.can('ai.use') && typeof AIAdvisor !== 'undefined' && document.getElementById('crm-pane-ai-advisor')) {
      AIAdvisor.init();
    }
    CRM.switchTab(navParams.tab || 'dashboard');
    document.body.classList.add('auth-ok');

    try {
      const welcome = sessionStorage.getItem('BARBERSUITE_WELCOME');
      if (welcome) {
        sessionStorage.removeItem('BARBERSUITE_WELCOME');
        UI.toast('Hola, ' + user.name + '. Ingresaste como ' + Auth.ROLE_LABEL[user.role].toLowerCase() + '.');
      }
    } catch (e) {}
    return;
  }

  /* ---------------- Web pública: barbería según ?b=slug ---------------- */
  const res = DB.initPublic();
  if (!res.ok) {
    TenantBrand.showUnavailable(res);
    return;
  }
  TenantBrand.applyPublic(DB.tenant);
  WhatsAppBot.init();

  const navParams = AppRouter.consumeNavParams();
  if (typeof PublicBooking !== 'undefined') {
    PublicBooking.renderPublicViews();
    if (activePage === 'reservar') {
      PublicBooking.applyPreselections(navParams);
    }
  }
  TenantBrand.rewriteLinks(DB.tenant.slug);
});
