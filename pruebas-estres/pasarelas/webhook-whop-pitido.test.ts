import test from "node:test";
import assert from "node:assert/strict";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";

/* ==================================================================
   ESTRÉS · el aviso de Whop es sólo el pitido (24/11).

   Con la clave de Whop, el webhook no guarda lo que dice el cuerpo del aviso
   (cualquiera con el link podría inventar un monto, y el cuerpo de la API v1
   no tiene la forma que leía delPayload): contesta al toque y trae los cobros
   de la API de Whop con el mismo código del cron de cada 5 minutos.
   Por eso también se acepta sin el token del link (la dirección pelada que
   se pega en el panel de Whop): lo peor es pedir una revisión de Whop.
   Red cortada y nube de mentira: no sale nada de la máquina.
   ================================================================== */

const TOKEN = "tok-whop-pitido-5c1e2b9a7d3f";
process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-whop-pitido-falsa";
process.env.PASARELAS_WEBHOOK_TOKEN = TOKEN;
process.env.WHOP_API_KEY = "whop_prueba_pitido";
for (const k of ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "HOTMART_HOTTOK", "CRON_SECRET"]) delete process.env[k];

const inst = instalarFetchFalso();
const AHORA = Math.floor(Date.now() / 1000);
let pedidosAWhop = 0;
inst.manejar((url) => {
  if (url.host !== "api.whop.com") return undefined;
  pedidosAWhop++;
  if (url.pathname === "/api/v5/company/payments") {
    const estado = url.searchParams.get("status");
    const data = estado === "paid" ? [{
      id: "pay_real", final_amount: 500, currency: "usd", paid_at: AHORA - 600, created_at: AHORA - 610, status: "paid", substatus: "succeeded",
      payment_processing_fee: 20, whop_fee: 5.37, user: { name: "Cami", email: "cami@mail.com" }, payment_method_type: "card", card_brand: "visa", card_last4: "4242",
    }] : [];
    return { json: { data, pagination: { total_pages: 1 } } };
  }
  if (url.pathname.startsWith("/api/v1/payments/")) return { json: { status: "paid", substatus: "succeeded", user: { name: "Cami", email: "cami@mail.com" } } };
  return { status: 404, json: {} };
});

const { POST } = await import("@/app/api/pasarelas/webhook/[proveedor]/route");
test.after(() => inst.restaurar());

const avisar = (cuerpo: unknown, token: string | null = TOKEN) => POST(
  new Request(`http://localhost/api/pasarelas/webhook/whop${token === null ? "" : `?token=${token}`}`, { method: "POST", body: JSON.stringify(cuerpo) }),
  { params: Promise.resolve({ proveedor: "whop" }) },
);

test("con la clave de Whop, el monto lo dice la API y no el aviso", async () => {
  const r = await avisar({ type: "payment.succeeded", api_version: "v1", data: { id: "pay_real", final_amount: 99999, total: { amount: "99999.00" } } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, enCamino: true });
  const movs = inst.nube.filas("movimientos");
  assert.equal(movs.length, 1);
  assert.equal(movs[0].referencia, "pay_real");
  assert.equal(Number(movs[0].monto), 500, "lo que cobró Whop, no lo que dice el cuerpo");
  assert.equal(movs[0].estado, "pendiente");
  assert.ok(pedidosAWhop > 0, "le preguntó a Whop");
  /* La revisión anotada en pasarelas_estado la prueba pruebas/pasarelas-al-dia.test.ts (esta nube de mentira no atiende maybeSingle). */
});

test("un aviso inventado de un pago que Whop no tiene no entra", async () => {
  await avisar({ type: "payment.succeeded", data: { id: "pay_inventado", final_amount: 5000, paid_at: AHORA } });
  assert.ok(!inst.nube.filas("movimientos").some((m) => m.referencia === "pay_inventado"));
});

test("el mismo aviso dos veces deja un solo cobro", async () => {
  await avisar({ type: "payment.succeeded", data: { id: "pay_real" } });
  await avisar({ type: "payment.succeeded", data: { id: "pay_real" } });
  assert.equal(inst.nube.filas("movimientos").filter((m) => m.referencia === "pay_real").length, 1);
});

test("sin el token (la dirección pelada que se pega en el panel de Whop) igual sólo trae de la API: nunca guarda el cuerpo", async () => {
  const antes = pedidosAWhop;
  const r = await avisar({ type: "payment.succeeded", data: { id: "pay_trucho", final_amount: 777, paid_at: AHORA } }, null);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, enCamino: true });
  assert.ok(pedidosAWhop > antes, "le preguntó a Whop");
  assert.ok(!inst.nube.filas("movimientos").some((m) => m.referencia === "pay_trucho" || Number(m.monto) === 777), "lo del cuerpo no entra");
  assert.equal((await avisar({ type: "payment.succeeded", data: { id: "pay_real" } }, "otro")).status, 200, "un token equivocado tampoco abre otra cosa que el pitido");
});

test("sin el token, un «reembolso» de Whop no llega a devoluciones (sólo el pitido)", async () => {
  const r = await avisar({ type: "refund.created", data: { id: "pay_dev_trucho", refunded_amount: 999, currency: "usd" } }, null);
  assert.equal(r.status, 200);
  assert.ok(!inst.nube.filas("devoluciones").some((d) => String(d.id).includes("pay_dev_trucho")));
});

test("un reembolso de Whop sigue yendo a devoluciones, nunca a cobros", async () => {
  const r = await avisar({ type: "refund.created", data: { id: "pay_dev", refunded_amount: 20, currency: "usd" } });
  assert.equal(r.status, 200);
  assert.ok(!inst.nube.filas("movimientos").some((m) => m.referencia === "pay_dev"));
});
