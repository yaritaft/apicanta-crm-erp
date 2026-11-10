import { sinTildes } from "./crm";
import { testimonioNormal } from "./clientes-cs";
import type { Alumno, Testimonio } from "./types";

/* ==================================================================
   «Testimonios» en Mi panel de Customer Success (Lili, 10/11): una lista con TODOS los testimonios, los que ya se grabaron y los
   que no, con su estado y filtros. La lista «Testimonios» de «Para hoy» (lib/panel-servicio.ts) sólo trae lo que pide acción (falta
   agendar la grabación o falta el link): lo grabado y con su video quedaba fuera y no había dónde verlo todo junto. Es la misma
   fuente que la tabla de Alumnos → Testimonios (lib/clientes-cs.ts), contada en pocos estados que se leen de un vistazo.
   ================================================================== */

export type EstadoTestimonio = "con-link" | "sin-link" | "agendado" | "por-agendar" | "no-quiere";
export type FiltroTestimonios = "todos" | EstadoTestimonio;

export const ESTADOS_TESTIMONIO: { id: EstadoTestimonio; chip: string; pastilla: string; ayuda: string; tono: "ok" | "aviso" | "info" | "malo" }[] = [
  { id: "con-link", chip: "Grabados con link", pastilla: "Grabado", tono: "ok", ayuda: "Ya se grabó y el video tiene su link." },
  { id: "sin-link", chip: "Falta el link", pastilla: "Falta el link", tono: "aviso", ayuda: "Ya se grabó (o el video está subido) y todavía no se cargó el link." },
  { id: "agendado", chip: "Agendados", pastilla: "Agendado", tono: "info", ayuda: "La llamada de grabación está agendada y todavía no llegó." },
  { id: "por-agendar", chip: "Por agendar", pastilla: "Por agendar", tono: "aviso", ayuda: "Falta agendar la llamada de grabación." },
  { id: "no-quiere", chip: "No quieren grabar", pastilla: "No quiere grabar", tono: "malo", ayuda: "Dijeron que no: no se les insiste." },
];

/** En qué está un testimonio. El link manda (si hay link, está grabado); después, que no quiere; después, la fecha de la grabación. */
export function estadoDelTestimonio(t: Pick<Testimonio, "link" | "followUp" | "estadoVideo" | "fechaGrabacion">, hoy: string): EstadoTestimonio {
  if ((t.link ?? "").trim()) return "con-link";
  const followUp = sinTildes(t.followUp ?? "").trim();
  const video = sinTildes(t.estadoVideo ?? "").trim();
  if (followUp === "no quiere grabar" || video === "no quiso grabar") return "no-quiere";
  if (["pendiente de subir", "subido a drive", "subido a youtube"].includes(video)) return "sin-link";
  const fecha = (t.fechaGrabacion ?? "").slice(0, 10);
  if (fecha) return fecha <= hoy ? "sin-link" : "agendado";
  return followUp === "llamada agendada" ? "agendado" : "por-agendar";
}

export interface FilaTestimonioPanel {
  id: string;
  alumnoId: string;
  /* Vacío si el alumno ya no existe. */
  nombre: string;
  estado: EstadoTestimonio;
  fecha: string | null;
  conQuien: string;
  link: string;
  creadoEn: string;
}

/** Todos los testimonios, uno por fila, con el nombre del alumno. */
export function filasDeTestimonios(
  testimonios: readonly Partial<Testimonio>[] | undefined, alumnos: readonly Pick<Alumno, "id" | "nombre">[], hoy: string,
): FilaTestimonioPanel[] {
  const nombres = new Map(alumnos.map((a) => [a.id, a.nombre] as const));
  return (testimonios ?? []).filter((t) => t.id && t.alumnoId).map((t0) => {
    const t = testimonioNormal(t0 as Pick<Testimonio, "id" | "alumnoId"> & Partial<Testimonio>);
    return {
      id: t.id, alumnoId: t.alumnoId, nombre: (nombres.get(t.alumnoId) ?? "").trim(), estado: estadoDelTestimonio(t, hoy),
      fecha: t.fechaGrabacion, conQuien: t.conQuien, link: t.link, creadoEn: t.creadoEn,
    };
  });
}

/** Cuántos hay en cada estado y en total. */
export function resumenDeTestimonios(filas: readonly FilaTestimonioPanel[]): { total: number; porEstado: Record<EstadoTestimonio, number> } {
  const porEstado: Record<EstadoTestimonio, number> = { "con-link": 0, "sin-link": 0, agendado: 0, "por-agendar": 0, "no-quiere": 0 };
  for (const f of filas) porEstado[f.estado] += 1;
  return { total: filas.length, porEstado };
}

/** Lo que se ve en la lista: el filtro elegido y lo que se busca (por alumno). Arriba lo más reciente o lo que viene; sin fecha, al final. */
export function listaDeTestimonios(filas: readonly FilaTestimonioPanel[], filtro: FiltroTestimonios, buscar: string): FilaTestimonioPanel[] {
  const q = sinTildes(buscar).trim();
  return filas
    .filter((f) => (filtro === "todos" || f.estado === filtro) && (!q || sinTildes(f.nombre).includes(q)))
    .sort((a, b) => (b.fecha ?? "").localeCompare(a.fecha ?? "") || b.creadoEn.localeCompare(a.creadoEn) || a.nombre.localeCompare(b.nombre, "es"));
}
