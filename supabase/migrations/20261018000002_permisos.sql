-- ==========================================================================
-- Reservalope · Migración 2/4 · Roles y permisos (RLS)
-- --------------------------------------------------------------------------
-- Traslada a la base de datos las reglas de js/core/auth.js y js/core/guard.js:
--   SUPERADMIN → todo.
--   ADMIN      → solo su barbería; módulos extra según "grants".
--   STAFF      → solo su barbería; si está vinculado a un barbero, solo sus citas.
-- El público (anon) NO lee tablas directamente: usa las funciones web_* de la
-- migración 3, que devuelven solo datos públicos.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- Funciones de apoyo (leen el perfil del usuario que hace la consulta)
-- --------------------------------------------------------------------------
create or replace function private.my_role()
returns text language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.active
$$;

-- Barbería del usuario, solo si está ACTIVA (suspender bloquea al personal)
create or replace function private.my_tenant()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.tenant_id
  from public.profiles p
  join public.tenants t on t.id = p.tenant_id and t.status = 'ACTIVE'
  where p.id = auth.uid() and p.active
$$;

create or replace function private.my_barber()
returns uuid language sql stable security definer set search_path = '' as $$
  select p.barber_id from public.profiles p
  where p.id = auth.uid() and p.active and p.role = 'STAFF'
$$;

create or replace function private.is_superadmin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(private.my_role() = 'SUPERADMIN', false)
$$;

-- ¿Tiene el módulo? (superadmin siempre; admin según grants; staff nunca)
create or replace function private.has_grant(p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_superadmin() or exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.active and p.role = 'ADMIN'
      and coalesce((p.grants ->> p_key)::boolean, false)
  )
$$;

create or replace function private.is_tenant_member(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_superadmin() or (p_tenant is not null and p_tenant = private.my_tenant())
$$;

create or replace function private.is_tenant_admin(p_tenant uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_superadmin()
      or (p_tenant is not null and p_tenant = private.my_tenant() and private.my_role() = 'ADMIN')
$$;

-- Personal vinculado a un barbero: solo SUS citas. Sin vínculo (recepción): todas.
create or replace function private.can_see_appointment(p_tenant uuid, p_barber uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_superadmin()
      or (p_tenant = private.my_tenant()
          and (private.my_role() = 'ADMIN' or private.my_barber() is null or p_barber = private.my_barber()))
$$;

-- Barbería sobre la que actúa un admin en una función (superadmin elige cuál)
create or replace function private.tenant_for_admin(p_tenant uuid, p_grant text)
returns uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if private.is_superadmin() then
    if p_tenant is null then
      raise exception 'Indica la barbería.' using errcode = '22023';
    end if;
    return p_tenant;
  end if;
  if private.my_role() = 'ADMIN' and private.has_grant(p_grant) and private.my_tenant() is not null then
    return private.my_tenant();
  end if;
  raise exception 'No tienes permiso para esta acción.' using errcode = '42501';
end $$;

revoke all on all functions in schema private from public;
grant usage on schema private to authenticated, service_role;
grant execute on all functions in schema private to authenticated, service_role;

-- --------------------------------------------------------------------------
-- Candados de columnas (lo que RLS no puede expresar por columna)
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
  return new;
end $$;
create trigger tenants_guard before update on public.tenants
  for each row execute function private.tenants_guard();

create or replace function private.profiles_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_superadmin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.tenant_id is distinct from old.tenant_id
     or new.email is distinct from old.email
     or new.grants is distinct from old.grants then
    raise exception 'No puedes cambiar rol, barbería, correo ni permisos.' using errcode = '42501';
  end if;
  if new.id = auth.uid()
     and (new.active is distinct from old.active or new.barber_id is distinct from old.barber_id) then
    raise exception 'No puedes cambiar tu propio estado ni tu vínculo de barbero.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger profiles_guard before update on public.profiles
  for each row execute function private.profiles_guard();

-- --------------------------------------------------------------------------
-- Activar RLS en todas las tablas
-- --------------------------------------------------------------------------
alter table public.tenants          enable row level security;
alter table public.profiles         enable row level security;
alter table public.barbers          enable row level security;
alter table public.barber_works     enable row level security;
alter table public.services         enable row level security;
alter table public.customers        enable row level security;
alter table public.appointments     enable row level security;
alter table public.walk_ins         enable row level security;
alter table public.ai_consultations enable row level security;
alter table public.audit_log        enable row level security;
alter table public.wa_sessions      enable row level security;
alter table public.wa_outbox        enable row level security;

-- El público no toca tablas; el personal entra como "authenticated".
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- --------------------------------------------------------------------------
-- Políticas
-- --------------------------------------------------------------------------
-- Barberías
create policy tenants_select on public.tenants for select to authenticated
  using ((select private.is_superadmin()) or id = (select private.my_tenant()));
create policy tenants_insert on public.tenants for insert to authenticated
  with check ((select private.is_superadmin()));
create policy tenants_update on public.tenants for update to authenticated
  using ((select private.is_superadmin())
         or (id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))))
  with check ((select private.is_superadmin()) or id = (select private.my_tenant()));
create policy tenants_delete on public.tenants for delete to authenticated
  using ((select private.is_superadmin()));

-- Usuarios
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid())
         or (select private.is_superadmin())
         or ((select private.my_role()) = 'ADMIN' and tenant_id = (select private.my_tenant())));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())
         or (select private.is_superadmin())
         or ((select private.my_role()) = 'ADMIN' and tenant_id = (select private.my_tenant()) and role = 'STAFF'))
  with check (id = (select auth.uid())
         or (select private.is_superadmin())
         or ((select private.my_role()) = 'ADMIN' and tenant_id = (select private.my_tenant()) and role = 'STAFF'));
