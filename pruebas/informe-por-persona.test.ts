import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, informeParaEnviar, textoParaEnviar } from "@/lib/honorarios";
import { estadoDePrueba, PERIODO } from "./estado-liquidacion";

/* ==================================================================
   Aldana (01/11): «un reporte que le pueda mandar a Nahuel, a Agustín, a Santi y a Yari, con el detalle de qué es lo que están cobrando».
   «Copiar para mandarle» dice cuánto; «Copiar el detalle» dice cómo: la regla, la cuenta paso a paso (Paso · Cálculo · Monto, como el informe de Angelo para
   Agustín, que mandó Aldana) y los cobros que cuentan.
   ================================================================== */

const persona = (id: string) => calcularLiquidacion(estadoDePrueba(), PERIODO, null).personas.find((p) => p.miembroId === id)!;

test("el detalle trae cada renglón con su regla, su cuenta y los cobros que cuentan", () => {
  const t = informeParaEnviar(persona("mariano"), PERIODO);
  assert.match(t, /^Hola Mariano, el detalle de tu liquidación de septiembre 2026:/);
  assert.match(t, /^COMISIÓN DE CLOSER$/m);
  assert.match(t, /Regla: /);
  assert.match(t, /^Paso · Cálculo · Monto$/m);
  /* Cada paso con de dónde sale y cómo va quedando la cuenta, como en la hoja de Angelo («74.529,14 × 66,67%»). */
  assert.match(t, /^1\. Cobrado en el mes · 3 cobros · US\$ 3\.500$/m);
  assert.match(t, /^2\. Lo que se quedaron los procesadores de pago · 3\.500 − 105,00 · US\$ 3\.395$/m);
  assert.match(t, /^3\. Porcentaje · 3\.395 × 15% · US\$ 509,25$/m);
  assert.match(t, /^Lo que se paga por esto: US\$ 509,25$/m);
  assert.match(t, /• \d\d\/\d\d · Belén Godoy · Mentoría · Stripe · US\$ 1\.500 \(neto US\$ 1\.455\)/, "cada cobro con su fecha, su cliente, el servicio y la pasarela");
  assert.match(t, /Pedro Gómez/);
  assert.match(t, /Total: US\$/);
});

test("el total del detalle es el mismo que el del mensaje corto", () => {
  const p = persona("mariano");
  const total = (t: string) => t.split("\n").filter((l) => l.startsWith("Total: "))[0];
  assert.equal(total(informeParaEnviar(p, PERIODO)), total(textoParaEnviar(p, PERIODO)));
});

test("con corte, lo dice; el sueldo fijo explica su cuenta sin lista de cobros", () => {
  const t = informeParaEnviar(persona("dani"), PERIODO, "2026-09-16");
  assert.match(t, /\(hasta el 16\/09\)/);
  assert.match(t, /^SUELDO$/m);
  assert.match(t, /^Lo que se paga por esto: US\$ 250$/m);
  assert.match(t, /^COMISIÓN DE SETTER$/m);
});

test("una nota para quien paga sale debajo de su renglón", () => {
  const e = estadoDePrueba();
  const liq = { id: "liq", periodo: PERIODO, estado: "abierta", entradas: {}, pagos: {}, gastoIds: [], creadoEn: "2026-10-01T00:00:00.000Z",
    extras: [{ id: "x", miembroId: "mariano", concepto: "Cobro en su cuenta personal", monto: -2500, moneda: "USD", nota: "Descontárselos de este pago" }] };
  const p = calcularLiquidacion(e, PERIODO, liq as never).personas.find((x) => x.miembroId === "mariano")!;
  assert.match(informeParaEnviar(p, PERIODO), /^COBRO EN SU CUENTA PERSONAL$/m);
  assert.match(informeParaEnviar(p, PERIODO), /Lo que se paga por esto: [−-]US\$ 2\.500/);
  assert.match(informeParaEnviar(p, PERIODO), /Nota: Descontárselos de este pago/);
});
