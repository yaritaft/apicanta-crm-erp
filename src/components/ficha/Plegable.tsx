"use client";

import React, { useState } from "react";
import { ChevronRight } from "lucide-react";

/* ==================================================================
   Los programas de la ficha (cada venta, cada servicio) se pliegan.

   Tocar la cabeza abre o cierra la tarjeta. El lápiz queda afuera del
   botón: un botón no puede ir adentro de otro. Cada tarjeta arranca
   como diga quien la usa (abierto lo que está en curso, plegado lo que
   ya terminó) y después manda lo que se toque.
   ================================================================== */

export function usePlegado() {
  const [tocadas, setTocadas] = useState<Record<string, boolean>>({});
  return {
    abierta: (id: string, porDefecto: boolean) => tocadas[id] ?? porDefecto,
    alternar: (id: string, porDefecto: boolean) =>
      setTocadas((t) => ({ ...t, [id]: !(t[id] ?? porDefecto) })),
  };
}

export function CabezaPlegable({ abierta, onAlternar, cuerpoId, accion, children }: {
  abierta: boolean; onAlternar: () => void; cuerpoId: string;
  accion?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="venta-card__head">
      <button
        type="button" className="venta-card__toggle" onClick={onAlternar}
        aria-expanded={abierta} aria-controls={abierta ? cuerpoId : undefined}
      >
        <ChevronRight size={16} className="venta-card__chevron" aria-hidden />
        {children}
      </button>
      {accion}
    </div>
  );
}
