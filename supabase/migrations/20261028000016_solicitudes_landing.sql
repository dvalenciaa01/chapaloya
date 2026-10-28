-- ==========================================================================
-- Reservalope · Migración 16 · Solicitudes de prueba de la landing
-- --------------------------------------------------------------------------
-- El formulario "Solicitar prueba" de reservalope.com sigue enviando el
-- correo con FormSubmit y, además, guarda la solicitud aquí para verla en la
-- consola del superadministrador (/admin → Solicitudes).
--   public.solicitudes          una fila por solicitud, con su estado
--                               (NUEVA → CONTACTADA → CERRADA) y una nota
--   public.registrar_solicitud  la única forma de crear una desde la web
--                               (anon): valida los datos y limita el envío
--                               repetido o masivo
-- Solo el superadministrador lee, cambia o borra solicitudes (RLS).
-- No toca datos. Se puede ejecutar sobre una base con datos y volver a
-- ejecutar.
-- ==========================================================================

create table if not exists public.solicitudes (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  nombre     text not null check (char_length(nombre) between 2 and 80),
  negocio    text not null check (char_length(negocio) between 2 and 120),
  rubro      text not null default '' check (char_length(rubro) <= 60),
  celular    text not null check (celular ~ '^9[0-9]{8}$'),
  email      text not null check (char_length(email) <= 160 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  origen     text not null default 'landing' check (origen in ('landing')),
  estado     text not null default 'NUEVA' check (estado in ('NUEVA', 'CONTACTADA', 'CERRADA')),
  nota       text not null default '' check (char_length(nota) <= 1000)
);

create index if not exists solicitudes_created_at_idx on public.solicitudes (created_at desc);
create index if not exists solicitudes_celular_idx on public.solicitudes (celular, created_at desc);

alter table public.solicitudes enable row level security;

drop policy if exists solicitudes_select on public.solicitudes;
create policy solicitudes_select on public.solicitudes for select to authenticated
  using ((select private.is_superadmin()));
drop policy if exists solicitudes_update on public.solicitudes;
create policy solicitudes_update on public.solicitudes for update to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));
drop policy if exists solicitudes_delete on public.solicitudes;
create policy solicitudes_delete on public.solicitudes for delete to authenticated
  using ((select private.is_superadmin()));

-- Desde la consola solo se cambian estado y nota; los datos del formulario no
revoke all on public.solicitudes from anon, authenticated;
grant select, delete on public.solicitudes to authenticated;
grant update (estado, nota) on public.solicitudes to authenticated;
grant all on public.solicitudes to service_role;

create or replace function private.solicitudes_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists solicitudes_touch on public.solicitudes;
create trigger solicitudes_touch before update on public.solicitudes
  for each row execute function private.solicitudes_touch();

-- Guarda una solicitud de la landing. Devuelve true si la guardó y false si
-- era repetida (mismo celular o correo en los últimos 10 minutos: el
-- visitante que vuelve a pulsar Enviar). Rechaza datos inválidos, más de 3
-- solicitudes del mismo celular en un día y más de 60 en una hora en total.
create or replace function public.registrar_solicitud(
  p_nombre text, p_negocio text, p_rubro text, p_celular text, p_email text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_nombre  text := btrim(coalesce(p_nombre, ''));
  v_negocio text := btrim(coalesce(p_negocio, ''));
  v_rubro   text := left(btrim(coalesce(p_rubro, '')), 60);
  v_celular text := regexp_replace(coalesce(p_celular, ''), '[^0-9]', '', 'g');
  v_email   text := lower(btrim(coalesce(p_email, '')));
begin
  if char_length(v_celular) = 11 and left(v_celular, 2) = '51' then
    v_celular := substr(v_celular, 3);
  end if;
  if char_length(v_nombre) not between 2 and 80 then
    raise exception 'Escribe tu nombre.' using errcode = '22023';
  end if;
  if char_length(v_negocio) not between 2 and 120 then
    raise exception 'Escribe el nombre de tu negocio.' using errcode = '22023';
  end if;
  if v_celular !~ '^9[0-9]{8}$' then
    raise exception 'Escribe un celular peruano de 9 dígitos que empiece con 9.' using errcode = '22023';
  end if;
  if char_length(v_email) > 160 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Escribe un correo válido.' using errcode = '22023';
  end if;

  if exists (select 1 from public.solicitudes s
             where (s.celular = v_celular or s.email = v_email)
               and s.created_at > now() - interval '10 minutes') then
    return false;
  end if;
  if (select count(*) from public.solicitudes s
      where s.celular = v_celular and s.created_at > now() - interval '1 day') >= 3 then
    raise exception 'Ya recibimos tus solicitudes de hoy. Te escribiremos pronto.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.solicitudes s where s.created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Recibimos muchas solicitudes. Inténtalo en un rato.' using errcode = 'P0001';
  end if;

  insert into public.solicitudes (nombre, negocio, rubro, celular, email)
  values (v_nombre, v_negocio, v_rubro, v_celular, v_email);
  return true;
end $$;

revoke all on function public.registrar_solicitud(text, text, text, text, text) from public;
grant execute on function public.registrar_solicitud(text, text, text, text, text) to anon, authenticated, service_role;
revoke all on function private.solicitudes_touch() from public;

comment on table public.solicitudes is
  'Solicitudes de prueba del formulario de la landing (reservalope.com). Las crea registrar_solicitud; solo el superadmin las ve en /admin → Solicitudes.';
