"use client";

import React, { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, Clock, Download, ListChecks } from "lucide-react";
import { Button, Card, Empty } from "@/components/ui/ui";
import { DateRangePicker, diaDeNegocio, rangoStr, rangoSub } from "@/components/ui/DateRangePicker";
import { Desglose, type QueDesglosar } from "@/components/panel/Desglose";
import { FiltroVista } from "@/components/panel/FiltroVista";
import { FiltroSegmento } from "@/components/panel/FiltroSegmento";
import { useFilasKpi } from "@/components/panel/useFilasKpi";
import { ConfigColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { AccionesTopbar } from "@/components/shell/AccionesTopbar";
import { TablaKpis, variacionKpi, type FilaKpi } from "@/components/panel/TablaKpis";
import { useEstado } from "@/lib/store";
import { useRangoURL } from "@/lib/useRango";
import { rangoDeFechas, type RangoMes } from "@/lib/metricas";
import {
  catalogo, conFiltro, conPrevios, Contexto, cortesPorDia, cortesPorMes, SECCIONES, valorEn, webinarsParaFiltro,
  type Corte, type DefKpi, type FiltroKpi, type SeccionKpi,
} from "@/lib/kpis";

/* Las columnas son siempre tiempo. Qué parte del negocio se mira (un
   embudo, un webinar) es otro filtro, aparte: FiltroSegmento. */
type Vista = "periodo" | "meses";

const VISTAS: { valor: Vista; texto: string; ayuda: string }[] = [
  { valor: "periodo", texto: "Por día", ayuda: "Una columna por día del período y el total al final. Con más de 3 meses, una por mes." },
  { valor: "meses", texto: "Por mes", ayuda: "Los 6 meses que terminan en el mes elegido y el total de los seis." },
];

export default function DashboardKpis() {
  const e = useEstado();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const mon = e.ajustes.monedaBase;

  /* El período, las columnas, el filtro, el área y la comparación viven en
     la URL, como en Finanzas: se puede mandar el link a "cobranza del
     webinar del 13/09, día por día". */
  const [rango, setRango] = useRangoURL("mes");
  const comparar = params.get("comparar") === "1";
  const vista: Vista = (VISTAS.some((v) => v.valor === params.get("vista")) ? params.get("vista") : "periodo") as Vista;
  const area = (SECCIONES.some((s) => s.id === params.get("area")) ? params.get("area") : "todo") as SeccionKpi | "todo";
  const setParams = useCallback((cambios: Record<string, string | null | undefined>) => {
    const q = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(cambios)) {
      if (v) q.set(k, v); else q.delete(k);
    }
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }, [params, pathname, router]);
  const setParam = useCallback((k: string, v: string | null) => setParams({ [k]: v }), [setParams]);

  /* Un filtro que apunta a algo que ya no existe se ignora. */
  const webinarsFiltro = useMemo(() => webinarsParaFiltro(e), [e]);
  const embudosFiltro = useMemo(() => [...e.embudos].filter((x) => x.activo).sort((a, b) => a.orden - b.orden), [e.embudos]);
  const filtro: FiltroKpi = useMemo(() => {
    const w = params.get("webinar"), em = params.get("embudo");
    if (w && webinarsFiltro.some((x) => x.id === w)) return { webinarId: w };
    if (em && e.embudos.some((x) => x.id === em)) return { embudoId: em };
    return {};
  }, [params, webinarsFiltro, e.embudos]);

  const [desglose, setDesglose] = useState<{ que: QueDesglosar; mes: RangoMes } | null>(null);

  /* "Máximo" arranca en el primer dato que existe. */
  const minimo = useMemo(() => {
    const fechas = [
      ...e.ventas.map((v) => v.fecha), ...e.pagos.map((p) => p.fecha), ...e.gastos.map((x) => x.fecha),
      ...e.webinars.map((w) => w.fecha), ...e.contactos.map((c) => c.creadoEn),
    ].filter(Boolean).map((f) => diaDeNegocio(f)).sort();
    return fechas[0] ?? null;
  }, [e.ventas, e.pagos, e.gastos, e.webinars, e.contactos]);

  /* Las columnas (tiempo), con el filtro puesto en cada una. Comparar es
     aparte: cada columna se mide contra su paso anterior, con el mismo
     filtro (ver conPrevios). */
  const cortes: Corte[] = useMemo(() => {
    const tiempo = vista === "meses" ? cortesPorMes(rango.hasta) : cortesPorDia(rango.desde, rango.hasta, rangoSub(rango));
    const filtradas = conFiltro(tiempo, filtro);
    return comparar ? conPrevios(filtradas) : filtradas;
  }, [rango, vista, filtro, comparar]);

  /* Cada celda, calculada una vez. Una fila sin ningún dato no se muestra:
     filtrando un webinar, el P&L o el gasto de Meta no existen (no tienen
     webinar), y una fila de guiones no dice nada. */
  const todas: FilaKpi[] = useMemo(() => {
    const ctx = cortes.map((c) => new Contexto(e, c));
    const ctxPrevio = cortes.map((c) => (c.previo ? new Contexto(e, c.previo) : null));
    const tiene = (v: number | null, def: DefKpi) => v !== null && (!def.ocultarEnCero || v !== 0);
    return catalogo(e)
      .map((def) => ({
        def,
        valores: ctx.map((c) => valorEn(def, c)),
        previos: ctxPrevio.map((c) => (c ? valorEn(def, c) : null)),
      }))
      .filter((f) => f.valores.some((v) => tiene(v, f.def)));
  }, [e, cortes]);

  /* Qué métricas se ven y en qué orden: lo elige cada uno (useFilasKpi). */
  const defs = useMemo(() => todas.map((f) => f.def), [todas]);
  const config = useFilasKpi(defs);
  const enArea = useMemo(() => {
    const porId = new Map(todas.map((f) => [f.def.id, f]));
    return config.ordenadas
      .filter((d) => area === "todo" || d.seccion === area)
      .map((d) => porId.get(d.id)!);
  }, [todas, config.ordenadas, area]);
  const filas = enArea.filter((f) => !config.ocultas.has(f.def.id));
  const opcionesFilas: DefColumna[] = useMemo(
    () => enArea.map((f) => ({
      clave: f.def.id, titulo: f.def.etiqueta, ayuda: f.def.ayuda,
      grupo: SECCIONES.find((x) => x.id === f.def.seccion)?.titulo,
    })),
    [enArea],
  );

  const abrir = (def: DefKpi, c: Corte) => {
    if (def.desglose) setDesglose({ que: def.desglose, mes: rangoDeFechas(c.desde, c.hasta, c.sub ?? c.titulo) });
  };

  const areas: { id: SeccionKpi | "todo"; titulo: string }[] = [{ id: "todo", titulo: "Todo" }, ...SECCIONES];
  const elegirArea = (id: SeccionKpi | "todo") => setParam("area", id === "todo" ? null : id);

  return (
    <div className="stack-4">
      {/* Una sola línea: las áreas a la izquierda, como pestañas (de TOFU a
          servicio), y los filtros de la vista a la derecha. Si no entran,
          los filtros suben a una línea propia y las pestañas quedan
          apoyadas sobre la raya. */}
      <div className="kpis-cabecera">
        <div className="kpis-areas" role="tablist" aria-label="Área del negocio">
          {areas.map((a, i) => (
            <button
              key={a.id} type="button" role="tab" className="kpis-area"
              aria-selected={area === a.id} tabIndex={area === a.id ? 0 : -1}
              onClick={() => elegirArea(a.id)}
              onKeyDown={(ev) => {
                const paso = ev.key === "ArrowRight" ? 1 : ev.key === "ArrowLeft" ? -1 : 0;
                if (!paso) return;
                ev.preventDefault();
                const sig = areas[(i + paso + areas.length) % areas.length];
                elegirArea(sig.id);
                (ev.currentTarget.parentElement?.children[(i + paso + areas.length) % areas.length] as HTMLElement | undefined)?.focus();
              }}
            >
              {a.titulo}
            </button>
          ))}
        </div>

        <div className="kpis-barra">
          <button
            type="button" className={`dp-pill kpis-comparar${comparar ? " kpis-comparar--on" : ""}`}
            aria-pressed={comparar} onClick={() => setParam("comparar", comparar ? null : "1")}
            title="Debajo de cada número, cuánto cambió contra el paso anterior: el período anterior, el mes anterior o el webinar anterior"
          >
            <ArrowLeftRight size={14} />
            Comparar períodos
          </button>
          <FiltroVista valor={vista} opciones={VISTAS} onCambiar={(v) => setParam("vista", v === "periodo" ? null : v)} />
          <FiltroSegmento
            filtro={filtro} embudos={embudosFiltro} webinars={webinarsFiltro}
            onCambiar={(f) => setParams({ embudo: f.embudoId, webinar: f.webinarId })}
          />
          <DateRangePicker value={rango} minDate={minimo} onApply={setRango} footerNota="Días calendario · zona horaria de Argentina" />
        </div>
      </div>

      {/* Lo que se hace con la tabla entera va arriba, junto a Buscar. */}
      <AccionesTopbar>
        <ConfigColumnas
          titulo="Métricas" icono={<ListChecks size={14} />} conCuenta={false}
          todas={opcionesFilas} visibles={filas.map((f) => f.def.id)}
          alternar={config.alternar} mover={config.mover} restaurar={config.restaurar}
        />
        <Button sm variante="secondary" icono={<Download size={16} />} onClick={() => exportar(filas, cortes, comparar, rangoStr(rango))}>
          Exportar
        </Button>
      </AccionesTopbar>

      <Card className="planilla-card kpis-card">
        {filas.length === 0 ? (
          <Empty
            icono={<Clock size={22} />}
            titulo="Nada para mostrar en esta vista"
            texto={filtro.embudoId || filtro.webinarId
              ? "Con este filtro, esta área no tiene números: puede que no se puedan atribuir a un embudo o webinar todavía, o que los hayas apagado en «Métricas»."
              : "Esta área no tiene métricas para mostrar: puede que las hayas apagado en «Métricas»."}
          />
        ) : (
          <TablaKpis
            filas={filas} cortes={cortes} comparar={comparar} moneda={mon} porDia={vista === "periodo"}
            conSecciones={area === "todo"} onAbrir={abrir}
          />
        )}
      </Card>

      {desglose && <Desglose que={desglose.que} mes={desglose.mes} onCerrar={() => setDesglose(null)} />}
    </div>
  );
}

