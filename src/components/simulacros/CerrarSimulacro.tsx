"use client";

import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Input, Select, Textarea } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { useToast } from "@/components/ui/Toast";
import { useUsuarioActual } from "@/lib/usuario";
import { useAcceso } from "@/lib/acceso";
import { fechaLarga } from "@/lib/format";
import { diaDeClase, problemaDeResultado, RESULTADOS, TIPOS_TOMADOS, TOMAN_SIMULACROS, type EstadoSimulacro, type Simulacro } from "@/lib/simulacros";
import type { EstadoApp } from "@/lib/types";
import { guardarSimulacro } from "./simulacros-nube";

/* «Cargar cómo fue» el simulacro de un alumno, tipo Typeform (Lili, 23/10): ¿se hizo? Si se hizo, qué entrevista, las
   tecnologías, un comentario y quién la tomó; si no, por qué. Si no se había anotado («+ Cargar otro alumno»), primero
   quién es. Queda en la ficha del alumno (Seguimiento). */

type PasoId = "alumno" | "resultado" | "tipo" | "tecnologias" | "comentario" | "responsable" | "motivo";
const TITULOS: Record<PasoId, string> = {
  alumno: "Alumno", resultado: "¿Se hizo?", tipo: "Entrevista", tecnologias: "Tecnologías", comentario: "Comentario", responsable: "Quién la tomó", motivo: "Qué pasó",
};

