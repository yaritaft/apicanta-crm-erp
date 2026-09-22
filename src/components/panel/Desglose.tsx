"use client";

import Link from "next/link";
import { Badge, Tag } from "@/components/ui/ui";
import { Drawer } from "@/components/ui/Drawer";
import { useEstado } from "@/lib/store";
import { fecha, money, num, pct, relativo } from "@/lib/format";
import { comisionesDelMes, cuotasPorCobrar, gastosDelMes, pagosDelMes } from "@/lib/finanzas";
import {
  alumnosActivos, inscriptosMes, leadsCerrados, leadsDelPipeline, leadsMes, type RangoMes,
} from "@/lib/metricas";
import type { EstadoApp, Lead } from "@/lib/types";

/* ==================================================================
   El desglose de un número del Panel: qué registros lo forman.

   Cada total sale de la MISMA lista que se muestra (pagosDelMes,
   cuotasPorCobrar, leadsDelPipeline...), no de una cuenta paralela: el
   panel lateral no puede sumar distinto que la tarjeta que lo abrió.
   ================================================================== */

export type QueDesglosar =
  | { tipo: "ingresos" } | { tipo: "resultado" } | { tipo: "leads" } | { tipo: "inscriptos" }
  | { tipo: "mrr" } | { tipo: "pipeline" } | { tipo: "cierre" } | { tipo: "cobrar" }
  | { tipo: "etapa"; etapaId: string };

interface Fila { id: string; titulo: string; detalle?: string; valor?: string; href?: string; marca?: React.ReactNode }
interface Seccion { titulo?: string; total?: string; filas: Fila[]; vacio?: string }
interface Contenido { titulo: string; sub: string; resumen: { etiqueta: string; valor: string }[]; secciones: Seccion[] }

/* Los datos de ejemplo y los de prueba se marcan, para que nadie los tome
   por reales cuando conviven con los que entran de verdad. */
/* La semilla de ejemplo numera sus ids con cuatro cifras (`ven_0012`,
   `lead_0003`); los que nacen en la app llevan fecha y azar (`ven_mf3k…`), y
   los que entran de Calendly o de una migración, el id de su origen. */
function marcaDeDato(id: string): string | null {
  if (id.startsWith("prueba_")) return "prueba";
  if (/^[a-z]+_\d{4}$/.test(id)) return "ejemplo";
  return null;
}

