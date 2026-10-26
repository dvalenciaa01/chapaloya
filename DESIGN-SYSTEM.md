# Reservalope — Sistema de diseño

Plantilla para cualquier negocio que trabaja con citas (barbería, salón, spa, consultorio, clínica dental, veterinaria, etc.). Cada negocio aporta su paleta, su logo y su rubro; las palabras visibles salen de `js/core/vocab.js`.

## Color (regla 60 / 30 / 10)
Valores de fábrica (paleta por defecto de un negocio nuevo):

| Rol | Hex | Uso |
|---|---|---|
| Primario | `#000000` | Superficies dominantes: header, hero, CRM, footer (60%) |
| Terciario | `#FFFFFF` | Texto sobre negro y secciones/tarjetas claras de respiro (30%) |
| Secundario | `#D79848` | Acento. Solo acciones principales, estado activo y acentos (10%) |

- **Regla del acento:** el secundario nunca va como texto sobre fondo claro; en superficies claras solo rellena (botones, marcadores, foco) con texto en el primario.
- Verde/rojo solo como colores semánticos de estado de cita (confirmada / cancelada).
- Tokens en `css/variables.css`. Los alias antiguos (`--golden`, `--bg-card`, etc.) se mantienen para los scripts.

## Paleta por negocio (multimarca)
Cada negocio define 3 colores (formato `#RRGGBB`, validado también en la base): **primario** = fondo, **secundario** = acento, **terciario** = texto.
- `js/core/tenant-brand.js` → `applyPalette()` deriva los tonos intermedios (tinta, bordes, texto atenuado) mezclando primario y terciario, para que toda la interfaz siga la marca.
- Validación (`checkPalette`): primario más oscuro que terciario; texto/fondo ≥ 7:1; acento/fondo ≥ 4.5:1.
- Reservalope (landing, login y consola) usa su propia paleta: fondo `#FFFFFF`, acento azul `#3B3BF2`, texto `#0E0E12`; en modo oscuro `#0C0C0F` / `#7373FF` / `#F2F2F5`. El botón de modo claro/oscuro guarda la elección en `localStorage` (`reservalope-theme`) y la comparten landing, login y consola.

## Gráficos (Reservalope)
- `js/core/charts.js`: línea (periodo anterior punteado), barras horizontales, columnas y barra apilada 100%, con tooltip compartido.
- Trazos de 2px, grilla tenue, texto siempre en colores de texto (nunca en el color de la serie), leyenda cuando hay 2+ series.

## Reportes
- Estilos compartidos de analítica (periodo, KPIs, gráficos): `css/pages/analytics.css`, usado por Reservalope y el CRM. Constructor de reportes: `css/pages/reports.css`.
- PDF sobre fondo blanco (imprimible): banda superior en el primario con el texto en el terciario, línea de acento en el secundario y barras del gráfico en el primario. Variación positiva verde `#15803D`, negativa roja `#B91C1C`.
- Excel: encabezados de tabla con el primario del negocio y texto en el terciario.

## Estilo por rubro (web pública)
`css/pages/rubros.css` da a cada rubro su propia personalidad sobre `html[data-rubro]` (lo escribe `Vocab.set()`). Los colores siguen siendo los del negocio; cambian tipografía, forma, texturas y composición. `TenantBrand.applyRubroFonts()` descarga solo la fuente del rubro activo.

| Rubro | Dirección | Tipografía (títulos / texto) | Rasgos |
|---|---|---|---|
| barberia | Cartel de taller clásico | Alfa Slab One / Work Sans | Esquinas rectas, barra de barbero, ticket troquelado, equipo en B/N |
| salon | Revista de moda | Bodoni Moda cursiva / Jost | Índice numerado 01-02, marcos en arco, aros finos |
| spa | Jardín zen | Cormorant Garamond / Figtree | Anillos de agua, borde ondulado, tarjeta en arco, hojas |
| unas | Pop y brillo | Unbounded / DM Sans | Destellos, sticker 24/7, polaroids giradas |
| consultorio | Ficha clínica | IBM Plex Sans / Plex Mono | Papel milimetrado, electrocardiograma, datos en mono |
| dental | Fresco y redondeado | Outfit | Curva de sonrisa, burbujas, avatares con aro |
| psicologia | Cuaderno cálido | Fraunces / Source Sans 3 | Subrayado a mano, trazo de lápiz, ritmo pausado |
| veterinaria | Amigable y robusta | Fredoka / Nunito | Huellas, sombras sólidas, formas de gota |
| tatuajes | Hoja de flash | Pirata One / Space Grotesk | Semitono, bordes gruesos, láminas Nº torcidas |
| fitness | Cartel deportivo | Big Shoulders Display / Inter Tight | Mayúsculas, cortes diagonales, botones en paralelogramo |
| otro | Neutro | Plus Jakarta Sans / Inter | Retícula de puntos |

