/* Página de ingreso: login, bloqueo por intentos y cambio de contraseña temporal */
const Login = {
  pendingUser: null,

  init() {
    DB.load();
    Auth.seedIfNeeded();
    this.applyBrand();

    const params = new URLSearchParams(window.location.search);
    this.nextTab = params.get('tab') || '';
    const msg = params.get('msg');
    if (msg) this.showMsg(msg);

    // Si ya hay una sesión válida, ir directo al CRM
    const s = Auth.readSession();
    if (s && s.userId && Date.now() < s.exp && Date.now() - (s.lastActive || 0) < Auth.IDLE_MINUTES * 60000) {
      const u = Auth.findById(s.userId);
      if (u && u.active && !u.mustChangePassword) return this.go();
    }

    document.getElementById('login-form').addEventListener('submit', (e) => this.submit(e));
    document.getElementById('change-form').addEventListener('submit', (e) => this.submitChange(e));
    document.getElementById('change-cancel').addEventListener('click', () => this.backToLogin());
    ['new-pass', 'new-pass2'].forEach(id => document.getElementById(id).addEventListener('input', () => this.checkRules()));
    document.querySelectorAll('.pass-toggle').forEach(btn => btn.addEventListener('click', () => {
      const inp = document.getElementById(btn.dataset.target);
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.setAttribute('aria-pressed', String(show));
      btn.setAttribute('aria-label', show ? 'Ocultar contraseña' : 'Mostrar contraseña');
    }));
    document.getElementById('login-email').focus();
  },

  /* Marca: si se llega desde la web de una barbería, se muestra su logo y color */
  applyBrand() {
    let slug = new URLSearchParams(window.location.search).get('b');
    if (!slug) { try { slug = sessionStorage.getItem(DB.PUBLIC_SLUG_KEY); } catch (e) { slug = null; } }
    const t = slug ? DB.tenantBySlug(slug) : null;
    if (!t) return;
    TenantBrand.applyPalette(TenantBrand.paletteOf(t));
    const box = document.getElementById('login-logo');
    if (t.logo) box.innerHTML = '<img class="login-logo-img" src="' + UIx.esc(t.logo) + '" alt="' + UIx.esc(t.name) + '" />';
    else box.innerHTML = '<span class="brand-wordmark is-lg">' + UIx.esc(t.name) + '</span>';
    const back = document.getElementById('login-back');
    if (back) back.href = 'index.html?b=' + encodeURIComponent(t.slug);
  },

  showMsg(text) {
    const el = document.getElementById('login-msg');
    el.textContent = text;
    el.hidden = false;
  },

  setBusy(btnId, busy) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = busy;
    btn.classList.toggle('is-busy', busy);
  },

  submit(e) {
    e.preventDefault();
    const err = document.getElementById('login-error');
    err.textContent = '';
    const email = document.getElementById('login-email').value.trim();
    const pass = document.getElementById('login-pass').value;
    if (!email || !pass) { err.textContent = 'Escribe tu correo y contraseña.'; return; }

    this.setBusy('login-submit', true);
    // Pequeña pausa para que el estado de carga se pinte antes del cálculo del hash
    setTimeout(() => {
      const res = Auth.login(email, pass);
      this.setBusy('login-submit', false);
      if (!res.ok) {
        err.textContent = res.error;
        document.getElementById('login-pass').value = '';
        document.getElementById('login-pass').focus();
        return;
      }
      if (res.user.mustChangePassword) {
        this.pendingUser = res.user;
        document.getElementById('login-form').hidden = true;
        document.getElementById('change-form').hidden = false;
        document.getElementById('change-sub').textContent = 'Hola, ' + res.user.name + '. Tu contraseña actual es temporal. Crea una nueva para continuar.';
        document.getElementById('new-pass').focus();
        this.checkRules();
        return;
      }
      this.go();
    }, 30);
  },

  checkRules() {
    const p1 = document.getElementById('new-pass').value;
    const p2 = document.getElementById('new-pass2').value;
    const rules = { len: p1.length >= 8, mix: /[A-Za-z]/.test(p1) && /[0-9]/.test(p1), match: !!p1 && p1 === p2 };
    document.querySelectorAll('#pass-rules li').forEach(li => li.classList.toggle('is-ok', !!rules[li.dataset.rule]));
    return rules;
  },

  submitChange(e) {
    e.preventDefault();
    const err = document.getElementById('change-error');
    const u = this.pendingUser;
    if (!u) return this.backToLogin();
    const p1 = document.getElementById('new-pass').value;
    const p2 = document.getElementById('new-pass2').value;
    const v = Auth.validatePassword(p1);
    if (v) { err.textContent = v; return; }
    if (p1 !== p2) { err.textContent = 'Las contraseñas no coinciden.'; return; }
    if (Auth.verifyPassword(p1, u.passHash)) { err.textContent = 'La nueva contraseña debe ser distinta a la temporal.'; return; }
    Auth.setPassword(u, p1, false);
    Auth.user = u;
    DB.log('Cambió su contraseña temporal', 'Primer ingreso completado.', { actorId: u.id, actorName: u.name, actorRole: u.role, tenantId: u.tenantId });
    this.go();
  },

  backToLogin() {
    try { localStorage.removeItem(Auth.SESSION_KEY); } catch (e) {}
    this.pendingUser = null;
    document.getElementById('change-form').hidden = true;
    document.getElementById('login-form').hidden = false;
    document.getElementById('login-pass').value = '';
    document.getElementById('login-email').focus();
  },

  go() {
    try { sessionStorage.setItem('BARBERSUITE_WELCOME', '1'); } catch (e) {}
    const s = Auth.readSession();
    const u = s ? Auth.findById(s.userId) : null;
    // El superadministrador trabaja en su propia consola (Reservalope)
    if (u && u.role === 'SUPERADMIN' && (!this.nextTab || this.nextTab === 'dashboard')) return window.location.replace('reservalope.html');
    window.location.replace('crm.html' + (this.nextTab ? '?tab=' + encodeURIComponent(this.nextTab) : ''));
  }
};

window.addEventListener('DOMContentLoaded', () => Login.init());
