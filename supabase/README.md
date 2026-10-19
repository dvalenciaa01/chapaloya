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
| `functions/admin-usuarios/` | Crear cuentas, restablecer contraseñas, editar y desactivar usuarios (solo superadmin, o admin con su personal) |
| `functions/reservar/` | Recibe las reservas de la web: verifica el captcha y crea la cita |

Probado en PostgreSQL 16 con las funciones de Supabase imitadas: permisos por rol, dobles reservas, horas de silencio, reprogramación, confirmación y cancelación por WhatsApp.

---

## 1. Ejecutar las migraciones (una sola vez por proyecto)

Hazlo primero en el proyecto de **pruebas** y, cuando todo funcione, en el de **producción**.

1. Entra a tu proyecto en supabase.com → **SQL Editor** → **New query**.
2. Abre `20261018000001_esquema.sql`, copia todo, pégalo y pulsa **Run**. Debe decir *Success*.
3. Repite con los archivos `…02`, `…03`, `…04`, `…05`, `…06` y `…07`, **en ese orden**.

> Si ya ejecutaste del 1 al 6, solo falta el `…07` (y volver a publicar `admin-usuarios`). Si ya ejecutaste del 1 al 5, falta el `…06`. Las barberías existentes quedan con el horario de todos los días de 09:00 a 13:00 y de 14:00 a 20:30, citas cada 30 minutos; cada administrador lo cambia en **Configuración → Horario de atención**.

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

> `SUPABASE_URL` y la clave del servidor ya existen en las funciones; no hay que crearlas. Si la función respondiera "Falta configurar la clave del servidor", agrega el secret `SERVICE_KEY` con la *Secret key* del proyecto.

## 3. Crear el superadministrador

1. **Authentication → Users → Add user → Create new user**: tu correo y una contraseña segura; marca *Auto Confirm User*.
2. En el **SQL Editor**, cambia el correo y ejecuta:

```sql
insert into public.profiles (id, email, name, role, must_change_password)
select id, email, 'Superadministrador', 'SUPERADMIN', false
from auth.users where email = 'TU-CORREO@ejemplo.com';
```

## 4. Crear la primera barbería (ejemplo: Golden)

También se puede crear desde Reservalope (**Barberías → Nueva barbería**), que además carga el catálogo de servicios base.

```sql
insert into public.tenants (slug, name, owner_name, address, phone, hours, city, plan, plan_fee, subscription_end)
values ('golden', 'Golden Barbería', 'Nombre del dueño', 'Av. La Marina', '+51 999 999 999',
        'Citas de 9:00 a 20:00', 'Lima, Perú', 'PRO', 149, current_date + 30);
```

Los barberos, servicios y usuarios de la barbería se cargarán con el script de migración de datos de la Fase 1, o desde el CRM cuando esté conectado.

## 5. Activar WhatsApp en una barbería (cuando el bot esté listo, Fase 3)

```sql
update public.tenants
set whatsapp = jsonb_set(jsonb_set(whatsapp, '{enabled}', 'true'),
                         '{notifyTo}', '["999999999"]')   -- celular(es) que reciben el aviso de cada reserva
where slug = 'golden';
```

Después se configurará desde la pestaña WhatsApp del CRM: plantillas, recordatorios (cuántos y con cuánta anticipación) y horas de silencio.

---

## Reglas importantes

- **Contraseñas olvidadas:** no se envían correos. El superadministrador (o el administrador, para su personal) pulsa **Clave** en Usuarios y entrega la contraseña temporal; al ingresar, el sistema pide crear una nueva.
- **La secret key** (antes "service_role") salta todos los permisos. Solo va en el bot y en las Edge Functions; nunca en la web ni en GitHub.
- **La web pública no lee tablas.** Usa `web_barberia`, `web_horarios` y `web_consultar_cita`, que devuelven solo datos públicos.
- **Las reservas web** se crean con `crear_reserva`, que solo puede llamar la Edge Function `reservar` (Fase 2) después de verificar el captcha.
- **"Mi cita"** exige celular y código de reserva; ya no basta con escribir un nombre.
- **Barberos:** se desactivan (`active = false`), no se borran, para conservar el historial de citas.
- **WhatsApp a clientes** solo si aceptaron (`wa_opt_in`). En el CRM habrá que marcar la casilla "Acepta WhatsApp" al crear la cita.
- **Variables de las plantillas:** `{cliente} {telefono} {servicio} {barbero} {fecha} {hora} {cuando} {precio} {barberia} {direccion} {codigo}`. `{cuando}` dice "hoy", "mañana" o la fecha, según el momento real del envío.
