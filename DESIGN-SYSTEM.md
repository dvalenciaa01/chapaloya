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
- Reservalope usa su propia paleta fija: `#000000` / `#FFD503` / `#FFFFFF`.

## Gráficos (Reservalope)
- `js/core/charts.js`: línea (periodo anterior punteado), barras horizontales, columnas y barra apilada 100%, con tooltip compartido.
- Trazos de 2px, grilla tenue, texto siempre en colores de texto (nunca en el color de la serie), leyenda cuando hay 2+ series.

## Reportes
- Estilos compartidos de analítica (periodo, KPIs, gráficos): `css/pages/analytics.css`, usado por Reservalope y el CRM. Constructor de reportes: `css/pages/reports.css`.
- PDF sobre fondo blanco (imprimible): banda superior en el primario con el texto en el terciario, línea de acento en el secundario y barras del gráfico en el primario. Variación positiva verde `#15803D`, negativa roja `#B91C1C`.
- Excel: encabezados de tabla con el primario del negocio y texto en el terciario.

## Tipografía
- Web pública: títulos en **Plus Jakarta Sans** y texto en **Inter**, mayúsculas y minúsculas normales (`css/pages/publico.css`).
- CRM y consola: **Barlow Condensed** para títulos y **Barlow** para texto, base 16px, interlineado 1.6.

## Componentes
- `btn-golden` (acción principal, 1 por bloque), `btn-dark` (secundaria, contorno), `btn-black` (principal sobre blanco/amarillo), `btn-ghost` (terciaria).
- Altura mínima de botones e inputs: 48px (44px en elementos compactos).
- Iconos SVG de línea en `js/utils/icons.js` → `ic('nombre')` en JS o `<i data-icon="nombre"></i>` en HTML. Sin emojis en la interfaz.
- Radios: 4 / 8 / 14px. Foco visible amarillo (negro en superficies claras).
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
