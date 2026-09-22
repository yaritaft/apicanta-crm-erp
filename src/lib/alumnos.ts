import type { Alumno, Cuota, EstadoApp, EtapaServicio, ID, Venta } from "./types";
import { claveEmail } from "./contactos";

/* ------------------------------------------------------------------
   Reglas del alumno.

   Viven acá, y no en store.ts, porque las usan tres lados que tienen que
   decidir igual: el store (el alta automática al registrar una venta), el
   asistente de alta y las pantallas. Si cada uno tuviera su versión de
   "este alumno ya existe", el mismo cliente terminaría duplicado según por
   dónde entró.
------------------------------------------------------------------- */

/* Las etapas del pipeline de servicio, en el orden de las columnas. */
export function etapasDeServicio(e: EstadoApp): EtapaServicio[] {
  return [...(e.etapasServicio ?? [])].sort(
    (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"),
  );
}

/* La columna en la que se dibuja un alumno. Sin etapa, o con una que ya se
   borró, cae en la primera: un alumno nunca puede quedar fuera del tablero,
   ni desaparecer de la vista porque alguien borró su etapa. */
export function etapaDelAlumno(etapas: EtapaServicio[], a: Alumno): EtapaServicio | undefined {
  return etapas.find((x) => x.id === a.etapaServicioId) ?? etapas[0];
}

/* Donde arranca un alumno nuevo. */
export function etapaInicialDeServicio(e: EstadoApp): ID | undefined {
  return etapasDeServicio(e)[0]?.id;
}

/* La persona detrás de una venta.

   `venta.contactoId` guarda hoy el id de un LEAD, que casi siempre es también
   el id de su contacto (ver la nota de `altaDeLead` en store.ts). Se busca en
   los dos lados y el contacto manda, porque es la fuente de verdad de la
   persona; si no hay ninguno, queda el nombre que se escribió en la venta. */
export function personaDeVenta(e: EstadoApp, v: Venta): {
  nombre: string; email: string; pais: string; leadId?: ID;
} {
  const lead = v.contactoId ? e.leads.find((l) => l.id === v.contactoId) : undefined;
  const contacto = v.contactoId
    ? e.contactos.find((c) => c.id === v.contactoId)
      ?? (lead?.contactoId ? e.contactos.find((c) => c.id === lead.contactoId) : undefined)
    : undefined;
  return {
    nombre: (contacto?.nombre || lead?.nombre || v.contactoNombre || "").trim(),
    email: (contacto?.email || lead?.email || "").trim(),
    pais: (contacto?.pais || lead?.pais || "").trim(),
    leadId: v.contactoId,
  };
}

/* El alumno que ya le corresponde a una venta, si hay uno: el que la tiene
   enlazada, el que salió del mismo lead o el que tiene el mismo mail.

   Es LA regla contra duplicados. Por nombre no se compara a propósito: dos
   "Martín Gómez" pueden ser dos personas, y enlazar la venta de uno a la
   ficha del otro es un error que no se ve. Un duplicado sí se ve, y se borra. */
export function alumnoDeVenta(e: EstadoApp, v: Venta): Alumno | undefined {
  const porVenta = e.alumnos.find((a) => a.ventaId === v.id);
  if (porVenta) return porVenta;
  if (v.contactoId) {
    const porLead = e.alumnos.find((a) => a.leadId === v.contactoId);
    if (porLead) return porLead;
  }
  const k = claveEmail(personaDeVenta(e, v).email);
  return k ? e.alumnos.find((a) => claveEmail(a.email) === k) : undefined;
}

/* El plan de un alumno que viene de una venta es el producto que compró. */
export function planDeVenta(e: EstadoApp, v: Venta): string {
  return e.productos.find((p) => p.id === v.productoId)?.nombre ?? "";
}

/* Lo que paga por mes, sacado del plan de cuotas de la venta.

   Un pago único no deja cuota mensual; un plan en cuotas, el monto de una
   cuota regular (la reserva es una seña, no una mensualidad). Se asume plan
   mensual, que es como se venden casi todas. Si no hay forma de saberlo, 0:
   un hueco a la vista es mejor que un MRR inventado. */
export function cuotaMensualDeVenta(cuotas: Cuota[]): number {
  const regulares = cuotas
    .filter((c) => !c.esReserva && c.estado !== "cancelada")
    .sort((a, b) => a.numero - b.numero);
  if (regulares.length < 2) return 0;
  return Math.round(regulares[0].monto * 100) / 100;
}

/* Las opciones de plan: las de Ajustes más las que hagan falta.

   Un alumno que vino de una venta tiene como plan el nombre del producto, que
   no está en la lista de Ajustes. Sin sumarlo, el desplegable mostraría otro
   plan que el que tiene y, al guardar, lo pisaría sin que nadie lo note. */
export function opcionesDePlan(e: EstadoApp, ...extra: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const p of [...e.ajustes.planes, ...extra]) {
    const t = (p ?? "").trim();
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/* Las cohortes en uso, de la más nueva a la más vieja: atajos para no
   escribir "C9" a mano cada vez. */
export function cohortesRecientes(e: EstadoApp, max = 5): string[] {
  const ultima = new Map<string, number>();
  for (const a of e.alumnos) {
    const c = a.cohorte?.trim();
    if (!c) continue;
    const t = new Date(a.inicio).getTime() || 0;
    if (t >= (ultima.get(c) ?? -Infinity)) ultima.set(c, t);
  }
  return [...ultima.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([c]) => c);
}

/* Las ventas que se le pueden enlazar a un alumno: las que no tienen alumno
   (o son de éste). Primero las que parecen suyas —mismo lead, mismo mail o
   mismo nombre—, después las más nuevas. */
export function ventasParaEnlazar(e: EstadoApp, a: Pick<Alumno, "id" | "nombre" | "email" | "leadId">): Venta[] {
  const k = claveEmail(a.email);
  const nombre = a.nombre.trim().toLowerCase();
  const afinidad = (v: Venta) => {
    if (a.leadId && v.contactoId === a.leadId) return 3;
    if (k && claveEmail(personaDeVenta(e, v).email) === k) return 2;
    if (nombre && v.contactoNombre.trim().toLowerCase() === nombre) return 1;
    return 0;
  };
  return e.ventas
    .filter((v) => {
      const suyo = alumnoDeVenta(e, v);
      return !suyo || suyo.id === a.id;
    })
    .map((v) => ({ v, n: afinidad(v) }))
    .sort((x, y) => y.n - x.n || +new Date(y.v.fecha) - +new Date(x.v.fecha))
    .map((x) => x.v);
}
