import { claveEmail } from "./contactos";
import { personaDe } from "./persona";
import type { Alumno, EstadoApp, ID, Resell } from "./types";

/* ==================================================================
   A qué ficha lleva una llamada de resell.

   Abrir una ficha por un id que esta cuenta no puede resolver deja el cartel «No encontramos a esta persona» (le pasó a Lili el 19/11: la
   llamada la lee sólo quien ve Ventas o el CRM, y ella no). Por eso nunca se navega a ciegas: se prueba cada camino contra lo que ESTA cuenta
   tiene cargado (personaDe) y se elige el primero que resuelve. Si ninguno resuelve, no hay a dónde ir y el botón lo dice.

   El alumno primero (ahí están sus llamadas de resell, en Servicio → Testimonio); si no es alumno, la persona: la de la llamada (quien la
   puede leer, como el closer), la que guardó la base o la del mismo mail.
   ================================================================== */

export interface DestinoDeFicha {
  id: ID;
  vista: "servicio" | "llamadas";
  hoja?: "testimonio";
}

export function destinoDeResell(e: EstadoApp, r: Pick<Resell, "email" | "sesionId"> & Partial<Pick<Resell, "contactoId">>, alumno?: Alumno): DestinoDeFicha | null {
  if (alumno && personaDe(e, alumno.id)) return { id: alumno.id, vista: "servicio", hoja: "testimonio" };
  const k = claveEmail(r.email);
  const delMail = k ? e.contactos.find((c) => claveEmail(c.email) === k)?.id : undefined;
  for (const id of [r.sesionId, r.contactoId, delMail]) {
    if (id && personaDe(e, id)) return { id, vista: "llamadas" };
  }
  return null;
}
