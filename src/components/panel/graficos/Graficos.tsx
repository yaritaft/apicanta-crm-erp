"use client";

import React, { useMemo, useState } from "react";
import { ChartColumn, ChartLine } from "lucide-react";
import { Card, Empty } from "@/components/ui/ui";
import type { ExplicarKpis } from "@/components/panel/TablaKpis";
import { useEstado } from "@/lib/store";
import { useParamsURL } from "@/lib/useParamsURL";
import { Contexto, type Corte, type DefKpi } from "@/lib/kpis";
import { dePagos, deVentas } from "@/lib/kpis-detalle";
import {
  DIMENSIONES, medidasDe, METRICAS, pagosDeCategoria, piezasDeSerie, piezasDeTasa, piezasDeTicket, queSeVe, serieTemporal, TEXTOS,
  ventasDeCategoria, ZONAS_MAPA, type Categoria, type DimensionId, type Medidas, type MetricaDesglose, type ZonaMapa,
} from "@/lib/kpis-graficos";
import type { Moneda } from "@/lib/types";
import { BORDE_CC, BORDE_REVENUE, CabezaGrafico, COLOR_CC, COLOR_REVENUE, formatoPct, formatoPlata, InfoGrafico, plataCorta, Selector } from "./comun";
import { GraficoTiempo, type PuntoTiempo, type SerieTiempo } from "./GraficoTiempo";
import { MapaMundo } from "./MapaMundo";
import { PanelDesglose } from "./PanelDesglose";
import { PanelMora } from "./PanelMora";
import { Tarjetas, Variacion } from "./Tarjetas";

/* ==================================================================
   El Dashboard en gráficos (?modo=graficos).

   Lo pidió Angelo: gráficos de Revenue y Cash Collected, tasa de cobro y de
   mora, ticket promedio, desgloses por plan de pago, país, estrategia,
   servicio y proyecto, y un mapa. Respeta todo lo que se eligió arriba (el
   período, el filtro de embudo o webinar, las columnas por día o por mes y
   «Comparar períodos») y las áreas que ve cada tipo de cuenta. Los totales
   son los de la columna Total de la tabla: los gráficos no recalculan nada
   (lib/kpis-graficos.ts).

   Qué desglose, qué métrica y qué zona del mapa se están mirando va en la URL
   (?dim, ?met y ?zona), como el resto del Dashboard.
   ================================================================== */

const GRAFICOS_URL = { dim: "pais", met: "revenue", zona: "mundo" };

/* «jue 1 oct» para un día; «Sep 26» para un mes; «Oct 26 · días 1–7» para un mes a medias. */
function tituloDe(c: Corte): string {
  if (c.desde === c.hasta) return [c.sub, c.titulo].filter(Boolean).join(" ");
  return c.sub ? `${c.titulo} · días ${c.sub}` : c.titulo;
}

