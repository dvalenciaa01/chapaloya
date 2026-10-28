# Base de datos en Supabase

Esta carpeta contiene la base de datos de producción de Reservalope. Reemplaza el `localStorage` de la demo.

| Archivo | Qué crea |
|---|---|
| `migrations/20261018000001_esquema.sql` | Tablas: barberías, usuarios, barberos, portafolio, servicios, clientes, citas, walk-in, historial y las tablas de WhatsApp |
| `migrations/20261018000002_permisos.sql` | Permisos por rol (RLS): cada barbería ve solo lo suyo; el personal vinculado ve solo sus citas |
| `migrations/20261018000003_reservas.sql` | Reglas de agenda (sin fechas pasadas ni dobles reservas), funciones de la web pública y `crear_reserva` |
| `migrations/20261018000004_whatsapp.sql` | Cola de mensajes: aviso a la barbería, confirmación, recordatorios configurables y respuestas 1 / 2 / BAJA |
| `migrations/20261019000005_fase1_app.sql` | Horarios ocupados para la web, uso de la base para Reservalope y el bucket `media` de Storage para fotos y logos |
| `migrations/20261019000006_horarios.sql` | Horario semanal por barbería y por barbero, fechas especiales (feriados, días libres) y hasta cuántos días adelante se puede reservar |
| `migrations/20261019000007_quitar_asesoria_ia.sql` | Retira la asesoría IA: borra la tabla `ai_consultations` y el módulo `ai` de los accesos |
| `migrations/20261019000008_historial_oculto.sql` | Oculta el Historial a todos los administradores hasta que el superadmin se lo habilite |
| `migrations/20261019000009_whatsapp_confirmar.sql` | WhatsApp: el cliente confirma respondiendo CONFIRMAR (ya no hay 1 / 2 ni cancelación por WhatsApp) y el bot solo toma mensajes de las barberías vinculadas |
| `migrations/20261021000010_correcciones_qa.sql` | Correcciones del QA del 21/10/2026: sin citas que se cruzan (usa la duración del servicio), reglas de estados, clave temporal obligatoria también en la base, permisos de clientes y del personal, nombres únicos, validaciones de la web, anticipación mínima, avisos de WhatsApp al cliente al cancelar o reprogramar, bajas por teléfono, horas de silencio y cola más segura |
| `migrations/20261022000011_rubros.sql` | Rubros: cada negocio elige su tipo (barbería, salón, spa, consultorio, clínica dental…) en `tenants.business_type` y puede personalizar las palabras en `tenants.labels`; `web_barberia` los devuelve; WhatsApp acepta `{negocio}` y `{profesional}` y las plantillas de fábrica pasan a textos neutros; mensajes de error sin "barbería" / "barbero" |
| `migrations/20261022000012_crm_personalizable.sql` | CRM personalizable por negocio (solo el superadmin): `tenants.crm_config` con módulos visibles, campos visibles u obligatorios, campos propios de clientes y citas, columnas de la tabla de citas, tema del CRM y portada de la web; clientes con correo, fecha de nacimiento, documento y dirección; `extra` en clientes y citas; `web_barberia` devuelve `booking_fields` y `site`; `crear_reserva` recibe `p_extra` |
| `migrations/20261026000013_enlaces_reservados.sql` | Enlaces reservados: ningún negocio puede llamarse como una ruta del sitio (`crm`, `admin`, `css`, `js`…), necesario para las direcciones limpias `/<enlace>` y `/crm/<enlace>` |
| `migrations/20261028000014_vista_citas.sql` | Vista de la pestaña Citas del CRM por negocio: `tenants.appt_view` (`agenda` por defecto o `lista`), la elige el administrador en **Configuración → Vista de citas** |
| `migrations/20261028000015_preferencias_crm.sql` | Preferencias del CRM que elige el administrador del negocio: `tenants.crm_prefs` (por ahora, qué tarjetas y secciones se ven en el Panel principal, desde **Configuración → Panel principal**) |
| `tests/supabase_stub.sql`, `tests/qa_10.sql`, `tests/rubros_11.sql` y `tests/crm_12.sql` | Solo para probar en un PostgreSQL local (no se ejecutan en Supabase) |
| `functions/admin-usuarios/` | Crear cuentas, restablecer contraseñas, editar y desactivar usuarios (solo superadmin, o admin con su personal) |
| `functions/reservar/` | Recibe las reservas de la web: verifica el captcha y crea la cita |