-- Las cuentas nuevas las crea una Edge Function con la secret key (Fase 1).
create policy profiles_insert on public.profiles for insert to authenticated
  with check ((select private.is_superadmin()));
create policy profiles_delete on public.profiles for delete to authenticated
  using ((select private.is_superadmin()));

-- Barberos, portafolio y servicios: todo el equipo lee; el admin edita
create policy barbers_select on public.barbers for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy barbers_write on public.barbers for all to authenticated
  using ((select private.is_tenant_admin(tenant_id)))
  with check ((select private.is_tenant_admin(tenant_id)));

create policy barber_works_select on public.barber_works for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy barber_works_write on public.barber_works for all to authenticated
  using ((select private.is_tenant_admin(tenant_id)))
  with check ((select private.is_tenant_admin(tenant_id)));

create policy services_select on public.services for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy services_write on public.services for all to authenticated
  using ((select private.is_tenant_admin(tenant_id)))
  with check ((select private.is_tenant_admin(tenant_id)));

-- Clientes: el personal los crea al agendar; borrar requiere el módulo Clientes
create policy customers_select on public.customers for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy customers_insert on public.customers for insert to authenticated
  with check ((select private.is_tenant_member(tenant_id)));
create policy customers_update on public.customers for update to authenticated
  using ((select private.is_tenant_member(tenant_id)))
  with check ((select private.is_tenant_member(tenant_id)));
create policy customers_delete on public.customers for delete to authenticated
  using ((select private.is_tenant_admin(tenant_id)) and (select private.has_grant('customers')));

-- Citas
create policy appointments_select on public.appointments for select to authenticated
  using ((select private.can_see_appointment(tenant_id, barber_id)));
create policy appointments_insert on public.appointments for insert to authenticated
  with check ((select private.can_see_appointment(tenant_id, barber_id)));
create policy appointments_update on public.appointments for update to authenticated
  using ((select private.can_see_appointment(tenant_id, barber_id)))
  with check ((select private.can_see_appointment(tenant_id, barber_id)));
create policy appointments_delete on public.appointments for delete to authenticated
  using ((select private.is_tenant_admin(tenant_id)));

-- Walk-in: cola compartida por todo el personal
create policy walk_ins_select on public.walk_ins for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy walk_ins_insert on public.walk_ins for insert to authenticated
  with check ((select private.is_tenant_member(tenant_id)));
create policy walk_ins_update on public.walk_ins for update to authenticated
  using ((select private.is_tenant_member(tenant_id)))
  with check ((select private.is_tenant_member(tenant_id)));
create policy walk_ins_delete on public.walk_ins for delete to authenticated
  using ((select private.is_tenant_admin(tenant_id)));

-- Asesoría IA
create policy ai_select on public.ai_consultations for select to authenticated
  using ((select private.is_tenant_member(tenant_id)));
create policy ai_insert on public.ai_consultations for insert to authenticated
  with check ((select private.is_tenant_member(tenant_id)));
create policy ai_delete on public.ai_consultations for delete to authenticated
  using ((select private.is_tenant_admin(tenant_id)));

-- Historial: se escribe solo con registrar_actividad(); se lee con el módulo Historial
create policy audit_select on public.audit_log for select to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('audit'))));

-- WhatsApp: solo lectura para el admin con el módulo Configuración
create policy wa_sessions_select on public.wa_sessions for select to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))));
create policy wa_outbox_select on public.wa_outbox for select to authenticated
  using ((select private.is_superadmin())
         or (tenant_id = (select private.my_tenant()) and (select private.my_role()) = 'ADMIN'
             and (select private.has_grant('settings'))));

-- --------------------------------------------------------------------------
-- Registrar actividad (reemplaza DB.log). El nombre y rol salen del perfil,
-- así nadie puede firmar con otro nombre.
-- --------------------------------------------------------------------------
create or replace function public.registrar_actividad(p_action text, p_detail text default '', p_tenant_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  me public.profiles;
begin
  select * into me from public.profiles where id = auth.uid() and active;
  if me.id is null then
    raise exception 'Sesión no válida.' using errcode = '42501';
  end if;
  insert into public.audit_log (tenant_id, user_id, user_name, role, action, detail)
  values (case when me.role = 'SUPERADMIN' then p_tenant_id else private.my_tenant() end,
          me.id, coalesce(nullif(me.name, ''), me.email), me.role,
          left(p_action, 120), left(coalesce(p_detail, ''), 1000));
end $$;
revoke all on function public.registrar_actividad(text, text, uuid) from public, anon;
grant execute on function public.registrar_actividad(text, text, uuid) to authenticated;
