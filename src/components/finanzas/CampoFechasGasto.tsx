"use client";

import React, { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import { Chip, Input, Select } from "@/components/ui/ui";
import { AvisoMesCerrado } from "@/components/ui/AvisoMesCerrado";
import { isoDia } from "@/lib/format";
import { periodoDeFecha } from "@/lib/periodos";
import {
  alElegirMes, conOtraFechaDePago, mediodia, mesesParaElegir, pasarAlMes, resumenDeFechas, sinOtraFechaDePago,
  type BorradorGasto, type ProblemasGasto,
} from "@/lib/carga-gasto";

/* ==================================================================
   Las fechas de un gasto, en el asistente (paso «Fecha» y revisión).

   Casi siempre se paga el mismo día que se genera el gasto, y hay una sola
   fecha. Pero un gasto de septiembre que se paga el 2 de octubre (el contador,
   por ejemplo) resta del estado de resultados de septiembre y sale de la caja
   en octubre: «Es de otro mes o se pagó otro día» abre las dos.

   - Mes al que corresponde: decide en qué mes resta del estado de resultados.
   - Día que se pagó: decide cuándo sale de la caja y del arqueo.

   Si el mes al que corresponde ya tiene la liquidación cerrada se avisa (no
   se bloquea) y se ofrece pasarlo al mes que sigue sin mover la plata.
   ================================================================== */

type Poner = (cambios: Partial<BorradorGasto>) => void;

/* Lo que devuelve el calendario («2026-10-07») queda al mediodía, como el resto de las fechas. */
const fechaDelCalendario = (dia: string) => new Date(`${dia}T12:00:00`).toISOString();

function atajosDeFecha() {
  const hoy = new Date();
  return [
    { texto: "Hoy", fecha: mediodia(hoy) },
    { texto: "Ayer", fecha: mediodia(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1)) },
    { texto: "El 1 de este mes", fecha: mediodia(new Date(hoy.getFullYear(), hoy.getMonth(), 1)) },
  ];
}

export function CampoFechasGasto({ b, set, problemas, id = "gasto" }: {
  b: BorradorGasto;
  set: Poner;
  problemas?: ProblemasGasto;
  /* Para que los casilleros de la revisión y del paso no repitan id. */
  id?: string;
}) {
  const dos = b.fechaPago !== "";
  const atajos = atajosDeFecha();
  const meses = useMemo(() => mesesParaElegir(b.fecha), [b.fecha]);

  return (
    <div className="gasto-fechas">
      {!dos ? (
        <div className="hk-field">
          <label className="hk-label" htmlFor={`${id}-fecha`}>Fecha</label>
          <Input
            id={`${id}-fecha`} type="date" value={isoDia(b.fecha)} aria-label="Fecha del gasto"
            error={Boolean(problemas?.fecha)}
            onChange={(ev) => { if (ev.target.value) set({ fecha: fechaDelCalendario(ev.target.value) }); }}
          />
          <div className="row-wrap">
            {atajos.map((a) => (
              <Chip key={a.texto} activo={isoDia(b.fecha) === isoDia(a.fecha)} onClick={() => set({ fecha: a.fecha })}>{a.texto}</Chip>
            ))}
          </div>
          <button type="button" className="link t-sm gasto-fechas__otra" onClick={() => set(conOtraFechaDePago(b))}>
            <CalendarClock size={14} aria-hidden /> Es de otro mes o se pagó otro día
          </button>
        </div>
      ) : (
        <div className="gasto-fechas__dos">
          <div className="hk-field">
            <label className="hk-label" htmlFor={`${id}-mes`}>Mes al que corresponde</label>
            <Select
              id={`${id}-mes`} value={periodoDeFecha(b.fecha)}
              onChange={(ev) => { if (ev.target.value) set(alElegirMes(b, ev.target.value)); }}
              opciones={meses.map((m) => ({ valor: m.valor, texto: m.texto }))}
            />
            <span className="hk-help">Decide en qué mes resta del estado de resultados.</span>
          </div>
          <div className="hk-field">
            <label className="hk-label" htmlFor={`${id}-pago`}>Día que se pagó</label>
            <Input
              id={`${id}-pago`} type="date" value={isoDia(b.fechaPago)} aria-label="Día que se pagó el gasto"
              error={Boolean(problemas?.fechaPago)}
              onChange={(ev) => { if (ev.target.value) set({ fechaPago: fechaDelCalendario(ev.target.value) }); }}
            />
            <div className="row-wrap">
              {atajos.map((a) => (
                <Chip key={a.texto} activo={isoDia(b.fechaPago) === isoDia(a.fecha)} onClick={() => set({ fechaPago: a.fecha })}>{a.texto}</Chip>
              ))}
            </div>
            <span className="hk-help">Decide cuándo sale de la caja y del arqueo.</span>
          </div>
          <p className="gasto-fechas__resumen t-sm t-subtle">
            {resumenDeFechas(b)}{" "}
            <button type="button" className="link" onClick={() => set(sinOtraFechaDePago(b))}>Es una sola fecha</button>
          </p>
        </div>
      )}

      <AvisoMesCerrado fecha={b.fecha} que="gasto" onPasar={(fecha) => set(pasarAlMes(b, fecha))} />
    </div>
  );
}
