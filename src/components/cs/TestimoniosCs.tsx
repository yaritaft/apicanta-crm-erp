"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import {
  coincideTestimonio, filasClientes, filasTestimonios, listasCs, MOTOR_TESTIMONIOS, ORDEN_TESTIMONIOS, testimonioNormal,
  VISIBLES_TESTIMONIOS, type ClaveTestimonio, type FilaTestimonio,
} from "@/lib/clientes-cs";
import type { ColorCrm, OpcionCrm, Testimonio } from "@/lib/types";
import { Pastilla } from "./pastillas";
import { NADA, Recorte, TablaCs } from "./TablaCs";

/* ==================================================================
   Testimonios: la pestaña de Lili, con sus 16 columnas. Los datos del alumno
   (edad, inicio, teléfono, stack, país) salen de su ficha de cliente: no se
   cargan de nuevo. Un alumno puede tener más de un testimonio.
   ================================================================== */

const opciones = (xs: readonly string[], color: ColorCrm = "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color }));

/* Cómo se corrige cada columna del testimonio. Las de la persona no se tocan acá. */
const EDITOR: Partial<Record<ClaveTestimonio, "texto" | "largo" | "fecha" | "opciones">> = {
  followUp: "opciones", fechaGrabacion: "fecha", conQuien: "opciones", resell: "opciones", estadoVideo: "opciones", link: "texto",
  tecnologias: "texto", previa: "largo", actual: "largo", notas: "largo",
};
const CAMPO: Partial<Record<ClaveTestimonio, keyof Testimonio>> = {
  followUp: "followUp", fechaGrabacion: "fechaGrabacion", conQuien: "conQuien", resell: "resell", estadoVideo: "estadoVideo", link: "link",
  tecnologias: "tecnologias", previa: "situacionPrevia", actual: "situacionActual", notas: "notas",
};

export function TestimoniosCs() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const abrirFicha = useAbrirFicha();
  const puede = puedeEditar(acceso, "testimonios");
  const hoy = hoyDelNegocio();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const clientes = useMemo(() => filasClientes(e, hoy), [e, hoy]);
  const filas = useMemo(() => filasTestimonios(e, clientes), [e, clientes]);
  const [editando, setEditando] = useState<{ id: string; clave: ClaveTestimonio } | null>(null);
  const [form, setForm] = useState<{ t?: Testimonio } | null>(null);
  const [borrar, setBorrar] = useState<Testimonio | null>(null);

  const opcionesDe = (clave: ClaveTestimonio): OpcionCrm[] | undefined => {
    switch (clave) {
      case "followUp": return opciones(listas.followUpsTestimonio);
      case "conQuien": return opciones(listas.quienGraba);
      case "resell": return opciones(listas.resellsTestimonio);
      case "estadoVideo": return opciones(listas.estadosVideo);
      default: return undefined;
    }
  };
  const ordenValores = useMemo(() => ({
    followUp: listas.followUpsTestimonio, conQuien: listas.quienGraba, resell: listas.resellsTestimonio, estadoVideo: listas.estadosVideo,
  }), [listas]);

  const guardarCelda = (f: FilaTestimonio, clave: ClaveTestimonio, valor: string) => {
    const campo = CAMPO[clave];
    if (!campo) return;
    const v = valor.trim();
    if (clave === "link" && v && !/^https?:\/\/\S+$/i.test(v)) { toast("El link tiene que empezar con http:// o https://", "err"); return; }
    const antes = f.testimonio;
    const nuevo = { ...antes, [campo]: campo === "fechaGrabacion" ? (v || null) : campo === "situacionPrevia" || campo === "situacionActual" || campo === "notas" ? valor : v } as Testimonio;
    acciones.guardarTestimonio(nuevo);
    const titulo = MOTOR_TESTIMONIOS.columna[clave].titulo;
    toast(`${titulo} de ${f.nombre || "el testimonio"}: ${v || "vacío"}.`, "ok", { texto: "Deshacer", onClick: () => acciones.guardarTestimonio(antes) });
  };

  const contenido = (clave: ClaveTestimonio, f: FilaTestimonio): React.ReactNode => {
    const t = f.testimonio;
    switch (clave) {
      case "edad": return f.edad === null ? NADA : <span className="t-num">{f.edad}</span>;
      case "inicio": return f.inicio ? <span className="t-num">{formatoDia(f.inicio, hoy)}</span> : NADA;
      case "fechaGrabacion": return t.fechaGrabacion ? <span className="t-num">{formatoDia(t.fechaGrabacion, hoy)}</span> : NADA;
      case "followUp": return <Pastilla texto={t.followUp} />;
      case "estadoVideo": return <Pastilla texto={t.estadoVideo} />;
      case "resell": return <Pastilla texto={t.resell} />;
      case "conQuien": return t.conQuien ? <Pastilla texto={t.conQuien} tono="neutra" /> : NADA;
      case "stack": return f.stack ? <Pastilla texto={f.stack} tono="neutra" /> : NADA;
      case "link": return t.link
        ? <a href={t.link} target="_blank" rel="noreferrer noopener" className="row" style={{ gap: 4 }} onClick={(ev) => ev.stopPropagation()}>Abrir<ExternalLink size={13} aria-hidden /></a>
        : NADA;
      case "tecnologias": return <Recorte texto={f.tecnologias} />;
      case "previa": return <Recorte texto={t.situacionPrevia} />;
      case "actual": return <Recorte texto={t.situacionActual} />;
      case "notas": return <Recorte texto={t.notas} />;
      case "telefono": return <Recorte texto={f.telefono} />;
      case "pais": return <Recorte texto={f.pais} />;
      default: return NADA;
    }
  };
  const valorEditable = (clave: ClaveTestimonio, f: FilaTestimonio): string => {
    const campo = CAMPO[clave];
    const x = campo ? f.testimonio[campo] : "";
    return typeof x === "string" ? x : "";
  };

  const celda = (col: { clave: ClaveTestimonio }, f: FilaTestimonio): React.ReactNode => {
    const clave = col.clave;
    if (clave === "alumno") {
      return (
        <span className="crm-t__persona">
          <button type="button" className="crm-t__abrir truncate" disabled={!f.alumno} onClick={() => f.alumno && abrirFicha(f.alumno.id, "servicio")}>
            {f.nombre || "Alumno borrado"}
          </button>
          {puede && (
            <button type="button" className="crm-t__lapiz" onClick={() => setForm({ t: f.testimonio })} aria-label="Editar el testimonio" title="Editar el testimonio"><Pencil size={12} /></button>
          )}
        </span>
      );
    }
    const editor = EDITOR[clave];
    if (!editor || !puede) {
      const porQue = MOTOR_TESTIMONIOS.columna[clave].ayuda;
      return <span className="crm-t__fija" title={porQue}>{contenido(clave, f)}</span>;
    }
    const abierta = editando?.id === f.id && editando.clave === clave;
    return (
      <CeldaEditable
        editor={editor} valor={valorEditable(clave, f)} titulo={MOTOR_TESTIMONIOS.columna[clave].titulo} abierta={abierta}
        onAbrir={() => setEditando({ id: f.id, clave })} onCerrar={() => setEditando((x) => (x?.id === f.id && x.clave === clave ? null : x))}
        onGuardar={(v) => guardarCelda(f, clave, v)} opciones={opcionesDe(clave)} vaciable
      >
        {contenido(clave, f)}
      </CeldaEditable>
    );
  };

  return (
    <>
      <TablaCs
        motor={MOTOR_TESTIMONIOS} pantalla="testimonios-cs" filas={filas} coincide={coincideTestimonio}
        visiblesPorDefecto={VISIBLES_TESTIMONIOS} ordenPorDefecto={ORDEN_TESTIMONIOS} fija="alumno" ordenValores={ordenValores}
        celda={(col, f) => celda(col, f)}
        filaAcciones={puede ? (f) => <IconButton etiqueta="Borrar" onClick={() => setBorrar(f.testimonio)}><Trash2 size={15} /></IconButton> : undefined}
        excel={{ nombre: "Testimonios", hoy, valor: (col, f) => {
          if (col.numerica && col.orden) { const n = Number(col.orden(f)); return Number.isFinite(n) && col.orden(f) !== "" ? n : null; }
          const campo = CAMPO[col.clave];
          if (campo === "fechaGrabacion") return f.testimonio.fechaGrabacion;
          if (campo) { const x = f.testimonio[campo]; return typeof x === "string" ? x : ""; }
          return MOTOR_TESTIMONIOS.textoDeColumna(f, col);
        } }}
        singular="testimonio" plural="testimonios" placeholder="Buscar por alumno, tecnología o nota"
        acciones={puede ? <Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setForm({})}>Nuevo testimonio</Button> : undefined}
        vacio={{
          titulo: "Todavía no hay testimonios",
          texto: "Cargá a quién se le pidió un testimonio y llevá cuándo se agendó la llamada, si se grabó y dónde está el video. También se pueden traer del Airtable con «Importar» en Clientes.",
          accion: puede ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm({})}>Cargar el primero</Button> : undefined,
        }}
      />
      {form && <FormTestimonioCs testimonio={form.t} onCerrar={() => setForm(null)} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar este testimonio?" texto="Se borra el registro del testimonio (no el video ni el posteo). El alumno sigue donde estaba."
        onConfirmar={() => { if (borrar) { acciones.borrarTestimonio(borrar.id); toast("Testimonio borrado."); } }}
      />
    </>
  );
}

