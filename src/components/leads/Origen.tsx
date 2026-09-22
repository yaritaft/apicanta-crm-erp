"use client";

import Link from "next/link";
import { ChevronRight, Megaphone } from "lucide-react";
import { Tag } from "@/components/ui/ui";
import { Dato } from "@/components/ui/Drawer";
import { ETIQUETA_CANAL } from "@/lib/calendly";
import { useEstado } from "@/lib/store";
import type { Contacto } from "@/lib/types";

/* De dónde vino una persona. Lo usan la ficha del lead y la de la llamada.

   Dos juegos de UTMs, a propósito separados:
   - los del REGISTRO, guardados en el contacto: el primer contacto de la
     persona, que es el que trae el anuncio de Meta;
   - los de la AGENDA, guardados en la llamada: con qué embudo agendó
     (`Webinar` + la fecha, `Resell`, `setter-ia`). Calendly no conoce el
     anuncio, así que estos nunca lo traen.
   Mezclarlos haría creer que la agenda vino del anuncio, o al revés. */

export function Origen({ contacto, utmAgenda }: { contacto?: Contacto; utmAgenda?: Record<string, string> }) {
  const e = useEstado();
  const ad = contacto?.origenAdId ? e.ads.find((a) => a.id === contacto.origenAdId) : undefined;
  const conjunto = ad ? e.adsets.find((s) => s.id === ad.adsetId) : undefined;
  const campania = ad ? e.campaigns.find((c) => c.id === ad.campaignId) : undefined;
  const webinar = contacto?.origenWebinarId ? e.webinars.find((w) => w.id === contacto.origenWebinarId) : undefined;
  const nada = !contacto?.origenCanal && !ad && !webinar && !contacto?.utm && !utmAgenda;

  return (
    <div>
      <div className="t-label" style={{ marginBottom: 12 }}>Origen</div>
      {nada ? (
        <p className="t-sm t-subtle">
          Todavía no sabemos de dónde vino. Llega solo cuando la persona se registra en la landing o agenda por Calendly.
        </p>
      ) : (
        <div className="stack-3">
          {(contacto?.origenCanal || webinar) && (
            <dl className="dl">
              {contacto?.origenCanal && <Dato label="Entró por">{ETIQUETA_CANAL[contacto.origenCanal]}</Dato>}
              {webinar && <Dato label="Webinar">{webinar.titulo}</Dato>}
            </dl>
          )}

          {ad ? (
            <Link
              href={`/marketing?ver=${ad.campaignId}`}
              style={{
                display: "flex", gap: 12, alignItems: "center", padding: "12px 14px",
                background: "var(--surface-200)", border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)", color: "inherit", textDecoration: "none",
              }}
            >
              <Megaphone size={18} style={{ flexShrink: 0, color: "var(--brand)" }} />
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="t-sm t-subtle truncate" style={{ display: "block" }}>
                  {campania?.nombre ?? "Campaña"}{conjunto ? ` › ${conjunto.nombre}` : ""}
                </span>
                <span className="truncate" style={{ display: "block", fontWeight: 600 }}>{ad.nombre}</span>
              </span>
              <ChevronRight size={16} style={{ flexShrink: 0 }} className="t-subtle" />
            </Link>
          ) : contacto?.origenAdId ? (
            <p className="t-sm t-subtle">
              Vino de un anuncio que todavía no está en la sincronización de Meta.
            </p>
          ) : null}

          {contacto?.utm && <Utms titulo="UTMs del registro" utm={contacto.utm} />}
          {utmAgenda && <Utms titulo="UTMs con los que agendó" utm={utmAgenda} />}
        </div>
      )}
    </div>
  );
}

/* Siempre en el orden en que se leen, de lo general a lo particular. La base
   (jsonb) guarda las claves en su propio orden —las cortas primero—, y "term"
   salía antes que "source". */
const ORDEN_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
const posicion = (k: string) => {
  const i = ORDEN_UTM.indexOf(k);
  return i === -1 ? ORDEN_UTM.length : i;
};

function Utms({ titulo, utm }: { titulo: string; utm: Record<string, string> }) {
  return (
    <div>
      <div className="t-sm t-subtle" style={{ marginBottom: 6 }}>{titulo}</div>
      <div className="row-wrap">
        {Object.entries(utm).sort(([a], [b]) => posicion(a) - posicion(b)).map(([k, v]) => (
          <Tag key={k}>{k.replace(/^utm_/, "")}: {v}</Tag>
        ))}
      </div>
    </div>
  );
}
