import type { EstadoApp, ID } from "./types";
import { comisionesSetterYReferidor } from "./finanzas";
import { moverPeriodo, nombrePeriodo, rangoDePeriodo } from "./periodos";

/* ==================================================================
   Una comisión de setter muy por encima de lo de siempre (Aldana, 31/10): «su comisión según el cierre mensual es mil y pico y nunca en la
   historia comisionó tanto por setting». Se notó al cerrar el mes. Ahora la liquidación lo avisa antes: si lo que cobra un setter por sus
   ventas este mes es más del doble de su mejor mes de los seis anteriores, dice cuánto y de qué mes, y manda a ver las ventas que lo traen.
   ================================================================== */

export const MESES_DE_HISTORIA = 6;
/* Por debajo de esto no vale la pena el aviso. */
export const MINIMO_QUE_AVISA = 150;
export const VECES_QUE_AVISA = 2;

export interface AvisoDeSetter {
  miembroId: ID;
  nombre: string;
  esteMes: number;
  /* Su mejor mes de los anteriores y cuál fue (aaaa-mm). */
  mejorAntes: number;
  mesDelMejor: string;
  veces: number;
  periodo: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function settersConComisionInusual(e: EstadoApp, periodo: string): AvisoDeSetter[] {
  const setters = e.equipo.filter((m) => m.rol === "setter");
  if (setters.length === 0) return [];
  const delMes = (p: string) => new Map(comisionesSetterYReferidor(e, rangoDePeriodo(p)).porPersona.map((x) => [x.nombre, x.total] as const));
  const ahora = delMes(periodo);
  const avisos: AvisoDeSetter[] = [];
  for (const m of setters) {
    const esteMes = r2(ahora.get(m.nombre) ?? 0);
    if (esteMes < MINIMO_QUE_AVISA) continue;
    let mejorAntes = 0, mesDelMejor = "";
    for (let k = 1; k <= MESES_DE_HISTORIA; k++) {
      const p = moverPeriodo(periodo, -k);
      const total = r2(delMes(p).get(m.nombre) ?? 0);
      if (total > mejorAntes) { mejorAntes = total; mesDelMejor = p; }
    }
    if (mejorAntes <= 0 || esteMes < mejorAntes * VECES_QUE_AVISA) continue;
    avisos.push({ miembroId: m.id, nombre: m.nombre, esteMes, mejorAntes, mesDelMejor, veces: Math.round((esteMes / mejorAntes) * 10) / 10, periodo });
  }
  return avisos;
}

export const mesDelAviso = (a: Pick<AvisoDeSetter, "mesDelMejor">) => nombrePeriodo(a.mesDelMejor);