export function CerrarSimulacro({ e, simulacro, fecha, onCerrar, onListo }: {
  e: EstadoApp; simulacro: Simulacro | null; fecha: string; onCerrar: () => void; onListo: () => void;
}) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const nuevo = simulacro === null;
  const [alumnoId, setAlumnoId] = useState(simulacro?.alumnoId ?? "");
  /* Una del Google Form «sin registro» pide elegir cómo fue de verdad (no se guarda otra vez «sin registro»). */
  const [estado, setEstado] = useState<EstadoSimulacro | null>(simulacro && simulacro.estado !== "inscripto" && simulacro.estado !== "sin_registro" ? simulacro.estado : null);
  const [tipoTomado, setTipoTomado] = useState(simulacro?.tipoTomado ?? "");
  const [tecnologias, setTecnologias] = useState(simulacro?.tecnologias ?? simulacro?.stack ?? "");
  const [comentario, setComentario] = useState(simulacro?.comentario ?? "");
  const [motivo, setMotivo] = useState(simulacro?.motivo ?? "");
  /* Yari y Nahuel, que son los que los toman, primero. */
  const equipo = useMemo(() => e.equipo.filter((m) => m.activo !== false && m.nombre?.trim())
    .sort((a, b) => Number(TOMAN_SIMULACROS.includes(b.id)) - Number(TOMAN_SIMULACROS.includes(a.id)) || a.nombre.localeCompare(b.nombre, "es"))
    .map((m) => m.nombre.trim()), [e.equipo]);
  /* Quien la toma suele ser quien la carga, si es dueño (Yari o Nahuel); Lili la carga por ellos y elige. */
  const { esDueno } = useAcceso();
  const [responsable, setResponsable] = useState(simulacro?.responsable ?? (esDueno && equipo.includes(yo.nombre) ? yo.nombre : ""));
  const [i, setI] = useState(0);
  const [guardando, setGuardando] = useState(false);

  const alumnos = useMemo(() => [...e.alumnos]
    .sort((a, b) => Number(b.estado === "activo") - Number(a.estado === "activo") || a.nombre.localeCompare(b.nombre, "es"))
    .map((a) => ({ valor: a.id, texto: a.estado === "activo" ? a.nombre : `${a.nombre} (${a.estado})` })), [e.alumnos]);
  const alumno = alumnoId ? e.alumnos.find((a) => a.id === alumnoId) : undefined;
  const nombre = alumno?.nombre ?? simulacro?.nombre ?? "el alumno";
  const primero = nombre.split(" ")[0];

  const ids: PasoId[] = [
    ...(nuevo || !simulacro?.alumnoId ? ["alumno" as const] : []),
    "resultado",
    ...(estado === "hecho" ? (["tipo", "tecnologias", "comentario", "responsable"] as const) : estado === "otro" ? (["motivo"] as const) : []),
  ];
  const pasos = ids.map((id) => ({ id, titulo: TITULOS[id] }));
  const actual = Math.min(i, pasos.length - 1);
  const id = ids[actual];

  const falta = id === "alumno" ? (nuevo && !alumnoId ? "Elegí el alumno." : null)
    : id === "resultado" ? (estado ? null : "Elegí cómo fue.")
      : id === "tipo" ? (tipoTomado ? null : "Elegí qué entrevista se le tomó.")
        : id === "responsable" ? (responsable ? null : "Elegí quién la tomó.")
          : id === "motivo" ? (motivo.trim() ? null : "Contá qué pasó.")
            : null;

  const guardar = async () => {
    const r = { estado, tipoTomado: estado === "hecho" ? tipoTomado : null, motivo: estado === "otro" ? motivo : null, responsable: estado === "hecho" ? responsable : null };
    if (problemaDeResultado(r) || guardando) return;
    setGuardando(true);
    try {
      await guardarSimulacro({
        id: simulacro?.id ?? `sim_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        ...(nuevo ? { fecha, nombre: alumno?.nombre ?? "", telefono: "", stack: "", tipoPedido: "", preparado: true, origen: "panel" as const } : {}),
        alumnoId: alumnoId || null,
        estado: estado as EstadoSimulacro, tipoTomado: r.tipoTomado, motivo: r.motivo, responsable: r.responsable,
        tecnologias: estado === "hecho" ? tecnologias.trim() || null : null,
        comentario: estado === "hecho" ? comentario.trim() || null : null,
        cargadoPor: yo.nombre,
      }, nuevo);
      toast(estado === "hecho" ? `Listo: el simulacro de ${primero} quedó cargado en su ficha.` : `Listo: quedó anotado que el simulacro de ${primero} no se hizo.`);
      onListo();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo guardar.", "err");
    } finally { setGuardando(false); }
  };

  return createPortal(
    <Asistente
      etiqueta={`Simulacro de ${nombre}`} pasos={pasos} actual={actual} onCambiarPaso={setI}
      problema={guardando ? "Guardando…" : falta} onCerrar={onCerrar} terminarTexto="Guardar" onTerminar={() => void guardar()}
    >
      {id === "alumno" && (
        <>
          <Pregunta texto={nuevo ? "¿A qué alumno se le tomó?" : `¿Qué alumno es ${simulacro?.nombre}?`}
            sub={nuevo ? `Simulacro del ${diaDeClase(fecha, fechaLarga)}. Se carga en su ficha.` : `Se anotó con el celular ${simulacro?.telefono || "—"} y no lo encontramos solo. Elegilo para que quede en su ficha (o seguí sin atarlo).`} />
          <div className="hk-field">
            <label className="hk-label">Alumno</label>
            <Select value={alumnoId} placeholder="Elegí el alumno" aria-label="Alumno" onChange={(ev) => setAlumnoId(ev.target.value)}
              opciones={nuevo ? alumnos : [{ valor: "", texto: "No es alumno de la app" }, ...alumnos]} />
          </div>
        </>
      )}
      {id === "resultado" && (
        <>
          <Pregunta texto={`¿Se hizo el simulacro con ${primero}?`}
            sub={simulacro?.tipoPedido ? `Pidió: ${simulacro.tipoPedido}${simulacro.stack ? ` · ${simulacro.stack}` : ""}.` : undefined} />
          <div className="opciones opciones--lista">
            {RESULTADOS.map((o, k) => (
              <Opcion key={o.valor} tecla={String(k + 1)} nombre={o.nombre} sub={o.sub} activo={estado === o.valor}
                onClick={() => { setEstado(o.valor); if (o.valor === "hecho" || o.valor === "otro") window.setTimeout(() => setI(actual + 1), 220); }} />
            ))}
          </div>
        </>
      )}
      {id === "tipo" && (
        <>
          <Pregunta texto="¿Qué entrevista se le tomó?" sub={simulacro?.tipoPedido ? `Había pedido: ${simulacro.tipoPedido}.` : undefined} />
          <div className="opciones opciones--lista">
            {TIPOS_TOMADOS.map((t, k) => <Opcion key={t} tecla={String(k + 1)} nombre={t} activo={tipoTomado === t} onClick={() => setTipoTomado(t)} />)}
          </div>
        </>
      )}
      {id === "tecnologias" && (
        <>
          <Pregunta texto="¿Sobre qué tecnologías?" sub="Las que se preguntaron (opcional)." />
          <Input value={tecnologias} onChange={(ev) => setTecnologias(ev.target.value)} placeholder="React, Node, SQL…" aria-label="Tecnologías" maxLength={200} />
        </>
      )}
      {id === "comentario" && (
        <>
          <Pregunta texto="¿Algún comentario?" sub="Cómo le fue, qué tiene que mejorar (opcional). Lo ve el equipo en su ficha." />
          <Textarea rows={5} value={comentario} onChange={(ev) => setComentario(ev.target.value)} aria-label="Comentario" maxLength={2000}
            placeholder="Respondió bien lo técnico; tiene que practicar contar sus proyectos…" />
        </>
      )}
      {id === "responsable" && (
        <>
          <Pregunta texto="¿Quién se la tomó?" />
          <div className="hk-field">
            <label className="hk-label">Responsable</label>
            <Select value={responsable} placeholder="Elegí quién" aria-label="Quién la tomó" onChange={(ev) => setResponsable(ev.target.value)} opciones={equipo} />
          </div>
        </>
      )}
      {id === "motivo" && (
        <>
          <Pregunta texto="¿Qué pasó?" />
          <Textarea rows={4} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} aria-label="Qué pasó" maxLength={1000} placeholder="Se le cortó la conexión, lo pasamos para el martes que viene…" />
        </>
      )}
    </Asistente>,
    document.body,
  );
}
