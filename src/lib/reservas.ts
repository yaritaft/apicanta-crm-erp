import type { Alumno, Cuota, EstadoApp, ID, Pago, Producto, Venta } from "./types";
import { mismaPersona, quienDeLaVenta, type QuienCompra } from "./ventas-repetidas";

/* ==================================================================
   Una compra que todavía es sólo la reserva (Lili, 21/10: Cristian Lopez dejó
   USD 50 de reserva y la ficha lo mostraba como alumno de una Mentoría de 2.400;
   José Ponceleón dejó 100 de una venta de 500 y entra al Downsell recién el 15/11).

   Mientras lo único que pagó es la reserva, el programa no arrancó: no corren
   los días ni el vencimiento, y la ficha lo dice. Cuando paga la primera cuota
   que no es reserva, pasa a ser una compra común.
   ================================================================== */

export interface EstadoReserva {
  /* Lo que dejó de reserva (las cuotas de reserva pagadas). */
  pagado: number;
  /* Lo que le falta pagar de la venta. */
  falta: number;
}

/** La reserva que todavía no se completó (sólo pagó la reserva), o null si no es eso.
 *
 *  Con `precioPrograma` (el precio de lista del producto de la venta, `precioDeLista`): si lo que pagó como «reserva» ya cubre el
 *  programa, no es una reserva, es el pago entero mal rotulado (Liliana, 27/11: Leonardo Beltrán pagó US$ 500 de un Downsell que vale
 *  497 y figuraba «Reserva», con los accesos del Downsell; la cuota venía marcada como reserva de la planilla vieja). La venta de una
 *  reserva suelta vale lo mismo que la reserva (Carlos Juca: 400 de 400), así que el precio de la venta no sirve para saberlo. */
export function reservaSinCompletar(cuotasVenta: readonly Pick<Cuota, "monto" | "esReserva" | "estado">[], precioPrograma?: number | null): EstadoReserva | null {
  const reservas = cuotasVenta.filter((c) => c.esReserva);
  if (!reservas.some((c) => c.estado === "pagada")) return null;
  const resto = cuotasVenta.filter((c) => !c.esReserva);
  if (resto.some((c) => c.estado === "pagada")) return null;
  const pagado = reservas.filter((c) => c.estado === "pagada").reduce((a, c) => a + (c.monto || 0), 0);
  if (precioPrograma && precioPrograma > 0 && pagado >= precioPrograma - 0.009) return null;
  const falta = cuotasVenta.filter((c) => c.estado !== "pagada").reduce((a, c) => a + (c.monto || 0), 0);
  return { pagado, falta };
}

/** El precio de lista del programa de cada venta (su producto), o null si no se sabe: para `reservaSinCompletar`. */
export function precioDeLista(e: { ventas?: readonly Pick<Venta, "id" | "productoId">[]; productos?: readonly Pick<Producto, "id" | "precioLista">[] }): (ventaId: ID | null | undefined) => number | null {
  const lista = new Map((e.productos ?? []).map((p) => [p.id, Number(p.precioLista) || 0] as const));
  const porVenta = new Map((e.ventas ?? []).map((v) => [v.id, v.productoId ? lista.get(v.productoId) ?? 0 : 0] as const));
  return (ventaId) => (ventaId ? porVenta.get(ventaId) || null : null);
}

const sinTildes = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Lili le puso «Reserva» en el Follow Up: la reserva se pagó por fuera de la app (o todavía no está cargada). */
export const followUpDeReserva = (followUp: string | null | undefined) => sinTildes(followUp ?? "").startsWith("reserva");

/** Quién es hoy sólo una reserva (Lili, 22/10: «para que no me aparezca que falta el contacto a la semana»): lo único que
 *  pagó de su venta es la reserva, o su Follow Up dice «Reserva». Todavía no arrancó: no entra al seguimiento, no se le
 *  pide el primer contacto ni el reporte. Cuando paga lo que falta, pasa solo a ser un alumno más. Se arma una vez por lista. */
