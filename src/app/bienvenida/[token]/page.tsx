"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CheckCircle2, GraduationCap, LifeBuoy, Map as MapaIcono, NotebookPen, Send, Video } from "lucide-react";
import type { Bienvenida } from "@/lib/contratos";
import type { GuiaBienvenida } from "@/lib/bienvenida-alumno";

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

/* Los botones de la app (hk-btn), en chico para que entren al lado del nombre: naranja el primero, el resto secundarios. */
const claseBoton = (primario: boolean) => `hk-btn ${primario ? "hk-btn--primary" : "hk-btn--secondary"} bienv-boton`;

/* Los nombres de las reuniones vienen de Zoom con « - ZOOM» al final: acá ya se sabe que son de Zoom. */
const sinZoom = (nombre: string) => nombre.replace(/\s*[-–]\s*zoom\s*$/i, "");

function Seccion({ icono, titulo, children }: { icono: React.ReactNode; titulo: string; children: React.ReactNode }) {
  return (
    <section className="bienv-seccion">
      <h2><span aria-hidden className="bienv-seccion__icono">{icono}</span>{titulo}</h2>
      {children}
    </section>
  );
}

/* Un acceso: el nombre (que puede ocupar dos renglones) y a la derecha qué hacer. */
function Fila({ nombre, detalle, children }: { nombre: string; detalle?: string; children: React.ReactNode }) {
  return (
    <div className="bienv-fila">
      <span className="bienv-fila__texto">{nombre}{detalle && <small>{detalle}</small>}</span>
      {children}
    </div>
  );
}

const Chico = ({ children }: { children: React.ReactNode }) => <p className="bienv-nota">{children}</p>;

/* Lo que sigue después de los accesos (Lili, 22/10): su roadmap según el perfil, el formulario de los lunes y a quién
   escribirle. `primario` decide si el primer botón va naranja. */
