"use client";

import React, { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { Button, Chip, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { useEscribirURL } from "@/lib/useParamsURL";
import { sinTildes } from "@/lib/crm";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { listasCs } from "@/lib/clientes-cs";
import {
  coincideRevisionCv, contadoresCv, filasRevisionesCv, MOTOR_REVISIONES_CV, ORDEN_REVISIONES_CV, revisionCvNormal, VISIBLES_REVISIONES_CV,
  type ClaveRevisionCv, type ContadorCv, type FilaRevisionCv,
} from "@/lib/revision-cv";
import type { ColorCrm, OpcionCrm, RevisionCv } from "@/lib/types";
import { Pastilla, type TonoPastilla } from "./pastillas";
import { NADA, Recorte, TablaCs } from "./TablaCs";

/* ==================================================================
   La revisión de CVs de Customer Success: la base de Notion de Aldana («REVISION DE CVS») adentro de la app. Una fila por alumno con en qué
   etapa va (el estado), si el CV llegó y si ya mandó la primera y la segunda corrección, el documento de corrección que se le manda al alumno
   y el Loom de Yari. Arriba, cuántos hay en cada estado pendiente: un clic filtra la tabla (Cerrado y Outboarding ya terminaron: no se cuentan).
   ================================================================== */

const opciones = (xs: readonly string[], color: ColorCrm = "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color }));

/* El color de cada etapa: lo que ya terminó, en verde; lo que espera al alumno, en ámbar; el resto, en azul. */
function tonoDeEstado(estado: string): TonoPastilla {
  const t = sinTildes(estado).toLowerCase();
  if (/cerrad/.test(t)) return "ok";
  if (/esperando/.test(t)) return "aviso";
  if (/outboard|offboard|sin estado/.test(t)) return "neutra";
  return "info";
}

const esLink = (t: string) => /^https?:\/\/\S+$/i.test(t.trim());
const diaValido = (t: string) => /^\d{4}-\d{2}-\d{2}$/.test(t) && !Number.isNaN(Date.parse(`${t}T12:00:00Z`));

type Editor = "texto" | "largo" | "opciones" | "fecha" | "si-no";
const EDITOR: Partial<Record<ClaveRevisionCv, Editor>> = {
  estado: "opciones", cvRecibido: "si-no", correccion1: "si-no", correccion2: "si-no", fechaInicio: "fecha",
  telefono: "texto", mensajes: "texto", notas: "largo", linkCv: "texto", linkLinkedin: "texto", linkCorreccion: "texto", linkLoom: "texto",
};
const LINKS: ClaveRevisionCv[] = ["linkCv", "linkLinkedin", "linkCorreccion", "linkLoom"];
const ETIQUETA_LINK: Partial<Record<ClaveRevisionCv, string>> = { linkCv: "CV", linkLinkedin: "LinkedIn", linkCorreccion: "Documento", linkLoom: "Loom" };

export function RevisionCvCs() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const puede = puedeEditar(acceso, "revisiones_cv");
  const hoy = hoyDelNegocio();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const filas = useMemo(() => filasRevisionesCv(e), [e]);
  const contadores = useMemo(() => contadoresCv(filas, listas.estadosCv), [filas, listas]);
  const [editando, setEditando] = useState<{ id: string; clave: ClaveRevisionCv } | null>(null);
  const [form, setForm] = useState<{ r?: RevisionCv } | null>(null);
  const [borrar, setBorrar] = useState<RevisionCv | null>(null);
  const ordenValores = useMemo(() => ({ estado: listas.estadosCv }), [listas]);

  /* ---------- El contador: un clic filtra por ese estado (y otro clic saca el filtro) ---------- */
  const filtros = MOTOR_REVISIONES_CV.filtrosDeURL(new URLSearchParams(params.toString()));
  const activo = (c: ContadorCv) => {
    const f = filtros.estado;
    return Boolean(f && f.modo === "solo" && f.valores.length === c.valores.length && c.valores.every((v) => f.valores.includes(v)));
  };
  const alternar = (c: ContadorCv) =>
    escribir({ ...MOTOR_REVISIONES_CV.filtroAURL("estado", activo(c) ? null : { modo: "solo", valores: c.valores }), [MOTOR_REVISIONES_CV.paramPagina]: null });
  const atajos = (
    <div className="cs-atajos" aria-label="Cuántos hay en cada estado pendiente">
      {contadores.map((c) => (
        <Chip key={c.estado} activo={activo(c)} count={c.n} onClick={() => alternar(c)} title={`Revisiones en «${c.estado}»: un clic filtra la tabla`}>{c.estado}</Chip>
      ))}
    </div>
  );

  /* ---------- Corregir en la celda ---------- */
  const guardar = (r: RevisionCv, cambios: Partial<RevisionCv>, titulo: string, texto: string) => {
    acciones.guardarRevisionCv({ ...r, ...cambios });
    toast(`${titulo} de ${r.nombre || "la revisión"}: ${texto || "vacío"}.`, "ok", { texto: "Deshacer", onClick: () => acciones.guardarRevisionCv(r) });
  };

  const guardarCelda = (f: FilaRevisionCv, clave: ClaveRevisionCv, valor: string) => {
    const r = f.revision;
    const v = valor.trim();
    const titulo = MOTOR_REVISIONES_CV.columna[clave].titulo;
    switch (clave) {
      case "estado": return guardar(r, { estado: v }, titulo, v);
      case "cvRecibido": return guardar(r, { cvRecibido: v === "Sí" }, titulo, v === "Sí" ? "Sí" : "No");
      case "correccion1": return guardar(r, { correccion1: v === "Sí" }, titulo, v === "Sí" ? "Sí" : "No");
      case "correccion2": return guardar(r, { correccion2: v === "Sí" }, titulo, v === "Sí" ? "Sí" : "No");
      case "fechaInicio":
        if (v && !diaValido(v)) { toast("Esa fecha no es válida.", "err"); return; }
        return guardar(r, { fechaInicio: v || null }, titulo, v ? formatoDia(v, hoy) : "");
      case "telefono": return guardar(r, { telefono: v }, titulo, v);
      case "mensajes": return guardar(r, { mensajes: v }, titulo, v);
      case "notas": return guardar(r, { notas: valor }, titulo, v ? "con texto" : "");
      case "linkCv": case "linkLinkedin": case "linkCorreccion": case "linkLoom": {
        if (v && !esLink(v)) { toast("El link tiene que empezar con http:// o https://.", "err"); return; }
        return guardar(r, { [clave]: v } as Partial<RevisionCv>, titulo, v ? "con link" : "");
      }
      default: return;
    }
  };

  const valorDe = (clave: ClaveRevisionCv, f: FilaRevisionCv): string => {
    const r = f.revision;
    switch (clave) {
      case "estado": return r.estado;
      case "cvRecibido": return r.cvRecibido ? "Sí" : "No";
      case "correccion1": return r.correccion1 ? "Sí" : "No";
      case "correccion2": return r.correccion2 ? "Sí" : "No";
      case "fechaInicio": return r.fechaInicio ?? "";
      case "telefono": return r.telefono;
      case "mensajes": return r.mensajes;
      case "notas": return r.notas;
      case "linkCv": return r.linkCv;
      case "linkLinkedin": return r.linkLinkedin;
      case "linkCorreccion": return r.linkCorreccion;
      case "linkLoom": return r.linkLoom;
      default: return "";
    }
  };

  const contenido = (clave: ClaveRevisionCv, f: FilaRevisionCv): React.ReactNode => {
    const r = f.revision;
    switch (clave) {
      case "nombre": return <Recorte texto={r.nombre} />;
      case "telefono": return <Recorte texto={r.telefono} />;
      case "alumno": return f.alumno ? <Recorte texto={f.alumno.nombre} /> : <span className="t-subtle">Sin atar</span>;
      case "estado": return <Pastilla texto={f.estado} tono={tonoDeEstado(f.estado)} />;
      case "cvRecibido": case "correccion1": case "correccion2": {
        const si = clave === "cvRecibido" ? r.cvRecibido : clave === "correccion1" ? r.correccion1 : r.correccion2;
        return <Pastilla texto={si ? "Sí" : "No"} tono={si ? "ok" : "neutra"} />;
      }
      case "fechaInicio": return r.fechaInicio ? <span className="t-num">{formatoDia(r.fechaInicio, hoy)}</span> : NADA;
      case "linkCv": case "linkLinkedin": case "linkCorreccion": case "linkLoom": {
        const link = valorDe(clave, f).trim();
        if (!link) return NADA;
        if (!esLink(link)) return <Recorte texto={link} />;
        return (
          <a className="cs-link-cv" href={link} target="_blank" rel="noopener noreferrer" title={link} onClick={(ev) => ev.stopPropagation()}>
            Abrir <ExternalLink size={12} />
          </a>
        );
      }
      case "mensajes": return <Recorte texto={r.mensajes} />;
      case "notas": return <Recorte texto={r.notas} />;
      default: return NADA;
    }
  };

  const celda = (col: { clave: ClaveRevisionCv }, f: FilaRevisionCv): React.ReactNode => {
    const clave = col.clave;
    const r = f.revision;
    const titulo = MOTOR_REVISIONES_CV.columna[clave].titulo;
    if (clave === "nombre") {
      return (
        <span className="crm-t__persona">
          <span className="crm-t__fija">{contenido(clave, f)}</span>
          {puede && (
            <button type="button" className="crm-t__lapiz" onClick={() => setForm({ r })} aria-label={`Editar la revisión de ${r.nombre || "este alumno"}`} title="Editar la revisión"><Pencil size={12} /></button>
          )}
        </span>
      );
    }
    const editor = EDITOR[clave];
    if (!editor || !puede) return <span className="crm-t__fija">{contenido(clave, f)}</span>;
    if (editor === "si-no") {
      const si = valorDe(clave, f) === "Sí";
      return (
        <button type="button" className="cs-si-no" aria-pressed={si} title={`${titulo}: clic para cambiar`}
          onClick={(ev) => { ev.stopPropagation(); guardarCelda(f, clave, si ? "No" : "Sí"); }}>
          {contenido(clave, f)}
        </button>
      );
    }
    const abierta = editando?.id === f.id && editando.clave === clave;
    const lista = clave === "estado" ? (r.estado && !listas.estadosCv.includes(r.estado) ? [r.estado, ...listas.estadosCv] : listas.estadosCv) : undefined;
    return (
      <CeldaEditable
        editor={editor} valor={valorDe(clave, f)} titulo={titulo} abierta={abierta}
        onAbrir={() => setEditando({ id: f.id, clave })} onCerrar={() => setEditando((x) => (x?.id === f.id && x.clave === clave ? null : x))}
        onGuardar={(v) => guardarCelda(f, clave, v)} opciones={lista ? opciones(lista) : undefined} vaciable
      >
        {contenido(clave, f)}
      </CeldaEditable>
    );
  };

  return (
    <>
      <TablaCs
        motor={MOTOR_REVISIONES_CV} pantalla="revision-cv" filas={filas} coincide={coincideRevisionCv}
        visiblesPorDefecto={VISIBLES_REVISIONES_CV} ordenPorDefecto={ORDEN_REVISIONES_CV} fija="nombre" ordenValores={ordenValores}
        celda={(col, f) => celda(col, f)} atajos={atajos}
        filaAcciones={puede ? (f) => <IconButton etiqueta="Borrar" onClick={() => setBorrar(f.revision)}><Trash2 size={15} /></IconButton> : undefined}
        excel={{ nombre: "Revisión de CVs", hoy, valor: (col, f) => {
          const r = f.revision;
          switch (col.clave) {
            case "estado": return f.estado;
            case "cvRecibido": return r.cvRecibido ? "Sí" : "No";
            case "correccion1": return r.correccion1 ? "Sí" : "No";
            case "correccion2": return r.correccion2 ? "Sí" : "No";
            case "fechaInicio": return r.fechaInicio;
            case "alumno": return f.alumno?.nombre ?? "";
            case "linkCv": case "linkLinkedin": case "linkCorreccion": case "linkLoom": return valorDe(col.clave, f);
            default: return MOTOR_REVISIONES_CV.textoDeColumna(f, col);
          }
        } }}
        singular="revisión" plural="revisiones" placeholder="Buscar por nombre, teléfono o notas"
        acciones={puede ? <Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setForm({})}>Nuevo CV</Button> : undefined}
        vacio={{
          titulo: "Todavía no hay CVs en revisión",
          texto: "Cada CV que llega para corregir tiene su fila: en qué etapa va, si ya se mandó la corrección, el documento y el Loom de Yari.",
          accion: puede ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm({})}>Cargar el primero</Button> : undefined,
        }}
      />
      {form && <FormRevisionCv revision={form.r} onCerrar={() => setForm(null)} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar esta revisión?" texto={`Se borra la fila de ${borrar?.nombre || "este alumno"} de la revisión de CVs. El documento de corrección y el CV no se tocan.`}
        onConfirmar={() => { if (borrar) { acciones.borrarRevisionCv(borrar.id); toast("Revisión borrada."); } }}
      />
    </>
  );
}

/* El formulario de una revisión: nueva o una existente. */
function FormRevisionCv({ revision, onCerrar }: { revision?: RevisionCv; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const r0 = revision ? revisionCvNormal(revision) : undefined;
  const [b, setB] = useState({
    nombre: r0?.nombre ?? "", telefono: r0?.telefono ?? "", estado: r0 ? r0.estado : (listas.estadosCv[0] ?? ""),
    fechaInicio: r0 ? (r0.fechaInicio ?? "") : diaDeNegocio(new Date().toISOString()),
    cvRecibido: r0 ? r0.cvRecibido : true, correccion1: r0?.correccion1 ?? false, correccion2: r0?.correccion2 ?? false,
    linkCv: r0?.linkCv ?? "", linkLinkedin: r0?.linkLinkedin ?? "", linkCorreccion: r0?.linkCorreccion ?? "", linkLoom: r0?.linkLoom ?? "",
    mensajes: r0?.mensajes ?? "", notas: r0?.notas ?? "",
  });
  const set = <K extends keyof typeof b>(k: K, v: (typeof b)[K]) => setB((x) => ({ ...x, [k]: v }));
  const linkOk = (t: string) => !t.trim() || esLink(t);
  const todosLosLinksOk = LINKS.every((k) => linkOk(b[k as "linkCv"]));
  const fechaOk = !b.fechaInicio || diaValido(b.fechaInicio);
  const puedeGuardar = Boolean(b.nombre.trim()) && todosLosLinksOk && fechaOk;
  const estados = b.estado && !listas.estadosCv.includes(b.estado) ? [b.estado, ...listas.estadosCv] : listas.estadosCv;

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={revision ? "Editar la revisión de CV" : "Nuevo CV para revisar"} ancho puedeGuardar={puedeGuardar}
      sub={r0?.origen === "importado" ? "Viene de la base de Notion de Aldana." : "Cargada a mano."}
      onGuardar={() => {
        acciones.guardarRevisionCv(revisionCvNormal({
          ...(r0 ?? {}), id: r0?.id ?? nuevoId("cv"), alumnoId: r0?.alumnoId ?? null,
          nombre: b.nombre, telefono: b.telefono, estado: b.estado, fechaInicio: b.fechaInicio || null,
          cvRecibido: b.cvRecibido, correccion1: b.correccion1, correccion2: b.correccion2,
          linkCv: b.linkCv, linkLinkedin: b.linkLinkedin, linkCorreccion: b.linkCorreccion, linkLoom: b.linkLoom,
          mensajes: b.mensajes, notas: b.notas, origen: r0?.origen ?? "manual", creadoEn: r0?.creadoEn,
        }));
        toast(revision ? "Revisión actualizada." : "CV cargado para revisar.");
        onCerrar();
      }}
    >
      <div className="form-grid">
        <Field label="Nombre" span2><Input value={b.nombre} onChange={(ev) => set("nombre", ev.target.value)} autoFocus /></Field>
        <Field label="Teléfono"><Input value={b.telefono} onChange={(ev) => set("telefono", ev.target.value)} /></Field>
        <Field label="Fecha de inicio" error={fechaOk ? undefined : "Esa fecha no es válida."}>
          <Input type="date" value={b.fechaInicio} onChange={(ev) => set("fechaInicio", ev.target.value)} error={!fechaOk} />
        </Field>
        <Field label="Estado" ayuda="En qué etapa va la revisión">
          <Select value={b.estado} aria-label="Estado" placeholder="Sin estado" opciones={estados} onChange={(ev) => set("estado", ev.target.value)} />
        </Field>
        <Field label="Lo que ya está hecho">
          <div className="stack-2">
            <label className="row" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={b.cvRecibido} onChange={(ev) => set("cvRecibido", ev.target.checked)} /><span>CV recibido</span></label>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={b.correccion1} onChange={(ev) => set("correccion1", ev.target.checked)} /><span>Corrección 1 enviada</span></label>
            <label className="row" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={b.correccion2} onChange={(ev) => set("correccion2", ev.target.checked)} /><span>Corrección 2 enviada</span></label>
          </div>
        </Field>
        {LINKS.map((k) => {
          const clave = k as "linkCv" | "linkLinkedin" | "linkCorreccion" | "linkLoom";
          const ok = linkOk(b[clave]);
          return (
            <Field key={k} label={MOTOR_REVISIONES_CV.columna[k].titulo} error={ok ? undefined : "Tiene que empezar con http:// o https://."}>
              <Input value={b[clave]} onChange={(ev) => set(clave, ev.target.value)} placeholder="https://…" error={!ok} aria-label={ETIQUETA_LINK[k]} />
            </Field>
          );
        })}
        <Field label="Mensajes" ayuda="«msj 9/9», «pedido a lili»…" span2><Input value={b.mensajes} onChange={(ev) => set("mensajes", ev.target.value)} /></Field>
        <Field label="Notas" span2><Textarea rows={3} value={b.notas} onChange={(ev) => set("notas", ev.target.value)} /></Field>
      </div>
    </ModalForm>
  );
}
