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
    { clave: "ventas", titulo: "Ventas", tipo: "num", info: { ayuda: "Ventas del embudo en el período: las cargadas con ese embudo como «Estrategia utilizada».", formula: "Ventas con fecha del período y ese embudo, sin las canceladas ni las que son sólo una reserva" }, orden: (f) => f.ventas, celda: (f) => num(f.ventas), pie: num(suma("ventas")) },
    { clave: "facturado", titulo: "Facturado", tipo: "num", info: { ayuda: "Revenue del embudo: lo que se vendió, se haya cobrado o no.", formula: "Suma del precio acordado de las ventas del período con ese embudo, sin las canceladas" }, orden: (f) => f.facturado, celda: (f) => M(f.facturado), pie: M(suma("facturado")) },
    { clave: "cobrado", titulo: "Cobrado", tipo: "num", info: { ayuda: "Cash Collected (CC) del embudo: la plata que entró en el período de sus ventas, sin importar cuándo se vendieron.", formula: "Suma de los pagos con fecha del período que son de ventas de ese embudo" }, orden: (f) => f.cobrado, celda: (f) => M(f.cobrado), pie: M(suma("cobrado")) },
    { clave: "inversion", titulo: "Inversión", tipo: "num", info: { ayuda: "Lo que se invirtió en el embudo en el período. Los gastos fijos de la empresa no se reparten entre embudos.", formula: "Embudo de webinar: pauta + DM Ads + WhatsApp API de los webinars del período.\nOtros embudos: las campañas de Meta cuyo nombre dice el embudo, día por día.\nEn todos: más los gastos de Finanzas cargados con ese embudo." }, orden: (f) => f.inversion, celda: (f) => (f.inversion ? M(f.inversion) : <span className="t-subtle">—</span>), pie: M(suma("inversion")) },
    { clave: "cac", titulo: "CAC", tipo: "num", info: { ayuda: "Lo que costó conseguir cada venta de este embudo.", formula: "Inversión del embudo ÷ Ventas del embudo", ejemplo: "US$ 5.000 invertidos y 4 ventas: el CAC es US$ 1.250." }, orden: (f) => f.cac ?? -1, celda: (f) => (f.cac === null ? <span className="t-subtle">—</span> : M(f.cac)) },
    { clave: "roasCC", titulo: "ROAS on CC", tipo: "num", info: { ayuda: "Por cada dólar invertido en el embudo, cuántos entraron.", formula: "Cash Collected (CC) del embudo ÷ Inversión del embudo", ejemplo: "Invertiste US$ 5.000 y entraron US$ 12.500: ROAS on CC = 2,5x." }, orden: (f) => f.roasCC ?? -1, celda: (f) => X(f.roasCC) },
    { clave: "roasRev", titulo: "ROAS on Revenue", tipo: "num", info: { ayuda: "Por cada dólar invertido en el embudo, cuántos se vendieron, como si todos pagaran todas las cuotas.", formula: "Revenue del embudo ÷ Inversión del embudo", ejemplo: "Con los mismos US$ 5.000 y US$ 20.000 vendidos: ROAS on Revenue = 4x." }, orden: (f) => f.roasRev ?? -1, celda: (f) => X(f.roasRev) },
    { clave: "profitCC", titulo: "Profit on CC", tipo: "num", info: { ayuda: "Lo que dejó el embudo sobre lo que ya se cobró. No incluye los gastos fijos de la empresa.", formula: "Cash Collected (CC) del embudo − Procesadores − Comisiones (closers y director) − Inversión del embudo" }, orden: (f) => f.profitCC, celda: (f) => signo(f.profitCC), pie: signo(suma("profitCC")) },
    { clave: "profitRev", titulo: "Profit on Revenue", tipo: "num", info: { ayuda: "Lo que dejaría el embudo si se cobrara todo lo vendido. No incluye los gastos fijos de la empresa.", formula: "Revenue del embudo − Procesadores − Comisiones (closers y director) − Inversión del embudo" }, orden: (f) => f.profitRev, celda: (f) => signo(f.profitRev), pie: signo(suma("profitRev")) },
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
