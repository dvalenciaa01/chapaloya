/* ==========================================================================
   Configuración pública de Reservalope
   --------------------------------------------------------------------------
   Estos valores SON públicos (se ven en el navegador). La seguridad la dan
   las reglas RLS de la base de datos, no estas claves.
   NUNCA pongas aquí la "Secret key" de Supabase ni la de Turnstile.
   ========================================================================== */
window.RESERVALOPE_CONFIG = {
  // Proyecto de PRUEBAS (reservalope-pruebas). Cambiar al de producción al lanzar.
  supabaseUrl: 'https://cdsstbykktdkhhxtcsnx.supabase.co',
  supabaseKey: 'sb_publishable_hqJty101OjD4pHM7S8WLnA_pdzq2L6O',

  // Cloudflare Turnstile (Fase 2). Vacío = sin captcha (solo pruebas).
  turnstileSiteKey: ''
};
