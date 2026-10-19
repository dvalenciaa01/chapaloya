-- ==========================================================================
-- Reservalope · Migración 1/4 · Esquema de datos
-- --------------------------------------------------------------------------
-- Reemplaza la estructura que hoy vive en localStorage (js/data/db.js):
--   root.tenants          → public.tenants
--   root.users            → auth.users (Supabase Auth) + public.profiles
--   data[t].barberProfiles→ public.barbers + public.barber_works
--   data[t].services      → public.services
--   data[t].customers     → public.customers
--   data[t].appointments  → public.appointments
--   data[t].walkIns       → public.walk_ins
--   data[t].aiConsultations → public.ai_consultations (función oculta por ahora)
--   root.audit            → public.audit_log
-- Nuevo para WhatsApp: public.wa_sessions y public.wa_outbox.
--
-- Todas las tablas que dependen de una barbería llevan tenant_id y llaves
-- foráneas compuestas (tenant_id, id) para que un registro nunca pueda
-- apuntar a un barbero o servicio de OTRA barbería.
-- ==========================================================================

create schema if not exists private;
revoke all on schema private from public;

-- --------------------------------------------------------------------------
-- Utilidades
-- --------------------------------------------------------------------------
create or replace function private.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Configuración de WhatsApp que recibe cada barbería nueva (apagada por defecto).
-- Variables disponibles en las plantillas:
--   {cliente} {telefono} {servicio} {barbero} {fecha} {hora} {precio}
--   {barberia} {direccion} {codigo}
--   {cuando} → "hoy", "mañana" o "el lunes 19 de octubre", según el momento real del envío
create or replace function private.wa_default_config()
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'enabled', false,
    'notifyTo', '[]'::jsonb,
    'notifyGroupId', null,
    'notifyOn', jsonb_build_object('new', true, 'cancel', true, 'reschedule', true),
    'confirmationToClient', true,
    'templates', jsonb_build_object(
      'shopNew',        E'💈 Nueva reserva ({codigo})\n{cliente} · {telefono}\n{servicio} con {barbero}\n{fecha} a las {hora}',
      'shopCancel',     E'❌ Cita cancelada ({codigo})\n{cliente} · {servicio} con {barbero}\n{fecha} a las {hora}',
      'shopReschedule', E'🔁 Cita reprogramada ({codigo})\n{cliente} · {servicio} con {barbero}\nNueva fecha: {fecha} a las {hora}',
      'clientConfirm',  E'Hola {cliente}, tu cita en {barberia} quedó registrada:\n{servicio} con {barbero}\n{fecha} a las {hora}\nCódigo: {codigo}\n\nResponde 1 para confirmar o 2 para cancelar.'
    ),
    'reminders', jsonb_build_array(
      jsonb_build_object('id', 'r1', 'offsetMinutes', 1440, 'onlyIfNotConfirmed', false,
        'template', E'Hola {cliente}, te recordamos tu cita {cuando} a las {hora} con {barbero} en {barberia}. {direccion}\nResponde 1 para confirmar o 2 para cancelar.'),
      jsonb_build_object('id', 'r2', 'offsetMinutes', 120, 'onlyIfNotConfirmed', false,
        'template', E'{cliente}, tu cita es {cuando} a las {hora} con {barbero}. ¡Te esperamos en {barberia}!')
    ),
    'quietHours', jsonb_build_object('from', '21:00', 'to', '08:00')
  )
$$;

-- --------------------------------------------------------------------------
-- Barberías
-- --------------------------------------------------------------------------
create table public.tenants (
  id               uuid primary key default gen_random_uuid(),
  slug             text not null unique
                   check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) between 2 and 40),
  name             text not null check (length(name) between 2 and 80),
  owner_name       text not null default '',
  owner_email      text not null default '',
  owner_phone      text not null default '',
  logo_url         text,
  palette          jsonb not null default '{"primary":"#000000","secondary":"#D79848","tertiary":"#FFFFFF"}',
  address          text not null default '',
  phone            text not null default '',
  hours            text not null default 'Citas de 9:00 a 20:00',
  city             text not null default 'Lima, Perú',
  currency         text not null default 'S/',
  timezone         text not null default 'America/Lima',
  time_slots       time[] not null default
                   '{09:00,09:30,10:00,10:30,11:00,11:30,12:00,14:00,15:00,16:00,17:00,18:00,19:00,20:00}',
  plan             text not null default 'PRO' check (plan in ('BASICO', 'PRO', 'PREMIUM')),
  plan_fee         numeric(10,2) not null default 149 check (plan_fee >= 0),
  subscription_end date,
  status           text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUSPENDED')),
  whatsapp         jsonb not null default private.wa_default_config(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger tenants_updated before update on public.tenants
  for each row execute function private.touch_updated_at();

-- --------------------------------------------------------------------------
-- Barberos y portafolio
-- --------------------------------------------------------------------------
create table public.barbers (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  name        text not null check (length(name) between 1 and 60),
  role_title  text not null default '',
  photo_url   text,
  specialties text[] not null default '{}',
  active      boolean not null default true,   -- desactivar en vez de borrar
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (tenant_id, id)
);
create index barbers_tenant on public.barbers (tenant_id);
create trigger barbers_updated before update on public.barbers
  for each row execute function private.touch_updated_at();

create table public.barber_works (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  barber_id  uuid not null,
  title      text not null default '',
  image_url  text not null,
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, barber_id) references public.barbers (tenant_id, id) on delete cascade
);
create index barber_works_barber on public.barber_works (barber_id);

