"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/* Una pantalla puede poner sus acciones en la barra de arriba, a la
   izquierda de Buscar. El Shell deja el lugar vacío; la pantalla lo llena
   mientras está abierta y al irse se lleva lo suyo. */
export const ID_ACCIONES_TOPBAR = "topbar-acciones";

export function AccionesTopbar({ children }: { children: React.ReactNode }) {
  const [destino, setDestino] = useState<HTMLElement | null>(null);
  useEffect(() => { setDestino(document.getElementById(ID_ACCIONES_TOPBAR)); }, []);
  return destino ? createPortal(children, destino) : null;
}
