/* ==========================================================================
   Constructor de reportes (interfaz): filtros, contenido, vista previa y
   botones de descarga. Se usa en CRM › Reportes y en Reservalope › Reportes.
   opts: { mode: 'crm'|'console', tenantId, money, canExport() }
   ========================================================================== */
const ReportBuilder = {
  st: null,
  PREVIEW_ROWS: 15,

  esc(s) { return UI.esc(s == null ? '' : String(s)); },

  mount(root, opts) {
    if (!root) return;
    const prev = this.st && this.st.root === root ? this.st : null;
    this.st = {
      root,
      mode: opts.mode || 'crm',
      money: opts.money !== false,
      customers: opts.customers !== false,
      canExport: opts.canExport || (() => true),
      scope: opts.tenantId || (prev ? prev.scope : 'ALL'),
      filters: prev ? prev.filters : Reports.defaultFilters(),
      sections: prev ? prev.sections : Reports.SECTIONS.map(s => s.key).filter(k => opts.money !== false || k !== 'sales'),
      busy: false
    };
    if (opts.tenantId && prev && prev.scope !== opts.tenantId) { this.st.filters = Reports.defaultFilters(); }
    this.render();
    if (!this._docBound) {
      this._docBound = true;
      document.addEventListener('click', (e) => {
        if (!e.target.closest('.rp-ms')) this.closeMenus();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.closeMenus(true); });
    }
  },

  /* Barberías en alcance */
  tenants() {
    const st = this.st;
    if (st.mode === 'crm') return [DB.tenantById(st.scope) || DB.tenant].filter(Boolean);
    const all = DB.load().tenants;
    if (st.scope !== 'ALL') return all.filter(t => t.id === st.scope);
    return st.filters.tenants.length ? all.filter(t => st.filters.tenants.includes(t.id)) : all;
  },
  isGlobal() { return this.st.mode === 'console' && this.st.scope === 'ALL'; },

  buildReport() {
    return Reports.build({ tenants: this.tenants(), global: this.isGlobal(), filters: this.st.filters, sections: this.st.sections, money: this.st.money, customers: this.st.customers });
  },

  /* ---------------- Render principal ---------------- */
  render() {
    const st = this.st;
    const f = st.filters;
    const allTenants = DB.load().tenants;
    const opt = Reports.options(this.tenants());
    const scopeHTML = st.mode === 'console'
      ? '<div class="rp-scope">' +
          '<div><label class="field-lbl" for="rp-scope">Barbería</label>' +
          '<select id="rp-scope" class="input-dark" data-rp="scope">' +
            '<option value="ALL"' + (st.scope === 'ALL' ? ' selected' : '') + '>Todas las barberías (comparativo)</option>' +
            allTenants.map(t => '<option value="' + this.esc(t.id) + '"' + (st.scope === t.id ? ' selected' : '') + '>' + this.esc(t.name) + (t.status !== 'ACTIVE' ? ' (suspendida)' : '') + '</option>').join('') +
          '</select></div>' +
          (st.scope === 'ALL' ? this.msHTML('tenants', 'Barberías incluidas', allTenants.map(t => ({ value: t.id, label: t.name })), f.tenants, 'Todas') : '') +
        '</div>'
      : '';

    const presets = Analytics.PRESETS.map(p =>
      '<button type="button" class="btn-dark' + (f.preset === p.key ? ' active' : '') + '" data-rp-preset="' + p.key + '" aria-pressed="' + (f.preset === p.key) + '">' + p.label + '</button>'
    ).join('');
    const r = Analytics.range(f.preset, f.from, f.to);

    st.root.innerHTML =
      '<section class="crm-section-card rp-card" aria-labelledby="rp-f-title">' +
        '<div class="card-head"><h3 id="rp-f-title">Filtros</h3><button type="button" class="btn-ghost btn-xs" data-rp="clear">' + ic('refresh') + 'Limpiar filtros</button></div>' +
        scopeHTML +
        '<div class="rp-period">' +
          '<span class="field-lbl">Periodo</span>' +
          '<div class="segmented rl-presets" role="group" aria-label="Periodo">' + presets + '</div>' +
          '<div class="rp-custom"' + (f.preset === 'custom' ? '' : ' hidden') + '>' +
            '<label class="sr-only" for="rp-from">Desde</label><input type="date" id="rp-from" class="input-dark" data-rp="from" value="' + r.from + '" />' +
            '<span aria-hidden="true">a</span>' +
            '<label class="sr-only" for="rp-to">Hasta</label><input type="date" id="rp-to" class="input-dark" data-rp="to" value="' + r.to + '" />' +
          '</div>' +
        '</div>' +
        '<div class="rp-grid">' +
          this.msHTML('barbers', 'Barbero', opt.barbers.map(b => ({ value: b, label: b })), f.barbers, 'Todos') +
          this.msHTML('services', 'Servicio', opt.services.map(b => ({ value: b, label: b })), f.services, 'Todos') +
          this.msHTML('statuses', 'Estado', Reports.STATUSES.map(s => ({ value: s.key, label: s.label })), f.statuses, 'Todos') +
          this.msHTML('channels', 'Canal', Reports.CHANNELS.map(s => ({ value: s.key, label: s.label })), f.channels, 'Todos') +
          '<div><label class="field-lbl" for="rp-kind">Tipo</label><select id="rp-kind" class="input-dark" data-rp="kind">' +
            Reports.KINDS.map(k => '<option value="' + k.key + '"' + (f.kind === k.key ? ' selected' : '') + '>' + k.label + '</option>').join('') +
          '</select></div>' +
          '<div><label class="field-lbl" for="rp-q">Cliente</label><input type="search" id="rp-q" class="input-dark" data-rp="q" placeholder="' + (st.customers ? 'Nombre o teléfono' : 'Nombre') + '" value="' + this.esc(f.q) + '" autocomplete="off" /></div>' +
        '</div>' +
      '</section>' +

      '<section class="crm-section-card rp-card" aria-labelledby="rp-c-title">' +
        '<div class="card-head"><h3 id="rp-c-title">Contenido del reporte</h3></div>' +
        '<div class="rp-sections">' + Reports.SECTIONS.map(s => {
          const locked = s.money && !st.money;
          const on = st.sections.includes(s.key);
          return '<label class="rp-sec' + (on ? ' is-on' : '') + (locked ? ' is-locked' : '') + '">' +
            '<input type="checkbox" data-rp-sec="' + s.key + '"' + (on ? ' checked' : '') + (locked ? ' disabled' : '') + ' />' +
            '<span class="rp-sec-check" aria-hidden="true">' + ic('check') + '</span>' +
            '<span class="rp-sec-txt"><strong>' + (s.key === 'people' && !st.customers ? 'Barberos' : s.label) + '</strong><small>' + (locked ? 'Requiere el permiso de Ventas.' : (s.key === 'people' && !st.customers ? 'Desempeño por barbero (la cartera de clientes requiere el permiso de Clientes).' : s.desc)) + '</small></span>' +
          '</label>';
        }).join('') + '</div>' +
      '</section>' +

      '<div class="rp-bar" role="region" aria-label="Descargar reporte">' +
        '<div class="rp-bar-info" id="rp-bar-info" aria-live="polite"></div>' +
        '<div class="rp-bar-actions">' +
          '<button type="button" class="btn-dark" data-rp-export="xlsx">' + ic('download') + 'Excel</button>' +
          '<button type="button" class="btn-golden" data-rp-export="pdf">' + ic('file') + 'PDF</button>' +
        '</div>' +
      '</div>' +

      '<div class="rp-preview" id="rp-preview" aria-live="polite"></div>';

    this.bind();
    this.renderPreview();
  },

  msHTML(key, label, options, selected, allLabel) {
    const id = 'rp-ms-' + key;
    const summary = !selected.length ? allLabel : selected.length === 1
      ? ((options.find(o => o.value === selected[0]) || {}).label || selected[0])
      : selected.length + ' seleccionados';
    return '<div class="rp-ms" data-ms="' + key + '">' +
      '<span class="field-lbl" id="' + id + '-lbl">' + label + '</span>' +
      '<button type="button" class="input-dark rp-ms-btn' + (selected.length ? ' is-active' : '') + '" aria-haspopup="true" aria-expanded="false" aria-controls="' + id + '" aria-labelledby="' + id + '-lbl ' + id + '-val"><span id="' + id + '-val">' + this.esc(summary) + '</span></button>' +
      '<div class="rp-ms-panel" id="' + id + '" role="group" aria-labelledby="' + id + '-lbl" hidden>' +
        '<button type="button" class="rp-ms-all" data-ms-all="' + key + '">' + allLabel + '</button>' +
        (options.length ? options.map(o =>
          '<label class="rp-ms-opt"><input type="checkbox" data-ms-opt="' + key + '" value="' + this.esc(o.value) + '"' + (selected.includes(o.value) ? ' checked' : '') + ' /><span>' + this.esc(o.label) + '</span></label>'
        ).join('') : '<p class="rp-ms-empty">Sin opciones.</p>') +
      '</div>' +
    '</div>';
  },

  closeMenus(focusBtn) {
    if (!this.st) return;
    this.st.root.querySelectorAll('.rp-ms-panel:not([hidden])').forEach(p => {
      p.hidden = true;
      const btn = p.parentElement.querySelector('.rp-ms-btn');
      btn.setAttribute('aria-expanded', 'false');
      if (focusBtn) btn.focus();
    });
  },

  bind() {
    const st = this.st, root = st.root, f = st.filters;
    const rerender = () => this.render();
    root.querySelectorAll('[data-rp-preset]').forEach(b => b.addEventListener('click', () => {
      f.preset = b.getAttribute('data-rp-preset');
      if (f.preset === 'custom' && !f.from) { const r = Analytics.range('30d'); f.from = r.from; f.to = r.to; }
      rerender();
    }));
    const on = (sel, ev, fn) => { const el = root.querySelector(sel); if (el) el.addEventListener(ev, fn); };
    on('[data-rp="from"]', 'change', (e) => { f.from = e.target.value; this.renderPreview(); });
    on('[data-rp="to"]', 'change', (e) => { f.to = e.target.value; this.renderPreview(); });
    on('[data-rp="kind"]', 'change', (e) => { f.kind = e.target.value; this.renderPreview(); });
    let t = null;
    on('[data-rp="q"]', 'input', (e) => { clearTimeout(t); t = setTimeout(() => { f.q = e.target.value.trim().slice(0, 60); this.renderPreview(); }, 250); });
    on('[data-rp="scope"]', 'change', (e) => {
      st.scope = e.target.value;
      st.filters = Object.assign(Reports.defaultFilters(), { preset: f.preset, from: f.from, to: f.to });
      if (st.mode === 'console' && typeof Reservalope !== 'undefined' && Reservalope.setReportHash) Reservalope.setReportHash(st.scope);
      rerender();
    });
    on('[data-rp="clear"]', 'click', () => {
      st.filters = Object.assign(Reports.defaultFilters(), { preset: f.preset, from: f.from, to: f.to });
      rerender();
      UI.toast('Filtros restablecidos.');
    });

    this.bindMs(root);

    root.querySelectorAll('[data-rp-sec]').forEach(cb => cb.addEventListener('change', () => {
      const k = cb.getAttribute('data-rp-sec');
      const set = new Set(st.sections);
      if (cb.checked) set.add(k); else set.delete(k);
      st.sections = Reports.SECTIONS.map(s => s.key).filter(x => set.has(x));
      cb.closest('.rp-sec').classList.toggle('is-on', cb.checked);
      this.renderPreview();
    }));

    root.querySelectorAll('[data-rp-export]').forEach(b => b.addEventListener('click', () => this.exportAs(b.getAttribute('data-rp-export'))));
  },

  bindMs(scope) {
    const root = this.st.root, f = this.st.filters;
    scope.querySelectorAll('.rp-ms-btn').forEach(btn => btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = btn.parentElement.querySelector('.rp-ms-panel');
      const open = panel.hidden;
      this.closeMenus();
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      if (open) { const first = panel.querySelector('input, button'); if (first) first.focus(); }
    }));
    scope.querySelectorAll('[data-ms-opt]').forEach(cb => cb.addEventListener('change', () => {
      const key = cb.getAttribute('data-ms-opt');
      const set = new Set(f[key]);
      if (cb.checked) set.add(cb.value); else set.delete(cb.value);
      f[key] = Array.from(set);
      this.updateMsLabel(key);
      if (key === 'tenants') { f.barbers = []; f.services = []; this.refreshOptionLists(); }
      this.renderPreview();
    }));
    scope.querySelectorAll('[data-ms-all]').forEach(b => b.addEventListener('click', () => {
      const key = b.getAttribute('data-ms-all');
      f[key] = [];
      root.querySelectorAll('[data-ms-opt="' + key + '"]').forEach(cb => { cb.checked = false; });
      this.updateMsLabel(key);
      if (key === 'tenants') { f.barbers = []; f.services = []; this.refreshOptionLists(); }
      this.renderPreview();
    }));

  },

  updateMsLabel(key) {
    const box = this.st.root.querySelector('.rp-ms[data-ms="' + key + '"]');
    if (!box) return;
    const sel = this.st.filters[key];
    const checked = Array.from(box.querySelectorAll('[data-ms-opt]:checked'));
    const all = key === 'tenants' ? 'Todas' : 'Todos';
    const txt = !sel.length ? all : sel.length === 1 ? (checked[0] ? checked[0].nextElementSibling.textContent : sel[0]) : sel.length + ' seleccionados';
    box.querySelector('.rp-ms-btn span').textContent = txt;
    box.querySelector('.rp-ms-btn').classList.toggle('is-active', sel.length > 0);
  },

  // Al cambiar las barberías incluidas se recalculan barberos y servicios
  refreshOptionLists() {
    const opt = Reports.options(this.tenants());
    ['barbers', 'services'].forEach(key => {
      const box = this.st.root.querySelector('.rp-ms[data-ms="' + key + '"]');
      if (!box) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = this.msHTML(key, key === 'barbers' ? 'Barbero' : 'Servicio', opt[key].map(v => ({ value: v, label: v })), [], 'Todos');
      const fresh = tmp.firstChild;
      box.replaceWith(fresh);
      this.bindMs(fresh);
    });
  },

  /* ---------------- Vista previa ---------------- */
  renderPreview() {
    const st = this.st;
    const box = st.root.querySelector('#rp-preview');
    const info = st.root.querySelector('#rp-bar-info');
    const btns = st.root.querySelectorAll('[data-rp-export]');
    const r = Analytics.range(st.filters.preset, st.filters.from, st.filters.to);
    const custom = st.root.querySelector('.rp-custom');
    if (custom) { custom.hidden = st.filters.preset !== 'custom'; }

    if (!st.sections.length) {
      btns.forEach(b => { b.disabled = true; });
      info.innerHTML = '<strong>Elige al menos un contenido</strong> para generar el reporte.';
      box.innerHTML = '<div class="crm-section-card rp-empty">' + ic('alert') + '<p>Marca al menos una sección en <strong>Contenido del reporte</strong>.</p></div>';
      return;
    }
    btns.forEach(b => { b.disabled = st.busy; });
    const rep = this.buildReport();
    const k = rep.kpis;
    const cs = rep.currency;
    info.innerHTML = '<strong>' + k.records.toLocaleString('es-PE') + (k.records === 1 ? ' registro' : ' registros') + '</strong>' +
      (st.money ? '<span>' + Reports.money(k.revenue, cs) + ' en ventas</span>' : '') +
      '<span>' + Reports.fmtDate(r.from) + ' – ' + Reports.fmtDate(r.to) + '</span>' +
      (rep.meta.activeFilters ? '<span class="rp-chip">' + rep.meta.activeFilters + (rep.meta.activeFilters === 1 ? ' filtro' : ' filtros') + '</span>' : '');

    const tables = Reports.tables(rep);
    let html = '<div class="rp-preview-head"><div><span class="eyebrow-golden">Vista previa</span><h2>' + this.esc(rep.meta.title) + '</h2>' +
      '<p>' + this.esc(rep.meta.filters[0][1]) + ' · comparado con ' + this.esc(rep.meta.filters[1][1]) + '</p></div></div>';
    if (rep.mixedCurrency) html += '<p class="text-warn">' + ic('alert') + 'Las barberías usan monedas distintas: los totales suman montos de monedas diferentes.</p>';

    const kpiT = tables.find(t => t.kpi);
    if (kpiT) {
      const pick = st.money
        ? ['Ingresos', 'Ventas (', 'Ticket promedio', 'Citas registradas', 'Tasa de citas completadas', 'Tasa de cancelación', 'Walk-in atendidos', 'Clientes únicos']
        : ['Ventas (', 'Citas registradas', 'Citas completadas', 'Tasa de citas completadas', 'Tasa de cancelación', 'No asistió', 'Walk-in atendidos', 'Clientes únicos'];
      const tiles = pick.map(l => kpiT.rows.find(x => x.label.indexOf(l) === 0)).filter(Boolean);
      html += '<div class="rl-kpis rp-kpis">' + tiles.map(x => {
        const tone = Reports.deltaTone(x);
        return '<div class="crm-kpi-card rl-kpi"><div class="crm-kpi-label">' + this.esc(x.label.replace(/ \(.*\)/, '')) + '</div>' +
          '<div class="crm-kpi-val">' + this.esc(Reports.cellText({ key: 'cur', type: 'auto' }, x, rep)) + '</div>' +
          '<div class="kpi-foot"><span class="kpi-delta is-' + tone + '">' + this.esc(Reports.deltaText(x)) + '</span>' +
          '<span class="crm-kpi-sub">antes ' + this.esc(Reports.cellText({ key: 'prev', type: 'auto' }, x, rep)) + '</span></div></div>';
      }).join('') + '</div>';
      html += '<div class="crm-section-card rp-chart-card"><div class="card-head"><h3>' + (st.money ? 'Ingresos por día' : 'Citas por día') + '</h3>' +
        '<div class="chart-legend-inline"><span><i class="lg-line"></i>Periodo actual</span><span><i class="lg-line is-prev"></i>Periodo anterior</span></div></div>' +
        '<div class="chart-box" id="rp-chart"></div></div>';
    }

    tables.forEach(t => { html += this.tableHTML(t, rep); });
    box.innerHTML = html;

    if (kpiT) {
      const key = st.money ? 'revenue' : 'appts';
      Charts.line(box.querySelector('#rp-chart'), {
        dates: rep.byDay.map(d => d.date), aria: st.money ? 'Ingresos por día' : 'Citas por día',
        series: [{ name: 'Actual', values: rep.byDay.map(d => d[key]), kind: 'current' }, { name: 'Anterior', values: rep.prevByDay.map(d => d[key]), kind: 'previous' }],
        format: (v) => st.money ? Reports.money(v, cs) : String(v)
      });
    }
    this.last = rep;
  },

  tableHTML(t, rep) {
    const limit = t.kpi ? t.rows.length : this.PREVIEW_ROWS;
    const rows = t.rows.slice(0, limit);
    const num = (c) => ['int', 'money', 'pct', 'auto', 'delta'].includes(c.type);
    const head = t.columns.map(c => '<th scope="col"' + (num(c) ? ' class="is-num"' : '') + '>' + this.esc(c.label) + '</th>').join('');
    const body = rows.length ? rows.map(row => '<tr>' + t.columns.map((c, i) => {
      let txt = this.esc(Reports.cellText(c, row, rep));
      if (c.type === 'delta') txt = '<span class="kpi-delta is-' + Reports.deltaTone(row) + '">' + txt + '</span>';
      else if (i === 0) txt = '<strong>' + txt + '</strong>';
      return '<td data-label="' + this.esc(c.label) + '"' + (num(c) ? ' class="is-num"' : '') + '>' + txt + '</td>';
    }).join('') + '</tr>').join('')
      : '<tr class="is-empty"><td colspan="' + t.columns.length + '" class="rp-td-empty">Sin registros con los filtros aplicados.</td></tr>';
    const foot = (t.totals && t.rows.length)
      ? '<tfoot><tr>' + t.columns.map(c => '<td data-label="' + this.esc(c.label) + '"' + (num(c) ? ' class="is-num"' : '') + '>' + this.esc(Reports.cellText(c, Object.assign({ currency: rep.currency }, t.totals), rep)) + '</td>').join('') + '</tr></tfoot>'
      : '';
    const more = t.rows.length > limit
      ? '<p class="rp-more">Vista previa de ' + limit + ' de ' + t.rows.length.toLocaleString('es-PE') + ' filas. El PDF y el Excel incluyen todas.</p>'
      : '';
    return '<section class="crm-section-card rp-table-card">' +
      '<div class="card-head"><h3>' + this.esc(t.title) + '</h3><span class="rp-count">' + t.rows.length.toLocaleString('es-PE') + (t.kpi ? ' indicadores' : ' filas') + '</span></div>' +
      '<div class="crm-table-wrap is-flat"><table class="crm-table rp-table"><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody>' + foot + '</table></div>' +
      more +
    '</section>';
  },

  /* ---------------- Exportar ---------------- */
  async exportAs(fmt) {
    const st = this.st;
    if (st.busy) return;
    if (!st.canExport()) { UI.toast('No tienes permiso para exportar reportes.', 'error'); return; }
    if (!st.sections.length) { UI.toast('Elige al menos un contenido para el reporte.', 'error'); return; }
    const btn = st.root.querySelector('[data-rp-export="' + fmt + '"]');
    const original = btn.innerHTML;
    st.busy = true;
    st.root.querySelectorAll('[data-rp-export]').forEach(b => { b.disabled = true; });
    btn.innerHTML = '<span class="rp-spin" aria-hidden="true"></span>Generando…';
    btn.setAttribute('aria-busy', 'true');
    try {
      const rep = this.buildReport();
      const res = fmt === 'pdf' ? await ReportExport.toPDF(rep) : await ReportExport.toExcel(rep);
      DB.log('Exportó un reporte', Reports.auditDetail(rep, fmt === 'pdf' ? 'PDF' : 'Excel'), { tenantId: rep.global ? null : rep.tenants[0].id });
      this.lastExport = { fmt, name: res.name, size: res.size, records: rep.records.length };
      UI.toast('Reporte descargado: ' + res.name);
    } catch (e) {
      console.error(e);
      UI.toast('No se pudo generar el reporte. ' + (e && e.message ? e.message : ''), 'error');
    } finally {
      st.busy = false;
      btn.innerHTML = original;
      btn.removeAttribute('aria-busy');
      st.root.querySelectorAll('[data-rp-export]').forEach(b => { b.disabled = !st.sections.length; });
    }
  }
};
