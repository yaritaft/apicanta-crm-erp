"use client";

import React from "react";
import { Tag } from "@/components/ui/ui";
import { Origen, Utms } from "@/components/leads/Origen";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { fechaHora, fechaLarga } from "@/lib/format";
import type { Persona } from "@/lib/persona";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Todo el historial de atribución de la persona, en orden: con qué
   anuncio y UTMs se registró, con qué embudo agendó cada llamada (los
   UTMs de Calendly), y a qué embudo y webinar quedó atribuida cada
   venta. Separado por toque, a propósito: mezclarlos haría creer que
   una agenda vino del anuncio o al revés.
   ================================================================== */

export function UtmsPersona({ e, p }: { e: EstadoApp; p: Persona }) {
  const agendas = p.sesiones.filter((s) => (s.utm && Object.keys(s.utm).length > 0) || s.canal);

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

      <div className="stack-3">
        <div className="t-label">Con qué agendó cada llamada</div>
        {agendas.length === 0 ? (
          <p className="t-sm t-subtle">Ninguna llamada trajo UTMs todavía. Las de Calendly los traen solas.</p>
        ) : (
          agendas.map((s) => (
            <div key={s.id} className="caja-suave stack-2">
              <div className="row-wrap t-sm">
                <span className="t-strong">{s.tipo || s.titulo}</span>
                <span className="t-subtle">agendó el {fechaHora(s.creadoEn)}</span>
                {s.canal && <Tag>entró por: {ETIQUETA_CANAL[s.canal]}</Tag>}
              </div>
              {s.utm && Object.keys(s.utm).length > 0 && <Utms titulo="UTMs con los que agendó" utm={s.utm} />}
            </div>
          ))
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
