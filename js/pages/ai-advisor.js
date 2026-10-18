const AIAdvisor = {
  uploadedClientPhotos: [
    { id: 'ph-1', angle: 'Rostro Frontal + Barba', src: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80' },
    { id: 'ph-2', angle: 'Perfil Lateral Derecho', src: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80' },
    { id: 'ph-3', angle: 'Perfil Lateral Izquierdo', src: 'https://images.unsplash.com/photo-1621607512214-68297480165e?auto=format&fit=crop&w=600&q=80' }
  ],
  currentProposals: [],

  init() {
    this.populateHeaderSelectors();
    this.renderUploadedPhotos();

    try {
      const rawCtx = sessionStorage.getItem('GOLDEN_AI_CLIENT_CTX');
      if (rawCtx) {
        const ctx = JSON.parse(rawCtx);
        sessionStorage.removeItem('GOLDEN_AI_CLIENT_CTX');
        this.applyClientContext(ctx);
      }
    } catch (e) {}

    this.generate4Proposals(false);
    this.renderHistory();
  },

  applyClientContext(ctx) {
    if (!ctx) return;
    const nameInp = document.getElementById('ai-client-name');
    const phoneInp = document.getElementById('ai-client-phone');
    const barbSel = document.getElementById('ai-active-barber');
    if (nameInp && ctx.clientName) nameInp.value = ctx.clientName;
    if (phoneInp && ctx.phone) phoneInp.value = ctx.phone;
    if (barbSel && ctx.barberName && DB.assignableBarbers().includes(ctx.barberName)) barbSel.value = ctx.barberName;
  },

  populateHeaderSelectors() {
    const barbSel = document.getElementById('ai-active-barber');
    if (barbSel) {
      const cur = barbSel.value;
      const allowed = DB.assignableBarbers();
      barbSel.innerHTML = DB.state.barberProfiles.filter(bp => allowed.includes(bp.name)).map(bp =>
        '<option value="' + bp.name + '">' + bp.name + ' (' + bp.role + ')</option>'
      ).join('') || '<option value="">Aún no hay barberos registrados</option>';
      if (cur) barbSel.value = cur;
    }

    const cliSel = document.getElementById('ai-select-existing-client');
    if (cliSel) {
      const activeClients = [
        ...DB.visibleAppointments().filter(a => a.status !== 'CANCELADA').map(a => ({
          name: a.customerName,
          phone: a.phone || '',
          barber: a.barber,
          label: '[Cita ' + a.time + '] ' + a.customerName
        })),
        ...DB.state.walkIns.filter(w => w.status !== 'FINALIZADO').map(w => ({
          name: w.customerName,
          phone: '',
          barber: w.barber,
          label: '[Walk-In] ' + w.customerName
        }))
      ];
      cliSel.innerHTML = '<option value="">-- Seleccionar de citas/cola o escribir manual --</option>' +
        activeClients.map((c, idx) =>
          '<option value="' + idx + '" data-name="' + c.name + '" data-phone="' + c.phone + '" data-barber="' + c.barber + '">' + c.label + '</option>'
        ).join('');
    }
  },

  onSelectExistingClient(idx) {
    const sel = document.getElementById('ai-select-existing-client');
    const opt = sel.options[sel.selectedIndex];
    if (!opt || !opt.getAttribute('data-name')) return;
    document.getElementById('ai-client-name').value = opt.getAttribute('data-name');
    document.getElementById('ai-client-phone').value = opt.getAttribute('data-phone') || '987654321';
    const barb = opt.getAttribute('data-barber');
    if (barb) document.getElementById('ai-active-barber').value = barb;
  },

  openForClient(clientName, phone, barberName) {
    if (typeof CRM !== 'undefined') {
      CRM.switchTab('ai-advisor');
      this.applyClientContext({ clientName, phone, barberName });
      this.generate4Proposals(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      AppRouter.openAIAdvisorForClient(clientName, phone, barberName);
    }
  },

  async handleUploadFiles(event) {
    const files = Array.from(event.target.files || []);
    const angleTag = document.getElementById('ai-upload-angle-tag').value;
    for (let i = 0; i < files.length; i++) {
      const dataUrl = await readAndCompressImage(files[i], 720, 0.8);
      if (dataUrl) {
        this.uploadedClientPhotos.push({
          id: 'ph-' + Date.now() + '-' + i,
          angle: files.length > 1 ? (angleTag + ' (#' + (i + 1) + ')') : angleTag,
          src: dataUrl
        });
      }
    }
    event.target.value = '';
    this.renderUploadedPhotos();
  },

  removePhoto(photoId) {
    this.uploadedClientPhotos = this.uploadedClientPhotos.filter(p => p.id !== photoId);
    this.renderUploadedPhotos();
  },

  clearPhotos() {
    this.uploadedClientPhotos = [];
    this.renderUploadedPhotos();
  },

  loadSampleSession() {
    this.uploadedClientPhotos = [
      { id: 'ph-s1', angle: '1. Rostro Frontal + Barba', src: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80' },
      { id: 'ph-s2', angle: '2. Perfil Lateral Derecho', src: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80' },
      { id: 'ph-s3', angle: '3. Perfil Lateral Izquierdo', src: 'https://images.unsplash.com/photo-1621607512214-68297480165e?auto=format&fit=crop&w=600&q=80' },
      { id: 'ph-s4', angle: '4. Zona Superior / Coronilla', src: 'https://images.unsplash.com/photo-1517832607067-4db24a2ae47c?auto=format&fit=crop&w=600&q=80' }
    ];
    this.renderUploadedPhotos();
    this.generate4Proposals(true);
  },

  renderUploadedPhotos() {
    const counterEl = document.getElementById('ai-photo-counter');
    if (counterEl) counterEl.textContent = this.uploadedClientPhotos.length;
    const grid = document.getElementById('ai-client-photos-grid');
    if (!grid) return;

    if (this.uploadedClientPhotos.length === 0) {
      grid.innerHTML = '<p style="grid-column: 1 / -1; color:var(--text-grey);">No hay fotos cargadas. Sube las fotos del cliente arriba para activar el escáner biométrico.</p>';
      return;
    }

    grid.innerHTML = this.uploadedClientPhotos.map(p =>
      '<div class="ai-client-photo-slot">' +
        '<img src="' + p.src + '" alt="' + p.angle + '" />' +
        '<div class="biometric-overlay" title="Malla de proporciones craneales y mandibulares"></div>' +
        '<button type="button" class="crm-work-thumb-del" onclick="AIAdvisor.removePhoto(\'' + p.id + '\')" title="Quitar foto" aria-label="Quitar foto">' + ic('x') + '</button>' +
        '<div class="ai-photo-angle-tag">' +
          '<span>' + ic('scan') + ' ' + p.angle + '</span>' +
          '<span>IA OK</span>' +
        '</div>' +
      '</div>'
    ).join('');
  },

  generate4Proposals(scrollToResults = true) {
    const clientName = document.getElementById('ai-client-name')?.value.trim() || 'Cliente';
    const barberName = document.getElementById('ai-active-barber')?.value || 'Carlos';

    const vibe = document.getElementById('q-style-vibe')?.value || 'URBANO_MODERNO';
    const topLen = document.getElementById('q-top-length')?.value || 'MEDIO_PEINABLE';
    const sideFade = document.getElementById('q-side-fade')?.value || 'MID_FADE';
    const faceShape = document.getElementById('q-face-shape')?.value || 'OVALADO';
    const hairType = document.getElementById('q-hair-type')?.value || 'ONDULADO';
    const issues = document.getElementById('q-hair-issues')?.value || 'NINGUNA';
    const beardStyle = document.getElementById('q-beard-style')?.value || 'BARBA_MEDIA_CONECTADA';
    const maintenance = document.getElementById('q-maintenance')?.value || 'MEDIO_3_MIN';
    const finish = document.getElementById('q-finish')?.value || 'MATE_NATURAL';
    const customNotes = document.getElementById('q-custom-notes')?.value.trim() || '';

    const hasBeard = beardStyle !== 'SIN_BARBA';
    const primaryClientPhoto = this.uploadedClientPhotos[0]?.src || 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80';

    const faceAdviceMap = {
      OVALADO: 'Sus proporciones craneales equilibradas permiten lucir tanto degradados limpios como volúmenes estructurados sin perder simetría.',
      REDONDO: 'Para estilizar y alargar visualmente sus facciones, comprimimos los laterales con el degradado y proyectamos altura en la zona frontal.',
      CUADRADO: 'Potenciamos su línea mandibular masculina suavizando las esquinas parietales con una transición progresiva.',
      DIAMANTE: 'Equilibramos el ancho de los pómulos manteniendo textura controlada en la zona superior y densidad estratégica en patillas.',
      ALARGADO: 'Evitamos exceso de altura vertical y aportamos estructura en los contornos para armonizar el largo del rostro.'
    };

    const beardPlanMap = {
      BARBA_MEDIA_CONECTADA: {
        badge: 'CON BARBA MEDIA CONECTADA',
        tech: 'Degradado inverso en patilla (peine #1.5 a #3 hacia el mentón), línea de mejilla alta perfilada a navaja libre y ángulo mandibular a 95°.',
        benefit: 'Define el maxilar inferior y conecta de forma imperceptible con el corte lateral.'
      },
      BARBA_3_DIAS: {
        badge: 'CON BARBA DE 3 DÍAS PERFILADA',
        tech: 'Rebaje uniforme con trimmer #1 (3 mm), desconexión limpia en patilla y marcación nítida en cuello (2 dedos sobre la nuez) con toalla caliente.',
        benefit: 'Aporta sombra masculina en el tercio inferior sin recargar las facciones.'
      },
      BARBA_LARGA_ESCULPIDA: {
        badge: 'CON BARBA ESCULPIDA EN V',
        tech: 'Esculpido a mano alzada y tijera: laterales comprimidos con peine #2 y elongación progresiva en el mentón, finalizando con bálsamo y aceite.',
        benefit: 'Alarga y proyecta el mentón creando una silueta imponente y simétrica.'
      },
      CANDADO_BIGOTE: {
        badge: 'CON BIGOTE & PERILLA MARCADA',
        tech: 'Afeitado Royal al ras en mejillas con doble toalla caliente, perfilando bigote y perilla simétrica a navaja.',
        benefit: 'Centra la atención en el eje vertical del rostro y despeja los pómulos.'
      },
      SIN_BARBA: {
        badge: 'AFEITADO ROYAL AL RAS (SIN BARBA)',
        tech: 'Ritual de afeitado completo con espuma tibia y navaja libre, acentuando el contorno limpio de las patillas.',
        benefit: 'Resalta la limpieza del corte y rejuvenece las facciones faciales.'
      }
    };

    const beardInfo = beardPlanMap[beardStyle] || beardPlanMap.BARBA_MEDIA_CONECTADA;

    const topLengthMap = {
      MEDIO_PEINABLE: { cm: '4.5 a 6 cm', styleDesc: 'longitud media con movimiento natural' },
      CORTO_TEXTURIZADO: { cm: '2 a 3 cm', styleDesc: 'longitud corta de bajo mantenimiento y alta textura' },
      MANTENER_LARGO: { cm: 'Largo actual saneado (-1 cm)', styleDesc: 'conservación de largo con despunte de estructura' },
      MUY_CORTO_BUZZ: { cm: '1 a 1.5 cm (#3 o #4)', styleDesc: 'contorno milimétrico ultra limpio' }
    };
    const topInfo = topLengthMap[topLen] || topLengthMap.MEDIO_PEINABLE;

    const issueFixMap = {
      NINGUNA: 'Coronilla y línea frontal trabajadas con simetría estándar.',
      ENTRADAS: 'Flequillo texturizado proyectado ligeramente hacia adelante para camuflar las entradas de forma natural.',
      FRENTE_AMPLIA: 'Caída frontal controlada para equilibrar el tercio superior del rostro.',
      REMOLINO: 'Zona de coronilla trabajada con 1.5 cm extra de peso a tijera para evitar que el remolino se levante.',
      POCA_DENSIDAD: 'Texturizado interno en seco con polvo voluminizador para generar efecto de mayor densidad capilar.'
    };

    this.currentProposals = [
      {
        id: 'prop-1',
        match: '98% MATCH FACIAL',
        name: '1. ' + sideFade.replace('_', ' ') + ' ESTRUCTURADO + ' + (hasBeard ? beardInfo.badge : 'CONTORNO LIMPIO'),
        refImg: 'https://images.unsplash.com/photo-1622286342621-4bd786c2447c?auto=format&fit=crop&w=600&q=80',
        clientImg: primaryClientPhoto,
        visagismoWhy: faceAdviceMap[faceShape] + ' ' + issueFixMap[issues],
        haircutTech: 'Superior en ' + topInfo.cm + ' (' + topInfo.styleDesc + ') trabajado con tijera de entresacar. Laterales en ' + sideFade.replace('_', ' ') + ' pulido con máquina de #0.5 a #2.',
        beardTech: beardInfo.tech,
        productRec: finish === 'MATE_NATURAL' ? 'Polvo Texturizador + Cera Mate Arcilla (Mantenimiento: ' + maintenance.replace(/_/g, ' ') + ')' : 'Pomada Semimate + Aceite de Cedro para Barba'
      },
      {
        id: 'prop-2',
        match: '95% MATCH FACIAL',
        name: '2. FRENCH CROP / TEXTURA FRONTAL + ' + (hasBeard ? beardInfo.badge : 'PERFILADO A NAVAJA'),
        refImg: 'https://images.unsplash.com/photo-1599351431202-1e0f0137899a?auto=format&fit=crop&w=600&q=80',
        clientImg: primaryClientPhoto,
        visagismoWhy: 'Ideal para cabello ' + hairType.toLowerCase().replace('_', ' ') + '. Enmarca las facciones superiores con textura dirigida hacia adelante y resalta la mirada.',
        haircutTech: 'Largo superior controlado (' + topInfo.cm + ') con técnica Point-Cutting en seco. Compresión lateral en Drop Fade cayendo detrás del lóbulo.',
        beardTech: hasBeard ? (beardInfo.tech + ' (' + beardInfo.benefit + ')') : 'Limpieza de cuello y patillas en ángulo geométrico con gel de afeitado transparente.',
        productRec: 'Cera Mate en Pasta + Spray de Sal Marina'
      },
      {
        id: 'prop-3',
        match: '93% MATCH FACIAL',
        name: '3. QUIFF EJECUTIVO / VOLUMEN CONTEMPORÁNEO + ' + (hasBeard ? beardInfo.badge : 'ACABADO SARTORIAL'),
        refImg: 'https://images.unsplash.com/photo-1503951914875-452162b0f3f1?auto=format&fit=crop&w=600&q=80',
        clientImg: primaryClientPhoto,
        visagismoWhy: 'Proyecta una imagen ' + vibe.toLowerCase().replace('_', ' ') + ' estilizando el eje vertical del rostro ' + faceShape.toLowerCase() + '.',
        haircutTech: 'Zona frontal ligeramente más larga (' + topInfo.cm + ') conectada a tijera sobre peine en la zona parietal para evitar escalones.',
        beardTech: hasBeard ? ('Conexión progresiva en patillas + ' + beardInfo.tech) : 'Afeitado clásico con doble compresa caliente y aftershave balsámico.',
        productRec: 'Pomada Ejecutiva de Fijación Fuerte + Bálsamo Hidratante de Barba'
      },
      {
        id: 'prop-4',
        match: '91% MATCH FACIAL',
        name: '4. TAPER / DEGRADADO PROGRESIVO DE AUTOR + ' + (hasBeard ? beardInfo.badge : 'CONTORNO NATURAL'),
        refImg: 'https://images.unsplash.com/photo-1621607512214-68297480165e?auto=format&fit=crop&w=600&q=80',
        clientImg: primaryClientPhoto,
        visagismoWhy: 'Mantiene oscuridad estratégica en los contornos laterales para dar máxima armonía a sus facciones y un crecimiento limpio durante 3 semanas.',
        haircutTech: 'Desvanecido concentrado en sienes y nuca respetando la caída natural del cabello (' + topInfo.cm + ' arriba).',
        beardTech: beardInfo.tech,
        productRec: 'Crema de Peinado Texturizante + Tónico Refrescante'
      }
    ];

    const headlineEl = document.getElementById('ai-results-headline');
    if (headlineEl) {
      headlineEl.textContent = '4 CORTES + BARBA RECOMENDADOS POR IA PARA ' + clientName.toUpperCase();
    }

    const bannerEl = document.getElementById('ai-biometric-diagnosis-banner');
    if (bannerEl) {
      const notesLine = customNotes ? ('<br/><em>Nota del cliente: "' + customNotes + '"</em>') : '';
      bannerEl.innerHTML = '<div style="display:flex; justify-content:space-between; flex-wrap:wrap; gap:10px;">' +
        '<div>' +
          '<strong style="color:var(--golden);">RESUMEN DEL ESCANEO FACIAL Y CUESTIONARIO</strong><br/>' +
          'Cliente: <strong>' + clientName + '</strong> &nbsp;|&nbsp; ' +
          'Barbero Asignado: <strong>' + barberName + '</strong> &nbsp;|&nbsp; ' +
          'Rostro Detectado: <strong style="color:var(--golden);">' + faceShape + '</strong> &nbsp;|&nbsp; ' +
          'Cabello: <strong>' + hairType.replace('_',' ') + '</strong> &nbsp;|&nbsp; ' +
          'Largo Pedido: <strong>' + topInfo.cm + '</strong> &nbsp;|&nbsp; ' +
          'Proyecto de Barba: <strong style="color:var(--yellow);">' + beardInfo.badge + '</strong>' +
          notesLine +
        '</div>' +
        '<div style="text-align:right;">' +
          '<span style="font-size:0.75rem; color:var(--text-grey);">Fotos analizadas: <strong>' + this.uploadedClientPhotos.length + ' ángulo(s)</strong></span>' +
        '</div>' +
      '</div>';
    }

    const gridEl = document.getElementById('ai-4-proposals-grid');
    if (gridEl) {
      gridEl.innerHTML = this.currentProposals.map((p, idx) =>
        '<div class="ai-proposal-card" id="ai-card-' + p.id + '">' +
          '<div>' +
            '<div class="ai-proposal-visual-header">' +
              '<div class="ai-visual-pane">' +
                '<img src="' + p.clientImg + '" alt="Foto del Cliente" />' +
                '<span class="ai-visual-tag">' + ic('camera') + 'Facciones del cliente</span>' +
                '<div class="biometric-overlay" style="margin:12px;"></div>' +
              '</div>' +
              '<div class="ai-visual-pane" style="border-right:none;">' +
                '<img src="' + p.refImg + '" alt="' + p.name + '" />' +
                '<span class="ai-visual-tag">' + ic('sparkles') + 'Proyección corte + barba</span>' +
              '</div>' +
              '<div class="ai-match-badge">' + p.match + '</div>' +
            '</div>' +
            '<div class="ai-proposal-body">' +
              '<h3 style="font-size:1.12rem; color:var(--golden); margin-bottom:8px;">' + p.name + '</h3>' +
              '<p style="font-size:0.8rem; line-height:1.55; color:var(--text-light); margin-bottom:10px;">' +
                '<strong>¿Por qué favorece a sus facciones?:</strong> ' + p.visagismoWhy +
              '</p>' +
              '<div class="ai-tech-box">' +
                '<div><strong>' + ic('scissors') + 'Técnica de cabello:</strong> ' + p.haircutTech + '</div>' +
                '<div style="margin-top:6px;"><strong>' + ic('user') + 'Integración de barba:</strong> ' + p.beardTech + '</div>' +
                '<div style="margin-top:6px; color:var(--golden);"><strong>' + ic('droplet') + 'Styling / mantenimiento:</strong> ' + p.productRec + '</div>' +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div style="padding: 0 20px 20px; display:flex; gap:8px; flex-wrap:wrap;">' +
            '<button type="button" class="btn-golden" style="flex:1;" onclick="AIAdvisor.selectWinningProposal(' + idx + ')">' +
              ic('check') + 'Elegir y enviar ficha por WhatsApp' +
            '</button>' +
          '</div>' +
        '</div>'
      ).join('');
    }

    if (scrollToResults) {
      const containerEl = document.getElementById('ai-results-container');
      if (containerEl) containerEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  },

  selectWinningProposal(idx) {
    const chosen = this.currentProposals[idx];
    if (!chosen) return;

    const clientName = document.getElementById('ai-client-name').value.trim() || 'Cliente';
    const clientPhone = document.getElementById('ai-client-phone').value.trim() || '987654321';
    const barberName = document.getElementById('ai-active-barber').value || DB.assignableBarbers()[0] || 'Barbero';

    document.querySelectorAll('.ai-proposal-card').forEach(c => c.classList.remove('selected-winner'));
    const cardEl = document.getElementById('ai-card-' + chosen.id);
    if (cardEl) cardEl.classList.add('selected-winner');

    const record = {
      id: 'ai-' + Date.now(),
      date: DB.todayISO(),
      time: DB.nowTimeStr(),
      clientName,
      clientPhone,
      barberName,
      chosenStyle: chosen.name,
      match: chosen.match,
      beardTech: chosen.beardTech
    };

    DB.state.aiConsultations.unshift(record);
    DB.ensureCustomer(clientName, clientPhone, '[Asesoría IA con ' + barberName + ']: Eligió ' + chosen.name);
    DB.save();

    this.renderHistory();
    if (typeof CRM !== 'undefined') CRM.renderCustomers();

    WhatsAppBot.sendAIConsultationReport(record, chosen);
  },

  renderHistory() {
    const listEl = document.getElementById('ai-saved-history-list');
    if (!listEl) return;
    const list = DB.state.aiConsultations || [];

    if (!list.length) {
      listEl.innerHTML = '<p>Aún no se ha guardado ninguna selección. Haz clic en "Elegir y enviar ficha" en cualquiera de las 4 propuestas arriba.</p>';
      return;
    }

    listEl.innerHTML = list.slice(0, 30).map(item =>
      '<div class="crm-list-item">' +
        '<div>' +
          '<strong style="color:var(--golden);">' + item.clientName + '</strong> (' + item.clientPhone + ') — Atendido por <strong>' + item.barberName + '</strong><br/>' +
          '<span style="font-size:0.8rem; color:var(--text-light);">Corte + Barba Elegido: <strong>' + item.chosenStyle + '</strong></span>' +
        '</div>' +
        '<span class="st-badge st-CONFIRMADA_WSP">' + item.match + ' • ' + item.date + '</span>' +
      '</div>'
    ).join('');
  }
};