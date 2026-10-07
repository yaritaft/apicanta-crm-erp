import type { EstadoApp, ID, Pago } from "./types";
import { escribirXlsx, letraDeColumna, serialDeDia, TIPO_XLSX, type Celda, type ColumnaHoja, type EstiloCelda, type HojaXlsx } from "./xlsxEscribir";
import { comprobanteDe, diaArgentina, linksDeComprobantes } from "./reporteFinanciera";
import { conciliacionDe, controlDeCobro, primerNombre, quienEs, ROL_DE_CASILLERO } from "./control-cobros";
import { fechaHora } from "./format";

/* ==================================================================
   Los cobros que se ven, en un Excel.

   Angelo (02/10): «en un Excel más que en un CSV: lo sube, lo concilia y
   chao». Es el botón «Descargar Excel» de la lista de cobros: sale lo que
   está en pantalla, con los filtros puestos, y sus totales al pie. Lleva lo
   que pide la Financiera (fecha, nombre de quien transfirió, CUIT, monto y
   comprobante) y, al lado, lo que dice el control: si está conciliado, quién
   lo chequeó y cuándo. El comprobante guardado en la nube sale con un link
   que dura 30 días. Para el corte con el formato de la Financiera está el
   «Reporte para la Financiera» (lib/reporteFinanciera.ts).
   ================================================================== */

export interface FilaExcelCobro {
  pagoId: ID;
  /** El día en Argentina, "aaaa-mm-dd". */
  dia: string;
  cliente: string;
  /** Quién transfirió; si no se cargó, vacío (el cliente de la venta va aparte). */
  transfirio: string;
  cuit: string;
  servicio: string;
  closer: string;
  cuota: string;
  cuenta: string;
  montoUsd: number;
  montoArs?: number;
  tipoCambio?: number;
  /** Lo que va en la celda: el link, el archivo guardado en la nube (se firma
   *  al bajar el Excel) o lo que se escribió en la planilla. */
  comprobante: { texto: string; url?: string; ruta?: string };
  conciliado: string;
  chequeo: string;
  chequeadoPor: string;
  chequeadoEn: string;
  cargadoPor: string;
  referencia: string;
}

const redondear = (n: number) => Math.round(n * 100) / 100;

