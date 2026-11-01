"use client";

import React, { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { PartesDeUnTotal, type Parte } from "@/components/finanzas/visual/visual";
import { useEscribirURL } from "@/lib/useParamsURL";
import { VACIAS } from "@/lib/crm-tabla";
import { num } from "@/lib/format";
import type { Motor } from "@/lib/tabla-cs";

/* ==================================================================
   Arriba de cada tabla de Customer Success: un número y cómo se reparte. Cada
   parte de la barra filtra la tabla por esa columna, y otro toque saca el filtro.
   Una parte puede juntar varios valores (`grupos`), o ser uno por valor.
   ================================================================== */

export interface GrupoResumen<F> {
  id: string; nombre: string; es: (f: F) => boolean; valores?: (filas: F[]) => string[]; tono?: Parte["tono"]; ayuda?: string;
  /* Una parte que no es un valor de la columna (lo que falta cerrar, lo que viene) se elige a su manera. */
  alElegir?: () => void; elegida?: boolean;
}

export function ResumenCs<F extends { id: string }, K extends string>({ etiqueta, valor, sub, ayuda, motor, columna, filas, grupos, derecha, alFiltrar }: {
  etiqueta: string; valor: React.ReactNode; sub?: React.ReactNode; ayuda?: string;
  motor: Motor<F, K>; columna: K; filas: F[];
  /* Sin grupos, una parte por cada valor de la columna, de la que más tiene a la que menos (hasta 5). */
  grupos?: GrupoResumen<F>[];
  derecha?: React.ReactNode;
  /* Lo que se saca de la URL al elegir una parte: las partes se excluyen entre sí. */
  alFiltrar?: Record<string, null>;
}) {
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const col = motor.columna[columna];
  const partes = useMemo(() => {
    if (grupos) {
      return grupos.map((g) => {
        const suyas = filas.filter(g.es);
        const valores = g.valores ? g.valores(suyas) : [...new Set(suyas.flatMap((f) => col.valores(f)))];
        return { id: g.id, nombre: g.nombre, valor: suyas.length, valores, tono: g.tono, ayuda: g.ayuda, alElegir: g.alElegir, elegida: g.elegida };
      }).filter((g) => g.valor > 0);
    }
    const cuenta = new Map<string, number>();
    for (const f of filas) { const v = col.valores(f)[0] ?? ""; cuenta.set(v, (cuenta.get(v) ?? 0) + 1); }
    return [...cuenta].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([v, n]) => ({ id: v, nombre: !v || v === VACIAS ? "Sin cargar" : v, valor: n, valores: [v], tono: undefined, ayuda: undefined, alElegir: undefined, elegida: undefined }));
  }, [filas, grupos, col]);

  const filtro = motor.filtrosDeURL(new URLSearchParams(params.toString()))[columna];
  const elegida = partes.find((p) => p.elegida || (!p.alElegir && filtro && filtro.modo === "solo" && filtro.valores.length === p.valores.length && p.valores.every((v) => filtro.valores.includes(v))));

  return (
    <section className="fz-hero fz-hero--bajo cs-resumen" aria-label={etiqueta}>
      <div>
        <span className="fz-hero__etiqueta">{etiqueta}{ayuda && <InfoMetrica titulo={etiqueta} ayuda={ayuda} />}</span>
        <div className="cs-resumen__cifra">
          <span className="fz-semana__valor">{typeof valor === "number" ? num(valor) : valor}</span>
          {sub && <span className="fz-hero__sub">{sub}</span>}
        </div>
      </div>
      <div className="fz-hero__der">
        <PartesDeUnTotal
          etiqueta={`Cómo se reparte: ${col.titulo}`} activo={elegida?.id}
          partes={partes.map((p) => ({ id: p.id, nombre: p.nombre, valor: p.valor, texto: num(p.valor), tono: p.tono, ayuda: p.ayuda }))}
          onElegir={(id) => {
            const p = partes.find((x) => x.id === id);
            if (!p) return;
            if (p.alElegir) { escribir({ ...motor.filtroAURL(columna, null), [motor.paramPagina]: null }); p.alElegir(); return; }
            escribir({ ...alFiltrar, ...motor.filtroAURL(columna, elegida?.id === id ? null : { modo: "solo", valores: p.valores }), [motor.paramPagina]: null });
          }}
        />
        {derecha}
      </div>
    </section>
  );
}
