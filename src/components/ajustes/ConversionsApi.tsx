"use client";

import React, { useEffect, useState } from "react";
import { Check, Plug, TriangleAlert } from "lucide-react";
import { Badge, Card, CardHead } from "@/components/ui/ui";
import { cabeceras } from "@/components/webinars/useYoutube";
import { num, relativo } from "@/lib/format";
import type { EstadoCapi } from "@/lib/capi-estado";

/* ==================================================================
   Ajustes → Integraciones → Conversions API de Meta (F3-07).

   Dice si la app le está mandando eventos a Meta desde el servidor
   (registro, registro calificado, agenda y compra) y, si no, qué falta
   cargar en Vercel y para qué. Nunca muestra una clave: sólo si está.
   ================================================================== */

type Respuesta = EstadoCapi & {
  enviados?: Record<string, { n: number; ultimo: string | null }>;
  sinTabla?: boolean;
  error?: string;
};

const NOMBRE_EVENTO: Record<string, string> = {
  Lead: "Registros (Lead)", Schedule: "Agendas (Schedule)", Purchase: "Compras (Purchase)",
};

export function ConversionsApi() {
  const [r, setR] = useState<Respuesta | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let vivo = true;
    cabeceras()
      .then((headers) => fetch("/api/meta/capi", { cache: "no-store", headers }))
      .then((resp) => resp.json())
      .then((j: Respuesta) => { if (vivo) { if (j.error) setError(j.error); else setR(j); } })
      .catch(() => { if (vivo) setError("No pude preguntarle al servidor. Probá de nuevo en un rato."); });
    return () => { vivo = false; };
  }, []);

  const lista = Boolean(r?.lista);
  const obligatorias = r?.faltan.filter((f) => f.obligatoria) ?? [];
  const recomendadas = r?.faltan.filter((f) => !f.obligatoria) ?? [];

  return (
    <Card>
      <CardHead
        titulo="Conversions API de Meta"
        sub="La app le cuenta a Meta, desde el servidor, quién se registró, quién califica, quién agendó y quién compró."
        acciones={
          <Badge variante={lista ? "success" : "neutral"} icono={lista ? <Check size={13} /> : <Plug size={13} />}>
            {r === null && !error ? "Revisando…" : lista ? (r?.prueba ? "En modo prueba" : "Mandando eventos") : "Sin configurar"}
          </Badge>
        }
      />
      {error ? (
        <p className="t-sm t-muted">{error}</p>
      ) : r === null ? (
        <p className="t-sm t-muted">Preguntándole al servidor…</p>
      ) : (
        <div className="stack-3">
          <p className="t-sm t-muted">
            {lista
              ? r.prueba
                ? "Los eventos van a «Probar eventos» de Events Manager y no cuentan para optimizar. Cuando los veas llegar bien, sacá META_CAPI_TEST de Vercel."
                : `Cada registro a la landing manda el Lead, y si la persona califica (puede invertir 1000 USD o más, inglés conversacional y carrera), también «${r.eventoCalificado}». Las agendas y las compras salen cada media hora.`
              : "Todavía no se manda nada: no hace falta para que la app ande, es para que Meta optimice los anuncios hacia la gente que califica y compra."}
          </p>

          {obligatorias.length > 0 && (
            <div className="stack-2">
              <p className="t-sm" style={{ fontWeight: 600, display: "flex", gap: 6, alignItems: "center" }}>
                <TriangleAlert size={14} />Falta cargar en Vercel (Settings → Environment Variables → Production)
              </p>
              <ul className="t-sm t-muted" style={{ margin: 0, paddingLeft: 18 }}>
                {obligatorias.map((f) => <li key={f.variable}><code>{f.variable}</code>: {f.para}.</li>)}
              </ul>
              <p className="t-sm t-subtle">Después hay que volver a publicar para que el servidor las lea. Paso a paso: docs/registro-webinar.md.</p>
            </div>
          )}

          {lista && r.token === "sistema" && (
            <p className="t-sm t-muted">
              Hoy usa el token de Meta Ads (<code>META_SYSTEM_TOKEN</code>). Si Meta lo rechaza, cargá <code>META_CAPI_TOKEN</code> con el de la Conversions API del píxel.
            </p>
          )}

          {recomendadas.length > 0 && (
            <ul className="t-sm t-subtle" style={{ margin: 0, paddingLeft: 18 }}>
              {recomendadas.map((f) => <li key={f.variable}>Recomendada: <code>{f.variable}</code>, {f.para}.</li>)}
            </ul>
          )}

          <p className="t-sm t-subtle">
            {r.origenes.length > 0
              ? `Los registros sólo se aceptan de ${r.origenes.join(", ")}.`
              : "Hoy los registros se aceptan desde cualquier página."}
          </p>

          {r.sinTabla ? (
            <p className="t-sm t-subtle">Para ver cuántos eventos se mandaron falta correr <code>supabase/capi-enviados.sql</code>.</p>
          ) : r.enviados && (
            <div className="t-sm t-subtle">
              {[["Lead", NOMBRE_EVENTO.Lead], [r.eventoCalificado, `Registros calificados (${r.eventoCalificado})`], ["Schedule", NOMBRE_EVENTO.Schedule], ["Purchase", NOMBRE_EVENTO.Purchase]]
                .map(([clave, titulo]) => {
                  const x = r.enviados?.[clave];
                  return (
                    <div key={clave}>
                      {titulo}: {x && x.n > 0 ? `${num(x.n)} mandados · el último, ${relativo(x.ultimo ?? "")}` : "ninguno todavía"}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
