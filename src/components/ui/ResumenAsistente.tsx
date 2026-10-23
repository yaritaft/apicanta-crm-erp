"use client";

import React from "react";
import "./resumen-asistente.css";

/* ==================================================================
   La última pantalla de un asistente paso a paso (components/ui/Asistente): todo lo que se cargó, un renglón por dato, con «Cambiar»
   para volver a la pantalla de ese dato. Un dato que falta se pinta (ámbar) y dice «Completar». Lo usan las devoluciones y los
   movimientos entre cuentas.
   ================================================================== */

export interface FilaDeResumen {
  etiqueta: string;
  valor: React.ReactNode;
  /* Sin esto, el dato no se cambia desde acá (no hay una pantalla para él). */
  onCambiar?: () => void;
  falta?: boolean;
}

export function ResumenAsistente({ filas }: { filas: FilaDeResumen[] }) {
  return (
    <div className="resumen-asistente">
      {filas.map((f) => (
        <div className="resumen-asistente__fila" key={f.etiqueta} data-falta={f.falta ? "true" : undefined}>
          <span className="resumen-asistente__etiqueta">{f.etiqueta}</span>
          <span className="resumen-asistente__valor">{f.valor}</span>
          {f.onCambiar ? <button type="button" className="link t-sm" onClick={f.onCambiar}>{f.falta ? "Completar" : "Cambiar"}</button> : <span />}
        </div>
      ))}
    </div>
  );
}
