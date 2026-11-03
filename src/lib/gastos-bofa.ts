import type { EstadoApp } from "./types";
import { normalizar } from "./gastos";
import { cuentaDeContraparte } from "./traspasos";
import { fechasDeMercury, montoDeMercury, personaDelEquipo, type QueEs } from "./gastos-mercury";

/* ==================================================================
   El export de Bank of America, leído para cargar gastos (Manu, 03/11: «Mercury no la vamos a manejar más, ahora vamos a manejar la cuenta del
   Bank of America [...] que chupe todos los gastos a nivel individual»).

   Bank of America no tiene una API que la app pueda leer (sacó hasta el formato OFX): lo que deja es bajar los movimientos en CSV desde Online Banking
   («Download»). Acá está lo que sabe leer de ese archivo y qué hacer con cada movimiento, con las mismas reglas que el export de Mercury: cargarlo como
   gasto, como plata que volvió, como pago al equipo (marcado: sale de la caja, no suma al costo), o dejarlo afuera con su motivo (pago de la tarjeta, lo que pasa
   entre cuentas propias, lo que entra).
   Sin React ni red: se prueba con filas de ejemplo.

   Los dos formatos que baja el banco:
     · cuenta corriente / ahorro:  Date, Description, Amount, Running Bal.   (con un resumen arriba: «Beginning balance as of…», «Total credits»…)
     · tarjeta de crédito:         Posted Date, Reference Number, Payee, Address, Amount
   Fechas de Estados Unidos (mes/día/año) y montos con el signo del banco: negativo sale plata, positivo entra.
   ================================================================== */

export interface FilaBofa {
  fecha: string;
  /* Lo que dice el banco, entero. */
  descripcion: string;
  monto: number;
  saldo?: number;
  origen: "cuenta" | "tarjeta";
  /* Cuál de las movimientos iguales (mismo día, monto y descripción) del archivo es: dos cafés iguales el mismo día son dos gastos. */
  repetida: number;
}

