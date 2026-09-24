"use client";

import React from "react";
import { Card, CardHead, Tabs } from "@/components/ui/ui";
import { Dato } from "@/components/ui/Drawer";
import { Funnel } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { useEstado } from "@/lib/store";
import { money, num, pct } from "@/lib/format";
import { CAMPO_MANUAL, type CampoManual, type MetricasWebinar } from "@/lib/webinar";
import type { Webinar } from "@/lib/types";
import { CeldaEditable, type Direccion } from "./CeldaEditable";
import { guardarMetrica } from "./guardar";
import { tonoRoas } from "./estado";

/* ==================================================================
   Los números del lanzamiento, en la ficha.

   Los que se cargan a mano se editan donde están (igual que en la
   planilla): click, escribir, Enter. Enter pasa al número de abajo, así
   la carga del día es escribir y Enter, escribir y Enter. Los demás se
   recalculan en el momento con las mismas fórmulas de la planilla
   (lib/webinar.ts).
   ================================================================== */

/* Enter, Tab o las flechas van al próximo número editable de la ficha,
   en el orden en que se leen. */
export function moverMetrica(campo: string, hacia: Direccion) {
  const todas = [...document.querySelectorAll<HTMLElement>('[data-celda^="m:"]')];
  const i = todas.findIndex((el) => el.getAttribute("data-celda") === `m:${campo}`);
  if (i < 0) return;
  const paso = hacia === "abajo" || hacia === "derecha" ? 1 : -1;
  (todas[i + paso] ?? todas[i]).focus();
}

function useMoneda() {
  const mon = useEstado().ajustes.monedaBase;
  return (n: number, d = 0) => money(n, mon, d);
}

function FilaMetrica({ w, campo, detalle, color }: {
  w: Webinar; campo: CampoManual; detalle?: React.ReactNode; color?: string;
}) {
  const M = useMoneda();
  const toast = useToast();
  const def = CAMPO_MANUAL[campo];
  const formato = (n: number) => (def.moneda ? M(n) : num(n));
  return (
    <div className="wb-fila">
      <div className="wb-fila__texto">
        <span className="wb-fila__nombre">
          {color && <i className="chart-legend__dot" style={{ background: color }} aria-hidden />}
          {def.largo}
        </span>
        {detalle && <span className="wb-fila__detalle t-num">{detalle}</span>}
      </div>
      <CeldaEditable
        grande
        valor={w[campo]}
        formato={formato}
        decimales={def.moneda ? 2 : 0}
        etiqueta={def.largo}
        ayuda={`${def.ayuda} Click o Enter para cambiarlo.`}
        celda={`m:${campo}`}
        onGuardar={(n) => guardarMetrica(w, campo, n, formato)}
        onMover={(hacia) => moverMetrica(campo, hacia)}
        onError={(msg) => toast(msg, "err")}
      />
    </div>
  );
}

function Kpi({ etiqueta, valor, sub, color }: { etiqueta: string; valor: string; sub?: string; color?: string }) {
  return (
    <div className="wb-kpi">
      <span className="t-label">{etiqueta}</span>
      <span className="wb-kpi__valor t-num" style={color ? { color } : undefined} title={valor}>{valor}</span>
      {sub && <span className="t-sm t-subtle t-num">{sub}</span>}
    </div>
  );
}

/* ---------- Resultado ---------- */

