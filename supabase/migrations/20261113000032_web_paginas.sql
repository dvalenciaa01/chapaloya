-- ==========================================================================
-- Reservalope · Migración 32 · Diseñar todas las páginas de la web
-- --------------------------------------------------------------------------
-- Hasta ahora el constructor (Diseñar web) solo armaba el Inicio. Desde aquí
-- tenants.web_page acepta una clave nueva:
--   pages  { servicios | equipo | galeria | mi-cita | reservar: { blocks: [...] } }
-- Cada página lleva sus propios bloques (portada, texto, fotos, video…) y un
-- bloque fijo "pagina" (exactamente uno): el contenido propio de esa página
-- (la lista de servicios, el equipo, la galería, la búsqueda de la cita o el
-- formulario de reserva), que se puede mover pero no quitar.
-- Una página sin diseño se ve como siempre.
--
-- También acepta "css" (estilo propio, igual que la migración 31), así que
-- da lo mismo si la 31 ya se ejecutó o no; si se ejecuta la 31 DESPUÉS de
-- esta, vuelve a ejecutar esta.
--
-- Solo cambia la validación private.web_page_valida (ahora usa
-- private.web_bloques_validos para el Inicio y para cada página) y sube el
-- tamaño máximo del diseño de 96 KB a 256 KB. Ningún dato cambia.
-- Requiere las migraciones 21 a 28. Se puede ejecutar más de una vez.
-- ==========================================================================

-- Bloques de una página. en_pagina = true: es una página distinta del Inicio
-- y debe llevar exactamente un bloque "pagina"; en el Inicio no puede haber.
create or replace function private.web_bloques_validos(bl jsonb, en_pagina boolean)
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
    "fotos":     ["cuadricula", "mosaico", "carrusel"],
    "pagina":    ["normal"]
  }';
  fuentes constant text[] := array['urbanist', 'alfa-slab', 'bodoni', 'cormorant', 'dm-serif', 'plex-sans', 'outfit',
    'fraunces', 'fredoka', 'pirata', 'big-shoulders', 'work-sans', 'jost', 'figtree', 'dm-sans', 'source-sans',
    'nunito', 'space-grotesk', 'inter-tight'];
  url_re constant text := '^https://[^[:space:]"''<>()\\]+$';
  f jsonb;
  slot text;
  ex jsonb;
  ex_ids text[];
  b jsonb;
  it jsonb;
  ids text[] := array[]::text[];
