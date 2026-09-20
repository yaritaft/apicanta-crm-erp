"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight, Download,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Button, Card, CardHead, StatCard } from "@/components/ui/ui";
import { AreaChart, COLORES, Donut } from "@/components/charts/charts";
import { acciones, useEstado } from "@/lib/store";
import { delta, money, num, pct } from "@/lib/format";
import { periodoAnterior, rangoDeFechas, ultimosMeses, variacion } from "@/lib/metricas";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import {
  calcularPyL, cashCollected, comisionesDelMes, cuotasVencidas, gastosPorCategoria,
  revenue, totalComisiones,
} from "@/lib/finanzas";

export default function Finanzas() {
  const e = useEstado();

  /* `meses` queda solo para el grafico de 6 meses, que es una tendencia y no
     depende del filtro. El filtro ahora es el rango libre. */
  const meses = useMemo(() => ultimosMeses(6), []);

  /* El rango vive en la URL: navegar entre el resumen y el detalle lo
     conserva, y se puede mandar un link a un periodo concreto. Arranca en
     "Este mes", que es lo que pidio Yari: entrar y ver el mes en curso. */
  const [rango, setRango] = useRangoURL("mes");

  /* "Maximo" tiene que decir la verdad por los dos lados: arranca en el primer
     dato que existe, y termina en la ultima cuota PROGRAMADA — si terminara
     hoy, las cuotas que vencen el mes que viene quedarian fuera de pantalla. */
  const limites = useMemo(() => {
    const fechas = [...e.ventas.map((v) => v.fecha), ...e.pagos.map((x) => x.fecha), ...e.gastos.map((g) => g.fecha)]
      .filter(Boolean).map((f) => f.slice(0, 10)).sort();
    const vence = e.cuotas.map((c) => c.vence).filter(Boolean).map((f) => f!.slice(0, 10)).sort();
    return { min: fechas[0] ?? null, max: vence[vence.length - 1] ?? null };
  }, [e.ventas, e.pagos, e.gastos, e.cuotas]);

  const mes = useMemo(() => rangoDeFechas(rango.desde, rango.hasta, rangoSub(rango)), [rango]);

  /* El detalle hereda el periodo que estabas mirando. */
  const qs = new URLSearchParams({ periodo: rango.preset, desde: rango.desde, hasta: rango.hasta }).toString();
  const previo = useMemo(() => {
    const a = periodoAnterior(rango.desde, rango.hasta);
    return rangoDeFechas(a.desde, a.hasta, "período anterior");
  }, [rango]);

  const p = useMemo(() => calcularPyL(e, mes), [e, mes]);
  const pPrev = useMemo(() => calcularPyL(e, previo), [e, previo]);
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const serie = meses.map((m) => ({
    etiqueta: m.etiqueta, valor: cashCollected(e, m), valor2: revenue(e, m),
  }));

  const vencidas = useMemo(() => cuotasVencidas(e), [e]);
  const comisiones = useMemo(() => comisionesDelMes(e, mes), [e, mes]);
  const totComi = totalComisiones(comisiones);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Finanzas"
        sub="Lo facturado y lo realmente cobrado, lado a lado. Todo sale de las ventas, los pagos y los gastos que cargás."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max}
              onApply={setRango} footerNota="Días calendario · zona horaria de Argentina"
            />
            <Button variante="secondary" icono={<Download size={16} />} onClick={() => exportarPyL(e, mes, p)}>Exportar</Button>
            <Link href={`/finanzas/detalle?${qs}`}>
              <Button variante="primary" icono={<ArrowRight size={16} />}>
                {vencidas.length > 0 ? `Ver el detalle · ${vencidas.length} vencidas` : "Ver el detalle"}
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid-stats">
        <StatCard hero etiqueta={`Cobrado en ${mes.etiqueta}`} valor={M(p.cashCollected)}
          delta={delta(variacion(p.cashCollected, pPrev.cashCollected))}
          direccion={p.cashCollected >= pPrev.cashCollected ? "up" : "down"}
          contexto={`vs. ${previo.etiqueta}`} ayuda="Cash collected: la plata que efectivamente entró este mes." />
        <StatCard etiqueta="Facturado" valor={M(p.revenue)}
          delta={pct(p.tasaCobro, 0)} direccion={p.tasaCobro >= 75 ? "up" : "accent"}
          contexto="se cobró de lo vendido" ayuda="Revenue: el precio acordado de las ventas cerradas este mes." />
        <StatCard etiqueta="Profit neto" valor={M(p.netoCC)}
          delta={p.cashCollected > 0 ? pct((p.netoCC / p.cashCollected) * 100, 0) : "—"}
          direccion={p.netoCC >= 0 ? "up" : "down"} contexto="de margen sobre lo cobrado" />
        <StatCard etiqueta="ROAS" valor={p.roasCC > 0 ? `${num(p.roasCC, 1)}x` : "—"}
          delta={p.roasRev > 0 ? `${num(p.roasRev, 1)}x facturado` : undefined} direccion="accent"
          contexto="sobre lo cobrado" ayuda="Cuántas veces recuperás lo que ponés en publicidad." />
      </div>

      <div className="stack-4">
          <div className="grid-2">
            <Card>
              <CardHead titulo="Facturado vs. cobrado" sub="Últimos 6 meses. La distancia entre las dos líneas es lo que falta cobrar." />
              <AreaChart datos={serie} serie2="Facturado" formato={(n) => M(n)} alto={220} />
            </Card>
            <Card>
              <CardHead titulo="En qué se va la plata" sub={`Gastos operativos de ${mes.etiqueta}.`} />
              <Donut
                datos={gastosPorCategoria(e, mes, "operativo").slice(0, 7)
                  .map((g, i) => ({ etiqueta: g.categoria, valor: g.monto, color: COLORES[i % COLORES.length] }))}
                formato={(n) => M(n)} total={M(p.gastosOperativos)} totalEtiqueta="operativos" />
            </Card>
          </div>

          <Card style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "var(--space-5) var(--space-5) 0" }}>
              <CardHead titulo={`Estado de resultados — ${mes.etiqueta}`}
                sub="Dos columnas porque casi todo se vende en cuotas: una cosa es lo que vendiste y otra la que ya está en la cuenta." />
            </div>
            <table className="hk-table">
              <thead>
                <tr>
                  <th>Concepto</th>
                  <th className="hk-th--num">Sobre lo cobrado</th>
                  <th className="hk-th--num">Sobre lo facturado</th>
                </tr>
              </thead>
              <tbody>
                <Linea t="Ingresos" cc={p.cashCollected} rev={p.revenue} fuerte M={M} />
                <Bloque t="Costos directos" />
                <Linea t="Comisiones de closers" cc={-p.comisionCloser} rev={-p.comisionCloser} M={M} />
                <Linea t="Comisión del director" cc={-p.comisionDirector} rev={-p.comisionDirector} M={M} />
                <Linea t="Procesadores de pago" cc={-p.feesProcesador} rev={-p.feesProcesador} M={M} />
                {p.otrosDirectos > 0 && <Linea t="Otros costos directos" cc={-p.otrosDirectos} rev={-p.otrosDirectos} M={M} />}
                <Linea t="Utilidad bruta" cc={p.brutoCC} rev={p.brutoRev} fuerte M={M} />
                <Bloque t="Gastos operativos" />
                {gastosPorCategoria(e, mes, "operativo").map((g) => (
                  <Linea key={g.categoria} t={g.categoria} cc={-g.monto} rev={-g.monto} M={M} />
                ))}
                <Linea t="Resultado operativo" cc={p.operativoCC} rev={p.operativoRev} fuerte M={M} />
                {p.honorariosCeo > 0 && (
                  <>
                    <Bloque t="Honorarios del dueño" />
                    <Linea t="Honorarios del CEO" cc={-p.honorariosCeo} rev={-p.honorariosCeo} M={M} />
                  </>
                )}
                <Linea t="Rentabilidad neta" cc={p.netoCC} rev={p.netoRev} fuerte destacado M={M} />
              </tbody>
            </table>
          </Card>

      </div>

    </div>
  );
}

