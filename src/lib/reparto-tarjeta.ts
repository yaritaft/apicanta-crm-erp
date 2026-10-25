import type { EstadoApp, Gasto } from "./types";
import { sugerirCategoria } from "./gastos";

/* ==================================================================
   El pago de la tarjeta de crédito, repartido en sus compras (Aldana, 24/10).

   El banco (Mercury) sólo avisa lo que se pagó de la tarjeta, todos los días: «Pago de la tarjeta · IO AUTOPAY, US$ 2.212,62». Las compras de la tarjeta
   —la mayoría, honorarios del CEO— no las muestra por su API. Cargado así, un solo gasto «Pendiente de revisión» junta cosas que son de categorías
   distintas: el estado de resultados no sabe cuánto fue de Software, de Ads o de honorarios.

   Acá se reparte ese gasto en sus compras: cada una con su categoría, y suman exactamente lo que se pagó. La cuenta, el día y la referencia del
   banco quedan en todas, así que para la caja nada cambia; lo que cambia es dónde cae cada compra en el estado de resultados.
   ================================================================== */

export const CATEGORIA_SIN_REVISAR = "Pendiente de revisión";

const r2 = (n: number) => Math.round(n * 100) / 100;

/** ¿Es el pago de la tarjeta de crédito del banco, todavía en un solo gasto? */
export const esPagoDeTarjeta = (g: Pick<Gasto, "concepto" | "monto" | "extra">): boolean =>
  Boolean(g.extra?.bancoRef) && /tarjeta de cr[eé]dito/i.test(g.concepto) && g.monto > 0 && !g.extra?.repartidoDe;

/** ¿Es una de las compras en que se repartió un pago de la tarjeta? */
export const esParteDeUnPago = (g: Pick<Gasto, "extra">): boolean => Boolean(g.extra?.repartidoDe);

export interface CompraDeTarjeta { concepto: string; monto: number; categoria: string }

export const sumaDeCompras = (compras: readonly Pick<CompraDeTarjeta, "monto">[]): number =>
  r2(compras.reduce((a, c) => a + (Number.isFinite(c.monto) ? c.monto : 0), 0));

/** Lo que falta (+) o sobra (−) para que las compras sumen lo que se pagó. */
export const faltaRepartir = (total: number, compras: readonly Pick<CompraDeTarjeta, "monto">[]): number => r2(total - sumaDeCompras(compras));

/** ¿Se puede repartir? Qué falta, si no. */
export function problemaDelReparto(total: number, compras: readonly CompraDeTarjeta[]): string | null {
  if (compras.length === 0) return "Agregá al menos una compra";
  const sinNombre = compras.findIndex((c) => !c.concepto.trim());
  if (sinNombre >= 0) return `Falta decir qué fue la compra ${sinNombre + 1}`;
  const sinMonto = compras.findIndex((c) => !(c.monto > 0));
  if (sinMonto >= 0) return `Falta el monto de la compra ${sinMonto + 1}`;
  const sinCategoria = compras.findIndex((c) => !c.categoria.trim());
  if (sinCategoria >= 0) return `Falta la categoría de la compra ${sinCategoria + 1}`;
  const dif = faltaRepartir(total, compras);
  if (Math.abs(dif) > 0.009) return dif > 0 ? `Faltan ${dif.toFixed(2)} para llegar a lo que se pagó` : `Sobran ${Math.abs(dif).toFixed(2)} sobre lo que se pagó`;
  return null;
}

/* ---------- Leer las compras que se pegan ---------- */

const NUMERICO = /^\(?[-+]?\s*(?:US\$|USD|\$)?\s*[-+]?\d[\d.,]*\)?$/i;
const FECHA = /^(\d{4}-\d{2}-\d{2}([ T][\d:.Z+-]+)?|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|[A-Za-zñÑ]{3,9}\.? \d{1,2}(,? \d{4})?)$/;
const ESTADO = /^(sent|pending|posted|settled|failed|cancelled|canceled|completed|enviado|pendiente|completado|fallido)$/i;
const NO_ES_COMPRA = /\b(autopay|cashback|credit card payment|payment received|pago de la tarjeta|statement)\b/i;

