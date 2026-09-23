"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Download, Plus } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Button } from "@/components/ui/ui";
import { EstadoResultados } from "@/components/finanzas/EstadoResultados";
import { rutaDeGasto } from "@/lib/estadoResultados";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { fechaLarga } from "@/lib/format";
import { rangoDeFechas, type RangoMes } from "@/lib/metricas";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import { calcularPyL, cuotasVencidas, gastosPorCategoria } from "@/lib/finanzas";
import type { EstadoApp, Gasto } from "@/lib/types";

export default function Finanzas() {
  const e = useEstado();
  const toast = useToast();

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

  const p = useMemo(() => calcularPyL(e, mes), [e, mes]);

  const vencidas = useMemo(() => cuotasVencidas(e), [e]);

  /* Un gasto del estado de resultados abre su ficha en la lista de gastos,
     con el mismo período. */
  const hrefGasto = useCallback(
    (id: string) => `/finanzas/detalle?${qs}&vista=gastos&ver=${encodeURIComponent(id)}`,
    [qs],
  );

  const [cargando, setCargando] = useState(false);
  const [enfoque, setEnfoque] = useState<{ ruta: string[]; marca: number } | null>(null);

  /* Recién cargado, el gasto se muestra donde cayó: se abre su renglón. Si
     es de otro período, se avisa en vez de dejar a nadie buscándolo. */
  const alCargar = (g: Gasto) => {
    setCargando(false);
    const t = new Date(g.fecha).getTime();
    if (t >= mes.desde.getTime() && t <= mes.hasta.getTime()) {
      toast(`Gasto cargado: ${g.concepto}.`);
      setEnfoque({ ruta: rutaDeGasto(g), marca: Date.now() });
    } else {
      toast(`Gasto cargado. Es del ${fechaLarga(g.fecha)}: no entra en el período que estás mirando.`, "info");
    }
  };

  return (
    <div className="stack-5">
      <PageHead
        titulo="Finanzas"
        sub="Lo facturado y lo realmente cobrado, lado a lado. Los ingresos salen de las ventas; los gastos, de lo que cargás."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max}
              onApply={setRango} footerNota="Días calendario · zona horaria de Argentina"
            />
            <Button variante="secondary" icono={<Download size={16} />} onClick={() => exportarPyL(e, mes, p)}>Exportar</Button>
            <Link href={`/finanzas/detalle?${qs}`}>
              <Button variante="secondary" icono={<ArrowRight size={16} />}>
                {vencidas.length > 0 ? `Ver el detalle · ${vencidas.length} vencidas` : "Ver el detalle"}
              </Button>
            </Link>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setCargando(true)}>Cargar gasto</Button>
          </>
        }
      />

      <div className="stack-4">
        <EstadoResultados
          e={e} mes={mes} p={p} hrefGasto={hrefGasto} enfoque={enfoque}
          onCargarGasto={() => setCargando(true)}
        />
      </div>

      {cargando && <AsistenteGasto onCerrar={() => setCargando(false)} onListo={alCargar} />}
    </div>
  );
}

/* El CSV lleva lo mismo que se ve: los renglones del estado y, debajo de
   cada bloque de gastos, sus categorías. */
function exportarPyL(e: EstadoApp, m: RangoMes, p: ReturnType<typeof calcularPyL>) {
  const categorias = (grupo: Gasto["grupo"]): [string, number, number][] =>
    gastosPorCategoria(e, m, grupo).map((g) => [`   ${g.categoria}`, -g.monto, -g.monto]);
  const filas: [string, number, number][] = [
    ["Ingresos", p.cashCollected, p.revenue],
    ["Comisiones closers", -p.comisionCloser, -p.comisionCloser],
    ["Comision director", -p.comisionDirector, -p.comisionDirector],
    ["Procesadores", -p.feesProcesador, -p.feesProcesador],
    ["Otros costos directos", -p.otrosDirectos, -p.otrosDirectos],
    ...categorias("directo"),
    ["Utilidad bruta", p.brutoCC, p.brutoRev],
    ["Gastos operativos", -p.gastosOperativos, -p.gastosOperativos],
    ...categorias("operativo"),
    ["Resultado operativo", p.operativoCC, p.operativoRev],
    ["Honorarios del CEO", -p.honorariosCeo, -p.honorariosCeo],
    ...categorias("dueno"),
    ["Rentabilidad neta", p.netoCC, p.netoRev],
  ];
  const csv = [
    `Estado de resultados,${m.etiqueta}`,
    "Concepto,Sobre lo cobrado,Sobre lo facturado",
    ...filas.map(([c, a, b]) => `"${c.replace(/"/g, '""')}",${a.toFixed(2)},${b.toFixed(2)}`),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `apicanta-pyl-${m.etiqueta.replace(/\s+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
