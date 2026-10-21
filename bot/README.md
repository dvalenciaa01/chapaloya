# Bot de WhatsApp de Reservalope

Programa que envía los mensajes de WhatsApp de todos los negocios y recibe sus respuestas. Usa el WhatsApp de cada negocio, vinculado como "dispositivo" (igual que WhatsApp Web).

Qué hace:

- **Envía la cola `wa_outbox`:** el aviso al equipo por cada reserva, cancelación o cambio; la confirmación al cliente; los recordatorios; y los mensajes de prueba. Cada negocio envía por su lado, esperando entre 8 y 20 segundos entre un mensaje y otro: si un negocio tiene mucha cola, no retrasa a los demás.
- **Recibe las respuestas:** si el cliente escribe **CONFIRMAR** (o "confirmar" y el código, si tiene varias citas), la cita queda **Confirmada** y se le responde una vez. Si escribe **BAJA**, deja de recibir recordatorios. Cualquier otro mensaje no se toca: lo contesta el negocio desde su celular. Si un mismo número escribe muchas veces seguidas (más de 5 en 10 minutos), el resto se ignora.
- **Vincula y desvincula** cuando el administrador lo pide en **CRM → Configuración → WhatsApp** (el QR aparece ahí mismo).

> Importante: no es la API oficial de WhatsApp. Funciona como WhatsApp Web y es gratis, pero WhatsApp puede bloquear un número que envíe spam. Usa un número con antigüedad, escribe solo a clientes que aceptaron y no subas la cantidad de recordatorios.

---

## 1. Dónde instalarlo

Tiene que estar encendido todo el día. Sirve:

