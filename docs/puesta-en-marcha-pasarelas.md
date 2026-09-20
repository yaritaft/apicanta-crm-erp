# Puesta en marcha de la conciliación (lo nuestro)

Esto va antes de que Yari toque nada. Su parte está en `conectar-pasarelas.md`.

## 1. La tabla en Supabase

SQL Editor del proyecto `ddysbsybfoeiwcrmetyt` → pegar y correr `sql/conciliacion.sql`.

Crea la tabla `movimientos` con su política de RLS, el índice único que evita cobros
repetidos, agrega `pagos."movimientoId"` y `procesadores.proveedor`, y da de alta Whop
como procesador.

Mientras la tabla no exista la app **no se rompe**: `TABLAS_OPCIONALES` en
`lib/supabase.ts` saltea la que falta y los cobros viven sólo en el navegador.

## 2. Las variables en Vercel (proyecto `apicanta-erp`, scope `apicanta`, entorno Production)

| Variable | Valor |
|---|---|
| `PASARELAS_WEBHOOK_TOKEN` | `ad2cb3a9e4c908a095be14d419ca32f249dbd5a534badcec` |
| `CRON_SECRET` | `ded64e7f25419125374d68c4f74f00fc6427814047facfd6` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (hay que copiarla de ahí) |

El token es el que va pegado en la URL de cada pasarela. Si se cambia, hay que volver a
editar las cinco URLs: cambiarlo es la forma de cortar el acceso de golpe.

```bash
vercel env add PASARELAS_WEBHOOK_TOKEN production --scope apicanta
vercel env add CRON_SECRET production --scope apicanta
vercel env add SUPABASE_SERVICE_ROLE_KEY production --scope apicanta
```

## 3. Las claves de Yari, cuando lleguen

Mismo lugar, mismos nombres exactos:

```
# Avisan al instante (webhook + consulta)
STRIPE_SECRET_KEY            rk_live_…
STRIPE_WEBHOOK_SECRET        whsec_…
HOTMART_CLIENT_ID            …
HOTMART_CLIENT_SECRET        …
HOTMART_BASIC                …
HOTMART_HOTTOK               …
WHOP_API_KEY                 …
DLOCAL_X_LOGIN               …
DLOCAL_TRANS_KEY             …
DLOCAL_SECRET_KEY            …
MERCADOPAGO_ACCESS_TOKEN     APP_USR-…

# No avisan: los consulta el cron cada hora
MERCURY_API_TOKEN            …
BINANCE_API_KEY              …
BINANCE_API_SECRET           …
TRUST_WALLET_ADDRESS         T…            (la dirección pública, no la frase de 12 palabras)
TRONSCAN_API_KEY             …             (opcional, sube el límite de consultas)
```

Galicia, la financiera y el efectivo no tienen variable: entran por **Importar** o a mano.

Después, redeploy: `vercel deploy --prod --yes --scope apicanta`.

## 4. Qué queda funcionando

- **Webhook** `POST /api/pasarelas/webhook/<pasarela>?token=…` — Stripe, Hotmart, Whop,
  dLocal y Mercado Pago: el cobro entra en segundos.
  El aviso sólo se usa para saber *qué* cobro llegó; los montos se le vuelven a preguntar a
  la pasarela por API, porque un cuerpo HTTP lo escribe cualquiera y de ahí sale plata.
- **Cron horario** (`vercel.json`) → `GET /api/pasarelas/sync?guardar=1` — repesca por API los
  últimos 60 días de cada plataforma conectada. Para Mercury, Binance y Trust **este es el
  único camino**: no tienen webhook.
- **Botón Sincronizar** en Conciliación — lo mismo, a mano, cuando alguien quiere mirar ya.
- **Importar CSV** — sigue andando aunque no haya ninguna clave puesta.

En los cuatro caminos, la referencia del cobro es la clave: el mismo pago no entra dos veces.

## 5. Lo que todavía no se probó contra una cuenta real

Los adaptadores de las cinco pasarelas se escribieron contra la documentación, sin claves
para probarlos. El primer cobro real de cada una es el que dice si quedó bien. Por eso el
cron existe: si el webhook de alguna no matchea el formato esperado, el cobro entra igual
por API dentro de la hora.
