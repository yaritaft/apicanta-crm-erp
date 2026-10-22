/* Reglas de la persona, compartidas entre el navegador y el servidor.

   El store (lo que carga alguien del equipo) y la entrada de Calendly (que
   corre en el servidor, sin sesión) tienen que decidir igual cuándo un dato
   de un contacto se completa y cuándo se respeta. Si cada lado tuviera su
   versión, un teléfono cargado a mano podría quedar pisado por el formulario
   de Calendly — o al revés, nunca completarse. Por eso viven acá, y no dentro
   de `store.ts`, que el servidor no puede importar. */

/* Vacío NO es un dato. Un input de React manda "" cuando está vacío, nunca
   undefined: con `??` un teléfono en "" no se completaba jamás. */
export const lleno = (v: unknown): boolean => v !== undefined && v !== null && v !== "";

/* Se queda con lo que ya había; sólo usa lo nuevo para llenar un hueco. */
export const completar = <T,>(ya: T, nuevo: T): T => (lleno(ya) ? ya : nuevo);

/* Los caracteres que no se ven y viajan pegados al copiar de un Excel o de WhatsApp (marcas de dirección, espacios de ancho
   cero): «‪‬nacho@…» y «nacho@…» se ven iguales y no lo son, y así una persona quedaba dos veces (22/10). */
const INVISIBLES = /[​-‏‪-‮⁠-⁤﻿]/g;

/* El mail como hay que guardarlo: sin invisibles ni espacios alrededor. */
export const limpiarEmail = (email: string | undefined | null): string =>
  (email ?? "").replace(INVISIBLES, "").trim();

/* El mismo email con otras mayúsculas, espacios o invisibles es la misma persona. */
export const claveEmail = (email: string | undefined | null): string =>
  limpiarEmail(email).toLowerCase();