Probado en PostgreSQL 16 con las funciones de Supabase imitadas: permisos por rol, dobles reservas, horas de silencio, reprogramación, confirmación y cancelación por WhatsApp. Las migraciones 10, 11 y 12 tienen su propio script de pruebas (`tests/qa_10.sql`, `tests/rubros_11.sql` y `tests/crm_12.sql`).

---

## 1. Ejecutar las migraciones (una sola vez por proyecto)

Hazlo primero en el proyecto de **pruebas** y, cuando todo funcione, en el de **producción**.

1. Entra a tu proyecto en supabase.com → **SQL Editor** → **New query**.
2. Abre `20261018000001_esquema.sql`, copia todo, pégalo y pulsa **Run**. Debe decir *Success*.
3. Repite con los archivos `…02`, `…03`, `…04`, `…05`, `…06`, `…07`, `…08`, `…09`, `…10`, `…11`, `…12`, `…13` y `…14`, **en ese orden**.

> **Si ya ejecutaste del 1 al 13, solo falta el `…14`** (vista de citas). Solo agrega una columna: todos los negocios quedan con la agenda del día. Mientras no se ejecute, el CRM igual muestra la agenda y la elección de **Configuración → Vista de citas** se guarda solo en el navegador de quien la cambie.
>
> **Si ya ejecutaste del 1 al 11, solo falta el `…12`** (CRM personalizable) y volver a publicar la función `reservar` (paso 2), que ahora envía los campos propios de la reserva (`extra`). Se puede ejecutar con datos y repetir: todos los negocios quedan con `crm_config = {}`, es decir, el CRM se ve igual que antes hasta que el superadmin lo personalice desde Reservalope. Mientras no publiques la nueva `reservar`, la web sigue reservando, pero un negocio con campos propios **obligatorios** en la reserva no podrá recibir reservas.
>
> **Si ya ejecutaste del 1 al 10, solo falta el `…11`** (rubros) y volver a publicar las dos funciones (paso 2), que ahora responden con palabras neutras. Se puede ejecutar con datos y repetir: los negocios existentes quedan con el rubro *barbería* (nada cambia para ellos hasta que elijan otro en **Configuración**); las plantillas de WhatsApp que seguían iguales a las de fábrica pasan a las nuevas (`{negocio}`, `{profesional}`, 📅) y las personalizadas no se tocan.
>
> **Si ya ejecutaste del 1 al 9, falta el `…10`** (y luego el `…11`) y volver a publicar las dos funciones (paso 2). Se puede ejecutar con datos: si encuentra citas viejas que se cruzan las deja como están (la regla vale para las nuevas); si hay barberos o servicios con el mismo nombre muestra un *NOTICE* con la lista: renómbralos y vuelve a ejecutar el `…10` (es repetible) para que la base cree el índice de nombres únicos. Si avisa que una barbería tiene la configuración de WhatsApp mal formada, ábrela en el CRM y pulsa **Guardar WhatsApp**.
>
> Si ya ejecutaste del 1 al 8, falta el `…09` (y luego el `…10` y el `…11`). Si ya ejecutaste del 1 al 6, faltan el `…07` y el `…08` (y volver a publicar `admin-usuarios`). Si ya ejecutaste del 1 al 5, falta el `…06`. Las barberías existentes quedan con el horario de todos los días de 09:00 a 13:00 y de 14:00 a 20:30, citas cada 30 minutos; cada administrador lo cambia en **Configuración → Horario de atención**.

> Con la Supabase CLI también sirve: `supabase link` y luego `supabase db push`.

## 2. Publicar las dos funciones (Edge Functions)

Para cada una (`admin-usuarios` y `reservar`):

1. **Edge Functions → Deploy a new function → Via Editor**.
2. Nombre: exactamente `admin-usuarios` (o `reservar`).
3. Borra el código de ejemplo y pega el contenido de `functions/<nombre>/index.ts`.
4. Pulsa **Deploy function**.
5. En la función → **Details** (o *Settings*): **desactiva "Verify JWT"**. Las dos funciones verifican por su cuenta quién llama; con la verificación activada la web pública no podría reservar.

Luego, en **Edge Functions → Secrets** agrega:

