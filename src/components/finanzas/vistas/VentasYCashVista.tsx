"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, CalendarDays, Wallet } from "lucide-react";
import { CabeceraVista } from "@/components/finanzas/vistas/CabeceraVista";
import { Button, Card, Empty } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { CopiarLink } from "@/components/ui/Filtros";
import { useEstado } from "@/lib/store";
import { useRangoURL } from "@/lib/useRango";
import { fechaLarga, money, num, pct } from "@/lib/format";
import { resumenDeCash, type DiaCash, type FilaCash } from "@/lib/ventas-y-cash";
import "@/components/finanzas/visual/visual.css";
import "./ventas-y-cash.css";

/* ==================================================================
   Ventas y cash: los números de lo vendido y lo cobrado, y nada más (permiso `cash`, lib/permisos.ts).

   Santiago (12/11): «nada más quiere ver los números de ventas y el cash collected». Acá no hay gastos, cuentas, caja, comisiones ni
   honorarios, y no se carga nada: se mira. Las cuentas son las del Dashboard (lib/ventas-y-cash.ts).
   ================================================================== */

export function VentasYCashVista() {
  const e = useEstado();
  const [rango, setRango] = useRangoURL("mes");
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const limites = useMemo(() => {
    const dias = [...e.ventas.map((v) => v.fecha), ...e.pagos.map((p) => p.fecha)].filter(Boolean).map((f) => f.slice(0, 10)).sort();
    return { min: dias[0] ?? null };
  }, [e.ventas, e.pagos]);

  const etiqueta = rangoSub(rango);
  const r = useMemo(() => resumenDeCash(e, rango.desde, rango.hasta, etiqueta), [e, rango.desde, rango.hasta, etiqueta]);

  const columnasDe = (primera: string): Columna<FilaCash>[] => [
    { clave: "nombre", titulo: primera, tipo: "primary", celda: (f) => <span className="truncate" style={{ display: "block" }}>{f.nombre}</span>, orden: (f) => f.nombre, pie: <strong>Total</strong> },
    { clave: "ventas", titulo: "Ventas", tipo: "num", celda: (f) => num(f.ventas), orden: (f) => f.ventas, pie: <strong className="t-num">{num(r.ventas)}</strong> },
    { clave: "facturado", titulo: "Facturado", tipo: "num", celda: (f) => M(f.facturado), orden: (f) => f.facturado, pie: <strong className="t-num">{M(r.facturado)}</strong> },
    { clave: "cobrado", titulo: "Cash Collected", tipo: "num", celda: (f) => M(f.cobrado), orden: (f) => f.cobrado, pie: <strong className="t-num">{M(r.cobrado)}</strong> },
  ];
  const columnasDias: Columna<DiaCash & { id: string }>[] = [
    { clave: "dia", titulo: "Día", tipo: "primary", celda: (f) => fechaLarga(f.dia), orden: (f) => f.dia, pie: <strong>Total</strong> },
    { clave: "cobros", titulo: "Cobros", tipo: "num", celda: (f) => num(f.cobros), orden: (f) => f.cobros, pie: <strong className="t-num">{num(r.cobros)}</strong> },
    { clave: "cobrado", titulo: "Cash Collected", tipo: "num", celda: (f) => M(f.cobrado), orden: (f) => f.cobrado, pie: <strong className="t-num">{M(r.cobrado)}</strong> },
  ];
  const vacio = (titulo: string) => <Empty icono={<Wallet size={22} />} titulo={titulo} texto="No hay ventas ni cobros en estas fechas." />;
  const hayAlgo = r.ventas > 0 || r.cobros > 0 || r.facturado > 0;

  return (
    <div className="stack-5">
      <CabeceraVista embebido={false} titulo="Ventas y cash"
        izquierda={<DateRangePicker value={rango} minDate={limites.min} onApply={setRango} footerNota="Días calendario · zona horaria de Argentina" />}
        acciones={
          <>
            <CopiarLink variante="ghost" />
            <Link href="/ventas"><Button variante="secondary" icono={<ArrowRight size={16} />}>Ver las ventas</Button></Link>
          </>
        }
      />

      <section className="fz-hero" aria-label={`Ventas y cash de ${etiqueta}`}>
        <div>
          <span className="fz-hero__etiqueta">
            Cash Collected (CC) · {etiqueta}
            <InfoMetrica
              titulo="Cash Collected (CC)" periodo={etiqueta}
              ayuda="La plata que entró en el período, de ventas de cualquier fecha, menos lo que se devolvió en el período. Es el mismo número que el Cash Collected del Dashboard."
              formula={"Cash Collected (CC) = lo que entró en el período − lo que se devolvió en el período"}
              componentes={() => [
                { concepto: "Lo que entró", valor: M(r.entrado, 2), signo: "+" as const, nota: `${num(r.cobros)} ${r.cobros === 1 ? "cobro" : "cobros"}` },
                ...(r.devuelto > 0 ? [{ concepto: "Devoluciones", valor: M(r.devuelto, 2), signo: "−" as const }] : []),
                { concepto: "Cash Collected (CC)", valor: M(r.cobrado, 2), signo: "=" as const },
              ]}
            />
          </span>
          <span className="fz-hero__valor">{M(r.cobrado)}</span>
          <p className="fz-hero__sub">
            {r.tasaDeCobro !== null ? <><b>{pct(r.tasaDeCobro, 1)}</b> de lo facturado</> : "Sin ventas en el período"}
          </p>
          {r.devuelto > 0 && <p className="fz-hero__sub">Ya descontadas devoluciones por <b>{M(r.devuelto)}</b></p>}
        </div>

        <dl className="vc-datos" aria-label="Los números del período">
          <Dato etiqueta="Revenue (facturado)" valor={M(r.facturado)} ayuda="El precio acordado de las ventas del período, se haya cobrado o no." />
          <Dato etiqueta="Ventas" valor={num(r.ventas)} ayuda="Ventas cerradas en el período, sin las canceladas ni las que son sólo una reserva." />
          <Dato etiqueta="Ticket promedio" valor={r.ticket !== null ? M(r.ticket) : "—"} ayuda="Revenue sobre la cantidad de ventas." />
          <Dato etiqueta="Por cobrar hoy" valor={M(r.porCobrar)} ayuda="Cuotas pendientes, vencidas o no. Es de hoy, no del período." />
          <Dato etiqueta="Vencido hoy" valor={M(r.vencido)} tono={r.vencido > 0 ? "mal" : undefined} ayuda="Lo que ya se tendría que haber cobrado y no entró. Es de hoy, no del período." />
        </dl>
      </section>

      {!hayAlgo ? (
        <Card><Empty icono={<CalendarDays size={22} />} titulo={`Nada en ${etiqueta}`} texto="No hay ventas ni cobros en estas fechas: probá con otro período." /></Card>
      ) : (
        <>
          <div className="vc-dos">
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <Cab titulo="Por servicio" sub="Qué se vendió y cuánto entró de cada cosa" />
              <DataTable filas={r.porServicio} columnas={columnasDe("Servicio")} ordenInicial={{ clave: "cobrado", desc: true }} vacio={vacio("Sin servicios")} />
            </Card>
            <Card style={{ padding: 0, overflow: "hidden" }}>
              <Cab titulo="Por vendedor" sub="Quién cerró cada venta" />
              <DataTable filas={r.porVendedor} columnas={columnasDe("Vendedor")} ordenInicial={{ clave: "cobrado", desc: true }} vacio={vacio("Sin vendedores")} />
            </Card>
          </div>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <Cab titulo="Día por día" sub="Lo que entró cada día, menos lo devuelto ese día" />
            <DataTable filas={r.porDia.map((d) => ({ ...d, id: d.dia }))} columnas={columnasDias} ordenInicial={{ clave: "dia", desc: true }} porPagina={31} vacio={vacio("Sin cobros")} />
          </Card>
        </>
      )}
    </div>
  );
}

function Cab({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div className="vc-cab">
      <h2 className="card-head__title">{titulo}</h2>
      <p className="card-head__sub">{sub}</p>
    </div>
  );
}

function Dato({ etiqueta, valor, ayuda, tono }: { etiqueta: string; valor: string; ayuda: string; tono?: "mal" }) {
  return (
    <div className="vc-dato">
      <dt className="vc-dato__etiqueta">{etiqueta}<InfoMetrica titulo={etiqueta} ayuda={ayuda} /></dt>
      <dd className="vc-dato__valor" data-tono={tono}>{valor}</dd>
    </div>
  );
}
