/* Arranque de la web pública y del CRM. Los datos vienen de Supabase, así que
   se espera a que lleguen antes de pintar. */
const App = {
  // Mensaje a pantalla completa cuando no se pueden cargar los datos
  fatal(msg) {
    const box = document.getElementById('main') || document.querySelector('.crm-main') || document.body;
    const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    box.innerHTML = '<section class="unavailable"><div class="container"><h1>No pudimos cargar la información</h1>' +
      '<p>' + esc(msg) + '</p><p><button type="button" class="btn-golden" onclick="location.reload()">Reintentar</button></p></div></section>';
    document.body.classList.add('auth-ok');
  }
};

window.addEventListener('DOMContentLoaded', async () => {
  const activePage = document.body.getAttribute('data-page');
  if (activePage === 'login') return; // lo maneja js/pages/login.js

  /* ---------------- CRM: requiere sesión ---------------- */
  if (activePage === 'crm') {
    let user;
    try {
      user = await Auth.requireSession();
      if (!user) return; // redirigido al login
      await DB.init(Auth.activeTenantId());
    } catch (e) {
      console.error(e);
      return App.fatal(DB.errorText(e));
    }
    TenantBrand.applyCrm(DB.tenant);

    const navParams = AppRouter.consumeNavParams();
    sessionStorage.removeItem('GOLDEN_CRM_TARGET_TAB');

    Guard.install();
    AdminUI.init();
    WhatsAppBot.init();
    if (Auth.can('ai.use') && typeof AIAdvisor !== 'undefined' && document.getElementById('crm-pane-ai-advisor')) {
      AIAdvisor.init();
    }
    // Si otra persona o la web cambia algo, se repinta con los datos nuevos
    DB.onReload = () => {
      TenantBrand.applyCrm(DB.tenant);
      CRM.renderAll();
    };
    CRM.switchTab(navParams.tab || 'dashboard');
    document.body.classList.add('auth-ok');

    try {
      const welcome = sessionStorage.getItem('BARBERSUITE_WELCOME');
      if (welcome) {
        sessionStorage.removeItem('BARBERSUITE_WELCOME');
        UI.toast('Hola, ' + user.name + '. Ingresaste como ' + Auth.ROLE_LABEL[user.role].toLowerCase() + '.');
      }
    } catch (e) { /* sin almacenamiento */ }
    return;
  }

  /* ---------------- Web pública: barbería según ?b=slug ---------------- */
  let res;
  try {
    res = await DB.initPublic();
  } catch (e) {
    console.error(e);
    return App.fatal(DB.errorText(e));
  }
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
      PublicBooking.initCaptcha();
    }
  }
  TenantBrand.rewriteLinks(DB.tenant.slug);
});
