import type { Alumno, Cuota, ID, SeguimientoAlumno, Venta } from "./types";
import { indiceDeReservas } from "./reservas";
import { esVentaDeBaja } from "./contratos-de-baja";

/* ==================================================================
   En qué está un alumno de verdad: LA regla para contar y filtrar «activos» (Liliana, 27/11).

   «En Alumnos, con el filtro Activos, me figuran 701. No es real: adentro aparecen los que están en outboarding (que serían las
   bajas) y las reservas (que todavía no deberían contar ni como activos ni como bajas)». Ella estimaba 400–420.

   Por qué pasaba: el campo `estado` del alumno (activo, pausado, egresado, baja) se carga una vez y nadie lo actualiza. Lo que
   Lili lleva de verdad es el Follow Up (OUTBOARDING cuando cierra) y la reserva sale sola de los pagos. El panel de Servicio ya
   lo sabía (sacaba outboarding y reservas), pero la lista de Alumnos, el número del menú, el Dashboard y Clientes contaban el
   campo crudo: cada pantalla con su propia cuenta, y cada una daba distinto.

   Ahora hay una sola regla y la usan todas. No se escribe nada en la base: sale de lo que ya está cargado, así que cuando Lili
   pasa a alguien a Outboarding, o una reserva paga lo que falta, o Finanzas da de baja una venta, el número cambia solo.

     · Lo que se marcó a mano en el estado (pausado, egresado, baja) manda.
     · Figura activo pero su venta se canceló o se reembolsó  → baja (devolvió la plata, o el closer pidió la baja de la reserva).
     · Figura activo pero su Follow Up dice Outboarding        → baja (terminó o se fue: lo cierra Lili).
     · Figura activo y sólo pagó la reserva (o el Follow Up dice Reserva) → reserva: todavía no arrancó; no es activo ni baja.
     · Todo lo demás → activo.
   ================================================================== */

export type SituacionAlumno = "activo" | "reserva" | "pausado" | "graduado" | "baja";

/** En el orden en que se muestran los filtros. */
export const SITUACIONES_ALUMNO: readonly SituacionAlumno[] = ["activo", "reserva", "pausado", "graduado", "baja"];

export const SITUACION_ALUMNO: Record<SituacionAlumno, { texto: string; plural: string; variante: "success" | "warning" | "brand" | "neutral" | "info"; ayuda: string }> = {
  activo: { texto: "Activo", plural: "Activos", variante: "success", ayuda: "Cursan hoy: sin las reservas, sin los que están en Outboarding y sin las ventas canceladas o reembolsadas." },
  reserva: { texto: "Reserva", plural: "Reservas", variante: "info", ayuda: "Sólo pagaron la reserva (o su Follow Up dice Reserva): todavía no arrancaron. No cuentan como activos ni como bajas." },
  pausado: { texto: "Pausado", plural: "Pausados", variante: "warning", ayuda: "Marcados como pausados en su ficha." },
  graduado: { texto: "Egresado", plural: "Egresados", variante: "brand", ayuda: "Marcados como egresados en su ficha." },
  baja: { texto: "Baja", plural: "Bajas", variante: "neutral", ayuda: "Dados de baja: con el Follow Up en Outboarding, con la venta cancelada o reembolsada, o marcados como baja en su ficha." },
};

/** Lili ya lo pasó a «outboarding» en el Follow Up (como en su Airtable): terminó el programa, aunque el campo `estado` siga «activo».
 *
 *  «Caso de éxito» NO es terminar: un caso de éxito puede seguir con el contrato vigente y entonces hay que seguir contactándolo
 *  (Lili, 10/11: «que no se me anule el próximo contacto»). Cuando su contrato termina, sale como cualquier otro (por la fecha de egreso). */
export function terminoElServicio(followUp: string | null | undefined): boolean {
  const f = (followUp ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return f.startsWith("outboarding") || f.startsWith("outbording");
}

export interface DatosDeSituacion {
  estado: Alumno["estado"];
  followUp?: string | null;
  /* Sólo pagó la reserva, o su Follow Up dice «Reserva» (lib/reservas.ts). */
  enReserva?: boolean;
  /* La venta que cursa (`alumno.ventaId`) está cancelada o reembolsada (lib/contratos-de-baja.ts). */
  ventaDeBaja?: boolean;
}

/** La situación de un alumno con lo que ya se sabe de él. Ver la regla arriba. */
export function situacionDelAlumno(d: DatosDeSituacion): SituacionAlumno {
  if (d.estado !== "activo") {
    /* Lo marcado a mano manda. Un estado escrito de otra forma («egresado», de una importación vieja) nunca cuenta como activo. */
    const e = String(d.estado ?? "").toLowerCase().trim();
    if (e === "pausado") return "pausado";
    if (e === "graduado" || e === "egresado") return "graduado";
    return "baja";
  }
  if (d.ventaDeBaja) return "baja";
  if (terminoElServicio(d.followUp)) return "baja";
  if (d.enReserva) return "reserva";
  return "activo";
}

type AlumnoDeSituacion = Pick<Alumno, "id" | "estado"> & { ventaId?: string | null };
type BaseDeSituaciones<T extends AlumnoDeSituacion = AlumnoDeSituacion> = {
  alumnos: readonly T[];
  seguimientos?: readonly Pick<SeguimientoAlumno, "alumnoId" | "followUp">[];
  cuotas?: readonly Pick<Cuota, "ventaId" | "monto" | "esReserva" | "estado">[];
  ventas?: readonly Pick<Venta, "id" | "estado">[];
};

/** La situación de cada alumno de la base, armada una sola vez (con cientos de alumnos, buscar uno por uno se nota). */
export function indiceDeSituaciones(e: Omit<BaseDeSituaciones, "alumnos">): (a: AlumnoDeSituacion) => SituacionAlumno {
  const followUp = new Map((e.seguimientos ?? []).map((s) => [s.alumnoId, s.followUp] as const));
  const ventaDeBaja = new Set((e.ventas ?? []).filter((v) => esVentaDeBaja(v.estado)).map((v) => v.id));
  const esReserva = indiceDeReservas(e.cuotas ?? []);
  const cache = new Map<ID, SituacionAlumno>();
  return (a) => {
    const ya = cache.get(a.id);
    if (ya) return ya;
    const fu = followUp.get(a.id);
    const s = situacionDelAlumno({
      estado: a.estado, followUp: fu, enReserva: esReserva({ ventaId: a.ventaId ?? undefined }, fu), ventaDeBaja: Boolean(a.ventaId && ventaDeBaja.has(a.ventaId)),
    });
    cache.set(a.id, s);
    return s;
  };
}

/** Cuántos alumnos hay en cada situación. */
export function cuentaPorSituacion(e: BaseDeSituaciones): Record<SituacionAlumno, number> {
  const de = indiceDeSituaciones(e);
  const n: Record<SituacionAlumno, number> = { activo: 0, reserva: 0, pausado: 0, graduado: 0, baja: 0 };
  for (const a of e.alumnos) n[de(a)] += 1;
  return n;
}

/** Los alumnos activos de verdad: lo que dice «Alumnos activos» en cualquier pantalla (la lista, el menú, el Dashboard, Clientes). */
export function alumnosActivos<T extends AlumnoDeSituacion>(e: BaseDeSituaciones<T>): T[] {
  const de = indiceDeSituaciones(e);
  return e.alumnos.filter((a) => de(a) === "activo");
}
