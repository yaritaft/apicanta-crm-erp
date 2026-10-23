"use client";

import React, { useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { CADA_CUANTO_MS, cuentaRegresiva, ESPERA_PARA_BLOQUEAR_MS, hayQueActualizar, type VersionPublicada } from "@/lib/version-app";

/* ==================================================================
   «Hay una versión nueva: actualizá» (Juan Cruz, 23/10: «sí o sí»).
   Pregunta /api/version cada minuto y medio y al volver a la pestaña. Si
   se publicó otra versión o un dueño pidió que todos actualicen, aparece
   un cartel que no se cierra, con dos minutos para guardar lo que se esté
   cargando; después la app queda tapada hasta apretar «Actualizar». No
   recarga sola: perdería lo que alguien tiene a medio escribir. Si la
   pestaña estaba en segundo plano, se tapa apenas vuelve.
   ================================================================== */

/* El «Pedir a todos que actualicen» de esta misma pestaña: a quien lo pidió no le aparece el cartel. */
let recargaPropia: string | null = null;
export function marcarRecargaPropia(valor: string) { recargaPropia = valor; }

const recargar = () => window.location.reload();

export function AvisoVersion() {
  const base = useRef<VersionPublicada | null>(null);
  const desdeRef = useRef<number | null>(null);
  const [desde, setDesde] = useState<number | null>(null);
  const [bloqueado, setBloqueado] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());

  useEffect(() => {
    let vivo = true;
    const propia = process.env.VERSION_APP ?? "";
    const avisar = (tapar: boolean) => {
      /* La hora de ahora también: si no, el primer cuadro cuenta desde que se abrió la pestaña («en 3:31»). */
      if (desdeRef.current === null) { desdeRef.current = Date.now(); setAhora(desdeRef.current); setDesde(desdeRef.current); }
      if (tapar) setBloqueado(true);
    };
    async function mirar() {
      try {
        const r = await fetch("/api/version", { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const v = (await r.json()) as VersionPublicada;
        if (!base.current) base.current = { version: propia || v.version, recarga: v.recarga };
        if (v.recarga && v.recarga === recargaPropia) base.current = { ...base.current, recarga: v.recarga };
        if (hayQueActualizar(base.current, v)) avisar(document.hidden);
      } catch { /* sin red: se vuelve a preguntar en la próxima */ }
    }
    const alVolver = () => {
      if (document.hidden) return;
      if (desdeRef.current !== null) setBloqueado(true);
      void mirar();
    };
    void mirar();
    const t = window.setInterval(() => { void mirar(); }, CADA_CUANTO_MS);
    document.addEventListener("visibilitychange", alVolver);
    return () => { vivo = false; window.clearInterval(t); document.removeEventListener("visibilitychange", alVolver); };
  }, []);

  /* La cuenta regresiva hasta taparla. */
  useEffect(() => {
    if (desde === null || bloqueado) return;
    const t = window.setInterval(() => {
      const ya = Date.now();
      setAhora(ya);
      if (ya - desde >= ESPERA_PARA_BLOQUEAR_MS) setBloqueado(true);
    }, 1000);
    return () => window.clearInterval(t);
  }, [desde, bloqueado]);

  if (desde === null) return null;

  if (bloqueado) {
    return (
      <div role="alertdialog" aria-modal="true" aria-labelledby="aviso-version-titulo"
        style={{
          position: "fixed", inset: 0, zIndex: 1000, background: "var(--overlay)",
          backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", justifyContent: "center", padding: "var(--space-4)",
        }}>
        <div className="stack-3" style={{
          width: "100%", maxWidth: 420, background: "var(--surface-100)", border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: "var(--space-5)", textAlign: "center",
        }}>
          <h2 id="aviso-version-titulo" className="modal__title">Hay una versión nueva de la app</h2>
          <p className="t-body t-muted">Para seguir, actualizá la página. Lo que ya se guardó no se pierde.</p>
          <div><Button variante="primary" icono={<RefreshCw size={16} />} onClick={recargar} autoFocus>Actualizar ahora</Button></div>
        </div>
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite"
      style={{
        position: "fixed", left: "50%", bottom: "var(--space-4)", transform: "translateX(-50%)", zIndex: 1000,
        width: "min(560px, calc(100vw - 32px))", display: "flex", alignItems: "center", gap: "var(--space-3)",
        flexWrap: "wrap", background: "var(--surface-100)", border: "1px solid var(--accent)",
        borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-lg)", padding: "var(--space-3) var(--space-4)",
      }}>
      <span className="t-body" style={{ flex: "1 1 260px" }}>
        <strong>Hay una versión nueva de la app.</strong>{" "}
        <span className="t-muted">Guardá lo que estés haciendo: en {cuentaRegresiva(Math.min(ESPERA_PARA_BLOQUEAR_MS, ESPERA_PARA_BLOQUEAR_MS - (ahora - desde)))} se bloquea hasta que actualices.</span>
      </span>
      <Button sm variante="primary" icono={<RefreshCw size={14} />} onClick={recargar}>Actualizar ahora</Button>
    </div>
  );
}
