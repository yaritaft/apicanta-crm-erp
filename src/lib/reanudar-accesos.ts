import type { Cuota, Pago, Venta } from "./types";
import { esOutboarding } from "./outboarding";
import { diaDeNegocio } from "./dia-negocio";
import { hoyDelNegocio, sumarDias } from "./seguimiento";

/* ==================================================================
   Reanudar los accesos (Liliana, 27/11): «El 20/11 se hizo el outboarding por falta de pago. Ayer se
   cargó la 2da cuota. Tendríamos que tener una opción de "reanudar accesos", porque tenemos que volver a darle accesos. La app
   debería notificarme cuando reanude para enviarle mensaje».

   LA RAÍZ: la baja por falta de pago era una puerta de un solo lado. La app sabía sacar (el closer pide la baja, la pasada de cada
   hora le saca los accesos, Lili lo pasa a Outboarding) pero nada miraba si después pagaba: «si el alumno paga, el pedido se cae
   solo» (lib/bajas-falta-de-pago.ts) apagaba el pedido, no lo que ya se había hecho. Dante cargó la cuota el 26/11 y el alumno siguió
   de baja, sin accesos, hasta que Lili se dio cuenta mirando.

   Ahora el pago es lo que lo trae de vuelta, entre por donde entre (Registrar pago, Whop, la conciliación), con ESTA regla:
     · quien está afuera (Follow Up en Outboarding o de baja), con la venta activa y el programa sin terminar, al que en los últimos
       30 días se le cargó una cuota que ya estaba vencida y ya no debe nada vencido, PIDE QUE LO REANUDEN;
     · Customer Success recibe el aviso en la campanita (la pasada de cada hora, lib/reanudar-accesos-servidor.ts) y lo ve en su
       panel, en «Pagaron estando afuera», hasta que lo reanuda;
     · «Reanudar accesos» (ficha → Servicio → Accesos) hace todo de una: vuelve a activo con el Follow Up que elija, le saca la marca
       de «Pido la baja» a sus cuotas, le devuelve los accesos de la app y deja copiado el mensaje para mandarle.

   Las fechas NO se corren (como al pasar a Downsell por falta de pago): su programa termina el mismo día. Si se decide compensar
   los días que estuvo afuera, se carga una pausa.
   ================================================================== */

/** Cuántos días después del pago sigue pidiendo que lo reanuden (después se entiende que no vuelve). */
export const DIAS_PARA_REANUDAR = 30;

/** El Follow Up con el que vuelve si nadie elige otro: sigue cursando. */
export const FOLLOW_UP_AL_VOLVER = "Avanzando";

/** ¿Está afuera del programa? Su Follow Up dice Outboarding o el alumno está de baja. */
export const estaAfuera = (followUp: string | null | undefined, estadoAlumno: string | null | undefined): boolean =>
  esOutboarding(followUp) || estadoAlumno === "baja";

type CuotaR = Pick<Cuota, "id" | "numero" | "monto" | "vence" | "estado" | "esReserva">;
type PagoR = Pick<Pago, "id" | "cuotaId" | "monto"> & { creadoEn?: string | null; fecha?: string | null };
type VentaR = Pick<Venta, "id" | "estado">;

/** Lo que debe de cuotas ya vencidas (la cuenta de cuotasVencidas en lib/finanzas.ts): pendientes, vencidas y con saldo. */
export function deudaVencida(cuotas: readonly CuotaR[], pagos: readonly PagoR[], ahora: Date): number {
  const pagado = new Map<string, number>();
  for (const p of pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + (Number(p.monto) || 0));
  let debe = 0;
  for (const c of cuotas) {
    if (c.estado !== "pendiente" || !c.vence || new Date(c.vence).getTime() >= ahora.getTime()) continue;
    const saldo = (Number(c.monto) || 0) - (pagado.get(c.id) ?? 0);
    if (saldo > 0.01) debe += saldo;
  }
  return Math.round(debe * 100) / 100;
}

export interface PedidoDeReanudar<V extends VentaR = VentaR, C extends CuotaR = CuotaR, P extends PagoR = PagoR> {
  venta: V;
  cuota: C;
  pago: P;
  /* El día (aaaa-mm-dd, Argentina) en que se cargó el pago y el día en que vencía la cuota. */
  pagoEl: string;
  vencia: string;
}