| Secret | Valor | Dónde |
|---|---|---|
| `ALLOW_NO_CAPTCHA` | `true` | **Solo en pruebas**, mientras no haya captcha |
| `TURNSTILE_SECRET_KEY` | La *Secret key* de Cloudflare Turnstile | Producción (Fase 2) |
| `TURNSTILE_HOSTNAMES` | Opcional. Dominios donde está la web, separados por comas (p. ej. `reservalope.com,www.reservalope.com`). Si se pone, se rechaza un captcha resuelto en otro dominio | Producción |

> Tras ejecutar la migración `…10` hay que **volver a publicar las dos funciones** (pegar de nuevo el `index.ts` de cada una y *Deploy*): `admin-usuarios` ahora guarda la huella de la contraseña temporal y `reservar` traduce los errores y exige el captcha.

> `SUPABASE_URL` y la clave del servidor ya existen en las funciones; no hay que crearlas. Si la función respondiera "Falta configurar la clave del servidor", agrega el secret `SERVICE_KEY` con la *Secret key* del proyecto.

### Duración de las sesiones (Supabase Auth)

El CRM cierra la sesión tras 8 horas o 60 minutos sin uso, pero eso vive en el navegador. Para que también lo haga el servidor: **Authentication → Sessions** (en algunos paneles, *Auth → Settings → User Sessions*):

- **Time-box user sessions**: `8 hours`.
- **Inactivity timeout**: `1 hour`.
- **Single session per user** (opcional): actívalo si no quieres que una cuenta se use en dos equipos a la vez.

Estas opciones solo existen en los planes de pago (Pro o superior). En el plan gratuito no aparecen: entonces el límite queda solo en el navegador, y lo más seguro es bajar **JWT expiry** (Authentication → *JWT Keys/Settings*) a `3600` segundos, para que un token robado sirva como máximo una hora.

## 3. Crear el superadministrador

1. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña segura; marca *Auto Confirm User*.
2. En el **SQL Editor**, cambia el correo y ejecuta:

```sql
insert into public.profiles (id, email, name, role, must_change_password)
select id, email, 'Superadministrador', 'SUPERADMIN', false
from auth.users where email = 'TU-CORREO@ejemplo.com';
```

## 4. Crear el primer negocio (ejemplo: Golden)

También se puede crear desde Reservalope (**Negocios → Nuevo negocio**), que además carga el catálogo de servicios base.

```sql
insert into public.tenants (slug, name, business_type, owner_name, address, phone, hours, city, plan, plan_fee, subscription_end)
values ('golden', 'Golden Barbería', 'barberia', 'Nombre del dueño', 'Av. La Marina', '+51 999 999 999',
        'Citas de 9:00 a 20:00', 'Lima, Perú', 'PRO', 149, current_date + 30);
```

`business_type` es el rubro: `barberia`, `salon`, `spa`, `unas`, `consultorio`, `dental`, `psicologia`, `veterinaria`, `tatuajes`, `fitness` u `otro`.

Los profesionales, servicios y usuarios del negocio se cargarán con el script de migración de datos de la Fase 1, o desde el CRM cuando esté conectado.

## 5. Activar WhatsApp en un negocio

1. Instala y enciende el bot siguiendo [`bot/README.md`](../bot/README.md).
2. En el CRM del negocio: **Configuración → WhatsApp → Vincular WhatsApp** y escanea el QR con el celular del negocio.
3. Marca **Enviar mensajes automáticos por WhatsApp**, escribe los celulares que reciben el aviso de cada reserva y pulsa **Guardar WhatsApp**.

Ahí mismo se editan el mensaje al reservar, los recordatorios (cuántos y con cuántas horas de anticipación), las horas de silencio, y se ve el historial de envíos.

---

## Reglas importantes

