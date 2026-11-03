-- ==========================================================================
-- Migración 18 · Configuración como módulo que el superadmin puede ocultar
-- --------------------------------------------------------------------------
-- Hasta ahora crm_config.modules.settings solo aceptaba true. Desde aquí
-- acepta true o false, igual que los demás módulos: con false la pestaña
-- Configuración del CRM desaparece para todo el equipo de ese negocio
-- (Horario y WhatsApp siguen visibles en su propia pestaña).
-- Solo cambia la validación private.crm_config_valida; ningún dato cambia.
-- Es repetible: se puede ejecutar más de una vez.
-- ==========================================================================

create or replace function private.crm_config_valida(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  modulos constant text[] := array['dashboard', 'appointments', 'walkin', 'customers', 'services',
                                   'staff', 'sales', 'reports', 'whatsapp', 'audit', 'settings'];
  campos constant jsonb := '{
    "appointments": ["phone", "notes", "price", "source"],
    "customers":    ["phone", "email", "birthdate", "document", "address", "notes"],
    "services":     ["category", "description", "duration", "featured"],
    "staff":        ["role", "photo", "bio", "gallery"]
  }';
  -- Campos estándar donde "required" tiene sentido
  con_requerido constant text[] := array['appointments.phone', 'customers.phone'];
  e record;
  f record;
  c record;
  o jsonb;
  claves text[];
  v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return false;
  end if;
  if exists (select 1 from jsonb_object_keys(p) k
             where k not in ('modules', 'fields', 'customFields', 'theme', 'lists', 'site')) then
    return false;
  end if;

  -- modules: { clave: bool }. Desde la migración 18, "settings" también se puede ocultar.
  if p ? 'modules' then
    v := p -> 'modules';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for e in select * from jsonb_each(v) loop
      if jsonb_typeof(e.value) <> 'boolean' then return false; end if;
      if not (e.key = any (modulos)) then
        return false;
      end if;
    end loop;
  end if;

  -- fields: { entidad: { campo: {show: bool, required?: bool} } }
  if p ? 'fields' then
    v := p -> 'fields';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for e in select * from jsonb_each(v) loop
      if not (campos ? e.key) or jsonb_typeof(e.value) <> 'object' then return false; end if;
      for f in select * from jsonb_each(e.value) loop
        if not ((campos -> e.key) ? f.key) or jsonb_typeof(f.value) <> 'object' then return false; end if;
        if exists (select 1 from jsonb_object_keys(f.value) k where k not in ('show', 'required')) then
          return false;
        end if;
        if not private.json_bool_o_nada(f.value -> 'show')
           or not private.json_bool_o_nada(f.value -> 'required') then
          return false;
        end if;
        if f.value ? 'required' and not ((e.key || '.' || f.key) = any (con_requerido)) then
          return false;
        end if;
      end loop;
    end loop;
  end if;

  -- customFields: { customers|appointments: [ {key,label,type,options?,required?,showInList?,public?} ] }
  if p ? 'customFields' then
    v := p -> 'customFields';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for e in select * from jsonb_each(v) loop
      if e.key not in ('customers', 'appointments') or jsonb_typeof(e.value) <> 'array' then
        return false;
      end if;
      if jsonb_array_length(e.value) > 12 then return false; end if;
      claves := array[]::text[];
      for c in select x.value as f from jsonb_array_elements(e.value) x loop
        if jsonb_typeof(c.f) <> 'object' then return false; end if;
        if exists (select 1 from jsonb_object_keys(c.f) k
                   where k not in ('key', 'label', 'type', 'options', 'required', 'showInList', 'public')) then
          return false;
        end if;
        if jsonb_typeof(c.f -> 'key') is distinct from 'string'
           or (c.f ->> 'key') !~ '^[a-z][a-z0-9_]{1,29}$'
           or (c.f ->> 'key') = any (claves) then
          return false;
        end if;
        claves := claves || (c.f ->> 'key');
        if not private.json_texto(c.f -> 'label', 40) then return false; end if;
        if jsonb_typeof(c.f -> 'type') is distinct from 'string'
           or (c.f ->> 'type') not in ('text', 'textarea', 'number', 'date', 'select', 'checkbox') then
          return false;
        end if;
        if c.f ->> 'type' = 'select' then
          o := c.f -> 'options';
          if o is null or jsonb_typeof(o) <> 'array' or jsonb_array_length(o) not between 1 and 20 then
            return false;
          end if;
          if exists (select 1 from jsonb_array_elements(o) x where not private.json_texto(x, 40, false)) then
            return false;
          end if;
        elsif c.f ? 'options' and jsonb_typeof(c.f -> 'options') <> 'null' then
          return false;                -- options solo en los de tipo select
        end if;
        if not private.json_bool_o_nada(c.f -> 'required')
           or not private.json_bool_o_nada(c.f -> 'showInList')
           or not private.json_bool_o_nada(c.f -> 'public') then
          return false;
        end if;
        if c.f ? 'public' and e.key <> 'appointments' then
          return false;                -- solo los campos de citas pueden pedirse en la web
        end if;
      end loop;
    end loop;
  end if;

  -- theme
  if p ? 'theme' then
    v := p -> 'theme';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v) k
               where k not in ('mode', 'primary', 'accent', 'font', 'density', 'radius', 'logoInNav')) then
      return false;
    end if;
    if (v ? 'mode' and (jsonb_typeof(v -> 'mode') <> 'string' or v ->> 'mode' not in ('dark', 'light', 'auto')))
       or (v ? 'font' and (jsonb_typeof(v -> 'font') <> 'string'
                           or v ->> 'font' not in ('barlow', 'inter', 'jakarta', 'system')))
       or (v ? 'density' and (jsonb_typeof(v -> 'density') <> 'string'
                              or v ->> 'density' not in ('comfortable', 'compact')))
       or (v ? 'radius' and (jsonb_typeof(v -> 'radius') <> 'string'
                             or v ->> 'radius' not in ('sharp', 'soft', 'round')))
       or not private.json_bool_o_nada(v -> 'logoInNav') then
      return false;
    end if;
    if (v ? 'primary' and jsonb_typeof(v -> 'primary') <> 'null'
        and (jsonb_typeof(v -> 'primary') <> 'string' or v ->> 'primary' !~ '^#[0-9A-Fa-f]{6}$'))
       or (v ? 'accent' and jsonb_typeof(v -> 'accent') <> 'null'
           and (jsonb_typeof(v -> 'accent') <> 'string' or v ->> 'accent' !~ '^#[0-9A-Fa-f]{6}$')) then
      return false;
    end if;
  end if;

  -- lists: { appointments: { columns: [...] } } → columnas de la tabla de
  -- citas, en orden; "x:<key>" = un campo propio de citas que exista
  if p ? 'lists' then
    v := p -> 'lists';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v) k where k <> 'appointments') then return false; end if;
    if v ? 'appointments' then
      o := v -> 'appointments';
      if jsonb_typeof(o) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_object_keys(o) k where k <> 'columns') then return false; end if;
      if o ? 'columns' then
        o := o -> 'columns';
        if jsonb_typeof(o) <> 'array' or jsonb_array_length(o) not between 1 and 12 then return false; end if;
        if exists (select 1 from jsonb_array_elements(o) x where jsonb_typeof(x) <> 'string') then
          return false;
        end if;
        if (select count(distinct x #>> '{}') <> count(*) from jsonb_array_elements(o) x) then
          return false;                -- columna repetida
        end if;
        if exists (
          select 1 from jsonb_array_elements_text(o) col
          where col not in ('date', 'time', 'client', 'phone', 'service', 'staff', 'price', 'status', 'source', 'notes')
            and not (col ~ '^x:[a-z][a-z0-9_]{1,29}$'
                     and jsonb_typeof(p #> '{customFields,appointments}') = 'array'
                     and exists (select 1 from jsonb_array_elements(p #> '{customFields,appointments}') cf
                                 where cf ->> 'key' = substr(col, 3)))) then
          return false;
        end if;
      end if;
    end if;
  end if;

  -- site: portada de la web pública (null = la de siempre)
  if p ? 'site' then
    v := p -> 'site';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(v) k where k not in ('heroTitle', 'heroSubtitle', 'heroImage')) then
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
  end if;

  return true;
end $$;

-- Portada de la web pública (crm_config.site), con las tres claves siempre
create or replace function private.site_publico(p_config jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'heroTitle', case when jsonb_typeof(p_config #> '{site,heroTitle}') = 'string' then p_config #> '{site,heroTitle}' end,
    'heroSubtitle', case when jsonb_typeof(p_config #> '{site,heroSubtitle}') = 'string' then p_config #> '{site,heroSubtitle}' end,
    'heroImage', case when jsonb_typeof(p_config #> '{site,heroImage}') = 'string' then p_config #> '{site,heroImage}' end)
$$;