/** «1.234,56», «1,234.56», «45.99», «-$45», «(45,00)» → 1234.56, 1234.56, 45.99, 45, 45. Sin signo: lo que se pagó es siempre positivo. */
export function numeroDeCompra(texto: string): number | null {
  let t = texto.trim().replace(/US\$|USD|\$|\s|[()+-]/gi, "");
  if (!/^\d[\d.,]*$/.test(t)) return null;
  const punto = t.lastIndexOf("."), coma = t.lastIndexOf(",");
  if (punto >= 0 && coma >= 0) {
    const decimal = punto > coma ? "." : ",";
    t = t.split(decimal === "." ? "," : ".").join("").replace(decimal, ".");
  } else if (coma >= 0) {
    t = /,\d{1,2}$/.test(t) && t.indexOf(",") === coma ? t.replace(",", ".") : t.split(",").join("");
  } else if (punto >= 0) {
    t = /\.\d{1,2}$/.test(t) && t.indexOf(".") === punto ? t : t.split(".").join("");
  }
  const n = Number(t);
  return Number.isFinite(n) ? r2(n) : null;
}

/** Corta una línea en celdas: por tabulaciones, o por comas si parece un CSV (comillas o varias comas). Si no, null. */
function celdasDe(linea: string): string[] | null {
  if (linea.includes("\t")) return linea.split("\t").map((c) => c.trim());
  let comasFuera = 0, dentro = false;
  for (const ch of linea) { if (ch === '"') dentro = !dentro; else if (ch === "," && !dentro) comasFuera++; }
  if (comasFuera < 2 && !linea.includes('"')) return null;
  const celdas: string[] = [];
  let actual = "";
  dentro = false;
  for (const ch of linea) {
    if (ch === '"') dentro = !dentro;
    else if (ch === "," && !dentro) { celdas.push(actual.trim()); actual = ""; }
    else actual += ch;
  }
  celdas.push(actual.trim());
  return celdas;
}

const limpiar = (t: string) => t.replace(/\s+/g, " ").replace(/^[\s\-–—,;:|*]+|[\s\-–—,;:|*]+$/g, "").trim();

/** Lee lo que se pegó —una compra por línea («Zoom 15,99»), o filas del CSV o de la tabla de la tarjeta del banco— y sugiere la categoría de cada una. */
export function leerCompras(texto: string, e: EstadoApp): CompraDeTarjeta[] {
  const out: CompraDeTarjeta[] = [];
  let columnas: { monto: number; concepto: number } | null = null;
  for (const cruda of texto.split(/\r?\n/)) {
    const linea = cruda.trim();
    if (!linea) continue;
    const celdas = celdasDe(linea);
    let concepto = "", monto: number | null = null;
    if (celdas && celdas.length >= 2) {
      const minus = celdas.map((c) => c.toLowerCase());
      const iMonto = minus.findIndex((c) => /^(amount|monto|importe)$/.test(c));
      if (iMonto >= 0) {
        const iConcepto = minus.findIndex((c) => /^(description|merchant|descripci[oó]n|comercio|name|nombre)$/.test(c));
        columnas = { monto: iMonto, concepto: iConcepto >= 0 ? iConcepto : minus.findIndex((_, i) => i !== iMonto && !FECHA.test(celdas[i])) };
        continue;
      }
      if (columnas && celdas[columnas.monto] !== undefined) {
        monto = numeroDeCompra(celdas[columnas.monto]);
        concepto = celdas[columnas.concepto] ?? "";
      } else {
        /* Sin encabezado: el monto es la celda numérica con decimales (la de la derecha si hay varias); el concepto, la primera con letras. */
        const numericas = celdas.map((c, i) => ({ c, i })).filter((x) => NUMERICO.test(x.c) && !FECHA.test(x.c));
        const conDecimales = numericas.filter((x) => /[.,]\d{1,2}\)?$/.test(x.c));
        const elegida = (conDecimales.length ? conDecimales : numericas).slice(-1)[0];
        monto = elegida ? numeroDeCompra(elegida.c) : null;
        concepto = celdas.find((c) => /[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(c) && !FECHA.test(c) && !ESTADO.test(c) && !NUMERICO.test(c)) ?? "";
      }
    } else {
      const m = linea.match(/(\(?[-+]?\s*(?:US\$|USD|\$)?\s*[-+]?\d[\d.,]*\)?)\s*$/i);
      if (!m) continue;
      monto = numeroDeCompra(m[1]);
      concepto = linea.slice(0, m.index).replace(/^(\d{4}-\d{2}-\d{2}|\d{1,2}[/.-]\d{1,2}([/.-]\d{2,4})?|[A-Za-z]{3,9}\.? \d{1,2}(,? \d{4})?)\b/, "");
    }
    concepto = limpiar(concepto);
    if (!monto || monto <= 0 || !concepto || NO_ES_COMPRA.test(concepto)) continue;
    out.push({ concepto, monto, categoria: sugerirCategoria(concepto, e)?.categoria ?? CATEGORIA_SIN_REVISAR });
  }
  return out;
}
