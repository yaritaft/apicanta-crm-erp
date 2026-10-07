import test from "node:test";
import assert from "node:assert/strict";
import { Azar, basura, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · la sincronización de las pasarelas (/api/pasarelas/sync), la
   que corre el cron «de seguridad» y la que aprieta Conciliación.

   Se llama a la ruta de verdad con las claves de todas las pasarelas
   puestas, una nube de mentira en memoria y las APIs de las pasarelas
   contestadas por la prueba (con datos buenos al azar o con basura). La
   red está cortada.

   - La puerta: sin credencial 401; con el secreto del cron o el token, 200.
   - Con las pasarelas contestando basura (JSON roto, tipos cambiados, 429,
     500, listas donde va un objeto): siempre 200 con JSON, el error de cada
     pasarela viaja en `errores` y lo que se guarda tiene monto, fecha y
     referencia válidos.
   - Con datos buenos: guardar dos veces, o con el listado en otro orden,
     deja lo mismo y no duplica (el id sale de la referencia), y los
     montos son los de la pasarela (Stripe habla en centavos).
   ================================================================== */

const TOKEN = "tok-sync-estres-5d1e8a77c3b94f20";
const CRON = "cron-estres-0a9b8c7d6e5f4a3b2c1d";
const SERVICIO = "svc-sync-estres-falsa-0002";

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICIO;
process.env.PASARELAS_WEBHOOK_TOKEN = TOKEN;
process.env.CRON_SECRET = CRON;
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "MERCURY_REGLAS_INTERNAS"]) delete process.env[k];
const CLAVES: Record<string, string> = {
  STRIPE_SECRET_KEY: "sk_estres_a1b2c3d4e5f6", HOTMART_CLIENT_ID: "hm-id-estres-9f8e7d", HOTMART_CLIENT_SECRET: "hm-secreto-estres-6c5b4a", HOTMART_BASIC: "hm-basic-estres-3d2c1b",
  WHOP_API_KEY: "whop_estres_0f1e2d3c", DLOCAL_X_LOGIN: "dl-login-estres-7a8b9c", DLOCAL_TRANS_KEY: "dl-trans-estres-4d5e6f", DLOCAL_SECRET_KEY: "dl-secreto-estres-1a2b3c",
  MERCADOPAGO_ACCESS_TOKEN: "mp_estres_APP_USR_5e4d3c", MERCURY_API_TOKEN: "merc_estres_secret_8b7a6f", BINANCE_API_KEY: "bn-key-estres-2c3d4e", BINANCE_API_SECRET: "bn-secreto-estres-5f6a7b",
  TRUST_WALLET_ADDRESS: "TXestres000000000000000000000000000",
};
const sinClaves = () => { for (const k of Object.keys(CLAVES)) delete process.env[k]; };
const conClaves = () => Object.assign(process.env, CLAVES);
sinClaves();

const nube = instalarFetchFalso();
const { GET } = await import("@/app/api/pasarelas/sync/route");
test.after(() => nube.restaurar());

const pedir = (q = "", cabeceras: Record<string, string> = {}) => GET(new Request(`http://localhost/api/pasarelas/sync${q}`, { headers: cabeceras }));
const ok = `?token=${TOKEN}&guardar=1`;
const movs = () => nube.nube.filas("movimientos");

/* ---------- la puerta ---------- */

test("la puerta: sin credencial, con otro token, con «Bearer undefined» o con otro secreto de cron: 401, y no guarda", async () => {
  nube.nube.vaciar();
  for (const [q, h] of [
    ["", {}], ["?guardar=1", {}], [`?token=${TOKEN}x`, {}], ["?token=", {}], [`?token=${TOKEN.toUpperCase()}`, {}],
    ["", { authorization: "Bearer undefined" }], ["", { authorization: "Bearer " }], ["", { authorization: `Bearer ${CRON}x` }],
    ["", { authorization: CRON }], ["", { authorization: `bearer ${CRON}` }], ["", { authorization: `Basic ${CRON}` }],
    ["?guardar=1", { authorization: "Bearer algo.que.parece.un.jwt" }],
  ] as [string, Record<string, string>][]) {
    const r = await pedir(q, h);
    assert.equal(r.status, 401, `${q} ${JSON.stringify(h)}`);
    assert.equal((await r.text()).includes(CRON), false);
  }
  assert.equal(nube.nube.escrituras.length, 0);
  assert.equal((await pedir("", { authorization: `Bearer ${CRON}` })).status, 200, "el cron entra");
  assert.equal((await pedir(`?token=${TOKEN}`)).status, 200, "el token entra");
});

