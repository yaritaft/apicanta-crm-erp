"use client";

import { acciones } from "@/lib/store";
import { CAMPO_MANUAL, type CampoManual } from "@/lib/webinar";
import type { Webinar } from "@/lib/types";

/* ==================================================================
   Las escrituras de un webinar, en un solo lugar para la planilla y la
   ficha.

   Cada número que se carga queda en la actividad con el antes y el
   después: con varias personas actualizando lo mismo día a día,
   "¿quién puso 410 formularios?" es una pregunta que se va a hacer.
   ================================================================== */

export function guardarMetrica(w: Webinar, campo: CampoManual, n: number, formato: (n: number) => string) {
  const antes = w[campo];
  if (antes === n) return;
  /* `registrados` es el nombre viejo de los formularios y lo siguen leyendo
     las metas ("Registrados a webinars"): van siempre juntos. */
  const cambios = (campo === "formularios" ? { formularios: n, registrados: n } : { [campo]: n }) as Partial<Webinar>;
  acciones.actualizar<Webinar>(
    "webinars", w.id, cambios, w.titulo,
    `${CAMPO_MANUAL[campo].largo} de «${w.titulo}»: ${formato(antes)} → ${formato(n)}.`,
  );
}

export function guardarWebinar(w: Webinar, cambios: Partial<Webinar>, detalle: string) {
  acciones.actualizar<Webinar>("webinars", w.id, cambios, cambios.titulo ?? w.titulo, detalle);
}
