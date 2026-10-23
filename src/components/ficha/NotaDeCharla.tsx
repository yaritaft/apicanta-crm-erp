"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Check, CornerDownLeft, FileText, Loader2, Paperclip, X } from "lucide-react";
import { Button, IconButton, Select, Textarea } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { ADJUNTOS_POR_MENSAJE, descartarAdjunto, problemaDeAdjunto, subirAdjunto } from "@/lib/adjuntos-chat";
import { textoDeNota, TIPOS_DE_NOTA, type TipoDeNota } from "@/lib/nota-de-charla";
import type { Adjunto, EstadoApp } from "@/lib/types";
import "./nota-charla.css";

/* «Anotar la charla» al lado de «Lo contacté» (Lili, 23/10): lo que hablaron en el seguimiento —una queja, una
   sugerencia, un agradecimiento—, con fotos o videos si hace falta, y a quién del equipo avisarle («un agradecimiento a
   Yari, algo del CV a Aldi, un reclamo del sistema a Manu»). Queda en el chat de la ficha con las menciones, y la base
   le deja el aviso a cada uno (supabase/avisos.sql).

   Tipo Typeform, como el asistente de ventas (Juan Cruz, 23/10): una pregunta por pantalla, los números eligen la
   opción, Enter sigue (en el texto, Cmd/Ctrl + Enter) y a quién avisarle se elige en un desplegable, como el vendedor. */

type Pendiente = { clave: string; nombre: string; estado: "subiendo" | "listo" | "error"; adjunto?: Adjunto; error?: string };
type PasoId = "tipo" | "texto" | "avisar" | "contacto";

const SUB_DE_TIPO: Record<TipoDeNota, string> = {
  Charla: "Lo que hablaron en el seguimiento",
  Queja: "Algo que no le gustó o no le anduvo",
  Sugerencia: "Una idea para mejorar",
  Agradecimiento: "Algo que le encantó",
  Otro: "Cualquier otra cosa",
};

function Opcion({ tecla, nombre, sub, activo, onClick }: { tecla: string; nombre: string; sub?: string; activo: boolean; onClick: () => void }) {
  return (
    <button type="button" className="opcion" aria-pressed={activo} onClick={onClick}>
      <span className="opcion__tecla">{tecla}</span>
      <span className="opcion__texto">
        <span className="opcion__nombre">{nombre}</span>
        {sub && <span className="opcion__sub">{sub}</span>}
      </span>
      {activo && <Check size={16} style={{ marginLeft: "auto", color: "var(--brand)" }} />}
    </button>
  );
}

