# Conectar el Bank of America — paso a paso

El objetivo: que los gastos de la cuenta del Bank of America entren **solos, de a uno y con su categoría**, y que el saldo real
de la cuenta se compare con lo que espera la app, sin pegar el CSV del banco.

Bank of America no ofrece una API para que una app lea una cuenta de empresa. Lo que sí hay es **Plaid**, un servicio que
el banco acepta para eso: quien tiene acceso a la cuenta entra **una vez** con su usuario del banco en una ventana de Plaid y le da
a la app un permiso **de sólo lectura** (la app no puede mover plata). La clave del banco la ve el banco: nunca pasa por la app.

> Mientras no esté conectado, todo sigue como hoy: se pega el CSV del banco en Transacciones → «Cargar varios».

---

## Lo que hace falta

1. **Una cuenta de Plaid** (la de la empresa) con acceso a **Production**. Con Production en espera, Plaid sólo deja
   conectar bancos de prueba (ver «Probar sin tocar el banco de verdad», abajo).
2. Las tres variables en Vercel (Paso 1).
3. Alguien que pueda entrar a la cuenta del banco (Yari o Manu): lo hace una sola vez.

## Paso 1 — Las claves de Plaid, en Vercel

1. Entrá a **dashboard.plaid.com** → **Developers** → **Keys**.
2. Copiá el **client_id** y el **secret** de **Production**.
3. Cargalas en Vercel como se explica en el [Paso 0 de «Conectar los medios de pago»](./conectar-pasarelas.md) (proyecto **apicanta-erp** →
   Settings → Environment Variables → Production):

| Nombre exacto | Qué va |
|---|---|
| `PLAID_CLIENT_ID` | el `client_id` |
| `PLAID_SECRET` | el `secret` de **Production** |
| `PLAID_ENV` | la palabra `production` |

4. **Redeploy** (las variables nuevas no hacen nada hasta el próximo deploy).

> Las claves **no se mandan por WhatsApp ni se escriben en ningún documento**: van directo en Vercel.

## Paso 2 — Conectar el banco

1. En la app: **Ajustes → Integraciones → Bank of America**. Tiene que decir «Claves de Plaid: Puestas».
2. Botón **Conectar Bank of America**. Se abre la ventana de Plaid.
3. Buscá **Bank of America**, entrá con el usuario del banco y elegí la cuenta (o las cuentas) que se comparten.
   Bank of America tiene su propia pantalla para elegirlas.
4. Al volver, la tarjeta dice **Conectado** con el nombre de la cuenta. Tocá **Traer ahora** para ver que lee.

## Qué pasa después

- **Cada hora** entran solos los gastos nuevos de la cuenta, de a uno, con las mismas reglas que el CSV: lo que no es un gasto queda
  afuera (el pago de la tarjeta, lo que pasa entre cuentas propias —Stripe, Whop, Mercury— y lo que entra), los pagos al equipo
  entran marcados como pago de equipo y cada uno lleva su categoría. Si no se sabe a cuál va, queda en **«Pendiente de revisión»**:
  se revisa filtrando por esa categoría en **Finanzas → Transacciones**.
- **Sólo desde que se conectó.** Lo anterior se carga con el CSV; si el mismo movimiento viene por los dos caminos, no se repite.
- **Saldos:** el saldo real de Bank of America se lee en vivo y se compara con lo que la app espera (Finanzas → Saldos y el control de la Caja).
- **Caja → «Ver qué pasó en la cuenta»** muestra todo lo que movió el banco, y cuánto de eso ya está en la app.
- Para dejar de cargar solo sin desconectar: el interruptor **«Cargar los gastos solos»**. «Desconectar» anula el permiso en Plaid.

Los depósitos de Stripe, Whop y las transferencias entre cuentas propias **no son gastos**: siguen cargándose como **Caja → Movimiento entre cuentas**.

## Cada año: volver a autorizar

Bank of America vence el permiso **a los 12 meses** (y cuando alguien cambia la clave del banco). La tarjeta lo avisa con «Pide volver a
autorizar»: se toca **Volver a autorizar**, se entra al banco otra vez y listo. No se pierde nada de lo cargado.

## Probar sin tocar el banco de verdad

Con `PLAID_ENV` en `sandbox` (o sin ponerla) y el `secret` de **Sandbox**, la ventana de Plaid ofrece bancos de juguete (por ejemplo
el «Platypus OAuth Bank»): según la documentación de Plaid, ahí se puede escribir cualquier cosa como usuario y clave. Sirve para ver cómo
queda la tarjeta y el flujo; un banco de prueba no trae los movimientos de la cuenta real.

## Si algo falla

| La tarjeta dice | Qué es |
|---|---|
| «Faltan PLAID_CLIENT_ID…» | falta cargar las variables en Vercel (o el Redeploy) |
| «Plaid no aceptó las claves» | el `secret` no es del mismo entorno que `PLAID_ENV` (Sandbox vs Production) |
| «Pide volver a autorizar» | venció el permiso (al año) o cambió la clave del banco: **Volver a autorizar** |
| «Plaid todavía está trayendo el historial» | recién se conectó: en unos minutos está |
| «No pude guardar el permiso del banco» | falta correr `supabase/conexion-bancaria.sql` |

## Cuánto cuesta

Plaid factura **por conexión y por mes** mientras exista (sin importar cuántas veces se lea). El precio de tu plan está en el panel
de Plaid; según su documentación, el plan de prueba permite hasta 10 conexiones. La app tiene **una** conexión: al reconectar da de baja la
vieja para no pagar dos.

## Dónde está en el código

`lib/plaid.ts` (traducir lo de Plaid al formato del banco), `lib/plaid-servidor.ts` (hablar con Plaid, guardar el permiso, cargar los gastos),
`app/api/bofa/*` (conectar, estado, traer ahora), el cron de cada hora es `/api/pasarelas/sync`, y la tabla `conexion_bancaria`
(`supabase/conexion-bancaria.sql`, sin políticas: sólo la lee el servidor).
