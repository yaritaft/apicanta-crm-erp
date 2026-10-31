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
  /* El escalón más alto con alguien adentro: son los que tendrían que tener a alguien encima. */
  const escalon = [...UMBRALES_ATRASO].reverse().find((d) => d > 7 && a.clientes[d] > 0);
  return (
    <div className="alarma" role="alert">
      <AlertTriangle size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="alarma__titulo">
          {n === 1 ? "Un cliente atrasado debe" : `${n} clientes atrasados deben`} <span className="t-num">{money(a.saldo, e.ajustes.monedaBase)}</span>
        </div>
        <div className="alarma__texto">
          {escalon ? <>{a.clientes[escalon]} hace más de {escalon} días</> : "Hace 7 días o más"}
          {a.peor && <> · el más atrasado: {a.peor.contacto}, {a.peor.diasAtraso} días</>}
        </div>
      </div>
      <Link href="/finanzas/detalle?atraso=7" className="hk-btn hk-btn--secondary hk-btn--sm">Ver quién debe</Link>
    </div>
  );
}
