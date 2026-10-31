"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { useAcceso } from "@/lib/acceso";
import { veLaLiquidacion } from "@/lib/permisos";
import { useChequeos } from "@/lib/chequeos-finanzas";
import { pasosDeFinanzas, periodoActual } from "@/lib/finanzas-pasos";
import type { EstadoApp } from "@/lib/types";
import { Cuenta, Nodo, TEXTO_ESTADO } from "./Nodo";
import "./cierre.css";

/* ==================================================================
   En Conciliación: los pasos del mes que tocan a los cobros y a los bancos,
   con su estado, para que ningún cobro se quede sin atar o sin validar. Cada
   uno abre su lugar en Finanzas → Pasos.
   ================================================================== */

export function PasosDeConciliacion({ e }: { e: EstadoApp }) {
  const { acceso } = useAcceso();
  const esDueno = veLaLiquidacion(acceso);
  const { chequeos } = useChequeos();
  const mes = periodoActual("mes");
  const pasos = useMemo(() => pasosDeFinanzas(e, "mes", mes, { esDueno, chequeos }), [e, mes, esDueno, chequeos]);
  const delArea = pasos.filter((p) => p.area === "cobros");
  return (
    <section className="cm-banda" aria-label="Pasos para que no se pase nada">
      <div className="cm-pasos-mini">
        {delArea.map((p) => (
          <Link key={p.id} href={`/finanzas?paso=${p.id}`} className="cm-mini" title={`${p.titulo}: ${TEXTO_ESTADO[p.estado].toLowerCase()}`}>
            <Nodo estado={p.estado} n={pasos.indexOf(p) + 1} />
            <span className="cm-mini__titulo">{p.titulo}</span>
            <Cuenta p={p} />
          </Link>
        ))}
        <Link href="/finanzas" className="cm-mini cm-mini--todos">Ver todos<ArrowRight size={15} aria-hidden /></Link>
      </div>
    </section>
  );
}
