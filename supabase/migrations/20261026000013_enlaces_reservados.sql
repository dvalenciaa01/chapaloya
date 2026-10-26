-- ==========================================================================
-- 13 · Enlaces reservados
-- --------------------------------------------------------------------------
-- Con direcciones limpias (reservalope.com/<enlace> y reservalope.com/crm/<enlace>,
-- ver _redirects) el enlace de un negocio no puede coincidir con una ruta del
-- sitio. Misma lista que Routes.RESERVED en js/core/routes.js.
-- Si algún negocio ya usa uno de estos enlaces, la migración falla: cámbialo
-- antes desde la consola.
-- ==========================================================================

alter table public.tenants
  add constraint tenants_slug_no_reservado
  check (slug <> all (array[
    'admin', 'api', 'assets', 'barberos', 'bot', 'consultar-cita', 'crm', 'css', 'docs', 'index',
    'ingresar', 'js', 'landing', 'login', 'privacidad', 'reservalope', 'reservar', 'servicios', 'supabase', 'www'
  ]::text[]));