function contenido(e: EstadoApp, que: QueDesglosar, mes: RangoMes): Contenido {
  const M = (n: number, d = 0) => money(n, e.ajustes.monedaBase, d);
  const etapaDe = (l: Lead) => e.etapas.find((x) => x.id === l.etapaId);
  const filaLead = (l: Lead, detalle?: string): Fila => ({
    id: l.id, titulo: l.nombre, href: `/leads?ver=${l.id}`, valor: money(l.monto, l.moneda),
    detalle: detalle ?? `${etapaDe(l)?.nombre ?? "Sin etapa"} · ${l.fuente || "Sin fuente"} · entró ${relativo(l.creadoEn)}`,
  });
  const cuotaDe = (id: string) => e.cuotas.find((c) => c.id === id);
  const ventaDe = (id?: string) => (id ? e.ventas.find((v) => v.id === id) : undefined);
  const procesador = (id?: string) => (id ? e.procesadores.find((p) => p.id === id)?.nombre : undefined);
  const nombreCuota = (c?: { numero: number; esReserva: boolean }) =>
    !c ? "Pago" : c.esReserva ? "Reserva" : `Cuota ${c.numero}`;

  const pagos = () => pagosDelMes(e, mes)
    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha))
    .map((p) => {
      const c = cuotaDe(p.cuotaId);
      const v = ventaDe(c?.ventaId);
      return {
        p, fila: {
          id: p.id, titulo: v?.contactoNombre ?? "Pago sin venta",
          detalle: [nombreCuota(c), fecha(p.fecha), procesador(p.procesadorId)].filter(Boolean).join(" · "),
          valor: M(p.monto), href: v ? `/ventas?ver=${v.id}` : undefined,
        } as Fila,
      };
    });

  switch (que.tipo) {
    case "ingresos": {
      const lista = pagos();
      const total = lista.reduce((a, x) => a + x.p.monto, 0);
      return {
        titulo: "Ingresos del mes", sub: `${mes.etiqueta} · lo que se cobró`,
        resumen: [{ etiqueta: "Cobrado", valor: M(total) }, { etiqueta: "Pagos", valor: num(lista.length) }],
        secciones: [{ filas: lista.map((x) => x.fila), vacio: "No entró ningún pago este mes." }],
      };
    }

    case "resultado": {
      const lista = pagos();
      const ingresos = lista.reduce((a, x) => a + x.p.monto, 0);

      const comisiones: Fila[] = [];
      for (const c of comisionesDelMes(e, mes)) {
        const v = ventaDe(c.ventaId);
        if (c.comisionCloser > 0) comisiones.push({ id: `${c.ventaId}_closer`, titulo: `${c.closerNombre} · closer`, detalle: `Venta de ${v?.contactoNombre ?? "—"}`, valor: M(c.comisionCloser), href: `/ventas?ver=${c.ventaId}` });
        if (c.comisionDirector > 0) comisiones.push({ id: `${c.ventaId}_director`, titulo: `${e.equipo.find((x) => x.id === c.directorId)?.nombre ?? "Director"} · director`, detalle: `Venta de ${v?.contactoNombre ?? "—"}`, valor: M(c.comisionDirector), href: `/ventas?ver=${c.ventaId}` });
      }
      const totalComisiones = comisionesDelMes(e, mes).reduce((a, c) => a + c.comisionCloser + c.comisionDirector, 0);

      const conFee = lista.filter((x) => x.p.feeMonto > 0);
      const fees = conFee.map((x) => ({ ...x.fila, id: `${x.p.id}_fee`, titulo: `Fee de ${procesador(x.p.procesadorId) ?? "la pasarela"}`, detalle: x.fila.titulo, valor: M(x.p.feeMonto) }));
      const totalFees = conFee.reduce((a, x) => a + x.p.feeMonto, 0);

      const gastos = (grupo: "directo" | "operativo" | "dueno") => {
        const g = gastosDelMes(e, mes, grupo).sort((a, b) => b.monto - a.monto);
        return {
          total: g.reduce((a, x) => a + x.monto, 0),
          filas: g.map((x) => ({ id: x.id, titulo: x.concepto || x.categoria, detalle: `${x.categoria} · ${fecha(x.fecha)}`, valor: M(x.monto) })),
        };
      };
      const directos = gastos("directo"), operativos = gastos("operativo"), honorarios = gastos("dueno");
      const egresos = totalComisiones + totalFees + directos.total + operativos.total + honorarios.total;

      return {
        titulo: "Resultado del mes", sub: `${mes.etiqueta} · lo cobrado menos lo que salió`,
        resumen: [
          { etiqueta: "Ingresos", valor: M(ingresos) }, { etiqueta: "Egresos", valor: M(egresos) },
          { etiqueta: "Resultado", valor: M(ingresos - egresos) },
          { etiqueta: "Margen", valor: ingresos > 0 ? pct(((ingresos - egresos) / ingresos) * 100) : "—" },
        ],
        secciones: [
          { titulo: "Ingresos", total: M(ingresos), filas: lista.map((x) => x.fila), vacio: "No entró ningún pago." },
          { titulo: "Comisiones", total: M(totalComisiones), filas: comisiones, vacio: "Sin comisiones este mes." },
          { titulo: "Fees de las pasarelas", total: M(totalFees), filas: fees, vacio: "Sin fees este mes." },
          { titulo: "Costos directos", total: M(directos.total), filas: directos.filas, vacio: "Sin costos directos." },
          { titulo: "Gastos operativos", total: M(operativos.total), filas: operativos.filas, vacio: "Sin gastos operativos." },
          { titulo: "Honorarios", total: M(honorarios.total), filas: honorarios.filas, vacio: "Sin honorarios." },
        ],
      };
    }

    case "leads": {
      const lista = leadsMes(e, mes).sort((a, b) => +new Date(b.creadoEn) - +new Date(a.creadoEn));
      return {
        titulo: "Leads nuevos", sub: `${mes.etiqueta} · la gente que entró`,
        resumen: [{ etiqueta: "Leads", valor: num(lista.length) }, { etiqueta: "Valor potencial", valor: M(lista.reduce((a, l) => a + l.monto, 0)) }],
        secciones: [{ filas: lista.map((l) => filaLead(l)), vacio: "No entró ningún lead este mes." }],
      };
    }

    case "inscriptos": {
      const lista = inscriptosMes(e, mes).sort((a, b) => +new Date(b.actualizadoEn) - +new Date(a.actualizadoEn));
      return {
        titulo: "Inscriptos", sub: `${mes.etiqueta} · leads que cerraron`,
        resumen: [{ etiqueta: "Inscriptos", valor: num(lista.length) }, { etiqueta: "Valor", valor: M(lista.reduce((a, l) => a + l.monto, 0)) }],
        secciones: [{ filas: lista.map((l) => filaLead(l, `${l.fuente || "Sin fuente"} · se inscribió ${relativo(l.actualizadoEn)}`)), vacio: "Nadie se inscribió este mes." }],
      };
    }

    case "mrr": {
      const lista = alumnosActivos(e).sort((a, b) => b.cuotaMensual - a.cuotaMensual);
      return {
        titulo: "MRR", sub: "Lo que entra todos los meses por cuotas de alumnos activos",
        resumen: [{ etiqueta: "MRR", valor: M(lista.reduce((a, x) => a + x.cuotaMensual, 0)) }, { etiqueta: "Alumnos activos", valor: num(lista.length) }],
        secciones: [{
          filas: lista.map((a) => ({ id: a.id, titulo: a.nombre, detalle: `${a.plan} · ${a.cohorte}`, valor: money(a.cuotaMensual, a.moneda), href: `/alumnos?ver=${a.id}` })),
          vacio: "No hay alumnos activos.",
        }],
      };
    }

    case "pipeline": {
      const lista = leadsDelPipeline(e).sort((a, b) => b.ponderado - a.ponderado);
      return {
        titulo: "Pipeline ponderado", sub: "Cada lead abierto por la probabilidad de su etapa",
        resumen: [
          { etiqueta: "Ponderado", valor: M(lista.reduce((a, f) => a + f.ponderado, 0)) },
          { etiqueta: "Bruto", valor: M(lista.reduce((a, f) => a + f.lead.monto, 0)) },
          { etiqueta: "Leads abiertos", valor: num(lista.length) },
        ],
        secciones: [{
          filas: lista.map((f) => ({ ...filaLead(f.lead, `${f.etapa?.nombre ?? "Sin etapa"} · ${f.probabilidad}% de ${money(f.lead.monto, f.lead.moneda)}`), valor: M(f.ponderado) })),
          vacio: "No hay leads abiertos.",
        }],
      };
    }

    case "cierre": {
      const { ganados, perdidos } = leadsCerrados(e);
      const total = ganados.length + perdidos.length;
      return {
        titulo: "Tasa de cierre", sub: "De los leads que ya se definieron",
        resumen: [
          { etiqueta: "Tasa", valor: total ? pct((ganados.length / total) * 100) : "—" },
          { etiqueta: "Ganados", valor: num(ganados.length) }, { etiqueta: "Perdidos", valor: num(perdidos.length) },
        ],
        secciones: [
          { titulo: "Ganados", total: num(ganados.length), filas: ganados.map((l) => filaLead(l)), vacio: "Ninguno todavía." },
          { titulo: "Perdidos", total: num(perdidos.length), filas: perdidos.map((l) => filaLead(l)), vacio: "Ninguno." },
        ],
      };
    }

    case "cobrar": {
      const hoy = Date.now();
      const lista = cuotasPorCobrar(e).sort((a, b) => +new Date(a.cuota.vence ?? 0) - +new Date(b.cuota.vence ?? 0));
      const vencido = lista.filter((x) => x.cuota.vence && +new Date(x.cuota.vence) < hoy).reduce((a, x) => a + x.saldo, 0);
      return {
        titulo: "Por cobrar", sub: "Cuotas registradas que todavía no se cobraron",
        resumen: [
          { etiqueta: "Por cobrar", valor: M(lista.reduce((a, x) => a + x.saldo, 0)) },
          { etiqueta: "Ya vencido", valor: M(vencido) }, { etiqueta: "Cuotas", valor: num(lista.length) },
        ],
        secciones: [{
          filas: lista.map((x) => {
            const v = ventaDe(x.cuota.ventaId);
            const vencida = x.cuota.vence && +new Date(x.cuota.vence) < hoy;
            return {
              id: x.cuota.id, titulo: v?.contactoNombre ?? "Venta sin contacto",
              detalle: `${nombreCuota(x.cuota)}${x.cuota.vence ? ` · vence ${fecha(x.cuota.vence)}` : ""}${x.pagado > 0 ? ` · pagó ${M(x.pagado)}` : ""}`,
              valor: M(x.saldo), href: v ? `/ventas?ver=${v.id}` : undefined,
              marca: vencida ? <Badge variante="danger">Vencida</Badge> : undefined,
            };
          }),
          vacio: "No hay nada pendiente de cobro.",
        }],
      };
    }

    case "etapa": {
      const et = e.etapas.find((x) => x.id === que.etapaId);
      /* Mismo criterio que el embudo: cuenta a los que llegaron a esta etapa
         o más lejos, sin los perdidos. */
      const lista = e.leads.filter((l) => {
        const suya = etapaDe(l);
        return et && suya && !suya.esPerdida && suya.orden >= et.orden;
      }).sort((a, b) => +new Date(b.actualizadoEn) - +new Date(a.actualizadoEn));
      return {
        titulo: et?.nombre ?? "Etapa", sub: `Los que llegaron hasta «${et?.nombre ?? "—"}» o más lejos`,
        resumen: [{ etiqueta: "Leads", valor: num(lista.length) }, { etiqueta: "Valor", valor: M(lista.reduce((a, l) => a + l.monto, 0)) }],
        secciones: [{ filas: lista.map((l) => filaLead(l)), vacio: "Nadie llegó a esta etapa." }],
      };
    }
  }
}

