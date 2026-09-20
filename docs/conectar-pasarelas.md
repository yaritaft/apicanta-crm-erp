# Para Yari — conectar las pasarelas de cobro

El objetivo: que cada pago que entra a Stripe, PayPal, Hotmart, Whop o Mercado Pago
aparezca solo en Apicanta, en el momento, con el fee real ya descontado. Hoy eso se carga
a mano y por eso siempre falta algo.

Por cada plataforma son **dos cosas**, y hacen falta las dos:

| | Qué es | Para qué |
|---|---|---|
| **A. La clave** | Un permiso de lectura para que Apicanta le pregunte a la plataforma | Saber el monto y la comisión **reales** de cada cobro |
| **B. El webhook** | Una dirección nuestra que la plataforma avisa cuando alguien paga | Que el cobro aparezca en segundos |

**Cómo mandar las claves:** por 1Password o Bitwarden. No por WhatsApp ni por mail: son
llaves de la caja. Si alguna se filtra, se revoca desde el mismo panel donde se creó.

**Si un menú no se llama exactamente así,** buscá en el panel *"API"* o *"Webhooks"*: las
plataformas les cambian el nombre cada tanto, pero siempre están.

Cada plataforma funciona sola: la que conectes primero empieza a andar primero, no hay que
esperar a tenerlas todas.

---

## 1. Stripe

### A. La clave

1. Entrá a **dashboard.stripe.com**.
2. Arriba a la derecha, fijate que **no** diga "Modo de prueba / Test mode". Si lo dice, apagalo.
3. Menú **Desarrolladores** (o el ícono `</>`) → **Claves de API**.
4. Botón **Crear clave restringida**.
5. Nombre: `Apicanta ERP`. Permisos: todos en **Leer**, ninguno en escribir:
   - Cargos (Charges) → Leer
   - Transacciones de saldo (Balance transactions) → Leer
   - Intentos de pago (Payment intents) → Leer
   - Clientes (Customers) → Leer
6. Crear → **copiá la clave** (empieza con `rk_live_…`). **Se muestra una sola vez.**

### B. El webhook

1. Desarrolladores → **Webhooks** → **Agregar destino / Add endpoint**.
2. Pegá esta dirección, tal cual, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/stripe?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Eventos a escuchar (buscalos por nombre y tildalos):
   - `charge.succeeded`
   - `payment_intent.succeeded`
   - `checkout.session.completed`
4. Guardar → entrá al webhook que acabás de crear → **Signing secret** → *Revelar* →
   **copiá ese valor** (empieza con `whsec_…`).

**Me mandás:** la clave `rk_live_…` y el secreto `whsec_…`

---

## 2. PayPal

### A. La clave

1. Entrá a **developer.paypal.com** con la cuenta **Business**.
2. Arriba: **Apps & Credentials** → pestaña **Live** (no "Sandbox").
3. **Create App** → nombre `Apicanta ERP` → tipo **Merchant** → Create.
4. Copiá el **Client ID**, y en Secret apretá **Generate/Show** y copiá el **Secret**.

### B. El webhook

1. En esa misma app, bajá hasta **Webhooks** → **Add Webhook**.
2. Pegá esta dirección, tal cual, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/paypal?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Evento: **Payment capture completed** (`PAYMENT.CAPTURE.COMPLETED`).
4. Save.

**Me mandás:** Client ID y Secret

---

## 3. Hotmart

### A. La clave

1. Entrá a Hotmart con la cuenta de Productor.
2. Menú **Herramientas** (Ferramentas) → **Credenciales (API)**.
3. **Crear credencial** → nombre `Apicanta ERP`.
4. Copiá los **tres** valores que aparecen: **Client ID**, **Client Secret** y **Basic**.

### B. El webhook

1. Herramientas → **Webhook (API y Notificaciones)** → **Nueva configuración**.
2. Pegá esta dirección, tal cual, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/hotmart?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Versión del webhook: **2.0.0**.
4. Eventos: **Compra aprobada** (`PURCHASE_APPROVED`) y **Compra completa** (`PURCHASE_COMPLETE`).
5. Guardar → la pantalla muestra un **hottok**. Copialo.

**Me mandás:** Client ID, Client Secret, Basic y el hottok

---

## 4. Whop

### A. La clave

1. Entrá a **whop.com/dashboard** con la cuenta dueña de la comunidad.
2. **Settings** → **Developer** (o **API keys**).
3. **Create API key** → nombre `Apicanta ERP` → permisos de **lectura de pagos**.
4. Copiala. **Se muestra una sola vez.**

### B. El webhook

1. En Developer → **Webhooks** → **Create webhook**.
2. Pegá esta dirección, tal cual, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/whop?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Evento: el que diga que un pago se completó (**payment succeeded**).
4. Guardar.

**Me mandás:** la API key

---

## 5. Mercado Pago

### A. La clave

1. Entrá a **mercadopago.com.ar/developers** → **Tus integraciones**.
2. **Crear aplicación** → nombre `Apicanta ERP` → producto **Pagos online**.
3. Adentro: **Credenciales de producción** (no las de prueba).
4. Copiá el **Access Token** (empieza con `APP_USR-…`).

### B. El webhook

1. En la misma aplicación: **Webhooks / Notificaciones** → **Configurar notificaciones**.
2. En **URL de producción** pegá esta dirección, tal cual, entera:

   ```
   https://apicanta-erp.vercel.app/api/pasarelas/webhook/mercadopago?token=ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec
   ```

3. Evento: **Pagos** (`payment`).
4. Guardar.

**Me mandás:** el Access Token de producción

---

## La lista, para no perderse

- [ ] **Stripe:** `rk_live_…` + `whsec_…`
- [ ] **PayPal:** Client ID + Secret
- [ ] **Hotmart:** Client ID + Client Secret + Basic + hottok
- [ ] **Whop:** API key
- [ ] **Mercado Pago:** Access Token de producción

---

## Cómo sabemos que quedó andando

1. **Sin plata:** en Stripe, el webhook tiene un botón **Send test event** → elegí
   `charge.succeeded` → mandalo. Tiene que responder **200**.
2. **Con plata:** el próximo cobro real tiene que aparecer en Apicanta → **Conciliación**,
   en *Pendientes*, en segundos y con el fee ya descontado.
3. Si no aparece, **no se perdió**: cada hora Apicanta le vuelve a preguntar a cada
   plataforma por los últimos 60 días y mete lo que falte.

> La dirección que pegás lleva un token al final. Es una llave: que no salga de acá.
