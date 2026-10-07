/* Estrés del almacén: lo que registrarVenta y registrarPago hacen con la plata no pierde ni inventa centavos.

   Invariantes (con semilla), sobre ventas y cobros al azar con montos fraccionarios:
   - el total de la venta (la suma de sus cuotas que no están canceladas) no cambia nunca: sólo se mueve el saldo de una cuota a otra
     (o a una cuota nueva); el único caso en que cambia es un cobro de más (la cuota queda como pagada y lo que sobra no se reparte);
   - lo pagado de una cuota es la suma de sus cobros, y la cuota queda «pagada» exactamente cuando lo cubre (con un centavo de tolerancia);
   - todos los montos que se guardan son finitos y tienen a lo sumo dos decimales;
   - un cobro de monto 0 o negativo no crea nada;
   - a cada cobro nuevo le toca una comisión que es monto × la tasa de su cuenta, redondeada a centavos. */
import test from "node:test";
import assert from "node:assert/strict";
import { instalarNavegador } from "./_navegador";
import { storeNuevo } from "./_fresco";
import { azar } from "./_aleatorio";
import type { E } from "./_acciones";

instalarNavegador();
const centavos = (n: number) => Math.round(n * 100);
const dosDecimales = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

test("registrarPago: el total de la venta no cambia (sólo se mueve el saldo), y lo cobrado cuadra con la cuota", async () => {
  const S = await storeNuevo();
  await S.acciones.vaciarTodo();   // sin la demo: cada exportar() pesa poco
  const a = azar(2026);
  const inicial = JSON.parse(S.acciones.exportar()) as E;
  const procs = inicial.procesadores as E[];
  const producto = inicial.productos[0].id as string;
  const closer = (inicial.equipo as E[]).find((m) => m.rol === "closer")!.id as string;
  let casos = 0;
  for (let i = 0; i < 140; i++) {
    /* Una venta nueva con un plan al azar, con un precio con decimales. */
    const n = a.entero(1, 5);
    const precio = Math.round((a.entero(500, 6000) + a.r()) * 100) / 100;
    const base = Math.floor((precio / n) * 100) / 100;
    const vid = `ven_inv_${i}`;
    const cuotas = Array.from({ length: n }, (_x, k) => ({ id: `cuo_inv_${i}_${k}`, ventaId: vid, numero: k + 1, monto: k === n - 1 ? Math.round((precio - base * (n - 1)) * 100) / 100 : base, vence: "2026-11-01T12:00:00.000Z", estado: "pendiente", esReserva: false }));
    S.acciones.registrarVenta({ venta: { id: vid, contactoNombre: `Cliente ${i}`, productoId: producto, precioAcordado: precio, moneda: "USD", closerId: closer, excluidoMarketing: false, estado: "activa", fecha: "2026-10-01T12:00:00.000Z", creadoEn: "2026-10-01T12:00:00.000Z", extra: {} }, cuotas, cobros: [] } as never);
    const antes = JSON.parse(S.acciones.exportar()) as E;
    const total0 = antes.cuotas.filter((c: E) => c.ventaId === vid && c.estado !== "cancelada").reduce((x: number, c: E) => x + centavos(c.monto), 0);
    assert.equal(total0, centavos(precio), `caso ${i}: el plan de cuotas no suma el precio`);
    /* Cobros al azar (uno o varios, con fracciones). */
    for (let k = 0; k < a.entero(1, 3); k++) {
      const e0 = JSON.parse(S.acciones.exportar()) as E;
      const pend = e0.cuotas.filter((c: E) => c.ventaId === vid && c.estado === "pendiente");
      if (!pend.length) break;
      const c = a.pick(pend) as E;
      const proc = a.pick(procs);
      const monto = a.pick([c.monto, Math.round(c.monto * (0.2 + a.r() * 0.7) * 100) / 100, Math.round(c.monto * 100 + a.entero(1, 5000)) / 100, 0.01, 0.005]);
      const reajuste = a.pick(["repartir", "proxima", "pendiente"] as const);
      const totalAntes = e0.cuotas.filter((x: E) => x.ventaId === vid && x.estado !== "cancelada").reduce((s: number, x: E) => s + centavos(x.monto), 0);
      const pagosAntes = e0.pagos.length;
      const ok = S.acciones.registrarPago({ cuotaId: c.id, reajuste, cobros: [{ monto, fecha: "2026-10-05T12:00:00.000Z", procesadorId: proc.id }] as never });
      const e1 = JSON.parse(S.acciones.exportar()) as E;
      if (!ok) { assert.equal(e1.pagos.length, pagosAntes, `caso ${i}: devolvió false pero creó un pago`); continue; }
      casos++;
      const cuotasV = e1.cuotas.filter((x: E) => x.ventaId === vid);
      const nuevo = e1.pagos[0] as E;
      const montoCobrado = Math.round(monto * 100) / 100;
      assert.equal(centavos(nuevo.monto), centavos(montoCobrado), `caso ${i}: el cobro se guardó con otro monto`);
      assert.equal(centavos(nuevo.feeMonto), Math.round(montoCobrado * nuevo.feeRate * 100), `caso ${i}: la comisión no es monto × tasa`);
      const pagadoCuota = e1.pagos.filter((p: E) => p.cuotaId === c.id).reduce((s: number, p: E) => s + centavos(p.monto), 0);
      const cuotaDespues = cuotasV.find((x: E) => x.id === c.id) as E;
      const sobra = pagadoCuota - centavos(c.monto);
      const totalDespues = cuotasV.filter((x: E) => x.estado !== "cancelada").reduce((s: number, x: E) => s + centavos(x.monto), 0);
      if (sobra > 1 || reajuste === "pendiente" || centavos(c.monto) - pagadoCuota <= 1) {
        /* Cobro de más, o de menos sin reajustar: el total no se toca. */
        if (sobra <= 1) assert.equal(totalDespues, totalAntes, `caso ${i} (${reajuste}): cambió el total de la venta (${totalAntes} → ${totalDespues} centavos) con un cobro de ${monto} en una cuota de ${c.monto}`);
      } else {
        assert.equal(totalDespues, totalAntes, `caso ${i} (${reajuste}): el reajuste perdió o inventó plata: ${totalAntes} → ${totalDespues} centavos (cuota ${c.monto}, cobro ${monto})`);
        assert.equal(cuotaDespues.estado, "pagada");
      }
      assert.equal(cuotaDespues.estado === "pagada", pagadoCuota >= centavos(cuotaDespues.monto) - 1 || (reajuste !== "pendiente" && centavos(c.monto) - pagadoCuota > 1), `caso ${i}: estado «${cuotaDespues.estado}» con ${pagadoCuota} cobrado de ${cuotaDespues.monto}`);
      for (const x of cuotasV) assert.ok(dosDecimales(x.monto), `caso ${i}: la cuota ${x.id} quedó con ${x.monto}`);
    }
  }
  assert.ok(casos > 100, `sólo ${casos} cobros pudieron registrarse`);
});

test("un cobro de monto 0, negativo o con menos de un décimo de centavo no crea nada", async () => {
  const S = await storeNuevo();
  const e = JSON.parse(S.acciones.exportar()) as E;
  const c = e.cuotas.find((x: E) => x.estado === "pendiente" && e.ventas.find((v: E) => v.id === x.ventaId)?.estado === "activa");
  const antes = e.pagos.length;
  for (const monto of [0, -5, 0.0004, -0.0001]) {
    assert.equal(S.acciones.registrarPago({ cuotaId: c.id, reajuste: "pendiente", cobros: [{ monto, fecha: "2026-10-05T12:00:00.000Z", procesadorId: e.procesadores[0].id }] as never }), false, `monto ${monto}`);
  }
  assert.equal((JSON.parse(S.acciones.exportar()) as E).pagos.length, antes);
});
