"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { PartesDeUnTotal } from "@/components/finanzas/visual/visual";
import { mesDeNegocio } from "@/lib/dia-negocio";
import { money, num } from "@/lib/format";
import { moverPeriodo, nombrePeriodo } from "@/lib/periodos";
import { usePendientesDelMes, type DatosDePendientes } from "./usePendientes";
import "./conciliacion.css";

/* ==================================================================
   En el panel del director: cuánto queda sin origen, de este mes y del
   anterior (Aldana, 31/10: «le tendría que aparecer a Santi este panel»).
   Sin pendientes no ocupa lugar. Cada mes abre su lista ahí mismo.
   ================================================================== */

export function TarjetaOrigen({ ahora, onAbrir }: { ahora: number; onAbrir: (mes: string) => void }) {
  const actual = mesDeNegocio(ahora);
  const esteMes = usePendientesDelMes(actual, true, true);
  const anterior = usePendientesDelMes(moverPeriodo(actual, -1), true, true);
  const meses = [anterior, esteMes].filter((d) => d.carga === "listo" && d.resumen.total > 0);
  if (meses.length === 0) return null;
  return (
    <section className="mp-card pc-tarjeta" aria-label="Para conciliar">
      <span className="mp-cap">Para conciliar</span>
      <p className="pc-tarjeta__sub">Sin su origen no se sabe de qué estrategia vino cada una.</p>
      <div className="pc-tarjeta__lista">
        {meses.map((d) => <FilaDelMes key={d.mes} d={d} onAbrir={() => onAbrir(d.mes)} />)}
      </div>
    </section>
  );
}

function FilaDelMes({ d, onAbrir }: { d: DatosDePendientes; onAbrir: () => void }) {
  const { total, conVenta, soloAgenda, montos } = d.resumen;
  const plata = [montos.USD ? money(montos.USD, "USD") : "", montos.ARS ? money(montos.ARS, "ARS") : ""].filter(Boolean).join(" + ");
  return (
    <button type="button" className="pc-tarjeta__fila" onClick={onAbrir} aria-label={`Resolver ${nombrePeriodo(d.mes)}: ${num(total)} pendientes`}>
      <span className="pc-tarjeta__mes">
        <b className="t-num">{num(total)}</b>
        <span className="t-sm t-subtle">{nombrePeriodo(d.mes)}</span>
      </span>
      <span className="pc-tarjeta__partes">
        <PartesDeUnTotal
          etiqueta={`Pendientes de ${nombrePeriodo(d.mes)}`}
          partes={[
            { id: "venta", nombre: "Con venta", valor: conVenta, texto: plata ? `${num(conVenta)} · ${plata}` : num(conVenta), tono: "alerta" as const },
            { id: "agenda", nombre: "Sólo agenda", valor: soloAgenda, texto: num(soloAgenda) },
          ].filter((p) => p.valor > 0)}
        />
      </span>
      <ChevronRight size={18} className="pc-tarjeta__ir" aria-hidden />
    </button>
  );
}
