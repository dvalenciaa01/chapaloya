-- ==========================================================================
-- Migración 21 · Constructor visual de la web (página de inicio por bloques)
-- --------------------------------------------------------------------------
-- tenants.web_page  { blocks: [ {id, type, show, style, bg, ...textos} ] }
--   El Inicio de la web se arma con bloques (portada, servicios, equipo,
--   galería, ventajas, llamado a reservar, contacto y texto con foto).
--   Los bloques NO copian datos del CRM: los de servicios, equipo y galería
--   solo dicen cómo mostrarlos y la web los lee en vivo de web_barberia.
--   null = la web de siempre (nada cambia hasta que alguien guarde un diseño).
-- tenants.web_editor  (verdadero/falso, por defecto verdadero)
--   Si el negocio puede diseñar su propia web desde su CRM. Lo decide solo
--   el superadministrador (consola → Negocios → Diseñar web).
--
-- Quién cambia web_page: el superadministrador, o el ADMIN del negocio con
-- el permiso Configuración (como el resto de los datos del negocio) cuando
-- web_editor está activo.
-- web_barberia devuelve "page" para que la web dibuje los bloques.
--
-- Solo agrega dos columnas y cambia funciones; ningún dato cambia.
-- Se puede ejecutar más de una vez.
-- ==========================================================================

alter table public.tenants add column if not exists web_page jsonb;
alter table public.tenants add column if not exists web_editor boolean not null default true;

comment on column public.tenants.web_page is
  'Diseño por bloques del Inicio de la web (constructor visual). null = diseño de siempre. Ver js/core/site-blocks.js.';
comment on column public.tenants.web_editor is
  'Si el ADMIN del negocio puede diseñar su web. Solo lo cambia el superadministrador.';

