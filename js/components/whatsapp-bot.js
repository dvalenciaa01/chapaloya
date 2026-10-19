/* ==========================================================================
   WhatsApp
   --------------------------------------------------------------------------
   La demo simulaba aquí un chat dentro de la página. En producción los
   mensajes reales los envía el bot (Fase 3) desde la cola public.wa_outbox,
   que llena la base de datos al crear, cancelar o reprogramar una cita.
   Este objeto se conserva para no romper las páginas que lo llaman, y
   retira el botón flotante de la simulación.
   ========================================================================== */
const WhatsAppBot = {
  init() {
    document.querySelectorAll('.wsp-float-btn, #wsp-modal').forEach(el => el.remove());
  },
  toggle() {},
  sendConfirmation() {},
  sendAIConsultationReport() {},
  reply() {},
  render() {}
};
