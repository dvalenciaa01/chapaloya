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

- **Una VM gratuita** (recomendado): Oracle Cloud "Always Free", Ubuntu 22.04 o 24.04, la más pequeña alcanza.
- **Una computadora de la barbería** que nunca se apague.

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

## En una computadora con Windows

Instala Node.js 22 desde nodejs.org, descarga el repositorio, abre una terminal en la carpeta `bot`, crea el `.env` como en el paso 3 y ejecuta `npm ci --omit=dev` y luego `npm start`. La ventana debe quedar abierta; si la computadora se reinicia, vuelve a ejecutar `npm start`.

## Seguridad

- La **Secret key** de Supabase da acceso total a la base: solo va en el `.env` de esta máquina.
- La carpeta `sessions/` es el acceso al WhatsApp de cada barbería. Está cifrada, pero no la compartas.
- El paquete de WhatsApp es el oficial `@whiskeysockets/baileys`, con la versión fijada en `package.json`. No instales forks con nombres parecidos.
