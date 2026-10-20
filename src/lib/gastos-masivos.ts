import type { EstadoApp, Gasto, GrupoGasto, Moneda } from "./types";
import type { CategoriaGasto } from "./seed";
import { aMonedaBase, categoriasDisponibles, fechaDePago, leerMonto, escribirMonto, montoOriginal, normalizar, sugerirCategoria } from "./gastos";
import { datosDelGasto, opcionesProveedor, problemasDelGasto, tipoCambioDeAjustes, type BorradorGasto, type ProblemasGasto } from "./carga-gasto";
import { diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   Cargar muchos gastos de una vez, pegando las filas de una planilla.

   Aldana (20/10): «hay más de 100 egresos desde el 7, unos 30 consumos por
   día: cargarlos uno por uno son horas». Se copian las filas de Excel y se
   pegan; la app lee las columnas (por los títulos, o por lo que hay en
   cada una), propone categoría y proveedor, marca lo que ya estaba cargado
   y deja corregir todo en una grilla antes de cargar.

   Sin React ni base: las mismas reglas las usa la pantalla y las pruebas.
   ================================================================== */

export type CampoMasivo = "fecha" | "concepto" | "proveedor" | "categoria" | "monto" | "moneda" | "cuenta" | "notas";

export const CAMPOS_MASIVOS: readonly { id: CampoMasivo; titulo: string; claves: readonly string[] }[] = [
  { id: "fecha", titulo: "Fecha", claves: ["fecha", "dia", "date", "fecha de pago", "fecha pago"] },
  { id: "concepto", titulo: "Concepto", claves: ["concepto", "detalle", "descripcion", "consumo", "movimiento", "description", "detail", "referencia"] },
  { id: "proveedor", titulo: "Proveedor", claves: ["proveedor", "comercio", "merchant", "pagado a", "beneficiario", "vendor", "negocio", "pago a"] },
  { id: "categoria", titulo: "Categoría", claves: ["categoria", "rubro", "category", "tipo de gasto"] },
  { id: "monto", titulo: "Monto", claves: ["monto", "importe", "total", "usd", "valor", "amount", "egreso", "egresos", "debito", "gasto", "gastos", "salida"] },
  { id: "moneda", titulo: "Moneda", claves: ["moneda", "divisa", "currency"] },
  { id: "cuenta", titulo: "Cuenta", claves: ["cuenta", "tarjeta", "medio de pago", "medio", "banco", "origen", "account", "card", "pagado con"] },
  { id: "notas", titulo: "Nota", claves: ["nota", "notas", "comentario", "comentarios", "observaciones", "obs"] },
];

/* ---------- Leer lo pegado ---------- */

/** Las filas y columnas de lo que se copió de una planilla. Excel y Google Sheets copian con tabulaciones; también se leen
 *  archivos separados por «;» o por «,». Las celdas entre comillas pueden llevar saltos de línea. Las filas vacías se ignoran. */
export function parsearPegado(texto: string): string[][] {
  const t = texto.replace(/\r\n?/g, "\n").replace(/^﻿/, "");
  if (!t.trim()) return [];
  const sep = elegirSeparador(t);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (entreComillas) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else entreComillas = false; } else celda += c;
    } else if (c === '"' && celda === "") {
      entreComillas = true;
    } else if (c === sep) {
      fila.push(celda.trim()); celda = "";
    } else if (c === "\n") {
      fila.push(celda.trim()); celda = "";
      filas.push(fila); fila = [];
    } else {
      celda += c;
    }
  }
  fila.push(celda.trim());
  filas.push(fila);
  return filas.filter((f) => f.some((c) => c !== ""));
}

/* Tabulación si hay (lo que copia Excel); si no, el separador que más se repite igual en todas las líneas. */
function elegirSeparador(t: string): string {
  if (t.includes("\t")) return "\t";
  const lineas = t.split("\n").filter((l) => l.trim()).slice(0, 20);
  for (const s of [";", ","]) {
    const cuentas = lineas.map((l) => l.split(s).length - 1);
    if (cuentas.length && cuentas[0] > 0 && cuentas.every((n) => n === cuentas[0])) return s;
  }
  return "\t";
}

