"use client";

import React, { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { money, num, pct } from "@/lib/format";
import { desglosePor, DIMENSIONES, moraCategoria, moraDe, piezasDeMora, TEXTOS, type DimensionId } from "@/lib/kpis-graficos";
import type { Contexto } from "@/lib/kpis";
import type { Moneda } from "@/lib/types";
import { CabezaGrafico, InfoGrafico, Selector } from "./comun";
import { Medidor } from "./Medidor";

/* La tasa de mora es una foto de HOY: no tiene serie. Se mira en un medidor y
   repartida por la misma dimensión que el desglose: dónde están las cuotas
   que ya vencieron y siguen sin pagar. */

const TOPE = 5;

export function PanelMora({ ctx, moneda, dim, onDim }: {
  ctx: Contexto; moneda: Moneda; dim: DimensionId; onDim: (d: DimensionId) => void;
}) {
  const mora = useMemo(() => moraDe(ctx), [ctx]);
  const d = useMemo(() => desglosePor(ctx, dim), [ctx, dim]);
  const def = DIMENSIONES.find((x) => x.id === dim)!;
  const [expandido, setExpandido] = useState(false);

  /* Las que ya tienen cuotas vencidas, de más a menos mora; el resto no tiene nada que contar. */
  const filas = useMemo(
    () => d.categorias
      .filter((x) => x.exigibles > 0)
      .sort((a, b) => (moraCategoria(b) ?? 0) - (moraCategoria(a) ?? 0) || b.exigibles - a.exigibles || a.nombre.localeCompare(b.nombre, "es")),
    [d],
  );
  const visibles = expandido ? filas : filas.slice(0, TOPE);

  return (
    <section className="hk-card gr-card" aria-labelledby="gr-mora">
      <CabezaGrafico
        id="gr-mora" titulo="Tasa de mora"
        info={<InfoGrafico texto={TEXTOS.mora} moneda={moneda} piezas={() => piezasDeMora(mora)} periodo="hoy" />}
        sub={<><span className="kpis__hoy" title="Es una foto de hoy, no depende del período">hoy</span> Cuotas que ya vencieron y siguen sin pagar</>}
      />

      <Selector modo="tabs" chico etiqueta="Por qué dimensión repartir la mora" valor={dim} onCambiar={(x) => { onDim(x); setExpandido(false); }} opciones={DIMENSIONES.map((x) => ({ id: x.id, titulo: x.titulo }))} />

      <div className="gr-mora">
        <Medidor
          valor={mora.pct} etiqueta="de mora"
          sub={mora.exigibles ? `${num(mora.vencidas)} de ${num(mora.exigibles)} cuotas vencidas sin pagar${mora.saldo > 0 ? ` · ${money(mora.saldo, moneda, 0)} por cobrar` : ""}` : "Todavía no venció ninguna cuota"}
        />

        <div className="gr-mora__lista">
          <span className="t-label">Mora {def.por}</span>
          {filas.length === 0 ? (
            <p className="gr-vacio">No hay cuotas vencidas para repartir {def.por}.</p>
          ) : (
            <ul className="gr-mora__filas">
              {visibles.map((x) => {
                const m = moraCategoria(x) ?? 0;
                return (
                  <li key={x.clave} className={`gr-mora__fila${x.sinDato ? " gr-fila--sin" : ""}`} title={`${x.nombre}: ${x.vencidas} de ${x.exigibles} cuotas que ya vencieron siguen sin pagar${x.saldoVencido > 0 ? ` (${money(x.saldoVencido, moneda, 0)})` : ""}`}>
                    <span className="truncate gr-mora__nombre">{x.nombre}</span>
                    <span className="gr-mora__pista" aria-hidden><span className="gr-mora__barra" style={{ width: `${Math.max(Math.min(m, 100), m > 0 ? 1.5 : 0)}%` }} /></span>
                    <span className="t-num gr-mora__pct">{pct(m, m >= 10 ? 0 : 1)}</span>
                    <span className="t-num t-sm t-subtle gr-mora__base">{x.vencidas} de {x.exigibles}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {filas.length > TOPE && (
            <button type="button" className="gr-mas" onClick={() => setExpandido((v) => !v)}>
              {expandido ? <><ChevronUp size={14} aria-hidden /> Ver sólo las primeras</> : <><ChevronDown size={14} aria-hidden /> Ver las otras {filas.length - TOPE}</>}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
