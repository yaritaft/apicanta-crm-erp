import { escribirXlsx, letraDeColumna, serialDeDia, type Celda, type ColumnaHoja, type EstiloCelda, type HojaXlsx } from "./xlsxEscribir";

/* ==================================================================
   Una tabla de Customer Success (Clientes, Testimonios, Resells) en un Excel:
   lo que se ve, con los filtros puestos y en el orden elegido. Los títulos
   van en la primera fila, con filtro, para subirla o trabajarla tal cual.
   ================================================================== */

export interface ColumnaExcelCs<F> {
  titulo: string;
  /* En caracteres, como el ancho que muestra Excel. */
  ancho: number;
  tipo: "texto" | "numero" | "fecha";
  /* El valor: un texto, un número o un día «aaaa-mm-dd» (si es de fecha). */
  celda: (f: F) => string | number | null;
}

const FINO = "thin" as const;
const BORDES = { izquierda: FINO, derecha: FINO, arriba: FINO, abajo: FINO, color: "D0D0D0" };
const CABECERA: EstiloCelda = {
  fuente: { nombre: "Calibri", tamanio: 11, negrita: true, color: "FFFFFF" }, relleno: "674EA7", bordes: BORDES,
  alineacion: { horizontal: "center", vertical: "center", ajustar: true },
};
const DATO = (extra: EstiloCelda = {}): EstiloCelda => ({
  fuente: { nombre: "Calibri", tamanio: 11 }, bordes: BORDES, alineacion: { vertical: "center" }, ...extra,
});

/* El nombre de una hoja: hasta 31 caracteres y sin : \ / ? * [ ]. */
const nombreDeHoja = (n: string) => n.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Hoja";

export function hojaDeTabla<F>(nombre: string, columnas: readonly ColumnaExcelCs<F>[], filas: readonly F[]): HojaXlsx {
  const celdas: Celda[] = [];
  columnas.forEach((c, i) => celdas.push({ fila: 1, columna: i + 1, valor: c.titulo, estilo: CABECERA }));
  filas.forEach((f, k) => {
    columnas.forEach((c, i) => {
      const v = c.celda(f);
      if (c.tipo === "fecha") {
        const ok = typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
        celdas.push({
          fila: 2 + k, columna: i + 1, valor: ok ? serialDeDia(v) : null,
          estilo: DATO({ formato: "d/M/yyyy", alineacion: { horizontal: "center", vertical: "center" } }),
        });
      } else if (c.tipo === "numero") {
        const n = typeof v === "number" ? v : v === null || v === "" ? NaN : Number(v);
        celdas.push({ fila: 2 + k, columna: i + 1, valor: Number.isFinite(n) ? n : null, estilo: DATO() });
      } else {
        /* Un texto que empieza con = + - @ lo tomaría Excel por una fórmula: se deja como texto. */
        celdas.push({ fila: 2 + k, columna: i + 1, valor: v === null ? null : String(v), estilo: DATO({ formato: "@" }) });
      }
    });
  });
  const hoja: ColumnaHoja[] = columnas.map((c, i) => ({ desde: i + 1, ancho: c.ancho }));
  return {
    nombre: nombreDeHoja(nombre), celdas, columnas: hoja, altos: { 1: 32 },
    filtro: filas.length ? `A1:${letraDeColumna(columnas.length)}${filas.length + 1}` : undefined,
    colorPestania: "674EA7",
  };
}

/** «Clientes 09-10-2026.xlsx». */
export function nombreArchivoCs(base: string, hoy: string): string {
  return `${base} ${hoy.split("-").reverse().join("-")}.xlsx`;
}

export async function excelDeTabla<F>(
  nombre: string, columnas: readonly ColumnaExcelCs<F>[], filas: readonly F[],
): Promise<Uint8Array<ArrayBuffer>> {
  return escribirXlsx({ hojas: [hojaDeTabla(nombre, columnas, filas)] });
}
