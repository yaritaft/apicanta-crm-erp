/* ==================================================================
   Los resells que agendó Customer Success en un mes (Lili, 26/10: «a fin de
   mes saber cuántos resells agendé en el mes, porque es parte del sueldo»).

   Un resell agendado es una fila de la agenda de resells (Alumnos → Resells:
   las llamadas de resell y de testimonio que entran solas de Calendly, las que
   se cargan a mano y las importadas del Airtable) que no se canceló. Cuenta en
   el mes en que se RESERVÓ, no en el de la llamada: `agendadoEn` lo pone la
   base (supabase/resells-agendado-en.sql) con el día de la reserva original,
   así que una reprogramación no cuenta dos veces ni se muda de mes. Las
   importadas del Airtable no traen ese dato: cuentan por el día de la llamada.

   Es la misma cuenta para su panel (lo que ella pasa) y para la liquidación
   de Honorarios (la base «Resells agendados», lib/honorarios.ts). Antes la
   liquidación contaba las llamadas con utm_source «Resell», y desde que los
   resells entran por «Próximos pasos» (sin UTM) daba cero.
   ================================================================== */

import { diaDeNegocio } from "./dia-negocio";
import type { Resell } from "./types";

type DeLaAgenda = Pick<Resell, "id" | "fechaHora" | "nombre" | "closer" | "cancelada"> & Partial<Pick<Resell, "agendadoEn" | "casoDeExito">>;

export interface ResellAgendado<R extends DeLaAgenda = Resell> {
  resell: R;
  /* El día en que se reservó, en Argentina («2026-10-22»); si no se sabe (importado del Airtable), el de la llamada. */
  dia: string;
  porLlamada: boolean;
}

/** Cuándo cuenta un resell: el instante de la reserva o, si no se sabe, el de la llamada. */
export const instanteDeAgenda = (r: Pick<Resell, "fechaHora"> & Partial<Pick<Resell, "agendadoEn">>): string => r.agendadoEn || r.fechaHora;

/** Los resells reservados entre dos días de Argentina (inclusive), sin los cancelados, del más viejo al más nuevo. */
export function resellsAgendados<R extends DeLaAgenda>(resells: readonly R[] | undefined, desdeDia: string, hastaDia: string): ResellAgendado<R>[] {
  const vistos = new Set<string>();
  const out: ResellAgendado<R>[] = [];
  for (const r of resells ?? []) {
    if (r.cancelada || vistos.has(r.id)) continue;
    vistos.add(r.id);
    const dia = diaDeNegocio(instanteDeAgenda(r));
    if (!dia || dia < desdeDia || dia > hastaDia) continue;
    out.push({ resell: r, dia, porLlamada: !r.agendadoEn });
  }
  return out.sort((a, b) => a.dia.localeCompare(b.dia) || a.resell.nombre.localeCompare(b.resell.nombre, "es"));
}

const finDeMes = (mes: string): string => {
  const [a, m] = mes.split("-").map(Number);
  return `${mes}-${String(new Date(Date.UTC(a, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Los de un mes («2026-10»). */
export const resellsDelMes = <R extends DeLaAgenda>(resells: readonly R[] | undefined, mes: string): ResellAgendado<R>[] =>
  resellsAgendados(resells, `${mes}-01`, finDeMes(mes));

/** «2026-09» → «2026-10» (o al revés con -1). */
export function otroMes(mes: string, cuantos: number): string {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + cuantos, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** «octubre de 2026». */
export const mesEnLetras = (mes: string): string => `${MESES[Number(mes.slice(5, 7)) - 1]} de ${mes.slice(0, 4)}`;

/** El closer como se lo conoce: «Mariano Arias» y «Mariano» son el mismo. */
const nombreCorto = (closer: string): string => closer.trim().split(/\s+/)[0] || "Sin closer";

export interface ResumenResells {
  total: number;
  /* Los que son llamada de testimonio (caso de éxito). */
  testimonio: number;
  porCloser: { closer: string; n: number }[];
}

export function resumenResells(items: readonly ResellAgendado<DeLaAgenda>[]): ResumenResells {
  const porCloser = new Map<string, number>();
  for (const i of items) {
    /* Los importados del Airtable a veces traen dos («Martin,Mariano»): cuenta para el primero. */
    const c = nombreCorto(i.resell.closer.split(",")[0] ?? "");
    porCloser.set(c, (porCloser.get(c) ?? 0) + 1);
  }
  return {
    total: items.length,
    testimonio: items.filter((i) => i.resell.casoDeExito).length,
    porCloser: [...porCloser].map(([closer, n]) => ({ closer, n })).sort((a, b) => b.n - a.n || a.closer.localeCompare(b.closer, "es")),
  };
}

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

/** El texto para pasar la cuenta del mes (a Finanzas, para la liquidación): el total y uno por renglón. */
export function textoParaPasar(mes: string, items: readonly ResellAgendado<DeLaAgenda>[]): string {
  const r = resumenResells(items);
  const cabeza = `Resells agendados en ${mesEnLetras(mes)}: ${r.total}`;
  if (!r.total) return cabeza;
  const detalle = [
    r.porCloser.map((x) => `${x.closer} ${x.n}`).join(" · "),
    r.testimonio ? `${r.testimonio} de testimonio` : "",
  ].filter(Boolean).join(" — ");
  const renglones = items.map((i) => {
    const llamada = diaDeNegocio(i.resell.fechaHora);
    const cuando = i.porLlamada ? `llamada el ${ddmm(i.dia)}` : `agendado el ${ddmm(i.dia)}${llamada && llamada !== i.dia ? `, llamada el ${ddmm(llamada)}` : ""}`;
    return `• ${i.resell.nombre.trim() || "Sin nombre"} (con ${nombreCorto(i.resell.closer.split(",")[0] ?? "")}, ${cuando})`;
  });
  return [cabeza, detalle, "", ...renglones].join("\n");
}
