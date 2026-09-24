import type { EstadoApp, ID, Pago, Procesador } from "./types";
import { CODIGO_MACRO, bancoDeCbu, limpiarCbu, validarCbu } from "./cbu";
import {
  escribirXlsx, letraDeColumna, refCelda, serialDeDia,
  type Borde, type Celda, type ColumnaHoja, type EstiloCelda, type HojaXlsx,
} from "./xlsxEscribir";
import { nube } from "./supabase";
import { BUCKET_COMPROBANTES } from "./comprobantes";

/* ==================================================================
   El corte para la Financiera.

   Los clientes que pagan en pesos le transfieren a la Financiera, que
   los pasa a dólares. Cada tanto se le manda el "corte": las
   transferencias de un período, para que las encuentre y liquide.

   Sale con el formato de las hojas "Cortes Financiera" (pesos) y
   "Corte Financiera USD" (la misma, con la columna Closer) del Excel
   de finanzas: la leyenda de colores arriba, los tres bloques con su
   título y, a la derecha, las cuentas a las que se transfiere. Todo va
   en el bloque de la Financiera; Mastermind y Expansión 3.0 quedan con
   su título y sus encabezados, sin filas y ocultos, como en la planilla.

   Lo único nuevo es la columna CVU: el CBU/CVU desde el que transfirió
   el cliente, que es con lo que la Financiera encuentra la plata. El
   banco sale de sus tres primeros números.
   ================================================================== */

export type FormatoCorte = "ARS" | "USD";

/** Los colores de la leyenda de la planilla: pintan la fila entera. */
export const COLOR_FALTA_INFO = "F6B26B";
export const COLOR_COMPLETO_MAL = "A4C2F4";
export const COLOR_MACRO = "DD7E6B";

/** Cuánto dura el link de un comprobante guardado en la nube. */
export const DIAS_LINK_COMPROBANTE = 30;

export interface FilaCorte {
  pagoId: ID;
  /** El día en Argentina, "aaaa-mm-dd". */
  dia: string;
  /** Quién transfirió; si no se cargó, el cliente de la venta. */
  nombre: string;
  cuit: string;
  cvu: string;
  montoArs?: number;
  montoUsd: number;
  banco: string;
  /** Lo que va en la celda: el link que se cargó, el archivo guardado en
   *  la nube (se firma al bajar el Excel) o lo que se escribió. */
  comprobante: { texto: string; url?: string; ruta?: string };
  verificado: boolean;
  /** El servicio de la venta. */
  unidad: string;
  closer: string;
  /** Lo que le falta para que la Financiera la encuentre ("el CUIT"). */
  faltan: string[];
  macro: boolean;
}

export interface Corte {
  procesador: Procesador;
  formato: FormatoCorte;
  /** Días de Argentina, "aaaa-mm-dd", los dos incluidos. */
  desde: string;
  hasta: string;
  filas: FilaCorte[];
}

/** El día del negocio (Argentina, UTC−3) de una fecha guardada. Una fecha
 *  sin hora queda como está. */
export function diaArgentina(fecha: string): string {
  if (!fecha) return "";
  if (fecha.length <= 10) return fecha.slice(0, 10);
  const t = new Date(fecha).getTime();
  if (Number.isNaN(t)) return fecha.slice(0, 10);
  return new Date(t - 3 * 3600000).toISOString().slice(0, 10);
}

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const redondear = (n: number) => Math.round(n * 100) / 100;

export const formatoDeCuenta = (p: Procesador): FormatoCorte => (p.moneda === "ARS" ? "ARS" : "USD");

/** Las cuentas que tienen corte: las que se llaman Financiera y las que
 *  tienen cuentas bancarias cargadas. Las activas primero. */
export function cuentasConCorte(e: EstadoApp): Procesador[] {
  return e.procesadores
    .filter((p) => sinAcentos(p.nombre).includes("financiera") || (p.cuentasBancarias?.length ?? 0) > 0)
    .sort((a, b) => Number(b.activo) - Number(a.activo));
}

/** La que se elige sola: la Financiera en pesos. */
export function cuentaPorDefecto(cuentas: Procesador[]): Procesador | undefined {
  return cuentas.find((p) => p.id === "proc_financiera_ars")
    ?? cuentas.find((p) => p.moneda === "ARS" && sinAcentos(p.nombre).includes("financiera"))
    ?? cuentas[0];
}

