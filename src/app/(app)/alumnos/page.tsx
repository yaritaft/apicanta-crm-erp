"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Check, Clock, GraduationCap, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Bar, Button, Card, Chip, Empty, Field, IconButton, Input, Persona, Select, StatCard, Textarea } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { fechaLarga, isoDia, money, num, pct, relativo } from "@/lib/format";
import { mrr, semanasSinReportar } from "@/lib/metricas";
import type { Alumno, EstadoAlumno, Moneda } from "@/lib/types";

const ETIQUETA: Record<EstadoAlumno, { texto: string; variante: "success" | "warning" | "brand" | "neutral" }> = {
  "activo": { texto: "Activo", variante: "success" },
  "pausado": { texto: "Pausado", variante: "warning" },
  "graduado": { texto: "Graduado", variante: "brand" },
  "baja": { texto: "Baja", variante: "neutral" },
};

const VACIO = (plan: string): Omit<Alumno, "id"> => ({
  nombre: "", email: "", pais: "", cohorte: "C9", plan, cuotaMensual: 400,
  moneda: "USD" as Moneda, estado: "activo", inicio: new Date().toISOString(),
  progreso: 0, notas: "", creadoEn: new Date().toISOString(), extra: {},
});

export default function Alumnos() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"todos" | EstadoAlumno>("todos");
  const [form, setForm] = useState<(Omit<Alumno, "id"> & { id?: string }) | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Alumno | null>(null);

  useEffect(() => {
    if (url.nuevo) { setForm(VACIO(e.ajustes.planes[0] ?? "")); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url, e.ajustes.planes]);

  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return e.alumnos.filter((a) => {
      if (estado !== "todos" && a.estado !== estado) return false;
      if (!t) return true;
      return [a.nombre, a.email, a.cohorte, a.plan, a.pais].some((x) => x?.toLowerCase().includes(t));
    });
  }, [e.alumnos, q, estado]);

  const activos = e.alumnos.filter((a) => a.estado === "activo");
  const aVisto = e.alumnos.find((a) => a.id === ver) ?? null;

  function guardar() {
    if (!form) return;
    if (!form.nombre.trim()) { toast("Poné al menos el nombre.", "err"); return; }
    if (form.id) { acciones.actualizar<Alumno>("alumnos", form.id, form, form.nombre); toast("Alumno actualizado."); }
    else { acciones.crear<Alumno>("alumnos", form, form.nombre); toast(`${form.nombre} ya está en el programa.`); }
    setForm(null);
  }

  const columnas: Columna<Alumno>[] = [
    { clave: "nombre", titulo: "Alumno", tipo: "primary", orden: (a) => a.nombre, celda: (a) => <Persona nombre={a.nombre} sub={a.email} /> },
    { clave: "estado", titulo: "Estado", orden: (a) => a.estado, celda: (a) => <Badge variante={ETIQUETA[a.estado].variante}>{ETIQUETA[a.estado].texto}</Badge> },
    {
      clave: "plan", titulo: "Plan", tipo: "secondary", orden: (a) => a.plan,
      celda: (a) => <span>{a.plan} <span className="t-subtle">· {a.cohorte}</span></span>,
    },
    {
      clave: "progreso", titulo: "Progreso", orden: (a) => a.progreso,
      celda: (a) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 120 }}>
          <span style={{ flex: 1 }}><Bar valor={a.progreso} tono={a.progreso >= 80 ? "success" : "brand"} /></span>
          <span className="t-sm t-num t-subtle">{a.progreso}%</span>
        </span>
      ),
    },
    {
      clave: "reporte", titulo: "Reportes", orden: (a) => semanasSinReportar(e, a.id),
      celda: (a) => {
        const s = semanasSinReportar(e, a.id);
        if (a.estado !== "activo") return <span className="t-sm t-subtle">—</span>;
        return s === 0
          ? <Badge variante="success" icono={<Check size={13} />}>Al día</Badge>
          : <Badge variante={s >= 3 ? "danger" : "warning"} icono={<Clock size={13} />}>{s} sem.</Badge>;
      },
    },
    { clave: "cuota", titulo: "Cuota", tipo: "num", orden: (a) => a.cuotaMensual, celda: (a) => money(a.cuotaMensual, a.moneda) },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Alumnos"
        sub="Quién está cursando, cómo viene y si está mandando su reporte semanal."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIO(e.ajustes.planes[0] ?? ""))}>Nuevo alumno</Button>}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Alumnos activos" valor={num(activos.length)} contexto={`de ${e.alumnos.length} en total`} />
        <StatCard etiqueta="MRR" valor={money(mrr(e), e.ajustes.monedaBase)} contexto="por cuotas de los activos" />
        <StatCard etiqueta="Progreso promedio" valor={pct(activos.length ? activos.reduce((s, a) => s + a.progreso, 0) / activos.length : 0, 0)} contexto="del programa" />
        <StatCard
          etiqueta="Sin reportar" valor={num(activos.filter((a) => semanasSinReportar(e, a.id) >= 2).length)}
          delta={activos.filter((a) => semanasSinReportar(e, a.id) >= 2).length > 0 ? "Seguir" : undefined} direccion="accent"
          contexto="2 semanas o más"
        />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <div className="toolbar">
            <Input icono={<GraduationCap size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscá por nombre, cohorte o plan…" aria-label="Buscar alumnos" />
            <Chip activo={estado === "todos"} onClick={() => setEstado("todos")} count={e.alumnos.length}>Todos</Chip>
            {(Object.keys(ETIQUETA) as EstadoAlumno[]).map((k) => (
              <Chip key={k} activo={estado === k} onClick={() => setEstado(k)} count={e.alumnos.filter((a) => a.estado === k).length}>
                {ETIQUETA[k].texto}
              </Chip>
            ))}
          </div>
        </div>

        <DataTable
          filas={filtrados} columnas={columnas} ordenInicial={{ clave: "nombre", desc: false }}
          onFila={(a) => setVer(a.id)} etiquetaFila={(a) => `Ver ${a.nombre}`}
          acciones={(a) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm({ ...a })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(a)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty
              icono={<GraduationCap size={22} />}
              titulo={q || estado !== "todos" ? "Ningún alumno coincide" : "Todavía no hay alumnos"}
              texto={q || estado !== "todos" ? "Probá con otro texto o sacá los filtros." : "Cuando un lead compre, convertilo en alumno desde su ficha. O cargalo directo acá."}
              accion={
                q || estado !== "todos"
                  ? <Button variante="secondary" onClick={() => { setQ(""); setEstado("todos"); }}>Limpiar filtros</Button>
                  : <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIO(e.ajustes.planes[0] ?? ""))}>Cargar un alumno</Button>
              }
            />
          }
        />
      </Card>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar alumno" : "Nuevo alumno"}
          sub="El progreso lo vas actualizando a mano a medida que avanza."
          guardarTexto={form.id ? "Guardar cambios" : "Crear alumno"}
          puedeGuardar={form.nombre.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Nombre y apellido"><Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Martín Quiroga" autoFocus /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(ev) => setForm({ ...form, email: ev.target.value })} /></Field>
            <Field label="País"><Input value={form.pais ?? ""} onChange={(ev) => setForm({ ...form, pais: ev.target.value })} /></Field>
            <Field label="Cohorte" ayuda="El grupo con el que entró."><Input value={form.cohorte} onChange={(ev) => setForm({ ...form, cohorte: ev.target.value })} placeholder="C9" /></Field>
            <Field label="Plan"><Select value={form.plan} onChange={(ev) => setForm({ ...form, plan: ev.target.value })} opciones={e.ajustes.planes} /></Field>
            <Field label="Estado">
              <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoAlumno })}
                opciones={(Object.keys(ETIQUETA) as EstadoAlumno[]).map((k) => ({ valor: k, texto: ETIQUETA[k].texto }))} />
            </Field>
            <Field label="Cuota mensual"><Input type="number" min={0} value={form.cuotaMensual} onChange={(ev) => setForm({ ...form, cuotaMensual: Number(ev.target.value) })} /></Field>
            <Field label="Fecha de inicio"><Input type="date" value={isoDia(form.inicio)} onChange={(ev) => setForm({ ...form, inicio: new Date(ev.target.value).toISOString() })} /></Field>
            <Field label="Progreso" span2 ayuda={`${form.progreso}% del programa completado.`}>
              <Input type="range" min={0} max={100} step={5} value={form.progreso} onChange={(ev) => setForm({ ...form, progreso: Number(ev.target.value) })} />
            </Field>
            <Field label="Notas" span2><Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={3} /></Field>
            <CamposExtra campos={e.campos} entidad="alumno" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
          </div>
        </ModalForm>
      )}

      {aVisto && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={aVisto.nombre}
          cabecera={
            <div className="stack-2">
              <Persona nombre={aVisto.nombre} sub={aVisto.email} size={40} />
              <div className="row-wrap">
                <Badge variante={ETIQUETA[aVisto.estado].variante}>{ETIQUETA[aVisto.estado].texto}</Badge>
                <Badge variante="neutral">{aVisto.plan}</Badge>
                <Badge variante="info">{aVisto.cohorte}</Badge>
              </div>
            </div>
          }
          pie={
            <>
              <Button variante="secondary" icono={<Pencil size={16} />} onClick={() => { setForm({ ...aVisto }); setVer(null); }}>Editar</Button>
              {aVisto.email && <a href={`mailto:${aVisto.email}`}><Button variante="secondary" icono={<Mail size={16} />}>Escribirle</Button></a>}
            </>
          }
        >
          <div className="stack-5">
            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="t-label">Progreso del programa</span>
                <span className="spacer t-sm t-num t-strong">{aVisto.progreso}%</span>
              </div>
              <Bar valor={aVisto.progreso} tono={aVisto.progreso >= 80 ? "success" : "brand"} />
              <div className="row-wrap" style={{ marginTop: 10 }}>
                {[0, 25, 50, 75, 100].map((v) => (
                  <Chip key={v} activo={aVisto.progreso === v} onClick={() => { acciones.actualizar<Alumno>("alumnos", aVisto.id, { progreso: v }, aVisto.nombre, `${aVisto.nombre}: progreso al ${v}%.`); toast(`Progreso al ${v}%.`); }}>
                    {v}%
                  </Chip>
                ))}
              </div>
            </div>

            <dl className="dl">
              <Dato label="Cuota">{money(aVisto.cuotaMensual, aVisto.moneda)} por mes</Dato>
              <Dato label="País">{aVisto.pais || "—"}</Dato>
              <Dato label="Empezó">{fechaLarga(aVisto.inicio)}</Dato>
              <Dato label="Antigüedad">{relativo(aVisto.inicio).replace("hace ", "")}</Dato>
              {aVisto.leadId && <Dato label="Vino de">{e.leads.find((l) => l.id === aVisto.leadId)?.fuente ?? "—"}</Dato>}
              <DatosExtra campos={e.campos} entidad="alumno" valores={aVisto.extra} />
            </dl>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Reportes semanales</div>
              {e.reportes.filter((r) => r.alumnoId === aVisto.id).length === 0 ? (
                <p className="t-sm t-subtle">Todavía no mandó ningún reporte.</p>
              ) : (
                <div className="stack-2">
                  {e.reportes.filter((r) => r.alumnoId === aVisto.id)
                    .sort((a, b) => +new Date(b.semanaDel) - +new Date(a.semanaDel)).slice(0, 6)
                    .map((r) => (
                      <div key={r.id} className="agenda-item" style={{ cursor: "default" }}>
                        <span className="t-sm" style={{ flex: 1 }}>Semana del {fechaLarga(r.semanaDel)}</span>
                        {r.estado === "completado" && r.horasEstudio !== undefined && (
                          <span className="t-sm t-subtle t-num">{r.horasEstudio} h · {r.postulaciones} post.</span>
                        )}
                        <Badge variante={r.estado === "completado" ? "success" : r.estado === "pendiente" ? "accent" : r.estado === "vencido" ? "danger" : "neutral"}>
                          {r.estado === "completado" ? "Completado" : r.estado === "pendiente" ? "Pendiente" : r.estado === "vencido" ? "Vencido" : "No enviado"}
                        </Badge>
                      </div>
                    ))}
                </div>
              )}
            </div>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Pagos</div>
              {e.transacciones.filter((t) => t.alumnoId === aVisto.id).length === 0 ? (
                <p className="t-sm t-subtle">Sin pagos registrados.</p>
              ) : (
                <div className="stack-2">
                  {e.transacciones.filter((t) => t.alumnoId === aVisto.id)
                    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)).slice(0, 6)
                    .map((t) => (
                      <div key={t.id} className="agenda-item" style={{ cursor: "default" }}>
                        <span className="t-sm" style={{ flex: 1 }}>{fechaLarga(t.fecha)}</span>
                        <span className="t-sm t-num t-strong">{money(t.monto, t.moneda)}</span>
                        <Badge variante={t.estado === "pagado" ? "success" : "warning"}>{t.estado === "pagado" ? "Pagado" : "Pendiente"}</Badge>
                      </div>
                    ))}
                </div>
              )}
            </div>

            {aVisto.notas && (
              <div>
                <div className="t-label" style={{ marginBottom: 8 }}>Notas</div>
                <p className="t-body t-muted" style={{ whiteSpace: "pre-wrap" }}>{aVisto.notas}</p>
              </div>
            )}
          </div>
        </Drawer>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar a ${borrar?.nombre}?`}
        texto="Se borra el alumno y sus reportes dejan de contar. Los pagos quedan en Finanzas."
        onConfirmar={() => { if (borrar) { acciones.eliminar("alumnos", borrar.id, borrar.nombre); toast(`Se eliminó a ${borrar.nombre}.`); } }}
      />
    </div>
  );
}
