"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Megaphone, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select,
  StatCard, Tabs,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { ConectarMeta } from "@/components/shell/ConectarMeta";
import { COLORES, Donut, BarChart, truncar } from "@/components/charts/charts";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { fechaLarga, isoDia, money, num, pct } from "@/lib/format";
import { metricasCampania, negocioDeCampania } from "@/lib/metricas";
import type { Campania, EstadoCampania } from "@/lib/types";

type Vista = "dashboard" | "campanias";

const ETIQUETA: Record<EstadoCampania, { texto: string; variante: "success" | "warning" | "neutral" }> = {
  "activa": { texto: "Activa", variante: "success" },
  "pausada": { texto: "Pausada", variante: "warning" },
  "finalizada": { texto: "Finalizada", variante: "neutral" },
};

const VACIA = (): Omit<Campania, "id"> => ({
  nombre: "", plataforma: "Meta", objetivo: "Conversiones", estado: "activa",
  inversion: 0, impresiones: 0, clicks: 0, leads: 0,
  desde: new Date().toISOString(), creadoEn: new Date().toISOString(), extra: {},
});

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
  const [form, setForm] = useState<(Omit<Campania, "id"> & { id?: string }) | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Campania | null>(null);

  const [rango, setRango] = useRangoURL("mes");
  const [busca, setBusca] = useState("");
  const [fEstado, setFEstado] = useState("");
  const [fPlataforma, setFPlataforma] = useState("");

  const cols = useColumnas("campanias", COLUMNAS, POR_DEFECTO);

  useEffect(() => {
    if (url.nuevo) { setVista("campanias"); setForm(VACIA()); url.limpiar(); }
    else if (url.ver) { setVista("campanias"); setVer(url.ver); url.limpiar(); }
  }, [url]);

  const M = (n: number, d = 0) => money(n, e.ajustes.monedaBase, d);

  /* Una campaña entra si SOLAPA el rango, no si empezó adentro: una que viene
     corriendo desde marzo y sigue viva es parte de lo que pasó este mes. */
  const enRango = useMemo(() => {
    const desde = new Date(`${rango.desde}T00:00:00`).getTime();
    const hasta = new Date(`${rango.hasta}T23:59:59`).getTime();
    return e.campanias.filter((c) => {
      const a = new Date(c.desde).getTime();
      const b = c.hasta ? new Date(c.hasta).getTime() : Infinity;
      return a <= hasta && b >= desde;
    });
  }, [e.campanias, rango]);

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return enRango.filter((c) =>
      (!q || c.nombre.toLowerCase().includes(q) || c.objetivo.toLowerCase().includes(q)) &&
      (!fEstado || c.estado === fEstado) &&
      (!fPlataforma || c.plataforma === fPlataforma));
  }, [enRango, busca, fEstado, fPlataforma]);

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

  const cVista = e.campanias.find((c) => c.id === ver) ?? null;
  const mVista = cVista ? metricasCampania(cVista) : null;

  function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) { toast("Ponele un nombre a la campaña.", "err"); return; }
    if (form.id) { acciones.actualizar<Campania>("campanias", form.id, form, form.nombre); toast("Campaña actualizada."); }
    else { acciones.crear<Campania>("campanias", form, form.nombre); toast(`«${form.nombre}» creada.`); }
    setForm(null);
  }

  /* Cada columna del catálogo, definida una sola vez. La tabla recibe sólo las
     prendidas, en el orden en que quedaron. */
  const DEF: Record<string, Columna<Campania>> = {
    nombre: { clave: "nombre", titulo: "Campaña", tipo: "primary", orden: (c) => c.nombre, celda: (c) => c.nombre },
    estado: { clave: "estado", titulo: "Estado", orden: (c) => c.estado, celda: (c) => <Badge variante={ETIQUETA[c.estado].variante}>{ETIQUETA[c.estado].texto}</Badge> },
    plataforma: { clave: "plataforma", titulo: "Plataforma", orden: (c) => c.plataforma, celda: (c) => c.plataforma },
    objetivo: { clave: "objetivo", titulo: "Objetivo", orden: (c) => c.objetivo, celda: (c) => c.objetivo },
    inversion: { clave: "inversion", titulo: "Inversión", tipo: "num", orden: (c) => c.inversion, celda: (c) => M(c.inversion) },
    cpm: { clave: "cpm", titulo: "CPM", tipo: "num", orden: (c) => metricasCampania(c).cpm, celda: (c) => M(metricasCampania(c).cpm, 2) },
    impresiones: { clave: "impresiones", titulo: "Impresiones", tipo: "num", orden: (c) => c.impresiones, celda: (c) => num(c.impresiones) },
    alcance: { clave: "alcance", titulo: "Alcance", tipo: "num", orden: (c) => c.alcance ?? 0, celda: (c) => (c.alcance ? num(c.alcance) : "—") },
    frecuencia: { clave: "frecuencia", titulo: "Frecuencia", tipo: "num", orden: (c) => c.frecuencia ?? 0, celda: (c) => (c.frecuencia ? num(c.frecuencia, 2) : "—") },
    clicks: { clave: "clicks", titulo: "Clicks", tipo: "num", orden: (c) => c.clicks, celda: (c) => num(c.clicks) },
    ctr: { clave: "ctr", titulo: "CTR", tipo: "num", orden: (c) => metricasCampania(c).ctr, celda: (c) => pct(metricasCampania(c).ctr, 2) },
    cpc: { clave: "cpc", titulo: "CPC", tipo: "num", orden: (c) => metricasCampania(c).cpc, celda: (c) => M(metricasCampania(c).cpc, 2) },
    clicksEnlace: { clave: "clicksEnlace", titulo: "Clicks en el enlace", tipo: "num", orden: (c) => c.clicksEnlace ?? 0, celda: (c) => (c.clicksEnlace ? num(c.clicksEnlace) : "—") },
    ctrEnlace: { clave: "ctrEnlace", titulo: "CTR del enlace", tipo: "num", orden: (c) => c.ctrEnlace ?? 0, celda: (c) => (c.ctrEnlace ? pct(c.ctrEnlace, 2) : "—") },
    cpcEnlace: { clave: "cpcEnlace", titulo: "Costo por click en enlace", tipo: "num", orden: (c) => c.costoPorClickEnlace ?? 0, celda: (c) => (c.costoPorClickEnlace ? M(c.costoPorClickEnlace, 2) : "—") },
    leads: { clave: "leads", titulo: "Leads", tipo: "num", orden: (c) => c.leads, celda: (c) => num(c.leads) },
    cpl: { clave: "cpl", titulo: "Costo por lead", tipo: "num", orden: (c) => metricasCampania(c).cpl, celda: (c) => M(metricasCampania(c).cpl, 2) },
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
  const plataformas = [...new Set(e.campanias.map((c) => c.plataforma))];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Marketing"
        sub="Lo que invertís y qué te devuelve, campaña por campaña."
        acciones={
          <>
            <DateRangePicker
              value={rango} minDate={null} onApply={setRango}
              footerNota="Días calendario · zona horaria de Argentina"
            />
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => { setVista("campanias"); setForm(VACIA()); }}>Nueva campaña</Button>
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
                    datos={filtradas.map((c) => ({ etiqueta: truncar(c.nombre, 12), valor: metricasCampania(c).cpl, completo: c.nombre }))}
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
            <div style={{ width: 150 }}>
              <Select value={fPlataforma} onChange={(ev) => setFPlataforma(ev.target.value)} placeholder="Todas las plataformas" opciones={plataformas} />
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
              acciones={(c) => (
                <>
                  <IconButton etiqueta="Editar" onClick={() => setForm({ ...c })}><Pencil size={15} /></IconButton>
                  <IconButton etiqueta="Eliminar" onClick={() => setBorrar(c)}><Trash2 size={15} /></IconButton>
                </>
              )}
              vacio={
                <Empty
                  icono={<Megaphone size={22} />}
                  titulo={e.campanias.length === 0 ? "Todavía no cargaste campañas" : "Ninguna campaña en este período"}
                  texto={e.campanias.length === 0
                    ? "Conectá Meta o cargá una a mano con lo que invertiste y los leads que trajo."
                    : "Probá con otro rango de fechas, o sacá los filtros."}
                  accion={e.campanias.length === 0
                    ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIA())}>Cargar mi primera campaña</Button>
                    : undefined}
                />
              }
            />
          </Card>
        </div>
      )}

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar campaña" : "Nueva campaña"}
          sub="Copiá los números del administrador de anuncios. Con la inversión y los leads ya te calculo lo importante."
          guardarTexto={form.id ? "Guardar cambios" : "Crear campaña"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Nombre" span2>
              <Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Remoto-USA-Frío" autoFocus />
            </Field>
            <Field label="Plataforma">
              <Select value={form.plataforma} onChange={(ev) => setForm({ ...form, plataforma: ev.target.value })} opciones={["Meta", "Google", "TikTok", "YouTube", "LinkedIn"]} />
            </Field>
            <Field label="Objetivo">
              <Select value={form.objetivo} onChange={(ev) => setForm({ ...form, objetivo: ev.target.value })} opciones={["Conversiones", "Clientes potenciales", "Tráfico", "Reproducciones", "Alcance"]} />
            </Field>
            <Field label="Estado">
              <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoCampania })}
                opciones={(Object.keys(ETIQUETA) as EstadoCampania[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto }))} />
            </Field>
            <Field label="Inversión">
              <Input type="number" min={0} value={form.inversion} onChange={(ev) => setForm({ ...form, inversion: Number(ev.target.value) })} />
            </Field>
            <Field label="Impresiones">
              <Input type="number" min={0} value={form.impresiones} onChange={(ev) => setForm({ ...form, impresiones: Number(ev.target.value) })} />
            </Field>
            <Field label="Clicks" ayuda="Todos los clicks, como los reporta Meta.">
              <Input type="number" min={0} value={form.clicks} onChange={(ev) => setForm({ ...form, clicks: Number(ev.target.value) })} />
            </Field>
            <Field label="Clicks en el enlace" ayuda="Los que se fueron a la landing.">
              <Input type="number" min={0} value={form.clicksEnlace ?? 0} onChange={(ev) => setForm({ ...form, clicksEnlace: Number(ev.target.value) })} />
            </Field>
            <Field label="Leads" ayuda="Cuántos formularios completaron.">
              <Input type="number" min={0} value={form.leads} onChange={(ev) => setForm({ ...form, leads: Number(ev.target.value) })} />
            </Field>
            <Field label="Desde">
              <Input type="date" value={isoDia(form.desde)} onChange={(ev) => setForm({ ...form, desde: new Date(ev.target.value).toISOString() })} />
            </Field>
            <CamposExtra campos={e.campos} entidad="campania" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
          </div>
        </ModalForm>
      )}

      {cVista && mVista && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={cVista.nombre} sub={`${cVista.plataforma} · ${cVista.objetivo}`}
          pie={
            <>
              <Button variante="secondary" icono={<Pencil size={16} />} onClick={() => { setForm({ ...cVista }); setVer(null); }}>Editar</Button>
              <Button variante="danger" icono={<Trash2 size={16} />} onClick={() => { setBorrar(cVista); setVer(null); }}>Eliminar</Button>
            </>
          }
        >
          <div className="stack-5">
            <Badge variante={ETIQUETA[cVista.estado].variante}>{ETIQUETA[cVista.estado].texto}</Badge>

            <div className="grid-2" style={{ gap: 12 }}>
              <Mini etiqueta="Costo por lead" valor={M(mVista.cpl, 2)} />
              <Mini etiqueta="CTR" valor={pct(mVista.ctr, 2)} />
              <Mini etiqueta="Costo por click" valor={M(mVista.cpc, 2)} />
              <Mini etiqueta="CPM" valor={M(mVista.cpm, 2)} />
            </div>

            <dl className="dl">
              <Dato label="Inversión">{M(cVista.inversion)}</Dato>
              <Dato label="Impresiones">{num(cVista.impresiones)}</Dato>
              {cVista.alcance ? <Dato label="Alcance">{num(cVista.alcance)}</Dato> : null}
              {cVista.frecuencia ? <Dato label="Frecuencia">{num(cVista.frecuencia, 2)}</Dato> : null}
              <Dato label="Clicks">{num(cVista.clicks)}</Dato>
              {cVista.clicksEnlace ? <Dato label="Clicks en el enlace">{num(cVista.clicksEnlace)}</Dato> : null}
              <Dato label="Leads">{num(cVista.leads)}</Dato>
              <Dato label="Desde">{fechaLarga(cVista.desde)}</Dato>
              {cVista.hasta && <Dato label="Hasta">{fechaLarga(cVista.hasta)}</Dato>}
              <DatosExtra campos={e.campos} entidad="campania" valores={cVista.extra} />
            </dl>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Leads con esta campaña</div>
              {e.leads.filter((l) => l.campania === cVista.nombre).length === 0 ? (
                <p className="t-sm t-subtle">Ningún lead quedó etiquetado con esta campaña todavía.</p>
              ) : (
                <div className="stack-2">
                  {e.leads.filter((l) => l.campania === cVista.nombre).slice(0, 8).map((l) => (
                    <div key={l.id} className="agenda-item" style={{ cursor: "default" }}>
                      <span className="truncate" style={{ flex: 1 }}>{l.nombre}</span>
                      <span className="t-sm t-num t-subtle">{money(l.monto, l.moneda)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Drawer>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar esta campaña?"
        texto={`Se borra «${borrar?.nombre}» y sus números dejan de contar en los totales.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("campanias", borrar.id, borrar.nombre); toast("Campaña eliminada."); } }}
      />
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