## Landing de Reservalope (`landing/index.html`)
- Estilo fintech limpio: fondo blanco, azul eléctrico `#3B3BF2` como único acento, texto secundario gris `#6B7080` (modo oscuro incluido).
- Tipografía **Urbanist** (titulares en peso 500–600, texto 400–500).
- Botones e inputs en píldora, sin sombras de color. Portada con teléfono sobre bloque azul; plataforma en franja negra con tarjetas montadas sobre ella; pie en panel gris.
- Sin adornos de plantilla: nada de etiquetas de color sobre cada título, brillos, aros, texturas de puntos, rejillas de "ícono en círculo + título" ni viñetas con check. Encabezados alineados a la izquierda (en secciones anchas, la etiqueta va en una columna lateral bajo una línea); listas separadas por líneas finas.
- Botón de modo claro/oscuro en la cabecera: parte del tema del sistema y guarda la elección en `localStorage` (`reservalope-theme`).
- El muestrario de rubros carga cada tipografía solo con las letras necesarias (parámetro `text` de Google Fonts).

## Tipografía
- Todo el sistema sigue el lenguaje de la landing: **Urbanist**, títulos en minúscula de peso medio, botones y campos en píldora, tarjetas planas sin sombras, etiquetas en texto simple (sin mayúsculas espaciadas ni color de acento) y listas separadas por líneas finas.
- Web pública: Urbanist por defecto (`css/pages/publico.css`); cada rubro aplica su tipografía y su toque (`css/pages/rubros.css`). Portadas claras; cabecera, pie, franja final y bloque tras la tarjeta de reserva en el color principal del negocio.
- CRM y consola: Urbanist por defecto. En `crm_config` la opción de fuente `barlow` conserva esa clave (la valida la base de datos) pero hoy es "Urbanist (de la marca)".

## Componentes
- Botones en píldora (`--radius-btn`; esquinas "rectas" en `crm_config` los vuelve rectos). `btn-golden` (acción principal, 1 por bloque), `btn-dark` (secundaria, contorno), `btn-black` (principal sobre blanco/amarillo), `btn-ghost` (terciaria).
- Altura mínima de botones e inputs: 48px (44px en elementos compactos).
- Iconos SVG de línea en `js/utils/icons.js` → `ic('nombre')` en JS o `<i data-icon="nombre"></i>` en HTML. Sin emojis en la interfaz.
- Radios: 8 / 12 / 20px y píldora en botones y campos. Foco visible con el color de acento.
- Movimiento 150–420ms con `prefers-reduced-motion` respetado.

## Logo e íconos de rubro
- Encabezado y pie: el logo que sube cada negocio (`logo_url`); sin logo se muestra su nombre. Alto 46px escritorio / 38px móvil.
- Cada rubro tiene un ícono de línea en `js/core/vocab.js` (`Vocab.icon()`, atributo `data-v-icon`).

## Palabras por rubro
- El HTML trae palabras genéricas ("profesional", "servicio", "cliente") marcadas con `data-v`, `data-v-fmt` o `data-v-attr`, y `Vocab.apply()` las cambia al cargar el negocio.
- Evitar frases que obliguen a concordar género; en el CRM usar `UI.v()` cuando haga falta.

## Responsive
- Puntos de quiebre: 380 · 400 · 480 · 560 · 640 · 720 · 960/980 · 1080 · 1180 px.
- Verificado sin scroll horizontal en 320, 360, 390, 414, 768, 834, 1024, 1280 y 1440 px.
- ≤960px: menú hamburguesa (web) y menú horizontal deslizable (CRM y Reservalope).
- ≤720px: tablas del CRM se convierten en tarjetas (cada celda usa `data-label`).
- ≤560px: modales como hoja inferior; botón de WhatsApp se oculta mientras se escribe.
- Efectos hover desactivados en pantallas táctiles; áreas táctiles ≥44px; área segura de iPhone respetada.