export function indiceDeReservas(cuotas: readonly Pick<Cuota, "ventaId" | "monto" | "esReserva" | "estado">[], precioDe: (ventaId: ID) => number | null = () => null) {
  const porVenta = new Map<string, Pick<Cuota, "ventaId" | "monto" | "esReserva" | "estado">[]>();
  for (const c of cuotas) {
    const l = porVenta.get(c.ventaId);
    if (l) l.push(c); else porVenta.set(c.ventaId, [c]);
  }
  return (a: Pick<Alumno, "ventaId">, followUp?: string | null): boolean =>
    followUpDeReserva(followUp) || Boolean(a.ventaId && reservaSinCompletar(porVenta.get(a.ventaId) ?? [], precioDe(a.ventaId)));
}

/* ==================================================================
   La reserva suelta, y cómo se completa (Aldana, 18/11).

   Carlos Juca dejó US$ 400 de reserva de Hackear AI el 16/11 (una venta de 400, «sólo la reserva») y al otro día pagó los
   2.600 que faltaban. No había por dónde decirle a la app «completó el pago»: la venta de la reserva no tiene cuotas por
   cobrar, así que el closer cargó OTRA venta de 3.000 con la reserva adentro (cargada a mano por segunda vez) y quedaron
   3.400 cobrados. Antes había pasado con Alan Vargas, Iván Suchan y Héctor Méndez (la reserva en una venta y el resto en
   otra), y Finanzas no podía borrar la que sobraba porque ya tenía un contrato firmado.

   La reserva y lo que falta son UNA compra: completar la reserva es subir el valor de esa misma venta al del programa y
   sumarle las cuotas de lo que falta. La reserva cobrada no se toca (su cobro, su contrato, su fecha).
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface ReservaSuelta {
  venta: Venta;
  /* Lo que ya pagó (la reserva). */
  pagado: number;
  /* Las cuotas ya cobradas, que quedan como están. */
  cobradas: Cuota[];
}

/** ¿Esta venta es sólo la reserva y nada más? Activa, con la reserva pagada, sin ningún pago del programa y sin nada más por
    cobrar cargado: vale lo que la reserva. (Con cuotas por cobrar no es suelta: el pago se carga en su cuota.) */
export function reservaSuelta(venta: Venta, cuotasVenta: readonly Cuota[], precioPrograma?: number | null): ReservaSuelta | null {
  if (venta.estado !== "activa") return null;
  const r = reservaSinCompletar(cuotasVenta, precioPrograma);
  if (!r || r.falta > 0.009) return null;
  return { venta, pagado: r2(r.pagado), cobradas: cuotasVenta.filter((c) => c.estado === "pagada") };
}

/** Las reservas sueltas de una persona, la más nueva primero: lo que hay que completar en vez de cargarle otra venta. */
export function reservasSueltasDe(e: Pick<EstadoApp, "ventas" | "cuotas" | "contactos" | "leads"> & Partial<Pick<EstadoApp, "productos">>, quien: QuienCompra): ReservaSuelta[] {
  const precio = precioDeLista(e);
  if (!quien.contactoId && !quien.email && !quien.telefono && !(quien.nombre ?? "").trim()) return [];
  const porVenta = new Map<ID, Cuota[]>();
  for (const c of e.cuotas) {
    const l = porVenta.get(c.ventaId);
    if (l) l.push(c); else porVenta.set(c.ventaId, [c]);
  }
  return (e.ventas ?? [])
    .filter((v) => v.estado === "activa" && mismaPersona(quienDeLaVenta(e, v), quien))
    .map((v) => reservaSuelta(v, porVenta.get(v.id) ?? [], precio(v.id)))
    .filter((x): x is ReservaSuelta => x !== null)
    .sort((a, b) => Date.parse(b.venta.fecha) - Date.parse(a.venta.fecha));
}

