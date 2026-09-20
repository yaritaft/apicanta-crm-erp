# Conectar los medios de pago — paso a paso

El objetivo: que cada pago que entra aparezca solo en Apicanta, con la comisión real ya
descontada, sin que nadie lo cargue a mano.

## El resumen, antes de empezar

| Medio de pago | Qué se puede hacer | Cuánto tarda en aparecer |
|---|---|---|
| **Stripe** | Todo: avisa al instante y se le puede preguntar | Segundos |
| **Hotmart** | Todo | Segundos |
| **Whop** | Todo | Segundos |
| **dLocal** | Todo | Segundos |
| **Mercado Pago Yari** | Todo | Segundos |
| **ACH-WIRE Mercury** | Se le pregunta (el banco no avisa) | Hasta 1 hora |
| **USDT Binance** | Se le pregunta | Hasta 1 hora |
| **USDT Trust** | Se mira la blockchain con la dirección | Hasta 1 hora |
| **Galicia (ARS)** | No hay API. Se pega el resumen | Cuando lo pegás |
| **Galicia (USD)** | No hay API. Se pega el resumen | Cuando lo pegás |
| **Financiera ARS Juan** | No hay API. Se pega la planilla | Cuando la pegás |
| **Financiera USD Juan** | No hay API. Se pega la planilla | Cuando la pegás |
| **Efectivo USD** | Nada que conectar: se carga a mano | Cuando lo cargás |

**Ocho de trece entran solos.** Los otros cinco no es un problema del software: Galicia no
tiene API, la financiera es una persona con una planilla y el efectivo es efectivo. Para
esos, Apicanta tiene **Importar**: se pega el CSV y entran igual.

---

# Paso 0 — Cómo se carga una clave en Vercel

Esto se aprende una vez y sirve para las ocho. **Cada vez que la guía diga
"cargala en Vercel", es exactamente esto:**

1. Entrá a **vercel.com** y logueate.
2. Elegí el equipo **apicanta** (arriba a la izquierda) → proyecto **apicanta-erp**.
3. Arriba: **Settings** → en la columna izquierda, **Environment Variables**.
4. Botón **Add** (o el formulario que ya está ahí):
   - **Key / Name:** el nombre EXACTO que dice la guía. Todo en MAYÚSCULAS, con guiones
     bajos, sin espacios ni comillas. Si dice `STRIPE_SECRET_KEY`, es `STRIPE_SECRET_KEY`.
   - **Value:** el valor que copiaste de la plataforma. Pegalo entero, sin espacios al
     principio ni al final, sin comillas.
   - **Environments:** tildá **Production** (si te deja tildar las tres, tildá las tres).
5. **Save**.

> ⚠️ **Lo más importante y lo que siempre se olvida:** las variables nuevas **no hacen nada
> hasta el próximo deploy**. Cuando termines de cargar todas las de una plataforma, andá a
> la solapa **Deployments** → el deploy de más arriba → el menú **⋯** de la derecha →
> **Redeploy** → confirmar. Recién ahí empieza a funcionar.

Si te equivocaste en un valor: **Settings → Environment Variables** → los tres puntitos al
lado de la variable → **Edit** → pegás el correcto → Save → Redeploy.

---

# Parte 1 — Los cinco que avisan al instante

Por cada uno son **tres pasos**: sacar la clave, cargarla en Vercel, y pegar la dirección
del webhook en la plataforma.

**Si un menú no se llama exactamente así,** buscá *"API"* o *"Webhooks"* en el panel: les
cambian el nombre cada tanto, pero siempre están.

---

## 1. Stripe

### A. Sacar la clave

1. Entrá a **dashboard.stripe.com**.
2. Arriba a la derecha, fijate que **no** diga "Modo de prueba / Test mode". Si lo dice, apagalo.
3. Menú **Desarrolladores** (o el ícono `</>`) → **Claves de API**.
4. Botón **Crear clave restringida**.
5. Nombre: `Apicanta ERP`. Todos estos en **Leer**, ninguno en escribir:
   - Cargos (Charges) → Leer
   - Transacciones de saldo (Balance transactions) → Leer
   - Intentos de pago (Payment intents) → Leer
   - Clientes (Customers) → Leer
