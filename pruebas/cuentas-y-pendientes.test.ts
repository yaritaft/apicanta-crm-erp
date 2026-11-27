import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cuentasPorUso } from "@/lib/cuentas-por-uso";

const proc = (id: string, nombre: string, activo = true) => ({ id, nombre, activo });
const pago = (procesadorId: string) => ({ procesadorId });

/* Mariano (19/10): «falta la opción de Whop». Estaba, al fondo de 16. */
test("las cuentas se ofrecen de la más usada a la menos, y Whop deja de estar al fondo", () => {
  const e = {
    procesadores: [proc("mercury", "ACH-WIRE Mercury"), proc("stripe", "Stripe"), proc("efectivo", "Efectivo USD"), proc("whop", "Whop"), proc("paypal", "PayPal", false), proc("hotmart", "Hotmart")],
    pagos: [...Array(5).fill(pago("stripe")), ...Array(3).fill(pago("whop")), pago("hotmart"), pago("hotmart")],
  };
  assert.deepEqual(cuentasPorUso(e as never).map((p) => p.id), ["stripe", "whop", "hotmart", "mercury", "efectivo"], "sin las inactivas; a igual uso, por nombre");
});

test("sin cobros todavía, las cuentas salen por nombre", () => {
  const e = { procesadores: [proc("w", "Whop"), proc("a", "ACH"), proc("s", "Stripe")], pagos: [] };
  assert.deepEqual(cuentasPorUso(e as never).map((p) => p.id), ["a", "s", "w"]);
});

test("el asistente de venta y Registrar pago usan la misma lista (la del editor de cobros, por uso)", () => {
  assert.match(readFileSync("src/components/cobros/EditorCobros.tsx", "utf8"), /opcionesDeCuenta\(e, /);
  for (const f of ["src/components/ventas/AsistenteVenta.tsx", "src/components/cobros/RegistrarPago.tsx"]) {
    assert.match(readFileSync(f, "utf8"), /<EditorCobros/, f);
  }
});

/* Aldana (27/11): «cargan las ventas con la primera opción que aparece, que es Stripe, en vez de buscar Whop». El cobro arrancaba con la cuenta más
   usada ya puesta. Ahora arranca sin cuenta y no se puede guardar hasta elegirla (problemaDeCuenta). */
test("ningún cobro nuevo arranca con una cuenta elegida: se elige a propósito", () => {
  for (const f of ["src/components/ventas/AsistenteVenta.tsx", "src/components/cobros/EditorCobros.tsx", "src/components/cobros/RegistrarPago.tsx"]) {
    const s = readFileSync(f, "utf8");
    assert.ok(!/agregarMedio\([^)]*procesadores(\[0\]|\.find)/.test(s), `${f} no arranca con la primera cuenta`);
    for (const m of s.matchAll(/agregarMedio\(([^)]*)\)/g)) {
      if (/procesadorId: string/.test(m[1])) continue; /* la definición */
      assert.match(m[1], /,\s*""$/, `${f}: ${m[0]}`);
    }
  }
});

/* Dante (19/10): «todavía no me aparecen todos los leads que tengo que actualizar». Eran 12 llamadas de venta de entre el 21/09 y el 03/10:
   el cierre del día sólo miraba las dos últimas semanas. */
test("el cierre del día suma TODAS las llamadas pendientes de antes, sin tope de días", () => {
  const eod = readFileSync("src/components/crm-tabla/Eod.tsx", "utf8");
  assert.ok(!/DIAS_PENDIENTES/.test(eod), "no queda el tope de 14 días");
  assert.match(eod, /f\?\.sinCargar && d < dia && esDelCloser\(s, closer, e\.equipo\)/);
});