test("sin CRON_SECRET en el entorno «Bearer undefined» no abre nada", async () => {
  const antes = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  try {
    assert.equal((await pedir("", { authorization: "Bearer undefined" })).status, 401);
  } finally { process.env.CRON_SECRET = antes; }
});

/* ---------- las APIs contestando basura ---------- */

test("con las pasarelas contestando basura, la ruta siempre contesta 200 con JSON y lo que guarda es válido", propiedad("sync con caos", 120, async (az) => {
  conClaves();
  nube.soltar();
  nube.nube.vaciar();
  nube.manejar((url) => {
    if (url.origin === URL_NUBE) return undefined;
    const k = az.int(0, 6);
    const cuerpo = k === 0 ? basura(az)
      : k === 1 ? { data: basura(az), items: basura(az), results: basura(az), transactions: basura(az), accounts: basura(az), token_transfers: basura(az), access_token: "tok", has_more: basura(az), pagination: basura(az) }
      : k === 2 ? [basura(az), basura(az)]
      : k === 3 ? { data: [basura(az), basura(az), basura(az)], items: [basura(az)], results: [basura(az)], access_token: "t", accounts: [{ id: "a1", kind: "checking" }], transactions: [basura(az)], token_transfers: [basura(az)] }
      : k === 4 ? "esto no es json"
      : k === 5 ? null : {};
    if (typeof cuerpo === "string") return { status: az.pick([200, 500, 401]), texto: cuerpo };
    return { status: az.pick([200, 200, 200, 400, 429, 500]), json: cuerpo };
  });
  try {
    const r = await pedir(ok);
    assert.equal(r.status, 200);
    const j = (await r.json()) as { errores: { proveedor: string; mensaje: string }[]; movimientos: unknown[]; conectadas: string[] };
    assert.ok(Array.isArray(j.errores) && Array.isArray(j.movimientos) && Array.isArray(j.conectadas));
    for (const e of j.errores) assert.ok(typeof e.mensaje === "string" && e.mensaje.length > 0 && typeof e.proveedor === "string");
    for (const m of movs()) {
      assert.ok(typeof m.referencia === "string" && (m.referencia as string) !== "");
      assert.ok(Number.isFinite(m.monto as number) && (m.monto as number) > 0, `monto ${m.monto}`);
    }
    /* Ninguna clave en la respuesta ni en los errores. */
    const texto = JSON.stringify(j);
    for (const v of Object.values(CLAVES)) assert.equal(texto.includes(v), false, `se coló «${v}»`);
  } finally { sinClaves(); nube.soltar(); }
}));

/* ---------- las APIs contestando bien ---------- */

interface Mundo {
  stripe: { id: string; centavos: number; fee: number; creado: number; devuelto: boolean; estado: string }[];
  hotmart: { tx: string; valor: number; comision: number; aprobado: number }[];
  whop: { id: string; monto: number; fee: number; pagado: number }[];
  mp: { id: number; monto: number; neto: number }[];
  dlocal: { id: string; monto: number; estado: string }[];
  binance: { txId: string; monto: number; estado: number }[];
}

const AHORA_S = () => Math.floor(Date.now() / 1000);

