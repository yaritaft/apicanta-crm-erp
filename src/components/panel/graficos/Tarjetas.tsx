"use client";

import React from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { InfoMetrica, type ComponenteMetrica } from "@/components/ui/InfoMetrica";
import { formatear, variacionKpi, type ExplicarKpis } from "@/components/panel/TablaKpis";
import { money, num, pct } from "@/lib/format";
import { valorEn, type DefKpi, type FormatoKpi } from "@/lib/kpis";
import { componentesDe, explicacionDe } from "@/lib/kpis-formulas";
import { piezasDeTicket, TEXTOS, type Medidas, type QueSeVe } from "@/lib/kpis-graficos";
import type { Moneda } from "@/lib/types";
import { BORDE_CC, BORDE_REVENUE, COLOR_CC, COLOR_REVENUE, Forma, InfoGrafico } from "./comun";

/* Las cifras de arriba: los totales del período, los mismos de la columna
   «Total» de la tabla. Con «Comparar períodos», cuánto cambiaron contra el
   período anterior, con la misma cuenta que la tabla (variacionKpi). */

/** La variación de un número contra el paso anterior, como en la tabla. */
export function Variacion({ def, actual, previo, antes, moneda }: { def: DefKpi; actual: number | null; previo: number | null | undefined; antes?: string; moneda: Moneda }) {
  const v = variacionKpi(def, actual, previo ?? null);
  if (!v || previo === null || previo === undefined) return null;
  const Flecha = v.texto.startsWith("+") ? ArrowUpRight : v.texto.startsWith("−") ? ArrowDownRight : null;
  return (
    <span className={`kpis__delta${v.tono !== "neutral" ? ` kpis__delta--${v.tono}` : ""}`} title={`Antes: ${formatear(previo, def.formato, moneda)}${antes ? ` (${antes})` : ""}`}>
      {Flecha && <Flecha size={12} aria-hidden />}
      {v.texto}
    </span>
  );
}

/* El ícono de una fila de la tabla: la misma explicación y los mismos números
   que el de la tabla (lib/kpis-formulas), con los del Total. */
function InfoDeFila({ id, explicar, moneda }: { id: string; explicar: ExplicarKpis; moneda: Moneda }) {
  const def = explicar.porId.get(id);
  if (!def) return null;
  const ex = explicacionDe(def);
  const texto = (v: number | null, f: FormatoKpi) => (v === null ? "—" : f === "moneda" || f === "resultado" ? money(v, moneda, 2) : formatear(v, f, moneda));
  return (
    <InfoMetrica
      titulo={def.etiqueta} ayuda={def.ayuda} formula={ex?.formula} ejemplo={ex?.ejemplo} periodo={explicar.periodo}
      componentes={(): ComponenteMetrica[] | null => {
        const piezas = componentesDe(def, explicar.ctx, explicar.porId);
        if (!piezas) return null;
        return [
          ...piezas.map((p): ComponenteMetrica => ({ concepto: p.concepto, valor: texto(p.valor, p.formato), signo: p.signo, nota: p.nota })),
          { concepto: def.etiqueta, valor: texto(valorEn(def, explicar.ctx), def.formato), signo: "=" },
        ];
      }}
    />
  );
}

export function Tarjetas({ actual, previo, comparar, moneda, ve, explicar, cobros }: {
  actual: Medidas;
  previo?: Medidas;
  comparar: boolean;
  moneda: Moneda;
  ve: QueSeVe;
  explicar: ExplicarKpis;
  /* Cuántos pagos hay detrás del CC. */
  cobros: number;
}) {
  const def = (id: string) => explicar.porId.get(id)!;
  const vs = (id: string, a: number | null, p: number | null | undefined) => (comparar && previo ? <Variacion def={def(id)} actual={a} previo={p} moneda={moneda} /> : null);
  const ventas = `${num(actual.ventas)} ${actual.ventas === 1 ? "venta" : "ventas"}`;

  return (
    <section className="gr-resumen" aria-label="Los totales del período, como en la tabla">
      {ve.revenue && (
        <Tarjeta
          marca={<Forma forma="circulo" color={COLOR_REVENUE} borde={BORDE_REVENUE} />}
          etiqueta="Revenue" info={<InfoDeFila id="v_fact" explicar={explicar} moneda={moneda} />}
          valor={money(actual.revenue, moneda, 0)} delta={vs("v_fact", actual.revenue, previo?.revenue)} sub={ventas}
        />
      )}
      {ve.cc && (
        <Tarjeta
          marca={<Forma forma="rombo" color={COLOR_CC} borde={BORDE_CC} />}
          etiqueta="Cash Collected (CC)" info={<InfoDeFila id="c_cc" explicar={explicar} moneda={moneda} />}
          valor={money(actual.cc, moneda, 0)} delta={vs("c_cc", actual.cc, previo?.cc)} sub={`${num(cobros)} ${cobros === 1 ? "cobro" : "cobros"}`}
        />
      )}
      {ve.tasaCobro && (
        <Tarjeta
          etiqueta="Tasa de cobro" info={<InfoDeFila id="c_tasa" explicar={explicar} moneda={moneda} />}
          valor={actual.tasaCobro === null ? "—" : pct(actual.tasaCobro, 1)} delta={vs("c_tasa", actual.tasaCobro, previo?.tasaCobro)} sub="CC ÷ Revenue"
        />
      )}
      {ve.unidades && (
        <Tarjeta
          etiqueta="Ventas" info={<InfoDeFila id="v_n" explicar={explicar} moneda={moneda} />}
          valor={num(actual.ventas)} delta={vs("v_n", actual.ventas, previo?.ventas)} sub="sin canceladas ni reservas"
        />
      )}
      {ve.ticketRev && (
        <Tarjeta
          marca={<Forma forma="circulo" color={COLOR_REVENUE} borde={BORDE_REVENUE} />}
          etiqueta="Ticket sobre Revenue" info={<InfoGrafico texto={TEXTOS.ticketRev} moneda={moneda} periodo={explicar.periodo} piezas={() => piezasDeTicket(actual, "revenue")} />}
          valor={actual.ticketRev === null ? "—" : money(actual.ticketRev, moneda, 0)} delta={vs("v_ticket", actual.ticketRev, previo?.ticketRev)} sub="Revenue ÷ ventas"
        />
      )}
      {ve.ticketCC && (
        <Tarjeta
          marca={<Forma forma="rombo" color={COLOR_CC} borde={BORDE_CC} />}
          etiqueta="Ticket sobre CC" info={<InfoGrafico texto={TEXTOS.ticketCC} moneda={moneda} periodo={explicar.periodo} piezas={() => piezasDeTicket(actual, "cc")} />}
          valor={actual.ticketCC === null ? "—" : money(actual.ticketCC, moneda, 0)} delta={vs("v_ticket", actual.ticketCC, previo?.ticketCC)} sub="CC ÷ ventas"
        />
      )}
    </section>
  );
}

function Tarjeta({ marca, etiqueta, info, valor, delta, sub }: {
  marca?: React.ReactNode; etiqueta: string; info: React.ReactNode; valor: string; delta?: React.ReactNode; sub?: string;
}) {
  return (
    <div className="hk-card hk-stat gr-tarjeta">
      <span className="hk-stat__label">{marca}<span className="gr-tarjeta__texto">{etiqueta}</span>{info}</span>
      <span className="hk-stat__value">{valor}</span>
      <span className="hk-stat__meta">{delta}{sub && <span>{sub}</span>}</span>
    </div>
  );
}
