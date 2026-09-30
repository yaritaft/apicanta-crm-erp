"use client";

import React, { useMemo } from "react";
import { CalendarCheck } from "lucide-react";
import { Card, CardHead, Empty } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { useEstado } from "@/lib/store";
import { money, num, pct } from "@/lib/format";
import { NOMBRE_LINK, NOMBRE_VIA, rendimientoPorVia, type NumerosVia } from "@/lib/vias-webinar";
import type { Webinar } from "@/lib/types";

/* ==================================================================
   De dónde vinieron las agendas del webinar y cuánto vendió cada vía:
   el vivo, el replay y el seguimiento del webinar, su clase cero y su Q&A
   (lib/vias-webinar.ts). Lo pidió Yari para ver cuánto rinde cada cosa.

   Una fila por vía, con el detalle de cada link abajo. Las ventas del
   webinar de gente que no agendó por ningún link del lanzamiento van en
   una fila aparte, así el total da las ventas del resultado.
   ================================================================== */

interface Fila { id: string; nivel: "via" | "link" | "sin"; nombre: string; n: NumerosVia }

export function TarjetaVias({ w, className }: { w: Webinar; className?: string }) {
  const e = useEstado();
  const r = useMemo(() => rendimientoPorVia(e, w), [e, w]);
  const M = (n: number) => money(n, e.ajustes.monedaBase);
  const nada = <span className="t-subtle">—</span>;

  const filas = useMemo(() => {
    const out: Fila[] = [];
    for (const g of r.grupos) {
      out.push({ id: g.via, nivel: "via", nombre: NOMBRE_VIA[g.via], n: g.total });
      for (const f of g.filas) out.push({ id: `${g.via}:${f.link}`, nivel: "link", nombre: NOMBRE_LINK[g.via][f.link], n: f.n });
    }
    if (r.sinAgenda.ventas > 0) out.push({ id: "sin", nivel: "sin", nombre: "Sin agenda de este lanzamiento", n: r.sinAgenda });
    return out;
  }, [r]);

  /* Antes de que las agendas entraran solas desde Calendly no hay por qué
     link agendó nadie: no se puede separar. */
  const primeraAgenda = useMemo(() => e.sesiones.reduce<number>((m, s) => (
    (s.origen === "calendly" || s.calendlyInvitadoUri) ? Math.min(m, Date.parse(s.creadoEn)) : m
  ), Infinity), [e.sesiones]);
  const esDeAntes = Date.parse(w.fecha) < primeraAgenda - 2 * 86_400_000;

  const cierre = (n: NumerosVia) => (n.agendas > 0 ? pct((n.ventas / n.agendas) * 100, 0) : nada);
  const conAgenda: NumerosVia = { ...r.total, ventas: r.total.ventas - r.sinAgenda.ventas };
  const columnas: Columna<Fila>[] = [
    {
      clave: "via", titulo: "Vía", tipo: "primary", pie: "Total",
      celda: (f) => (f.nivel === "via" ? <span className="t-strong">{f.nombre}</span>
        : f.nivel === "link" ? <span className="wb-via__link">{f.nombre}</span>
          : <span className="t-muted">{f.nombre}</span>),
    },
    {
      clave: "agendas", titulo: "Agendas", tipo: "num", pie: num(r.total.agendas),
      celda: (f) => (f.nivel === "sin" ? nada : (
        <span title={f.n.canceladas ? `Y ${num(f.n.canceladas)} ${f.n.canceladas === 1 ? "cancelada" : "canceladas"}` : undefined}>{num(f.n.agendas)}</span>
      )),
    },
    { clave: "calificadas", titulo: "Calificadas", tipo: "num", pie: num(r.total.calificadas), celda: (f) => (f.nivel === "sin" ? nada : num(f.n.calificadas)) },
    { clave: "ventas", titulo: "Ventas", tipo: "num", pie: num(r.total.ventas), celda: (f) => num(f.n.ventas) },
    { clave: "cierre", titulo: "Cierre", tipo: "num", pie: cierre(conAgenda), celda: (f) => (f.nivel === "sin" ? nada : cierre(f.n)) },
    { clave: "facturado", titulo: "Facturado", tipo: "num", pie: M(r.total.facturado), celda: (f) => M(f.n.facturado) },
    { clave: "cobrado", titulo: "Cobrado", tipo: "num", pie: M(r.total.cobrado), celda: (f) => M(f.n.cobrado) },
  ];

  return (
    <Card className={className}>
      <CardHead
        titulo="De dónde vinieron las agendas"
        sub="Por qué link agendó cada uno y cuánto vendió cada vía: el vivo, el replay y el seguimiento del webinar, su clase cero y su Q&A."
      />
      {!r.hayAgendas ? (
        <Empty
          icono={<CalendarCheck size={22} />}
          titulo={esDeAntes ? "Este webinar es de antes de que las agendas entraran solas" : "Todavía no llegó ninguna agenda de este lanzamiento"}
          texto={esDeAntes
            ? "Sus agendas no dicen por qué link llegaron, así que no se pueden separar por vía."
            : "Aparecen solas cuando alguien agenda desde un link del webinar, de su clase cero o de su Q&A."}
        />
      ) : (
        <div className="stack-3">
          <div className="wb-vias">
            <DataTable filas={filas} columnas={columnas} vacio={null} etiquetaFila={(f) => f.nombre} />
          </div>
          <p className="t-sm t-subtle">
            Una venta es de la vía por la que agendó esa persona: su última agenda de este webinar, su clase cero o su Q&A
            hasta el día de la venta. Cierre: ventas sobre agendas.
            {r.sinAgenda.ventas > 0 ? " «Sin agenda de este lanzamiento» son ventas del webinar de gente que no agendó por esos links." : ""}
          </p>
        </div>
      )}
    </Card>
  );
}
