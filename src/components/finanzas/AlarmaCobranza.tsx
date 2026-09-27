"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { alarmaCobranza } from "@/lib/finanzas";
import { money } from "@/lib/format";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   La alarma de cobranza: salta sola en el Dashboard y en Finanzas en
   cuanto alguien pasa los 7 días de atraso, con cuántos van por 15 y
   por 20 y quién es el más atrasado. El detalle, en Finanzas → Detalle.
   ================================================================== */

export function AlarmaCobranza({ e }: { e: EstadoApp }) {
  const a = useMemo(() => alarmaCobranza(e), [e]);
  if (a.clientes[7] === 0) return null;
  const n = a.clientes[7];
  return (
    <div className="alarma" role="alert">
      <AlertTriangle size={18} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="alarma__titulo">
          {n === 1 ? "Un cliente atrasado" : `${n} clientes atrasados`} hace 7 días o más
        </div>
        <div className="alarma__texto">
          {n === 1 ? "Debe" : "Deben"} <strong className="t-num">{money(a.saldo, e.ajustes.monedaBase)}</strong>
          {a.clientes[15] > 0 && <> · {a.clientes[15]} pasaron los 15 días</>}
          {a.clientes[20] > 0 && <>{a.clientes[15] > 0 ? " y " : " · "}<strong>{a.clientes[20]} los 20</strong></>}
          {a.peor && <> · el más atrasado es {a.peor.contacto}, con <strong>{a.peor.diasAtraso} días</strong></>}.
        </div>
      </div>
      <Link href="/finanzas/detalle?atraso=7" className="hk-btn hk-btn--secondary hk-btn--sm">Ver quién debe</Link>
    </div>
  );
}
