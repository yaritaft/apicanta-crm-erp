import { clavesDeTelefono, digitosDe, numeroParaWhatsapp, traePais } from "./telefonos-wpp";
import { telefonoLegible } from "./telefonos";

/* ==================================================================
   El teléfono de una persona, para llevárselo: verlo con su «+» y copiarlo
   para pegarlo en la conversación de WhatsApp. Es lo que se hace con él el
   100% de las veces (Dante y Mariano, closers, 19/10). Estaba armado a mano
   en cada pantalla (la ficha limpiaba los dígitos de una manera, el CRM de
   otra, el cierre del día no lo mostraba), y muchos teléfonos están
   guardados sin el «+» (`54 9 11 3438-0201`, `5491164780489`), a veces con
   marcas invisibles de dirección que el Calendly o el celular dejan al
   copiar («‪57 301 5606277‬»). Todo pasa por acá (y por
   components/ui/Telefono.tsx).

   El botón de WhatsApp que abría `wa.me` en una pestaña nueva se sacó de las
   pantallas de los closers: arrancaba WhatsApp Web de cero y no servía
   (Mariano, 19/10). Se copia el número y se pega en la conversación.
   ================================================================== */

/* En un mismo campo puede haber dos números («11 5555-1234 / 11 4444-3333»). */
const SEPARADOR = /[\n/;|]|\s+y\s+|\s+o\s+/i;

/* Las marcas invisibles de dirección (LRE, PDF, LRM, RLM, aislados…) y el espacio de no separar. */
const INVISIBLES = /[‎‏‪-‮⁦-⁩ ﻿]/g;
const limpio = (crudo: string | null | undefined) => String(crudo ?? "").replace(INVISIBLES, " ").replace(/\s+/g, " ").trim();

/** El enlace al chat de WhatsApp de ese número, o `null` si no alcanza para abrirlo.
    `pais` es el país de la persona (texto libre): ayuda cuando el número no trae el código. */
export function enlaceWhatsapp(crudo: string | null | undefined, pais?: string | null): string | null {
  const t = limpio(crudo);
  if (!t) return null;
  const d = numeroParaWhatsapp(t.split(SEPARADOR)[0]?.trim() ?? "", pais);
  return d.length >= 7 ? `https://wa.me/${d}` : null;
}

/* Los dígitos con el código de país, si se sabe cuál es: porque lo trae («+54…»), o porque la persona tiene país y
   el número es de ahí. Sin eso, `null`: un número sin país no se completa a ciegas. */
function conCodigo(t: string, pais?: string | null): string | null {
  if (!t || SEPARADOR.test(t)) return null;
  if (traePais(t)) return numeroParaWhatsapp(t) || null;
  if (!pais?.trim()) return null;
  const n = numeroParaWhatsapp(t, pais);
  return n.length >= 7 && clavesDeTelefono(t, pais)[0] === n ? n : null;
}

/** Lo que queda en el portapapeles al tocar el número: con el «+» y el código de país si se sabe (se pega directo en la
    conversación de WhatsApp), y si no, tal cual está cargado (sin marcas invisibles). */
export function numeroParaCopiar(crudo: string | null | undefined, pais?: string | null): string {
  const t = limpio(crudo);
  const n = conCodigo(t, pais);
  return n ? `+${n}` : t;
}

/** Cómo se ve el número: siempre con el «+» cuando se sabe el país. Si ya trae «+», tal cual; si trae el código sin el
    «+» (`54 9 11 3438-0201`), se le suma; si es local («11 5750-5283»), se completa con el país de la persona. */
export function numeroParaMostrar(crudo: string | null | undefined, pais?: string | null): string {
  const t = limpio(crudo);
  if (!t || t.startsWith("+")) return t;
  const n = conCodigo(t, pais);
  if (!n) return t;
  return digitosDe(t) === n ? `+${t}` : telefonoLegible(`+${n}`);
}