6. Crear → **copiá la clave** (empieza con `rk_live_…`). **Se muestra una sola vez.**

### B. Cargarla en Vercel

| Key | Value |
|---|---|
| `STRIPE_SECRET_KEY` | la clave `rk_live_…` que acabás de copiar |

### C. El webhook

1. Desarrolladores → **Webhooks** → **Agregar destino / Add endpoint**.
2. Pegá esta dirección, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/stripe?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Eventos (buscalos por nombre y tildalos):
   `charge.succeeded`, `payment_intent.succeeded`, `checkout.session.completed`
4. Guardar → entrá al webhook recién creado → **Signing secret** → *Revelar* → copiá el
   valor (empieza con `whsec_…`).
5. Cargalo en Vercel:

| Key | Value |
|---|---|
| `STRIPE_WEBHOOK_SECRET` | el `whsec_…` |

→ **Redeploy.**

---

## 2. Hotmart

### A. Sacar las claves

1. Entrá a Hotmart con la cuenta de **Productor**.
2. Menú **Herramientas** (Ferramentas) → **Credenciales (API)**.
3. **Crear credencial** → nombre `Apicanta ERP`.
4. Te muestra **tres** valores. Copiá los tres.

### B. Cargarlas en Vercel

| Key | Value |
|---|---|
| `HOTMART_CLIENT_ID` | el Client ID |
| `HOTMART_CLIENT_SECRET` | el Client Secret |
| `HOTMART_BASIC` | el Basic |

### C. El webhook

1. Herramientas → **Webhook (API y Notificaciones)** → **Nueva configuración**.
2. Pegá esta dirección, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/hotmart?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Versión: **2.0.0**.
4. Eventos: **Compra aprobada** (`PURCHASE_APPROVED`) y **Compra completa** (`PURCHASE_COMPLETE`).
5. Guardar → la pantalla muestra un **hottok**. Copialo y cargalo:

| Key | Value |
|---|---|
| `HOTMART_HOTTOK` | el hottok |

→ **Redeploy.**

---

## 3. Whop

### A. Sacar la clave

1. Entrá a **whop.com/dashboard** con la cuenta dueña de la comunidad.
2. **Settings** → **Developer** (o **API keys**).
3. **Create API key** → nombre `Apicanta ERP` → permisos de **lectura de pagos**.
4. Copiala. **Se muestra una sola vez.**

### B. Cargarla en Vercel

| Key | Value |
|---|---|
| `WHOP_API_KEY` | la API key |

### C. El webhook

1. En Developer → **Webhooks** → **Create webhook**.
2. Pegá esta dirección, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/whop?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Evento: el que diga que un pago se completó (**payment succeeded**).
4. Guardar. → **Redeploy.**

---

## 4. dLocal

> dLocal no se abre solo: las credenciales salen del **panel de comerciante** y, si no
> aparecen, se las pide al ejecutivo de cuenta. Si no tenemos panel propio y cobramos a
> través de un tercero, avisá: se resuelve por CSV y listo.

### A. Sacar las claves

1. Entrá al **Merchant Panel** de dLocal (`merchant.dlocal.com`).
2. **Settings / Integration** → **API Keys** (o **Credenciales**).
3. Copiá los **tres** valores del ambiente de **producción** (no sandbox):
   **X-Login**, **Trans-Key** y **Secret Key**.

### B. Cargarlas en Vercel

| Key | Value |
|---|---|
| `DLOCAL_X_LOGIN` | el X-Login |
| `DLOCAL_TRANS_KEY` | el Trans-Key |
| `DLOCAL_SECRET_KEY` | el Secret Key |

### C. El webhook

1. En el mismo panel: **Settings** → **Notifications / Webhooks**.
2. Pegá esta dirección, entera, como **Notification URL** de producción:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/dlocal?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Evento: **pago aprobado / PAID**.
4. Guardar. → **Redeploy.**

---

## 5. Mercado Pago (Yari)

### A. Sacar la clave

