# Lector de WhatsApp para Apicanta (sólo lectura)

Un servicio chico que corre siempre en un servidor propio (el VPS de Hostinger), con **un número de WhatsApp
dedicado vinculado como dispositivo**, y **lee** los grupos de los talleres para que Apicanta sepa solo **quién se
unió** y quién no. En Formularios cada persona que se anotó dice si está en el grupo, y en la ficha de cada webinar se
elige cuál es su grupo.

**No manda mensajes. No marca nada como leído. No aparece «en línea».** Sólo mira quién entra y quién sale de los
grupos y se lo avisa a la app. Está hecho para que no pueda hacer otra cosa: el lector no trabaja con la conexión de
WhatsApp directamente sino con un envoltorio que tira un error ante cualquier cosa que no sea mirar
(`src/solo-lectura.js`, con pruebas).

**Para vincular el número no hace falta una terminal.** Cuando WhatsApp pide escanear, el lector manda el código QR a la
app y se escanea desde **Ajustes → WhatsApp**, con el teléfono del número dedicado. Si algún día WhatsApp cierra la
sesión, el lector empieza otra vinculación solo y vuelve a mostrar el código ahí: nadie tiene que entrar al servidor.

## Lo que hay que saber antes (con honestidad)

- **Es una conexión no oficial.** Usa [Baileys](https://github.com/WhiskeySockets/Baileys), una librería que habla el
  protocolo de WhatsApp Web sin ser de WhatsApp. No es la API oficial (WhatsApp Business API). Aunque el lector sólo
  lea, **WhatsApp podría bloquear el número** o cambiar el protocolo y romperlo hasta que salga una versión nueva de
  la librería. Es lo que se hace en BlueHackers, pero el riesgo existe.
- **Usá un número dedicado**, no el principal del negocio ni uno personal. Tiene que estar en un teléfono (o una SIM)
  que se mantenga: si el teléfono pasa unos 14 días sin conectarse a internet, WhatsApp desvincula los dispositivos
  vinculados y hay que escanear el código de nuevo.
- **El número tiene que ser miembro de cada grupo** que se quiere vigilar (se lo agrega como a cualquier persona). El
  lector sólo ve los grupos en los que está.
- Los miembros del grupo van a ver ese número entre los participantes. Conviene ponerle un nombre claro («Hackear IT»).
- **Algunos participantes no muestran su teléfono.** WhatsApp está pasando a identificar a la gente por un id interno
  (LID) y, según la privacidad de cada uno y la versión de la librería, el teléfono puede no estar. A esos el lector
  los **cuenta aparte**: informa el total pero **no los manda** (no hay con qué compararlos). Mientras un grupo tenga
  participantes así, la app **no marca a nadie como «salió» por una foto** (no sabe si se fue o si quedó oculto): sólo
  por los avisos de «salió». Los números pueden quedar un poco por debajo de la realidad.
- **El código QR es una credencial.** Quien lo escanea con su teléfono lee los chats de ese WhatsApp. Por eso la app se
  lo muestra sólo a un dueño (o a quien edita Ajustes), lo guarda aparte en una tabla que no se puede leer desde el
  navegador, lo borra apenas el número se conecta, y el lector nunca lo escribe en sus registros.
- Los teléfonos son datos personales. Quedan sólo en la base de Apicanta, y los ve quien ve los Webinars. Nunca se
  escriben en los registros del servicio.

## Cómo funciona

1. Al conectarse, el lector trae los grupos del número, se queda con los que coinciden con `GRUPOS_REGEX` (en
   producción, `taller online`) y manda a la app una **«foto»** de cada uno: la lista completa de teléfonos.
2. Después escucha quién **entra** y quién **sale** y lo avisa (junta lo que pasa en 2 segundos en un solo pedido).
3. Cada 6 horas (`FOTO_CADA_HORAS`) vuelve a mandar la foto de cada grupo: si se perdió un aviso, queda corregido.
4. Manda un **latido** cada 2 minutos, y **enseguida** cada vez que cambia algo, con cómo está con WhatsApp:

   | `estado` | Qué es | En la app |
   |---|---|---|
   | `conectado` | Mirando los grupos | **Conectado** |
   | `esperando_qr` | Hay que vincular el número. Lleva el código QR | **Esperando que lo escaneen**, con el código |
   | `reconectando` | Arrancando, o se cortó la conexión y vuelve sola (espera creciente: 2 s, 4 s, 8 s… hasta 5 min) | **Reconectando** |
   | `cerrado` | WhatsApp cerró la sesión y no pudo empezar otra, o hay otra copia usando la misma sesión | **Sesión cerrada** |

   Si pasan 15 minutos sin latido, o el número lleva 15 minutos sin conectarse, la app muestra un aviso en Webinars y
   en el Dashboard.
5. **El código QR** lo da WhatsApp cada ~20 segundos mientras espera. El lector lo convierte en una imagen (SVG, con la
   librería `qrcode`) y lo manda **apenas llega**, en el latido, sin esperar los 2 minutos. La app lo muestra en
   Ajustes → WhatsApp, que se renueva sola y lo saca cuando el número se conecta. Si nadie lo escanea, WhatsApp da unos
   6 códigos (unos 3 minutos) y cierra la conexión: el lector pide otra tanda enseguida y sigue «esperando», así que el
   código siempre está vivo cuando alguien abre la pantalla, aunque el lector lleve horas o días esperando.
6. **Si WhatsApp cierra la sesión** (se desvinculó el dispositivo desde el teléfono), el lector mueve la carpeta `auth`
   a `auth.vieja` y empieza una vinculación nueva: queda `esperando_qr`. Si se vuelve a cerrar apenas empezada, no la
   mueve otra vez (esperaría tirar una vinculación a medias) y reintenta con espera creciente.

Habla con la app por dos rutas, con un secreto compartido en `Authorization: Bearer …`:

| Ruta | Para qué |
|---|---|
| `POST /api/whatsapp/grupos` | `{ grupo: { id, nombre }, participantes: [teléfonos], evento: "foto" \| "entro" \| "salio", en }` (y `total`, `sinTelefono` en las fotos) |
| `POST /api/whatsapp/latido` | `{ en, conectado, estado, grupos, qr? }` (`qr`: una imagen en data URL, sólo con `esperando_qr`) |

## Paso a paso (Ubuntu en Hostinger)

### 0. En la app (una vez)

1. Correr en el SQL Editor de Supabase `supabase/whatsapp-lector.sql` (las tablas del lector) y
   `supabase/whatsapp-lector-qr.sql` (el estado y la tabla del código QR).
2. Inventar el secreto y ponerlo en Vercel como `WHATSAPP_LECTOR_TOKEN`:
   ```bash
   openssl rand -hex 32
   ```
   Después de agregar la variable en Vercel hay que **volver a publicar** para que la tome. Guardá el secreto en un
   lugar seguro: lo vas a necesitar en el paso 4. **No lo escribas en el repo ni en un chat.**

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
rsync -av --exclude node_modules --exclude auth --exclude 'auth.*' --exclude .env \
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
Vercel) y `GRUPOS_REGEX` (en producción `taller online`: se prueba contra el **nombre** del grupo, sin distinguir
mayúsculas; vacío mira todos los grupos del número).

