# Golden Barbería — Sistema de diseño

## Color (regla 60 / 30 / 10)
| Rol | Hex | Uso |
|---|---|---|
| Primario | `#000000` | Superficies dominantes: header, hero, CRM, footer (60%) |
| Terciario | `#FFFFFF` | Texto sobre negro y secciones/tarjetas claras de respiro (30%) |
| Secundario | `#D79848` | Dorado tomado del logo. Solo acciones principales, estado activo y acentos (10%) |

- Dorado sobre negro: 8.5:1 (AAA). Negro sobre dorado: 8.5:1 (AAA). Blanco sobre dorado: 2.5:1 → no usar.
- **Prohibido:** texto dorado sobre blanco (2.5:1). En superficies blancas el dorado solo va como relleno (marcadores, foco) con texto negro.
- Verde/rojo solo como colores semánticos de estado de cita (confirmada / cancelada).
- Tokens en `css/variables.css`. Los alias antiguos (`--golden`, `--bg-card`, etc.) se mantienen para los scripts.

## Paleta por barbería (multimarca)
Cada barbería define 3 colores con los mismos roles que Golden: **primario** = fondo, **secundario** = acento, **terciario** = texto.
- `js/core/tenant-brand.js` → `applyPalette()` deriva los tonos intermedios (tinta, bordes, texto atenuado) mezclando primario y terciario, para que toda la interfaz siga la marca.
- Validación (`checkPalette`): primario más oscuro que terciario; texto/fondo ≥ 7:1; acento/fondo ≥ 4.5:1.
- Reservalope usa su propia paleta fija: `#000000` / `#FFD503` / `#FFFFFF`.

## Gráficos (Reservalope)
- `js/core/charts.js`: línea (periodo anterior punteado), barras horizontales, columnas y barra apilada 100%, con tooltip compartido.
- Trazos de 2px, grilla tenue, texto siempre en colores de texto (nunca en el color de la serie), leyenda cuando hay 2+ series.

## Reportes
- Estilos compartidos de analítica (periodo, KPIs, gráficos): `css/pages/analytics.css`, usado por Reservalope y el CRM. Constructor de reportes: `css/pages/reports.css`.
- PDF sobre fondo blanco (imprimible): banda superior en el primario con el texto en el terciario, línea de acento en el secundario y barras del gráfico en el primario. Variación positiva verde `#15803D`, negativa roja `#B91C1C`.
- Excel: encabezados de tabla con el primario de la barbería y texto en el terciario.

## Tipografía
- Títulos: **Barlow Condensed** 600–800, mayúsculas (estilo rótulo de barbería).
- Texto e interfaz: **Barlow** 400–700, base 16px, interlineado 1.6.

## Componentes
- `btn-golden` (acción principal, 1 por bloque), `btn-dark` (secundaria, contorno), `btn-black` (principal sobre blanco/amarillo), `btn-ghost` (terciaria).
- Altura mínima de botones e inputs: 48px (44px en elementos compactos).
- Iconos SVG de línea en `js/utils/icons.js` → `ic('nombre')` en JS o `<i data-icon="nombre"></i>` en HTML. Sin emojis en la interfaz.
- Radios: 4 / 8 / 14px. Foco visible amarillo (negro en superficies claras).
- Movimiento 150–420ms con `prefers-reduced-motion` respetado.

## Logo
- Encabezado y pie: `assets/icons/logo-golden-header.jpg` (recorte sin margen negro del original `Logo-golden.jpg`). Alto 46px escritorio / 38px móvil.

## Responsive
- Puntos de quiebre: 380 · 400 · 480 · 560 · 640 · 720 · 960/980 · 1080 · 1180 px.
- Verificado sin scroll horizontal en 320, 360, 390, 414, 768, 834, 1024, 1280 y 1440 px.
- ≤960px: menú hamburguesa (web) y menú horizontal deslizable (CRM y Reservalope).
- ≤720px: tablas del CRM se convierten en tarjetas (cada celda usa `data-label`).
- ≤560px: modales como hoja inferior; botón de WhatsApp se oculta mientras se escribe.
- Efectos hover desactivados en pantallas táctiles; áreas táctiles ≥44px; área segura de iPhone respetada.
