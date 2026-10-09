"use client";

import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { esCodigoValido } from "@/lib/reporte-enlace";
import {
  esIdFormulario, FORMULARIOS, LARGO_TEXTO, LARGO_TEXTO_CORTO, problemaDeRespuesta,
  type FormularioReporte, type PreguntaReporte, type Respuestas,
} from "@/lib/reporte-formularios";

/* ==================================================================
   El reporte semanal de los alumnos. Una sola página, siempre el mismo link:
   cada alumno entra con su código (el mensaje que le mandamos ya lo trae en
   el link: /reporte?c=…) y contesta el formulario de su programa, una
   pregunta por pantalla, como el cierre del día.

   Es pública (no pide iniciar sesión): lo único que abre es el código, un
   UUID al azar. Completarlo de nuevo la misma semana reemplaza el anterior.
   Lo que va escribiendo se guarda en el navegador hasta que lo manda, así un
   cierre sin querer no le hace perder diez respuestas.
   ================================================================== */

type Fase = "codigo" | "cargando" | "programa" | "preguntas" | "listo";

const BORRADOR = "apicanta.reporte.borrador.";
const TRES_DIAS = 3 * 24 * 3600 * 1000;
const POR_ATAJO: Record<string, string> = { biz: "hackear-biz", it: "hackear-it" };

/* El borrador vive en este navegador. Si no se puede leer o escribir (modo privado), se sigue sin él. */
const leerBorrador = (codigo: string, formulario: string): { respuestas: Respuestas; paso: number } | null => {
  try {
    const crudo = window.localStorage.getItem(`${BORRADOR}${codigo}.${formulario}`);
    if (!crudo) return null;
    const b = JSON.parse(crudo) as { en?: number; respuestas?: Respuestas; paso?: number };
    if (!b.respuestas || typeof b.respuestas !== "object" || !b.en || Date.now() - b.en > TRES_DIAS) return null;
    return { respuestas: b.respuestas, paso: Math.max(0, Number(b.paso) || 0) };
  } catch { return null; }
};
const guardarBorrador = (codigo: string, formulario: string, respuestas: Respuestas, paso: number) => {
  try { window.localStorage.setItem(`${BORRADOR}${codigo}.${formulario}`, JSON.stringify({ en: Date.now(), respuestas, paso })); } catch { /* sin borrador */ }
};
const borrarBorrador = (codigo: string, formulario: string) => {
  try { window.localStorage.removeItem(`${BORRADOR}${codigo}.${formulario}`); } catch { /* nada que borrar */ }
};

