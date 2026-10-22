-- ==========================================================================
-- Reservalope · Migración 12 · CRM personalizable (por negocio)
-- --------------------------------------------------------------------------
-- El superadministrador decide, para cada negocio, qué módulos y campos ve
-- el CRM, agrega campos propios a clientes y citas y elige la apariencia.
-- Todo vive en tenants.crm_config ('{}' = el CRM como hasta ahora).
-- Se puede ejecutar sobre una base con datos y volver a ejecutar sin romper
-- nada.
--
--   1. tenants.crm_config y su validación (private.crm_config_valida):
--      modules, fields, customFields, theme, lists (columnas de la tabla
--      de citas) y site (portada de la web pública)
--   2. tenants_guard: solo el superadmin (o el servidor) cambia crm_config
--   3. Clientes: email, fecha de nacimiento, documento, dirección y extra
--   4. Citas: extra (campos propios; el personal también puede cambiarlos)
--   5. web_barberia devuelve booking_fields (campos propios públicos) y
--      site (portada de la web: título, subtítulo e imagen)
--   6. crear_reserva(..., p_extra) valida y guarda los campos públicos
--   7. Permisos de las funciones
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Configuración del CRM
-- --------------------------------------------------------------------------
alter table public.tenants add column if not exists crm_config jsonb not null default '{}'::jsonb;

