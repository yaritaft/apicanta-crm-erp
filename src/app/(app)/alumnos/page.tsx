"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check, Clock, GraduationCap, Pencil, Plus, Search, Settings2, Trash2,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Badge, Bar, Button, Card, Chip, Empty, IconButton, Input, Persona, Tabs, Tag,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { AsistenteAlumno } from "@/components/alumnos/AsistenteAlumno";
import { EditarAlumno } from "@/components/alumnos/Servicio";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { PipelineServicio } from "@/components/alumnos/PipelineServicio";
import { ContactarHoy } from "@/components/alumnos/Seguimiento";
import { ClientesCs } from "@/components/cs/ClientesCs";
import { ResellsCs } from "@/components/cs/ResellsCs";
import { TestimoniosCs } from "@/components/cs/TestimoniosCs";
import { BadgeEtapa, ESTADO_ALUMNO, ESTADOS_ALUMNO } from "@/components/alumnos/comun";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { CopiarLink } from "@/components/ui/Filtros";
import { ordenAURL, ordenDeURL, paginaDeURL, useBusquedaURL, useParamsURL } from "@/lib/useParamsURL";
import { etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import { rachasAHoy } from "@/lib/reportes";
import { money, num } from "@/lib/format";
import type { Alumno, EstadoAlumno } from "@/lib/types";

type Vista = "lista" | "pipeline" | "clientes" | "hoy" | "testimonios" | "resells";
const VISTAS: Vista[] = ["lista", "pipeline", "clientes", "hoy", "testimonios", "resells"];

/* Lo que se está mirando vive en la URL (lib/useParamsURL): el menú lateral
   entra directo al pipeline (/alumnos?seccion=pipeline), y el link se puede
   guardar o mandar y se ve tal cual.
   - seccion: lista (por defecto), pipeline o, para Customer Success, clientes
     (la lista con las columnas de Lili), hoy (a quién contactar), testimonios y
     resells (la agenda). No va en ?vista, que es de la ficha de una persona:
     abrir una desde el pipeline pasaba el fondo a la lista. Un link viejo con
     ?vista=pipeline o ?seccion=seguimiento se sigue entendiendo.
   - estado: activo, pausado, egresado o baja
   - q: nombre, correo, cohorte, plan o país
   - orden: la columna, con "-" adelante si va de mayor a menor. Sin orden,
     los que entraron último van arriba.
   - pag: la página, desde 1 */
const VISTA_ALUMNOS = { seccion: "lista", vista: "", estado: "todos", orden: "", pag: "1" };
const COLUMNAS_QUE_ORDENAN = ["nombre", "etapa", "plan", "progreso", "reporte", "cuota"];
const SIN_ORDEN = { clave: "", desc: false };

/* Sin mayúsculas ni tildes: "benitez" encuentra a "Benítez". */
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function Alumnos() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const abrirFicha = useAbrirFicha();

  const [enURL, setEnURL] = useParamsURL(VISTA_ALUMNOS);
  /* La ficha nunca escribe "pipeline" en ?vista: si está, es un link viejo. */
  const seccion = enURL.seccion === "seguimiento" ? "clientes" : enURL.seccion;
  const vista: Vista = enURL.vista === "pipeline" ? "pipeline" : VISTAS.includes(seccion as Vista) ? (seccion as Vista) : "lista";
  const cambiarVista = (v: Vista) => setEnURL({ seccion: v }, enURL.vista === "pipeline" ? { vista: null } : {});
  useEffect(() => {
    if (enURL.vista === "pipeline") setEnURL({ seccion: "pipeline", vista: null });
  }, [enURL.vista, setEnURL]);
  const [q, setQ] = useBusquedaURL("q", ["pag"]);
  const estado: "todos" | EstadoAlumno = ESTADOS_ALUMNO.includes(enURL.estado as EstadoAlumno) ? (enURL.estado as EstadoAlumno) : "todos";
  const setEstado = (v: "todos" | EstadoAlumno) => setEnURL({ estado: v, pag: null });
  const orden = ordenDeURL(enURL.orden, COLUMNAS_QUE_ORDENAN, SIN_ORDEN);
  const [asistente, setAsistente] = useState(false);
  const [form, setForm] = useState<Alumno | null>(null);
  const [borrar, setBorrar] = useState<Alumno | null>(null);

  useEffect(() => {
    if (url.nuevo) { setAsistente(true); url.limpiar(); }
    /* ?ver=<alumno> abre la ficha de la persona en la pestaña Servicio. */
    else if (url.ver) abrirFicha(url.ver, "servicio");
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
  const limpiarFiltros = () => { setQ(""); setEnURL({ estado: null, pag: null }, { q: null }); };

  function guardar() {
    if (!form) return;
    const nombre = form.nombre.trim();
    if (!nombre) { toast("Poné al menos el nombre.", "err"); return; }
    const { id, ...cambios } = form;
    const antes = e.alumnos.find((a) => a.id === id);
    acciones.actualizar<Alumno>("alumnos", id, { ...cambios, nombre }, nombre);
    /* El nombre y el mail son de la persona: se corrigen en todos lados. */
    acciones.corregirPersona(antes?.leadId ?? id, {
      nombre: nombre !== antes?.nombre ? nombre : undefined,
      email: cambios.email !== antes?.email ? cambios.email : undefined,
    });
    toast("Alumno actualizado.");
    setForm(null);
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
        acciones={
          <>
            <CopiarLink sm={false} />
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setAsistente(true)}>Nuevo alumno</Button>
          </>
        }
      />

      <Tabs
        valor={vista} onChange={cambiarVista}
        opciones={[
          { valor: "lista", texto: `Lista · ${num(filtrados.length)}` },
          { valor: "pipeline", texto: "Pipeline" },
          /* Customer Success (F2-09): el seguimiento de los alumnos, como lo lleva Lili. */
          { valor: "hoy", texto: "A contactar hoy" },
          { valor: "clientes", texto: "Clientes" },
          { valor: "testimonios", texto: "Testimonios" },
          { valor: "resells", texto: "Resells" },
        ]}
      />

      {vista === "lista" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
            <div className="toolbar">{filtrosBarra}</div>
          </div>
          <DataTable
            filas={filtrados} columnas={columnas} alto={620} porPagina={50}
            orden={orden.clave ? orden : null} onOrden={(o) => setEnURL({ orden: ordenAURL(o), pag: null })}
            pagina={paginaDeURL(enURL.pag) - 1} onPagina={(p) => setEnURL({ pag: String(p + 1) })}
            onFila={(a) => abrirFicha(a.id, "servicio")} etiquetaFila={(a) => `Ver la ficha de ${a.nombre}`}
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

      {vista === "hoy" && <ContactarHoy />}
      {vista === "clientes" && <ClientesCs onNuevo={() => setAsistente(true)} />}
      {vista === "testimonios" && <TestimoniosCs />}
      {vista === "resells" && <ResellsCs />}

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
            : <PipelineServicio alumnos={filtrados} onAbrir={(id) => abrirFicha(id, "servicio")} />}
        </div>
      )}

      {asistente && (
        <AsistenteAlumno
          onCerrar={() => setAsistente(false)}
          onListo={(id, nombre) => { setAsistente(false); abrirFicha(id, "servicio"); toast(`${nombre} ya está en el programa.`); }}
          onAbrirAlumno={(id) => { setAsistente(false); abrirFicha(id, "servicio"); }}
        />
      )}

      {form && <EditarAlumno form={form} setForm={setForm} onGuardar={guardar} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar a ${borrar?.nombre}?`}
        texto="Se borra el alumno y sus reportes dejan de contar. La venta y los pagos quedan en Ventas y Finanzas."
        onConfirmar={() => { if (borrar) { acciones.eliminar("alumnos", borrar.id, borrar.nombre); toast(`Se eliminó a ${borrar.nombre}.`); } }}
      />
    </div>
  );
}