-- --------------------------------------------------------------------------
-- 1. Validación de web_page
-- --------------------------------------------------------------------------
-- Texto opcional: null o una cadena de hasta p_max caracteres
create or replace function private.web_txt(p jsonb, p_max int)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or jsonb_typeof(p) = 'null'
      or (jsonb_typeof(p) = 'string' and char_length(p #>> '{}') <= p_max)
$$;

create or replace function private.web_page_valida(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  estilos constant jsonb := '{
    "portada":   ["foto-fondo", "foto-lado", "centrado"],
    "servicios": ["tarjetas", "lista"],
    "equipo":    ["tarjetas", "circulos"],
    "galeria":   ["cuadricula", "mosaico"],
    "ventajas":  ["columnas", "lista"],
    "reservar":  ["franja", "tarjeta"],
    "contacto":  ["columnas", "tarjeta"],
    "texto":     ["foto-izquierda", "foto-derecha", "solo-texto"]
  }';
  b jsonb;
  it jsonb;
  ids text[] := array[]::text[];
begin
  if v is null or jsonb_typeof(v) = 'null' then return true; end if;
  if jsonb_typeof(v) <> 'object' or octet_length(v::text) > 65536 then return false; end if;
  if exists (select 1 from jsonb_object_keys(v) k where k <> 'blocks') then return false; end if;
  if jsonb_typeof(v -> 'blocks') is distinct from 'array' or jsonb_array_length(v -> 'blocks') > 24 then
    return false;
  end if;

  for b in select x from jsonb_array_elements(v -> 'blocks') x loop
    if jsonb_typeof(b) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(b) k
               where k not in ('id', 'type', 'show', 'style', 'bg', 'eyebrow', 'title', 'text',
                               'image', 'btn', 'btn2', 'cat', 'limit', 'map', 'items')) then
      return false;
    end if;
    -- id único (lo pone el editor) y tipo conocido
    if jsonb_typeof(b -> 'id') is distinct from 'string' or (b ->> 'id') !~ '^[a-z0-9]{4,16}$'
       or (b ->> 'id') = any (ids) then
      return false;
    end if;
    ids := ids || (b ->> 'id');
    if jsonb_typeof(b -> 'type') is distinct from 'string' or not (estilos ? (b ->> 'type')) then
      return false;
    end if;
    if not private.json_bool_o_nada(b -> 'show') or not private.json_bool_o_nada(b -> 'map') then
      return false;
    end if;
    if b ? 'style' and jsonb_typeof(b -> 'style') <> 'null'
       and (jsonb_typeof(b -> 'style') <> 'string' or not ((estilos -> (b ->> 'type')) ? (b ->> 'style'))) then
      return false;
    end if;
    if b ? 'bg' and jsonb_typeof(b -> 'bg') <> 'null'
       and (jsonb_typeof(b -> 'bg') <> 'string' or (b ->> 'bg') not in ('normal', 'suave', 'marca')) then
      return false;
    end if;
    -- Textos (la web los muestra siempre escapados)
    if not private.web_txt(b -> 'eyebrow', 60) or not private.web_txt(b -> 'title', 120)
       or not private.web_txt(b -> 'text', 1500) or not private.web_txt(b -> 'btn', 30)
       or not private.web_txt(b -> 'btn2', 30) or not private.web_txt(b -> 'cat', 40) then
      return false;
    end if;
    -- Foto: solo enlaces https sin caracteres que rompan el HTML
    if b ? 'image' and jsonb_typeof(b -> 'image') <> 'null'
       and (jsonb_typeof(b -> 'image') <> 'string' or char_length(b ->> 'image') > 1000
            or (b ->> 'image') !~ '^https://[^[:space:]"''<>()\\]+$') then
      return false;
    end if;
    if b ? 'limit' and jsonb_typeof(b -> 'limit') <> 'null'
       and (jsonb_typeof(b -> 'limit') <> 'number' or (b ->> 'limit') !~ '^[0-9]+$'
            or (b ->> 'limit')::int not between 1 and 24) then
      return false;
    end if;
    -- items: puntos del bloque de ventajas (hasta 6)
    if b ? 'items' and jsonb_typeof(b -> 'items') <> 'null' then
      if jsonb_typeof(b -> 'items') <> 'array' or jsonb_array_length(b -> 'items') > 6 then return false; end if;
      for it in select x from jsonb_array_elements(b -> 'items') x loop
        if jsonb_typeof(it) <> 'object'
           or exists (select 1 from jsonb_object_keys(it) k where k not in ('icon', 'title', 'text'))
           or not private.web_txt(it -> 'title', 60) or not private.web_txt(it -> 'text', 240)
           or (it ? 'icon' and jsonb_typeof(it -> 'icon') <> 'null'
               and (jsonb_typeof(it -> 'icon') <> 'string' or (it ->> 'icon') !~ '^[A-Za-z]{1,24}$')) then
          return false;
        end if;
      end loop;
    end if;
  end loop;

  -- Una sola portada
  if (select count(*) from jsonb_array_elements(v -> 'blocks') x where x ->> 'type' = 'portada') > 1 then
    return false;
  end if;
  return true;
end $$;

alter table public.tenants drop constraint if exists tenants_web_page_valida;
alter table public.tenants add constraint tenants_web_page_valida check (private.web_page_valida(web_page));

-- --------------------------------------------------------------------------
-- 2. Candado de columnas de tenants (igual que en la 12, más web_page y web_editor)
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
  if new.web_editor is distinct from old.web_editor then
    raise exception 'Solo el superadministrador decide si el negocio puede diseñar su web.' using errcode = '42501';
  end if;
  if new.web_page is distinct from old.web_page
     and not (old.web_editor and private.my_role() = 'ADMIN' and private.has_grant('settings')
              and old.id = private.my_tenant()) then
    raise exception 'El diseño de la web solo lo cambia el superadministrador o un administrador del negocio con Configuración (si el superadministrador lo permite).'
      using errcode = '42501';
  end if;
  return new;
end $$;

-- --------------------------------------------------------------------------
-- 3. La web recibe el diseño (igual que en la 20, más "page")
-- --------------------------------------------------------------------------
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
    'page', t.web_page,
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
      'site', private.site_publico(t.crm_config),
      'page', t.web_page
    ),
    'services', (select coalesce(jsonb_agg(jsonb_build_object(
                   'id', s.id, 'name', s.name, 'category', s.category, 'price', s.price,
                   'duration_min', s.duration_min, 'description', s.description, 'featured', s.featured,
                   'image_url', s.image_url)
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
-- 4. Permisos
-- --------------------------------------------------------------------------
revoke all on function private.web_txt(jsonb, int) from public;
grant execute on function private.web_txt(jsonb, int) to authenticated, service_role;
revoke all on function private.web_page_valida(jsonb) from public;
grant execute on function private.web_page_valida(jsonb) to authenticated, service_role;
revoke all on function public.web_barberia(text) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
