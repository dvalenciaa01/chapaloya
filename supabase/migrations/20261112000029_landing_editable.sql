-- ==========================================================================
-- Reservalope · Migración 29 · Landing editable desde la consola
-- --------------------------------------------------------------------------
-- El superadministrador cambia los textos, los videos y las secciones
-- visibles de la landing (reservalope.com) desde /admin → Landing, sin tocar
-- código. Aquí se guarda solo lo que cambió respecto del texto de fábrica que
-- está en landing/index.html:
--   public.landing_contenido   una sola fila (id = 1) con `contenido`:
--     { "text":   { "<clave>": "texto" },          textos cambiados
--       "media":  { "<clave>": { "src", "poster" } }, videos cambiados
--       "hidden": [ "<sección o punto>" ],          lo que no se muestra
--       "seo":    { "title", "description" } }       título de la pestaña y
--                                                    descripción para Google
-- Todos (también la web sin sesión) la leen; solo el superadmin la cambia.
-- Las fotos y videos se suben al bucket `media` (carpeta del superadmin), que
-- ya existe: no hace falta tocar Storage.
-- No toca datos. Se puede ejecutar sobre una base con datos y volver a
-- ejecutar.
-- ==========================================================================

create table if not exists public.landing_contenido (
  id          smallint primary key default 1 check (id = 1),
  contenido   jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);

-- Forma básica del contenido y tamaño máximo (los textos van escapados en la
-- página: nunca se insertan como HTML)
create or replace function private.landing_contenido_valido(c jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v jsonb;
begin
  if c is null or jsonb_typeof(c) <> 'object' then return false; end if;
  if pg_column_size(c) > 200000 then return false; end if;
  if exists (select 1 from jsonb_object_keys(c) x where x not in ('v', 'text', 'media', 'hidden', 'seo')) then
    return false;
  end if;

  if c ? 'text' then
    if jsonb_typeof(c->'text') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(c->'text') loop
      if k !~ '^[a-z0-9.]{1,60}$' or jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 2000 then
        return false;
      end if;
    end loop;
  end if;

  if c ? 'media' then
    if jsonb_typeof(c->'media') <> 'object' then return false; end if;
    for k, v in select * from jsonb_each(c->'media') loop
      if k !~ '^[a-z0-9.]{1,60}$' or jsonb_typeof(v) <> 'object' then return false; end if;
      if exists (select 1 from jsonb_each(v) m
                 where m.key not in ('src', 'poster')
                    or jsonb_typeof(m.value) <> 'string'
                    or char_length(m.value #>> '{}') > 600
                    or (m.value #>> '{}') !~ '^https://[^[:space:]"<>]+$') then
        return false;
      end if;
    end loop;
  end if;

  if c ? 'hidden' then
    if jsonb_typeof(c->'hidden') <> 'array' or jsonb_array_length(c->'hidden') > 100 then return false; end if;
    if exists (select 1 from jsonb_array_elements(c->'hidden') h
               where jsonb_typeof(h) <> 'string' or (h #>> '{}') !~ '^[a-z0-9.]{1,60}$') then
      return false;
    end if;
  end if;

  if c ? 'seo' then
    if jsonb_typeof(c->'seo') <> 'object' then return false; end if;
    if exists (select 1 from jsonb_each(c->'seo') s
               where s.key not in ('title', 'description')
                  or jsonb_typeof(s.value) <> 'string'
                  or char_length(s.value #>> '{}') > 300) then
      return false;
    end if;
  end if;
  return true;
end $$;

alter table public.landing_contenido drop constraint if exists landing_contenido_valido;
alter table public.landing_contenido add constraint landing_contenido_valido
  check (private.landing_contenido_valido(contenido));

insert into public.landing_contenido (id) values (1) on conflict (id) do nothing;

alter table public.landing_contenido enable row level security;

drop policy if exists landing_contenido_select on public.landing_contenido;
create policy landing_contenido_select on public.landing_contenido for select to anon, authenticated
  using (true);
drop policy if exists landing_contenido_update on public.landing_contenido;
create policy landing_contenido_update on public.landing_contenido for update to authenticated
  using ((select private.is_superadmin())) with check ((select private.is_superadmin()));

revoke all on public.landing_contenido from anon, authenticated;
grant select (id, contenido, updated_at) on public.landing_contenido to anon, authenticated;
grant update (contenido) on public.landing_contenido to authenticated;
grant all on public.landing_contenido to service_role;

create or replace function private.landing_contenido_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

drop trigger if exists landing_contenido_touch on public.landing_contenido;
create trigger landing_contenido_touch before update on public.landing_contenido
  for each row execute function private.landing_contenido_touch();

revoke all on function private.landing_contenido_touch() from public;
grant execute on function private.landing_contenido_valido(jsonb) to anon, authenticated, service_role;

comment on table public.landing_contenido is
  'Textos, videos y secciones visibles de la landing de reservalope.com que el superadmin cambió en /admin → Landing (solo los cambios; lo demás sale de landing/index.html).';
