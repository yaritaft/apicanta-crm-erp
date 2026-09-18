"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight, CalendarDays, Clock, Plus, Target, TriangleAlert, Video, Check, X as XIco,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Bar, Button, Card, CardHead, Empty, Persona, StatCard } from "@/components/ui/ui";
import { AreaChart, Funnel } from "@/components/charts/charts";
import { useEstado } from "@/lib/store";
import { delta, fechaHora, money, num, pct, relativo } from "@/lib/format";
import {
  ETIQUETA_METRICA, egresosMes, ingresosMes, inscriptosMes, leadsMes, leadsSinContactar,
  mrr, porCobrar, progresoMeta, proximasSesiones, semanasSinReportar, tasaConversion,
  tasaShow, ultimosMeses, valorPipeline, variacion,
} from "@/lib/metricas";

export default function Panel() {
  const e = useEstado();
  const meses = useMemo(() => ultimosMeses(6), []);
  const mesActual = meses[meses.length - 1];
  const mesPrevio = meses[meses.length - 2];

  const ingresos = ingresosMes(e, mesActual);
  const ingresosPrev = ingresosMes(e, mesPrevio);
  const egresos = egresosMes(e, mesActual);
  const neto = ingresos - egresos;

  const leadsAhora = leadsMes(e, mesActual).length;
  const leadsAntes = leadsMes(e, mesPrevio).length;
  const inscriptos = inscriptosMes(e, mesActual).length;
  const inscriptosPrev = inscriptosMes(e, mesPrevio).length;

  const pipe = valorPipeline(e);
  const sinContactar = leadsSinContactar(e);
  const proximas = proximasSesiones(e, 5);

  const serie = meses.map((m) => ({
    etiqueta: m.etiqueta,
    valor: ingresosMes(e, m),
    valor2: egresosMes(e, m),
  }));

  const embudo = useMemo(() => {
    const ordenadas = [...e.etapas].filter((x) => !x.esPerdida).sort((a, b) => a.orden - b.orden);
    const colores: Record<string, string> = {
      info: "var(--info)", brand: "var(--brand-fill)", accent: "var(--accent)",
      warning: "var(--warning)", success: "var(--success)", danger: "var(--danger)", neutral: "var(--surface-300)",
    };
    return ordenadas.map((et, i) => ({
      etiqueta: et.nombre,
      /* Cada etapa cuenta los leads que llegaron hasta ahí o más lejos. */
      valor: e.leads.filter((l) => {
        const suya = e.etapas.find((x) => x.id === l.etapaId);
        return suya && !suya.esPerdida && suya.orden >= et.orden;
      }).length,
      color: colores[et.variante] ?? "var(--brand-fill)",
      _i: i,
    }));
  }, [e]);

  const enRiesgo = useMemo(() =>
    e.alumnos
      .filter((a) => a.estado === "activo")
      .map((a) => ({ a, semanas: semanasSinReportar(e, a.id) }))
      .filter((x) => x.semanas >= 2)
      .sort((a, b) => b.semanas - a.semanas)
      .slice(0, 5),
    [e]);

  return (
    <div className="stack-6">
      <PageHead
        titulo={`Hola, ${(e.ajustes.responsable || "Yari").split(" ")[0]}`}
        sub={`Así viene ${mesActual.etiqueta}. Los números se calculan solos con lo que vas cargando.`}
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => { window.location.href = "/leads?nuevo=1"; }}>Nuevo lead</Button>}
      />

      <div className="grid-stats">
        <StatCard
          hero etiqueta="Ingresos del mes" valor={money(ingresos, e.ajustes.monedaBase)}
          delta={delta(variacion(ingresos, ingresosPrev))} direccion={ingresos >= ingresosPrev ? "up" : "down"}
          contexto={`vs. ${mesPrevio.etiqueta}`}
          ayuda="Suma de todos los ingresos con fecha de este mes, cobrados o por cobrar."
        />
        <StatCard
          etiqueta="Resultado del mes" valor={money(neto, e.ajustes.monedaBase)}
          delta={ingresos > 0 ? pct((neto / ingresos) * 100) : "—"} direccion={neto >= 0 ? "up" : "down"}
          contexto="de margen"
          ayuda="Ingresos menos egresos de este mes."
        />
        <StatCard
          etiqueta="Leads nuevos" valor={num(leadsAhora)}
          delta={delta(variacion(leadsAhora, leadsAntes))} direccion={leadsAhora >= leadsAntes ? "up" : "down"}
          contexto={`vs. ${mesPrevio.etiqueta}`}
          ayuda="Personas que entraron este mes."
        />
        <StatCard
          etiqueta="Inscriptos" valor={num(inscriptos)}
          delta={delta(variacion(inscriptos, inscriptosPrev))} direccion={inscriptos >= inscriptosPrev ? "up" : "down"}
          contexto={`vs. ${mesPrevio.etiqueta}`}
          ayuda="Leads que cerraron y pasaron a alumno este mes."
        />
      </div>

      <div className="grid-stats">
        <StatCard etiqueta="MRR" valor={money(mrr(e), e.ajustes.monedaBase)} contexto={`${e.alumnos.filter((a) => a.estado === "activo").length} alumnos activos`} ayuda="Lo que entra todos los meses por cuotas de alumnos activos." />
        <StatCard etiqueta="Pipeline ponderado" valor={money(pipe.ponderado, e.ajustes.monedaBase)} contexto={`de ${money(pipe.bruto, e.ajustes.monedaBase)} abiertos`} ayuda="El valor del pipeline ajustado por la probabilidad de cada etapa." />
        <StatCard etiqueta="Tasa de cierre" valor={pct(tasaConversion(e))} contexto="de los leads cerrados" ayuda="De los leads que ya se definieron, cuántos terminaron inscribiéndose." />
        <StatCard
          etiqueta="Por cobrar" valor={money(porCobrar(e), e.ajustes.monedaBase)}
          delta={porCobrar(e) > 0 ? "Revisar" : undefined} direccion="accent"
          contexto="pendiente de pago" ayuda="Ingresos ya registrados que todavía no se cobraron."
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHead
            titulo="Ingresos y egresos"
            sub="Últimos 6 meses. Pasá el mouse para ver cada mes."
            acciones={<Link href="/finanzas"><Button sm variante="ghost" icono={<ArrowRight size={15} />}>Finanzas</Button></Link>}
          />
          <AreaChart datos={serie} serie2="Egresos" formato={(n) => money(n, e.ajustes.monedaBase)} alto={220} />
        </Card>

        <Card>
          <CardHead
            titulo="Embudo de ventas"
            sub="Cuánta gente llega a cada etapa y cuánta pasa a la siguiente."
            acciones={<Link href="/pipeline"><Button sm variante="ghost" icono={<ArrowRight size={15} />}>Pipeline</Button></Link>}
          />
          <Funnel pasos={embudo} />
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead
            titulo="Próximas sesiones"
            sub={`${proximas.length === 0 ? "Nada" : proximas.length} en agenda · ${pct(tasaShow(e))} de asistencia histórica`}
            acciones={<Link href="/agenda"><Button sm variante="ghost" icono={<ArrowRight size={15} />}>Agenda</Button></Link>}
          />
          {proximas.length === 0 ? (
            <Empty
              icono={<CalendarDays size={22} />}
              titulo="No hay sesiones agendadas"
              texto="Cuando agendes una llamada con un lead va a aparecer acá."
              accion={<Link href="/agenda?nuevo=1"><Button variante="primary">Agendar una sesión</Button></Link>}
            />
          ) : (
            <div className="stack-2">
              {proximas.map((s) => (
                <Link key={s.id} href={`/agenda?ver=${s.id}`} className="agenda-item">
                  <span className="agenda-item__hora">{fechaHora(s.inicia).split(" · ")[1]}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="truncate t-strong" style={{ display: "block", color: "var(--ink)" }}>{s.invitado}</span>
                    <span className="truncate t-sm t-subtle" style={{ display: "block" }}>{s.tipo} · {relativo(s.inicia)}</span>
                  </span>
                  {s.origen === "calendly" && <Badge variante="info">Calendly</Badge>}
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHead titulo="Metas del mes" sub="Cuánto falta para llegar." acciones={<Link href="/metas"><Button sm variante="ghost" icono={<ArrowRight size={15} />}>Metas</Button></Link>} />
          {e.metas.length === 0 ? (
            <Empty
              icono={<Target size={22} />}
              titulo="Todavía no pusiste metas"
              texto="Definí qué querés lograr este mes y te muestro cuánto te falta."
              accion={<Link href="/metas?nuevo=1"><Button variante="primary">Crear una meta</Button></Link>}
            />
          ) : (
            <div className="stack-4">
              {e.metas.slice(0, 4).map((m) => {
                const p = progresoMeta(e, m);
                const fmt = m.unidad === "moneda" ? (n: number) => money(n, e.ajustes.monedaBase) : m.unidad === "porcentaje" ? pct : num;
                return (
                  <div key={m.id}>
                    <div className="row" style={{ marginBottom: 6 }}>
                      <span className="t-sm t-strong">{m.nombre}</span>
                      <span className="spacer t-sm t-num t-muted">{fmt(p.actual)} / {fmt(m.objetivo)}</span>
                      <span className="t-sm t-num t-strong" style={{ minWidth: 46, textAlign: "right", color: p.pct >= 100 ? "var(--success)" : p.pct >= 60 ? "var(--accent-text)" : "var(--ink-subtle)" }}>
                        {Math.round(p.pct)}%
                      </span>
                    </div>
                    <Bar valor={p.pct} tono={p.pct >= 100 ? "success" : "accent"} />
                    <div className="t-sm t-subtle" style={{ marginTop: 4 }}>{ETIQUETA_METRICA[m.metrica]}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <div className="grid-2">
        <Card>
          <CardHead titulo="Requiere atención" sub="Lo que te conviene mirar hoy." />
          <div className="stack-3">
            <Fila
              icono={<Clock size={16} />}
              texto={`${sinContactar.length} leads sin contactar`}
              detalle={sinContactar.length > 0 ? `El más viejo entró ${relativo([...sinContactar].sort((a, b) => +new Date(a.creadoEn) - +new Date(b.creadoEn))[0].creadoEn)}` : "Estás al día"}
              tono={sinContactar.length > 5 ? "warning" : sinContactar.length > 0 ? "info" : "success"}
              href="/leads"
            />
            <Fila
              icono={<TriangleAlert size={16} />}
              texto={`${enRiesgo.length} alumnos sin reportar`}
              detalle={enRiesgo.length > 0 ? `${enRiesgo[0].a.nombre} lleva ${enRiesgo[0].semanas} semanas` : "Todos al día"}
              tono={enRiesgo.length > 0 ? "danger" : "success"}
              href="/reportes"
            />
            <Fila
              icono={<Video size={16} />}
              texto={`${e.webinars.filter((w) => w.estado === "programado").length} webinars por venir`}
              detalle={e.webinars.filter((w) => w.estado === "programado")[0]?.titulo ?? "Sin webinars programados"}
              tono="info"
              href="/webinars"
            />
            <Fila
              icono={<Clock size={16} />}
              texto={`${e.transacciones.filter((t) => t.tipo === "ingreso" && t.estado !== "pagado").length} cobros pendientes`}
              detalle={money(porCobrar(e), e.ajustes.monedaBase) + " sin cobrar"}
              tono={porCobrar(e) > 0 ? "warning" : "success"}
              href="/finanzas"
            />
          </div>
        </Card>

        <Card>
          <CardHead titulo="Últimos movimientos" sub="Cada cambio queda registrado." acciones={<Link href="/actividad"><Button sm variante="ghost" icono={<ArrowRight size={15} />}>Ver todo</Button></Link>} />
          <div className="timeline">
            {e.actividad.slice(0, 6).map((a) => (
              <div key={a.id} className="timeline__item">
                <span className="timeline__dot">
                  {a.accion === "creo" ? <Plus size={13} /> : a.accion === "elimino" ? <XIco size={13} /> : <Check size={13} />}
                </span>
                <div style={{ minWidth: 0 }}>
                  <div className="timeline__text">{a.detalle}</div>
                  <div className="timeline__meta">{a.actor} · {relativo(a.fecha)}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead titulo="Alumnos que necesitan seguimiento" sub="Activos que no mandaron su reporte hace 2 semanas o más." acciones={<Link href="/reportes"><Button sm variante="ghost" icono={<ArrowRight size={15} />}>Reportes</Button></Link>} />
        {enRiesgo.length === 0 ? (
          <Empty icono={<Check size={22} />} titulo="Todos al día" texto="Ningún alumno activo tiene dos o más semanas sin reportar. Buen trabajo." />
        ) : (
          <div className="stack-2">
            {enRiesgo.map(({ a, semanas }) => (
              <Link key={a.id} href={`/alumnos?ver=${a.id}`} className="agenda-item">
                <Persona nombre={a.nombre} sub={`${a.plan} · ${a.cohorte}`} />
                <span className="spacer" />
                <Badge variante={semanas >= 3 ? "danger" : "warning"} icono={<Clock size={13} />}>
                  {semanas} semanas sin reportar
                </Badge>
              </Link>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Fila({ icono, texto, detalle, tono, href }: {
  icono: React.ReactNode; texto: string; detalle: string;
  tono: "success" | "warning" | "danger" | "info"; href: string;
}) {
  const color = { success: "var(--success)", warning: "var(--warning)", danger: "var(--danger)", info: "var(--info)" }[tono];
  const fondo = { success: "var(--success-soft)", warning: "var(--warning-soft)", danger: "var(--danger-soft)", info: "var(--info-soft)" }[tono];
  return (
    <Link href={href} className="agenda-item">
      <span style={{ display: "grid", placeItems: "center", width: 32, height: 32, borderRadius: 8, background: fondo, color, flex: "none" }}>
        {icono}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="truncate t-strong" style={{ display: "block", color: "var(--ink)" }}>{texto}</span>
        <span className="truncate t-sm t-subtle" style={{ display: "block" }}>{detalle}</span>
      </span>
      <ArrowRight size={16} color="var(--ink-subtle)" />
    </Link>
  );
}
