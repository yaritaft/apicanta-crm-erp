"use client";

import React, { useState } from "react";
import { AlertTriangle, Check, Stethoscope } from "lucide-react";
import { Badge, Button } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { cabeceras } from "@/components/webinars/useYoutube";
import { useAcceso } from "@/lib/acceso";
import { esDueno } from "@/lib/permisos";
import { hayNube } from "@/lib/store";
import { fecha, num, relativo } from "@/lib/format";
import type { Diagnostico } from "@/lib/fathom-diagnostico";

/* ==================================================================
   «Diagnosticar», en Ajustes → Fathom (sólo dueños): por qué no llegan
   las llamadas de los closers (F2-04). Corre en el servidor, con la clave
   que ya está en Vercel, y devuelve cuentas y un veredicto: la clave no
   pasa por acá ni se muestra, y no se ven títulos ni contenido de las
   reuniones.
   ================================================================== */

const CAUSAS: Record<Diagnostico["veredicto"]["causa"], { etiqueta: string; ok: boolean }> = {
  a: { etiqueta: "Causa (a): Zoom", ok: false },
  b: { etiqueta: "Causa (b): visibilidad", ok: false },
  c: { etiqueta: "Causa (c): sin pedir el equipo", ok: false },
  d: { etiqueta: "No se atan", ok: false },
  ok: { etiqueta: "Todo en orden", ok: true },
  "sin-datos": { etiqueta: "Sin datos para comparar", ok: false },
  error: { etiqueta: "No se pudo leer", ok: false },
};