/** Quiénes tienen hoy una reserva suelta, por la ficha de la venta (`contactoId`): para decirlo al lado de su nombre en el buscador. */
export function reservasSueltasPorContacto(e: Pick<EstadoApp, "ventas" | "cuotas"> & Partial<Pick<EstadoApp, "productos">>): Map<ID, ReservaSuelta> {
  const precio = precioDeLista(e);
  const porVenta = new Map<ID, Cuota[]>();
  for (const c of e.cuotas) {
    const l = porVenta.get(c.ventaId);
    if (l) l.push(c); else porVenta.set(c.ventaId, [c]);
  }
  const indice = new Map<ID, ReservaSuelta>();
  for (const v of e.ventas ?? []) {
    if (!v.contactoId || v.estado !== "activa") continue;
    const r = reservaSuelta(v, porVenta.get(v.id) ?? [], precio(v.id));
    const ya = indice.get(v.contactoId);
    /* Con más de una, la más nueva. */
    if (r && (!ya || Date.parse(v.fecha) > Date.parse(ya.venta.fecha))) indice.set(v.contactoId, r);
  }
  return indice;
}

export interface PedidoDeCompletar {
  /* Lo que vale el programa entero, con la reserva adentro. */
  precio: number;
  /* Las cuotas de lo que falta (sin la reserva), ya con su id. */
  cuotas: readonly Pick<Cuota, "id" | "monto" | "vence">[];
}

export interface PlanDeCompletar {
  /* Las cuotas que ya estaban cobradas (o con algún cobro): no se tocan. */
  quedan: Cuota[];
  /* Las pendientes sin ningún cobro que tenía la venta (una cuota en cero, por ejemplo): las reemplaza el plan nuevo. */
  quitadas: Cuota[];
  nuevas: Cuota[];
  cobrado: number;
  falta: number;
}

/** Por qué no se puede completar así, o null si está bien. */
export function problemaDeCompletar(venta: Venta | undefined, cuotasVenta: readonly Cuota[], pagos: readonly Pick<Pago, "cuotaId" | "monto">[], a: PedidoDeCompletar): string | null {
  if (!venta) return "No encuentro esa venta.";
  if (venta.estado !== "activa") return "Esa venta está dada de baja: primero hay que reactivarla.";
  const cobrado = r2(pagos.filter((p) => cuotasVenta.some((c) => c.id === p.cuotaId)).reduce((t, p) => t + p.monto, 0));
  if (!(a.precio > cobrado + 0.009)) return `El valor del programa tiene que ser mayor que lo que ya pagó (${cobrado}).`;
  if (a.cuotas.length === 0) return "Falta el plan de lo que queda por pagar.";
  if (a.cuotas.some((c) => !(c.monto > 0))) return "Cada cuota tiene que tener su monto.";
  const suma = r2(a.cuotas.reduce((t, c) => t + c.monto, 0));
  const falta = r2(a.precio - cobrado);
  if (Math.abs(suma - falta) > 0.5) return `Las cuotas suman ${suma} y lo que falta es ${falta}.`;
  return null;
}

/** El plan de una reserva que se completa: lo cobrado queda, y lo que falta entra en las cuotas nuevas (numeradas después de las que quedan). */
export function planParaCompletar(venta: Venta, cuotasVenta: readonly Cuota[], pagos: readonly Pick<Pago, "cuotaId" | "monto">[], a: PedidoDeCompletar): PlanDeCompletar {
  const conCobros = new Set(pagos.map((p) => p.cuotaId));
  const quedan = cuotasVenta.filter((c) => c.estado !== "pendiente" || conCobros.has(c.id));
  const quitadas = cuotasVenta.filter((c) => c.estado === "pendiente" && !conCobros.has(c.id));
  const cobrado = r2(pagos.filter((p) => cuotasVenta.some((c) => c.id === p.cuotaId)).reduce((t, p) => t + p.monto, 0));
  let numero = Math.max(0, ...quedan.map((c) => c.numero));
  const nuevas: Cuota[] = a.cuotas.map((c) => {
    numero += 1;
    return { id: c.id, ventaId: venta.id, numero, monto: r2(c.monto), vence: c.vence, estado: "pendiente", esReserva: false };
  });
  return { quedan, quitadas, nuevas, cobrado, falta: r2(a.precio - cobrado) };
}
