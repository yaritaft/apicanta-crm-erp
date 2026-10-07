import { refCelda, serialDeDia, type Celda, type ColumnaHoja, type EstiloCelda, type HojaXlsx } from "./xlsxEscribir";

/* ==================================================================
   Una tabla declarativa → una hoja de Excel con el estilo de la app.

   Los informes (el del webinar, los que vengan) no arman celdas a mano:
   declaran sus columnas (título, ancho, formato y cómo sacar el valor de
   cada fila) y esto las vuelve una hoja con título, bloques de resumen,
   encabezado con filtro, formatos de número y fecha y fila de totales.
   Para cambiar un informe se toca la lista de columnas, no el dibujo.

   Las fechas van como número de Excel (no como texto) para que se puedan
   ordenar y filtrar; los porcentajes, como fracción con formato %.
   ================================================================== */

export type Valor = string | number | boolean | null | undefined;

export type FormatoColumna = "texto" | "entero" | "decimal" | "moneda" | "porcentaje" | "fecha" | "fechaHora" | "si-no";

export interface ColumnaTabla<F> {
  titulo: string;
  /* En caracteres, como el ancho de Excel. */
  ancho?: number;
  formato?: FormatoColumna;
  valor: (fila: F) => Valor;
  /* Un link que se abre al tocar la celda. */
  enlace?: (fila: F) => string | undefined;
  /* El total de la columna: qué poner en la fila de totales. */
  total?: (filas: F[]) => Valor;
}

/* Un bloque de «etiqueta → valor → cómo se calcula», arriba de la tabla. */
export interface BloqueResumen {
  titulo: string;
  filas: { etiqueta: string; valor: Valor; formato?: FormatoColumna; nota?: string }[];
}

export interface TablaInforme<F> {
  /* El nombre de la pestaña: hasta 31 caracteres, sin : \ / ? * [ ]. */
  nombre: string;
  titulo: string;
  subtitulo?: string;
  bloques?: BloqueResumen[];
  columnas: ColumnaTabla<F>[];
  filas: F[];
  /* Si hay filas vacías: qué decir en vez de una tabla sin nada. */
  sinFilas?: string;
  /* La etiqueta de la fila de totales (la primera columna); sin esto no hay fila. */
  etiquetaTotal?: string;
  colorPestania?: string;
}

const COLOR_MARCA = "3B3A8F";
const COLOR_FONDO_TOTAL = "EDEBFA";
const COLOR_BORDE = "D0D0D8";

const FUENTE = { nombre: "Arial", tamanio: 10 };
const BORDE = { izquierda: "thin", derecha: "thin", arriba: "thin", abajo: "thin", color: COLOR_BORDE } as const;

/* El formato de número o fecha de Excel de cada tipo de columna. */
export const FORMATO_EXCEL: Record<FormatoColumna, string | undefined> = {
  texto: undefined,
  entero: "#,##0",
  decimal: "#,##0.00",
  moneda: '"US$ "#,##0.00',
  porcentaje: "0.0%",
  fecha: "d/M/yyyy",
  fechaHora: "d/M/yyyy h:mm",
  "si-no": undefined,
};

const DERECHA: EstiloCelda["alineacion"] = { horizontal: "right", vertical: "center" };
const IZQUIERDA: EstiloCelda["alineacion"] = { horizontal: "left", vertical: "center" };
const CENTRO: EstiloCelda["alineacion"] = { horizontal: "center", vertical: "center" };

/** El instante como número de Excel, en hora de Argentina (UTC−3, el día de
 *  negocio del equipo): la parte entera es el día y la decimal, la hora. */
export function serialDeInstante(iso?: string | null): number | undefined {
  if (!iso) return undefined;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return undefined;
  const ar = new Date(t - 3 * 3600000);
  const dia = ar.toISOString().slice(0, 10);
  const minutos = ar.getUTCHours() * 60 + ar.getUTCMinutes();
  return serialDeDia(dia) + minutos / 1440;
}

/** El valor de una celda, listo para el Excel según su formato. */
export function valorParaExcel(v: Valor, formato: FormatoColumna = "texto"): Celda["valor"] {
  if (v === null || v === undefined || v === "") return undefined;
  if (formato === "fecha") {
    if (typeof v === "number") return v;
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? serialDeDia(s) : Math.floor(serialDeInstante(s) ?? NaN) || s;
  }
  if (formato === "fechaHora") return typeof v === "number" ? v : serialDeInstante(String(v)) ?? String(v);
  if (formato === "si-no") return v === true ? "Sí" : v === false ? "No" : String(v);
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  return v;
}

