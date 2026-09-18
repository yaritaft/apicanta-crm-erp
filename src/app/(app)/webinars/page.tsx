"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ExternalLink, Info, Pencil, Plus, Trash2, Video } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, StatCard, Textarea,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { AreaChart, Funnel } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { fecha, fechaLarga, isoMinuto, money, num, pct } from "@/lib/format";
import { metricasDeWebinar, serieDeWebinars } from "@/lib/webinar";
import type { EstadoWebinar, Webinar } from "@/lib/types";

const ETIQUETA: Record<EstadoWebinar, { texto: string; variante: "neutral" | "accent" | "danger" | "success" }> = {
  "borrador":   { texto: "Borrador",   variante: "neutral" },
  "programado": { texto: "Programado", variante: "accent" },
  "en-vivo":    { texto: "En vivo",    variante: "danger" },
  "finalizado": { texto: "Finalizado", variante: "success" },
};

const VACIO = (): Omit<Webinar, "id"> => {
  const d = new Date(); d.setDate(d.getDate() + 14); d.setHours(19, 0, 0, 0);
  return {
    titulo: "", fecha: d.toISOString(), duracionMin: 75, estado: "programado",
    registrados: 0, asistentes: 0, inversion: 0,
    formularios: 0, grupoWpp: 0, llamadasVivo: 0, llamadasPosterior: 0,
    llamadasCanceladas: 0, llamadasInasistidas: 0, llamadasNoCalificadas: 0,
    llamadasCalificadas: 0, inversionDmAds: 0, costoWhatsappApi: 0,
    enlaceRegistro: "", enlaceReplay: "", notas: "",
    creadoEn: new Date().toISOString(), extra: {},
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

  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);
  const serie = useMemo(() => serieDeWebinars(e), [e]);

  const totales = useMemo(() => {
    const inv = serie.reduce((a, x) => a + x.m.inversionTotal, 0);
    const cc = serie.reduce((a, x) => a + x.m.cobrado, 0);
    const rev = serie.reduce((a, x) => a + x.m.facturado, 0);
    return {
      inv, cc, rev,
      roasCC: inv > 0 ? cc / inv : 0,
      roasRev: inv > 0 ? rev / inv : 0,
      formularios: serie.reduce((a, x) => a + x.m.formularios, 0),
      ventas: serie.reduce((a, x) => a + x.m.ventas, 0),
    };
  }, [serie]);

  const wVisto = e.webinars.find((w) => w.id === ver) ?? null;
  const mVisto = wVisto ? metricasDeWebinar(e, wVisto) : null;

  function guardar() {
    if (!form) return;
    if (!form.titulo.trim()) { toast("Ponele un título al webinar.", "err"); return; }
    if (form.id) { acciones.actualizar<Webinar>("webinars", form.id, form, form.titulo); toast("Webinar actualizado."); }
    else { acciones.crear<Webinar>("webinars", form, form.titulo); toast(`«${form.titulo}» creado.`); }
    setForm(null);
  }

  const columnas: Columna<Webinar>[] = [
    { clave: "titulo", titulo: "Webinar", tipo: "primary", orden: (w) => w.fecha, celda: (w) => <span className="truncate" style={{ display: "block", maxWidth: 260 }}>{w.titulo}</span> },
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (w) => w.fecha, celda: (w) => fechaLarga(w.fecha) },
    { clave: "inv", titulo: "Inversión", tipo: "num", orden: (w) => metricasDeWebinar(e, w).inversionTotal, celda: (w) => M(metricasDeWebinar(e, w).inversionTotal) },
    { clave: "form", titulo: "Formularios", tipo: "num", orden: (w) => w.formularios, celda: (w) => num(w.formularios) },
    { clave: "ventas", titulo: "Ventas", tipo: "num", orden: (w) => metricasDeWebinar(e, w).ventas, celda: (w) => num(metricasDeWebinar(e, w).ventas) },
    {
      clave: "roas", titulo: "ROAS cobrado", tipo: "num", orden: (w) => metricasDeWebinar(e, w).roasCC,
      celda: (w) => {
        const r = metricasDeWebinar(e, w).roasCC;
        if (r === 0) return <span className="t-subtle">—</span>;
        return <span style={{ color: r >= 3 ? "var(--success)" : r >= 1.5 ? "var(--warning)" : "var(--danger)", fontWeight: 600 }}>{num(r, 2)}x</span>;
      },
    },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Webinars"
        sub="Cada webinar con los números que venís midiendo: del formulario al grupo, del grupo a la llamada, de la llamada a la venta."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIO())}>Nuevo webinar</Button>}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="ROAS cobrado" valor={totales.roasCC > 0 ? `${num(totales.roasCC, 2)}x` : "—"}
          delta={totales.roasRev > 0 ? `${num(totales.roasRev, 2)}x facturado` : undefined} direccion="accent"
          contexto={`${serie.length} webinars`} ayuda="Cash collected sobre la inversión total (pauta + DM Ads + WhatsApp API)." />
        <StatCard etiqueta="Inversión total" valor={M(totales.inv)} contexto="pauta, DM Ads y WhatsApp API" />
        <StatCard etiqueta="Formularios" valor={num(totales.formularios)}
          contexto={totales.formularios > 0 ? `${M(totales.inv / totales.formularios, 2)} cada uno` : "—"} />
        <StatCard etiqueta="Ventas" valor={num(totales.ventas)}
          contexto={totales.ventas > 0 ? `${M(totales.inv / totales.ventas)} de CPA` : "sin ventas todavía"} />
      </div>

      {serie.length > 1 && (
        <Card>
          <CardHead titulo="Evolución del ROAS" sub="Webinar a webinar, en orden. La línea llena es lo cobrado; la punteada, lo facturado." />
          <AreaChart
            datos={serie.map(({ webinar, m }) => ({
              etiqueta: fecha(webinar.fecha), valor: m.roasCC, valor2: m.roasRev, completo: webinar.titulo,
            }))}
            serie2="ROAS facturado" formato={(n) => `${num(n, 1)}x`} alto={220}
          />
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
            <Empty icono={<Video size={22} />} titulo="Todavía no cargaste ningún webinar"
              texto="Cargá uno con la inversión y los números del embudo, y te calculo el costo por formulario, el CPA, el ROAS y el profit."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIO())}>Cargar mi primer webinar</Button>} />
          }
        />
      </Card>

      {/* ---------- Alta / edición ---------- */}
      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar webinar" : "Nuevo webinar"}
          sub="Con el título y la fecha alcanza para empezar. Los números del embudo los cargás después del vivo."
          guardarTexto={form.id ? "Guardar cambios" : "Crear webinar"}
          puedeGuardar={form.titulo.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Título" span2>
              <Input value={form.titulo} onChange={(ev) => setForm({ ...form, titulo: ev.target.value })}
                placeholder="Cómo conseguir tu primer trabajo remoto en USA" autoFocus />
            </Field>
            <Field label="Fecha y hora">
              <Input type="datetime-local" value={isoMinuto(form.fecha)} onChange={(ev) => setForm({ ...form, fecha: new Date(ev.target.value).toISOString() })} />
            </Field>
            <Field label="Estado">
              <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoWebinar })}
                opciones={(Object.keys(ETIQUETA) as EstadoWebinar[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto }))} />
            </Field>

            <div className="span-2 t-label" style={{ marginTop: 8 }}>Inversión</div>
            <Field label="Pauta de captación"><Input type="number" min={0} value={form.inversion} onChange={(ev) => setForm({ ...form, inversion: Number(ev.target.value) })} /></Field>
            <Field label="DM Ads"><Input type="number" min={0} value={form.inversionDmAds} onChange={(ev) => setForm({ ...form, inversionDmAds: Number(ev.target.value) })} /></Field>
            <Field label="WhatsApp API" span2 ayuda={`Inversión total del webinar: ${M(form.inversion + form.inversionDmAds + form.costoWhatsappApi)}`}>
              <Input type="number" min={0} value={form.costoWhatsappApi} onChange={(ev) => setForm({ ...form, costoWhatsappApi: Number(ev.target.value) })} />
            </Field>

            <div className="span-2 t-label" style={{ marginTop: 8 }}>Embudo</div>
            <Field label="Formularios completados"><Input type="number" min={0} value={form.formularios} onChange={(ev) => setForm({ ...form, formularios: Number(ev.target.value), registrados: Number(ev.target.value) })} /></Field>
            <Field label="Se unieron al grupo"><Input type="number" min={0} value={form.grupoWpp} onChange={(ev) => setForm({ ...form, grupoWpp: Number(ev.target.value) })} /></Field>
            <Field label="Asistieron al taller" span2><Input type="number" min={0} value={form.asistentes} onChange={(ev) => setForm({ ...form, asistentes: Number(ev.target.value) })} /></Field>

            <div className="span-2 t-label" style={{ marginTop: 8 }}>Llamadas</div>
            <Field label="Agendadas en el vivo"><Input type="number" min={0} value={form.llamadasVivo} onChange={(ev) => setForm({ ...form, llamadasVivo: Number(ev.target.value) })} /></Field>
            <Field label="Agendadas después"><Input type="number" min={0} value={form.llamadasPosterior} onChange={(ev) => setForm({ ...form, llamadasPosterior: Number(ev.target.value) })} /></Field>
            <Field label="Canceladas"><Input type="number" min={0} value={form.llamadasCanceladas} onChange={(ev) => setForm({ ...form, llamadasCanceladas: Number(ev.target.value) })} /></Field>
            <Field label="No asistieron"><Input type="number" min={0} value={form.llamadasInasistidas} onChange={(ev) => setForm({ ...form, llamadasInasistidas: Number(ev.target.value) })} /></Field>
            <Field label="No calificadas"><Input type="number" min={0} value={form.llamadasNoCalificadas} onChange={(ev) => setForm({ ...form, llamadasNoCalificadas: Number(ev.target.value) })} /></Field>
            <Field label="Calificadas"><Input type="number" min={0} value={form.llamadasCalificadas} onChange={(ev) => setForm({ ...form, llamadasCalificadas: Number(ev.target.value) })} /></Field>

            <div className="span-2 t-label" style={{ marginTop: 8 }}>Enlaces y notas</div>
            <Field label="Link de registro" span2><Input value={form.enlaceRegistro ?? ""} onChange={(ev) => setForm({ ...form, enlaceRegistro: ev.target.value })} /></Field>
            <Field label="Link del replay" span2><Input value={form.enlaceReplay ?? ""} onChange={(ev) => setForm({ ...form, enlaceReplay: ev.target.value })} /></Field>
            <Field label="Qué pasó en este webinar" span2 ayuda="Lo que cambiaste, lo que funcionó, lo que salió mal. Esto es lo que después te explica por qué un webinar rindió distinto.">
              <Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={4}
                placeholder="No hice el recordatorio del día anterior. Poca gente se unió al grupo. Reutilicé el 100% de los ads." />
            </Field>
            <CamposExtra campos={e.campos} entidad="webinar" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
          </div>
        </ModalForm>
      )}

      {/* ---------- Detalle ---------- */}
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
            <div className="row-wrap">
              <Badge variante={ETIQUETA[wVisto.estado].variante}>{ETIQUETA[wVisto.estado].texto}</Badge>
              {mVisto.roasCC > 0 && (
                <Badge variante={mVisto.roasCC >= 3 ? "success" : mVisto.roasCC >= 1.5 ? "warning" : "danger"}>
                  ROAS {num(mVisto.roasCC, 2)}x
                </Badge>
              )}
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>El embudo, paso a paso</div>
              <Funnel
                pasos={[
                  { etiqueta: "Formularios", valor: mVisto.formularios, color: "var(--info)" },
                  { etiqueta: "Grupo de WhatsApp", valor: mVisto.grupoWpp, color: "var(--brand-fill)" },
                  { etiqueta: "Asistieron al taller", valor: mVisto.asistentes, color: "var(--accent)" },
                  { etiqueta: "Llamadas agendadas", valor: mVisto.llamadas, color: "var(--warning)" },
                  { etiqueta: "Calificadas", valor: mVisto.llamadasCalificadas, color: "var(--info)" },
                  { etiqueta: "Ventas", valor: mVisto.ventas, color: "var(--success)" },
                ]}
                formato={num}
              />
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Cuánto costó cada paso</div>
              <div className="grid-2" style={{ gap: 12 }}>
                <Mini etiqueta="Por formulario" valor={M(mVisto.cplFormulario, 2)} />
                <Mini etiqueta="Por unión al grupo" valor={M(mVisto.cplGrupo, 2)} />
                <Mini etiqueta="Por llamada" valor={M(mVisto.cpLlamada, 2)} />
                <Mini etiqueta="Por llamada calificada" valor={M(mVisto.cpLlamadaCalificada, 2)} />
                <Mini etiqueta="CPA" valor={M(mVisto.cpa)} />
                <Mini etiqueta="Inversión total" valor={M(mVisto.inversionTotal)} />
              </div>
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Conversiones</div>
              <dl className="dl">
                <Dato label="Form → grupo">{pct(mVisto.asistenciaFormulario)}</Dato>
                <Dato label="Asistencia">{pct(mVisto.asistenciaTaller)}</Dato>
                <Dato label="Grupo → agenda">{pct(mVisto.porcentajeAgenda)}</Dato>
                <Dato label="Asisten → agenda">{pct(mVisto.agendaSobreAsisten)}</Dato>
                <Dato label="Grupo → venta">{pct(mVisto.convLeadVenta, 2)}</Dato>
                <Dato label="Tasa de cierre">{pct(mVisto.tasaCierre)}</Dato>
              </dl>
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>La plata</div>
              <dl className="dl">
                <Dato label="Facturado">{M(mVisto.facturado)}</Dato>
                <Dato label="Cobrado">{M(mVisto.cobrado)}</Dato>
                <Dato label="Comisiones">{M(mVisto.comisiones)}</Dato>
                <Dato label="ROAS facturado">{mVisto.roasRev > 0 ? `${num(mVisto.roasRev, 2)}x` : "—"}</Dato>
                <Dato label="ROAS cobrado">{mVisto.roasCC > 0 ? `${num(mVisto.roasCC, 2)}x` : "—"}</Dato>
              </dl>
              <div className="grid-2" style={{ gap: 12, marginTop: 12 }}>
                <Mini etiqueta="Profit facturado" valor={M(mVisto.beneficioRev)} tono={mVisto.beneficioRev >= 0 ? "success" : "danger"} />
                <Mini etiqueta="Profit cobrado" valor={M(mVisto.beneficioCC)} tono={mVisto.beneficioCC >= 0 ? "success" : "danger"} />
              </div>
              <p className="t-sm t-subtle" style={{ marginTop: 10 }}>
                Profit = la plata menos pauta, DM Ads, WhatsApp API, comisiones y procesador.
              </p>
            </div>

            {wVisto.notas && (
              <div>
                <div className="t-label" style={{ marginBottom: 8 }}>Qué pasó en este webinar</div>
                <p className="t-body t-muted" style={{ whiteSpace: "pre-wrap" }}>{wVisto.notas}</p>
              </div>
            )}

            <div className="row-wrap">
              {wVisto.enlaceRegistro && <a href={wVisto.enlaceRegistro} target="_blank" rel="noreferrer"><Button sm variante="secondary" icono={<ExternalLink size={15} />}>Registro</Button></a>}
              {wVisto.enlaceReplay && <a href={wVisto.enlaceReplay} target="_blank" rel="noreferrer"><Button sm variante="secondary" icono={<ExternalLink size={15} />}>Replay</Button></a>}
            </div>

            <dl className="dl"><DatosExtra campos={e.campos} entidad="webinar" valores={wVisto.extra} /></dl>
          </div>
        </Drawer>
      )}

      <Ayuda titulo="Por qué hay dos ROAS" icono={<Info size={18} />}>
        El <strong>facturado</strong> asume que todas las cuotas se van a pagar; el <strong>cobrado</strong> sólo
        cuenta la plata que ya entró. Un webinar puede tener ROAS 5 facturado y 2 cobrado: vendió bien, pero
        todavía falta cobrar. Los dos importan y por eso van siempre juntos.
      </Ayuda>

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar este webinar?"
        texto={`Se borra «${borrar?.titulo}» y sus números. Las ventas que trajo quedan, pero pierden la atribución.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("webinars", borrar.id, borrar.titulo); toast("Webinar eliminado."); } }}
      />
    </div>
  );
}

function Mini({ etiqueta, valor, tono }: { etiqueta: string; valor: string; tono?: "success" | "danger" }) {
  return (
    <div style={{ background: "var(--surface-200)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
      <div className="t-label" style={{ marginBottom: 4 }}>{etiqueta}</div>
      <div className="t-num" style={{ fontSize: 19, fontWeight: 600, color: tono === "success" ? "var(--success)" : tono === "danger" ? "var(--danger)" : "var(--ink)" }}>{valor}</div>
    </div>
  );
}
