-- ==========================================================================
-- Reservalope · Migración 14 · Vista de citas del CRM
-- --------------------------------------------------------------------------
-- Cada negocio elige cómo ve la pestaña Citas del CRM:
--   'agenda' → agenda del día con una columna por profesional (por defecto)
--   'lista'  → la tabla con filtros de siempre
-- La cambia el administrador con el módulo Configuración (la política
-- tenants_update ya lo limita a él y al superadmin). No toca datos.
-- Se puede ejecutar sobre una base con datos y volver a ejecutar.
-- ==========================================================================

alter table public.tenants add column if not exists appt_view text not null default 'agenda';

alter table public.tenants drop constraint if exists tenants_appt_view_valid;
alter table public.tenants add constraint tenants_appt_view_valid check (appt_view in ('agenda', 'lista'));

comment on column public.tenants.appt_view is
  'Vista de la pestaña Citas del CRM: agenda (columnas por profesional) o lista (tabla). La elige el negocio en Configuración.';
