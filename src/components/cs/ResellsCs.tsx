"use client";

import React, { useMemo, useState } from "react";
import { ExternalLink, Pencil, Plus, RefreshCw, ShoppingBag, Trash2 } from "lucide-react";
import { Button, Field, IconButton, Input, Select, Textarea } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CeldaEditable } from "@/components/crm-tabla/CeldaEditable";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { Telefono } from "@/components/ui/Telefono";
import { paisDeTelefono } from "@/lib/crm-tabla";
import { acciones, cargarDeLaNube, hayNube, nuevoId, reiniciarCarga, useEstado, useSync } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { useUsuarioActual } from "@/lib/usuario";
import { esDelCloser } from "@/lib/eod";
import { miembroDeCloser } from "@/lib/crm";
import { AsistenteVenta } from "@/components/ventas/AsistenteVenta";
import { useSearchParams } from "next/navigation";
import { useEscribirURL } from "@/lib/useParamsURL";
import { puedeEditar } from "@/lib/permisos";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import { diaDeNegocio } from "@/lib/dia-negocio";
import {
  alternarEstadoResell, coincideResell, COLUMNAS_SUMADAS_RESELLS, esDeTestimonio, estadosDeResell, filasResells, RESULTADOS_TESTIMONIO, resellAbierto, listasCs, MOTOR_RESELLS, ORDEN_RESELLS, resellNormal, VISIBLES_RESELLS, type ClaveResell, type FilaResell,
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
/* Lo cobrado, con centavos sólo si los tiene: «US$ 1.200,50» o «US$ 1.200». */
const montoCs = (n: number) => money(n, "USD", Math.abs(n % 1) > 0.004 ? 2 : 0);
const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

/* Lo que agendó Calendly no se corrige acá: cambia si el alumno reprograma. */
const DE_CALENDLY: ClaveResell[] = ["fechaHora", "nombre", "email", "telefono", "closer"];
const EDITOR: Partial<Record<ClaveResell, "texto" | "largo" | "opciones" | "si-no">> = {
  nombre: "texto", email: "texto", telefono: "texto", closer: "texto", estado: "opciones", cash: "texto", caso: "si-no", grabacion: "texto", notas: "largo",
  testimonio: "opciones", linkTestimonio: "texto", linkPitch: "texto",
};
const esLink = (v: string) => !v || /^https?:\/\/\S+\.\S+/.test(v);

export function ResellsCs() {
  const e = useEstado();
  const toast = useToast();
  const { acceso } = useAcceso();
  const { estado: sync } = useSync();
  const puede = puedeEditar(acceso, "resells");
  const abrirFicha = useAbrirFicha();
  const hoy = hoyDelNegocio();
  const listas = useMemo(() => listasCs(e.ajustes.seguimiento), [e.ajustes.seguimiento]);
  const yo = useUsuarioActual();
  const params = useSearchParams();
  const escribirURL = useEscribirURL();
  const [vendiendo, setVendiendo] = useState<Resell | null>(null);
  /* ?por-cargar=1: sólo las abiertas: ya pasaron y todavía no tienen un resultado que las cierre (sin estado, o sólo «Seguimiento»
     o «2da Agenda»). La misma regla que el panel de Lili y Mi panel del closer (resellAbierto, lib/clientes-cs.ts). */
  const soloPorCargar = params.get("por-cargar") === "1";
  /* Un closer ve sólo sus agendas (la base ya lo recorta; acá también, para que sea igual sin nube). */
  const suyas = useMemo(() => {
    const todas = filasResells(e);
    return acceso?.soloLoSuyo && yo.miembro ? todas.filter((f) => esDelCloser({ anfitrion: f.resell.closer }, yo.miembro!.nombre, e.equipo)) : todas;
  }, [e, acceso?.soloLoSuyo, yo.miembro]);
  const porCargar = useMemo(() => suyas.filter((f) => resellAbierto(f.resell, Date.now())), [suyas]);
  const filas = soloPorCargar ? porCargar : suyas;
  /* El país de la persona, para escribir su teléfono con el «+»: el de su ficha (por mail) o, si el número ya empieza con un código de
     país (los del Airtable vienen «54 9 11…», «57 300…» sin el «+»), el de ese código. Un número corto no se adivina. */
  const paisDe = (r: Resell) => {
    const deFicha = r.email ? e.contactos.find((c) => c.email?.trim().toLowerCase() === r.email.trim().toLowerCase())?.pais : undefined;
    if (deFicha) return deFicha;
    const digitos = r.telefono.replace(/\D/g, "");
    return digitos.length >= 11 ? paisDeTelefono(`+${digitos}`) : "";
  };
  /* La persona de la agenda en el CRM (por su mail), para cargarle la venta con su comprobante. */
  const leadDe = (r: Resell) => (r.email ? e.leads.find((l) => l.email?.trim().toLowerCase() === r.email.trim().toLowerCase()) : undefined);
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
      /* Se eligen varios: cada clic suma o saca uno. */
      case "estado": { const nuevo = alternarEstadoResell(r.estado, v); return guardar(r, { estado: nuevo }, titulo, nuevo); }
      case "cash": {
        if (!v) return guardar(r, { cashCollect: null }, titulo, "");
        const n = leerMontoCs(v);
        if (n === null || n < 0) { toast("El Cash Collect tiene que ser un monto (por ejemplo 1200 o 1.200,50).", "err"); return; }
        return guardar(r, { cashCollect: n }, titulo, montoCs(n));
      }
      case "caso": return guardar(r, { casoDeExito: v === "Sí" }, titulo, v === "Sí" ? "Sí" : "No");
      case "grabacion": return guardar(r, { grabacion: v }, titulo, v ? "cargada" : "vacía");
      case "testimonio": {
        const t = (RESULTADOS_TESTIMONIO as readonly string[]).includes(v) ? (v as Resell["testimonio"]) : "";
        /* Un testimonio cargado marca la agenda como caso de éxito. */
        return guardar(r, { testimonio: t, ...(t ? { casoDeExito: true } : {}) }, titulo, t || "vacío");
      }
      case "linkTestimonio":
      case "linkPitch":
        if (!esLink(v)) { toast("El link tiene que empezar con https://", "err"); return; }
        return guardar(r, { [clave]: v } as Partial<Resell>, titulo, v ? "cargado" : "vacío");
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
      case "agendado": return r.agendadoEn ? <span className="t-num">{formatoDia(diaDeNegocio(r.agendadoEn), hoy)}</span> : NADA;
      case "estado": return <span className="cs-pastillas">{estadosDeResell(f.estado).map((x) => <Pastilla key={x} texto={x} />)}</span>;
      case "cash": return r.cashCollect === null ? NADA : <span className="t-num">{montoCs(r.cashCollect)}</span>;
      case "caso": return <Pastilla texto={r.casoDeExito ? "Sí" : "No"} tono={r.casoDeExito ? "ok" : "neutra"} />;
      case "grabacion": return f.grabacion
        ? <a className="link" href={f.grabacion} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}><ExternalLink size={13} /> Verla</a>
        : NADA;
      case "notas": return <Recorte texto={r.notas} />;
      case "testimonio": return r.testimonio ? <Pastilla texto={r.testimonio} tono={r.testimonio === "Grabó" ? "ok" : "neutra"} />
        : esDeTestimonio(r) ? <Pastilla texto="Sin cargar" /> : NADA;
      case "linkTestimonio": case "linkPitch": {
        const l = clave === "linkTestimonio" ? r.linkTestimonio : r.linkPitch;
        return l ? <a className="link" href={l} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}><ExternalLink size={13} /> Verlo</a> : NADA;
      }
      case "nombre": return <Recorte texto={r.nombre} />;
      case "email": return <Recorte texto={r.email} />;
      case "telefono": return r.telefono ? <Telefono valor={r.telefono} pais={paisDe(r)} compacto /> : NADA;
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
      case "grabacion": return f.grabacion;
      case "notas": return r.notas;
      case "testimonio": return r.testimonio ?? "";
      case "linkTestimonio": return r.linkTestimonio ?? "";
      case "linkPitch": return r.linkPitch ?? "";
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
    if (clave === "nombre" && (f.alumno || r.sesionId)) {
      /* El nombre abre su ficha: la del alumno en la solapa Testimonio (ahí están sus llamadas de resell) o, si no es alumno de la
         app, la de su llamada. El nombre se corrige con el lápiz de la agenda. */
      const nombre = r.nombre || f.alumno?.nombre || "Sin nombre";
      return (
        <button type="button" className="crm-t__abrir truncate" title={`Abrir la ficha de ${nombre}`}
          onClick={() => (f.alumno ? abrirFicha(f.alumno.id, "servicio", { hoja: "testimonio" }) : abrirFicha(r.sesionId!, "llamadas"))}>
          {nombre}
        </button>
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
        onGuardar={(v) => guardarCelda(f, clave, v)} opciones={clave === "estado" ? opciones(listas.estadosResell) : clave === "testimonio" ? opciones([...RESULTADOS_TESTIMONIO]) : undefined} vaciable multiple={clave === "estado"}
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
        filaAcciones={puede ? (f) => (
          <>
            {leadDe(f.resell) && (
              <IconButton etiqueta="Cargar la venta (con su comprobante)" onClick={() => setVendiendo(f.resell)}><ShoppingBag size={15} /></IconButton>
            )}
            {f.resell.origen !== "calendly" && <IconButton etiqueta="Borrar" onClick={() => setBorrar(f.resell)}><Trash2 size={15} /></IconButton>}
          </>
        ) : undefined}
        columnasSumadas={COLUMNAS_SUMADAS_RESELLS}
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
            {porCargar.length > 0 && (
              <Button sm variante={soloPorCargar ? "primary" : "secondary"} aria-pressed={soloPorCargar}
                title="Las que ya pasaron y todavía no tienen un resultado final: sin estado, o sólo «Seguimiento» o «2da Agenda»"
                onClick={() => escribirURL({ "por-cargar": soloPorCargar ? null : "1" })}>
                Por cerrar ({porCargar.length})
              </Button>
            )}
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
      {vendiendo && (() => {
        const lead = leadDe(vendiendo);
        return lead ? (
          <AsistenteVenta
            cliente={{ contactoId: lead.id, nombre: vendiendo.nombre || lead.nombre, email: vendiendo.email }}
            closerId={miembroDeCloser(vendiendo.closer, e.equipo)?.id}
            sesionId={vendiendo.sesionId ?? undefined}
            onCerrar={() => setVendiendo(null)}
            onListo={(_id, nombre) => { setVendiendo(null); toast(`Venta de ${nombre} registrada.`); }}
          />
        ) : null;
      })()}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Borrar esta agenda?" texto="Se borra el registro de la agenda de resells. La llamada en Calendly no se toca."
        onConfirmar={() => { if (borrar) { acciones.borrarResell(borrar.id); toast("Agenda borrada."); } }}
      />
    </>
  );
}