export function NotaDeCharla({ e, contactoId, nombre, puedeContactar, onContacte, onCerrar }: {
  e: EstadoApp; contactoId: string; nombre: string; puedeContactar: boolean; onContacte: () => void; onCerrar: () => void;
}) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const [tipo, setTipo] = useState<TipoDeNota | null>(null);
  const [texto, setTexto] = useState("");
  const [avisarA, setAvisarA] = useState<string[]>([]);
  const [contacte, setContacte] = useState(puedeContactar);
  const [archivos, setArchivos] = useState<Pendiente[]>([]);
  const [i, setI] = useState(0);
  const elegir = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const primero = nombre.split(" ")[0] || nombre;
  const yoMail = (yo.email ?? "").toLowerCase();
  const equipo = useMemo(() => e.equipo
    .filter((m) => m.activo !== false && m.nombre?.trim() && m.email?.includes("@") && m.email.toLowerCase() !== yoMail)
    .map((m) => m.nombre.trim())
    .sort((a, b) => a.localeCompare(b, "es")), [e.equipo, yoMail]);

  const pasos: { id: PasoId; titulo: string }[] = [
    { id: "tipo", titulo: "Qué fue" },
    { id: "texto", titulo: "Qué hablaron" },
    { id: "avisar", titulo: "A quién avisarle" },
    ...(puedeContactar ? [{ id: "contacto" as const, titulo: "Contacto" }] : []),
  ];
  const paso = pasos[i];
  const ultimo = i === pasos.length - 1;

  const subir = (lista: FileList | null) => {
    for (const archivo of Array.from(lista ?? []).slice(0, ADJUNTOS_POR_MENSAJE - archivos.length)) {
      const clave = `${archivo.name}:${archivo.size}:${Math.random().toString(36).slice(2, 6)}`;
      const problema = problemaDeAdjunto(archivo);
      if (problema) { toast(problema, "err"); continue; }
      setArchivos((xs) => [...xs, { clave, nombre: archivo.name, estado: "subiendo" }]);
      subirAdjunto(archivo, contactoId).then(
        (adjunto) => setArchivos((xs) => xs.map((p) => (p.clave === clave ? { ...p, estado: "listo", adjunto } : p))),
        (err) => setArchivos((xs) => xs.map((p) => (p.clave === clave ? { ...p, estado: "error", error: err instanceof Error ? err.message : "No se pudo subir." } : p))),
      );
    }
    if (elegir.current) elegir.current.value = "";
  };
  const sacar = (p: Pendiente) => {
    if (p.adjunto) void descartarAdjunto(p.adjunto);
    setArchivos((xs) => xs.filter((x) => x.clave !== p.clave));
  };
  const cancelar = () => {
    for (const p of archivos) if (p.adjunto) void descartarAdjunto(p.adjunto);
    onCerrar();
  };

  const listos = archivos.filter((p) => p.estado === "listo" && p.adjunto).map((p) => p.adjunto as Adjunto);
  const subiendo = archivos.some((p) => p.estado === "subiendo");
  const problema = paso.id === "tipo" && !tipo ? "Elegí qué fue."
    : paso.id === "texto" && subiendo ? "Esperá que terminen de subir los archivos."
      : paso.id === "texto" && !texto.trim() && listos.length === 0 ? "Escribí qué hablaron o adjuntá algo."
        : null;
  const puedeAvanzar = problema === null;

  const guardar = () => {
    if (!tipo || subiendo || (!texto.trim() && listos.length === 0)) return;
    acciones.comentar(contactoId, textoDeNota(tipo, texto, avisarA), yo.nombre, yo.email ?? undefined, listos);
    if (puedeContactar && contacte) onContacte();
    toast(avisarA.length ? `Listo: la charla quedó en el chat y le avisamos a ${avisarA.join(", ")}.` : "Listo: la charla quedó en el chat de la ficha.");
    onCerrar();
  };
  const avanzar = () => {
    if (!puedeAvanzar) return;
    if (ultimo) guardar();
    else setI((x) => Math.min(x + 1, pasos.length - 1));
  };
  /* Elegir una opción ya contesta la pregunta: se pasa sola a la siguiente, como en Typeform. */
  const elegirTipo = (t: TipoDeNota) => { setTipo(t); window.setTimeout(() => setI((x) => (x === 0 ? 1 : x)), 220); };

  /* Teclado: Esc sale, los números eligen, Enter sigue (en el texto, Cmd/Ctrl + Enter). */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (document.querySelector(".modal-backdrop, [data-flotante-abierto]")) return;
      if (ev.key === "Escape") { ev.preventDefault(); cancelar(); return; }
      const foco = ev.target as HTMLElement | null;
      const escribiendo = foco?.tagName === "INPUT" || foco?.tagName === "TEXTAREA" || Boolean(foco?.classList?.contains("sel"));
      if (!escribiendo && /^[1-9]$/.test(ev.key)) {
        const opcion = mainRef.current?.querySelectorAll<HTMLButtonElement>(".opcion")[Number(ev.key) - 1];
        if (opcion) { ev.preventDefault(); opcion.click(); return; }
      }
      if (ev.key !== "Enter" || ev.shiftKey) return;
      if (foco?.tagName === "TEXTAREA" && !(ev.metaKey || ev.ctrlKey)) return;
      if (foco?.tagName === "BUTTON" && !foco.classList?.contains("opcion")) return;
      ev.preventDefault();
      avanzar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  /* Foco en el primer control de cada paso. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      mainRef.current?.querySelector<HTMLElement>("textarea, .sel, .opcion[aria-pressed='true'], .opcion")?.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [i]);

  const progreso = ((i + (puedeAvanzar ? 1 : 0.35)) / pasos.length) * 100;
  const sinElegir = equipo.filter((n) => !avisarA.includes(n));

  /* Al body, como pantalla completa encima de la ficha: así ningún contenedor de la ficha la recorta. */
  return createPortal(
    <div className="asistente" role="dialog" aria-modal="true" aria-label={`Anotar la charla con ${nombre}`}>
      <div className="asistente__progreso"><div className="asistente__progreso-fill" style={{ width: `${progreso}%` }} /></div>

      <div className="asistente__head">
        <span className="asistente__paso-n">{i + 1} / {pasos.length}</span>
        <span className="asistente__ruta">
          {pasos.map((p, k) => (
            <React.Fragment key={p.id}>
              {k > 0 && <span className="asistente__ruta-sep">·</span>}
              <span className="asistente__ruta-item" data-activo={k === i}>{p.titulo}</span>
            </React.Fragment>
          ))}
        </span>
        <span className="spacer" />
        <IconButton etiqueta="Salir sin guardar" onClick={cancelar}><X size={18} /></IconButton>
      </div>

      <div className="asistente__main" ref={mainRef}>
        <div className="asistente__paso" key={paso.id}>
          {paso.id === "tipo" && (
            <>
              <div>
                <h2 className="asistente__pregunta">¿Qué fue la charla con {primero}?</h2>
                <p className="asistente__sub">Queda en el chat de su ficha, para que el equipo la vea.</p>
              </div>
              <div className="opciones">
                {TIPOS_DE_NOTA.map((t, k) => (
                  <Opcion key={t} tecla={String(k + 1)} nombre={t} sub={SUB_DE_TIPO[t]} activo={tipo === t} onClick={() => elegirTipo(t)} />
                ))}
              </div>
            </>
          )}

          {paso.id === "texto" && (
            <>
              <div>
                <h2 className="asistente__pregunta">¿Qué hablaron?</h2>
                <p className="asistente__sub">Una línea alcanza. Si hace falta, sumá fotos, videos o archivos.</p>
              </div>
              <Textarea rows={5} value={texto} onChange={(ev) => setTexto(ev.target.value)} aria-label="Qué hablaron"
                placeholder={tipo === "Queja" ? "De qué se quejó y qué le dijiste…" : tipo === "Agradecimiento" ? "Qué le encantó…" : "Qué pidió, qué contó, qué quedaron en hacer…"} />
              <div className="nota-charla__archivos">
                <input ref={elegir} type="file" multiple hidden accept="image/*,video/*,audio/*,application/pdf" onChange={(ev) => subir(ev.target.files)} />
                <button type="button" className="link t-sm" onClick={() => elegir.current?.click()} disabled={archivos.length >= ADJUNTOS_POR_MENSAJE}>
                  <Paperclip size={14} aria-hidden /> Adjuntar foto, video o archivo
                </button>
                {archivos.map((p) => (
                  <span key={p.clave} className={`nota-charla__archivo${p.estado === "error" ? " nota-charla__archivo--error" : ""}`} title={p.error}>
                    {p.estado === "subiendo" ? <Loader2 size={13} className="nota-charla__gira" aria-hidden /> : <FileText size={13} aria-hidden />}
                    <span className="truncate">{p.estado === "error" ? `${p.nombre}: ${p.error}` : p.nombre}</span>
                    <button type="button" onClick={() => sacar(p)} aria-label={`Sacar ${p.nombre}`}><X size={12} /></button>
                  </span>
                ))}
              </div>
            </>
          )}

          {paso.id === "avisar" && (
            <>
              <div>
                <h2 className="asistente__pregunta">¿Le avisamos a alguien del equipo?</h2>
                <p className="asistente__sub">Le llega a su campanita, con el link a esta ficha. Podés sumar a más de uno, o seguir sin avisar.</p>
              </div>
              <div className="hk-field">
                <label className="hk-label">Avisarle a</label>
                <Select value="" placeholder={avisarA.length ? "Sumar a alguien más" : "Elegí a quién avisarle"} aria-label="Avisarle a"
                  onChange={(ev) => { const n = ev.target.value; if (n) setAvisarA((xs) => (xs.includes(n) ? xs : [...xs, n])); }}
                  opciones={sinElegir} disabled={sinElegir.length === 0} />
              </div>
              {avisarA.length > 0 && (
                <div className="nota-charla__elegidos" aria-label="A quiénes se les avisa">
                  {avisarA.map((n) => (
                    <span key={n} className="nota-charla__elegido">
                      {n}
                      <button type="button" onClick={() => setAvisarA((xs) => xs.filter((x) => x !== n))} aria-label={`No avisarle a ${n}`}><X size={12} /></button>
                    </span>
                  ))}
                </div>
              )}
            </>
          )}

          {paso.id === "contacto" && (
            <>
              <div>
                <h2 className="asistente__pregunta">¿Lo marcamos como contactado hoy?</h2>
                <p className="asistente__sub">Como «Lo contacté»: el próximo contacto se corre según su cadencia.</p>
              </div>
              <div className="opciones">
                <Opcion tecla="1" nombre="Sí, lo contacté hoy" sub="Se anota la charla y el contacto" activo={contacte} onClick={() => setContacte(true)} />
                <Opcion tecla="2" nombre="No, sólo anotar la charla" sub="El próximo contacto queda como está" activo={!contacte} onClick={() => setContacte(false)} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="asistente__foot">
        {i > 0 && <Button variante="ghost" icono={<ArrowLeft size={16} />} onClick={() => setI((x) => Math.max(0, x - 1))}>Atrás</Button>}
        <span className="spacer" />
        {problema && <span className="t-sm" style={{ color: "var(--ink-subtle)" }}>{problema}</span>}
        <span className="asistente__pista">
          {paso.id === "texto" ? <><kbd>⌘</kbd><kbd>Enter</kbd></> : <kbd>Enter</kbd>}<CornerDownLeft size={13} />
        </span>
        {ultimo
          ? <Button variante="primary" icono={<Check size={16} />} onClick={guardar} disabled={!puedeAvanzar}>Guardar la charla</Button>
          : <Button variante="primary" onClick={avanzar} disabled={!puedeAvanzar}>Continuar</Button>}
      </div>
    </div>,
    document.body,
  );
}
