import type { EstadoApp, Gasto } from "./types";
import { normalizar } from "./gastos";
import { cuentaDeContraparte } from "./traspasos";

/* ==================================================================
   El export de Mercury, leído para cargar gastos (Aldana, 27/10/2026).

   Aldana bajó todos los movimientos de octubre de Mercury (tarjeta y cuenta corriente) y vio dos cosas: (1) las compras de la tarjeta estaban
   cargadas como UN pago diario («Pago de la tarjeta de crédito Mercury», operativo) cuando gran parte son honorarios del CEO; (2) las «Comisiones»
   de procesadores que había exportado de la planilla Finance estaban de más, porque el sistema ya las calcula de cada cobro. Y avisó que los pagos
   de equipo de fin de mes se registran dos veces si se cargan, porque ya los registra el cierre de la liquidación.

   Acá está lo que sabe leer un export de Mercury y qué hacer con cada movimiento: cargarlo como gasto, como plata que volvió, o dejarlo afuera con su
   motivo (el pago de la tarjeta, el pago de equipo, lo que pasa entre cuentas propias, lo que falló, lo que entra). Sin React ni red: se prueba con
   filas de ejemplo.
   ================================================================== */

/** Una fila del export de Mercury, ya leída. `monto` va con el signo del banco: negativo, sale plata; positivo, entra. */
export interface FilaMercury {
  fecha: string;
  descripcion: string;
  monto: number;
  estado: string;
  /* «Mercury Credit» (la tarjeta) o «Mercury Checking xx5408». */
  cuentaOrigen: string;
  descripcionBanco: string;
  referencia: string;
  nota: string;
  tarjeta: string;
  rubroMercury: string;
  comercio: string;
  /* Cuándo lo creó el banco (único por movimiento): sirve para no cargarlo dos veces. */
  timestamp: string;
}

export type QueEs =
  | { tipo: "gasto" }
  | { tipo: "ingreso" }
  | { tipo: "afuera"; motivo: string };

const r2 = (n: number) => Math.round(n * 100) / 100;

/* ---------- Leer el export ---------- */