function comprobanteDe(p: Pago): FilaCorte["comprobante"] {
  const escrito = p.comprobanteLink?.trim() ?? "";
  const url = /https?:\/\/[^\s<>"']+/i.exec(escrito)?.[0];
  if (url) return { texto: escrito, url };
  if (p.comprobante) {
    /* Sin nube el archivo vive en el navegador: no hay link para mandar. */
    if (p.comprobante.ruta.startsWith("data:")) return { texto: p.comprobante.nombre };
    return { texto: p.comprobante.nombre, ruta: p.comprobante.ruta };
  }
  return { texto: escrito };
}

/** Las transferencias que entraron a una cuenta entre dos días de
 *  Argentina (los dos incluidos), de la más vieja a la más nueva. */
export function corteFinanciera(e: EstadoApp, procesadorId: ID, desde: string, hasta: string): Corte {
  const procesador = e.procesadores.find((p) => p.id === procesadorId);
  if (!procesador) throw new Error("Esa cuenta recaudadora ya no existe.");
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  const servicioDe = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
  const personaDe = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));

  const filas = e.pagos
    .filter((p) => p.procesadorId === procesadorId)
    .map((p) => ({ p, dia: diaArgentina(p.fecha) }))
    .filter(({ dia }) => dia >= desde && dia <= hasta)
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.p.fecha.localeCompare(b.p.fecha) || a.p.creadoEn.localeCompare(b.p.creadoEn))
    .map(({ p, dia }): FilaCorte => {
      const cuota = cuotaDe.get(p.cuotaId);
      const venta = cuota ? ventaDe.get(cuota.ventaId) : undefined;
      const cvu = p.cvu?.trim() ?? "";
      const cvuValido = validarCbu(cvu);
      const comprobante = comprobanteDe(p);
      const faltan: string[] = [];
      if (!p.pagador?.trim()) faltan.push("el nombre de quien transfirió");
      if (!p.cuit?.trim()) faltan.push("el CUIT");
      if (!cvu) faltan.push("el CBU/CVU");
      else if (!cvuValido) faltan.push("un CBU/CVU válido");
      if (!comprobante.url && !p.comprobante) faltan.push("el comprobante");
      const ars = p.montoArs ? p.montoArs : p.tipoCambio ? p.monto * p.tipoCambio : undefined;
      return {
        pagoId: p.id,
        dia,
        nombre: p.pagador?.trim() || venta?.contactoNombre || "",
        cuit: p.cuit?.trim() ?? "",
        cvu: cvuValido ? limpiarCbu(cvu) : cvu,
        montoArs: ars === undefined ? undefined : redondear(ars),
        montoUsd: redondear(p.monto),
        banco: bancoDeCbu(cvu),
        comprobante,
        verificado: Boolean(p.chequeado),
        unidad: (venta?.productoId && servicioDe.get(venta.productoId)) || "",
        closer: (venta?.closerId && personaDe.get(venta.closerId)) || "",
        faltan,
        macro: limpiarCbu(cvu).startsWith(CODIGO_MACRO),
      };
    });

  return { procesador, formato: formatoDeCuenta(procesador), desde, hasta, filas };
}

/** Lo que se muestra antes de bajarlo. */
export function resumenCorte(c: Corte) {
  return {
    transferencias: c.filas.length,
    incompletas: c.filas.filter((f) => f.faltan.length > 0),
    macro: c.filas.filter((f) => f.macro && f.faltan.length === 0).length,
    totalArs: redondear(c.filas.reduce((s, f) => s + (f.montoArs ?? 0), 0)),
    totalUsd: redondear(c.filas.reduce((s, f) => s + f.montoUsd, 0)),
  };
}

/** "Corte Financiera ARS 01-09-2026 a 23-09-2026.xlsx". */
export function nombreArchivoCorte(c: Corte): string {
  const dma = (dia: string) => dia.split("-").reverse().join("-");
  return `Corte Financiera ${c.formato} ${dma(c.desde)} a ${dma(c.hasta)}.xlsx`;
}

/* ---------- La hoja, con el formato de la planilla ---------- */

const FINO: Borde = "thin";
const MEDIO: Borde = "medium";
const TODO_FINO = { izquierda: FINO, derecha: FINO, arriba: FINO, abajo: FINO };
const CENTRO = { horizontal: "center", vertical: "center" } as const;
const PESOS = '"$"#,##0.00';

