"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2, Video } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Bar, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, StatCard, Textarea } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { BarChart, Funnel } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { fechaLarga, isoMinuto, money, num, pct } from "@/lib/format";
import { metricasWebinar } from "@/lib/metricas";
import type { EstadoWebinar, Webinar } from "@/lib/types";

const ETIQUETA: Record<EstadoWebinar, { texto: string; variante: "neutral" | "accent" | "danger" | "success" }> = {
  "borrador": { texto: "Borrador", variante: "neutral" },
  "programado": { texto: "Programado", variante: "accent" },
  "en-vivo": { texto: "En vivo", variante: "danger" },
  "finalizado": { texto: "Finalizado", variante: "success" },
};

const VACIO = (): Omit<Webinar, "id"> => {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(19, 0, 0, 0);
  return {
    titulo: "", fecha: d.toISOString(), duracionMin: 75, estado: "programado",
    registrados: 0, asistentes: 0, inversion: 0, enlaceRegistro: "", enlaceReplay: "",
    notas: "", creadoEn: new Date().toISOString(), extra: {},
  };
};

export default function Webinars() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [form, setForm] = useState<(Omit<Webinar, "id"> & { id?: string }) | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Webinar | null>(null);

  useEffect(() => {
    if (url.nuevo) { setForm(VACIO()); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url]);

  const finalizados = e.webinars.filter((w) => w.estado === "finalizado");
  const totales = useMemo(() => ({
    registrados: e.webinars.reduce((a, w) => a + w.registrados, 0),
    asistentes: finalizados.reduce((a, w) => a + w.asistentes, 0),
    inversion: e.webinars.reduce((a, w) => a + w.inversion, 0),
    leads: e.leads.filter((l) => l.webinarId).length,
  }), [e.webinars, e.leads, finalizados]);

  const asistenciaMedia = totales.registrados > 0
    ? (finalizados.reduce((a, w) => a + w.asistentes, 0) / Math.max(finalizados.reduce((a, w) => a + w.registrados, 0), 1)) * 100 : 0;

  const wVisto = e.webinars.find((w) => w.id === ver) ?? null;
  const mVisto = wVisto ? metricasWebinar(e, wVisto.id) : null;

  function guardar() {
    if (!form) return;
    if (!form.titulo.trim()) { toast("Ponele un título al webinar.", "err"); return; }
    if (form.id) { acciones.actualizar<Webinar>("webinars", form.id, form, form.titulo); toast("Webinar actualizado."); }
    else { acciones.crear<Webinar>("webinars", form, form.titulo); toast(`«${form.titulo}» creado.`); }
    setForm(null);
  }

  const columnas: Columna<Webinar>[] = [
    { clave: "titulo", titulo: "Webinar", tipo: "primary", orden: (w) => w.titulo, celda: (w) => <span className="truncate" style={{ display: "block", maxWidth: 320 }}>{w.titulo}</span> },
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (w) => w.fecha, celda: (w) => fechaLarga(w.fecha) },
    { clave: "estado", titulo: "Estado", orden: (w) => w.estado, celda: (w) => <Badge variante={ETIQUETA[w.estado].variante}>{ETIQUETA[w.estado].texto}</Badge> },
    { clave: "reg", titulo: "Registrados", tipo: "num", orden: (w) => w.registrados, celda: (w) => num(w.registrados) },
    { clave: "asis", titulo: "Asistencia", tipo: "num", orden: (w) => (w.registrados ? w.asistentes / w.registrados : 0), celda: (w) => w.estado === "finalizado" ? `${num(w.asistentes)} · ${pct(w.registrados ? (w.asistentes / w.registrados) * 100 : 0, 0)}` : "—" },
    { clave: "inv", titulo: "Inversión", tipo: "num", orden: (w) => w.inversion, celda: (w) => money(w.inversion, e.ajustes.monedaBase) },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Webinars"
        sub="Cada clase en vivo con sus números: cuánta gente se anotó, cuánta vino y cuánta terminó comprando."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIO())}>Nuevo webinar</Button>}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Registrados" valor={num(totales.registrados)} contexto={`en ${e.webinars.length} webinars`} />
        <StatCard etiqueta="Asistencia media" valor={pct(asistenciaMedia)} contexto="de los que se anotan, cuántos vienen" />
        <StatCard etiqueta="Leads generados" valor={num(totales.leads)} contexto="que vinieron de un webinar" />
        <StatCard etiqueta="Inversión total" valor={money(totales.inversion, e.ajustes.monedaBase)} contexto="en promoción de webinars" />
      </div>

      {e.webinars.length > 0 && (
        <Card>
          <CardHead titulo="Registrados por webinar" sub="Cuál convocó más gente." />
          <BarChart datos={[...e.webinars].sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha)).map((w) => ({ etiqueta: w.titulo.split(" ").slice(0, 2).join(" "), valor: w.registrados }))} formato={num} alto={200} />
        </Card>
      )}

      <Card style={{ padding: 0 }}>
        <DataTable
          filas={e.webinars} columnas={columnas} ordenInicial={{ clave: "fecha", desc: true }}
          onFila={(w) => setVer(w.id)} etiquetaFila={(w) => `Ver ${w.titulo}`}
          acciones={(w) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm({ ...w })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(w)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty
              icono={<Video size={22} />} titulo="Todavía no cargaste ningún webinar"
              texto="Cargá uno con su fecha y cuánta gente se anotó, y te calculo la asistencia, los leads y el retorno."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIO())}>Cargar mi primer webinar</Button>}
            />
          }
        />
      </Card>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar webinar" : "Nuevo webinar"}
          sub="Con el título y la fecha alcanza para empezar. Los números los cargás después del evento."
          guardarTexto={form.id ? "Guardar cambios" : "Crear webinar"}
          puedeGuardar={form.titulo.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Título" span2>
              <Input value={form.titulo} onChange={(ev) => setForm({ ...form, titulo: ev.target.value })} placeholder="Cómo conseguir tu primer trabajo remoto en USA" autoFocus />
            </Field>
            <Field label="Fecha y hora">
              <Input type="datetime-local" value={isoMinuto(form.fecha)} onChange={(ev) => setForm({ ...form, fecha: new Date(ev.target.value).toISOString() })} />
            </Field>
            <Field label="Duración" ayuda="En minutos.">
              <Input type="number" min={5} step={5} value={form.duracionMin} onChange={(ev) => setForm({ ...form, duracionMin: Number(ev.target.value) })} />
            </Field>
            <Field label="Estado">
              <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoWebinar })}
                opciones={(Object.keys(ETIQUETA) as EstadoWebinar[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto }))} />
            </Field>
            <Field label="Inversión" ayuda="Lo que gastaste para llenarlo.">
              <Input type="number" min={0} value={form.inversion} onChange={(ev) => setForm({ ...form, inversion: Number(ev.target.value) })} />
            </Field>
            <Field label="Registrados">
              <Input type="number" min={0} value={form.registrados} onChange={(ev) => setForm({ ...form, registrados: Number(ev.target.value) })} />
            </Field>
            <Field label="Asistentes" ayuda="Cuántos entraron en vivo.">
              <Input type="number" min={0} value={form.asistentes} onChange={(ev) => setForm({ ...form, asistentes: Number(ev.target.value) })} />
            </Field>
            <Field label="Link de registro" span2>
              <Input value={form.enlaceRegistro ?? ""} onChange={(ev) => setForm({ ...form, enlaceRegistro: ev.target.value })} placeholder="https://hackearit.com/webinar" />
            </Field>
            <Field label="Link del replay" span2>
              <Input value={form.enlaceReplay ?? ""} onChange={(ev) => setForm({ ...form, enlaceReplay: ev.target.value })} placeholder="https://hackearit.com/replay" />
            </Field>
            <Field label="Notas" span2>
              <Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={3} />
            </Field>
            <CamposExtra campos={e.campos} entidad="webinar" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
          </div>
        </ModalForm>
      )}

      {wVisto && mVisto && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={wVisto.titulo} sub={fechaLarga(wVisto.fecha)}
          pie={
            <>
              <Button variante="secondary" icono={<Pencil size={16} />} onClick={() => { setForm({ ...wVisto }); setVer(null); }}>Editar</Button>
              <Button variante="danger" icono={<Trash2 size={16} />} onClick={() => { setBorrar(wVisto); setVer(null); }}>Eliminar</Button>
            </>
          }
        >
          <div className="stack-5">
            <Badge variante={ETIQUETA[wVisto.estado].variante}>{ETIQUETA[wVisto.estado].texto}</Badge>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>De registrado a inscripto</div>
              <Funnel
                pasos={[
                  { etiqueta: "Registrados", valor: wVisto.registrados, color: "var(--info)" },
                  { etiqueta: "Asistieron", valor: wVisto.asistentes, color: "var(--brand-fill)" },
                  { etiqueta: "Se hicieron lead", valor: mVisto.leads, color: "var(--accent)" },
                  { etiqueta: "Se inscribieron", valor: mVisto.inscriptos, color: "var(--success)" },
                ]}
                formato={num}
              />
            </div>

            <div className="grid-2" style={{ gap: 12 }}>
              <Mini etiqueta="Asistencia" valor={pct(mVisto.asistencia)} />
              <Mini etiqueta="Conversión" valor={pct(mVisto.conversion)} />
              <Mini etiqueta="Ingresos" valor={money(mVisto.ingresos, e.ajustes.monedaBase)} />
              <Mini etiqueta="Retorno" valor={wVisto.inversion > 0 ? pct(mVisto.roi, 0) : "—"} tono={mVisto.roi >= 0 ? "success" : "danger"} />
            </div>

            <div>
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="t-sm t-strong">Costo por registrado</span>
                <span className="spacer t-sm t-num">{money(mVisto.costoPorRegistrado, e.ajustes.monedaBase, 2)}</span>
              </div>
              <Bar valor={Math.min((mVisto.costoPorRegistrado / 10) * 100, 100)} tono={mVisto.costoPorRegistrado < 3 ? "success" : mVisto.costoPorRegistrado < 6 ? "accent" : "danger"} />
            </div>

            <dl className="dl">
              <Dato label="Duración">{wVisto.duracionMin} min</Dato>
              <Dato label="Inversión">{money(wVisto.inversion, e.ajustes.monedaBase)}</Dato>
              <Dato label="Registrados">{num(wVisto.registrados)}</Dato>
              <Dato label="Asistentes">{num(wVisto.asistentes)}</Dato>
              <DatosExtra campos={e.campos} entidad="webinar" valores={wVisto.extra} />
            </dl>

            <div className="row-wrap">
              {wVisto.enlaceRegistro && <a href={wVisto.enlaceRegistro} target="_blank" rel="noreferrer"><Button sm variante="secondary" icono={<ExternalLink size={15} />}>Página de registro</Button></a>}
              {wVisto.enlaceReplay && <a href={wVisto.enlaceReplay} target="_blank" rel="noreferrer"><Button sm variante="secondary" icono={<ExternalLink size={15} />}>Ver el replay</Button></a>}
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Leads que trajo ({mVisto.leads})</div>
              {mVisto.leads === 0 ? (
                <p className="t-sm t-subtle">Todavía ningún lead quedó asociado a este webinar.</p>
              ) : (
                <div className="stack-2">
                  {e.leads.filter((l) => l.webinarId === wVisto.id).slice(0, 8).map((l) => (
                    <div key={l.id} className="agenda-item" style={{ cursor: "default" }}>
                      <span className="truncate" style={{ flex: 1 }}>{l.nombre}</span>
                      <span className="t-sm t-num t-subtle">{money(l.monto, l.moneda)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {wVisto.notas && (
              <div>
                <div className="t-label" style={{ marginBottom: 8 }}>Notas</div>
                <p className="t-body t-muted" style={{ whiteSpace: "pre-wrap" }}>{wVisto.notas}</p>
              </div>
            )}
          </div>
        </Drawer>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar este webinar?"
        texto={`Se borra «${borrar?.titulo}» y sus números. Los leads que trajo quedan, pero pierden la referencia.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("webinars", borrar.id, borrar.titulo); toast("Webinar eliminado."); } }}
      />
    </div>
  );
}

function Mini({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: "success" | "danger" }) {
  return (
    <div style={{ background: "var(--surface-200)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>{etiqueta}</div>
      <div className="t-num" style={{ fontSize: 20, fontWeight: 600, color: tono === "success" ? "var(--success)" : tono === "danger" ? "var(--danger)" : "var(--ink)" }}>{valor}</div>
    </div>
  );
}
