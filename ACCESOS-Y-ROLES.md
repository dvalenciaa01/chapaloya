# Accesos, roles y barberías (versión demo)

## Cuentas iniciales
En la demo se crean la primera vez que se abre `login.html`: un superadministrador, un administrador y un barbero por barbería. Cada cuenta **debe cambiar su contraseña** en el primer ingreso. Las contraseñas iniciales ya no se publican aquí; pídelas al responsable del proyecto.

En producción las cuentas se crean en Supabase Auth (ver [supabase/README.md](supabase/README.md)).

- El **superadministrador** entra a **Reservalope** (`reservalope.html`), su consola propia. Desde ahí puede abrir el CRM de cualquier barbería y volver con el botón "Reservalope".
- Administradores y personal entran directo al CRM de su barbería (`crm.html`).

> Cambia las contraseñas iniciales antes de mostrar el sistema a terceros.

## Qué puede hacer cada rol

| Módulo | Superadmin | Administrador | Personal |
|---|---|---|---|
| Panel principal | ✔ | ✔ (ingresos solo si tiene Ventas) | ✔ sin ingresos |
| Citas | ✔ | Ver, crear, cambiar estado, eliminar | Ver, crear, cambiar estado (no eliminar) |
| Walk-in | ✔ | ✔ | Ver, crear, pasar a sillón y finalizar |
| Servicios | ✔ | ✔ | — |
| Barberos y portafolio | ✔ | ✔ | — |
| Usuarios | Todos | Solo personal de su barbería | — |
| Ventas · Clientes · Configuración · Historial | ✔ | Si se le otorga | — |
| Reportes (PDF / Excel) | ✔ todas las barberías | Si se le otorga (solo su barbería; montos solo si también tiene Ventas) | — |
| Barberías y permisos | ✔ | — | — |

- **Personal vinculado a un barbero:** solo ve y gestiona *sus* citas. Sin vínculo (por ejemplo, recepción) ve todas las citas de su barbería.
- **La cola walk-in** es compartida: todo el personal la ve completa.
- **Un administrador** nunca puede crear otros administradores, ver otra barbería ni cambiar sus propios permisos.

## Reservalope (consola del superadministrador)
| Sección | Qué muestra |
|---|---|
| Dashboard global | Periodo (hoy, 7 días, 30 días, mes, 90 días o rango propio) comparado con el periodo anterior. Ingresos, citas, completadas, cancelación, no-show, walk-in, clientes, ticket promedio, canal web vs CRM, ranking de barberías, MRR y suscripciones. |
| Barberías | Tabla comparativa de todas las barberías, con exportación a CSV. |
| Ficha de barbería | Paleta, KPIs, tendencia, barberos (ocupación), servicios, estados, horas pico, próximas citas, checklist de configuración, usuarios y actividad. |
| Reportes | Una barbería o todas (comparativo), con filtros y descarga en PDF o Excel. También desde el botón "Reportes" de cada ficha. |
| Alertas | Suscripción por vencer o vencida, cancelación/no-show altos, sin actividad 7 días, configuración incompleta, cuentas bloqueadas, almacenamiento alto. |
| Usuarios y accesos · Historial | Igual que antes, para todas las barberías. |
| Plataforma | Almacenamiento usado, respaldo (sin contraseñas), borrar datos demo y restablecer de fábrica. |

- Si las barberías usan monedas distintas, el total global las suma y muestra un aviso.
- Una suscripción vencida **solo genera alerta**; no suspende la barbería automáticamente.
- Precios de plan (Básico S/ 79, Pro S/ 149, Premium S/ 249) son valores de ejemplo editables por barbería.

## Barberías
- Cada barbería tiene su web: `index.html?b=enlace` (ej. `index.html?b=golden`, `index.html?b=navaja-norte`). El enlace se mantiene al navegar.
- El superadministrador crea barberías con: nombre, enlace, **paleta de 3 colores**, logo, dirección, teléfono, horario, moneda, plan, vencimiento y contacto del dueño.
- **Paleta:** primario (fondo), secundario (acento: botones y resaltados) y terciario (texto). Se guarda solo si el primario es más oscuro que el terciario, el texto tiene contraste ≥ 7:1 y el acento ≥ 4.5:1 sobre el fondo. La vista previa se actualiza al instante.
- **Suspender** una barbería oculta su web ("no disponible") y bloquea el ingreso de su personal. Los datos se conservan.
- Una barbería nueva empieza con el catálogo de servicios base y sin barberos. Su web muestra avisos amables hasta que se configure.