const BLANCO: EstiloCelda = { relleno: "FFFFFF" };
const TITULO: EstiloCelda = {
  fuente: { nombre: "Montserrat", tamanio: 20, negrita: true, color: "FFFFFF" }, relleno: "674EA7", alineacion: CENTRO,
};
const cabecera = (bordes: EstiloCelda["bordes"], alineacion: EstiloCelda["alineacion"] = CENTRO): EstiloCelda => ({
  fuente: { nombre: "Calibri", tamanio: 11, negrita: true, color: "FFFFFF" }, relleno: "8E7CC3", bordes, alineacion,
});
const dato = (extra: EstiloCelda = {}): EstiloCelda => ({
  fuente: { nombre: "Montserrat", tamanio: 10 }, bordes: TODO_FINO, alineacion: CENTRO, ...extra,
});

const LEYENDA: [string, string][] = [
  ["Falta información", COLOR_FALTA_INFO],
  ['Completó mal en "varios", % impuestos', COLOR_COMPLETO_MAL],
  ["Banco Macro", COLOR_MACRO],
];

/* Los otros dos bloques: [encabezado, ancho (sin ancho, el de siempre), bordes]. */
type ColumnaVacia = [string, number | undefined, EstiloCelda["bordes"]];
const MASTERMIND: { titulo: string; columnas: ColumnaVacia[] } = {
  titulo: "TRANSFERENCIAS MASTERMIND",
  columnas: [
    ["Fecha", 14.5, { izquierda: MEDIO, derecha: FINO }],
    ["Nombre quien transfiere", 26.38, { izquierda: MEDIO, derecha: FINO }],
    ["Cuit", undefined, { derecha: FINO }],
    ["Monto ARS", 18.88, { derecha: FINO }],
    ["Monto USD", 18.88, { derecha: FINO }],
    ["Comprobante", 54.75, { derecha: FINO }],
    ["Banco", 19, { derecha: FINO }],
    ["Pago Verificado", 14.63, undefined],
    ["Unidad de Negocio", 18.13, TODO_FINO],
  ],
};
const EXPANSION: { titulo: string; columnas: ColumnaVacia[] } = {
  titulo: "TRANSFERENCIAS EXPANSIÓN 3.0",
  columnas: [
    ["Fecha", 14.5, { izquierda: MEDIO, derecha: FINO }],
    ["Nombre quien transfiere", 26.38, { izquierda: MEDIO, derecha: FINO }],
    ["Cuit", undefined, { derecha: FINO }],
    ["Monto ARS", undefined, { derecha: FINO }],
    ["Monto USD", undefined, { derecha: FINO }],
    ["Comprobante", 53.13, { derecha: FINO }],
    ["Banco", 22.38, { derecha: FINO }],
    ["Pago Verificado", 18.25, { derecha: MEDIO }],
  ],
};

/* La tabla de la derecha: las cuentas de la Financiera. */
const TABLA: [string, number][] = [
  ["Nombre", 21.25], ["Banco", 17.88], ["N° de cuenta", 22.75], ["ALIAS", 27], ["CBU/CVU", 27], ["CUIT", 15.38],
];
const tablaCabecera = (i: number): EstiloCelda => ({
  fuente: { nombre: "Calibri", tamanio: 20 }, relleno: "F2F2F2", alineacion: { horizontal: "center", vertical: "bottom" },
  bordes: i === 0 ? { izquierda: MEDIO, derecha: MEDIO, arriba: MEDIO } : { arriba: MEDIO, abajo: FINO },
});
const tablaDato = (i: number): EstiloCelda => ({
  fuente: { nombre: "Calibri", tamanio: 14 }, relleno: "C5E0B3", alineacion: { horizontal: "center", vertical: "bottom" },
  bordes: i === 0 ? TODO_FINO : { derecha: FINO, abajo: FINO },
  ...(i === 3 || i === 4 ? { formato: "@" } : {}),
});

interface ColumnaFinanciera {
  titulo: string;
  ancho: number;
  estilo: EstiloCelda;
  celda: (f: FilaCorte) => { valor?: Celda["valor"]; enlace?: string };
}

