"use client";

import React, { useCallback, useEffect, useRef } from "react";
import { ArrowLeft, Check, CornerDownLeft, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/ui";

/* ==================================================================
   Formulario paso a paso, a pantalla completa, como un Typeform.

   Una pregunta por pantalla: el que carga nunca ve veinte campos juntos.
   Enter avanza, Esc sale y los números 1-9 eligen la opción que tienen
   al lado. El paso lo maneja quien lo usa (`actual` + `onCambiarPaso`),
   así cada formulario valida a su manera: mientras `problema` tenga
   texto, no se avanza.

   Es el mismo formato del asistente de venta (components/ventas), con
   las mismas clases `.asistente*` de globals.css.
   ================================================================== */

export interface PasoAsistente {
  id: string;
  titulo: string;
}

export function Asistente({
  etiqueta, pasos, actual, onCambiarPaso, problema = null, problemaEsError = false,
  onCerrar, terminarTexto, onTerminar, children,
}: {
  /* Lo que lee un lector de pantalla: "Nuevo webinar" */
  etiqueta: string;
  pasos: PasoAsistente[];
  actual: number;
  onCambiarPaso: (i: number) => void;
  /* Lo que falta para seguir. null = se puede avanzar. */
  problema?: string | null;
  /* En los pasos de plata un desvío es un error; en el resto sólo falta completar algo. */
  problemaEsError?: boolean;
  onCerrar: () => void;
  terminarTexto: string;
  onTerminar: () => void;
  children: React.ReactNode;
}) {
  const mainRef = useRef<HTMLDivElement>(null);
  const puedeAvanzar = problema === null;
  const ultimo = actual === pasos.length - 1;
  const paso = pasos[actual];

  const avanzar = useCallback(() => {
    if (!puedeAvanzar) return;
    if (ultimo) { onTerminar(); return; }
    onCambiarPaso(Math.min(actual + 1, pasos.length - 1));
    mainRef.current?.scrollTo({ top: 0 });
  }, [puedeAvanzar, ultimo, onTerminar, onCambiarPaso, actual, pasos.length]);

  const volver = useCallback(() => {
    onCambiarPaso(Math.max(0, actual - 1));
    mainRef.current?.scrollTo({ top: 0 });
  }, [onCambiarPaso, actual]);

  /* Teclado: Enter avanza, Esc sale. En un textarea Enter escribe. */
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.defaultPrevented) return;
      if (ev.key === "Escape") {
        /* Un desplegable o un calendario abierto se cierra primero. */
        if (document.querySelector("[data-flotante-abierto]")) return;
        ev.preventDefault(); onCerrar(); return;
      }
      const foco = ev.target as HTMLElement | null;
      const escribiendo = foco?.tagName === "INPUT" || foco?.tagName === "TEXTAREA" || foco?.tagName === "SELECT";

      /* Los números eligen la opción que tienen al lado, como muestra el
         cartelito de cada tarjeta. Mientras se escribe, un 3 es un 3. */
      if (!escribiendo && /^[1-9]$/.test(ev.key)) {
        const opciones = mainRef.current?.querySelectorAll<HTMLButtonElement>(".opcion");
        const elegida = opciones?.[Number(ev.key) - 1];
        if (elegida) { ev.preventDefault(); elegida.click(); return; }
      }

      if (ev.key !== "Enter" || ev.shiftKey) return;
      if (foco?.tagName === "TEXTAREA") return;
      if (document.querySelector("[data-flotante-abierto]")) return;
      /* Sobre una opción ya elegida, Enter avanza en vez de volver a
         tocarla; sobre cualquier otro botón, hace lo de ese botón. */
      if (foco?.tagName === "BUTTON" && !foco.classList.contains("opcion")) return;
      ev.preventDefault();
      avanzar();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [avanzar, onCerrar]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  /* Foco en el primer control de cada paso. */
  useEffect(() => {
    const t = window.setTimeout(() => {
      mainRef.current?.querySelector<HTMLElement>("input, textarea, select, .opcion, [data-foco-inicial]")?.focus();
    }, 80);
    return () => window.clearTimeout(t);
  }, [actual]);

  const progreso = ((actual + (puedeAvanzar ? 1 : 0.35)) / pasos.length) * 100;

  return (
    <div className="asistente" role="dialog" aria-modal="true" aria-label={etiqueta}>
      <div className="asistente__progreso">
        <div className="asistente__progreso-fill" style={{ width: `${progreso}%` }} />
      </div>

      <div className="asistente__head">
        <span className="asistente__paso-n">{actual + 1} / {pasos.length}</span>
        <span className="asistente__ruta">
          {pasos.map((p, k) => (
            <React.Fragment key={p.id}>
              {k > 0 && <span className="asistente__ruta-sep">·</span>}
              <span className="asistente__ruta-item" data-activo={k === actual}>{p.titulo}</span>
            </React.Fragment>
          ))}
        </span>
        <span className="spacer" />
        <IconButton etiqueta="Salir sin guardar" onClick={onCerrar}><X size={18} /></IconButton>
      </div>

      <div className="asistente__main" ref={mainRef}>
        <div className="asistente__paso" key={paso?.id}>
          {children}
        </div>
      </div>

      <div className="asistente__foot">
        {actual > 0 && <Button variante="ghost" icono={<ArrowLeft size={16} />} onClick={volver}>Atrás</Button>}
        <span className="spacer" />
        {problema && (
          <span className="t-sm" style={{ color: problemaEsError ? "var(--warning)" : "var(--ink-subtle)" }}>
            {problema}
          </span>
        )}
        {!ultimo && <span className="asistente__pista"><kbd>Enter</kbd><CornerDownLeft size={13} /></span>}
        <Button
          variante="primary" onClick={avanzar} disabled={!puedeAvanzar}
          icono={ultimo ? <Check size={16} /> : undefined}
        >
          {ultimo ? terminarTexto : "Continuar"}
        </Button>
      </div>
    </div>
  );
}

/* La pregunta grande de cada paso, con su aclaración. */
export function Pregunta({ texto, sub }: { texto: string; sub?: string }) {
  return (
    <div>
      <h2 className="asistente__pregunta">{texto}</h2>
      {sub && <p className="asistente__sub">{sub}</p>}
    </div>
  );
}

/* Una tarjeta elegible. `tecla` es el número que la elige con el teclado.
   Van dentro de un `<div className="opciones">` (grilla) o
   `"opciones opciones--lista"` (una por renglón). */
export function Opcion({ tecla, nombre, sub, activo, onClick }: {
  tecla?: string; nombre: string; sub?: string; activo: boolean; onClick: () => void;
}) {
  return (
    <button type="button" className="opcion" aria-pressed={activo} onClick={onClick}>
      {tecla && <span className="opcion__tecla">{tecla}</span>}
      <span className="opcion__texto">
        <span className="opcion__nombre">{nombre}</span>
        {sub && <span className="opcion__sub">{sub}</span>}
      </span>
      {activo && <Check size={16} style={{ marginLeft: "auto", color: "var(--brand)" }} />}
    </button>
  );
}
