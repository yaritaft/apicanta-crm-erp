"use client";

import React, { useMemo, useState } from "react";
import { Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { acciones, cargarDeLaNube, hayNube, nuevoId, reiniciarCarga, useEstado, useSync } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeEditar } from "@/lib/permisos";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import { diaDeNegocio } from "@/lib/dia-negocio";
import {
  coincideResell, filasResells, listasCs, MOTOR_RESELLS, ORDEN_RESELLS, resellNormal, VISIBLES_RESELLS, type ClaveResell, type FilaResell,
} from "@/lib/clientes-cs";
import { leerMontoCs } from "@/lib/importar-cs";
import { money } from "@/lib/format";
import type { ColorCrm, OpcionCrm, Resell } from "@/lib/types";
import { Pastilla } from "./pastillas";
import { NADA, Recorte, TablaCs } from "./TablaCs";

/* ==================================================================
   Agenda de resells: la tercera pestaña de Lili, con sus 9 columnas. Las
   llamadas que agenda un alumno por el link de Calendly entran solas
   (lib/calendly-sync.ts): fecha, nombre, mail, teléfono y closer vienen de
   ahí. Customer Success completa el estado (renueva, no renueva…), el cash
   collect, si es un caso de éxito y las notas. También se pueden cargar a mano.
   ================================================================== */

const opciones = (xs: readonly string[], color: ColorCrm = "gris1"): OpcionCrm[] => xs.map((nombre) => ({ nombre, color }));
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

/* Lo que agendó Calendly no se corrige acá: cambia si el alumno reprograma. */
const DE_CALENDLY: ClaveResell[] = ["fechaHora", "nombre", "email", "telefono", "closer"];
const EDITOR: Partial<Record<ClaveResell, "texto" | "largo" | "opciones" | "si-no">> = {
  nombre: "texto", email: "texto", telefono: "texto", closer: "texto", estado: "opciones", cash: "texto", caso: "si-no", notas: "largo",
};