export function Graficos({ cortes, comparar, moneda, explicar, verVentas, verCobranza, segmento, onAbrir }: {
  /* Las columnas de la tabla, con el filtro puesto y, comparando, sus previos. */
  cortes: Corte[];
  comparar: boolean;
  moneda: Moneda;
  explicar: ExplicarKpis;
  verVentas: boolean;
  verCobranza: boolean;
  /* «Todo el negocio», el embudo o el webinar que se está mirando. */
  segmento: string;
  /* Abre el detalle (el mismo panel que al tocar un número de la tabla). */
  onAbrir: (def: DefKpi, corte: Corte) => void;
}) {
  const e = useEstado();
  const ve = useMemo(() => queSeVe(verVentas, verCobranza), [verVentas, verCobranza]);
  const [g, setG] = useParamsURL(GRAFICOS_URL);
  const dim = (DIMENSIONES.some((x) => x.id === g.dim) ? g.dim : "pais") as DimensionId;
  const met = (METRICAS.some((x) => x.id === g.met) ? g.met : "revenue") as MetricaDesglose;
  const zona = (ZONAS_MAPA.some((x) => x.id === g.zona) ? g.zona : "mundo") as ZonaMapa;
  const [dimMora, setDimMora] = useState<DimensionId>("plan");
  const [modoElegido, setModoElegido] = useState<"lineas" | "barras" | null>(null);

  const corteTotal = cortes.find((c) => c.total) ?? cortes[cortes.length - 1];
  const serie = useMemo(() => serieTemporal(e, cortes), [e, cortes]);
  const total = useMemo(() => medidasDe(explicar.ctx), [explicar.ctx]);
  const previoTotal = useMemo(() => (corteTotal.previo ? medidasDe(new Contexto(e, corteTotal.previo)) : undefined), [e, corteTotal]);
  const cobros = useMemo(() => explicar.ctx.pagos().length, [explicar.ctx]);

  const puntos: PuntoTiempo[] = useMemo(() => serie.map((p) => ({ clave: p.corte.clave, eje: p.corte.titulo, titulo: tituloDe(p.corte) })), [serie]);
  const modo = modoElegido ?? (serie.length <= 12 ? "barras" : "lineas");
  const def = (id: string) => explicar.porId.get(id)!;

  /* En el tooltip de cada punto, cuánto cambió contra el paso anterior (como la tabla). */
  const extra = (campos: { id: string; nombre: string; de: (m: Medidas) => number | null }[]) => {
    if (!comparar) return undefined;
    return (i: number) => {
      const p = serie[i];
      if (!p?.previo) return null;
      const antes = p.corte.previo ? (p.corte.previo.sub ?? p.corte.previo.titulo) : "el período anterior";
      const vars = campos.map((c) => <Variacion key={c.id} def={def(c.id)} actual={c.de(p.medidas)} previo={c.de(p.previo!)} moneda={moneda} antes={antes} />);
      return (
        <div className="gr-tip__vs">
          <span>vs. {antes}</span>
          {campos.map((c, k) => <span key={c.id} className="gr-tip__vs-item">{campos.length > 1 ? `${c.nombre} ` : ""}{vars[k] ?? "—"}</span>)}
        </div>
      );
    };
  };

  const plata = formatoPlata(moneda);
  const eje = (n: number) => plataCorta(n, moneda);
  const serieRevenue: SerieTiempo = { id: "revenue", nombre: "Revenue", color: COLOR_REVENUE, borde: BORDE_REVENUE, marca: "circulo", valores: serie.map((p) => p.medidas.revenue) };
  const serieCC: SerieTiempo = { id: "cc", nombre: "Cash Collected (CC)", color: COLOR_CC, borde: BORDE_CC, marca: "rombo", patron: true, valores: serie.map((p) => p.medidas.cc) };
  const seriesRC = [...(ve.revenue ? [serieRevenue] : []), ...(ve.cc ? [serieCC] : [])];
  const textoRC = ve.revenue && ve.cc ? TEXTOS.revenueCC : ve.revenue ? TEXTOS.soloRevenue : TEXTOS.soloCC;
  const tituloRC = textoRC.titulo;
  /* Con más de tres meses, la tabla pasa a una columna por mes aunque se pida por día. */
  const unidadTiempo = serie.length > 0 && serie.every((p) => p.corte.desde === p.corte.hasta) ? "día" : "mes";
  const contexto = `${explicar.periodo} · por ${unidadTiempo} · ${segmento}`;

  /* Una tasa por día se dispara cuando casi no hubo ventas ese día (800%): el eje se corta
     un poco arriba de lo habitual y lo que pasa se marca en el borde. */
  const techoTasa = useMemo(() => {
    const vs = serie.map((p) => p.medidas.tasaCobro).filter((v): v is number => v !== null).sort((a, b) => a - b);
    return vs.length < 6 ? undefined : Math.max(200, vs[Math.floor(0.9 * (vs.length - 1))] * 1.3);
  }, [serie]);
  const serieTasa: SerieTiempo = { id: "tasa", nombre: "Tasa de cobro", color: "var(--brand)", borde: "var(--brand)", marca: "cuadrado", valores: serie.map((p) => p.medidas.tasaCobro) };
  const serieTicketRev: SerieTiempo = { id: "ticketRev", nombre: "Ticket sobre Revenue", color: COLOR_REVENUE, borde: BORDE_REVENUE, marca: "circulo", valores: serie.map((p) => p.medidas.ticketRev) };
  const serieTicketCC: SerieTiempo = { id: "ticketCC", nombre: "Ticket sobre CC", color: COLOR_CC, borde: BORDE_CC, marca: "rombo", valores: serie.map((p) => p.medidas.ticketCC) };
  const seriesTicket = [...(ve.ticketRev ? [serieTicketRev] : []), ...(ve.ticketCC ? [serieTicketCC] : [])];

  const abrirCategoria = (que: "ventas" | "cobros", cat: Categoria, d: DimensionId, metrica: MetricaDesglose) => {
    const por = DIMENSIONES.find((x) => x.id === d)!.por;
    onAbrir({
      id: `grafico:${d}:${cat.clave}:${que}`, seccion: que === "ventas" ? "ventas" : "cobranza", grupo: "Gráficos", formato: "moneda",
      etiqueta: `${cat.nombre} · ${que === "ventas" ? (metrica === "unidades" ? "ventas" : "ventas del Revenue") : "cobros del CC"}`,
      ayuda: `${que === "ventas" ? "Las ventas" : "Los cobros"} que forman la categoría «${cat.nombre}» del desglose ${por}: la misma lista que suma el gráfico.`,
      valor: () => null,
      detalle: (c) => (que === "ventas"
        ? deVentas(c, ventasDeCategoria(c, d, cat.clave, metrica === "unidades" ? "unidades" : "revenue"))
        : dePagos(c, pagosDeCategoria(c, d, cat.clave))),
    }, corteTotal);
  };

  if (ve.ninguno) {
    return (
      <Card>
        <Empty
          icono={<ChartLine size={22} />} titulo="Tu tipo de cuenta no ve ventas ni cobranza"
          texto="Los gráficos salen de esas dos áreas. En la tabla ves las métricas de las áreas que sí podés ver."
        />
      </Card>
    );
  }

  return (
    <div className="gr stack-4">
      <p className="gr-nota">
        Los mismos números que la tabla: los totales son los de su columna Total, con el período, el filtro y las columnas de arriba.
        Pasá el mouse, tocá o usá las flechas para ver cada punto; el ⓘ de cada gráfico explica la cuenta.
      </p>

      <Tarjetas actual={total} previo={previoTotal} comparar={comparar} moneda={moneda} ve={ve} explicar={explicar} cobros={cobros} />

      {/* Revenue vs Cash Collected: lo vendido contra lo que entró. */}
      <section className="hk-card gr-card" aria-labelledby="gr-rc">
        <CabezaGrafico
          id="gr-rc" titulo={tituloRC}
          info={<InfoGrafico texto={textoRC} moneda={moneda} periodo={explicar.periodo} piezas={() => piezasDeSerie(total, ve)} />}
          sub={contexto}
          acciones={seriesRC.length > 0 ? (
            <Selector
              chico etiqueta="Cómo dibujarlo" valor={modo} onCambiar={setModoElegido}
              opciones={[
                { id: "lineas", titulo: "Líneas", icono: <ChartLine size={13} aria-hidden /> },
                { id: "barras", titulo: "Barras", icono: <ChartColumn size={13} aria-hidden /> },
              ]}
            />
          ) : undefined}
        />
        <GraficoTiempo
          etiqueta={`${tituloRC}, por ${unidadTiempo}`} puntos={puntos} series={seriesRC} modo={modo} alto={290}
          formato={plata} formatoEje={eje} sinDatos={ve.revenue && ve.cc ? "Sin ventas ni cobros en este período." : ve.revenue ? "Sin ventas en este período." : "Sin cobros en este período."}
          extra={extra([...(ve.revenue ? [{ id: "v_fact", nombre: "Revenue", de: (m: Medidas) => m.revenue }] : []), ...(ve.cc ? [{ id: "c_cc", nombre: "CC", de: (m: Medidas) => m.cc }] : [])])}
          accionesFijas={(i) => (
            <div className="gr-tip__acciones">
              {ve.revenue && <button type="button" className="link t-sm" onClick={() => onAbrir(def("v_fact"), serie[i].corte)}>Ver las ventas</button>}
              {ve.cc && <button type="button" className="link t-sm" onClick={() => onAbrir(def("c_cc"), serie[i].corte)}>Ver los cobros</button>}
            </div>
          )}
        />
      </section>

      <div className="gr-dos">
        {ve.tasaCobro && (
          <section className="hk-card gr-card" aria-labelledby="gr-tasa">
            <CabezaGrafico
              id="gr-tasa" titulo="Tasa de cobro"
              info={<InfoGrafico texto={TEXTOS.tasaCobro} moneda={moneda} periodo={explicar.periodo} piezas={() => piezasDeTasa(total)} />}
              sub={`CC ÷ Revenue, por ${unidadTiempo}`}
            />
            <GraficoTiempo
              etiqueta={`Tasa de cobro por ${unidadTiempo}`} puntos={puntos} series={[serieTasa]} modo="lineas" alto={300} area
              formato={formatoPct} formatoEje={(n) => `${Math.round(n)}%`} referencia={{ valor: 100, texto: "todo lo vendido, cobrado" }} minimoMax={100} techo={techoTasa}
              sinDatos="Sin ventas en este período: no hay tasa de cobro para calcular."
              extra={extra([{ id: "c_tasa", nombre: "Tasa", de: (m) => m.tasaCobro }])}
            />
          </section>
        )}
        {ve.mora && <PanelMora ctx={explicar.ctx} moneda={moneda} dim={dimMora} onDim={setDimMora} />}
      </div>

      {seriesTicket.length > 0 && (
        <section className="hk-card gr-card" aria-labelledby="gr-ticket">
          <CabezaGrafico
            id="gr-ticket" titulo="Ticket promedio"
            info={(
              <InfoGrafico
                texto={ve.ticketCC ? TEXTOS.ticket : TEXTOS.ticketRev}
                moneda={moneda} periodo={explicar.periodo}
                piezas={() => (ve.ticketCC ? [
                  { titulo: "Sobre Revenue", filas: piezasDeTicket(total, "revenue") },
                  { titulo: "Sobre CC", filas: piezasDeTicket(total, "cc") },
                ] : piezasDeTicket(total, "revenue"))}
              />
            )}
            sub={`${ve.ticketCC ? "Revenue ÷ ventas y CC ÷ ventas" : "Revenue ÷ ventas"}, por ${unidadTiempo}`}
          />
          <GraficoTiempo
            etiqueta={`Ticket promedio por ${unidadTiempo}`} puntos={puntos} series={seriesTicket} modo="lineas" alto={240}
            formato={plata} formatoEje={eje} sinDatos="Sin ventas en este período: no hay ticket para calcular."
            extra={extra([...(ve.ticketRev ? [{ id: "v_ticket", nombre: "Rev.", de: (m: Medidas) => m.ticketRev }] : []), ...(ve.ticketCC ? [{ id: "v_ticket", nombre: "CC", de: (m: Medidas) => m.ticketCC }] : [])])}
          />
        </section>
      )}

      <PanelDesglose
        ctx={explicar.ctx} moneda={moneda} ve={ve} periodo={contexto}
        dim={dim} onDim={(x) => setG({ dim: x })} metrica={met} onMetrica={(x) => setG({ met: x })}
        onAbrir={abrirCategoria}
      />

      <MapaMundo
        ctx={explicar.ctx} moneda={moneda} ve={ve} periodo={contexto} zona={zona} onZona={(z) => setG({ zona: z })}
        onAbrir={(que, cat, metrica) => abrirCategoria(que, cat, "pais", metrica)}
      />
    </div>
  );
}
