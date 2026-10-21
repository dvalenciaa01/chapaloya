# Accesos, roles y negocios

## Cuentas iniciales
Las cuentas se crean en Supabase Auth (ver [supabase/README.md](supabase/README.md)) o desde **Usuarios y accesos**. Cada cuenta **debe cambiar su contraseña temporal** en el primer ingreso: hasta hacerlo, la base de datos no le da acceso a ningún dato.

- El **superadministrador** entra a **Reservalope** (`reservalope.html`), su consola propia. Desde ahí puede abrir el CRM de cualquier negocio y volver con el botón "Reservalope".
- Administradores y personal entran directo al CRM de su negocio (`crm.html`).

> Cambia las contraseñas iniciales antes de mostrar el sistema a terceros.

## Qué puede hacer cada rol

| Módulo | Superadmin | Administrador | Personal |
|---|---|---|---|
| Panel principal | ✔ | ✔ (ingresos solo si tiene Ventas) | ✔ sin ingresos |
| Citas | ✔ | Ver, crear, cambiar estado, eliminar | Ver, crear, cambiar estado (no eliminar) |
| Walk-in | ✔ | ✔ | Ver, crear, pasar a atención y finalizar |
| Servicios | ✔ | ✔ | — |
| Profesionales y portafolio | ✔ | ✔ | — |
| Usuarios | Todos | Solo personal de su negocio | — |
| Ventas · Clientes · Configuración | ✔ | Si se le otorga | — |
| Historial | ✔ | Oculto hasta que el superadmin se lo habilite | — |
| Reportes (PDF / Excel) | ✔ todos los negocios | Si se le otorga (solo su negocio; montos solo si también tiene Ventas) | — |
| Negocios y permisos | ✔ | — | — |

- **Personal vinculado a un profesional:** solo ve y gestiona *sus* citas. Sin vínculo (por ejemplo, recepción) ve todas las citas de su negocio.
- **La cola walk-in** es compartida: todo el personal la ve completa.
- **Un administrador** nunca puede crear otros administradores, ver otro negocio ni cambiar sus propios permisos.

## Reservalope (consola del superadministrador)
| Sección | Qué muestra |
|---|---|
| Dashboard global | Periodo (hoy, 7 días, 30 días, mes, 90 días o rango propio) comparado con el periodo anterior. Ingresos, citas, completadas, cancelación, no-show, walk-in, clientes, ticket promedio, canal web vs CRM, ranking de negocios, MRR y suscripciones. |
| Negocios | Tabla comparativa de todos los negocios, con exportación a CSV. |
| Ficha del negocio | Paleta, KPIs, tendencia, profesionales (ocupación), servicios, estados, horas pico, próximas citas, checklist de configuración, usuarios y actividad. |
| Reportes | Un negocio o todos (comparativo), con filtros y descarga en PDF o Excel. También desde el botón "Reportes" de cada ficha. |
| Alertas | Suscripción por vencer o vencida, cancelación/no-show altos, sin actividad 7 días, configuración incompleta, cuentas bloqueadas, almacenamiento alto. |
| Usuarios y accesos · Historial | Igual que antes, para todos los negocios. |
| Plataforma | Almacenamiento usado y respaldo (sin contraseñas). |

- Si los negocios usan monedas distintas, el total global las suma y muestra un aviso.
- Una suscripción vencida muestra un aviso en el CRM y en la consola. Las reservas web siguen 7 días después del vencimiento y luego se pausan hasta renovar.
- Precios de plan (Básico S/ 79, Pro S/ 149, Premium S/ 249) son valores de ejemplo editables por negocio.

## Negocios
- Cada negocio tiene su web: `index.html?b=enlace` (ej. `index.html?b=golden`, `index.html?b=navaja-norte`). El enlace se mantiene al navegar.
- El superadministrador crea negocios con: nombre, enlace, **paleta de 3 colores**, logo, dirección, teléfono, horario, moneda, plan, vencimiento y contacto del dueño.
- **Paleta:** primario (fondo), secundario (acento: botones y resaltados) y terciario (texto). Se guarda solo si el primario es más oscuro que el terciario, el texto tiene contraste ≥ 7:1 y el acento ≥ 4.5:1 sobre el fondo. La vista previa se actualiza al instante.
- **Suspender** un negocio oculta su web ("no disponible") y bloquea el ingreso de su personal. Los datos se conservan.
- Un negocio nuevo empieza con el catálogo de servicios base y sin profesionales. Su web muestra avisos amables hasta que se configure.
- **Rubro:** cada negocio elige su rubro (barbería, salón de belleza, spa, uñas, consultorio médico, clínica dental, psicología, veterinaria, tatuajes, fitness u otro). El rubro decide las palabras que ven el público y el equipo: "barbero" o "doctor", "cliente" o "paciente", "servicio" o "consulta", etc. El administrador con el permiso Configuración (o el superadministrador) puede cambiar el rubro y personalizar esas palabras; la base de datos rechaza el cambio a cualquier otra cuenta.

## Reportes (PDF y Excel)
- **Dónde:** CRM › Reportes (administrador con el permiso Reportes y superadministrador) y Reservalope › Reportes (por negocio o todos).
- **Filtros:** periodo (hoy, 7 días, 30 días, este mes, 90 días o fechas propias), negocio (solo Reservalope), profesional, servicio, estado, canal (web, CRM, presencial), tipo (citas, walk-in o ambos) y cliente por nombre o teléfono.
- **Contenido (se elige):** Resumen ejecutivo (indicadores vs. periodo anterior, por día y por servicio; en Reservalope además el comparativo por negocio) · Ventas e ingresos · Citas y walk-in · Profesionales y clientes.
- **Vista previa** en pantalla con los mismos números del archivo (muestra 15 filas por tabla; las descargas incluyen todas).
- **PDF:** horizontal A4, con logo, nombre y colores del negocio, filtros aplicados, quién lo generó, gráfico de ingresos por día y número de página.
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
- Los horarios ocupados para ese profesional aparecen bloqueados ("Ocupado"); los pasados, como "Ya pasó".
- Si el día elegido ya no tiene horarios libres, la web salta al siguiente día disponible y lo avisa.
- La validación se repite al guardar, así que manipular el formulario no permite saltarse la regla.

## Seguridad de cuentas
- Las contraseñas las guarda Supabase Auth (nunca en texto plano). Mínimo 8 caracteres, con letras y números.
- Contraseña temporal obligatoria de cambiar en el primer ingreso o tras un restablecimiento.
- 5 intentos fallidos bloquean la cuenta 15 minutos. Un administrador puede desbloquearla restableciendo la clave.
- La sesión expira a las 8 horas, o tras 60 minutos sin actividad.
- Los usuarios se **desactivan**, no se borran, para conservar el historial. Siempre debe quedar un superadministrador activo.
- Todo texto ingresado (por ejemplo, el nombre de un cliente en la web) se escapa al mostrarlo, para evitar inyección de código.
- Los permisos los aplica la base de datos (RLS), no solo la pantalla.

## Historial de actividad
Registra inicios de sesión, intentos fallidos, bloqueos, citas, walk-in, profesionales, fotos, servicios, clientes, usuarios, permisos, negocios, configuración y reservas web. Se puede filtrar y exportar a CSV.