export function TarjetaResultado({ m, className }: { m: MetricasWebinar; className?: string }) {
  const M = useMoneda();
  const tasaCobro = m.facturado > 0 ? (m.cobrado / m.facturado) * 100 : 0;
  return (
    <Card className={className}>
      <CardHead
        titulo="Resultado"
        sub={m.ventas > 0
          ? `${num(m.ventas)} ${m.ventas === 1 ? "venta atribuida" : "ventas atribuidas"} a este webinar`
          : "Todavía no hay ventas atribuidas a este webinar"}
      />
      <div className="wb-kpis">
        <Kpi
          etiqueta="ROAS cobrado" valor={m.roasCC > 0 ? `${num(m.roasCC, 2)}x` : "—"}
          color={m.roasCC > 0 ? tonoRoas(m.roasCC) : undefined}
          sub={m.roasRev > 0 ? `${num(m.roasRev, 2)}x facturado` : "sobre la inversión total"}
        />
        <Kpi
          etiqueta="Profit cobrado" valor={M(m.beneficioCC)}
          color={m.beneficioCC >= 0 ? "var(--success)" : "var(--danger)"}
          sub={`${M(m.beneficioRev)} facturado`}
        />
        <Kpi etiqueta="CPA" valor={m.cpa > 0 ? M(m.cpa) : "—"} sub="lo que costó cada venta" />
        <Kpi
          etiqueta="Costo por formulario" valor={m.cplFormulario > 0 ? M(m.cplFormulario, 2) : "—"}
          sub={`${num(m.formularios)} formularios`}
        />
      </div>
      <dl className="dl wb-dl">
        <Dato label="Ventas">{num(m.ventas)}</Dato>
        <Dato label="Facturado">{M(m.facturado)}</Dato>
        <Dato label="Cobrado">
          {M(m.cobrado)}
          {m.facturado > 0 && <span className="t-sm t-subtle"> · {pct(tasaCobro, 0)} de lo facturado</span>}
        </Dato>
        <Dato label="ROAS facturado">
          {m.roasRev > 0 ? <span style={{ color: tonoRoas(m.roasRev), fontWeight: 600 }}>{num(m.roasRev, 2)}x</span> : "—"}
        </Dato>
        <Dato label="Comisiones">{M(m.comisiones)}</Dato>
        <Dato label="Procesador">{M(m.procesador)}</Dato>
        <Dato label="Inversión">{M(m.inversionTotal)}</Dato>
      </dl>
      <p className="t-sm t-subtle" style={{ marginTop: "var(--space-4)" }}>
        Profit = la plata menos pauta, DM Ads, WhatsApp API, comisiones y procesador. Las ventas se suman solas
        cuando se cargan con este webinar como origen.
      </p>
    </Card>
  );
}

/* ---------- Inversión ---------- */

const COLORES_INVERSION: Record<string, string> = {
  inversion: "var(--brand-fill)", inversionDmAds: "var(--info)", costoWhatsappApi: "var(--border-strong)",
};

export function TarjetaInversion({ w, m, className }: { w: Webinar; m: MetricasWebinar; className?: string }) {
  const M = useMoneda();
  const partes = (["inversion", "inversionDmAds", "costoWhatsappApi"] as const).map((k) => ({ k, v: w[k] }));
  const parte = (v: number) => (m.inversionTotal > 0 ? `${pct((v / m.inversionTotal) * 100, 0)} del total` : undefined);
  return (
    <Card className={className}>
      <CardHead titulo="Inversión" sub="Lo que costó llenar el vivo" />
      <div className="wb-total">
        <span className="wb-total__valor t-num">{M(m.inversionTotal)}</span>
        <span className="t-sm t-subtle">en total</span>
      </div>
      {m.inversionTotal > 0 && (
        <div className="wb-reparto" aria-hidden>
          {partes.filter((p) => p.v > 0).map((p) => (
            <span key={p.k} style={{ width: `${(p.v / m.inversionTotal) * 100}%`, background: COLORES_INVERSION[p.k] }} />
          ))}
        </div>
      )}
      <div className="wb-filas">
        {partes.map((p) => (
          <FilaMetrica key={p.k} w={w} campo={p.k} color={COLORES_INVERSION[p.k]} detalle={parte(p.v)} />
        ))}
      </div>
    </Card>
  );
}

/* ---------- Captación ---------- */

export function TarjetaCaptacion({ w, m, className }: { w: Webinar; m: MetricasWebinar; className?: string }) {
  const M = useMoneda();
  return (
    <Card className={className}>
      <CardHead titulo="Captación" sub="Del formulario al vivo" />
      <div className="wb-filas">
        <FilaMetrica
          w={w} campo="formularios"
          detalle={m.cplFormulario > 0 ? `${M(m.cplFormulario, 2)} cada uno` : undefined}
        />
        <FilaMetrica
          w={w} campo="grupoWpp"
          detalle={m.formularios > 0
            ? `${pct(m.asistenciaFormulario)} de los formularios${m.cplGrupo > 0 ? ` · ${M(m.cplGrupo, 2)} cada uno` : ""}`
            : undefined}
        />
        <FilaMetrica
          w={w} campo="asistentes"
          detalle={m.grupoWpp > 0 ? `${pct(m.asistenciaTaller)} del grupo` : undefined}
        />
      </div>
    </Card>
  );
}

