/* ==========================================================================
   Editor de horario semanal
   --------------------------------------------------------------------------
   Lo usan "Horario de atención" (horario del negocio) y la ficha de cada
   profesional. Arriba muestra la semana dibujada (como un calendario) y
   debajo un renglón por día con un interruptor Abierto/Cerrado, el horario
   y, si hace falta, una pausa (p. ej. el almuerzo). El dibujo se actualiza
   mientras se edita.

   El formato que devuelve es el de la base de datos (migración 6):
     { 0: [['09:00','13:00'], ['14:00','20:30']], 1: [], … }   0 = domingo
   Dos tramos = abierto, pausa, abierto.
   ========================================================================== */
const ScheduleEditor = {
  ORDER: [1, 2, 3, 4, 5, 6, 0],   // la semana empieza el lunes

  _ic(name) { return typeof ic === 'function' ? ic(name) : ''; },
  _short(d) { return DB.DAY_NAMES[d].slice(0, 3); },
  _min(t) { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? (+m[1]) * 60 + (+m[2]) : null; },
  _hhmm(m) { m = Math.max(0, Math.min(23 * 60 + 55, m)); return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); },
  // "09:00" → "9:00"; "13:30" → "13:30"
  _pretty(t) { return String(t || '').replace(/^0(\d)/, '$1'); },

  html(prefix, week) {
    const w = week || {};
    const val = (d, i, j) => { const r = (w[d] || [])[i]; return r ? r[j] : ''; };
    const P = '\'' + prefix + '\'';
    const rows = this.ORDER.map(d => {
      const on = (w[d] || []).length > 0;
      const two = (w[d] || []).length > 1;
      const name = DB.DAY_NAMES[d];
      const id = (i, j) => prefix + '-' + d + '-' + i + '-' + (j ? 't' : 'f');
      const time = (i, j) => '<input type="time" step="300" id="' + id(i, j) + '" class="input-dark sch-time" value="' + val(d, i, j) + '"' +
        (on ? '' : ' disabled') + ' aria-label="' + name + (i ? ' (después de la pausa)' : '') + (j ? ': cierra a las' : ': abre a las') + '" />';
      return '<div class="sch-row' + (on ? '' : ' is-off') + (two ? ' has-break' : '') + '" id="' + prefix + '-row-' + d + '" data-day="' + d + '">' +
        '<label class="sch-day">' +
          '<input type="checkbox" class="sch-switch-input" id="' + prefix + '-on-' + d + '"' + (on ? ' checked' : '') +
            ' onchange="ScheduleEditor.toggle(' + P + ',' + d + ')" />' +
          '<span class="sch-switch" aria-hidden="true"></span>' +
          '<span class="sch-day-txt"><strong>' + name + '</strong><small class="sch-day-state">' + (on ? 'Abierto' : 'Cerrado') + '</small></span>' +
        '</label>' +
        '<div class="sch-ranges">' +
          '<div class="sch-range"><span class="sch-lbl">Abre</span>' + time(0, 0) + '<span class="sch-lbl">cierra</span>' + time(0, 1) + '</div>' +
          '<div class="sch-range sch-range-2"><span class="sch-lbl">Vuelve</span>' + time(1, 0) + '<span class="sch-lbl">cierra</span>' + time(1, 1) +
            '<button type="button" class="sch-icon-btn" onclick="ScheduleEditor.removeBreak(' + P + ',' + d + ')" aria-label="Quitar la pausa del ' + name + '" title="Quitar la pausa">' + this._ic('x') + '</button></div>' +
          '<span class="sch-closed">No se puede reservar este día</span>' +
        '</div>' +
        '<div class="sch-actions">' +
          '<button type="button" class="sch-mini-btn sch-add-break" onclick="ScheduleEditor.addBreak(' + P + ',' + d + ')" title="Cerrar un rato a mitad del día (por ejemplo, el almuerzo)">' + this._ic('coffee') + 'Pausa</button>' +
          '<button type="button" class="sch-mini-btn sch-copy" onclick="ScheduleEditor.copyDay(' + P + ',' + d + ')" title="Poner este mismo horario en los demás días abiertos">' + this._ic('copy') + 'Copiar a todos</button>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="sch-editor" id="' + prefix + '-editor" oninput="ScheduleEditor.refresh(' + P + ')">' +
      '<div class="sch-viz" id="' + prefix + '-viz" aria-hidden="true">' + this.vizHtml(prefix, w) + '</div>' +
      '<div class="sch-rows">' + rows + '</div>' +
      '<p class="sch-help">Activa los días que atiendes. Si cierras al mediodía, toca <strong>+ Pausa</strong>. ' +
        'Con <strong>Copiar a todos</strong> pasas el horario de un día a los demás días abiertos.</p>' +
    '</div>';
  },

  /* ---------- Semana dibujada ---------- */
  vizHtml(prefix, week) {
    const all = [];
    this.ORDER.forEach(d => (week[d] || []).forEach(r => { const a = this._min(r[0]), b = this._min(r[1]); if (a != null && b != null && a < b) all.push([a, b]); }));
    let lo = all.length ? Math.floor(Math.min(...all.map(r => r[0])) / 60) : 9;
    let hi = all.length ? Math.ceil(Math.max(...all.map(r => r[1])) / 60) : 18;
    while (hi - lo < 6) { if (lo > 0) lo--; if (hi - lo < 6 && hi < 24) hi++; }
    const span = (hi - lo) * 60;
    const pct = (m) => ((m - lo * 60) / span * 100).toFixed(3) + '%';
    let hours = 0, days = 0;
    const step = (hi - lo) > 10 ? 3 : 2;
    const axis = [];
    for (let h = lo; h <= hi; h += step) axis.push('<span style="top:' + pct(h * 60) + '">' + h + ':00</span>');
    const today = new Date().getDay();
    const cols = this.ORDER.map(d => {
      const rs = (week[d] || []).map(r => [this._min(r[0]), this._min(r[1]), r]).filter(r => r[0] != null && r[1] != null && r[0] < r[1]);
      if (rs.length) days++;
      rs.forEach(r => { hours += (r[1] - r[0]) / 60; });
      const blocks = rs.map(r => '<span class="sch-viz-block" style="top:' + pct(r[0]) + ';height:calc(' + pct(r[1]) + ' - ' + pct(r[0]) + ')">' +
        '<b>' + this._pretty(r[2][0]) + '</b><b>' + this._pretty(r[2][1]) + '</b></span>').join('');
      return '<button type="button" tabindex="-1" class="sch-viz-col' + (rs.length ? '' : ' is-off') + (d === today ? ' is-today' : '') + '" onclick="ScheduleEditor.focusDay(\'' + prefix + '\',' + d + ')">' +
        '<span class="sch-viz-day">' + this._short(d) + '</span>' +
        '<span class="sch-viz-track" style="--sch-rows:' + (hi - lo) + '">' + (rs.length ? blocks : '<span class="sch-viz-off">Cerrado</span>') + '</span>' +
      '</button>';
    }).join('');
    const h = Math.round(hours * 10) / 10;
    return '<div class="sch-viz-head"><strong>Así queda tu semana</strong>' +
        '<span class="sch-viz-stats"><span><b>' + days + '</b> ' + (days === 1 ? 'día abierto' : 'días abiertos') + '</span>' +
        '<span><b>' + String(h).replace('.', ',') + '</b> h a la semana</span></span></div>' +
      '<div class="sch-viz-grid"><span class="sch-viz-axis">' + axis.join('') + '</span>' + cols + '</div>';
  },

  // Lee lo que hay en pantalla sin validar (para el dibujo)
  peek(prefix) {
    const week = {};
    this.ORDER.forEach(d => {
      const on = document.getElementById(prefix + '-on-' + d);
      week[d] = [];
      if (!on || !on.checked) return;
      const row = document.getElementById(prefix + '-row-' + d);
      [0, 1].forEach(i => {
        if (i === 1 && !row.classList.contains('has-break')) return;
        const f = document.getElementById(prefix + '-' + d + '-' + i + '-f').value;
        const t = document.getElementById(prefix + '-' + d + '-' + i + '-t').value;
        if (f && t) week[d].push([f, t]);
      });
    });
    return week;
  },

  refresh(prefix) {
    const viz = document.getElementById(prefix + '-viz');
    if (viz) viz.innerHTML = this.vizHtml(prefix, this.peek(prefix));
  },

  // Avisa de un cambio hecho con botones (para el aviso de "sin guardar")
  changed(prefix) {
    this.refresh(prefix);
    const ed = document.getElementById(prefix + '-editor');
    if (ed) ed.dispatchEvent(new Event('change', { bubbles: true }));
  },

  focusDay(prefix, d) {
    const row = document.getElementById(prefix + '-row-' + d);
    if (!row) return;
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.remove('is-flash'); void row.offsetWidth; row.classList.add('is-flash');
    const el = row.classList.contains('is-off') ? document.getElementById(prefix + '-on-' + d) : document.getElementById(prefix + '-' + d + '-0-f');
    if (el) el.focus({ preventScroll: true });
  },

  toggle(prefix, d) {
    const on = document.getElementById(prefix + '-on-' + d).checked;
    const row = document.getElementById(prefix + '-row-' + d);
    row.classList.toggle('is-off', !on);
    row.querySelector('.sch-day-state').textContent = on ? 'Abierto' : 'Cerrado';
    row.querySelectorAll('.sch-time').forEach(el => { el.disabled = !on; });
    const f = document.getElementById(prefix + '-' + d + '-0-f');
    const t = document.getElementById(prefix + '-' + d + '-0-t');
    if (on && !f.value && !t.value) {
      // Al abrir un día vacío se propone el horario del día abierto más cercano
      const src = this.ORDER.find(x => x !== d && document.getElementById(prefix + '-on-' + x).checked &&
        document.getElementById(prefix + '-' + x + '-0-f').value);
      if (src != null) this._copy(prefix, src, d);
      else { f.value = '09:00'; t.value = '20:00'; }
    }
    this.changed(prefix);
  },

  addBreak(prefix, d) {
    const row = document.getElementById(prefix + '-row-' + d);
    const g = (i, j) => document.getElementById(prefix + '-' + d + '-' + i + '-' + j);
    const a = this._min(g(0, 'f').value), b = this._min(g(0, 't').value);
    // Parte el horario en dos: la pausa va a mediodía (13:00 a 14:00) si cabe
    let p1 = 13 * 60, p2 = 14 * 60;
    if (a != null && b != null && b - a >= 120) {
      if (!(p1 > a && p2 < b)) { const mid = Math.round((a + b) / 2 / 30) * 30; p1 = mid - 30; p2 = mid + 30; }
      g(1, 't').value = this._hhmm(b);
      g(0, 't').value = this._hhmm(p1);
      g(1, 'f').value = this._hhmm(p2);
    } else if (b != null) {
      g(1, 'f').value = this._hhmm(b + 60);
      g(1, 't').value = this._hhmm(b + 240);
    }
    row.classList.add('has-break');
    g(1, 'f').focus();
    this.changed(prefix);
  },

  removeBreak(prefix, d) {
    const row = document.getElementById(prefix + '-row-' + d);
    const g = (i, j) => document.getElementById(prefix + '-' + d + '-' + i + '-' + j);
    // Sin pausa: el día queda de la apertura al cierre final
    if (g(1, 't').value) g(0, 't').value = g(1, 't').value;
    g(1, 'f').value = ''; g(1, 't').value = '';
    row.classList.remove('has-break');
    this.changed(prefix);
  },

  _copy(prefix, from, to) {
    const get = (d, i, j) => document.getElementById(prefix + '-' + d + '-' + i + '-' + j);
    [0, 1].forEach(i => ['f', 't'].forEach(j => { get(to, i, j).value = get(from, i, j).value; }));
    const brk = document.getElementById(prefix + '-row-' + from).classList.contains('has-break');
    document.getElementById(prefix + '-row-' + to).classList.toggle('has-break', brk);
    if (!brk) { get(to, 1, 'f').value = ''; get(to, 1, 't').value = ''; }
  },

  copyDay(prefix, from) {
    let n = 0;
    this.ORDER.forEach(d => {
      if (d === from || !document.getElementById(prefix + '-on-' + d).checked) return;
      this._copy(prefix, from, d); n++;
    });
    this.changed(prefix);
    if (typeof UI !== 'undefined' && UI.toast) {
      UI.toast(n ? 'Horario del ' + DB.DAY_NAMES[from].toLowerCase() + ' copiado a ' + n + (n === 1 ? ' día abierto.' : ' días abiertos.') + ' Recuerda guardar.'
        : 'No hay otros días abiertos. Activa primero los días que atiendes.', n ? undefined : 'info');
    }
  },

  // Devuelve { week } o { error } con un mensaje para el usuario
  read(prefix) {
    const week = {};
    for (const d of this.ORDER) {
      const name = DB.DAY_NAMES[d];
      if (!document.getElementById(prefix + '-on-' + d).checked) { week[d] = []; continue; }
      const row = document.getElementById(prefix + '-row-' + d);
      const v = (i, j) => document.getElementById(prefix + '-' + d + '-' + i + '-' + j).value;
      const ranges = [];
      for (const i of [0, 1]) {
        if (i === 1 && row && !row.classList.contains('has-break')) continue;
        const f = v(i, 'f');
        const t = v(i, 't');
        if (!f && !t) continue;
        if (!f || !t) return { error: name + ': completa la hora en que abre y la hora en que cierra.' };
        if (f >= t) return { error: name + ': la hora en que abre debe ser antes de la hora en que cierra.' };
        if (ranges.length && f < ranges[ranges.length - 1][1]) return { error: name + ': después de la pausa, la hora en que vuelve debe ser más tarde que la hora en que cerró.' };
        ranges.push([f, t]);
      }
      if (!ranges.length) return { error: name + ': indica el horario o apaga "' + name + '" si no se atiende.' };
      week[d] = ranges;
    }
    return { week };
  },

  // "Lun–Vie 09:00–13:00 y 14:00–20:30 · Sáb 09:00–14:00" (resumen corto)
  summary(week) {
    const txt = (d) => (week[d] || []).map(r => r[0] + '–' + r[1]).join(' y ');
    const short = (d) => DB.DAY_NAMES[d].slice(0, 3);
    const groups = [];
    this.ORDER.forEach(d => {
      const t = txt(d);
      const last = groups[groups.length - 1];
      if (last && last.t === t) last.to = d;
      else groups.push({ from: d, to: d, t });
    });
    const open = groups.filter(g => g.t);
    if (!open.length) return 'Sin días de atención';
    return open.map(g => (g.from === g.to ? short(g.from) : short(g.from) + '–' + short(g.to)) + ' ' + g.t).join(' · ');
  }
};
