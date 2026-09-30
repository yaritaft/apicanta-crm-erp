"use client";

import React, { useMemo, useState } from "react";
import { CalendarDays, ClipboardCheck, ExternalLink, Pencil, Star } from "lucide-react";
import { Badge, Button, Empty } from "@/components/ui/ui";
import { Eod } from "@/components/crm-tabla/Eod";
import { textoFecha } from "@/components/crm-tabla/FiltroColumna";
import { VARIANTE_RESULTADO } from "@/components/crm-tabla/resultado";
import { filasTabla, type FilaTabla } from "@/lib/crm-tabla";
import type { Persona } from "@/lib/persona";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   La ficha, vista Llamadas: lo del CRM de esta persona, ordenado.

   Arriba, quién es (lo que contestó al agendar) y de dónde vino. Abajo,
   cada llamada con cómo terminó: el resultado, la objeción, si hubo
   oferta, para cuándo se estima el cierre, la grabación y las notas. La
   que ya pasó y nadie cargó se carga desde acá (el mismo EOD, para esa
   llamada sola).
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });

/* El primer valor que no esté vacío, de la llamada más nueva a la más vieja. */
const primero = (filas: FilaTabla[], f: (x: FilaTabla) => string) => filas.map(f).find((v) => v) ?? "";

export function VistaLlamadas({ e, p }: { e: EstadoApp; p: Persona }) {
  const [cargar, setCargar] = useState<string | null>(null);
  const filas = useMemo(() => {
    const ids = new Set(p.sesiones.map((s) => s.id));
    return filasTabla(e).filter((f) => ids.has(f.id)).sort((a, b) => b.llamada.localeCompare(a.llamada));
  }, [e, p.sesiones]);

  if (p.sesiones.length === 0) {
    return (
      <Empty icono={<CalendarDays size={22} />} titulo="Todavía no agendó"
        texto="Cuando agende por Calendly, acá aparece cada llamada con todo lo que contestó y cómo terminó." />
    );
  }

  const perfil: [string, string][] = ([
    ["País", primero(filas, (f) => f.pais) || p.pais || ""],
    ["Edad", primero(filas, (f) => f.edad)],
    ["Tecnologías", primero(filas, (f) => f.tecnologias.join(", "))],
    ["Inglés", primero(filas, (f) => f.ingles)],
    ["Experiencia", primero(filas, (f) => f.experiencia)],
    ["Formación", primero(filas, (f) => f.formacion.join(", "))],
    ["Gana por mes", primero(filas, (f) => f.ingreso)],
    ["Puede invertir", primero(filas, (f) => f.inversion)],
  ] as [string, string][]).filter(([, v]) => v);
  const calificada = filas.some((f) => f.calificada === "Sí");
  const ad = primero(filas, (f) => f.ad);
  const campania = primero(filas, (f) => f.campania);
  const vias = [...new Set(filas.map((f) => f.via).filter(Boolean))];

  return (
    <div className="stack-5 ficha-ll">
      <section className="ficha-ll__bloque">
        <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="t-label">Quién es</span>
          {calificada && <Badge variante="warning"><Star size={12} fill="currentColor" />Agenda calificada</Badge>}
        </div>
        {perfil.length === 0 ? (
          <p className="t-sm t-subtle">No contestó el formulario de Calendly.</p>
        ) : (
          <dl className="ficha-ll__datos">
            {perfil.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd title={v}>{v}</dd></div>))}
          </dl>
        )}
      </section>

      <section className="ficha-ll__bloque">
        <span className="t-label">De dónde vino</span>
        <dl className="ficha-ll__datos">
          <div><dt>Por qué vía agendó</dt><dd>{vias.join(" · ") || "—"}</dd></div>
          <div><dt>Ad</dt><dd title={ad}>{ad || "—"}</dd></div>
          {campania && <div><dt>Campaña</dt><dd title={campania}>{campania}</dd></div>}
        </dl>
      </section>

      <section className="stack-3">
        <span className="t-label">Llamadas ({filas.length})</span>
        {filas.map((f) => <Llamada key={f.id} f={f} onCargar={() => setCargar(f.id)} />)}
      </section>

      {cargar && <Eod soloSesionId={cargar} onCerrar={() => setCargar(null)} />}
    </div>
  );
}

function Llamada({ f, onCargar }: { f: FilaTabla; onCargar: () => void }) {
  const cargable = f.sinCargar || f.sesion.resultado;
  const detalles: [string, React.ReactNode][] = ([
    ["Objeción", f.objecion],
    ["¿Hizo la oferta?", f.oferta],
    ["Cierre estimado", f.cierre ? textoFecha(f.cierre) : ""],
    ["Venta", f.venta ? <span className="crm-t__venta">{f.venta}</span> : ""],
    ["Grabación", f.grabacion ? <a className="link" href={f.grabacion} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} /> Verla</a> : ""],
  ] as [string, React.ReactNode][]).filter(([, v]) => v);
  return (
    <article className="ficha-ll__llamada">
      <header className="ficha-ll__cabeza">
        <span className="stack-1" style={{ minWidth: 0 }}>
          <span className="t-strong t-num">{textoFecha(f.dia)} · {HORA.format(new Date(f.llamada))} hs</span>
          <span className="t-sm t-subtle truncate">{[f.closer, f.via].filter(Boolean).join(" · ")}</span>
        </span>
        <span className="spacer" />
        <Badge variante={VARIANTE_RESULTADO[f.resultado] ?? "neutral"}>{f.resultado}</Badge>
      </header>
      {detalles.length > 0 && (
        <dl className="ficha-ll__detalle">
          {detalles.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      )}
      {f.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>{f.notas}</p>}
      {cargable && (
        <div>
          <Button sm variante={f.sinCargar ? "primary" : "ghost"} icono={f.sinCargar ? <ClipboardCheck size={14} /> : <Pencil size={14} />} onClick={onCargar}>
            {f.sinCargar ? "Cargar cómo terminó" : "Cambiar el resultado"}
          </Button>
        </div>
      )}
    </article>
  );
}
