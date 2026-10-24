"use client";

import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, MailCheck } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui/ui";
import { Asistente, Pregunta } from "@/components/ui/Asistente";
import { fechaLarga } from "@/lib/format";
import { esCodigoValido } from "@/lib/reporte-enlace";
import { diaDeClase } from "@/lib/simulacros";
import { codigoEnTexto, esMailValido, MSJ_CODIGO_MALO } from "@/lib/links-alumno";
import { problemaDeConsulta } from "@/lib/consultas";

/* ==================================================================
   La consulta de los jueves (Lili, 24/10). Reemplaza al Google Form: el
   alumno que no puede ir a la clase deja su consulta acá, Yari la responde
   al comienzo de la clase y él mira la grabación.

   Entra con SU código, el mismo del reporte semanal: el link personal ya lo
   trae (/consulta?c=…); con el link general lo pega o se lo pide a su mail.
   Así no se le pregunta el nombre, el mail ni el celular.
   Pública: no pide iniciar sesión.
   ================================================================== */

type Fase = "codigo" | "cargando" | "pedir" | "pedido" | "consulta" | "listo";
const PASOS = [{ id: "consulta", titulo: "Tu consulta" }];

function Formulario() {
  const params = useSearchParams();
  const delLink = codigoEnTexto(params.get("c") ?? "");
  const [fase, setFase] = useState<Fase>(delLink ? "cargando" : "codigo");
  const [codigo, setCodigo] = useState(delLink);
  const [alumno, setAlumno] = useState<{ nombre: string; fecha: string; cuantas: number } | null>(null);
  const [consulta, setConsulta] = useState("");
  const [mail, setMail] = useState("");
  const [trampa, setTrampa] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState("");
  const ultimo = useRef("");

  /* Con el código se pregunta de quién es: para saludarlo y decirle en qué clase se responde. */
  const entrar = useCallback(async (escrito: string) => {
    const c = codigoEnTexto(escrito);
    if (!esCodigoValido(c)) { setAviso(MSJ_CODIGO_MALO); setFase("codigo"); return; }
    ultimo.current = c;
    setAviso(null);
    setFase("cargando");
    try {
      const r = await fetch(`/api/consultas/enviar?c=${encodeURIComponent(c)}`, { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; nombre?: string; fecha?: string; cuantas?: number; error?: string };
      if (ultimo.current !== c) return;
      if (!r.ok || !j.ok) { setAviso(j.error ?? MSJ_CODIGO_MALO); setFase("codigo"); return; }
      setCodigo(c);
      setAlumno({ nombre: j.nombre ?? "", fecha: j.fecha ?? "", cuantas: j.cuantas ?? 0 });
      setFase("consulta");
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
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: mail.trim(), para: "consulta", sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; mensaje?: string; error?: string };
      if (r.ok && j.ok) { setPedido(j.mensaje ?? ""); setFase("pedido"); return; }
      setAviso(j.error ?? "No pudimos mandarte el mail. Probá de nuevo en un rato.");
    } catch {
      setAviso("No hay conexión. Probá de nuevo en un momento.");
    } finally { setEnviando(false); }
  };

  const enviar = async () => {
    if (enviando || problemaDeConsulta(consulta)) return;
    setEnviando(true);
    try {
      const r = await fetch("/api/consultas/enviar", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codigo, consulta: consulta.trim(), sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; fecha?: string; error?: string; campo?: string };
      if (r.ok && j.ok) { setAlumno((a) => (a ? { ...a, fecha: j.fecha ?? a.fecha, cuantas: a.cuantas + 1 } : a)); setFase("listo"); return; }
      if (j.campo === "codigo") { setAviso(j.error ?? MSJ_CODIGO_MALO); setFase("codigo"); return; }
      setAviso(j.error ?? "No pudimos guardar tu consulta. Probá de nuevo.");
    } catch {
      setAviso("No hay conexión. Probá de nuevo en un momento: lo que escribiste sigue acá.");
    } finally { setEnviando(false); }
  };

  const trampaEl = (
    <div aria-hidden style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
      <input tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} name="sitio" />
    </div>
  );
  const jueves = alumno?.fecha ? `del jueves ${diaDeClase(alumno.fecha, fechaLarga)}` : "del jueves";

  if (fase === "consulta" && alumno) {
    return (
      <>
        {trampaEl}
        <Asistente
          etiqueta="Tu consulta para la clase del jueves" pasos={PASOS} actual={0} onCambiarPaso={() => undefined}
          problema={enviando ? "Enviando…" : problemaDeConsulta(consulta)} onCerrar={() => undefined} sinSalir terminarTexto="Enviar consulta" onTerminar={() => void enviar()}
        >
          <Pregunta texto={`Hola${alumno.nombre ? `, ${alumno.nombre}` : ""}: ¿cuál es tu consulta?`}
            sub={`Yari la responde al comienzo de la clase ${jueves} (18 h de Argentina). Si no podés venir, mirá la grabación para escuchar la respuesta.${alumno.cuantas ? ` Ya dejaste ${alumno.cuantas === 1 ? "una consulta" : `${alumno.cuantas} consultas`} para esa clase: esta se suma.` : ""}`} />
          <Textarea rows={7} value={consulta} onChange={(e) => { setConsulta(e.target.value); setAviso(null); }} aria-label="Tu consulta" maxLength={3000} autoFocus
            placeholder="Contá tu duda con el mayor detalle posible: qué estás haciendo, qué probaste y dónde te trabaste." />
          <p className="reporte-pub__chico" style={{ margin: "8px 0 0" }}>Enter hace un renglón nuevo. Para mandarla, Ctrl + Enter o el botón.</p>
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
            <h1>¿No podés venir el jueves?</h1>
            <p className="reporte-pub__sub">Dejá tu consulta: Yari la responde al comienzo de la clase y la ves en la grabación. Para empezar, pegá tu código: es el mismo del reporte semanal.</p>
            <div className="hk-field">
              <label className="hk-label" htmlFor="cq-codigo">Tu código</label>
              <Input id="cq-codigo" value={codigo} onChange={(e) => { setCodigo(e.target.value); setAviso(null); }} placeholder="Está en el mensaje que te mandamos"
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
            <p className="reporte-pub__sub">Escribí el mail con el que compraste y te llega tu link para dejar consultas, con tu código adentro.</p>
            <div className="hk-field">
              <label className="hk-label" htmlFor="cq-mail">Tu mail</label>
              <Input id="cq-mail" type="email" value={mail} onChange={(e) => { setMail(e.target.value); setAviso(null); }} placeholder="tu@mail.com"
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

        {fase === "listo" && (
          <div className="reporte-pub__listo" role="status">
            <CheckCircle2 size={44} aria-hidden style={{ color: "var(--success)" }} />
            <h1>¡Listo{alumno?.nombre ? `, ${alumno.nombre}` : ""}, recibimos tu consulta!</h1>
            <p>Yari la responde al comienzo de la clase {jueves}. Mirá la grabación para escuchar la respuesta.</p>
            <Button variante="secondary" onClick={() => { setConsulta(""); setAviso(null); setFase("consulta"); }}>Dejar otra consulta</Button>
          </div>
        )}
      </div>
    </main>
  );
}

export default function PaginaConsulta() {
  return (
    <Suspense fallback={<main className="reporte-pub"><p className="reporte-pub__sub">Cargando…</p></main>}>
      <Formulario />
    </Suspense>
  );
}
