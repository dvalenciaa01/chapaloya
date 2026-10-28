-- ==========================================================================
-- Reservalope · Migración 15 · Preferencias del CRM que elige el negocio
-- --------------------------------------------------------------------------
-- tenants.crm_prefs: lo que el administrador del negocio decide sobre cómo se
-- ve su CRM (a diferencia de crm_config, que solo cambia el superadmin).
-- Por ahora:
--   dashboard.cards: tarjetas y secciones visibles en el Panel principal
--                    (lista de claves; sin dato = las de siempre)
-- La cambia el administrador con el módulo Configuración (la política
-- tenants_update ya lo limita a él y al superadmin). No toca datos.
-- Se puede ejecutar sobre una base con datos y volver a ejecutar.
-- ==========================================================================

alter table public.tenants add column if not exists crm_prefs jsonb not null default '{}'::jsonb;

-- Objeto de hasta 4 KB; dashboard.cards, si está, es una lista de claves cortas
create or replace function private.crm_prefs_validas(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and octet_length(p::text) <= 4096
     and (p -> 'dashboard' is null or jsonb_typeof(p -> 'dashboard') = 'object')
     and (p #> '{dashboard,cards}' is null or (
           jsonb_typeof(p #> '{dashboard,cards}') = 'array'
           and not exists (
             select 1 from jsonb_array_elements(p #> '{dashboard,cards}') e
             where jsonb_typeof(e) <> 'string' or (e #>> '{}') !~ '^[a-z][a-z0-9_]{1,29}$')))
$$;

alter table public.tenants drop constraint if exists tenants_crm_prefs_valid;
alter table public.tenants add constraint tenants_crm_prefs_valid check (private.crm_prefs_validas(crm_prefs));

revoke all on function private.crm_prefs_validas(jsonb) from public;
grant execute on function private.crm_prefs_validas(jsonb) to authenticated, service_role;

comment on column public.tenants.crm_prefs is
  'Preferencias del CRM que elige el administrador del negocio (por ahora dashboard.cards). Ver js/pages/crm.js (DASH_ITEMS).';
