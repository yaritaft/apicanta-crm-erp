import type { Cuota, EstadoApp, ID, Venta } from "./types";
import { normalizar } from "./conciliacion";
import { closerDeCuota } from "./finanzas";

/* ==================================================================
   Buscar a quien compró o a quien paga una cuota.

   Lo usan el asistente de venta (¿quién compró?) y el de cargar una
   cuota (¿de quién es el pago?). Se busca por nombre, correo o teléfono,
   y cada persona viene con lo que ya compró y las cuotas que debe: así,
   si alguien viene a cargar el pago de una cuota por el lado de "venta
   nueva", la app se lo dice antes de que duplique la venta.
   ================================================================== */

export interface CuotaPendiente {
  cuota: Cuota;
  venta: Venta;
  producto?: string;
  productoId?: ID;
  /* Quién comisiona esta cuota: el que la heredó o, si nadie, el closer de la venta. */
  closerId?: ID;
  closer?: string;
  saldo: number;
  /* Días desde que venció; negativo si todavía no venció. */
  diasAtraso: number;
}

export interface PersonaBuscada {
  id: ID;
  nombre: string;
  email?: string;
  telefono?: string;
  compras: number;
  cuotas: CuotaPendiente[];
}

/* Para achicar la lista de a quién se le carga el pago: los chips de closer
   y de servicio. Angelo (06/10): «hay que poder filtrar por closer». Es la
   misma regla que usan Clientes y Finanzas → Cobros (02/10: «filtros por
   producto y por closer»): lo que hace falta de una cuota es su closer y su
   servicio (`LineaFiltrable`), y una persona es cualquier cosa que tenga
   cuotas (`ConLineas`). */
export const SIN_CLOSER = "sin-closer";
export interface FiltroPersonas { closerId?: ID | typeof SIN_CLOSER; productoId?: ID }

/** Lo que tiene que saber cada cuota para filtrarse por closer y por servicio. */
export interface LineaFiltrable { closerId?: ID; closer?: string; productoId?: ID; producto?: string }
/** Alguien (o algo) con cuotas: una persona que debe, un cliente, una cuota vencida. */
export interface ConLineas { cuotas: readonly LineaFiltrable[] }

/** ¿Esta cuota cumple el filtro? Las dos condiciones sobre la MISMA cuota. */
export function cuotaPasa(c: Pick<LineaFiltrable, "closerId" | "productoId">, f?: FiltroPersonas): boolean {
  if (!f) return true;
  return (!f.closerId || (f.closerId === SIN_CLOSER ? !c.closerId : c.closerId === f.closerId))
    && (!f.productoId || c.productoId === f.productoId);
}

export function pasaFiltro(p: ConLineas, f?: FiltroPersonas): boolean {
  if (!f || (!f.closerId && !f.productoId)) return true;
  /* Las dos condiciones sobre la MISMA cuota: «Mentoría de Dante», no «algo de Dante y algo de Mentoría». */
  return p.cuotas.some((c) => cuotaPasa(c, f));
}

interface Indice {
  leads: EstadoApp["leads"]; ventas: EstadoApp["ventas"]; cuotas: EstadoApp["cuotas"];
  pagos: EstadoApp["pagos"]; productos: EstadoApp["productos"]; equipo: EstadoApp["equipo"];
  personas: PersonaBuscada[];
  porId: Map<ID, PersonaBuscada>;
  texto: Map<ID, string>;
  digitos: Map<ID, string>;
}

let IX: Indice | null = null;
const DIA = 86400000;
const r2 = (n: number) => Math.round(n * 100) / 100;

function indice(e: EstadoApp): Indice {
  if (IX && IX.leads === e.leads && IX.ventas === e.ventas && IX.cuotas === e.cuotas
    && IX.pagos === e.pagos && IX.productos === e.productos && IX.equipo === e.equipo) return IX;
  const pagado = new Map<ID, number>();
  for (const p of e.pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
  const producto = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
  const equipo = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));
  const ventasDe = new Map<ID, Venta[]>();
  for (const v of e.ventas) if (v.contactoId) ventasDe.set(v.contactoId, [...(ventasDe.get(v.contactoId) ?? []), v]);
  const cuotasDe = new Map<ID, Cuota[]>();
  for (const c of e.cuotas) cuotasDe.set(c.ventaId, [...(cuotasDe.get(c.ventaId) ?? []), c]);
  const hoy = Date.now();

  const personas: PersonaBuscada[] = e.leads.map((l) => {
    const ventas = ventasDe.get(l.id) ?? [];
    const cuotas: CuotaPendiente[] = [];
    for (const v of ventas) {
      if (v.estado !== "activa") continue;
      for (const c of cuotasDe.get(v.id) ?? []) {
        if (c.estado !== "pendiente") continue;
        const saldo = r2(c.monto - (pagado.get(c.id) ?? 0));
        if (saldo <= 0.01) continue;
        const vence = c.vence ? new Date(c.vence).getTime() : hoy;
        const closerId = closerDeCuota(v, c) || undefined;
        cuotas.push({
          cuota: c, venta: v, producto: v.productoId ? producto.get(v.productoId) : undefined, productoId: v.productoId,
          closerId, closer: closerId ? equipo.get(closerId) : undefined,
          saldo, diasAtraso: Math.floor((hoy - vence) / DIA),
        });
      }
    }
    cuotas.sort((a, b) => b.diasAtraso - a.diasAtraso);
    return { id: l.id, nombre: l.nombre, email: l.email || undefined, telefono: l.telefono || undefined, compras: ventas.length, cuotas };
  });
  IX = {
    leads: e.leads, ventas: e.ventas, cuotas: e.cuotas, pagos: e.pagos, productos: e.productos, equipo: e.equipo,
    personas,
    porId: new Map(personas.map((p) => [p.id, p] as const)),
    texto: new Map(personas.map((p) => [p.id, normalizar(`${p.nombre} ${p.email ?? ""}`)] as const)),
    digitos: new Map(personas.map((p) => [p.id, (p.telefono ?? "").replace(/\D/g, "")] as const)),
  };
  return IX;
}