const MESES: Record<string, number> = {
  ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, set: 9, sep: 9, oct: 10, nov: 11, dic: 12,
};

const dosCifras = (n: number) => String(n).padStart(2, "0");

/** El día de una celda como «aaaa-mm-dd», o null si no es una fecha. Lee 07/10/2026, 7/10/26, 7-10, 2026-10-07, «7 oct», «7 de octubre
 *  de 2026» y los números de fecha de Excel (46302). Va día/mes (como se escribe acá); si el primer número pasa de 12 es el día y si el
 *  segundo pasa de 12 es el mes (formato de Estados Unidos). Sin año, es el de `hoy` (o el anterior si quedaría a más de un mes). */
export function leerFecha(texto: string, hoy: Date = new Date()): string | null {
  const t = normalizar(texto).replace(/\bde\b/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  const armar = (a: number, m: number, d: number): string | null => {
    const f = new Date(Date.UTC(a, m - 1, d));
    return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? `${a}-${dosCifras(m)}-${dosCifras(d)}` : null;
  };
  const sinAnio = (m: number, d: number): string | null => {
    let a = hoy.getFullYear();
    const f = armar(a, m, d);
    if (f && Date.parse(`${f}T12:00:00Z`) > hoy.getTime() + 31 * 86400000) a -= 1;
    return armar(a, m, d);
  };
  const anio = (s: string) => (s.length === 2 ? 2000 + Number(s) : Number(s));

  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:\D|$)/);
  if (m) return armar(Number(m[1]), Number(m[2]), Number(m[3]));

  m = t.match(/^(\d{1,2})[-/.](\d{1,2})(?:[-/.](\d{2}|\d{4}))?(?:\s|$)/);
  if (m) {
    let d = Number(m[1]);
    let mes = Number(m[2]);
    if (mes > 12 && d <= 12) [d, mes] = [mes, d];
    return m[3] ? armar(anio(m[3]), mes, d) : sinAnio(mes, d);
  }

  m = t.match(/^(\d{1,2})[ -]([a-z]{3,})\.?(?:[ -](\d{2}|\d{4}))?(?:\s|$)/);
  if (m) {
    const mes = MESES[m[2].slice(0, 3)];
    if (!mes) return null;
    return m[3] ? armar(anio(m[3]), mes, Number(m[1])) : sinAnio(mes, Number(m[1]));
  }

  if (/^\d{5}$/.test(t) && Number(t) > 30000 && Number(t) < 70000) {
    const f = new Date(Date.UTC(1899, 11, 30) + Number(t) * 86400000);
    return armar(f.getUTCFullYear(), f.getUTCMonth() + 1, f.getUTCDate());
  }
  return null;
}

/** Un monto pegado: «US$ 1.234,56», «(45,00)» (entre paréntesis es negativo), «45.50», «-12». La moneda sólo si la celda la dice. */
export function leerMontoPegado(texto: string): { monto: number; moneda?: Moneda } | null {
  const crudo = texto.trim();
  if (!crudo) return null;
  const moneda: Moneda | undefined = /\b(usd|us\$|u\$s|dolar(es)?)\b|us\$|u\$s/i.test(crudo) ? "USD" : /\b(ars|pesos?)\b|\$\s?ar/i.test(crudo) ? "ARS" : undefined;
  const negativo = /^\(.*\)$/.test(crudo) || /^[-−–]/.test(crudo.replace(/^[^\d(−–-]*/, "")) || /[-−–]\s*$/.test(crudo);
  const limpio = crudo.replace(/[−–]/g, "-").replace(/[^\d.,]/g, "");
  if (!/\d/.test(limpio)) return null;
  const n = leerMonto(limpio);
  if (!Number.isFinite(n)) return null;
  return { monto: negativo ? -Math.abs(n) : n, ...(moneda ? { moneda } : {}) };
}

/* ---------- Qué es cada columna ---------- */

const esFecha = (c: string) => leerFecha(c) !== null && /[/.\-\s]/.test(c.trim());
const esMonto = (c: string) => leerMontoPegado(c) !== null && /\d/.test(c) && !esFecha(c) && /^[\s$()\-−–+]*(us\$|u\$s|usd|ars)?[\s$]*[\d.,]+[\s)\-−–]*(usd|ars)?$/i.test(c.trim());

