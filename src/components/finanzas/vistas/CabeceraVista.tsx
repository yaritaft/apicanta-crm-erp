"use client";

import React from "react";
import { PageHead } from "@/components/shell/PageHead";

/* La cabecera de una pantalla de Finanzas. Suelta, es la de siempre; metida adentro de un paso del camino, se
   queda sólo con sus botones (el título y la explicación ya los da el paso). */
export function CabeceraVista({ embebido, titulo, sub, acciones }: { embebido: boolean; titulo: string; sub: string; acciones?: React.ReactNode }) {
  if (!embebido) return <PageHead titulo={titulo} sub={sub} acciones={acciones} />;
  return acciones ? <div className="row-wrap" style={{ justifyContent: "flex-end", gap: "var(--space-2)" }}>{acciones}</div> : null;
}
