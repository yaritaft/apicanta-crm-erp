"use client";

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Input, Select, Textarea } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { useToast } from "@/components/ui/Toast";
import { useUsuarioActual } from "@/lib/usuario";
import { fechaLarga } from "@/lib/format";
import { diaDeClase, TOMAN_SIMULACROS } from "@/lib/simulacros";
import { cambiosDeResultado, problemaDeConsulta, RESULTADOS_CONSULTA, type ConsultaClase, type ResultadoConsulta } from "@/lib/consultas";
import type { EstadoApp } from "@/lib/types";
import { guardarConsulta } from "./consultas-nube";

/* Los que dan las clases (Yari y Nahuel): van primeros al elegir quién la dio, y el que la carga queda elegido. */
function useQuienesDan(e: EstadoApp): { equipo: string[]; yoDoy: string } {
  const yo = useUsuarioActual();
  const equipo = useMemo(() => e.equipo.filter((m) => m.activo !== false && m.nombre?.trim())
    .sort((a, b) => Number(TOMAN_SIMULACROS.includes(b.id)) - Number(TOMAN_SIMULACROS.includes(a.id)) || a.nombre.localeCompare(b.nombre, "es"))
    .map((m) => m.nombre.trim()), [e.equipo]);
  return { equipo, yoDoy: yo.miembro && TOMAN_SIMULACROS.includes(yo.miembro.id) ? yo.miembro.nombre.trim() : "" };
}

/* «Cargar cómo fue» la clase de un jueves, tipo Typeform (Lili, 24/10): quién la dio y, una por una, qué pasó con cada
   consulta (respondida, no se respondió, o queda para la próxima clase). Queda en la ficha de cada alumno. */
export function CerrarClase({ e, consultas, fecha, onCerrar, onListo }: {
  e: EstadoApp; consultas: ConsultaClase[]; fecha: string; onCerrar: () => void; onListo: () => void;
}) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const { equipo, yoDoy } = useQuienesDan(e);
  const [responsable, setResponsable] = useState(consultas.find((c) => c.responsable)?.responsable ?? yoDoy);
  const [resultados, setResultados] = useState<Record<string, ResultadoConsulta>>({});
  const [notas, setNotas] = useState<Record<string, string>>({});
  const [i, setI] = useState(0);
  const [guardando, setGuardando] = useState(false);

  const pasos = [{ id: "responsable", titulo: "Quién la dio" }, ...consultas.map((c, k) => ({ id: c.id, titulo: `Consulta ${k + 1}` }))];
  const actual = Math.min(i, pasos.length - 1);
  const consulta = actual > 0 ? consultas[actual - 1] : null;
  const nombreDe = (c: ConsultaClase) => (c.alumnoId ? e.alumnos.find((a) => a.id === c.alumnoId)?.nombre : undefined) ?? c.nombre ?? "el alumno";
  const falta = actual === 0 ? (responsable ? null : "Elegí quién dio la clase.") : consulta && !resultados[consulta.id] ? "Elegí qué pasó con la consulta." : null;

  const guardar = async () => {
    if (guardando || !responsable || consultas.some((c) => !resultados[c.id])) return;
    setGuardando(true);
    try {
      for (const c of consultas) await guardarConsulta({ id: c.id, ...cambiosDeResultado(c, resultados[c.id], responsable, notas[c.id] ?? "", yo.nombre) }, false);
      const pasan = consultas.filter((c) => resultados[c.id] === "proxima").length;
      toast(`Listo: la clase del ${diaDeClase(fecha, fechaLarga)} quedó cargada${pasan ? ` (${pasan} ${pasan === 1 ? "pasa" : "pasan"} al jueves siguiente)` : ""}.`);
      onListo();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar.", "err");
    } finally { setGuardando(false); }
  };

  return createPortal(
    <Asistente
      etiqueta={`Clase de consultas del ${diaDeClase(fecha, fechaLarga)}`} pasos={pasos} actual={actual} onCambiarPaso={setI}
      problema={guardando ? "Guardando…" : falta} onCerrar={onCerrar} terminarTexto="Guardar" onTerminar={() => void guardar()}
    >
      {actual === 0 && (
        <>
          <Pregunta texto="¿Quién dio la clase?" sub={`Clase de consultas del jueves ${diaDeClase(fecha, fechaLarga)}: ${consultas.length} ${consultas.length === 1 ? "consulta" : "consultas"} para cargar.`} />
          <div className="opciones opciones--lista">
            {equipo.slice(0, 2).map((n, k) => <Opcion key={n} tecla={String(k + 1)} nombre={n} activo={responsable === n} onClick={() => { setResponsable(n); window.setTimeout(() => setI(1), 220); }} />)}
          </div>
          <div className="hk-field" style={{ maxWidth: 360 }}>
            <label className="hk-label">U otra persona</label>
            <Select value={equipo.slice(0, 2).includes(responsable) ? "" : responsable} placeholder="Elegí quién" aria-label="Quién dio la clase"
              onChange={(ev) => setResponsable(ev.target.value)} opciones={equipo.slice(2)} />
          </div>
        </>
      )}
      {consulta && (
        <>
          <Pregunta texto={`¿Qué pasó con la consulta de ${nombreDe(consulta).split(" ")[0]}?`}
            sub={consulta.postergada ? `Viene de la clase del ${diaDeClase(consulta.primeraFecha, fechaLarga)}.` : nombreDe(consulta)} />
          <blockquote className="cq-cita">{consulta.consulta}</blockquote>
          <div className="opciones opciones--lista">
            {RESULTADOS_CONSULTA.map((o, k) => (
              <Opcion key={o.valor} tecla={String(k + 1)} nombre={o.nombre} sub={o.sub} activo={resultados[consulta.id] === o.valor}
                onClick={() => { setResultados((r) => ({ ...r, [consulta.id]: o.valor })); if (actual < pasos.length - 1) window.setTimeout(() => setI(actual + 1), 220); }} />
            ))}
          </div>
          <div className="hk-field">
            <label className="hk-label">Nota (opcional)</label>
            <Input value={notas[consulta.id] ?? ""} onChange={(ev) => setNotas((n) => ({ ...n, [consulta.id]: ev.target.value }))} maxLength={500}
              placeholder="Se respondió en el minuto 12; le falta mandar el repo…" aria-label="Nota" />
          </div>
        </>
      )}
    </Asistente>,
    document.body,
  );
}

