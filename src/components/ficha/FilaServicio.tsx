"use client";

import React from "react";

/* ==================================================================
   Las filas de la vista Servicio de la ficha (hoja-servicio.css) para
   las solapas que viven en otros archivos, como Contrato y Accesos
   (Juan Cruz, 21/10: «que esté todo con la misma visual»): el ícono y
   el rótulo a la izquierda, el dato o el estado pintado a la derecha.
   Son las mismas Fila y Bloque de HojaServicio, con un renglón chico
   opcional abajo del rótulo y lugar para un botón al lado del estado.
   ================================================================== */

export function FilaServicio({ icono, rotulo, detalle, children }: {
  icono?: React.ReactNode; rotulo: React.ReactNode; detalle?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className="hs-fila">
      <span className="hs-fila__rot">
        <span className="hs-fila__ico" aria-hidden>{icono}</span>
        <span className="hs-fila__txt">{rotulo}{detalle && <small className="hs-fila__det">{detalle}</small>}</span>
      </span>
      <div className="hs-fila__val"><span className="hs-fila__acc">{children}</span></div>
    </div>
  );
}

/* Una sección de filas con su título chico arriba y, a la derecha del título, un resumen (un estado) si hace falta. */
export function BloqueServicio({ titulo, extra, children }: { titulo?: string; extra?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="hs-bloque">
      {(titulo || extra) && (
        <div className="hs-bloque__cab">
          {titulo && <span className="hs-bloque__tit">{titulo}</span>}
          {extra}
        </div>
      )}
      <div className="hs-filas">{children}</div>
    </section>
  );
}

/* Los botones de la solapa, arriba a la derecha (como «Lo contacté» en la cabecera). */
export function AccionesServicio({ children }: { children: React.ReactNode }) {
  return <div className="hs-acciones">{children}</div>;
}
