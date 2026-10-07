"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, ChartColumn, Clock, Download, EyeOff, ListChecks, Table2 } from "lucide-react";
import { Button, Card, Empty } from "@/components/ui/ui";
import { DateRangePicker, diaDeNegocio, rangoStr, rangoSub } from "@/components/ui/DateRangePicker";
import { CopiarLink } from "@/components/ui/Filtros";
import { Desglose, DetalleDeKpi, type QueDesglosar } from "@/components/panel/Desglose";
import { DetalleAnuncio, type FormatoPlata } from "@/components/marketing/DetalleAnuncio";
import { FiltroVista } from "@/components/panel/FiltroVista";
import { FiltroSegmento } from "@/components/panel/FiltroSegmento";
import { Graficos } from "@/components/panel/graficos/Graficos";
import { Selector } from "@/components/panel/graficos/comun";
import { useFilasKpi } from "@/components/panel/useFilasKpi";
import { ConfigColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { AccionesTopbar } from "@/components/shell/AccionesTopbar";
import { useToast } from "@/components/ui/Toast";
import { AlarmaCobranza } from "@/components/finanzas/AlarmaCobranza";
import { TablaKpis, variacionKpi, type ExplicarKpis, type FilaKpi } from "@/components/panel/TablaKpis";
import { useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { veSeccion } from "@/lib/permisos";
import { money, num } from "@/lib/format";
import { useRangoURL } from "@/lib/useRango";
import { useParamsURL } from "@/lib/useParamsURL";
import { rangoDeFechas, type RangoMes } from "@/lib/metricas";
import {
  catalogo, conFiltro, conPrevios, Contexto, cortesPorDia, cortesPorMes, SECCIONES, valorEn, webinarsParaFiltro,
  type Corte, type DefKpi, type FiltroKpi, type SeccionKpi,
} from "@/lib/kpis";

/* Las columnas son siempre tiempo. Qué parte del negocio se mira (un
   embudo, un webinar) es otro filtro, aparte: FiltroSegmento. */
type Columnas = "dia" | "mes";

const COLUMNAS: { valor: Columnas; texto: string; ayuda: string }[] = [
  { valor: "dia", texto: "Por día", ayuda: "Una columna por día del período y el total al final. Con más de 3 meses, una por mes." },
  { valor: "mes", texto: "Por mes", ayuda: "Los 6 meses que terminan en el mes elegido y el total de los seis." },
];

/* Todo lo que arma la vista va en la URL (ver lib/useParamsURL.ts), además
   del período: se puede mandar el link a "cobranza del webinar del 13/09,
   día por día" y el otro lo ve igual. Lo que no se escribe es lo de siempre.
   - area: una de SECCIONES (lib/kpis.ts); sin ella, Todo
   - columnas: dia · mes
   - comparar: 1 para ver la variación contra el paso anterior
   - embudo / webinar: el id; se usa uno u otro, nunca los dos
   - modo: graficos para ver el Dashboard dibujado (components/panel/graficos);
     sin ella, la tabla. Los gráficos respetan todo lo anterior y agregan sus
     propias claves (dim, met y zona).
   Qué métricas se ven y en qué orden NO va: es de cada uno (useFilasKpi).

   ?ver=graficos también se entiende y pasa solo a ?modo=graficos. «ver» no
   sirve para guardar una vista: en el resto de la app abre una ficha, así que
   lib/vistas-guardadas.ts lo cuenta como de un solo uso (no se recuerda como
   «lo último que se vio») y useAbrirFicha lo borra de la URL al abrir una
   persona: abrir una venta desde el detalle de un gráfico habría devuelto el
   Dashboard a la tabla.

   Las columnas se llamaban ?vista, pero la ficha de una persona también
   escribe ?vista (ventas o servicio): abrir una desde el Desglose pasaba la
   tabla a "Por día", y al cerrarla se perdía "Por mes". Un link viejo con
   ?vista=meses se sigue entendiendo. */
const VISTA_PANEL = { area: "todo", columnas: "dia", comparar: "", embudo: "", webinar: "", modo: "tabla" };

export default function DashboardKpis() {
  const e = useEstado();
  const params = useSearchParams();
  const mon = e.ajustes.monedaBase;

  const [rango, setRango] = useRangoURL("mes");
  const [vista, setVista] = useParamsURL(VISTA_PANEL);
  /* El nombre de cada métrica lleva a su pantalla con este mismo período:
     "Llamadas agendadas" de septiembre abre la Agenda de septiembre. Se pasa
     tal cual está en la URL; sin nada, es el mes, que es el de siempre acá
     pero no en todas (la Agenda arranca en lo próximo). */
  const periodoDelLink = useMemo(() => {
    const q = new URLSearchParams({ periodo: params.get("periodo") ?? "mes" });
    for (const k of ["desde", "hasta"]) { const v = params.get(k); if (v) q.set(k, v); }
    return q.toString();
  }, [params]);
  const comparar = vista.comparar === "1";
  const columnasViejas = !params.get("columnas") && params.get("vista") === "meses";
  const columnas: Columnas = vista.columnas === "mes" || columnasViejas ? "mes" : "dia";
  /* Cada tipo de cuenta ve las secciones de sus áreas (lib/permisos:
     veSeccion): Marketing, adquisición y el webinar; Administración,
     cobranza y rentabilidad. Los números de lo demás ni llegan de la base. */
  const { acceso } = useAcceso();
  const secciones = useMemo(() => SECCIONES.filter((s) => veSeccion(acceso, s.id)), [acceso]);
  const area = (secciones.some((s) => s.id === vista.area) ? vista.area : "todo") as SeccionKpi | "todo";
  /* Los gráficos salen de Ventas y Cobranza: sin ver ninguna de las dos, sólo la tabla. */
  const puedeGraficos = veSeccion(acceso, "ventas") || veSeccion(acceso, "cobranza");
  const ver: "tabla" | "graficos" = (vista.modo === "graficos" || params.get("ver") === "graficos") && puedeGraficos ? "graficos" : "tabla";
  /* El link con ?ver=graficos pasa a ?modo=graficos (ver el comentario de arriba). */
  const enAlias = params.get("ver") === "graficos";
  useEffect(() => {
    if (enAlias) setVista({ modo: "graficos" }, { ver: null });
  }, [enAlias, setVista]);

  /* Un filtro que apunta a algo que ya no existe se ignora. */
  const webinarsFiltro = useMemo(() => webinarsParaFiltro(e), [e]);
  const embudosFiltro = useMemo(() => [...e.embudos].filter((x) => x.activo).sort((a, b) => a.orden - b.orden), [e.embudos]);
  const filtro: FiltroKpi = useMemo(() => {
    const w = vista.webinar, em = vista.embudo;
    if (w && webinarsFiltro.some((x) => x.id === w)) return { webinarId: w };
    if (em && e.embudos.some((x) => x.id === em)) return { embudoId: em };
    return {};
  }, [vista.webinar, vista.embudo, webinarsFiltro, e.embudos]);

  /* Qué parte del negocio se está mirando, con su nombre (lo dicen los gráficos). */
  const segmentoTexto = filtro.webinarId
    ? webinarsFiltro.find((x) => x.id === filtro.webinarId)?.titulo ?? "Webinar"
    : filtro.embudoId ? e.embudos.find((x) => x.id === filtro.embudoId)?.nombre ?? "Embudo" : "Todo el negocio";

  const [desglose, setDesglose] = useState<{ que: QueDesglosar; mes: RangoMes } | null>(null);
  /* El número que se abrió (los registros que lo forman) y, desde su lista,
     el anuncio que se está mirando. */
  const [detalle, setDetalle] = useState<{ def: DefKpi; corte: Corte } | null>(null);
  const [anuncioId, setAnuncioId] = useState<string | null>(null);
  const anuncio = anuncioId ? e.ads.find((a) => a.id === anuncioId) : undefined;
  const router = useRouter();
  const M = useCallback<FormatoPlata>((n, d = 0) => money(n, mon, d), [mon]);

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
    const tiempo = columnas === "mes" ? cortesPorMes(rango.hasta) : cortesPorDia(rango.desde, rango.hasta, rangoSub(rango));
    const filtradas = conFiltro(tiempo, filtro);
    return comparar ? conPrevios(filtradas) : filtradas;
  }, [rango, columnas, filtro, comparar]);

  /* El catálogo entero, armado una vez por estado. */
  const catalogoTodo = useMemo(() => catalogo(e), [e]);

  /* Cada celda, calculada una vez. Una fila sin ningún dato no se muestra:
     filtrando un webinar, el P&L o el gasto de Meta no existen (no tienen
     webinar), y una fila de guiones no dice nada. */
  const todas: FilaKpi[] = useMemo(() => {
    const ctx = cortes.map((c) => new Contexto(e, c));
    const ctxPrevio = cortes.map((c) => (c.previo ? new Contexto(e, c.previo) : null));
    const tiene = (v: number | null, def: DefKpi) => v !== null && (!def.ocultarEnCero || v !== 0);
    return catalogoTodo
      .filter((def) => secciones.some((s) => s.id === def.seccion))
      .map((def) => ({
        def,
        valores: ctx.map((c) => valorEn(def, c)),
        previos: ctxPrevio.map((c) => (c ? valorEn(def, c) : null)),
      }))
      .filter((f) => f.valores.some((v) => tiene(v, f.def)));
  }, [e, catalogoTodo, cortes, secciones]);

  /* «Cómo se calcula» de cada fila, con los números del Total (todo lo que se
     está mirando): las piezas de cada cuenta son filas de esta misma tabla. */
  const explicar: ExplicarKpis | undefined = useMemo(() => {
    const total = cortes.find((c) => c.total) ?? cortes[cortes.length - 1];
    if (!total) return undefined;
    return {
      ctx: new Contexto(e, total),
      porId: new Map(catalogoTodo.map((d) => [d.id, d])),
      periodo: rangoStr({ preset: "custom", desde: total.desde, hasta: total.hasta }),
    };
  }, [e, catalogoTodo, cortes]);

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
  /* Las ocultas se pueden mirar sin volver a prenderlas: van atenuadas y
     con el ojo para devolverlas. El CSV lleva sólo las que se ven. */
  const [verOcultas, setVerOcultas] = useState(false);
  const cuantasOcultas = enArea.length - filas.length;
  const filasTabla = verOcultas ? enArea : filas;
  const toast = useToast();
  const alternarFila = (def: DefKpi) => {
    const estaba = config.ocultas.has(def.id);
    config.alternar(def.id);
    /* Devuelta la última, no queda nada que mirar aparte. */
    if (estaba && cuantasOcultas === 1) setVerOcultas(false);
    if (!estaba) toast(`Ocultaste «${def.etiqueta}». Queda guardado en tu usuario.`, "ok", { texto: "Deshacer", onClick: () => config.alternar(def.id) });
  };
  const opcionesFilas: DefColumna[] = useMemo(
    () => enArea.map((f) => ({
      clave: f.def.id, titulo: f.def.etiqueta, ayuda: f.def.ayuda,
      grupo: SECCIONES.find((x) => x.id === f.def.seccion)?.titulo,
    })),
    [enArea],
  );

  const abrir = (def: DefKpi, c: Corte) => {
    if (def.detalle) setDetalle({ def, corte: c });
    else if (def.desglose) setDesglose({ que: def.desglose, mes: rangoDeFechas(c.desde, c.hasta, c.sub ?? c.titulo) });
  };

  const areas: { id: SeccionKpi | "todo"; titulo: string }[] = [{ id: "todo", titulo: "Todo" }, ...secciones];
  const elegirArea = (id: SeccionKpi | "todo") => setVista({ area: id });

  return (
    <div className="stack-4">
      {veSeccion(acceso, "cobranza") && <AlarmaCobranza e={e} />}

      {/* Una sola línea: las áreas a la izquierda, como pestañas (de TOFU a
          servicio), y los filtros de la vista a la derecha. Si no entran,
          los filtros suben a una línea propia y las pestañas quedan
          apoyadas sobre la raya. */}
      <div className="kpis-cabecera">
        <div className="kpis-izq">
          {/* Tabla (la de siempre) o Gráficos: lo mismo, dibujado. */}
          {puedeGraficos && (
            <Selector
              modo="tabs" etiqueta="Cómo ver el Dashboard" valor={ver} onCambiar={(v) => setVista({ modo: v }, { ver: null })}
              opciones={[
                { id: "tabla", titulo: "Tabla", icono: <Table2 size={14} aria-hidden />, ayuda: "Todas las métricas en una tabla" },
                { id: "graficos", titulo: "Gráficos", icono: <ChartColumn size={14} aria-hidden />, ayuda: "Lo mismo, dibujado: Revenue y cobro en el tiempo, mora, ticket, desgloses y mapa" },
              ]}
            />
          )}
          {ver === "tabla" && (
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
          )}
        </div>

        <div className="kpis-barra">
          <button
            type="button" className={`dp-pill kpis-comparar${comparar ? " kpis-comparar--on" : ""}`}
            aria-pressed={comparar} onClick={() => setVista({ comparar: comparar ? null : "1" })}
            title="Debajo de cada número, cuánto cambió contra el paso anterior: el período anterior, el mes anterior o el webinar anterior"
          >
            <ArrowLeftRight size={14} />
            Comparar períodos
          </button>
          <FiltroVista
            valor={columnas} opciones={COLUMNAS}
            onCambiar={(v) => setVista({ columnas: v }, columnasViejas ? { vista: null } : undefined)}
          />
          <FiltroSegmento
            filtro={filtro} embudos={embudosFiltro} webinars={webinarsFiltro}
            onCambiar={(f) => setVista({ embudo: f.embudoId ?? null, webinar: f.webinarId ?? null })}
          />
          <DateRangePicker value={rango} minDate={minimo} onApply={setRango} footerNota="Días calendario · zona horaria de Argentina" />
        </div>
      </div>

      {/* Lo que se hace con la tabla entera va arriba, junto a Buscar. */}
      <AccionesTopbar>
        {ver === "tabla" && (
          <ConfigColumnas
            titulo="Métricas" icono={<ListChecks size={14} />} conCuenta={false}
            todas={opcionesFilas} visibles={filas.map((f) => f.def.id)}
            alternar={config.alternar} mover={config.mover} restaurar={config.restaurar}
          />
        )}
        <CopiarLink />
        {ver === "tabla" && (
          <Button sm variante="secondary" icono={<Download size={16} />} onClick={() => exportar(filas, cortes, comparar, rangoStr(rango))}>
            Exportar
          </Button>
        )}
      </AccionesTopbar>

      {ver === "graficos" && explicar ? (
        <Graficos
          cortes={cortes} comparar={comparar} moneda={mon} explicar={explicar}
          verVentas={veSeccion(acceso, "ventas")} verCobranza={veSeccion(acceso, "cobranza")} segmento={segmentoTexto}
          onAbrir={(def, corte) => setDetalle({ def, corte })}
        />
      ) : (
        <Card className="planilla-card kpis-card">
          {filasTabla.length === 0 ? (
            <Empty
              icono={<Clock size={22} />}
              titulo="Nada para mostrar en esta vista"
              texto={filtro.embudoId || filtro.webinarId
                ? "Con este filtro, esta área no tiene números: puede que no se puedan atribuir a un embudo o webinar todavía, o que los hayas apagado en «Métricas»."
                : "Esta área no tiene métricas para mostrar: puede que las hayas apagado en «Métricas»."}
            />
          ) : (
            <TablaKpis
              filas={filasTabla} cortes={cortes} comparar={comparar} moneda={mon} porDia={columnas === "dia"}
              conSecciones={area === "todo"} onAbrir={abrir} periodo={periodoDelLink}
              onAlternar={alternarFila} ocultas={verOcultas ? config.ocultas : undefined} explicar={explicar}
            />
          )}
          {cuantasOcultas > 0 && (
            <div className="kpis-ocultas">
              <EyeOff size={14} aria-hidden />
              <span>
                {cuantasOcultas === 1 ? "1 métrica oculta" : `${num(cuantasOcultas)} métricas ocultas`}
                {area === "todo" ? "" : " en esta área"}
              </span>
              <button type="button" className="link" aria-pressed={verOcultas} onClick={() => setVerOcultas((v) => !v)}>
                {verOcultas ? "Esconderlas" : "Mostrarlas"}
              </button>
            </div>
          )}
        </Card>
      )}

      {desglose && <Desglose que={desglose.que} mes={desglose.mes} onCerrar={() => setDesglose(null)} />}
      {detalle && !anuncio && (
        <DetalleDeKpi def={detalle.def} corte={detalle.corte} onCerrar={() => setDetalle(null)} onAnuncio={setAnuncioId} />
      )}
      {/* El anuncio, con los días de la columna que se abrió. Al cerrarlo vuelve la lista. */}
      {detalle && anuncio && (
        <DetalleAnuncio
          ad={anuncio} M={M} rango={{ preset: "custom", desde: detalle.corte.desde, hasta: detalle.corte.hasta }}
          onCerrar={() => setAnuncioId(null)}
          onIr={(d) => router.push(`/marketing?${new URLSearchParams({
            nivel: d.nivel, ...(d.campania ? { campania: d.campania } : {}), ...(d.conjunto ? { conjunto: d.conjunto } : {}),
            periodo: "custom", desde: detalle.corte.desde, hasta: detalle.corte.hasta,
          })}`)}
        />
      )}
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
