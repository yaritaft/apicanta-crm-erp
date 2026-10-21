import test from "node:test";
import assert from "node:assert/strict";
import { primerConteo } from "@/lib/primer-conteo";

/* Aldana (21/10): el arqueo del 7/10 dejó dLocal, la Financiera USD y la Financiera ARS «en revisión» (en cero). Al contarlas el 20/10 con sus saldos
   reales, la Caja marcó 84.855 «a explicar»: 75.276 eran lo que esas tres cuentas ya tenían el 7/10. Los números son los reales. */

const US = (n: number, m: string) => `${m === "ARS" ? "$" : "US$"} ${n.toFixed(2)}`;
const saldos = [
  { procesadorId: "proc_stripe", monto: 467.93, moneda: "USD" as const, montoBase: 467.93 },
  { procesadorId: "proc_financiera_usd", monto: 40074.52, moneda: "USD" as const, montoBase: 40074.52 },
  { procesadorId: "proc_financiera_ars", monto: 11791525.1, moneda: "ARS" as const, montoBase: 7369.7 },
  { procesadorId: "proc_dlocal", monto: 39709.97, moneda: "USD" as const, montoBase: 39709.97 },
];
const esperadas = new Map([
  ["proc_stripe", { anterior: 2394.23, entro: 9376.3, pases: -10748.41, salio: 550.16 }],
  ["proc_financiera_usd", { anterior: undefined, entro: 4961.32, pases: 0, salio: 370.68 }],
  ["proc_financiera_ars", { anterior: undefined, entro: 2038390, pases: 0, salio: 0 }],
  ["proc_dlocal", { anterior: undefined, entro: 7118.34, pases: 0, salio: 1104.57 }],
]);

test("las tres cuentas que no estaban en el arqueo del 7/10 parten de lo que ya tenían: 75.276 dólares", () => {
  const r = primerConteo(saldos, esperadas, true, US);
  assert.deepEqual(r.cuentas.map((c) => c.procesadorId), ["proc_financiera_usd", "proc_financiera_ars", "proc_dlocal"], "Stripe sí estaba: no entra");
  const [usd, ars, dl] = r.cuentas;
  assert.equal(usd.partida, 35483.88);
  assert.equal(ars.partida, 9753135.1, "en pesos, en su moneda");
  assert.equal(ars.partidaBase, 6095.71, "9.753.135,10 a 1.600");
  assert.equal(dl.partida, 33696.2);
  assert.equal(r.totalBase, 75275.79);
  assert.match(usd.nota, /Primer conteo de esta cuenta: no estaba en el arqueo anterior\. Lo contado \(US\$ 40074\.52\) menos lo que se movió desde entonces \(US\$ 4590\.64\) da lo que ya tenía: US\$ 35483\.88/);
});

test("con esa partida, la diferencia de 84.855 pasa a 9.579: lo que queda es lo real (comisiones por pagar, el pase de Hotmart, los reintegros de Whop)", () => {
  const r = primerConteo(saldos, esperadas, true, US);
  const total = 245961.45, esperado = 161106.42;
  assert.equal(Math.round((total - esperado) * 100) / 100, 84855.03, "antes");
  assert.equal(Math.round((total - (esperado + r.totalBase)) * 100) / 100, 9579.24, "después");
});

test("sin arqueo anterior no hay nada que incorporar; una cuenta que ya estaba (aunque en cero) tampoco", () => {
  assert.deepEqual(primerConteo(saldos, esperadas, false, US), { cuentas: [], totalBase: 0 });
  const conCero = new Map(esperadas); conCero.set("proc_dlocal", { anterior: 0, entro: 7118.34, pases: 0, salio: 1104.57 });
  assert.deepEqual(primerConteo(saldos, conCero, true, US).cuentas.map((c) => c.procesadorId), ["proc_financiera_usd", "proc_financiera_ars"]);
  /* Una cuenta que nadie conoce (sin movimientos calculados) se saltea. */
  assert.deepEqual(primerConteo([{ procesadorId: "proc_x", monto: 5, moneda: "USD", montoBase: 5 }], new Map(), true, US).cuentas, []);
});

test("una cuenta nueva que se cuenta en cero y no se movió no suma nada; una que se cuenta por primera vez con sólo lo que cobró da partida cero", () => {
  const nueva = primerConteo(
    [{ procesadorId: "proc_n", monto: 0, moneda: "USD", montoBase: 0 }, { procesadorId: "proc_m", monto: 1000, moneda: "USD", montoBase: 1000 }],
    new Map([["proc_n", { anterior: undefined, entro: 0, pases: 0, salio: 0 }], ["proc_m", { anterior: undefined, entro: 1000, pases: 0, salio: 0 }]]),
    true, US,
  );
  assert.deepEqual(nueva.cuentas.map((c) => [c.procesadorId, c.partida, c.partidaBase]), [["proc_n", 0, 0], ["proc_m", 0, 0]]);
  assert.equal(nueva.totalBase, 0);
});