function columnasFinanciera(usd: boolean, links: Map<string, string>): ColumnaFinanciera[] {
  const columnas: ColumnaFinanciera[] = [
    { titulo: "Fecha", ancho: 14.25, estilo: dato({ formato: "d/M/yyyy" }), celda: (f) => ({ valor: serialDeDia(f.dia) }) },
    { titulo: "Nombre de quien transfiere", ancho: 34.63, estilo: dato(), celda: (f) => ({ valor: f.nombre }) },
    { titulo: "Cuit", ancho: 14.5, estilo: dato(), celda: (f) => ({ valor: f.cuit }) },
    { titulo: "CVU", ancho: 26.38, estilo: dato({ formato: "@" }), celda: (f) => ({ valor: f.cvu }) },
    { titulo: "Transferencia ARS", ancho: 18.88, estilo: dato({ formato: PESOS }), celda: (f) => ({ valor: f.montoArs }) },
    { titulo: "Transferencia USD", ancho: 18.88, estilo: dato({ formato: PESOS }), celda: (f) => ({ valor: f.montoUsd }) },
    { titulo: "Banco", ancho: 23.88, estilo: dato(), celda: (f) => ({ valor: f.banco }) },
    {
      titulo: "Comprobante", ancho: 66.38, estilo: dato({ alineacion: { horizontal: "left", vertical: "center" } }),
      celda: (f) => {
        const firmado = f.comprobante.ruta ? links.get(f.comprobante.ruta) : undefined;
        return { valor: firmado ?? f.comprobante.texto, enlace: firmado ?? f.comprobante.url };
      },
    },
    { titulo: "Pago Verificado", ancho: 16.25, estilo: dato({ fuente: { nombre: "Montserrat", tamanio: 12 } }), celda: (f) => ({ valor: f.verificado }) },
    {
      titulo: "Unidad de Negocio", ancho: 19.25,
      estilo: { bordes: { izquierda: FINO, derecha: FINO, abajo: FINO }, alineacion: CENTRO },
      celda: (f) => ({ valor: f.unidad }),
    },
  ];
  if (usd) columnas.push({ titulo: "Closer", ancho: 19.25, estilo: dato(), celda: (f) => ({ valor: f.closer }) });
  return columnas;
}

/* Los encabezados del bloque de la Financiera, con los bordes de cada hoja. */
function cabeceraFinanciera(titulo: string, usd: boolean): EstiloCelda {
  if (titulo === "Closer") return cabecera({ izquierda: FINO, derecha: FINO }, { horizontal: "center" });
  if (titulo === "Unidad de Negocio") return cabecera({ izquierda: FINO, derecha: FINO, abajo: FINO }, { horizontal: "center" });
  return cabecera(usd ? { izquierda: FINO, derecha: FINO, abajo: FINO } : TODO_FINO);
}

/** La hoja del corte. `links` son los comprobantes de la nube ya firmados,
 *  por ruta; los que no están salen con el nombre del archivo. */
