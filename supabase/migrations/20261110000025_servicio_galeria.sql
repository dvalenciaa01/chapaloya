-- ==========================================================================
-- 25 · Más fotos y videos por servicio
-- --------------------------------------------------------------------------
-- Además de la foto principal (image_url, migración 20), cada servicio puede
-- tener hasta 12 fotos o videos más (services.media), que se suben desde
-- CRM → Servicios al bucket media. En la web se ven con "Ver fotos y videos"
-- en la tarjeta del servicio. Videos: MP4 o WebM subidos (el bucket los
-- acepta desde la migración 22).
--   media [ { type: image | video, url: https://… } ]
-- web_barberia (versión de la 21) devuelve services[].media.
-- Requiere las migraciones 20 y 22. Se puede ejecutar más de una vez.
-- ==========================================================================

create or replace function private.servicio_media_valida(v jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select v is null or (
    jsonb_typeof(v) = 'array' and jsonb_array_length(v) <= 12
    and not exists (
      select 1 from jsonb_array_elements(v) x
      where jsonb_typeof(x) <> 'object'
         or exists (select 1 from jsonb_object_keys(x) k where k not in ('type', 'url'))
         or jsonb_typeof(x -> 'type') is distinct from 'string' or (x ->> 'type') not in ('image', 'video')
         or jsonb_typeof(x -> 'url') is distinct from 'string' or char_length(x ->> 'url') > 1000
         or (x ->> 'url') !~ '^https://[^[:space:]"''<>()\\]+$'))
$$;

alter table public.services add column if not exists media jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'services_media_valida'
                 and conrelid = 'public.services'::regclass) then
    alter table public.services add constraint services_media_valida check (private.servicio_media_valida(media));
  end if;
end $$;

-- Igual que en la migración 21, más media en cada servicio
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
                   'image_url', s.image_url, 'media', s.media)
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

revoke all on function private.servicio_media_valida(jsonb) from public;
grant execute on function private.servicio_media_valida(jsonb) to authenticated, service_role;
revoke all on function public.web_barberia(text) from public;
grant execute on function public.web_barberia(text) to anon, authenticated;