/** Si la primera fila son títulos: ninguna celda es una fecha ni un monto y, o alguna se llama como un campo conocido, o la fila de
 *  abajo sí tiene fechas o montos (los títulos pueden ser cualquiera: «Cuándo», «Qué», «Cuánto»). */
export function tieneTitulos(filas: string[][]): boolean {
  const primera = filas[0];
  if (!primera || filas.length < 2) return false;
  if (primera.some((c) => esFecha(c) || esMonto(c))) return false;
  return primera.some((c) => campoDeTitulo(c) !== null) || filas[1].some((c) => esFecha(c) || esMonto(c));
}

function campoDeTitulo(titulo: string): CampoMasivo | null {
  const t = normalizar(titulo).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  for (const c of CAMPOS_MASIVOS) if (c.claves.includes(t)) return c.id;
  for (const c of CAMPOS_MASIVOS) if (c.claves.some((k) => t.startsWith(`${k} `) || t.endsWith(` ${k}`))) return c.id;
  return null;
}

/** A qué campo va cada columna: por su título si hay, y lo que falte (fecha, concepto, monto) por lo que dice cada columna. */
export function adivinarColumnas(filas: string[][], conTitulos: boolean): (CampoMasivo | null)[] {
  const ancho = Math.max(0, ...filas.map((f) => f.length));
  const mapa: (CampoMasivo | null)[] = Array.from({ length: ancho }, () => null);
  const usados = new Set<CampoMasivo>();
  const poner = (i: number, c: CampoMasivo) => { if (mapa[i] === null && !usados.has(c)) { mapa[i] = c; usados.add(c); } };
  const datos = conTitulos ? filas.slice(1) : filas;

  if (conTitulos) filas[0].forEach((t, i) => { const c = campoDeTitulo(t); if (c) poner(i, c); });

  const columna = (i: number) => datos.map((f) => f[i] ?? "").filter((c) => c.trim() !== "");
  const mayoria = (i: number, prueba: (c: string) => boolean) => {
    const celdas = columna(i);
    return celdas.length > 0 && celdas.filter(prueba).length / celdas.length >= 0.7;
  };

  if (!usados.has("fecha")) for (let i = 0; i < ancho; i++) if (mapa[i] === null && mayoria(i, esFecha)) { poner(i, "fecha"); break; }
  if (!usados.has("monto")) for (let i = ancho - 1; i >= 0; i--) if (mapa[i] === null && mayoria(i, esMonto)) { poner(i, "monto"); break; }
  if (!usados.has("concepto")) {
    let mejor = -1; let largo = 0;
    for (let i = 0; i < ancho; i++) {
      if (mapa[i] !== null) continue;
      const celdas = columna(i);
      if (!celdas.length || celdas.filter((c) => esFecha(c) || esMonto(c)).length / celdas.length > 0.5) continue;
      const media = celdas.reduce((a, c) => a + c.length, 0) / celdas.length;
      if (media > largo) { largo = media; mejor = i; }
    }
    if (mejor >= 0) poner(mejor, "concepto");
  }
  return mapa;
}

/* ---------- Las filas para revisar ---------- */

export interface FilaMasiva {
  /* Estable mientras se edita: la fila 3 de lo pegado es «f3». */
  id: string;
  /* Se carga o se deja afuera (ya estaba cargada, o se desmarcó). */
  incluir: boolean;
  /* «aaaa-mm-dd» o vacío si no se pudo leer. */
  fecha: string;
  concepto: string;
  proveedor: string;
  categoria: string;
  /* Texto como se escribe acá («1.234,5»), siempre positivo: si es plata que volvió, `ingreso`. */
  monto: string;
  moneda: Moneda;
  cuenta: string;
  notas: string;
  ingreso: boolean;
  /* Ya hay un gasto igual (mismo día, monto y concepto). */
  yaCargada: boolean;
}

export interface ContextoMasivo {
  e: EstadoApp;
  hoy?: Date;
  /* La moneda de lo pegado cuando la planilla no la dice. */
  moneda?: Moneda;
  cuenta?: string;
}

