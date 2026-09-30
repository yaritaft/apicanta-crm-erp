"use client";

import React, { useState } from "react";
import { Flag, Pencil, X } from "lucide-react";
import { Button, Input } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { num } from "@/lib/format";
import { agendasDesdeElPitch, isoDelPitch, minutoDelPitch } from "@/lib/pitch";
import type { AgendaDelWebinar } from "@/lib/agendas-webinar";
import type { Webinar } from "@/lib/types";
import { partesArgentina } from "./fechas";
import { guardarWebinar } from "./guardar";

/* ==================================================================
   El pitch de venta, a mano: en el vivo con «Arranca el pitch», después
   escribiendo la hora, y se corrige cuando se quiera (lib/pitch.ts). Va
   en la tarjeta de agendas porque es lo que mide sin YouTube: cuántas de
   las agendas del vivo llegaron desde el pitch. Con video, la curva de
   espectadores lo marca además con su línea.
   ================================================================== */

const MIN = 60_000;

export function MarcaPitch({ w, agendas }: { w: Webinar; agendas?: AgendaDelWebinar[] }) {
  const toast = useToast();
  const [editando, setEditando] = useState(false);
  const [hora, setHora] = useState("");
  const inicio = +new Date(w.fecha);
  /* En el aire según la hora del webinar (con o sin YouTube): se puede marcar "ahora". */
  const enElAire = Date.now() >= inicio - 15 * MIN && Date.now() <= inicio + ((w.duracionMin || 120) + 60) * MIN;
  const nueva = isoDelPitch(w.fecha, hora);

  function marcar(iso: string) {
    const hh = partesArgentina(iso).hora;
    const min = minutoDelPitch(w.fecha, iso);
    guardarWebinar(w, { pitchEn: iso }, `El pitch de «${w.titulo}» ${w.pitchEn ? "pasó a" : "arrancó a"} las ${hh}${min >= 0 ? ` (minuto ${min} del vivo)` : ""}.`);
    toast(`Pitch marcado a las ${hh}.`);
    setEditando(false);
  }

  function empezar() {
    setHora(w.pitchEn ? partesArgentina(w.pitchEn).hora : "");
    setEditando(true);
  }

  if (editando || !w.pitchEn) {
    return (
      <div className="wb-pitch">
        <span className="wb-pitch__titulo"><Flag size={15} aria-hidden />Pitch de venta</span>
        {!editando && (
          <span className="t-sm t-subtle wb-pitch__texto">
            Marcá a qué hora arrancó y se ve cuántos agendaron desde ahí.
          </span>
        )}
        <div
          className="wb-pitch__campos"
          onKeyDown={(ev) => {
            if (ev.key === "Enter" && nueva) { ev.preventDefault(); marcar(nueva); }
            if (ev.key === "Escape" && editando) { ev.preventDefault(); setEditando(false); }
          }}
        >
          {enElAire && !editando && (
            <Button sm variante="primary" icono={<Flag size={14} />} onClick={() => marcar(new Date().toISOString())}>Arranca ahora</Button>
          )}
          <div style={{ width: 116 }}>
            <Input type="time" value={hora} onChange={(ev) => setHora(ev.target.value)} aria-label="Hora del pitch, en Argentina" autoFocus={editando} />
          </div>
          <Button sm variante={enElAire && !editando ? "secondary" : "primary"} disabled={!nueva} onClick={() => nueva && marcar(nueva)}>
            {editando ? "Guardar" : "Marcar"}
          </Button>
          {editando && <Button sm variante="ghost" onClick={() => setEditando(false)}>Cancelar</Button>}
        </div>
      </div>
    );
  }

  const min = minutoDelPitch(w.fecha, w.pitchEn);
  const cuenta = agendas ? agendasDesdeElPitch(agendas, w.pitchEn) : null;
  return (
    <div className="wb-pitch wb-pitch--marcado">
      <span className="wb-pitch__titulo"><Flag size={15} aria-hidden />Pitch a las {partesArgentina(w.pitchEn).hora} hs</span>
      <span className="t-sm t-subtle wb-pitch__texto">
        {min >= 0 ? `Minuto ${num(min)} del vivo` : `${num(-min)} min antes de la hora del webinar`}
        {cuenta && cuenta.delVivo > 0
          ? ` · ${num(cuenta.desde)} de las ${num(cuenta.delVivo)} agendas del vivo llegaron desde ahí`
          : cuenta ? " · todavía no hay agendas del vivo" : ""}
      </span>
      <div className="wb-pitch__campos">
        <Button sm variante="ghost" icono={<Pencil size={14} />} onClick={empezar}>Cambiar la hora</Button>
        <Button sm variante="ghost" icono={<X size={14} />} onClick={() => {
          guardarWebinar(w, { pitchEn: null }, `Se sacó la marca del pitch de «${w.titulo}».`);
          toast("Se sacó la marca del pitch.");
        }}>Sacar</Button>
      </div>
    </div>
  );
}
