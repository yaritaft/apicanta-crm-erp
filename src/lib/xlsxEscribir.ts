/* ==================================================================
   Escribir un Excel (.xlsx) en el navegador, sin librerías.

   El espejo de xlsx.ts, que lee: un .xlsx es un zip de XML. Acá se
   arman el libro, los estilos, los textos y cada hoja, y se meten en
   un zip con su CRC-32. Se comprime con el CompressionStream del
   navegador ("deflate-raw", el mismo formato que xlsx.ts descomprime);
   si no está, los archivos van guardados sin comprimir, que también
   es un zip válido.

   Alcanza para un reporte con el formato de una planilla: textos,
   números, fechas, VERDADERO/FALSO, fuente (nombre, tamaño, negrita,
   color), relleno, bordes, alineación, formato de número, anchos,
   columnas ocultas, altos, celdas combinadas, links y filtro. No hace
   fórmulas, gráficos ni imágenes.
   ================================================================== */

export type Borde = "thin" | "medium" | "thick" | "dashed" | "dotted" | "double" | "hair";

export interface Fuente {
  nombre?: string;
  /** En puntos. */
  tamanio?: number;
  negrita?: boolean;
  cursiva?: boolean;
  subrayada?: boolean;
  /** "RRGGBB". */
  color?: string;
}

export interface EstiloCelda {
  fuente?: Fuente;
  /** Relleno sólido, "RRGGBB". */
  relleno?: string;
  bordes?: { izquierda?: Borde; derecha?: Borde; arriba?: Borde; abajo?: Borde; color?: string };
  alineacion?: { horizontal?: "left" | "center" | "right"; vertical?: "top" | "center" | "bottom"; ajustar?: boolean };
  /** El formato de número de Excel: "@" (texto), "d/M/yyyy", '"$"#,##0.00'.
   *  Sin formato, General. */
  formato?: string;
}

export interface Celda {
  /** 1 es la primera fila; 1 es la columna A. */
  fila: number;
  columna: number;
  /** Una fecha va como número (serialDeDia) con un formato de fecha. */
  valor?: string | number | boolean | null;
  estilo?: EstiloCelda;
  /** Link http(s) que se abre al tocar la celda. */
  enlace?: string;
}

export interface ColumnaHoja {
  desde: number;
  hasta?: number;
  /** En caracteres, como el ancho que muestra Excel. */
  ancho?: number;
  oculta?: boolean;
  /** El formato de las celdas vacías de la columna (las que no están en celdas). */
  estilo?: EstiloCelda;
}

export interface HojaXlsx {
  /** Hasta 31 caracteres, sin : \ / ? * [ ]. */
  nombre: string;
  celdas: Celda[];
  columnas?: ColumnaHoja[];
  /** Alto en puntos, por número de fila. */
  altos?: Record<number, number>;
  /** Rangos combinados: "B8:K8". */
  combinadas?: string[];
  /** El rango con filtro, encabezados incluidos: "B9:K40". */
  filtro?: string;
  /** Rangos donde Excel no tiene que marcar "número guardado como texto"
   *  (un CUIT o un CBU son texto aunque sean todos números). */
  numerosComoTexto?: string[];
  colorPestania?: string;
  anchoPorDefecto?: number;
  altoPorDefecto?: number;
}

export interface LibroXlsx {
  hojas: HojaXlsx[];
  /** La fuente de lo que no dice otra. Por defecto Arial 10, la de Google Sheets. */
  fuente?: { nombre: string; tamanio: number };
}

export const TIPO_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** 1 → "A", 27 → "AA". */
export function letraDeColumna(n: number): string {
  let s = "";
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s;
  return s;
}

/** (8, 2) → "B8". */
export const refCelda = (fila: number, columna: number): string => `${letraDeColumna(columna)}${fila}`;