/** Las categorías por nombre. Se arma una vez y se pasa a las funciones de abajo: pedirla de nuevo por cada fila ordena todos los gastos cada vez. */
export type Catalogo = ReadonlyMap<string, CategoriaGasto>;
export const catalogoDe = (e: EstadoApp): Catalogo => new Map(categoriasDisponibles(e).map((c) => [c.categoria, c] as const));

const clave = (dia: string, monto: number, concepto: string) => `${dia}|${Math.round(Math.abs(monto) * 100)}|${normalizar(concepto)}`;

/** La categoría con que se cargó antes cada proveedor o concepto (la del más reciente): «Figma» va con Software porque ya hubo uno. */
function categoriasPorNombre(e: Pick<EstadoApp, "gastos">): Map<string, string> {
  const m = new Map<string, string>();
  for (const g of [...e.gastos].sort((a, b) => +new Date(b.creadoEn || b.fecha) - +new Date(a.creadoEn || a.fecha))) {
    if (!g.categoria) continue;
    for (const nombre of [g.proveedor ?? "", g.concepto]) {
      const k = normalizar(nombre);
      if (k && !m.has(k)) m.set(k, g.categoria);
    }
  }
  return m;
}

/** Las claves de los gastos que ya están cargados (el monto en la moneda en que se pagó): para no cargar dos veces la misma planilla. */
export function clavesCargadas(e: Pick<EstadoApp, "gastos">): Set<string> {
  const s = new Set<string>();
  for (const g of e.gastos) {
    const dia = diaDeNegocio(fechaDePago(g));
    const orig = montoOriginal(g);
    s.add(clave(dia, orig ? orig.monto : g.monto, g.concepto));
  }
  return s;
}

/** Las filas de lo pegado, ya leídas, con categoría y proveedor propuestos y marcadas las que ya estaban cargadas. */
export function armarFilas(tabla: string[][], mapa: (CampoMasivo | null)[], conTitulos: boolean, c: ContextoMasivo): FilaMasiva[] {
  const { e } = c;
  const hoy = c.hoy ?? new Date();
  const base = c.moneda ?? e.ajustes.monedaBase;
  const ya = clavesCargadas(e);
  const categorias = [...catalogoDe(e).values()];
  const dePrevio = categoriasPorNombre(e);
  const celda = (fila: string[], campo: CampoMasivo) => {
    const i = mapa.indexOf(campo);
    return i >= 0 ? (fila[i] ?? "").trim() : "";
  };
  const datos = conTitulos ? tabla.slice(1) : tabla;
  return datos.map((fila, n) => {
    const concepto = celda(fila, "concepto");
    const leido = leerMontoPegado(celda(fila, "monto"));
    const fecha = leerFecha(celda(fila, "fecha"), hoy) ?? "";
    const dicho = normalizar(celda(fila, "categoria"));
    const dePlanilla = dicho ? categorias.find((k) => normalizar(k.categoria) === dicho) : undefined;
    const proveedorDicho = celda(fila, "proveedor");
    const categoria = dePlanilla?.categoria ?? sugerirCategoria(concepto, e)?.categoria
      ?? dePrevio.get(normalizar(proveedorDicho || concepto)) ?? dePrevio.get(normalizar(concepto)) ?? "";
    const monedaDicha = normalizar(celda(fila, "moneda"));
    const moneda: Moneda = /\b(ars|pesos?)\b/.test(monedaDicha) ? "ARS" : /\b(usd|us|dolar(es)?)\b/.test(monedaDicha) ? "USD" : leido?.moneda ?? base;
    const monto = leido ? leido.monto : NaN;
    const f: FilaMasiva = {
      id: `f${n + 1}`,
      incluir: true,
      fecha, concepto,
      proveedor: celda(fila, "proveedor") || concepto,
      categoria,
      monto: Number.isFinite(monto) ? escribirMonto(Math.abs(monto)) : celda(fila, "monto"),
      moneda,
      cuenta: celda(fila, "cuenta") || c.cuenta || "",
      notas: celda(fila, "notas"),
      ingreso: Number.isFinite(monto) && monto < 0,
      yaCargada: false,
    };
    f.yaCargada = Boolean(fecha) && Number.isFinite(monto) && ya.has(clave(fecha, monto, concepto));
    f.incluir = !f.yaCargada;
    return f;
  });
}

