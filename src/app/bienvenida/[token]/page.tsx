"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, GraduationCap, Send, Video } from "lucide-react";
import type { Bienvenida } from "@/lib/contratos";

/* ==================================================================
   La bienvenida: adonde PandaDoc manda al alumno apenas firma su contrato.
   Le muestra sus accesos para que entre solo, sin que nadie le pase nada:
   - los grupos de Telegram (un link personal de un solo uso por grupo: un
     bot no puede meter a nadie en un grupo, tiene que tocarlo él),
   - sus cursos de Wisboo (un link para entrar directo),
   - sus clases de Zoom.
   Pública: la abre sólo su código (largo, al azar). Mientras la firma o los
   accesos no están, se vuelve a preguntar sola.
   ================================================================== */

const CADA_MS = 4_000;
const TOPE_VUELTAS = 60;

/* Los botones de la app (hk-btn): naranja el primero, el resto secundarios. */
const claseBoton = (primario: boolean) => `hk-btn hk-btn--lg ${primario ? "hk-btn--primary" : "hk-btn--secondary"}`;
const anchoCompleto: React.CSSProperties = { width: "100%", textDecoration: "none", justifyContent: "center" };

function Paso({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 16, borderTop: "1px solid var(--border)" }}>
      <h2 style={{ margin: 0, fontSize: 17, display: "flex", alignItems: "center", gap: 8, color: "var(--ink)" }}>
        <span aria-hidden style={{ color: "var(--brand, var(--accent))", display: "inline-flex" }}>{icono}</span>{titulo}
      </h2>
      {children}
    </section>
  );
}

const Chico = ({ children }: { children: React.ReactNode }) => <p style={{ margin: 0, fontSize: 13, lineHeight: "20px", color: "var(--ink-subtle)" }}>{children}</p>;

export default function PaginaBienvenida() {
  const { token } = useParams<{ token: string }>();
  const [b, setB] = useState<Bienvenida | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cansado, setCansado] = useState(false);
  const vueltas = useRef(0);

  const preguntar = useCallback(async () => {
    try {
      const r = await fetch(`/api/bienvenida/${encodeURIComponent(token)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as Bienvenida & { error?: string };
      if (!r.ok) { setError(j.error ?? "No pudimos cargar tus accesos."); return; }
      setError(null);
      setB(j);
    } catch { setError("No pudimos conectarnos. Revisá tu internet y volvé a abrir esta página."); }
  }, [token]);

  useEffect(() => { void preguntar(); }, [preguntar]);
  const esperando = b?.fase === "firmar" || b?.fase === "preparando";
  useEffect(() => {
    if (!esperando) return;
    const t = window.setInterval(() => {
      vueltas.current += 1;
      if (vueltas.current > TOPE_VUELTAS) { setCansado(true); window.clearInterval(t); return; }
      void preguntar();
    }, CADA_MS);
    return () => window.clearInterval(t);
  }, [esperando, preguntar]);

  const hola = b?.nombre ? `, ${b.nombre}` : "";
  /* Un solo botón naranja: el primer paso que tiene algo para tocar. */
  let primarioUsado = false;
  const primario = () => { if (primarioUsado) return false; primarioUsado = true; return true; };

  return (
    <main className="reporte-pub">
      <div className="reporte-pub__marca">Apicanta<span>.</span></div>
      <div className="reporte-pub__tarjeta" aria-live="polite">
        {error ? (
          <div className="reporte-pub__form">
            <h1>No encontramos esta página</h1>
            <p className="reporte-pub__sub">
              {/^No encontramos/.test(error) ? "" : `${error} `}Si recién firmaste tu contrato, escribinos por WhatsApp y te pasamos tus accesos.
            </p>
          </div>
        ) : !b ? (
          <p className="reporte-pub__sub" role="status">Cargando…</p>
        ) : b.fase === "firmar" ? (
          <div className="reporte-pub__form">
            <h1>Estamos esperando tu firma</h1>
            <p className="reporte-pub__sub">Si ya firmaste el contrato{b.programa ? ` de ${b.programa}` : ""}, en unos segundos aparecen tus accesos acá. No hace falta que hagas nada.</p>
            {cansado && <Chico>Está tardando más de lo normal: te escribimos por WhatsApp con tus accesos.</Chico>}
          </div>
        ) : b.fase === "preparando" ? (
          <div className="reporte-pub__form">
            <h1>¡Listo{hola}!</h1>
            <p className="reporte-pub__sub">Firmaste el contrato de {b.programa}. Estamos preparando tus accesos: tarda unos segundos.</p>
            {cansado && <Chico>Está tardando más de lo normal: te escribimos por WhatsApp con tus accesos.</Chico>}
          </div>
        ) : b.fase === "sin-accesos" ? (
          <div className="reporte-pub__listo">
            <CheckCircle2 size={40} style={{ color: "var(--success)" }} aria-hidden />
            <h1>¡Gracias{hola}!</h1>
            <p className="reporte-pub__sub">Firmaste el contrato de {b.programa}. En las próximas horas te escribimos por WhatsApp con tus accesos.</p>
          </div>
        ) : (
          <div className="reporte-pub__form">
            <h1>¡Bienvenido a {b.programa}{hola}!</h1>
            <p className="reporte-pub__sub">Ya firmaste. Estos son tus accesos: entrá a cada uno desde acá.</p>

            {b.telegram.length > 0 && (
              <Paso icono={<Send size={18} />} titulo="Tu comunidad en Telegram">
                {b.telegram.map((g) => g.adentro ? (
                  <p key={g.nombre} style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, color: "var(--success)" }}>
                    <CheckCircle2 size={18} aria-hidden /> Ya estás en {g.nombre}
                  </p>
                ) : g.url ? (
                  <a key={g.nombre} href={g.url} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} style={anchoCompleto}>Entrar a {g.nombre}</a>
                ) : null)}
                <Chico>Cada link es personal y sirve una sola vez. Abrilo desde el celular con Telegram instalado.</Chico>
              </Paso>
            )}

            {b.wisboo && (
              <Paso icono={<GraduationCap size={18} />} titulo="Tus cursos">
                <Chico>{b.wisboo.cursos.join(" · ")}</Chico>
                {b.wisboo.url
                  ? <a href={b.wisboo.url} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} style={anchoCompleto}>Entrar a mis cursos</a>
                  : <Chico>Entrá a la plataforma de cursos con el mail con el que firmaste.</Chico>}
              </Paso>
            )}

            {b.zoom.length > 0 && (
              <Paso icono={<Video size={18} />} titulo="Tus clases en vivo">
                {b.zoom.map((z) => z.url
                  ? <a key={z.nombre} href={z.url} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} style={anchoCompleto}>Mi link a {z.nombre}</a>
                  : <Chico key={z.nombre}>{z.nombre}: te llega un mail de Zoom con tu link.</Chico>)}
                <Chico>Guardá este link: es el tuyo para entrar a todas las clases.</Chico>
              </Paso>
            )}

            {b.faltaAlgo && <Chico>Alguno de tus accesos lo terminamos a mano: te escribimos por WhatsApp.</Chico>}
          </div>
        )}
      </div>
    </main>
  );
}
