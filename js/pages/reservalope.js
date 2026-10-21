/* ==========================================================================
   Reservalope · Consola del superadministrador
   Dashboard global, cartera de barberías, ficha individual, alertas,
   usuarios, historial y plataforma.
   ========================================================================== */
var Guard = window.Guard || { deny(msg) { UI.toast(msg || 'No tienes permiso para realizar esta acción.', 'error'); } };

const Reservalope = {
  PALETTE: { primary: '#000000', secondary: '#FFD503', tertiary: '#FFFFFF' },
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
    TenantBrand.applyPalette(this.PALETTE);

    AdminUI.init();
    AdminUI.renderHeader();
    // Al crear/editar/suspender una barbería desde los modales compartidos, refrescar la consola
    AdminUI.renderTenants = () => this.refresh();

    try {
      const p = JSON.parse(localStorage.getItem('RESERVALOPE_PERIOD') || 'null');
      if (p && p.preset) { this.preset = p.preset; this.from = p.from; this.to = p.to; }
    } catch (e) {}

    const d = document.getElementById('rl-date');
    if (d) d.textContent = Charts.dateLong(DB.todayISO());
    this.mountPeriod();
    this.fillPlanFilter();
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

  /* ---------------- Navegación (con enlaces directos #pane / #barberia/id) ---------------- */
  fromHash() {
    const h = (window.location.hash || '').replace('#', '');
    if (h.indexOf('barberia/') === 0) {
      const id = h.split('/')[1];
      if (DB.tenantById(id)) return this.show('detail', id);
    }
    if (h === 'reportes' || h.indexOf('reportes/') === 0) {
      const id = h.split('/')[1];
      return this.show('reports', id && DB.tenantById(id) ? id : 'ALL');
    }
    const valid = ['dashboard', 'tenants', 'alerts', 'users', 'audit', 'platform'];
    this.show(valid.includes(h) ? h : 'dashboard');
  },

  go(pane, id) {
    const target = pane === 'detail' ? 'barberia/' + id
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

  /* ---------------- Reportes (por barbería o comparativo) ---------------- */
  renderReports() {
    ReportBuilder.mount(document.getElementById('rl-reports-root'), {
      mode: 'console',
      tenantId: this.reportScope || 'ALL',
      money: true,
      canExport: () => !!(Auth.user && Auth.user.role === 'SUPERADMIN')
    });
  },

  // El selector de barbería del reporte actualiza el enlace sin recargar la vista
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

  kpiGrid(cur, prev, cs) {
    const D = Analytics.delta.bind(Analytics);
    const rateD = (a, b) => (a == null || b == null) ? null : a - b;
    return [
      this.kpi({ hero: true, label: 'Ingresos del período', value: Charts.money(cur.revenue, cs), delta: D(cur.revenue, prev.revenue), sub: 'vs ' + Charts.money(prev.revenue, cs) + ' antes' }),
      this.kpi({ label: 'Citas', value: cur.appts.toLocaleString('es-PE'), delta: D(cur.appts, prev.appts), sub: cur.pending ? cur.pending + ' pendientes' : '' }),
      this.kpi({ label: 'Ticket promedio', value: Charts.money(cur.avgTicket, cs), delta: D(cur.avgTicket, prev.avgTicket) }),
      this.kpi({ label: 'Clientes únicos', value: cur.clients.toLocaleString('es-PE'), delta: D(cur.clients, prev.clients) }),
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
      (currencies.length > 1 ? '<br/><span class="text-warn">' + ic('alert') + ' Hay barberías con distinta moneda (' + UI.esc(currencies.join(', ')) + '); los totales globales suman montos sin convertir.</span>' : '');

    document.getElementById('rl-dash-kpis').innerHTML = this.kpiGrid(cur, prev, cs);

    const pf = Analytics.platform();
    document.getElementById('rl-dash-platform').innerHTML =
      '<div class="rl-pf-item"><span>Barberías activas</span><strong>' + pf.active + ' <small>de ' + pf.tenants + '</small></strong></div>' +
      '<div class="rl-pf-item"><span>Ingreso mensual por suscripciones</span><strong>' + Charts.money(pf.mrr, 'S/') + '</strong></div>' +
      '<div class="rl-pf-item"><span>Planes</span><strong class="rl-plans">' + pf.byPlan.map(x => '<em>' + x.label + ' ' + x.count + '</em>').join('') + '</strong></div>' +
      '<div class="rl-pf-item' + (pf.expiring + pf.expired ? ' is-warn' : '') + '"><span>Suscripciones por vencer / vencidas</span><strong>' + pf.expiring + ' / ' + pf.expired + '</strong></div>' +
      '<div class="rl-pf-item"><span>Usuarios activos</span><strong>' + pf.users + (pf.locked ? ' <small>· ' + pf.locked + ' bloqueado(s)</small>' : '') + '</strong></div>';

    this.lineFor('rl-dash-line', 'rl-dash-line-legend', cur, prev, r, p, cs);

    const prevBy = {}; prev.per.forEach(m => { prevBy[m.tenant.id] = m; });
    const rank = cur.per.slice().sort((a, b) => b.revenue - a.revenue).map(m => {
      const d = Analytics.delta(m.revenue, (prevBy[m.tenant.id] || {}).revenue || 0);
      return {
        label: m.tenant.name, value: m.revenue, sub: m.appts + ' citas · ' + m.walkins + ' walk-in' + (m.tenant.status !== 'ACTIVE' ? ' · suspendida' : ''),
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

  /* ---------------- Barberías ---------------- */
  fillPlanFilter() {
    const sel = document.getElementById('rl-t-plan');
    if (sel) sel.innerHTML = '<option value="ALL">Todos</option>' + Object.keys(DB.PLANS).map(k => '<option value="' + k + '">' + DB.PLANS[k].label + '</option>').join('');
  },

  /* C1: la paleta la puede escribir el administrador de la barbería (por API).
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
    const list = DB.load().tenants.filter(t =>
      (st === 'ALL' || t.status === st) && (pl === 'ALL' || t.plan === pl) &&
      (!q || (t.name + ' ' + t.slug).toLowerCase().includes(q)));
    if (!list.length) {
      tbody.innerHTML = '<tr class="is-empty"><td colspan="9"><div class="empty-state">' + ic('store') + '<strong>Sin barberías</strong>No hay barberías con esos filtros.</div></td></tr>';
      return;
    }
    tbody.innerHTML = list.map(t => {
      const m = Analytics.tenantMetrics(t, r), pm = Analytics.tenantMetrics(t, p);
      const lost = m.appts ? (m.cancelled + m.noShow) / m.appts : null;
      return '<tr>' +
        '<td data-label="Barbería"><div class="rl-tenant-cell">' + this.swatches(t) + '<div><strong>' + UI.esc(t.name) + '</strong><br/><a class="tenant-link" href="index.html?b=' + encodeURIComponent(t.slug) + '" target="_blank" rel="noopener">?b=' + UI.esc(t.slug) + '</a></div></div></td>' +
        '<td data-label="Estado">' + (t.status === 'ACTIVE' ? '<span class="st-badge st-COMPLETADA">Activa</span>' : '<span class="st-badge st-CANCELADA">Suspendida</span>') + '</td>' +
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
            (active ? '<span class="st-badge st-COMPLETADA">Activa</span>' : '<span class="st-badge st-CANCELADA">Suspendida</span>') + '</div>' +
          '<dl class="rl-facts">' +
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
            (active ? '<button type="button" class="btn-danger btn-xs" onclick="AdminUI.toggleTenant(\'' + t.id + '\')">Suspender</button>'
                    : '<button type="button" class="btn-golden btn-xs" onclick="AdminUI.toggleTenant(\'' + t.id + '\')">Reactivar</button>') +
          '</div>' +
        '</div>' +
      '</section>';

    document.getElementById('rl-detail-kpis').innerHTML = this.kpiGrid(cur, prev, cs);
    this.lineFor('rl-detail-line', 'rl-detail-line-legend', cur, prev, r, p, cs);

    const barbers = Object.entries(cur.byBarber).sort((a, b) => b[1].revenue - a[1].revenue);
    document.getElementById('rl-detail-barbers').innerHTML = barbers.length ? barbers.map(([name, b]) =>
      '<tr><td data-label="Barbero"><strong>' + UI.esc(name) + '</strong></td><td data-label="Citas">' + b.appts + '</td><td data-label="Completadas">' + b.completed + '</td>' +
      '<td data-label="Walk-in">' + b.walkins + '</td><td data-label="Ingresos"><strong>' + Charts.money(b.revenue, cs) + '</strong></td>' +
      '<td data-label="Ocupación"><div class="meter" role="img" aria-label="Ocupación ' + Charts.pct(b.occupancy) + '"><span style="width:' + Math.round(b.occupancy * 100) + '%;"></span></div><span class="meter-val">' + Charts.pct(b.occupancy) + '</span></td></tr>'
    ).join('') : '<tr class="is-empty"><td colspan="6"><div class="empty-state">' + ic('users') + '<strong>Sin barberos</strong>Esta barbería aún no registra barberos.</div></td></tr>';

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
      '<p class="card-text" style="margin-top:12px;">Base de datos de Supabase (plan gratis: 500 MB). Las fotos se guardan aparte, en Storage. Abajo, el volumen de datos de cada barbería.</p>' +
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
    DB.log('Exportó un respaldo completo', root.tenants.length + ' barberías · ' + root.users.length + ' usuarios', { tenantId: null });
  },

  // En producción no existe "borrar todo": los datos viven en Supabase y tienen respaldo.
  factoryReset() {
    UI.toast('No disponible en producción. Para empezar de cero se usa un proyecto nuevo de Supabase.', 'error');
  },

  /* ---------------- CSV comparativo ---------------- */
  exportCSV() {
    const r = this.range(), p = Analytics.previous(r);
    const head = ['Barbería', 'Enlace', 'Estado', 'Plan', 'Monto mensual', 'Vence', 'Moneda', 'Ingresos', 'Ingresos período anterior', 'Variación %', 'Citas', 'Completadas', 'Canceladas', 'No asistió', '% Cancelación', 'Walk-in', 'Ticket promedio', 'Clientes únicos', '% Reservas web', 'Última actividad'];
    const rows = DB.load().tenants.map(t => {
      const m = Analytics.tenantMetrics(t, r), pm = Analytics.tenantMetrics(t, p);
      const d = Analytics.delta(m.revenue, pm.revenue);
      return [t.name, t.slug, t.status === 'ACTIVE' ? 'Activa' : 'Suspendida', (DB.PLANS[t.plan] || {}).label, t.planFee, t.subscriptionEnd, t.currency,
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
    DB.log('Exportó CSV comparativo', rows.length + ' barberías · ' + r.from + ' a ' + r.to, { tenantId: null });
    UI.toast('CSV descargado.');
  }
};

window.addEventListener('DOMContentLoaded', () => Reservalope.init());
