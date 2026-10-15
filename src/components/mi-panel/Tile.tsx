import React from "react";

/* Un número del panel como una tarjeta propia (estilo widget): lo que es, la cifra grande y una línea de contexto.
   Con `onAbrir` es un botón que abre lo que forma el número. */
export function Tile({ rot, valor, sub, verde, onAbrir }: { rot: string; valor: string; sub: string; verde?: boolean; onAbrir?: () => void }) {
  const sinDato = valor === "Sin dato";
  const cuerpo = (
    <>
      <span className="mp-tile__rot">{rot}</span>
      <span className={`mp-tile__valor${verde ? " mp-tile__valor--verde" : ""}${sinDato ? " mp-tile__valor--chico" : ""}`}>{valor}</span>
      <span className="mp-tile__sub" title={sub}>{sub}</span>
    </>
  );
  return onAbrir
    ? <button type="button" className="mp-tile" aria-label={`${rot}: ver el detalle`} onClick={onAbrir}>{cuerpo}</button>
    : <div className="mp-tile">{cuerpo}</div>;
}
