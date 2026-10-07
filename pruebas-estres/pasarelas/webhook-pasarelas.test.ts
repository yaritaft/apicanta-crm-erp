import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Azar, basura, capturandoConsola, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el webhook de las pasarelas, de punta a punta.

   Se llama a la ruta de verdad (src/app/api/pasarelas/webhook/[proveedor])
   con Request falsos, contra una nube de mentira en memoria
   (pruebas/stress/nube-falsa.ts) y con la red cortada: no sale nada de la
   máquina. Se mira lo que quedó guardado.

   Propiedades:
   - la puerta: sin token ni firma, 401; proveedor raro, 404; nunca 500;
   - el mismo aviso una vez, dos veces o en otro orden deja las mismas filas;
   - un aviso de reembolso NUNCA entra como cobro;
   - con la API de la pasarela, los tres avisos de un mismo pago de Stripe
     (cargo, intento y sesión) dan un solo cobro, en cualquier orden;
   - los secretos no salen en las respuestas ni en la consola.
   ================================================================== */

const TOKEN = "tok-estres-9f3a7c1e5b2d4086a1c3";
const WHSEC = "whsec_estres_Zm9vYmFyYmF6cXV4MTIzNDU2";
const HOTTOK = "hottok-estres-77c0ffee11223344";
const SERVICIO = "svc-estres-clave-de-servicio-falsa-0001";

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICIO;
process.env.PASARELAS_WEBHOOK_TOKEN = TOKEN;
process.env.STRIPE_WEBHOOK_SECRET = WHSEC;
process.env.HOTMART_HOTTOK = HOTTOK;
for (const k of ["STRIPE_SECRET_KEY", "HOTMART_CLIENT_ID", "HOTMART_CLIENT_SECRET", "HOTMART_BASIC", "WHOP_API_KEY", "DLOCAL_X_LOGIN",
  "DLOCAL_TRANS_KEY", "DLOCAL_SECRET_KEY", "MERCADOPAGO_ACCESS_TOKEN", "CRON_SECRET"]) delete process.env[k];

const nube = instalarFetchFalso();
const { POST, GET } = await import("@/app/api/pasarelas/webhook/[proveedor]/route");

test.after(() => nube.restaurar());

/* Lo que el protocolo deja pasar en una cabecera: Request rechaza el resto antes de llegar a la ruta. */
const cabeceraPosible = (v: string) => { try { new Headers({ x: v }); return true; } catch { return false; } };

