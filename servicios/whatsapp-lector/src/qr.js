/* ==================================================================
   El código QR como imagen.

   Para vincular el número, WhatsApp da un texto que se dibuja como código QR
   y se escanea con el teléfono. En vez de dibujarlo en la terminal del
   servidor, el lector lo convierte en una imagen (un SVG, como data URL) y se
   la manda a la app, que la muestra en Ajustes → WhatsApp.

   Es una credencial: quien lo escanea lee ese WhatsApp. Nunca a un registro.
   ================================================================== */

/** Arma el generador con la librería `qrcode`. Si no está instalada, null. `importar` se pasa
    de afuera en las pruebas. */
export async function cargarGeneradorQr({ importar = () => import('qrcode') } = {}) {
  let QRCode;
  try {
    const modulo = await importar();
    QRCode = modulo.default ?? modulo;
    /* Todo objeto tiene un toString heredado: el que sirve es el de la librería. */
    if (typeof QRCode?.toString !== 'function' || QRCode.toString === Object.prototype.toString) return null;
  } catch {
    return null;
  }
  return async (texto) => {
    /* Corrección de errores baja y margen de 4 módulos: el más fácil de leer desde una pantalla. */
    const svg = await QRCode.toString(String(texto), { type: 'svg', errorCorrectionLevel: 'L', margin: 4 });
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  };
}

/* Un dibujo con la pinta de un código QR (los tres cuadrados de las esquinas y puntos que dependen del
   texto), para probar el modo simulado cuando `qrcode` no está instalado. NO se puede escanear, y lo dice. */
export function imagenDeMentira(texto) {
  const N = 29;
  let h = 2166136261;
  for (const c of String(texto)) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  /* Los tres cuadrados de las esquinas (7 × 7, con su borde blanco de 1) y, en el resto, puntos según el texto. */
  const esquinas = [[0, 0], [N - 7, 0], [0, N - 7]];
  const zona = (x, y, ox, oy) => x >= ox - 1 && x <= ox + 7 && y >= oy - 1 && y <= oy + 7;
  const negroDelCuadrado = (x, y, ox, oy) => {
    const dx = x - ox, dy = y - oy;
    return dx === 0 || dx === 6 || dy === 0 || dy === 6 || (dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4);
  };
  const celdas = [];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const esquina = esquinas.find(([ox, oy]) => zona(x, y, ox, oy));
      let negro;
      if (esquina) {
        const [ox, oy] = esquina;
        negro = x >= ox && x < ox + 7 && y >= oy && y < oy + 7 && negroDelCuadrado(x, y, ox, oy);
      } else {
        h = Math.imul(h ^ (x * 31 + y), 16777619) >>> 0;
        negro = (h >>> 7) % 2 === 0;
      }
      if (negro) celdas.push(`M${x + 4} ${y + 4}h1v1h-1z`);
    }
  }
  const lado = N + 8;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${lado} ${lado + 3}" shape-rendering="crispEdges">`
    + `<rect width="${lado}" height="${lado + 3}" fill="#fff"/><path d="${celdas.join('')}" fill="#000"/>`
    + `<text x="${lado / 2}" y="${lado + 1.6}" font-family="sans-serif" font-size="2.2" text-anchor="middle" fill="#b00">QR DE PRUEBA (no se escanea)</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}
