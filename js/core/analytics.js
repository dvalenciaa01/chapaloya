/* ==========================================================================
   Analytics: métricas por barbería y globales, comparación de períodos,
   checklist de configuración y alertas de salud (Reservalope)
   ========================================================================== */
const Analytics = {
  PRESETS: [
    { key: 'today', label: 'Hoy' },
    { key: '7d', label: '7 días' },
    { key: '30d', label: '30 días' },
    { key: 'month', label: 'Este mes' },
    { key: '90d', label: '90 días' },
    { key: 'custom', label: 'Personalizado' }
  ],

  daysBetween(a, b) {
    return Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000) + 1;
  },

  range(preset, from, to) {
    const today = DB.todayISO();
    let f = today, t = today;
    if (preset === '7d') f = DB.addDays(today, -6);
    else if (preset === '30d') f = DB.addDays(today, -29);
    else if (preset === '90d') f = DB.addDays(today, -89);
    else if (preset === 'month') f = today.slice(0, 8) + '01';
    else if (preset === 'custom') { f = from || DB.addDays(today, -29); t = to || today; if (f > t) { const x = f; f = t; t = x; } }
    const days = this.daysBetween(f, t);
    return { from: f, to: t, days, preset };
  },

  previous(r) {
    return { from: DB.addDays(r.from, -r.days), to: DB.addDays(r.from, -1), days: r.days };
  },

  inRange(d, r) { return !!d && d >= r.from && d <= r.to; },

  dates(r) {
    const out = [];
    for (let d = r.from; d <= r.to; d = DB.addDays(d, 1)) out.push(d);
    return out;
  },

  /* Métricas de UNA barbería en un rango */
  tenantMetrics(t, r) {
    const s = DB.load().data[t.id] || {};
    const appts = (s.appointments || []).filter(a => this.inRange(a.date, r));
    const completed = appts.filter(a => a.status === 'COMPLETADA');
    const cancelled = appts.filter(a => a.status === 'CANCELADA');
    const noShow = appts.filter(a => a.status === 'NO_ASISTIO');
    const pending = appts.filter(a => a.status === 'PROGRAMADA' || a.status === 'CONFIRMADA_WSP');
    const walks = (s.walkIns || []).filter(w => w.status === 'FINALIZADO' && this.inRange(w.date, r));
    const revenue = completed.reduce((x, a) => x + Number(a.price || 0), 0) + walks.reduce((x, w) => x + Number(w.price || 0), 0);
    const salesCount = completed.length + walks.length;
    const resolved = completed.length + cancelled.length + noShow.length;
    const clients = new Set();
    appts.filter(a => a.status !== 'CANCELADA').forEach(a => clients.add((a.phone && a.phone !== '—' ? a.phone : a.customerName).toLowerCase()));
    walks.forEach(w => clients.add(String(w.customerName).toLowerCase()));
    const ai = (s.aiConsultations || []).filter(c => this.inRange(c.date, r)).length;
    const web = appts.filter(a => a.source === 'WEB').length;

    const byDay = {};
    const add = (d, rev, cnt) => { if (!byDay[d]) byDay[d] = { revenue: 0, appts: 0 }; byDay[d].revenue += rev; byDay[d].appts += cnt; };
    completed.forEach(a => add(a.date, Number(a.price || 0), 0));
    walks.forEach(w => add(w.date, Number(w.price || 0), 0));
    appts.forEach(a => add(a.date, 0, 1));

    const byService = {};
    const addSrv = (name, price) => { if (!byService[name]) byService[name] = { count: 0, revenue: 0 }; byService[name].count++; byService[name].revenue += Number(price || 0); };
    completed.forEach(a => addSrv(a.service, a.price));
    walks.forEach(w => addSrv(w.service, w.price));

    const byHour = {};
    appts.filter(a => a.status !== 'CANCELADA').forEach(a => { const h = String(a.time || '').slice(0, 2); if (h) byHour[h] = (byHour[h] || 0) + 1; });
    walks.forEach(w => { const h = String(w.addedAt || '').slice(0, 2); if (/^\d\d$/.test(h)) byHour[h] = (byHour[h] || 0) + 1; });

    const byBarber = {};
    (s.barberProfiles || []).forEach(b => { byBarber[b.name] = { appts: 0, completed: 0, revenue: 0, booked: 0, walkins: 0 }; });
    const bb = (n) => (byBarber[n] = byBarber[n] || { appts: 0, completed: 0, revenue: 0, booked: 0, walkins: 0 });
    appts.forEach(a => { const b = bb(a.barber); b.appts++; if (a.status !== 'CANCELADA') b.booked++; if (a.status === 'COMPLETADA') { b.completed++; b.revenue += Number(a.price || 0); } });
    walks.forEach(w => { const b = bb(w.barber); b.walkins++; b.revenue += Number(w.price || 0); });
    const capacity = DB.avgDailySlots(t) * r.days;
    Object.values(byBarber).forEach(b => { b.occupancy = capacity ? Math.min(1, b.booked / capacity) : 0; });

    return {
      tenant: t,
      revenue, salesCount,
      avgTicket: salesCount ? revenue / salesCount : 0,
      appts: appts.length,
      completed: completed.length, cancelled: cancelled.length, noShow: noShow.length, pending: pending.length,
      completionRate: resolved ? completed.length / resolved : null,
      cancelRate: appts.length ? cancelled.length / appts.length : null,
      noShowRate: appts.length ? noShow.length / appts.length : null,
      walkins: walks.length,
      clients: clients.size,
      ai,
      web, crm: appts.length - web,
      webShare: appts.length ? web / appts.length : null,
      byDay, byService, byHour, byBarber,
      _clientKeys: clients
    };
  },

  /* Suma de varias barberías */
  aggregate(tenants, r) {
    const per = tenants.map(t => this.tenantMetrics(t, r));
    const sum = (k) => per.reduce((x, m) => x + (m[k] || 0), 0);
    const merge = (k, fields) => {
      const out = {};
      per.forEach(m => Object.entries(m[k]).forEach(([key, val]) => {
        if (typeof val === 'number') { out[key] = (out[key] || 0) + val; return; }
        out[key] = out[key] || {};
        fields.forEach(f => { out[key][f] = (out[key][f] || 0) + (val[f] || 0); });
      }));
      return out;
    };
    const clients = new Set();
    per.forEach(m => m._clientKeys.forEach(c => clients.add(m.tenant.id + ':' + c)));
    const revenue = sum('revenue'), salesCount = sum('salesCount'), appts = sum('appts');
    const completed = sum('completed'), cancelled = sum('cancelled'), noShow = sum('noShow'), web = sum('web');
    const resolved = completed + cancelled + noShow;
    return {
      per,
      revenue, salesCount, appts, completed, cancelled, noShow, pending: sum('pending'),
      avgTicket: salesCount ? revenue / salesCount : 0,
      completionRate: resolved ? completed / resolved : null,
      cancelRate: appts ? cancelled / appts : null,
      noShowRate: appts ? noShow / appts : null,
      walkins: sum('walkins'), clients: clients.size, ai: sum('ai'),
      web, crm: appts - web, webShare: appts ? web / appts : null,
      byDay: merge('byDay', ['revenue', 'appts']),
      byService: merge('byService', ['count', 'revenue']),
      byHour: merge('byHour', [])
    };
  },

  /* Variación vs período anterior (null si no hay base de comparación) */
  delta(cur, prev) {
    if (cur == null || prev == null) return null;
    if (prev === 0) return cur === 0 ? 0 : null;
    return (cur - prev) / Math.abs(prev);
  },

  /* ---------------- Plataforma ---------------- */
  platform() {
    const root = DB.load();
    const today = DB.todayISO();
    const active = root.tenants.filter(t => t.status === 'ACTIVE');
    const users = root.users.filter(u => u.active);
    return {
      tenants: root.tenants.length,
      active: active.length,
      suspended: root.tenants.length - active.length,
      users: users.length,
      locked: root.users.filter(u => u.lockedUntil && u.lockedUntil > Date.now()).length,
      mrr: active.reduce((x, t) => x + Number(t.planFee || 0), 0),
      expiring: active.filter(t => t.subscriptionEnd >= today && t.subscriptionEnd <= DB.addDays(today, 7)).length,
      expired: active.filter(t => t.subscriptionEnd < today).length,
      byPlan: Object.keys(DB.PLANS).map(k => ({ key: k, label: DB.PLANS[k].label, count: active.filter(t => t.plan === k).length }))
    };
  },

  // Uso de la base de datos de Supabase (lo trae Reservalope con plataforma_uso)
  storage() {
    const u = DB.usage || {};
    const used = Number(u.db_bytes) || 0;
    const limit = Number(u.limit_bytes) || 500 * 1024 * 1024;
    return { used, limit, pct: used / limit };
  },

  lastActivity(t) {
    const s = DB.load().data[t.id] || {};
    let last = '';
    (s.appointments || []).forEach(a => { const c = (a.createdAt || '').slice(0, 10); if (c > last) last = c; });
    (s.walkIns || []).forEach(w => { if ((w.date || '') > last) last = w.date; });
    DB.load().audit.forEach(a => { if (a.tenantId === t.id && a.role !== 'SYSTEM') { const d = a.ts.slice(0, 10); if (d > last) last = d; } });
    return last || null;
  },

  subscriptionState(t) {
    const today = DB.todayISO();
    if (!t.subscriptionEnd) return { key: 'none', label: 'Sin fecha', days: null };
    const days = this.daysBetween(today, t.subscriptionEnd) - 1;
    if (days < 0) return { key: 'expired', label: 'Vencida hace ' + Math.abs(days) + ' d', days };
    if (days <= 7) return { key: 'soon', label: days === 0 ? 'Vence hoy' : 'Vence en ' + days + ' d', days };
    return { key: 'ok', label: 'Vigente', days };
  },

  /* Checklist de configuración de una barbería */
  checklist(t) {
    const root = DB.load();
    const s = root.data[t.id] || {};
    const users = root.users.filter(u => u.tenantId === t.id && u.active);
    const pal = TenantBrand.paletteOf(t);
    const sub = this.subscriptionState(t);
    return [
      { label: 'Logo cargado', ok: !!t.logo, hint: 'Sin logo se muestra el nombre en texto.' },
      { label: 'Paleta de colores válida', ok: TenantBrand.checkPalette(pal).ok, hint: 'Revisa el contraste de la paleta.' },
      { label: 'Dirección y teléfono públicos', ok: !!(t.address && t.phone), hint: 'Se muestran en la web.' },
      { label: 'Al menos un barbero', ok: (s.barberProfiles || []).length > 0, hint: 'Sin barberos no se puede reservar.' },
      { label: 'Catálogo de servicios', ok: (s.services || []).length > 0, hint: 'Sin servicios no se puede reservar.' },
      { label: 'Administrador creado', ok: users.some(u => u.role === 'ADMIN'), hint: 'Crea su administrador en Usuarios.' },
      { label: 'Personal registrado', ok: users.some(u => u.role === 'STAFF'), hint: 'Opcional, recomendado.' },
      { label: 'Contacto del dueño', ok: !!(t.ownerEmail || t.ownerPhone), hint: 'Para cobranza y avisos.' },
      { label: 'Suscripción vigente', ok: sub.key === 'ok' || sub.key === 'soon', hint: sub.label }
    ];
  },

  /* Alertas de salud ordenadas por gravedad */
  alerts() {
    const root = DB.load();
    const today = DB.todayISO();
    const out = [];
    const push = (severity, t, title, detail, action) => out.push({ severity, tenantId: t ? t.id : null, tenantName: t ? t.name : 'Plataforma', title, detail, action });
    const last30 = this.range('30d');

    root.tenants.forEach(t => {
      const s = root.data[t.id] || {};
      if (t.status !== 'ACTIVE') { push('info', t, 'Barbería suspendida', 'Su web muestra “no disponible” y su personal no puede ingresar.', 'tenant'); return; }
      const sub = this.subscriptionState(t);
      if (sub.key === 'expired') push('critical', t, 'Suscripción vencida', 'Venció el ' + t.subscriptionEnd + ' (plan ' + (DB.PLANS[t.plan] || {}).label + ', S/ ' + t.planFee + ').', 'edit');
      else if (sub.key === 'soon') push('warning', t, 'Suscripción por vencer', sub.label + ' · ' + t.subscriptionEnd + ' (plan ' + (DB.PLANS[t.plan] || {}).label + ').', 'edit');

      const missing = [];
      if (!(s.barberProfiles || []).length) missing.push('barberos');
      if (!(s.services || []).length) missing.push('servicios');
      if (!root.users.some(u => u.tenantId === t.id && u.role === 'ADMIN' && u.active)) missing.push('administrador');
      if (missing.length) push('warning', t, 'Configuración incompleta', 'Falta: ' + missing.join(', ') + '.', 'tenant');

      const created = (t.createdAt || '').slice(0, 10);
      const last = this.lastActivity(t);
      if (created && created <= DB.addDays(today, -7) && (!last || last < DB.addDays(today, -7))) {
        push('warning', t, 'Sin actividad en 7 días', last ? 'Último movimiento: ' + last + '.' : 'Nunca registró citas ni walk-in.', 'tenant');
      }

      const m = this.tenantMetrics(t, last30);
      if (m.appts >= 10) {
        const lost = (m.cancelled + m.noShow) / m.appts;
        if (lost > 0.2) push('warning', t, 'Cancelaciones altas', Math.round(lost * 100) + '% de las citas de los últimos 30 días se cancelaron o no asistieron (' + (m.cancelled + m.noShow) + ' de ' + m.appts + ').', 'tenant');
      }
    });

    root.users.filter(u => u.lockedUntil && u.lockedUntil > Date.now()).forEach(u => {
      const t = u.tenantId ? DB.tenantById(u.tenantId) : null;
      push('warning', t, 'Cuenta bloqueada', u.name + ' (' + u.email + ') superó los intentos de acceso.', 'users');
    });

    const st = this.storage();
    if (st.pct >= 0.85) push('critical', null, 'Almacenamiento casi lleno', Math.round(st.pct * 100) + '% usado. Exporta un respaldo y reduce fotos.', 'platform');
    else if (st.pct >= 0.7) push('warning', null, 'Almacenamiento alto', Math.round(st.pct * 100) + '% usado.', 'platform');

    const rank = { critical: 0, warning: 1, info: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }
};