const llamar = (proveedor: string, cuerpo: unknown, op: { token?: string | null; cabeceras?: Record<string, string>; query?: string } = {}) => {
  const token = op.token === undefined ? TOKEN : op.token;
  const q = op.query ?? (token === null ? "" : `?token=${encodeURIComponent(token)}`);
  return POST(
    new Request(`http://localhost/api/pasarelas/webhook/${proveedor}${q}`, {
      method: "POST", headers: op.cabeceras, body: typeof cuerpo === "string" ? cuerpo : JSON.stringify(cuerpo),
    }),
    { params: Promise.resolve({ proveedor }) },
  );
};
const firmaStripe = (cuerpo: string, secreto = WHSEC, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secreto).update(`${t}.${cuerpo}`).digest("hex")}`;

/* ---------- Avisos de ejemplo ---------- */

const T0 = 1_790_000_000;
const cargoStripe = (id: string, centavos: number, extra: Record<string, unknown> = {}) => ({
  id: `evt_${id}`, type: "charge.succeeded",
  data: { object: { id, object: "charge", amount: centavos, currency: "usd", created: T0, status: "succeeded", billing_details: { email: "Ana@Mail.com", name: "Ana" }, ...extra } },
});
const intentoStripe = (id: string, centavos: number, extra: Record<string, unknown> = {}) => ({
  id: `evt_${id}`, type: "payment_intent.succeeded",
  data: { object: { id, object: "payment_intent", amount: centavos, currency: "usd", created: T0, status: "succeeded", ...extra } },
});
const compraHotmart = (tx: string, valor: number, evento = "PURCHASE_APPROVED", extra: Record<string, unknown> = {}) => ({
  event: evento, version: "2.0.0",
  data: { purchase: { transaction: tx, status: evento.replace("PURCHASE_", ""), price: { value: valor, currency_value: "USD" }, order_date: T0 * 1000, ...extra }, buyer: { name: "Beto", email: "BETO@mail.com" }, product: { name: "Mentoría" } },
});
const pagoWhop = (id: string, monto: number, tipo = "payment.succeeded") => ({
  type: tipo, data: { id, final_amount: monto, currency: "usd", paid_at: T0, user: { name: "Cami", email: "cami@mail.com" }, product_title: "Curso" },
});
const pagoDlocal = (id: string, monto: number) => ({
  id, amount: monto, currency: "USD", status: "PAID", approved_date: new Date(T0 * 1000).toISOString(), payer: { name: "Dani", email: "dani@mail.com" },
});

const reembolsoStripe = (re: string, cargo: string, centavos: number, tipo = "refund.created") => ({
  id: `evt_${re}`, type: tipo,
  data: { object: { id: re, object: "refund", amount: centavos, currency: "usd", status: "succeeded", charge: cargo, payment_intent: `pi_${cargo}`, created: T0 + 100, reason: "requested_by_customer" } },
});

const vaciar = () => nube.nube.vaciar();
const movs = () => nube.nube.filas("movimientos");
const devs = () => nube.nube.filas("devoluciones");

/* ================================================================== */

test("la puerta: sin token ni firma 401, proveedor raro 404, token con otra forma 401; nunca escribe", async () => {
  vaciar();
  const cuerpo = cargoStripe("ch_puerta", 10000);
  assert.equal((await llamar("stripe", cuerpo, { token: null })).status, 401, "sin token");
  assert.equal((await llamar("stripe", cuerpo, { token: "" })).status, 401, "token vacío");
  assert.equal((await llamar("stripe", cuerpo, { token: "otro" })).status, 401);
  assert.equal((await llamar("stripe", cuerpo, { token: TOKEN + "x" })).status, 401, "token con una letra de más");
  assert.equal((await llamar("stripe", cuerpo, { token: TOKEN.slice(0, -1) })).status, 401, "token con una letra de menos");
  assert.equal((await llamar("stripe", cuerpo, { token: TOKEN.toUpperCase() })).status, 401, "mayúsculas");
  assert.equal((await llamar("stripe", cuerpo, { query: `?token=${TOKEN}&token=otro` })).status, 200, "con un token repetido manda el primero");
  assert.equal((await llamar("stripe", cuerpo, { query: `?token[]=${TOKEN}` })).status, 401);
  for (const raro of ["paypal", "STRIPE", "", "../stripe", "stripe%00", "manual", "trust-wallet", "__proto__", "constructor"]) {
    assert.equal((await llamar(raro, cuerpo)).status, 404, `proveedor «${raro}»`);
  }
  assert.equal(movs().length, 1, "sólo el que entró con el primer token bueno");
  const g = await GET();
  assert.equal(g.status, 200);
  assert.deepEqual(await g.json(), { ok: true, listo: true });
});

test("la firma de Stripe: la buena pasa; cuerpo cambiado, otra clave o basura en la cabecera dan 401, nunca 500", propiedad("firma de Stripe", 150, async (az) => {
  vaciar();
  const cuerpo = JSON.stringify(cargoStripe(`ch_${az.alfanum(8)}`, az.int(100, 900000)));
  const ok = await llamar("stripe", cuerpo, { token: null, cabeceras: { "stripe-signature": firmaStripe(cuerpo) } });
  assert.equal(ok.status, 200);
  assert.equal(movs().length, 1);
  const sinPasar: string[] = [
    firmaStripe(cuerpo, "otra-clave"),
    firmaStripe(cuerpo + " ", WHSEC),
    "", "t=", "v1=", "t=1,v1=", ",,,", "=", "t=1", "v1=abc", `t=${Math.floor(Date.now() / 1000)}`,
    "x".repeat(10000), "t=1,v1=" + "0".repeat(64), "\u0000\u0001", "t=abc,v1=zzz", "t=,v1=,t=,v1=",
    firmaStripe(cuerpo).replace("v1=", "v1=0"), firmaStripe(cuerpo).slice(0, -2),
    az.alfanum(az.int(0, 80)), `t=${az.int(0, 9999999999)},v1=${az.alfanum(64)}`,
  ];
  for (const cab of sinPasar.filter(cabeceraPosible)) {
    const r = await llamar("stripe", cuerpo, { token: null, cabeceras: { "stripe-signature": cab } });
    assert.equal(r.status, 401, `la cabecera «${cab.slice(0, 40)}» no debería pasar`);
  }
  /* La firma de Stripe no vale para otra pasarela. */
  assert.equal((await llamar("hotmart", cuerpo, { token: null, cabeceras: { "stripe-signature": firmaStripe(cuerpo) } })).status, 401);
}));

test("el hottok de Hotmart: sólo el exacto, y sólo en Hotmart", async () => {
  vaciar();
  const c = compraHotmart("HP100", 100);
  assert.equal((await llamar("hotmart", c, { token: null, cabeceras: { "x-hotmart-hottok": HOTTOK } })).status, 200);
  for (const mal of ["", HOTTOK.toUpperCase(), HOTTOK + "x", HOTTOK.slice(1), "undefined", "null"]) {
    assert.equal((await llamar("hotmart", c, { token: null, cabeceras: { "x-hotmart-hottok": mal } })).status, 401, `hottok «${mal}»`);
  }
  assert.equal((await llamar("whop", pagoWhop("pay_1", 10), { token: null, cabeceras: { "x-hotmart-hottok": HOTTOK } })).status, 401, "el hottok no abre Whop");
  assert.equal((await llamar("hotmart", c, { token: null })).status, 401);
});

/* ---------- idempotencia ---------- */

interface Aviso { proveedor: string; cuerpo: unknown }

function avisosAleatorios(az: Azar, n: number): Aviso[] {
  const out: Aviso[] = [];
  for (let i = 0; i < n; i++) {
    const k = az.int(0, 5);
    const centavos = az.int(1, 900000);
    const id = az.alfanum(10) + i;
    if (k === 0) out.push({ proveedor: "stripe", cuerpo: cargoStripe(`ch_${id}`, centavos) });
    else if (k === 1) out.push({ proveedor: "stripe", cuerpo: intentoStripe(`pi_${id}`, centavos) });
    else if (k === 2) out.push({ proveedor: "hotmart", cuerpo: compraHotmart(`HP${id}`, centavos / 100, az.pick(["PURCHASE_APPROVED", "PURCHASE_COMPLETE"])) });
    else if (k === 3) out.push({ proveedor: "whop", cuerpo: pagoWhop(`pay_${id}`, centavos / 100) });
    else if (k === 4) out.push({ proveedor: "dlocal", cuerpo: pagoDlocal(`D-${id}`, centavos / 100) });
    else out.push({ proveedor: "stripe", cuerpo: cargoStripe(`py_${id}`, centavos) });
  }
  return out;
}

test("idempotencia: la misma lista una vez, dos veces o en otro orden deja las mismas filas, con ids derivados de la referencia", propiedad("idempotencia del webhook", 40, async (az) => {
  const lista = avisosAleatorios(az, az.int(1, 12));
  vaciar();
  for (const a of lista) assert.equal((await llamar(a.proveedor, a.cuerpo)).status, 200);
  const una = nube.nube.foto("movimientos");
  const filas = movs().length;
  assert.equal(filas, lista.length, "un cobro por aviso");
  for (const m of movs()) assert.equal(m.id, `mov_${m.proveedor}_${m.referencia}`, "el id sale de la referencia");

  /* Otra vez, en otro orden y con cada uno repetido. */
  vaciar();
  const repetida = az.mezclar([...lista, ...lista, ...az.mezclar(lista).slice(0, 3)]);
  let nuevos = 0;
  for (const a of repetida) {
    const r = await llamar(a.proveedor, a.cuerpo);
    assert.equal(r.status, 200);
    nuevos += ((await r.json()) as { guardados?: number }).guardados ?? 0;
  }
  assert.equal(nuevos, lista.length, "cada cobro se cuenta como nuevo una sola vez");
  assert.equal(nube.nube.foto("movimientos"), una, "mismas filas, mismos montos, mismos ids");
}));

test("lo ya conciliado no se pisa: si el cobro ya estaba conciliado, un reintento del aviso no lo devuelve a «pendiente»", async () => {
  vaciar();
  const c = cargoStripe("ch_conciliado", 250000);
  await llamar("stripe", c);
  const m = movs()[0];
  m.estado = "conciliado"; m.cuotaId = "cuo_1"; m.pagoId = "pag_1";
  await llamar("stripe", c);
  await llamar("stripe", c);
  assert.equal(movs().length, 1);
  assert.equal(movs()[0].estado, "conciliado");
  assert.equal(movs()[0].pagoId, "pag_1");
});

test("un aviso con monto cero, negativo o sin id no guarda nada y contesta 200", async () => {
  vaciar();
  for (const [p, c] of [
    ["stripe", cargoStripe("ch_cero", 0)], ["stripe", cargoStripe("ch_neg", -500)], ["stripe", { type: "charge.succeeded", data: { object: { amount: 1000 } } }],
    ["hotmart", compraHotmart("HP0", 0)], ["hotmart", compraHotmart("HPneg", -3)], ["hotmart", compraHotmart("", 100)],
    ["whop", pagoWhop("pay_0", 0)], ["dlocal", pagoDlocal("D-0", 0)], ["dlocal", { amount: 50 }], ["mercadopago", { data: { id: "123" } }],
  ] as const) {
    const r = await llamar(p, c);
    assert.equal(r.status, 200, `${p}`);
  }
  assert.equal(movs().length, 0);
});

/* ---------- reembolsos ---------- */

test("un aviso de reembolso NUNCA entra como cobro: queda, como mucho, como propuesta de devolución, y repetido no duplica", propiedad("reembolso no es cobro", 40, async (az) => {
  vaciar();
  const id = az.alfanum(9);
  const centavos = az.int(100, 800000);
  const avisos: Aviso[] = [
    { proveedor: "stripe", cuerpo: reembolsoStripe(`re_${id}`, `ch_${id}`, centavos, az.pick(["refund.created", "refund.updated", "charge.refund.updated", "Refund.Created", "REFUND.CREATED"])) },
    { proveedor: "stripe", cuerpo: { type: "charge.refunded", data: { object: { id: `ch_${id}`, amount: centavos, amount_refunded: centavos, refunded: true, currency: "usd", created: T0 } } } },
    { proveedor: "hotmart", cuerpo: compraHotmart(`HP${id}`, centavos / 100, az.pick(["PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"])) },
    { proveedor: "whop", cuerpo: pagoWhop(`pay_${id}`, centavos / 100, az.pick(["payment.refunded", "refund.created", "payment_refunded", "REFUNDED", "charge.chargeback"])) },
    { proveedor: "dlocal", cuerpo: { ...pagoDlocal(`D-${id}`, centavos / 100), type: "PAYMENT_REFUNDED", status: "REFUNDED" } },
  ];
  for (const a of az.mezclar([...avisos, ...avisos])) assert.equal((await llamar(a.proveedor, a.cuerpo)).status, 200);
  assert.equal(movs().length, 0, "ningún aviso de reembolso se guarda como cobro");
  for (const d of devs()) assert.equal(d.estado, "propuesta");
  /* Repetidos: un solo reembolso por referencia. */
  const ids = devs().map((d) => d.id as string);
  assert.equal(new Set(ids).size, ids.length);
}));

test("reembolsos: Stripe, Hotmart y Whop quedan como propuesta (no cuentan), con id derivado de la referencia, y repetirlos no duplica", async () => {
  vaciar();
  const avisos: Aviso[] = [
    { proveedor: "stripe", cuerpo: reembolsoStripe("re_AAA", "ch_AAA", 150000) },
    { proveedor: "hotmart", cuerpo: compraHotmart("HPBBB", 99.5, "PURCHASE_REFUNDED") },
    { proveedor: "hotmart", cuerpo: compraHotmart("HPCCC", 10, "PURCHASE_CHARGEBACK") },
    { proveedor: "whop", cuerpo: { type: "payment.refunded", data: { id: "pay_DDD", refunded_amount: 20, currency: "usd", user: { email: "d@d.com" } } } },
  ];
  for (let vuelta = 0; vuelta < 3; vuelta++) for (const a of avisos) assert.equal((await llamar(a.proveedor, a.cuerpo)).status, 200);
  assert.equal(movs().length, 0, "ningún reembolso es un cobro");
  assert.deepEqual(devs().map((d) => d.id).sort(), ["dev_hotmart_reembolso:HPBBB", "dev_hotmart_reembolso:HPCCC", "dev_stripe_re_AAA", "dev_whop_reembolso:pay_DDD"].sort());
  for (const d of devs()) {
    assert.equal(d.estado, "propuesta", "una propuesta no resta plata hasta que Finanzas la confirme");
    assert.ok((d.monto as number) > 0);
  }
  assert.equal(devs().find((d) => d.id === "dev_stripe_re_AAA")?.monto, 1500);
  assert.equal(devs().find((d) => d.id === "dev_hotmart_reembolso:HPCCC")?.motivo, "Contracargo");
});

test("una disputa de Stripe (dp_) o cualquier objeto que no sea cargo, intento ni sesión no entra como cobro", async () => {
  vaciar();
  for (const objeto of ["dp_1", "re_1", "evt_1", "in_1", "sub_1", "cus_1", "txn_1", "po_1", "seti_1", "src_1", "price_1", "ch1", "CH_1", " ch_1"]) {
    const r = await llamar("stripe", { type: "charge.dispute.created", data: { object: { id: objeto, amount: 5000, currency: "usd", created: T0 } } });
    assert.equal(r.status, 200, objeto);
  }
  assert.equal(movs().length, 0);
});

/* ---------- basura autorizada ---------- */

/* Una mutación al azar de un aviso bueno. Los campos de fecha quedan en un rango razonable (los extremos
   tienen su BUG aparte, más abajo). */
function mutar(az: Azar, base: unknown): unknown {
  const copia = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  const rutas: string[][] = [];
  const caminar = (o: unknown, ruta: string[]) => {
    if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { rutas.push([...ruta, k]); caminar(v, [...ruta, k]); }
  };
  caminar(copia, []);
  for (let i = az.int(1, 3); i > 0 && rutas.length; i--) {
    const ruta = az.pick(rutas);
    const ultima = ruta[ruta.length - 1];
    const esFecha = /created|paid_at|order_date|approved_date|created_date|refunded_at|updated_at/.test(ultima);
    let nuevo = basura(az);
    if (esFecha && typeof nuevo === "number" && Math.abs(nuevo) > 1e12) nuevo = az.int(0, 2_000_000_000);
    if (esFecha && typeof nuevo === "string" && /^[-+]?\d{9,}$/.test(nuevo)) nuevo = "1790000000";
    /* Un monto de 1e308 desborda a Infinity al redondear (y el JSON lo manda como null): la base lo rechaza con un error (200 con «error»), no es el punto de esta prueba. */
    if (typeof nuevo === "number" && Math.abs(nuevo) > 1e15) nuevo = 1e15;
    /* moneda(): un «currency» que no es texto tira TypeError (BUG aparte, abajo). */
    if (/^(currency|currency_value|currency_code|currency_id)$/.test(ultima) && typeof nuevo !== "string") nuevo = "usd";
    /* dLocal y Mercado Pago guardan la fecha del aviso tal cual viene (BUG aparte, abajo). */
    if (/^(approved_date|created_date|date_approved|date_created)$/.test(ultima) && typeof nuevo === "string") nuevo = new Date(T0 * 1000).toISOString();
    let o: Record<string, unknown> | null = copia;
    for (const k of ruta.slice(0, -1)) {
      const sig: unknown = o?.[k];
      o = sig && typeof sig === "object" ? (sig as Record<string, unknown>) : null;
      if (!o) break;
    }
    if (!o) continue;
    if (nuevo === undefined) delete o[ultima]; else o[ultima] = nuevo;
  }
  return copia;
}

test("basura con la autorización puesta: siempre 200, y lo que se guarda tiene monto positivo, fecha válida y referencia", propiedad("basura autorizada", 400, async (az) => {
  vaciar();
  const base = az.pick([
    () => ({ proveedor: "stripe", cuerpo: cargoStripe(`ch_${az.alfanum(8)}`, az.int(1, 90000)) }),
    () => ({ proveedor: "stripe", cuerpo: intentoStripe(`pi_${az.alfanum(8)}`, az.int(1, 90000)) }),
    () => ({ proveedor: "stripe", cuerpo: { type: "checkout.session.completed", data: { object: { id: `cs_${az.alfanum(8)}`, amount_total: 1000 } } } }),
    () => ({ proveedor: "stripe", cuerpo: reembolsoStripe(`re_${az.alfanum(8)}`, `ch_${az.alfanum(8)}`, az.int(1, 90000)) }),
    () => ({ proveedor: "hotmart", cuerpo: compraHotmart(`HP${az.alfanum(8)}`, az.int(1, 900), az.pick(["PURCHASE_APPROVED", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK"])) }),
    () => ({ proveedor: "whop", cuerpo: pagoWhop(`pay_${az.alfanum(8)}`, az.int(1, 900), az.pick(["payment.succeeded", "payment.refunded"])) }),
    () => ({ proveedor: "dlocal", cuerpo: pagoDlocal(`D-${az.alfanum(8)}`, az.int(1, 900)) }),
    () => ({ proveedor: "mercadopago", cuerpo: { action: "payment.created", data: { id: az.digitos(10) } } }),
  ])();
  const cuerpo = mutar(az, base.cuerpo);
  const r = await llamar(base.proveedor, cuerpo);
  assert.equal(r.status, 200, `cuerpo ${JSON.stringify(cuerpo).slice(0, 300)}`);
  for (const m of movs()) {
    assert.ok(typeof m.referencia === "string" && (m.referencia as string).length > 0);
    assert.ok(Number.isFinite(m.monto as number) && (m.monto as number) > 0, `monto ${m.monto} (cuerpo ${JSON.stringify(cuerpo).slice(0, 400)})`);
    assert.ok(Number.isFinite(m.fee as number) && Number.isFinite(m.neto as number));
    assert.ok(!Number.isNaN(Date.parse(m.fecha as string)), `fecha ${m.fecha}`);
    assert.ok(["USD", "ARS"].includes(m.moneda as string));
  }
  for (const d of devs()) {
    assert.equal(d.estado, "propuesta");
    assert.ok(Number.isFinite(d.monto as number) && (d.monto as number) > 0);
  }
}));

test("cuerpos que no son un objeto (texto, número, lista, form-urlencoded, vacío) con la autorización puesta: 200 sin guardar", async () => {
  vaciar();
  for (const proveedor of ["stripe", "hotmart", "whop", "dlocal", "mercadopago"]) {
    for (const cuerpo of ["", "   ", "hola", "123", "true", "[]", "[1,2,3]", '"texto"', "{", "id=ch_1&amount=100", "\u0000", "x".repeat(200_000), "[" + "[".repeat(2000) + "]".repeat(2000) + "]"]) {
      const r = await llamar(proveedor, cuerpo);
      assert.equal(r.status, 200, `${proveedor}: ${cuerpo.slice(0, 20)}`);
    }
  }
  assert.equal(movs().length, 0);
});

/* ---------- los secretos ---------- */

test("los secretos (token, clave de firma, hottok, clave de servicio) no salen en ninguna respuesta ni en la consola", async () => {
  vaciar();
  const secretos = [TOKEN, WHSEC, HOTTOK, SERVICIO];
  const { valor: cuerpos, texto } = await capturandoConsola(async () => {
    const salida: string[] = [];
    const az = new Azar(4242);
    const pedidos: [string, unknown, Parameters<typeof llamar>[2]?][] = [
      ["stripe", cargoStripe("ch_s1", 1000)], ["stripe", cargoStripe("ch_s1", 1000), { token: "malo" }], ["stripe", "{", { token: null }],
      ["hotmart", compraHotmart("HPs1", 5), { token: null, cabeceras: { "x-hotmart-hottok": HOTTOK } }],
      ["hotmart", compraHotmart("HPs2", 5), { token: null, cabeceras: { "x-hotmart-hottok": "mal" } }],
      ["paypal", {}], ["whop", pagoWhop("pay_s1", 3)], ["stripe", reembolsoStripe("re_s1", "ch_s1", 100)],
      ["stripe", cargoStripe("ch_s2", 1000), { token: null, cabeceras: { "stripe-signature": firmaStripe(JSON.stringify(cargoStripe("ch_s2", 1000))) } }],
    ];
    for (let i = 0; i < 30; i++) pedidos.push([az.pick(["stripe", "hotmart", "whop", "dlocal"]), basura(az) ?? {}]);
    for (const [p, c, op] of pedidos) {
      const cuerpoPedido = typeof c === "string" ? c : JSON.stringify(c);
      const r = await llamar(p, cuerpoPedido, op);
      salida.push(`${r.status} ${await r.text()}`);
    }
    salida.push(await (await GET()).text());
    return salida;
  });
  const todo = cuerpos.join("\n") + "\n" + texto;
  for (const s of secretos) assert.equal(todo.includes(s), false, `se coló un secreto: ${s.slice(0, 8)}…`);
});

/* ---------- con la API de Stripe a mano (la configuración recomendada) ---------- */

test("con la clave de Stripe: cargo, intento y sesión del MISMO pago dan un solo cobro, en cualquier orden y repetidos, con la comisión real", propiedad("tres avisos, un cobro", 25, async (az) => {
  vaciar();
  const clave = "sk_test_estres_no_es_real";
  process.env.STRIPE_SECRET_KEY = clave;
  const cantidad = az.int(1, 5);
  const pagos = Array.from({ length: cantidad }, (_, i) => {
    const sufijo = az.alfanum(8) + i;
    const centavos = az.int(1000, 900000), fee = Math.round(centavos * 0.029) + 30;
    return { ch: `ch_${sufijo}`, pi: `pi_${sufijo}`, cs: `cs_${sufijo}`, centavos, fee };
  });
  const cargoDe = (p: (typeof pagos)[number]) => ({
    id: p.ch, object: "charge", amount: p.centavos, currency: "usd", created: T0, status: "succeeded", payment_intent: p.pi,
    balance_transaction: { id: `txn_${p.ch}`, fee: p.fee, net: p.centavos - p.fee },
    billing_details: { email: "Cliente@Mail.com", name: "Cliente" },
  });
  nube.soltar();
  nube.manejar((url) => {
    if (url.host !== "api.stripe.com") return undefined;
    const ruta = url.pathname.replace("/v1/", "");
    const [tipo, id] = ruta.split("/");
    const p = pagos.find((x) => x.ch === id || x.pi === id || x.cs === id);
    if (!p) return { status: 404, json: { error: { message: "No such object" } } };
    if (tipo === "charges") return { json: cargoDe(p) };
    if (tipo === "payment_intents") return { json: { id: p.pi, latest_charge: cargoDe(p) } };
    if (tipo === "checkout") return { json: { id: p.cs, customer_details: { email: "cliente@mail.com", name: "Cliente" }, payment_intent: { id: p.pi, latest_charge: cargoDe(p) } } };
    return undefined;
  });
  try {
    const avisos: Aviso[] = pagos.flatMap((p) => [
      { proveedor: "stripe", cuerpo: cargoStripe(p.ch, p.centavos) },
      { proveedor: "stripe", cuerpo: intentoStripe(p.pi, p.centavos) },
      { proveedor: "stripe", cuerpo: { type: "checkout.session.completed", data: { object: { id: p.cs, amount_total: p.centavos, currency: "usd", created: T0 } } } },
    ]);
    for (const a of az.mezclar([...avisos, ...avisos.slice(0, 4)])) assert.equal((await llamar(a.proveedor, a.cuerpo)).status, 200);
    assert.deepEqual(movs().map((m) => m.referencia).sort(), pagos.map((p) => p.ch).sort(), "un cobro por pago, siempre con el id del cargo");
    for (const p of pagos) {
      const m = movs().find((x) => x.referencia === p.ch)!;
      assert.equal(m.monto, p.centavos / 100);
      assert.equal(m.fee, p.fee / 100, "la comisión real de Stripe, no la del aviso");
      assert.equal(m.neto, (p.centavos - p.fee) / 100);
      assert.equal(m.id, `mov_stripe_${p.ch}`);
    }
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    nube.soltar();
  }
}));

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: un cuerpo «null» con la autorización puesta tira TypeError (500) en vez de contestar 200", { todo: true }, async () => {
  /* JSON.parse("null") da null; después tipoDelAviso(cuerpo) lee cuerpo.event. El comentario de la
     ruta dice «siempre se responde 200 salvo que el aviso no esté autorizado: un 500 hace que la
     pasarela reintente el mismo evento durante días». */
  vaciar();
  for (const proveedor of ["stripe", "hotmart", "whop", "dlocal"]) {
    const r = await llamar(proveedor, "null");
    assert.equal(r.status, 200, proveedor);
  }
});

test("BUG: una fecha enorme en el aviso (created 1e300) tira RangeError (500) en vez de contestar 200", { todo: true }, async () => {
  /* new Date(n * 1000).toISOString() con n finito pero enorme lanza «Invalid time value»; numero()
     sólo filtra NaN e Infinity. Pasa en Stripe (created), Hotmart (order_date), Whop (paid_at) y en
     el reembolso de Stripe (re_) con created. */
  vaciar();
  const casos: [string, unknown][] = [
    ["stripe", cargoStripe("ch_gigante", 1000, { created: 1e300 })],
    ["hotmart", compraHotmart("HPgigante", 10, "PURCHASE_APPROVED", { order_date: 1e300 })],
    ["whop", { type: "payment.succeeded", data: { id: "pay_gigante", final_amount: 10, paid_at: 1e300 } }],
    ["stripe", reembolsoStripe("re_gigante", "ch_x", 1000).data.object && { type: "refund.created", data: { object: { id: "re_gigante", amount: 1000, status: "succeeded", created: 1e300 } } }],
  ];
  for (const [proveedor, cuerpo] of casos) {
    const r = await llamar(proveedor, cuerpo);
    assert.equal(r.status, 200, `${proveedor} con una fecha enorme`);
  }
});

test("BUG: un «currency» que no es texto (número, objeto) en un aviso de reembolso tira TypeError (500)", { todo: true }, async () => {
  /* moneda(s) hace (s ?? "").toUpperCase() y los adaptadores le pasan `r.currency as string` sin mirar el
     tipo (reembolsoDeStripe, reembolsoDeWhop, deCargoStripe…). El camino de cobros del webhook sí pasa por
     texto() y no se rompe; el de reembolsos sí. */
  vaciar();
  for (const moneda of [123, {}, [], true]) {
    const r1 = await llamar("stripe", { type: "refund.created", data: { object: { id: "re_moneda", amount: 1000, status: "succeeded", created: T0, currency: moneda } } });
    assert.equal(r1.status, 200, `Stripe con currency ${JSON.stringify(moneda)}`);
    const r2 = await llamar("whop", { type: "payment.refunded", data: { id: "pay_moneda", refunded_amount: 10, currency: moneda } });
    assert.equal(r2.status, 200, `Whop con currency ${JSON.stringify(moneda)}`);
  }
});

test("BUG: dLocal guarda la fecha del aviso tal cual viene, aunque no sea una fecha (fecha es texto en la base)", { todo: true }, async () => {
  /* Los otros proveedores arman la fecha con new Date(...).toISOString(); dLocal (webhook y API) y
     Mercado Pago (API) copian el string: «no es una fecha» queda en movimientos.fecha, y de ahí en pagos.fecha. */
  vaciar();
  await llamar("dlocal", { id: "D-fecha-rota", amount: 10, currency: "USD", approved_date: "no es una fecha" });
  assert.equal(movs().length, 1);
  assert.ok(!Number.isNaN(Date.parse(movs()[0].fecha as string)), `fecha guardada: «${movs()[0].fecha}»`);
});

test("BUG: un pago que la pasarela NO aprobó (fallido, boleto impreso, cancelado, vencido) entra como cobro con los montos del aviso", { todo: true }, async () => {
  /* La ruta dice «Lo que diga la pasarela por API gana» y contesta «El aviso no es un cobro aprobado»
     cuando traerUno() no confirma. Pero traerUno() devuelve null tanto si la pasarela dice «no está
     aprobado» como si no se la pudo consultar, y el código hace `confirmado ?? delAviso`: el cuerpo del
     aviso (lo que se dice no creerle) entra igual. Con las claves puestas ocurre lo mismo (Hotmart
     sólo lista aprobadas y completas: un BILLET_PRINTED no está en su historial). Depende de qué
     eventos se activaron en cada pasarela; la guía manda sólo los de «aprobado». */
  vaciar();
  const noAprobados: Aviso[] = [
    { proveedor: "stripe", cuerpo: { type: "payment_intent.payment_failed", data: { object: { id: "pi_fallido", amount: 5000, currency: "usd", created: T0, status: "requires_payment_method" } } } },
    { proveedor: "stripe", cuerpo: cargoStripe("ch_fallido", 5000, { status: "failed", paid: false }) },
    { proveedor: "hotmart", cuerpo: compraHotmart("HPboleto", 100, "PURCHASE_BILLET_PRINTED") },
    { proveedor: "hotmart", cuerpo: compraHotmart("HPcancel", 100, "PURCHASE_CANCELED") },
    { proveedor: "hotmart", cuerpo: compraHotmart("HPexpiro", 100, "PURCHASE_EXPIRED") },
    { proveedor: "whop", cuerpo: pagoWhop("pay_falla", 50, "payment.failed") },
  ];
  for (const a of noAprobados) await llamar(a.proveedor, a.cuerpo);
  assert.deepEqual(movs().map((m) => m.referencia), [], "ninguno de estos es plata cobrada");
});

test("BUG: con la clave de Stripe puesta, un intento que Stripe dice «no cobrado» igual entra con el monto del aviso", { todo: true }, async () => {
  vaciar();
  process.env.STRIPE_SECRET_KEY = "sk_test_estres_no_es_real";
  nube.soltar();
  nube.manejar((url) => {
    if (url.host === "api.stripe.com" && url.pathname.includes("payment_intents/pi_noCobrado")) {
      return { json: { id: "pi_noCobrado", latest_charge: { id: "ch_noCobrado", status: "failed", amount: 7000, currency: "usd", created: T0 } } };
    }
    return undefined;
  });
  try {
    await llamar("stripe", intentoStripe("pi_noCobrado", 7000));
    assert.deepEqual(movs().map((m) => m.referencia), [], "Stripe dijo que el cargo falló");
  } finally {
    delete process.env.STRIPE_SECRET_KEY;
    nube.soltar();
  }
});

test("BUG: sin API (o si falla), el aviso del cargo y el del intento del MISMO pago dan dos cobros (ch_ y pi_)", { todo: true }, async () => {
  /* Con las claves, los dos se resuelven al cargo (ch_…) y es uno solo. Si traerUno() no puede
     consultar a Stripe (sin clave, un 429, un corte), cada aviso entra con su propio id y el pago se
     cuenta dos veces: el intento trae latest_charge, con lo que se podría unir. La guía manda
     suscribir charge.succeeded Y payment_intent.succeeded. */
  vaciar();
  await llamar("stripe", cargoStripe("ch_mismoPago", 50000, { payment_intent: "pi_mismoPago" }));
  await llamar("stripe", intentoStripe("pi_mismoPago", 50000, { latest_charge: "ch_mismoPago" }));
  assert.equal(movs().length, 1, "es un solo pago de 500 USD");
});

test("BUG: los secretos del webhook (token de la URL y hottok) se comparan con === en vez de en tiempo constante", { todo: true }, () => {
  /* La firma de Stripe sí usa timingSafeEqual (función iguales()); el token de la URL y el hottok no. */
  const raiz = fileURLToPath(new URL("../../src/app/api/", import.meta.url));
  const archivos: string[] = [];
  const recorrer = (d: string) => { for (const n of readdirSync(d)) { const p = join(d, n); if (statSync(p).isDirectory()) recorrer(p); else if (n === "route.ts") archivos.push(p); } };
  recorrer(raiz);
  const SECRETO = /(===|!==)\s*(`Bearer \$\{|token\b|hottok\b|esperado\b|secreto\b|cronSecreto\b)|\b(token|hottok|esperado|secreto|cronSecreto)\s*(===|!==)/;
  const directas: string[] = [];
  for (const a of archivos) {
    const limpio = readFileSync(a, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    limpio.split("\n").forEach((linea, i) => {
      if (SECRETO.test(linea) && !/timingSafeEqual|tokenValido|iguales\(/.test(linea)) directas.push(`${a.slice(raiz.length)}:${i + 1}: ${linea.trim().slice(0, 110)}`);
    });
  }
  assert.deepEqual(directas, [], "comparaciones de secretos que no usan timingSafeEqual");
});

