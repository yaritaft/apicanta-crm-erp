"use client";

import React, { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, ClipboardList, Clock, Download, Info, Search, X } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Ayuda, Badge, Bar, Button, Card, CardHead, Chip, Empty, Input, Persona, StatCard, Tabs, Tag } from "@/components/ui/ui";
import { AreaChart, BarChart } from "@/components/charts/charts";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { DateRangePicker, diaDeNegocio, rangoSub } from "@/components/ui/DateRangePicker";
import { useToast } from "@/components/ui/Toast";
import { BadgeEtapa, ESTADO_ALUMNO } from "@/components/alumnos/comun";
import { acciones, useEstado } from "@/lib/store";
import { useRangoURL } from "@/lib/useRango";
import { etapaDelAlumno, etapasDeServicio } from "@/lib/alumnos";
import {
  deDia, filasDeReportes, hoyDelNegocio, lunesDelDia, primeraSemanaEsperada, rachasHasta, type FilaReporte,
} from "@/lib/reportes";
import { fechaLarga, num, pct } from "@/lib/format";
import type { EstadoReporte, Reporte } from "@/lib/types";

type Vista = "dashboard" | "tabla";
type Metrica = "horas" | "postulaciones" | "entrevistas";

const ETIQUETA: Record<EstadoReporte, { texto: string; variante: "success" | "accent" | "danger" | "neutral" }> = {
  "completado": { texto: "Completado", variante: "success" },
  "pendiente": { texto: "Pendiente", variante: "accent" },
  "vencido": { texto: "Vencido", variante: "danger" },
  "no-enviado": { texto: "No enviado", variante: "neutral" },
};
const ESTADOS = Object.keys(ETIQUETA) as EstadoReporte[];

const METRICAS: Record<Metrica, { texto: string; unidad: string; campo: "horasEstudio" | "postulaciones" | "entrevistas" }> = {
  horas: { texto: "Horas de estudio", unidad: "h", campo: "horasEstudio" },
  postulaciones: { texto: "Postulaciones", unidad: "", campo: "postulaciones" },
  entrevistas: { texto: "Entrevistas", unidad: "", campo: "entrevistas" },
};

/* El catálogo de columnas de la tabla, como el de Marketing: se prenden,
   se apagan y se ordenan. La preferencia es de quien mira (localStorage). */
const COLUMNAS: DefColumna[] = [
  { clave: "alumno", titulo: "Alumno", fija: true },
  { clave: "semana", titulo: "Semana del", grupo: "Reporte" },
  { clave: "estado", titulo: "Estado", grupo: "Reporte" },
  { clave: "completado", titulo: "Completado el", grupo: "Reporte" },
  { clave: "horas", titulo: "Horas", grupo: "Actividad", ayuda: "Horas de estudio que reportó esa semana." },
  { clave: "postulaciones", titulo: "Postulaciones", grupo: "Actividad" },
  { clave: "entrevistas", titulo: "Entrevistas", grupo: "Actividad" },
  { clave: "bloqueo", titulo: "Bloqueo", grupo: "Actividad", ayuda: "Lo que contó que lo frena." },
  { clave: "cohorte", titulo: "Cohorte", grupo: "Alumno" },
  { clave: "plan", titulo: "Plan", grupo: "Alumno" },
  { clave: "etapa", titulo: "Etapa del servicio", grupo: "Alumno" },
  { clave: "estadoAlumno", titulo: "Estado del alumno", grupo: "Alumno" },
];
const POR_DEFECTO = ["alumno", "semana", "estado", "horas", "postulaciones", "entrevistas", "bloqueo"];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const diaYMes = (dia: string) => { const d = deDia(dia); return `${d.getDate()} ${MESES[d.getMonth()]}`; };
const barraCorta = (dia: string) => { const d = deDia(dia); return `${d.getDate()}/${d.getMonth() + 1}`; };
const normal = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const unDecimal = (n: number) => num(n, Number.isInteger(n) ? 0 : 1);