-- --------------------------------------------------------------------------
-- Usuarios (perfil de cada cuenta de Supabase Auth)
-- --------------------------------------------------------------------------
create table public.profiles (
  id                   uuid primary key references auth.users(id) on delete cascade,
  email                text not null,
  name                 text not null default '',
  role                 text not null check (role in ('SUPERADMIN', 'ADMIN', 'STAFF')),
  tenant_id            uuid references public.tenants(id) on delete restrict,
  barber_id            uuid,
  -- Módulos que el superadmin otorga a un ADMIN (igual que Auth.GRANTABLE)
  grants               jsonb not null default
                       '{"sales":true,"customers":true,"reports":true,"settings":true,"ai":false,"audit":true}',
  active               boolean not null default true,
  must_change_password boolean not null default true,
  last_login_at        timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  check ((role = 'SUPERADMIN') = (tenant_id is null)),
  check (role = 'STAFF' or barber_id is null),
  foreign key (tenant_id, barber_id) references public.barbers (tenant_id, id) on delete set null (barber_id)
);
create index profiles_tenant on public.profiles (tenant_id);
create trigger profiles_updated before update on public.profiles
  for each row execute function private.touch_updated_at();

-- --------------------------------------------------------------------------
-- Servicios
-- --------------------------------------------------------------------------
create table public.services (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null check (length(name) between 2 and 80),
  category     text not null default '',
  price        numeric(10,2) not null default 0 check (price >= 0),
  duration_min int not null default 30 check (duration_min between 5 and 480),
  description  text not null default '',
  featured     boolean not null default false,
  active       boolean not null default true,  -- false = oculto en la web (p. ej. asesoría IA)
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, id)
);
create index services_tenant on public.services (tenant_id);
create trigger services_updated before update on public.services
  for each row execute function private.touch_updated_at();

-- --------------------------------------------------------------------------
-- Clientes
-- --------------------------------------------------------------------------
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  name          text not null check (length(name) between 2 and 80),
  phone         text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  notes         text not null default '',
  wa_opt_out_at timestamptz,          -- el cliente escribió BAJA
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone)           -- varios clientes sin teléfono sí se permiten
);
create trigger customers_updated before update on public.customers
  for each row execute function private.touch_updated_at();

-- --------------------------------------------------------------------------
-- Citas
-- --------------------------------------------------------------------------
create table public.appointments (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  code          text not null,                  -- código corto para "Mi cita" (lo genera un trigger)
  customer_id   uuid,
  customer_name text not null check (length(customer_name) between 2 and 80),
  phone         text check (phone is null or phone ~ '^[0-9]{9,15}$'),
  service_id    uuid,
  service_name  text not null default '',       -- copia: el historial no cambia si se edita el servicio
  barber_id     uuid not null,
  barber_name   text not null default '',
  date          date not null,
  time          time not null,
  starts_at     timestamptz not null,           -- fecha + hora en la zona de la barbería (trigger)
  duration_min  int not null default 30,
  price         numeric(10,2) not null default 0 check (price >= 0),
  status        text not null default 'PROGRAMADA'
                check (status in ('PROGRAMADA', 'CONFIRMADA_WSP', 'COMPLETADA', 'CANCELADA', 'NO_ASISTIO')),
  source        text not null default 'CRM' check (source in ('WEB', 'CRM')),
  notes         text not null default '',
  wa_opt_in     boolean not null default false, -- aceptó recibir WhatsApp
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  completed_at  timestamptz,
  cancelled_at  timestamptz,
  unique (tenant_id, code),
  foreign key (tenant_id, barber_id)   references public.barbers (tenant_id, id)   on delete restrict,
  foreign key (tenant_id, service_id)  references public.services (tenant_id, id)  on delete set null (service_id),
  foreign key (tenant_id, customer_id) references public.customers (tenant_id, id) on delete set null (customer_id)
);
-- La base de datos rechaza la doble reserva aunque dos personas pulsen a la vez.
create unique index appointments_no_double_booking
  on public.appointments (barber_id, date, time) where status <> 'CANCELADA';