/* «Cargar una consulta» que llegó por otro lado (WhatsApp, en la clase): de qué alumno y cuál es. */
export function CargarConsulta({ e, fecha, onCerrar, onListo }: { e: EstadoApp; fecha: string; onCerrar: () => void; onListo: () => void }) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const [alumnoId, setAlumnoId] = useState("");
  const [texto, setTexto] = useState("");
  const [i, setI] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const alumnos = useMemo(() => [...e.alumnos]
    .sort((a, b) => Number(b.estado === "activo") - Number(a.estado === "activo") || a.nombre.localeCompare(b.nombre, "es"))
    .map((a) => ({ valor: a.id, texto: a.estado === "activo" ? a.nombre : `${a.nombre} (${a.estado})` })), [e.alumnos]);
  const alumno = e.alumnos.find((a) => a.id === alumnoId);
  const pasos = [{ id: "alumno", titulo: "Alumno" }, { id: "consulta", titulo: "Consulta" }];
  const falta = i === 0 ? (alumnoId ? null : "Elegí el alumno.") : problemaDeConsulta(texto);

  const guardar = async () => {
    if (guardando || !alumno || problemaDeConsulta(texto)) return;
    setGuardando(true);
    try {
      await guardarConsulta({
        id: `cq_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, fecha, primeraFecha: fecha, alumnoId: alumno.id,
        nombre: alumno.nombre, email: alumno.email ?? "", telefono: "", consulta: texto.trim(), estado: "recibida", postergada: 0,
        origen: "panel", cargadoPor: yo.nombre,
      }, true);
      toast(`Listo: la consulta de ${alumno.nombre.split(" ")[0]} quedó para la clase del ${diaDeClase(fecha, fechaLarga)}.`);
      onListo();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar.", "err");
    } finally { setGuardando(false); }
  };

  return createPortal(
    <Asistente
      etiqueta="Cargar una consulta" pasos={pasos} actual={i} onCambiarPaso={setI}
      problema={guardando ? "Guardando…" : falta} onCerrar={onCerrar} terminarTexto="Guardar" onTerminar={() => void guardar()}
    >
      {i === 0 && (
        <>
          <Pregunta texto="¿De qué alumno es la consulta?" sub={`Queda para la clase del jueves ${diaDeClase(fecha, fechaLarga)} y en su ficha.`} />
          <div className="hk-field">
            <label className="hk-label">Alumno</label>
            <Select value={alumnoId} placeholder="Elegí el alumno" aria-label="Alumno" onChange={(ev) => setAlumnoId(ev.target.value)} opciones={alumnos} />
          </div>
        </>
      )}
      {i === 1 && (
        <>
          <Pregunta texto="¿Cuál es la consulta?" />
          <Textarea rows={6} value={texto} onChange={(ev) => setTexto(ev.target.value)} aria-label="Consulta" maxLength={3000} autoFocus
            placeholder="La duda tal como la mandó el alumno." />
        </>
      )}
    </Asistente>,
    document.body,
  );
}
