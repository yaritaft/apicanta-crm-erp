import type { Devolucion, EstadoApp, Gasto, ID, Movimiento, Moneda, Pago, Traspaso } from "./types";
import { diaDeNegocio, enRangoDeDias, type RangoDeDias } from "./dia-negocio";
import { fechaDePago } from "./gastos";
import { esDevolucionConfirmada } from "./devoluciones";
import { medioDeMovimiento } from "./conciliacion";
import { motivoDeDescarte } from "./motivos";
import { quienDelReembolso } from "./reembolsos";

/* ==================================================================
   Transacciones: todo lo que entró y salió, de todas las cuentas, en una
   sola lista (Aldana, 17/10: «lo que cargo todos los días en la planilla de
   Transacciones, ¿dónde está?»).

   No inventa nada: junta lo que ya tiene la app, cada cosa una sola vez.
   - Ingreso · cobro: un pago imputado a una cuota (viene de una pasarela
     conciliada o se cargó a mano). El cobro de pasarela ya conciliado NO se
     repite: es ese mismo pago.
   - Ingreso · sin conciliar: plata que entró a una pasarela y todavía no se
     ató a ninguna cuota. Se ve, pero no se suma al total de ingresos (todavía
     no es un cobro: Conciliación).
   - Ingreso · devuelta: lo que volvió (un reembolso de un hotel): un gasto
     cargado como ingreso (monto negativo).
   - Egreso · gasto: lo que se pagó, el día que se pagó.
   - Egreso · devolución: la plata que se le devolvió a un cliente.
   - Entre cuentas: un pase de una cuenta propia a otra. No es ingreso ni
     egreso: se ve, pero no entra en los totales.
   - Sin venta: un cobro que se dejó sin venta (se reembolsó, el intento falló,
     está repetido…) con el motivo escrito. Ningún ingreso ni egreso de una
     pasarela se esconde: lo que no es una venta se ve, con su porqué, y no suma.
   - Sin devolución: un reembolso que informó la pasarela y se descartó, con su
     motivo; y los que todavía esperan decisión («Por confirmar»). Tampoco suman.
   ================================================================== */

export type TipoTransaccion = "ingreso" | "egreso" | "pase";
export type OrigenTransaccion = "cobro" | "sin-conciliar" | "sin-venta" | "ingreso-cargado" | "gasto" | "devolucion" | "reembolso-propuesto" | "sin-devolucion" | "pase";

export interface Transaccion {
  /* «origen:id», único en toda la lista. */
  id: string;
  tipo: TipoTransaccion;
  origen: OrigenTransaccion;
  /* El día de negocio (aaaa-mm-dd) y el instante, para ordenar. */
  dia: string;
  fecha: string;
  titulo: string;
  detalle: string;
  /* La cuenta por la que entró o salió, o vacío si no se sabe. */
  cuenta: string;
  /* Siempre positivo: el tipo dice para qué lado va. */
  monto: number;
  moneda: Moneda;
  /* Lo que se quedó la pasarela o el banco, si se sabe. */
  comision?: number;
  estado: string;
  /* A qué cosa lleva la fila. */
  pagoId?: ID;
  ventaId?: ID;
  movimientoId?: ID;
  gastoId?: ID;
  devolucionId?: ID;
  traspasoId?: ID;
}

export const ESTADO_DE_ORIGEN: Record<OrigenTransaccion, string> = {
  cobro: "Cobrado",
  "sin-conciliar": "Sin conciliar",
  "sin-venta": "Sin venta",
  "ingreso-cargado": "Devuelto a la empresa",
  gasto: "Pagado",
  devolucion: "Devuelto al cliente",
  "reembolso-propuesto": "Por confirmar",
  "sin-devolucion": "Sin devolución",
  pase: "Entre cuentas",
};

const r2 = (n: number) => Math.round(n * 100) / 100;
/* Una referencia larga (el hash de una transferencia) se lee mejor cortada: «7e2358…37f5». */
const corta = (ref: string | undefined): string => (ref && ref.length > 18 ? `${ref.slice(0, 6)}…${ref.slice(-4)}` : ref ?? "");

function cuentaDeGasto(g: Gasto): string {
  const c = g.extra?.cuenta;
  return typeof c === "string" ? c.trim() : "";
}