1. Entrá a **mercadopago.com.ar/developers** con la cuenta de Yari → **Tus integraciones**.
2. **Crear aplicación** → nombre `Apicanta ERP` → producto **Pagos online**.
3. Adentro: **Credenciales de producción** (no las de prueba).
4. Copiá el **Access Token** (empieza con `APP_USR-…`).

### B. Cargarla en Vercel

| Key | Value |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | el Access Token de **producción** |

### C. El webhook

1. En la misma aplicación: **Webhooks / Notificaciones** → **Configurar notificaciones**.
2. En **URL de producción** pegá esta dirección, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/mercadopago?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Evento: **Pagos** (`payment`).
4. Guardar. → **Redeploy.**

---

# Parte 2 — Los tres que no avisan, pero se les puede preguntar

Estos no golpean nuestra puerta: Apicanta les pregunta **cada hora** qué entró.
Acá **no hay webhook**, sólo la clave.

---

## 6. ACH / Wire (Mercury)

> Es un banco: sacá una clave de **sólo lectura**. Con una de escritura, quien la tenga
> puede mover plata.

### A. Sacar el token

1. Entrá a **mercury.com** con la cuenta dueña.
2. Arriba a la derecha: **Settings** → **Security** (en algunos planes está en
   *Settings → API* o *Developer*).
3. Buscá **API tokens** → **Generate / New token**.
4. Nombre: `Apicanta ERP`. Permiso: **Read only**. Si te deja elegir cuentas, marcá las que
   reciben los cobros.
5. Copiá el token. **Se muestra una sola vez.**

### B. Cargarlo en Vercel

| Key | Value |
|---|---|
| `MERCURY_API_TOKEN` | el token |

→ **Redeploy.**

**Qué va a entrar:** sólo los movimientos que **suman** (lo que sale no es un cobro), con el
nombre de quien transfirió. Si Mercury no te deja generar un token de sólo lectura, no lo
fuerces: se hace por CSV (Statements → Export).

---

## 7. USDT Binance

> Igual que el banco: **sólo lectura** y **sin permiso de retiro**. Una clave con retiro
> habilitado es la llave de la caja.

### A. Sacar las claves

1. Entrá a **binance.com** → el ícono de tu cuenta (arriba a la derecha) → **Gestión de API**
   (*API Management*).
2. **Crear API** → elegí **System generated** → nombre `Apicanta ERP`.
3. Confirmá con el 2FA (Google Authenticator / mail / SMS).
4. Te muestra **API Key** y **Secret Key** → copiá los dos.
   **El Secret se muestra una sola vez.**
5. Entrá a **Editar restricciones** de esa clave y dejá **sólo**:
   - ✅ **Habilitar lectura** (*Enable Reading*)
   - ❌ Spot & Margin Trading — apagado
   - ❌ **Habilitar retiros** (*Enable Withdrawals*) — **apagado. Esto es lo más importante.**
   - ❌ Futures — apagado
6. Si te pide restringir por IP, elegí **sin restricción** (nuestro servidor cambia de IP).

### B. Cargarlas en Vercel

| Key | Value |
|---|---|
| `BINANCE_API_KEY` | la API Key |
| `BINANCE_API_SECRET` | la Secret Key |

→ **Redeploy.**

**Qué va a entrar:** los **depósitos** de USDT acreditados. Ojo: la blockchain no trae el
nombre del que pagó, así que estos cobros se concilian por **monto y fecha** — el que
concilia elige la cuota. Es la naturaleza de la cripto, no una limitación de Apicanta.

---

## 8. USDT Trust

Trust es una billetera propia: no tiene panel ni clave ni API. Lo que hay es la
**blockchain, que es pública**: con la dirección alcanza para ver todo lo que entra.

### A. Copiar la dirección

1. Abrí la app **Trust Wallet**.
2. Entrá a **USDT** y fijate en qué red cobran. Casi siempre es **TRON (TRC20)**: la
   dirección empieza con **T**. (Si empieza con **0x** es BEP20 o ERC20 — avisá, porque se
   mira en otro lado.)
3. Tocá **Recibir** → **Copiar dirección**.