begin
  if jsonb_typeof(bl) is distinct from 'array' or jsonb_array_length(bl) > 24 then
    return false;
  end if;

  for b in select x from jsonb_array_elements(bl) x loop
    if jsonb_typeof(b) <> 'object' then return false; end if;
    if exists (select 1 from jsonb_object_keys(b) k
               where k not in ('id', 'type', 'show', 'style', 'bg', 'eyebrow', 'title', 'text',
                               'image', 'btn', 'btn2', 'cat', 'limit', 'map', 'items',
                               'bgColor', 'video', 'poster', 'images', 'fmt', 'extras')) then
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
    -- fmt: formato de cada texto del bloque (letra, color, tamaño, grosor,
    -- cursiva, alineación y, en los botones, su color)
    if b ? 'fmt' and jsonb_typeof(b -> 'fmt') <> 'null' then
      if jsonb_typeof(b -> 'fmt') <> 'object'
         or exists (select 1 from jsonb_object_keys(b -> 'fmt') k
                    where k not in ('eyebrow', 'title', 'text', 'btn', 'btn2', 'itemTitle', 'itemText')) then
        return false;
      end if;
      for slot, f in select key, value from jsonb_each(b -> 'fmt') loop
        if jsonb_typeof(f) <> 'object'
           or exists (select 1 from jsonb_object_keys(f) k
                      where k not in ('font', 'color', 'size', 'bold', 'italic', 'align', 'bg'))
           or not private.json_bool_o_nada(f -> 'bold') or not private.json_bool_o_nada(f -> 'italic')
           or (f ? 'font' and jsonb_typeof(f -> 'font') <> 'null'
               and (jsonb_typeof(f -> 'font') <> 'string' or not ((f ->> 'font') = any (fuentes))))
           or (f ? 'color' and jsonb_typeof(f -> 'color') <> 'null'
               and (jsonb_typeof(f -> 'color') <> 'string' or (f ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'))
           or (f ? 'bg' and jsonb_typeof(f -> 'bg') <> 'null'
               and (slot not in ('btn', 'btn2') or jsonb_typeof(f -> 'bg') <> 'string' or (f ->> 'bg') !~ '^#[0-9A-Fa-f]{6}$'))
           or (f ? 'size' and jsonb_typeof(f -> 'size') <> 'null'
               and (jsonb_typeof(f -> 'size') <> 'string' or (f ->> 'size') not in ('xs', 's', 'l', 'xl', 'xxl')))
           or (f ? 'align' and jsonb_typeof(f -> 'align') <> 'null'
               and (jsonb_typeof(f -> 'align') <> 'string' or (f ->> 'align') not in ('left', 'center', 'right'))) then
          return false;
        end if;
      end loop;
    end if;
    -- extras: cuadros de texto agregados al bloque (hasta 8), cada uno con su
    -- tipo (título, subtítulo o párrafo), su texto y su formato
    if b ? 'extras' and jsonb_typeof(b -> 'extras') <> 'null' then
      if jsonb_typeof(b -> 'extras') <> 'array' or jsonb_array_length(b -> 'extras') > 8 then return false; end if;
      ex_ids := array[]::text[];
      for ex in select x from jsonb_array_elements(b -> 'extras') x loop
        if jsonb_typeof(ex) <> 'object'
           or exists (select 1 from jsonb_object_keys(ex) k where k not in ('id', 'kind', 'text', 'fmt', 'pos', 'mpos'))
           or jsonb_typeof(ex -> 'id') is distinct from 'string' or (ex ->> 'id') !~ '^[a-z0-9]{4,16}$'
           or (ex ->> 'id') = any (ex_ids)
           or jsonb_typeof(ex -> 'kind') is distinct from 'string' or (ex ->> 'kind') not in ('titulo', 'subtitulo', 'parrafo')
           or not private.web_txt(ex -> 'text', 1500)
           or not private.web_pos_valida(ex -> 'pos') or not private.web_pos_valida(ex -> 'mpos') then
          return false;
        end if;
        ex_ids := ex_ids || (ex ->> 'id');
        f := ex -> 'fmt';
        if f is not null and jsonb_typeof(f) <> 'null' then
          if jsonb_typeof(f) <> 'object'
             or exists (select 1 from jsonb_object_keys(f) k
                        where k not in ('font', 'color', 'size', 'bold', 'italic', 'align'))
             or not private.json_bool_o_nada(f -> 'bold') or not private.json_bool_o_nada(f -> 'italic')
             or (f ? 'font' and jsonb_typeof(f -> 'font') <> 'null'
                 and (jsonb_typeof(f -> 'font') <> 'string' or not ((f ->> 'font') = any (fuentes))))
             or (f ? 'color' and jsonb_typeof(f -> 'color') <> 'null'
                 and (jsonb_typeof(f -> 'color') <> 'string' or (f ->> 'color') !~ '^#[0-9A-Fa-f]{6}$'))
             or (f ? 'size' and jsonb_typeof(f -> 'size') <> 'null'
                 and (jsonb_typeof(f -> 'size') <> 'string' or (f ->> 'size') not in ('xs', 's', 'l', 'xl', 'xxl')))
             or (f ? 'align' and jsonb_typeof(f -> 'align') <> 'null'
                 and (jsonb_typeof(f -> 'align') <> 'string' or (f ->> 'align') not in ('left', 'center', 'right'))) then
            return false;
          end if;
        end if;
      end loop;
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

  -- Una sola portada; el bloque "pagina" solo fuera del Inicio y exactamente uno
  if (select count(*) from jsonb_array_elements(bl) x where x ->> 'type' = 'portada') > 1 then
    return false;
  end if;
  if (select count(*) from jsonb_array_elements(bl) x where x ->> 'type' = 'pagina')
     <> (case when en_pagina then 1 else 0 end) then
    return false;
  end if;
  return true;
end $$;

revoke all on function private.web_bloques_validos(jsonb, boolean) from public;
grant execute on function private.web_bloques_validos(jsonb, boolean) to authenticated, service_role;

create or replace function private.web_page_valida(v jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  fuentes constant text[] := array['urbanist', 'alfa-slab', 'bodoni', 'cormorant', 'dm-serif', 'plex-sans', 'outfit',
    'fraunces', 'fredoka', 'pirata', 'big-shoulders', 'work-sans', 'jost', 'figtree', 'dm-sans', 'source-sans',
    'nunito', 'space-grotesk', 'inter-tight'];
  th jsonb;
  pg record;
begin
  if v is null or jsonb_typeof(v) = 'null' then return true; end if;
  if jsonb_typeof(v) <> 'object' or octet_length(v::text) > 262144 then return false; end if;
  if exists (select 1 from jsonb_object_keys(v) k where k not in ('blocks', 'theme', 'css', 'pages')) then return false; end if;

  -- css: estilo propio de la web (igual que la migración 31)
  if v ? 'css' and jsonb_typeof(v -> 'css') <> 'null' then
    if jsonb_typeof(v -> 'css') <> 'string' or char_length(v ->> 'css') > 30000
       or (v ->> 'css') ~ '[<\\]'
       or (v ->> 'css') ~* '(url[[:space:]]*\(|@import|@charset|@namespace|@font-face|expression[[:space:]]*\(|javascript:|behavior[[:space:]]*:|-moz-binding|image-set[[:space:]]*\(|src[[:space:]]*\()' then
      return false;
    end if;
  end if;

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

  -- Inicio
  if not private.web_bloques_validos(v -> 'blocks', false) then return false; end if;

  -- Las demás páginas del sitio (cada una con su bloque "pagina")
  if v ? 'pages' and jsonb_typeof(v -> 'pages') <> 'null' then
    if jsonb_typeof(v -> 'pages') <> 'object' then return false; end if;
    for pg in select key, value from jsonb_each(v -> 'pages') loop
      if pg.key not in ('servicios', 'equipo', 'galeria', 'mi-cita', 'reservar')
         or jsonb_typeof(pg.value) <> 'object'
         or exists (select 1 from jsonb_object_keys(pg.value) k where k <> 'blocks')
         or not private.web_bloques_validos(pg.value -> 'blocks', true) then
        return false;
      end if;
    end loop;
  end if;
  return true;
end $$;

revoke all on function private.web_page_valida(jsonb) from public;
grant execute on function private.web_page_valida(jsonb) to authenticated, service_role;