const TOPE = 300;

export function Desglose({ que, mes, onCerrar }: { que: QueDesglosar; mes: RangoMes; onCerrar: () => void }) {
  const e = useEstado();
  const c = contenido(e, que, mes);
  return (
    <Drawer abierto onCerrar={onCerrar} titulo={c.titulo} sub={c.sub}>
      <div className="stack-5">
        <div className="grid-2" style={{ gap: 12 }}>
          {c.resumen.map((r) => (
            <div key={r.etiqueta} style={{ background: "var(--surface-200)", border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "12px 14px" }}>
              <div className="t-label" style={{ marginBottom: 4 }}>{r.etiqueta}</div>
              <div className="t-num" style={{ fontSize: 20, fontWeight: 600, color: "var(--ink)" }}>{r.valor}</div>
            </div>
          ))}
        </div>

        {c.secciones.map((s, i) => (
          <div key={s.titulo ?? i}>
            {(s.titulo || s.total) && (
              <div className="row" style={{ marginBottom: 10 }}>
                <span className="t-label">{s.titulo}</span>
                <span className="spacer t-sm t-num t-muted">{s.total}</span>
              </div>
            )}
            {s.filas.length === 0 ? (
              <p className="t-sm t-subtle">{s.vacio ?? "Nada en este período."}</p>
            ) : (
              <div className="stack-2">
                {s.filas.slice(0, TOPE).map((f) => <FilaDesglose key={f.id} f={f} />)}
                {s.filas.length > TOPE && <p className="t-sm t-subtle">y {num(s.filas.length - TOPE)} más.</p>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function FilaDesglose({ f }: { f: Fila }) {
  const marca = marcaDeDato(f.id);
  const cuerpo = (
    <>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="truncate t-strong" style={{ display: "block", color: "var(--ink)" }}>{f.titulo}</span>
        {f.detalle && <span className="truncate t-sm t-subtle" style={{ display: "block" }}>{f.detalle}</span>}
      </span>
      {f.marca}
      {marca && <Tag>{marca}</Tag>}
      {f.valor && <span className="t-num t-strong" style={{ whiteSpace: "nowrap", color: "var(--ink)" }}>{f.valor}</span>}
    </>
  );
  return f.href
    ? <Link href={f.href} className="agenda-item">{cuerpo}</Link>
    : <div className="agenda-item" style={{ cursor: "default" }}>{cuerpo}</div>;
}