/* El formulario de un testimonio: nuevo (con el alumno a elegir) o uno existente. */
export function FormTestimonioCs({ testimonio, alumnoId, onCerrar }: { testimonio?: Testimonio; alumnoId?: string; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const t0 = testimonio ? testimonioNormal(testimonio) : undefined;
  const [alumno, setAlumno] = useState(t0?.alumnoId ?? alumnoId ?? "");
  const [b, setB] = useState({
    followUp: t0?.followUp ?? "", fecha: t0?.fechaGrabacion ?? "", conQuien: t0?.conQuien ?? "", resell: t0?.resell ?? "",
    estadoVideo: t0?.estadoVideo ?? "", link: t0?.link ?? "", tecnologias: t0?.tecnologias ?? "",
    previa: t0?.situacionPrevia ?? "", actual: t0?.situacionActual ?? "", notas: t0?.notas ?? "",
  });
  const set = <K extends keyof typeof b>(k: K, v: string) => setB((x) => ({ ...x, [k]: v }));
  const alumnos = useMemo(() => [...e.alumnos].sort((a, c) => a.nombre.localeCompare(c.nombre, "es")), [e.alumnos]);
  const linkValido = !b.link.trim() || /^https?:\/\/\S+$/i.test(b.link.trim());
  const conActual = (lista: readonly string[], actual: string) => (actual && !lista.includes(actual) ? [actual, ...lista] : [...lista]);

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={testimonio ? "Editar el testimonio" : "Nuevo testimonio"} ancho
      sub="Un alumno puede tener más de uno. La edad, el teléfono, el stack y el país salen de su ficha de cliente."
      puedeGuardar={Boolean(alumno) && linkValido}
      onGuardar={() => {
        acciones.guardarTestimonio({
          id: t0?.id ?? nuevoId("tes"), alumnoId: alumno, followUp: b.followUp, fechaGrabacion: b.fecha || null, conQuien: b.conQuien,
          resell: b.resell, estadoVideo: b.estadoVideo, link: b.link.trim(), tecnologias: b.tecnologias.trim(),
          situacionPrevia: b.previa, situacionActual: b.actual, notas: b.notas, creadoEn: t0?.creadoEn ?? new Date().toISOString(),
        });
        toast(testimonio ? "Testimonio actualizado." : "Testimonio cargado.");
        onCerrar();
      }}
    >
      <div className="form-grid">
        <Field label="Alumno" span2>
          <Select value={alumno} aria-label="Alumno" placeholder="Elegí un alumno" disabled={Boolean(testimonio)}
            opciones={alumnos.map((a) => ({ valor: a.id, texto: `${a.nombre}${a.email ? ` · ${a.email}` : ""}` }))} onChange={(ev) => setAlumno(ev.target.value)} />
        </Field>
        <Field label="Follow-up" ayuda="Si ya se agendó la llamada de grabación.">
          <Select value={b.followUp} aria-label="Follow-up" placeholder="Sin definir" opciones={conActual(listas.followUpsTestimonio, b.followUp)} onChange={(ev) => set("followUp", ev.target.value)} />
        </Field>
        <Field label="Fecha de grabación"><Input type="date" value={b.fecha} onChange={(ev) => set("fecha", ev.target.value)} /></Field>
        <Field label="Con quién grabó">
          <Select value={b.conQuien} aria-label="Con quién grabó" placeholder="Sin definir" opciones={conActual(listas.quienGraba, b.conQuien)} onChange={(ev) => set("conQuien", ev.target.value)} />
        </Field>
        <Field label="Resell" ayuda="Cómo salió el pitch de renovación después de la llamada.">
          <Select value={b.resell} aria-label="Resell" placeholder="Sin definir" opciones={conActual(listas.resellsTestimonio, b.resell)} onChange={(ev) => set("resell", ev.target.value)} />
        </Field>
        <Field label="Estado del video">
          <Select value={b.estadoVideo} aria-label="Estado del video" placeholder="Sin definir" opciones={conActual(listas.estadosVideo, b.estadoVideo)} onChange={(ev) => set("estadoVideo", ev.target.value)} />
        </Field>
        <Field label="Link del video" ayuda="Dónde está guardado o publicado." error={linkValido ? undefined : "Tiene que empezar con http:// o https://"}>
          <Input value={b.link} onChange={(ev) => set("link", ev.target.value)} placeholder="https://…" error={!linkValido} />
        </Field>
        <Field label="Tecnologías" span2><Input value={b.tecnologias} onChange={(ev) => set("tecnologias", ev.target.value)} placeholder="React, Node…" /></Field>
        <Field label="Situación previa" ayuda="Cómo estaba antes de entrar a la mentoría." span2><Textarea rows={3} value={b.previa} onChange={(ev) => set("previa", ev.target.value)} /></Field>
        <Field label="Situación actual" ayuda="Qué logró o dónde está hoy." span2><Textarea rows={3} value={b.actual} onChange={(ev) => set("actual", ev.target.value)} /></Field>
        <Field label="Notas" span2><Textarea rows={3} value={b.notas} onChange={(ev) => set("notas", ev.target.value)} placeholder="Información relevante del caso…" /></Field>
      </div>
    </ModalForm>
  );
}
