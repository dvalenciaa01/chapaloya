/* ==========================================================================
   Reservalope · Consola del superadministrador
   Dashboard global, cartera de negocios (de cualquier rubro), ficha
   individual, alertas, usuarios, historial y plataforma. La consola habla de
   "negocios" y usa palabras genéricas (profesional, cliente); la ficha de un
   negocio usa las palabras de su rubro (UI.vFor).
   ========================================================================== */
var Guard = window.Guard || { deny(msg) { UI.toast(msg || 'No tienes permiso para realizar esta acción.', 'error'); } };

const Reservalope = {
  /* Paleta de la marca Reservalope, igual que la landing: fondo claro y azul; en
     modo oscuro, fondo casi negro y azul más claro. La elección se comparte con la
     landing (localStorage 'reservalope-theme'); sin elección, sigue al sistema. */
  PALETTES: {
    light: { primary: '#FFFFFF', secondary: '#3B3BF2', tertiary: '#0E0E12' },
    dark: { primary: '#0C0C0F', secondary: '#7373FF', tertiary: '#F2F2F5' }
  },
  THEME_KEY: 'reservalope-theme',
  themeMode() {
    let t = null;
    try { t = localStorage.getItem(this.THEME_KEY); } catch (e) { t = null; }
    if (t === 'light' || t === 'dark') return t;
    return window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  },
  applyTheme() {
    const mode = this.themeMode();
    TenantBrand.applyPalette(this.PALETTES[mode]);
    // Colores de estado legibles en cada modo (los mismos que usa el CRM)
    const light = mode === 'light';
    const st = document.documentElement.style;
    st.setProperty('--success-text', light ? '#166534' : '#4ADE80');
    st.setProperty('--danger-text', light ? '#B91C1C' : '#F87171');
    st.setProperty('--warn-text', light ? '#92400E' : '#FBBF24');
    document.documentElement.setAttribute('data-crm-mode', mode);
    document.documentElement.style.colorScheme = mode;
    const btn = document.getElementById('rl-theme-toggle');
    if (btn) {
      btn.setAttribute('aria-pressed', String(mode === 'dark'));
      btn.setAttribute('aria-label', mode === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro');
      btn.innerHTML = ic(mode === 'dark' ? 'sun' : 'moon');
    }
  },
  toggleTheme() {
    const next = this.themeMode() === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(this.THEME_KEY, next); } catch (e) { /* sin almacenamiento */ }
    this.applyTheme();
    if (typeof this.refresh === 'function') this.refresh();   // los gráficos leen los colores al pintarse
  },
  pane: 'dashboard',
  preset: '30d',
  from: null,
  to: null,
  detailId: null,

  async init() {
    let user;
    try {
      user = await Auth.requireSession();
      if (!user) return;
      if (user.role !== 'SUPERADMIN') { window.location.replace('crm.html'); return; }
      await DB.initConsole();
    } catch (e) {
      console.error(e);
      const main = document.getElementById('rl-main') || document.body;
      main.innerHTML = '<div class="empty-state" style="margin:40px auto;max-width:520px;"><strong>No pudimos cargar la información</strong>' +
        UI.esc(DB.errorText(e)) + '<p><button type="button" class="btn-golden" onclick="location.reload()">Reintentar</button></p></div>';
      document.body.classList.add('auth-ok');
      return;
    }
    DB.onReload = () => { AdminUI.renderHeader(); this.refresh(); };
    this.applyTheme();
    // Vocabulario genérico de plataforma (cada ficha usa el de su negocio)
    if (window.Vocab) Vocab.set({ businessType: 'otro' });
    UI.applyVocab(document);

    AdminUI.init();
    AdminUI.renderHeader();
    // Al crear/editar/suspender un negocio desde los modales compartidos, refrescar la consola
    AdminUI.renderTenants = () => this.refresh();

    try {
      const p = JSON.parse(localStorage.getItem('RESERVALOPE_PERIOD') || 'null');
      if (p && p.preset) { this.preset = p.preset; this.from = p.from; this.to = p.to; }
    } catch (e) {}

    const d = document.getElementById('rl-date');
    if (d) d.textContent = Charts.dateLong(DB.todayISO());
    this.mountPeriod();
    this.fillPlanFilter();
    this.fillRubroFilter();
    window.addEventListener('hashchange', () => this.fromHash());
    this.fromHash();
    document.body.classList.add('auth-ok');

    try {
      if (sessionStorage.getItem('BARBERSUITE_WELCOME')) {
        sessionStorage.removeItem('BARBERSUITE_WELCOME');
        UI.toast('Bienvenido a Reservalope, ' + user.name + '.');
      }
    } catch (e) {}
  },

  /* ---------------- Navegación (con enlaces directos #pane / #negocio/id; #barberia/id sigue funcionando) ---------------- */
  fromHash() {
    const h = (window.location.hash || '').replace('#', '');
    if (h.indexOf('negocio/') === 0 || h.indexOf('barberia/') === 0) {
      const parts = h.split('/');
      const id = parts[1];
      if (DB.tenantById(id)) {
        if (this.pane !== 'detail' || this.detailId !== id) this.show('detail', id);
        // #negocio/<id>/crm abre directamente "Personalizar CRM" (enlace desde Configuración del CRM)
        if (parts[2] === 'crm') this.openCrmEditor(id);
        return;
      }
    }
    if (h === 'reportes' || h.indexOf('reportes/') === 0) {
      const id = h.split('/')[1];
      return this.show('reports', id && DB.tenantById(id) ? id : 'ALL');
    }
    const valid = ['dashboard', 'tenants', 'alerts', 'users', 'audit', 'platform'];
    this.show(valid.includes(h) ? h : 'dashboard');
  },

  go(pane, id) {
    const target = pane === 'detail' ? 'negocio/' + id
      : pane === 'reports' ? 'reportes' + (id && id !== 'ALL' ? '/' + id : '')
      : pane;
    if (window.location.hash.replace('#', '') === target) this.show(pane, id);
    else window.location.hash = target;
  },

  show(pane, id) {
    this.pane = pane;
    if (pane === 'detail') this.detailId = id;
    if (pane === 'reports') this.reportScope = id || 'ALL';
    document.querySelectorAll('.crm-pane').forEach(p => p.classList.remove('active-pane'));
    const el = document.getElementById('rl-pane-' + pane);
    if (el) el.classList.add('active-pane');
    const navKey = pane === 'detail' ? 'tenants' : pane;
    document.querySelectorAll('.crm-nav-btn[data-rl]').forEach(b => {
      const on = b.dataset.rl === navKey;
      b.classList.toggle('active', on);
      if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    this.render();
    window.scrollTo({ top: 0 });
    const main = document.getElementById('rl-main');
    if (main) main.focus({ preventScroll: true });
  },

  refresh() { this.render(); },

  render() {
    this.renderBadges();
    if (this.pane === 'dashboard') this.renderDashboard();
    else if (this.pane === 'tenants') this.renderTenants();
    else if (this.pane === 'detail') this.renderDetail();
    else if (this.pane === 'alerts') this.renderAlerts();
    else if (this.pane === 'users') AdminUI.renderUsers();
    else if (this.pane === 'audit') AdminUI.renderAudit(false);
    else if (this.pane === 'platform') this.renderPlatform();
    else if (this.pane === 'reports') this.renderReports();
  },

  /* ---------------- Reportes (por negocio o comparativo) ---------------- */
  renderReports() {
    ReportBuilder.mount(document.getElementById('rl-reports-root'), {
      mode: 'console',
      tenantId: this.reportScope || 'ALL',
      money: true,
      canExport: () => !!(Auth.user && Auth.user.role === 'SUPERADMIN')
    });
  },

  // El selector de negocio del reporte actualiza el enlace sin recargar la vista
  setReportHash(scope) {
    this.reportScope = scope;
    const target = '#reportes' + (scope && scope !== 'ALL' ? '/' + scope : '');
    try { history.replaceState(null, '', target); } catch (e) { /* sin historial */ }
  },

  renderBadges() {
    const root = DB.load();
    const t = document.getElementById('rl-badge-tenants');
    if (t) t.textContent = root.tenants.length;
    const a = document.getElementById('rl-badge-alerts');
    if (a) {
      const n = Analytics.alerts().filter(x => x.severity !== 'info').length;
      a.textContent = n;
      a.classList.toggle('has-alerts', n > 0);
    }
  },

  /* ---------------- Período ---------------- */
  mountPeriod() {
    const tpl = document.getElementById('rl-period-tpl');
    document.querySelectorAll('.rl-period-slot').forEach((slot, idx) => {
      const node = tpl.content.cloneNode(true);
      const presets = node.querySelector('.rl-presets');
      presets.innerHTML = Analytics.PRESETS.map(p =>
        '<button type="button" class="btn-dark" data-preset="' + p.key + '" aria-pressed="false">' + p.label + '</button>').join('');
      // ids únicos por copia
      const f = node.querySelector('.rl-from'), t = node.querySelector('.rl-to');
      f.id = 'rl-from-' + idx; t.id = 'rl-to-' + idx;
      node.querySelector('label[for="rl-from"]').setAttribute('for', f.id);
      node.querySelector('label[for="rl-to"]').setAttribute('for', t.id);
      slot.appendChild(node);
    });
    document.querySelectorAll('.rl-presets button').forEach(b => b.addEventListener('click', () => this.setPreset(b.dataset.preset)));
    document.querySelectorAll('.rl-from, .rl-to').forEach(inp => inp.addEventListener('change', (e) => {
      const box = e.target.closest('.rl-custom');
      this.from = box.querySelector('.rl-from').value;
      this.to = box.querySelector('.rl-to').value;
      this.savePeriod();
      this.syncPeriodUI();
      this.render();
    }));
    this.syncPeriodUI();
  },

  setPreset(key) {
    this.preset = key;
    if (key === 'custom' && (!this.from || !this.to)) {
      this.to = DB.todayISO();
      this.from = DB.addDays(this.to, -29);
    }
    this.savePeriod();
    this.syncPeriodUI();
    this.render();
  },

  savePeriod() {
    try { localStorage.setItem('RESERVALOPE_PERIOD', JSON.stringify({ preset: this.preset, from: this.from, to: this.to })); } catch (e) {}
  },

  syncPeriodUI() {
    document.querySelectorAll('.rl-presets button').forEach(b => {
      const on = b.dataset.preset === this.preset;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', String(on));
    });
    document.querySelectorAll('.rl-custom').forEach(c => {
      c.hidden = this.preset !== 'custom';
      c.querySelector('.rl-from').value = this.from || '';
      c.querySelector('.rl-to').value = this.to || '';
      c.querySelector('.rl-to').max = DB.todayISO();
      c.querySelector('.rl-from').max = DB.todayISO();
    });
  },

  range() { return Analytics.range(this.preset, this.from, this.to); },

  periodText(r, prev) {
    const f = (d) => Charts.dateShort(d);
    return (r.days === 1 ? f(r.from) : f(r.from) + ' – ' + f(r.to)) + ' (' + r.days + (r.days === 1 ? ' día' : ' días') + ') · comparado con ' +
      (prev.days === 1 ? f(prev.from) : f(prev.from) + ' – ' + f(prev.to));
  },

  /* ---------------- Bloques reutilizables ---------------- */
  deltaHTML(d, goodUp, pp) {
    if (d == null) return '<span class="kpi-delta is-flat">Sin base de comparación</span>';
    const v = pp ? d * 100 : d * 100;
    if (Math.abs(v) < 0.05) return '<span class="kpi-delta is-flat">= Sin cambio</span>';
    const up = v > 0;
    const good = up === goodUp;
    const txt = (up ? '▲ ' : '▼ ') + Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0) + (pp ? ' pp' : '%');
    return '<span class="kpi-delta ' + (good ? 'is-good' : 'is-bad') + '"><span class="sr-only">' + (up ? 'Sube' : 'Baja') + ' </span>' + txt + '</span>';
  },

  kpi(o) {
    return '<div class="crm-kpi-card rl-kpi' + (o.hero ? ' is-hero' : '') + '">' +
      '<div class="crm-kpi-label">' + UI.esc(o.label) + '</div>' +
      '<div class="crm-kpi-val">' + UI.esc(o.value) + '</div>' +
      '<div class="kpi-foot">' + (o.delta !== undefined ? this.deltaHTML(o.delta, o.goodUp !== false, o.pp) : '') +
        (o.sub ? '<span class="crm-kpi-sub">' + UI.esc(o.sub) + '</span>' : '') + '</div>' +
    '</div>';
  },

  kpiGrid(cur, prev, cs, t) {
    const D = Analytics.delta.bind(Analytics);
    const rateD = (a, b) => (a == null || b == null) ? null : a - b;
    return [
      this.kpi({ hero: true, label: 'Ingresos del período', value: Charts.money(cur.revenue, cs), delta: D(cur.revenue, prev.revenue), sub: 'vs ' + Charts.money(prev.revenue, cs) + ' antes' }),
      this.kpi({ label: 'Citas', value: cur.appts.toLocaleString('es-PE'), delta: D(cur.appts, prev.appts), sub: cur.pending ? cur.pending + ' pendientes' : '' }),
      this.kpi({ label: 'Ticket promedio', value: Charts.money(cur.avgTicket, cs), delta: D(cur.avgTicket, prev.avgTicket) }),
      this.kpi({ label: UI.vFor(t || null, '{ClientPlural} únicos'), value: cur.clients.toLocaleString('es-PE'), delta: D(cur.clients, prev.clients) }),
      this.kpi({ label: 'Citas completadas', value: Charts.pct(cur.completionRate), delta: rateD(cur.completionRate, prev.completionRate), pp: true, sub: cur.completed + ' atendidas' }),
      this.kpi({ label: 'Cancelaciones', value: Charts.pct(cur.cancelRate), delta: rateD(cur.cancelRate, prev.cancelRate), pp: true, goodUp: false, sub: cur.cancelled + ' citas' }),
      this.kpi({ label: 'No asistió', value: Charts.pct(cur.noShowRate), delta: rateD(cur.noShowRate, prev.noShowRate), pp: true, goodUp: false, sub: cur.noShow + ' citas' }),
      this.kpi({ label: 'Walk-in atendidos', value: cur.walkins.toLocaleString('es-PE'), delta: D(cur.walkins, prev.walkins) }),
      this.kpi({ label: 'Reservas web', value: Charts.pct(cur.webShare), delta: rateD(cur.webShare, prev.webShare), pp: true, sub: cur.web + ' citas' })
    ].join('');
  },

  lineFor(boxId, legendId, cur, prev, r, p, cs) {
    const dates = Analytics.dates(r);
    const pdates = Analytics.dates(p);
    const values = dates.map(d => (cur.byDay[d] ? cur.byDay[d].revenue : 0));
    const pvalues = pdates.map(d => (prev.byDay[d] ? prev.byDay[d].revenue : 0));
    const legend = document.getElementById(legendId);
    if (legend) legend.innerHTML = '<span><i class="lg-line"></i>Período actual</span><span><i class="lg-line is-prev"></i>Período anterior</span>';
    Charts.line(document.getElementById(boxId), {
      dates, aria: 'Ingresos por día',
      series: [{ name: 'Actual', values, kind: 'current' }, { name: 'Anterior', values: pvalues, kind: 'previous' }],
      format: (v) => Charts.money(v, cs)
    });
  },

  statusChart(m) {
    return Charts.stacked([
      { label: 'Completadas', value: m.completed, color: 'var(--success)' },
      { label: 'Pendientes', value: m.pending, color: '#8A8A8A' },
      { label: 'Canceladas', value: m.cancelled, color: 'var(--danger)' },
      { label: 'No asistió', value: m.noShow, color: '#F59E0B' }
    ], { aria: 'Citas por estado' });
  },

  servicesChart(m, cs) {
    const items = Object.entries(m.byService).sort((a, b) => b[1].count - a[1].count).slice(0, 6)
      .map(([name, v]) => ({ label: name, value: v.count, display: v.count + ' · ' + Charts.money(v.revenue, cs) }));
    return Charts.hbars(items);
  },

  hoursChart(m) {
    const hours = ['09', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19', '20'];
    return Charts.columns(hours.map(h => ({ label: h + 'h', value: m.byHour[h] || 0 })), { unit: 'atenciones', aria: 'Atenciones por hora' });
  },

  /* ---------------- Dashboard global ---------------- */
  renderDashboard() {
    const r = this.range(), p = Analytics.previous(r);
    const tenants = DB.load().tenants;
    const cur = Analytics.aggregate(tenants, r);
    const prev = Analytics.aggregate(tenants, p);
    const currencies = Array.from(new Set(tenants.map(t => t.currency || 'S/')));
    const cs = currencies.length === 1 ? currencies[0] : 'S/';
    document.getElementById('rl-dash-compare').innerHTML = UI.esc(this.periodText(r, p)) +
      (currencies.length > 1 ? '<br/><span class="text-warn">' + ic('alert') + ' Hay negocios con distinta moneda (' + UI.esc(currencies.join(', ')) + '); los totales globales suman montos sin convertir.</span>' : '');

    document.getElementById('rl-dash-kpis').innerHTML = this.kpiGrid(cur, prev, cs);

    const pf = Analytics.platform();
    document.getElementById('rl-dash-platform').innerHTML =
      '<div class="rl-pf-item"><span>Negocios activos</span><strong>' + pf.active + ' <small>de ' + pf.tenants + '</small></strong></div>' +
      '<div class="rl-pf-item"><span>Ingreso mensual por suscripciones</span><strong>' + Charts.money(pf.mrr, 'S/') + '</strong></div>' +
      '<div class="rl-pf-item"><span>Planes</span><strong class="rl-plans">' + pf.byPlan.map(x => '<em>' + x.label + ' ' + x.count + '</em>').join('') + '</strong></div>' +
      '<div class="rl-pf-item' + (pf.expiring + pf.expired ? ' is-warn' : '') + '"><span>Suscripciones por vencer / vencidas</span><strong>' + pf.expiring + ' / ' + pf.expired + '</strong></div>' +
      '<div class="rl-pf-item"><span>Usuarios activos</span><strong>' + pf.users + (pf.locked ? ' <small>· ' + pf.locked + ' bloqueado(s)</small>' : '') + '</strong></div>';

    this.lineFor('rl-dash-line', 'rl-dash-line-legend', cur, prev, r, p, cs);

    const prevBy = {}; prev.per.forEach(m => { prevBy[m.tenant.id] = m; });
    const rank = cur.per.slice().sort((a, b) => b.revenue - a.revenue).map(m => {
      const d = Analytics.delta(m.revenue, (prevBy[m.tenant.id] || {}).revenue || 0);
      return {
        label: m.tenant.name, value: m.revenue, sub: m.appts + ' citas · ' + m.walkins + ' walk-in' + (m.tenant.status !== 'ACTIVE' ? ' · suspendido' : ''),
        display: Charts.money(m.revenue, m.tenant.currency),
        tip: '<strong>' + UI.esc(m.tenant.name) + '</strong><br/>' + Charts.money(m.revenue, m.tenant.currency) + (d != null ? ' · ' + (d >= 0 ? '▲ ' : '▼ ') + Math.abs(d * 100).toFixed(0) + '% vs anterior' : '')
      };
    });
    document.getElementById('rl-dash-rank').innerHTML = Charts.hbars(rank);
    document.getElementById('rl-dash-status-sub').textContent = cur.appts + ' citas con fecha en el período';
    document.getElementById('rl-dash-status').innerHTML = this.statusChart(cur);
    document.getElementById('rl-dash-services').innerHTML = this.servicesChart(cur, cs);
    document.getElementById('rl-dash-hours').innerHTML = this.hoursChart(cur);
    const chSub = document.querySelector('#rl-pane-dashboard [data-channel-sub]');
    if (chSub) {
      const dd = (cur.webShare != null && prev.webShare != null) ? cur.webShare - prev.webShare : null;
      chSub.innerHTML = 'Web pública vs. registradas en el CRM · web ' + Charts.pct(cur.webShare) + ' ' + this.deltaHTML(dd, true, true);
    }
    document.getElementById('rl-dash-channel').innerHTML = Charts.stacked([
      { label: 'Web pública', value: cur.web, color: 'var(--yellow)' },
      { label: 'Registradas en el CRM', value: cur.crm, color: '#8A8A8A' }
    ], { aria: 'Canal de reserva' });
    document.getElementById('rl-dash-alerts').innerHTML = this.alertsHTML(Analytics.alerts().slice(0, 4), true);
  },

  /* ---------------- Negocios ---------------- */
  fillRubroFilter() {
    const sel = document.getElementById('rl-t-rubro');
    if (sel && window.Vocab) sel.innerHTML = '<option value="ALL">Todos</option>' + (Vocab.TYPES || Object.keys(Vocab.PRESETS)).map(k => '<option value="' + UI.esc(k) + '">' + UI.esc(Vocab.PRESETS[k].label) + '</option>').join('');
  },

  // Rubro legible ("Consultorio médico", "Barbería · palabras propias")
  rubroLabel(t) {
    if (!window.Vocab) return '';
    return Vocab.label(t.businessType || 'barberia') + (t.labels && Object.keys(t.labels).length ? ' · palabras propias' : '');
  },

  fillPlanFilter() {
    const sel = document.getElementById('rl-t-plan');
    if (sel) sel.innerHTML = '<option value="ALL">Todos</option>' + Object.keys(DB.PLANS).map(k => '<option value="' + k + '">' + DB.PLANS[k].label + '</option>').join('');
  },

  /* C1: la paleta la puede escribir el administrador del negocio (por API).
     Aquí solo se aceptan colores #RRGGBB; cualquier otra cosa se reemplaza por
     el color por defecto, y aun así todo se escapa al pintarlo. */
  HEX: /^#[0-9a-fA-F]{6}$/,
  safePalette(t) {
    const p = TenantBrand.paletteOf(t) || {};
    const d = TenantBrand.DEFAULT_PALETTE;
    const ok = (v, def) => (this.HEX.test(String(v || '')) ? String(v).toUpperCase() : def);
    return { primary: ok(p.primary, d.primary), secondary: ok(p.secondary, d.secondary), tertiary: ok(p.tertiary, d.tertiary) };
  },

  swatches(t) {
    const p = this.safePalette(t);
    return '<span class="rl-swatches" title="' + UI.esc('Primario ' + p.primary + ' · Secundario ' + p.secondary + ' · Terciario ' + p.tertiary) + '">' +
      ['primary', 'secondary', 'tertiary'].map(k => '<i style="background:' + UI.esc(p[k]) + ';"></i>').join('') + '</span>';
  },

  relDay(iso) {
    if (!iso) return 'Sin actividad';
    const days = Analytics.daysBetween(iso, DB.todayISO()) - 1;
    if (days <= 0) return 'Hoy';
    if (days === 1) return 'Ayer';
    return 'Hace ' + days + ' días';
  },

  // M17: vencida hace más de 7 días → la web ya no recibe reservas (lo aplica la base)
  subNote(t) {
    const s = Analytics.subscriptionState(t);
    if (s.key !== 'expired') return '';
    const blocked = -s.days > 7;
    return '<br/><small class="' + (blocked ? 'text-bad' : 'text-warn') + '">' +
      (blocked ? 'Web sin reservas en línea' : 'Reservas web hasta el ' + UI.esc(DB.addDays(t.subscriptionEnd, 7))) + '</small>';
  },

  subBadge(t) {
    const s = Analytics.subscriptionState(t);
    const cls = s.key === 'expired' ? 'st-CANCELADA' : (s.key === 'soon' ? 'st-EN_SILLON' : 'st-COMPLETADA');
    return '<span class="st-badge ' + cls + '">' + UI.esc(s.label) + '</span>';
  },

  renderTenants() {
    const tbody = document.getElementById('rl-tenants-tbody');
    if (!tbody) return;
    const r = this.range(), p = Analytics.previous(r);
    const q = (document.getElementById('rl-t-search').value || '').trim().toLowerCase();
    const st = document.getElementById('rl-t-status').value;
    const pl = document.getElementById('rl-t-plan').value;
    const ru = (document.getElementById('rl-t-rubro') || {}).value || 'ALL';
    const list = DB.load().tenants.filter(t =>
      (st === 'ALL' || t.status === st) && (pl === 'ALL' || t.plan === pl) && (ru === 'ALL' || (t.businessType || 'barberia') === ru) &&
      (!q || (t.name + ' ' + t.slug).toLowerCase().includes(q)));
    if (!list.length) {
      tbody.innerHTML = '<tr class="is-empty"><td colspan="10"><div class="empty-state">' + ic('store') + '<strong>Sin negocios</strong>No hay negocios con esos filtros.</div></td></tr>';
      return;
    }
    tbody.innerHTML = list.map(t => {
      const m = Analytics.tenantMetrics(t, r), pm = Analytics.tenantMetrics(t, p);
      const lost = m.appts ? (m.cancelled + m.noShow) / m.appts : null;
      return '<tr>' +
        '<td data-label="Negocio"><div class="rl-tenant-cell">' + this.swatches(t) + '<div><strong>' + UI.esc(t.name) + '</strong><br/><a class="tenant-link" href="index.html?b=' + encodeURIComponent(t.slug) + '" target="_blank" rel="noopener">?b=' + UI.esc(t.slug) + '</a></div></div></td>' +
        '<td data-label="Rubro"><span class="rl-rubro">' + (window.Vocab ? Vocab.icon('', t.businessType || 'barberia') : '') + UI.esc(this.rubroLabel(t)) + '</span></td>' +
        '<td data-label="Estado">' + (t.status === 'ACTIVE' ? '<span class="st-badge st-COMPLETADA">Activo</span>' : '<span class="st-badge st-CANCELADA">Suspendido</span>') + '</td>' +
        '<td data-label="Plan"><strong>' + UI.esc((DB.PLANS[t.plan] || {}).label || t.plan) + '</strong><br/><span class="text-grey" style="font-size:0.8rem;">S/ ' + UI.esc(t.planFee) + '/mes</span></td>' +
        '<td data-label="Suscripción">' + this.subBadge(t) + '<br/><span class="text-grey" style="font-size:0.8rem;">' + UI.esc(t.subscriptionEnd) + '</span>' + this.subNote(t) + '</td>' +
        '<td data-label="Ingresos"><strong>' + Charts.money(m.revenue, t.currency) + '</strong><br/>' + this.deltaHTML(Analytics.delta(m.revenue, pm.revenue), true) + '</td>' +
        '<td data-label="Citas">' + Number(m.appts) + '</td>' +
        '<td data-label="Cancelación"><span class="' + (lost != null && lost > 0.2 ? 'text-bad' : '') + '">' + Charts.pct(lost) + '</span></td>' +
        '<td data-label="Última actividad">' + UI.esc(this.relDay(Analytics.lastActivity(t))) + '</td>' +
        '<td data-label="Acciones"><button type="button" class="btn-golden btn-xs" onclick="Reservalope.go(\'detail\', \'' + t.id + '\')">Ver ficha' + ic('arrowRight') + '</button></td>' +
      '</tr>';
    }).join('');
  },

  /* ---------------- Ficha individual ---------------- */
  renderDetail() {
    const t = DB.tenantById(this.detailId);
    if (!t) return this.go('tenants');
    const root = DB.load();
    const s = root.data[t.id] || {};
    const r = this.range(), p = Analytics.previous(r);
    const cur = Analytics.tenantMetrics(t, r), prev = Analytics.tenantMetrics(t, p);
    const cs = t.currency || 'S/';
    const pal = this.safePalette(t);
    const active = t.status === 'ACTIVE';

    document.getElementById('rl-detail-head').innerHTML =
      '<section class="rl-head" style="--t-bg:' + UI.esc(pal.primary) + '; --t-accent:' + UI.esc(pal.secondary) + '; --t-text:' + UI.esc(pal.tertiary) + ';">' +
        '<div class="rl-head-brand">' + TenantBrand.logoHTML(t, 'tenant-logo') +
          '<ul class="rl-head-palette">' + [['primary', 'Primario'], ['secondary', 'Secundario'], ['tertiary', 'Terciario']].map(([k, l]) =>
            '<li><i style="background:' + UI.esc(pal[k]) + ';"></i><span>' + l + '</span><code>' + UI.esc(pal[k]) + '</code></li>').join('') + '</ul>' +
        '</div>' +
        '<div class="rl-head-info">' +
          '<div class="rl-head-top"><h1 class="crm-title">' + UI.esc(t.name) + '</h1>' +
            (active ? '<span class="st-badge st-COMPLETADA">Activo</span>' : '<span class="st-badge st-CANCELADA">Suspendido</span>') + '</div>' +
          '<dl class="rl-facts">' +
            '<div><dt>Rubro</dt><dd>' + UI.esc(this.rubroLabel(t)) + '</dd></div>' +
            '<div><dt>Plan</dt><dd>' + UI.esc((DB.PLANS[t.plan] || {}).label || t.plan) + ' · S/ ' + UI.esc(t.planFee) + '/mes</dd></div>' +
            '<div><dt>Suscripción</dt><dd>' + this.subBadge(t) + ' <span class="text-grey">' + UI.esc(t.subscriptionEnd) + '</span>' + this.subNote(t) + '</dd></div>' +
            '<div><dt>Dueño</dt><dd>' + UI.esc(t.ownerName || '—') + (t.ownerEmail ? ' · <a class="inline-link" href="mailto:' + UI.esc(t.ownerEmail) + '">' + UI.esc(t.ownerEmail) + '</a>' : '') + (t.ownerPhone ? ' · ' + UI.esc(t.ownerPhone) : '') + '</dd></div>' +
            '<div><dt>Web</dt><dd><a class="inline-link" href="index.html?b=' + encodeURIComponent(t.slug) + '" target="_blank" rel="noopener">index.html?b=' + UI.esc(t.slug) + '</a></dd></div>' +
            '<div><dt>Alta</dt><dd>' + UI.esc(UI.fmtDateTime(t.createdAt)) + '</dd></div>' +
          '</dl>' +
          '<div class="row-actions">' +
            '<button type="button" class="btn-golden btn-xs" onclick="AdminUI.switchTenant(\'' + t.id + '\')">' + ic('arrowRight') + 'Entrar al CRM</button>' +
            '<button type="button" class="btn-dark btn-xs" onclick="Reservalope.go(\'reports\', \'' + t.id + '\')">' + ic('download') + 'Reportes</button>' +
            '<a class="btn-dark btn-xs" href="index.html?b=' + encodeURIComponent(t.slug) + '" target="_blank" rel="noopener">' + ic('external') + 'Ver web</a>' +
            '<button type="button" class="btn-dark btn-xs" onclick="AdminUI.openTenantModal(\'' + t.id + '\')">' + ic('edit') + 'Editar</button>' +
            (this.ceIsSA() ? '<button type="button" class="btn-dark btn-xs" id="rl-crm-custom" onclick="Reservalope.openCrmEditor(\'' + t.id + '\')">' + ic('sliders') + 'Personalizar CRM</button>' : '') +
            (active ? '<button type="button" class="btn-danger btn-xs" onclick="AdminUI.toggleTenant(\'' + t.id + '\')">Suspender</button>'
                    : '<button type="button" class="btn-golden btn-xs" onclick="AdminUI.toggleTenant(\'' + t.id + '\')">Reactivar</button>') +
          '</div>' +
        '</div>' +
      '</section>';

    document.getElementById('rl-detail-kpis').innerHTML = this.kpiGrid(cur, prev, cs, t);
    const vf = (s) => UI.vFor(t, s);
    const stTitle = document.getElementById('rl-detail-staff-title');
    if (stTitle) stTitle.textContent = vf('Rendimiento por {staff}');
    const stTh = document.getElementById('rl-detail-staff-th');
    if (stTh) stTh.textContent = vf('{Staff}');
    const staffLbl = UI.esc(vf('{Staff}'));
    this.lineFor('rl-detail-line', 'rl-detail-line-legend', cur, prev, r, p, cs);

    const barbers = Object.entries(cur.byBarber).sort((a, b) => b[1].revenue - a[1].revenue);
    document.getElementById('rl-detail-barbers').innerHTML = barbers.length ? barbers.map(([name, b]) =>
      '<tr><td data-label="' + staffLbl + '"><strong>' + UI.esc(name) + '</strong></td><td data-label="Citas">' + b.appts + '</td><td data-label="Completadas">' + b.completed + '</td>' +
      '<td data-label="Walk-in">' + b.walkins + '</td><td data-label="Ingresos"><strong>' + Charts.money(b.revenue, cs) + '</strong></td>' +
      '<td data-label="Ocupación"><div class="meter" role="img" aria-label="Ocupación ' + Charts.pct(b.occupancy) + '"><span style="width:' + Math.round(b.occupancy * 100) + '%;"></span></div><span class="meter-val">' + Charts.pct(b.occupancy) + '</span></td></tr>'
    ).join('') : '<tr class="is-empty"><td colspan="6"><div class="empty-state">' + ic('users') + '<strong>' + UI.esc(vf('Sin {staffPlural}')) + '</strong>' + UI.esc(vf('{Este:business} {business} aún no registra {staffPlural}.')) + '</div></td></tr>';

    document.getElementById('rl-detail-services').innerHTML = this.servicesChart(cur, cs);
    document.getElementById('rl-detail-status').innerHTML = this.statusChart(cur);
    document.getElementById('rl-detail-hours').innerHTML = this.hoursChart(cur);

    const today = DB.todayISO();
    const upcoming = (s.appointments || []).filter(a => (a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP') && !DB.isPastSlot(a.date, a.time))
      .sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1)).slice(0, 8);
    document.getElementById('rl-detail-upcoming').innerHTML = upcoming.length ? '<ul class="rl-list">' + upcoming.map(a =>
      '<li><span class="rl-when"><strong>' + (a.date === today ? 'Hoy' : UI.esc(Charts.dateShort(a.date))) + '</strong>' + UI.esc(a.time) + '</span>' +
      '<span class="rl-what"><strong>' + UI.esc(a.customerName) + '</strong><small>' + UI.esc(a.service) + ' · ' + UI.esc(a.barber) + '</small></span>' +
      '<span class="st-badge st-' + a.status + '">' + DB.statusLabel(a.status) + '</span></li>').join('') + '</ul>'
      : '<div class="chart-empty">No hay citas próximas.</div>';

    const checks = Analytics.checklist(t);
    const done = checks.filter(c => c.ok).length;
    document.getElementById('rl-detail-check-sub').textContent = done + ' de ' + checks.length + ' completos';
    document.getElementById('rl-detail-checklist').innerHTML = checks.map(c =>
      '<li class="' + (c.ok ? 'is-ok' : 'is-missing') + '">' + ic(c.ok ? 'checkCircle' : 'alert') + '<span><strong>' + UI.esc(c.label) + '</strong>' + (c.ok ? '' : '<small>' + UI.esc(c.hint) + '</small>') + '</span></li>').join('');

    const users = root.users.filter(u => u.tenantId === t.id);
    document.getElementById('rl-detail-users').innerHTML = users.length ? '<ul class="rl-list">' + users.map(u =>
      '<li><span class="user-avatar sm">' + UI.esc(AdminUI.initials(u.name)) + '</span><span class="rl-what"><strong>' + UI.esc(u.name) + '</strong><small>' + UI.esc(u.email) + '</small></span>' +
      AdminUI.roleBadge(u.role) + (u.active ? '' : '<span class="st-badge st-CANCELADA">Desactivado</span>') + '</li>').join('') + '</ul>'
      : '<div class="chart-empty">Sin usuarios. Crea su administrador.</div>';

    const acts = root.audit.filter(a => a.tenantId === t.id).slice(0, 10);
    document.getElementById('rl-detail-activity').innerHTML = acts.length ? '<ul class="rl-activity">' + acts.map(a =>
      '<li><time>' + UI.esc(UI.fmtDateTime(a.ts)) + '</time><span><strong>' + UI.esc(a.action) + '</strong> · ' + UI.esc(a.userName) + '<small>' + UI.esc(a.detail) + '</small></span></li>').join('') + '</ul>'
      : '<div class="chart-empty">Sin actividad registrada.</div>';
  },

  newUserFor() {
    AdminUI.openUserModal(null);
    const tn = document.getElementById('m-us-tenant');
    if (tn && this.detailId) { tn.value = this.detailId; AdminUI.onUserTenantChange(); }
  },

  /* ---------------- Alertas ---------------- */
  alertsHTML(list, compact) {
    if (!list.length) return '<div class="empty-state">' + ic('checkCircle') + '<strong>Todo en orden</strong>No hay alertas activas.</div>';
    const icon = { critical: 'alert', warning: 'alert', info: 'lock' };
    const label = { critical: 'Crítica', warning: 'Advertencia', info: 'Información' };
    const actionBtn = (a) => {
      if (!a.action) return '';
      if (a.action === 'tenant' && a.tenantId) return '<button type="button" class="btn-dark btn-xs" onclick="Reservalope.go(\'detail\', \'' + a.tenantId + '\')">Ver ficha</button>';
      if (a.action === 'edit' && a.tenantId) return '<button type="button" class="btn-dark btn-xs" onclick="AdminUI.openTenantModal(\'' + a.tenantId + '\')">Actualizar suscripción</button>';
      if (a.action === 'users') return '<button type="button" class="btn-dark btn-xs" onclick="Reservalope.go(\'users\')">Ir a usuarios</button>';
      if (a.action === 'platform') return '<button type="button" class="btn-dark btn-xs" onclick="Reservalope.go(\'platform\')">Ver almacenamiento</button>';
      return '';
    };
    return '<ul class="rl-alerts' + (compact ? ' is-compact' : '') + '">' + list.map(a =>
      '<li class="rl-alert is-' + a.severity + '">' +
        '<span class="rl-alert-icon">' + ic(icon[a.severity]) + '</span>' +
        '<div class="rl-alert-body"><span class="rl-alert-meta"><b>' + label[a.severity] + '</b> · ' + UI.esc(a.tenantName) + '</span>' +
          '<strong>' + UI.esc(a.title) + '</strong><p>' + UI.esc(a.detail) + '</p></div>' +
        (compact ? '' : '<div class="rl-alert-action">' + actionBtn(a) + '</div>') +
      '</li>').join('') + '</ul>';
  },

  renderAlerts() {
    document.getElementById('rl-alerts-list').innerHTML = this.alertsHTML(Analytics.alerts(), false);
  },

  /* ---------------- Plataforma ---------------- */
  renderPlatform() {
    if (!DB.usage) {
      DB.client().rpc('plataforma_uso').then(({ data, error }) => {
        if (error) return UI.toast(DB.errorText(error), 'error');
        DB.usage = data;
        if (this.pane === 'platform') this.renderPlatform();
      });
    }
    const st = Analytics.storage();
    const root = DB.load();
    const pct = Math.min(100, st.pct * 100);
    const lvl = st.pct >= 0.85 ? 'is-bad' : st.pct >= 0.7 ? 'is-warn' : '';
    const sizes = root.tenants.map(t => ({ t, size: JSON.stringify(root.data[t.id] || {}).length })).sort((a, b) => b.size - a.size);
    document.getElementById('rl-storage').innerHTML =
      '<div class="rl-storage-top"><strong>' + pct.toFixed(1) + '%</strong><span>' + Math.round(st.used / 1024).toLocaleString('es-PE') + ' KB de ~' + Math.round(st.limit / 1024).toLocaleString('es-PE') + ' KB</span></div>' +
      '<div class="meter is-lg ' + lvl + '" role="img" aria-label="Almacenamiento usado ' + pct.toFixed(0) + '%"><span style="width:' + pct + '%;"></span></div>' +
      '<p class="card-text" style="margin-top:12px;">Base de datos de Supabase (plan gratis: 500 MB). Las fotos se guardan aparte, en Storage. Abajo, el volumen de datos de cada negocio.</p>' +
      Charts.hbars(sizes.map(x => ({ label: x.t.name, value: x.size, display: Math.round(x.size / 1024) + ' KB' })));

    document.getElementById('rl-policy').innerHTML = [
      ['Intentos fallidos antes de bloquear', Auth.MAX_ATTEMPTS],
      ['Duración del bloqueo', 'La define Supabase Auth'],
      ['Duración máxima de la sesión', Auth.SESSION_HOURS + ' h'],
      ['Cierre por inactividad', Auth.IDLE_MINUTES + ' min'],
      ['Contraseña mínima', '8 caracteres, letras y números'],
      ['Contraseña temporal', 'Cambio obligatorio al primer ingreso']
    ].map(([k, v]) => '<li><span>' + UI.esc(k) + '</span><strong>' + UI.esc(v) + '</strong></li>').join('');
  },

  exportBackup() {
    const root = JSON.parse(JSON.stringify(DB.load()));
    root.users.forEach(u => { delete u.passHash; }); // nunca exportar hashes de contraseñas
    const blob = new Blob([JSON.stringify({ plataforma: 'Reservalope', exportado: new Date().toISOString(), datos: root }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reservalope-respaldo-' + DB.todayISO() + '.json';
    a.click();
    DB.log('Exportó un respaldo completo', root.tenants.length + ' negocios · ' + root.users.length + ' usuarios', { tenantId: null });
  },

  // En producción no existe "borrar todo": los datos viven en Supabase y tienen respaldo.
  factoryReset() {
    UI.toast('No disponible en producción. Para empezar de cero se usa un proyecto nuevo de Supabase.', 'error');
  },

  /* ---------------- CSV comparativo ---------------- */
  exportCSV() {
    const r = this.range(), p = Analytics.previous(r);
    const head = ['Negocio', 'Rubro', 'Enlace', 'Estado', 'Plan', 'Monto mensual', 'Vence', 'Moneda', 'Ingresos', 'Ingresos período anterior', 'Variación %', 'Citas', 'Completadas', 'Canceladas', 'No asistió', '% Cancelación', 'Walk-in', 'Ticket promedio', 'Clientes únicos', '% Reservas web', 'Última actividad'];
    const rows = DB.load().tenants.map(t => {
      const m = Analytics.tenantMetrics(t, r), pm = Analytics.tenantMetrics(t, p);
      const d = Analytics.delta(m.revenue, pm.revenue);
      return [t.name, this.rubroLabel(t), t.slug, t.status === 'ACTIVE' ? 'Activo' : 'Suspendido', (DB.PLANS[t.plan] || {}).label, t.planFee, t.subscriptionEnd, t.currency,
        Math.round(m.revenue), Math.round(pm.revenue), d == null ? '' : (d * 100).toFixed(1), m.appts, m.completed, m.cancelled, m.noShow,
        m.appts ? ((m.cancelled / m.appts) * 100).toFixed(1) : '', m.walkins, Math.round(m.avgTicket), m.clients,
        m.webShare == null ? '' : (m.webShare * 100).toFixed(1), Analytics.lastActivity(t) || ''];
    });
    // UI.csv neutraliza fórmulas (nombres que empiezan con = + - @)
    const csv = UI.csv([['Período', r.from + ' a ' + r.to, 'Comparado con', p.from + ' a ' + p.to], head].concat(rows));
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'reservalope-comparativo-' + r.from + '_' + r.to + '.csv';
    a.click();
    DB.log('Exportó CSV comparativo', rows.length + ' negocios · ' + r.from + ' a ' + r.to, { tenantId: null });
    UI.toast('CSV descargado.');
  }
};

/* ==========================================================================
   Personalizar CRM (solo superadministrador)
   Editor de tenants.crm_config por negocio: módulos, campos estándar,
   columnas de la lista de citas, campos propios, apariencia y portada de la
   web, con vista previa en vivo. Guardar envía SOLO crm_config (lo que
   difiere de los valores por defecto); "Restablecer" lo deja en {}.
   ========================================================================== */
Object.assign(Reservalope, {
  ce: null,
  CE_TABS: [['modules', 'Módulos'], ['fields', 'Campos'], ['custom', 'Campos propios'], ['theme', 'Apariencia'], ['site', 'Web']],

  ceIsSA() { return !!(Auth.user && Auth.user.role === 'SUPERADMIN'); },

  openCrmEditor(id) {
    if (!this.ceIsSA()) return Guard.deny('Solo el superadministrador puede personalizar el CRM.');
    const t = DB.tenantById(id);
    if (!t) return;
    this.ce = { id: t.id, cfg: CrmConfig.normalize(t.crmConfig), tab: 'modules', entity: 'customers', edit: null, saving: false };
    const E = UI.esc;
    ModalComponent.open(
      '<div class="crm-modal-header"><div><span class="card-kicker">Personalizar CRM</span><h3>' + E(t.name) + '</h3></div>' +
        '<button type="button" class="btn-dark btn-xs" onclick="ModalComponent.close()" aria-label="Cerrar">' + ic('x') + '</button></div>' +
      '<div class="ce-layout" id="crm-editor">' +
        '<div class="ce-main">' +
          '<div class="ce-tabs" role="tablist" aria-label="Secciones">' + this.CE_TABS.map(([k, l]) =>
            '<button type="button" role="tab" class="ce-tab" id="ce-tab-' + k + '" data-tab="' + k + '" onclick="Reservalope.ceTab(\'' + k + '\')">' + E(l) + '</button>').join('') + '</div>' +
          '<div class="ce-panel" id="ce-panel" role="tabpanel"></div>' +
        '</div>' +
        '<aside class="ce-side" aria-label="Vista previa">' +
          '<span class="card-kicker">Vista previa</span>' +
          '<div class="ce-preview" id="ce-preview"></div>' +
          '<div class="ce-contrast" id="ce-contrast" aria-live="polite"></div>' +
        '</aside>' +
      '</div>' +
      '<div class="form-error" id="ce-error" role="alert"></div>' +
      '<div class="modal-actions ce-actions">' +
        '<button type="button" class="btn-dark" id="ce-reset" onclick="Reservalope.ceReset()">' + ic('refresh') + 'Restablecer</button>' +
        '<span class="ce-spacer"></span>' +
        '<button type="button" class="btn-dark" onclick="ModalComponent.close()">Cancelar</button>' +
        '<button type="button" class="btn-golden" id="ce-save" onclick="Reservalope.ceSave()">' + ic('check') + 'Guardar</button>' +
      '</div>',
      { wide: true }
    );
    this.ceTab('modules');
  },

  ceT() { return this.ce ? DB.tenantById(this.ce.id) : null; },
  ceV(s) { return UI.vFor(this.ceT(), s); },

  ceTab(tab) {
    if (!this.ce) return;
    this.ce.tab = tab;
    document.querySelectorAll('#crm-editor .ce-tab').forEach(b => {
      const on = b.dataset.tab === tab;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    this.ceRenderPanel();
    this.cePreview();
  },

  ceRenderPanel() {
    const el = document.getElementById('ce-panel');
    if (!el || !this.ce) return;
    const f = { modules: 'cePanelModules', fields: 'cePanelFields', custom: 'cePanelCustom', theme: 'cePanelTheme', site: 'cePanelSite' }[this.ce.tab];
    el.innerHTML = this[f]();
    const err = document.getElementById('ce-error');
    if (err) err.textContent = '';
  },

  ceChk(id, label, checked, onchange, extra) {
    return '<label class="ce-check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (extra || '') + ' onchange="' + onchange + '" /> <span>' + UI.esc(label) + '</span></label>';
  },

  /* ---------- Módulos ---------- */
  cePanelModules() {
    const c = this.ce.cfg;
    return '<p class="ce-hint">Un módulo apagado desaparece del menú y de las acciones para todo el equipo (administradores y personal). Configuración siempre queda visible.</p>' +
      '<div class="ce-grid">' + CrmConfig.MODULES.map(m =>
        this.ceChk('ce-mod-' + m.key, this.ceV(m.label), c.modules[m.key] !== false, 'Reservalope.ceSetModule(\'' + m.key + '\', this.checked)')).join('') + '</div>';
  },
  ceSetModule(k, on) { this.ce.cfg.modules[k] = !!on; this.cePreview(); },

  /* ---------- Campos estándar y columnas ---------- */
  cePanelFields() {
    const c = this.ce.cfg;
    const ent = Object.keys(CrmConfig.FIELDS).map(e =>
      '<fieldset class="ce-fieldset"><legend>' + UI.esc(this.ceV(CrmConfig.ENTITY_LABEL[e])) + '</legend>' +
        CrmConfig.FIELDS[e].map(f => {
          const v = c.fields[e][f.key];
          return '<div class="ce-row"><span class="ce-row-lbl">' + UI.esc(f.label) + '</span>' +
            this.ceChk('ce-f-' + e + '-' + f.key, 'Mostrar', v.show, 'Reservalope.ceSetField(\'' + e + '\', \'' + f.key + '\', \'show\', this.checked)') +
            (f.canRequire ? this.ceChk('ce-r-' + e + '-' + f.key, 'Obligatorio', v.show && v.required, 'Reservalope.ceSetField(\'' + e + '\', \'' + f.key + '\', \'required\', this.checked)', v.show ? '' : ' disabled') : '') +
          '</div>';
        }).join('') +
      '</fieldset>').join('');
    return '<p class="ce-hint">Los campos ocultos no se ven en formularios, tablas, fichas, exportaciones ni reportes. Los datos guardados no se borran.</p>' +
      ent + this.ceColumnsHTML();
  },
  ceSetField(e, k, prop, on) {
    const v = this.ce.cfg.fields[e][k];
    v[prop] = !!on;
    if (prop === 'show' && !on && 'required' in v) v.required = false;
    // Si se oculta un campo, su columna sale de la lista de citas
    if (e === 'appointments' && prop === 'show' && !on) this.ceDropColumn(k);
    this.ceRenderPanel();
    this.cePreview();
  },

  // Columnas disponibles: estándar (con su campo visible) + campos propios de citas
  ceAllColumns() {
    const c = this.ce.cfg;
    const std = CrmConfig.APPT_COLUMNS.filter(x => !x.field || c.fields.appointments[x.field].show !== false)
      .map(x => ({ key: x.key, label: this.ceV(x.label) }));
    return std.concat(c.customFields.appointments.map(f => ({ key: 'x:' + f.key, label: f.label + ' (propio)' })));
  },
  ceColumns() { return this.ce.cfg.lists.appointments.columns || CrmConfig.apptColumns(this.ce.cfg); },
  ceColumnsHTML() {
    const all = this.ceAllColumns();
    const cur = this.ceColumns().filter(k => all.some(a => a.key === k));
    const rest = all.filter(a => !cur.includes(a.key));
    const lbl = (k) => (all.find(a => a.key === k) || { label: k }).label;
    const isDefault = !this.ce.cfg.lists.appointments.columns;
    const row = (k, on, i) => {
      const id = 'ce-col-' + k.replace(':', '-');
      return '<li class="ce-col' + (on ? ' is-on' : '') + '" data-col="' + UI.esc(k) + '">' +
        this.ceChk(id, lbl(k), on, 'Reservalope.ceToggleCol(\'' + UI.esc(k) + '\', this.checked)') +
        (on ? '<span class="ce-col-move">' +
          '<button type="button" class="btn-dark btn-xs" aria-label="Subir ' + UI.esc(lbl(k)) + '" onclick="Reservalope.ceMoveCol(\'' + UI.esc(k) + '\', -1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="btn-dark btn-xs" aria-label="Bajar ' + UI.esc(lbl(k)) + '" onclick="Reservalope.ceMoveCol(\'' + UI.esc(k) + '\', 1)"' + (i === cur.length - 1 ? ' disabled' : '') + '>↓</button></span>' : '') +
      '</li>';
    };
    return '<fieldset class="ce-fieldset"><legend>' + UI.esc(this.ceV('Columnas de la lista de {appointmentPlural}')) + '</legend>' +
      '<p class="ce-hint">Marca las columnas y ordénalas (máximo ' + CrmConfig.MAX_COLUMNS + '). ' + (isDefault ? 'Ahora se usan las columnas por defecto.' : '') + '</p>' +
      '<ol class="ce-cols" id="ce-cols">' + cur.map((k, i) => row(k, true, i)).join('') + rest.map(a => row(a.key, false, 0)).join('') + '</ol>' +
      (isDefault ? '' : '<button type="button" class="btn-dark btn-xs" id="ce-cols-default" onclick="Reservalope.ceColsDefault()">Usar columnas por defecto</button>') +
    '</fieldset>';
  },
  ceSetColumns(cols) {
    // Nunca se guarda []: con una lista igual a la de por defecto se omite
    const def = CrmConfig.apptColumns(Object.assign({}, this.ce.cfg, { lists: { appointments: { columns: null } } }));
    this.ce.cfg.lists.appointments.columns = (cols.length && JSON.stringify(cols) !== JSON.stringify(def)) ? cols : null;
    this.ceRenderPanel();
    this.cePreview();
  },
  ceToggleCol(k, on) {
    const cols = this.ceColumns().slice();
    const err = document.getElementById('ce-error');
    if (on) {
      if (cols.length >= CrmConfig.MAX_COLUMNS) { this.ceRenderPanel(); document.getElementById('ce-error').textContent = 'Máximo ' + CrmConfig.MAX_COLUMNS + ' columnas.'; return; }
      if (!cols.includes(k)) cols.push(k);
    } else {
      if (cols.length <= 1) { this.ceRenderPanel(); document.getElementById('ce-error').textContent = 'La lista necesita al menos una columna.'; return; }
      cols.splice(cols.indexOf(k), 1);
    }
    if (err) err.textContent = '';
    this.ceSetColumns(cols);
  },
  ceMoveCol(k, d) {
    const cols = this.ceColumns().slice();
    const i = cols.indexOf(k), j = i + d;
    if (i < 0 || j < 0 || j >= cols.length) return;
    cols.splice(i, 1); cols.splice(j, 0, k);
    this.ceSetColumns(cols);
  },
  ceColsDefault() { this.ce.cfg.lists.appointments.columns = null; this.ceRenderPanel(); this.cePreview(); },
  ceDropColumn(k) {
    const cur = this.ce.cfg.lists.appointments.columns;
    if (!cur) return;
    const cols = cur.filter(x => x !== k);
    this.ce.cfg.lists.appointments.columns = cols.length ? cols : null;
  },

  /* ---------- Campos propios ---------- */
  cePanelCustom() {
    const e = this.ce.entity;
    const list = this.ce.cfg.customFields[e];
    const E = UI.esc;
    const typeLbl = (k) => (CrmConfig.TYPES.find(x => x.key === k) || {}).label || k;
    const ed = this.ce.edit;
    const cur = ed && ed.entity === e && ed.key ? list.find(f => f.key === ed.key) : null;
    const v = cur || { key: '', label: '', type: 'text', options: [], required: false, showInList: false, public: false };
    const entBtn = (k, l) => '<button type="button" class="ce-seg' + (e === k ? ' active' : '') + '" id="ce-ent-' + k + '" aria-pressed="' + (e === k) + '" onclick="Reservalope.ceEntity(\'' + k + '\')">' + E(l) + '</button>';
    return '<div class="ce-segs">' + entBtn('customers', this.ceV('Fichas de {clientPlural}')) + entBtn('appointments', this.ceV('{AppointmentPlural}')) + '</div>' +
      '<p class="ce-hint">Hasta ' + CrmConfig.MAX_CUSTOM + ' campos. Se guardan en la ficha (datos adicionales) y salen en los formularios, la lista y las exportaciones.</p>' +
      (list.length ? '<ol class="ce-cf-list" id="ce-cf-list">' + list.map((f, i) =>
        '<li class="ce-cf-item" data-key="' + E(f.key) + '"><div class="ce-cf-info"><strong>' + E(f.label) + '</strong><small>' + E(typeLbl(f.type)) +
          (f.type === 'select' ? ' · ' + E(f.options.join(', ')) : '') + (f.required ? ' · obligatorio' : '') + (f.showInList ? ' · en la lista' : '') + (f.public ? ' · público' : '') + '</small></div>' +
          '<span class="ce-cf-acts">' +
            '<button type="button" class="btn-dark btn-xs" aria-label="Subir" onclick="Reservalope.ceMoveCustom(' + i + ', -1)"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
            '<button type="button" class="btn-dark btn-xs" aria-label="Bajar" onclick="Reservalope.ceMoveCustom(' + i + ', 1)"' + (i === list.length - 1 ? ' disabled' : '') + '>↓</button>' +
            '<button type="button" class="btn-dark btn-xs" aria-label="Editar ' + E(f.label) + '" onclick="Reservalope.ceEditCustom(\'' + E(f.key) + '\')">' + ic('edit') + '</button>' +
            '<button type="button" class="btn-danger btn-xs" aria-label="Eliminar ' + E(f.label) + '" onclick="Reservalope.ceDeleteCustom(\'' + E(f.key) + '\')">' + ic('trash') + '</button>' +
          '</span></li>').join('') + '</ol>'
        : '<div class="chart-empty">Aún no hay campos propios.</div>') +
      '<fieldset class="ce-fieldset ce-cf-form"><legend>' + (cur ? 'Editar campo' : 'Nuevo campo') + '</legend>' +
        '<div class="form-grid-2">' +
          '<div><label class="field-lbl" for="ce-cf-label">Nombre</label><input type="text" id="ce-cf-label" class="input-dark" maxlength="40" value="' + E(v.label) + '" oninput="Reservalope.ceAutoKey()" placeholder="p. ej. Alergias" /></div>' +
          '<div><label class="field-lbl" for="ce-cf-key">Clave interna</label><input type="text" id="ce-cf-key" class="input-dark" maxlength="30" value="' + E(v.key) + '"' + (cur ? ' readonly' : '') + ' data-touched="' + (cur ? '1' : '') + '" oninput="this.dataset.touched=\'1\'" placeholder="alergias" />' +
            '<span class="field-hint">' + (cur ? 'La clave no cambia (así se conservan los datos guardados).' : 'Minúsculas, números y _. Se completa sola.') + '</span></div>' +
          '<div><label class="field-lbl" for="ce-cf-type">Tipo</label><select id="ce-cf-type" class="input-dark" onchange="Reservalope.ceTypeChange()">' +
            CrmConfig.TYPES.map(x => '<option value="' + x.key + '"' + (x.key === v.type ? ' selected' : '') + '>' + E(x.label) + '</option>').join('') + '</select></div>' +
          '<div id="ce-cf-opts-wrap"' + (v.type === 'select' ? '' : ' hidden') + '><label class="field-lbl" for="ce-cf-options">Opciones (una por línea)</label><textarea id="ce-cf-options" class="input-dark" rows="3">' + E((v.options || []).join('\n')) + '</textarea></div>' +
        '</div>' +
        '<div class="ce-grid">' +
          this.ceChk('ce-cf-req', 'Obligatorio', v.required, '') +
          this.ceChk('ce-cf-list', 'Mostrar en la lista', v.showInList, '') +
          (e === 'appointments' ? this.ceChk('ce-cf-pub', 'Público', v.public, '') : '') +
        '</div>' +
        (e === 'appointments' ? '<p class="ce-hint ce-note">' + ic('alert') + ' Los campos públicos aparecen en el formulario de reserva en línea de la web.</p>' : '') +
        '<div class="row-actions">' +
          '<button type="button" class="btn-golden btn-xs" id="ce-cf-save" onclick="Reservalope.ceSaveCustom()">' + ic(cur ? 'check' : 'plus') + (cur ? 'Guardar campo' : 'Agregar campo') + '</button>' +
          (cur ? '<button type="button" class="btn-dark btn-xs" onclick="Reservalope.ceCancelCustom()">Cancelar</button>' : '') +
        '</div>' +
      '</fieldset>';
  },
  ceEntity(e) { this.ce.entity = e; this.ce.edit = null; this.ceRenderPanel(); },
  ceAutoKey() {
    const k = document.getElementById('ce-cf-key');
    if (!k || k.dataset.touched === '1') return;
    let s = DB.slugify(document.getElementById('ce-cf-label').value).replace(/-/g, '_').replace(/^[^a-z]+/, '').slice(0, 30);
    if (s.length === 1) s += '_1';
    k.value = s;
  },
  ceTypeChange() {
    const w = document.getElementById('ce-cf-opts-wrap');
    if (w) w.hidden = document.getElementById('ce-cf-type').value !== 'select';
  },
  ceEditCustom(key) { this.ce.edit = { entity: this.ce.entity, key }; this.ceRenderPanel(); },
  ceCancelCustom() { this.ce.edit = null; this.ceRenderPanel(); },
  ceSaveCustom() {
    const e = this.ce.entity;
    const list = this.ce.cfg.customFields[e];
    const err = document.getElementById('ce-error');
    const ed = this.ce.edit && this.ce.edit.entity === e ? this.ce.edit.key : null;
    const val = (id) => (document.getElementById(id) || {}).value || '';
    const chk = (id) => !!(document.getElementById(id) || {}).checked;
    const label = val('ce-cf-label').trim();
    const key = val('ce-cf-key').trim();
    const type = val('ce-cf-type');
    const f = { key, label, type, required: chk('ce-cf-req'), showInList: chk('ce-cf-list') };
    if (type === 'select') f.options = Array.from(new Set(val('ce-cf-options').split('\n').map(s => s.trim()).filter(Boolean)));
    if (e === 'appointments') f.public = chk('ce-cf-pub');
    if (!label || label.length > 40 || /[<>"]/.test(label)) { err.textContent = 'El nombre debe tener de 1 a 40 caracteres, sin < > ".'; return false; }
    if (!CrmConfig.KEY_RE.test(key)) { err.textContent = 'La clave debe empezar con letra y usar solo minúsculas, números y _ (2 a 30).'; return false; }
    if (list.some(x => x.key === key && x.key !== ed)) { err.textContent = 'Ya existe un campo con la clave “' + key + '”.'; return false; }
    if (type === 'select' && (!f.options.length || f.options.length > 20 || f.options.some(o => o.length > 40 || /[<>"]/.test(o)))) { err.textContent = 'Agrega de 1 a 20 opciones (hasta 40 caracteres, sin < > ").'; return false; }
    if (!ed && list.length >= CrmConfig.MAX_CUSTOM) { err.textContent = 'Máximo ' + CrmConfig.MAX_CUSTOM + ' campos propios.'; return false; }
    if (ed) list[list.findIndex(x => x.key === ed)] = f; else list.push(f);
    // Con columnas propias elegidas, "mostrar en la lista" agrega o quita su columna
    if (e === 'appointments' && this.ce.cfg.lists.appointments.columns) {
      const cols = this.ce.cfg.lists.appointments.columns;
      const ck = 'x:' + key;
      if (f.showInList && !cols.includes(ck) && cols.length < CrmConfig.MAX_COLUMNS) cols.push(ck);
      if (!f.showInList && cols.includes(ck)) this.ceDropColumn(ck);
    }
    this.ce.edit = null;
    this.ceRenderPanel();
    this.cePreview();
    return true;
  },
  ceMoveCustom(i, d) {
    const list = this.ce.cfg.customFields[this.ce.entity];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    const [f] = list.splice(i, 1); list.splice(j, 0, f);
    this.ceRenderPanel();
    this.cePreview();
  },
  ceDeleteCustom(key) {
    const e = this.ce.entity;
    const list = this.ce.cfg.customFields[e];
    const i = list.findIndex(f => f.key === key);
    if (i < 0) return;
    list.splice(i, 1);
    if (e === 'appointments') this.ceDropColumn('x:' + key);   // su columna también se va
    if (this.ce.edit && this.ce.edit.key === key) this.ce.edit = null;
    this.ceRenderPanel();
    this.cePreview();
  },

  /* ---------- Apariencia ---------- */
  cePanelTheme() {
    const th = this.ce.cfg.theme;
    const t = this.ceT();
    const pal = TenantBrand.paletteOf(t);
    const usePal = !th.primary && !th.accent;
    const E = UI.esc;
    const radio = (name, val, lbl) => '<label class="ce-seg-radio"><input type="radio" name="ce-th-' + name + '" id="ce-th-' + name + '-' + val + '" value="' + val + '"' + (th[name] === val ? ' checked' : '') +
      ' onchange="Reservalope.ceSetTheme(\'' + name + '\', this.value)" /> <span>' + E(lbl) + '</span></label>';
    const color = (k, lbl, def) => '<div class="ce-color"><label class="field-lbl" for="ce-th-' + k + '">' + lbl + '</label>' +
      '<div class="color-field"><input type="color" id="ce-th-' + k + '" value="' + E(th[k] || def) + '"' + (usePal ? ' disabled' : '') + ' oninput="Reservalope.ceSetColor(\'' + k + '\', this.value)" />' +
      '<input type="text" id="ce-th-' + k + '-hex" class="input-dark" maxlength="7" value="' + E((th[k] || def).toUpperCase()) + '"' + (usePal ? ' disabled' : '') + ' aria-label="' + lbl + ' en hexadecimal" onchange="Reservalope.ceSetColor(\'' + k + '\', this.value)" /></div></div>';
    return '<fieldset class="ce-fieldset"><legend>Modo</legend><div class="ce-segs">' +
        radio('mode', 'dark', 'Oscuro') + radio('mode', 'light', 'Claro') + radio('mode', 'auto', 'Automático (según el equipo)') + '</div></fieldset>' +
      '<fieldset class="ce-fieldset"><legend>Colores</legend>' +
        this.ceChk('ce-th-usepal', 'Usar la paleta del negocio', usePal, 'Reservalope.ceUsePalette(this.checked)') +
        '<div class="form-grid-2">' + color('primary', 'Principal (botones y activos)', pal.secondary) + color('accent', 'Acento (detalles)', th.primary || pal.secondary) + '</div>' +
        '<p class="ce-hint">Si un color no se lee bien sobre el fondo, se ajusta solo y aquí se avisa.</p>' +
      '</fieldset>' +
      '<fieldset class="ce-fieldset"><legend>Texto y espacios</legend><div class="form-grid-2">' +
        '<div><label class="field-lbl" for="ce-th-font">Tipografía</label><select id="ce-th-font" class="input-dark" onchange="Reservalope.ceSetTheme(\'font\', this.value)">' +
          Object.keys(CrmConfig.FONTS).map(k => '<option value="' + k + '"' + (th.font === k ? ' selected' : '') + '>' + E(CrmConfig.FONTS[k].label) + '</option>').join('') + '</select></div>' +
        '<div><label class="field-lbl" for="ce-th-density">Densidad</label><select id="ce-th-density" class="input-dark" onchange="Reservalope.ceSetTheme(\'density\', this.value)">' +
          [['comfortable', 'Cómoda'], ['compact', 'Compacta']].map(([k, l]) => '<option value="' + k + '"' + (th.density === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
        '<div><label class="field-lbl" for="ce-th-radius">Esquinas</label><select id="ce-th-radius" class="input-dark" onchange="Reservalope.ceSetTheme(\'radius\', this.value)">' +
          [['sharp', 'Rectas'], ['soft', 'Suaves'], ['round', 'Redondeadas']].map(([k, l]) => '<option value="' + k + '"' + (th.radius === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></div>' +
        '<div class="ce-logo-opt">' + this.ceChk('ce-th-logo', 'Mostrar el logo en la barra (si no, el nombre)', th.logoInNav, 'Reservalope.ceSetTheme(\'logoInNav\', this.checked)') + '</div>' +
      '</div></fieldset>';
  },
  ceSetTheme(k, v) { this.ce.cfg.theme[k] = v; this.cePreview(); },
  ceUsePalette(on) {
    const th = this.ce.cfg.theme;
    if (on) { th.primary = null; th.accent = null; }
    else { const pal = TenantBrand.paletteOf(this.ceT()); th.primary = pal.secondary.toUpperCase(); th.accent = null; }
    this.ceRenderPanel();
    this.cePreview();
  },
  ceSetColor(k, v) {
    v = String(v || '').trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(v)) { document.getElementById('ce-error').textContent = 'El color debe tener el formato #RRGGBB.'; return; }
    document.getElementById('ce-error').textContent = '';
    this.ce.cfg.theme[k] = v.toUpperCase();
    const a = document.getElementById('ce-th-' + k), b = document.getElementById('ce-th-' + k + '-hex');
    if (a && a.value.toUpperCase() !== v.toUpperCase()) a.value = v;
    if (b && b.value.toUpperCase() !== v.toUpperCase()) b.value = v.toUpperCase();
    this.cePreview();
  },

  /* ---------- Web (portada pública) ---------- */
  cePanelSite() {
    const s = this.ce.cfg.site;
    const E = UI.esc;
    return '<p class="ce-hint">Portada de la web pública. Vacío usa los textos e imagen por defecto.</p>' +
      '<div class="form-stack">' +
        '<div><label class="field-lbl" for="ce-site-title">Título de portada</label><input type="text" id="ce-site-title" class="input-dark" maxlength="80" value="' + E(s.heroTitle) + '" oninput="Reservalope.ceSetSite(\'heroTitle\', this.value)" /><span class="field-hint">Hasta 80 caracteres.</span></div>' +
        '<div><label class="field-lbl" for="ce-site-sub">Subtítulo</label><textarea id="ce-site-sub" class="input-dark" rows="2" maxlength="200" oninput="Reservalope.ceSetSite(\'heroSubtitle\', this.value)">' + E(s.heroSubtitle) + '</textarea><span class="field-hint">Hasta 200 caracteres.</span></div>' +
        '<div><label class="field-lbl" for="ce-site-img">Imagen de portada (enlace https://)</label><input type="url" id="ce-site-img" class="input-dark" maxlength="500" value="' + E(s.heroImage) + '" placeholder="https://…" oninput="Reservalope.ceSetSite(\'heroImage\', this.value)" />' +
          '<div class="row-actions" style="margin-top:8px;"><label class="btn-dark btn-xs" for="ce-site-file">' + ic('upload') + 'Subir imagen</label>' +
          '<input type="file" id="ce-site-file" accept="image/png,image/jpeg,image/webp" class="sr-only" onchange="Reservalope.ceUploadHero(this)" />' +
          (s.heroImage ? '<button type="button" class="btn-dark btn-xs" onclick="Reservalope.ceClearHero()">' + ic('trash') + 'Quitar imagen</button>' : '') + '</div></div>' +
      '</div>' +
      '<span class="card-kicker" style="display:block;margin-top:16px;">Así se verá la portada</span>' +
      '<div class="ce-hero" id="ce-hero"></div>';
  },
  ceSetSite(k, v) { this.ce.cfg.site[k] = v; this.ceHero(); },
  ceHero() {
    const el = document.getElementById('ce-hero');
    if (!el || !this.ce) return;
    const s = this.ce.cfg.site, t = this.ceT();
    const pal = TenantBrand.paletteOf(t);
    const img = /^https:\/\/[^\s"'<>]+$/.test((s.heroImage || '').trim()) ? s.heroImage.trim() : '';
    el.style.setProperty('--h-bg', pal.primary); el.style.setProperty('--h-fg', pal.tertiary); el.style.setProperty('--h-ac', pal.secondary);
    el.style.backgroundImage = img ? 'linear-gradient(rgba(0,0,0,.55), rgba(0,0,0,.55)), url("' + img.replace(/["\\]/g, '') + '")' : '';
    el.innerHTML = '<strong>' + UI.esc(s.heroTitle || t.name) + '</strong><span>' + UI.esc(s.heroSubtitle || this.ceV('Reserva tu {appointment} en línea.')) + '</span>' +
      '<em>' + UI.esc(this.ceV('Reservar {appointment}')) + '</em>';
  },
  async ceUploadHero(input) {
    const file = input && input.files && input.files[0];
    const err = document.getElementById('ce-error');
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 4 * 1024 * 1024) { err.textContent = 'Usa una imagen JPG, PNG o WebP de hasta 4 MB.'; return; }
    const dataUrl = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
    err.textContent = 'Subiendo imagen…';
    try {
      const url = await DB.uploadImage(dataUrl, this.ce.id);
      if (!/^https:\/\//.test(url || '') || url.length > 500) throw new Error('El enlace de la imagen no es válido.');
      this.ce.cfg.site.heroImage = url;
      err.textContent = '';
      this.ceRenderPanel();
      this.cePreview();
    } catch (e) { err.textContent = DB.errorText(e); }
  },
  ceClearHero() { this.ce.cfg.site.heroImage = ''; this.ceRenderPanel(); this.cePreview(); },

  /* ---------- Vista previa en vivo (mini CRM con el tema elegido) ---------- */
  cePreview() {
    const el = document.getElementById('ce-preview');
    if (!el || !this.ce) return;
    const c = this.ce.cfg, t = this.ceT();
    const E = UI.esc, V = (s) => this.ceV(s);
    const r = CrmConfig.applyThemeTo(el, t, c);
    el.setAttribute('data-crm-logo', t.logo && !c.theme.logoInNav ? 'off' : 'on');
    const mods = CrmConfig.MODULES.filter(m => m.tab && c.modules[m.key] !== false).slice(0, 5);
    const cols = CrmConfig.apptColumns(c).slice(0, 8);
    const sample = { client: 'Lucía Torres', phone: '987 654 321', service: V('{Service}') === 'Servicio' ? 'Corte clásico' : V('{Service}') + ' general', staff: 'Ana', date: 'Hoy', time: '10:30', price: (t.currency || 'S/') + ' 40', status: '<span class="st-badge st-CONFIRMADA_WSP">Confirmada</span>', source: 'Web', notes: '—' };
    const colLbl = (k) => {
      if (/^x:/.test(k)) { const f = c.customFields.appointments.find(x => x.key === k.slice(2)); return f ? f.label : k; }
      return V((CrmConfig.APPT_COLUMNS.find(x => x.key === k) || {}).label || k);
    };
    const cell = (k) => /^x:/.test(k) ? '—' : (k === 'status' ? sample.status : E(sample[k]));
    const brand = (t.logo && c.theme.logoInNav) ? TenantBrand.logoHTML(t, 'cep-logo') : '<span class="cep-name">' + E(t.name) + '</span>';
    const ph = c.fields.appointments.phone;
    const firstCustom = c.customFields.appointments[0];
    el.innerHTML =
      '<div class="cep-top">' + brand + '<span class="crm-tag">CRM</span></div>' +
      '<div class="cep-shell">' +
        '<nav class="cep-nav" aria-label="Menú de ejemplo">' + (mods.length ? mods.map((m, i) => '<span class="cep-nav-item' + (i === 0 ? ' active' : '') + '">' + E(V(m.label)) + '</span>').join('') : '<span class="cep-nav-item">Configuración</span>') + '</nav>' +
        '<div class="cep-body">' +
          '<div class="cep-kpis">' +
            '<div class="crm-kpi-card"><div class="crm-kpi-label">' + E(V('{AppointmentPlural} de hoy')) + '</div><div class="crm-kpi-val">12</div><div class="crm-kpi-sub">3 por confirmar</div></div>' +
            '<div class="crm-kpi-card"><div class="crm-kpi-label">Ingresos</div><div class="crm-kpi-val">' + E((t.currency || 'S/') + ' 480') + '</div><div class="crm-kpi-sub cep-accent">+12% vs. ayer</div></div>' +
          '</div>' +
          '<div class="table-wrap cep-table"><table class="crm-table"><thead><tr>' + cols.map(k => '<th>' + E(colLbl(k)) + '</th>').join('') + '</tr></thead>' +
            '<tbody><tr>' + cols.map(k => '<td>' + cell(k) + '</td>').join('') + '</tr></tbody></table></div>' +
          '<div class="cep-form">' +
            '<label class="field-lbl" for="cep-in">' + E(V('{Client}')) + '</label><input id="cep-in" class="input-dark" value="Lucía Torres" readonly tabindex="-1" />' +
            (ph.show ? '<label class="field-lbl" for="cep-ph">Celular' + (ph.required ? ' *' : '') + '</label><input id="cep-ph" class="input-dark" placeholder="987 654 321" readonly tabindex="-1" />' : '') +
            (firstCustom ? '<label class="field-lbl" for="cep-x">' + E(firstCustom.label) + (firstCustom.required ? ' *' : '') + '</label><input id="cep-x" class="input-dark" readonly tabindex="-1" />' : '') +
            '<div class="cep-btns"><span class="btn-dark btn-xs">Cancelar</span><span class="btn-golden btn-xs">' + E(V('Guardar {appointment}')) + '</span></div>' +
          '</div>' +
        '</div>' +
      '</div>';
    // Avisos de contraste
    const box = document.getElementById('ce-contrast');
    if (box) {
      const bad = r.checks.filter(x => !x.ok);
      box.innerHTML = '<ul class="ce-checks">' + r.checks.map(x =>
        '<li class="' + (x.ok ? 'is-ok' : 'is-bad') + '">' + ic(x.ok ? 'checkCircle' : 'alert') + '<span>' + E(x.label) + '</span><code>' + x.ratio.toFixed(1) + ':1</code></li>').join('') + '</ul>' +
        r.notes.map(n => '<p class="ce-warn" data-note="' + n.key + '">' + ic('alert') + '<span>El color ' + E(n.from) + ' se lee poco sobre el fondo (' + n.ratio.toFixed(1) + ':1). Se usará ' + E(n.to) + ' para que tenga contraste 4.5:1.</span></p>').join('') +
        (bad.length ? '<p class="ce-warn">' + ic('alert') + '<span>Hay textos con poco contraste. Elige otros colores.</span></p>' : '');
    }
    this.ceHero();
    return r;
  },

  /* ---------- Guardar / restablecer ---------- */
  ceReset() {
    if (!this.ce) return;
    this.ce.cfg = CrmConfig.defaults();
    this.ce.edit = null;
    this.ceRenderPanel();
    this.cePreview();
    document.getElementById('ce-error').textContent = 'Se volvió a la configuración por defecto. Pulsa Guardar para aplicarlo.';
  },

  async ceSave() {
    if (!this.ce || this.ce.saving) return false;
    if (!this.ceIsSA()) { Guard.deny('Solo el superadministrador puede personalizar el CRM.'); return false; }
    const t = this.ceT();
    const err = document.getElementById('ce-error');
    const s = this.ce.cfg.site;
    ['heroTitle', 'heroSubtitle', 'heroImage'].forEach(k => { s[k] = String(s[k] || '').trim(); });
    const errs = CrmConfig.validate(this.ce.cfg);
    if (errs.length) { err.textContent = errs[0]; return false; }
    const out = CrmConfig.compact(this.ce.cfg);
    const errs2 = CrmConfig.validate(out);
    if (errs2.length) { err.textContent = errs2[0]; return false; }
    this.ce.saving = true;
    const btn = document.getElementById('ce-save');
    if (btn) btn.disabled = true;
    try {
      const { data, error } = await DB.client().from('tenants').update({ crm_config: out }).eq('id', t.id).select('id');
      if (error) throw error;
      if (!data || !data.length) throw new Error('No tienes permiso para guardar este cambio.');
    } catch (e) {
      err.textContent = DB.errorText(e);
      this.ce.saving = false;
      if (btn) btn.disabled = false;
      return false;
    }
    t.crmConfig = out;
    const parts = Object.keys(out);
    DB.log('Personalizó el CRM', t.name + ' · ' + (parts.length ? parts.join(', ') : 'configuración por defecto'), { tenantId: t.id });
    this.ce = null;
    ModalComponent.close();
    UI.toast(parts.length ? 'Personalización del CRM guardada.' : 'El CRM volvió a la configuración por defecto.');
    if (this.pane === 'detail') this.renderDetail();
    return true;
  }
});

window.addEventListener('DOMContentLoaded', () => Reservalope.init());
