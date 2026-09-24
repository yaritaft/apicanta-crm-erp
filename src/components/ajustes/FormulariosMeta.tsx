"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Download, Plug, TriangleAlert, Zap } from "lucide-react";
import { Badge, Button, Card, CardHead } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { cargarDeLaNube, useEstado } from "@/lib/store";
import { nube } from "@/lib/supabase";
import { fechaHora, num } from "@/lib/format";
import type { EstadoWebhook } from "@/lib/meta-leads";
import type { InscripcionMeta, ResultadoLeadsMeta } from "@/lib/meta-leads-sync";

/* ==================================================================
   Ajustes → Integraciones → Formularios de Meta.

   Los leads entran por webhook: Meta avisa al instante cada vez que
   alguien se anota, sin consultas cada tanto que se coman el límite de
   Meta. Acá se ve si los avisos están activos (la app escucha y cada
   página avisa), se activan con un botón, y se trae una sola vez lo
   anterior a los avisos (los últimos 90 días, lo que guarda Meta). Si a
   Meta le falta un permiso, el error dice cuál.
   ================================================================== */

async function cabeceras(): Promise<Record<string, string>> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (nube) {
    const { data } = await nube.auth.getSession();
    if (data.session?.access_token) h.Authorization = `Bearer ${data.session.access_token}`;
  }
  return h;
}

export function FormulariosMeta() {
  const e = useEstado();
  const toast = useToast();
  const [estado, setEstado] = useState<EstadoWebhook | null>(null);
  const [errorEstado, setErrorEstado] = useState("");
  const [activando, setActivando] = useState(false);
  const [trayendo, setTrayendo] = useState(false);
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

  const revisar = useCallback(async () => {
    try {
      const resp = await fetch("/api/meta/leads", { headers: await cabeceras(), cache: "no-store" });
      const j = (await resp.json().catch(() => ({}))) as EstadoWebhook & { error?: string };
      if (j.error) { setErrorEstado(j.error); setEstado(null); return; }
      setErrorEstado(""); setEstado(j);
    } catch {
      setErrorEstado("No pude preguntarle a Meta. Probá de nuevo en un rato.");
    }
  }, []);
  useEffect(() => { void revisar(); }, [revisar]);

  const paginas = estado?.paginas.filter((p) => p.id) ?? [];
  const activos = Boolean(estado?.app.activo) && paginas.length > 0 && paginas.every((p) => p.suscripta);
  const problemas = [
    estado?.app.error,
    ...(estado?.paginas.map((p) => p.error && `${p.nombre}: ${p.error}`) ?? []),
  ].filter(Boolean) as string[];

  async function activar() {
    setActivando(true); setError("");
    try {
      const resp = await fetch("/api/meta/leads", { method: "POST", headers: await cabeceras(), body: JSON.stringify({ accion: "activar" }) });
      const j = (await resp.json().catch(() => ({}))) as EstadoWebhook & { error?: string };
      if (j.error) throw new Error(j.error);
      setEstado(j);
      toast("Avisos de Meta activados: cada lead nuevo entra al instante.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron activar los avisos.");
    } finally {
      setActivando(false);
    }
  }

  async function traer() {
    setTrayendo(true); setError(""); setR(null);
    try {
      const resp = await fetch("/api/meta/leads", { method: "POST", headers: await cabeceras(), body: JSON.stringify({ accion: "traer", dias: 90 }) });
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
      setTrayendo(false);
    }
  }

  return (
    <Card>
      <CardHead
        titulo="Formularios de Meta"
        sub="Quien se anota en un formulario instantáneo de Facebook o Instagram entra al instante a Leads, con sus respuestas, su anuncio y su webinar: Meta avisa cada lead nuevo, no hay consultas cada tanto. La columna Formularios de cada webinar se completa sola."
        acciones={
          <Badge variante={activos ? "success" : "neutral"} icono={activos ? <Check size={13} /> : <Plug size={13} />}>
            {estado === null && !errorEstado ? "Revisando…" : activos ? "Avisos activos" : "Sin activar"}
          </Badge>
        }
      />

      <div className="stack-2">
        <p className="t-sm t-muted">
          {errorEstado
            ? errorEstado
            : estado === null
              ? "Preguntándole a Meta…"
              : activos
                ? `Meta avisa a ${estado.app.callback ?? "esta app"} por ${paginas.map((p) => p.nombre).join(", ")}.`
                : `Falta activar los avisos${paginas.length ? `: ${paginas.map((p) => `${p.nombre} ${p.suscripta ? "avisa" : "no avisa"}`).join(", ")}` : ""}${estado.app.activo ? "" : "; la app todavía no escucha los formularios"}.`}
        </p>
        <div className="row-wrap" style={{ alignItems: "center" }}>
          {!activos && (
            <Button variante="primary" icono={<Zap size={16} />} onClick={activar} disabled={activando || Boolean(errorEstado)}>
              {activando ? "Activando…" : "Activar los avisos de Meta"}
            </Button>
          )}
          <Button variante="secondary" icono={<Download size={16} />} onClick={traer} disabled={trayendo}>
            {trayendo ? "Trayendo de Meta…" : "Traer los últimos 90 días"}
          </Button>
          <span className="t-sm t-subtle">
            {total ? `${num(total)} inscripciones · la última, el ${fechaHora(ultima)}.` : "Todavía no entró ninguna."}
          </span>
        </div>
      </div>

      {[...problemas, ...(error ? [error] : [])].map((x) => (
        <div key={x} className="row t-sm" style={{ gap: 8, alignItems: "flex-start", marginTop: 10 }}>
          <TriangleAlert size={15} style={{ flex: "none", marginTop: 2, color: "var(--warning)" }} />
          <span>{x}</span>
        </div>
      ))}

      {r && (
        <div className="stack-2" style={{ marginTop: 12 }}>
          <dl className="dl dl--compacta">
            <dt>Formularios</dt>
            <dd>{r.formularios.length ? r.formularios.map((f) => `${f.nombre} (${num(f.leads)})`).join(" · ") : "Ninguno"}</dd>
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
