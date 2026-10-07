import test from "node:test";
import assert from "node:assert/strict";
import { Azar, propiedad } from "./azar";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · Mercury y los movimientos entre cuentas, por la sincronización
   (/api/pasarelas/sync?guardar=1) con una API de Mercury y de Stripe de
   mentira y una nube de mentira (sin red).

   - Lo que entra de un cliente es un cobro; lo que es de una pasarela
     (Stripe, Hotmart…), de la tarjeta, de las subcuentas, lo pending, lo
     anulado y lo que sale NO es un cobro.
   - Los depósitos de Stripe en Mercury se atan al retiro de Stripe: un solo
     pase con sus dos puntas, y repetir la sincronización (o traer todo en
     otro orden) no crea otro.
   - Un cobro que el banco anula después de entrar a la bandeja se descarta
     solo, con una nota; uno ya conciliado no se toca.
   ================================================================== */

const TOKEN = "tok-mercury-estres-1a2b3c4d5e6f7a8b";
process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-mercury-estres-falsa-0007";
process.env.PASARELAS_WEBHOOK_TOKEN = TOKEN;
process.env.MERCURY_API_TOKEN = "merc_estres_secret_token_5f4e3d2c1b0a";
process.env.STRIPE_SECRET_KEY = "sk_estres_mercury_9e8d7c6b5a49";
for (const k of ["CRON_SECRET", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "MERCURY_REGLAS_INTERNAS"]) delete process.env[k];

const nube = instalarFetchFalso();
const { GET } = await import("@/app/api/pasarelas/sync/route");
test.after(() => nube.restaurar());

const DIA = 86400000;
interface Tx { id: string; amount: number; status: string; counterpartyName?: string; kind?: string; postedAt?: string; createdAt: string; bankDescription?: string }
interface Retiro { id: string; amount: number; created: number; status: string }

let transacciones: Tx[] = [];
let retiros: Retiro[] = [];
function servir(az?: Azar) {
  nube.soltar();
  nube.manejar((url) => {
    const mezclar = <T,>(xs: T[]) => (az ? az.mezclar(xs) : xs);
    if (url.host === "api.mercury.com") {
      if (url.pathname === "/api/v1/accounts") return { json: { accounts: [{ id: "acc1", kind: "checking" }, { id: "cc1", kind: "creditCard" }] } };
      if (url.pathname === "/api/v1/account/acc1/transactions") return { json: { transactions: mezclar(transacciones) } };
      return { json: { transactions: [] } };
    }
    if (url.host === "api.stripe.com") {
      if (url.pathname === "/v1/payouts") return { json: { has_more: false, data: mezclar(retiros).map((r) => ({ id: r.id, object: "payout", amount: r.amount, currency: "usd", created: r.created, status: r.status })) } };
      return { json: { has_more: false, data: [] } };
    }
    return undefined;
  });
}

const sync = () => GET(new Request(`http://localhost/api/pasarelas/sync?token=${TOKEN}&guardar=1`));
const movs = () => nube.nube.filas("movimientos");
const pases = () => nube.nube.filas("traspasos");
const hace = (d: number) => new Date(Date.now() - d * DIA).toISOString();

