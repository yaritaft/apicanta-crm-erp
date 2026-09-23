/* ==================================================================
   Leer una hoja de un Excel (.xlsx) en el navegador, sin librerías.

   Un .xlsx es un zip de XML. Acá se lee el índice del zip, se descomprime
   sólo lo necesario (el libro, los textos compartidos y la hoja pedida)
   con el DecompressionStream del navegador, y se arma la tabla con
   DOMParser. Alcanza para la planilla de Angelo, que se baja de Google
   Sheets: no maneja zip64 ni cifrado, que ahí no aparecen.

   Devuelve texto crudo: los números como número ("2128.5") y las fechas
   como el serial de Excel ("45882"), que el importador sabe leer.
   ================================================================== */

interface Entrada { metodo: number; comprimido: number; offset: number }

function indiceZip(buf: ArrayBuffer): Map<string, Entrada> {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un Excel (.xlsx) válido.");
  const total = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Entrada>();
  for (let k = 0; k < total; k++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const metodo = v.getUint16(p + 10, true);
    const comprimido = v.getUint32(p + 20, true);
    const largoNombre = v.getUint16(p + 28, true);
    const largoExtra = v.getUint16(p + 30, true);
    const largoComentario = v.getUint16(p + 32, true);
    const offset = v.getUint32(p + 42, true);
    const nombre = dec.decode(new Uint8Array(buf, p + 46, largoNombre));
    out.set(nombre, { metodo, comprimido, offset });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return out;
}

async function leerArchivo(buf: ArrayBuffer, e: Entrada): Promise<string> {
  const v = new DataView(buf);
  const inicio = e.offset + 30 + v.getUint16(e.offset + 26, true) + v.getUint16(e.offset + 28, true);
  const datos = new Uint8Array(buf, inicio, e.comprimido);
  if (e.metodo === 0) return new TextDecoder().decode(datos);
  if (e.metodo !== 8) throw new Error("El Excel usa una compresión que no se puede leer.");
  const flujo = new Blob([datos]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(flujo).text();
}

const xml = (texto: string) => new DOMParser().parseFromString(texto, "application/xml");

/* "AB12" → 27 (base 0). */
function columna(ref: string): number {
  let n = 0;
  for (const c of ref.replace(/\d+$/, "")) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

/** Las hojas de un Excel, por nombre, para leer las que hagan falta. */
export async function abrirXlsx(buf: ArrayBuffer) {
  const zip = indiceZip(buf);
  const leer = async (nombre: string) => {
    const e = zip.get(nombre);
    return e ? leerArchivo(buf, e) : null;
  };

  const libro = xml((await leer("xl/workbook.xml")) ?? "");
  const rels = xml((await leer("xl/_rels/workbook.xml.rels")) ?? "");
  const destino = new Map<string, string>();
  for (const r of Array.from(rels.getElementsByTagName("Relationship"))) {
    const t = r.getAttribute("Target") ?? "";
    destino.set(r.getAttribute("Id") ?? "", t.startsWith("/") ? t.slice(1) : `xl/${t.replace(/^\.\//, "")}`);
  }
  const hojas = new Map<string, string>();
  for (const h of Array.from(libro.getElementsByTagName("sheet"))) {
    const id = h.getAttribute("r:id") ?? h.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
    const ruta = destino.get(id);
    if (ruta) hojas.set(h.getAttribute("name") ?? "", ruta);
  }

  let compartidos: string[] | null = null;
  const textos = async () => {
    if (compartidos) return compartidos;
    const doc = xml((await leer("xl/sharedStrings.xml")) ?? "<sst/>");
    compartidos = Array.from(doc.getElementsByTagName("si")).map((si) =>
      Array.from(si.getElementsByTagName("t")).map((t) => t.textContent ?? "").join(""));
    return compartidos;
  };

  return {
    nombres: [...hojas.keys()],
    /** La hoja como tabla de texto, o null si no existe. */
    async hoja(nombre: string): Promise<string[][] | null> {
      const ruta = hojas.get(nombre);
      if (!ruta) return null;
      const doc = xml((await leer(ruta)) ?? "");
      const ss = await textos();
      const tabla: string[][] = [];
      for (const fila of Array.from(doc.getElementsByTagName("row"))) {
        const r = Number(fila.getAttribute("r") ?? tabla.length + 1) - 1;
        const celdas: string[] = [];
        for (const c of Array.from(fila.getElementsByTagName("c"))) {
          const i = columna(c.getAttribute("r") ?? "A1");
          const t = c.getAttribute("t");
          const valor = c.getElementsByTagName("v")[0]?.textContent ?? "";
          let texto: string;
          if (t === "s") texto = ss[Number(valor)] ?? "";
          else if (t === "inlineStr") texto = Array.from(c.getElementsByTagName("t")).map((x) => x.textContent ?? "").join("");
          else if (t === "b") texto = valor === "1" ? "TRUE" : "FALSE";
          else texto = valor;
          celdas[i] = texto;
        }
        tabla[r] = Array.from(celdas, (x) => x ?? "");
      }
      return Array.from(tabla, (x) => x ?? []);
    },
  };
}
