"use client";

import React from "react";
import { Select } from "@/components/ui/ui";
import { vistaDePanel } from "@/lib/mi-panel";
import type { MiembroEquipo } from "@/lib/types";

/* ==================================================================
   «Ver el panel de…» (de Blue OS: la barra de impersonación). Un dueño elige
   de quién mirarlo y ve lo mismo que vería esa persona. Dos reglas que Blue
   aprendió caro: nunca se puede estar mirando el panel de otro sin que lo
   diga con todas las letras, y es sólo para mirar. Los controles de
   escritura (disputar, la meta) directamente no se dibujan: no van
   deshabilitados.
   ================================================================== */

const ROL: Record<string, string> = { closer: "closer", setter: "setter", director: "director", servicio: "servicio" };

export function BarraVerComo({ candidatos, elegido, yoId, viendoOtro, onElegir }: {
  candidatos: MiembroEquipo[];
  elegido: MiembroEquipo;
  yoId?: string;
  viendoOtro: boolean;
  onElegir: (id: string | null) => void;
}) {
  return (
    <div className={`mp-vercomo${viendoOtro ? " mp-vercomo--otro" : ""}`} role="group" aria-label="Ver el panel de otra persona">
      <span className="mp-cap" style={{ whiteSpace: "nowrap" }}>{viendoOtro ? "Viendo el panel de" : "Ver el panel de"}</span>
      <div className="mp-vercomo__select">
        <Select
          aria-label="Persona"
          value={elegido.id}
          onChange={(ev) => onElegir(ev.target.value === yoId ? null : ev.target.value)}
          opciones={candidatos.map((x) => ({ valor: x.id, texto: `${x.nombre} · ${ROL[vistaDePanel(x)] ?? x.rol}` }))}
        />
      </div>
      <span className="mp-vercomo__texto">
        {viendoOtro
          ? <>Estás mirando números que no son tuyos, tal cual los ve <b>{elegido.nombre}</b>. Es sólo para mirar: no podés escribir nada desde acá.</>
          : "Elegí a cualquiera del equipo para ver su panel tal cual lo ve."}
      </span>
    </div>
  );
}