function mundoAleatorio(az: Azar): Mundo {
  const cuantos = () => az.int(0, 6);
  return {
    stripe: Array.from({ length: cuantos() }, (_, i) => {
      const centavos = az.int(500, 900000);
      return { id: `ch_${az.alfanum(10)}${i}`, centavos, fee: Math.round(centavos * 0.029) + 30, creado: AHORA_S() - az.int(60, 20 * 86400), devuelto: az.bool(0.1), estado: az.pick(["succeeded", "succeeded", "succeeded", "failed", "pending"]) };
    }),
    hotmart: Array.from({ length: cuantos() }, (_, i) => {
      const valor = az.int(1, 5000);
      return { tx: `HP${az.alfanum(12)}${i}`, valor, comision: Math.round(valor * 0.9 * 100) / 100, aprobado: (AHORA_S() - az.int(60, 20 * 86400)) * 1000 };
    }),
    whop: Array.from({ length: cuantos() }, (_, i) => ({ id: `pay_${az.alfanum(10)}${i}`, monto: az.int(1, 4000), fee: az.int(0, 100), pagado: AHORA_S() - az.int(60, 20 * 86400) })),
    mp: Array.from({ length: cuantos() }, () => { const monto = az.int(1, 90000); return { id: az.int(1_000_000, 9_999_999) * 1000 + az.int(0, 999), monto, neto: Math.round(monto * 0.94 * 100) / 100 }; }),
    dlocal: Array.from({ length: cuantos() }, (_, i) => ({ id: `D-${az.alfanum(8)}${i}`, monto: az.int(1, 3000), estado: az.pick(["PAID", "PAID", "AUTHORIZED", "REJECTED", "PENDING"]) })),
    binance: Array.from({ length: cuantos() }, (_, i) => ({ txId: `0x${az.alfanum(40)}${i}`, monto: az.int(1, 9000), estado: az.pick([1, 1, 0, 6]) })),
  };
}

function servirMundo(az: Azar, m: Mundo) {
  const mezcla = <T,>(xs: T[]) => az.mezclar(xs);
  nube.soltar();
  nube.manejar((url) => {
    const { host, pathname } = url;
    if (host === "api.stripe.com") {
      if (pathname === "/v1/charges") {
        return { json: { has_more: false, data: mezcla(m.stripe).map((c) => ({
          id: c.id, object: "charge", status: c.estado, refunded: c.devuelto, amount: c.centavos, currency: "usd", created: c.creado,
          balance_transaction: { fee: c.fee, net: c.centavos - c.fee }, billing_details: { email: "Cliente@Mail.com", name: "Cliente" },
          payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
        })) } };
      }
      return { json: { data: [], has_more: false } };
    }
    if (host === "api-sec-vlc.hotmart.com") return { json: { access_token: "tok_hotmart" } };
    if (host === "developers.hotmart.com") {
      if (pathname.endsWith("sales/commissions")) return { json: { items: mezcla(m.hotmart).map((h) => ({ transaction: h.tx, commissions: [{ source: "PRODUCER", commission: { value: h.comision } }] })), page_info: {} } };
      if (pathname.endsWith("sales/history")) {
        if (url.searchParams.get("transaction_status")) return { json: { items: [], page_info: {} } };
        return { json: { items: mezcla(m.hotmart).map((h) => ({ purchase: { transaction: h.tx, price: { value: h.valor, currency_code: "USD" }, approved_date: h.aprobado, order_date: h.aprobado - 1000, payment: { type: "CREDIT_CARD", installments_number: 1 } }, buyer: { name: "Beto", email: "Beto@Mail.com" }, product: { name: "Mentoría" } })), page_info: {} } };
      }
    }
    if (host === "api.whop.com") {
      if (pathname.startsWith("/api/v5/company/payments")) {
        if (url.searchParams.get("status") === "refunded") return { json: { data: [], pagination: { total_pages: 1 } } };
        return { json: { data: mezcla(m.whop).sort((a, b) => b.pagado - a.pagado).map((w) => ({ id: w.id, final_amount: w.monto, currency: "usd", paid_at: w.pagado, payment_processing_fee: w.fee, user: { name: "Cami", email: "cami@mail.com" }, payment_method_type: "card", card_brand: "visa", card_last4: "4242" })), pagination: { total_pages: 1 } } };
      }
      return { json: {} };
    }
    if (host === "api.mercadopago.com") {
      return { json: { results: mezcla(m.mp).map((p) => ({ id: p.id, transaction_amount: p.monto, transaction_details: { net_received_amount: p.neto }, currency_id: "ARS", date_approved: new Date().toISOString(), payer: { email: "mp@mail.com", first_name: "Maru", last_name: "Paz" }, payment_type_id: "credit_card", payment_method_id: "visa" })) } };
    }
    if (host === "api.dlocal.com") {
      return { json: mezcla(m.dlocal).map((p) => ({ id: p.id, amount: p.monto, currency: "USD", status: p.estado, approved_date: new Date().toISOString(), payer: { name: "Dani", email: "dani@mail.com" } })) };
    }
    if (host === "api.mercury.com") return { json: pathname.endsWith("/accounts") ? { accounts: [] } : { transactions: [] } };
    if (host === "api.binance.com") return { json: mezcla(m.binance).map((d) => ({ txId: d.txId, amount: String(d.monto), status: d.estado, insertTime: Date.now() - 86400000, coin: "USDT", network: "TRX" })) };
    if (host === "apilist.tronscanapi.com") return { json: { token_transfers: [] } };
    return undefined;
  });
}

