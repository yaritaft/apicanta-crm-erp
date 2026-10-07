# Lector de WhatsApp para Apicanta (sólo lectura)

Un servicio chico que corre en un servidor propio (el VPS de Hostinger), con **un número de WhatsApp conectado por
código QR**, y **lee** los grupos de los webinars para que Apicanta sepa solo **quién se unió** y quién no. En la
ficha de cada webinar se ve quién está «Unida», quién «No unida» y se puede copiar la lista de los que faltan.

**No manda mensajes. No marca nada como leído. No aparece «en línea».** Sólo mira quién entra y quién sale de los
grupos y se lo avisa a la app. Está hecho para que no pueda hacer otra cosa: el lector no trabaja con la conexión de
WhatsApp directamente sino con un envoltorio que tira un error ante cualquier cosa que no sea mirar
(`src/solo-lectura.js`, con pruebas).

## Lo que hay que saber antes (con honestidad)

- **Es una conexión no oficial.** Usa [Baileys](https://github.com/WhiskeySockets/Baileys), una librería que habla el
  protocolo de WhatsApp Web sin ser de WhatsApp. No es la API oficial (WhatsApp Business API). Aunque el lector sólo
  lea, **WhatsApp podría bloquear el número** o cambiar el protocolo y romperlo hasta que salga una versión nueva de
  la librería. Es lo que se hace en BlueHackers, pero el riesgo existe.
- **Usá un número dedicado**, no el principal del negocio ni uno personal. Tiene que estar en un teléfono (o una SIM)
  que se mantenga: si el teléfono pasa unos 14 días sin conectarse a internet, WhatsApp desvincula los dispositivos
  vinculados y hay que escanear el QR de nuevo.
- **El número tiene que ser miembro de cada grupo** que se quiere vigilar (se lo agrega como a cualquier persona). El
  lector sólo ve los grupos en los que está.
- Los miembros del grupo van a ver ese número entre los participantes. Conviene ponerle un nombre claro («Hackear IT»).
- **Algunos participantes no muestran su teléfono.** WhatsApp está pasando a identificar a la gente por un id interno
  (LID) y, según la privacidad de cada uno y la versión de la librería, el teléfono puede no estar. A esos el lector
  los **cuenta aparte**: informa el total pero **no los manda** (no hay con qué compararlos). Mientras un grupo tenga
  participantes así, la app **no marca a nadie como «salió» por una foto** (no sabe si se fue o si quedó oculto): sólo
  por los avisos de «salió». Los números pueden quedar un poco por debajo de la realidad.
- Los teléfonos son datos personales. Quedan sólo en la base de Apicanta, y los ve quien ve los Webinars. Nunca se
  escriben en los registros del servicio.

## Cómo funciona

1. Al conectarse, el lector trae los grupos del número, se queda con los que coinciden con `GRUPOS_REGEX` y manda a
   la app una **«foto»** de cada uno: la lista completa de teléfonos.
2. Después escucha quién **entra** y quién **sale** y lo avisa (junta lo que pasa en 2 segundos en un solo pedido).
3. Cada 6 horas (`FOTO_CADA_HORAS`) vuelve a mandar la foto de cada grupo: si se perdió un aviso, queda corregido.
4. Cada 2 minutos manda un **latido**: «sigo vivo, y estoy conectado a WhatsApp sí / no». Si pasan 15 minutos sin
   latido, o el número lleva 15 minutos desconectado, la app muestra un aviso en Webinars.
5. Si se cae la conexión, reintenta con espera creciente (2 s, 4 s, 8 s… hasta 5 minutos) y avisa con el latido
   `conectado: false`. Si WhatsApp cerró la sesión (se desvinculó el dispositivo), **no insiste**: espera que alguien
   escanee el QR de nuevo.

Habla con la app por dos rutas, con un secreto compartido en `Authorization: Bearer …`:

| Ruta | Para qué |
|---|---|
| `POST /api/whatsapp/grupos` | `{ grupo: { id, nombre }, participantes: [teléfonos], evento: "foto" \| "entro" \| "salio", en }` (y `total`, `sinTelefono` en las fotos) |
| `POST /api/whatsapp/latido` | `{ en, conectado, grupos }` |

## Paso a paso (Ubuntu en Hostinger)

### 0. En la app (una vez)

1. Correr `supabase/whatsapp-lector.sql` en el SQL Editor de Supabase (crea las tablas del lector).
2. Inventar el secreto y ponerlo en Vercel como `WHATSAPP_LECTOR_TOKEN`:
   ```bash
   openssl rand -hex 32
   ```
   Después de agregar la variable en Vercel hay que **volver a publicar** para que la tome. Guardá el secreto en un
   lugar seguro: lo vas a necesitar en el paso 5. **No lo escribas en el repo ni en un chat.**

### 1. Entrar al servidor y crear un usuario

Con los accesos que da Hostinger (SSH desde la terminal):

```bash
ssh root@<IP_DEL_VPS>
adduser lector            # le pone una clave; el resto de las preguntas se pueden dejar vacías
```

### 2. Instalar Node.js

El lector necesita **Node 20 como mínimo**. Node 20 ya no recibe actualizaciones de seguridad (terminó en abril de
2026), así que lo mejor es la versión LTS vigente; abajo va la 22, y el servicio corre igual en 20, 22 o 24.

```bash
apt-get update
apt-get install -y ca-certificates curl gnupg git build-essential
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
NODE_MAJOR=22      # o 20
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_$NODE_MAJOR.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt-get update
apt-get install -y nodejs
node -v            # tiene que decir v20 o más
```

(`git` y `build-essential` por si alguna dependencia de Baileys se baja de GitHub o necesita compilarse.)

### 3. Copiar la carpeta al servidor

Desde tu compu, parado en la carpeta del repo de Apicanta:

```bash
rsync -av --exclude node_modules --exclude auth --exclude .env \
  servicios/whatsapp-lector/ lector@<IP_DEL_VPS>:/home/lector/whatsapp-lector/
```

(o con `scp -r servicios/whatsapp-lector lector@<IP_DEL_VPS>:/home/lector/`). Después, en el servidor, como el usuario
`lector`:

```bash
su - lector
cd whatsapp-lector
npm install
```

> **Versión de Baileys.** El `package.json` trae `7.0.0-rc14`, la versión actual de la librería. Si en BlueHackers ya
> andás con otra que te funciona, usá esa (`npm install @whiskeysockets/baileys@<versión>`); la rama estable anterior
> es la `6.7.24`. El lector entiende las dos formas en que Baileys entrega los participantes de un grupo (textos en la
> 6.7; objetos con `id`, `lid` y `phoneNumber` en la 7).

### 4. Completar el `.env`

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Completá `APP_URL` (la dirección de Apicanta, sin barra al final), `WHATSAPP_LECTOR_TOKEN` (el mismo valor que en
Vercel) y `GRUPOS_REGEX` (por ejemplo `webinar|taller`: se prueba contra el **nombre** del grupo, sin distinguir
mayúsculas; vacío mira todos los grupos del número).

### 5. Probar sin WhatsApp

```bash
npm run simulado
```

Manda a la app lo que dice `ejemplos/simulado.json` (un grupo con 10 participantes, uno que entra, uno que sale…).
Si sale `Simulación terminada: 5 enviados, 0 fallidos, 2 salteados` (con `GRUPOS_REGEX=webinar|taller`; el grupo VIP del
ejemplo no coincide y se saltea), la app, el token y las tablas están bien. En Apicanta →
**Ajustes → WhatsApp** tiene que aparecer el grupo «Webinar 08/10 - Grupo 1». Si algo falla, el mensaje dice qué
(ver «Cuando algo anda mal»).

### 6. La primera vez: escanear el QR

```bash
npm start
```

Aparece un código QR en la terminal. **Manu lo escanea** con el teléfono del número del lector: WhatsApp → **Ajustes →
Dispositivos vinculados → Vincular un dispositivo**. Cuando diga `Conectado a WhatsApp (sólo lectura)` y
`Vigilo N grupo(s)`, ya está. Cortalo con `Ctrl+C`: la sesión quedó guardada en la carpeta `auth/`.

Si el QR sale cortado o ilegible, agrandá la ventana de la terminal. El QR cambia cada ~20 segundos: si se vence, el
lector muestra uno nuevo.

### 7. Dejarlo andando

Dos opciones; usá **una**.

**A. pm2** (la más simple):

```bash
exit                                   # volvé a root
npm install -g pm2
su - lector
cd whatsapp-lector
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup                            # imprime un comando con sudo: copialo y pegalo (como root)
```

Los registros: `pm2 logs apicanta-whatsapp-lector`. Reiniciar: `pm2 restart apicanta-whatsapp-lector`. Parar:
`pm2 stop apicanta-whatsapp-lector`. Estado: `pm2 status`.

**B. systemd** (sin instalar nada más):

```bash
# como root
mkdir -p /opt/apicanta-whatsapp-lector
cp -a /home/lector/whatsapp-lector/. /opt/apicanta-whatsapp-lector/
chown -R lector:lector /opt/apicanta-whatsapp-lector
cp /opt/apicanta-whatsapp-lector/deploy/whatsapp-lector.service /etc/systemd/system/apicanta-whatsapp-lector.service
systemctl daemon-reload
systemctl enable --now apicanta-whatsapp-lector
systemctl status apicanta-whatsapp-lector
```

Los registros: `journalctl -u apicanta-whatsapp-lector -f`. Reiniciar: `systemctl restart apicanta-whatsapp-lector`.
Si Node no está en `/usr/bin/node` (`which node` lo dice), cambiá `ExecStart` en el archivo del servicio.

### 8. Verificar en la app

En **Ajustes → WhatsApp** tiene que decir **Conectado**, con el último latido de hace un par de minutos, y la lista de
grupos detectados. En cada uno se elige a qué webinar corresponde (la app sugiere el webinar si el nombre del grupo
trae la fecha). Después, en la ficha de ese webinar, aparece la vista del grupo de WhatsApp.

## Día a día

| Quiero… | pm2 | systemd |
|---|---|---|
| Ver los registros | `pm2 logs apicanta-whatsapp-lector` | `journalctl -u apicanta-whatsapp-lector -f` |
| Ver si está vivo | `pm2 status` | `systemctl status apicanta-whatsapp-lector` |
| Reiniciarlo | `pm2 restart apicanta-whatsapp-lector` | `systemctl restart apicanta-whatsapp-lector` |
| Pararlo | `pm2 stop apicanta-whatsapp-lector` | `systemctl stop apicanta-whatsapp-lector` |

**Actualizar el servicio:** copiá la carpeta de nuevo (`rsync`, como en el paso 3: **sin tocar `auth/` ni `.env`**),
corré `npm install` y reiniciá.

**Qué se ve en los registros** (una línea por cosa, con la hora de Argentina; nunca teléfonos):

```
07/10 15:02:11 INFO  Conectado a WhatsApp (sólo lectura).
07/10 15:02:14 INFO  Vigilo 2 grupo(s) (al conectar).
07/10 15:02:14 INFO  «Webinar 08/10 - Grupo 1»: 812 con teléfono y 3 sin teléfono visible (se cuentan, no se mandan).
07/10 15:05:40 INFO  «Webinar 08/10 - Grupo 1»: entraron 4.
```

## Si pide escanear de nuevo

Pasa si en el teléfono se **desvincula el dispositivo** (WhatsApp → Dispositivos vinculados → cerrar sesión), si el
teléfono estuvo mucho tiempo sin conexión, o si WhatsApp invalida la sesión. En los registros aparece:
`Se cerró la sesión de WhatsApp… No reintento: hay que escanear el QR de nuevo`, y en la app, **«Sin conexión con
WhatsApp»**. Para volver a conectarlo:

```bash
# parar el servicio
pm2 stop apicanta-whatsapp-lector              # o: sudo systemctl stop apicanta-whatsapp-lector
cd /home/lector/whatsapp-lector                # o /opt/apicanta-whatsapp-lector
mv auth auth.vieja                             # no se borra por si hace falta mirarla
npm start                                      # aparece el QR: que Manu lo escanee
# cuando diga «Conectado a WhatsApp», Ctrl+C
rm -rf auth.vieja
pm2 start apicanta-whatsapp-lector             # o: sudo systemctl start apicanta-whatsapp-lector
```

Los datos de los grupos que ya estaban en la app **no se pierden**: la próxima foto los pone al día.

## Cuando algo anda mal

| Qué dice | Qué significa y qué hacer |
|---|---|
| `La app rechazó el token (401)` | `WHATSAPP_LECTOR_TOKEN` del `.env` no es el mismo que en Vercel (o en Vercel falta publicar de nuevo). |
| `La app contestó 503` / `falta la variable WHATSAPP_LECTOR_TOKEN` | La app no tiene la variable `WHATSAPP_LECTOR_TOKEN`, o le falta `SUPABASE_SERVICE_ROLE_KEY`. |
| `Faltan las tablas de WhatsApp` | Falta correr `supabase/whatsapp-lector.sql`. |
| `No se pudo conectar con la app` | `APP_URL` mal escrita, o el servidor no sale a internet. Probá `curl -I <APP_URL>`. |
| `La hora del lector difiere N minutos` | El reloj del servidor está mal: `timedatectl set-ntp true`. |
| `Ningún grupo… coincide con GRUPOS_REGEX` | El número no está en esos grupos, o la expresión no calza con los nombres. Vaciala para ver todos. |
| `Otra copia del lector está usando esta misma sesión` | Hay dos lectores con la misma carpeta `auth/` (por ejemplo, uno de pruebas en tu compu). Dejá uno solo. |
| En la app: «Sin señal hace N minutos» | El servicio no está corriendo o el servidor no tiene internet. `pm2 status` / `systemctl status`. |
| En la app: «Sin conexión con WhatsApp» | El servicio está vivo pero WhatsApp se cortó. Si no vuelve solo, ver «Si pide escanear de nuevo». |

## Variables de entorno

| Variable | Qué es | Por defecto |
|---|---|---|
| `APP_URL` | La dirección de Apicanta, sin barra al final. **Obligatoria.** | — |
| `WHATSAPP_LECTOR_TOKEN` | El secreto compartido con la app (el mismo que en Vercel). **Obligatoria.** | — |
| `GRUPOS_REGEX` | Qué grupos mirar, por el nombre (sin distinguir mayúsculas). Vacía: todos. | todos |
| `AUTH_DIR` | Dónde se guarda la sesión de WhatsApp. | `./auth` |
| `LATIDO_CADA_SEG` | Cada cuánto avisa que sigue vivo (10 a 600). | `120` |
| `FOTO_CADA_HORAS` | Cada cuánto manda la lista completa de cada grupo (0: nunca). | `6` |
| `LOG_LEVEL` | `trace`, `debug`, `info`, `warn` o `error` (con `debug` también habla Baileys). | `info` |

## Seguridad

- **La carpeta `auth/` es la sesión de WhatsApp del número**: quien la copie puede leer sus chats. No se sube al repo
  (el repo de Apicanta es público; `.gitignore` la excluye), no se comparte y se cuida con permisos:
  `chmod 700 auth` y `chmod 600 .env`.
- El servicio **no abre ningún puerto**: sólo hace conexiones hacia afuera (a WhatsApp y a la app).
- Si el servidor se ve comprometido o se filtró el token: cambiá `WHATSAPP_LECTOR_TOKEN` en Vercel y en el `.env`, y en
  el teléfono cerrá la sesión de «Dispositivos vinculados».
- El token se manda en un encabezado, nunca en la dirección; la app lo compara en tiempo constante y sin él contesta 401.

## Probarlo sin WhatsApp

`npm run simulado` (o `node src/index.js --simulado otro-archivo.json`) manda a la app lo que dice el archivo, con los
mismos cuerpos y el mismo cliente que el lector de verdad, y respeta `GRUPOS_REGEX`. El archivo es una lista de
`pasos`:

```json
{ "pasos": [
  { "tipo": "latido", "conectado": true, "grupos": 1 },
  { "tipo": "foto",  "grupo": { "id": "120363000000000001@g.us", "nombre": "Webinar 08/10" },
    "participantes": [ "5491155550001@s.whatsapp.net", { "id": "1000@lid", "phoneNumber": "5491155550003@s.whatsapp.net" }, { "id": "2000@lid" } ] },
  { "tipo": "entro", "grupo": { "id": "120363000000000001@g.us", "nombre": "Webinar 08/10" }, "participantes": [ "5491155550011@s.whatsapp.net" ] },
  { "tipo": "salio", "grupo": { "id": "120363000000000001@g.us", "nombre": "Webinar 08/10" }, "participantes": [ "5491155550001@s.whatsapp.net" ], "haceMin": 2 },
  { "tipo": "esperar", "ms": 1000 }
] }
```

Los participantes se escriben como los entrega Baileys (un texto, o un objeto con el LID y el teléfono). Un paso puede
llevar `haceMin` para que «haya pasado hace tantos minutos». Para probar contra la app en tu compu: `APP_URL=http://localhost:3010`
y un `WHATSAPP_LECTOR_TOKEN` de prueba (el mismo en la app y acá) en tu entorno, nunca en el repo.

Las pruebas del servicio (no necesitan WhatsApp ni internet): `npm test`. Cubren los participantes (con y sin teléfono,
las dos versiones de Baileys), los cuerpos, los reintentos, el filtro de grupos, el envoltorio de sólo lectura y el
lector entero con un WhatsApp de mentira (conexión, avisos en lote, latidos, caídas, sesión cerrada).

**Lo que no se puede probar sin un número real:** la conexión de verdad con WhatsApp (el QR, los eventos tal como los
emite la librería instalada y cómo se comporta con grupos grandes). Las formas de los datos están tomadas de los tipos
de Baileys, pero la primera vez en el servidor conviene mirar los registros un rato.