function Guia({ g, primario }: { g: GuiaBienvenida; primario: () => boolean }) {
  return (
    <>
      <Seccion icono={<MapaIcono size={15} />} titulo="Tu roadmap">
        <Fila nombre={g.perfil ? `Roadmap ${g.perfil}` : "Tu roadmap personalizado"}
          detalle="Tu guía para definir tu stack y alinearte con el mercado. Empezá por acá.">
          {g.roadmap
            ? <a href={g.roadmap} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} aria-label="Ver mi roadmap">Ver</a>
            : <span className="bienv-nota bienv-fila__aparte">Te lo mandamos por WhatsApp</span>}
        </Fila>
      </Seccion>
      {g.modelo === "completo" && (
        <Seccion icono={<NotebookPen size={15} />} titulo="Tu seguimiento semanal">
          <Fila nombre="Formulario de seguimiento" detalle="Completalo todos los lunes: tus avances, dificultades y próximos pasos.">
            {g.formulario
              ? <a href={g.formulario} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} aria-label="Completar el formulario semanal">Completar</a>
              : <span className="bienv-nota bienv-fila__aparte">Te lo mandamos por WhatsApp</span>}
          </Fila>
          <Chico>Guardá este link: es tuyo y sirve todas las semanas.</Chico>
        </Seccion>
      )}
      {g.soporte && (
        <Seccion icono={<LifeBuoy size={15} />} titulo="¿Necesitás ayuda?">
          <Fila nombre={`${g.soporte.nombre}, del equipo de soporte`} detalle={`WhatsApp ${g.soporte.whatsapp}`}>
            {g.soporte.enlace && <a href={g.soporte.enlace} target="_blank" rel="noopener noreferrer" className={claseBoton(false)} aria-label={`Escribirle a ${g.soporte.nombre} por WhatsApp`}>Escribir</a>}
          </Fila>
        </Seccion>
      )}
    </>
  );
}

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
    <main className="reporte-pub reporte-pub--bienvenida">
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
        ) : b.fase === "terminado" ? (
          <div className="reporte-pub__form">
            <h1>Tus accesos a {b.programa} ya no están activos</h1>
            <p className="reporte-pub__sub">Si creés que es un error, escribinos por WhatsApp y lo vemos.</p>
          </div>
        ) : b.fase === "reserva" ? (
          <div className="reporte-pub__listo">
            <CheckCircle2 size={40} style={{ color: "var(--success)" }} aria-hidden />
            <h1>¡Reservaste tu lugar{hola}!</h1>
            <p className="reporte-pub__sub">Firmaste el contrato de la reserva de {b.programa}. Cuando avances con el programa completo, te mandamos su contrato y, al firmarlo, tus accesos.</p>
            {b.guia && <div className="reporte-pub__form" style={{ textAlign: "left", width: "100%" }}><Guia g={b.guia} primario={primario} /></div>}
          </div>
        ) : b.fase === "sin-accesos" ? (
          <div className="reporte-pub__listo">
            <CheckCircle2 size={40} style={{ color: "var(--success)" }} aria-hidden />
            <h1>¡Gracias{hola}!</h1>
            <p className="reporte-pub__sub">Firmaste el contrato de {b.programa}. En las próximas horas te escribimos por WhatsApp con tus accesos.</p>
            {b.guia && <div className="reporte-pub__form" style={{ textAlign: "left", width: "100%" }}><Guia g={b.guia} primario={primario} /></div>}
          </div>
        ) : (
          <div className="reporte-pub__form">
            <h1>¡Ya sos parte de {b.programa}{hola}!</h1>
            <p className="reporte-pub__sub">Firmaste tu contrato. Estos son tus accesos: entrá a cada uno desde acá.</p>

            {b.telegram.length > 0 && (
              <Seccion icono={<Send size={15} />} titulo="Comunidad en Telegram">
                {b.telegram.map((g) => (
                  <Fila key={g.nombre} nombre={g.nombre}>
                    {g.adentro
                      ? <span className="bienv-ok"><CheckCircle2 size={16} aria-hidden /> Ya estás</span>
                      : g.url ? <a href={g.url} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} aria-label={`Entrar a ${g.nombre}`}>Entrar</a> : null}
                  </Fila>
                ))}
                <Chico>Cada link es personal y sirve una sola vez. Abrilo con Telegram instalado.</Chico>
              </Seccion>
            )}

            {b.wisboo && (
              <Seccion icono={<GraduationCap size={15} />} titulo="Tus cursos">
                <Fila nombre="Plataforma de cursos" detalle={b.wisboo.cursos.join(" · ")}>
                  {b.wisboo.url && <a href={b.wisboo.url} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} aria-label="Entrar a mis cursos">Entrar</a>}
                </Fila>
                <Chico>{b.wisboo.url
                  ? "La primera vez te pide elegir una contraseña: tu usuario es el mail con el que firmaste."
                  : "Entrá a la plataforma de cursos con el mail con el que firmaste."}</Chico>
              </Seccion>
            )}

            {b.zoom.length > 0 && (
              <Seccion icono={<Video size={15} />} titulo="Clases en vivo por Zoom">
                {b.zoom.map((z) => (
                  <Fila key={z.nombre} nombre={sinZoom(z.nombre)}>
                    {z.url
                      ? <a href={z.url} target="_blank" rel="noopener noreferrer" className={claseBoton(primario())} aria-label={`Mi link a ${sinZoom(z.nombre)}`}>Mi link</a>
                      : <span className="bienv-nota bienv-fila__aparte">Te lo mandamos por WhatsApp</span>}
                  </Fila>
                ))}
                <Chico>Cada link es tuyo: guardalo, sirve para todas las clases de esa reunión.</Chico>
              </Seccion>
            )}

            {b.guia && <Guia g={b.guia} primario={primario} />}

            {b.faltaAlgo && <Chico>Alguno de tus accesos lo terminamos a mano: te escribimos por WhatsApp.</Chico>}
          </div>
        )}
      </div>
    </main>
  );
}