/* ---------- Lo que falta para poder cargarlas ---------- */

const borradorDe = (f: FilaMasiva, e: EstadoApp, cat: Catalogo): BorradorGasto => ({
  concepto: f.concepto, categoria: f.categoria, grupo: cat.get(f.categoria)?.grupo ?? ("operativo" as GrupoGasto),
  categoriaElegida: true, nueva: false,
  monto: f.monto, moneda: f.moneda, tipoCambio: tipoCambioDeAjustes(e.ajustes),
  fecha: f.fecha ? `${f.fecha}T15:00:00.000Z` : "", fechaPago: "", recurrente: false,
  proveedor: f.proveedor, webinarId: "", embudoId: "", notas: f.notas, ingreso: f.ingreso, cuenta: f.cuenta,
});

/** Lo que está mal de una fila, campo por campo (vacío si se puede cargar). Una categoría que no existe también cuenta. */
export function problemasDeFila(f: FilaMasiva, e: EstadoApp, cat: Catalogo = catalogoDe(e)): ProblemasGasto {
  const p = problemasDelGasto(borradorDe(f, e, cat), e.ajustes.monedaBase);
  if (!f.fecha) p.fecha = "Poné la fecha";
  if (f.categoria && !cat.has(f.categoria)) p.categoria = "Esa categoría no existe";
  return p;
}

/** ¿Ya hay un gasto igual (mismo día, monto y concepto) a como está la fila ahora? Se mira de nuevo al editarla. */
export function yaEstaCargada(f: Pick<FilaMasiva, "fecha" | "monto" | "concepto">, cargadas: ReadonlySet<string>): boolean {
  const n = leerMonto(f.monto);
  return Boolean(f.fecha) && Number.isFinite(n) && cargadas.has(clave(f.fecha, n, f.concepto));
}

export interface ResumenMasivo {
  filas: number;
  aCargar: number;
  yaCargadas: number;
  conProblemas: number;
  /* Lo que se va a cargar, en la moneda base: los gastos, y aparte lo que volvió (ingresos). */
  gastosTotal: number;
  ingresosTotal: number;
  /* Gastos menos ingresos. */
  total: number;
  ingresos: number;
}

export function resumenDeFilas(filas: readonly FilaMasiva[], e: EstadoApp, cat: Catalogo = catalogoDe(e)): ResumenMasivo {
  const base = e.ajustes.monedaBase;
  const tc = e.ajustes.tipoCambio;
  let aCargar = 0, yaCargadas = 0, conProblemas = 0, gastosTotal = 0, ingresosTotal = 0, ingresos = 0;
  for (const f of filas) {
    if (f.yaCargada && !f.incluir) { yaCargadas++; continue; }
    if (!f.incluir) continue;
    if (Object.keys(problemasDeFila(f, e, cat)).length) { conProblemas++; continue; }
    aCargar++;
    const n = aMonedaBase(Math.abs(leerMonto(f.monto)), f.moneda, base, tc);
    if (f.ingreso) { ingresosTotal += n; ingresos++; } else gastosTotal += n;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { filas: filas.length, aCargar, yaCargadas, conProblemas, gastosTotal: r2(gastosTotal), ingresosTotal: r2(ingresosTotal), total: r2(gastosTotal - ingresosTotal), ingresos };
}

/** Los gastos listos para guardar: sólo las filas marcadas y sin problemas. Todos llevan `extra.cargaMasiva` con el lote, para poder
 *  deshacer la carga entera. */
export function gastosDeFilas(filas: readonly FilaMasiva[], e: EstadoApp, loteId: string, ahora: string = new Date().toISOString()): Omit<Gasto, "id">[] {
  const base = e.ajustes.monedaBase;
  const opciones = opcionesProveedor(e);
  const cat = catalogoDe(e);
  const salida: Omit<Gasto, "id">[] = [];
  for (const f of filas) {
    if (!f.incluir || Object.keys(problemasDeFila(f, e, cat)).length) continue;
    const datos = datosDelGasto(borradorDe(f, e, cat), { base, opciones, ahora });
    salida.push({ ...datos, extra: { ...datos.extra, cargaMasiva: loteId } });
  }
  return salida;
}
