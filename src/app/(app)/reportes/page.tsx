"use client";

import React, { useMemo, useState } from "react";
import { Check, ClipboardList, Clock, Info, X } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Button, Card, CardHead, Chip, Empty, Persona, StatCard } from "@/components/ui/ui";
import { BarChart } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, inicioSemana, num, pct } from "@/lib/format";
import { semanasSinReportar } from "@/lib/metricas";
import type { EstadoReporte, Reporte } from "@/lib/types";

const ETIQUETA: Record<EstadoReporte, { texto: string; variante: "success" | "accent" | "danger" | "neutral" }> = {
  "completado": { texto: "Completado", variante: "success" },
  "pendiente": { texto: "Pendiente", variante: "accent" },
  "vencido": { texto: "Vencido", variante: "danger" },
  "no-enviado": { texto: "No enviado", variante: "neutral" },
};

export default function Reportes() {
  const e = useEstado();
  const toast = useToast();
  const [semanasAtras, setSemanasAtras] = useState(0);
  const [filtro, setFiltro] = useState<"todos" | EstadoReporte>("todos");

  const semana = useMemo(() => {
    const d = inicioSemana(new Date());
    d.setDate(d.getDate() - semanasAtras * 7);
    return d;
  }, [semanasAtras]);

  const activos = useMemo(() => e.alumnos.filter((a) => a.estado === "activo" || a.estado === "pausado"), [e.alumnos]);

  /* Para la semana elegida: el reporte de cada alumno, o uno virtual si no existe. */
  const filas = useMemo(() => {
    return activos.map((a) => {
      const r = e.reportes.find((x) => x.alumnoId === a.id && inicioSemana(new Date(x.semanaDel)).getTime() === semana.getTime());
      return { alumno: a, reporte: r ?? null, estado: (r?.estado ?? "no-enviado") as EstadoReporte };
    }).filter((f) => filtro === "todos" || f.estado === filtro);
  }, [activos, e.reportes, semana, filtro]);

  const conteo = (est: EstadoReporte) =>
    activos.filter((a) => {
      const r = e.reportes.find((x) => x.alumnoId === a.id && inicioSemana(new Date(x.semanaDel)).getTime() === semana.getTime());
      return (r?.estado ?? "no-enviado") === est;
    }).length;

  const completados = conteo("completado");
  const tasa = activos.length > 0 ? (completados / activos.length) * 100 : 0;

  /* Evolución de las últimas 8 semanas */
  const evolucion = useMemo(() => {
    const out = [];
    for (let i = 7; i >= 0; i--) {
      const s = inicioSemana(new Date());
      s.setDate(s.getDate() - i * 7);
      const done = e.reportes.filter((r) => inicioSemana(new Date(r.semanaDel)).getTime() === s.getTime() && r.estado === "completado").length;
      out.push({ etiqueta: `${s.getDate()}/${s.getMonth() + 1}`, valor: done });
    }
    return out;
  }, [e.reportes]);

  function marcar(alumnoId: string, estado: EstadoReporte) {
    const existente = e.reportes.find((x) => x.alumnoId === alumnoId && inicioSemana(new Date(x.semanaDel)).getTime() === semana.getTime());
    const alumno = e.alumnos.find((a) => a.id === alumnoId);
    if (existente) {
      acciones.actualizarSilencioso<Reporte>("reportes", existente.id, {
        estado, completadoEn: estado === "completado" ? new Date().toISOString() : undefined,
      });
    } else {
      acciones.crear<Reporte>("reportes", {
        alumnoId, semanaDel: semana.toISOString(), estado,
        completadoEn: estado === "completado" ? new Date().toISOString() : undefined,
      }, `Reporte de ${alumno?.nombre ?? "alumno"}`);
    }
    toast(`${alumno?.nombre ?? "El alumno"}: ${ETIQUETA[estado].texto.toLowerCase()}.`);
  }

  return (
    <div className="stack-5">
      <PageHead
        titulo="Reportes semanales"
        sub="Cada semana los alumnos cuentan cómo vienen. Acá ves quién contestó y quién no, y lo marcás con un clic."
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Completados" valor={`${num(completados)}/${num(activos.length)}`} contexto={`semana del ${fechaLarga(semana.toISOString())}`} />
        <StatCard etiqueta="Tasa de respuesta" valor={pct(tasa, 0)} delta={tasa >= 70 ? "Bien" : "Bajo"} direccion={tasa >= 70 ? "up" : "down"} contexto="de los alumnos activos" />
        <StatCard etiqueta="Sin contestar" valor={num(conteo("pendiente") + conteo("no-enviado"))} contexto="todavía a tiempo o sin enviar" />
        <StatCard etiqueta="En riesgo" valor={num(activos.filter((a) => semanasSinReportar(e, a.id) >= 2).length)} delta={activos.filter((a) => semanasSinReportar(e, a.id) >= 2).length > 0 ? "Seguir" : undefined} direccion="accent" contexto="2+ semanas sin reportar" />
      </div>

      <Card>
        <CardHead titulo="Reportes completados por semana" sub="Últimas 8 semanas." />
        <BarChart datos={evolucion} formato={num} alto={180} color="var(--success)" />
      </Card>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4)" }}>
          <div className="toolbar" style={{ marginBottom: "var(--space-3)" }}>
            <Button sm variante="secondary" onClick={() => setSemanasAtras((s) => s + 1)}>← Semana anterior</Button>
            <span className="t-strong" style={{ minWidth: 200, textAlign: "center" }}>
              {semanasAtras === 0 ? "Esta semana" : `Semana del ${fechaLarga(semana.toISOString())}`}
            </span>
            <Button sm variante="secondary" disabled={semanasAtras === 0} onClick={() => setSemanasAtras((s) => Math.max(0, s - 1))}>Semana siguiente →</Button>
          </div>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={activos.length}>Todos</Chip>
            {(Object.keys(ETIQUETA) as EstadoReporte[]).map((k) => (
              <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)} count={conteo(k)}>{ETIQUETA[k].texto}</Chip>
            ))}
          </div>
        </div>

        {filas.length === 0 ? (
          <Empty
            icono={<ClipboardList size={22} />}
            titulo={activos.length === 0 ? "No hay alumnos activos" : "Nada con ese filtro"}
            texto={activos.length === 0 ? "Cargá alumnos y acá vas a poder seguir su reporte semana a semana." : "Probá con otro estado."}
          />
        ) : (
          <div className="hk-table-wrap" style={{ borderRadius: 0, border: 0 }}>
            <table className="hk-table">
              <thead>
                <tr>
                  <th>Alumno</th>
                  <th>Estado</th>
                  <th className="hk-th--num">Horas</th>
                  <th className="hk-th--num">Postulaciones</th>
                  <th className="hk-th--num">Entrevistas</th>
                  <th>Bloqueo</th>
                  <th style={{ width: 130 }} aria-label="Marcar" />
                </tr>
              </thead>
              <tbody>
                {filas.map(({ alumno, reporte, estado }) => (
                  <tr key={alumno.id} style={{ cursor: "default" }}>
                    <td className="hk-td--primary"><Persona nombre={alumno.nombre} sub={`${alumno.cohorte} · ${alumno.plan}`} /></td>
                    <td><Badge variante={ETIQUETA[estado].variante}>{ETIQUETA[estado].texto}</Badge></td>
                    <td className="hk-td--num">{reporte?.horasEstudio ?? "—"}</td>
                    <td className="hk-td--num">{reporte?.postulaciones ?? "—"}</td>
                    <td className="hk-td--num">{reporte?.entrevistas ?? "—"}</td>
                    <td className="hk-td--secondary hk-td--wrap">{reporte?.bloqueo ?? "—"}</td>
                    <td>
                      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
                        <Button sm variante={estado === "completado" ? "brand" : "ghost"} onClick={() => marcar(alumno.id, "completado")} icono={<Check size={14} />} aria-label="Marcar completado">
                          {""}
                        </Button>
                        <Button sm variante={estado === "vencido" ? "danger" : "ghost"} onClick={() => marcar(alumno.id, "vencido")} icono={<X size={14} />} aria-label="Marcar vencido">
                          {""}
                        </Button>
                        <Button sm variante={estado === "pendiente" ? "secondary" : "ghost"} onClick={() => marcar(alumno.id, "pendiente")} icono={<Clock size={14} />} aria-label="Marcar pendiente">
                          {""}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Ayuda titulo="Para qué sirve esto" icono={<Info size={18} />}>
        El reporte semanal es el termómetro del programa: si alguien deja de contestar dos semanas seguidas,
        normalmente es la señal previa a que se caiga. Los botones de la derecha marcan
        <strong> completado</strong>, <strong>vencido</strong> o <strong>pendiente</strong> sin salir de la tabla.
      </Ayuda>
    </div>
  );
}
