/* ==========================================================================
   Exportación de reportes a Excel (.xlsx) y PDF.
   Las librerías (ExcelJS, jsPDF + AutoTable; licencia MIT) están en js/vendor
   y se cargan solo al exportar, para no hacer más lenta la página.
   ========================================================================== */
const ReportExport = {
  LIBS: {
    xlsx: ['js/vendor/exceljs.min.js'],
    pdf: ['js/vendor/jspdf.umd.min.js', 'js/vendor/jspdf.plugin.autotable.min.js']
  },
  _loaded: {},

  loadScript(src) {
    return new Promise((resolve, reject) => {
      if (this._loaded[src]) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => { this._loaded[src] = true; resolve(); };
      s.onerror = () => reject(new Error('No se pudo cargar ' + src));
      document.head.appendChild(s);
    });
  },
  async ensure(kind) {
    for (const src of this.LIBS[kind]) await this.loadScript(src);
  },

  download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  /* ---------------- Colores ---------------- */
  hex(h) { return String(h || '#000000').replace('#', '').toUpperCase().padStart(6, '0'); },
  rgb(h) { const x = this.hex(h); return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]; },

  /* ======================================================================
     EXCEL
     ====================================================================== */
  moneyFmt(cur) { return '"' + String(cur || 'S/').replace(/"/g, '') + '" #,##0.00'; },
  xlDate(iso) {
    const p = iso.split('-').map(Number);
    return new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  },
  sheetName(name, used) {
    let n = String(name).replace(/[\[\]\*\?\/\\:]/g, ' ').slice(0, 31);
    let i = 2;
    while (used.has(n)) n = n.slice(0, 28) + ' ' + (i++);
    used.add(n);
    return n;
  },

  async toExcel(rep) {
    await this.ensure('xlsx');
    const wb = new window.ExcelJS.Workbook();
    wb.creator = rep.meta.generatedBy;
    wb.created = rep.meta.generatedAt;
    const pal = rep.meta.palette;
    const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + this.hex(pal.primary) } };
    const headFont = { bold: true, color: { argb: 'FF' + this.hex(pal.tertiary) } };
    const tables = Reports.tables(rep);
    const used = new Set();

    const writeMeta = (ws, title, withFilters) => {
      ws.getCell('A1').value = rep.meta.name;
      ws.getCell('A1').font = { bold: true, size: 16 };
      ws.getCell('A2').value = title;
      ws.getCell('A2').font = { bold: true, size: 12, color: { argb: 'FF444444' } };
      let r = 3;
      const lines = withFilters ? rep.meta.filters : rep.meta.filters.slice(0, 1);
      lines.forEach(([k, v]) => {
        ws.getCell('A' + r).value = k;
        ws.getCell('A' + r).font = { bold: true, color: { argb: 'FF555555' } };
        ws.getCell('B' + r).value = v;
        r++;
      });
      if (withFilters) {
        ws.getCell('A' + r).value = 'Generado por';
        ws.getCell('A' + r).font = { bold: true, color: { argb: 'FF555555' } };
        ws.getCell('B' + r).value = rep.meta.generatedBy + ' · ' + rep.meta.generatedText;
        r++;
        if (rep.mixedCurrency) {
          ws.getCell('A' + r).value = 'Aviso';
          ws.getCell('A' + r).font = { bold: true, color: { argb: 'FFB45309' } };
          ws.getCell('B' + r).value = 'Las barberías usan monedas distintas: los totales suman montos de monedas diferentes.';
          r++;
        }
      }
      return r + 1; // fila libre
    };

    const writeTable = (ws, t, startRow) => {
      const cols = t.columns;
      const hr = ws.getRow(startRow);
      cols.forEach((c, i) => {
        const cell = hr.getCell(i + 1);
        cell.value = c.label;
        cell.fill = headFill; cell.font = headFont;
        cell.alignment = { vertical: 'middle', horizontal: ['int', 'money', 'pct', 'delta', 'auto'].includes(c.type) ? 'right' : 'left', wrapText: true };
        cell.border = { bottom: { style: 'medium', color: { argb: 'FF' + this.hex(pal.secondary) } } };
      });
      hr.height = 22;
      let r = startRow + 1;
      const put = (row, isTotal) => {
        const xr = ws.getRow(r);
        cols.forEach((c, i) => {
          const cell = xr.getCell(i + 1);
          let v = row[c.key];
          let type = c.type === 'auto' ? row.type : c.type;
          if (c.type === 'delta') {
            if (row.delta == null) { cell.value = 'Sin base'; cell.alignment = { horizontal: 'right' }; }
            else if (row.deltaMode === 'pp') { cell.value = Math.round(row.delta * 1000) / 10; cell.numFmt = '+0.0" pp";-0.0" pp";0" pp"'; }
            else { cell.value = row.delta; cell.numFmt = '+0.0%;-0.0%;0%'; }
            const tone = Reports.deltaTone(row);
            if (tone !== 'flat') cell.font = { color: { argb: tone === 'good' ? 'FF15803D' : 'FFB91C1C' }, bold: true };
            return;
          }
          if (v === undefined || v === null || v === '') { cell.value = null; return; }
          if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(v)) { cell.value = this.xlDate(v); cell.numFmt = 'dd/mm/yyyy'; }
          else if (type === 'money' && typeof v === 'number') { cell.value = Math.round(v * 100) / 100; cell.numFmt = this.moneyFmt(row.currency || rep.currency); }
          else if (type === 'pct' && typeof v === 'number') { cell.value = v; cell.numFmt = '0.0%'; }
          else if (type === 'int' && typeof v === 'number') { cell.value = v; cell.numFmt = '#,##0'; }
          else cell.value = v;
          if (['int', 'money', 'pct'].includes(type)) cell.alignment = { horizontal: 'right' };
        });
        if (isTotal) {
          xr.font = { bold: true };
          cols.forEach((c, i) => { xr.getCell(i + 1).border = { top: { style: 'thin', color: { argb: 'FF999999' } } }; });
        }
        r++;
      };
      t.rows.forEach(row => put(row, false));
      if (!t.rows.length) {
        ws.getCell(r, 1).value = 'Sin registros con los filtros aplicados.';
        ws.getCell(r, 1).font = { italic: true, color: { argb: 'FF777777' } };
        r++;
      }
      if (t.totals && t.rows.length) put(Object.assign({ currency: rep.currency }, t.totals), true);
      cols.forEach((c, i) => {
        const col = ws.getColumn(i + 1);
        col.width = Math.max(col.width || 0, c.width);
      });
      if (t.rows.length) ws.autoFilter = { from: { row: startRow, column: 1 }, to: { row: startRow + t.rows.length, column: cols.length } };
      return r;
    };

    // Hoja Resumen: datos del reporte + indicadores
    const kpiT = tables.find(t => t.kpi);
    const summary = wb.addWorksheet(this.sheetName('Resumen', used), { properties: { tabColor: { argb: 'FF' + this.hex(pal.secondary) } } });
    let row = writeMeta(summary, rep.meta.title, true);
    summary.getCell('A' + row).value = 'Contenido: ' + rep.meta.sectionLabels.join(', ');
    summary.getCell('A' + row).font = { italic: true, color: { argb: 'FF555555' } };
    row += 2;
    if (kpiT) {
      summary.getCell('A' + (row - 1)).value = kpiT.title;
      summary.getCell('A' + (row - 1)).font = { bold: true, size: 12 };
      summary.getCell('A' + (row - 1)).border = { bottom: { style: 'thin', color: { argb: 'FF' + this.hex(pal.secondary) } } };
      writeTable(summary, kpiT, row);
      summary.autoFilter = undefined;
    } else {
      const k = rep.kpis;
      summary.getCell('A' + row).value = 'Registros en el reporte';
      summary.getCell('B' + row).value = k.records;
    }
    summary.getColumn(1).width = Math.max(summary.getColumn(1).width || 0, 44);
    summary.getColumn(2).width = Math.max(summary.getColumn(2).width || 0, 22);
    summary.views = [{ showGridLines: false }];

    // Una hoja por tabla
    tables.filter(t => !t.kpi).forEach(t => {
      const ws = wb.addWorksheet(this.sheetName(t.sheet, used));
      const start = writeMeta(ws, t.title, false);
      writeTable(ws, t, start);
      ws.views = [{ state: 'frozen', ySplit: start, xSplit: 0, showGridLines: true }];
      ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
    });

    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const name = Reports.fileName(rep, 'xlsx');
    this.download(blob, name);
    return { name, size: blob.size };
  },

  /* ======================================================================
     PDF
     ====================================================================== */
  // Convierte el logo (archivo o imagen subida) a PNG/JPEG embebible.
  // Si el navegador no lo permite (p. ej. abriendo los archivos sin servidor) se usa el nombre en texto.
  loadLogo(src) {
    return new Promise((resolve) => {
      if (!src) return resolve(null);
      if (/^data:image\/(png|jpe?g)/i.test(src)) return resolve(src);
      const img = new Image();
      const done = (v) => { clearTimeout(timer); resolve(v); };
      const timer = setTimeout(() => resolve(null), 4000);
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          const scale = Math.min(1, 600 / Math.max(img.naturalWidth, 1));
          c.width = Math.max(1, Math.round(img.naturalWidth * scale));
          c.height = Math.max(1, Math.round(img.naturalHeight * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          done(c.toDataURL('image/png'));
        } catch (e) { done(null); }
      };
      img.onerror = () => done(null);
      img.src = src;
    });
  },

  // Helvetica (estándar PDF) cubre el español; se reemplaza lo que no soporta.
  pdfText(s) {
    return String(s == null ? '' : s)
      .replace(/[−–]/g, '-').replace(/[▲]/g, '+').replace(/[▼]/g, '-')
      .replace(/[^\x20-\x7E -ÿ—‘’“”•…]/g, '');
  },

  async toPDF(rep) {
    await this.ensure('pdf');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
    const T = (s) => this.pdfText(s);
    const pal = rep.meta.palette;
    const P = this.rgb(pal.primary), S = this.rgb(pal.secondary), W = this.rgb(pal.tertiary);
    const PW = doc.internal.pageSize.getWidth(), PH = doc.internal.pageSize.getHeight();
    const MX = 12, MB = 14;
    const INK = [24, 24, 27], MUTED = [100, 100, 108], LINE = [222, 222, 228];
    doc.setProperties({ title: T(rep.meta.title), author: T(rep.meta.generatedBy), creator: 'Reservalope' });

    /* --- Encabezado de portada --- */
    const bandH = 30;
    doc.setFillColor(...P); doc.rect(0, 0, PW, bandH, 'F');
    doc.setFillColor(...S); doc.rect(0, bandH, PW, 1.4, 'F');
    let tx = MX;
    const logo = await this.loadLogo(rep.meta.logo);
    if (logo) {
      try {
        const fmt = /png/i.test(logo.slice(0, 30)) ? 'PNG' : 'JPEG';
        const props = doc.getImageProperties(logo);
        const h = 18, w = Math.min(46, (props.width / props.height) * h);
        doc.addImage(logo, fmt, MX, (bandH - h) / 2, w, h);
        tx = MX + w + 6;
      } catch (e) { tx = MX; }
    }
    doc.setTextColor(...W);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text(T(rep.meta.name), tx, 13);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5);
    doc.text(T(rep.meta.title + ' · ' + rep.meta.filters[0][1]), tx, 21);
    doc.setFontSize(8.5);
    doc.text(T('Generado: ' + rep.meta.generatedText), PW - MX, 13, { align: 'right' });
    doc.text(T(rep.meta.generatedBy), PW - MX, 19, { align: 'right' });

    /* --- Filtros aplicados --- */
    let y = bandH + 9;
    doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    doc.text('Filtros aplicados', MX, y);
    y += 5;
    doc.setFontSize(8.5);
    const fl = rep.meta.filters;
    const colW = (PW - MX * 2) / 2;
    fl.forEach((f, i) => {
      const cx = MX + (i % 2) * colW;
      const cy = y + Math.floor(i / 2) * 4.6;
      doc.setFont('helvetica', 'bold'); doc.setTextColor(...MUTED);
      doc.text(T(f[0] + ':'), cx, cy);
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...INK);
      const val = doc.splitTextToSize(T(f[1]), colW - 32)[0];
      doc.text(val, cx + 30, cy);
    });
    y += Math.ceil(fl.length / 2) * 4.6 + 2;
    if (rep.mixedCurrency) {
      doc.setTextColor(180, 83, 9); doc.setFont('helvetica', 'bold');
      doc.text('Aviso: las barberías usan monedas distintas; los totales suman montos de monedas diferentes.', MX, y);
      y += 5;
    }
    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(MX, y, PW - MX, y);
    y += 7;

    const tables = Reports.tables(rep);
    const ensureSpace = (need) => { if (y + need > PH - MB) { doc.addPage(); y = 20; } };
    const sectionTitle = (txt) => {
      ensureSpace(22);
      doc.setFillColor(...S); doc.rect(MX, y - 3.6, 1.6, 5, 'F');
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(12);
      doc.text(T(txt), MX + 4, y);
      y += 5;
    };

    /* --- Indicadores (tarjetas) --- */
    const kpiT = tables.find(t => t.kpi);
    if (kpiT) {
      sectionTitle('Resumen ejecutivo');
      const pick = rep.money
        ? ['Ingresos', 'Ventas (', 'Ticket promedio', 'Citas registradas', 'Tasa de citas completadas', 'Tasa de cancelación', 'Walk-in atendidos', 'Clientes únicos']
        : ['Ventas (', 'Citas registradas', 'Citas completadas', 'Tasa de citas completadas', 'Tasa de cancelación', 'No asistió', 'Walk-in atendidos', 'Clientes únicos'];
      const tiles = pick.map(l => kpiT.rows.find(r => r.label.indexOf(l) === 0)).filter(Boolean);
      const perRow = 4, gap = 4, tw = (PW - MX * 2 - gap * (perRow - 1)) / perRow, th = 21;
      tiles.forEach((r, i) => {
        const cx = MX + (i % perRow) * (tw + gap);
        const cy = y + Math.floor(i / perRow) * (th + gap);
        doc.setDrawColor(...LINE); doc.setFillColor(250, 250, 251); doc.roundedRect(cx, cy, tw, th, 1.6, 1.6, 'FD');
        doc.setTextColor(...MUTED); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
        doc.text(T(r.label.replace(/ \(.*\)/, '')).toUpperCase(), cx + 4, cy + 5.5);
        doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        doc.text(T(Reports.cellText({ key: 'cur', type: 'auto' }, r, rep)), cx + 4, cy + 13.5);
        const tone = Reports.deltaTone(r);
        doc.setFontSize(7.5); doc.setFont('helvetica', tone === 'flat' ? 'normal' : 'bold');
        doc.setTextColor(...(tone === 'good' ? [21, 128, 61] : tone === 'bad' ? [185, 28, 28] : MUTED));
        doc.text(T(Reports.deltaText(r) + ' vs. anterior (' + Reports.cellText({ key: 'prev', type: 'auto' }, r, rep) + ')'), cx + 4, cy + 18.5);
      });
      y += Math.ceil(tiles.length / perRow) * (th + gap) + 3;

      /* Gráfico de columnas: ingresos (o movimiento) por día */
      const days = rep.byDay;
      if (days.length > 1) {
        const key = rep.money ? 'revenue' : 'appts';
        const ch = 46;
        ensureSpace(ch + 14);
        doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
        doc.text(rep.money ? 'Ingresos por día' : 'Citas por día', MX, y + 1);
        y += 5;
        const ax = MX + 16, aw = PW - MX * 2 - 16, ah = ch - 8;
        const max = Charts.niceMax(Math.max(1, ...days.map(d => d[key])));
        doc.setFontSize(7); doc.setFont('helvetica', 'normal');
        for (let i = 0; i <= 4; i++) {
          const yy = y + ah - (ah * i) / 4;
          doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(ax, yy, ax + aw, yy);
          doc.setTextColor(...MUTED); doc.text(Charts.compact((max * i) / 4), ax - 2, yy + 1, { align: 'right' });
        }
        const n = days.length, slot = aw / n, bw = Math.max(0.6, Math.min(8, slot - Math.min(1.2, slot * 0.25)));
        doc.setFillColor(...P);
        days.forEach((d, i) => {
          const h = (d[key] / max) * ah;
          if (h > 0) doc.rect(ax + i * slot + (slot - bw) / 2, y + ah - h, bw, h, 'F');
        });
        const ticks = Math.min(n, 8);
        doc.setTextColor(...MUTED);
        for (let k = 0; k < ticks; k++) {
          const i = ticks === 1 ? 0 : Math.round((k * (n - 1)) / (ticks - 1));
          doc.text(Reports.fmtDate(days[i].date).slice(0, 5), ax + i * slot + slot / 2, y + ah + 4, { align: 'center' });
        }
        y += ch + 4;
      }
    }

    /* --- Tablas --- */
    const sectionNames = { summary: 'Resumen ejecutivo', sales: 'Ventas e ingresos', records: 'Citas y walk-in', people: 'Barberos y clientes' };
    let lastSection = kpiT ? 'summary' : null;
    tables.forEach(t => {
      if (t.section !== lastSection) {
        if (lastSection) { doc.addPage(); y = 20; }
        sectionTitle(sectionNames[t.section]);
        lastSection = t.section;
      }
      ensureSpace(24);
      doc.setTextColor(...INK); doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      doc.text(T(t.title + (t.rows.length ? '  (' + t.rows.length + ')' : '')), MX, y + 1);
      y += 3;
      const right = (c) => ['int', 'money', 'pct'].includes(c.type);
      const totalW = t.columns.reduce((x, c) => x + c.width, 0);
      const avail = PW - MX * 2;
      const columnStyles = {};
      t.columns.forEach((c, i) => { columnStyles[i] = { halign: right(c) ? 'right' : 'left', cellWidth: (c.width / totalW) * avail }; });
      const body = t.rows.length
        ? t.rows.map(r => t.columns.map(c => T(Reports.cellText(c, r, rep))))
        : [[{ content: 'Sin registros con los filtros aplicados.', colSpan: t.columns.length, styles: { fontStyle: 'italic', textColor: MUTED } }]];
      const foot = (t.totals && t.rows.length) ? [t.columns.map(c => T(Reports.cellText(c, Object.assign({ currency: rep.currency }, t.totals), rep)))] : undefined;
      doc.autoTable({
        startY: y + 1,
        margin: { left: MX, right: MX, top: 20, bottom: MB + 2 },
        head: [t.columns.map(c => T(c.label))],
        body, foot,
        showFoot: 'lastPage',
        theme: 'plain',
        styles: { font: 'helvetica', fontSize: 7.6, cellPadding: { top: 1.6, bottom: 1.6, left: 1.8, right: 1.8 }, textColor: INK, overflow: 'linebreak', lineColor: LINE },
        headStyles: { fillColor: P, textColor: W, fontStyle: 'bold', fontSize: 7.6 },
        footStyles: { fillColor: [238, 238, 241], textColor: INK, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 250] },
        bodyStyles: { lineWidth: { bottom: 0.1 } },
        columnStyles,
        didParseCell: (d) => {
          const c = t.columns[d.column.index];
          if (!c) return;
          if (d.section !== 'body' && (right(c) || c.type === 'auto' || c.type === 'delta')) d.cell.styles.halign = 'right';
          if (d.section === 'body' && t.rows.length && (c.type === 'auto' || c.type === 'delta')) {
            d.cell.styles.halign = 'right';
            if (c.type === 'delta') {
              const tone = Reports.deltaTone(t.rows[d.row.index]);
              if (tone !== 'flat') { d.cell.styles.textColor = tone === 'good' ? [21, 128, 61] : [185, 28, 28]; d.cell.styles.fontStyle = 'bold'; }
            }
          }
        }
      });
      y = doc.lastAutoTable.finalY + 9;
    });

    /* --- Pie y encabezado en todas las páginas --- */
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
      if (i > 1) {
        doc.setFillColor(...P); doc.rect(0, 0, PW, 3, 'F');
        doc.text(T(rep.meta.name + ' · ' + rep.meta.title), MX, 11);
        doc.text(T(rep.meta.filters[0][1]), PW - MX, 11, { align: 'right' });
      }
      doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(MX, PH - 10, PW - MX, PH - 10);
      doc.text(T('Generado por ' + rep.meta.generatedBy + ' · ' + rep.meta.generatedText), MX, PH - 6);
      doc.text('Página ' + i + ' de ' + pages, PW - MX, PH - 6, { align: 'right' });
    }

    const blob = doc.output('blob');
    const name = Reports.fileName(rep, 'pdf');
    this.download(blob, name);
    return { name, size: blob.size, pages };
  }
};
