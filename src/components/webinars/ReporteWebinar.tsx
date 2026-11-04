"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, ClipboardCopy } from "lucide-react";
import { Button, Card, CardHead } from "@/components/ui/ui";
import { CampoFecha } from "@/components/ui/Campos";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { useToast } from "@/components/ui/Toast";
import { copiarTexto } from "@/components/ui/Telefono";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { useEstado } from "@/lib/store";
import { estadoVisible } from "@/lib/estados";
import { clasesDe } from "@/lib/agendas-descarga";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { reporteDelWebinar, tasasDelReporte, textoDelReporte, type AgendaParaReporte } from "@/lib/reporte-webinar";
import { money, num, pct } from "@/lib/format";
import type { Webinar } from "@/lib/types";
import { useAgendasWebinar } from "./useVivo";

/* ==================================================================
   «Reporte para el equipo»: el mensaje de métricas que Santi mandaba al
   grupo después de cada webinar, armado por la app (lib/reporte-webinar.ts)
   con la misma facturación y el mismo cash que dice esta ficha. Se elige
   hasta qué día (Santi lo mandó al 31/10) y se copia tal cual.
   ================================================================== */

export function ReporteWebinar({ w }: { w: Webinar }) {
  const e = useEstado();
  const toast = useToast();
  const abrirFicha = useAbrirFicha();
  const r = useAgendasWebinar(w.id);
  const d = r.estado === "listo" ? r.datos : null;
  const hoy = diaDeNegocio(new Date().toISOString());
  const [hasta, setHasta] = useState(hoy);

  const reporte = useMemo(() => {
    const sesiones = new Map(e.sesiones.map((s) => [s.id, s] as const));
    const agendas: AgendaParaReporte[] = (d?.agendas ?? []).filter((a) => !a.fuera).map((a) => {
      const s = sesiones.get(a.id);
      const ver = s ? estadoVisible(e, s) : undefined;
      return {
        persona: a.contactoId ?? a.id, agendadaEn: a.agendadaEn, desenlace: ver?.desenlace,
        clases: s ? clasesDe(s, ver?.desenlace) : a.estado === "no-show" ? ["no-vino"] : a.cancelada ? ["cancelo"] : [],
      };
    });
    return reporteDelWebinar(e, w, agendas, hasta || hoy);
  }, [e, w, d, hasta, hoy]);
  const t = tasasDelReporte(reporte);
  const M = (n: number, dec = 0) => money(n, "USD", dec);

  async function copiar() {
    const ok = await copiarTexto(textoDelReporte(reporte));
    toast(ok ? "Reporte copiado: pegalo en el grupo." : "No se pudo copiar. Probá de nuevo.", ok ? "ok" : "err");
  }

  return (
    <Card id="reporte" style={{ scrollMarginTop: 72 }}>
      <CardHead
        titulo="Reporte para el equipo"
        sub="Las métricas para mandar al grupo, sacadas de la app: la facturación y el cash son los de esta ficha."
        acciones={(
          <span className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
            <span className="t-sm t-subtle">Hasta el</span>
            <CampoFecha value={hasta} max={hoy} onChange={(ev) => setHasta(String(ev.target.value || hoy))} aria-label="Hasta qué día" style={{ width: 150 }} />
            <Button sm variante="primary" icono={<ClipboardCopy size={15} />} onClick={() => void copiar()} disabled={r.estado === "cargando"}>
              Copiar para WhatsApp
            </Button>
          </span>
        )}
      />
      {r.estado === "error" && <p className="t-sm t-muted">Las agendas no cargaron ({r.error}): el reporte sale sin ellas.</p>}

      <div className="wb-kpis" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", marginBottom: 0 }}>
        <Dato etiqueta="Facturación" valor={M(reporte.facturacion)} sub={`${num(reporte.cierres.ventas + reporte.reservas.ventas + reporte.downsell.ventas + reporte.otras.ventas)} ventas`}
          info={{ ayuda: "Lo que valen las ventas del webinar: el valor total de cada una, aunque todavía no la haya pagado entera.", formula: "Suma del valor total de las ventas del webinar (sin las canceladas)" }} />
        <Dato etiqueta="Cash collected" valor={M(reporte.cash)} sub={reporte.devoluciones.monto ? `${M(reporte.entro)} entró − ${M(reporte.devoluciones.monto)} devuelto` : "lo que ya entró"}
          info={{ ayuda: "Lo que ya entró de esas ventas hasta el día elegido, menos lo devuelto.", formula: "Cobros de las ventas del webinar hasta ese día − devoluciones" }} />
        <Dato etiqueta="Cierres" valor={num(reporte.cierres.ventas)} sub={`${num(reporte.cierres.full)} full · ${num(reporte.cierres.enCuotas)} en cuotas`} />
        <Dato etiqueta="Agendas" valor={num(reporte.agendas.total)} sub={`${num(reporte.agendas.asistieron)} asistieron · ${pct(t.showRate)}`} />
        <Dato etiqueta="Cierre sobre asistido" valor={pct(t.cierreSobreAsistido)} sub={`${pct(t.cierreSobreAgenda)} sobre agenda`} />
        <Dato etiqueta="Ticket promedio" valor={M(t.aov)} sub="de los cierres (AOV)" />
      </div>

      {reporte.deOtroOrigen.length > 0 && (
        <details className="hs-aviso" role="note" style={{ marginTop: 12, display: "block" }}>
          <summary style={{ cursor: "pointer", display: "flex", gap: 10, alignItems: "flex-start" }}>
            <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2, color: "var(--warning)" }} />
            <span>
              {reporte.deOtroOrigen.length === 1 ? "Una venta atada a este webinar parece de otro embudo" : `${reporte.deOtroOrigen.length} ventas atadas a este webinar parecen de otro embudo`}
              {" "}(suman {M(reporte.deOtroOrigen.reduce((a, x) => a + x.venta.precioAcordado, 0))} de facturación). <span className="link">Ver cuáles</span>
            </span>
          </summary>
          <span style={{ display: "block", paddingLeft: 26, marginTop: 6 }}>
            {reporte.deOtroOrigen.map(({ venta, motivo }) => (
              <span key={venta.id} style={{ display: "block" }}>
                <button type="button" className="link" onClick={() => abrirFicha(venta.contactoId ?? venta.id, "ventas", { venta: venta.id })}>{venta.contactoNombre}</button>
                <span className="t-subtle"> · {motivo}</span>
              </span>
            ))}
          </span>
        </details>
      )}

      <details style={{ marginTop: 12 }}>
        <summary className="t-sm link" style={{ cursor: "pointer" }}>Ver el mensaje completo</summary>
        <pre className="t-sm" style={{ whiteSpace: "pre-wrap", margin: "8px 0 0", fontFamily: "inherit" }}>{textoDelReporte(reporte)}</pre>
      </details>
    </Card>
  );
}

function Dato({ etiqueta, valor, sub, info }: { etiqueta: string; valor: string; sub?: string; info?: { ayuda: string; formula: string } }) {
  return (
    <div className="wb-kpi">
      <span className="t-label">{etiqueta}{info && <InfoMetrica titulo={etiqueta} ayuda={info.ayuda} formula={info.formula} />}</span>
      <span className="wb-kpi__valor t-num" title={valor}>{valor}</span>
      {sub && <span className="t-sm t-subtle t-num">{sub}</span>}
    </div>
  );
}
