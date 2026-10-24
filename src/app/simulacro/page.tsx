"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, MailCheck } from "lucide-react";
import { Button, Input } from "@/components/ui/ui";
import { Asistente, Opcion, Pregunta } from "@/components/ui/Asistente";
import { fechaLarga } from "@/lib/format";
import { esCodigoValido } from "@/lib/reporte-enlace";
import { codigoEnTexto, diaDeClase, esMailValido, MSJ_CODIGO_MALO, problemaDeInscripcion, TEXTO_PREPARADO, TIPOS_PEDIDOS } from "@/lib/simulacros";

/* ==================================================================
   Inscripción al simulacro de entrevista de los martes (Lili, 23/10).
   Reemplaza al Google Form: las mismas preguntas, una por pantalla, y la
   inscripción entra directo a la app (Programa → Simulacros).

   Cada alumno entra con SU código, el mismo del reporte semanal (Juan Cruz,
   24/10): el link personal ya lo trae (/simulacro?c=…) y entra derecho; con
   el link general del grupo lo pega, o se lo pide a su mail. Así se sabe
   seguro quién es y no se le pregunta el nombre ni el celular.
   Pública: no pide iniciar sesión.
   ================================================================== */

type Fase = "codigo" | "cargando" | "pedir" | "pedido" | "preguntas" | "listo";
type Datos = { stack: string; tipoPedido: string; preparado: boolean };

const PASOS = [
  { id: "stack", titulo: "Stack" },
  { id: "tipo", titulo: "Entrevista" },
  { id: "preparado", titulo: "Preparación" },
];

