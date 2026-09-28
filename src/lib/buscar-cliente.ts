import type { Cuota, EstadoApp, ID, Venta } from "./types";
import { normalizar } from "./conciliacion";

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

interface Indice {
  leads: EstadoApp["leads"]; ventas: EstadoApp["ventas"]; cuotas: EstadoApp["cuotas"];
  pagos: EstadoApp["pagos"]; productos: EstadoApp["productos"];
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
    && IX.pagos === e.pagos && IX.productos === e.productos) return IX;
  const pagado = new Map<ID, number>();
  for (const p of e.pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
  const producto = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
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
        cuotas.push({ cuota: c, venta: v, producto: v.productoId ? producto.get(v.productoId) : undefined, saldo, diasAtraso: Math.floor((hoy - vence) / DIA) });
      }
    }
    cuotas.sort((a, b) => b.diasAtraso - a.diasAtraso);
    return { id: l.id, nombre: l.nombre, email: l.email || undefined, telefono: l.telefono || undefined, compras: ventas.length, cuotas };
  });
  IX = {
    leads: e.leads, ventas: e.ventas, cuotas: e.cuotas, pagos: e.pagos, productos: e.productos,
    personas,
    porId: new Map(personas.map((p) => [p.id, p] as const)),
    texto: new Map(personas.map((p) => [p.id, normalizar(`${p.nombre} ${p.email ?? ""}`)] as const)),
    digitos: new Map(personas.map((p) => [p.id, (p.telefono ?? "").replace(/\D/g, "")] as const)),
  };
  return IX;
}

/** Por nombre, correo o teléfono. Primero los que ya compraron. */
export function buscarPersonas(e: EstadoApp, consulta: string, limite = 6, soloConCuotas = false): PersonaBuscada[] {
  const ix = indice(e);
  const q = normalizar(consulta);
  const digitos = consulta.replace(/\D/g, "");
  const base = soloConCuotas ? ix.personas.filter((p) => p.cuotas.length > 0) : ix.personas;
  if (q.length < 2 && digitos.length < 4) return [];
  return base
    .filter((p) => (q.length >= 2 && ix.texto.get(p.id)!.includes(q)) || (digitos.length >= 4 && ix.digitos.get(p.id)!.includes(digitos)))
    .sort((a, b) => b.cuotas.length - a.cuotas.length || b.compras - a.compras || a.nombre.localeCompare(b.nombre))
    .slice(0, limite);
}

/** Los que deben alguna cuota, del más atrasado al que menos. */
export function conCuotasPendientes(e: EstadoApp, limite = 8): PersonaBuscada[] {
  return indice(e).personas
    .filter((p) => p.cuotas.length > 0)
    .sort((a, b) => (b.cuotas[0]?.diasAtraso ?? 0) - (a.cuotas[0]?.diasAtraso ?? 0))
    .slice(0, limite);
}

export const personaPorId = (e: EstadoApp, id?: ID): PersonaBuscada | undefined => (id ? indice(e).porId.get(id) : undefined);

/** "Cuota 2 de Mentoría" / "Reserva de Mentoría". */
export const nombreDeCuota = (c: CuotaPendiente): string =>
  `${c.cuota.esReserva ? "Reserva" : `Cuota ${c.cuota.numero}`}${c.producto ? ` de ${c.producto}` : ""}`;