### 5. Probar sin WhatsApp

```bash
npm run simulado        # un grupo con 10 participantes, uno que entra, uno que sale…
npm run simulado:qr     # ensaya la vinculación: el código aparece, cambia y se conecta (tarda ~30 segundos)
```

Si el primero termina con `Simulación terminada: 5 enviados, 0 fallidos, 2 salteados` (con
`GRUPOS_REGEX=taller online`; el grupo VIP del ejemplo no coincide y se saltea), la app, el token y las tablas están
bien. En Apicanta → **Ajustes → WhatsApp** tiene que aparecer el grupo «Taller Online 08/10/26 #1». Con el segundo, si
tenés esa pantalla abierta, se ve el código de prueba aparecer, cambiar y desaparecer al conectarse (sin la librería
`qrcode` instalada es un dibujo que dice «QR DE PRUEBA»: no se escanea). Si algo falla, el mensaje dice qué (ver «Cuando
algo anda mal»).

> **Ojo, es de verdad:** la simulación escribe en la app a la que apunte `APP_URL` (con el `.env` del servidor, en
> producción). El grupo de ejemplo «Taller Online 08/10/26 #1» queda guardado con teléfonos inventados y se puede
> confundir con un webinar real de esa fecha. Si lo corriste en producción, borralo con
> `delete from public.whatsapp_grupos where id = '120363000000000001@g.us';` (los miembros se van en cascada). Para
> comprobar la conexión sin dejar nada inventado, prendé el servicio y mirá Ajustes → WhatsApp: el estado aparece solo.
> Las pruebas (`npm test`) nunca le hablan a la app real: corren desde una carpeta vacía, sin tu `.env`.

### 6. Dejarlo andando siempre (systemd)

Como root:

```bash
mkdir -p /opt/apicanta-whatsapp-lector
cp -a /home/lector/whatsapp-lector/. /opt/apicanta-whatsapp-lector/
chown -R lector:lector /opt/apicanta-whatsapp-lector
cp /opt/apicanta-whatsapp-lector/deploy/whatsapp-lector.service /etc/systemd/system/apicanta-whatsapp-lector.service
systemctl daemon-reload
systemctl enable --now apicanta-whatsapp-lector
systemctl status apicanta-whatsapp-lector
```