function esperados(m: Mundo): Map<string, { monto: number; fee?: number; neto?: number }> {
  const e = new Map<string, { monto: number; fee?: number; neto?: number }>();
  for (const c of m.stripe) if (c.estado === "succeeded" && !c.devuelto) e.set(`stripe:${c.id}`, { monto: c.centavos / 100, fee: c.fee / 100, neto: (c.centavos - c.fee) / 100 });
  for (const h of m.hotmart) e.set(`hotmart:${h.tx}`, { monto: h.valor, neto: h.comision });
  for (const w of m.whop) e.set(`whop:${w.id}`, { monto: w.monto, fee: w.fee || undefined });
  for (const p of m.mp) e.set(`mercadopago:${p.id}`, { monto: p.monto, neto: p.neto });
  for (const d of m.dlocal) if (/paid|authorized/i.test(d.estado)) e.set(`dlocal:${d.id}`, { monto: d.monto });
  for (const d of m.binance) if (d.estado === 1) e.set(`binance:${d.txId}`, { monto: d.monto });
  return e;
}

test("con datos buenos: quedan exactamente los cobros aprobados, con los montos de la pasarela; guardar dos veces o con otro orden no duplica", propiedad("sync idempotente", 40, async (az) => {
  conClaves();
  try {
    const mundo = mundoAleatorio(az);
    const esperado = esperados(mundo);
    nube.nube.vaciar();
    servirMundo(az, mundo);
    const r1 = await pedir(ok);
    assert.equal(r1.status, 200);
    const j1 = (await r1.json()) as { guardados: number; errores: { proveedor: string; mensaje: string }[] };
    assert.deepEqual(j1.errores, [], "sin errores");
    const claves = movs().map((m) => `${m.proveedor}:${m.referencia}`).sort();
    assert.deepEqual(claves, [...esperado.keys()].sort(), "exactamente los aprobados: ni los fallidos/pendientes ni los devueltos");
    assert.equal(j1.guardados, esperado.size);
    for (const m of movs()) {
      const e = esperado.get(`${m.proveedor}:${m.referencia}`)!;
      assert.equal(m.id, `mov_${m.proveedor}_${m.referencia}`);
      assert.equal(m.monto, e.monto, `monto de ${m.referencia}`);
      assert.ok((m.fee as number) >= 0 && (m.neto as number) <= (m.monto as number) + 0.001, "el neto nunca supera lo cobrado");
      if (e.fee !== undefined) assert.equal(m.fee, e.fee, `comisión de ${m.referencia}`);
      if (e.neto !== undefined) assert.equal(m.neto, e.neto, `neto de ${m.referencia}`);
      assert.equal(m.procesadorId, `proc_${m.proveedor}`);
      assert.equal(m.estado, "pendiente");
    }
    const foto1 = nube.nube.foto("movimientos");

    /* Otra vez, con el listado en otro orden: nada nuevo. */
    servirMundo(az, mundo);
    const j2 = (await (await pedir(ok)).json()) as { guardados: number; errores: unknown[] };
    assert.deepEqual(j2.errores, []);
    assert.equal(j2.guardados, 0, "ninguno es nuevo");
    assert.equal(nube.nube.foto("movimientos"), foto1);
  } finally { sinClaves(); nube.soltar(); }
}));