/* El formulario de una agenda de resell: nueva o una existente. Lo que trajo Calendly no se corrige. */
export function FormResell({ resell, onCerrar }: { resell?: Resell; onCerrar: () => void }) {
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
    caso: r0?.casoDeExito ?? false, notas: r0?.notas ?? "", grabacion: r0?.grabacion ?? "",
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
          estado: b.estado, cashCollect: cash, casoDeExito: b.caso, notas: b.notas, grabacion: b.grabacion.trim(), cancelada: r0?.cancelada ?? false,
          origen: r0?.origen ?? "manual", creadoEn: r0?.creadoEn ?? new Date().toISOString(),
          /* Una cargada a mano se agendó hoy: cuenta en los resells agendados de este mes (la base pone lo mismo). */
          ...(r0 ? {} : { agendadoEn: new Date().toISOString() }),
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
        <Field label="Estado" ayuda="Se pueden elegir varios." span2>
          <div className="row-wrap" style={{ gap: 12 }}>
            {[...estadosDeResell(b.estado).filter((x) => !listas.estadosResell.includes(x)), ...listas.estadosResell].map((x) => (
              <label key={x} className="row" style={{ gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={estadosDeResell(b.estado).includes(x)} onChange={() => set("estado", alternarEstadoResell(b.estado, x))} />
                <span>{x}</span>
              </label>
            ))}
          </div>
        </Field>
        <Field label="Grabación de la llamada" ayuda="El link (Fathom). Si la llamada vino de Calendly y Fathom la trajo, aparece sola." span2>
          <Input value={b.grabacion} onChange={(ev) => set("grabacion", ev.target.value)} placeholder="https://fathom.video/…" />
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
