"use client";

import React, { useMemo } from "react";
import { Badge } from "@/components/ui/ui";
import { useEstado } from "@/lib/store";
import { fechaLarga } from "@/lib/format";
import { respuestasLegibles } from "@/lib/reporte-formularios";
import type { Reporte } from "@/lib/types";

/* ==================================================================
   Lo que el alumno contestó en su formulario semanal (lib/reporte-formularios.ts),
   en la ficha de su cliente: un renglón por semana y, desplegadas, sus respuestas
   con la pregunta al lado. Se guardan solas cuando el alumno manda el reporte.
   ================================================================== */

/** Las respuestas de UN reporte, desplegables. No dibuja nada si ese reporte no tiene (los de antes, o los del webhook). */
export function RespuestasDelReporte({ reporte }: { reporte: Reporte }) {
  const lista = respuestasLegibles(reporte.formulario, reporte.respuestas);
  if (lista.length === 0) return null;
  return (
    <details className="rep-resp">
      <summary>Ver sus respuestas ({lista.length})</summary>
      <dl className="rep-resp__lista">
        {lista.map((x) => (
          <div key={x.id} className="rep-resp__item">
            <dt>{x.pregunta}</dt>
            <dd>{x.respuesta}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** Los formularios que mandó un cliente, el más nuevo arriba. */
export function ReportesDelCliente({ alumnoId }: { alumnoId: string }) {
  const e = useEstado();
  const reportes = useMemo(
    () => e.reportes.filter((r) => r.alumnoId === alumnoId && r.respuestas && Object.keys(r.respuestas).length > 0)
      .sort((a, b) => b.semanaDel.localeCompare(a.semanaDel)),
    [e.reportes, alumnoId],
  );
  if (reportes.length === 0) return null;
  return (
    <div className="stack-2" style={{ marginTop: 12 }}>
      <span className="t-label">Lo que contestó en el formulario semanal ({reportes.length})</span>
      {reportes.slice(0, 8).map((r) => {
        const compromiso = typeof r.respuestas?.compromiso === "number" ? r.respuestas.compromiso : null;
        return (
          <div key={r.id} className="rep-resp__fila">
            <div className="row t-sm" style={{ gap: 8, flexWrap: "wrap" }}>
              <span>Semana del {fechaLarga(r.semanaDel)}</span>
              {r.programa && <span className="t-subtle">{r.programa}</span>}
              <span className="spacer" />
              {compromiso !== null && <Badge variante={compromiso >= 8 ? "success" : compromiso >= 5 ? "neutral" : "danger"}>Compromiso {compromiso}/10</Badge>}
            </div>
            <RespuestasDelReporte reporte={r} />
          </div>
        );
      })}
      {reportes.length > 8 && <span className="t-sm t-subtle">Y {reportes.length - 8} semanas más, en Reportes.</span>}
    </div>
  );
}
