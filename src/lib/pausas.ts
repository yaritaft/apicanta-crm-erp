import { diasEntre, sumarDias } from "./seguimiento";
import type { PausaServicio } from "./types";

export type { PausaServicio };

/* ==================================================================
   Demora de inicio y pausas del programa (Lili, 22/10).

   - Demora de inicio: el alumno compró pero arranca más tarde (hasta 60
     días después del ingreso). El programa cuenta desde ese día.
   - Pausa: deja de cursar un tiempo (hasta 45 días) y retoma.

   Las dos corren el fin del programa. El ejemplo de Lili: entra el 22/10
   por 3 meses con 60 días de demora → cursa del 22/12 al 22/03; si pausa
   del 30/12 al 30/01 (31 días), termina el 22/04. Todo queda en el
   historial del alumno (no se pisa nada: cada demora o pausa es una
   fila), y mientras está en pausa no le toca el contacto de seguimiento.
   ================================================================== */

export const MAX_DEMORA_DIAS = 60;
export const MAX_PAUSA_DIAS = 45;

export type TipoPausa = PausaServicio["tipo"];

const DIA = /^\d{4}-\d{2}-\d{2}$/;

/* Lo que viene de la base, sano: sin filas rotas y ordenado por fecha. */
export function pausasNormales(x: unknown): PausaServicio[] {
  if (!Array.isArray(x)) return [];
  return x
    .filter((p): p is PausaServicio => Boolean(p) && typeof p === "object"
      && ((p as PausaServicio).tipo === "demora" || (p as PausaServicio).tipo === "pausa")
      && DIA.test(String((p as PausaServicio).desde)) && DIA.test(String((p as PausaServicio).hasta)))
    .map((p) => ({
      id: String(p.id), tipo: p.tipo, desde: p.desde, hasta: p.hasta, motivo: String(p.motivo ?? ""),
      creadoEn: String(p.creadoEn ?? ""), creadoPor: String(p.creadoPor ?? ""),
    }))
    .sort((a, b) => a.desde.localeCompare(b.desde));
}

export const diasDe = (p: Pick<PausaServicio, "desde" | "hasta">) => Math.max(0, diasEntre(p.desde, p.hasta));

/* La demora de inicio (hay una sola: la última que se cargó). */
export const demoraDe = (pausas: readonly PausaServicio[]) => [...pausas].reverse().find((p) => p.tipo === "demora");
export const soloPausas = (pausas: readonly PausaServicio[]) => pausas.filter((p) => p.tipo === "pausa");
export const diasDePausa = (pausas: readonly PausaServicio[]) => soloPausas(pausas).reduce((n, p) => n + diasDe(p), 0);

/* El día en que arranca de verdad: el ingreso o, con demora, el día en que termina la demora. */
export function inicioReal(inicio: string, pausas: readonly PausaServicio[]): string {
  return demoraDe(pausas)?.hasta ?? inicio;
}

/* El fin del programa con la demora y las pausas. `fin` es el que ya se calculaba (inicio + duración, o el que alguien
   escribió a mano); `finDesdeInicio` lo vuelve a calcular desde otro inicio, para que la demora corra los meses enteros
   (22/10 + 3 meses con 60 días de demora es 22/03, no 21/03). */
export function finConPausas(
  inicio: string, fin: string | null, pausas: readonly PausaServicio[], finDesdeInicio?: (inicio: string) => string | null,
): string | null {
  if (!fin) return null;
  const demora = demoraDe(pausas);
  let f = fin;
  if (demora) f = finDesdeInicio?.(demora.hasta) ?? sumarDias(fin, diasEntre(inicio, demora.hasta));
  const pausa = diasDePausa(pausas);
  return pausa ? sumarDias(f, pausa) : f;
}

/* La demora o la pausa en curso: desde ese día y hasta el día antes de retomar. */
export function pausaEnCurso(pausas: readonly PausaServicio[], hoy: string): PausaServicio | null {
  return pausas.find((p) => p.desde <= hoy && hoy < p.hasta) ?? null;
}

function dosMesesDespues(dia: string): string {
  const [a, m, d] = dia.split("-").map(Number);
  const finDeMes = new Date(Date.UTC(a, m + 2, 0)).getUTCDate();
  return new Date(Date.UTC(a, m + 1, Math.min(d, finDeMes))).toISOString().slice(0, 10);
}

/* Lo que no se puede cargar, en palabras (o null si está bien). */
export function problemaDePausa(p: Pick<PausaServicio, "id" | "tipo" | "desde" | "hasta">, inicio: string, otras: readonly PausaServicio[]): string | null {
  if (!DIA.test(p.desde) || !DIA.test(p.hasta)) return "Faltan las fechas.";
  const dias = diasEntre(p.desde, p.hasta);
  if (dias <= 0) return p.tipo === "demora" ? "El día en que arranca tiene que ser después del ingreso." : "El día en que retoma tiene que ser después del día en que pausa.";
  if (p.tipo === "demora") {
    /* «60 días» es «dos meses»: del 22/10 al 22/12 son 61 días y es lo que Lili cuenta como 60. */
    const tope = Math.max(MAX_DEMORA_DIAS, diasEntre(p.desde, dosMesesDespues(p.desde)));
    if (dias > tope) return `La demora de inicio es de hasta ${MAX_DEMORA_DIAS} días (dos meses): con ésta serían ${dias}.`;
    return null;
  }
  if (inicio && p.desde < inicioReal(inicio, otras)) return "La pausa empieza antes de que arranque el programa.";
  const resto = soloPausas(otras).filter((x) => x.id !== p.id);
  if (resto.some((x) => p.desde < x.hasta && x.desde < p.hasta)) return "Se superpone con otra pausa.";
  const total = resto.reduce((n, x) => n + diasDe(x), 0) + dias;
  if (total > MAX_PAUSA_DIAS) return `Las pausas suman hasta ${MAX_PAUSA_DIAS} días: con ésta serían ${total}.`;
  return null;
}

/* La lista con una demora o pausa nueva (o corregida, o borrada). La demora es una sola: una nueva reemplaza la anterior. */
export function conPausa(lista: readonly PausaServicio[] | undefined, p: PausaServicio, borrar = false): PausaServicio[] {
  const sin = (lista ?? []).filter((x) => x.id !== p.id && !(p.tipo === "demora" && x.tipo === "demora" && !borrar));
  return borrar ? sin : pausasNormales([...sin, p]);
}

/* Cómo decirlo en la ficha: «En pausa hasta el 30/01 · faltan 8 días». */
export function textoDePausa(p: PausaServicio, hoy: string, fmt: (dia: string) => string): string {
  const faltan = diasEntre(hoy, p.hasta);
  const cuando = faltan === 1 ? "mañana" : `en ${faltan} días`;
  return p.tipo === "demora" ? `Arranca el ${fmt(p.hasta)} (${cuando})` : `En pausa: retoma el ${fmt(p.hasta)} (${cuando})`;
}
