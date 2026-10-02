"use client";

import React, { useState } from "react";
import { CalendarDays, ClipboardCheck, ExternalLink, Pencil } from "lucide-react";
import { Button, Empty } from "@/components/ui/ui";
import { Eod } from "@/components/crm-tabla/Eod";
import { textoFecha } from "@/components/crm-tabla/FiltroColumna";
import { EstadoEditable } from "@/components/estados/EstadoLlamada";
import type { FilaTabla } from "@/lib/crm-tabla";
import type { Persona } from "@/lib/persona";
import type { Grabacion } from "@/lib/fathom";
import { GrabacionFathom, useGrabaciones } from "./GrabacionFathom";
import { PerfilPersona } from "./PerfilPersona";

/* ==================================================================
   La ficha, vista Llamadas: cada llamada de esta persona con sus dos
   estados (los mismos del CRM, la Agenda y el cierre del día: se cambian
   acá con un clic y cambian en todos lados), la objeción, si hubo oferta,
   para cuándo se estima el cierre, la grabación y las notas. La que ya
   pasó y nadie cargó se carga desde acá (el mismo EOD, para esa sola). Si
   Fathom la grabó, abajo va lo suyo: el resumen, los accionables y la
   transcripción (GrabacionFathom).

   Arriba, quién es (PerfilPersona): cada dato una sola vez en la ficha.
   De dónde vino está a la izquierda (FichaPersona, Lateral).
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

export function VistaLlamadas({ p, filas }: { p: Persona; /* Sus llamadas, de la más nueva a la más vieja. */ filas: FilaTabla[] }) {
  const [cargar, setCargar] = useState<string | null>(null);
  const { porSesion } = useGrabaciones(filas.map((f) => f.id));

  if (p.sesiones.length === 0) {
    return (
      <div className="stack-5 ficha-ll">
        <PerfilPersona p={p} filas={filas} />
        <Empty icono={<CalendarDays size={22} />} titulo="Todavía no agendó"
          texto="Cuando agende por Calendly, acá aparece cada llamada con cómo terminó." />
      </div>
    );
  }

  return (
    <div className="stack-4 ficha-ll">
      <PerfilPersona p={p} filas={filas} />
      <span className="t-label">Llamadas ({filas.length})</span>
      {filas.map((f) => <Llamada key={f.id} f={f} grabaciones={porSesion.get(f.id) ?? []} onCargar={() => setCargar(f.id)} />)}
      {cargar && <Eod soloSesionId={cargar} onCerrar={() => setCargar(null)} />}
    </div>
  );
}

function Llamada({ f, grabaciones, onCargar }: { f: FilaTabla; grabaciones: Grabacion[]; onCargar: () => void }) {
  /* Con algo cargado se puede completar o corregir lo del cierre del día. */
  const cargable = f.sinCargar || Boolean(f.sesion.estadoLlamada || f.sesion.estadoPreCall);
  const detalles: [string, React.ReactNode][] = ([
    ["Objeción", f.objecion],
    ["¿Hizo la oferta?", f.oferta],
    ["Cierre estimado", f.cierre ? textoFecha(f.cierre) : ""],
    ["Venta", f.venta ? <span className="crm-t__venta">{f.venta}</span> : ""],
    /* Con Fathom, el link va en su bloque de abajo. */
    ["Grabación", f.grabacion && grabaciones.length === 0 ? <a className="link" href={f.grabacion} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Verla</a> : ""],
  ] as [string, React.ReactNode][]).filter(([, v]) => v);
  return (
    <article className="ficha-ll__llamada">
      <header className="ficha-ll__cabeza">
        <span className="stack-1" style={{ minWidth: 0 }}>
          <span className="t-strong t-num">{textoFecha(f.dia)} · {HORA.format(new Date(f.llamada))} hs</span>
          <span className="t-sm t-subtle truncate">{[f.closer, f.via].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="spacer" />
        <span className="ficha-ll__estados">
          <EstadoEditable sesion={f.sesion} campo="estadoPreCall" vacio="Pre-Call" />
          <EstadoEditable sesion={f.sesion} campo="estadoLlamada" conVenta={Boolean(f.venta)} />
        </span>
      </header>
      {detalles.length > 0 && (
        <dl className="ficha-ll__detalle">
          {detalles.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
      {f.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{f.notas}</p>}
      {grabaciones.map((g) => <GrabacionFathom key={g.id} g={g} />)}
      {cargable && (
        <div>
          <Button sm variante={f.sinCargar ? "primary" : "ghost"} icono={f.sinCargar ? <ClipboardCheck size={14} /> : <Pencil size={14} />} onClick={onCargar}>
            {f.sinCargar ? "Cargar cómo terminó" : "Completar o corregir"}
          </Button>
        </div>
      )}
    </article>
  );
}
