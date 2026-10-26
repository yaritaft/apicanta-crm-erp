/* ==================================================================
   Un .zip armado en el navegador (o en las pruebas), sin librerías: cada
   archivo con su nombre en UTF-8, comprimido con deflate si el navegador
   sabe (CompressionStream) y sin comprimir si no. Para bajar muchos archivos
   de una (las transcripciones de un webinar). Hasta 65.535 archivos y 4 GB.
   ================================================================== */

export interface ArchivoZip { nombre: string; contenido: string | Uint8Array }

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const flujo = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(flujo).arrayBuffer());
  } catch { return null; }
}

/** Los archivos como un .zip. */
export async function crearZip(archivos: ArchivoZip[], ahora: Date = new Date()): Promise<Uint8Array> {
  const texto = new TextEncoder();
  /* Hora y fecha en formato DOS (lo que espera el zip). */
  const hora = (ahora.getHours() << 11) | (ahora.getMinutes() << 5) | (ahora.getSeconds() >> 1);
  const dia = (Math.max(0, ahora.getFullYear() - 1980) << 9) | ((ahora.getMonth() + 1) << 5) | ahora.getDate();

  const partes: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let posicion = 0;

  for (const a of archivos) {
    const nombre = texto.encode(a.nombre);
    const original = typeof a.contenido === "string" ? texto.encode(a.contenido) : a.contenido;
    const crc = crc32(original);
    const comprimido = original.length > 0 ? await deflate(original) : null;
    const usa = comprimido && comprimido.length < original.length ? comprimido : null;
    const datos = usa ?? original;
    const metodo = usa ? 8 : 0;

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, metodo, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, datos.length, true);
    local.setUint32(22, original.length, true);
    local.setUint16(26, nombre.length, true);
    local.setUint16(28, 0, true);
    partes.push(new Uint8Array(local.buffer), nombre, datos);

    const ficha = new DataView(new ArrayBuffer(46));
    ficha.setUint32(0, 0x02014b50, true);
    ficha.setUint16(4, 20, true);
    ficha.setUint16(6, 20, true);
    ficha.setUint16(8, 0x0800, true);
    ficha.setUint16(10, metodo, true);
    ficha.setUint16(12, hora, true);
    ficha.setUint16(14, dia, true);
    ficha.setUint32(16, crc, true);
    ficha.setUint32(20, datos.length, true);
    ficha.setUint32(24, original.length, true);
    ficha.setUint16(28, nombre.length, true);
    ficha.setUint32(42, posicion, true);
    central.push(new Uint8Array(ficha.buffer), nombre);

    posicion += 30 + nombre.length + datos.length;
  }

  const tamCentral = central.reduce((n, x) => n + x.length, 0);
  const fin = new DataView(new ArrayBuffer(22));
  fin.setUint32(0, 0x06054b50, true);
  fin.setUint16(8, archivos.length, true);
  fin.setUint16(10, archivos.length, true);
  fin.setUint32(12, tamCentral, true);
  fin.setUint32(16, posicion, true);

  const todo = [...partes, ...central, new Uint8Array(fin.buffer)];
  const salida = new Uint8Array(todo.reduce((n, x) => n + x.length, 0));
  let p = 0;
  for (const x of todo) { salida.set(x, p); p += x.length; }
  return salida;
}