const norm = (s: string) => normalizar(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** Si la primera fila es la de títulos de un export de Mercury («Date (UTC)», «Amount», «Source Account»…). */
export function esExportDeMercury(titulos: readonly string[]): boolean {
  const t = new Set(titulos.map(norm));
  return t.has("source account") && t.has("amount") && t.has("description") && [...t].some((x) => x.startsWith("date"));
}

/** Un monto como lo escribe Mercury («-2347.3») o como queda al pegar desde Excel en castellano («-2.347,30»). Null si no es un número. */
export function montoDeMercury(texto: string): number | null {
  let t = texto.trim().replace(/[−–]/g, "-").replace(/US\$|USD|\$|\s/gi, "");
  const negativo = /^\(.*\)$/.test(t) || t.startsWith("-");
  t = t.replace(/[()+-]/g, "");
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
  return Number.isFinite(n) ? (negativo ? -n : n) : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Los días «aaaa-mm-dd» de la columna de fechas. Mercury escribe fechas de Estados Unidos (mes-día-año) y Excel en castellano las pone día/mes/año: se
 *  decide mirando el conjunto (un número que pasa de 12 lo dice) y, si todavía no, la hora de creación del movimiento. */
export function fechasDeMercury(fechas: readonly string[], timestamps: readonly string[] = []): (string | null)[] {
  const armar = (a: number, m: number, d: number): string | null => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${pad(m)}-${pad(d)}` : null;
  };
  type Ambigua = { a: number; b: number; anio: number };
  const partes = fechas.map((t): { iso: string | null } | Ambigua => {
    const iso = t.trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    if (iso) return { iso: armar(Number(iso[1]), Number(iso[2]), Number(iso[3])) };
    const x = t.trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)/);
    if (!x) return { iso: null };
    const a = Number(x[1]), b = Number(x[2]), anio = x[3].length === 2 ? 2000 + Number(x[3]) : Number(x[3]);
    return { a, b, anio };
  });
  const esAmbigua = (p: { iso: string | null } | Ambigua): p is Ambigua => "a" in p;
  const sinIso = partes.filter(esAmbigua);
  let orden: "dmy" | "mdy" = "mdy";
  if (sinIso.some((p) => p.a > 12)) orden = "dmy";
  else if (sinIso.some((p) => p.b > 12)) orden = "mdy";
  else if (sinIso.length) {
    /* Los dos órdenes son posibles: gana el que queda a menos de un día de la hora de creación del movimiento. */
    const cerca = (o: "dmy" | "mdy") => sinIso.filter((p, i) => {
      const fechaTs = (timestamps[i] ?? "").slice(0, 10);
      const f = o === "dmy" ? armar(p.anio, p.b, p.a) : armar(p.anio, p.a, p.b);
      return f && fechaTs && Math.abs(Date.parse(`${f}T12:00:00Z`) - Date.parse(`${fechaTs}T12:00:00Z`)) <= 86400000;
    }).length;
    orden = cerca("dmy") > cerca("mdy") ? "dmy" : "mdy";
  }
  return partes.map((p) => (esAmbigua(p) ? (orden === "dmy" ? armar(p.anio, p.b, p.a) : armar(p.anio, p.a, p.b)) : p.iso));
}

/** Las filas de un export de Mercury (con su fila de títulos), o null si no lo es. Las que no tienen fecha o monto se descartan. */
export function leerExportDeMercury(tabla: string[][]): FilaMercury[] | null {
  if (tabla.length < 2 || !esExportDeMercury(tabla[0])) return null;
  const t = tabla[0].map(norm);
  const col = (...nombres: string[]) => t.findIndex((x) => nombres.includes(x));
  const i = {
    fecha: t.findIndex((x) => x.startsWith("date")), descripcion: col("description"), monto: col("amount"), estado: col("status"),
    cuenta: col("source account"), banco: col("bank description"), referencia: col("reference"), nota: col("note"), tarjeta: col("last four digits"),
    rubro: col("category"), comercio: col("merchant type"), timestamp: col("timestamp"),
  };
  const datos = tabla.slice(1);
  const celda = (f: string[], k: number) => (k >= 0 ? (f[k] ?? "").trim() : "");
  const fechas = fechasDeMercury(datos.map((f) => celda(f, i.fecha)), datos.map((f) => celda(f, i.timestamp)));
  const out: FilaMercury[] = [];
  datos.forEach((f, n) => {
    const monto = montoDeMercury(celda(f, i.monto));
    const fecha = fechas[n];
    if (monto === null || !fecha) return;
    out.push({
      fecha, descripcion: celda(f, i.descripcion), monto, estado: celda(f, i.estado), cuentaOrigen: celda(f, i.cuenta), descripcionBanco: celda(f, i.banco),
      referencia: celda(f, i.referencia), nota: celda(f, i.nota), tarjeta: celda(f, i.tarjeta), rubroMercury: celda(f, i.rubro), comercio: celda(f, i.comercio),
      timestamp: celda(f, i.timestamp),
    });
  });
  return out;
}

/* ---------- Qué es cada movimiento ---------- */

/** ¿Esta persona del equipo es la de esa descripción? Hace falta el primer nombre y el último (con o sin tildes): «Agustin Sica», «Mariano Arias (Closer)
 *  (Mariano Daniel Arias Kahale)». */
export function personaDelEquipo(texto: string, e: Pick<EstadoApp, "equipo">): string | null {
  const t = ` ${norm(texto)} `;
  for (const m of e.equipo) {
    const partes = norm(m.nombre).split(" ").filter(Boolean);
    if (partes.length < 2) continue;
    if (t.includes(` ${partes[0]} `) && t.includes(` ${partes[partes.length - 1]} `)) return m.nombre;
  }
  return null;
}

const PROCESADORES = /\b(stripe|d ?local|whop|hotmart|financiera|mercado ?pago|paypal|payoneer|binance)\b/;

/** ¿Es la comisión de un procesador de pagos («Comisiones stripe 12-18 Octubre», «Comisiones 12-18 Dlocal»)? Esa comisión ya se calcula de cada
 *  cobro (`pagos.feeMonto`): cargarla además como gasto la cuenta dos veces. */
export function esComisionDeProcesador(concepto: string, proveedor = ""): boolean {
  const c = norm(concepto);
  /* La comisión por mover la plata de una pasarela al banco (un retiro, una transacción de salida) no es la comisión de cada cobro: ésa sí es un costo aparte. */
  if (/\b(transaccion|retiro|payout|withdrawal|transferencia)\b/.test(c)) return false;
  return /^comisiones?\b/.test(c) && PROCESADORES.test(norm(`${concepto} ${proveedor}`));
}

/** Los gastos ya cargados que son la comisión de un procesador (lo que duplica lo que se calcula de cada cobro). */
export const esGastoDeComisionDeProcesador = (g: Pick<Gasto, "concepto" | "proveedor" | "categoria" | "grupo">): boolean =>
  g.grupo === "directo" && ["Comisiones Financieras", "Facturas Stripe"].includes(g.categoria) && esComisionDeProcesador(g.concepto, g.proveedor ?? "");

const AUTOPAGO_TARJETA = /\b(autopay|io payment|credit card payment|pago de la tarjeta)\b|^mercury credit$/;

/** Qué es un movimiento del export de Mercury y qué hacer con él. Lo que no es un gasto queda afuera con el motivo. */
export function queEsMercury(m: FilaMercury, e: Pick<EstadoApp, "equipo">): QueEs {
  const estado = norm(m.estado);
  if (/\b(failed|cancelled|canceled|reversed|blocked)\b/.test(estado)) return { tipo: "afuera", motivo: "El banco lo dejó fallido: la plata no se movió" };
  const esTarjeta = /credit/i.test(m.cuentaOrigen);
  const banco = norm(`${m.descripcionBanco} ${m.descripcion} ${m.referencia}`);
  const rubro = norm(m.rubroMercury);
  if (esTarjeta && m.monto > 0) {
    if (AUTOPAGO_TARJETA.test(banco) || /\bmercury checking\b/.test(norm(m.descripcion))) {
      return { tipo: "afuera", motivo: "Es el pago de la tarjeta: las compras se cargan una por una, cargarlo también las duplica" };
    }
    return { tipo: "ingreso" };
  }
  if (!esTarjeta && m.monto > 0) {
    if (/cashback/.test(banco)) return { tipo: "afuera", motivo: "Cashback de Mercury: lo trae el banco solo" };
    return { tipo: "afuera", motivo: "Es plata que entra: los cobros se concilian en Conciliación" };
  }
  if (!esTarjeta && AUTOPAGO_TARJETA.test(norm(m.descripcion))) {
    return { tipo: "afuera", motivo: "Es el pago de la tarjeta: las compras se cargan una por una, cargarlo también las duplica" };
  }
  if (rubro === "transfer" || cuentaDeContraparte(m.descripcion) !== null || /for further credit to apicanta/.test(banco)) {
    return { tipo: "afuera", motivo: "Es un movimiento entre cuentas propias: no es un gasto" };
  }
  if (rubro === "payroll" || personaDelEquipo(m.descripcion, e)) {
    return { tipo: "afuera", motivo: "Es un pago de equipo: se registra al cerrar la liquidación del mes, cargarlo acá lo duplica" };
  }
  return { tipo: "gasto" };
}

/* ---------- Qué categoría ---------- */

const RUBROS_PERSONALES = /^(business meals|travel transportation|entertainment|employee benefits)$/;
const COMERCIOS_PERSONALES = /^(restaurants|ridesharea?n?d?taxis|rideshareandtaxis|groundtransportation|lodging|airlines|othertravel|clothing|retail|medical|grocery|entertainment|travel|bars?|cafes?)$/;
const COMERCIOS_SOFTWARE = /^(software|internetandtelecom|internetandt\w*)$/;

/** La categoría que corresponde a un movimiento según lo que dice Mercury, cuando no hay un gasto igual cargado antes. Vacío si no se sabe. */
export function categoriaDeRubroMercury(m: Pick<FilaMercury, "descripcion" | "rubroMercury" | "comercio">): string {
  const d = norm(m.descripcion), rubro = norm(m.rubroMercury), comercio = norm(m.comercio).replace(/ /g, "");
  if (/\b(facebook|meta platforms|fb ads)\b/.test(d)) return "Meta Ads";
  if (rubro === "software subscriptions" || COMERCIOS_SOFTWARE.test(comercio)) return "Software";
  if (RUBROS_PERSONALES.test(rubro) || COMERCIOS_PERSONALES.test(comercio)) return "Honorarios del CEO";
  return "";
}

/* ---------- Lo que ya está cargado ---------- */

export interface GastoParecido { id: string; dia: string; centavos: number; nombre: string }

/** Los gastos que ya están, para ver si un movimiento del banco ya se cargó: mismo monto en centavos y a menos de tres días (la planilla y el banco no
 *  siempre usan el mismo día). Cada gasto sirve para UN movimiento: dos Uber del mismo monto y día piden dos gastos. */
export function indiceDeGastos(gastos: readonly { id: string; fecha: string; fechaPago?: string; monto: number; concepto?: string; proveedor?: string }[], dia: (g: { fecha: string; fechaPago?: string }) => string): Map<number, GastoParecido[]> {
  const m = new Map<number, GastoParecido[]>();
  for (const g of gastos) {
    const c = Math.round(g.monto * 100);
    m.set(c, [...(m.get(c) ?? []), { id: g.id, dia: dia(g), centavos: c, nombre: norm(`${g.concepto ?? ""} ${g.proveedor ?? ""}`) }]);
  }
  return m;
}

/* Si comparten alguna palabra de cuatro letras o más («Uber» y «Uber trip», «iPostal1» e «Ipostal1»). */
const seParecen = (a: string, b: string): boolean => {
  const ta = norm(a).split(" ").filter((x) => x.length >= 4);
  const tb = new Set(norm(b).split(" ").filter((x) => x.length >= 4));
  return ta.some((x) => tb.has(x));
};

const diasEntre = (a: string, b: string) => Math.abs(Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000;

/** Busca (y gasta) un gasto cargado igual al movimiento: el mismo monto a menos de tres días, y entre varios, el que se llama parecido y está más cerca.
 *  Devuelve su id o null. `usados` crece con cada uno que se asigna. */
export function gastoParecido(indice: Map<number, GastoParecido[]>, usados: Set<string>, dia: string, monto: number, nombre = ""): string | null {
  const c = Math.round(monto * 100);
  const candidatos = (indice.get(c) ?? []).filter((g) => !usados.has(g.id) && diasEntre(g.dia, dia) <= 3);
  if (!candidatos.length) return null;
  const puntaje = (g: GastoParecido) => (nombre && seParecen(nombre, g.nombre) ? 0 : 1);
  candidatos.sort((a, b) => puntaje(a) - puntaje(b) || diasEntre(a.dia, dia) - diasEntre(b.dia, dia));
  usados.add(candidatos[0].id);
  return candidatos[0].id;
}

/** Los pagos de la tarjeta (un solo gasto) de esas fechas: se reemplazan por las compras cuando se cargan una por una. */
export function pagosDeTarjetaDelRango(gastos: readonly Gasto[], desde: string, hasta: string, dia: (g: Gasto) => string): Gasto[] {
  return gastos.filter((g) => {
    if (!(g.monto > 0) || !/tarjeta de cr[eé]dito/i.test(g.concepto) || !g.extra?.bancoRef || g.extra?.repartidoDe) return false;
    const d = dia(g);
    return d >= desde && d <= hasta;
  });
}

export const sumaDe = (gastos: readonly Pick<Gasto, "monto">[]) => r2(gastos.reduce((a, g) => a + g.monto, 0));
