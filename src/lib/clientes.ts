import type { EstadoApp, ID, Venta } from "./types";
import { closerDeCuota, cuotasVencidas } from "./finanzas";
import { cuotaPasa, type FiltroPersonas, type LineaFiltrable } from "./buscar-cliente";

/* ==================================================================
   Clientes: la gente que compró.

   "Que haya un apartado de clientes: saber cuáles son los clientes activos
   fácilmente, como un CRM; qué producto compró cada uno, la fichita de
   cada cliente con todos sus cobros" (Yari). Un cliente es una persona con
   al menos una venta; lo de cada uno sale de sus ventas, cuotas y cobros,
   así que no hay nada que cargar aparte. La ficha es la de siempre.
   ================================================================== */

export type EstadoCliente = "al-dia" | "atrasado" | "pago-todo" | "baja";

/* Una cuota del cliente, con lo que hace falta para filtrar y sumar por closer y
   por servicio (F1-14: «el total de deuda por producto», «filtra los suyos»). El
   closer es el que comisiona esa cuota (el que la heredó, o el de la venta). */
export interface CuotaDeCliente extends LineaFiltrable {
  ventaId: ID;
  /** Lo que se cobró de esta cuota. */
  cobrado: number;
  /** Lo que falta: sólo si la venta está activa y la cuota no está cancelada. */
  saldo: number;
  /** Días de atraso si está vencida y sin pagar; 0 si no. */
  diasAtraso: number;
  vence?: string;
}

export interface Cliente {
  id: ID;             // con qué se abre la ficha: una venta atada a la persona
  /* Alguna venta está atada a una persona (lead o contacto): tiene ficha. */
  conFicha: boolean;
  nombre: string;
  email?: string;
  productos: string[];
  ventas: Venta[];
  activas: number;
  facturado: number;  // lo vendido, sin las dadas de baja
  cobrado: number;
  saldo: number;      // lo que falta cobrar de las activas
  primeraCompra: string;
  ultimaCompra: string;
  diasAtraso: number; // de la cuota más vieja sin pagar
  proximaCuota?: { vence: string; monto: number };
  estado: EstadoCliente;
  /* Todas sus cuotas: con ellas `vistaDeCliente` recalcula lo suyo para un closer o un servicio. */
  cuotas: CuotaDeCliente[];
}

export const ESTADOS_CLIENTE: Record<EstadoCliente, { texto: string; variante: "success" | "danger" | "brand" | "neutral" }> = {
  "al-dia": { texto: "Al día", variante: "success" },
  atrasado: { texto: "Atrasado", variante: "danger" },
  "pago-todo": { texto: "Pagó todo", variante: "brand" },
  baja: { texto: "De baja", variante: "neutral" },
};

const normal = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

export function clientes(e: EstadoApp): Cliente[] {
  const producto = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
  const leadPorId = new Map(e.leads.map((l) => [l.id, l] as const));
  const contactoPorId = new Map(e.contactos.map((c) => [c.id, c] as const));
  const cuotasDe = new Map<ID, typeof e.cuotas>();
  for (const c of e.cuotas) cuotasDe.set(c.ventaId, [...(cuotasDe.get(c.ventaId) ?? []), c]);
  const pagadoDe = new Map<ID, number>();
  for (const p of e.pagos) pagadoDe.set(p.cuotaId, (pagadoDe.get(p.cuotaId) ?? 0) + p.monto);
  const atraso = new Map<ID, number>();
  const atrasoDeCuota = new Map<ID, number>();
  for (const v of cuotasVencidas(e)) {
    atraso.set(v.ventaId, Math.max(atraso.get(v.ventaId) ?? 0, v.diasAtraso));
    atrasoDeCuota.set(v.cuotaId, v.diasAtraso);
  }
  const nombreDe = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));

  /* La persona: el contacto de la venta (su lead apunta a él); si no hay,
     el nombre escrito. */
  const clave = (v: Venta) => {
    const lead = v.contactoId ? leadPorId.get(v.contactoId) : undefined;
    const contacto = lead?.contactoId ?? (v.contactoId && contactoPorId.has(v.contactoId) ? v.contactoId : undefined);
    return contacto ? `c:${contacto}` : v.contactoId ? `l:${v.contactoId}` : `n:${normal(v.contactoNombre)}`;
  };
  const grupos = new Map<string, Venta[]>();
  for (const v of e.ventas) grupos.set(clave(v), [...(grupos.get(clave(v)) ?? []), v]);

  const hoy = Date.now();
  const out: Cliente[] = [];
  for (const [k, ventas] of grupos) {
    ventas.sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha));
    const activas = ventas.filter((v) => v.estado === "activa");
    let cobrado = 0, saldo = 0;
    let proxima: Cliente["proximaCuota"];
    const cuotas: CuotaDeCliente[] = [];
    for (const v of ventas) {
      for (const c of cuotasDe.get(v.id) ?? []) {
        const pagado = pagadoDe.get(c.id) ?? 0;
        cobrado += pagado;
        const closerId = closerDeCuota(v, c) || undefined;
        const cuenta = v.estado === "activa" && c.estado !== "cancelada";
        cuotas.push({
          ventaId: v.id, cobrado: pagado, saldo: cuenta ? Math.max(0, c.monto - pagado) : 0, diasAtraso: atrasoDeCuota.get(c.id) ?? 0, vence: c.vence,
          closerId, closer: closerId ? nombreDe.get(closerId) : undefined,
          productoId: v.productoId, producto: v.productoId ? producto.get(v.productoId) : undefined,
        });
        if (!cuenta) continue;
        const resta = Math.max(0, c.monto - pagado);
        saldo += resta;
        if (resta > 0.01 && c.vence && new Date(c.vence).getTime() >= hoy && (!proxima || c.vence < proxima.vence)) {
          proxima = { vence: c.vence, monto: resta };
        }
      }
    }
    const diasAtraso = Math.max(0, ...activas.map((v) => atraso.get(v.id) ?? 0));
    const contacto = k.startsWith("c:") ? contactoPorId.get(k.slice(2)) : undefined;
    const ultima = ventas[ventas.length - 1];
    const conPersona = [...ventas].reverse().find((v) => v.contactoId);
    out.push({
      id: (conPersona ?? ultima).id,
      conFicha: Boolean(conPersona),
      nombre: contacto?.nombre || ultima.contactoNombre || "Sin nombre",
      email: contacto?.email || (ultima.contactoId ? leadPorId.get(ultima.contactoId)?.email : undefined),
      productos: [...new Set(ventas.map((v) => (v.productoId ? producto.get(v.productoId) : undefined) ?? "Venta"))],
      ventas,
      activas: activas.length,
      facturado: activas.reduce((a, v) => a + v.precioAcordado, 0),
      cobrado: Math.round(cobrado * 100) / 100,
      saldo: Math.round(saldo * 100) / 100,
      primeraCompra: ventas[0].fecha,
      ultimaCompra: ultima.fecha,
      diasAtraso,
      proximaCuota: proxima,
      estado: activas.length === 0 ? "baja" : diasAtraso > 0 ? "atrasado" : saldo <= 0.01 ? "pago-todo" : "al-dia",
      cuotas,
    });
  }
  return out.sort((a, b) => +new Date(b.ultimaCompra) - +new Date(a.ultimaCompra));
}

