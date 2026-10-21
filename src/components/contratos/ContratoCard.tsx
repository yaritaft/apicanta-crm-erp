"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Ban, CalendarPlus, ChevronDown, ChevronRight, Copy, Eye, FileDown, FileSignature, KeyRound, Link2, Mail, PartyPopper, Pencil,
  PenLine, RefreshCw, Send,
} from "lucide-react";
import { Badge, Button, Switch, type VarianteBadge } from "@/components/ui/ui";
import { Confirmar, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { fechaHora, relativo } from "@/lib/format";
import {
  accionesDe, estaPendiente, fechaContrato, problemaDeDatos, ROTULO_ESTADO, ROTULO_EVENTO,
  type Contrato, type DatosContrato, type EventoContrato,
} from "@/lib/contratos";
import { programasDe } from "@/lib/programas";
import type { Venta } from "@/lib/types";
import { abrirPdf, contratosPrendidos, datosDeVenta, leerContratos, pedirContrato } from "./cliente";
import { DatosDelContrato } from "./DatosDelContrato";
import { AccionesServicio, BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";

/* ==================================================================
   El contrato de una venta (o de un servicio), como el ContratoCard de
   Blue OS: el estado (enviado, lo abrió, firmado…), el historial con
   fecha y quién, el link para copiar y mandarle por WhatsApp, y los
   botones que corresponden a ese estado — nunca uno que PandaDoc va a
   negar (un firmado no se anula ni se reenvía).
   Se lee directo de la base y, mientras espera algo de PandaDoc, se
   vuelve a leer sola cada 15 segundos.
   Dos formas: «tarjeta» (en la venta) y «hoja» (la solapa Contrato de la
   ficha → Servicio, con las mismas filas que el resto de la hoja).
   ================================================================== */

const VARIANTE: Record<string, VarianteBadge> = { neutral: "neutral", info: "info", warning: "warning", success: "success", danger: "danger" };
const REFRESCO_MS = 15_000;

interface Edicion { tipo: "crear" | "corregir"; contrato?: Contrato; datos: DatosContrato; programaId: string; prueba: boolean }

/* El ícono de cada paso del historial. */
const ICONO_EVENTO: Record<string, React.ReactNode> = {
  creado: <FileSignature size={15} />, enviado: <Send size={15} />, visto: <Eye size={15} />, firmado: <PenLine size={15} />,
  rechazado: <Ban size={15} />, anulado: <Ban size={15} />, reenviado: <Send size={15} />, corregido: <Pencil size={15} />,
  enlace: <Link2 size={15} />, accesos: <KeyRound size={15} />, error: <AlertTriangle size={15} />,
};

export function ContratoCard({ venta, alumnoId, sesionId, manual, forma = "tarjeta" }: {
  venta?: Venta; alumnoId?: string; sesionId?: string; forma?: "tarjeta" | "hoja";
  /* Lo marcado a mano en la ficha (Airtable: firmado / pendiente y su estado), con su editor: se ve mientras la app
     no tenga un contrato de esta venta. Lo pasa la vista Servicio. */
  manual?: React.ReactNode;
}) {
  const e = useEstado();
  const toast = useToast();
  const { esDueno } = useAcceso();
  const config = e.ajustes.contratos;
  const prendidos = contratosPrendidos(config, esDueno);
  const programas = useMemo(() => programasDe(e.ajustes), [e.ajustes]);
  const ventaId = venta?.id;

  const [contratos, setContratos] = useState<Contrato[] | null>(null);
  const [eventos, setEventos] = useState<EventoContrato[]>([]);
  const [faltaTabla, setFaltaTabla] = useState(false);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [edicion, setEdicion] = useState<Edicion | null>(null);
  const [anular, setAnular] = useState<Contrato | null>(null);
  const [historial, setHistorial] = useState<string | null>(null);

  const leer = useCallback(async () => {
    if (!ventaId && !alumnoId) return;
    const r = await leerContratos({ ventaId, alumnoId });
    setFaltaTabla(Boolean(r.faltaTabla));
    setContratos(r.contratos);
    setEventos(r.eventos);
  }, [ventaId, alumnoId]);
  /* Se lee siempre: el estado del contrato se ve aunque los contratos todavía estén apagados (sin botones). */
  useEffect(() => { void leer(); }, [leer]);

  /* Al ver un contrato firmado, la ficha del alumno se trae de nuevo: el servidor le cargó el inicio, el programa, las
     sesiones y los accesos (una vez por contrato). */
  const fichasTraidas = useRef(new Set<string>());
  useEffect(() => {
    if (!alumnoId) return;
    for (const c of contratos ?? []) {
      if (c.estado !== "firmado" || fichasTraidas.current.has(c.id)) continue;
      fichasTraidas.current.add(c.id);
      void acciones.traerFichaDe(alumnoId);
    }
  }, [contratos, alumnoId]);

  /* Mientras alguno espera algo de PandaDoc, se vuelve a leer solo. */
  const hayPendiente = (contratos ?? []).some((c) => estaPendiente(c.estado));
  useEffect(() => {
    if (!hayPendiente) return;
    const t = window.setInterval(() => { if (!document.hidden) void leer(); }, REFRESCO_MS);
    return () => window.clearInterval(t);
  }, [hayPendiente, leer]);

  if (!ventaId && !alumnoId) return null;
  /* Apagados y sin nada que mostrar: no ocupa lugar. */
  if (!prendidos && !manual && (contratos === null || contratos.length === 0)) return null;

  const modoPrueba = (config?.estado ?? "apagado") === "prueba";

  function abrirNuevo(base?: Contrato) {
    if (!venta) { toast("El contrato se manda desde la venta.", "err"); return; }
    const d = datosDeVenta(e, venta);
    setEdicion({
      tipo: "crear",
      datos: base?.datos ? { ...d.datos, ...(base.datos as Partial<DatosContrato>), fecha: d.datos.fecha } : d.datos,
      programaId: base?.programa ?? d.programa?.id ?? "",
      prueba: modoPrueba,
    });
  }

  async function hacer(c: Contrato, accion: string, extra: Record<string, unknown> = {}, ok?: string) {
    setTrabajando(`${c.id}:${accion}`);
    try {
      await pedirContrato({ accion, id: c.id, ...extra });
      if (ok) toast(ok);
      await leer();
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); await leer(); }
    setTrabajando(null);
  }

  async function copiarEnlace(c: Contrato) {
    let enlace = c.enlace;
    const vencido = c.enlaceVence ? new Date(c.enlaceVence).getTime() < Date.now() + 60_000 : false;
    if (!enlace || vencido) {
      setTrabajando(`${c.id}:enlace`);
      try { enlace = (await pedirContrato({ accion: "enlace", id: c.id })).enlace; await leer(); }
      catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
      setTrabajando(null);
    }
    if (!enlace) return;
    try { await navigator.clipboard.writeText(enlace); toast("Link para firmar copiado: mandáselo por WhatsApp."); }
    catch { window.prompt("Copiá el link para firmar:", enlace); }
  }

  async function guardarEdicion() {
    if (!edicion) return;
    const modo = edicion.prueba ? "prueba" : "produccion";
    const problema = !edicion.programaId ? "Elegí el programa." : problemaDeDatos(edicion.datos, edicion.contrato?.modo ?? modo);
    if (problema) { toast(problema, "err"); return; }
    setTrabajando("edicion");
    try {
      if (edicion.tipo === "corregir" && edicion.contrato) {
        await pedirContrato({ accion: "corregir", id: edicion.contrato.id, datos: edicion.datos });
        toast("Contrato corregido y mandado de nuevo.");
      } else {
        await pedirContrato({
          accion: "crear", ventaId, sesionId, leadId: venta?.contactoId, alumnoId,
          programa: edicion.programaId, datos: edicion.datos, prueba: edicion.prueba,
        });
        toast(`Contrato mandado a ${edicion.datos.email}.`);
      }
      setEdicion(null);
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
    await leer();
  }

  const modales = (
    <>
      {edicion && (
        <ModalForm
          abierto onCerrar={() => setEdicion(null)} onGuardar={() => void guardarEdicion()} ancho
          titulo={edicion.tipo === "corregir" ? "Corregir y mandar de nuevo" : "Mandar contrato"}
          sub={edicion.tipo === "corregir"
            ? "El contrato vuelve a borrador en PandaDoc, se cambian los datos y le llega de nuevo para firmar."
            : "Se arma con la plantilla del programa y le llega por mail para firmar."}
          guardarTexto={trabajando === "edicion" ? "Mandando…" : edicion.tipo === "corregir" ? "Corregir y mandar" : "Mandar contrato"}
          puedeGuardar={trabajando !== "edicion"}
        >
          <DatosDelContrato
            datos={edicion.datos} programas={programas} programaId={edicion.programaId}
            bloquearPrograma={edicion.tipo === "corregir"}
            onPrograma={(id) => setEdicion({ ...edicion, programaId: id })}
            onCambio={(c) => setEdicion({ ...edicion, datos: { ...edicion.datos, ...c } })}
          />
          {edicion.tipo === "crear" && esDueno && !modoPrueba && (
            <div className="row-wrap" style={{ gap: 8, marginTop: 12 }}>
              <Switch checked={edicion.prueba} onChange={(v) => setEdicion({ ...edicion, prueba: v })} etiqueta="Mandar como prueba" />
              <span className="t-sm t-muted">Mandar como prueba (sandbox: sólo a mails @apicanta.com, con marca de agua)</span>
            </div>
          )}
          {(edicion.prueba || modoPrueba) && edicion.tipo === "crear" && (
            <p className="t-sm t-subtle" style={{ marginTop: 8 }}>Es un contrato de prueba: sólo puede ir a un mail @apicanta.com.</p>
          )}
        </ModalForm>
      )}
      <Confirmar
        abierto={anular !== null} onCerrar={() => setAnular(null)} confirmarTexto="Anular"
        titulo="¿Anular el contrato?"
        texto="Queda vencido en PandaDoc y el link deja de servir. Si hace falta, después se manda uno nuevo."
        onConfirmar={() => { if (anular) void hacer(anular, "anular", { motivo: "Anulado desde Apicanta" }, "Contrato anulado."); }}
      />
    </>
  );

  async function verPdf(c: Contrato) {
    setTrabajando(`${c.id}:pdf`);
    try { await abrirPdf(c.id); } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); }
    setTrabajando(null);
  }
  async function copiarBienvenida(c: Contrato) {
    const url = `${window.location.origin}/bienvenida/${c.bienvenida}`;
    try { await navigator.clipboard.writeText(url); toast("Link de su página de bienvenida copiado: ahí ve sus accesos."); }
    catch { window.prompt("Copiá el link de su página de bienvenida:", url); }
  }

  /* ---------- La solapa Contrato de la ficha → Servicio: las mismas filas que el resto de la hoja ---------- */
  if (forma === "hoja") {
    const lista = contratos ?? [];
    const puedeMandar = prendidos && lista.length === 0 && contratos !== null && !faltaTabla && venta?.estado === "activa";
    const todavia = <span className="hs-guion">Todavía no</span>;
    return (
      <>
        {puedeMandar && (
          <AccionesServicio>
            <Button sm variante="primary" icono={<FileSignature size={14} />} onClick={() => abrirNuevo()}>Mandar contrato</Button>
          </AccionesServicio>
        )}
        {faltaTabla ? (
          <BloqueServicio><p className="hs-nada">Falta correr supabase/contratos-y-accesos.sql en la base.</p></BloqueServicio>
        ) : contratos === null ? (
          <div className="skeleton" style={{ height: 132, borderRadius: 12 }} />
        ) : lista.length === 0 ? (
          <>
            <BloqueServicio titulo="Contrato de PandaDoc">
              <p className="hs-nada">{venta ? "Todavía no se le mandó contrato desde la app." : "Sin contrato en la app."}</p>
            </BloqueServicio>
            {manual && <BloqueServicio titulo="Marcado a mano">{manual}</BloqueServicio>}
          </>
        ) : lista.map((c) => {
          const r = ROTULO_ESTADO[c.estado];
          const acciones = prendidos ? accionesDe(c) : accionesDe(c).filter((a) => a === "ver-pdf");
          const evs = eventos.filter((x) => x.contratoId === c.id);
          const ocupado = (a: string) => trabajando === `${c.id}:${a}`;
          const nombrePrograma = programas.find((p) => p.id === c.programa)?.nombre ?? c.plantillaNombre;
          const inicio = typeof c.datos.inicio === "string" ? fechaContrato(c.datos.inicio) : "";
          const conBienvenida = c.bienvenida && (c.estado === "firmado" || c.estado === "enviado" || c.estado === "visto");
          const botones = [
            acciones.includes("mandar") && <Button key="mandar" sm variante="secondary" icono={<Send size={14} />} cargando={ocupado("mandar")} onClick={() => void hacer(c, "mandar", {}, "Contrato mandado.")}>Mandar</Button>,
            acciones.includes("reenviar") && <Button key="reenviar" sm variante="secondary" icono={<Send size={14} />} cargando={ocupado("reenviar")} onClick={() => void hacer(c, "reenviar", {}, "Se le volvió a mandar el mail para firmar.")}>Reenviar</Button>,
            acciones.includes("corregir") && (
              <Button key="corregir" sm variante="ghost" icono={<Pencil size={14} />}
                onClick={() => setEdicion({ tipo: "corregir", contrato: c, datos: { ...(datosDeVenta(e, venta ?? ({ id: "", contactoNombre: "", moneda: "USD" } as Venta)).datos), ...(c.datos as Partial<DatosContrato>) }, programaId: c.programa, prueba: c.modo === "prueba" })}>
                Corregir
              </Button>
            ),
            acciones.includes("mandar-otro") && venta?.estado === "activa" && <Button key="otro" sm variante="secondary" icono={<FileSignature size={14} />} onClick={() => abrirNuevo(c)}>Mandar uno nuevo</Button>,
            acciones.includes("anular") && <Button key="anular" sm variante="ghost" icono={<Ban size={14} />} cargando={ocupado("anular")} onClick={() => setAnular(c)}>Anular</Button>,
            acciones.includes("sincronizar") && <Button key="sinc" sm variante="ghost" icono={<RefreshCw size={14} />} cargando={ocupado("sincronizar")} onClick={() => void hacer(c, "sincronizar")}>Actualizar</Button>,
          ].filter(Boolean);
          return (
            <React.Fragment key={c.id}>
              {botones.length > 0 && <AccionesServicio>{botones}</AccionesServicio>}
              <BloqueServicio titulo={`Contrato de ${nombrePrograma}`}>
                <FilaServicio icono={<FileSignature size={15} />} rotulo="Estado" detalle={c.origen === "pandadoc" ? "Mandado a mano desde PandaDoc" : undefined}>
                  <Badge variante={VARIANTE[r.tono]}>{r.texto}</Badge>
                  {c.modo === "prueba" && <Badge variante="neutral">Prueba</Badge>}
                </FilaServicio>
                <FilaServicio icono={<Mail size={15} />} rotulo="Se mandó a" detalle={c.destinatario.nombre}>{c.destinatario.email ?? "—"}</FilaServicio>
                <FilaServicio icono={<Send size={15} />} rotulo="Enviado">{c.enviadoEn ? fechaHora(c.enviadoEn) : todavia}</FilaServicio>
                <FilaServicio icono={<Eye size={15} />} rotulo="Lo abrió">{c.vistoEn ? fechaHora(c.vistoEn) : todavia}</FilaServicio>
                <FilaServicio icono={<PenLine size={15} />} rotulo="Firmado">{c.firmadoEn ? fechaHora(c.firmadoEn) : todavia}</FilaServicio>
                {c.estado === "anulado" && c.anuladoEn && <FilaServicio icono={<Ban size={15} />} rotulo="Anulado">{fechaHora(c.anuladoEn)}</FilaServicio>}
                {inicio && <FilaServicio icono={<CalendarPlus size={15} />} rotulo="Inicio del servicio">{inicio}</FilaServicio>}
                <FilaServicio icono={<KeyRound size={15} />} rotulo="Accesos">
                  {c.accesosEn ? <Badge variante="success">Se dieron el {fechaHora(c.accesosEn)}</Badge>
                    : c.estado === "firmado" ? <Badge variante="warning">Preparándose</Badge>
                    : <span className="hs-guion">Se dan solos al firmar</span>}
                </FilaServicio>
                {acciones.includes("copiar-enlace") && (
                  <FilaServicio icono={<Link2 size={15} />} rotulo="Link para firmar" detalle="Para mandárselo por WhatsApp">
                    <Button sm variante="ghost" icono={<Copy size={14} />} cargando={ocupado("enlace")} onClick={() => void copiarEnlace(c)}>Copiar link</Button>
                  </FilaServicio>
                )}
                {acciones.includes("ver-pdf") && (
                  <FilaServicio icono={<FileDown size={15} />} rotulo="PDF firmado">
                    <Button sm variante="ghost" icono={<FileDown size={14} />} cargando={ocupado("pdf")} onClick={() => void verPdf(c)}>Ver PDF</Button>
                  </FilaServicio>
                )}
                {conBienvenida && (
                  <FilaServicio icono={<PartyPopper size={15} />} rotulo="Página de bienvenida" detalle="Adonde llega al firmar, con sus accesos">
                    <Button sm variante="ghost" icono={<Copy size={14} />} onClick={() => void copiarBienvenida(c)}>Copiar link</Button>
                  </FilaServicio>
                )}
                {c.error && c.estado === "error" && (
                  <FilaServicio icono={<AlertTriangle size={15} />} rotulo="No salió"><span style={{ color: "var(--danger)" }}>{c.error}</span></FilaServicio>
                )}
              </BloqueServicio>
              {evs.length > 0 && (
                <BloqueServicio titulo="Historial del contrato">
                  {[...evs].reverse().map((ev) => {
                    const detalle = [
                      ev.quien,
                      ev.evento === "accesos" && typeof ev.detalle?.dados === "number" ? `${String(ev.detalle.dados)} dados${Number(ev.detalle.fallaron) ? `, ${String(ev.detalle.fallaron)} con error` : ""}` : "",
                      typeof ev.detalle?.motivo === "string" ? ev.detalle.motivo : "",
                    ].filter(Boolean).join(" · ");
                    return (
                      <FilaServicio key={ev.id} icono={ICONO_EVENTO[ev.evento] ?? <FileSignature size={15} />} rotulo={ROTULO_EVENTO[ev.evento] ?? ev.evento} detalle={detalle || undefined}>
                        {typeof ev.detalle?.error === "string" ? <span style={{ color: "var(--danger)" }}>{ev.detalle.error}</span> : <span className="hs-guion">{fechaHora(ev.cuando)}</span>}
                      </FilaServicio>
                    );
                  })}
                </BloqueServicio>
              )}
            </React.Fragment>
          );
        })}
        {modales}
      </>
    );
  }

  const lista = contratos ?? [];
  return (
    <div className="stack-2" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 4 }}>
      <div className="row-wrap" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="t-label">Contrato</span>
        {prendidos && lista.length === 0 && contratos !== null && !faltaTabla && venta?.estado === "activa" && (
          <Button sm variante="secondary" icono={<FileSignature size={14} />} onClick={() => abrirNuevo()}>Mandar contrato</Button>
        )}
      </div>
      {faltaTabla ? (
        <p className="t-sm t-subtle">Falta correr supabase/contratos-y-accesos.sql en la base.</p>
      ) : contratos === null ? (
        <div className="skeleton" style={{ height: 36 }} />
      ) : lista.length === 0 ? (
        manual ?? <p className="t-sm t-subtle">{venta ? "Todavía no se le mandó contrato desde la app." : "Sin contrato en la app."}</p>
      ) : lista.map((c) => {
        const r = ROTULO_ESTADO[c.estado];
        /* Apagados, sólo se puede ver el PDF firmado. */
        const acciones = prendidos ? accionesDe(c) : accionesDe(c).filter((a) => a === "ver-pdf");
        const evs = eventos.filter((x) => x.contratoId === c.id);
        const ocupado = (a: string) => trabajando === `${c.id}:${a}`;
        const nombrePrograma = programas.find((p) => p.id === c.programa)?.nombre ?? c.plantillaNombre;
        return (
          <div key={c.id} className="stack-1">
            <div className="row-wrap" style={{ gap: 8 }}>
              <span className="t-strong">{nombrePrograma}</span>
              <Badge variante={VARIANTE[r.tono]}>{r.texto}</Badge>
              {c.modo === "prueba" && <Badge variante="neutral">Prueba</Badge>}
              {c.origen === "pandadoc" && <span className="t-sm t-subtle">mandado desde PandaDoc</span>}
            </div>
            <span className="t-sm t-muted">
              {[
                c.destinatario.email && `a ${c.destinatario.email}`,
                c.enviadoEn && `enviado ${relativo(c.enviadoEn)}`,
                c.vistoEn && c.estado !== "firmado" && `lo abrió ${relativo(c.vistoEn)}`,
                c.firmadoEn && `firmado el ${fechaHora(c.firmadoEn)}`,
                c.anuladoEn && c.estado === "anulado" && `anulado ${relativo(c.anuladoEn)}`,
              ].filter(Boolean).join(" · ")}
            </span>
            {c.error && c.estado === "error" && <span className="t-sm" style={{ color: "var(--danger)" }}>{c.error}</span>}
            {c.estado === "firmado" && c.accesosEn && <span className="t-sm" style={{ color: "var(--success)" }}>Accesos disparados {relativo(c.accesosEn)}.</span>}

            {acciones.length > 0 && (
              <div className="row-wrap" style={{ gap: 6 }}>
                {acciones.includes("copiar-enlace") && (
                  <Button sm variante="secondary" icono={<Copy size={14} />} cargando={ocupado("enlace")} onClick={() => void copiarEnlace(c)}>Copiar link</Button>
                )}
                {acciones.includes("mandar") && (
                  <Button sm variante="secondary" icono={<Send size={14} />} cargando={ocupado("mandar")} onClick={() => void hacer(c, "mandar", {}, "Contrato mandado.")}>Mandar</Button>
                )}
                {acciones.includes("reenviar") && (
                  <Button sm variante="ghost" icono={<Send size={14} />} cargando={ocupado("reenviar")} onClick={() => void hacer(c, "reenviar", {}, "Se le volvió a mandar el mail para firmar.")}>Reenviar</Button>
                )}
                {acciones.includes("corregir") && (
                  <Button sm variante="ghost" icono={<Pencil size={14} />}
                    onClick={() => setEdicion({ tipo: "corregir", contrato: c, datos: { ...(datosDeVenta(e, venta ?? ({ id: "", contactoNombre: "", moneda: "USD" } as Venta)).datos), ...(c.datos as Partial<DatosContrato>) }, programaId: c.programa, prueba: c.modo === "prueba" })}>
                    Corregir
                  </Button>
                )}
                {acciones.includes("ver-pdf") && (
                  <Button sm variante="secondary" icono={<FileDown size={14} />} cargando={ocupado("pdf")}
                    onClick={async () => { setTrabajando(`${c.id}:pdf`); try { await abrirPdf(c.id); } catch (err) { toast(err instanceof Error ? err.message : "No se pudo.", "err"); } setTrabajando(null); }}>
                    Ver PDF firmado
                  </Button>
                )}
                {c.bienvenida && (c.estado === "firmado" || c.estado === "enviado" || c.estado === "visto") && (
                  <Button sm variante="ghost" icono={<PartyPopper size={14} />} onClick={async () => {
                    const url = `${window.location.origin}/bienvenida/${c.bienvenida}`;
                    try { await navigator.clipboard.writeText(url); toast("Link de su página de bienvenida copiado: ahí ve sus accesos."); }
                    catch { window.prompt("Copiá el link de su página de bienvenida:", url); }
                  }}>Copiar página de bienvenida</Button>
                )}
                {acciones.includes("mandar-otro") && venta?.estado === "activa" && (
                  <Button sm variante="secondary" icono={<FileSignature size={14} />} onClick={() => abrirNuevo(c)}>Mandar uno nuevo</Button>
                )}
                {acciones.includes("anular") && (
                  <Button sm variante="ghost" icono={<Ban size={14} />} cargando={ocupado("anular")} onClick={() => setAnular(c)}>Anular</Button>
                )}
                {acciones.includes("sincronizar") && (
                  <Button sm variante="ghost" icono={<RefreshCw size={14} />} cargando={ocupado("sincronizar")} onClick={() => void hacer(c, "sincronizar")}>Actualizar</Button>
                )}
              </div>
            )}

            {evs.length > 0 && (
              <div>
                <button type="button" className="t-sm t-subtle row-wrap" style={{ gap: 4, background: "none", border: 0, padding: 0, cursor: "pointer" }}
                  aria-expanded={historial === c.id} onClick={() => setHistorial(historial === c.id ? null : c.id)}>
                  {historial === c.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Historial ({evs.length})
                </button>
                {historial === c.id && (
                  <ul className="stack-1" style={{ listStyle: "none", margin: "6px 0 0", padding: "0 0 0 18px" }}>
                    {[...evs].reverse().map((ev) => (
                      <li key={ev.id} className="t-sm">
                        <span>{ROTULO_EVENTO[ev.evento] ?? ev.evento}</span>
                        <span className="t-subtle"> · {fechaHora(ev.cuando)}{ev.quien ? ` · ${ev.quien}` : ""}</span>
                        {typeof ev.detalle?.error === "string" && <span style={{ color: "var(--danger)" }}> · {ev.detalle.error}</span>}
                        {typeof ev.detalle?.motivo === "string" && ev.detalle.motivo && <span className="t-subtle"> · {ev.detalle.motivo}</span>}
                        {ev.evento === "accesos" && typeof ev.detalle?.dados === "number" && (
                          <span className="t-subtle"> · {String(ev.detalle.dados)} dados{Number(ev.detalle.fallaron) ? `, ${String(ev.detalle.fallaron)} con error` : ""}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {modales}
    </div>
  );
}