test("Mercury: sólo es cobro lo que entra de un cliente ya asentado; pasarelas, tarjeta, subcuentas, pending, anulados y salidas no", async () => {
  nube.nube.vaciar();
  retiros = [];
  transacciones = [
    { id: "ok1", amount: 5000, status: "sent", counterpartyName: "Ana Pérez", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(3) },
    { id: "wire1", amount: 1200.5, status: "sent", counterpartyName: "Beto SRL", kind: "incomingDomesticWire", postedAt: hace(1), createdAt: hace(1) },
    { id: "stripe1", amount: 3000, status: "sent", counterpartyName: "STRIPE", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) },
    { id: "hotmart1", amount: 900, status: "sent", counterpartyName: "Hotmart Inc", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) },
    { id: "pend1", amount: 700, status: "pending", counterpartyName: "Cami Ruiz", kind: "externalTransfer", createdAt: hace(1) },
    { id: "fail1", amount: 650, status: "failed", counterpartyName: "Dani Gómez", kind: "externalTransfer", postedAt: hace(1), createdAt: hace(1) },
    { id: "cancel1", amount: 650, status: "cancelled", counterpartyName: "Eli Sosa", kind: "externalTransfer", postedAt: hace(1), createdAt: hace(1) },
    { id: "sale1", amount: -400, status: "sent", counterpartyName: "Proveedor", kind: "externalTransfer", postedAt: hace(1), createdAt: hace(1) },
    { id: "interno1", amount: 800, status: "sent", counterpartyName: "Mercury", kind: "internalTransfer", postedAt: hace(1), createdAt: hace(1) },
    { id: "tarjeta1", amount: 120, status: "sent", counterpartyName: "Mercury Credit", kind: "creditCardTransaction", bankDescription: "Credit card payment", postedAt: hace(1), createdAt: hace(1) },
    { id: "arx1", amount: 2200, status: "sent", counterpartyName: "ARX LLC", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) },
    { id: "cero1", amount: 0, status: "sent", counterpartyName: "X", kind: "other", postedAt: hace(1), createdAt: hace(1) },
  ];
  servir();
  const r = (await (await sync()).json()) as { errores: unknown[]; mercury: { enProceso: number; internos: number; anulados: string[] } };
  assert.deepEqual(r.errores, []);
  assert.deepEqual(movs().map((m) => `${m.referencia}:${m.estado}`).sort(), ["arx1:ignorado", "ok1:pendiente", "wire1:pendiente"], "Hotmart/Stripe no son clientes; ARX entra ignorado (se recupera con un clic)");
  assert.equal(movs().find((m) => m.referencia === "wire1")!.monto, 1200.5);
  assert.equal(movs().find((m) => m.referencia === "wire1")!.metodo, "Wire");
  assert.deepEqual([...r.mercury.anulados].sort(), ["cancel1", "fail1"]);
  assert.equal(r.mercury.enProceso, 1);
  assert.ok(r.mercury.internos >= 2);
  /* Los depósitos de Stripe y Hotmart quedan como punta de un pase (la llegada), no como cobro. */
  assert.ok(pases().some((p) => p.llegadaRef === "mercury:stripe1"));
});

test("un cobro que el banco anula después de entrar a la bandeja se descarta solo con una nota; uno conciliado no se toca; todo repetido no cambia", async () => {
  nube.nube.vaciar();
  retiros = [];
  transacciones = [{ id: "x1", amount: 1000, status: "sent", counterpartyName: "Ana", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) }, { id: "x2", amount: 2000, status: "sent", counterpartyName: "Beto", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) }];
  servir();
  await sync();
  assert.equal(movs().length, 2);
  /* x2 ya se concilió con un pago. Después el banco anula los dos. */
  Object.assign(movs().find((m) => m.referencia === "x2")!, { estado: "conciliado", pagoId: "pag_1" });
  transacciones = transacciones.map((t) => ({ ...t, status: "failed" }));
  servir();
  for (let i = 0; i < 3; i++) await sync();
  const x1 = movs().find((m) => m.referencia === "x1")!, x2 = movs().find((m) => m.referencia === "x2")!;
  assert.equal(x1.estado, "ignorado");
  assert.match(x1.descripcion as string, /El banco lo anuló/);
  assert.equal((x1.descripcion as string).match(/El banco lo anuló/g)!.length, 1, "la nota no se repite en cada pasada");
  assert.equal(x2.estado, "conciliado", "uno ya conciliado lo decide una persona");
  assert.equal(movs().length, 2);
});