function delPago(e: EstadoApp, p: Pago, cuotas: Map<ID, ID>, ventas: Map<ID, string>, procs: Map<ID, string>): Transaccion {
  const ventaId = cuotas.get(p.cuotaId);
  const cuota = e.cuotas.find((c) => c.id === p.cuotaId);
  const nombre = (ventaId && ventas.get(ventaId)) || p.pagador || "Cobro";
  const que = p.caracteristica || (cuota ? (cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`) : "Cobro");
  return {
    id: `cobro:${p.id}`, tipo: "ingreso", origen: "cobro", dia: diaDeNegocio(p.fecha), fecha: p.fecha,
    titulo: nombre, detalle: que, cuenta: (p.procesadorId && procs.get(p.procesadorId)) || "",
    monto: r2(p.monto), moneda: p.moneda, comision: p.feeMonto ? r2(p.feeMonto) : undefined,
    estado: ESTADO_DE_ORIGEN.cobro, pagoId: p.id, ventaId, movimientoId: p.movimientoId,
  };
}

function delMovimiento(e: EstadoApp, m: Movimiento): Transaccion {
  return {
    id: `sin-conciliar:${m.id}`, tipo: "ingreso", origen: "sin-conciliar", dia: diaDeNegocio(m.fecha), fecha: m.fecha,
    titulo: m.clienteNombre || m.descripcion || m.referencia || "Cobro sin nombre",
    detalle: [m.metodo, corta(m.referencia)].filter(Boolean).join(" · "), cuenta: medioDeMovimiento(e, m),
    monto: r2(m.monto), moneda: m.moneda, comision: m.fee ? r2(m.fee) : undefined,
    estado: ESTADO_DE_ORIGEN["sin-conciliar"], movimientoId: m.id,
  };
}

/** Un cobro que se dejó sin venta: se ve, con su motivo, y no suma. */
function delCobroSinVenta(e: EstadoApp, m: Movimiento): Transaccion {
  return {
    ...delMovimiento(e, m), id: `sin-venta:${m.id}`, origen: "sin-venta", estado: ESTADO_DE_ORIGEN["sin-venta"],
    detalle: m.motivo?.trim() || "Falta escribir por qué no es una venta",
  };
}

/** Un reembolso de una pasarela que todavía no es una devolución: por confirmar, o descartado con su motivo. No suma. */
function delReembolsoDePasarela(e: EstadoApp, d: Devolucion, procs: Map<ID, string>): Transaccion {
  const base = delaDevolucion(e, d, procs);
  const descartado = d.estado === "ignorada";
  return {
    ...base, id: `reembolso:${d.id}`, origen: descartado ? "sin-devolucion" : "reembolso-propuesto",
    estado: descartado ? ESTADO_DE_ORIGEN["sin-devolucion"] : ESTADO_DE_ORIGEN["reembolso-propuesto"],
    detalle: descartado ? (motivoDeDescarte(d) ?? "Falta escribir por qué no es una devolución") : "La pasarela informó este reembolso: falta confirmarlo",
    titulo: quienDelReembolso(e, d).nombre ?? base.titulo,
  };
}

function delGasto(g: Gasto): Transaccion {
  const ingreso = g.monto < 0;
  const f = fechaDePago(g);
  return {
    id: `gasto:${g.id}`, tipo: ingreso ? "ingreso" : "egreso", origen: ingreso ? "ingreso-cargado" : "gasto",
    dia: diaDeNegocio(f), fecha: f, titulo: g.concepto || g.categoria,
    detalle: [g.categoria, g.proveedor].filter(Boolean).join(" · "), cuenta: cuentaDeGasto(g),
    monto: r2(Math.abs(g.monto)), moneda: g.moneda,
    estado: ingreso ? ESTADO_DE_ORIGEN["ingreso-cargado"] : g.grupo === "retiro" ? "Retiro del dueño" : ESTADO_DE_ORIGEN.gasto,
    gastoId: g.id,
  };
}

function delaDevolucion(e: EstadoApp, d: Devolucion, procs: Map<ID, string>): Transaccion {
  const venta = d.ventaId ? e.ventas.find((v) => v.id === d.ventaId) : undefined;
  return {
    id: `devolucion:${d.id}`, tipo: "egreso", origen: "devolucion", dia: diaDeNegocio(d.fecha), fecha: d.fecha,
    titulo: venta?.contactoNombre || (typeof d.extra?.clienteNombre === "string" ? d.extra.clienteNombre : "Devolución"),
    detalle: d.motivo || "Devolución a un cliente", cuenta: (d.procesadorId && procs.get(d.procesadorId)) || "",
    monto: r2(d.monto), moneda: d.moneda, estado: ESTADO_DE_ORIGEN.devolucion, devolucionId: d.id, ventaId: d.ventaId,
  };
}

function delPase(t: Traspaso, procs: Map<ID, string>): Transaccion {
  const de = (t.origenId && procs.get(t.origenId)) || "?";
  const a = (t.destinoId && procs.get(t.destinoId)) || t.contraparte || "?";
  return {
    id: `pase:${t.id}`, tipo: "pase", origen: "pase", dia: diaDeNegocio(t.fecha), fecha: t.fecha,
    titulo: `${de} → ${a}`, detalle: t.contraparte || "Movimiento entre cuentas propias", cuenta: de,
    monto: r2(t.montoSale), moneda: t.monedaSale,
    comision: t.monedaSale === t.monedaLlega && t.montoSale > t.montoLlega ? r2(t.montoSale - t.montoLlega) : undefined,
    estado: ESTADO_DE_ORIGEN.pase, traspasoId: t.id,
  };
}

export interface ResumenTransacciones {
  ingresos: number;
  egresos: number;
  neto: number;
  sinConciliar: number;
  sinConciliarN: number;
  /* Los cobros que se dejaron sin venta (con su motivo): se ven aparte y no suman. */
  sinVenta: number;
  sinVentaN: number;
  /* Cuántos de ellos no dicen por qué. */
  sinMotivoN: number;
  pasesN: number;
  n: number;
}

export interface Transacciones { filas: Transaccion[]; resumen: ResumenTransacciones }

/** Todo lo que entró y salió en el período (o siempre, sin rango), del día más nuevo al más viejo. */
export function transaccionesDe(e: EstadoApp, rango?: RangoDeDias | null): Transacciones {
  const dentro = (f: string) => !rango || enRangoDeDias(f, rango);
  const procs = new Map<ID, string>((e.procesadores ?? []).map((p) => [p.id, p.nombre] as const));
  const ventas = new Map<ID, string>((e.ventas ?? []).map((v) => [v.id, v.contactoNombre] as const));
  const cuotas = new Map<ID, ID>((e.cuotas ?? []).map((c) => [c.id, c.ventaId] as const));

  const filas: Transaccion[] = [];
  for (const p of e.pagos ?? []) if (dentro(p.fecha)) filas.push(delPago(e, p, cuotas, ventas, procs));
  for (const m of e.movimientos ?? []) {
    if (!dentro(m.fecha)) continue;
    if (m.estado === "pendiente") filas.push(delMovimiento(e, m));
    else if (m.estado === "ignorado") filas.push(delCobroSinVenta(e, m));
  }
  for (const g of e.gastos ?? []) if (dentro(fechaDePago(g))) filas.push(delGasto(g));
  for (const d of e.devoluciones ?? []) {
    if (!dentro(d.fecha)) continue;
    if (esDevolucionConfirmada(d)) filas.push(delaDevolucion(e, d, procs));
    else if (d.referencia) filas.push(delReembolsoDePasarela(e, d, procs));
  }
  for (const t of e.traspasos ?? []) if (dentro(t.fecha)) filas.push(delPase(t, procs));

  /* Lo más nuevo primero; en el mismo día, por la hora y por id para que el orden no cambie entre dibujos. */
  filas.sort((a, b) => b.dia.localeCompare(a.dia) || b.fecha.localeCompare(a.fecha) || a.id.localeCompare(b.id));
  return { filas, resumen: resumenDe(filas) };
}

/** Los totales de una lista: lo sin conciliar y los pases se cuentan aparte, no son ingreso ni egreso todavía. */
export function resumenDe(filas: readonly Transaccion[]): ResumenTransacciones {
  let ingresos = 0, egresos = 0, sinConciliar = 0, sinConciliarN = 0, pasesN = 0, sinVenta = 0, sinVentaN = 0, sinMotivoN = 0;
  for (const f of filas) {
    if (f.tipo === "pase") pasesN++;
    else if (f.origen === "sin-conciliar") { sinConciliar += f.monto; sinConciliarN++; }
    else if (f.origen === "sin-venta") { sinVenta += f.monto; sinVentaN++; if (f.detalle.startsWith("Falta escribir")) sinMotivoN++; }
    else if (f.origen === "reembolso-propuesto" || f.origen === "sin-devolucion") { /* se ven, con su motivo, y no suman */ }
    else if (f.tipo === "ingreso") ingresos += f.monto;
    else egresos += f.monto;
  }
  return { ingresos: r2(ingresos), egresos: r2(egresos), neto: r2(ingresos - egresos), sinConciliar: r2(sinConciliar), sinConciliarN, sinVenta: r2(sinVenta), sinVentaN, sinMotivoN, pasesN, n: filas.length };
}

/** Las cuentas que aparecen en la lista, para elegir una: con cuántas filas tiene cada una. */
export function cuentasDe(filas: readonly Transaccion[]): { cuenta: string; n: number }[] {
  const n = new Map<string, number>();
  for (const f of filas) n.set(f.cuenta, (n.get(f.cuenta) ?? 0) + 1);
  return [...n.entries()].map(([cuenta, c]) => ({ cuenta, n: c })).sort((a, b) => b.n - a.n || a.cuenta.localeCompare(b.cuenta, "es"));
}
