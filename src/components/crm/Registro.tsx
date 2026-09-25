"use client";

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, ChevronUp, ExternalLink, History, MessageSquare, Star, UserRound, X } from "lucide-react";
import { ChatEquipo } from "@/components/ficha/ChatEquipo";
import { useEstado } from "@/lib/store";
import { fechaHora, relativo } from "@/lib/format";
import {
  CAMPOS, fechaCrm, valorDe,
  type CampoCrm, type ClaveCampo, type FilaCrm, type Pintor,
} from "@/lib/crm";
import type { CampoOpcionesCrm, OpcionCrm } from "@/lib/types";
import { Chip, IconoCampo, MarcaAuto } from "./piezas";
import { SelectorOpciones } from "./Editores";

/* ==================================================================
   El registro abierto (el botón de la fila o Espacio), como el de
   Airtable: todos los campos de la agenda, uno debajo del otro. Arriba
   lo que carga el equipo, que se edita acá mismo; después lo que llegó
   de la agenda y las fórmulas; al final, todo lo que contestó en el
   formulario de Calendly.
   ================================================================== */

const digitos = (s: string) => s.replace(/[^\d]/g, "");

export function Registro({ f, opciones, pintar, onGuardar, onCerrar, onFicha, anterior, siguiente, posicion }: {
  f: FilaCrm;
  opciones: Record<CampoOpcionesCrm, OpcionCrm[]>;
  pintar: Pintor;
  onGuardar: (f: FilaCrm, clave: ClaveCampo, valor: string) => void;
  onCerrar: () => void;
  onFicha: (persona: string) => void;
  anterior?: () => void;
  siguiente?: () => void;
  posicion?: string;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const e = useEstado();
  const [lado, setLado] = useState<"chat" | "actividad">("chat");

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const t = ev.target as HTMLElement;
      const escribiendo = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
      if (ev.key === "Escape") { onCerrar(); return; }
      if (escribiendo) return;
      if (ev.key === "ArrowUp" && anterior) { ev.preventDefault(); anterior(); }
      if (ev.key === "ArrowDown" && siguiente) { ev.preventDefault(); siguiente(); }
    };
    document.addEventListener("keydown", onKey);
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = antes; };
  }, [onCerrar, anterior, siguiente]);

  useEffect(() => { caja.current?.focus(); }, [f.id]);

  const s = f.sesion;
  const persona = s.contactoId ?? s.leadId;
  const grupos: { titulo: string; campos: CampoCrm[]; nota?: React.ReactNode }[] = [
    { titulo: "Lo que carga el equipo", campos: CAMPOS.filter((c) => c.origen === "equipo") },
    { titulo: "De la agenda", nota: <><MarcaAuto /> Se llena sola con Calendly</>, campos: CAMPOS.filter((c) => c.origen === "agenda" && c.clave !== "nombre") },
    { titulo: "Fórmulas", campos: CAMPOS.filter((c) => c.origen === "calculado") },
  ];

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="crm-registro-fondo" onMouseDown={onCerrar}>
      <div
        ref={caja} className="crm-registro" role="dialog" aria-modal="true" aria-label={`Registro de ${f.nombre}`}
        tabIndex={-1} onMouseDown={(ev) => ev.stopPropagation()}
      >
        <header className="crm-registro__cabeza">
          <div className="crm-registro__nav">
            <button type="button" className="crm-icono" aria-label="Registro anterior" title="Anterior (↑)" disabled={!anterior} onClick={anterior}>
              <ChevronUp size={18} aria-hidden />
            </button>
            <button type="button" className="crm-icono" aria-label="Registro siguiente" title="Siguiente (↓)" disabled={!siguiente} onClick={siguiente}>
              <ChevronDown size={18} aria-hidden />
            </button>
            {posicion && <span className="crm-registro__pos">{posicion}</span>}
          </div>
          <div className="crm-registro__titulo">
            <h2>
              {f.nombre || "Sin nombre"}
              {f.calificada === "Sí" && (
                <span className="estrella-calificada" title="Agenda calificada: invierte +1000, inglés conversacional y carrera">
                  <Star size={16} fill="currentColor" aria-label="Agenda calificada" />
                </span>
              )}
            </h2>
            <p>{f.tipo}{f.closer ? ` · con ${f.closer}` : ""}{f.llamada ? ` · ${fechaCrm(f.llamada)}` : ""}</p>
          </div>
          <div className="crm-registro__acciones">
            {s.enlace && (
              <a className="crm-boton crm-boton--quieto" href={s.enlace} target="_blank" rel="noreferrer">
                <ExternalLink size={14} aria-hidden />Abrir la reunión
              </a>
            )}
            {persona && (
              <button type="button" className="crm-boton crm-boton--quieto" onClick={() => onFicha(persona)}>
                <UserRound size={14} aria-hidden />Ver la ficha
              </button>
            )}
            <button type="button" className="crm-icono" aria-label="Cerrar" onClick={onCerrar}><X size={18} aria-hidden /></button>
          </div>
        </header>

        <div className="crm-registro__partes">
        <div className="crm-registro__cuerpo">
          {grupos.map((g) => (
            <section key={g.titulo} className="crm-registro__grupo">
              <h3>{g.titulo}{g.nota && <span className="crm-registro__nota">{g.nota}</span>}</h3>
              {g.campos.map((c) => (
                <div key={c.clave} className="crm-registro__campo">
                  <div className="crm-registro__etiqueta" title={c.fuente}>
                    <IconoCampo tipo={c.tipo} size={14} />{c.titulo}{c.origen === "agenda" && <MarcaAuto />}
                  </div>
                  <ValorRegistro f={f} c={c} opciones={opciones} pintar={pintar} onGuardar={onGuardar} />
                </div>
              ))}
            </section>
          ))}

          {s.respuestas && s.respuestas.length > 0 && (
            <section className="crm-registro__grupo">
              <h3>Lo que contestó al agendar<span className="crm-registro__nota"><MarcaAuto /> Formulario de Calendly</span></h3>
              <dl className="crm-registro__qa">
                {s.respuestas.map((q) => (
                  <div key={q.pregunta}>
                    <dt>{q.pregunta}</dt>
                    <dd>{q.respuesta}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        {/* A la derecha, como en Airtable: lo que habla el equipo de la
            persona (el mismo chat de su ficha) y la historia de esta agenda. */}
        <aside className="crm-registro__lado">
          <div className="crm-registro__pestanias" role="tablist">
            <button type="button" role="tab" aria-selected={lado === "chat"} className={lado === "chat" ? "crm-registro__pestania--on" : ""} onClick={() => setLado("chat")}>
              <MessageSquare size={14} aria-hidden />Comentarios
            </button>
            <button type="button" role="tab" aria-selected={lado === "actividad"} className={lado === "actividad" ? "crm-registro__pestania--on" : ""} onClick={() => setLado("actividad")}>
              <History size={14} aria-hidden />Actividad
            </button>
          </div>
          {lado === "chat" ? (
            persona
              ? <ChatEquipo contactoId={persona} comentarios={(e.comentarios ?? []).filter((c) => c.contactoId === persona)} />
              : <p className="crm-registro__vacio">Esta agenda no tiene una persona enlazada.</p>
          ) : (
            <ol className="crm-registro__historia">
              {e.actividad.filter((a) => a.entidadId === f.id).map((a) => (
                <li key={a.id}>
                  <span>{a.detalle}</span>
                  <span className="crm-registro__cuando" title={fechaHora(a.fecha)}>{a.actor} · {relativo(a.fecha)}</span>
                </li>
              ))}
              <li>
                <span>Agendó por Calendly{f.closer ? ` con ${f.closer}` : ""}.</span>
                <span className="crm-registro__cuando" title={fechaHora(s.creadoEn)}>{relativo(s.creadoEn)}</span>
              </li>
            </ol>
          )}
        </aside>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ValorRegistro({ f, c, opciones, pintar, onGuardar }: {
  f: FilaCrm; c: CampoCrm; opciones: Record<CampoOpcionesCrm, OpcionCrm[]>; pintar: Pintor;
  onGuardar: (f: FilaCrm, clave: ClaveCampo, valor: string) => void;
}) {
  const v = valorDe(f, c.clave);
  const [abierto, setAbierto] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (c.origen === "equipo" && c.opciones) {
    const valor = String(v);
    return (
      <>
        {/* Un div y no un botón: adentro va la ✕ de la etiqueta, que es otro botón. */}
        <div
          ref={ref} role="button" tabIndex={0} className="crm-registro__caja crm-registro__caja--select"
          aria-label={`Elegir ${c.titulo}`} aria-haspopup="listbox" aria-expanded={abierto}
          onClick={() => setAbierto(true)}
          onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " " || ev.key === "ArrowDown") { ev.preventDefault(); setAbierto(true); } }}
        >
          {valor
            ? <Chip texto={valor} color={pintar(c.clave, valor)} grande onQuitar={c.clave === "estadoLlamada" && f.estadoAuto ? undefined : () => onGuardar(f, c.clave, "")} />
            : <span className="crm-registro__vacio">Elegí una opción</span>}
          {c.clave === "estadoLlamada" && f.estadoAuto && <span className="crm-registro__auto">puesto solo</span>}
          <ChevronDown size={16} className="crm-registro__flecha" aria-hidden />
        </div>
        {abierto && (
          <SelectorOpciones
            ancla={ref.current} opciones={opciones[c.opciones]} valor={f.estadoAuto && c.clave === "estadoLlamada" ? "" : valor}
            ancho={ref.current?.offsetWidth} onElegir={(x) => { onGuardar(f, c.clave, x); setAbierto(false); }} onCerrar={() => setAbierto(false)}
          />
        )}
      </>
    );
  }
  if (c.origen === "equipo") return <TextoEditable f={f} c={c} onGuardar={onGuardar} />;

  if (c.tipo === "seleccion" || c.etiqueta) {
    return <div className="crm-registro__caja crm-registro__caja--quieta">{v ? <Chip texto={String(v)} color={pintar(c.clave, String(v))} grande /> : <span className="crm-registro__vacio">—</span>}</div>;
  }
  if (c.tipo === "multiple") {
    const xs = v as string[];
    return <div className="crm-registro__caja crm-registro__caja--quieta crm-chips">{xs.length ? xs.map((x) => <Chip key={x} texto={x} color={pintar(c.clave, x)} grande />) : <span className="crm-registro__vacio">—</span>}</div>;
  }
  const texto = c.tipo === "fecha" ? fechaCrm(String(v)) : String(v);
  return (
    <div className="crm-registro__caja crm-registro__caja--quieta">
      {!texto ? <span className="crm-registro__vacio">—</span>
        : c.tipo === "email" ? <a className="crm-link" href={`mailto:${texto}`}>{texto}</a>
        : c.tipo === "telefono" ? <a className="crm-link" href={`https://wa.me/${digitos(texto)}`} target="_blank" rel="noreferrer">{texto}</a>
        : texto}
    </div>
  );
}

/* Notas y grabación: se guardan al salir del campo. */
function TextoEditable({ f, c, onGuardar }: { f: FilaCrm; c: CampoCrm; onGuardar: (f: FilaCrm, clave: ClaveCampo, valor: string) => void }) {
  const actual = String(valorDe(f, c.clave));
  const [t, setT] = useState(actual);
  useEffect(() => { setT(actual); }, [actual, f.id]);
  const guardar = () => { if (t.trim() !== actual.trim()) onGuardar(f, c.clave, t); };
  if (c.tipo === "texto-largo") {
    return (
      <textarea
        className="crm-registro__caja crm-registro__texto" rows={4} value={t} aria-label={c.titulo}
        placeholder="Lo que pasó en la llamada…" onChange={(ev) => setT(ev.target.value)} onBlur={guardar}
      />
    );
  }
  return (
    <div className="crm-registro__linea">
      <input
        className="crm-registro__caja" value={t} aria-label={c.titulo} spellCheck={false}
        placeholder={c.tipo === "url" ? "https://fathom.video/share/…" : ""}
        onChange={(ev) => setT(ev.target.value)} onBlur={guardar}
        onKeyDown={(ev) => { if (ev.key === "Enter") { ev.preventDefault(); (ev.target as HTMLInputElement).blur(); } }}
      />
      {c.tipo === "url" && actual && (
        <a className="crm-icono" href={actual} target="_blank" rel="noreferrer" aria-label="Abrir la grabación" title="Abrir la grabación">
          <ExternalLink size={16} aria-hidden />
        </a>
      )}
    </div>
  );
}
