"use client";

import React from "react";
import "@/components/finanzas/visual/visual.css";

/* La cabecera de una pantalla de Finanzas: una sola línea con los controles. El nombre y la explicación ya están en la
   barra de arriba de la app, y metida adentro de un paso, en el paso. `izquierda` es lo que elige qué se mira (el período);
   `acciones`, lo que se hace. */
export function CabeceraVista({ embebido, titulo, izquierda, acciones }: { embebido: boolean; titulo: string; izquierda?: React.ReactNode; acciones?: React.ReactNode }) {
  if (embebido) return acciones ? <div className="row-wrap" style={{ justifyContent: "flex-end", gap: "var(--space-2)" }}>{acciones}</div> : null;
  return (
    <>
      <h1 className="sr-only">{titulo}</h1>
      {(izquierda || acciones) && <div className="fz-barra">{izquierda}{acciones && <div className="fz-barra__der">{acciones}</div>}</div>}
    </>
  );
}
