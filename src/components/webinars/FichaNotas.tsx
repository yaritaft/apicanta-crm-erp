"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check, History } from "lucide-react";
import { Card, CardHead, Field, Input, Textarea } from "@/components/ui/ui";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { useEstado } from "@/lib/store";
import { relativo } from "@/lib/format";
import type { Webinar } from "@/lib/types";
import { guardarWebinar } from "./guardar";

/* ==================================================================
   Notas, links y campos propios del webinar.

   Se escriben y se guardan al salir del campo, sin botón: lo mismo que
   las celdas. Mientras alguien escribe, lo que llegue de la nube no le
   pisa el texto; cuando sale, se muestra lo último.
   ================================================================== */

type Borrador = { notas: string; enlaceRegistro: string; enlaceReplay: string };

const deWebinar = (w: Webinar): Borrador => ({
  notas: w.notas ?? "", enlaceRegistro: w.enlaceRegistro ?? "", enlaceReplay: w.enlaceReplay ?? "",
});

const NOMBRE: Record<keyof Borrador, string> = {
  notas: "Las notas", enlaceRegistro: "El link de registro", enlaceReplay: "El link del replay",
};

export function TarjetaNotas({ w, className }: { w: Webinar; className?: string }) {
  const e = useEstado();
  const [b, setB] = useState<Borrador>(() => deWebinar(w));
  const [extra, setExtra] = useState<Record<string, unknown>>(() => w.extra ?? {});
  const [guardado, setGuardado] = useState<string | null>(null);
  const escribiendo = useRef(false);

  /* Lo que cambie afuera (otra pestaña, la planilla) se ve, salvo mientras
     se está escribiendo acá. */
  useEffect(() => {
    if (escribiendo.current) return;
    setB(deWebinar(w));
    setExtra(w.extra ?? {});
  }, [w]);

  useEffect(() => {
    if (!guardado) return;
    const t = window.setTimeout(() => setGuardado(null), 2200);
    return () => window.clearTimeout(t);
  }, [guardado]);

  function guardarCampo(k: keyof Borrador) {
    escribiendo.current = false;
    const valor = b[k].trim();
    if (valor === (w[k] ?? "")) return;
    guardarWebinar(w, { [k]: valor } as Partial<Webinar>, `${NOMBRE[k]} de «${w.titulo}» se actualizó.`);
    setGuardado(NOMBRE[k]);
  }

  function guardarExtra() {
    escribiendo.current = false;
    if (JSON.stringify(extra) === JSON.stringify(w.extra ?? {})) return;
    guardarWebinar(w, { extra }, `Se actualizaron los campos propios de «${w.titulo}».`);
    setGuardado("Los campos propios");
  }

  const campo = (k: keyof Borrador) => ({
    value: b[k],
    onFocus: () => { escribiendo.current = true; },
    onChange: (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setB((x) => ({ ...x, [k]: ev.target.value })),
    onBlur: () => guardarCampo(k),
  });

  const hayPropios = e.campos.some((c) => c.entidad === "webinar");

  return (
    <Card className={className}>
      <CardHead titulo="Notas y enlaces" sub="Se guarda solo al salir de cada campo." />
      <div className="stack-4">
        <Field
          label="Qué pasó en este webinar"
          ayuda="Lo que cambiaste, lo que funcionó y lo que salió mal. Es lo que después explica por qué un webinar rindió distinto."
        >
          <Textarea
            rows={4} {...campo("notas")}
            placeholder="No hice el recordatorio del día anterior. Poca gente se unió al grupo. Reutilicé el 100% de los ads."
          />
        </Field>
        <div className="form-grid">
          <Field label="Link de registro">
            <Input type="url" inputMode="url" placeholder="https://…" {...campo("enlaceRegistro")} />
          </Field>
          <Field label="Link del replay">
            <Input type="url" inputMode="url" placeholder="https://…" {...campo("enlaceReplay")} />
          </Field>
        </div>
        {hayPropios && (
          /* El blur de cualquier campo propio sube hasta acá (focusout). */
          <div className="form-grid" onFocus={() => { escribiendo.current = true; }} onBlur={guardarExtra}>
            <CamposExtra
              campos={e.campos} entidad="webinar" valores={extra}
              onChange={(k, v) => setExtra((x) => ({ ...x, [k]: v }))}
            />
          </div>
        )}
        <span className="t-sm wb-guardado" aria-live="polite">
          {guardado && <><Check size={14} />{guardado}: guardado.</>}
        </span>
      </div>
    </Card>
  );
}

/* ---------- Lo último que se tocó ---------- */

export function TarjetaCambios({ w, className }: { w: Webinar; className?: string }) {
  const e = useEstado();
  const cambios = e.actividad.filter((a) => a.entidadId === w.id).slice(0, 8);
  return (
    <Card className={className}>
      <CardHead titulo="Cambios recientes" sub="Qué se cargó y cuándo. Sirve para saber de dónde salió un número." />
      {cambios.length === 0 ? (
        <p className="t-sm t-subtle">Todavía no hay cambios registrados.</p>
      ) : (
        <div className="timeline">
          {cambios.map((a) => (
            <div key={a.id} className="timeline__item">
              <span className="timeline__dot"><History size={13} /></span>
              <div style={{ minWidth: 0 }}>
                <div className="timeline__text t-sm" style={{ overflowWrap: "anywhere" }}>{a.detalle}</div>
                <div className="timeline__meta">{a.actor} · {relativo(a.fecha)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
