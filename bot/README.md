# Bot de WhatsApp de Reservalope

Programa que envía los mensajes de WhatsApp de todas las barberías y recibe sus respuestas. Usa el WhatsApp de cada barbería, vinculado como "dispositivo" (igual que WhatsApp Web).

Qué hace:

- **Envía la cola `wa_outbox`:** el aviso al equipo por cada reserva, cancelación o cambio; la confirmación al cliente; los recordatorios; y los mensajes de prueba. Espera entre 8 y 20 segundos entre un mensaje y otro.
- **Recibe las respuestas:** si el cliente escribe **CONFIRMAR** (o "sí", "ok"), la cita queda **Confirmada** y se le responde "Asistencia confirmada". Si escribe **BAJA**, deja de recibir recordatorios. Cualquier otro mensaje no se toca: lo contesta la barbería desde su celular.
- **Vincula y desvincula** cuando el administrador lo pide en **CRM → Configuración → WhatsApp** (el QR aparece ahí mismo).

> Importante: no es la API oficial de WhatsApp. Funciona como WhatsApp Web y es gratis, pero WhatsApp puede bloquear un número que envíe spam. Usa un número con antigüedad, escribe solo a clientes que aceptaron y no subas la cantidad de recordatorios.

---

## 1. Dónde instalarlo

Tiene que estar encendido todo el día. Sirve:

- **Una computadora de la barbería** con Windows que no se apague: lo más simple, ver [En una computadora con Windows](#en-una-computadora-con-windows-sin-servidor).
- **Una VM** con Ubuntu: gratis en Oracle Cloud "Always Free", o un VPS pequeño de pago (unos 5 dólares al mes).

No sirven los hostings que "duermen" cuando no hay visitas (Render gratis, Vercel, etc.): se cae la sesión de WhatsApp.

Un solo bot atiende a todas las barberías. **No enciendas dos bots a la vez**: WhatsApp cerraría la sesión.

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
sudo systemctl restart reservalope-bot       # reiniciar
```

## 6. Vincular el WhatsApp de una barbería

1. Ejecuta la migración `supabase/migrations/20261019000009_whatsapp_confirmar.sql` (una sola vez).
2. En el CRM de la barbería: **Configuración → WhatsApp → Vincular WhatsApp**.
3. En el celular de la barbería: **WhatsApp → Dispositivos vinculados → Vincular un dispositivo** y escanea el QR.
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

Sirve cualquier PC de la barbería con Windows 10 u 11 e internet. Mientras la PC esté encendida, los mensajes salen. Si se apaga, quedan en cola y salen al volver a encenderla, salvo los recordatorios cuya cita ya pasó.

1. **Que no se suspenda:** Configuración → Sistema → Inicio/apagado y batería (o *Energía*) → "Suspender" en **Nunca** cuando está enchufada.
2. **Node.js:** descarga la versión **22 LTS** de https://nodejs.org e instálala con las opciones por defecto.
3. **El bot:** en https://github.com/dvalenciaa01/chapaloya pulsa **Code → Download ZIP**, descomprímelo en `C:\reservalope` y entra a la carpeta `bot`.
4. **La clave de las sesiones:** abre **PowerShell** y ejecuta:
   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
   Copia el resultado (64 caracteres) y guárdalo en un lugar seguro.
5. **El archivo `.env`:** en la carpeta `bot`, copia `.env.example`, renombra la copia como `.env` y ábrela con el Bloc de notas. Completa `SUPABASE_URL`, `SUPABASE_SECRET_KEY` y `BOT_SESSION_KEY` (la del paso 4) y guarda. Si Windows la guarda como `.env.txt`, no pasa nada: el bot la corrige solo.
6. **Encenderlo:** doble clic en **`iniciar.bat`**. La primera vez instala lo que necesita. Cuando diga `Bot de Reservalope iniciado`, ya está. **No cierres esa ventana** (puedes minimizarla).
7. **Que arranque solo al prender la PC:** pulsa `Windows + R`, escribe `shell:startup` y Enter. En la carpeta que se abre, haz clic derecho → Nuevo → Acceso directo → elige `C:\reservalope\chapaloya-main\bot\iniciar.bat`.

Luego vincula el WhatsApp desde el CRM, como en el paso 6 de arriba.

Para actualizar: descarga el ZIP de nuevo, reemplaza la carpeta **conservando tu `.env` y la carpeta `sessions`**, y vuelve a abrir `iniciar.bat`.

## Seguridad

- La **Secret key** de Supabase da acceso total a la base: solo va en el `.env` de esta máquina.
- La carpeta `sessions/` es el acceso al WhatsApp de cada barbería. Está cifrada, pero no la compartas.
- El paquete de WhatsApp es el oficial `@whiskeysockets/baileys`, con la versión fijada en `package.json`. No instales forks con nombres parecidos.