## Reportes (PDF y Excel)
- **Dónde:** CRM › Reportes (administrador con el permiso Reportes y superadministrador) y Reservalope › Reportes (por barbería o todas).
- **Filtros:** periodo (hoy, 7 días, 30 días, este mes, 90 días o fechas propias), barbería (solo Reservalope), barbero, servicio, estado, canal (web, CRM, presencial), tipo (citas, walk-in o ambos) y cliente por nombre o teléfono.
- **Contenido (se elige):** Resumen ejecutivo (indicadores vs. periodo anterior, por día y por servicio; en Reservalope además el comparativo por barbería) · Ventas e ingresos · Citas y walk-in · Barberos y clientes.
- **Vista previa** en pantalla con los mismos números del archivo (muestra 15 filas por tabla; las descargas incluyen todas).
- **PDF:** horizontal A4, con logo, nombre y colores de la barbería, filtros aplicados, quién lo generó, gráfico de ingresos por día y número de página.
- **Excel:** hoja Resumen + una hoja por tabla, con filtros de columna, encabezado fijo, fechas reales y formato de moneda.
- Un administrador **sin** el permiso de Ventas genera reportes sin montos (sin ingresos, ticket ni gasto).
- Cada descarga queda en el **Historial** ("Exportó un reporte": formato, contenido, periodo y filtros).
- Las librerías de exportación están en `js/vendor` (ExcelJS, jsPDF y jsPDF-AutoTable, licencia MIT) y funcionan sin internet.

## Catálogo de servicios
- El administrador (y el superadministrador) puede **agregar, editar y eliminar** servicios: nombre, categoría, precio, duración y descripción.
- Al cambiar nombre o precio se actualizan las citas pendientes desde hoy en adelante; el historial pasado conserva sus datos.
- Al eliminar se advierte si hay citas futuras con ese servicio. Siempre debe quedar al menos un servicio.

## Reglas de agenda
- No se puede reservar en días que ya pasaron ni en horarios de hoy que ya pasaron (web y CRM).
- Los horarios ocupados para ese barbero aparecen bloqueados ("Ocupado"); los pasados, como "Ya pasó".
- Si el día elegido ya no tiene horarios libres, la web salta al siguiente día disponible y lo avisa.
- La validación se repite al guardar, así que manipular el formulario no permite saltarse la regla.

## Datos demo
- Golden y **Navaja Norte** traen 90 días de historial + 2 semanas futuras para ver el dashboard con datos.
- Para quitarlos: Reservalope → Plataforma → **Borrar datos demo**. Elimina los registros de ejemplo y la barbería Navaja Norte con sus usuarios; no se regeneran.

## Seguridad de cuentas
- Contraseñas guardadas con sal + hash iterado (nunca en texto plano). Mínimo 8 caracteres, con letras y números.
- Contraseña temporal obligatoria de cambiar en el primer ingreso o tras un restablecimiento.
- 5 intentos fallidos bloquean la cuenta 15 minutos. Un administrador puede desbloquearla restableciendo la clave.
- La sesión expira a las 8 horas, o tras 60 minutos sin actividad.
- Los usuarios se **desactivan**, no se borran, para conservar el historial. Siempre debe quedar un superadministrador activo.
- Todo texto ingresado (por ejemplo, el nombre de un cliente en la web) se neutraliza para evitar inyección de código.

## Historial de actividad
Registra inicios de sesión, intentos fallidos, bloqueos, citas, walk-in, barberos, fotos, servicios, clientes, usuarios, permisos, barberías, configuración y reservas web. Se puede filtrar y exportar a CSV.

## Limitación importante (modo demo)
Todo se guarda en el **navegador** (`localStorage`):
- Los datos **no se comparten entre equipos**: cada computadora o celular tiene su propia copia.
- Quien tenga acceso al equipo puede alterar los datos con las herramientas del navegador. El login organiza el uso, pero **no es una barrera de seguridad real**.
- El espacio es limitado (~5 MB): muchas fotos grandes pueden llenarlo.

**Para producción** se reemplaza `js/data/db.js` y `js/core/auth.js` por un backend (por ejemplo, Supabase o una API propia). La interfaz, los roles y las reglas ya están separados para que ese cambio sea acotado.
