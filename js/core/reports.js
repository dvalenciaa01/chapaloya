/* ==========================================================================
   Reportes: motor de datos con filtros (sin interfaz).
   Une citas y walk-in en un solo listado de "registros", aplica los filtros
   y arma las secciones que luego se previsualizan o exportan (PDF / Excel).
   ========================================================================== */
const Reports = {
  SECTIONS: [
    { key: 'summary', label: 'Resumen ejecutivo', desc: 'Indicadores vs. periodo anterior, por día y por servicio.' },
    { key: 'sales', label: 'Ventas e ingresos', desc: 'Cada cita completada y walk-in finalizado con su monto.', money: true },
    { key: 'records', label: 'Citas y walk-in', desc: 'Listado completo con estado, canal, barbero y servicio.' },
    { key: 'people', label: 'Barberos y clientes', desc: 'Desempeño por barbero y cartera de clientes.' }
  ],

  STATUSES: [
    { key: 'PROGRAMADA', label: 'Programada', kind: 'appt' },
    { key: 'CONFIRMADA_WSP', label: 'Confirmada', kind: 'appt' },
    { key: 'COMPLETADA', label: 'Completada', kind: 'appt' },
    { key: 'CANCELADA', label: 'Cancelada', kind: 'appt' },
    { key: 'NO_ASISTIO', label: 'No asistió', kind: 'appt' },
    { key: 'ESPERANDO', label: 'En espera (walk-in)', kind: 'walkin' },
    { key: 'EN_SILLON', label: 'En sillón (walk-in)', kind: 'walkin' },
    { key: 'FINALIZADO', label: 'Finalizado (walk-in)', kind: 'walkin' }
  ],

  CHANNELS: [
    { key: 'WEB', label: 'Web' },
    { key: 'CRM', label: 'CRM' },
    { key: 'WALKIN', label: 'Presencial (walk-in)' }
  ],

  KINDS: [
    { key: 'all', label: 'Citas y walk-in' },
    { key: 'appt', label: 'Solo citas' },
    { key: 'walkin', label: 'Solo walk-in' }
  ],

  CHANNEL_LABEL: { WEB: 'Web', CRM: 'CRM', WALKIN: 'Presencial' },

  defaultFilters() {
    return { preset: '30d', from: '', to: '', tenants: [], barbers: [], services: [], statuses: [], channels: [], kind: 'all', q: '' };
  },

  /* ---------------- Utilidades ---------------- */
  norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  },
  digits(s) { return String(s || '').replace(/\D/g, ''); },
  fmtDate(iso) {
    if (!iso) return '';
    const p = iso.split('-');
    return p[2] + '/' + p[1] + '/' + p[0];
  },
  hasPhone(p) { return !!p && p !== '—' && this.digits(p).length >= 6; },

  /* ---------------- Registros unificados ---------------- */
  recordsOf(t) {
    const s = DB.load().data[t.id] || {};
    const cur = t.currency || 'S/';
    const out = [];
    (s.appointments || []).forEach(a => {
      out.push({
        id: a.id, tenantId: t.id, tenantName: t.name, currency: cur,
        kind: 'appt', kindLabel: 'Cita',
        date: a.date || '', time: a.time || '',
        customer: a.customerName || '', phone: this.hasPhone(a.phone) ? a.phone : '',
        service: a.service || '', barber: a.barber || '',
        channel: a.source === 'WEB' ? 'WEB' : 'CRM',
        status: a.status, statusLabel: DB.statusLabel(a.status),
        price: Number(a.price || 0),
        sale: a.status === 'COMPLETADA',
        booked: a.status !== 'CANCELADA'
      });
    });
    (s.walkIns || []).forEach(w => {
      out.push({
        id: w.id, tenantId: t.id, tenantName: t.name, currency: cur,
        kind: 'walkin', kindLabel: 'Walk-in',
        date: w.date || '', time: String(w.addedAt || '').slice(0, 5),
        customer: w.customerName || '', phone: '',
        service: w.service || '', barber: w.barber || '',
        channel: 'WALKIN',
        status: w.status, statusLabel: DB.statusLabel(w.status),
        price: Number(w.price || 0),
        sale: w.status === 'FINALIZADO',
        booked: false
      });
    });
    return out;
  },

  /* Opciones de filtros (barberos y servicios conocidos, incluidos los de registros antiguos) */
  options(tenants) {
    const barbers = new Set(), services = new Set();
    tenants.forEach(t => {
      const s = DB.load().data[t.id] || {};
      (s.barberProfiles || []).forEach(b => barbers.add(b.name));
      (s.services || []).forEach(x => services.add(x.name));
      (s.appointments || []).forEach(a => { if (a.barber) barbers.add(a.barber); if (a.service) services.add(a.service); });
      (s.walkIns || []).forEach(w => { if (w.barber) barbers.add(w.barber); if (w.service) services.add(w.service); });
    });
    const sort = (a, b) => a.localeCompare(b, 'es');
    return { barbers: Array.from(barbers).sort(sort), services: Array.from(services).sort(sort) };
  },

  /* ¿El registro cumple los filtros (excepto fecha)? */
  matches(r, f) {
    if (f.kind && f.kind !== 'all' && r.kind !== f.kind) return false;
    if (f.barbers.length && !f.barbers.includes(r.barber)) return false;
    if (f.services.length && !f.services.includes(r.service)) return false;
    if (f.statuses.length && !f.statuses.includes(r.status)) return false;
    if (f.channels.length && !f.channels.includes(r.channel)) return false;
    if (f.q) {
      const q = this.norm(f.q), qd = this.digits(f.q);
      const byName = this.norm(r.customer).includes(q);
      const byPhone = qd.length >= 3 && this.digits(r.phone).includes(qd);
      if (!byName && !byPhone) return false;
    }
    return true;
  },

  /* ---------------- Indicadores ---------------- */
  kpis(recs) {
    const appts = recs.filter(r => r.kind === 'appt');
    const walks = recs.filter(r => r.kind === 'walkin');
    const sales = recs.filter(r => r.sale);
    const completed = appts.filter(r => r.status === 'COMPLETADA').length;
    const cancelled = appts.filter(r => r.status === 'CANCELADA').length;
    const noShow = appts.filter(r => r.status === 'NO_ASISTIO').length;
    const pending = appts.filter(r => r.status === 'PROGRAMADA' || r.status === 'CONFIRMADA_WSP').length;
    const resolved = completed + cancelled + noShow;
    const revenue = sales.reduce((x, r) => x + r.price, 0);
    const clients = new Set();
    recs.filter(r => r.status !== 'CANCELADA').forEach(r => clients.add(this.clientKey(r)));
    const web = appts.filter(r => r.channel === 'WEB').length;
    return {
      revenue, sales: sales.length,
      avgTicket: sales.length ? revenue / sales.length : 0,
      appts: appts.length, completed, cancelled, noShow, pending,
      walkins: walks.filter(r => r.status === 'FINALIZADO').length,
      walkinsAll: walks.length,
      completionRate: resolved ? completed / resolved : null,
      cancelRate: appts.length ? cancelled / appts.length : null,
      noShowRate: appts.length ? noShow / appts.length : null,
      clients: clients.size,
      web, webShare: appts.length ? web / appts.length : null,
      records: recs.length
    };
  },

  clientKey(r) {
    return r.tenantId + ':' + (r.phone ? this.digits(r.phone) : 'n:' + this.norm(r.customer));
  },

  /* ---------------- Construcción del reporte ----------------
     opts: { tenants:[tenant], global:bool, filters, sections:[keys], money:bool } */
  build(opts) {
    const f = Object.assign(this.defaultFilters(), opts.filters || {});
    const money = opts.money !== false;
    const sections = (opts.sections || this.SECTIONS.map(s => s.key)).filter(k => money || k !== 'sales');
    const tenants = opts.tenants;
    const range = Analytics.range(f.preset, f.from, f.to);
    const prev = Analytics.previous(range);

    const all = [];
    tenants.forEach(t => this.recordsOf(t).forEach(r => all.push(r)));
    const filtered = all.filter(r => this.matches(r, f));
    const cur = filtered.filter(r => r.date >= range.from && r.date <= range.to);
    const prv = filtered.filter(r => r.date >= prev.from && r.date <= prev.to);
    const sortDesc = (a, b) => (b.date + b.time).localeCompare(a.date + a.time);
    cur.sort(sortDesc);

    const currencies = Array.from(new Set(tenants.map(t => t.currency || 'S/')));
    const report = {
      global: !!opts.global,
      tenants, money, sections, filters: f,
      range, prev,
      currency: currencies[0] || 'S/',
      mixedCurrency: currencies.length > 1,
      kpis: this.kpis(cur),
      prevKpis: this.kpis(prv),
      records: cur,
      sales: cur.filter(r => r.sale),
      byDay: this.byDay(cur, range),
      prevByDay: this.byDay(prv, prev),
      byService: this.byService(cur),
      byBarber: this.byBarber(cur, tenants, f, range, !!opts.global),
      customers: this.customers(cur, all, !!opts.global),
      perTenant: opts.global ? tenants.map(t => ({
        tenant: t,
        cur: this.kpis(cur.filter(r => r.tenantId === t.id)),
        prev: this.kpis(prv.filter(r => r.tenantId === t.id))
      })) : null
    };
    report.meta = this.meta(report, opts);
    return report;
  },

  byDay(cur, range) {
    const map = {};
    Analytics.dates(range).forEach(d => { map[d] = { date: d, appts: 0, walkins: 0, sales: 0, revenue: 0, cancelled: 0 }; });
    cur.forEach(r => {
      const d = map[r.date]; if (!d) return;
      if (r.kind === 'appt') d.appts++; else d.walkins++;
      if (r.status === 'CANCELADA' || r.status === 'NO_ASISTIO') d.cancelled++;
      if (r.sale) { d.sales++; d.revenue += r.price; }
    });
    return Object.values(map);
  },

  byService(cur) {
    const map = {};
    const sales = cur.filter(r => r.sale);
    const total = sales.reduce((x, r) => x + r.price, 0);
    cur.forEach(r => {
      const k = r.service || '—';
      if (!map[k]) map[k] = { service: k, records: 0, sales: 0, revenue: 0, share: 0 };
      map[k].records++;
      if (r.sale) { map[k].sales++; map[k].revenue += r.price; }
    });
    Object.values(map).forEach(s => { s.share = total ? s.revenue / total : 0; });
    return Object.values(map).sort((a, b) => b.revenue - a.revenue || b.records - a.records);
  },

  byBarber(cur, tenants, f, range, global) {
    const map = {};
    const key = (tid, name) => tid + '|' + name;
    const ensure = (t, name) => {
      const k = key(t.id, name);
      if (!map[k]) map[k] = { barber: name, tenantName: t.name, currency: t.currency || 'S/', appts: 0, completed: 0, cancelled: 0, noShow: 0, walkins: 0, booked: 0, sales: 0, revenue: 0 };
      return map[k];
    };
    // Barberos activos aparecen aunque no tengan movimiento (si no se filtró por barbero)
    tenants.forEach(t => {
      const s = DB.load().data[t.id] || {};
      (s.barberProfiles || []).forEach(b => { if (!f.barbers.length || f.barbers.includes(b.name)) ensure(t, b.name); });
    });
    const tById = {}; tenants.forEach(t => { tById[t.id] = t; });
    cur.forEach(r => {
      const b = ensure(tById[r.tenantId], r.barber || '—');
      if (r.kind === 'appt') {
        b.appts++;
        if (r.status === 'COMPLETADA') b.completed++;
        if (r.status === 'CANCELADA') b.cancelled++;
        if (r.status === 'NO_ASISTIO') b.noShow++;
        if (r.booked) b.booked++;
      } else if (r.status === 'FINALIZADO') b.walkins++;
      if (r.sale) { b.sales++; b.revenue += r.price; }
    });
    const capacity = DB.TIME_SLOTS.length * range.days;
    return Object.values(map).map(b => Object.assign(b, {
      avgTicket: b.sales ? b.revenue / b.sales : 0,
      lostRate: b.appts ? (b.cancelled + b.noShow) / b.appts : null,
      occupancy: capacity ? Math.min(1, b.booked / capacity) : 0
    })).sort((a, b) => b.revenue - a.revenue || b.appts - a.appts || a.barber.localeCompare(b.barber, 'es'));
  },

  customers(cur, all, global) {
    // Teléfono conocido por nombre (los walk-in no guardan teléfono)
    const phoneByName = {};
    all.forEach(r => { if (r.phone) phoneByName[r.tenantId + ':' + this.norm(r.customer)] = r.phone; });
    const map = {};
    cur.forEach(r => {
      const phone = r.phone || phoneByName[r.tenantId + ':' + this.norm(r.customer)] || '';
      const k = r.tenantId + ':' + (phone ? this.digits(phone) : 'n:' + this.norm(r.customer));
      if (!map[k]) map[k] = { customer: r.customer, phone, tenantName: r.tenantName, currency: r.currency, visits: 0, appts: 0, lost: 0, spend: 0, last: '', barbers: {} };
      const c = map[k];
      if (r.kind === 'appt') c.appts++;
      if (r.status === 'CANCELADA' || r.status === 'NO_ASISTIO') c.lost++;
      if (r.sale) {
        c.visits++; c.spend += r.price;
        if (r.date > c.last) c.last = r.date;
        if (r.barber) c.barbers[r.barber] = (c.barbers[r.barber] || 0) + 1;
      }
    });
    return Object.values(map).map(c => {
      const top = Object.entries(c.barbers).sort((a, b) => b[1] - a[1])[0];
      return Object.assign(c, { topBarber: top ? top[0] : '', avgTicket: c.visits ? c.spend / c.visits : 0 });
    }).sort((a, b) => b.spend - a.spend || b.visits - a.visits || a.customer.localeCompare(b.customer, 'es'));
  },

  /* ---------------- Metadatos (encabezado del reporte) ---------------- */
  meta(rep, opts) {
    const f = rep.filters;
    const u = (typeof Auth !== 'undefined' && Auth.user) ? Auth.user : null;
    const preset = (Analytics.PRESETS.find(p => p.key === f.preset) || {}).label || '';
    const list = (arr, all) => arr.length ? arr.join(', ') : all;
    const lbl = (arr, src) => arr.map(k => (src.find(x => x.key === k) || {}).label || k);
    const filters = [
      ['Periodo', this.fmtDate(rep.range.from) + ' – ' + this.fmtDate(rep.range.to) + ' (' + rep.range.days + (rep.range.days === 1 ? ' día' : ' días') + (f.preset === 'today' || f.preset === 'month' ? ', ' + preset.toLowerCase() : '') + ')'],
      ['Comparado con', this.fmtDate(rep.prev.from) + ' – ' + this.fmtDate(rep.prev.to)]
    ];
    if (rep.global) filters.push(['Barberías', f.tenants.length ? rep.tenants.map(t => t.name).join(', ') : 'Todas (' + rep.tenants.length + ')']);
    filters.push(
      ['Tipo', (this.KINDS.find(k => k.key === f.kind) || this.KINDS[0]).label],
      ['Barberos', list(f.barbers, 'Todos')],
      ['Servicios', list(f.services, 'Todos')],
      ['Estados', list(lbl(f.statuses, this.STATUSES), 'Todos')],
      ['Canales', list(lbl(f.channels, this.CHANNELS), 'Todos')]
    );
    if (f.q) filters.push(['Cliente', f.q]);
    const t0 = rep.tenants[0];
    const name = rep.global ? 'Reservalope · Todas las barberías' : (t0 ? t0.name : '');
    const now = new Date();
    return {
      title: rep.global ? 'Reporte comparativo de barberías' : 'Reporte de ' + name,
      name,
      slug: rep.global ? 'reservalope' : (t0 ? t0.slug : 'barberia'),
      palette: rep.global ? { primary: '#000000', secondary: '#FFD503', tertiary: '#FFFFFF' } : TenantBrand.paletteOf(t0),
      logo: !rep.global && t0 && t0.logo ? t0.logo : null,
      filters,
      activeFilters: filters.slice(2).filter(x => !/^Tod/.test(x[1]) && x[1] !== this.KINDS[0].label).length,
      generatedBy: u ? u.name + ' (' + (Auth.ROLE_LABEL[u.role] || u.role) + ')' : 'Sistema',
      generatedAt: now,
      generatedText: now.toLocaleDateString('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + now.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' }),
      sectionLabels: rep.sections.map(k => (this.SECTIONS.find(s => s.key === k) || {}).label)
    };
  },

  /* ---------------- Tablas (misma definición para vista previa, PDF y Excel) ----------------
     Tipos de columna: text · date · int · money · pct */
  tables(rep) {
    const out = [];
    const M = rep.money;
    const G = rep.global;
    const col = (key, label, type, width, extra) => Object.assign({ key, label, type: type || 'text', width: width || 14 }, extra || {});
    const keep = (cols) => cols.filter(c => c && (M || c.type !== 'money'));
    const sum = (rows, k) => rows.reduce((x, r) => x + (Number(r[k]) || 0), 0);

    if (rep.sections.includes('summary')) {
      const k = rep.kpis, p = rep.prevKpis;
      const rows = [];
      const add = (label, cur, prev, type, mode, goodUp) => rows.push({ label, cur, prev, type, delta: mode === 'pp' ? (cur == null || prev == null ? null : cur - prev) : Analytics.delta(cur, prev), deltaMode: mode || 'pct', goodUp: goodUp !== false });
      if (M) add('Ingresos', k.revenue, p.revenue, 'money');
      add('Ventas (citas completadas + walk-in finalizados)', k.sales, p.sales, 'int');
      if (M) add('Ticket promedio', k.avgTicket, p.avgTicket, 'money');
      add('Citas registradas', k.appts, p.appts, 'int');
      add('Citas completadas', k.completed, p.completed, 'int');
      add('Tasa de citas completadas', k.completionRate, p.completionRate, 'pct', 'pp');
      add('Cancelaciones', k.cancelled, p.cancelled, 'int', 'pct', false);
      add('Tasa de cancelación', k.cancelRate, p.cancelRate, 'pct', 'pp', false);
      add('No asistió', k.noShow, p.noShow, 'int', 'pct', false);
      add('Citas pendientes', k.pending, p.pending, 'int');
      add('Walk-in atendidos', k.walkins, p.walkins, 'int');
      add('Clientes únicos', k.clients, p.clients, 'int');
      add('Reservas desde la web', k.webShare, p.webShare, 'pct', 'pp');
      out.push({ key: 'kpis', section: 'summary', sheet: 'Resumen', title: 'Indicadores del periodo', kpi: true,
        columns: [col('label', 'Indicador', 'text', 44), col('cur', 'Periodo actual', 'auto', 18), col('prev', 'Periodo anterior', 'auto', 18), col('delta', 'Variación', 'delta', 14)],
        rows });

      if (G && rep.perTenant) {
        const rowsT = rep.perTenant.map(x => ({
          tenantName: x.tenant.name, currency: x.tenant.currency || 'S/',
          revenue: x.cur.revenue, revDelta: Analytics.delta(x.cur.revenue, x.prev.revenue),
          sales: x.cur.sales, avgTicket: x.cur.avgTicket, appts: x.cur.appts,
          completionRate: x.cur.completionRate, cancelRate: x.cur.cancelRate,
          walkins: x.cur.walkins, clients: x.cur.clients, webShare: x.cur.webShare
        })).sort((a, b) => b.revenue - a.revenue);
        out.push({ key: 'tenants', section: 'summary', sheet: 'Por barbería', title: 'Comparativo por barbería',
          columns: keep([col('tenantName', 'Barbería', 'text', 26), col('revenue', 'Ingresos', 'money', 15), M ? col('revDelta', 'Var. ingresos', 'pct', 13) : null,
            col('sales', 'Ventas', 'int', 9), col('avgTicket', 'Ticket prom.', 'money', 13), col('appts', 'Citas', 'int', 9),
            col('completionRate', '% completadas', 'pct', 13), col('cancelRate', '% cancelación', 'pct', 13),
            col('walkins', 'Walk-in', 'int', 9), col('clients', 'Clientes', 'int', 9), col('webShare', '% web', 'pct', 9)]),
          rows: rowsT,
          totals: { tenantName: 'Total', revenue: sum(rowsT, 'revenue'), sales: sum(rowsT, 'sales'), appts: sum(rowsT, 'appts'), walkins: sum(rowsT, 'walkins'), clients: sum(rowsT, 'clients') } });
      }

      const days = rep.byDay;
      out.push({ key: 'byDay', section: 'summary', sheet: 'Por día', title: 'Movimiento por día',
        columns: keep([col('date', 'Fecha', 'date', 12), col('appts', 'Citas', 'int', 9), col('walkins', 'Walk-in', 'int', 9),
          col('cancelled', 'Cancel./No asistió', 'int', 16), col('sales', 'Ventas', 'int', 9), col('revenue', 'Ingresos', 'money', 15)]),
        rows: days,
        totals: { date: 'Total', appts: sum(days, 'appts'), walkins: sum(days, 'walkins'), cancelled: sum(days, 'cancelled'), sales: sum(days, 'sales'), revenue: sum(days, 'revenue') } });

      const sv = rep.byService;
      out.push({ key: 'byService', section: 'summary', sheet: 'Por servicio', title: 'Servicios',
        columns: keep([col('service', 'Servicio', 'text', 36), col('records', 'Registros', 'int', 11), col('sales', 'Ventas', 'int', 9),
          col('revenue', 'Ingresos', 'money', 15), M ? col('share', '% de ingresos', 'pct', 13) : null]),
        rows: sv,
        totals: { service: 'Total', records: sum(sv, 'records'), sales: sum(sv, 'sales'), revenue: sum(sv, 'revenue'), share: sv.length && M ? 1 : null } });
    }

    const recCols = (withStatus) => keep([
      col('date', 'Fecha', 'date', 12), col('time', 'Hora', 'text', 8), G ? col('tenantName', 'Barbería', 'text', 20) : null,
      col('kindLabel', 'Tipo', 'text', 9), col('customer', 'Cliente', 'text', 24), col('phone', 'Teléfono', 'text', 13),
      col('service', 'Servicio', 'text', 28), col('barber', 'Barbero', 'text', 14), col('channelLabel', 'Canal', 'text', 11),
      withStatus ? col('statusLabel', 'Estado', 'text', 13) : null, col('price', 'Monto', 'money', 13)]);
    const recRows = (arr) => arr.map(r => Object.assign({}, r, { channelLabel: this.CHANNEL_LABEL[r.channel] || r.channel }));

    if (rep.sections.includes('sales') && M) {
      const rows = recRows(rep.sales);
      out.push({ key: 'sales', section: 'sales', sheet: 'Ventas', title: 'Ventas e ingresos', columns: recCols(false), rows,
        totals: { date: 'Total', customer: rows.length + ' ventas', price: sum(rows, 'price') } });
    }

    if (rep.sections.includes('records')) {
      const rows = recRows(rep.records);
      out.push({ key: 'records', section: 'records', sheet: 'Citas y walk-in', title: 'Citas y walk-in', columns: recCols(true), rows,
        totals: { date: 'Total', customer: rows.length + ' registros', price: sum(rows.filter(r => r.sale), 'price') } });
    }

    if (rep.sections.includes('people')) {
      const b = rep.byBarber;
      out.push({ key: 'barbers', section: 'people', sheet: 'Barberos', title: 'Desempeño por barbero',
        columns: keep([G ? col('tenantName', 'Barbería', 'text', 20) : null, col('barber', 'Barbero', 'text', 18), col('appts', 'Citas', 'int', 8),
          col('completed', 'Completadas', 'int', 12), col('cancelled', 'Canceladas', 'int', 11), col('noShow', 'No asistió', 'int', 10),
          col('walkins', 'Walk-in', 'int', 9), col('sales', 'Ventas', 'int', 9), col('revenue', 'Ingresos', 'money', 14),
          col('avgTicket', 'Ticket prom.', 'money', 13), col('occupancy', 'Ocupación', 'pct', 11), col('lostRate', '% pérdida', 'pct', 10)]),
        rows: b,
        totals: { barber: 'Total', tenantName: G ? 'Total' : undefined, appts: sum(b, 'appts'), completed: sum(b, 'completed'), cancelled: sum(b, 'cancelled'), noShow: sum(b, 'noShow'), walkins: sum(b, 'walkins'), sales: sum(b, 'sales'), revenue: sum(b, 'revenue') } });

      const c = rep.customers;
      out.push({ key: 'customers', section: 'people', sheet: 'Clientes', title: 'Clientes',
        columns: keep([G ? col('tenantName', 'Barbería', 'text', 20) : null, col('customer', 'Cliente', 'text', 26), col('phone', 'Teléfono', 'text', 13),
          col('visits', 'Visitas', 'int', 9), col('appts', 'Citas', 'int', 8), col('lost', 'Cancel./No asistió', 'int', 16),
          col('spend', 'Gasto total', 'money', 14), col('avgTicket', 'Ticket prom.', 'money', 13), col('last', 'Última visita', 'date', 13),
          col('topBarber', 'Barbero frecuente', 'text', 18)]),
        rows: c,
        totals: { customer: c.length + ' clientes', tenantName: G ? 'Total' : undefined, visits: sum(c, 'visits'), appts: sum(c, 'appts'), lost: sum(c, 'lost'), spend: sum(c, 'spend') } });
    }
    return out;
  },

  /* Formato de celda para texto (vista previa y PDF) */
  money(n, cur) {
    return (cur || 'S/') + ' ' + (Number(n) || 0).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  },
  cellText(col, row, rep) {
    const v = row[col.key];
    let type = col.type;
    if (type === 'auto') type = row.type;
    if (v === undefined || v === null || v === '') return type === 'pct' && col.key !== 'share' ? '—' : (v === 0 ? '0' : '');
    switch (type) {
      case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(v) ? this.fmtDate(v) : String(v);
      case 'int': return typeof v === 'number' ? v.toLocaleString('es-PE') : String(v);
      case 'money': return typeof v === 'number' ? this.money(v, row.currency || rep.currency) : String(v);
      case 'pct': return typeof v === 'number' ? (v * 100).toFixed(1) + '%' : String(v);
      case 'delta': return this.deltaText(row);
      default: return String(v);
    }
  },
  deltaText(row) {
    const d = row.delta;
    if (d == null) return 'Sin base';
    const v = d * 100;
    if (Math.abs(v) < 0.05) return 'Sin cambio';
    return (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1) + (row.deltaMode === 'pp' ? ' pp' : '%');
  },
  deltaTone(row) {
    const d = row.delta;
    if (d == null || Math.abs(d * 100) < 0.05) return 'flat';
    return (d > 0) === row.goodUp ? 'good' : 'bad';
  },

  /* Texto corto de filtros para el historial */
  auditDetail(rep, format) {
    const m = rep.meta;
    const active = m.filters.slice(2).filter(x => !/^Tod/.test(x[1]) && x[1] !== this.KINDS[0].label).map(x => x[0] + ': ' + x[1]);
    return format + ' · ' + m.sectionLabels.join(', ') + ' · ' + this.fmtDate(rep.range.from) + ' a ' + this.fmtDate(rep.range.to) +
      (active.length ? ' · ' + active.join(' · ') : ' · sin filtros adicionales') + ' · ' + rep.records.length + ' registros';
  },

  fileName(rep, ext) {
    const base = 'Reporte-' + DB.slugify(rep.meta.slug || 'barberia') + '-' + rep.range.from + '_a_' + rep.range.to;
    return base + '.' + ext;
  }
};