/* ---------- Llamadas ---------- */

export function TarjetaLlamadas({ w, m, className }: { w: Webinar; m: MetricasWebinar; className?: string }) {
  const M = useMoneda();
  const total = m.llamadas;
  const de = (n: number) => (total > 0 ? `${pct((n / total) * 100, 0)} de las agendadas` : undefined);
  /* Lo que falta para completar las agendadas: llamadas que todavía no
     pasaron o que nadie marcó. */
  const resultado = [
    { k: "llamadasCalificadas", v: w.llamadasCalificadas, color: "var(--success)" },
    { k: "llamadasNoCalificadas", v: w.llamadasNoCalificadas, color: "var(--warning)" },
    { k: "llamadasInasistidas", v: w.llamadasInasistidas, color: "var(--danger)" },
    { k: "llamadasCanceladas", v: w.llamadasCanceladas, color: "var(--border-strong)" },
  ] as const;
  const conResultado = resultado.reduce((a, r) => a + r.v, 0);
  const escala = Math.max(total, conResultado);

  return (
    <Card className={className}>
      <CardHead titulo="Llamadas" sub="Cuántas se agendaron y cómo terminaron" />
      <div className="wb-total">
        <span className="wb-total__valor t-num">{num(total)}</span>
        <span className="t-sm t-subtle">
          agendadas{m.grupoWpp > 0 ? ` · ${pct(m.porcentajeAgenda)} del grupo` : ""}
          {m.cpLlamada > 0 ? ` · ${M(m.cpLlamada)} cada una` : ""}
        </span>
      </div>
      {escala > 0 && (
        <div className="wb-reparto" aria-hidden>
          {resultado.filter((r) => r.v > 0).map((r) => (
            <span key={r.k} style={{ width: `${(r.v / escala) * 100}%`, background: r.color }} />
          ))}
        </div>
      )}
      <div className="wb-filas">
        <FilaMetrica w={w} campo="llamadasVivo" />
        <FilaMetrica w={w} campo="llamadasPosterior" />
        <div className="wb-filas__corte" />
        <FilaMetrica
          w={w} campo="llamadasCalificadas" color="var(--success)"
          detalle={[de(w.llamadasCalificadas), m.cpLlamadaCalificada > 0 ? `${M(m.cpLlamadaCalificada)} cada una` : ""].filter(Boolean).join(" · ") || undefined}
        />
        <FilaMetrica w={w} campo="llamadasNoCalificadas" color="var(--warning)" detalle={de(w.llamadasNoCalificadas)} />
        <FilaMetrica w={w} campo="llamadasInasistidas" color="var(--danger)" detalle={de(w.llamadasInasistidas)} />
        <FilaMetrica w={w} campo="llamadasCanceladas" color="var(--border-strong)" detalle={de(w.llamadasCanceladas)} />
      </div>
      {conResultado > total && total > 0 && (
        <p className="t-sm" style={{ color: "var(--warning)", marginTop: "var(--space-3)" }}>
          Los resultados suman {num(conResultado)} y hay {num(total)} agendadas: revisá si falta cargar alguna agendada.
        </p>
      )}
    </Card>
  );
}

/* ---------- Embudo ---------- */

/* Dos modos: "En vivo" (los que vieron el vivo y las agendas que se
   hicieron durante) y "Con post vivo" (suma lo de después: las vistas de la
   grabación y las agendas del link de después), con lo del vivo y lo de
   después en dos colores dentro de la misma barra. Lo usan la ficha (un
   webinar) y la lista de webinars (la suma de los filtrados). */
export const COLOR_VIVO = "var(--danger)";
export const COLOR_DESPUES = "var(--info)";