/** Una fila por cobro, de los más viejos a los más nuevos. */
export function filasExcelCobros(
  e: Pick<EstadoApp, "cuotas" | "ventas" | "productos" | "equipo" | "procesadores">, pagos: readonly Pago[],
): FilaExcelCobro[] {
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  const servicioDe = new Map(e.productos.map((p) => [p.id, p.nombre] as const));
  const personaDe = new Map(e.equipo.map((m) => [m.id, m.nombre] as const));
  const procDe = new Map(e.procesadores.map((p) => [p.id, p.nombre] as const));

  return [...pagos]
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || a.creadoEn.localeCompare(b.creadoEn))
    .map((p): FilaExcelCobro => {
      const cuota = cuotaDe.get(p.cuotaId);
      const venta = cuota ? ventaDe.get(cuota.ventaId) : undefined;
      const control = controlDeCobro(p);
      const ars = p.montoArs ? p.montoArs : p.tipoCambio ? p.monto * p.tipoCambio : undefined;
      const quienes = control.chequeos.length ? control.chequeos : control.rechazos;
      const ultimo = quienes[quienes.length - 1];
      const nombreDe = (por?: string) => quienEs(e.equipo, por) || por || "";
      const closerId = cuota?.closerId || venta?.closerId;
      const conc = conciliacionDe(e.procesadores, p);
      return {
        pagoId: p.id,
        dia: diaArgentina(p.fecha),
        cliente: venta?.contactoNombre ?? "",
        transfirio: p.pagador?.trim() ?? "",
        cuit: p.cuit?.trim() ?? "",
        servicio: (venta?.productoId && servicioDe.get(venta.productoId)) || "",
        closer: (closerId && personaDe.get(closerId)) || "",
        cuota: p.caracteristica ?? (cuota ? (cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`) : ""),
        cuenta: (p.procesadorId && procDe.get(p.procesadorId)) || "Sin cuenta",
        montoUsd: redondear(p.monto),
        montoArs: ars === undefined ? undefined : redondear(ars),
        tipoCambio: p.tipoCambio,
        comprobante: comprobanteDe(p),
        conciliado: conc === "conciliado" ? "Sí" : conc === "sin-conciliar" ? "No" : "A mano",
        chequeo: control.estado === "chequeado" ? "Chequeado" : control.estado === "rechazado" ? "Rechazado" : "Sin chequear",
        chequeadoPor: ultimo
          ? `${quienes.map((x) => primerNombre(nombreDe(x.por)) || ROL_DE_CASILLERO[x.casillero].corto).join(" y ")}`
          : control.deAntes ? (control.conciliado ? "Pasarela" : "De antes") : "",
        chequeadoEn: ultimo?.en ? fechaHora(ultimo.en) : "",
        cargadoPor: nombreDe(p.cargadoPor),
        referencia: p.referencia ?? "",
      };
    });
}

/** Lo que suman las filas, en centavos enteros: así el total del Excel es el de la
 *  suma de las celdas, sin restos de punto flotante, y es el mismo que el de la lista. */
export function totalesExcelCobros(filas: readonly FilaExcelCobro[]): { cobros: number; usd: number; ars: number } {
  let usd = 0, ars = 0;
  for (const f of filas) {
    usd += Math.round(f.montoUsd * 100);
    ars += Math.round((f.montoArs ?? 0) * 100);
  }
  return { cobros: filas.length, usd: usd / 100, ars: ars / 100 };
}

/* ---------- La hoja ---------- */

const FINO = "thin" as const;
const BORDES = { izquierda: FINO, derecha: FINO, arriba: FINO, abajo: FINO, color: "D0D0D0" };
const CABECERA: EstiloCelda = {
  fuente: { nombre: "Calibri", tamanio: 11, negrita: true, color: "FFFFFF" }, relleno: "674EA7", bordes: BORDES,
  alineacion: { horizontal: "center", vertical: "center", ajustar: true },
};
const DATO = (extra: EstiloCelda = {}): EstiloCelda => ({
  fuente: { nombre: "Calibri", tamanio: 11 }, bordes: BORDES, alineacion: { vertical: "center" }, ...extra,
});
const TOTAL = (extra: EstiloCelda = {}): EstiloCelda => ({
  fuente: { nombre: "Calibri", tamanio: 11, negrita: true }, relleno: "EDE7F6", bordes: { ...BORDES, arriba: "medium" }, alineacion: { vertical: "center" }, ...extra,
});
const DOLARES = "#,##0.00";
const PESOS = '"$"#,##0.00';

interface ColumnaExcel {
  titulo: string;
  ancho: number;
  estilo?: EstiloCelda;
  celda: (f: FilaExcelCobro, links: Map<string, string>) => { valor?: Celda["valor"]; enlace?: string };
}

const COLUMNAS: ColumnaExcel[] = [
  { titulo: "Fecha", ancho: 12, estilo: { formato: "d/M/yyyy", alineacion: { horizontal: "center", vertical: "center" } }, celda: (f) => ({ valor: serialDeDia(f.dia) }) },
  { titulo: "Cliente", ancho: 28, celda: (f) => ({ valor: f.cliente }) },
  { titulo: "Nombre de quien transfiere", ancho: 30, celda: (f) => ({ valor: f.transfirio }) },
  { titulo: "CUIT", ancho: 15, celda: (f) => ({ valor: f.cuit }) },
  { titulo: "Servicio", ancho: 20, celda: (f) => ({ valor: f.servicio }) },
  { titulo: "Closer", ancho: 18, celda: (f) => ({ valor: f.closer }) },
  { titulo: "Cuota", ancho: 14, celda: (f) => ({ valor: f.cuota }) },
  { titulo: "Cuenta", ancho: 20, celda: (f) => ({ valor: f.cuenta }) },
  { titulo: "Monto USD", ancho: 14, estilo: { formato: DOLARES }, celda: (f) => ({ valor: f.montoUsd }) },
  { titulo: "Monto ARS", ancho: 16, estilo: { formato: PESOS }, celda: (f) => ({ valor: f.montoArs }) },
  { titulo: "Tipo de cambio", ancho: 14, estilo: { formato: PESOS }, celda: (f) => ({ valor: f.tipoCambio }) },
  {
    titulo: "Comprobante", ancho: 46,
    celda: (f, links) => {
      const firmado = f.comprobante.ruta ? links.get(f.comprobante.ruta) : undefined;
      return { valor: firmado ?? f.comprobante.texto, enlace: firmado ?? f.comprobante.url };
    },
  },
  { titulo: "Conciliado", ancho: 12, estilo: { alineacion: { horizontal: "center", vertical: "center" } }, celda: (f) => ({ valor: f.conciliado }) },
  { titulo: "Chequeo", ancho: 14, estilo: { alineacion: { horizontal: "center", vertical: "center" } }, celda: (f) => ({ valor: f.chequeo }) },
  { titulo: "Chequeado por", ancho: 20, celda: (f) => ({ valor: f.chequeadoPor }) },
  { titulo: "Cuándo", ancho: 16, celda: (f) => ({ valor: f.chequeadoEn }) },
  { titulo: "Cargado por", ancho: 22, celda: (f) => ({ valor: f.cargadoPor }) },
  { titulo: "Referencia", ancho: 24, celda: (f) => ({ valor: f.referencia }) },
];

/** Los títulos de las columnas, en orden. */
export const TITULOS_EXCEL_COBROS = COLUMNAS.map((c) => c.titulo);

/** La hoja: los encabezados en la fila 1 (para filtrarla o subirla tal cual),
 *  un cobro por fila y, después de una fila en blanco, los totales. `links` son
 *  los comprobantes de la nube ya firmados, por ruta. */
export function hojaCobros(filas: readonly FilaExcelCobro[], links: Map<string, string> = new Map(), nombre = "Cobros"): HojaXlsx {
  const celdas: Celda[] = [];
  COLUMNAS.forEach((c, i) => celdas.push({ fila: 1, columna: i + 1, valor: c.titulo, estilo: CABECERA }));
  filas.forEach((f, k) => {
    COLUMNAS.forEach((c, i) => {
      const { valor, enlace } = c.celda(f, links);
      celdas.push({ fila: 2 + k, columna: i + 1, valor, estilo: DATO(c.estilo), enlace });
    });
  });

  const t = totalesExcelCobros(filas);
  const filaTotal = filas.length + 3;
  COLUMNAS.forEach((c, i) => {
    const valor = c.titulo === "Cliente" ? `TOTAL · ${t.cobros} ${t.cobros === 1 ? "cobro" : "cobros"}`
      : c.titulo === "Monto USD" ? t.usd : c.titulo === "Monto ARS" ? (t.ars ? t.ars : undefined) : undefined;
    celdas.push({ fila: filaTotal, columna: i + 1, valor, estilo: TOTAL(c.estilo) });
  });

  const columnas: ColumnaHoja[] = COLUMNAS.map((c, i) => ({ desde: i + 1, ancho: c.ancho }));
  const ultima = letraDeColumna(COLUMNAS.length);
  return {
    nombre, celdas, columnas, altos: { 1: 32 },
    filtro: filas.length ? `A1:${ultima}${filas.length + 1}` : undefined,
    numerosComoTexto: filas.length ? [`D2:D${filas.length + 1}`] : undefined,
    colorPestania: "674EA7",
  };
}

/** "Cobros 01-09-2026 a 30-09-2026.xlsx". */
export function nombreArchivoCobros(desde: string, hasta: string): string {
  const dma = (dia: string) => dia.split("-").reverse().join("-");
  return `Cobros ${dma(desde)} a ${dma(hasta)}.xlsx`;
}

/** El Excel, con los comprobantes de la nube firmados por 30 días. `sinLink`
 *  cuenta los que no se pudieron firmar: van con el nombre del archivo. */
export async function excelCobros(
  filas: readonly FilaExcelCobro[], desde: string, hasta: string,
): Promise<{ nombre: string; datos: Uint8Array<ArrayBuffer>; sinLink: number }> {
  const rutas = filas.flatMap((f) => (f.comprobante.ruta ? [f.comprobante.ruta] : []));
  const links = await linksDeComprobantes(rutas);
  const datos = await escribirXlsx({ hojas: [hojaCobros(filas, links)] });
  return { nombre: nombreArchivoCobros(desde, hasta), datos, sinLink: rutas.filter((r) => !links.has(r)).length };
}

/** Lo baja el navegador. */
export function bajarExcel(nombre: string, datos: Uint8Array<ArrayBuffer>): void {
  const url = URL.createObjectURL(new Blob([datos], { type: TIPO_XLSX }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
