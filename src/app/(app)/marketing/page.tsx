"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Megaphone, Pencil, Plus, Plug, Trash2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, StatCard, Textarea } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { COLORES, Donut, BarChart } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { fechaLarga, isoDia, money, num, pct } from "@/lib/format";
import { cac, cpl, inversionTotal, leadsDeCampanias, metricasCampania, roas } from "@/lib/metricas";
import type { Campania, EstadoCampania } from "@/lib/types";

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

export default function Marketing() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [form, setForm] = useState<(Omit<Campania, "id"> & { id?: string }) | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Campania | null>(null);

  useEffect(() => {
    if (url.nuevo) { setForm(VACIA()); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url]);

  const porFuente = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of e.leads) m.set(l.fuente || "Sin fuente", (m.get(l.fuente || "Sin fuente") ?? 0) + 1);
    return [...m.entries()]
      .sort((a, b) => b[1] - a[1])
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

  const columnas: Columna<Campania>[] = [
    { clave: "nombre", titulo: "Campaña", tipo: "primary", orden: (c) => c.nombre, celda: (c) => c.nombre },
    { clave: "estado", titulo: "Estado", orden: (c) => c.estado, celda: (c) => <Badge variante={ETIQUETA[c.estado].variante}>{ETIQUETA[c.estado].texto}</Badge> },
    { clave: "inv", titulo: "Inversión", tipo: "num", orden: (c) => c.inversion, celda: (c) => money(c.inversion, e.ajustes.monedaBase) },
    { clave: "leads", titulo: "Leads", tipo: "num", orden: (c) => c.leads, celda: (c) => num(c.leads) },
    { clave: "cpl", titulo: "Costo por lead", tipo: "num", orden: (c) => metricasCampania(c).cpl, celda: (c) => money(metricasCampania(c).cpl, e.ajustes.monedaBase, 2) },
    { clave: "ctr", titulo: "CTR", tipo: "num", orden: (c) => metricasCampania(c).ctr, celda: (c) => pct(metricasCampania(c).ctr, 2) },
  ];

  const inv = inversionTotal(e);
  const r = roas(e);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Marketing"
        sub="Lo que invertís en Meta y qué te devuelve. Cargá una campaña y te calculo cuánto te cuesta cada lead y cada alumno."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIA())}>Nueva campaña</Button>}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Inversión total" valor={money(inv, e.ajustes.monedaBase)} contexto={`en ${e.campanias.length} campañas`} />
        <StatCard etiqueta="Costo por lead" valor={money(cpl(e), e.ajustes.monedaBase, 2)} contexto={`${num(leadsDeCampanias(e))} leads pagos`} ayuda="Inversión total dividida por los leads que trajeron las campañas." />
        <StatCard etiqueta="Costo por alumno" valor={money(cac(e), e.ajustes.monedaBase)} contexto="lo que sale cerrar uno" ayuda="Inversión total dividida por la cantidad de inscriptos." />
        <StatCard
          etiqueta="Retorno" valor={r > 0 ? `${num(r, 1)}x` : "—"}
          delta={r >= 3 ? "Sano" : r > 0 ? "Justo" : undefined} direccion={r >= 3 ? "up" : "accent"}
          contexto="ingresos sobre inversión" ayuda="Cuántas veces recuperás lo que invertís en publicidad."
        />
      </div>

      {!e.ajustes.metaToken && (
        <Ayuda titulo="Conectá Meta para que los números entren solos" icono={<Plug size={18} />}>
          Hoy las campañas las cargás a mano y funciona igual. Si pegás tu token de Meta y el ID de la cuenta
          publicitaria en Ajustes → Integraciones, la inversión, las impresiones y los clicks se van a actualizar
          sin que toques nada.
        </Ayuda>
      )}

      <div className="grid-2">
        <Card>
          <CardHead titulo="De dónde vienen tus leads" sub="Todas las fuentes, no sólo las pagas." />
          <Donut datos={porFuente} formato={num} total={num(e.leads.length)} totalEtiqueta="leads" />
        </Card>
        <Card>
          <CardHead titulo="Costo por lead por campaña" sub="Más bajo es mejor." />
          {e.campanias.length === 0
            ? <p className="t-sm t-subtle" style={{ padding: 24, textAlign: "center" }}>Cargá una campaña para ver esto.</p>
            : <BarChart
                datos={e.campanias.map((c) => ({ etiqueta: c.nombre.split("-")[0], valor: metricasCampania(c).cpl }))}
                formato={(n) => money(n, e.ajustes.monedaBase, 0)} alto={200} color="var(--accent)"
              />}
        </Card>
      </div>

      <Card style={{ padding: 0 }}>
        <DataTable
          filas={e.campanias} columnas={columnas} ordenInicial={{ clave: "inv", desc: true }}
          onFila={(c) => setVer(c.id)} etiquetaFila={(c) => `Ver ${c.nombre}`}
          acciones={(c) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm({ ...c })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(c)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty
              icono={<Megaphone size={22} />} titulo="Todavía no cargaste campañas"
              texto="Cargá una con lo que invertiste y los leads que trajo, y te calculo el costo por lead, el CTR y el retorno."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIA())}>Cargar mi primera campaña</Button>}
            />
          }
        />
      </Card>

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
            <Field label="Clicks">
              <Input type="number" min={0} value={form.clicks} onChange={(ev) => setForm({ ...form, clicks: Number(ev.target.value) })} />
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
              <Mini etiqueta="Costo por lead" valor={money(mVista.cpl, e.ajustes.monedaBase, 2)} />
              <Mini etiqueta="CTR" valor={pct(mVista.ctr, 2)} />
              <Mini etiqueta="Costo por click" valor={money(mVista.cpc, e.ajustes.monedaBase, 2)} />
              <Mini etiqueta="CPM" valor={money(mVista.cpm, e.ajustes.monedaBase, 2)} />
            </div>

            <dl className="dl">
              <Dato label="Inversión">{money(cVista.inversion, e.ajustes.monedaBase)}</Dato>
              <Dato label="Impresiones">{num(cVista.impresiones)}</Dato>
              <Dato label="Clicks">{num(cVista.clicks)}</Dato>
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
