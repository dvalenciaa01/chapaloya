/* ==========================================================================
   Datos de demostración (solo una vez por navegador)
   - 90 días de historial + 14 días de reservas futuras para Golden.
   - Segunda barbería de ejemplo: "Navaja Norte".
   Todo registro generado lleva  demo: true  y se puede borrar desde
   Reservalope → Plataforma → "Borrar datos de demostración".
   ========================================================================== */
const DemoSeed = {
  VERSION: 1,

  rng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },

  FIRST: ['Luis', 'Carlos', 'Jorge', 'Diego', 'Miguel', 'Andrés', 'José', 'Renzo', 'Bruno', 'Sergio', 'Kevin', 'Piero', 'Mateo', 'Gabriel', 'Álvaro', 'Iván', 'Óscar', 'Raúl', 'Fernando', 'Joaquín', 'Rodrigo', 'Martín', 'Daniel', 'Hugo', 'Franco', 'Sebastián', 'Tomás', 'Alonso', 'Eduardo', 'Gustavo'],
  LAST: ['Quispe', 'Flores', 'Rojas', 'Mendoza', 'García', 'Torres', 'Vargas', 'Castillo', 'Ramírez', 'Chávez', 'Díaz', 'Huamán', 'Paredes', 'Salazar', 'Gutiérrez', 'Silva', 'Morales', 'Rivera', 'Herrera', 'Medina', 'Cruz', 'Ríos', 'Vega', 'León', 'Soto'],
  STYLES: ['Mid Fade + Textura', 'Crop Francés', 'Quiff Ejecutivo', 'Taper Fade Moderno', 'Side Part Clásico', 'Buzz Cut Definido'],

  pick(r, arr) { return arr[Math.floor(r() * arr.length)]; },

  weighted(r, items) {
    const total = items.reduce((s, it) => s + it.w, 0);
    let x = r() * total;
    for (const it of items) { x -= it.w; if (x <= 0) return it.v; }
    return items[items.length - 1].v;
  },

  customers(r, n) {
    const seen = new Set();
    const out = [];
    while (out.length < n) {
      const name = this.pick(r, this.FIRST) + ' ' + this.pick(r, this.LAST);
      if (seen.has(name)) continue;
      seen.add(name);
      out.push({ name, phone: '9' + String(Math.floor(r() * 1e8)).padStart(8, '0') });
    }
    return out;
  },

  /* Genera historial para una barbería */
  history(state, opts) {
    const r = this.rng(opts.seed);
    const today = DB.todayISO();
    const barbers = state.barberProfiles.map(b => b.name);
    const services = state.services;
    if (!barbers.length || !services.length) return;
    const svcWeights = services.map(s => ({ v: s, w: opts.svcWeight[s.id] || 6 }));
    const pool = this.customers(r, opts.customers);
    let n = 0;

    for (let off = -90; off <= 13; off++) {
      if (off === 0) continue; // hoy se mantiene con los datos actuales
      const date = DB.addDays(today, off);
      const dow = new Date(date + 'T12:00:00').getDay();
      const dowF = dow === 0 ? 0.45 : (dow === 6 ? 1.35 : (dow === 5 ? 1.2 : 1));
      const trend = 0.72 + 0.5 * ((off + 90) / 90);         // crecimiento gradual
      const ahead = off > 0 ? Math.max(0.15, 1 - off / 14) : 1; // menos reservas cuanto más lejos
      const count = Math.max(0, Math.round(opts.base * dowF * trend * ahead * (0.75 + r() * 0.5)));
      const used = {};

      for (let i = 0; i < count; i++) {
        const barber = this.pick(r, barbers);
        const free = DB.TIME_SLOTS.filter(t => !used[barber + t]);
        if (!free.length) continue;
        const time = this.weighted(r, free.map(t => ({ v: t, w: (t >= '17:00' || t <= '10:30') ? 1.6 : 1 })));
        used[barber + time] = 1;
        const svc = this.weighted(r, svcWeights);
        const c = this.pick(r, pool);
        let status;
        if (off < 0) status = this.weighted(r, [{ v: 'COMPLETADA', w: 80 }, { v: 'CANCELADA', w: opts.cancel }, { v: 'NO_ASISTIO', w: 6 }]);
        else status = r() < 0.45 ? 'CONFIRMADA_WSP' : 'PROGRAMADA';
        const createdDate = DB.addDays(date, -Math.floor(r() * 6));
        const createdTime = String(8 + Math.floor(r() * 13)).padStart(2, '0') + ':' + String(Math.floor(r() * 60)).padStart(2, '0');
        const appt = {
          id: 'demo-a-' + opts.key + '-' + (n++),
          customerName: c.name, phone: c.phone, service: svc.name, barber, date, time,
          price: svc.price, status,
          source: r() < opts.web ? 'WEB' : 'CRM',
          createdAt: (createdDate > date ? date : createdDate) + 'T' + createdTime + ':00',
          notes: '', demo: true
        };
        if (status === 'COMPLETADA') {
          appt.completedAt = date + 'T' + time + ':00';
          if (svc.id === 's-ia' && r() < 0.65) {
            state.aiConsultations.push({
              id: 'demo-ai-' + opts.key + '-' + n, date, time, clientName: c.name, clientPhone: c.phone, barberName: barber,
              chosenStyle: this.pick(r, this.STYLES), match: (88 + Math.floor(r() * 11)) + '% MATCH FACIAL', beardTech: '', demo: true
            });
          }
        }
        state.appointments.push(appt);
      }

      // Walk-in atendidos (solo días pasados)
      if (off < 0) {
        const wk = Math.round(opts.base * 0.35 * dowF * trend * (0.6 + r() * 0.8));
        for (let j = 0; j < wk; j++) {
          const svc = this.weighted(r, svcWeights.map(x => ({ v: x.v, w: x.v.price <= 45 ? x.w * 2 : x.w * 0.4 })));
          const c = this.pick(r, pool);
          const hh = 9 + Math.floor(r() * 11), mm = Math.floor(r() * 60);
          const addedAt = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
          state.walkIns.push({
            id: 'demo-w-' + opts.key + '-' + (n++), customerName: c.name, service: svc.name, barber: this.pick(r, barbers),
            price: svc.price, status: 'FINALIZADO', addedAt, date, finishedAt: date + 'T' + addedAt + ':00', notes: '', demo: true
          });
        }
      }
    }

    const known = new Set(state.customers.map(c => c.name.toLowerCase()));
    pool.forEach(c => {
      if (!known.has(c.name.toLowerCase())) state.customers.push({ id: 'demo-c-' + opts.key + '-' + (n++), name: c.name, phone: c.phone, notes: 'Cliente de demostración', demo: true });
    });
  },

  navajaTenant() {
    const today = DB.todayISO();
    return {
      id: 't-navaja-norte', slug: 'navaja-norte', name: 'Navaja Norte', ownerName: 'Ricardo Salas',
      logo: '', accent: '#4FC3F7', palette: { primary: '#0B1320', secondary: '#4FC3F7', tertiary: '#F4F7FA' },
      address: 'Av. Universitaria 1520, Los Olivos', phone: '+51 988 111 222', hours: 'Citas de 9:00 a 20:00', city: 'Lima, Perú',
      currency: 'S/', status: 'ACTIVE', plan: 'BASICO', planFee: 79,
      subscriptionEnd: DB.addDays(today, 5), ownerEmail: 'ricardo@navajanorte.pe', ownerPhone: '+51 988 111 222',
      createdAt: DB.addDays(today, -96) + 'T10:00:00', demo: true
    };
  },

  navajaBarbers() {
    return [
      { id: 'bp-nn-1', name: 'Luis', role: 'Barbero principal • Fade y diseño', photo: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=600&q=80', specialties: ['Skin Fade', 'Diseño lateral', 'Barba'], works: [{ id: 'wk-nn-1', title: 'Burst Fade + Diseño', image: 'https://images.unsplash.com/photo-1519699047748-de8e457a634e?auto=format&fit=crop&w=600&q=80' }] },
      { id: 'bp-nn-2', name: 'Andrés', role: 'Barbero • Barba y navaja', photo: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=600&q=80', specialties: ['Afeitado clásico', 'Perfilado de barba'], works: [{ id: 'wk-nn-2', title: 'Perfilado geométrico', image: 'https://images.unsplash.com/photo-1621607512214-68297480165e?auto=format&fit=crop&w=600&q=80' }] },
      { id: 'bp-nn-3', name: 'Kevin', role: 'Barbero • Cortes clásicos', photo: 'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=600&q=80', specialties: ['Side Part', 'Corte a tijera'], works: [] }
    ];
  },

  /* Se ejecuta desde DB.load(). Devuelve true si generó datos. */
  run(root) {
    if (root.demoSeed) return false; // ya se generó (o se borró a propósito)
    const golden = root.tenants.find(t => t.id === 't-golden') || root.tenants[0];
    if (golden && root.data[golden.id]) {
      DB.migrateRecords(root.data[golden.id]);
      this.history(root.data[golden.id], { key: 'g', seed: 20261016, base: 9, customers: 140, cancel: 9, web: 0.48, svcWeight: { 's-ia': 5, s1: 9, s2: 4, s3: 8, s4: 4, s5: 2 } });
    }
    if (!root.tenants.some(t => t.slug === 'navaja-norte')) {
      const t2 = this.navajaTenant();
      root.tenants.push(t2);
      const st = DB.templateData(t2.name);
      st.barberProfiles = this.navajaBarbers();
      st.settings.ownerName = t2.ownerName;
      root.data[t2.id] = st;
      this.history(st, { key: 'n', seed: 777, base: 5, customers: 80, cancel: 18, web: 0.3, svcWeight: { 's-ia': 1, s1: 8, s2: 2, s3: 10, s4: 6, s5: 3 } });
    }
    root.demoSeed = { v: this.VERSION, at: new Date().toISOString(), usersPending: true };
    return true;
  },

  /* Borra todo lo marcado como demo (registros, barbería de ejemplo y sus usuarios) */
  clear(root) {
    const demoTenants = root.tenants.filter(t => t.demo).map(t => t.id);
    root.tenants = root.tenants.filter(t => !t.demo);
    demoTenants.forEach(id => { delete root.data[id]; });
    root.users = root.users.filter(u => !demoTenants.includes(u.tenantId));
    let removed = 0;
    Object.values(root.data).forEach(s => {
      ['appointments', 'walkIns', 'aiConsultations', 'customers'].forEach(k => {
        const before = (s[k] || []).length;
        s[k] = (s[k] || []).filter(x => !x.demo);
        removed += before - s[k].length;
      });
    });
    root.demoSeed = Object.assign({}, root.demoSeed || {}, { cleared: new Date().toISOString(), usersPending: false });
    return { removed, tenants: demoTenants.length };
  }
};
