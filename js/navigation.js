const AppRouter = {
  pageMap: {
    'inicio': 'index.html',
    'servicios': 'servicios.html',
    'barberos': 'barberos.html',
    'reservar': 'reservar.html',
    'mi-cita': 'consultar-cita.html'
  },

  goPublic(viewId, params = {}) {
    const targetFile = this.pageMap[viewId] || 'index.html';
    const p = Object.assign({}, params);
    // Mantener la barbería activa en la web pública (?b=slug o /<enlace>/)
    const slug = (typeof DB !== 'undefined' && DB.tenant) ? DB.tenant.slug : null;
    if (Object.keys(params).length > 0) {
      sessionStorage.setItem('GOLDEN_NAV_PARAMS', JSON.stringify(params));
    }
    if (slug && !p.b) { window.location.href = Routes.web(slug, targetFile, p); return; }
    const query = new URLSearchParams(p).toString();
    window.location.href = targetFile + (query ? '?' + query : '');
  },

  openCRM(defaultTab = 'dashboard') {
    if (defaultTab) {
      sessionStorage.setItem('GOLDEN_CRM_TARGET_TAB', defaultTab);
    }

    const currentPage = document.body.getAttribute('data-page');
    if (currentPage === 'crm' && typeof CRM !== 'undefined') {
      if (defaultTab) CRM.switchTab(defaultTab);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    window.location.href = Routes.crm(Routes.pathSlug(), { tab: defaultTab });
  },

  consumeNavParams() {
    const urlParams = new URLSearchParams(window.location.search);
    let stored = {};
    try {
      const raw = sessionStorage.getItem('GOLDEN_NAV_PARAMS');
      if (raw) {
        stored = JSON.parse(raw);
        sessionStorage.removeItem('GOLDEN_NAV_PARAMS');
      }
    } catch (e) {
      stored = {};
    }
    return {
      serviceId: urlParams.get('service') || stored.service || null,
      barberName: urlParams.get('barber') || stored.barber || null,
      tab: urlParams.get('tab') || sessionStorage.getItem('GOLDEN_CRM_TARGET_TAB') || null
    };
  }
};

/* --- Interacciones globales de la interfaz --------------------------------- */
const SiteUI = {
  init() {
    const header = document.querySelector('.site-header');
    const nav = document.getElementById('site-nav');
    const toggle = document.querySelector('.nav-toggle');

    if (toggle && nav) {
      const setOpen = (open) => {
        nav.classList.toggle('is-open', open);
        document.body.classList.toggle('nav-open', open);
        toggle.setAttribute('aria-expanded', String(open));
        toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
        toggle.innerHTML = ic(open ? 'x' : 'menu');
      };
      toggle.addEventListener('click', () => setOpen(!nav.classList.contains('is-open')));
      nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setOpen(false)));
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
      window.addEventListener('resize', () => { if (window.innerWidth > 960) setOpen(false); });
    }

    if (header) {
      const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
      onScroll();
      window.addEventListener('scroll', onScroll, { passive: true });
    }

    const isField = (el) => el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(el.type);
    document.addEventListener('focusin', (e) => { if (isField(e.target)) document.body.classList.add('is-typing'); });
    document.addEventListener('focusout', () => setTimeout(() => {
      if (!isField(document.activeElement)) document.body.classList.remove('is-typing');
    }, 60));

    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce && 'IntersectionObserver' in window) {
      document.documentElement.classList.add('js-reveal');
      const io = new IntersectionObserver((entries) => {
        entries.forEach(en => {
          if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      SiteUI.observeReveal = (root) => (root || document).querySelectorAll('.reveal:not(.is-visible)').forEach(el => io.observe(el));
      SiteUI.observeReveal();
    } else {
      SiteUI.observeReveal = () => {};
    }
  },
  observeReveal() {}
};

window.addEventListener('DOMContentLoaded', () => SiteUI.init());
