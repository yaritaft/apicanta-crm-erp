"use client";

import { useEffect, useState } from "react";

/* El alto de una tabla con scroll propio: lo que queda de la pantalla debajo de su barra. Así el encabezado queda fijo mientras se baja
   y se sabe qué columna es cuál (Mariano, 21/10: «que esta fila de arriba, cuando bajo, se me quede fijada»). Una tabla corta no se estira. */
export function useAltoTabla(reservado = 330, minimo = 360): number {
  const [alto, setAlto] = useState(720);
  useEffect(() => {
    const medir = () => setAlto(Math.max(minimo, window.innerHeight - reservado));
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [reservado, minimo]);
  return alto;
}