/** El cliente visto sólo por sus cuotas de un closer o de un servicio (o de los dos,
 *  sobre la misma cuota): lo que pagó, lo que le falta, su próxima cuota y su
 *  estado, de eso y no de todo lo que compró. Sin filtro es el mismo cliente; si
 *  ninguna de sus cuotas lo cumple, no está (null). Así los totales de arriba de
 *  Clientes dicen «la deuda de Mentoría» o «lo que le falta cobrar a Mariano», y
 *  suman lo mismo que las filas que quedan. */
export function vistaDeCliente(c: Cliente, f?: FiltroPersonas): Cliente | null {
  if (!f || (!f.closerId && !f.productoId)) return c;
  const lineas = c.cuotas.filter((l) => cuotaPasa(l, f));
  if (lineas.length === 0) return null;
  const ids = new Set(lineas.map((l) => l.ventaId));
  const ventas = c.ventas.filter((v) => ids.has(v.id));
  const activas = ventas.filter((v) => v.estado === "activa");
  const hoy = Date.now();
  let cobrado = 0, saldo = 0;
  let proxima: Cliente["proximaCuota"];
  for (const l of lineas) {
    cobrado += l.cobrado;
    saldo += l.saldo;
    if (l.saldo > 0.01 && l.vence && new Date(l.vence).getTime() >= hoy && (!proxima || l.vence < proxima.vence)) {
      proxima = { vence: l.vence, monto: l.saldo };
    }
  }
  const diasAtraso = Math.max(0, ...lineas.map((l) => l.diasAtraso));
  saldo = Math.round(saldo * 100) / 100;
  return {
    ...c,
    ventas,
    productos: [...new Set(lineas.map((l) => l.producto ?? "Venta"))],
    activas: activas.length,
    facturado: activas.reduce((a, v) => a + v.precioAcordado, 0),
    cobrado: Math.round(cobrado * 100) / 100,
    saldo,
    primeraCompra: ventas[0].fecha,
    ultimaCompra: ventas[ventas.length - 1].fecha,
    diasAtraso,
    proximaCuota: proxima,
    estado: activas.length === 0 ? "baja" : diasAtraso > 0 ? "atrasado" : saldo <= 0.01 ? "pago-todo" : "al-dia",
    cuotas: lineas,
  };
}

/** Lo que suman los clientes que se ven, en centavos enteros: lo que pagaron y lo
 *  que les falta. Las filas de la tabla y las tarjetas de arriba salen de acá, así
 *  no pueden dar distinto. */
export function totalesDeClientes(cs: readonly Cliente[]): { clientes: number; cobrado: number; saldo: number } {
  let cobrado = 0, saldo = 0;
  for (const c of cs) { cobrado += Math.round(c.cobrado * 100); saldo += Math.round(c.saldo * 100); }
  return { clientes: cs.length, cobrado: cobrado / 100, saldo: saldo / 100 };
}
