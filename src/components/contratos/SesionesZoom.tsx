"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Video } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { nube } from "@/lib/supabase";
import { cabeceras } from "@/components/webinars/useYoutube";
import { formatoDia, hoyDelNegocio } from "@/lib/seguimiento";
import { resumirAsistencia, type AsistenciaZoom, type ClaseZoom } from "@/lib/zoom-asistencia";
import { BloqueServicio, FilaServicio } from "@/components/ficha/FilaServicio";

/* ==================================================================
   Las sesiones de Zoom de un alumno (Yari, 22/10): a cuántas clases entró,
   cuáles y cuántos minutos estuvo. Sirve para ver si está activo en el
   servicio y como argumento cuando dice «yo fui a todas» (la garantía pide
   haber ido al 70% de las clases).

   Lo trae lib/zoom-asistencia-servidor.ts cada hora; acá se lee de las dos
   tablas (supabase/asistencias-zoom.sql) por el mail del alumno. «Traer
   ahora» corre lo mismo sin esperar la hora.
   ================================================================== */

export function SesionesZoom({ email, desde }: { email: string; desde?: string }) {
  const toast = useToast();
  const [datos, setDatos] = useState<{ clases: ClaseZoom[]; asistencias: AsistenciaZoom[] } | "sin-tablas" | null>(null);
  const [trayendo, setTrayendo] = useState(false);
  const correo = email.trim().toLowerCase();

  const leer = useCallback(async () => {
    if (!nube) { setDatos("sin-tablas"); return; }
    const [c, a] = await Promise.all([
      nube.from("asistencias_zoom_clases").select("*").order("inicio", { ascending: false }).limit(300),
      correo ? nube.from("asistencias_zoom").select("*").eq("email", correo).order("inicio", { ascending: false }).limit(300) : Promise.resolve({ data: [], error: null }),
    ]);
    if (c.error || a.error) { setDatos("sin-tablas"); return; }
    setDatos({ clases: (c.data ?? []) as ClaseZoom[], asistencias: (a.data ?? []) as AsistenciaZoom[] });
  }, [correo]);
  useEffect(() => { void leer(); }, [leer]);

  async function traerAhora() {
    setTrayendo(true);
    try {
      const r = await fetch("/api/zoom/asistencia", { method: "POST", cache: "no-store", headers: await cabeceras() });
      const j = (await r.json().catch(() => ({}))) as { clases?: number; personas?: number; errores?: string[]; permiso?: string; error?: string };
      if (!r.ok) toast(j.error ?? `No se pudo traer (error ${r.status}).`, "err");
      else if (j.errores?.length) toast(j.permiso ?? j.errores[0], "err");
      else toast(j.clases ? `Listo: ${j.clases} ${j.clases === 1 ? "clase nueva" : "clases nuevas"}.` : "Está al día: no hay clases nuevas para traer.");
    } catch { toast("No se pudo hablar con el servidor.", "err"); }
    setTrayendo(false);
    await leer();
  }

  const r = useMemo(() => (datos && datos !== "sin-tablas" ? resumirAsistencia(datos.clases, datos.asistencias, { desde }) : null), [datos, desde]);
  const hoy = hoyDelNegocio();

  const boton = (
    <Button sm variante="ghost" icono={<RefreshCw size={14} />} cargando={trayendo} onClick={() => void traerAhora()}>Traer ahora</Button>
  );

  if (datos === null) return <div className="skeleton" style={{ height: 96, borderRadius: 12 }} />;
  if (datos === "sin-tablas" || !r) {
    return (
      <BloqueServicio titulo="Sesiones de Zoom" extra={boton}>
        <p className="hs-nada">Todavía no está activada la asistencia a las clases de Zoom.</p>
      </BloqueServicio>
    );
  }
  if (r.deClases === 0) {
    return (
      <BloqueServicio titulo="Sesiones de Zoom" extra={boton}>
        <p className="hs-nada">Todavía no se trajo ninguna clase de Zoom. Se traen solas cada hora; con «Traer ahora» se piden en el momento.</p>
      </BloqueServicio>
    );
  }
  const porcentaje = Math.round((r.asistio / r.deClases) * 100);
  return (
    <BloqueServicio
      titulo="Sesiones de Zoom"
      extra={<span className="row-wrap" style={{ gap: 6 }}>
        <Badge variante={r.asistio === 0 ? "danger" : porcentaje >= 70 ? "success" : "warning"}>Asistió a {r.asistio} de {r.deClases}</Badge>
        {boton}
      </span>}
    >
      <FilaServicio icono={<Video size={15} />} rotulo="Asistencia" detalle={desde ? `Clases desde el ${formatoDia(desde.slice(0, 10), hoy)}` : "Todas las clases que se trajeron"}>
        <span className="t-num">{porcentaje}% · {r.minutos} min en total</span>
      </FilaServicio>
      <FilaServicio rotulo="Última vez que entró" icono={<Video size={15} />}>
        {r.lista.find((x) => x.fue)
          ? <span className="t-num">{formatoDia(r.lista.find((x) => x.fue)!.inicio.slice(0, 10), hoy)}</span>
          : <span className="hs-guion">Nunca entró a una clase</span>}
      </FilaServicio>
      {r.lista.slice(0, 12).map((x) => (
        <FilaServicio key={x.instancia} icono={<Video size={15} />} rotulo={x.tema || "Clase"} detalle={formatoDia(x.inicio.slice(0, 10), hoy)}>
          {x.fue ? <Badge variante="success">Entró · {Math.round(x.minutos)} min</Badge> : <Badge variante="neutral">No entró</Badge>}
        </FilaServicio>
      ))}
      {r.lista.length > 12 && <p className="hs-nada">Y {r.lista.length - 12} clases más, anteriores.</p>}
    </BloqueServicio>
  );
}
