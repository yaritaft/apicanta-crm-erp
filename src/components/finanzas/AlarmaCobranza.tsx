"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { alarmaCobranza, UMBRALES_ATRASO } from "@/lib/finanzas";
import { money } from "@/lib/format";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   La alarma de cobranza: salta sola en el Dashboard y en Finanzas en
   cuanto alguien pasa los 7 días de atraso, con cuántos van por 10, 12,
   15 y 20 y quién es el más atrasado. El detalle, en Finanzas → Detalle.
   ================================================================== */

export function AlarmaCobranza({ e }: { e: EstadoApp }) {
  const a = useMemo(() => alarmaCobranza(e), [e]);
  if (a.clientes[7] === 0) return null;
  const n = a.clientes[7];
  /* Los escalones después del primero, con al menos un cliente: «· 5
     pasaron los 10 días, 4 los 12, 3 los 15 y 2 los 20». El último va en
     negrita: son los que tendrían que tener a alguien encima. */
  const ultimo = UMBRALES_ATRASO[UMBRALES_ATRASO.length - 1];
  const tramos = UMBRALES_ATRASO.slice(1).filter((d) => a.clientes[d] > 0);
  return (
    <div className="alarma" role="alert">
      <AlertTriangle size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="alarma__titulo">
          {n === 1 ? "Un cliente atrasado" : `${n} clientes atrasados`} hace 7 días o más
        </div>
        <div className="alarma__texto">
          {n === 1 ? "Debe" : "Deben"} <strong className="t-num">{money(a.saldo, e.ajustes.monedaBase)}</strong>
          {tramos.map((d, i) => {
            const k = a.clientes[d];
            const texto = i === 0 ? `${k} ${k === 1 ? "pasó" : "pasaron"} los ${d} días` : `${k} los ${d}`;
            return (
              <React.Fragment key={d}>
                {i === 0 ? " · " : i === tramos.length - 1 ? " y " : ", "}
                {d === ultimo ? <strong>{texto}</strong> : texto}
              </React.Fragment>
            );
          })}
          {a.peor && <> · el más atrasado es {a.peor.contacto}, con <strong>{a.peor.diasAtraso} días</strong></>}.
        </div>
      </div>
      <Link href="/finanzas/detalle?atraso=7" className="hk-btn hk-btn--secondary hk-btn--sm">Ver quién debe</Link>
    </div>
  );
}