function Formulario() {
  const params = useSearchParams();
  const atajo = POR_ATAJO[(params.get("p") ?? "").trim().toLowerCase()] ?? null;
  const [fase, setFase] = useState<Fase>(params.get("c") && esCodigoValido(params.get("c")) ? "cargando" : "codigo");
  const [codigo, setCodigo] = useState(params.get("c")?.trim() ?? "");
  const [nombre, setNombre] = useState("");
  const [formulario, setFormulario] = useState<FormularioReporte | null>(null);
  const [respuestas, setRespuestas] = useState<Respuestas>({});
  const [paso, setPaso] = useState(0);
  const [trampa, setTrampa] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [reemplazo, setReemplazo] = useState(false);
  const pedido = useRef("");

  /* Con el código se pregunta de quién es y qué formulario le toca. */
  const entrar = useCallback(async (c: string) => {
    if (!esCodigoValido(c)) { setAviso("Ese código no es válido. Copialo de nuevo del mensaje que te mandamos."); setFase("codigo"); return; }
    pedido.current = c;
    setAviso(null);
    setFase("cargando");
    try {
      const r = await fetch(`/api/reportes/enviar?c=${encodeURIComponent(c)}`);
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; nombre?: string; formulario?: string | null; error?: string };
      if (pedido.current !== c) return;
      if (!r.ok || !j.ok) { setAviso(j.error ?? "No encontramos ese código."); setFase("codigo"); return; }
      setCodigo(c);
      setNombre(j.nombre ?? "");
      const id = j.formulario && esIdFormulario(j.formulario) ? j.formulario : atajo && esIdFormulario(atajo) ? atajo : null;
      if (id) empezar(FORMULARIOS[id], c); else setFase("programa");
    } catch {
      if (pedido.current === c) { setAviso("No hay conexión. Probá de nuevo en un momento."); setFase("codigo"); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [atajo]);

  const empezar = (f: FormularioReporte, c: string) => {
    const b = leerBorrador(c, f.id);
    setFormulario(f);
    setRespuestas(b?.respuestas ?? {});
    setPaso(b ? Math.min(b.paso, f.preguntas.length) : 0);
    setFase("preguntas");
  };

  useEffect(() => {
    const c = params.get("c")?.trim() ?? "";
    if (esCodigoValido(c)) void entrar(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cambiarPaso = (i: number) => {
    setPaso(i);
    setAviso(null);
    if (formulario) guardarBorrador(codigo, formulario.id, respuestas, i);
  };
  const responder = (id: string, valor: string | number) => {
    const nuevas = { ...respuestas, [id]: valor };
    setRespuestas(nuevas);
    setAviso(null);
    if (formulario) guardarBorrador(codigo, formulario.id, nuevas, paso);
  };

  const enviar = async () => {
    if (!formulario || enviando) return;
    setEnviando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/reportes/enviar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim(), formulario: formulario.id, respuestas, sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; nombre?: string; reemplazo?: boolean; error?: string; campo?: string };
      if (r.ok && j.ok) {
        borrarBorrador(codigo, formulario.id);
        if (j.nombre) setNombre(j.nombre);
        setReemplazo(Boolean(j.reemplazo));
        setFase("listo");
        return;
      }
      /* La pregunta que falló: se vuelve a ella. */
      const donde = formulario.preguntas.findIndex((p) => p.id === j.campo);
      if (donde >= 0) setPaso(donde + 1);
      if (j.campo === "codigo") { setFase("codigo"); }
      setAviso(j.error ?? "No pudimos guardar tu reporte. Probá de nuevo.");
    } catch {
      setAviso("No hay conexión. Probá de nuevo en un momento: lo que escribiste sigue acá.");
    } finally { setEnviando(false); }
  };

  const trampaEl = (
    <div aria-hidden style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
      <input tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} name="sitio" />
    </div>
  );

  if (fase === "preguntas" && formulario) {
    return (
      <>
        {trampaEl}
        <PreguntasPaso
          formulario={formulario} nombre={nombre} respuestas={respuestas} paso={paso} aviso={aviso} enviando={enviando}
          onResponder={responder} onPaso={cambiarPaso} onEnviar={enviar}
        />
      </>
    );
  }

  return (
    <main className="reporte-pub">
      <div className="reporte-pub__marca">Apicanta<span>.</span></div>
      <div className="reporte-pub__tarjeta">
        {trampaEl}
        {fase === "cargando" && <p className="reporte-pub__sub" role="status">Cargando…</p>}

        {fase === "codigo" && (
          <form className="reporte-pub__form" noValidate onSubmit={(ev) => { ev.preventDefault(); void entrar(codigo.trim()); }}>
            <h1>Reporte semanal</h1>
            <p className="reporte-pub__sub">Pegá tu código para empezar. Está en el mensaje que te mandamos y es siempre el mismo.</p>
            <div className="hk-field">
              <label className="hk-label" htmlFor="rp-codigo">Tu código</label>
              <Input id="rp-codigo" value={codigo} onChange={(e) => { setCodigo(e.target.value); setAviso(null); }} placeholder="Está en el mensaje que te mandamos" autoComplete="off" spellCheck={false} autoFocus error={Boolean(aviso)} />
            </div>
            {aviso && <p className="reporte-pub__error" role="alert">{aviso}</p>}
            <Button type="submit" variante="primary" lg style={{ width: "100%" }}>Continuar</Button>
          </form>
        )}

        {fase === "programa" && (
          <div className="reporte-pub__form">
            <h1>{nombre ? `Hola, ${nombre}` : "Reporte semanal"}</h1>
            <p className="reporte-pub__sub">¿De qué programa es el reporte que vas a completar?</p>
            <div className="opciones opciones--lista">
              {Object.values(FORMULARIOS).map((f, i) => (
                <Opcion key={f.id} tecla={String(i + 1)} nombre={f.programa} activo={false} onClick={() => empezar(f, codigo)} />
              ))}
            </div>
          </div>
        )}

        {fase === "listo" && (
          <div className="reporte-pub__listo" role="status">
            <CheckCircle2 size={44} aria-hidden />
            <h1>¡Listo{nombre ? `, ${nombre}` : ""}!</h1>
            <p>Tu reporte de esta semana quedó guardado.{reemplazo ? " Reemplazó al que habías mandado antes." : ""}</p>
            <p className="reporte-pub__chico">Si te equivocaste en algo, volvé a completarlo: el nuevo reemplaza al de esta semana.</p>
            <Button variante="secondary" onClick={() => { setPaso(1); setFase("preguntas"); }}>Corregir mi reporte</Button>
          </div>
        )}
      </div>
      {formulario && fase === "listo" && <p className="reporte-pub__pie">{formulario.programa}</p>}
    </main>
  );
}

/* ---------- Una pregunta por pantalla ---------- */

function PreguntasPaso({ formulario, nombre, respuestas, paso, aviso, enviando, onResponder, onPaso, onEnviar }: {
  formulario: FormularioReporte; nombre: string; respuestas: Respuestas; paso: number; aviso: string | null; enviando: boolean;
  onResponder: (id: string, valor: string | number) => void; onPaso: (i: number) => void; onEnviar: () => void;
}) {
  /* El paso 0 es la bienvenida; el resto, una pregunta cada uno. */
  const pasos = useMemo(
    () => [{ id: "inicio", titulo: "Inicio" }, ...formulario.preguntas.map((p, i) => ({ id: p.id, titulo: p.etiqueta ?? `Pregunta ${i + 1}` }))],
    [formulario],
  );
  const pregunta = paso > 0 ? formulario.preguntas[paso - 1] : null;
  const problema = enviando ? "Enviando…" : pregunta ? problemaDeRespuesta(pregunta, respuestas[pregunta.id]) : null;

  return (
    <Asistente
      etiqueta={formulario.nombre} pasos={pasos} actual={paso} onCambiarPaso={onPaso} problema={problema}
      onCerrar={() => undefined} sinSalir terminarTexto="Enviar mi reporte" onTerminar={onEnviar}
    >
      {pregunta ? (
        <>
          <Pregunta texto={pregunta.titulo} sub={pregunta.ayuda} />
          <Respuesta pregunta={pregunta} valor={respuestas[pregunta.id]} onCambio={(v) => onResponder(pregunta.id, v)} />
          {aviso && <p className="reporte-pub__error" role="alert">{aviso}</p>}
        </>
      ) : (
        <>
          <Pregunta texto={nombre ? `Hola, ${nombre}` : "Hola"} sub={formulario.saludo} />
          <p className="asistente__sub">Son {formulario.preguntas.length} preguntas y lleva unos minutos. Lo que vas escribiendo se guarda en este navegador hasta que lo envíes.</p>
        </>
      )}
    </Asistente>
  );
}

function Respuesta({ pregunta, valor, onCambio }: { pregunta: PreguntaReporte; valor: string | number | undefined; onCambio: (v: string | number) => void }) {
  const texto = valor === undefined ? "" : String(valor);

  if (pregunta.tipo === "opciones" || pregunta.tipo === "si-no") {
    return (
      <div className="opciones opciones--lista">
        {(pregunta.opciones ?? []).map((o, i) => (
          <Opcion key={o} tecla={String(i + 1)} nombre={o} activo={texto === o} onClick={() => onCambio(o)} />
        ))}
      </div>
    );
  }

  if (pregunta.tipo === "escala") {
    const min = pregunta.min ?? 1, max = pregunta.max ?? 10;
    const valores = Array.from({ length: max - min + 1 }, (_, i) => min + i);
    return (
      <div>
        <div className="reporte-escala" role="group" aria-label={pregunta.titulo}>
          {valores.map((n) => (
            <button key={n} type="button" className="opcion reporte-escala__n" aria-pressed={texto === String(n)} onClick={() => onCambio(n)}>
              {n}
            </button>
          ))}
        </div>
        <div className="reporte-escala__extremos"><span>{min}</span><span>{max}</span></div>
      </div>
    );
  }

  if (pregunta.tipo === "numero") {
    return <Input type="text" inputMode="numeric" value={texto} onChange={(e) => onCambio(e.target.value)} placeholder="0" autoComplete="off" aria-label={pregunta.titulo} />;
  }

  if (pregunta.tipo === "texto-corto") {
    return <Input value={texto} onChange={(e) => onCambio(e.target.value)} maxLength={LARGO_TEXTO_CORTO} placeholder="Tu respuesta" autoComplete="off" aria-label={pregunta.titulo} />;
  }

  return (
    <div>
      <Textarea rows={5} value={texto} onChange={(e) => onCambio(e.target.value)} maxLength={LARGO_TEXTO} placeholder="Escribí tu respuesta" aria-label={pregunta.titulo} />
      <p className="reporte-pub__chico" style={{ margin: "8px 0 0" }}>Enter hace un renglón nuevo. Para seguir, Ctrl + Enter o el botón.</p>
    </div>
  );
}

export default function PaginaReporte() {
  return (
    <Suspense fallback={<main className="reporte-pub"><p className="reporte-pub__sub">Cargando…</p></main>}>
      <Formulario />
    </Suspense>
  );
}
