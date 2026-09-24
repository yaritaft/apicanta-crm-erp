"use client";

import React from "react";
import { Tag } from "@/components/ui/ui";
import { Origen, Utms } from "@/components/leads/Origen";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { fechaHora, fechaLarga } from "@/lib/format";
import type { Persona } from "@/lib/persona";
import type { EstadoApp } from "@/lib/types";
import type { InscripcionMeta } from "@/lib/meta-leads-sync";

/* ==================================================================
   Todo el historial de atribución de la persona, en orden: con qué
   anuncio y UTMs se registró, con qué embudo agendó cada llamada (los
   UTMs de Calendly), y a qué embudo y webinar quedó atribuida cada
   venta. Separado por toque, a propósito: mezclarlos haría creer que
   una agenda vino del anuncio o al revés.

   Los formularios de Meta van aparte: cada vez que se anotó en uno, con
   sus respuestas, su anuncio y el webinar al que quedó atada.
   ================================================================== */

export function UtmsPersona({ e, p }: { e: EstadoApp; p: Persona }) {
  const agendas = p.sesiones.filter((s) => (s.utm && Object.keys(s.utm).length > 0) || s.canal);
  const formularios = (Array.isArray(p.contacto?.extra?.formulariosMeta) ? (p.contacto!.extra.formulariosMeta as InscripcionMeta[]) : [])
    .slice().sort((a, b) => b.creado.localeCompare(a.creado));

  return (
    <div className="stack-5">
      <div className="caja-suave">
        <Origen contacto={p.contacto} />
      </div>

      {p.leads.some((l) => l.fuente || l.campania) && (
        <div className="stack-2">
          <div className="t-label">Oportunidades</div>
          {p.leads.map((l) => (
            <div key={l.id} className="row-wrap t-sm">
              <span className="t-subtle">{fechaLarga(l.creadoEn)}</span>
              {l.fuente && <Tag>fuente: {l.fuente}</Tag>}
              {l.campania && <Tag>campaña: {l.campania}</Tag>}
            </div>
          ))}
        </div>
      )}

      {formularios.length > 0 && (
        <div className="stack-3">
          <div className="t-label">Formularios de Meta</div>
          {/* Una por formulario enviado: con scroll, como las agendas. */}
          <div className="stack-3 lista-scroll">
            {formularios.map((f) => {
              const webinar = e.webinars.find((w) => w.id === f.webinarId);
              return (
                <div key={f.leadgenId} className="caja-suave stack-2">
                  <div className="row-wrap t-sm">
                    <span className="t-strong">{f.formulario}</span>
                    <span className="t-subtle">se anotó el {fechaHora(f.creado)}</span>
                    <Tag>{f.plataforma === "ig" ? "Instagram" : "Facebook"}</Tag>
                    {webinar && <Tag>webinar: {webinar.titulo}</Tag>}
                  </div>
                  {(f.campania || f.anuncio) && (
                    <div className="row-wrap t-sm t-subtle">
                      {f.campania && <span>campaña: {f.campania}</span>}
                      {f.anuncio && <span>anuncio: {f.anuncio}</span>}
                    </div>
                  )}
                  {f.respuestas.length > 0 && (
                    <dl className="dl dl--compacta">
                      {f.respuestas.map((q) => (
                        <React.Fragment key={q.pregunta}><dt>{q.pregunta}</dt><dd>{q.respuesta}</dd></React.Fragment>
                      ))}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="stack-3">
        <div className="t-label">Con qué agendó cada llamada</div>
        {agendas.length === 0 ? (
          <p className="t-sm t-subtle">Ninguna llamada trajo UTMs todavía. Las de Calendly los traen solas.</p>
        ) : (
          /* Una por agenda, reprogramaciones incluidas: con scroll, así lo de
             las ventas de abajo no queda lejos. */
          <div className="stack-3 lista-scroll">
            {agendas.map((s) => (
              <div key={s.id} className="caja-suave stack-2">
                <div className="row-wrap t-sm">
                  <span className="t-strong">{s.tipo || s.titulo}</span>
                  <span className="t-subtle">agendó el {fechaHora(s.creadoEn)}</span>
                  {s.canal && <Tag>entró por: {ETIQUETA_CANAL[s.canal]}</Tag>}
                </div>
                {s.utm && Object.keys(s.utm).length > 0 && <Utms titulo="UTMs con los que agendó" utm={s.utm} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {p.ventas.length > 0 && (
        <div className="stack-2">
          <div className="t-label">A qué quedó atribuida cada venta</div>
          {p.ventas.map((v) => {
            const producto = e.productos.find((x) => x.id === v.productoId)?.nombre ?? "Venta";
            const embudo = e.embudos.find((x) => x.id === v.embudoId)?.nombre;
            const webinar = e.webinars.find((x) => x.id === v.webinarId)?.titulo;
            return (
              <div key={v.id} className="row-wrap t-sm">
                <span className="t-strong">{producto}</span>
                <span className="t-subtle">{fechaLarga(v.fecha)}</span>
                <Tag>embudo: {embudo ?? "sin embudo"}</Tag>
                {webinar && <Tag>webinar: {webinar}</Tag>}
                {v.excluidoMarketing && <Tag>excluida de marketing</Tag>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
