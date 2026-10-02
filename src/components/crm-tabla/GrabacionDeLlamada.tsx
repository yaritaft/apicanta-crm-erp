"use client";

import React, { useState } from "react";
import { ExternalLink, Link2, Search, Video } from "lucide-react";
import { Button, Input } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { acciones, hayNube } from "@/lib/store";
import type { CandidataGrabacion } from "@/lib/fathom";
import type { Sesion } from "@/lib/types";
import { textoFecha } from "./FiltroColumna";

/* ==================================================================
   El link de la grabación de una llamada, en el cierre del día.

   Con Fathom conectado llega solo y aparece ya cargado. Si no llegó (la
   persona entró con otro mail, o a un Meet armado en el momento), se pega
   a mano o se busca entre las grabaciones de Fathom del closer de esa
   llamada, alrededor de ese día, y se ata: desde ahí la ficha muestra
   también su resumen y su transcripción (api/fathom: buscar y atar).
   ================================================================== */

const HORA = new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
const DIA = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires", year: "numeric", month: "2-digit", day: "2-digit" });

async function pedir(cuerpo: object): Promise<Record<string, unknown>> {
  const r = await fetch("/api/fathom", {
    method: "POST", cache: "no-store",
    headers: { ...(await cabeceras()), "Content-Type": "application/json" },
    body: JSON.stringify(cuerpo),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `Error ${r.status}`));
  return j;
}

export function GrabacionDeLlamada({ s, valor, buscar: puedeBuscar, onCambiar }: {
  s: Pick<Sesion, "id" | "grabacion" | "anfitrion">;
  /* Lo que hay en el campo: el link que ya tenía la llamada o el que se está pegando. */
  valor: string;
  /* Buscar entre las grabaciones del closer: quien atendió la llamada o un dueño. */
  buscar: boolean;
  onCambiar: (link: string) => void;
}) {
  const toast = useToast();
  const [candidatas, setCandidatas] = useState<CandidataGrabacion[] | null>(null);
  const [trabajando, setTrabajando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const deFathom = Boolean(s.grabacion && valor === s.grabacion && /fathom/i.test(s.grabacion));

  async function buscar() {
    setTrabajando("buscar"); setAviso(null);
    try {
      const j = await pedir({ accion: "buscar", sesionId: s.id });
      if (typeof j.esperar === "number") setAviso(`Fathom pidió una pausa: probá de nuevo en ${Math.ceil(j.esperar)} segundos.`);
      else setCandidatas((j.candidatas as CandidataGrabacion[] | undefined) ?? []);
    } catch (err) { setAviso(err instanceof Error ? err.message : "No se pudo buscar en Fathom."); }
    setTrabajando(null);
  }

  async function atar(c: CandidataGrabacion) {
    setTrabajando(c.recordingId); setAviso(null);
    try {
      const j = await pedir({ accion: "atar", sesionId: s.id, recordingId: c.recordingId });
      if (typeof j.esperar === "number") { setAviso(`Fathom pidió una pausa: probá de nuevo en ${Math.ceil(j.esperar)} segundos.`); setTrabajando(null); return; }
      const link = String(j.shareUrl ?? c.shareUrl ?? "");
      /* La base ya la guardó: acá sólo se refleja, sin volver a escribirla. */
      if (link) acciones.aplicarDeLaNube<Sesion>("sesiones", { [s.id]: { grabacion: link } });
      onCambiar(link);
      setCandidatas(null);
      toast("Grabación atada a la llamada: en la ficha ya están su resumen y su transcripción.");
    } catch (err) { setAviso(err instanceof Error ? err.message : "No se pudo atar la grabación."); }
    setTrabajando(null);
  }

  return (
    <div className="stack-2">
      <span className="t-label">Link de la grabación <span className="t-subtle">{deFathom ? "(llegó de Fathom)" : "(opcional)"}</span></span>
      <div className="row" style={{ gap: 8, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input icono={<Link2 size={15} />} value={valor} onChange={(ev) => onCambiar(ev.target.value)} placeholder="https://fathom.video/…" aria-label="Link de la grabación" />
        </div>
        {/^https?:\/\//i.test(valor) && (
          <a className="link t-sm" href={valor} target="_blank" rel="noopener noreferrer" style={{ whiteSpace: "nowrap" }}><ExternalLink size={13} /> Abrir</a>
        )}
      </div>
      {hayNube && puedeBuscar && !deFathom && (
        <div>
          <Button sm variante="ghost" icono={<Search size={14} />} cargando={trabajando === "buscar"} disabled={Boolean(trabajando)} onClick={() => void buscar()}>
            Buscar en Fathom
          </Button>
        </div>
      )}
      {aviso && <p className="t-sm" style={{ color: "var(--warning)", margin: 0 }}>{aviso}</p>}
      {candidatas && (
        candidatas.length === 0 ? (
          <p className="t-sm t-subtle" style={{ margin: 0 }}>
            Fathom no tiene grabaciones de {s.anfitrion || "este closer"} cerca de ese día. Si la grabó otra persona, pegá el link.
          </p>
        ) : (
          <ul className="crm-eod__grabaciones">
            {candidatas.map((c) => {
              const cuando = c.empieza ? `${textoFecha(DIA.format(new Date(c.empieza)))} · ${HORA.format(new Date(c.empieza))} hs` : "Sin fecha";
              return (
                <li key={c.recordingId}>
                  <Video size={15} className="t-subtle" aria-hidden />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="truncate t-strong" style={{ display: "block" }}>{c.titulo}</span>
                    <span className="truncate t-sm t-subtle" style={{ display: "block" }}>
                      {[cuando, c.duracion, c.invitados.join(", ")].filter(Boolean).join(" · ")}
                    </span>
                    {c.otraLlamada && <span className="t-sm" style={{ color: "var(--warning)" }}>Ya está atada a otra llamada: al elegirla pasa a ésta.</span>}
                  </span>
                  <Button sm variante="secondary" cargando={trabajando === c.recordingId} disabled={Boolean(trabajando)} onClick={() => void atar(c)}>Es ésta</Button>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}