Arranca con el servidor, y si se cae lo levanta de nuevo a los 10 segundos. Si Node no está en `/usr/bin/node`
(`which node` lo dice), cambiá `ExecStart` en el archivo del servicio.

<details>
<summary>¿Preferís pm2?</summary>

```bash
npm install -g pm2          # como root
su - lector
cd whatsapp-lector
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup                 # imprime un comando con sudo: copialo y pegalo, como root
```

Los registros: `pm2 logs apicanta-whatsapp-lector`. Reiniciar: `pm2 restart apicanta-whatsapp-lector`.
</details>

### 7. Vincular el número, desde la app

1. Entrá a Apicanta con una cuenta de **dueño** → **Ajustes → WhatsApp**. Dice **«Esperando que lo escaneen»** y muestra
   el código QR (puede tardar unos segundos en aparecer).
2. En el teléfono del número dedicado: **WhatsApp → Dispositivos vinculados → Vincular un dispositivo**, y escaneá el
   código de la pantalla. Se renueva solo cada pocos segundos; dejá la pantalla abierta.
3. Cuando se conecta, el código desaparece y la pantalla dice **«Conectado: vigila N grupos»**.
4. Agregá ese número a los grupos de los talleres, como a cualquier persona. Los grupos aparecen solos en
   **Ajustes → WhatsApp**: «Atar los sugeridos» los ata al webinar de la fecha que dice su nombre
   («Taller Online 08/10/26 #1», #2, #3… son del mismo webinar).

> Si el código no aparece: la pantalla dice por qué (falta correr `whatsapp-lector-qr.sql`, o tu tipo de cuenta no
> edita Ajustes y sólo ve el estado). Siempre queda el camino de la terminal: ver «Depurar con el código en la terminal».

## Día a día

| Quiero… | systemd | pm2 |
|---|---|---|
| Ver los registros | `journalctl -u apicanta-whatsapp-lector -f` | `pm2 logs apicanta-whatsapp-lector` |
| Ver si está vivo | `systemctl status apicanta-whatsapp-lector` | `pm2 status` |
| Reiniciarlo | `systemctl restart apicanta-whatsapp-lector` | `pm2 restart apicanta-whatsapp-lector` |
| Pararlo | `systemctl stop apicanta-whatsapp-lector` | `pm2 stop apicanta-whatsapp-lector` |

**Actualizar el servicio:** copiá la carpeta de nuevo (`rsync`, como en el paso 3: **sin tocar `auth/` ni `.env`**),
corré `npm install` (esta versión suma la librería `qrcode`) y reiniciá.

**Qué se ve en los registros** (una línea por cosa, con la hora de Argentina; nunca teléfonos ni el código QR):

```
07/10 15:02:11 INFO  Conectado a WhatsApp (sólo lectura).
07/10 15:02:14 INFO  Vigilo 2 grupo(s) (al conectar).
07/10 15:02:14 INFO  «Taller Online 08/10/26 #1»: 812 con teléfono y 3 sin teléfono visible (se cuentan, no se mandan).
07/10 15:05:40 INFO  «Taller Online 08/10/26 #1»: entraron 4.
```

## Si WhatsApp cierra la sesión

Pasa si en el teléfono se **desvincula el dispositivo** (WhatsApp → Dispositivos vinculados → cerrar sesión), si el
teléfono estuvo unos 14 días sin conexión, o si WhatsApp invalida la sesión. **No hay nada que hacer en el servidor.** El
lector lo ve, aparta la sesión vieja en `auth.vieja` y empieza otra vinculación; en la app el estado pasa a **«Esperando
que lo escaneen»** (y salta el aviso de Webinars si pasan 15 minutos). Un dueño abre Ajustes → WhatsApp y escanea el
código de nuevo, como la primera vez.

Los datos de los grupos que ya estaban en la app **no se pierden**: la próxima foto los pone al día. `auth.vieja` son
llaves que ya no sirven (la próxima vez se pisa); si querés, `rm -rf auth.vieja`.

## Depurar con el código en la terminal

Sólo si la app no puede mostrar el código (por ejemplo, mientras no esté corrido `whatsapp-lector-qr.sql`):

```bash
systemctl stop apicanta-whatsapp-lector
cd /opt/apicanta-whatsapp-lector
sudo -u lector node src/index.js --qr-terminal     # dibuja el código en la terminal, y también lo manda a la app
# cuando diga «Conectado a WhatsApp», Ctrl+C
systemctl start apicanta-whatsapp-lector
```

Si el código sale cortado, agrandá la ventana de la terminal.

## Cuando algo anda mal

| Qué dice | Qué significa y qué hacer |
|---|---|
| `La app rechazó el token (401)` | `WHATSAPP_LECTOR_TOKEN` del `.env` no es el mismo que en Vercel (o en Vercel falta publicar de nuevo). |
| `La app contestó 503` / `falta la variable WHATSAPP_LECTOR_TOKEN` | La app no tiene la variable `WHATSAPP_LECTOR_TOKEN`, o le falta `SUPABASE_SERVICE_ROLE_KEY`. |
| `Faltan las tablas de WhatsApp` | Falta correr `supabase/whatsapp-lector.sql`. |
| `La app avisa: Falta correr supabase/whatsapp-lector-qr.sql` | El lector anda, pero el código QR no tiene dónde guardarse. Correr ese archivo. |
| `No se pudo conectar con la app` | `APP_URL` mal escrita, o el servidor no sale a internet. Probá `curl -I <APP_URL>`. |
| `La hora del lector difiere N minutos` | El reloj del servidor está mal: `timedatectl set-ntp true`. |
| `Ningún grupo… coincide con GRUPOS_REGEX` | El número no está en esos grupos, o la expresión no calza con los nombres. Vaciala para ver todos. |
| `Otra copia del lector está usando esta misma sesión` | Hay dos lectores con la misma carpeta `auth/` (por ejemplo, uno de pruebas en tu compu). Dejá uno solo. |
| `No pude apartar la sesión vieja` | El usuario del servicio no puede renombrar `auth`. Revisá los permisos de la carpeta (`chown -R lector:lector`). |
| `Faltan las dependencias` | Falta `npm install` en la carpeta (esta versión suma `qrcode`). |
| En la app: «Sin señal hace N minutos» | El servicio no está corriendo o el servidor no tiene internet. `systemctl status`. |
| En la app: «Reconectando» que no termina | WhatsApp no lo deja conectar. Mirá los registros; si dura, puede pedir vincular de nuevo. |
| En la app: «Sesión cerrada» | WhatsApp cerró la sesión y no se pudo empezar otra (mirá los registros), o hay otra copia usando el número. |

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
| `QR_EN_TERMINAL` | `1`: dibuja el código en la terminal además de mandarlo a la app (igual que `--qr-terminal`). | — |

## Seguridad

- **La carpeta `auth/` es la sesión de WhatsApp del número**: quien la copie puede leer sus chats. No se sube al repo
  (el repo de Apicanta es público; `.gitignore` la excluye), no se comparte y se cuida con permisos:
  `chmod 700 auth` y `chmod 600 .env`. Lo mismo `auth.vieja`.
- **El código QR también lo es** (ver arriba): sólo lo ve un dueño, vive menos de un minuto en la app, no se lee desde el
  navegador con la base y se borra al conectarse. No le saques captura ni lo mandes por chat.
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
  { "tipo": "estado", "estado": "esperando_qr", "qr": "texto que da WhatsApp" },
  { "tipo": "esperar", "ms": 9000 },
  { "tipo": "estado", "estado": "conectado", "grupos": 1 },
  { "tipo": "foto",  "grupo": { "id": "120363000000000001@g.us", "nombre": "Taller Online 08/10/26 #1" },
    "participantes": [ "5491155550001@s.whatsapp.net", { "id": "1000@lid", "phoneNumber": "5491155550003@s.whatsapp.net" }, { "id": "2000@lid" } ] },
  { "tipo": "entro", "grupo": { "id": "120363000000000001@g.us", "nombre": "Taller Online 08/10/26 #1" }, "participantes": [ "5491155550011@s.whatsapp.net" ] },
  { "tipo": "salio", "grupo": { "id": "120363000000000001@g.us", "nombre": "Taller Online 08/10/26 #1" }, "participantes": [ "5491155550001@s.whatsapp.net" ], "haceMin": 2 }
] }
```

Los participantes se escriben como los entrega Baileys (un texto, o un objeto con el LID y el teléfono). Un paso puede
llevar `haceMin` para que «haya pasado hace tantos minutos». `latido` y `estado` son lo mismo. Para probar contra la app
en tu compu: `APP_URL=http://localhost:3010` y un `WHATSAPP_LECTOR_TOKEN` de prueba (el mismo en la app y acá) en tu
entorno, nunca en el repo.

Las pruebas del servicio (no necesitan WhatsApp ni internet): `npm test`. Cubren los participantes (con y sin teléfono,
las dos versiones de Baileys), los cuerpos, los reintentos, el filtro de grupos, el envoltorio de sólo lectura y el
lector entero con un WhatsApp de mentira (conexión, avisos en lote, latidos, caídas, el código QR de `esperando_qr` a
`conectado`, y la sesión cerrada que se aparta en `auth.vieja`).

**Lo que no se puede probar sin un número real:** la conexión de verdad con WhatsApp (los eventos tal como los emite la
librería instalada, que el código dibujado por `qrcode` lo lea el teléfono, y cómo se comporta con grupos grandes). Las
formas de los datos están tomadas de los tipos de Baileys, pero la primera vez en el servidor conviene mirar los
registros un rato.