test("el retiro de Stripe y el depósito en Mercury son UN pase con sus dos puntas; repetir la sync o traerlos en otro orden no crea otro", propiedad("pases idempotentes", 40, async (az) => {
  nube.nube.vaciar();
  const k = az.int(1, 6);
  retiros = []; transacciones = [];
  const llegan = new Set<number>();
  for (let i = 0; i < k; i++) {
    const monto = 1000 + i * 700 + az.int(0, 99);
    const dia = az.int(2, 20);
    retiros.push({ id: `po_${az.alfanum(8)}${i}`, amount: monto * 100, created: Math.floor((Date.now() - dia * DIA) / 1000), status: "paid" });
    if (az.bool(0.7)) { llegan.add(i); transacciones.push({ id: `dep_${az.alfanum(8)}${i}`, amount: monto, status: "sent", counterpartyName: az.pick(["STRIPE", "Stripe Payments", "STRIPE TRANSFER"]), kind: "externalTransfer", postedAt: hace(dia - az.int(1, 2)), createdAt: hace(dia - 1) }); }
  }
  /* Y plata de clientes que no tiene que ver con nada. */
  for (let i = 0; i < az.int(0, 3); i++) transacciones.push({ id: `cli_${i}`, amount: 50 + i, status: "sent", counterpartyName: `Cliente ${i}`, kind: "externalTransfer", postedAt: hace(3), createdAt: hace(3) });
  servir(az);
  const r1 = (await (await sync()).json()) as { errores: { mensaje: string }[]; pases: { nuevos: number; conciliados: number }; pasesGuardados: boolean };
  assert.deepEqual(r1.errores, []);
  assert.equal(r1.pasesGuardados, true);
  const foto = nube.nube.foto("traspasos");
  /* Un pase por retiro (con o sin llegada); el retiro que llegó queda con sus dos puntas. */
  assert.equal(pases().length, k, `un pase por retiro (llegaron ${llegan.size} de ${k})`);
  assert.equal(pases().filter((p) => p.salidaRef && p.llegadaRef).length, llegan.size);
  const refs = pases().flatMap((p) => [p.salidaRef, p.llegadaRef]).filter(Boolean);
  assert.equal(new Set(refs).size, refs.length, "ninguna punta en dos pases");
  /* Otra vez, con el orden cambiado. */
  for (let i = 0; i < 2; i++) { servir(az); const r = (await (await sync()).json()) as { pases: { nuevos: number } }; assert.equal(r.pases.nuevos, 0, "no hay pases nuevos"); }
  assert.equal(nube.nube.foto("traspasos"), foto, "los pases quedaron igual");
  /* Los depósitos de Stripe no son cobros; los clientes sí, una vez. */
  assert.ok(movs().every((m) => /^cli_/.test(m.referencia as string)));
}));

test("con Mercury y Stripe rechazando la clave (401) la sync contesta 200 con el error de cada una y no guarda nada", async () => {
  nube.nube.vaciar();
  nube.soltar();
  nube.manejar((url) => (url.host === "api.mercury.com" || url.host === "api.stripe.com" ? { status: 401, json: { error: "clave inválida" } } : undefined));
  const r = await sync();
  const j = (await r.json()) as { errores: { proveedor: string; mensaje: string }[] };
  assert.equal(r.status, 200);
  assert.ok(j.errores.some((e) => e.proveedor === "mercury" && /Mercury/.test(e.mensaje) && /401/.test(e.mensaje)));
  assert.ok(j.errores.some((e) => e.proveedor === "stripe" && /401/.test(e.mensaje)));
  assert.equal(movs().length + pases().length, 0);
});

test("BUG: el cobro de un cliente cuyo nombre trae «Mercury», «Stripe» o «Whop» (Mercury Dental SRL, Stripe Studio) se descarta como si fuera una pasarela", { todo: true }, async () => {
  /* NO_ES_CLIENTE = /\b(stripe|hotmart|whop|dlocal|mercado pago|paypal|mercury)\b/i se prueba contra todo el nombre de
     la contraparte: sirve para «STRIPE» (el depósito de Stripe) pero también se lleva a cualquier cliente que lo contenga.
     No entra como cobro ni como pase: la plata no aparece en ninguna parte. */
  nube.nube.vaciar();
  retiros = [];
  transacciones = [
    { id: "dental1", amount: 2400, status: "sent", counterpartyName: "Mercury Dental SRL", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) },
    { id: "studio1", amount: 1800, status: "sent", counterpartyName: "Stripe Studio LLC", kind: "externalTransfer", postedAt: hace(2), createdAt: hace(2) },
  ];
  servir();
  await sync();
  assert.deepEqual(movs().map((m) => m.referencia).sort(), ["dental1", "studio1"]);
});
