"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Megaphone, Search } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Button, Card, CardHead, Empty, Input, Select, StatCard, Tabs } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { ConectarMeta } from "@/components/shell/ConectarMeta";
import { COLORES, Donut, BarChart, truncar } from "@/components/charts/charts";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { money, num, pct } from "@/lib/format";
import { campaniasDelRango, negocioDeCampania, primerDiaConDatos, type FilaCampania } from "@/lib/metricas";
import type { Campania, EstadoCampania } from "@/lib/types";

type Vista = "dashboard" | "campanias";

const ETIQUETA: Record<EstadoCampania, { texto: string; variante: "success" | "warning" | "neutral" }> = {
  "activa": { texto: "Activa", variante: "success" },
  "pausada": { texto: "Pausada", variante: "warning" },
  "finalizada": { texto: "Finalizada", variante: "neutral" },
};

/* El catálogo de columnas. Los nombres y el orden son los del Ads Manager,
   para que quien viene de ahí no tenga que traducir nada. */
const COLUMNAS: DefColumna[] = [
  { clave: "nombre", titulo: "Campaña", fija: true },

  { clave: "estado", titulo: "Estado", grupo: "Identidad" },
  { clave: "plataforma", titulo: "Plataforma", grupo: "Identidad" },
  { clave: "objetivo", titulo: "Objetivo", grupo: "Identidad" },

  { clave: "inversion", titulo: "Inversión", grupo: "Inversión" },
  { clave: "cpm", titulo: "CPM", grupo: "Inversión", ayuda: "Costo por mil impresiones." },

  { clave: "impresiones", titulo: "Impresiones", grupo: "Alcance", ayuda: "Veces que se mostró, contando repetidas." },
  { clave: "alcance", titulo: "Alcance", grupo: "Alcance", ayuda: "Personas distintas que lo vieron." },
  { clave: "frecuencia", titulo: "Frecuencia", grupo: "Alcance", ayuda: "Veces que lo vio cada una. Alta con CTR cayendo es fatiga de creativo." },

  { clave: "clicks", titulo: "Clicks", grupo: "Clicks", ayuda: "Todos: incluye likes, comentarios y «ver más»." },
  { clave: "ctr", titulo: "CTR", grupo: "Clicks" },
  { clave: "cpc", titulo: "CPC", grupo: "Clicks" },
  { clave: "clicksEnlace", titulo: "Clicks en el enlace", grupo: "Clicks", ayuda: "Los que se fueron a la landing. Para el embudo, vale éste." },
  { clave: "ctrEnlace", titulo: "CTR del enlace", grupo: "Clicks" },
  { clave: "cpcEnlace", titulo: "Costo por click en enlace", grupo: "Clicks" },

  { clave: "leads", titulo: "Leads", grupo: "Conversión", ayuda: "Formularios completados." },
  { clave: "cpl", titulo: "Costo por lead", grupo: "Conversión" },

  { clave: "ventas", titulo: "Ventas", grupo: "Negocio", ayuda: "Atribuidas por el nombre de campaña del lead." },
  { clave: "facturado", titulo: "Facturado", grupo: "Negocio" },
  { clave: "cobrado", titulo: "Cobrado", grupo: "Negocio" },
  { clave: "roas", titulo: "ROAS", grupo: "Negocio", ayuda: "Cobrado sobre inversión." },
];

const POR_DEFECTO = [
  "nombre", "estado", "inversion", "impresiones", "clicks", "ctr",
  "clicksEnlace", "leads", "cpl", "ventas",
];

