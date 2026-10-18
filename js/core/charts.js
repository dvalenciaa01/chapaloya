/* ==========================================================================
   Gráficos livianos (SVG/HTML, sin librerías externas)
   - Línea con comparación de período, barras horizontales, columnas y barra
     apilada 100%. Marcas finas, cuadrícula discreta, tooltip al pasar el mouse
     o al enfocar con teclado. Se redibujan con el ancho real del contenedor.
   ========================================================================== */
const Charts = {
  money(n, cur) {
    return (cur || 'S/') + ' ' + Math.round(Number(n) || 0).toLocaleString('es-PE');
  },
  compact(n) {
    const v = Math.abs(n);
    if (v >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + 'M';
    if (v >= 1e3) return (n / 1e3).toFixed(1).replace('.0', '') + 'K';
    return String(Math.round(n));
  },
  pct(x, digits) { return x == null ? '—' : (x * 100).toFixed(digits == null ? 0 : digits) + '%'; },
  dateShort(iso) {
    const d = new Date(iso + 'T12:00:00');
    return d.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' }).replace('.', '');
  },
  dateLong(iso) {
    const d = new Date(iso + 'T12:00:00');
    const s = d.toLocaleDateString('es-PE', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  },
  niceMax(v) {
    if (v <= 0) return 1;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    const f = v / exp;
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * exp;
  },
  css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); },

  /* ---------------- Tooltip compartido ---------------- */
  tip: null,
  ensureTip() {
    if (this.tip) return this.tip;
    const el = document.createElement('div');
    el.className = 'chart-tip';
    el.setAttribute('role', 'tooltip');
    el.hidden = true;
    document.body.appendChild(el);
    this.tip = el;
    const show = (target, x, y) => {
      el.innerHTML = target.getAttribute('data-tip');
      el.hidden = false;
      const r = el.getBoundingClientRect();
      let left = x + 14, top = y - r.height - 12;
      if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
      if (top < 8) top = y + 16;
      el.style.left = Math.max(8, left) + 'px';
      el.style.top = top + 'px';
    };
    document.addEventListener('mousemove', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t) show(t, e.clientX, e.clientY); else if (!el.hidden) el.hidden = true;
    });
    document.addEventListener('focusin', (e) => {
      const t = e.target.closest && e.target.closest('[data-tip]');
      if (t) { const r = t.getBoundingClientRect(); show(t, r.left + r.width / 2, r.top); }
    });
    document.addEventListener('focusout', () => { el.hidden = true; });
    window.addEventListener('scroll', () => { el.hidden = true; }, { passive: true });
    return el;
  },

  /* ---------------- Línea (ej. ingresos por día) ---------------- */
  // opts: { dates:[iso], series:[{name, values:[], kind:'current'|'previous'}], format:fn, height }
  line(container, opts) {
    if (!container) return;
    this.ensureTip();
    const draw = () => {
      const W = Math.max(280, container.clientWidth || 600);
      const H = opts.height || 240;
      const pad = { l: 52, r: 16, t: 14, b: 30 };
      const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
      const n = opts.dates.length;
      const all = opts.series.flatMap(s => s.values);
      const max = this.niceMax(Math.max(1, ...all));
      const x = (i) => pad.l + (n <= 1 ? iw / 2 : (i * iw) / (n - 1));
      const y = (v) => pad.t + ih - (v / max) * ih;
      const accent = this.css('--yellow') || '#D79848';
      const prevC = this.css('--on-dark-lo') || '#888';
      const grid = this.css('--line-dark') || 'rgba(255,255,255,.1)';
      const label = this.css('--on-dark-lo') || '#999';
      const fmt = opts.format || ((v) => String(v));

      let svg = '<svg class="chart-svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + UIx.esc(opts.aria || 'Gráfico de línea') + '">';
      for (let i = 0; i <= 4; i++) {
        const v = (max / 4) * i, yy = y(v);
        svg += '<line x1="' + pad.l + '" x2="' + (W - pad.r) + '" y1="' + yy + '" y2="' + yy + '" stroke="' + grid + '" stroke-width="1"/>';
        svg += '<text x="' + (pad.l - 8) + '" y="' + (yy + 4) + '" text-anchor="end" class="chart-axis" fill="' + label + '">' + this.compact(v) + '</text>';
      }
      const ticks = Math.min(n, W < 480 ? 4 : 7);
      for (let k = 0; k < ticks; k++) {
        const i = ticks === 1 ? 0 : Math.round((k * (n - 1)) / (ticks - 1));
        svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="' + (k === 0 ? 'start' : k === ticks - 1 ? 'end' : 'middle') + '" class="chart-axis" fill="' + label + '">' + this.dateShort(opts.dates[i]) + '</text>';
      }
      opts.series.slice().reverse().forEach(s => {
        const pts = s.values.map((v, i) => x(i) + ',' + y(v)).join(' ');
        const color = s.kind === 'previous' ? prevC : accent;
        if (s.kind !== 'previous' && n > 1) {
          svg += '<polygon points="' + x(0) + ',' + y(0) + ' ' + pts + ' ' + x(n - 1) + ',' + y(0) + '" fill="' + color + '" fill-opacity="0.1"/>';
        }
        svg += '<polyline points="' + pts + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"' + (s.kind === 'previous' ? ' stroke-dasharray="5 5"' : '') + '/>';
        if (s.kind !== 'previous' && n) {
          const lv = s.values[n - 1];
          svg += '<circle cx="' + x(n - 1) + '" cy="' + y(lv) + '" r="4.5" fill="' + color + '" stroke="' + (this.css('--ink-850') || '#111') + '" stroke-width="2"/>';
        }
      });
      svg += '<line class="chart-cross" x1="0" x2="0" y1="' + pad.t + '" y2="' + (pad.t + ih) + '" stroke="' + label + '" stroke-width="1" opacity="0"/>';
      svg += '<circle class="chart-cross-dot" r="5" fill="' + accent + '" stroke="' + (this.css('--ink-850') || '#111') + '" stroke-width="2" opacity="0"/>';
      // Zonas de interacción (una por día)
      const bw = n > 1 ? iw / (n - 1) : iw;
      opts.dates.forEach((d, i) => {
        const cur = opts.series[0].values[i];
        const prev = opts.series[1] ? opts.series[1].values[i] : null;
        const tipHtml = '<strong>' + this.dateLong(d) + '</strong><br/>' + UIx.esc(opts.series[0].name) + ': <b>' + fmt(cur) + '</b>' +
          (prev != null ? '<br/><span class="tip-muted">' + UIx.esc(opts.series[1].name) + ': ' + fmt(prev) + '</span>' : '');
        svg += '<rect class="chart-hit" x="' + Math.max(pad.l, x(i) - bw / 2) + '" y="' + pad.t + '" width="' + Math.max(4, Math.min(bw, iw)) + '" height="' + ih + '" fill="transparent" data-i="' + i + '" data-tip="' + UIx.esc(tipHtml) + '"/>';
      });
      svg += '</svg>';
      container.innerHTML = svg;
      const cross = container.querySelector('.chart-cross');
      const dot = container.querySelector('.chart-cross-dot');
      container.querySelectorAll('.chart-hit').forEach(r => {
        r.addEventListener('mouseenter', () => {
          const i = Number(r.getAttribute('data-i'));
          cross.setAttribute('x1', x(i)); cross.setAttribute('x2', x(i)); cross.setAttribute('opacity', '0.6');
          dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(opts.series[0].values[i])); dot.setAttribute('opacity', '1');
        });
        r.addEventListener('mouseleave', () => { cross.setAttribute('opacity', '0'); dot.setAttribute('opacity', '0'); });
      });
    };
    draw();
    this.onResize(container, draw);
  },

  _resizers: [],
  onResize(container, fn) {
    this._resizers = this._resizers.filter(r => document.body.contains(r.el) && r.el !== container);
    this._resizers.push({ el: container, fn });
    if (!this._bound) {
      this._bound = true;
      let t = null;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => this._resizers.forEach(r => { if (document.body.contains(r.el)) r.fn(); }), 150);
      });
    }
  },

  /* ---------------- Barras horizontales ---------------- */
  // items: [{label, value, display, sub, tip}]
  hbars(items, opts) {
    this.ensureTip();
    const o = opts || {};
    if (!items.length) return '<div class="chart-empty">' + (o.empty || 'Sin datos en este período.') + '</div>';
    const max = Math.max(...items.map(i => i.value), 1);
    return '<ul class="hbars">' + items.map(i =>
      '<li class="hb-row" tabindex="0" data-tip="' + UIx.esc(i.tip || ('<strong>' + UIx.esc(i.label) + '</strong><br/>' + UIx.esc(i.display))) + '">' +
        '<span class="hb-label">' + UIx.esc(i.label) + (i.sub ? '<small>' + UIx.esc(i.sub) + '</small>' : '') + '</span>' +
        '<span class="hb-track"><span class="hb-fill" style="width:' + Math.max(1.5, (i.value / max) * 100) + '%;"></span></span>' +
        '<span class="hb-value">' + UIx.esc(i.display) + '</span>' +
      '</li>'
    ).join('') + '</ul>';
  },

  /* ---------------- Columnas (ej. horas pico) ---------------- */
  columns(items, opts) {
    this.ensureTip();
    const o = opts || {};
    if (!items.some(i => i.value > 0)) return '<div class="chart-empty">' + (o.empty || 'Sin datos en este período.') + '</div>';
    const max = Math.max(...items.map(i => i.value), 1);
    const peak = items.reduce((a, b) => (b.value > a.value ? b : a), items[0]);
    return '<div class="cols" role="img" aria-label="' + UIx.esc(o.aria || '') + '">' + items.map(i =>
      '<div class="col" tabindex="0" data-tip="' + UIx.esc('<strong>' + i.label + '</strong><br/>' + i.value + ' ' + (o.unit || '')) + '">' +
        '<span class="col-val">' + (i === peak ? i.value : '') + '</span>' +
        '<span class="col-bar' + (i === peak ? ' is-peak' : '') + '" style="height:' + Math.max(2, (i.value / max) * 100) + '%;"></span>' +
        '<span class="col-lbl">' + i.label + '</span>' +
      '</div>'
    ).join('') + '</div>';
  },

  /* ---------------- Barra apilada 100% + leyenda ---------------- */
  // segments: [{label, value, color}]
  stacked(segments, opts) {
    this.ensureTip();
    const o = opts || {};
    const total = segments.reduce((x, s) => x + s.value, 0);
    if (!total) return '<div class="chart-empty">' + (o.empty || 'Sin datos en este período.') + '</div>';
    return '<div class="stk" role="img" aria-label="' + UIx.esc(o.aria || '') + '">' + segments.filter(s => s.value > 0).map(s =>
      '<span class="stk-seg" tabindex="0" style="flex-grow:' + s.value + '; background:' + s.color + ';" data-tip="' + UIx.esc('<strong>' + s.label + '</strong><br/>' + s.value + ' · ' + this.pct(s.value / total, 1)) + '"></span>'
    ).join('') + '</div>' +
    '<ul class="chart-legend">' + segments.map(s =>
      '<li><span class="lg-swatch" style="background:' + s.color + ';"></span><span class="lg-label">' + UIx.esc(s.label) + '</span><strong>' + s.value + '</strong><span class="lg-pct">' + this.pct(s.value / total) + '</span></li>'
    ).join('') + '</ul>';
  }
};