const norm = (s: string) => normalizar(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** La fila de títulos de un export de Bank of America (puede venir debajo del resumen), y de cuál de los dos formatos es. */
function encontrarTitulos(tabla: readonly string[][]): { i: number; origen: FilaBofa["origen"] } | null {
  for (let i = 0; i < Math.min(tabla.length, 30); i++) {
    const t = tabla[i].map(norm);
    if (t.includes("date") && t.includes("description") && t.includes("amount") && t.includes("running bal")) return { i, origen: "cuenta" };
    if (t.includes("posted date") && t.includes("payee") && t.includes("amount")) return { i, origen: "tarjeta" };
  }
  return null;
}

/** ¿Lo pegado es un export de Bank of America? */
export const esExportDeBofa = (tabla: readonly string[][]): boolean => encontrarTitulos(tabla) !== null;

/** Las filas de un export de Bank of America, o null si no lo es. Se descartan las que no tienen fecha ni monto (el «Beginning balance» de arriba). */
export function leerExportDeBofa(tabla: string[][]): FilaBofa[] | null {
  const h = encontrarTitulos(tabla);
  if (!h) return null;
  const t = tabla[h.i].map(norm);
  const col = (...nombres: string[]) => t.findIndex((x) => nombres.includes(x));
  const i = { fecha: col("date", "posted date"), desc: col("description", "payee"), monto: col("amount"), saldo: col("running bal") };
  const datos = tabla.slice(h.i + 1);
  const celda = (f: string[], k: number) => (k >= 0 ? (f[k] ?? "").trim() : "");
  const fechas = fechasDeMercury(datos.map((f) => celda(f, i.fecha)));
  const vistas = new Map<string, number>();
  const out: FilaBofa[] = [];
  datos.forEach((f, n) => {
    const monto = montoDeMercury(celda(f, i.monto));
    const fecha = fechas[n];
    if (monto === null || !fecha) return;
    const descripcion = celda(f, i.desc).replace(/\s+/g, " ");
    const clave = `${fecha}|${Math.round(Math.abs(monto) * 100)}|${monto < 0 ? "-" : "+"}|${norm(descripcion)}`;
    const repetida = (vistas.get(clave) ?? 0) + 1;
    vistas.set(clave, repetida);
    const saldo = i.saldo >= 0 ? montoDeMercury(celda(f, i.saldo)) : null;
    out.push({ fecha, descripcion, monto, ...(saldo !== null ? { saldo } : {}), origen: h.origen, repetida });
  });
  return out;
}

/* ---------- Un nombre que se lee ---------- */

/** «CHECKCARD 1031 UBER *TRIP HELP.UBER.COM CA 24692165275100012345678» → «UBER *TRIP HELP.UBER.COM CA». Le saca lo que pone el banco y no dice nada. */
export function limpiarDescripcionBofa(d: string): string {
  let s = d.replace(/\s+/g, " ").trim();
  s = s.replace(/^(CHECKCARD|CHECK CARD|PURCHASE|DEBIT CARD|DEBIT PURCHASE|RECURRING PAYMENT|RECURRING CARD)\s+(\d{4}\s+)?/i, "");
  s = s.replace(/\s+(CONF#|CONFIRMATION#|TRN:|ID:|REF:|PMT ID:)\s*\S*.*$/i, "");
  s = s.replace(/\s+X{4,}\d*\s*$/i, "");
  s = s.replace(/\s+\d{10,}\s*$/, "");
  return s.slice(0, 80).trim() || d.trim();
}

/** Una clave corta y estable de un movimiento: no se carga dos veces el mismo si se baja el archivo de nuevo. Los iguales del mismo archivo llevan su número. */
export function refDeBofa(m: FilaBofa): string {
  const texto = `${m.fecha}|${Math.round(m.monto * 100)}|${norm(m.descripcion)}`;
  let h = 5381;
  for (let k = 0; k < texto.length; k++) h = ((h << 5) + h + texto.charCodeAt(k)) | 0;
  return `bofa:${m.fecha}:${Math.round(Math.abs(m.monto) * 100)}:${(h >>> 0).toString(36)}${m.repetida > 1 ? `:${m.repetida}` : ""}`;
}

/* ---------- Qué es cada movimiento ---------- */

const PAGO_DE_TARJETA = /\b(credit card|card payment|bill payment|payment to crd|online payment to|autopay|payment thank you)\b/i;
const ENTRE_CUENTAS = /\b(mercury|relay|apicanta llc|online banking transfer|transfer to (chk|sav)|transfer from (chk|sav)|from (chk|sav)|to (chk|sav))\b/i;
const NOMINA = /\b(payroll|gusto|deel|rippling|remote\.com|adp)\b/i;
const COMISION_DEL_BANCO = /\b(service charge|monthly (maintenance )?fee|maintenance fee|wire (transfer )?fee|overdraft|nsf|international transaction fee)\b/i;
const REINTEGRO = /\b(refund|reversal|credit adjustment|return)\b/i;

/** Qué es un movimiento de Bank of America y qué hacer con él. Lo que no es un gasto queda afuera con el motivo. */
export function queEsBofa(m: FilaBofa, e: Pick<EstadoApp, "equipo">): QueEs {
  const d = m.descripcion;
  if (/\b(beginning|ending) balance\b/i.test(d)) return { tipo: "afuera", motivo: "Es el saldo del resumen, no un movimiento" };
  const propia = cuentaDeContraparte(d) !== null || ENTRE_CUENTAS.test(d);
  if (m.monto > 0) {
    if (propia) return { tipo: "afuera", motivo: "Es plata que viene de una cuenta propia: se carga en Caja → Movimiento entre cuentas" };
    if (REINTEGRO.test(d)) return { tipo: "ingreso" };
    return { tipo: "afuera", motivo: "Es plata que entra: los cobros se concilian en Conciliación" };
  }
  if (PAGO_DE_TARJETA.test(d) && m.origen === "cuenta") {
    return { tipo: "afuera", motivo: "Es el pago de la tarjeta: las compras se cargan una por una (el archivo de la tarjeta), cargarlo también las duplica" };
  }
  if (propia) return { tipo: "afuera", motivo: "Es un movimiento entre cuentas propias: se carga en Caja → Movimiento entre cuentas, no es un gasto" };
  const persona = personaDelEquipo(d, e);
  if (NOMINA.test(d) || persona) return { tipo: "equipo", persona };
  return { tipo: "gasto" };
}

/** Las comisiones del banco tienen categoría propia si existe en el catálogo; el resto la sugiere el historial. */
export const esComisionDelBanco = (d: string): boolean => COMISION_DEL_BANCO.test(d);