export function ResellsCs() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const { estado: sync } = useSync();
  const puede = puedeEditar(acceso, "resells");
  const hoy = hoyDelNegocio();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const filas = useMemo(() => filasResells(e), [e]);
  const [editando, setEditando] = useState<{ id: string; clave: ClaveResell } | null>(null);
  const [form, setForm] = useState<{ r?: Resell } | null>(null);
  const [borrar, setBorrar] = useState<Resell | null>(null);
  const ordenValores = useMemo(() => ({ estado: listas.estadosResell }), [listas]);

  const guardar = (r: Resell, cambios: Partial<Resell>, titulo: string, texto: string) => {
    acciones.guardarResell({ ...r, ...cambios });
    toast(`${titulo} de ${r.nombre || "la agenda"}: ${texto || "vacío"}.`, "ok", { texto: "Deshacer", onClick: () => acciones.guardarResell(r) });
  };

  const guardarCelda = (f: FilaResell, clave: ClaveResell, valor: string) => {
    const r = f.resell;
    const v = valor.trim();
    const titulo = MOTOR_RESELLS.columna[clave].titulo;
    switch (clave) {
      case "estado": return guardar(r, { estado: v }, titulo, v);
      case "cash": {
        if (!v) return guardar(r, { cashCollect: null }, titulo, "");
        const n = leerMontoCs(v);
        if (n === null || n < 0) { toast("El Cash Collect tiene que ser un monto (por ejemplo 1200 o 1.200,50).", "err"); return; }
        return guardar(r, { cashCollect: n }, titulo, money(n, "USD"));
      }
      case "caso": return guardar(r, { casoDeExito: v === "Sí" }, titulo, v === "Sí" ? "Sí" : "No");
      case "notas": return guardar(r, { notas: valor }, titulo, v ? "con texto" : "");
      case "nombre": return guardar(r, { nombre: v }, titulo, v);
      case "email":
        if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) { toast("Ese mail no parece válido.", "err"); return; }
        return guardar(r, { email: v }, titulo, v);
      case "telefono": return guardar(r, { telefono: v }, titulo, v);
      case "closer": return guardar(r, { closer: v }, titulo, v);
      default: return;
    }
  };

  const contenido = (clave: ClaveResell, f: FilaResell): React.ReactNode => {
    const r = f.resell;
    switch (clave) {
      case "fechaHora": return <span className="t-num">{formatoDia(f.dia, hoy)} · {HORA.format(new Date(r.fechaHora))}</span>;
      case "estado": return <Pastilla texto={f.estado} />;
      case "cash": return r.cashCollect === null ? NADA : <span className="t-num">{money(r.cashCollect, "USD")}</span>;
      case "caso": return <Pastilla texto={r.casoDeExito ? "Sí" : "No"} tono={r.casoDeExito ? "ok" : "neutra"} />;
      case "notas": return <Recorte texto={r.notas} />;
      case "nombre": return <Recorte texto={r.nombre} />;
      case "email": return <Recorte texto={r.email} />;
      case "telefono": return <Recorte texto={r.telefono} />;
      case "closer": return <Recorte texto={r.closer} />;
      default: return NADA;
    }
  };
  const valorEditable = (clave: ClaveResell, f: FilaResell): string => {
    const r = f.resell;
    switch (clave) {
      case "estado": return r.estado;
      case "cash": return r.cashCollect === null ? "" : String(r.cashCollect);
      case "caso": return r.casoDeExito ? "Sí" : "No";
      case "notas": return r.notas;
      case "nombre": return r.nombre;
      case "email": return r.email;
      case "telefono": return r.telefono;
      case "closer": return r.closer;
      default: return "";
    }
  };

  const celda = (col: { clave: ClaveResell }, f: FilaResell): React.ReactNode => {
    const clave = col.clave;
    const r = f.resell;
    const titulo = MOTOR_RESELLS.columna[clave].titulo;
    if (clave === "fechaHora") {
      return (
        <span className="crm-t__persona">
          <span className="crm-t__fija" title={r.origen === "calendly" ? "Agendó por Calendly: si el alumno reprograma, cambia sola." : undefined}>{contenido(clave, f)}</span>
          {puede && (
            <button type="button" className="crm-t__lapiz" onClick={() => setForm({ r })} aria-label="Editar la agenda" title="Editar la agenda"><Pencil size={12} /></button>
          )}
        </span>
      );
    }
    const editor = EDITOR[clave];
    const deCalendly = r.origen === "calendly" && DE_CALENDLY.includes(clave);
    if (!editor || !puede || deCalendly) {
      return <span className="crm-t__fija" title={deCalendly ? "Viene de Calendly: si el alumno reprograma, cambia sola." : undefined}>{contenido(clave, f)}</span>;
    }
    if (editor === "si-no") {
      return (
        <button type="button" className="cs-si-no" aria-pressed={r.casoDeExito} title={`${titulo}: clic para cambiar`}
          onClick={(ev) => { ev.stopPropagation(); guardarCelda(f, clave, r.casoDeExito ? "No" : "Sí"); }}>
          {contenido(clave, f)}
        </button>
      );
    }
    const abierta = editando?.id === f.id && editando.clave === clave;
    return (
      <CeldaEditable
        editor={editor} valor={valorEditable(clave, f)} titulo={titulo} abierta={abierta}
        onAbrir={() => setEditando({ id: f.id, clave })} onCerrar={() => setEditando((x) => (x?.id === f.id && x.clave === clave ? null : x))}
        onGuardar={(v) => guardarCelda(f, clave, v)} opciones={clave === "estado" ? opciones(listas.estadosResell) : undefined} vaciable
      >
        {contenido(clave, f)}
      </CeldaEditable>
    );
  };

  async function actualizar() {
    reiniciarCarga();
    await cargarDeLaNube();
    toast("Agenda actualizada.");
  }

  return (
    <>
      <TablaCs
        motor={MOTOR_RESELLS} pantalla="resells-cs" filas={filas} coincide={coincideResell}
        visiblesPorDefecto={VISIBLES_RESELLS} ordenPorDefecto={ORDEN_RESELLS} fija="fechaHora" ordenValores={ordenValores}
        celda={(col, f) => celda(col, f)}
        filaAcciones={puede ? (f) => (f.resell.origen === "calendly"
          ? undefined
          : <IconButton etiqueta="Borrar" onClick={() => setBorrar(f.resell)}><Trash2 size={15} /></IconButton>) : undefined}
        excel={{ nombre: "Agenda de resells", hoy, valor: (col, f) => {
          const r = f.resell;
          switch (col.clave) {
            case "fechaHora": return f.dia;
            case "cash": return r.cashCollect;
            case "estado": return f.estado;
            case "caso": return r.casoDeExito ? "Sí" : "No";
            default: return MOTOR_RESELLS.textoDeColumna(f, col);
          }
        } }}
        singular="agenda" plural="agendas" placeholder="Buscar por nombre, mail o closer"
        acciones={
          <>
            {hayNube && <Button sm variante="ghost" icono={<RefreshCw size={14} />} disabled={sync !== "listo"} onClick={() => void actualizar()}
              title="Trae de la nube lo que agendaron por Calendly desde que abriste la app">Actualizar</Button>}
            {puede && <Button sm variante="primary" icono={<Plus size={15} />} onClick={() => setForm({})}>Nueva agenda</Button>}
          </>
        }
        vacio={{
          titulo: "Todavía no hay agendas de resells",
          texto: "Cuando un alumno agende por el link de Calendly de resells (el evento de «auditoría»), entra acá solo. También se puede cargar una a mano o traer la tabla del Airtable con «Importar» en Clientes.",
          accion: puede ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm({})}>Cargar una</Button> : undefined,
        }}
      />
      {form && <FormResell resell={form.r} onCerrar={() => setForm(null)} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar esta agenda?" texto="Se borra el registro de la agenda de resells. La llamada en Calendly no se toca."
        onConfirmar={() => { if (borrar) { acciones.borrarResell(borrar.id); toast("Agenda borrada."); } }}
      />
    </>
  );
}

