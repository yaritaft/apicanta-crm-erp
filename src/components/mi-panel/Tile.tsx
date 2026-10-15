import React from "react";

/* Una cifra de plata con el símbolo chico y suave («US$» al lado del número, no de su mismo tamaño): el número manda y
   entra en cualquier tarjeta. Lo que no empieza con una moneda se dibuja tal cual. */
export function Cifra({ texto }: { texto: string }) {
  const m = /^(US\$|\$)\s*(.+)$/.exec(texto);
  if (!m) return <>{texto}</>;
  return <><span className="mp-moneda">{m[1]}</span>{m[2]}</>;
}

/* Un número del panel como una tarjeta propia (estilo widget): lo que es, la cifra grande y una línea de contexto.
   Con `onAbrir` es un botón que abre lo que forma el número. */
export function Tile({ rot, valor, sub, verde, onAbrir }: { rot: string; valor: string; sub: string; verde?: boolean; onAbrir?: () => void }) {
  const sinDato = valor === "Sin dato";
  const cuerpo = (
    <>
      <span className="mp-tile__rot">{rot}</span>
      <span className={`mp-tile__valor${verde ? " mp-tile__valor--verde" : ""}${sinDato ? " mp-tile__valor--chico" : ""}`}><Cifra texto={valor} /></span>
      <span className="mp-tile__sub" title={sub}>{sub}</span>
    </>
  );
  return onAbrir
    ? <button type="button" className="mp-tile" aria-label={`${rot}: ver el detalle`} onClick={onAbrir}>{cuerpo}</button>
    : <div className="mp-tile">{cuerpo}</div>;
}