export interface DatosEmbudo {
  formularios: number; grupoWpp: number;
  asistentes: number; grabacion: number;
  llamadasVivo: number; llamadasPosterior: number;
  calificadas: number; ventas: number;
}

export const grabacionDe = (w: Webinar) =>
  (typeof w.extra?.vistasGrabacion === "number" ? (w.extra.vistasGrabacion as number) : 0);

export function EmbudoDosModos({ d, titulo, sub, className, children }: {
  d: DatosEmbudo; titulo: string; sub: string; className?: string; children?: React.ReactNode;
}) {
  const [modo, setModo] = React.useState<"vivo" | "todo">("vivo");
  const todo = modo === "todo";
  return (
    <Card className={`wb-embudo${className ? ` ${className}` : ""}`}>
      <CardHead
        titulo={titulo}
        sub={sub}
        acciones={
          <Tabs<"vivo" | "todo">
            valor={modo} onChange={setModo}
            opciones={[{ valor: "vivo", texto: "En vivo" }, { valor: "todo", texto: "Con post vivo" }]}
          />
        }
      />
      <Funnel
        pasos={[
          { etiqueta: "Formularios", valor: d.formularios, color: "var(--brand-fill)" },
          { etiqueta: "Grupo de WhatsApp", valor: d.grupoWpp, color: "var(--brand-fill)" },
          todo
            ? { etiqueta: "Vieron el vivo o la grabación", valor: d.asistentes, color: COLOR_VIVO, valor2: d.grabacion, color2: COLOR_DESPUES }
            : { etiqueta: "Asistieron al vivo", valor: d.asistentes, color: COLOR_VIVO },
          todo
            ? { etiqueta: "Llamadas agendadas", valor: d.llamadasVivo, color: COLOR_VIVO, valor2: d.llamadasPosterior, color2: COLOR_DESPUES }
            : { etiqueta: "Agendadas en el vivo", valor: d.llamadasVivo, color: COLOR_VIVO },
          { etiqueta: "Calificadas", valor: d.calificadas, color: "var(--brand-fill)" },
          { etiqueta: "Ventas", valor: d.ventas, color: "var(--success)" },
        ]}
        formato={num}
      />
      <div className="chart-legend" style={{ marginTop: "var(--space-3)" }}>
        <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: COLOR_VIVO }} />En el vivo</span>
        {todo && <span className="chart-legend__item"><i className="chart-legend__dot" style={{ background: COLOR_DESPUES }} />Después del vivo</span>}
        {todo && d.grabacion === 0 && (
          <span className="t-sm t-subtle">
            Todavía no hay vistas de la grabación: se toman una vez por hora después del vivo (y las definitivas, de YouTube Analytics, a los dos o tres días).
          </span>
        )}
      </div>
      {children}
    </Card>
  );
}

export function TarjetaEmbudo({ w, m, className }: { w: Webinar; m: MetricasWebinar; className?: string }) {
  return (
    <EmbudoDosModos
      titulo="El embudo, paso a paso" sub="Cuánta gente llegó a cada escalón y cuánta pasó al siguiente." className={className}
      d={{
        formularios: m.formularios, grupoWpp: m.grupoWpp, asistentes: m.asistentes, grabacion: grabacionDe(w),
        llamadasVivo: w.llamadasVivo, llamadasPosterior: w.llamadasPosterior, calificadas: m.llamadasCalificadas, ventas: m.ventas,
      }}
    >
      <dl className="dl wb-dl" style={{ marginTop: "var(--space-5)" }}>
        <Dato label="Form → grupo">{pct(m.asistenciaFormulario)}</Dato>
        <Dato label="Asistencia">{pct(m.asistenciaTaller)}</Dato>
        <Dato label="Grupo → agenda">{pct(m.porcentajeAgenda)}</Dato>
        <Dato label="Asisten → agenda">{pct(m.agendaSobreAsisten)}</Dato>
        <Dato label="Grupo → venta">{pct(m.convLeadVenta, 2)}</Dato>
        <Dato label="Tasa de cierre">{pct(m.tasaCierre)}</Dato>
      </dl>
    </EmbudoDosModos>
  );
}
