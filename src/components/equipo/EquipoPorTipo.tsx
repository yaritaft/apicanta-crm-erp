"use client";

import React, { useMemo } from "react";
import { equipoPorTipo } from "@/lib/equipo-por-tipo";
import { plata } from "@/lib/honorarios";
import type { EstadoApp, ResultadoLiquidacion } from "@/lib/types";

/* ==================================================================
   «El equipo, por tipo de pago» (Aldana, 28/10): los fijos y las comisiones
   por separado, con lo que calcula la liquidación. Es sólo una forma de
   mirar lo mismo que «Persona por persona»: para cambiar algo, se cambia
   en la persona.
   ================================================================== */

export function EquipoPorTipo({ e, r }: { e: EstadoApp; r: ResultadoLiquidacion }) {
  const base = e.ajustes.monedaBase;
  const t = useMemo(() => equipoPorTipo(r.personas, e.equipo), [r.personas, e.equipo]);
  if (t.grupos.length === 0) return null;
  return (
    <>
      <div className="eq-tipo">
        {t.grupos.map((g) => (
          <section key={g.id} className="eq-tipo__grupo" aria-label={g.titulo}>
            <header className="eq-tipo__cab" title={g.ayuda}>
              <div>
                <h4 className="eq-tipo__titulo">{g.titulo}</h4>
              </div>
              <b className="t-num">{plata(g.total, base)}</b>
            </header>
            <ul className="eq-tipo__filas">
              {g.filas.map((f) => (
                <li key={f.miembroId} className="eq-tipo__fila">
                  <div className="eq-tipo__quien">
                    <span className="t-strong">{f.nombre}</span>
                    {f.puesto && <span className="t-sm t-subtle">{f.puesto}</span>}
                  </div>
                  <span className="t-sm t-muted eq-tipo__partes">
                    {f.partes.map((p, i) => (
                      <React.Fragment key={i}>{i > 0 ? " · " : ""}{p.nombre} <span className="t-num">{plata(p.monto, base)}</span></React.Fragment>
                    ))}
                  </span>
                  <b className="t-num eq-tipo__total">{plata(f.total, base)}</b>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <footer className="eq-tipo__pie">
          <div><span className="t-label">Total del equipo</span><b className="t-num">{plata(t.total, base)}</b></div>
          <div>
            <span className="t-label">Entra en los costos de Agustín y Nahuel</span><b className="t-num">{plata(t.enLosCostos, base)}</b>
            <span className="t-sm t-subtle">Todo menos sus propias comisiones, que se calculan después</span>
          </div>
          {t.sinNada > 0 && <div><span className="t-label">Sin nada para pagar este mes</span><b className="t-num">{t.sinNada}</b></div>}
        </footer>
      </div>
    </>
  );
}
