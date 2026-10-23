"use client";

import React, { useMemo, useRef, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import { Chip, Field, Switch, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
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
   le deja el aviso a cada uno (supabase/avisos.sql). */

type Pendiente = { clave: string; nombre: string; estado: "subiendo" | "listo" | "error"; adjunto?: Adjunto; error?: string };

export function NotaDeCharla({ e, contactoId, nombre, puedeContactar, onContacte, onCerrar }: {
  e: EstadoApp; contactoId: string; nombre: string; puedeContactar: boolean; onContacte: () => void; onCerrar: () => void;
}) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const [tipo, setTipo] = useState<TipoDeNota>("Charla");
  const [texto, setTexto] = useState("");
  const [avisarA, setAvisarA] = useState<string[]>([]);
  const [contacte, setContacte] = useState(puedeContactar);
  const [archivos, setArchivos] = useState<Pendiente[]>([]);
  const elegir = useRef<HTMLInputElement>(null);
  const yoMail = (yo.email ?? "").toLowerCase();
  const equipo = useMemo(() => e.equipo
    .filter((m) => m.activo !== false && m.nombre?.trim() && m.email?.includes("@") && m.email.toLowerCase() !== yoMail)
    .map((m) => m.nombre.trim())
    .sort((a, b) => a.localeCompare(b, "es")), [e.equipo, yoMail]);

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
  const hayAlgo = texto.trim() !== "" || listos.length > 0;

  const guardar = () => {
    if (!hayAlgo || subiendo) return;
    acciones.comentar(contactoId, textoDeNota(tipo, texto, avisarA), yo.nombre, yo.email ?? undefined, listos);
    if (contacte) onContacte();
    toast(avisarA.length ? `Listo: la charla quedó en el chat y le avisamos a ${avisarA.join(", ")}.` : "Listo: la charla quedó en el chat de la ficha.");
    onCerrar();
  };

  return (
    <ModalForm abierto onCerrar={cancelar} titulo={`Anotar la charla con ${nombre}`}
      sub="Queda en el chat de la ficha, para que el equipo la vea. Si avisás a alguien, le llega a su campanita."
      guardarTexto={subiendo ? "Subiendo…" : "Guardar"} puedeGuardar={hayAlgo && !subiendo} onGuardar={guardar}>
      <div className="stack-3">
        <div className="nota-charla__chips" role="radiogroup" aria-label="Qué fue">
          {TIPOS_DE_NOTA.map((t) => <Chip key={t} activo={tipo === t} onClick={() => setTipo(t)}>{t}</Chip>)}
        </div>
        <Field label="¿Qué hablaron?">
          <Textarea rows={4} value={texto} onChange={(ev) => setTexto(ev.target.value)} autoFocus
            placeholder="Una línea alcanza: qué pidió, de qué se quejó, qué agradeció…" aria-label="Qué hablaron" />
        </Field>
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
        {equipo.length > 0 && (
          <Field label="Avisarle a" ayuda="Le llega a su campanita, con el link a esta ficha.">
            <div className="nota-charla__chips">
              {equipo.map((n) => (
                <Chip key={n} activo={avisarA.includes(n)} onClick={() => setAvisarA((xs) => (xs.includes(n) ? xs.filter((x) => x !== n) : [...xs, n]))}>{n}</Chip>
              ))}
            </div>
          </Field>
        )}
        {puedeContactar && (
          <div className="devol-opcion">
            <div>
              <div className="t-strong">Marcar que lo contacté hoy</div>
              <div className="t-sm t-subtle">Como «Lo contacté»: el próximo contacto se corre según su cadencia.</div>
            </div>
            <Switch checked={contacte} onChange={setContacte} etiqueta="Marcar que lo contacté hoy" />
          </div>
        )}
      </div>
    </ModalForm>
  );
}