create index appointments_tenant_date on public.appointments (tenant_id, date);
create index appointments_tenant_phone on public.appointments (tenant_id, phone);

-- --------------------------------------------------------------------------
-- Cola walk-in
-- --------------------------------------------------------------------------
create table public.walk_ins (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  customer_name text not null check (length(customer_name) between 1 and 80),
  service_id    uuid,
  service_name  text not null default '',
  barber_id     uuid,
  barber_name   text not null default '',
  price         numeric(10,2) not null default 0 check (price >= 0),
  status        text not null default 'ESPERANDO' check (status in ('ESPERANDO', 'EN_SILLON', 'FINALIZADO')),
  date          date not null default ((now() at time zone 'America/Lima')::date),
  added_at      time not null default ((now() at time zone 'America/Lima')::time(0)),
  finished_at   timestamptz,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  foreign key (tenant_id, service_id) references public.services (tenant_id, id) on delete set null (service_id),
  foreign key (tenant_id, barber_id)  references public.barbers (tenant_id, id)  on delete set null (barber_id)
);
create index walk_ins_tenant_date on public.walk_ins (tenant_id, date);
create trigger walk_ins_updated before update on public.walk_ins
  for each row execute function private.touch_updated_at();

-- --------------------------------------------------------------------------
-- Asesoría IA (la función queda oculta en el lanzamiento; se guarda la tabla)
-- --------------------------------------------------------------------------
create table public.ai_consultations (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  date         date not null default ((now() at time zone 'America/Lima')::date),
  client_name  text not null default '',
  client_phone text,
  barber_name  text not null default '',
  data         jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index ai_consultations_tenant on public.ai_consultations (tenant_id, date);

-- --------------------------------------------------------------------------
-- Historial de actividad
-- --------------------------------------------------------------------------
create table public.audit_log (
  id        bigint generated always as identity primary key,
  ts        timestamptz not null default now(),
  tenant_id uuid references public.tenants(id) on delete set null,
  user_id   uuid,
  user_name text not null default 'Sistema',
  role      text not null default 'SYSTEM',
  action    text not null,
  detail    text not null default ''
);
create index audit_log_tenant_ts on public.audit_log (tenant_id, ts desc);

-- --------------------------------------------------------------------------
-- WhatsApp: estado de la sesión de cada barbería (lo escribe el bot)
-- --------------------------------------------------------------------------
create table public.wa_sessions (
  tenant_id        uuid primary key references public.tenants(id) on delete cascade,
  status           text not null default 'DISCONNECTED'
                   check (status in ('DISCONNECTED', 'WAITING_QR', 'CONNECTED', 'LOGGED_OUT')),
  phone            text,                 -- número vinculado
  qr               text,                 -- QR vigente para vincular (solo lo ve el admin)
  requested_action text check (requested_action in ('LINK', 'LOGOUT')),
  last_seen_at     timestamptz,          -- latido del bot
  last_error       text,
  updated_at       timestamptz not null default now()
);
create trigger wa_sessions_updated before update on public.wa_sessions
  for each row execute function private.touch_updated_at();

-- --------------------------------------------------------------------------
-- WhatsApp: cola de mensajes (la llena un trigger, la vacía el bot)
-- --------------------------------------------------------------------------
create table public.wa_outbox (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  appointment_id        uuid references public.appointments(id) on delete cascade,
  kind                  text not null check (kind in
                        ('SHOP_NEW', 'SHOP_CANCEL', 'SHOP_RESCHEDULE', 'CLIENT_CONFIRM', 'REMINDER', 'REPLY', 'TEST')),
  rule_id               text not null default '',   -- id del recordatorio o número/grupo destino
  recipient             text not null,              -- 51XXXXXXXXX o id de grupo (…@g.us)
  body                  text not null,
  send_at               timestamptz not null default now(),
  only_if_not_confirmed boolean not null default false,
  status                text not null default 'PENDING'
                        check (status in ('PENDING', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  attempts              int not null default 0,
  locked_at             timestamptz,
  last_error            text,
  sent_at               timestamptz,
  created_at            timestamptz not null default now()
);
-- Un mismo mensaje programado no se duplica mientras esté pendiente
create unique index wa_outbox_unique_pending
  on public.wa_outbox (appointment_id, kind, rule_id) where status = 'PENDING';
create index wa_outbox_due on public.wa_outbox (status, send_at);
create index wa_outbox_tenant on public.wa_outbox (tenant_id, created_at desc);