test("BUG: el reembolso que ya entró por el CSV (fecha del cobro) y llega después por la API (fecha real) cuando pasaron más de 15 días entra DOS veces desde el servidor", { todo: true }, async () => {
  /* guardarReembolsos (servidor) sólo trae las devoluciones a ±15 días de las fechas de lo que llega, más las que ya
     tienen esa referencia. La propuesta del CSV («stripe:reembolso:ch_1», con la fecha del cobro: 1/9) queda afuera de
     la ventana del reembolso de la API (re_1, 5/10), así que yaDeCobro() no la ve y se propone otra. En el navegador
     (importarReembolsos, con todo el estado) sí se unen: la misma regla da dos resultados. */
  vaciar();
  nube.nube.filas("devoluciones").push({
    id: "dev_stripe_reembolso:ch_1", monto: 100, moneda: "USD", fecha: "2026-09-01T12:00:00.000Z", estado: "propuesta", referencia: "stripe:reembolso:ch_1", proveedor: "stripe",
    noDescontarAlCloser: false, creadoEn: "2026-10-01T00:00:00.000Z", extra: { origen: "pasarela", referenciasCobro: ["ch_1"], fechaDelCobro: true },
  });
  await llamar("stripe", { type: "refund.created", data: { object: { id: "re_1", amount: 10000, currency: "usd", status: "succeeded", charge: "ch_1", payment_intent: "pi_1", created: Math.floor(Date.parse("2026-10-05T12:00:00Z") / 1000) } } });
  assert.equal(devs().length, 1, `propuestas: ${devs().map((d) => d.id)}`);
});