- **Contraseñas olvidadas:** no se envían correos. El superadministrador (o el administrador, para su personal) pulsa **Clave** en Usuarios y entrega la contraseña temporal; al ingresar, el sistema pide crear una nueva.
- **La secret key** (antes "service_role") salta todos los permisos. Solo va en el bot y en las Edge Functions; nunca en la web ni en GitHub.
- **La web pública no lee tablas.** Usa `web_barberia`, `web_horarios` y `web_consultar_cita`, que devuelven solo datos públicos.
- **Las reservas web** se crean con `crear_reserva`, que solo puede llamar la Edge Function `reservar` (Fase 2) después de verificar el captcha.
- **"Mi cita"** exige celular y código de reserva; ya no basta con escribir un nombre.
- **Contraseña temporal:** mientras el usuario no la cambie, la base le niega todo salvo leer su perfil. Después de `supabase.auth.updateUser({ password })` el CRM llama a `perfil_contrasena_cambiada()`, que solo quita la marca si la contraseña de verdad cambió.
- **Citas:** ocupan desde su hora hasta hora + duración del servicio (`ends_at`); la base rechaza las que se cruzan o no caben antes del cierre o de un descanso. Estados: PROGRAMADA → CONFIRMADA_WSP / CANCELADA / COMPLETADA / NO_ASISTIO; CANCELADA es final; COMPLETADA y NO_ASISTIO solo cuando la cita ya empezó (y solo un admin corrige una por otra); reprogramar una confirmada la vuelve a PROGRAMADA. El personal solo cambia estado, notas, datos propios (`extra`) y fecha/hora.
- **Reservas web:** máximo 2 citas futuras por celular; anticipación mínima `tenants.booking_lead_minutes` (15 min por defecto); no se reciben si el negocio está suspendido o su suscripción venció hace más de 7 días.
- **Bajas de WhatsApp:** quien escribe BAJA queda en `wa_opt_outs` (por teléfono, aunque no tenga ficha). Para reactivarlo, quita la baja en la ficha del cliente o borra la fila.
- **CRM personalizable:** `tenants.crm_config` solo la cambia el superadministrador (o el servidor); el admin y el personal la leen y el CRM la aplica. `{}` = el CRM de siempre. La base rechaza claves o valores desconocidos (`private.crm_config_valida`). Los campos propios se guardan en `customers.extra` y `appointments.extra` (objeto de hasta 8 KB, valores texto ≤ 500, número o verdadero/falso); el personal también puede cambiar `appointments.extra`. Solo los campos de citas marcados `public` se piden en la web (`web_barberia → booking_fields`) y `crear_reserva` los valida.
- **Profesionales** (tabla `barbers`): se desactivan (`active = false`), no se borran, para conservar el historial de citas.
- **WhatsApp a clientes** solo si aceptaron (`wa_opt_in`). En el CRM habrá que marcar la casilla "Acepta WhatsApp" al crear la cita.
- **Rubro y palabras:** `tenants.business_type` (por defecto `barberia`) y `tenants.labels` (palabras propias: objeto con las claves de `js/core/vocab.js`, textos de 1 a 40 caracteres sin `<` `>` `"`). Solo los cambia el superadministrador o el administrador con el módulo Configuración.
- **Variables de las plantillas:** `{cliente} {telefono} {servicio} {profesional} {fecha} {hora} {cuando} {precio} {negocio} {direccion} {codigo}`. Las antiguas `{barbero}` y `{barberia}` siguen funcionando (son lo mismo que `{profesional}` y `{negocio}`). `{cuando}` dice "hoy", "mañana" o la fecha, según el momento real del envío.

---

## Probar las migraciones 10 y 11 en local

Con PostgreSQL 16 instalado (no en Supabase):

```bash
createdb reservalope_test
psql -d reservalope_test -f supabase/tests/supabase_stub.sql          # imita auth, roles y realtime
for f in supabase/migrations/2026101*_*.sql; do psql -v ON_ERROR_STOP=1 -d reservalope_test -f "$f"; done   # 1 a 9
psql -v ON_ERROR_STOP=1 -d reservalope_test -f supabase/tests/qa_10.sql   # carga datos viejos, aplica la 10 y prueba
```

Cada prueba imprime `OK …`; al final: `qa_10: todas las pruebas pasaron`.

Para la 11, en una base nueva con el stub y las migraciones 1 a 10 aplicadas:

```bash
createdb reservalope_11
psql -d reservalope_11 -f supabase/tests/supabase_stub.sql
for f in supabase/migrations/2026101*_*.sql supabase/migrations/20261021000010_*.sql; do psql -v ON_ERROR_STOP=1 -d reservalope_11 -f "$f"; done   # 1 a 10
psql -v ON_ERROR_STOP=1 -d reservalope_11 -f supabase/tests/rubros_11.sql   # aplica la 11 (dos veces) y prueba
```

Al final: `rubros_11: todas las pruebas pasaron`.
