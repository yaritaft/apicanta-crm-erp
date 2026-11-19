"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { AlertTriangle, Gauge } from "lucide-react";
import { money } from "@/lib/format";
import { topeDeCuentas } from "@/lib/tope-cuentas";
import type { EstadoApp } from "@/lib/types";
import "./vistas/saldos-vista.css";

/* ==================================================================
   El tope de la Financiera (Aldana, 19/11): entre Financiera ARS, Financiera USD y dLocal nunca tendría que haber más de US$ 50.000 (se retira lo que
   pase). Se marca en rojo cuando se pasa, en ámbar cuando se acerca (desde el 90%) y, en la pantalla de Saldos, siempre se ve cuánto falta.
   La cuenta es lib/tope-cuentas.ts (la misma de Saldos); el aviso en la campanita lo manda components/avisos/useAvisoDeTope.ts.
   ================================================================== */

export function AlertaTope({ e, siempre = false, conLink = true }: {
  e: EstadoApp;
  /* En Saldos se ve siempre, aunque falte mucho; en el resto sólo cuando hay algo que decir. */
  siempre?: boolean;
  /* Dónde ver el detalle de cada cuenta (no hace falta si ya se está en Saldos). */
  conLink?: boolean;
}) {
  const t = useMemo(() => topeDeCuentas(e, new Date().toISOString()), [e]);
  if (t.cuentas.length === 0) return null;
  const M = (n: number) => money(n, t.base, 0);
  const pct = Math.round(t.proporcion * 100);
  const detalle = t.cuentas.map((c) => `${c.nombre} ${c.saldoBase !== undefined ? M(c.saldoBase) : "sin dato"}`).join(" · ");

  if (t.faltaCambio) {
    return (
      <div className="alarma alarma--atencion" role="status" data-tope="sin-cambio">
        <AlertTriangle size={18} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="alarma__titulo">No se puede controlar el tope de la Financiera</div>
          <div className="alarma__texto">Falta el tipo de cambio en Ajustes: sin él no se pueden sumar los pesos de la Financiera ARS.</div>
        </div>
      </div>
    );
  }

  if (t.excede || t.seAcerca) {
    const rojo = t.excede;
    return (
      <div className={`alarma${rojo ? "" : " alarma--atencion"}`} role={rojo ? "alert" : "status"} data-tope={rojo ? "excede" : "cerca"}>
        <AlertTriangle size={18} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="alarma__titulo">
            {rojo ? "Financiera y dLocal pasaron el tope: " : "Financiera y dLocal se acercan al tope: "}
            <span className="t-num">{M(t.total)}</span> de <span className="t-num">{M(t.limite)}</span> ({pct}%)
          </div>
          <div className="alarma__texto">
            {rojo ? <>Se pasan por <b className="t-num">{M(t.exceso)}</b>: hay que avisar y hacer un retiro. </> : <>Faltan <b className="t-num">{M(t.falta)}</b> para el tope. </>}
            {detalle}
            {t.parciales.length > 0 && <> · {t.parciales.join(" y ")} {t.parciales.length === 1 ? "no estaba" : "no estaban"} en el último arqueo: sólo cuenta lo que se movió desde entonces</>}
          </div>
        </div>
        {conLink && <Link href="/finanzas/saldos" className="hk-btn hk-btn--secondary hk-btn--sm">Ver saldos</Link>}
      </div>
    );
  }

  if (!siempre) return null;
  return (
    <div className="sd-tope" data-tope="bajo">
      <div className="sd-tope__fila">
        <Gauge size={16} aria-hidden />
        <span className="sd-tope__titulo">Tope de la Financiera</span>
        <span className="sd-tope__valor"><b className="t-num">{M(t.total)}</b> de {M(t.limite)} · {pct}%</span>
      </div>
      <div className="sd-tope__pista" role="img" aria-label={`${pct}% del tope`}><div className="sd-tope__relleno" style={{ width: `${Math.min(pct, 100)}%` }} /></div>
      <div className="sd-tope__sub">{detalle}. Faltan <span className="t-num">{M(t.falta)}</span> para llegar al tope.</div>
    </div>
  );
}
