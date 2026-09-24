"use client";

import React, { useEffect, useState } from "react";
import { CalendarCheck, Star } from "lucide-react";
import { Badge, Card, CardHead, Empty, Select, type VarianteBadge } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { num } from "@/lib/format";
import { acciones } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { claveDeFecha, type AgendaDelWebinar } from "@/lib/agendas-webinar";
import type { Webinar } from "@/lib/types";
import { diaYHora } from "./fechas";
import { atribuirAgenda, useAgendasWebinar } from "./useVivo";

/* ==================================================================
   Las agendas de Calendly del webinar: cuántas se hicieron en el vivo,
   cuántas después y cuántas se cancelaron, con cada persona.

   Son las mismas que el cron pasa solo a "Llamadas en vivo", "Llamadas
   después" y "Canceladas" (lib/agendas-webinar.ts). Se actualiza cada 30
   segundos: el webhook de Calendly las trae en segundos.
   ================================================================== */

const ESTADO: Record<string, { texto: string; variante: VarianteBadge }> = {
  agendada: { texto: "Agendada", variante: "accent" },
  hecha: { texto: "Hecha", variante: "success" },
  "no-show": { texto: "No vino", variante: "danger" },
  cancelada: { texto: "Cancelada", variante: "neutral" },
};

export function AgendasWebinar({ w, className }: { w: Webinar; className?: string }) {
  const r = useAgendasWebinar(w.id);
  const d = r.estado === "listo" ? r.datos : null;

  /* Lo mismo que el cron va a escribir en la planilla, ya: así el embudo y
     las llamadas de la ficha no esperan su vuelta (sólo en memoria). */
  useEffect(() => {
    if (!d) return;
    acciones.aplicarDeLaNube<Webinar>("webinars", {
      [w.id]: { llamadasVivo: d.vivo, llamadasPosterior: d.despues, llamadasCanceladas: d.canceladas },
    });
  }, [d, w.id]);
  const clave = claveDeFecha(w.fecha);

  return (
    <Card className={className}>
      <CardHead
        titulo="Agendas de Calendly"
        sub={`Las que llegan con los UTMs de este webinar (utm_medium=${clave}). Completan solas las llamadas de la planilla.`}
      />
      {r.estado === "cargando" && <div className="skeleton" style={{ height: 120 }} aria-busy="true" aria-label="Trayendo las agendas" />}
      {r.estado === "error" && <p className="t-sm t-muted">{r.error}</p>}
      {d && (
        <div className="stack-4">
          <div className="wb-kpis" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", marginBottom: 0 }}>
            <Kpi etiqueta="En el vivo" valor={d.vivo} />
            <Kpi etiqueta="Después" valor={d.despues} />
            <Kpi etiqueta="Canceladas" valor={d.canceladas} tenue />
          </div>
          {d.agendas.length === 0 ? (
            <Empty
              icono={<CalendarCheck size={22} />}
              titulo="Todavía no hay agendas de este webinar"
              texto="Aparecen solas cuando alguien agenda desde el link del vivo o el de después."
            />
          ) : (
            /* Con scroll adentro: la lista no estira la ficha y los números de arriba no se mueven. */
            <div className="wb-filas lista-scroll">
              {d.agendas.map((a) => {
                const e = ESTADO[a.estado] ?? ESTADO.agendada;
                return (
                  <div key={a.id} className="wb-fila" style={a.fuera ? { opacity: 0.55 } : undefined}>
                    <span className="wb-fila__texto">
                      <span className="wb-fila__nombre">
                        <span className="truncate">
                          {a.calificada && (
                            <span className="estrella-calificada" title="Agenda calificada: invierte +1000, inglés conversacional y carrera">
                              <Star size={14} fill="currentColor" aria-label="Agenda calificada" />
                            </span>
                          )}
                          {a.nombre}
                        </span>
                        <Badge variante={e.variante}>{e.texto}</Badge>
                      </span>
                      <span className="wb-agenda__badges">
                        {/* Por qué link vino (el embudo ya se sabe: es este webinar). El
                            link viejo, en amarillo; los UTMs al pasar el mouse. */}
                        <span title={a.utm || "Sin UTMs"}>
                          <Badge variante={a.link === "viejo" ? "warning" : "neutral"}>
                            {a.link === "viejo" ? "Link viejo" : a.link ?? "Sin link"}
                          </Badge>
                        </span>
                        {a.por === "manual" && <Badge variante="brand">Corregida{a.corregidoPor ? ` por ${a.corregidoPor}` : ""}</Badge>}
                      </span>
                      <span className="wb-fila__detalle">
                        Agendó el {diaYHora(a.agendadaEn)} hs
                        {a.closer ? ` · ${a.closer}` : ""}
                        {a.llamada ? ` · llamada el ${diaYHora(a.llamada)} hs` : ""}
                        {a.por === "hora" ? " · atribuida por la hora" : ""}
                      </span>
                    </span>
                    <SelectorAtribucion a={a} webinarId={w.id} onCambio={r.recargar} />
                  </div>
                );
              })}
            </div>
          )}
          {d.noVino > 0 && <p className="t-sm t-subtle">{num(d.noVino)} no se presentaron a la llamada.</p>}
        </div>
      )}
    </Card>
  );
}

/* Dónde cuenta esta agenda. "Automático" deja que decida el link (o la
   hora); lo demás es una corrección a mano, que queda en la actividad. */
function SelectorAtribucion({ a, webinarId, onCambio }: { a: AgendaDelWebinar; webinarId: string; onCambio: () => void }) {
  const toast = useToast();
  const yo = useUsuarioActual();
  const [guardando, setGuardando] = useState(false);
  const valor = a.fuera ? "fuera" : a.por === "manual" ? a.momento : "auto";
  const auto = a.momento === "vivo" ? "Automático · en el vivo" : "Automático · después";
  return (
    <div className="wb-agenda__select">
      <Select
        value={valor} disabled={guardando}
        aria-label={`Atribución de la agenda de ${a.nombre}`}
        opciones={[
          { valor: "auto", texto: a.por === "manual" || a.fuera ? "Automático" : auto },
          { valor: "vivo", texto: "En el vivo" },
          { valor: "despues", texto: "Después" },
          { valor: "fuera", texto: "No es de este webinar" },
        ]}
        onChange={async (ev) => {
          const nuevo = ev.target.value as "vivo" | "despues" | "fuera" | "auto";
          if (nuevo === valor) return;
          setGuardando(true);
          const error = await atribuirAgenda(a.id, nuevo, webinarId, yo.nombre || yo.email || undefined);
          setGuardando(false);
          if (error) { toast(error, "err"); return; }
          toast("Listo: la planilla se actualiza en un minuto.");
          onCambio();
        }}
      />
    </div>
  );
}

function Kpi({ etiqueta, valor, tenue }: { etiqueta: string; valor: number; tenue?: boolean }) {
  return (
    <div className="wb-kpi">
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num" style={tenue ? { color: "var(--ink-subtle)" } : undefined}>{num(valor)}</span>
    </div>
  );
}
