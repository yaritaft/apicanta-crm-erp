"use client";

import React, { useMemo } from "react";
import { Card, CardHead } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { money, num } from "@/lib/format";
import { resultadoPorEmbudo, type ResultadoEmbudo } from "@/lib/embudos";
import type { RangoMes } from "@/lib/metricas";
import type { EstadoApp } from "@/lib/types";
import { useTablaURL } from "@/lib/useParamsURL";

/* ==================================================================
   El resultado de cada embudo en el período: CAC, ROAS y profit por
   estrategia (lib/embudos.ts). El de la empresa entera es el estado de
   resultados de arriba; acá no entran los gastos fijos.
   ================================================================== */

type Fila = ResultadoEmbudo & { id: string };

export function PorEmbudo({ e, mes }: { e: EstadoApp; mes: RangoMes }) {
  const filas: Fila[] = useMemo(
    () => resultadoPorEmbudo(e, mes).map((f) => ({ ...f, id: f.embudoId ?? "sin" })),
    [e, mes],
  );
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon);
  const X = (n: number | null) => (n === null ? <span className="t-subtle">—</span> : `${num(n, 2)}x`);
  const signo = (n: number) => <span style={{ color: n < 0 ? "var(--danger)" : undefined }}>{M(n)}</span>;
  const suma = (k: keyof ResultadoEmbudo) => filas.reduce((a, f) => a + (Number(f[k]) || 0), 0);

  const columnas: Columna<Fila>[] = [
    { clave: "nombre", titulo: "Estrategia", tipo: "primary", orden: (f) => f.nombre, celda: (f) => f.nombre, pie: "Total" },
    { clave: "ventas", titulo: "Ventas", tipo: "num", orden: (f) => f.ventas, celda: (f) => num(f.ventas), pie: num(suma("ventas")) },
    { clave: "facturado", titulo: "Facturado", tipo: "num", orden: (f) => f.facturado, celda: (f) => M(f.facturado), pie: M(suma("facturado")) },
    { clave: "cobrado", titulo: "Cobrado", tipo: "num", orden: (f) => f.cobrado, celda: (f) => M(f.cobrado), pie: M(suma("cobrado")) },
    { clave: "inversion", titulo: "Inversión", tipo: "num", orden: (f) => f.inversion, celda: (f) => (f.inversion ? M(f.inversion) : <span className="t-subtle">—</span>), pie: M(suma("inversion")) },
    { clave: "cac", titulo: "CAC", tipo: "num", orden: (f) => f.cac ?? -1, celda: (f) => (f.cac === null ? <span className="t-subtle">—</span> : M(f.cac)) },
    { clave: "roasCC", titulo: "ROAS on CC", tipo: "num", orden: (f) => f.roasCC ?? -1, celda: (f) => X(f.roasCC) },
    { clave: "roasRev", titulo: "ROAS on Revenue", tipo: "num", orden: (f) => f.roasRev ?? -1, celda: (f) => X(f.roasRev) },
    { clave: "profitCC", titulo: "Profit on CC", tipo: "num", orden: (f) => f.profitCC, celda: (f) => signo(f.profitCC), pie: signo(suma("profitCC")) },
    { clave: "profitRev", titulo: "Profit on Revenue", tipo: "num", orden: (f) => f.profitRev, celda: (f) => signo(f.profitRev), pie: signo(suma("profitRev")) },
  ];

  /* El orden va en el link como ?orden-embudos. */
  const tabla = useTablaURL("embudos", { clave: "cobrado", desc: true }, columnas.filter((c) => c.orden).map((c) => c.clave));

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
        <CardHead
          titulo="Por embudo"
          sub="Cada estrategia con sus ventas, lo que se invirtió en ella y lo que dejó: lo cobrado (o facturado) menos procesador, comisiones e inversión. La inversión del webinar es la de sus webinars; la de los demás, sus campañas de Meta y los gastos cargados con ese embudo. Los fijos de la empresa no se reparten."
        />
      </div>
      <DataTable filas={filas} columnas={columnas} orden={tabla.orden} onOrden={tabla.onOrden}
        vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>No hubo ventas, cobros ni inversión en el período.</p>} />
    </Card>
  );
}
