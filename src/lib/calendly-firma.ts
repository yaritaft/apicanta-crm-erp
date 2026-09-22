/* La firma de los webhooks de Calendly. Sólo servidor: usa node:crypto, y
   `calendly.ts` lo importan también las pantallas (las etiquetas de canal). */

import { createHmac, timingSafeEqual } from "node:crypto";

/* Un aviso firmado hace más de 3 minutos se rechaza: sin eso, alguien que
   capturó uno lo podría reenviar cuando quisiera. */
const TOLERANCIA_SEG = 180;

export function firmaCalendlyValida(cuerpo: string, cabecera: string | null, clave: string, ahoraSeg = Date.now() / 1000): boolean {
  if (!cabecera) return false;
  const partes = Object.fromEntries(
    cabecera.split(",").map((p) => {
      const i = p.indexOf("=");
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(partes.t);
  if (!partes.t || !partes.v1 || !Number.isFinite(t)) return false;
  if (Math.abs(ahoraSeg - t) > TOLERANCIA_SEG) return false;
  const esperado = Buffer.from(createHmac("sha256", clave).update(`${partes.t}.${cuerpo}`).digest("hex"));
  const recibido = Buffer.from(partes.v1);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