export default function Reportes() {
  const e = useEstado();
  const toast = useToast();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [rango, setRango] = useRangoURL("mes");
  const vista: Vista = params.get("vista") === "tabla" ? "tabla" : "dashboard";
  const cambiarVista = useCallback((v: Vista) => {
    const q = new URLSearchParams(params.toString());
    if (v === "tabla") q.set("vista", "tabla"); else q.delete("vista");
    const s = q.toString();
    router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }, [params, pathname, router]);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<"todos" | EstadoReporte>("todos");
  const [metrica, setMetrica] = useState<Metrica>("postulaciones");
  const cols = useColumnas("reportes", COLUMNAS, POR_DEFECTO);

  /* Todo sale de acá: tabla, números y gráficos cuentan las mismas filas. */
  const filas = useMemo(() => filasDeReportes(e, rango.desde, rango.hasta), [e, rango.desde, rango.hasta]);
  const primeraSemana = useMemo(() => primeraSemanaEsperada(e), [e]);
  const estaSemana = lunesDelDia(hoyDelNegocio());
  const ultimaSemana = lunesDelDia(rango.hasta);
  const etapas = useMemo(() => etapasDeServicio(e), [e]);

  const total = filas.length;
  const cuenta = (est: EstadoReporte) => filas.filter((f) => f.estado === est).length;
  const completados = cuenta("completado");
  const sinContestar = cuenta("pendiente") + cuenta("no-enviado");
  const tasa = total > 0 ? (completados / total) * 100 : 0;

  /* En riesgo al cierre del período: activos con dos semanas o más seguidas
     sin completar el reporte, contando para atrás desde la última semana. */
  const enRiesgo = useMemo(() => {
    const rachas = rachasHasta(e, ultimaSemana);
    return e.alumnos
      .filter((a) => a.estado === "activo" && (rachas.get(a.id) ?? 0) >= 2)
      .map((a) => ({ alumno: a, semanas: rachas.get(a.id) ?? 0 }))
      .sort((x, y) => y.semanas - x.semanas || x.alumno.nombre.localeCompare(y.alumno.nombre, "es"));
  }, [e, ultimaSemana]);

  const porSemana = useMemo(() => {
    const m = new Map<string, { total: number; completados: number; valores: Record<Metrica, number[]> }>();
    for (const f of filas) {
      const x = m.get(f.semana) ?? { total: 0, completados: 0, valores: { horas: [], postulaciones: [], entrevistas: [] } };
      x.total++;
      if (f.estado === "completado" && f.reporte) {
        x.completados++;
        for (const k of Object.keys(METRICAS) as Metrica[]) {
          const v = f.reporte[METRICAS[k].campo];
          if (typeof v === "number" && Number.isFinite(v)) x.valores[k].push(v);
        }
      }
      m.set(f.semana, x);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filas]);

  /* Sólo semanas con reportes esperados: una semana sin nadie que deba
     reportar no es un 0%, es "no hay dato", y como barra vacía mentía. */
  const evolucion = porSemana.map(([s, x]) => ({
    etiqueta: barraCorta(s),
    valor: (x.completados / x.total) * 100,
    completo: `Semana del ${diaYMes(s)}${s === estaSemana ? " (en curso)" : ""} · ${x.completados} de ${x.total}`,
  }));

  /* Promedio por reporte, y sólo semanas en las que alguien reportó ese dato.
     El total engañaba igual que una barra vacía: la semana en curso, con la
     mitad de los reportes, parecía una caída. */
  const actividad = porSemana
    .filter(([, x]) => x.valores[metrica].length > 0)
    .map(([s, x]) => {
      const vs = x.valores[metrica];
      return {
        etiqueta: barraCorta(s),
        valor: vs.reduce((a, v) => a + v, 0) / vs.length,
        completo: `Semana del ${diaYMes(s)}${s === estaSemana ? " (en curso)" : ""} · ${vs.length} ${vs.length === 1 ? "reporte" : "reportes"}`,
      };
    });

  const totales = useMemo(() => {
    const suma = (k: Metrica) => porSemana.reduce((a, [, x]) => a + x.valores[k].reduce((b, v) => b + v, 0), 0);
    return { horas: suma("horas"), postulaciones: suma("postulaciones"), entrevistas: suma("entrevistas") };
  }, [porSemana]);
  const conSemanaEnCurso = porSemana.some(([s]) => s === estaSemana);

  const bloqueos = useMemo(() => {
    const m = new Map<string, { texto: string; veces: number; alumnos: Set<string> }>();
    for (const f of filas) {
      const t = f.reporte?.bloqueo?.trim().replace(/\s+/g, " ");
      if (!t) continue;
      const k = normal(t);
      const x = m.get(k) ?? { texto: t, veces: 0, alumnos: new Set<string>() };
      x.veces++;
      x.alumnos.add(f.alumno.id);
      m.set(k, x);
    }
    return [...m.values()].sort((a, b) => b.veces - a.veces || a.texto.localeCompare(b.texto, "es")).slice(0, 6);
  }, [filas]);

  const filtradas = useMemo(() => {
    const t = normal(busca.trim());
    return filas
      .filter((f) => (filtro === "todos" || f.estado === filtro)
        && (!t || normal(f.alumno.nombre).includes(t) || normal(f.alumno.email ?? "").includes(t)))
      /* Por nombre de base: la tabla ordena por semana y, dentro de cada
         semana, quedan en orden alfabético. */
      .sort((a, b) => a.alumno.nombre.localeCompare(b.alumno.nombre, "es"));
  }, [filas, filtro, busca]);

  function marcar(f: FilaReporte, estado: EstadoReporte) {
    if (f.estado === estado) return;
    const completadoEn = estado === "completado" ? new Date().toISOString() : undefined;
    if (f.reporte) {
      acciones.actualizarSilencioso<Reporte>("reportes", f.reporte.id, { estado, completadoEn });
    } else {
      /* La medianoche del lunes, como los reportes de siempre. */
      acciones.crear<Reporte>("reportes", {
        alumnoId: f.alumno.id, semanaDel: deDia(f.semana).toISOString(), estado, completadoEn,
      }, `Reporte de ${f.alumno.nombre}`);
    }
    toast(`${f.alumno.nombre}, semana del ${diaYMes(f.semana)}: ${ETIQUETA[estado].texto.toLowerCase()}.`);
  }

  const DEF: Record<string, Columna<FilaReporte>> = {
    alumno: {
      clave: "alumno", titulo: "Alumno", tipo: "primary", orden: (f) => f.alumno.nombre,
      celda: (f) => <Persona nombre={f.alumno.nombre} sub={[f.alumno.cohorte, f.alumno.plan].filter(Boolean).join(" · ") || undefined} />,
    },
    semana: {
      clave: "semana", titulo: "Semana del", tipo: "secondary", orden: (f) => f.semana,
      celda: (f) => (
        <span>{diaYMes(f.semana)} {deDia(f.semana).getFullYear()}{f.semana === estaSemana && <span className="t-subtle"> · en curso</span>}</span>
      ),
    },
    estado: {
      clave: "estado", titulo: "Estado", orden: (f) => ESTADOS.indexOf(f.estado),
      celda: (f) => <Badge variante={ETIQUETA[f.estado].variante}>{ETIQUETA[f.estado].texto}</Badge>,
    },
    completado: {
      clave: "completado", titulo: "Completado el", tipo: "secondary",
      orden: (f) => (f.estado === "completado" ? f.reporte?.completadoEn ?? "" : ""),
      celda: (f) => (f.estado === "completado" && f.reporte?.completadoEn ? fechaLarga(f.reporte.completadoEn) : "—"),
    },
    horas: {
      clave: "horas", titulo: "Horas", tipo: "num", orden: (f) => f.reporte?.horasEstudio ?? -1,
      celda: (f) => (f.reporte?.horasEstudio == null ? "—" : num(f.reporte.horasEstudio)),
    },
    postulaciones: {
      clave: "postulaciones", titulo: "Postulaciones", tipo: "num", orden: (f) => f.reporte?.postulaciones ?? -1,
      celda: (f) => (f.reporte?.postulaciones == null ? "—" : num(f.reporte.postulaciones)),
    },
    entrevistas: {
      clave: "entrevistas", titulo: "Entrevistas", tipo: "num", orden: (f) => f.reporte?.entrevistas ?? -1,
      celda: (f) => (f.reporte?.entrevistas == null ? "—" : num(f.reporte.entrevistas)),
    },
    bloqueo: {
      clave: "bloqueo", titulo: "Bloqueo", tipo: "secondary", orden: (f) => f.reporte?.bloqueo ?? "",
      celda: (f) => <span className="rep-texto">{f.reporte?.bloqueo || "—"}</span>,
    },
    cohorte: { clave: "cohorte", titulo: "Cohorte", tipo: "secondary", orden: (f) => f.alumno.cohorte, celda: (f) => f.alumno.cohorte || "—" },
    plan: { clave: "plan", titulo: "Plan", tipo: "secondary", orden: (f) => f.alumno.plan, celda: (f) => f.alumno.plan || "—" },
    etapa: {
      clave: "etapa", titulo: "Etapa del servicio", orden: (f) => etapaDelAlumno(etapas, f.alumno)?.orden ?? 99,
      celda: (f) => <BadgeEtapa etapa={etapaDelAlumno(etapas, f.alumno)} />,
    },
    estadoAlumno: {
      clave: "estadoAlumno", titulo: "Estado del alumno", orden: (f) => f.alumno.estado,
      celda: (f) => <Tag>{ESTADO_ALUMNO[f.alumno.estado].texto}</Tag>,
    },
  };

  /* Los botones de marcar van siempre a la vista y al final, fuera del
     configurador: son la acción de la tabla, no un dato que se pueda apagar. */
  const MARCAR: Columna<FilaReporte> = {
    clave: "_marcar", titulo: "Marcar", ancho: 148,
    celda: (f) => (
      <div className="row" style={{ gap: 4, justifyContent: "flex-end" }}>
        <Button sm variante={f.estado === "completado" ? "brand" : "ghost"} icono={<Check size={14} />}
          onClick={() => marcar(f, "completado")} aria-pressed={f.estado === "completado"}
          aria-label={`Marcar completado el reporte de ${f.alumno.nombre}`} title="Completado" />
        <Button sm variante={f.estado === "vencido" ? "danger" : "ghost"} icono={<X size={14} />}
          onClick={() => marcar(f, "vencido")} aria-pressed={f.estado === "vencido"}
          aria-label={`Marcar vencido el reporte de ${f.alumno.nombre}`} title="Vencido" />
        <Button sm variante={f.estado === "pendiente" ? "secondary" : "ghost"} icono={<Clock size={14} />}
          onClick={() => marcar(f, "pendiente")} aria-pressed={f.estado === "pendiente"}
          aria-label={`Marcar pendiente el reporte de ${f.alumno.nombre}`} title="Pendiente" />
      </div>
    ),
  };

  const columnas = [...cols.visibles.map((k) => DEF[k]).filter(Boolean), MARCAR];

  function exportar() {
    const cab = ["alumno", "email", "semana_del", "estado", "completado_el", "horas", "postulaciones", "entrevistas", "bloqueo", "cohorte", "plan", "etapa_servicio"];
    const lineas = [...filtradas]
      .sort((a, b) => b.semana.localeCompare(a.semana) || a.alumno.nombre.localeCompare(b.alumno.nombre, "es"))
      .map((f) => [
        f.alumno.nombre, f.alumno.email ?? "", f.semana, ETIQUETA[f.estado].texto,
        /* El día de Argentina, no el de UTC: a las 22 el ISO ya dice mañana. */
        f.estado === "completado" ? diaDeNegocio(f.reporte?.completadoEn) : "",
        f.reporte?.horasEstudio ?? "", f.reporte?.postulaciones ?? "", f.reporte?.entrevistas ?? "",
        f.reporte?.bloqueo ?? "", f.alumno.cohorte, f.alumno.plan, etapaDelAlumno(etapas, f.alumno)?.nombre ?? "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[cab.join(","), ...lineas].join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apicanta-reportes-${rango.desde}-a-${rango.hasta}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Se bajaron ${num(lineas.length)} reportes.`);
  }

  const sinNada = total === 0;
  const periodo = rangoSub(rango);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Reportes"
        sub="Cómo vienen los alumnos: quién reporta cada semana, cuánto estudia, a cuántos trabajos se postula y qué lo frena."
        acciones={
          <DateRangePicker
            value={rango} minDate={primeraSemana} onApply={setRango}
            footerNota="Semanas que tocan el período · hora de Argentina"
          />
        }
      />

      <Tabs valor={vista} onChange={cambiarVista} opciones={[
        { valor: "dashboard", texto: "Dashboard" },
        { valor: "tabla", texto: `Tabla · ${num(total)}` },
      ]} />

      {vista === "dashboard" && (
        <div className="stack-4">
          <div className="grid-stats">
            <StatCard
              hero etiqueta="Completados" valor={sinNada ? "—" : `${num(completados)}/${num(total)}`}
              contexto={`reportes · ${periodo}`}
              ayuda="Reportes completados sobre los que se esperaban en el período."
            />
            <StatCard
              etiqueta="Tasa de respuesta" valor={sinNada ? "—" : pct(tasa, 0)}
              delta={sinNada ? undefined : tasa >= 70 ? "Bien" : "Baja"} direccion={tasa >= 70 ? "up" : "down"}
              contexto="de los reportes esperados"
            />
            <StatCard
              etiqueta="Sin contestar" valor={num(sinContestar)} contexto="pendientes o sin enviar"
              ayuda="Reportes del período que figuran pendientes o sin enviar. En la tabla se filtran por estado."
            />
            <StatCard
              etiqueta="En riesgo" valor={num(enRiesgo.length)}
              delta={enRiesgo.length > 0 ? "Seguir" : undefined} direccion="accent"
              contexto="2+ semanas sin reportar"
              ayuda="Alumnos activos que, al cierre del período, llevan dos semanas seguidas o más sin completar el reporte."
            />
          </div>

          {sinNada ? (
            <Card>
              <Empty
                icono={<ClipboardList size={22} />}
                titulo={e.alumnos.some((a) => a.estado === "activo" || a.estado === "pausado") ? "No hay reportes en este período" : "Todavía no hay alumnos activos"}
                texto={e.alumnos.some((a) => a.estado === "activo" || a.estado === "pausado")
                  ? "Probá con otro rango de fechas."
                  : "Cuando tengas alumnos activos, acá vas a ver quién reporta cada semana y cómo vienen."}
              />
            </Card>
          ) : (
            <>
              <div className="grid-2">
                <Card>
                  <CardHead titulo="Tasa de respuesta por semana" sub="Qué parte de los reportes que se debían se completó." />
                  <AreaChart datos={evolucion} formato={(n) => pct(n, 0)} alto={200} color="var(--success)" serie="Tasa de respuesta" />
                  {conSemanaEnCurso && (
                    <p className="t-sm t-subtle rep-resumen">
                      La última semana está en curso: con los pendientes que falten, todavía puede subir.
                    </p>
                  )}
                </Card>
                <Card>
                  <CardHead titulo="Actividad por semana" sub="Promedio por reporte completado." />
                  <div className="row-wrap" style={{ marginBottom: "var(--space-3)" }}>
                    {(Object.keys(METRICAS) as Metrica[]).map((k) => (
                      <Chip key={k} activo={metrica === k} onClick={() => setMetrica(k)}>{METRICAS[k].texto}</Chip>
                    ))}
                  </div>
                  {actividad.length === 0 ? (
                    <p className="t-sm t-subtle rep-sin-datos">Nadie reportó {METRICAS[metrica].texto.toLowerCase()} en este período.</p>
                  ) : (
                    <BarChart
                      datos={actividad} alto={176} color="var(--brand)"
                      formato={(n) => `${unDecimal(n)}${METRICAS[metrica].unidad ? ` ${METRICAS[metrica].unidad}` : ""}`}
                    />
                  )}
                  <p className="t-sm t-subtle rep-resumen">
                    En el período: <span className="t-num t-strong">{unDecimal(totales.horas)} h</span> de estudio ·{" "}
                    <span className="t-num t-strong">{num(totales.postulaciones)}</span> postulaciones ·{" "}
                    <span className="t-num t-strong">{num(totales.entrevistas)}</span> entrevistas
                  </p>
                </Card>
              </div>

              <div className="grid-2">
                <Card>
                  <CardHead titulo="Bloqueos más frecuentes" sub="Lo que los alumnos cuentan que los frena." />
                  {bloqueos.length === 0 ? (
                    <p className="t-sm t-subtle rep-sin-datos">Nadie reportó un bloqueo en este período.</p>
                  ) : (
                    <div className="stack-3">
                      {bloqueos.map((b) => (
                        <div key={b.texto} className="rep-bloqueo">
                          <div className="row" style={{ gap: "var(--space-3)" }}>
                            <span className="t-sm t-strong truncate" style={{ flex: 1, minWidth: 0 }} title={b.texto}>{b.texto}</span>
                            <span className="t-sm t-subtle t-num" style={{ whiteSpace: "nowrap" }}>
                              {num(b.veces)} {b.veces === 1 ? "vez" : "veces"} · {num(b.alumnos.size)} {b.alumnos.size === 1 ? "alumno" : "alumnos"}
                            </span>
                          </div>
                          <Bar valor={(b.veces / bloqueos[0].veces) * 100} />
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
                <Card>
                  <CardHead titulo="En riesgo" sub="Activos con dos semanas o más sin completar el reporte." />
                  {enRiesgo.length === 0 ? (
                    <Empty icono={<Check size={22} />} titulo="Todos al día" texto="Ningún alumno activo lleva dos semanas sin reportar." />
                  ) : (
                    <div className="stack-2 rep-riesgo">
                      {enRiesgo.map(({ alumno: a, semanas }) => (
                        <Link key={a.id} href={`/alumnos?ver=${a.id}`} className="agenda-item">
                          <span style={{ flex: 1, minWidth: 0 }}>
                            <Persona nombre={a.nombre} sub={[a.cohorte, a.plan].filter(Boolean).join(" · ") || undefined} />
                          </span>
                          <Badge variante={semanas >= 3 ? "danger" : "warning"} icono={<AlertTriangle size={13} />}>
                            {semanas} sem.
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
            </>
          )}
        </div>
      )}

      {vista === "tabla" && (
        <div className="stack-4">
          <div className="rep-barra">
            <div className="rep-barra__buscar">
              <Input icono={<Search size={16} />} value={busca} onChange={(ev) => setBusca(ev.target.value)} placeholder="Buscar por alumno" aria-label="Buscar por alumno" />
            </div>
            {/* Juntos y contra la derecha, también cuando bajan de renglón en el
                teléfono: el menú de columnas se abre hacia la izquierda y, pegado
                al borde izquierdo, se salía de la pantalla. */}
            <div className="rep-barra__acciones">
              <Button variante="secondary" sm icono={<Download size={15} />} onClick={exportar} disabled={filtradas.length === 0}>Exportar</Button>
              <ConfigColumnas todas={COLUMNAS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} />
            </div>
          </div>
          <div className="row-wrap">
            {/* Los contadores son del período entero, no de la búsqueda: si
                contaran sobre lo filtrado, el chip elegido mostraría su total
                y los demás cero. */}
            <Chip activo={filtro === "todos"} onClick={() => setFiltro("todos")} count={total}>Todos</Chip>
            {ESTADOS.map((k) => (
              <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)} count={cuenta(k)}>{ETIQUETA[k].texto}</Chip>
            ))}
          </div>

          <Card style={{ padding: 0 }}>
            <DataTable
              filas={filtradas} columnas={columnas} alto={620} porPagina={100}
              ordenInicial={{ clave: "semana", desc: true }}
              vacio={
                <Empty
                  icono={<ClipboardList size={22} />}
                  titulo={total === 0 ? "No hay reportes en este período" : "Nada con ese filtro"}
                  texto={total === 0 ? "Probá con otro rango de fechas." : "Probá con otro estado o sacá la búsqueda."}
                  accion={total > 0
                    ? <Button variante="secondary" onClick={() => { setFiltro("todos"); setBusca(""); }}>Limpiar filtros</Button>
                    : undefined}
                />
              }
            />
          </Card>
        </div>
      )}

      <Ayuda titulo="Cómo se cuenta" icono={<Info size={18} />}>
        Cada alumno activo o pausado debe un reporte por semana desde que empezó; si no lo mandó, figura como
        <strong> No enviado</strong> y se puede marcar desde la tabla. Una semana entra en el período si alguno de sus
        días cae adentro. Quien deja de contestar dos semanas seguidas suele estar por caerse: por eso aparece
        <strong> en riesgo</strong>.
      </Ayuda>
    </div>
  );
}
