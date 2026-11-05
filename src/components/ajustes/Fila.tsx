import React from "react";

/* Una fila de ajuste: qué es a la izquierda, el control a la derecha (Ajustes, desde el 05/11). */
export function Fila({ titulo, sub, children }: { titulo: string; sub?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="aj-fila">
      <div className="aj-fila__textos">
        <span className="aj-fila__titulo">{titulo}</span>
        {sub && <span className="aj-fila__sub">{sub}</span>}
      </div>
      <div className="aj-fila__control">{children}</div>
    </div>
  );
}