/* ---------- Piezas de la tabla del P&L ---------- */

function Linea({ t, cc, rev, fuerte, destacado, M }: {
  t: string; cc: number; rev: number; fuerte?: boolean; destacado?: boolean; M: (n: number, d?: number) => string;
}) {
  const color = destacado ? (cc >= 0 ? "var(--success)" : "var(--danger)") : fuerte ? "var(--ink)" : undefined;
  return (
    <tr style={{ cursor: "default", background: fuerte ? "var(--surface-200)" : undefined }}>
      <td className={fuerte ? "hk-td--primary" : undefined}>{t}</td>
      <td className="hk-td--num" style={{ color, fontWeight: fuerte ? 700 : undefined }}>{M(cc)}</td>
      <td className="hk-td--num" style={{ color, fontWeight: fuerte ? 700 : undefined }}>{M(rev)}</td>
    </tr>
  );
}

function Bloque({ t }: { t: string }) {
  return (
    <tr style={{ cursor: "default" }}>
      <td colSpan={3} className="t-label" style={{ paddingTop: 18, paddingBottom: 6, border: 0 }}>{t}</td>
    </tr>
  );
}

function gastosDelMesLista(e: ReturnType<typeof useEstado>, m: { desde: Date; hasta: Date }) {
  return e.gastos.filter((g) => {
    const d = new Date(g.fecha).getTime();
    return d >= m.desde.getTime() && d <= m.hasta.getTime();
  });
}

function exportarPyL(e: ReturnType<typeof useEstado>, m: { etiqueta: string }, p: ReturnType<typeof calcularPyL>) {
  const filas: [string, number, number][] = [
    ["Ingresos", p.cashCollected, p.revenue],
    ["Comisiones closers", -p.comisionCloser, -p.comisionCloser],
    ["Comision director", -p.comisionDirector, -p.comisionDirector],
    ["Procesadores", -p.feesProcesador, -p.feesProcesador],
    ["Utilidad bruta", p.brutoCC, p.brutoRev],
    ["Gastos operativos", -p.gastosOperativos, -p.gastosOperativos],
    ["Resultado operativo", p.operativoCC, p.operativoRev],
    ["Honorarios del CEO", -p.honorariosCeo, -p.honorariosCeo],
    ["Rentabilidad neta", p.netoCC, p.netoRev],
  ];
  const csv = [
    `Estado de resultados,${m.etiqueta}`,
    "Concepto,Sobre lo cobrado,Sobre lo facturado",
    ...filas.map(([c, a, b]) => `"${c}",${a.toFixed(2)},${b.toFixed(2)}`),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `apicanta-pyl-${m.etiqueta.replace(" ", "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  void e;
}
