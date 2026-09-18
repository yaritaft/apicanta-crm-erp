"use client";

import React, { useEffect, useState } from "react";

/* Apicanta guarda los datos en el navegador y muestra horas relativas
   ("hace 2 h"), así que el HTML del servidor nunca puede coincidir con el
   del cliente. En vez de pelear con eso, el servidor entrega el esqueleto
   y la app se monta una sola vez, ya en el navegador. */
export function SoloCliente({ children, esqueleto }: { children: React.ReactNode; esqueleto: React.ReactNode }) {
  const [montado, setMontado] = useState(false);
  useEffect(() => { setMontado(true); }, []);
  return <>{montado ? children : esqueleto}</>;
}