/** Por nombre, correo o teléfono. Primero los que ya compraron. */
export function buscarPersonas(e: EstadoApp, consulta: string, limite = 6, soloConCuotas = false, filtro?: FiltroPersonas): PersonaBuscada[] {
  return coincidencias(e, consulta, soloConCuotas, filtro).slice(0, limite);
}

/** Todas las que coinciden, sin recortar: para saber cuántas quedaron afuera. */
export function coincidencias(e: EstadoApp, consulta: string, soloConCuotas = false, filtro?: FiltroPersonas): PersonaBuscada[] {
  const ix = indice(e);
  const q = normalizar(consulta);
  const digitos = consulta.replace(/\D/g, "");
  const base = soloConCuotas ? ix.personas.filter((p) => p.cuotas.length > 0) : ix.personas;
  if (q.length < 2 && digitos.length < 4) return [];
  return base
    .filter((p) => pasaFiltro(p, filtro))
    .filter((p) => (q.length >= 2 && ix.texto.get(p.id)!.includes(q)) || (digitos.length >= 4 && ix.digitos.get(p.id)!.includes(digitos)))
    .sort((a, b) => b.cuotas.length - a.cuotas.length || b.compras - a.compras || a.nombre.localeCompare(b.nombre));
}

/** Los que deben alguna cuota, del más atrasado al que menos. */
export function conCuotasPendientes(e: EstadoApp, limite = 8, filtro?: FiltroPersonas): PersonaBuscada[] {
  return todosLosQueDeben(e, filtro).slice(0, limite);
}

/** Todos los que deben alguna cuota, sin recortar. */
export function todosLosQueDeben(e: EstadoApp, filtro?: FiltroPersonas): PersonaBuscada[] {
  return indice(e).personas
    .filter((p) => p.cuotas.length > 0 && pasaFiltro(p, filtro))
    .sort((a, b) => (b.cuotas[0]?.diasAtraso ?? 0) - (a.cuotas[0]?.diasAtraso ?? 0));
}

export interface OpcionFiltro { id: string; nombre: string; personas: number }

/** Los chips: los closers y los servicios de las cuotas que se deben, cada uno
 *  con cuánta gente queda si se lo elige. Sólo los que existen entre los que
 *  deben: un closer sin deudores no aparece. */
export function opcionesDeFiltro(e: EstadoApp, filtro?: FiltroPersonas): { closers: OpcionFiltro[]; servicios: OpcionFiltro[] } {
  return opcionesSobre(indice(e).personas.filter((p) => p.cuotas.length > 0), filtro);
}

/** Lo mismo sobre cualquier lista de cosas con cuotas (los clientes, las cuotas
 *  vencidas): los closers y los servicios que hay, cada uno con cuántos quedan
 *  si se lo elige y con el otro filtro ya puesto. */
export function opcionesSobre(debe: readonly ConLineas[], filtro?: FiltroPersonas): { closers: OpcionFiltro[]; servicios: OpcionFiltro[] } {
  const closers = new Map<string, OpcionFiltro>();
  const servicios = new Map<string, OpcionFiltro>();
  for (const p of debe) {
    /* Cada persona cuenta una vez por closer y una por servicio, con el otro
       filtro ya puesto: así el número del chip es lo que se va a ver. */
    const aporta = (f: FiltroPersonas) => pasaFiltro(p, f);
    for (const c of p.cuotas) {
      const k = c.closerId ?? SIN_CLOSER;
      if (!closers.has(k)) closers.set(k, { id: k, nombre: c.closer ?? (c.closerId ? "Closer sin nombre" : "Sin closer"), personas: 0 });
      if (c.productoId && !servicios.has(c.productoId)) servicios.set(c.productoId, { id: c.productoId, nombre: c.producto ?? "Sin servicio", personas: 0 });
    }
    for (const o of closers.values()) if (aporta({ productoId: filtro?.productoId, closerId: o.id })) o.personas += 1;
    for (const o of servicios.values()) if (aporta({ closerId: filtro?.closerId, productoId: o.id })) o.personas += 1;
  }
  const orden = (a: OpcionFiltro, b: OpcionFiltro) => (a.id === SIN_CLOSER ? 1 : b.id === SIN_CLOSER ? -1 : b.personas - a.personas || a.nombre.localeCompare(b.nombre));
  /* Una opción que con el otro filtro puesto deja a cero no se ofrece (salvo la que ya está elegida). */
  const hay = (activo?: string) => (o: OpcionFiltro) => o.personas > 0 || o.id === activo;
  return {
    closers: [...closers.values()].filter(hay(filtro?.closerId)).sort(orden),
    servicios: [...servicios.values()].filter(hay(filtro?.productoId)).sort(orden),
  };
}

export const personaPorId = (e: EstadoApp, id?: ID): PersonaBuscada | undefined => (id ? indice(e).porId.get(id) : undefined);

/** "Cuota 2 de Mentoría" / "Reserva de Mentoría". */
export const nombreDeCuota = (c: CuotaPendiente): string =>
  `${c.cuota.esReserva ? "Reserva" : `Cuota ${c.cuota.numero}`}${c.producto ? ` de ${c.producto}` : ""}`;