function Inscripcion() {
  const params = useSearchParams();
  const delLink = codigoEnTexto(params.get("c") ?? "");
  const [fase, setFase] = useState<Fase>(delLink ? "cargando" : "codigo");
  const [codigo, setCodigo] = useState(delLink);
  const [alumno, setAlumno] = useState<{ nombre: string; fecha: string; ya: boolean } | null>(null);
  const [d, setD] = useState<Datos>({ stack: "", tipoPedido: "", preparado: false });
  const [paso, setPaso] = useState(0);
  const [mail, setMail] = useState("");
  const [trampa, setTrampa] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState<{ fecha: string; otraVez: boolean } | null>(null);
  const [pedido, setPedido] = useState("");
  const ultimo = useRef("");
  const cambiar = (c: Partial<Datos>) => { setD((x) => ({ ...x, ...c })); setAviso(null); };

  /* Con el código se pregunta de quién es: para saludarlo y saber para qué martes se anota. */
  const entrar = useCallback(async (escrito: string) => {
    const c = codigoEnTexto(escrito);
    if (!esCodigoValido(c)) { setAviso(MSJ_CODIGO_MALO); setFase("codigo"); return; }
    ultimo.current = c;
    setAviso(null);
    setFase("cargando");
    try {
      const r = await fetch(`/api/simulacros/inscripcion?c=${encodeURIComponent(c)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; nombre?: string; fecha?: string; ya?: boolean; stack?: string; error?: string };
      if (ultimo.current !== c) return;
      if (!r.ok || !j.ok) { setAviso(j.error ?? MSJ_CODIGO_MALO); setFase("codigo"); return; }
      setCodigo(c);
      setAlumno({ nombre: j.nombre ?? "", fecha: j.fecha ?? "", ya: Boolean(j.ya) });
      if (j.stack) setD((x) => (x.stack ? x : { ...x, stack: j.stack ?? "" }));
      setPaso(0);
      setFase("preguntas");
    } catch {
      if (ultimo.current === c) { setAviso("No hay conexión. Probá de nuevo en un momento."); setFase("codigo"); }
    }
  }, []);

  useEffect(() => {
    if (delLink) void entrar(delLink);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pedirLink = async () => {
    if (enviando) return;
    if (!esMailValido(mail.trim())) { setAviso("Escribí el mail con el que compraste."); return; }
    setEnviando(true);
    try {
      const r = await fetch("/api/simulacros/mi-link", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: mail.trim(), sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensaje?: string; error?: string };
      if (r.ok && j.ok) { setPedido(j.mensaje ?? ""); setFase("pedido"); return; }
      setAviso(j.error ?? "No pudimos mandarte el mail. Probá de nuevo en un rato.");
    } catch {
      setAviso("No hay conexión. Probá de nuevo en un momento.");
    } finally { setEnviando(false); }
  };

  const enviar = async () => {
    if (enviando || problemaDeInscripcion(d)) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/simulacros/inscripcion", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...d, codigo, sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; fecha?: string; otraVez?: boolean; error?: string; campo?: string };
      if (r.ok && j.ok) { setListo({ fecha: j.fecha ?? alumno?.fecha ?? "", otraVez: Boolean(j.otraVez) }); setFase("listo"); return; }
      if (j.campo === "codigo") { setAviso(j.error ?? MSJ_CODIGO_MALO); setFase("codigo"); return; }
      setAviso(j.error ?? "No pudimos anotarte. Probá de nuevo.");
    } catch {
      setAviso("No hay conexión. Probá de nuevo en un momento: lo que elegiste sigue acá.");
    } finally { setEnviando(false); }
  };

  const trampaEl = (
    <div aria-hidden style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
      <input tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} name="sitio" />
    </div>
  );

  if (fase === "preguntas" && alumno) {
    const id = PASOS[paso].id;
    const falta = id === "stack" ? (d.stack.trim() ? null : "Contanos con qué stack trabajás.")
      : id === "tipo" ? (d.tipoPedido ? null : "Elegí qué tipo de entrevista querés.")
        : (d.preparado ? null : "Confirmá que te preparaste.");
    const martes = alumno.fecha ? `del martes ${diaDeClase(alumno.fecha, fechaLarga)}` : "del martes";
    return (
      <>
        {trampaEl}
        <Asistente
          etiqueta="Inscripción al simulacro de entrevista" pasos={PASOS} actual={paso} onCambiarPaso={(i) => { setPaso(i); setAviso(null); }}
          problema={enviando ? "Enviando…" : falta} onCerrar={() => undefined} sinSalir terminarTexto="Anotarme" onTerminar={() => void enviar()}
        >
          {id === "stack" && (
            <>
              <Pregunta texto={`Hola${alumno.nombre ? `, ${alumno.nombre}` : ""}: ¿con qué stack trabajás?`}
                sub={`Te anotás al simulacro de entrevista ${martes}.${alumno.ya ? " Ya estabas anotado: si cambiás algo, se actualiza." : ""} Por ejemplo: React y Node, Java y Spring, Python…`} />
              <Input value={d.stack} onChange={(e) => cambiar({ stack: e.target.value })} placeholder="Tu stack" aria-label="Stack con el que trabajás" maxLength={200} autoFocus />
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

  return (
    <main className="reporte-pub">
      <div className="reporte-pub__marca">Apicanta<span>.</span></div>
      <div className="reporte-pub__tarjeta">
        {trampaEl}
        {fase === "cargando" && <p className="reporte-pub__sub" role="status">Cargando…</p>}

        {fase === "codigo" && (
          <form className="reporte-pub__form" noValidate onSubmit={(ev) => { ev.preventDefault(); void entrar(codigo); }}>
            <h1>Simulacro de entrevista</h1>
            <p className="reporte-pub__sub">Los martes practicamos una entrevista en vivo, con feedback. Para anotarte, pegá tu código: es el mismo del reporte semanal.</p>
            <div className="hk-field">
              <label className="hk-label" htmlFor="sim-codigo">Tu código</label>
              <Input id="sim-codigo" value={codigo} onChange={(e) => { setCodigo(e.target.value); setAviso(null); }} placeholder="Está en el mensaje que te mandamos"
                autoComplete="off" spellCheck={false} autoFocus error={Boolean(aviso)} />
            </div>
            {aviso && <p className="reporte-pub__error" role="alert">{aviso}</p>}
            <Button type="submit" variante="primary" lg style={{ width: "100%" }}>Continuar</Button>
            <Button type="button" variante="ghost" onClick={() => { setAviso(null); setFase("pedir"); }}>No tengo mi código</Button>
          </form>
        )}

        {fase === "pedir" && (
          <form className="reporte-pub__form" noValidate onSubmit={(ev) => { ev.preventDefault(); void pedirLink(); }}>
            <h1>Te mandamos tu link</h1>
            <p className="reporte-pub__sub">Escribí el mail con el que compraste y te llega tu link para anotarte, con tu código adentro.</p>
            <div className="hk-field">
              <label className="hk-label" htmlFor="sim-mail">Tu mail</label>
              <Input id="sim-mail" type="email" value={mail} onChange={(e) => { setMail(e.target.value); setAviso(null); }} placeholder="tu@mail.com"
                autoComplete="email" autoFocus error={Boolean(aviso)} maxLength={200} />
            </div>
            {aviso && <p className="reporte-pub__error" role="alert">{aviso}</p>}
            <Button type="submit" variante="primary" lg style={{ width: "100%" }} cargando={enviando}>Mandarme el link</Button>
            <Button type="button" variante="ghost" onClick={() => { setAviso(null); setFase("codigo"); }}>Ya tengo mi código</Button>
          </form>
        )}

        {fase === "pedido" && (
          <div className="reporte-pub__listo" role="status">
            <MailCheck size={40} aria-hidden style={{ color: "var(--success)" }} />
            <h1>Revisá tu mail</h1>
            <p>{pedido}</p>
            <p className="reporte-pub__chico">Si no te llega, escribile a tu coordinadora y te lo pasa.</p>
          </div>
        )}

        {fase === "listo" && listo && (
          <div className="reporte-pub__listo" role="status">
            <CheckCircle2 size={44} aria-hidden style={{ color: "var(--success)" }} />
            <h1>{listo.otraVez ? "Actualizamos tu inscripción" : `¡Listo${alumno?.nombre ? `, ${alumno.nombre}` : ""}, quedaste anotado!`}</h1>
            <p>Simulacro de entrevista del {listo.fecha ? diaDeClase(listo.fecha, fechaLarga) : "martes"}. ¡Nos vemos en sala!</p>
            <p className="reporte-pub__chico">Si por algo no podés, avisale al equipo así le damos el lugar a otro.</p>
          </div>
        )}
      </div>
    </main>
  );
}

export default function PaginaSimulacro() {
  return (
    <Suspense fallback={<main className="reporte-pub"><p className="reporte-pub__sub">Cargando…</p></main>}>
      <Inscripcion />
    </Suspense>
  );
}