/** Cuándo se cargó un pago (si no se sabe, el día del pago). */
const cargadoEn = (p: PagoR): string => p.creadoEn || p.fecha || "";

/** ¿Pide que le reanuden los accesos? Está afuera, su venta sigue activa, su programa no terminó, ya no debe nada vencido y en los
    últimos 30 días se cargó el pago de una cuota que ya estaba vencida (se fue por falta de pago y pagó). El pago más reciente. */
export function pedidoDeReanudar<V extends VentaR, C extends CuotaR, P extends PagoR>(x: {
  followUp: string | null | undefined; estadoAlumno: string | null | undefined;
  venta: V | null | undefined; cuotas: readonly C[]; pagos: readonly P[];
  fin: string | null | undefined; ahora: Date;
}): PedidoDeReanudar<V, C, P> | null {
  const { venta, ahora } = x;
  if (!venta || venta.estado !== "activa" || !estaAfuera(x.followUp, x.estadoAlumno)) return null;
  const hoy = hoyDelNegocio(ahora);
  if (x.fin && x.fin.slice(0, 10) < hoy) return null;
  const cuotas = new Map(x.cuotas.map((c) => [c.id, c] as const));
  const pagos = x.pagos.filter((p) => cuotas.has(p.cuotaId));
  if (deudaVencida(x.cuotas, pagos, ahora) > 0.01) return null;
  const desde = sumarDias(hoy, -DIAS_PARA_REANUDAR);
  const tarde = pagos
    .map((p) => ({ p, c: cuotas.get(p.cuotaId)!, el: diaDeNegocio(cargadoEn(p)) }))
    .filter(({ p, c, el }) => (Number(p.monto) || 0) > 0 && c.estado !== "cancelada" && Boolean(c.vence) && Boolean(el)
      && el >= desde && el > diaDeNegocio(c.vence))
    .sort((a, b) => cargadoEn(b.p).localeCompare(cargadoEn(a.p)));
  const ultimo = tarde[0];
  if (!ultimo) return null;
  return { venta, cuota: ultimo.c, pago: ultimo.p, pagoEl: ultimo.el, vencia: diaDeNegocio(ultimo.c.vence) };
}

const ddmmaaaa = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

/** Si se le puede reanudar (el botón, también sin pago de por medio): el motivo si no se puede, o null. */
export function problemaParaReanudar(x: {
  followUp: string | null | undefined; estadoAlumno: string | null | undefined;
  venta: Pick<Venta, "estado"> | null | undefined; fin: string | null | undefined; hoy: string;
}): string | null {
  if (!estaAfuera(x.followUp, x.estadoAlumno)) return "Ya está activo: no hay nada que reanudar.";
  if (x.venta && (x.venta.estado === "cancelada" || x.venta.estado === "reembolsada")) {
    return `Su venta está ${x.venta.estado}: esa baja es de la venta, no de un pago atrasado.`;
  }
  if (x.fin && x.fin.slice(0, 10) < x.hoy) return `Su programa terminó el ${ddmmaaaa(x.fin.slice(0, 10))}: para volver tiene que renovar.`;
  return null;
}

/** El Follow Up con el que vuelve: el elegido si es uno de la lista (nunca Outboarding ni Reserva); si no, «Avanzando». */
export function followUpAlVolver(elegido: string | null | undefined, opciones: readonly string[]): string {
  const e = (elegido ?? "").trim();
  if (!e || esOutboarding(e) || /^reserva$/i.test(e)) return FOLLOW_UP_AL_VOLVER;
  return opciones.some((o) => o === e) ? e : FOLLOW_UP_AL_VOLVER;
}

/** Los Follow Up que se pueden elegir al volver (los de la lista menos Outboarding y Reserva). */
export const followUpsParaVolver = (opciones: readonly string[]): string[] =>
  opciones.filter((o) => !esOutboarding(o) && !/^reserva$/i.test(o.trim()));

/** Qué cuota pagó, en palabras («la cuota 2», «la reserva»). */
export const queCuota = (c: Pick<Cuota, "numero" | "esReserva">): string => (c.esReserva ? "la reserva" : `la cuota ${c.numero}`);
