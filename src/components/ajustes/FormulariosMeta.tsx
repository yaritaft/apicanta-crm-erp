"use client";

import React, { useMemo, useState } from "react";
import { Check, Download, FileText, TriangleAlert } from "lucide-react";
import { Badge, Button, Card, CardHead } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { cargarDeLaNube, useEstado } from "@/lib/store";
import { nube } from "@/lib/supabase";
import { fechaHora, num } from "@/lib/format";
import type { InscripcionMeta, ResultadoLeadsMeta } from "@/lib/meta-leads-sync";

/* ==================================================================
   Ajustes → Integraciones → Formularios de Meta.

   Los que se anotan en un formulario instantáneo de Facebook o Instagram
   entran solos cada 15 minutos (con el cron de Meta). Acá se ve cuántos
   entraron y se pueden traer ya los últimos 90 días, que es lo que guarda
   Meta: sirve la primera vez y para ver enseguida si a Meta le falta un
   permiso, que el error dice cuál.
   ================================================================== */

export function FormulariosMeta() {
  const e = useEstado();
  const toast = useToast();
  const [corriendo, setCorriendo] = useState(false);
  const [r, setR] = useState<ResultadoLeadsMeta | null>(null);
  const [error, setError] = useState("");

  const { total, ultima } = useMemo(() => {
    let n = 0;
    let max = "";
    for (const c of e.contactos) {
      const xs = Array.isArray(c.extra?.formulariosMeta) ? (c.extra.formulariosMeta as InscripcionMeta[]) : [];
      n += xs.length;
      for (const i of xs) if (i.creado > max) max = i.creado;
    }
    return { total: n, ultima: max };
  }, [e.contactos]);

  async function traer() {
    setCorriendo(true); setError(""); setR(null);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (nube) {
        const { data } = await nube.auth.getSession();
        if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
      }
      const resp = await fetch("/api/meta/leads", { method: "POST", headers, body: JSON.stringify({ dias: 90 }) });
      const j = (await resp.json().catch(() => ({}))) as ResultadoLeadsMeta & { error?: string };
      if (j.error) throw new Error(j.error);
      setR(j);
      if (j.inscripcionesNuevas > 0) {
        await cargarDeLaNube();
        toast(`Entraron ${num(j.inscripcionesNuevas)} inscripciones de los formularios de Meta.`);
      } else if (!j.errores?.length) {
        toast("No había inscripciones nuevas en los formularios de Meta.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron traer los formularios.");
    } finally {
      setCorriendo(false);
    }
  }

  return (
    <Card>
      <CardHead
        titulo="Formularios de Meta"
        sub="Quien se anota en un formulario instantáneo de Facebook o Instagram entra solo a Leads cada 15 minutos, con sus respuestas, su anuncio y su webinar. La columna Formularios de cada webinar se completa sola."
        acciones={
          <Badge variante={total ? "success" : "neutral"} icono={total ? <Check size={13} /> : <FileText size={13} />}>
            {total ? `${num(total)} inscripciones` : "Sin inscripciones"}
          </Badge>
        }
      />
      <div className="row-wrap" style={{ alignItems: "center" }}>
        <Button variante="secondary" icono={<Download size={16} />} onClick={traer} disabled={corriendo}>
          {corriendo ? "Trayendo de Meta…" : "Traer los últimos 90 días"}
        </Button>
        <span className="t-sm t-subtle">
          {ultima ? `La última entró el ${fechaHora(ultima)}.` : "Todavía no entró ninguna."}
        </span>
      </div>

      {error && <p className="t-sm" style={{ color: "var(--danger)", marginTop: 10 }}>{error}</p>}

      {r && (
        <div className="stack-2" style={{ marginTop: 12 }}>
          <dl className="dl dl--compacta">
            <dt>Páginas</dt><dd>{r.paginas.length ? r.paginas.join(", ") : "Ninguna"}</dd>
            <dt>Formularios</dt>
            <dd>
              {r.formularios.length
                ? r.formularios.map((f) => `${f.nombre} (${num(f.leads)})`).join(" · ")
                : "Ninguno"}
            </dd>
            <dt>Nuevas</dt>
            <dd>
              {num(r.inscripcionesNuevas)} inscripciones · {num(r.contactosNuevos)} contactos nuevos · {num(r.leadsNuevos)} leads nuevos
              {r.webinarsActualizados ? ` · ${num(r.webinarsActualizados)} webinars con Formularios al día` : ""}
            </dd>
          </dl>
          {r.errores.slice(0, 6).map((x) => (
            <div key={x} className="row t-sm" style={{ gap: 8, alignItems: "flex-start" }}>
              <TriangleAlert size={15} style={{ flex: "none", marginTop: 2, color: "var(--warning)" }} />
              <span>{x}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