export function FathomDiagnostico({ deshabilitado }: { deshabilitado?: boolean }) {
  const toast = useToast();
  const { acceso } = useAcceso();
  const [trabajando, setTrabajando] = useState(false);
  const [resultado, setResultado] = useState<{ d: Diagnostico; cuando: string } | null>(null);

  /* Sólo los dueños: la respuesta dice quién grabó cada reunión. */
  if (!hayNube || !esDueno(acceso)) return null;

  async function diagnosticar() {
    setTrabajando(true);
    try {
      const r = await fetch("/api/fathom", {
        method: "POST", cache: "no-store",
        headers: { ...(await cabeceras()), "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "diagnosticar" }),
      });
      const j = (await r.json().catch(() => ({}))) as { diagnostico?: Diagnostico; cuando?: string; error?: string };
      if (!r.ok || !j.diagnostico) throw new Error(j.error ?? `Error ${r.status}`);
      setResultado({ d: j.diagnostico, cuando: j.cuando ?? new Date().toISOString() });
    } catch (err) { toast(err instanceof Error ? err.message : "No se pudo diagnosticar.", "err"); }
    setTrabajando(false);
  }

  return (
    <div className="stack-3" style={{ borderTop: "1px solid var(--border)", paddingTop: "var(--space-3)" }}>
      <div className="row-wrap" style={{ gap: 8, alignItems: "center" }}>
        <Button variante="secondary" icono={<Stethoscope size={16} />} disabled={deshabilitado || trabajando}
          cargando={trabajando} onClick={() => void diagnosticar()}>Diagnosticar</Button>
        <span className="t-sm t-subtle">
          ¿No llegan las llamadas de los closers? Mira qué ve la clave en Fathom y lo cruza con Calendly. Tarda un minuto; no guarda nada.
        </span>
      </div>
      {trabajando && <p className="t-sm t-subtle" role="status">Preguntándole a Fathom (equipos, quién grabó y las reuniones desde hace unas semanas)…</p>}
      {resultado && !trabajando && <Resultado d={resultado.d} cuando={resultado.cuando} />}
    </div>
  );
}

function Resultado({ d, cuando }: { d: Diagnostico; cuando: string }) {
  const v = d.veredicto;
  const causa = CAUSAS[v.causa];
  const color = causa.ok ? "var(--success)" : "var(--warning)";
  const fondo = causa.ok ? "var(--success-soft)" : "var(--warning-soft)";
  return (
    <div className="stack-3" aria-live="polite">
      <div style={{ background: fondo, border: `1px solid ${color}`, borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
        <div className="row-wrap" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
          <Badge variante={causa.ok ? "success" : "warning"} icono={causa.ok ? <Check size={12} /> : <AlertTriangle size={12} />}>{causa.etiqueta}</Badge>
          <strong style={{ color: "var(--ink)" }}>{v.titulo}</strong>
        </div>
        <p className="t-sm" style={{ margin: 0, color: "var(--ink)" }}>{v.explicacion}</p>
        {v.pasos.length > 0 && (
          <>
            <p className="t-label" style={{ margin: "10px 0 4px" }}>Qué hacer</p>
            <ul className="t-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--ink)" }}>{v.pasos.map((p) => <li key={p}>{p}</li>)}</ul>
          </>
        )}
        {v.pistas.length > 0 && (
          <>
            <p className="t-label" style={{ margin: "10px 0 4px" }}>Otras pistas</p>
            <ul className="t-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--ink)" }}>{v.pistas.map((p) => <li key={p}>{p}</li>)}</ul>
          </>
        )}
      </div>

      <div className="wb-kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 0 }}>
        <Kpi etiqueta="Reuniones que ve la clave" valor={num(d.sinFiltrar)} sub="sin filtrar" />
        <Kpi etiqueta="Sólo al pedir por equipo" valor={num(d.soloPorEquipo)} sub={d.equipos.some((q) => q.deVentas) ? "Team Calls de ventas" : "no hay equipo de ventas"} />
        <Kpi etiqueta="Atadas a una agenda" valor={num(d.atado.atadas)} sub={`${num(d.atado.nuevas)} nuevas, ${num(d.atado.yaExistian)} ya estaban`} />
        <Kpi etiqueta="Sin agenda de Calendly" valor={num(d.atado.sinAgenda)} sub="con invitado de afuera" />
        <Kpi etiqueta="Personales o internas" valor={num(d.atado.personales)} sub="sin invitados de afuera" />
      </div>

      <p className="t-sm t-muted">
        Se miró desde el {fecha(d.desde)}: {num(d.reuniones)} reuniones distintas. Según Fathom, {num(d.tipos.conAfuera)} tienen gente de afuera,
        {" "}{num(d.tipos.soloInternas)} son sólo del equipo{d.tipos.sinDato ? ` y ${num(d.tipos.sinDato)} no lo informan` : ""}.
        {d.incompleto ? " Quedó incompleto: Fathom devolvió más de lo que se leyó o pidió esperar." : ""}
      </p>

      {d.equipos.length > 0 && (
        <Tabla titulo="Equipos de Fathom" cabeza={["Equipo", "Reuniones", "Sólo ahí"]} filas={d.equipos.map((q) => [
          `${q.nombre}${q.deVentas ? " (ventas)" : ""}`,
          q.error ? `error: ${q.error}` : q.reuniones === null ? "no se pidió" : `${num(q.reuniones)}${q.completo ? "" : "+"}`,
          q.soloAhi === null ? "—" : num(q.soloAhi),
        ])} />
      )}

      <Tabla titulo="Quién grabó" cabeza={["Grabó", "Equipo", "Reuniones", "Atadas", "Sin agenda", "Personales"]} vacio="La clave no ve ninguna reunión."
        filas={d.grabadores.map((g) => [
          `${g.nombre}${g.esCloser ? " (closer)" : ""}`, g.equipo ?? "—", num(g.reuniones), num(g.atadas), num(g.sinAgenda), num(g.personales),
        ])} />

      <Tabla titulo="Closers y sus llamadas de Calendly" cabeza={["Closer", "Llamadas", "Con grabación", "Grabó él", "En Fathom"]} vacio="No hay llamadas de Calendly en el período."
        filas={d.closers.map((c) => [
          c.nombre, num(c.llamadas), num(c.conGrabacion), num(c.grabadasPorEl),
          c.enFathom === null ? (c.email ? "no se sabe" : "falta su mail") : c.enFathom ? "sí" : "no",
        ])} />

      {d.plataformas.length > 0 && (
        <Tabla titulo="Por plataforma de la llamada" cabeza={["Plataforma", "Llamadas", "Con grabación"]}
          filas={d.plataformas.map((p) => [p.nombre, num(p.llamadas), num(p.conGrabacion)])} />
      )}

      {d.errores.length > 0 && (
        <ul className="t-sm" style={{ margin: 0, paddingLeft: 18, color: "var(--danger)" }}>{d.errores.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      <p className="t-sm t-subtle">
        Diagnóstico de {relativo(cuando)}. Sólo lee: no guarda nada, y no muestra títulos ni contenido de las reuniones ni la clave.
      </p>
    </div>
  );
}

function Kpi({ etiqueta, valor, sub }: { etiqueta: string; valor: string; sub?: string }) {
  return (
    <div className="wb-kpi">
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num">{valor}</span>
      {sub && <span className="t-sm t-subtle">{sub}</span>}
    </div>
  );
}

function Tabla({ titulo, cabeza, filas, vacio }: { titulo: string; cabeza: string[]; filas: string[][]; vacio?: string }) {
  return (
    <div className="stack-2">
      <p className="t-label" style={{ margin: 0 }}>{titulo}</p>
      {filas.length === 0 ? (
        <p className="t-sm t-subtle" style={{ margin: 0 }}>{vacio ?? "Nada."}</p>
      ) : (
        <div className="hk-table-wrap" style={{ overflowX: "auto" }}>
          <table className="hk-table">
            <thead><tr>{cabeza.map((c) => <th key={c}>{c}</th>)}</tr></thead>
            <tbody>{filas.map((f, i) => <tr key={i}>{f.map((c, j) => <td key={j} className={j > 0 && /^[\d.,+]+$/.test(c) ? "t-num" : undefined}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}
