import type { EstadoApp, ID, Venta } from "./types";
import { cuotasVencidas } from "./finanzas";

/* ==================================================================
   Clientes: la gente que compró.

   "Que haya un apartado de clientes: saber cuáles son los clientes activos
   fácilmente, como un CRM; qué producto compró cada uno, la fichita de
   cada cliente con todos sus cobros" (Yari). Un cliente es una persona con
   al menos una venta; lo de cada uno sale de sus ventas, cuotas y cobros,
   así que no hay nada que cargar aparte. La ficha es la de siempre.
   ================================================================== */

export type EstadoCliente = "al-dia" | "atrasado" | "pago-todo" | "baja";

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
  for (const v of cuotasVencidas(e)) atraso.set(v.ventaId, Math.max(atraso.get(v.ventaId) ?? 0, v.diasAtraso));

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
    for (const v of ventas) {
      for (const c of cuotasDe.get(v.id) ?? []) {
        const pagado = pagadoDe.get(c.id) ?? 0;
        cobrado += pagado;
        if (v.estado !== "activa" || c.estado === "cancelada") continue;
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
    });
  }
  return out.sort((a, b) => +new Date(b.ultimaCompra) - +new Date(a.ultimaCompra));
}