export default function Marketing() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [vista, setVista] = useState<Vista>("dashboard");
  const [ver, setVer] = useState<string | null>(null);

  const [rango, setRango] = useRangoURL("mes");
  const [busca, setBusca] = useState("");
  const [fEstado, setFEstado] = useState("");

  const cols = useColumnas("campanias", COLUMNAS, POR_DEFECTO);

  useEffect(() => {
    if (url.nuevo || url.ver) { setVista("campanias"); if (url.ver) setVer(url.ver); url.limpiar(); }
  }, [url]);

  const M = (n: number, d = 0) => money(n, e.ajustes.monedaBase, d);

  /* Ahora sale de ad_insights: el gasto se suma dia por dia y sube de anuncio
     a campaña. Por eso el rango recorta de verdad — antes `campanias` tenia UN
     numero por campaña y el filtro solo podia elegir cuales mostrar. */
  const enRango = useMemo(
    () => campaniasDelRango(e, rango.desde, rango.hasta),
    [e, rango],
  );

  /* Que "Máximo" no arranque en enero cuando la sincronizacion empieza en
     septiembre. */
  const primerDia = useMemo(() => primerDiaConDatos(e), [e]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return enRango.filter((c) =>
      (!q || c.nombre.toLowerCase().includes(q) || c.objetivo.toLowerCase().includes(q)) &&
      (!fEstado || c.estado === fEstado));
  }, [enRango, busca, fEstado]);

  /* Los totales salen de lo FILTRADO, no de toda la base: si filtrás por Meta,
     el costo por lead que ves tiene que ser el de Meta. */
  const tot = useMemo(() => {
    const inv = filtradas.reduce((s, c) => s + c.inversion, 0);
    const leads = filtradas.reduce((s, c) => s + c.leads, 0);
    const neg = filtradas.reduce((acc, c) => {
      const n = negocioDeCampania(e, c.nombre);
      return { ventas: acc.ventas + n.ventas, cobrado: acc.cobrado + n.cobrado };
    }, { ventas: 0, cobrado: 0 });
    return {
      inv, leads, ...neg,
      cpl: leads > 0 ? inv / leads : 0,
      cac: neg.ventas > 0 ? inv / neg.ventas : 0,
      roas: inv > 0 ? neg.cobrado / inv : 0,
    };
  }, [filtradas, e]);

  const porFuente = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of e.leads) m.set(l.fuente || "Sin fuente", (m.get(l.fuente || "Sin fuente") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([etiqueta, valor], i) => ({ etiqueta, valor, color: COLORES[i % COLORES.length] }));
  }, [e.leads]);

  /* La fila agregada del rango, no la campaña cruda: el detalle tiene que
     mostrar los mismos números que la tabla. */
  const cVista = enRango.find((c) => c.id === ver) ?? null;

  /* Cada columna del catálogo, definida una sola vez. La tabla recibe sólo las
     prendidas, en el orden en que quedaron. */
  /* Las derivadas ya vienen calculadas sobre los totales del rango, desde
     campaniasDelRango. No se recalculan acá ni se promedian las diarias: el
     promedio de siete CTR no es el CTR de la semana. */
  const DEF: Record<string, Columna<FilaCampania>> = {
    nombre: { clave: "nombre", titulo: "Campaña", tipo: "primary", orden: (c) => c.nombre, celda: (c) => c.nombre },
    estado: { clave: "estado", titulo: "Estado", orden: (c) => c.estado, celda: (c) => <Badge variante={c.estado === "active" ? "success" : c.estado === "paused" ? "warning" : "neutral"}>{c.estado || "—"}</Badge> },
    objetivo: { clave: "objetivo", titulo: "Objetivo", orden: (c) => c.objetivo, celda: (c) => c.objetivo || "—" },
    inversion: { clave: "inversion", titulo: "Inversión", tipo: "num", orden: (c) => c.inversion, celda: (c) => M(c.inversion) },
    cpm: { clave: "cpm", titulo: "CPM", tipo: "num", orden: (c) => c.cpm, celda: (c) => M(c.cpm, 2) },
    impresiones: { clave: "impresiones", titulo: "Impresiones", tipo: "num", orden: (c) => c.impresiones, celda: (c) => num(c.impresiones) },
    anuncios: { clave: "anuncios", titulo: "Anuncios", tipo: "num", orden: (c) => c.anuncios, celda: (c) => num(c.anuncios) },
    dias: { clave: "dias", titulo: "Días con datos", tipo: "num", orden: (c) => c.dias, celda: (c) => num(c.dias) },
    clicks: { clave: "clicks", titulo: "Clicks", tipo: "num", orden: (c) => c.clicks, celda: (c) => num(c.clicks) },
    ctr: { clave: "ctr", titulo: "CTR", tipo: "num", orden: (c) => c.ctr, celda: (c) => pct(c.ctr, 2) },
    cpc: { clave: "cpc", titulo: "CPC", tipo: "num", orden: (c) => c.cpc, celda: (c) => M(c.cpc, 2) },
    clicksEnlace: { clave: "clicksEnlace", titulo: "Clicks en el enlace", tipo: "num", orden: (c) => c.clicksEnlace, celda: (c) => num(c.clicksEnlace) },
    ctrEnlace: { clave: "ctrEnlace", titulo: "CTR del enlace", tipo: "num", orden: (c) => c.ctrEnlace, celda: (c) => pct(c.ctrEnlace, 2) },
    cpcEnlace: { clave: "cpcEnlace", titulo: "Costo por click en enlace", tipo: "num", orden: (c) => c.cpcEnlace, celda: (c) => M(c.cpcEnlace, 2) },
    leads: { clave: "leads", titulo: "Leads", tipo: "num", orden: (c) => c.leads, celda: (c) => num(c.leads) },
    cpl: { clave: "cpl", titulo: "Costo por lead", tipo: "num", orden: (c) => c.cpl, celda: (c) => M(c.cpl, 2) },
    ventas: { clave: "ventas", titulo: "Ventas", tipo: "num", orden: (c) => negocioDeCampania(e, c.nombre).ventas, celda: (c) => num(negocioDeCampania(e, c.nombre).ventas) },
    facturado: { clave: "facturado", titulo: "Facturado", tipo: "num", orden: (c) => negocioDeCampania(e, c.nombre).facturado, celda: (c) => M(negocioDeCampania(e, c.nombre).facturado) },
    cobrado: { clave: "cobrado", titulo: "Cobrado", tipo: "num", orden: (c) => negocioDeCampania(e, c.nombre).cobrado, celda: (c) => M(negocioDeCampania(e, c.nombre).cobrado) },
    roas: {
      clave: "roas", titulo: "ROAS", tipo: "num",
      orden: (c) => (c.inversion > 0 ? negocioDeCampania(e, c.nombre).cobrado / c.inversion : 0),
      celda: (c) => (c.inversion > 0 ? `${num(negocioDeCampania(e, c.nombre).cobrado / c.inversion, 2)}x` : "—"),
    },
  };

  const columnas = cols.visibles.map((k) => DEF[k]).filter(Boolean);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Marketing"
        sub="Lo que invertís y qué te devuelve, campaña por campaña."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={primerDia} onApply={setRango}
              footerNota="Días calendario · zona horaria de Argentina"
            />
          </>
        }
      />

      <Tabs valor={vista} onChange={setVista} opciones={[
        { valor: "dashboard", texto: "Dashboard" },
        { valor: "campanias", texto: `Campañas${filtradas.length ? ` · ${filtradas.length}` : ""}` },
      ]} />

      {vista === "dashboard" && (
        <div className="stack-4">
          <div className="grid-stats">
            <StatCard hero etiqueta={`Inversión · ${rangoSub(rango)}`} valor={M(tot.inv)} contexto={`en ${filtradas.length} campañas`} />
            <StatCard etiqueta="Costo por lead" valor={M(tot.cpl, 2)} contexto={`${num(tot.leads)} leads`} ayuda="Inversión del período dividida por los leads que trajeron esas campañas." />
            <StatCard etiqueta="Costo por venta" valor={tot.ventas > 0 ? M(tot.cac) : "—"} contexto={`${num(tot.ventas)} ventas atribuidas`} ayuda="Inversión dividida por las ventas que se pudieron atribuir." />
            <StatCard
              etiqueta="ROAS" valor={tot.roas > 0 ? `${num(tot.roas, 2)}x` : "—"}
              delta={tot.roas >= 3 ? "Sano" : tot.roas > 0 ? "Justo" : undefined}
              direccion={tot.roas >= 3 ? "up" : "accent"}
              contexto="cobrado sobre inversión" ayuda="Sobre lo realmente cobrado, no sobre lo facturado."
            />
          </div>

          <ConectarMeta rango={rango} />

          <div className="grid-2">
            <Card>
              <CardHead titulo="De dónde vienen tus leads" sub="Todas las fuentes, no sólo las pagas." />
              <Donut datos={porFuente} formato={num} total={num(e.leads.length)} totalEtiqueta="leads" />
            </Card>
            <Card>
              <CardHead titulo="Costo por lead por campaña" sub={`${rangoSub(rango)}. Más bajo es mejor.`} />
              {filtradas.length === 0
                ? <p className="t-sm t-subtle" style={{ padding: 24, textAlign: "center" }}>No hay campañas en este período.</p>
                : <BarChart
                    datos={filtradas.map((c) => ({ etiqueta: truncar(c.nombre, 12), valor: c.cpl, completo: c.nombre }))}
                    formato={(n) => M(n, 0)} alto={200} color="var(--accent)"
                  />}
            </Card>
          </div>
        </div>
      )}

      {vista === "campanias" && (
        <div className="stack-4">
          <div className="row" style={{ gap: "var(--space-2)", flexWrap: "wrap" }}>
            <div style={{ minWidth: 220, flex: 1, maxWidth: 340 }}>
              <Input value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar por nombre u objetivo" icono={<Search size={16} />} />
            </div>
            <div style={{ width: 150 }}>
              <Select value={fEstado} onChange={(ev) => setFEstado(ev.target.value)} placeholder="Todos los estados"
                opciones={(Object.keys(ETIQUETA) as EstadoCampania[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto }))} />
            </div>
            <span className="spacer" />
            <ConfigColumnas
              todas={COLUMNAS} visibles={cols.visibles}
              alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar}
            />
          </div>

          <Card style={{ padding: 0 }}>
            <DataTable
              filas={filtradas} columnas={columnas} alto={560}
              ordenInicial={{ clave: "inversion", desc: true }}
              onFila={(c) => setVer(c.id)} etiquetaFila={(c) => `Ver ${c.nombre}`}
              vacio={
                <Empty
                  icono={<Megaphone size={22} />}
                  titulo={e.campaigns.length === 0 ? "Todavía no trajiste nada de Meta" : "Ninguna campaña gastó en este período"}
                  texto={e.campaigns.length === 0
                    ? "Conectá Meta y apretá «Traer anuncios y días» en el Dashboard."
                    : "Probá con otro rango de fechas, o sacá los filtros."}
                />
              }
            />
          </Card>
        </div>
      )}

      {cVista && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={cVista.nombre}
          sub={`${cVista.objetivo || "Sin objetivo"} · ${rangoSub(rango)}`}
        >
          <div className="stack-5">
            <div className="grid-2" style={{ gap: 12 }}>
              <Mini etiqueta="Inversión" valor={M(cVista.inversion)} />
              <Mini etiqueta="Costo por lead" valor={M(cVista.cpl, 2)} />
              <Mini etiqueta="CTR" valor={pct(cVista.ctr, 2)} />
              <Mini etiqueta="Clicks en el enlace" valor={num(cVista.clicksEnlace)} />
            </div>

            <dl className="dl">
              <Dato label="Impresiones">{num(cVista.impresiones)}</Dato>
              <Dato label="Clicks">{num(cVista.clicks)}</Dato>
              <Dato label="Leads">{num(cVista.leads)}</Dato>
              <Dato label="Anuncios que corrieron">{num(cVista.anuncios)}</Dato>
              <Dato label="Días con datos">{num(cVista.dias)}</Dato>
            </dl>

            {/* Acá se ven los dos niveles de abajo, que hasta ahora estaban en
                la base sin que ninguna pantalla los mostrara. */}
            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>
                Conjuntos de anuncios
              </div>
              <div className="stack-2">
                {e.adsets.filter((s) => s.campaignId === cVista.id).map((s) => {
                  const suyos = e.ads.filter((a) => a.adsetId === s.id);
                  return (
                    <div key={s.id} className="agenda-item" style={{ cursor: "default" }}>
                      <span className="truncate" style={{ flex: 1 }}>{s.nombre}</span>
                      <span className="t-sm t-num t-subtle">{num(suyos.length)} anuncios</span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Drawer>
      )}

    </div>
  );
}

function Mini({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div style={{ background: "var(--surface-200)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>{etiqueta}</div>
      <div className="t-num" style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{valor}</div>
    </div>
  );
}
