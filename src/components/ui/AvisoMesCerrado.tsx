"use client";

import React from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { useEstado } from "@/lib/store";
import { mesCerradoDe, primerDiaDe } from "@/lib/mes-cerrado";

/* ==================================================================
   El aviso de «ese mes ya está cerrado» (D5: se avisa, no se bloquea).

   Se muestra debajo de la fecha cuando lo que se está cargando o editando
   cae en un mes con la liquidación cerrada. Dice qué pasa en cada caso y,
   si quien lo usa sabe pasarlo al mes que sigue, ofrece hacerlo.
   ================================================================== */

export type QueSeCarga = "gasto" | "devolucion" | "cobro";

const QUE_PASA: Record<QueSeCarga, (mes: string, siguiente: string) => string> = {
  gasto: (mes, siguiente) =>
    `Este gasto va a ${mes} en el estado de resultados: cambia el profit de ${mes}, pero la liquidación cerrada no se reescribe. Si preferís que no mueva ${mes}, pasalo a ${siguiente}: la plata sale de la caja igual el día que se pagó.`,
  devolucion: (mes, siguiente) =>
    `La devolución resta en Finanzas con la fecha que pusiste (${mes}), pero lo que se le descuenta al closer entra en la liquidación de ${siguiente}: lo cerrado no se reescribe.`,
  cobro: (mes, siguiente) =>
    `Este cobro suma a ${mes} (Cash Collected y comisiones), pero la liquidación cerrada no cambia. La diferencia se puede sumar a mano en la liquidación de ${siguiente}.`,
};

export function AvisoMesCerrado({ fecha, que, onPasar }: {
  fecha?: string | null;
  que: QueSeCarga;
  /* Pasa lo que se carga al mes abierto que sigue: recibe su primer día. */
  onPasar?: (fechaIso: string) => void;
}) {
  const e = useEstado();
  const cerrado = mesCerradoDe(e, fecha);
  if (!cerrado) return null;
  return (
    <div className="mes-cerrado" role="note">
      <Lock size={16} aria-hidden />
      <div className="mes-cerrado__texto">
        <div className="mes-cerrado__titulo">La liquidación de {cerrado.nombre} ya está cerrada</div>
        <div>{QUE_PASA[que](cerrado.nombre, cerrado.nombreSiguiente)}</div>
        {onPasar && (
          <Button sm variante="secondary" onClick={() => onPasar(primerDiaDe(cerrado.siguiente))}>
            Pasarlo a {cerrado.nombreSiguiente}
          </Button>
        )}
      </div>
    </div>
  );
}