- **Una VM** con Ubuntu: gratis en Oracle Cloud "Always Free", o un VPS pequeño de pago (unos 5 dólares al mes). **Es lo recomendado en producción con varios negocios**: el bot usa la *Secret key* de Supabase, que da acceso total a los datos de todos los negocios, y debe estar en un servidor que controle Reservalope, no en la PC de un negocio.
- **Una computadora con Windows** que no se apague, instalada como servicio: ver [En una computadora con Windows](#en-una-computadora-con-windows-sin-servidor). Sirve para un solo negocio o para pruebas, en una PC de confianza.

No sirven los hostings que "duermen" cuando no hay visitas (Render gratis, Vercel, etc.): se cae la sesión de WhatsApp.

Un solo bot atiende a todos los negocios. **No enciendas dos bots con los mismos negocios** (por ejemplo, en dos computadoras): WhatsApp cerraría la sesión. En una misma carpeta el bot ya lo impide solo: si hay uno encendido, el segundo se cierra sin conectarse (archivo `bot.lock`).

## 2. Instalar en la VM (Ubuntu)

Conéctate por SSH y ejecuta:

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Código
cd ~
git clone https://github.com/dvalenciaa01/chapaloya.git
cd chapaloya/bot
npm ci --omit=dev
```

## 3. Configurar

```bash
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"   # copia el resultado
nano .env
```

Completa:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API → Project URL |
| `SUPABASE_SECRET_KEY` | Supabase → Project Settings → API Keys → **Secret key** |
| `BOT_SESSION_KEY` | El texto de 64 caracteres que generaste arriba. Guárdalo: si se pierde, hay que volver a vincular cada WhatsApp |

Guarda con `Ctrl + O`, `Enter` y sal con `Ctrl + X`.

## 4. Probar

```bash
npm start
```

Debe decir `Bot de Reservalope iniciado`. Si dice que no se pudo conectar con Supabase, revisa la URL y la Secret key. Detén la prueba con `Ctrl + C`.

## 5. Dejarlo encendido siempre

```bash
sudo cp reservalope-bot.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now reservalope-bot
```

Si tu usuario no es `ubuntu`, cambia `User=` y `WorkingDirectory=` en el archivo antes de copiarlo.

Comandos útiles:

```bash
sudo systemctl status reservalope-bot        # ¿está encendido?
journalctl -u reservalope-bot -f             # ver lo que hace en vivo
tail -f ~/chapaloya/bot/logs/bot.log         # el mismo registro, en archivo (rota cada día o a los 5 MB)
sudo systemctl restart reservalope-bot       # reiniciar
```

## 6. Vincular el WhatsApp de un negocio

1. Ejecuta la migración `supabase/migrations/20261019000009_whatsapp_confirmar.sql` (una sola vez).
2. En el CRM del negocio: **Configuración → WhatsApp → Vincular WhatsApp**.
3. En el celular del negocio: **WhatsApp → Dispositivos vinculados → Vincular un dispositivo** y escanea el QR.
4. Cuando diga **Conectado**, marca **Enviar mensajes automáticos por WhatsApp**, escribe los celulares que deben recibir el aviso de cada reserva y pulsa **Guardar WhatsApp**.
5. Usa **Enviar prueba** con tu celular para comprobarlo.

## 7. Actualizar el bot

```bash
cd ~/chapaloya && git pull
cd bot && npm ci --omit=dev
sudo systemctl restart reservalope-bot
```

Las sesiones vinculadas se conservan (carpeta `bot/sessions/`, cifrada con `BOT_SESSION_KEY`).

## En una computadora con Windows (sin servidor)

Sirve cualquier PC con Windows 10 u 11 e internet. Mientras la PC esté encendida, los mensajes salen. Si se apaga, quedan en cola y salen al volver a encenderla, salvo los recordatorios cuya cita ya pasó.

> Antes de elegir esta opción lee [Seguridad](#seguridad): quien tenga acceso de administrador a esa PC puede leer la *Secret key*, que abre los datos de **todos** los negocios.

1. **Que no se suspenda:** Configuración → Sistema → Inicio/apagado y batería (o *Energía*) → "Suspender" en **Nunca** cuando está enchufada.
2. **Node.js:** descarga la versión **22 LTS** de https://nodejs.org e instálala con las opciones por defecto.
3. **El bot:** en https://github.com/dvalenciaa01/chapaloya pulsa **Code → Download ZIP**, descomprímelo en `C:\reservalope` y entra a la carpeta `bot`.
4. **La clave de las sesiones:** abre **PowerShell** y ejecuta:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copia el resultado (64 caracteres) y guárdalo en un lugar seguro.
5. **El archivo `.env`:** en la carpeta `bot`, copia `.env.example`, renombra la copia como `.env` y ábrela con el Bloc de notas. Completa `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `BOT_SESSION_KEY` (la del paso 4) y guarda. Si Windows la guarda como `.env.txt`, no pasa nada: se corrige solo.
   *Opcional:* en vez de dejarlo en la carpeta del bot, puedes guardarlo como `C:\ProgramData\Reservalope\bot.env` (o en la ruta que indique la variable de sistema `BOT_ENV_FILE`); así no viaja si alguien copia la carpeta del bot.
6. **Probarlo:** doble clic en **`iniciar.bat`**. La primera vez instala lo que necesita. Cuando diga `Bot de Reservalope iniciado`, funciona. Ciérralo con `Ctrl + C` (o cerrando la ventana).
7. **Instalarlo como servicio:** doble clic en **`instalar-servicio.bat`** y acepta el permiso de administrador. Esto:
   - crea la tarea programada **"Reservalope Bot"**, que enciende el bot al prender la PC **aunque nadie inicie sesión**, sin ventana (no se puede cerrar por error) y lo vuelve a encender si se cae;
   - deja el `.env` y la carpeta `sessions` (y `logs`) visibles solo para SYSTEM y Administradores;
   - quita los accesos directos antiguos a `iniciar.bat` de la carpeta de Inicio, si había.

   Al terminar dice si el bot quedó encendido. Desde ahí **ya no uses `iniciar.bat`** (si lo abres, avisa que el servicio ya está y se cierra).

Luego vincula el WhatsApp desde el CRM, como en el paso 6 de arriba.

**Ver qué hace:** abre `logs\bot.log` (como administrador si el servicio está instalado). Se crea un archivo nuevo cada día o al pasar de 5 MB y se guardan los 10 últimos. Los arranques y errores graves del servicio quedan en `logs\servicio.log`. También puedes abrir http://127.0.0.1:8080 en esa PC.

**Quitar el servicio:** doble clic en **`desinstalar-servicio.bat`**. Apaga el bot con calma, borra la tarea y devuelve los permisos normales a `.env`, `sessions` y `logs`.

**Actualizar:** descarga el ZIP de nuevo y copia los archivos nuevos **encima** de la carpeta `bot` (no borres `.env` ni `sessions`). Después vuelve a ejecutar `instalar-servicio.bat`: apaga el bot viejo y enciende el nuevo.

## Si algo falla

| En el CRM o en el registro | Qué hacer |
|---|---|
| "WhatsApp bloqueó este número" | WhatsApp suspendió el número. Revísalo en el celular; si lo recuperas, pulsa **Vincular WhatsApp**. El bot no reintenta solo. |
| "Sesión dañada: vuelve a vincular" | La sesión guardada no sirve y se borró. Pulsa **Vincular WhatsApp**. |
| "WhatsApp rechazó este dispositivo vinculado" | Actualiza WhatsApp en el celular y vuelve a vincular. |
| "No se pudo reconectar con WhatsApp tras muchos intentos" | El bot estuvo horas sin internet. Pulsa **Vincular WhatsApp**: reconecta sin perder la vinculación. |
| "Ya hay un bot de Reservalope encendido" | Hay otro bot en la misma carpeta (o el servicio). No abras otro. |
| "No se pudo guardar el resultado del envío; queda en el diario local" | Supabase no respondió. El resultado queda en `marcados-pendientes.json` y se guarda solo cuando vuelva la conexión; mientras tanto no se envía nada nuevo (para no duplicar mensajes). |

## Seguridad

- La **Secret key** de Supabase da **acceso total a la base de todos los negocios** (salta todos los permisos). Solo va en el `.env` del bot. Para producción con varios negocios, **el bot debe correr en un servidor controlado por Reservalope** (sección 2), no en la PC de un negocio: quien sea administrador de esa PC, o se la lleve, puede leer la clave aunque el servicio proteja el archivo.
- Si alguna vez la clave estuvo en una PC que ya no controlas, **cámbiala** en Supabase (Project Settings → API Keys) y actualiza el `.env`.
- La carpeta `sessions/` es el acceso al WhatsApp de cada negocio. Está cifrada con `BOT_SESSION_KEY`, pero no la compartas ni la copies junto con el `.env`.
- El paquete de WhatsApp es el oficial `@whiskeysockets/baileys`, con la versión fijada en `package.json` (7.0.0-rc14: al 21/10/2026 todavía no hay una 7.x estable publicada). No instales forks con nombres parecidos.
