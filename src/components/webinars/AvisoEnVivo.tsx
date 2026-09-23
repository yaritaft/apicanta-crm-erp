"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { num } from "@/lib/format";
import { acciones, useEstado } from "@/lib/store";
import type { Webinar } from "@/lib/types";
import { useEnVivo } from "./useVivo";
import "./vivo.css";

/* ==================================================================
   El aviso de la lista de webinars cuando uno está en el aire.

   Lo sabe el cron, que mira YouTube cada minuto: nadie tiene que cambiar
   el estado a mano. Si el webinar en memoria todavía dice "Programado",
   se pasa a "En vivo" acá también (la base ya lo hizo el cron), así el
   filtro "En vivo" lo muestra sin recargar la página.
   ================================================================== */

export function AvisoEnVivo() {
  const e = useEstado();
  const r = useEnVivo();
  const vivos = r.estado === "listo" ? r.datos.vivos : [];

  useEffect(() => {
    for (const v of vivos) {
      const w = e.webinars.find((x) => x.id === v.webinarId);
      if (w && (w.estado === "programado" || w.estado === "borrador")) {
        acciones.actualizarSilencioso<Webinar>("webinars", w.id, { estado: "en-vivo" });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sólo cuando cambia la lista de vivos
  }, [vivos.map((v) => v.webinarId).join(",")]);

  if (vivos.length === 0) return null;
  return (
    <div className="stack-2">
      {vivos.map((v) => {
        const w = e.webinars.find((x) => x.id === v.webinarId);
        return (
          <Link key={v.videoId} href={`/webinars/${encodeURIComponent(v.webinarId)}`} className="vivo-aviso">
            <span className="vivo-etiqueta"><span className="vivo-punto" aria-hidden />En vivo ahora</span>
            <span className="t-strong" style={{ flex: 1, minWidth: 200 }}>{w?.titulo ?? "Un webinar"}</span>
            {v.espectadores !== undefined && <span className="t-sm t-muted t-num">{num(v.espectadores)} mirando</span>}
            <span className="row t-sm" style={{ gap: 4, color: "var(--brand)" }}>Ver en vivo<ArrowRight size={15} /></span>
          </Link>
        );
      })}
    </div>
  );
}
