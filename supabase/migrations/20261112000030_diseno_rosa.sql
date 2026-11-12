-- ==========================================================================
-- Reservalope · Migración 30 · Diseño "rosa" de la web
-- --------------------------------------------------------------------------
-- crm_config.site.layout acepta un valor nuevo:
--   'rosa'   diseño de salón de uñas en rosa, negro y blanco, con letra con
--            serifa (barra superior con ciudad, horario y teléfono, servicios
--            en tarjetas con ícono, franja negra para reservar, franja rosa
--            "Visítanos" y pie oscuro). Se basa en el diseño boutique.
-- Se elige en Reservalope → negocio → Personalizar CRM → Web → Diseño.
-- Solo cambia la validación private.web_site_valida (igual que en la 19, con
-- 'rosa' permitido); ningún dato cambia. Es repetible.
-- ==========================================================================

create or replace function private.web_site_valida(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  tipos constant text[] := array['inicio', 'servicios', 'equipo', 'galeria', 'mi-cita', 'reservar'];
  s jsonb;
begin
  if v is null or jsonb_typeof(v) = 'null' then return true; end if;
  if jsonb_typeof(v) <> 'object' then return false; end if;
  if exists (select 1 from jsonb_object_keys(v) k
             where k not in ('heroTitle', 'heroSubtitle', 'heroImage', 'layout', 'sections')) then
    return false;
  end if;
  if (v ? 'heroTitle' and jsonb_typeof(v -> 'heroTitle') <> 'null' and not private.json_texto(v -> 'heroTitle', 80))
     or (v ? 'heroSubtitle' and jsonb_typeof(v -> 'heroSubtitle') <> 'null'
         and not private.json_texto(v -> 'heroSubtitle', 200))
     or (v ? 'heroImage' and jsonb_typeof(v -> 'heroImage') <> 'null'
         and (jsonb_typeof(v -> 'heroImage') <> 'string'
              or char_length(v ->> 'heroImage') > 500
              or (v ->> 'heroImage') !~ '^https://[A-Za-z0-9.-]+(:[0-9]+)?/[^\s<>"''\\]*$')) then
    return false;
  end if;

  if v ? 'layout' and jsonb_typeof(v -> 'layout') <> 'null'
     and (jsonb_typeof(v -> 'layout') <> 'string' or v ->> 'layout' not in ('clasico', 'boutique', 'rosa')) then
    return false;
  end if;

  if v ? 'sections' and jsonb_typeof(v -> 'sections') <> 'null' then
    s := v -> 'sections';
    if jsonb_typeof(s) <> 'array' or jsonb_array_length(s) not between 2 and 10 then return false; end if;
    if exists (
      select 1 from jsonb_array_elements(s) x
      where jsonb_typeof(x) <> 'object'
         or exists (select 1 from jsonb_object_keys(x) k where k not in ('type', 'label', 'show', 'cat'))
         or jsonb_typeof(x -> 'type') is distinct from 'string'
         or not ((x ->> 'type') = any (tipos))
         or not private.json_texto(x -> 'label', 30)
         or not private.json_bool_o_nada(x -> 'show')
         or ((x ->> 'type') in ('inicio', 'reservar') and (x -> 'show') = 'false'::jsonb)
         or (x ? 'cat' and jsonb_typeof(x -> 'cat') <> 'null'
             and ((x ->> 'type') <> 'servicios' or not private.json_texto(x -> 'cat', 40)))) then
      return false;
    end if;
    -- Una de cada tipo (servicios: hasta 4) e Inicio y Reservar obligatorias
    if exists (select 1 from unnest(tipos) t
               where (select count(*) from jsonb_array_elements(s) x where x ->> 'type' = t)
                     > case when t = 'servicios' then 4 else 1 end) then
      return false;
    end if;
    if not exists (select 1 from jsonb_array_elements(s) x where x ->> 'type' = 'inicio')
       or not exists (select 1 from jsonb_array_elements(s) x where x ->> 'type' = 'reservar') then
      return false;
    end if;
    -- Secciones de servicios con categorías distintas (sin categoría = todas)
    if (select count(distinct lower(btrim(coalesce(x ->> 'cat', '')))) <> count(*)
        from jsonb_array_elements(s) x where x ->> 'type' = 'servicios') then
      return false;
    end if;
  end if;

  return true;
end $$;

revoke all on function private.web_site_valida(jsonb) from public;
grant execute on function private.web_site_valida(jsonb) to authenticated, service_role;
