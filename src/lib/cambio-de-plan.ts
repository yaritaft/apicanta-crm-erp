import type { Cuota, ID, Pago } from "./types";

/* ==================================================================
   Cambiar lo que vale una venta ya cargada (Dante, 27/10: «si un cliente
   dejó una seña para Hackear IA pero al final no consiguió la plata y
   quiere el downsell, ¿cómo lo modifico?»).

   Editar la venta cambiaba el producto y el precio, pero las cuotas
   quedaban como estaban: la venta decía 500 y las cuotas seguían sumando
   3.000 por cobrar. Ahora, si cambia el precio, se rearma el plan de lo
   que falta:
   - lo cobrado no se toca: las cuotas pagadas quedan, y una a medio pagar
     queda saldada en lo que se pagó;
   - las cuotas pendientes sin cobros se quitan;
   - lo que falta (el precio nuevo menos lo cobrado) va en cuotas nuevas,
     una por mes desde el día que se elige.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PlanRearmado {
  /* Las que quedan saldadas en lo que se pagó (estaban a medio pagar). */
  saldadas: Cuota[];
  /* Las pendientes sin cobros, que se quitan. */
  quitadas: Cuota[];
  nuevas: Cuota[];
  cobrado: number;
  /* El precio nuevo menos lo cobrado (negativo: ya pagó más de lo que vale ahora). */
  falta: number;
}

/** El plan de lo que falta de una venta a la que le cambia el precio. `primera` es aaaa-mm-dd. */
export function rearmarPlan(
  cuotas: readonly Cuota[], pagos: readonly Pick<Pago, "cuotaId" | "monto">[],
  a: { ventaId: ID; precio: number; cantidad: number; primera: string; nuevoId: () => ID; motivo?: string },
): PlanRearmado {
  const deLaVenta = cuotas.filter((c) => c.ventaId === a.ventaId);
  const cobradoDe = (c: Cuota) => r2(pagos.filter((p) => p.cuotaId === c.id).reduce((t, p) => t + p.monto, 0));
  const nota = (c: Cuota, linea: string) => (c.notas ? `${c.notas} | ${linea}` : linea);
  const saldadas: Cuota[] = [];
  const quitadas: Cuota[] = [];
  for (const c of deLaVenta) {
    if (c.estado !== "pendiente") continue;
    const cob = cobradoDe(c);
    if (cob > 0.009) saldadas.push({ ...c, monto: cob, estado: "pagada", notas: nota(c, `Quedó en ${cob} (lo cobrado) al cambiar el plan${a.motivo ? `: ${a.motivo}` : ""}`) });
    else quitadas.push(c);
  }
  const cobrado = r2(deLaVenta.reduce((t, c) => t + cobradoDe(c), 0));
  const falta = r2(a.precio - cobrado);
  const nuevas: Cuota[] = [];
  const cantidad = Math.max(1, Math.min(36, Math.round(a.cantidad)));
  if (falta > 0.009) {
    const quedan = deLaVenta.filter((c) => !quitadas.some((q) => q.id === c.id));
    let numero = Math.max(0, ...quedan.map((c) => c.numero));
    const parte = Math.floor((falta / cantidad) * 100) / 100;
    for (let k = 0; k < cantidad; k++) {
      const vence = new Date(`${a.primera}T12:00:00-03:00`);
      vence.setMonth(vence.getMonth() + k);
      numero += 1;
      nuevas.push({
        id: a.nuevoId(), ventaId: a.ventaId, numero, estado: "pendiente", esReserva: false,
        monto: k === cantidad - 1 ? r2(falta - parte * (cantidad - 1)) : parte, vence: vence.toISOString(),
      });
    }
  }
  return { saldadas, quitadas, nuevas, cobrado, falta };
}
