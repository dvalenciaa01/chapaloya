const WhatsAppBot = {
  messages: [],

  init() {
    const first = DB.state.appointments[0];
    if (first) this.sendConfirmation(first, false);
  },

  toggle() {
    const modal = document.getElementById('wsp-modal');
    if (modal) modal.classList.toggle('open');
  },

  sendConfirmation(appt, autoOpen = true) {
    const shop = (DB.tenant ? DB.tenant.name : 'Barbería').toUpperCase();
    const msgHtml = '<strong>💈 ' + shop + '</strong><br/>Hola <strong>' +
      appt.customerName + '</strong>, registramos tu cita para <strong>' +
      appt.service + '</strong> con <strong>' +
      appt.barber + '</strong> el <strong>' +
      appt.date + ' a las ' + appt.time + '</strong>.';

    this.messages.unshift({
      id: appt.id,
      type: 'CONFIRM',
      html: msgHtml
    });
    this.render();
    if (autoOpen) {
      const modal = document.getElementById('wsp-modal');
      if (modal) modal.classList.add('open');
    }
  },

  sendAIConsultationReport(record, chosenProposal) {
    const shop = (DB.tenant ? DB.tenant.name : 'Barbería').toUpperCase();
    const reportHtml = '<strong>🤖 FICHA DE ASESORÍA DE IMAGEN + IA · ' + shop + '</strong><br/>' +
      'Hola <strong>' + record.clientName + '</strong>, tu maestro barbero <strong>' +
      record.barberName + '</strong> ha registrado tu diseño ideal:<br/><br/>' +
      '🏆 <strong>Estilo Elegido:</strong> ' + chosenProposal.name + '<br/>' +
      '🎯 <strong>Compatibilidad Biométrica:</strong> ' + chosenProposal.match + '<br/>' +
      '🪒 <strong>Diseño de Barba:</strong> ' + chosenProposal.beardTech + '<br/>' +
      '🧴 <strong>Mantenimiento en casa:</strong> ' + chosenProposal.productRec;

    this.messages.unshift({
      id: record.id,
      type: 'AI_REPORT',
      html: reportHtml
    });
    this.render();
    const modal = document.getElementById('wsp-modal');
    if (modal) modal.classList.add('open');
  },

  reply(apptId, action) {
    const item = DB.state.appointments.find(a => a.id === apptId);
    if (item) {
      const before = item.status;
      item.status = action === 'OK' ? 'CONFIRMADA_WSP' : 'CANCELADA';
      DB.save();
      DB.log(action === 'OK' ? 'Cliente confirmó su cita' : 'Cliente canceló su cita',
        item.customerName + ' (' + item.date + ' ' + item.time + '): ' + DB.statusLabel(before) + ' → ' + DB.statusLabel(item.status),
        { actorName: item.customerName + ' (WhatsApp)', actorRole: 'PUBLIC' });
      if (typeof CRM !== 'undefined' && typeof CRM.renderAll === 'function') {
        CRM.renderAll();
      }
      if (typeof PublicBooking !== 'undefined' && typeof PublicBooking.renderPublicViews === 'function') {
        PublicBooking.renderPublicViews();
      }
    }
    this.messages.unshift({
      id: apptId,
      type: 'ACK',
      html: action === 'OK' ? '✅ Cita confirmada en el CRM.' : '❌ Cita cancelada.'
    });
    this.render();
  },

  render() {
    const badgeEl = document.getElementById('wsp-badge');
    const messagesEl = document.getElementById('wsp-messages');
    if (badgeEl) badgeEl.textContent = this.messages.length;
    if (!messagesEl) return;

    messagesEl.innerHTML = this.messages.map(m => {
      const actionsHtml = m.type === 'CONFIRM'
        ? '<div class="wsp-actions">' +
          '<button class="wsp-act-btn" onclick="WhatsAppBot.reply(\'' + m.id + '\',\'OK\')">Confirmar asistencia</button>' +
          '<button class="wsp-act-btn cancel" onclick="WhatsAppBot.reply(\'' + m.id + '\',\'CANCEL\')">Cancelar cita</button>' +
          '</div>'
        : '';
      return '<div class="wsp-msg">' + m.html + actionsHtml + '</div>';
    }).join('');
  }
};