> 🚨 **La dirección es pública y no sirve para sacar plata. La frase de recuperación de 12
> palabras NO se comparte con nadie, nunca, ni conmigo ni con Apicanta.** Si alguien te la
> pide, es un robo.

### B. Cargarla en Vercel

| Key | Value |
|---|---|
| `TRUST_WALLET_ADDRESS` | la dirección (algo como `TXk…`) |

→ **Redeploy.**

**Qué va a entrar:** cada transferencia de USDT que **llega** a esa dirección. Igual que
Binance, sin nombre: se concilia por monto y fecha.

---

# Parte 3 — Los cinco que se cargan con planilla

No hay nada que conectar. Pero tampoco hay que cargarlos de a uno: en
**Apicanta → Conciliación → Importar** se pega el CSV y entran todos juntos, listos para
imputar a su cuota.

El lector entiende cualquier planilla que tenga, con el nombre de columna que sea, **fecha**,
**monto** y —si está— **nombre** o **email** de quien pagó. Descarta solo los reembolsos, los
rechazados y las filas de resumen.

## 9 y 10. Galicia (ARS) y Galicia (USD)

1. Entrá al **Home Banking de Galicia** (o Galicia Office).
2. **Cuentas** → elegí la cuenta → **Movimientos / Consulta de movimientos**.
3. Elegí el rango de fechas (por ejemplo, el mes).
4. **Descargar / Exportar** → **Excel o CSV**.
5. Si baja en `.xls` o `.xlsx`: abrilo y *Guardar como → CSV*. O abrilo, seleccionás todo,
   copiás y lo pegás directo en Apicanta: también funciona.
6. En Apicanta: **Conciliación → Importar** → pasarela **"Otro (planilla)"** → pegar → Importar.

## 11 y 12. Financiera ARS / USD (Juan)

Lo mismo con lo que mande la financiera. Si manda un PDF o un mensaje, con pasarlo a una
planilla de tres columnas alcanza:

```
fecha,monto,nombre
2026-09-18,1200,Martín Quiroga
2026-09-19,850,Sofía Cáceres
```

## 13. Efectivo USD

Se carga a mano al registrar la venta: en el asistente, la cuota se marca cobrada con el
medio **Efectivo USD**. No pasa por conciliación porque no hay nada con qué cruzarlo: la
plata ya está en la mano.

---

# La lista, para ir tachando

| # | Plataforma | Variables a cargar en Vercel | Webhook |
|---|---|---|---|
| 1 | Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Sí |
| 2 | Hotmart | `HOTMART_CLIENT_ID`, `HOTMART_CLIENT_SECRET`, `HOTMART_BASIC`, `HOTMART_HOTTOK` | Sí |
| 3 | Whop | `WHOP_API_KEY` | Sí |
| 4 | dLocal | `DLOCAL_X_LOGIN`, `DLOCAL_TRANS_KEY`, `DLOCAL_SECRET_KEY` | Sí |
| 5 | Mercado Pago | `MERCADOPAGO_ACCESS_TOKEN` | Sí |
| 6 | Mercury | `MERCURY_API_TOKEN` | No |
| 7 | Binance | `BINANCE_API_KEY`, `BINANCE_API_SECRET` | No |
| 8 | Trust | `TRUST_WALLET_ADDRESS` | No |
| 9-13 | Galicia, Financiera, Efectivo | — | — |

Cada plataforma es independiente: la que termines primero empieza a andar primero. No hay
que esperar a tenerlas todas, pero **sí hay que hacer Redeploy** después de cada tanda.

---

# Cómo sabemos que quedó andando

1. **Sin plata:** en Stripe, el webhook tiene un botón **Send test event** → elegí
   `charge.succeeded` → mandalo. Tiene que responder **200**.
2. **Con plata:** el próximo cobro real aparece en Apicanta → **Conciliación**, en
   *Pendientes*, con el fee ya descontado. Los cinco de la Parte 1 en segundos; los tres de
   la Parte 2 dentro de la hora.
3. Si no aparece, **no se perdió**: cada hora Apicanta le vuelve a preguntar a cada
   plataforma conectada por los últimos 60 días y mete lo que falte.

> Las direcciones de webhook llevan un token al final. Es una llave: que no salga de acá.
