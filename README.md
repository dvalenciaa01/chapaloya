# Reservalope · Sistema para barberías (demo)

Plataforma web para administrar **varias barberías** desde un solo sistema: cada barbería tiene su propia web de reservas con su marca, un CRM para su equipo y, por encima de todas, **Reservalope**, la consola del superadministrador con dashboard global, alertas y reportes.

Es una **demo que funciona 100 % en el navegador**: HTML, CSS y JavaScript sin frameworks ni servidor. Los datos se guardan en el `localStorage` de cada navegador.

![Dashboard global de Reservalope](docs/capturas/reservalope-dashboard.png)

| Reportes con filtros (PDF / Excel) | CRM de la barbería |
|---|---|
| ![Reportes](docs/capturas/reportes.png) | ![CRM · Servicios](docs/capturas/crm-servicios.png) |

| Web de reservas con la marca de cada barbería | Diseño responsivo |
|---|---|
| ![Reserva web de Navaja Norte](docs/capturas/reserva-web-navaja.png) | ![Dashboard en el celular](docs/capturas/movil-dashboard.png) |

---

## Funciones

**Web pública por barbería** (`index.html?b=enlace`)
- Inicio, servicios, barberos con portafolio, reserva de citas y consulta de "Mi cita".
- Usa el nombre, logo, paleta de 3 colores y datos de contacto de cada barbería.
- No permite reservar en días u horarios que ya pasaron, ni en horarios ocupados.

**CRM de la barbería** (`crm.html`)
- Panel principal, citas, cola walk-in, barberos y portafolio, servicios (agregar, editar, eliminar), ventas, clientes, reportes, usuarios, historial y configuración.

**Roles y permisos**
- **Superadministrador:** acceso total; crea barberías y usuarios.
- **Administrador:** solo su barbería; crea personal; módulos extra según lo que le otorgue el superadministrador.
- **Personal:** ve el panel, crea y gestiona citas y walk-in (solo sus propias citas si está vinculado a un barbero).
- Contraseñas con sal y hash, bloqueo tras 5 intentos, cambio obligatorio de contraseña temporal, sesión con caducidad e historial de actividad.

**Reservalope · consola del superadministrador** (`reservalope.html`)
- Dashboard global con comparación contra el periodo anterior, ranking de barberías, ingresos por suscripciones.
- Ficha individual de cada barbería, alertas de salud (suscripción, cancelaciones, inactividad, configuración), exportación CSV.
- Creación de barberías con paleta de 3 colores validada por contraste, plan y vencimiento.

**Reportes**
- Filtros por periodo, barbería, barbero, servicio, estado, canal, tipo y cliente.
- Vista previa en pantalla y descarga en **PDF** (con la marca de la barbería) o **Excel** (varias hojas con formato).

El detalle de roles, reglas y cuentas está en [ACCESOS-Y-ROLES.md](ACCESOS-Y-ROLES.md) y el sistema de diseño en [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md).

---

## Probarlo

### En tu computadora

Se recomienda abrirlo con un servidor local (con doble clic también funciona, pero el logo no aparece en los PDF):

```bash
# Opción 1: Python
python -m http.server 8000
# Opción 2: Node
npx serve .
```

Luego abre <http://localhost:8000>. En VS Code también sirve la extensión **Live Server**.

### Publicarlo con GitHub Pages

1. Sube el proyecto a un repositorio de GitHub.
2. En el repositorio: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, rama `main`, carpeta `/ (root)` → **Save**.
3. En uno o dos minutos queda publicado en `https://TU-USUARIO.github.io/NOMBRE-DEL-REPO/`.

| Página | Enlace (sobre la URL publicada) |
|---|---|
| Web de Golden Barbería | `index.html?b=golden` |
| Web de Navaja Norte (demo) | `index.html?b=navaja-norte` |
| Ingreso al CRM / Reservalope | `login.html` |

### Cuentas

Las contraseñas de las cuentas de demostración ya no se publican en este repositorio. Pídelas al responsable del proyecto.

En producción las cuentas viven en Supabase Auth: el superadministrador se crea desde el panel de Supabase y él crea a los administradores y al personal (ver [supabase/README.md](supabase/README.md)).

La demo trae 90 días de historial de ejemplo. Se borra desde **Reservalope → Plataforma → Borrar datos demo**.

---

## Estructura

```
├── index.html, servicios.html, barberos.html,
│   reservar.html, consultar-cita.html      Web pública (por barbería)
├── login.html                               Ingreso
├── crm.html                                 CRM de la barbería
├── reservalope.html                         Consola del superadministrador
├── assets/icons/                            Logos
├── css/
│   ├── variables.css, components.css, layout.css, main.css
│   └── pages/                               Estilos por página (crm, reservalope, reports, analytics…)
├── js/
│   ├── data/      db.js (datos y reglas de agenda) · demo-seed.js (datos de ejemplo)
│   ├── core/      auth, guard (permisos), tenant-brand (marca), analytics, charts, reports, report-export
│   ├── pages/     lógica de cada página
│   ├── components/ modal, WhatsApp, constructor de reportes
│   ├── utils/     iconos SVG, compresión de imágenes
│   └── vendor/    jsPDF, jsPDF-AutoTable, ExcelJS (MIT)
└── docs/capturas/                           Imágenes de este README
```

---

## Limitaciones de la demo

- **Los datos viven en el navegador.** No se comparten entre computadoras ni celulares, y se pierden si se borra el historial del navegador.
- **El login no es una barrera de seguridad real**: quien tenga acceso al equipo puede modificar los datos con las herramientas del navegador.
- El espacio del navegador es limitado (~5 MB); muchas fotos grandes pueden llenarlo.

**Para producción** se reemplazan `js/data/db.js` y `js/core/auth.js` por un backend real (por ejemplo, Supabase o una API propia) con base de datos y autenticación en el servidor. La interfaz, los roles y las reglas ya están separados para que ese cambio sea acotado.

---

## Licencias

Las librerías de terceros incluidas y sus licencias se detallan en [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
