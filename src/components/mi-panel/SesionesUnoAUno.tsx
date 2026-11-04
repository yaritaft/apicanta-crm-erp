"use client";

import React from "react";
import { CalendarCheck } from "lucide-react";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fechaLarga, hora } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import type { SesionUnoAUnoQueViene } from "@/lib/mi-panel";

/* ==================================================================
   «Tus sesiones 1 a 1» en Mi panel (Lili, 04/11: «si esto se le puede
   avisar a Yari en su panel sería ideal»). Las que vienen, de quien las
   da como mentor: con quién, cuándo y cuántas lleva de su contrato. El
   nombre abre la ficha del alumno en Bonos. Sin ninguna, no se muestra.
   ================================================================== */

export function SesionesUnoAUno({ sesiones, ahora }: { sesiones: SesionUnoAUnoQueViene[]; ahora: number }) {
  const abrirFicha = useAbrirFicha();
  if (sesiones.length === 0) return null;
  const hoy = diaDeNegocio(new Date(ahora).toISOString());
  return (
    <section className="mp-card mp-llamadas" aria-label="Tus sesiones 1 a 1">
      <div className="mp-cap-fila"><span className="mp-cap"><CalendarCheck size={14} aria-hidden /> Tus sesiones 1 a 1</span><span className="mp-cuenta">{sesiones.length}</span></div>
      <span className="mp-nota" style={{ marginTop: 2 }}>Las que agendaron con vos por Calendly. Ya están en la ficha de cada alumno, en Bonos.</span>
      <ul className="mp-llamadas__lista">
        {sesiones.map(({ sesion: s, alumno, numero, incluidas }) => {
          const esHoy = diaDeNegocio(s.inicia) === hoy;
          const nombre = alumno?.nombre || s.invitado || "Sin nombre";
          return (
            <li key={s.id} className="mp-llamada mp-llamada--1a1">
              <div className="mp-llamada__quien">
                {alumno
                  ? <button type="button" className="link t-strong" onClick={() => abrirFicha(alumno.id, "servicio", { hoja: "bonos" })}>{nombre}</button>
                  : <span className="t-strong">{nombre}</span>}
                <span className={`hs-chip${esHoy ? " hs-chip--ok" : ""}`}>{esHoy ? `Hoy ${hora(s.inicia)}` : `${fechaLarga(s.inicia)} · ${hora(s.inicia)}`}</span>
              </div>
              <span className="t-sm mp-llamada__falta">
                {!alumno ? "No encontramos un alumno con este mail: no quedó en ninguna ficha."
                  : incluidas && incluidas > 0 ? numero > incluidas ? `Es la ${numero}.ª: su contrato incluye ${incluidas}.` : `Es la ${numero} de ${incluidas} que incluye su contrato.`
                    : "Su contrato no dice cuántas sesiones incluye."}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