/* El CSV lleva lo que se ve: las filas del área elegida, con los números
   crudos para poder seguir haciendo cuentas en una planilla. Comparando,
   cada columna va seguida de su valor anterior y la variación. */
function exportar(filas: FilaKpi[], cortes: Corte[], comparar: boolean, periodo: string) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const crudo = (v: number | null) => (v === null ? "" : String(Math.round(v * 100) / 100));
  const titulos = cortes.flatMap((c) => {
    const t = c.sub ? `${c.titulo} (${c.sub})` : c.titulo;
    return comparar ? [t, `${t} · anterior`, `${t} · variación`] : [t];
  });
  const lineas = [
    ["Área", "Tema", "Métrica", ...titulos].map(esc).join(","),
    ...filas.map((f) => {
      const area = SECCIONES.find((s) => s.id === f.def.seccion)?.titulo ?? "";
      const celdas = f.valores.flatMap((v, i) => comparar
        ? [crudo(v), crudo(f.previos[i]), esc(variacionKpi(f.def, v, f.previos[i])?.texto ?? "")]
        : [crudo(v)]);
      return [esc(area), esc(f.def.grupo), esc(f.def.etiqueta), ...celdas].join(",");
    }),
  ];
  const blob = new Blob([lineas.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `apicanta-kpis-${periodo.replace(/\s+/g, "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