/** El número con que Excel guarda un día "aaaa-mm-dd": días desde el 30/12/1899. */
export function serialDeDia(dia: string): number {
  const [a, m, d] = dia.split("-").map(Number);
  return Math.round((Date.UTC(a, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

/* ---------- XML ---------- */

const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships";
const CABEZA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

/* Lo que XML 1.0 no admite (controles, surrogates sueltos) se saca: un solo
   carácter así y Excel dice que el archivo está dañado. */
const NO_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;
const SURROGATES = /[\uD800-\uDBFF][\uDC00-\uDFFF]|[\uD800-\uDFFF]/g;

function esc(s: string): string {
  return s.replace(NO_XML, "").replace(SURROGATES, (m) => (m.length === 2 ? m : ""))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* En los textos de Excel "_x0041_" es un carácter escapado: un texto que
   traiga eso literal se protege escapando su guion bajo. */
const escTexto = (s: string) => esc(s.replace(/_(x[0-9A-Fa-f]{4}_)/g, "_x005F_$1"));

function argb(color: string): string {
  const h = color.replace(/^#/, "").toUpperCase();
  if (/^[0-9A-F]{8}$/.test(h)) return h;
  if (/^[0-9A-F]{6}$/.test(h)) return `FF${h}`;
  throw new Error(`Color inválido para el Excel: ${color}`);
}

/* ---------- Estilos ----------
   Cada combinación distinta de fuente, relleno, borde, alineación y
   formato es un "xf" de styles.xml; las celdas lo nombran por índice. */

const FORMATOS_DE_EXCEL: Record<string, number> = {
  General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "@": 49,
};

function estilos(base: { nombre: string; tamanio: number }) {
  const fuentes = new Map<string, number>();
  const rellenos = new Map<string, number>();
  const bordes = new Map<string, number>();
  const formatos = new Map<string, number>();
  const xfs = new Map<string, number>();
  const alta = (m: Map<string, number>, xml: string) => {
    let i = m.get(xml);
    if (i === undefined) { i = m.size; m.set(xml, i); }
    return i;
  };

  const xmlFuente = (f: Fuente) =>
    `<font>${f.negrita ? "<b/>" : ""}${f.cursiva ? "<i/>" : ""}${f.subrayada ? "<u/>" : ""}` +
    `<sz val="${f.tamanio ?? base.tamanio}"/><color rgb="${argb(f.color ?? "000000")}"/>` +
    `<name val="${esc(f.nombre ?? base.nombre)}"/></font>`;

  alta(fuentes, xmlFuente({}));
  alta(rellenos, '<fill><patternFill patternType="none"/></fill>');
  alta(rellenos, '<fill><patternFill patternType="gray125"/></fill>');
  alta(bordes, "<border><left/><right/><top/><bottom/><diagonal/></border>");
  alta(xfs, '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>');

  function idFormato(codigo: string): number {
    const propio = FORMATOS_DE_EXCEL[codigo];
    if (propio !== undefined) return propio;
    let id = formatos.get(codigo);
    if (id === undefined) { id = 164 + formatos.size; formatos.set(codigo, id); }
    return id;
  }

  return {
    indice(e?: EstiloCelda): number {
      if (!e) return 0;
      const fuente = e.fuente ? alta(fuentes, xmlFuente(e.fuente)) : 0;
      const relleno = e.relleno
        ? alta(rellenos, `<fill><patternFill patternType="solid"><fgColor rgb="${argb(e.relleno)}"/><bgColor indexed="64"/></patternFill></fill>`)
        : 0;
      let borde = 0;
      if (e.bordes) {
        const b = e.bordes;
        const color = argb(b.color ?? "000000");
        const lado = (tag: string, s?: Borde) => (s ? `<${tag} style="${s}"><color rgb="${color}"/></${tag}>` : `<${tag}/>`);
        borde = alta(bordes, `<border>${lado("left", b.izquierda)}${lado("right", b.derecha)}${lado("top", b.arriba)}${lado("bottom", b.abajo)}<diagonal/></border>`);
      }
      const formato = e.formato ? idFormato(e.formato) : 0;
      const a = e.alineacion;
      const atributos = a
        ? [a.horizontal && `horizontal="${a.horizontal}"`, a.vertical && `vertical="${a.vertical}"`, a.ajustar && 'wrapText="1"'].filter(Boolean).join(" ")
        : "";
      return alta(xfs,
        `<xf numFmtId="${formato}" fontId="${fuente}" fillId="${relleno}" borderId="${borde}" xfId="0"` +
        (formato ? ' applyNumberFormat="1"' : "") + (fuente ? ' applyFont="1"' : "") +
        (relleno ? ' applyFill="1"' : "") + (borde ? ' applyBorder="1"' : "") +
        (atributos ? ` applyAlignment="1"><alignment ${atributos}/></xf>` : "/>"));
    },
    xml(): string {
      const lista = (m: Map<string, number>) => [...m.keys()].join("");
      const numFmts = formatos.size
        ? `<numFmts count="${formatos.size}">${[...formatos].map(([codigo, id]) => `<numFmt numFmtId="${id}" formatCode="${esc(codigo)}"/>`).join("")}</numFmts>`
        : "";
      return `${CABEZA}<styleSheet xmlns="${NS_MAIN}">${numFmts}` +
        `<fonts count="${fuentes.size}">${lista(fuentes)}</fonts>` +
        `<fills count="${rellenos.size}">${lista(rellenos)}</fills>` +
        `<borders count="${bordes.size}">${lista(bordes)}</borders>` +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        `<cellXfs count="${xfs.size}">${lista(xfs)}</cellXfs>` +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
        '<dxfs count="0"/><tableStyles count="0"/></styleSheet>';
    },
  };
}

/* ---------- Textos compartidos ---------- */

function textos() {
  const indices = new Map<string, number>();
  let usos = 0;
  return {
    indice(s: string): number {
      usos++;
      let i = indices.get(s);
      if (i === undefined) { i = indices.size; indices.set(s, i); }
      return i;
    },
    xml(): string {
      const si = [...indices.keys()].map((s) => {
        /* Excel corta en 32.767 caracteres por celda. */
        const t = s.length > 32767 ? s.slice(0, 32767) : s;
        const preservar = /^\s|\s$|\n|\t/.test(t) ? ' xml:space="preserve"' : "";
        return `<si><t${preservar}>${escTexto(t)}</t></si>`;
      }).join("");
      return `${CABEZA}<sst xmlns="${NS_MAIN}" count="${usos}" uniqueCount="${indices.size}">${si}</sst>`;
    },
  };
}

/* ---------- Hojas ---------- */

/* Excel no acepta links de más de 2079 caracteres ni direcciones que no
   sean URIs: esos quedan como texto, sin link. */
function enlaceValido(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.href.length <= 2079 ? u.href : null;
  } catch {
    return null;
  }
}

const absoluto = (rango: string) => rango.replace(/([A-Z]+)(\d+)/g, "$$$1$$$2");

function nombreDeHoja(nombre: string, usados: Set<string>): string {
  const base = nombre.replace(/[:\\/?*[\]]/g, " ").replace(/\s+/g, " ").replace(/^'+|'+$/g, "").trim().slice(0, 31) || "Hoja";
  let n = base;
  for (let k = 2; usados.has(n.toLowerCase()); k++) n = `${base.slice(0, 31 - ` (${k})`.length)} (${k})`;
  usados.add(n.toLowerCase());
  return n;
}

function xmlHoja(hoja: HojaXlsx, primera: boolean, est: ReturnType<typeof estilos>, txt: ReturnType<typeof textos>) {
  /* Por fila y columna; si una celda se repite, gana la última. */
  const filas = new Map<number, Map<number, Celda>>();
  for (const c of hoja.celdas) {
    if (!(c.fila >= 1 && c.columna >= 1)) continue;
    if (!filas.has(c.fila)) filas.set(c.fila, new Map());
    filas.get(c.fila)!.set(c.columna, c);
  }
  const altos = hoja.altos ?? {};
  const numeros = [...new Set([...filas.keys(), ...Object.keys(altos).map(Number)])].sort((a, b) => a - b);

  let minF = Infinity, maxF = 0, minC = Infinity, maxC = 0;
  const enlaces: { ref: string; url: string }[] = [];
  const sheetData = numeros.map((f) => {
    const alto = altos[f];
    const celdas = [...(filas.get(f)?.values() ?? [])].sort((a, b) => a.columna - b.columna).map((c) => {
      const ref = refCelda(f, c.columna);
      const s = est.indice(c.estilo);
      const url = c.enlace ? enlaceValido(c.enlace) : null;
      const v = c.valor;
      let xml: string;
      if (typeof v === "number" && Number.isFinite(v)) xml = `<c r="${ref}"${s ? ` s="${s}"` : ""}><v>${v}</v></c>`;
      else if (typeof v === "boolean") xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="b"><v>${v ? 1 : 0}</v></c>`;
      else if (typeof v === "string" && v !== "") xml = `<c r="${ref}"${s ? ` s="${s}"` : ""} t="s"><v>${txt.indice(v)}</v></c>`;
      else if (s) xml = `<c r="${ref}" s="${s}"/>`;
      else return "";
      if (url) enlaces.push({ ref, url });
      minF = Math.min(minF, f); maxF = Math.max(maxF, f);
      minC = Math.min(minC, c.columna); maxC = Math.max(maxC, c.columna);
      return xml;
    }).join("");
    return `<row r="${f}"${alto ? ` ht="${alto}" customHeight="1"` : ""}>${celdas}</row>`;
  }).join("");

  const dimension = maxF ? `${refCelda(minF, minC)}:${refCelda(maxF, maxC)}` : "A1";
  const cols = [...(hoja.columnas ?? [])].sort((a, b) => a.desde - b.desde).map((c) =>
    `<col min="${c.desde}" max="${c.hasta ?? c.desde}" width="${c.ancho ?? hoja.anchoPorDefecto ?? 8.43}"` +
    `${c.estilo ? ` style="${est.indice(c.estilo)}"` : ""}` +
    `${c.ancho !== undefined ? ' customWidth="1"' : ""}${c.oculta ? ' hidden="1"' : ""}/>`).join("");
  const formatoFilas = `<sheetFormatPr${hoja.anchoPorDefecto ? ` defaultColWidth="${hoja.anchoPorDefecto}"` : ""}` +
    ` defaultRowHeight="${hoja.altoPorDefecto ?? 15}"${hoja.altoPorDefecto ? ' customHeight="1"' : ""}/>`;
  const combinadas = hoja.combinadas ?? [];

  /* El orden de los elementos lo fija el esquema: Excel no abre la hoja si
     vienen en otro orden. */
  const xml = `${CABEZA}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_REL}">` +
    (hoja.colorPestania ? `<sheetPr><tabColor rgb="${argb(hoja.colorPestania)}"/></sheetPr>` : "") +
    `<dimension ref="${dimension}"/>` +
    `<sheetViews><sheetView workbookViewId="0"${primera ? ' tabSelected="1"' : ""}/></sheetViews>` +
    formatoFilas +
    (cols ? `<cols>${cols}</cols>` : "") +
    `<sheetData>${sheetData}</sheetData>` +
    (hoja.filtro ? `<autoFilter ref="${hoja.filtro}"/>` : "") +
    (combinadas.length ? `<mergeCells count="${combinadas.length}">${combinadas.map((r) => `<mergeCell ref="${r}"/>`).join("")}</mergeCells>` : "") +
    (enlaces.length ? `<hyperlinks>${enlaces.map((x, i) => `<hyperlink ref="${x.ref}" r:id="rId${i + 1}"/>`).join("")}</hyperlinks>` : "") +
    '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>' +
    (hoja.numerosComoTexto?.length ? `<ignoredErrors><ignoredError sqref="${hoja.numerosComoTexto.join(" ")}" numberStoredAsText="1"/></ignoredErrors>` : "") +
    "</worksheet>";

  const rels = enlaces.length
    ? `${CABEZA}<Relationships xmlns="${NS_PKG}">${enlaces.map((x, i) =>
      `<Relationship Id="rId${i + 1}" Type="${NS_REL}/hyperlink" Target="${esc(x.url)}" TargetMode="External"/>`).join("")}</Relationships>`
    : null;
  return { xml, rels };
}

/** El libro armado como .xlsx, listo para un Blob con TIPO_XLSX. */
export async function escribirXlsx(libro: LibroXlsx): Promise<Uint8Array<ArrayBuffer>> {
  if (!libro.hojas.length) throw new Error("El Excel necesita al menos una hoja.");
  const est = estilos(libro.fuente ?? { nombre: "Arial", tamanio: 10 });
  const txt = textos();
  const usados = new Set<string>();
  const nombres = libro.hojas.map((h) => nombreDeHoja(h.nombre, usados));

  const archivos: { nombre: string; texto: string }[] = [];
  const hojas = libro.hojas.map((h, i) => xmlHoja(h, i === 0, est, txt));
  hojas.forEach((h, i) => {
    archivos.push({ nombre: `xl/worksheets/sheet${i + 1}.xml`, texto: h.xml });
    if (h.rels) archivos.push({ nombre: `xl/worksheets/_rels/sheet${i + 1}.xml.rels`, texto: h.rels });
  });

  /* El filtro necesita su nombre definido: sin él, Excel lo pierde al guardar. */
  const definidos = libro.hojas.map((h, i) => h.filtro
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${esc(`'${nombres[i].replace(/'/g, "''")}'!${absoluto(h.filtro)}`)}</definedName>`
    : "").join("");
  const workbook = `${CABEZA}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_REL}"><workbookPr/>` +
    '<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="28800" windowHeight="17000" activeTab="0"/></bookViews>' +
    `<sheets>${nombres.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>` +
    (definidos ? `<definedNames>${definidos}</definedNames>` : "") + "</workbook>";
  const n = libro.hojas.length;
  const workbookRels = `${CABEZA}<Relationships xmlns="${NS_PKG}">` +
    nombres.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS_REL}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("") +
    `<Relationship Id="rId${n + 1}" Type="${NS_REL}/styles" Target="styles.xml"/>` +
    `<Relationship Id="rId${n + 2}" Type="${NS_REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
  const tipos = `${CABEZA}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    nombres.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>' +
    "</Types>";

  /* Los estilos y los textos van al final: recién ahí están todos. */
  return zip([
    { nombre: "[Content_Types].xml", texto: tipos },
    { nombre: "_rels/.rels", texto: `${CABEZA}<Relationships xmlns="${NS_PKG}"><Relationship Id="rId1" Type="${NS_REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { nombre: "xl/workbook.xml", texto: workbook },
    { nombre: "xl/_rels/workbook.xml.rels", texto: workbookRels },
    ...archivos,
    { nombre: "xl/styles.xml", texto: est.xml() },
    { nombre: "xl/sharedStrings.xml", texto: txt.xml() },
  ]);
}

/* ---------- Zip ---------- */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = TABLA_CRC[(c ^ datos[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function comprimir(datos: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const flujo = new Blob([datos]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  } catch {
    return null;
  }
}

async function zip(archivos: { nombre: string; texto: string }[]): Promise<Uint8Array<ArrayBuffer>> {
  const enc = new TextEncoder();
  const ahora = new Date();
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const fecha = ((Math.max(ahora.getFullYear(), 1980) - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();

  const partes: Uint8Array<ArrayBuffer>[] = [];
  const indice: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const a of archivos) {
    const nombre = enc.encode(a.nombre);
    const datos = enc.encode(a.texto);
    const crc = crc32(datos);
    const comprimido = await comprimir(datos);
    const deflate = comprimido !== null && comprimido.length < datos.length;
    const guardado = deflate ? comprimido : datos;

    const local = new Uint8Array(30 + nombre.length);
    const l = new DataView(local.buffer);
    l.setUint32(0, 0x04034b50, true);
    l.setUint16(4, 20, true);
    l.setUint16(8, deflate ? 8 : 0, true);
    l.setUint16(10, hora, true);
    l.setUint16(12, fecha, true);
    l.setUint32(14, crc, true);
    l.setUint32(18, guardado.length, true);
    l.setUint32(22, datos.length, true);
    l.setUint16(26, nombre.length, true);
    local.set(nombre, 30);

    const central = new Uint8Array(46 + nombre.length);
    const c = new DataView(central.buffer);
    c.setUint32(0, 0x02014b50, true);
    c.setUint16(4, 20, true);
    c.setUint16(6, 20, true);
    c.setUint16(10, deflate ? 8 : 0, true);
    c.setUint16(12, hora, true);
    c.setUint16(14, fecha, true);
    c.setUint32(16, crc, true);
    c.setUint32(20, guardado.length, true);
    c.setUint32(24, datos.length, true);
    c.setUint16(28, nombre.length, true);
    c.setUint32(42, offset, true);
    central.set(nombre, 46);

    partes.push(local, guardado);
    indice.push(central);
    offset += local.length + guardado.length;
  }
  const largoIndice = indice.reduce((s, x) => s + x.length, 0);
  const fin = new Uint8Array(22);
  const f = new DataView(fin.buffer);
  f.setUint32(0, 0x06054b50, true);
  f.setUint16(8, archivos.length, true);
  f.setUint16(10, archivos.length, true);
  f.setUint32(12, largoIndice, true);
  f.setUint32(16, offset, true);

  const todo = [...partes, ...indice, fin];
  const salida = new Uint8Array(todo.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of todo) { salida.set(x, p); p += x.length; }
  return salida;
}
