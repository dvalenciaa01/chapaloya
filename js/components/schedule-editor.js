/* ==========================================================================
   Editor de horario semanal
   --------------------------------------------------------------------------
   Lo usan Configuración (horario de la barbería) y la ficha de cada barbero.
   Cada día tiene una casilla "Atiende" y hasta dos tramos (p. ej. mañana y
   tarde). El formato que devuelve es el de la base de datos (migración 6):
     { 0: [['09:00','13:00'], ['14:00','20:30']], 1: [], … }   0 = domingo
   ========================================================================== */
const ScheduleEditor = {
  ORDER: [1, 2, 3, 4, 5, 6, 0],   // la semana empieza el lunes

  html(prefix, week) {
    const w = week || {};
    const val = (d, i, j) => { const r = (w[d] || [])[i]; return r ? r[j] : ''; };
    const rows = this.ORDER.map(d => {
      const on = (w[d] || []).length > 0;
      const id = (i, j) => prefix + '-' + d + '-' + i + '-' + (j ? 't' : 'f');
      const time = (i, j) => '<input type="time" step="300" id="' + id(i, j) + '" class="input-dark sch-time" value="' + val(d, i, j) + '"' + (on ? '' : ' disabled') + ' aria-label="' + DB.DAY_NAMES[d] + (j ? ' hasta' : ' desde') + '" />';
      return '<div class="sch-row' + (on ? '' : ' is-off') + '" id="' + prefix + '-row-' + d + '">' +
        '<label class="sch-day"><input type="checkbox" id="' + prefix + '-on-' + d + '"' + (on ? ' checked' : '') +
          ' onchange="ScheduleEditor.toggle(\'' + prefix + '\',' + d + ')" /><span>' + DB.DAY_NAMES[d] + '</span></label>' +
        '<div class="sch-ranges">' +
          '<span class="sch-range">' + time(0, 0) + '<span class="sch-sep">a</span>' + time(0, 1) + '</span>' +
          '<span class="sch-range sch-range-2">' + time(1, 0) + '<span class="sch-sep">a</span>' + time(1, 1) + '</span>' +
          '<span class="sch-closed">' + 'No atiende' + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
    return '<div class="sch-editor" id="' + prefix + '-editor">' + rows +
      '<div class="sch-help">El segundo tramo es opcional (por ejemplo, la tarde después del almuerzo). La hora final es la hora de cierre.' +
      ' <button type="button" class="inline-link sch-copy" onclick="ScheduleEditor.copyMonday(\'' + prefix + '\')">Copiar el lunes a los demás días abiertos</button></div>' +
    '</div>';
  },

  toggle(prefix, d) {
    const on = document.getElementById(prefix + '-on-' + d).checked;
    const row = document.getElementById(prefix + '-row-' + d);
    row.classList.toggle('is-off', !on);
    row.querySelectorAll('.sch-time').forEach(el => { el.disabled = !on; });
    const f = document.getElementById(prefix + '-' + d + '-0-f');
    const t = document.getElementById(prefix + '-' + d + '-0-t');
    if (on && !f.value && !t.value) { f.value = '09:00'; t.value = '20:00'; }
  },

  copyMonday(prefix) {
    const get = (d, i, j) => document.getElementById(prefix + '-' + d + '-' + i + '-' + j).value;
    this.ORDER.slice(1).forEach(d => {
      if (!document.getElementById(prefix + '-on-' + d).checked) return;
      [0, 1].forEach(i => ['f', 't'].forEach(j => {
        document.getElementById(prefix + '-' + d + '-' + i + '-' + j).value = get(1, i, j);
      }));
    });
  },

  // Devuelve { week } o { error } con un mensaje para el usuario
  read(prefix) {
    const week = {};
    for (const d of this.ORDER) {
      const name = DB.DAY_NAMES[d];
      if (!document.getElementById(prefix + '-on-' + d).checked) { week[d] = []; continue; }
      const v = (i, j) => document.getElementById(prefix + '-' + d + '-' + i + '-' + j).value;
      const ranges = [];
      for (const i of [0, 1]) {
        const f = v(i, 'f');
        const t = v(i, 't');
        if (!f && !t) continue;
        if (!f || !t) return { error: name + ': completa la hora de inicio y la de cierre.' };
        if (f >= t) return { error: name + ': la hora de inicio debe ser antes de la de cierre.' };
        if (ranges.length && f < ranges[ranges.length - 1][1]) return { error: name + ': el segundo tramo debe empezar después de que termine el primero.' };
        ranges.push([f, t]);
      }
      if (!ranges.length) return { error: name + ': indica el horario o desmarca "' + name + '" si no se atiende.' };
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
