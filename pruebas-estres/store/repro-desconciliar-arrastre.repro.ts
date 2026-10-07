/* Extensión del repro: el vínculo viejo que deja desconciliar() sobrevive a una nueva conciliación repartida en dos cuotas
   (conciliar() sólo manda pagoId/cuotaId/ventaId cuando es una sola cuota; si no, deja `mov.pagoId` etc., que en memoria son undefined). */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, instalar } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";
import type { E } from "./_acciones";
import { quienPago } from "@/lib/conciliacion";

const base = new BaseFalsa();
instalar(base);
const por = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id) as T;

test("el vínculo viejo (venta equivocada) sobrevive a una nueva imputación repartida en dos cuotas y gana sobre la correcta al recargar", async () => {
  const S = await conDemo(base);
  const e = estadoDe(S);
  const mov = e.movimientos.find((m: E) => m.estado === "pendiente" && !m.vinculado && e.cuotas.some((c: E) => c.estado === "pendiente" && c.monto >= m.monto - 0.01));
  const mal = e.cuotas.find((c: E) => c.estado === "pendiente" && c.monto >= mov.monto - 0.01);
  const x = Math.round(mov.monto / 2 * 100) / 100, y = Math.round((mov.monto - x) * 100) / 100;
  const buenas = e.cuotas.filter((c: E) => c.estado === "pendiente" && c.id !== mal.id && c.ventaId !== mal.ventaId && c.monto >= Math.max(x, y));
  const ventasBuenas = new Set(buenas.map((c: E) => c.ventaId));
  const [A, B] = [buenas[0], buenas.find((c: E) => c.ventaId === buenas[0].ventaId && c.id !== buenas[0].id) ?? buenas[1]];
  assert.ok(A && B, "la demo tiene dos cuotas pendientes de otras ventas");
  console.log("# ventas:", { mal: mal.ventaId, A: A.ventaId, B: B.ventaId, hayVariasVentasBuenas: ventasBuenas.size });

  // 1) se concilia mal (con la venta equivocada) y se deshace
  await yEsperar(S, () => assert.ok(S.acciones.conciliar(mov.id, [{ cuotaId: mal.id, monto: mov.monto }])));
  await yEsperar(S, () => assert.ok(S.acciones.desconciliar(mov.id)));
  // 2) se vuelve a imputar bien, repartido entre dos cuotas de otra venta
  await yEsperar(S, () => assert.ok(S.acciones.conciliar(mov.id, [{ cuotaId: A.id, monto: x }, { cuotaId: B.id, monto: y }])));

  const enMemoria = por<E>(estadoDe(S).movimientos, mov.id);
  const enBase = base.tabla("movimientos").get(mov.id)!;
  console.log("# memoria:", JSON.stringify({ estado: enMemoria.estado, pagoId: enMemoria.pagoId, cuotaId: enMemoria.cuotaId, ventaId: enMemoria.ventaId }));
  console.log("# base   :", JSON.stringify({ estado: enBase.estado, pagoId: enBase.pagoId, cuotaId: enBase.cuotaId, ventaId: enBase.ventaId }));
  assert.equal(enMemoria.estado, "conciliado");
  assert.equal(enMemoria.ventaId, undefined);
  assert.equal(enBase.ventaId, mal.ventaId);                 // la venta de la conciliación que se había deshecho
  assert.equal(base.tabla("pagos").has(String(enBase.pagoId)), false); // y un pago que ya no existe

  const rec = await recargado();
  const q = quienPago(rec as never, por<E>(rec.movimientos, mov.id));
  const qMem = quienPago(estadoDe(S) as never, enMemoria);
  console.log("# quienPago en memoria:", JSON.stringify({ fuente: qMem.fuente, fichaId: qMem.fichaId }), "| recargado:", JSON.stringify({ fuente: q.fuente, fichaId: q.fichaId }));
  assert.equal(q.fuente, "venta");
  const ventaDeLaFicha = rec.ventas.find((v: E) => v.contactoId === q.fichaId)?.id;
  assert.equal(ventaDeLaFicha, mal.ventaId, "al recargar la ficha es la de la venta vieja");
});
