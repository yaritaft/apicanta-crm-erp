import { sumarMeses } from "./clientes-cs";
import type { SeguimientoAlumno, SesionUnoAUno } from "./types";

/* ==================================================================
   Los bonos del alumno (reunión del 21/10 con Lili): las sesiones 1 a 1
   con Yari que trae el contrato y las de acompañamiento con Lili.

   El contrato dice cuántas sesiones con Yari incluye («Sesiones con el
   mentor», `sesionesMentor`) y que se toman dentro de los primeros 3 meses
   del programa: pasados, se pierden. Las de Lili no tienen tope; se anotan
   para que cualquiera del equipo sepa qué acompañamiento tuvo.
   ================================================================== */

/** Cuántos meses desde el inicio valen las sesiones del contrato. */
export const MESES_DE_LAS_SESIONES = 3;

export const esConYari = (s: Pick<SesionUnoAUno, "con">) => s.con.trim().toLowerCase().startsWith("yari");

export interface ResumenBonos {
  /* Las que incluye el contrato con Yari (null: no se cargó). */
  incluidas: number | null;
  tomadas: number;
  quedan: number | null;
  /* Hasta cuándo valen (inicio + 3 meses); "" si no se sabe el inicio. */
  vencen: string;
  /* Le quedan sesiones y ya pasó el plazo. */
  vencidas: boolean;
  conYari: SesionUnoAUno[];
  conOtros: SesionUnoAUno[];
}

/** Lo que se ve en la solapa Bonos: las de Yari contra las incluidas y el plazo, y las demás aparte (lo más nuevo arriba). */
export function resumenBonos(seg: Pick<SeguimientoAlumno, "sesionesMentor" | "sesionesUnoAUno">, inicio: string, hoy: string): ResumenBonos {
  const todas = [...(seg.sesionesUnoAUno ?? [])].sort((a, b) => b.fecha.localeCompare(a.fecha) || b.creadoEn.localeCompare(a.creadoEn));
  const conYari = todas.filter(esConYari);
  const incluidas = seg.sesionesMentor ?? null;
  const quedan = incluidas === null ? null : Math.max(0, incluidas - conYari.length);
  const vencen = /^\d{4}-\d{2}-\d{2}/.test(inicio) ? sumarMeses(inicio.slice(0, 10), MESES_DE_LAS_SESIONES) : "";
  return {
    incluidas, tomadas: conYari.length, quedan, vencen,
    vencidas: Boolean(vencen && hoy > vencen && (quedan ?? 0) > 0),
    conYari, conOtros: todas.filter((s) => !esConYari(s)),
  };
}

/** La lista con una sesión agregada o corregida (por id) o, con `borrar`, sin ella. */
export function conSesion(lista: readonly SesionUnoAUno[] | undefined, s: SesionUnoAUno, borrar = false): SesionUnoAUno[] {
  const sin = (lista ?? []).filter((x) => x.id !== s.id);
  return borrar ? sin : [...sin, s];
}
