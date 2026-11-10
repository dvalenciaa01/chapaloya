-- ==========================================================================
-- Migración 22 · Constructor de la web: tipo de letra, colores, fotos y videos
-- --------------------------------------------------------------------------
-- tenants.web_page acepta además:
--   theme   { fontTitle, fontBody, primary, accent }  tipo de letra de títulos
--           y de texto (de una lista de fuentes alojadas en el sitio) y colores
--           principal y de acento de la web (#RRGGBB). Sin dato = los del negocio.
--   bloques nuevos: "video" (archivo subido o enlace de YouTube/Vimeo) y
--           "fotos" (hasta 12 fotos propias, sin depender del equipo).
--   en cada bloque: bg "color" + bgColor (#RRGGBB), video (la portada puede
--           tener video de fondo) y poster (imagen mientras carga el video).
-- Bucket "media": acepta videos MP4 y WebM, y el límite por archivo sube de
--   2 MB a 50 MB (las fotos se siguen achicando en el navegador antes de subir).
--
-- Requiere la migración 21. Solo cambia validaciones y el bucket; ningún dato
-- cambia. Se puede ejecutar más de una vez.
-- ==========================================================================

-- --------------------------------------------------------------------------
-- 1. Validación de web_page (igual que en la 21, más lo nuevo)
-- --------------------------------------------------------------------------
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
    "texto":     ["foto-izquierda", "foto-derecha", "solo-texto"],
    "video":     ["ancho", "con-texto"],
    "fotos":     ["cuadricula", "mosaico", "carrusel"]
  }';
  fuentes constant text[] := array['urbanist', 'alfa-slab', 'bodoni', 'cormorant', 'dm-serif', 'plex-sans', 'outfit',
    'fraunces', 'fredoka', 'pirata', 'big-shoulders', 'work-sans', 'jost', 'figtree', 'dm-sans', 'source-sans',
    'nunito', 'space-grotesk', 'inter-tight'];
  url_re constant text := '^https://[^[:space:]"''<>()\\]+$';
  th jsonb;
  b jsonb;
  it jsonb;
  ids text[] := array[]::text[];
begin
  if v is null or jsonb_typeof(v) = 'null' then return true; end if;
  if jsonb_typeof(v) <> 'object' or octet_length(v::text) > 98304 then return false; end if;
  if exists (select 1 from jsonb_object_keys(v) k where k not in ('blocks', 'theme')) then return false; end if;

  -- theme: tipo de letra (títulos y texto) y colores de toda la web
  if v ? 'theme' and jsonb_typeof(v -> 'theme') <> 'null' then
    th := v -> 'theme';
    if jsonb_typeof(th) <> 'object'
       or exists (select 1 from jsonb_object_keys(th) k where k not in ('fontTitle', 'fontBody', 'primary', 'accent')) then
      return false;
    end if;
    if (th ? 'fontTitle' and jsonb_typeof(th -> 'fontTitle') <> 'null'
        and (jsonb_typeof(th -> 'fontTitle') <> 'string' or not ((th ->> 'fontTitle') = any (fuentes))))
       or (th ? 'fontBody' and jsonb_typeof(th -> 'fontBody') <> 'null'
           and (jsonb_typeof(th -> 'fontBody') <> 'string' or not ((th ->> 'fontBody') = any (fuentes))))
       or (th ? 'primary' and jsonb_typeof(th -> 'primary') <> 'null'
           and (jsonb_typeof(th -> 'primary') <> 'string' or (th ->> 'primary') !~ '^#[0-9A-Fa-f]{6}$'))
       or (th ? 'accent' and jsonb_typeof(th -> 'accent') <> 'null'
           and (jsonb_typeof(th -> 'accent') <> 'string' or (th ->> 'accent') !~ '^#[0-9A-Fa-f]{6}$')) then
      return false;
    end if;
  end if;
  if jsonb_typeof(v -> 'blocks') is distinct from 'array' or jsonb_array_length(v -> 'blocks') > 24 then
    return false;
  end if;

  for b in select x from jsonb_array_elements(v -> 'blocks') x loop
    if jsonb_typeof(b) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(b) k
               where k not in ('id', 'type', 'show', 'style', 'bg', 'eyebrow', 'title', 'text',
                               'image', 'btn', 'btn2', 'cat', 'limit', 'map', 'items',
                               'bgColor', 'video', 'poster', 'images')) then
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
       and (jsonb_typeof(b -> 'bg') <> 'string' or (b ->> 'bg') not in ('normal', 'suave', 'marca', 'color')) then
      return false;
    end if;
    if b ? 'bgColor' and jsonb_typeof(b -> 'bgColor') <> 'null'
       and (jsonb_typeof(b -> 'bgColor') <> 'string' or (b ->> 'bgColor') !~ '^#[0-9A-Fa-f]{6}$') then
      return false;
    end if;
    -- Video (archivo subido o enlace de YouTube/Vimeo) y su imagen de portada
    if (b ? 'video' and jsonb_typeof(b -> 'video') <> 'null'
        and (jsonb_typeof(b -> 'video') <> 'string' or char_length(b ->> 'video') > 1000 or (b ->> 'video') !~ url_re))
       or (b ? 'poster' and jsonb_typeof(b -> 'poster') <> 'null'
           and (jsonb_typeof(b -> 'poster') <> 'string' or char_length(b ->> 'poster') > 1000 or (b ->> 'poster') !~ url_re)) then
      return false;
    end if;
    -- images: fotos propias del bloque "fotos" (hasta 12)
    if b ? 'images' and jsonb_typeof(b -> 'images') <> 'null' then
      if jsonb_typeof(b -> 'images') <> 'array' or jsonb_array_length(b -> 'images') > 12 then return false; end if;
      if exists (select 1 from jsonb_array_elements(b -> 'images') x
                 where jsonb_typeof(x) <> 'string' or char_length(x #>> '{}') > 1000 or (x #>> '{}') !~ url_re) then
        return false;
      end if;
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
            or (b ->> 'image') !~ url_re) then
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

-- --------------------------------------------------------------------------
-- 2. Bucket media: fotos y videos de hasta 50 MB
-- --------------------------------------------------------------------------
do $$
begin
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set file_size_limit = 52428800,
           allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']
     where id = 'media';
  end if;
end $$;

revoke all on function private.web_page_valida(jsonb) from public;
grant execute on function private.web_page_valida(jsonb) to authenticated, service_role;