test("sin guardar (?guardar=1 ausente) devuelve lo que vio y no escribe nada", async () => {
  conClaves();
  try {
    const az = new Azar(99);
    const mundo = mundoAleatorio(az);
    mundo.stripe = [{ id: "ch_solo_mirar", centavos: 12345, fee: 400, creado: AHORA_S() - 3600, devuelto: false, estado: "succeeded" }];
    nube.nube.vaciar();
    servirMundo(az, mundo);
    const r = await pedir(`?token=${TOKEN}`);
    const j = (await r.json()) as { movimientos: { referencia: string; monto: number }[]; guardados: number };
    assert.equal(j.guardados, 0);
    assert.equal(nube.nube.escrituras.length, 0, "no escribió");
    assert.ok(j.movimientos.some((m) => m.referencia === "ch_solo_mirar" && m.monto === 123.45));
  } finally { sinClaves(); nube.soltar(); }
});

test("un cobro que ya estaba sin comisión (el aviso llegó antes que Stripe la calculara) la completa después, sin duplicarse ni pisar la conciliación", async () => {
  conClaves();
  try {
    const az = new Azar(7);
    const cargo = { id: "ch_completar", centavos: 100000, fee: 3230, creado: AHORA_S() - 7200, devuelto: false, estado: "succeeded" };
    nube.nube.vaciar();
    /* El aviso del webhook ya había guardado el cobro, sin comisión y conciliado con un pago. */
    nube.nube.filas("movimientos").push({ id: "mov_stripe_ch_completar", proveedor: "stripe", referencia: "ch_completar", monto: 1000, fee: 0, neto: 1000, moneda: "USD", fecha: new Date().toISOString(), estado: "conciliado", pagoId: "pag_1", cuotaId: "cuo_1", origen: "webhook", creadoEn: new Date().toISOString() });
    nube.nube.filas("pagos").push({ id: "pag_1", movimientoId: "mov_stripe_ch_completar", monto: 1000, feeMonto: 0, feeRate: 0 });
    servirMundo(az, { stripe: [cargo], hotmart: [], whop: [], mp: [], dlocal: [], binance: [] });
    const j = (await (await pedir(ok)).json()) as { guardados: number; completados: number };
    assert.equal(j.guardados, 0);
    assert.equal(j.completados, 1);
    assert.equal(movs().length, 1);
    assert.equal(movs()[0].fee, 32.3);
    assert.equal(movs()[0].neto, 967.7);
    assert.equal(movs()[0].estado, "conciliado", "la conciliación no se toca");
    assert.equal(movs()[0].pagoId, "pag_1");
    assert.equal(nube.nube.filas("pagos")[0].feeMonto, 32.3, "el pago conciliado toma la comisión real");
    /* Una tercera vez: ya no hay nada que completar. */
    const k = (await (await pedir(ok)).json()) as { completados: number };
    assert.equal(k.completados, 0);
  } finally { sinClaves(); nube.soltar(); }
});

/* ==================================================================
   BUGS de verdad. { todo: true }: se corren y se ven fallar, sin romper la suite.
   ================================================================== */

