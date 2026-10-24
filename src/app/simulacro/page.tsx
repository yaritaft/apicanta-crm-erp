"use client";

import React, { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Input } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { fechaLarga } from "@/lib/format";
import { diaDeClase, problemaDeInscripcion, TEXTO_PREPARADO, TIPOS_PEDIDOS } from "@/lib/simulacros";

/* ==================================================================
   Inscripción al simulacro de entrevista de los martes (Lili, 23/10).
   Reemplaza al Google Form: las mismas preguntas, una por pantalla, y la
   inscripción entra directo a la app (Programa → Simulacros), atada sola
   al alumno por su celular. Pública: no pide iniciar sesión.
   ================================================================== */

type Datos = { nombre: string; telefono: string; stack: string; tipoPedido: string; preparado: boolean };

const PASOS = [
  { id: "nombre", titulo: "Nombre" },
  { id: "telefono", titulo: "Celular" },
  { id: "stack", titulo: "Stack" },
  { id: "tipo", titulo: "Entrevista" },
  { id: "preparado", titulo: "Preparación" },
];

export default function PaginaSimulacro() {
  const [d, setD] = useState<Datos>({ nombre: "", telefono: "", stack: "", tipoPedido: "", preparado: false });
  const [paso, setPaso] = useState(0);
  const [trampa, setTrampa] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<{ fecha: string; otraVez: boolean } | null>(null);
  const cambiar = (c: Partial<Datos>) => { setD((x) => ({ ...x, ...c })); setAviso(null); };

  const id = PASOS[paso].id;
  const falta = id === "nombre" ? (d.nombre.trim().split(/\s+/).filter(Boolean).length < 2 ? "Escribí tu nombre y tu apellido." : null)
    : id === "telefono" ? (d.telefono.replace(/\D/g, "").length < 8 ? "Escribí tu celular con el código de país." : null)
      : id === "stack" ? (d.stack.trim() ? null : "Contanos con qué stack trabajás.")
        : id === "tipo" ? (d.tipoPedido ? null : "Elegí qué tipo de entrevista querés.")
          : (d.preparado ? null : "Confirmá que te preparaste.");
  const problema = enviando ? "Enviando…" : falta;

  const enviar = async () => {
    if (enviando || problemaDeInscripcion(d)) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/simulacros/inscripcion", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; fecha?: string; otraVez?: boolean; error?: string };
      if (r.ok && j.ok) { setListo({ fecha: j.fecha ?? "", otraVez: Boolean(j.otraVez) }); return; }
      setAviso(j.error ?? "No pudimos anotarte. Probá de nuevo.");
    } catch {
      setAviso("No hay conexión. Probá de nuevo en un momento: lo que escribiste sigue acá.");
    } finally { setEnviando(false); }
  };

  if (listo) {
    return (
      <main className="reporte-pub">
        <div className="reporte-pub__marca">Apicanta<span>.</span></div>
        <div className="reporte-pub__tarjeta">
          <div className="reporte-pub__listo" role="status">
            <CheckCircle2 size={36} aria-hidden style={{ color: "var(--success)" }} />
            <h1 className="reporte-pub__titulo">{listo.otraVez ? "Actualizamos tu inscripción" : "¡Listo, quedaste anotado!"}</h1>
            <p className="reporte-pub__sub">Simulacro de entrevista del {listo.fecha ? diaDeClase(listo.fecha, fechaLarga) : "martes"}. ¡Nos vemos en sala!</p>
            <p className="reporte-pub__chico">Si por algo no podés, avisale al equipo así le damos el lugar a otro.</p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <>
      <div aria-hidden style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
        <input tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} name="sitio" />
      </div>
      <Asistente
        etiqueta="Inscripción al simulacro de entrevista" pasos={PASOS} actual={paso} onCambiarPaso={(i) => { setPaso(i); setAviso(null); }}
        problema={problema} onCerrar={() => undefined} sinSalir terminarTexto="Anotarme" onTerminar={() => void enviar()}
      >
        {id === "nombre" && (
          <>
            <Pregunta texto="Inscripción al simulacro de entrevista" sub="Los martes practicamos una entrevista en vivo con feedback. ¿Cómo te llamás?" />
            <Input value={d.nombre} onChange={(e) => cambiar({ nombre: e.target.value })} placeholder="Nombre y apellido" autoComplete="name" aria-label="Nombre completo" maxLength={120} />
          </>
        )}
        {id === "telefono" && (
          <>
            <Pregunta texto="¿Cuál es tu celular?" sub="Con el código de país, el mismo que usás con el equipo." />
            <Input type="tel" value={d.telefono} onChange={(e) => cambiar({ telefono: e.target.value })} placeholder="+54 9 11 5555 5555" autoComplete="tel" aria-label="Celular con código de país" maxLength={40} />
          </>
        )}
        {id === "stack" && (
          <>
            <Pregunta texto="¿Con qué stack trabajás?" sub="Por ejemplo: React y Node, Java y Spring, Python…" />
            <Input value={d.stack} onChange={(e) => cambiar({ stack: e.target.value })} placeholder="Tu stack" aria-label="Stack con el que trabajás" maxLength={200} />
          </>
        )}
        {id === "tipo" && (
          <>
            <Pregunta texto="¿Qué tipo de entrevista querés que te evaluemos?" />
            <div className="opciones opciones--lista">
              {TIPOS_PEDIDOS.map((t, i) => (
                <Opcion key={t} tecla={String(i + 1)} nombre={t} activo={d.tipoPedido === t} onClick={() => cambiar({ tipoPedido: t })} />
              ))}
            </div>
          </>
        )}
        {id === "preparado" && (
          <>
            <Pregunta texto="¿Te preparaste para la entrevista?" sub="Para aprovechar el espacio, antes mirá el módulo de Wisboo que explica cómo pasar este tipo de entrevistas." />
            <div className="opciones opciones--lista">
              <Opcion tecla="1" nombre={TEXTO_PREPARADO} activo={d.preparado} onClick={() => cambiar({ preparado: !d.preparado })} />
            </div>
          </>
        )}
        {aviso && <p className="reporte-pub__error" role="alert">{aviso}</p>}
      </Asistente>
    </>
  );
}