-- ¿Es un booleano de JSON? (null de SQL = la clave no está = vale)
create or replace function private.json_bool_o_nada(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or jsonb_typeof(p) = 'boolean'
$$;

-- Texto de 1..max caracteres, no vacío, opcionalmente sin < > "
create or replace function private.json_texto(p jsonb, p_max int, p_sin_html boolean default true)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null
     and jsonb_typeof(p) = 'string'
     and char_length(p #>> '{}') between 1 and p_max
     and btrim(p #>> '{}') <> ''
     and (not p_sin_html or (p #>> '{}') !~ '[<>"]')
$$;

-- Forma completa de crm_config (ver README y js/core/crm-config.js).
-- Todas las claves son opcionales; las desconocidas se rechazan.
create or replace function private.crm_config_valida(p jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  modulos constant text[] := array['dashboard', 'appointments', 'walkin', 'customers', 'services',
                                   'staff', 'sales', 'reports', 'whatsapp', 'audit'];
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

  -- modules: { clave: bool }. "settings" no se puede ocultar (solo true).
  if p ? 'modules' then
    v := p -> 'modules';
    if jsonb_typeof(v) <> 'object' then return false; end if;
    for e in select * from jsonb_each(v) loop
      if jsonb_typeof(e.value) <> 'boolean' then return false; end if;
      if e.key = 'settings' then
        if e.value <> 'true'::jsonb then return false; end if;
      elsif not (e.key = any (modulos)) then
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

alter table public.tenants drop constraint if exists tenants_crm_config_valid;
alter table public.tenants add constraint tenants_crm_config_valid check (private.crm_config_valida(crm_config));

comment on column public.tenants.crm_config is
  'Personalización del CRM (módulos, campos, campos propios y tema). Solo la cambia el superadministrador. Ver js/core/crm-config.js.';

-- --------------------------------------------------------------------------
-- 2. Candado de columnas de tenants (reemplaza el de la migración 11)
-- --------------------------------------------------------------------------
create or replace function private.tenants_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_superadmin() then
    return new;                      -- servidor (secret key) o superadmin
  end if;
  if new.slug is distinct from old.slug
     or new.plan is distinct from old.plan
     or new.plan_fee is distinct from old.plan_fee
     or new.subscription_end is distinct from old.subscription_end
     or new.status is distinct from old.status
     or new.owner_email is distinct from old.owner_email then
    raise exception 'Solo el superadministrador puede cambiar enlace, plan, vencimiento, estado o correo del dueño.'
      using errcode = '42501';
  end if;
  if new.crm_config is distinct from old.crm_config then
    raise exception 'Solo el superadministrador puede personalizar el CRM.' using errcode = '42501';
  end if;
  if (new.business_type is distinct from old.business_type or new.labels is distinct from old.labels)
     and not (private.my_role() = 'ADMIN' and private.has_grant('settings')
              and old.id = private.my_tenant()) then
    raise exception 'Solo un administrador con el módulo Configuración puede cambiar el rubro y las palabras del negocio.'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------------
-- 3 y 4. Campos de clientes y campos propios (extra)
-- --------------------------------------------------------------------------
-- extra: objeto de hasta 8 KB; claves como las de customFields; valores
-- texto (≤ 500 caracteres), número o verdadero/falso.
create or replace function private.extra_valido(p jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select p is not null
     and jsonb_typeof(p) = 'object'
     and octet_length(p::text) <= 8192
     and not exists (
       select 1 from jsonb_each(p) e
       where e.key !~ '^[a-z][a-z0-9_]{1,29}$'
          or jsonb_typeof(e.value) not in ('string', 'number', 'boolean')
          or (jsonb_typeof(e.value) = 'string' and char_length(e.value #>> '{}') > 500))
$$;

alter table public.customers add column if not exists email text;
alter table public.customers add column if not exists birthdate date;
alter table public.customers add column if not exists document text;
alter table public.customers add column if not exists address text;
alter table public.customers add column if not exists extra jsonb not null default '{}'::jsonb;
alter table public.appointments add column if not exists extra jsonb not null default '{}'::jsonb;

alter table public.customers drop constraint if exists customers_email_valid;
alter table public.customers add constraint customers_email_valid check (
  email is null or (char_length(email) <= 120 and email ~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$'));
alter table public.customers drop constraint if exists customers_birthdate_valid;
alter table public.customers add constraint customers_birthdate_valid check (
  birthdate is null or birthdate >= date '1900-01-01');
alter table public.customers drop constraint if exists customers_document_valid;
alter table public.customers add constraint customers_document_valid check (
  document is null or document ~ '^[A-Za-z0-9-]{1,20}$');
alter table public.customers drop constraint if exists customers_address_valid;
alter table public.customers add constraint customers_address_valid check (
  address is null or char_length(address) <= 160);
alter table public.customers drop constraint if exists customers_extra_valid;
alter table public.customers add constraint customers_extra_valid check (private.extra_valido(extra));
alter table public.appointments drop constraint if exists appointments_extra_valid;
alter table public.appointments add constraint appointments_extra_valid check (private.extra_valido(extra));

comment on column public.customers.email is 'Correo del cliente (opcional, hasta 120 caracteres).';
comment on column public.customers.birthdate is 'Fecha de nacimiento (opcional).';
comment on column public.customers.document is 'DNI, CE o RUC (opcional, hasta 20 letras, números o guiones).';
comment on column public.customers.address is 'Dirección (opcional, hasta 160 caracteres).';
comment on column public.customers.extra is 'Campos propios del cliente (crm_config.customFields.customers).';
comment on column public.appointments.extra is 'Campos propios de la cita (crm_config.customFields.appointments). El personal también los cambia.';

-- El personal (STAFF) puede cambiar appointments.extra: es información
-- clínica u operativa. El candado de appointments_before bloquea columnas
-- concretas y extra no está entre ellas; aquí solo se actualiza el mensaje
-- (repetible: si la frase ya no está, no hace nada).
do $$
declare
  f constant regprocedure := 'private.appointments_before()'::regprocedure;
  def text := pg_get_functiondef(f);
  nuevo text;
begin
  nuevo := replace(def, 'El personal solo puede cambiar el estado, las notas y la fecha u hora de la cita.',
                        'El personal solo puede cambiar el estado, las notas, los datos propios y la fecha u hora de la cita.');
  if nuevo <> def then
    execute nuevo;
  end if;
end $$;

-- --------------------------------------------------------------------------
-- 5. Web pública: campos propios de la cita que se piden al reservar
-- --------------------------------------------------------------------------
-- Solo los marcados public:true y solo key, label, type, options y required.
create or replace function private.booking_fields(p_config jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'key', f ->> 'key',
           'label', f ->> 'label',
           'type', f ->> 'type',
           'options', case when f ->> 'type' = 'select' then f -> 'options' else '[]'::jsonb end,
           'required', coalesce((f ->> 'required')::boolean, false))
           order by n), '[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(p_config #> '{customFields,appointments}') = 'array'
                                 then p_config #> '{customFields,appointments}' else '[]'::jsonb end)
       with ordinality as x(f, n)
  where f ->> 'public' = 'true'
$$;

create or replace function public.web_barberia(p_slug text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'wa_enabled', private.wa_activo(t.whatsapp),
    'accepting', private.tenant_accepting(t),
    'lead_minutes', t.booking_lead_minutes,
    'timezone', t.timezone,
    'server_now', now(),
    'business_type', t.business_type,
    'labels', t.labels,
    'booking_fields', private.booking_fields(t.crm_config),
    'site', private.site_publico(t.crm_config),
    'tenant', jsonb_build_object(
      'id', t.id, 'slug', t.slug, 'name', t.name, 'logo_url', t.logo_url, 'palette', t.palette,
      'address', t.address, 'phone', t.phone, 'hours', t.hours, 'city', t.city,
      'currency', t.currency, 'timezone', t.timezone, 'schedule', t.schedule,
      'time_slots', (select coalesce(jsonb_agg(to_char(x, 'HH24:MI') order by x), '[]'::jsonb)
                     from unnest(t.time_slots) x),
      'wa_enabled', private.wa_activo(t.whatsapp),
      'server_now', now(),
      'lead_minutes', t.booking_lead_minutes,
      'accepting', private.tenant_accepting(t),
      'business_type', t.business_type,
      'labels', t.labels,
      'site', private.site_publico(t.crm_config)
    ),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'name', s.name, 'category', s.category, 'price', s.price,
                   'duration_min', s.duration_min, 'description', s.description, 'featured', s.featured)
                   order by s.featured desc, s.sort, s.name), '[]'::jsonb)
                 from public.services s where s.tenant_id = t.id and s.active),
    'barbers', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', b.id, 'name', b.name, 'role_title', b.role_title, 'photo_url', b.photo_url,
                   'specialties', to_jsonb(b.specialties), 'schedule', b.schedule,
                   'in_chair', exists (select 1 from public.walk_ins w
                                       where w.barber_id = b.id and w.status = 'EN_SILLON'
                                         and w.date = (now() at time zone t.timezone)::date),
                   'works', (select coalesce(jsonb_agg(jsonb_build_object(
                               'id', wk.id, 'title', wk.title, 'image_url', wk.image_url)
                               order by wk.sort, wk.created_at), '[]'::jsonb)
                             from public.barber_works wk where wk.barber_id = b.id))
                   order by b.sort, b.name), '[]'::jsonb)
                from public.barbers b where b.tenant_id = t.id and b.active),
    'exceptions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', e.id, 'barber_id', e.barber_id, 'date', e.date, 'ranges', e.ranges)
                     order by e.date), '[]'::jsonb)
                   from public.schedule_exceptions e
                   where e.tenant_id = t.id
                     and e.date >= (now() at time zone t.timezone)::date
                     and e.date <= (now() at time zone t.timezone)::date
                                   + coalesce((t.schedule ->> 'maxDays')::int, 60))
  )
  from public.tenants t
  where t.slug = lower(p_slug)