test("BUG: ?dias=abc (o NaN) con credencial tira RangeError «Invalid time value» (500) en vez de usar la ventana por defecto o contestar 400", { todo: true }, async () => {
  /* desdeHasta(): Number("abc") = NaN; Math.min(Math.max(NaN, 1), 365) = NaN; la fecha «desde» queda inválida y
     desde.toISOString() de la respuesta revienta. Con ?dias= vacío da 1 día en silencio. */
  sinClaves();
  for (const dias of ["abc", "NaN", "1,5", "hoy"]) {
    const r = await pedir(`?token=${TOKEN}&dias=${dias}`);
    assert.ok(r.status === 200 || r.status === 400, `dias=${dias} dio ${r.status}`);
  }
});

test("BUG: un cargo de Stripe en otra moneda (euros) entra con el número de la moneda original rotulado USD y un neto mayor que el monto", { todo: true }, async () => {
  /* deCargoStripe: monto = c.amount / 100 (500 EUR) y moneda(«eur») = «USD»; la comisión y el neto sí vienen de la
     balance_transaction, ya en dólares (fee 17, neto 523): neto > monto, y los 540 USD que cobró de verdad
     (balance_transaction.amount) no se usan. La importación de CSV sí lo previó (usa «Converted Amount»). */
  conClaves();
  try {
    nube.nube.vaciar();
    nube.soltar();
    nube.manejar((url) => {
      if (url.host === "api.stripe.com" && url.pathname === "/v1/charges") {
        return { json: { has_more: false, data: [{ id: "ch_eur", status: "succeeded", refunded: false, amount: 50000, currency: "eur", created: AHORA_S() - 3600, balance_transaction: { amount: 54000, currency: "usd", fee: 1700, net: 52300 }, billing_details: { email: "a@b.com" } }] } };
      }
      return url.host === "api.stripe.com" ? { json: { has_more: false, data: [] } } : undefined;
    });
    await pedir(ok);
    const m = movs().find((x) => x.referencia === "ch_eur")!;
    assert.ok(m, "entró el cobro");
    assert.ok((m.neto as number) <= (m.monto as number), `neto ${m.neto} > monto ${m.monto}`);
    assert.equal(m.monto, 540, "lo que cobró en dólares");
  } finally { sinClaves(); nube.soltar(); }
});

test("BUG: referenciasCompletas('whop') lee los cobros de Whop sin paginar: pasadas las 1000 filas que corta la nube, los cobros ya completos se vuelven a pedir en detalle en cada corrida", { todo: true }, async () => {
  /* servidor.referenciasCompletas hace select(...).eq("proveedor", ...) sobre TODA la historia de la pasarela: PostgREST corta en
     1000 sin avisar. Los cobros completos que quedan afuera de las primeras 1000 filas no están en el conjunto, así que la
     sync le pide a Whop el detalle de cada uno (un pedido por cobro, de a 4) en cada pasada del cron. */
  conClaves();
  try {
    nube.nube.vaciar();
    for (let i = 0; i < 1200; i++) {
      nube.nube.filas("movimientos").push({ id: `mov_whop_pay_${i}`, proveedor: "whop", referencia: `pay_${i}`, monto: 100, fee: 3, neto: 97, moneda: "USD", fecha: new Date().toISOString(), clienteEmail: `p${i}@mail.com`, metodo: "Tarjeta Visa ···4242", estado: "pendiente", origen: "api", creadoEn: new Date().toISOString() });
    }
    let detalles = 0;
    nube.soltar();
    nube.manejar((url) => {
      if (url.host !== "api.whop.com") return url.host === "api.stripe.com" ? { json: { has_more: false, data: [] } } : undefined;
      if (url.pathname.startsWith("/api/v1/payments/")) { detalles++; return { json: {} }; }
      if (url.pathname.startsWith("/api/v5/company/payments")) {
        return { json: { data: [1100, 1101, 1102, 1103, 1104].map((i) => ({ id: `pay_${i}`, final_amount: 100, currency: "usd", paid_at: AHORA_S() - 3600, payment_processing_fee: 3 })), pagination: { total_pages: 1 } } };
      }
      return undefined;
    });
    await pedir(ok);
    assert.equal(detalles, 0, "los 5 cobros ya estaban completos en la base");
  } finally { sinClaves(); nube.soltar(); }
});