/* El formulario de una agenda de resell: nueva o una existente. Lo que trajo Calendly no se corrige. */
function FormResell({ resell, onCerrar }: { resell?: Resell; onCerrar: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const r0 = resell ? resellNormal(resell) : undefined;
  const deCalendly = r0?.origen === "calendly";
  const inicial = r0 ? new Date(r0.fechaHora) : new Date();
  const [b, setB] = useState({
    dia: r0 ? diaDeNegocio(r0.fechaHora) : diaDeNegocio(new Date().toISOString()),
    hora: r0 ? HORA.format(inicial) : "12:00",
    nombre: r0?.nombre ?? "", email: r0?.email ?? "", telefono: r0?.telefono ?? "", closer: r0?.closer ?? "",
    estado: r0?.estado ?? "", cash: r0?.cashCollect === null || r0?.cashCollect === undefined ? "" : String(r0.cashCollect),
    caso: r0?.casoDeExito ?? false, notas: r0?.notas ?? "",
  });
  const set = <K extends keyof typeof b>(k: K, v: (typeof b)[K]) => setB((x) => ({ ...x, [k]: v }));
  const cash = b.cash.trim() ? leerMontoCs(b.cash) : null;
  const mailOk = !b.email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(b.email.trim());
  const cashOk = !b.cash.trim() || (cash !== null && cash >= 0);
  const closers = e.equipo.filter((m) => m.rol === "closer" && m.activo).map((m) => m.nombre);
  const puedeGuardar = Boolean(b.dia) && (deCalendly || Boolean(b.nombre.trim())) && mailOk && cashOk;

  return (
    <ModalForm
      abierto onCerrar={onCerrar} titulo={resell ? "Editar la agenda" : "Nueva agenda de resell"} ancho puedeGuardar={puedeGuardar}
      sub={deCalendly ? "Agendó por Calendly: la fecha, el nombre, el mail, el teléfono y el closer vienen de ahí y cambian si reprograma." : "Cargada a mano."}
      onGuardar={() => {
        const fechaHora = deCalendly ? r0!.fechaHora : new Date(`${b.dia}T${/^\d{1,2}:\d{2}$/.test(b.hora) ? b.hora.padStart(5, "0") : "12:00"}:00-03:00`).toISOString();
        acciones.guardarResell({
          ...(r0 ?? {}),
          id: r0?.id ?? nuevoId("rs"), sesionId: r0?.sesionId ?? null, fechaHora,
          nombre: deCalendly ? r0!.nombre : b.nombre.trim(), email: deCalendly ? r0!.email : b.email.trim(),
          telefono: deCalendly ? r0!.telefono : b.telefono.trim(), closer: deCalendly ? r0!.closer : b.closer.trim(),
          estado: b.estado, cashCollect: cash, casoDeExito: b.caso, notas: b.notas, cancelada: r0?.cancelada ?? false,
          origen: r0?.origen ?? "manual", creadoEn: r0?.creadoEn ?? new Date().toISOString(),
        } as Resell);
        toast(resell ? "Agenda actualizada." : "Agenda cargada.");
        onCerrar();
      }}
    >
      <div className="form-grid">
        <Field label="Fecha de la agenda"><Input type="date" value={b.dia} onChange={(ev) => set("dia", ev.target.value)} disabled={deCalendly} /></Field>
        <Field label="Hora (Argentina)"><Input type="time" value={b.hora} onChange={(ev) => set("hora", ev.target.value)} disabled={deCalendly} /></Field>
        <Field label="Nombre completo" span2><Input value={b.nombre} onChange={(ev) => set("nombre", ev.target.value)} disabled={deCalendly} /></Field>
        <Field label="Mail" error={mailOk ? undefined : "Ese mail no parece válido."}><Input type="email" value={b.email} onChange={(ev) => set("email", ev.target.value)} disabled={deCalendly} error={!mailOk} /></Field>
        <Field label="Teléfono"><Input value={b.telefono} onChange={(ev) => set("telefono", ev.target.value)} disabled={deCalendly} /></Field>
        <Field label="Closer">
          <Input value={b.closer} onChange={(ev) => set("closer", ev.target.value)} disabled={deCalendly} list="cs-resell-closers" />
          <datalist id="cs-resell-closers">{closers.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Estado" ayuda="Renueva, no renueva…">
          <Select value={b.estado} aria-label="Estado" placeholder="Sin definir (agendada)" opciones={b.estado && !listas.estadosResell.includes(b.estado) ? [b.estado, ...listas.estadosResell] : listas.estadosResell} onChange={(ev) => set("estado", ev.target.value)} />
        </Field>
        <Field label="Cash Collect (USD)" error={cashOk ? undefined : "Un monto, por ejemplo 1200."}>
          <Input value={b.cash} onChange={(ev) => set("cash", ev.target.value)} placeholder="0" error={!cashOk} />
        </Field>
        <Field label="Caso de éxito">
          <label className="row" style={{ gap: 8, cursor: "pointer" }}><input type="checkbox" checked={b.caso} onChange={(ev) => set("caso", ev.target.checked)} /><span>Sí, es un caso de éxito</span></label>
        </Field>
        <Field label="Notas" span2><Textarea rows={3} value={b.notas} onChange={(ev) => set("notas", ev.target.value)} /></Field>
      </div>
    </ModalForm>
  );
}
