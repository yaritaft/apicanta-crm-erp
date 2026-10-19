import { digitosDe, numeroParaWhatsapp, traePais } from "./telefonos-wpp";

/* ==================================================================
   El teléfono de una persona, para llevárselo: copiarlo o abrir su chat de
   WhatsApp. Es lo que se hace con él el 100% de las veces (Dante, 19/10:
   «poder copiar el número e ir directamente a la conversación de
   WhatsApp»), y estaba armado a mano en cada pantalla: la ficha limpiaba los
   dígitos de una manera, el CRM de otra, y el cierre del día no lo mostraba.
   Todo pasa por acá (y por components/ui/Telefono.tsx), así que un número
   sin código de país se resuelve igual en todos lados.
   ================================================================== */

/* En un mismo campo puede haber dos números («11 5555-1234 / 11 4444-3333»). */
const SEPARADOR = /[\n/;|]|\s+y\s+|\s+o\s+/i;

/** El primer número de lo que se escribió (el que se abre en WhatsApp). */
const primero = (crudo: string) => crudo.split(SEPARADOR)[0]?.trim() ?? "";

/** El enlace al chat de WhatsApp de ese número, o `null` si no alcanza para abrirlo.
    `pais` es el país de la persona (texto libre): ayuda cuando el número no trae el código. */
export function enlaceWhatsapp(crudo: string | null | undefined, pais?: string | null): string | null {
  const t = String(crudo ?? "").trim();
  if (!t) return null;
  const d = numeroParaWhatsapp(primero(t), pais);
  return d.length >= 7 ? `https://wa.me/${d}` : null;
}

/** Lo que queda en el portapapeles al tocar el número: con el código de país y el «+» si se
    sabe (se pega directo en la búsqueda de WhatsApp), y si no, tal cual está cargado. */
export function numeroParaCopiar(crudo: string | null | undefined, pais?: string | null): string {
  const t = String(crudo ?? "").trim();
  if (!t) return "";
  if (SEPARADOR.test(t)) return t;
  const n = numeroParaWhatsapp(t, pais);
  return n.length >= 7 && (traePais(t) || n !== digitosDe(t)) ? `+${n}` : t;
}