const alineacionDe = (f: FormatoColumna): EstiloCelda["alineacion"] =>
  f === "texto" ? { ...IZQUIERDA, ajustar: false } : f === "si-no" ? CENTRO : f === "fecha" || f === "fechaHora" ? CENTRO : DERECHA;

/** La hoja de una tabla. */
export function hojaDeTabla<F>(t: TablaInforme<F>): HojaXlsx {
  const celdas: Celda[] = [];
  const poner = (fila: number, columna: number, valor: Celda["valor"], estilo?: EstiloCelda, enlace?: string) => {
    celdas.push({ fila, columna, valor, estilo, enlace });
  };
  const altos: Record<number, number> = {};
  let fila = 1;

  poner(fila, 1, t.titulo, { fuente: { ...FUENTE, tamanio: 14, negrita: true, color: COLOR_MARCA } });
  altos[fila] = 22;
  fila++;
  if (t.subtitulo) { poner(fila, 1, t.subtitulo, { fuente: { ...FUENTE, color: "666666", cursiva: true } }); fila++; }
  fila++;

  for (const b of t.bloques ?? []) {
    poner(fila, 1, b.titulo, { fuente: { ...FUENTE, negrita: true, color: "FFFFFF" }, relleno: COLOR_MARCA, alineacion: IZQUIERDA });
    poner(fila, 2, undefined, { relleno: COLOR_MARCA });
    if (b.filas.some((x) => x.nota)) poner(fila, 3, "Cómo se calcula", { fuente: { ...FUENTE, negrita: true, color: "FFFFFF" }, relleno: COLOR_MARCA, alineacion: IZQUIERDA });
    fila++;
    for (const x of b.filas) {
      const f = x.formato ?? "texto";
      poner(fila, 1, x.etiqueta, { fuente: FUENTE, bordes: BORDE, alineacion: IZQUIERDA });
      poner(fila, 2, valorParaExcel(x.valor, f), {
        fuente: { ...FUENTE, negrita: true }, bordes: BORDE, alineacion: f === "texto" ? IZQUIERDA : DERECHA, formato: FORMATO_EXCEL[f],
      });
      if (x.nota) poner(fila, 3, x.nota, { fuente: { ...FUENTE, color: "666666" }, alineacion: IZQUIERDA });
      fila++;
    }
    fila++;
  }

  const cab = fila;
  t.columnas.forEach((c, i) => poner(cab, i + 1, c.titulo, {
    fuente: { ...FUENTE, negrita: true, color: "FFFFFF" }, relleno: COLOR_MARCA, bordes: BORDE,
    alineacion: { horizontal: "center", vertical: "center", ajustar: true },
  }));
  altos[cab] = 32;

  t.filas.forEach((registro, k) => {
    const r = cab + 1 + k;
    t.columnas.forEach((c, i) => {
      const f = c.formato ?? "texto";
      poner(r, i + 1, valorParaExcel(c.valor(registro), f), {
        fuente: FUENTE, bordes: BORDE, alineacion: alineacionDe(f), formato: FORMATO_EXCEL[f],
      }, c.enlace?.(registro));
    });
  });

  let ultima = cab + t.filas.length;
  if (t.filas.length === 0 && t.sinFilas) {
    poner(cab + 1, 1, t.sinFilas, { fuente: { ...FUENTE, cursiva: true, color: "666666" }, alineacion: IZQUIERDA });
    ultima = cab + 1;
  } else if (t.etiquetaTotal && t.filas.length > 0) {
    const r = ultima + 1;
    t.columnas.forEach((c, i) => {
      const f = c.formato ?? "texto";
      const v = i === 0 ? t.etiquetaTotal : c.total?.(t.filas);
      poner(r, i + 1, i === 0 ? v : valorParaExcel(v, f), {
        fuente: { ...FUENTE, negrita: true }, relleno: COLOR_FONDO_TOTAL, bordes: BORDE,
        alineacion: i === 0 ? IZQUIERDA : alineacionDe(f), formato: FORMATO_EXCEL[f],
      });
    });
    ultima = r;
  }

  const columnas: ColumnaHoja[] = t.columnas.map((c, i) => ({ desde: i + 1, ancho: c.ancho ?? 16 }));
  return {
    nombre: t.nombre.slice(0, 31),
    celdas, columnas, altos,
    /* El filtro sólo sobre los datos, sin la fila de totales. */
    filtro: t.filas.length > 0 ? `${refCelda(cab, 1)}:${refCelda(cab + t.filas.length, t.columnas.length)}` : undefined,
    colorPestania: t.colorPestania,
  };
}