$$;

-- --------------------------------------------------------------------------
-- 6. Reservas web con campos propios
-- --------------------------------------------------------------------------
-- Valida los datos propios que manda la web contra booking_fields y
-- devuelve el objeto limpio que se guarda en appointments.extra:
--   · solo claves de campos públicos; los obligatorios deben venir
--   · text/textarea: texto ≤ 500 (se recortan espacios; vacío = no vino)
--   · number: número (o texto con un número)   · date: AAAA-MM-DD válida
--   · select: una de las opciones              · checkbox: true/false
--     (un checkbox obligatorio debe venir marcado)
create or replace function private.extra_reserva(p_config jsonb, p_extra jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  campos jsonb := private.booking_fields(p_config);
  f jsonb;
  e record;
  v jsonb;
  s text;
  d date;
  v_out jsonb := '{}'::jsonb;
begin
  if p_extra is null or jsonb_typeof(p_extra) = 'null' then
    p_extra := '{}'::jsonb;
  end if;
  if jsonb_typeof(p_extra) <> 'object' then
    raise exception 'Revisa los datos de tu reserva e inténtalo de nuevo.' using errcode = '22023';
  end if;
  for e in select * from jsonb_each(p_extra) loop
    if not exists (select 1 from jsonb_array_elements(campos) x where x ->> 'key' = e.key) then
      raise exception 'Este formulario cambió. Recarga la página e inténtalo de nuevo.' using errcode = '22023';
    end if;
  end loop;

  for f in select x from jsonb_array_elements(campos) x loop
    v := p_extra -> (f ->> 'key');
    if v is not null and jsonb_typeof(v) = 'string' then
      s := btrim(v #>> '{}');
      v := case when s = '' then null else to_jsonb(s) end;
    elsif v is not null and jsonb_typeof(v) = 'null' then
      v := null;
    end if;

    if v is null then
      if (f ->> 'required')::boolean then
        raise exception '% "%".', case when f ->> 'type' = 'checkbox' then 'Marca' else 'Completa' end,
          f ->> 'label' using errcode = '22023';
      end if;
      continue;
    end if;

    case f ->> 'type'
      when 'text', 'textarea' then
        if jsonb_typeof(v) <> 'string' then
          raise exception 'Revisa "%".', f ->> 'label' using errcode = '22023';
        end if;
        if char_length(v #>> '{}') > 500 then
          raise exception '"%" no puede pasar de 500 caracteres.', f ->> 'label' using errcode = '22023';
        end if;
      when 'number' then
        if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^-?[0-9]{1,15}([.,][0-9]{1,6})?$' then
          v := to_jsonb(replace(v #>> '{}', ',', '.')::numeric);
        end if;
        if jsonb_typeof(v) <> 'number' then
          raise exception '"%" debe ser un número.', f ->> 'label' using errcode = '22023';
        end if;
      when 'date' then
        d := null;
        if jsonb_typeof(v) = 'string' and (v #>> '{}') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
          begin
            d := (v #>> '{}')::date;
          exception when others then
            d := null;
          end;
        end if;
        if d is null or to_char(d, 'YYYY-MM-DD') <> (v #>> '{}') then
          raise exception '"%" debe ser una fecha válida.', f ->> 'label' using errcode = '22023';
        end if;
      when 'select' then
        if jsonb_typeof(v) <> 'string' or not ((f -> 'options') @> jsonb_build_array(v)) then
          raise exception 'Elige una opción de "%".', f ->> 'label' using errcode = '22023';
        end if;
      when 'checkbox' then
        if jsonb_typeof(v) <> 'boolean' then
          raise exception 'Revisa "%".', f ->> 'label' using errcode = '22023';
        end if;
        if v = 'false'::jsonb and (f ->> 'required')::boolean then
          raise exception 'Marca "%".', f ->> 'label' using errcode = '22023';
        end if;
      else
        raise exception 'Revisa los datos de tu reserva e inténtalo de nuevo.' using errcode = '22023';
    end case;
    v_out := v_out || jsonb_build_object(f ->> 'key', v);
  end loop;
  return v_out;
end $$;

-- La firma cambia (p_extra al final): se quita la anterior para que no haya
-- dos versiones de crear_reserva.
drop function if exists public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean);

-- Crear reserva. Solo la Edge Function "reservar" (secret key).
create or replace function public.crear_reserva(
  p_slug text, p_service_id uuid, p_barber_id uuid, p_date date, p_time time,
  p_name text, p_phone text, p_notes text default '', p_wa_opt_in boolean default false,
  p_extra jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.tenants;
  s public.services;
  v_phone text := private.norm_phone(p_phone);
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
  v_notes text := btrim(coalesce(p_notes, ''));
  v_extra jsonb;
  v_start timestamptz;
  v_customer uuid;
  a public.appointments;
begin
  select * into t from public.tenants where slug = lower(btrim(coalesce(p_slug, '')));
  if t.id is null then
    raise exception 'Este negocio no está disponible.' using errcode = '22023';
  end if;
  if not private.tenant_accepting(t) then
    raise exception 'Este negocio no está recibiendo reservas en línea por ahora.' using errcode = '22023';
  end if;
  if p_service_id is null then
    raise exception 'Elige un servicio.' using errcode = '22023';
  end if;
  select * into s from public.services where id = p_service_id and tenant_id = t.id and active;
  if s.id is null then
    raise exception 'Ese servicio no está disponible.' using errcode = '22023';
  end if;
  if p_barber_id is null then
    raise exception 'Elige un profesional.' using errcode = '22023';
  end if;
  if p_date is null or p_time is null then
    raise exception 'Elige la fecha y la hora de tu cita.' using errcode = '22023';
  end if;
  if length(v_name) < 2 or length(v_name) > 80 then
    raise exception 'Tu nombre debe tener entre 2 y 80 letras.' using errcode = '22023';
  end if;
  if v_phone !~ '^9[0-9]{8}$' then
    raise exception 'El celular debe tener 9 dígitos y empezar con 9.' using errcode = '22023';
  end if;
  if length(v_notes) > 300 then
    raise exception 'Las notas no pueden pasar de 300 caracteres.' using errcode = '22023';
  end if;
  v_extra := private.extra_reserva(t.crm_config, p_extra);
  v_start := (p_date + p_time) at time zone t.timezone;
  if v_start > now() and v_start < now() + make_interval(mins => t.booking_lead_minutes) then
    raise exception 'Reserva con al menos % minutos de anticipación. Elige una hora más tarde.',
      t.booking_lead_minutes using errcode = '22023';
  end if;

  -- A5 · Máximo 2 citas futuras vigentes por celular en este negocio
  perform pg_advisory_xact_lock(hashtextextended('reservalope.cel:' || t.id::text || ':' || v_phone, 0));
  if (select count(*) from public.appointments x
      where x.tenant_id = t.id and x.phone = v_phone
        and x.status in ('PROGRAMADA', 'CONFIRMADA_WSP') and x.starts_at > now()) >= 2 then
    raise exception 'Ya tienes 2 citas pendientes con nosotros. Para otra, escríbenos.' using errcode = '22023';
  end if;

  -- A5 · La web nunca renombra al cliente ni anula su baja de WhatsApp
  insert into public.customers (tenant_id, name, phone) values (t.id, v_name, v_phone)
  on conflict (tenant_id, phone) do nothing
  returning id into v_customer;
  if v_customer is null then
    select id into v_customer from public.customers where tenant_id = t.id and phone = v_phone;
  end if;

  begin
    insert into public.appointments (tenant_id, customer_id, customer_name, phone, service_id, barber_id,
                                     date, time, status, source, notes, wa_opt_in, extra)
    values (t.id, v_customer, v_name, v_phone, s.id, p_barber_id,
            p_date, p_time, 'PROGRAMADA', 'WEB',
            coalesce(nullif(v_notes, ''), 'Reserva desde la web'), coalesce(p_wa_opt_in, false), v_extra)
    returning * into a;
  exception
    when unique_violation then
      raise exception 'Ese horario acaba de ser tomado. Elige otro.' using errcode = '23505';
    when check_violation or not_null_violation or string_data_right_truncation
         or invalid_text_representation or foreign_key_violation then
      raise exception 'Revisa los datos de tu reserva e inténtalo de nuevo.' using errcode = '22023';
  end;

  insert into public.audit_log (tenant_id, user_name, role, action, detail)
  values (t.id, v_name || ' (web)', 'PUBLIC', 'Reserva desde la web',
          a.service_name || ' · ' || a.barber_name || ' · ' || a.date || ' ' || to_char(a.time, 'HH24:MI'));

  return jsonb_build_object('id', a.id, 'code', a.code, 'date', a.date, 'time', to_char(a.time, 'HH24:MI'),
                            'service', a.service_name, 'barber', a.barber_name);
end $$;

-- --------------------------------------------------------------------------
-- 7. Permisos de las funciones (Supabase da EXECUTE a anon por defecto)
-- --------------------------------------------------------------------------
revoke all on function private.json_bool_o_nada(jsonb) from public;
revoke all on function private.json_texto(jsonb, int, boolean) from public;
revoke all on function private.crm_config_valida(jsonb) from public;
revoke all on function private.extra_valido(jsonb) from public;
revoke all on function private.booking_fields(jsonb) from public;
revoke all on function private.site_publico(jsonb) from public;
revoke all on function private.extra_reserva(jsonb, jsonb) from public;
grant execute on function private.json_bool_o_nada(jsonb) to authenticated, service_role;
grant execute on function private.json_texto(jsonb, int, boolean) to authenticated, service_role;
grant execute on function private.crm_config_valida(jsonb) to authenticated, service_role;
grant execute on function private.extra_valido(jsonb) to authenticated, service_role;
grant execute on function private.booking_fields(jsonb) to authenticated, service_role;
grant execute on function private.site_publico(jsonb) to authenticated, service_role;
grant execute on function private.extra_reserva(jsonb, jsonb) to service_role;

revoke all on function public.web_barberia(text) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
revoke all on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb)
  from public, anon, authenticated;
grant execute on function public.crear_reserva(text, uuid, uuid, date, time, text, text, text, boolean, jsonb)
  to service_role;
