"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowRight, Check, Clock, GraduationCap, Link2, Mail, Pencil, Plus, Search, Settings2, Trash2,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Badge, Bar, Button, Card, Chip, Empty, Field, IconButton, Input, Persona, Select, StatCard, Tabs, Tag, Textarea,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { CamposExtra, DatosExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { AsistenteAlumno } from "@/components/alumnos/AsistenteAlumno";
import { PipelineServicio } from "@/components/alumnos/PipelineServicio";
import { BadgeEtapa, ESTADO_ALUMNO, ESTADOS_ALUMNO, cuandoEmpezo } from "@/components/alumnos/comun";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import {
  etapaDelAlumno, etapasDeServicio, opcionesDePlan, planDeVenta, ventasParaEnlazar,
} from "@/lib/alumnos";
import { rachasAHoy } from "@/lib/reportes";
import { fechaLarga, isoDia, money, num, pct, relativo } from "@/lib/format";
import { mrr } from "@/lib/metricas";
import type { Alumno, EstadoAlumno, Venta } from "@/lib/types";

type Vista = "lista" | "pipeline";

/* Sin mayúsculas ni tildes: "benitez" encuentra a "Benítez". */
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function Alumnos() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  /* La vista vive en la URL: el menú lateral entra directo al pipeline
     (/alumnos?vista=pipeline), y el link se puede mandar o guardar. */
  const vista: Vista = params.get("vista") === "pipeline" ? "pipeline" : "lista";
  const cambiarVista = useCallback((v: Vista) => {
    const q = new URLSearchParams(params.toString());
    if (v === "pipeline") q.set("vista", "pipeline"); else q.delete("vista");
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const [q, setQ] = useState("");
  const [estado, setEstado] = useState<"todos" | EstadoAlumno>("todos");
  const [asistente, setAsistente] = useState(false);
  const [form, setForm] = useState<Alumno | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Alumno | null>(null);

  useEffect(() => {
    if (url.nuevo) { setAsistente(true); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url]);

  const etapas = useMemo(() => etapasDeServicio(e), [e]);
  /* La misma cuenta que Reportes: una semana que se debía y no tiene reporte
     también es una semana sin reportar. */
  const rachas = useMemo(() => rachasAHoy(e), [e]);
  const sinReportar = (a: Alumno) => (a.estado === "activo" ? rachas.get(a.id) ?? 0 : 0);

  const filtrados = useMemo(() => {
    const t = normal(q.trim());
    return e.alumnos
      .filter((a) => {
        if (estado !== "todos" && a.estado !== estado) return false;
        if (!t) return true;
        return [a.nombre, a.email, a.cohorte, a.plan, a.pais].some((x) => x && normal(x).includes(t));
      })
      /* Los que entraron último, arriba: con cada venta nace un alumno, y los
         recién llegados son los que hay que atender primero. */
      .sort((x, y) => +new Date(y.inicio) - +new Date(x.inicio));
  }, [e.alumnos, q, estado]);

  const hayFiltros = q.trim() !== "" || estado !== "todos";
  const limpiarFiltros = () => { setQ(""); setEstado("todos"); };

  const activos = e.alumnos.filter((a) => a.estado === "activo");
  const enRiesgo = activos.filter((a) => sinReportar(a) >= 2).length;
  const aVisto = e.alumnos.find((a) => a.id === ver) ?? null;

  function guardar() {
    if (!form) return;
    const nombre = form.nombre.trim();
    if (!nombre) { toast("Poné al menos el nombre.", "err"); return; }
    const { id, ...cambios } = form;
    acciones.actualizar<Alumno>("alumnos", id, { ...cambios, nombre }, nombre);
    toast("Alumno actualizado.");
    setForm(null);
  }

  function moverDesdeFicha(a: Alumno, etapaId: string) {
    const et = etapas.find((x) => x.id === etapaId);
    if (!et || etapaDelAlumno(etapas, a)?.id === etapaId) return;
    acciones.moverAlumno(a.id, etapaId);
    toast(`${a.nombre} → ${et.nombre}`);
  }

  const columnas: Columna<Alumno>[] = [
    {
      clave: "nombre", titulo: "Alumno", tipo: "primary", orden: (a) => a.nombre,
      celda: (a) => <Persona nombre={a.nombre} sub={a.email || "Sin mail"} />,
    },
    {
      /* La etapa del servicio, y el estado sólo cuando no es el de siempre:
         así entra todo en seis columnas. */
      clave: "etapa", titulo: "Etapa",
      orden: (a) => (etapaDelAlumno(etapas, a)?.orden ?? 99) * 10 + ESTADOS_ALUMNO.indexOf(a.estado),
      celda: (a) => (
        <span className="row" style={{ gap: 6 }}>
          <BadgeEtapa etapa={etapaDelAlumno(etapas, a)} />
          {a.estado !== "activo" && <Tag>{ESTADO_ALUMNO[a.estado].texto}</Tag>}
        </span>
      ),
    },
    {
      clave: "plan", titulo: "Plan", tipo: "secondary", orden: (a) => a.plan,
      celda: (a) => <span>{a.plan || "Sin plan"}{a.cohorte && <span className="t-subtle"> · {a.cohorte}</span>}</span>,
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
      clave: "reporte", titulo: "Reportes", orden: (a) => sinReportar(a),
      celda: (a) => {
        if (a.estado !== "activo") return <span className="t-sm t-subtle">—</span>;
        const s = sinReportar(a);
        return s === 0
          ? <Badge variante="success" icono={<Check size={13} />}>Al día</Badge>
          : <Badge variante={s >= 3 ? "danger" : "warning"} icono={<Clock size={13} />}>{s} sem.</Badge>;
      },
    },
    {
      clave: "cuota", titulo: "Cuota", tipo: "num", orden: (a) => a.cuotaMensual,
      celda: (a) => (a.cuotaMensual > 0 ? money(a.cuotaMensual, a.moneda) : <span className="t-subtle">—</span>),
    },
  ];

  const filtrosBarra = (
    <>
      <Input
        icono={<Search size={18} />} value={q} onChange={(ev) => setQ(ev.target.value)}
        placeholder="Buscá por nombre, cohorte o plan…" aria-label="Buscar alumnos"
      />
      <Chip activo={estado === "todos"} onClick={() => setEstado("todos")} count={e.alumnos.length}>Todos</Chip>
      {ESTADOS_ALUMNO.map((k) => (
        <Chip key={k} activo={estado === k} onClick={() => setEstado(k)} count={e.alumnos.filter((a) => a.estado === k).length}>
          {ESTADO_ALUMNO[k].texto}
        </Chip>
      ))}
    </>
  );

  const vacio = (
    <Empty
      icono={<GraduationCap size={22} />}
      titulo={hayFiltros ? "Ningún alumno coincide" : "Todavía no hay alumnos"}
      texto={hayFiltros
        ? "Probá con otro texto o sacá los filtros."
        : "Cada venta que registres crea su alumno sola, en la primera etapa del servicio. También podés cargar uno a mano."}
      accion={hayFiltros
        ? <Button variante="secondary" onClick={limpiarFiltros}>Limpiar filtros</Button>
        : <Button variante="brand" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Cargar un alumno</Button>}
    />
  );

  return (
    <div className="stack-5">
      <PageHead
        titulo="Alumnos"
        sub="Quién está cursando, en qué etapa del servicio está y si manda su reporte semanal."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Nuevo alumno</Button>}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Alumnos activos" valor={num(activos.length)} contexto={`de ${num(e.alumnos.length)} en total`} />
        <StatCard etiqueta="MRR" valor={money(mrr(e), e.ajustes.monedaBase)} contexto="por cuotas de los activos" />
        <StatCard etiqueta="Progreso promedio" valor={pct(activos.length ? activos.reduce((s, a) => s + a.progreso, 0) / activos.length : 0, 0)} contexto="del programa" />
        <StatCard
          etiqueta="Sin reportar" valor={num(enRiesgo)}
          delta={enRiesgo > 0 ? "Seguir" : undefined} direccion="accent"
          contexto="2 semanas o más"
        />
      </div>

      <Tabs
        valor={vista} onChange={cambiarVista}
        opciones={[
          { valor: "lista", texto: `Lista · ${num(filtrados.length)}` },
          { valor: "pipeline", texto: "Pipeline" },
        ]}
      />

      {vista === "lista" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
            <div className="toolbar">{filtrosBarra}</div>
          </div>
          <DataTable
            filas={filtrados} columnas={columnas} alto={620} porPagina={50}
            onFila={(a) => setVer(a.id)} etiquetaFila={(a) => `Ver ${a.nombre}`}
            acciones={(a) => (
              <>
                <IconButton etiqueta="Editar" onClick={() => setForm({ ...a })}><Pencil size={15} /></IconButton>
                <IconButton etiqueta="Eliminar" onClick={() => setBorrar(a)}><Trash2 size={15} /></IconButton>
              </>
            )}
            vacio={vacio}
          />
        </Card>
      )}

      {vista === "pipeline" && (
        <div className="stack-4">
          <div className="toolbar" style={{ marginBottom: 0 }}>
            {filtrosBarra}
            <span className="spacer" />
            <Link href="/ajustes?seccion=pipeline&pipeline=servicio" className="hk-btn hk-btn--ghost hk-btn--sm">
              <Settings2 size={15} />Editar etapas
            </Link>
          </div>
          {filtrados.length === 0
            ? <Card>{vacio}</Card>
            : <PipelineServicio alumnos={filtrados} onAbrir={setVer} />}
        </div>
      )}

      {asistente && (
        <AsistenteAlumno
          onCerrar={() => setAsistente(false)}
          onListo={(id, nombre) => { setAsistente(false); setVer(id); toast(`${nombre} ya está en el programa.`); }}
          onAbrirAlumno={(id) => { setAsistente(false); setVer(id); }}
        />
      )}

      {form && <EditarAlumno form={form} setForm={setForm} onGuardar={guardar} />}

      {aVisto && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={aVisto.nombre}
          cabecera={
            <div className="stack-2">
              <Persona nombre={aVisto.nombre} sub={aVisto.email || "Sin mail"} size={40} />
              <div className="row-wrap">
                <Badge variante={ESTADO_ALUMNO[aVisto.estado].variante}>{ESTADO_ALUMNO[aVisto.estado].texto}</Badge>
                {aVisto.plan && <Badge variante="neutral">{aVisto.plan}</Badge>}
                {aVisto.cohorte && <Badge variante="info">{aVisto.cohorte}</Badge>}
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
              <div className="t-label" style={{ marginBottom: 10 }}>Etapa del servicio</div>
              <div style={{ maxWidth: 280 }}>
                <Select
                  value={etapaDelAlumno(etapas, aVisto)?.id ?? ""} aria-label="Etapa del servicio"
                  onChange={(ev) => moverDesdeFicha(aVisto, ev.target.value)}
                  opciones={etapas.map((et) => ({ valor: et.id, texto: et.nombre }))}
                />
              </div>
            </div>

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
              <Dato label="Cuota">{aVisto.cuotaMensual > 0 ? `${money(aVisto.cuotaMensual, aVisto.moneda)} por mes` : "Sin cuota mensual"}</Dato>
              <Dato label="País">{aVisto.pais || "—"}</Dato>
              <Dato label="Empezó">{fechaLarga(aVisto.inicio)}</Dato>
              <Dato label="Antigüedad">{cuandoEmpezo(relativo(aVisto.inicio))}</Dato>
              {aVisto.leadId && <Dato label="Vino de">{e.leads.find((l) => l.id === aVisto.leadId)?.fuente || "—"}</Dato>}
              <DatosExtra campos={e.campos} entidad="alumno" valores={aVisto.extra} />
            </dl>

            <VentaDelAlumno alumno={aVisto} />

            <div>
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="t-label">Reportes</span>
                <Link href="/reportes?vista=tabla" className="link t-sm spacer">Ver todos</Link>
              </div>
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
                          <span className="t-sm t-subtle t-num">{r.horasEstudio} h · {r.postulaciones ?? 0} post.</span>
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
              {(() => {
                /* Las de su venta enlazada y las de su lead: un alumno que vino
                   de una venta sin lead sólo se encuentra por la venta. */
                const ventas = e.ventas.filter((v) => v.id === aVisto.ventaId || (aVisto.leadId && v.contactoId === aVisto.leadId));
                const ids = new Set(e.cuotas.filter((c) => ventas.some((v) => v.id === c.ventaId)).map((c) => c.id));
                const pagos = e.pagos.filter((p) => ids.has(p.cuotaId))
                  .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
                if (pagos.length === 0) return <p className="t-sm t-subtle">Sin pagos registrados.</p>;
                return (
                  <div className="stack-2">
                    {pagos.slice(0, 6).map((p) => (
                      <div key={p.id} className="agenda-item" style={{ cursor: "default" }}>
                        <span className="t-sm" style={{ flex: 1 }}>{fechaLarga(p.fecha)}</span>
                        <span className="t-sm t-subtle">{e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "—"}</span>
                        <span className="t-sm t-num t-strong">{money(p.monto, p.moneda)}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
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
        texto="Se borra el alumno y sus reportes dejan de contar. La venta y los pagos quedan en Ventas y Finanzas."
        onConfirmar={() => { if (borrar) { acciones.eliminar("alumnos", borrar.id, borrar.nombre); toast(`Se eliminó a ${borrar.nombre}.`); } }}
      />
    </div>
  );
}

/* ---------- La venta de la ficha ----------
   Enlazada: se ve y lleva a su detalle en Ventas. Sin enlazar: se puede elegir
   ahí mismo entre las ventas que no tienen alumno, empezando por las que
   parecen suyas. */

function VentaDelAlumno({ alumno }: { alumno: Alumno }) {
  const e = useEstado();
  const toast = useToast();
  const venta = alumno.ventaId ? e.ventas.find((v) => v.id === alumno.ventaId) : undefined;
  const candidatas = useMemo(
    () => (venta ? [] : ventasParaEnlazar(e, alumno).slice(0, 60)),
    [e, alumno, venta],
  );

  if (venta) {
    return (
      <div>
        <div className="t-label" style={{ marginBottom: 12 }}>Venta</div>
        <Link href={`/ventas?ver=${venta.id}`} className="agenda-item alu-venta">
          <Link2 size={16} className="alu-venta__ico" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="alu-venta__titulo truncate">{planDeVenta(e, venta) || "Venta sin producto"}</span>
            <span className="t-sm t-subtle t-num">{fechaLarga(venta.fecha)} · {money(venta.precioAcordado, venta.moneda)}</span>
          </span>
          {venta.estado !== "activa" && (
            <Badge variante={venta.estado === "reembolsada" ? "danger" : "neutral"}>
              {venta.estado === "reembolsada" ? "Reembolsada" : "Cancelada"}
            </Badge>
          )}
          <ArrowRight size={16} className="alu-venta__ico" />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>Venta</div>
      <p className="t-sm t-subtle" style={{ marginBottom: candidatas.length ? 10 : 0 }}>
        {alumno.ventaId ? "La venta que tenía enlazada ya no existe." : "No tiene una venta enlazada."}{" "}
        {candidatas.length ? "Si ya está cargada, elegila:" : "No hay ventas sin alumno para enlazarle."}
      </p>
      {candidatas.length > 0 && (
        <Select
          value="" placeholder="Enlazar una venta…" aria-label="Enlazar una venta"
          onChange={(ev) => {
            const v = candidatas.find((x) => x.id === ev.target.value);
            if (!v) return;
            acciones.actualizar<Alumno>("alumnos", alumno.id, { ventaId: v.id }, alumno.nombre, `Se enlazó a ${alumno.nombre} la venta de ${v.contactoNombre}.`);
            toast("Venta enlazada.");
          }}
          opciones={candidatas.map((v) => ({ valor: v.id, texto: textoVenta(e.productos, v) }))}
        />
      )}
    </div>
  );
}

function textoVenta(productos: { id: string; nombre: string }[], v: Venta): string {
  const producto = productos.find((p) => p.id === v.productoId)?.nombre ?? "Sin producto";
  return `${v.contactoNombre} · ${producto} · ${fechaLarga(v.fecha)}`;
}

/* ---------- Editar ----------
   El alta es el asistente; editar sigue en un modal, con todo a la vista. */

function EditarAlumno({ form, setForm, onGuardar }: {
  form: Alumno; setForm: (a: Alumno | null) => void; onGuardar: () => void;
}) {
  const e = useEstado();
  const etapas = etapasDeServicio(e);
  const ventas = useMemo(() => {
    const libres = ventasParaEnlazar(e, form).slice(0, 80);
    /* La que ya tiene tiene que estar en la lista aunque la regla de
       duplicados se la atribuya a otro: si no, el desplegable mostraría
       "Sin venta" y guardar la desenlazaría sin querer. */
    const actual = form.ventaId ? e.ventas.find((v) => v.id === form.ventaId) : undefined;
    return actual && !libres.some((v) => v.id === actual.id) ? [actual, ...libres] : libres;
  }, [e, form]);

  return (
    <ModalForm
      abierto onCerrar={() => setForm(null)} onGuardar={onGuardar} ancho
      titulo="Editar alumno" sub="El progreso lo vas actualizando a mano a medida que avanza."
      guardarTexto="Guardar cambios" puedeGuardar={form.nombre.trim().length > 0}
    >
      <div className="form-grid">
        <Field label="Nombre y apellido"><Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Martín Quiroga" autoFocus /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(ev) => setForm({ ...form, email: ev.target.value })} /></Field>
        <Field label="País"><Input value={form.pais ?? ""} onChange={(ev) => setForm({ ...form, pais: ev.target.value })} /></Field>
        <Field label="Cohorte" ayuda="El grupo con el que entró."><Input value={form.cohorte} onChange={(ev) => setForm({ ...form, cohorte: ev.target.value })} placeholder="C9" /></Field>
        <Field label="Plan"><Select value={form.plan} onChange={(ev) => setForm({ ...form, plan: ev.target.value })} opciones={opcionesDePlan(e, form.plan)} /></Field>
        <Field label="Estado">
          <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoAlumno })}
            opciones={ESTADOS_ALUMNO.map((k) => ({ valor: k, texto: ESTADO_ALUMNO[k].texto }))} />
        </Field>
        <Field label="Etapa del servicio" ayuda="La columna del pipeline de alumnos.">
          <Select value={etapaDelAlumno(etapas, form)?.id ?? ""} onChange={(ev) => setForm({ ...form, etapaServicioId: ev.target.value })}
            opciones={etapas.map((et) => ({ valor: et.id, texto: et.nombre }))} />
        </Field>
        <Field label="Venta" ayuda="La venta que lo trajo.">
          <Select value={form.ventaId ?? ""} placeholder="Sin venta enlazada"
            onChange={(ev) => setForm({ ...form, ventaId: ev.target.value || undefined })}
            opciones={ventas.map((v) => ({ valor: v.id, texto: textoVenta(e.productos, v) }))} />
        </Field>
        <Field label="Cuota mensual" ayuda="0 si pagó todo junto."><Input type="number" min={0} value={form.cuotaMensual} onChange={(ev) => setForm({ ...form, cuotaMensual: Number(ev.target.value) })} /></Field>
        <Field label="Fecha de inicio">
          <Input type="date" value={isoDia(form.inicio)}
            /* Mediodía: la medianoche UTC en Argentina es el día anterior. */
            onChange={(ev) => { if (ev.target.value) setForm({ ...form, inicio: new Date(`${ev.target.value}T12:00:00`).toISOString() }); }} />
        </Field>
        <Field label="Progreso" span2 ayuda={`${form.progreso}% del programa completado.`}>
          <Input type="range" min={0} max={100} step={5} value={form.progreso} onChange={(ev) => setForm({ ...form, progreso: Number(ev.target.value) })} />
        </Field>
        <Field label="Notas" span2><Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={3} /></Field>
        <CamposExtra campos={e.campos} entidad="alumno" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
      </div>
    </ModalForm>
  );
}
