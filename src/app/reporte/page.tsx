"use client";

import React, { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { Button, Input, Textarea } from "@/components/ui/ui";
import { esCodigoValido } from "@/lib/reporte-enlace";

/* ==================================================================
   El reporte semanal de los alumnos. Una sola página, siempre el mismo link:
   cada alumno entra con su código (el mensaje que le mandamos ya lo trae en
   el link: /reporte?c=…) y completa las cifras de la semana.

   Es pública (no pide iniciar sesión): lo único que abre es el código, un
   UUID al azar. Completarlo de nuevo la misma semana reemplaza el anterior.
   ================================================================== */

type Estado = { tipo: "libre" } | { tipo: "enviando" } | { tipo: "listo"; nombre?: string; reemplazo: boolean } | { tipo: "error"; mensaje: string; campo?: string };

function Formulario() {
  const params = useSearchParams();
  const [codigo, setCodigo] = useState(params.get("c")?.trim() ?? "");
  const [horas, setHoras] = useState("");
  const [entrevistas, setEntrevistas] = useState("");
  const [postulaciones, setPostulaciones] = useState("");
  const [bloqueo, setBloqueo] = useState("");
  const [trampa, setTrampa] = useState("");
  const [nombre, setNombre] = useState<string | null>(null);
  const [codigoMalo, setCodigoMalo] = useState<string | null>(null);
  const [estado, setEstado] = useState<Estado>({ tipo: "libre" });
  const ultimo = useRef("");

  /* Con un código de buena forma se pregunta de quién es, para saludarlo (y avisar enseguida si no existe). */
  useEffect(() => {
    const c = codigo.trim();
    setNombre(null);
    setCodigoMalo(null);
    if (!esCodigoValido(c) || ultimo.current === c) return;
    const parar = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/reportes/enviar?c=${encodeURIComponent(c)}`, { signal: parar.signal });
        const j = (await r.json()) as { ok?: boolean; nombre?: string; error?: string };
        if (r.ok && j.ok) { setNombre(j.nombre ?? ""); ultimo.current = c; } else setCodigoMalo(j.error ?? "No encontramos ese código.");
      } catch { /* sin red: se avisa al enviar */ }
    }, 350);
    return () => { clearTimeout(t); parar.abort(); };
  }, [codigo]);

  const enviar = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (estado.tipo === "enviando") return;
    setEstado({ tipo: "enviando" });
    try {
      const r = await fetch("/api/reportes/enviar", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codigo: codigo.trim(), horas, entrevistas, postulaciones, bloqueo, sitio: trampa }),
      });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; nombre?: string; reemplazo?: boolean; error?: string; campo?: string };
      if (r.ok && j.ok) { setEstado({ tipo: "listo", nombre: j.nombre, reemplazo: Boolean(j.reemplazo) }); return; }
      setEstado({ tipo: "error", mensaje: j.error ?? "No pudimos guardar tu reporte. Probá de nuevo.", campo: j.campo });
    } catch {
      setEstado({ tipo: "error", mensaje: "No hay conexión. Probá de nuevo en un momento." });
    }
  };

  if (estado.tipo === "listo") {
    return (
      <div className="reporte-pub__listo" role="status">
        <CheckCircle2 size={44} aria-hidden />
        <h1>¡Listo{estado.nombre ? `, ${estado.nombre}` : ""}!</h1>
        <p>Tu reporte de esta semana quedó guardado.{estado.reemplazo ? " Reemplazó al que habías mandado antes." : ""}</p>
        <p className="reporte-pub__chico">Si te equivocaste en algo, volvé a completarlo: el nuevo reemplaza al de esta semana.</p>
        <Button variante="secondary" onClick={() => setEstado({ tipo: "libre" })}>Corregir mi reporte</Button>
      </div>
    );
  }

  const campoMalo = (c: string) => estado.tipo === "error" && estado.campo === c;
  return (
    <form className="reporte-pub__form" onSubmit={enviar} noValidate>
      <h1>Reporte semanal</h1>
      <p className="reporte-pub__sub">
        {nombre ? <>Hola, <strong>{nombre}</strong>. </> : null}Contanos cómo te fue esta semana. Son menos de dos minutos.
      </p>

      <div className="hk-field">
        <label className="hk-label" htmlFor="rp-codigo">Tu código</label>
        <Input id="rp-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="Está en el mensaje que te mandamos" autoComplete="off" spellCheck={false} error={campoMalo("codigo") || Boolean(codigoMalo)} />
        {codigoMalo && <span className="hk-help reporte-pub__malo">{codigoMalo}</span>}
      </div>

      <div className="reporte-pub__fila">
        <div className="hk-field">
          <label className="hk-label" htmlFor="rp-horas">Horas de estudio</label>
          <Input id="rp-horas" type="text" inputMode="decimal" value={horas} onChange={(e) => setHoras(e.target.value)} placeholder="0" autoComplete="off" error={campoMalo("horas")} />
        </div>
        <div className="hk-field">
          <label className="hk-label" htmlFor="rp-ent">Entrevistas</label>
          <Input id="rp-ent" type="text" inputMode="numeric" value={entrevistas} onChange={(e) => setEntrevistas(e.target.value)} placeholder="0" autoComplete="off" error={campoMalo("entrevistas")} />
        </div>
        <div className="hk-field">
          <label className="hk-label" htmlFor="rp-post">Postulaciones</label>
          <Input id="rp-post" type="text" inputMode="numeric" value={postulaciones} onChange={(e) => setPostulaciones(e.target.value)} placeholder="0" autoComplete="off" error={campoMalo("postulaciones")} />
        </div>
      </div>

      <div className="hk-field">
        <label className="hk-label" htmlFor="rp-bloqueo">¿Algo te trabó esta semana? <span className="reporte-pub__chico">(opcional)</span></label>
        <Textarea id="rp-bloqueo" rows={3} value={bloqueo} onChange={(e) => setBloqueo(e.target.value)} maxLength={2000} placeholder="Una duda, un tema que no te sale, algo en lo que necesites ayuda" />
      </div>

      {/* El campo trampa para bots: una persona no lo ve. */}
      <div aria-hidden style={{ position: "absolute", left: "-9999px", height: 0, overflow: "hidden" }}>
        <input tabIndex={-1} autoComplete="off" value={trampa} onChange={(e) => setTrampa(e.target.value)} name="sitio" />
      </div>

      {estado.tipo === "error" && <p className="reporte-pub__error" role="alert">{estado.mensaje}</p>}
      <Button type="submit" variante="primary" lg cargando={estado.tipo === "enviando"} style={{ width: "100%" }}>Enviar mi reporte</Button>
    </form>
  );
}

export default function PaginaReporte() {
  return (
    <main className="reporte-pub">
      <div className="reporte-pub__marca">Apicanta<span>.</span></div>
      <div className="reporte-pub__tarjeta">
        <Suspense fallback={<p className="reporte-pub__sub">Cargando…</p>}>
          <Formulario />
        </Suspense>
      </div>
      <p className="reporte-pub__pie">Hackear IT</p>
    </main>
  );
}