export function hojaCorte(c: Corte, links: Map<string, string> = new Map()): HojaXlsx {
  const usd = c.formato === "USD";
  const celdas: Celda[] = [];
  const combinadas: string[] = [];
  const poner = (fila: number, columna: number, valor?: Celda["valor"], estilo?: EstiloCelda, enlace?: string) => {
    celdas.push({ fila, columna, valor, estilo, enlace });
  };
  /* El título de un bloque ocupa la fila 8 de punta a punta. */
  const titulo = (desde: number, hasta: number, texto: string, abajo: Borde) => {
    poner(8, desde, texto, { ...TITULO, bordes: { izquierda: MEDIO, arriba: MEDIO, abajo } });
    for (let col = desde + 1; col < hasta; col++) poner(8, col, undefined, { bordes: { arriba: MEDIO, abajo } });
    poner(8, hasta, undefined, { bordes: { derecha: MEDIO, arriba: MEDIO, abajo } });
    combinadas.push(`${refCelda(8, desde)}:${refCelda(8, hasta)}`);
  };

  /* Dónde cae cada cosa: la columna A de margen, el bloque de la
     Financiera desde la B, una columna vacía entre bloques y dos antes
     de la tabla de cuentas. */
  const financiera = columnasFinanciera(usd, links);
  const fin1 = 1 + financiera.length;
  const ini2 = fin1 + 2;
  const ini3 = ini2 + MASTERMIND.columnas.length + 1;
  const iniTabla = ini3 + EXPANSION.columnas.length + 2;
  const n = c.filas.length;
  const cuentas = c.procesador.cuentasBancarias ?? [];

  /* La columna A va blanca, sin cuadrícula, como en la planilla. */
  for (let f = 1; f <= Math.max(9 + n, 8 + cuentas.length); f++) poner(f, 1, undefined, BLANCO);

  LEYENDA.forEach(([texto, color], i) => {
    poner(4 + i, 3, texto);
    poner(4 + i, 4, undefined, { relleno: color });
  });

  titulo(2, fin1, "TRANSFERENCIAS EN PESOS Y EN DÓLARES FINANCIERA", usd ? MEDIO : FINO);
  financiera.forEach((col, i) => poner(9, 2 + i, col.titulo, cabeceraFinanciera(col.titulo, usd)));
  c.filas.forEach((f, k) => {
    /* Falta información manda sobre Banco Macro: es lo que hay que arreglar. */
    const color = f.faltan.length ? COLOR_FALTA_INFO : f.macro ? COLOR_MACRO : undefined;
    financiera.forEach((col, i) => {
      const { valor, enlace } = col.celda(f);
      poner(10 + k, 2 + i, valor, color ? { ...col.estilo, relleno: color } : col.estilo, enlace);
    });
  });

  for (const [ini, bloque] of [[ini2, MASTERMIND], [ini3, EXPANSION]] as const) {
    titulo(ini, ini + bloque.columnas.length - 1, bloque.titulo, FINO);
    bloque.columnas.forEach(([texto, , bordes], i) => poner(9, ini + i, texto, cabecera(bordes)));
  }

  TABLA.forEach(([texto], i) => poner(8, iniTabla + i, texto, tablaCabecera(i)));
  cuentas.forEach((cb, k) => {
    [cb.titular, cb.banco, cb.numero, cb.alias, limpiarCbu(cb.cbu), cb.cuit]
      .forEach((v, i) => poner(9 + k, iniTabla + i, v, tablaDato(i)));
  });

  const columnas: ColumnaHoja[] = [
    { desde: 1, ancho: 11.13, estilo: BLANCO },
    ...financiera.map((col, i) => ({ desde: 2 + i, ancho: col.ancho })),
    /* Mastermind y Expansión 3.0 van ocultos, como en la planilla. */
    ...MASTERMIND.columnas.map(([, ancho], i) => ({ desde: ini2 + i, ancho, oculta: true })),
    { desde: ini3 - 1, oculta: true },
    ...EXPANSION.columnas.map(([, ancho], i) => ({ desde: ini3 + i, ancho, oculta: true })),
    ...TABLA.map(([, ancho], i) => ({ desde: iniTabla + i, ancho })),
  ];

  /* La planilla no fija altos: Google Sheets agranda solo las filas con
     letra grande. Excel no, así que se fijan acá. */
  const altos: Record<number, number> = { 8: 30 };
  cuentas.forEach((_, k) => { altos[9 + k] = 18.75; });

  const texto: string[] = [];
  if (n) texto.push(`D10:E${9 + n}`);
  if (cuentas.length) texto.push(`${letraDeColumna(iniTabla + 2)}9:${letraDeColumna(iniTabla + 5)}${8 + cuentas.length}`);

  return {
    nombre: usd ? "Corte Financiera USD" : "Cortes Financiera",
    celdas, columnas, altos, combinadas,
    /* Sólo la de pesos tiene filtro en la planilla. */
    filtro: usd ? undefined : `B9:${letraDeColumna(fin1)}${9 + n}`,
    numerosComoTexto: texto,
    colorPestania: "7F6000",
    anchoPorDefecto: 12.63,
    altoPorDefecto: 15.75,
  };
}

/* ---------- Bajarlo ---------- */

/** Los links firmados de los comprobantes guardados en la nube, pedidos de
 *  a cien. El bucket es privado: sin firma nadie de afuera los abre, y con
 *  la firma cualquiera que tenga el link, hasta que vence. */
export async function linksDeComprobantes(rutas: string[]): Promise<Map<string, string>> {
  const links = new Map<string, string>();
  const pendientes = [...new Set(rutas)].filter((r) => r && !r.startsWith("data:"));
  if (!nube || pendientes.length === 0) return links;
  for (let i = 0; i < pendientes.length; i += 100) {
    const lote = pendientes.slice(i, i + 100);
    const { data, error } = await nube.storage.from(BUCKET_COMPROBANTES)
      .createSignedUrls(lote, DIAS_LINK_COMPROBANTE * 86400);
    if (error || !data) continue;
    data.forEach((x, k) => {
      if (x.signedUrl && !x.error) links.set(x.path ?? lote[k], x.signedUrl);
    });
  }
  return links;
}

/** El Excel del corte, con los comprobantes de la nube firmados por 30 días.
 *  `sinLink` cuenta los que no se pudieron firmar: van con el nombre del archivo. */
export async function excelCorte(c: Corte): Promise<{ nombre: string; datos: Uint8Array<ArrayBuffer>; sinLink: number }> {
  const rutas = c.filas.flatMap((f) => (f.comprobante.ruta ? [f.comprobante.ruta] : []));
  const links = await linksDeComprobantes(rutas);
  const datos = await escribirXlsx({ hojas: [hojaCorte(c, links)] });
  return { nombre: nombreArchivoCorte(c), datos, sinLink: rutas.filter((r) => !links.has(r)).length };
}
