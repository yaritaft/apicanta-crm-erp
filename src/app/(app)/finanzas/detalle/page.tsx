"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowDownRight, ArrowLeft, Check, Info, Pencil, Plus, Trash2, Wallet,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Button, Card, CardHead, Chip, Empty, Field, IconButton, Input,
  Select, StatCard, Tabs, Textarea,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { AreaChart, COLORES, Donut } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { delta, fechaLarga, isoDia, money, num, pct } from "@/lib/format";
import { periodoAnterior, rangoDeFechas, ultimosMeses, variacion } from "@/lib/metricas";
import { DateRangePicker, rangoSub } from "@/components/ui/DateRangePicker";
import { useRangoURL } from "@/lib/useRango";
import {
  calcularPyL, cashCollected, comisionesDelMes, cuotasVencidas, gastosPorCategoria,
  porCobrarTotal, revenue, tasaDeMora, totalComisiones,
} from "@/lib/finanzas";
import { CATEGORIAS_GASTO } from "@/lib/seed";
import type { Cuota, Gasto, Moneda } from "@/lib/types";

type Vista = "cobros" | "gastos" | "comisiones" | "adquisicion";

const VACIO = (): Omit<Gasto, "id"> => ({
  categoria: "Software", grupo: "operativo", concepto: "", monto: 0, moneda: "USD" as Moneda,
  fecha: new Date().toISOString(), recurrente: false, creadoEn: new Date().toISOString(), extra: {},
});

export default function FinanzasDetalle() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [vista, setVista] = useState<Vista>("cobros");
  const [form, setForm] = useState<(Omit<Gasto, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<Gasto | null>(null);

  /* `meses` queda solo para el grafico de 6 meses, que es una tendencia y no
     depende del filtro. El filtro ahora es el rango libre. */
  const meses = useMemo(() => ultimosMeses(6), []);

  /* El rango vive en la URL: navegar entre el resumen y el detalle lo
     conserva, y se puede mandar un link a un periodo concreto. Arranca en
     "Este mes", que es lo que pidio Yari: entrar y ver el mes en curso. */
  const [rango, setRango] = useRangoURL("mes");

  /* "Maximo" tiene que decir la verdad por los dos lados: arranca en el primer
     dato que existe, y termina en la ultima cuota PROGRAMADA — si terminara
     hoy, las cuotas que vencen el mes que viene quedarian fuera de pantalla. */
  const limites = useMemo(() => {
    const fechas = [...e.ventas.map((v) => v.fecha), ...e.pagos.map((x) => x.fecha), ...e.gastos.map((g) => g.fecha)]
      .filter(Boolean).map((f) => f.slice(0, 10)).sort();
    const vence = e.cuotas.map((c) => c.vence).filter(Boolean).map((f) => f!.slice(0, 10)).sort();
    return { min: fechas[0] ?? null, max: vence[vence.length - 1] ?? null };
  }, [e.ventas, e.pagos, e.gastos, e.cuotas]);

  const mes = useMemo(() => rangoDeFechas(rango.desde, rango.hasta, rangoSub(rango)), [rango]);

  /* Volver al resumen sin perder el periodo que estabas mirando. */
  const qs = new URLSearchParams({ periodo: rango.preset, desde: rango.desde, hasta: rango.hasta }).toString();
  const previo = useMemo(() => {
    const a = periodoAnterior(rango.desde, rango.hasta);
    return rangoDeFechas(a.desde, a.hasta, "período anterior");
  }, [rango]);

  useEffect(() => { if (url.nuevo) { setVista("gastos"); setForm(VACIO()); url.limpiar(); } }, [url]);

  const p = useMemo(() => calcularPyL(e, mes), [e, mes]);
  const pPrev = useMemo(() => calcularPyL(e, previo), [e, previo]);
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const serie = meses.map((m) => ({
    etiqueta: m.etiqueta, valor: cashCollected(e, m), valor2: revenue(e, m),
  }));

  const vencidas = useMemo(() => cuotasVencidas(e), [e]);
  const comisiones = useMemo(() => comisionesDelMes(e, mes), [e, mes]);
  const totComi = totalComisiones(comisiones);

  return (
    <div className="stack-5">
      <PageHead
        titulo="Detalle de finanzas"
        sub="Fila por fila: qué se debe, en qué se fue la plata y cuánto comisiona cada uno."
        acciones={
          <>
            <Link href={`/finanzas?${qs}`}>
              <Button variante="secondary" icono={<ArrowLeft size={16} />}>Volver al resumen</Button>
            </Link>
            <DateRangePicker
              value={rango} minDate={limites.min} maxDate={limites.max}
              onApply={setRango} footerNota="Días calendario · zona horaria de Argentina"
            />
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => { setVista("gastos"); setForm(VACIO()); }}>Nuevo gasto</Button>
          </>
        }
      />

      <div className="grid-stats">
        <StatCard hero etiqueta={`Cobrado en ${mes.etiqueta}`} valor={M(p.cashCollected)}
          delta={delta(variacion(p.cashCollected, pPrev.cashCollected))}
          direccion={p.cashCollected >= pPrev.cashCollected ? "up" : "down"}
          contexto={`vs. ${previo.etiqueta}`} ayuda="Cash collected: la plata que efectivamente entró este mes." />
        <StatCard etiqueta="Facturado" valor={M(p.revenue)}
          delta={pct(p.tasaCobro, 0)} direccion={p.tasaCobro >= 75 ? "up" : "accent"}
          contexto="se cobró de lo vendido" ayuda="Revenue: el precio acordado de las ventas cerradas este mes." />
        <StatCard etiqueta="Profit neto" valor={M(p.netoCC)}
          delta={p.cashCollected > 0 ? pct((p.netoCC / p.cashCollected) * 100, 0) : "—"}
          direccion={p.netoCC >= 0 ? "up" : "down"} contexto="de margen sobre lo cobrado" />
        <StatCard etiqueta="ROAS" valor={p.roasCC > 0 ? `${num(p.roasCC, 1)}x` : "—"}
          delta={p.roasRev > 0 ? `${num(p.roasRev, 1)}x facturado` : undefined} direccion="accent"
          contexto="sobre lo cobrado" ayuda="Cuántas veces recuperás lo que ponés en publicidad." />
      </div>

      <Tabs valor={vista} onChange={setVista} opciones={[
        { valor: "cobros", texto: `Cobros${vencidas.length ? ` · ${vencidas.length}` : ""}` },
        { valor: "gastos", texto: "Gastos" },
        { valor: "comisiones", texto: "Comisiones" },
        { valor: "adquisicion", texto: "Adquisición" },
      ]} />

      {/* ---------------- P&L ---------------- */}
      {vista === "cobros" && (
        <div className="stack-4">
          <div className="grid-stats">
            <StatCard hero etiqueta="Por cobrar" valor={M(porCobrarTotal(e))} contexto="en cuotas pendientes" />
            <StatCard etiqueta="Vencido" valor={M(vencidas.reduce((a, c) => a + c.saldo, 0))}
              delta={vencidas.length > 0 ? `${vencidas.length} cuotas` : undefined} direccion="down"
              contexto="pasado de fecha" />
            <StatCard etiqueta="Tasa de mora" valor={pct(tasaDeMora(e))} contexto="de las cuotas ya exigibles" />
            <StatCard etiqueta="El más atrasado" valor={vencidas.length ? `${vencidas[0].diasAtraso} días` : "—"}
              contexto={vencidas.length ? vencidas[0].contacto : "Nadie atrasado"} />
          </div>

          {vencidas.length > 0 && (
            <Ayuda titulo={`Hay ${vencidas.length} cuotas vencidas sin cobrar`} icono={<AlertTriangle size={18} />}>
              Suman <strong>{M(vencidas.reduce((a, c) => a + c.saldo, 0))}</strong>. La más vieja lleva{" "}
              <strong>{vencidas[0].diasAtraso} días</strong> y es de {vencidas[0].contacto}. Marcá el pago cuando entre
              y desaparece de esta lista.
            </Ayuda>
          )}

          <Card style={{ padding: 0 }}>
            <DataTable
              alto={460}
              filas={vencidas.map((v) => ({ ...v, id: v.cuotaId }))}
              ordenInicial={{ clave: "dias", desc: true }}
              columnas={[
                { clave: "contacto", titulo: "Cliente", tipo: "primary", orden: (c) => c.contacto, celda: (c) => c.contacto },
                { clave: "cuota", titulo: "Cuota", tipo: "secondary", orden: (c) => c.numero, celda: (c) => c.numero === 0 ? "Reserva" : `Cuota ${c.numero}` },
                { clave: "vence", titulo: "Vencía", tipo: "secondary", orden: (c) => c.vence, celda: (c) => fechaLarga(c.vence) },
                {
                  clave: "dias", titulo: "Atraso", orden: (c) => c.diasAtraso,
                  celda: (c) => (
                    <Badge variante={c.diasAtraso >= 30 ? "danger" : c.diasAtraso >= 14 ? "warning" : "accent"}>
                      {c.diasAtraso} días
                    </Badge>
                  ),
                },
                { clave: "saldo", titulo: "Saldo", tipo: "num", orden: (c) => c.saldo, celda: (c) => M(c.saldo) },
              ]}
              acciones={(c) => (
                <IconButton etiqueta="Marcar como cobrada" onClick={() => {
                  acciones.actualizar<Cuota>("cuotas", c.cuotaId, { estado: "pagada" }, `Cuota de ${c.contacto}`, `Se cobró la cuota ${c.numero} de ${c.contacto}.`);
                  toast("Cuota marcada como cobrada.");
                }}><Check size={15} /></IconButton>
              )}
              vacio={<Empty icono={<Check size={22} />} titulo="Nadie atrasado" texto="Todas las cuotas exigibles están cobradas. Si aparece una vencida, la vas a ver acá con los días de atraso." />}
            />
          </Card>
        </div>
      )}

      {/* ---------------- Gastos ---------------- */}
      {vista === "gastos" && (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ padding: "var(--space-4)" }}>
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <span className="t-strong">{gastosDelMesLista(e, mes).length} gastos en {mes.etiqueta}</span>
              <span className="spacer t-num t-muted">
                {M(gastosDelMesLista(e, mes).reduce((a, g) => a + g.monto, 0))}
              </span>
            </div>
          </div>
          <DataTable
            alto={460}
            filas={gastosDelMesLista(e, mes)}
            ordenInicial={{ clave: "fecha", desc: true }}
            columnas={[
              { clave: "concepto", titulo: "Concepto", tipo: "primary", orden: (g) => g.concepto, celda: (g) => <span className="truncate" style={{ display: "block", maxWidth: 300 }}>{g.concepto}</span> },
              { clave: "categoria", titulo: "Categoría", tipo: "secondary", orden: (g) => g.categoria, celda: (g) => g.categoria },
              { clave: "grupo", titulo: "Bloque", orden: (g) => g.grupo, celda: (g) => <Badge variante={g.grupo === "directo" ? "warning" : g.grupo === "dueno" ? "brand" : "neutral"}>{g.grupo === "dueno" ? "Dueño" : g.grupo === "directo" ? "Directo" : "Operativo"}</Badge> },
              { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (g) => g.fecha, celda: (g) => fechaLarga(g.fecha) },
              { clave: "monto", titulo: "Monto", tipo: "num", orden: (g) => g.monto, celda: (g) => M(g.monto) },
            ]}
            acciones={(g) => (
              <>
                <IconButton etiqueta="Editar" onClick={() => setForm({ ...g })}><Pencil size={15} /></IconButton>
                <IconButton etiqueta="Eliminar" onClick={() => setBorrar(g)}><Trash2 size={15} /></IconButton>
              </>
            )}
            vacio={
              <Empty icono={<Wallet size={22} />} titulo={`Sin gastos en ${mes.etiqueta}`}
                texto="Cargá lo que gastaste y el estado de resultados se rehace solo."
                accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIO())}>Cargar un gasto</Button>} />
            }
          />
        </Card>
      )}

      {/* ---------------- Comisiones ---------------- */}
      {vista === "comisiones" && (
        <div className="stack-4">
          <div className="grid-3">
            <StatCard hero etiqueta="Closers" valor={M(totComi.closers)} contexto={`${comisiones.filter((c) => c.comisionCloser > 0).length} ventas con comisión`} />
            <StatCard etiqueta="Director" valor={M(totComi.director)} contexto="5% del neto de procesador" />
            <StatCard etiqueta="Sin comisión" valor={num(comisiones.filter((c) => c.sinComision).length)} contexto="ventas cerradas por Yari" />
          </div>

          <Ayuda titulo="Cómo se calcula" icono={<Info size={18} />}>
            El closer cobra sobre el <strong>cash collected neto de procesador</strong>, no sobre el profit:
            si entraron US$ 1.000 por Stripe, la base es 1.000 − 2,9% y sobre eso va su porcentaje.
            El director cobra 5% con la misma base. Si la venta figura a nombre de <strong>Yari</strong>,
            no comisiona nadie.
          </Ayuda>

          <Card style={{ padding: 0 }}>
            <DataTable
              alto={460}
              filas={comisiones.map((c) => ({ ...c, id: c.ventaId }))}
              ordenInicial={{ clave: "cobrado", desc: true }}
              columnas={[
                {
                  clave: "closer", titulo: "Venta", tipo: "primary", orden: (c) => c.closerNombre,
                  celda: (c) => {
                    const v = e.ventas.find((x) => x.id === c.ventaId);
                    return <span>{v?.contactoNombre ?? "—"} <span className="t-subtle">· {c.closerNombre}</span></span>;
                  },
                },
                { clave: "cobrado", titulo: "Cobrado", tipo: "num", orden: (c) => c.cobradoEnMes, celda: (c) => M(c.cobradoEnMes) },
                { clave: "neto", titulo: "Neto", tipo: "num", orden: (c) => c.netoProcesador, celda: (c) => M(c.netoProcesador) },
                { clave: "comiCloser", titulo: "Closer", tipo: "num", orden: (c) => c.comisionCloser, celda: (c) => c.sinComision ? <span className="t-subtle">Sin comisión</span> : M(c.comisionCloser, 2) },
                { clave: "comiDir", titulo: "Director", tipo: "num", orden: (c) => c.comisionDirector, celda: (c) => c.sinComision ? "—" : M(c.comisionDirector, 2) },
              ]}
              vacio={<Empty icono={<Wallet size={22} />} titulo={`Sin cobros en ${mes.etiqueta}`} texto="Cuando entre un pago, la comisión de quien cerró esa venta aparece acá calculada." />}
            />
          </Card>

          <div className="grid-2">
            <Card>
              <CardHead titulo="Reparto del profit" sub="Growth partner y socio cobran sobre el resultado operativo." />
              <dl className="dl">
                <dt>Resultado operativo</dt><dd className="t-num">{M(p.operativoCC)}</dd>
                <dt>Growth partner</dt><dd className="t-num">{M(p.growth)}</dd>
                <dt>Socio</dt><dd className="t-num">{M(p.socio)}</dd>
                <dt>Queda</dt><dd className="t-num t-strong">{M(p.operativoCC - p.growth - p.socio)}</dd>
              </dl>
              <Ayuda titulo="Ojo con esto" icono={<Info size={18} />}>
                El growth partner no comisiona las ventas marcadas como <strong>excluidas de marketing</strong>
                (eventos y conocidos), así que su número ya sale prorrateado. Lo del socio, que cobra distinto
                según el producto, todavía está como un 10% parejo — falta definirlo.
              </Ayuda>
            </Card>
          </div>
        </div>
      )}

      {/* ---------------- Adquisición ---------------- */}
      {vista === "adquisicion" && (
        <div className="grid-2">
            <Card>
              <CardHead titulo="Métricas de adquisición" sub={`${mes.etiqueta}.`} />
              <dl className="dl">
                <dt>Ventas</dt><dd className="t-num">{num(p.ventas)}</dd>
                <dt>Inversión en ads</dt><dd className="t-num">{M(p.inversionAds)}</dd>
                <dt>CAC</dt><dd className="t-num">{M(p.cac)}</dd>
                <dt>ROAS cobrado</dt><dd className="t-num">{p.roasCC > 0 ? `${num(p.roasCC, 2)}x` : "—"}</dd>
                <dt>ROAS facturado</dt><dd className="t-num">{p.roasRev > 0 ? `${num(p.roasRev, 2)}x` : "—"}</dd>
                <dt>Tasa de cobro</dt><dd className="t-num">{pct(p.tasaCobro)}</dd>
                <dt>Tasa de mora</dt><dd className="t-num" style={{ color: tasaDeMora(e) > 15 ? "var(--danger)" : undefined }}>{pct(tasaDeMora(e))}</dd>
              </dl>
            </Card>
        </div>
      )}

      {/* ---------------- Alta / edición de gasto ---------------- */}
      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} ancho
          titulo={form.id ? "Editar gasto" : "Nuevo gasto"}
          sub="El bloque define en qué parte del estado de resultados cae."
          guardarTexto={form.id ? "Guardar cambios" : "Registrar gasto"}
          puedeGuardar={form.concepto.trim().length > 0}
          onGuardar={() => {
            if (!form.concepto.trim()) { toast("Escribí de qué se trata.", "err"); return; }
            if (form.id) { acciones.actualizar<Gasto>("gastos", form.id, form, form.concepto); toast("Gasto actualizado."); }
            else { acciones.crear<Gasto>("gastos", form, form.concepto); toast("Gasto registrado."); }
            setForm(null);
          }}
        >
          <div className="form-grid">
            <Field label="Categoría">
              <Select value={form.categoria}
                onChange={(ev) => {
                  const cat = ev.target.value;
                  const def = CATEGORIAS_GASTO.find((c) => c.categoria === cat);
                  setForm({ ...form, categoria: cat, grupo: def?.grupo ?? form.grupo });
                }}
                opciones={CATEGORIAS_GASTO.map((c) => c.categoria)} />
            </Field>
            <Field label="Bloque" ayuda="Directo resta antes de la utilidad bruta.">
              <Select value={form.grupo} onChange={(ev) => setForm({ ...form, grupo: ev.target.value as Gasto["grupo"] })}
                opciones={[
                  { valor: "directo", texto: "Costo directo" },
                  { valor: "operativo", texto: "Gasto operativo" },
                  { valor: "dueno", texto: "Honorarios del dueño" },
                ]} />
            </Field>
            <Field label="Concepto" span2>
              <Input value={form.concepto} onChange={(ev) => setForm({ ...form, concepto: ev.target.value })}
                placeholder="Meta Ads — pauta de septiembre" autoFocus />
            </Field>
            <Field label="Monto"><Input type="number" min={0} step="0.01" value={form.monto} onChange={(ev) => setForm({ ...form, monto: Number(ev.target.value) })} /></Field>
            <Field label="Fecha"><Input type="date" value={isoDia(form.fecha)} onChange={(ev) => setForm({ ...form, fecha: new Date(ev.target.value + "T12:00:00").toISOString() })} /></Field>
            <Field label="Webinar" span2 ayuda="Opcional. Si es un gasto de un webinar puntual, atribuilo y entra en su profit.">
              <Select value={form.webinarId ?? ""} onChange={(ev) => setForm({ ...form, webinarId: ev.target.value || undefined })}
                placeholder="Sin atribuir" opciones={e.webinars.map((w) => ({ valor: w.id, texto: w.titulo }))} />
            </Field>
            <Field label="Proveedor"><Input value={form.proveedor ?? ""} onChange={(ev) => setForm({ ...form, proveedor: ev.target.value })} placeholder="Meta" /></Field>
            <Field label="Notas" span2><Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={2} /></Field>
          </div>
        </ModalForm>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar este gasto?"
        texto={`Se borra «${borrar?.concepto}» y el estado de resultados se recalcula.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("gastos", borrar.id, borrar.concepto); toast("Gasto eliminado."); } }}
      />
    </div>
  );
}

/* ---------- Piezas de la tabla del P&L ---------- */

function Linea({ t, cc, rev, fuerte, destacado, M }: {
  t: string; cc: number; rev: number; fuerte?: boolean; destacado?: boolean; M: (n: number, d?: number) => string;
}) {
  const color = destacado ? (cc >= 0 ? "var(--success)" : "var(--danger)") : fuerte ? "var(--ink)" : undefined;
  return (
    <tr style={{ cursor: "default", background: fuerte ? "var(--surface-200)" : undefined }}>
      <td className={fuerte ? "hk-td--primary" : undefined}>{t}</td>
      <td className="hk-td--num" style={{ color, fontWeight: fuerte ? 700 : undefined }}>{M(cc)}</td>
      <td className="hk-td--num" style={{ color, fontWeight: fuerte ? 700 : undefined }}>{M(rev)}</td>
    </tr>
  );
}

function Bloque({ t }: { t: string }) {
  return (
    <tr style={{ cursor: "default" }}>
      <td colSpan={3} className="t-label" style={{ paddingTop: 18, paddingBottom: 6, border: 0 }}>{t}</td>
    </tr>
  );
}

function gastosDelMesLista(e: ReturnType<typeof useEstado>, m: { desde: Date; hasta: Date }) {
  return e.gastos.filter((g) => {
    const d = new Date(g.fecha).getTime();
    return d >= m.desde.getTime() && d <= m.hasta.getTime();
  });
}

function exportarPyL(e: ReturnType<typeof useEstado>, m: { etiqueta: string }, p: ReturnType<typeof calcularPyL>) {
  const filas: [string, number, number][] = [
    ["Ingresos", p.cashCollected, p.revenue],
    ["Comisiones closers", -p.comisionCloser, -p.comisionCloser],
    ["Comision director", -p.comisionDirector, -p.comisionDirector],
    ["Procesadores", -p.feesProcesador, -p.feesProcesador],
    ["Utilidad bruta", p.brutoCC, p.brutoRev],
    ["Gastos operativos", -p.gastosOperativos, -p.gastosOperativos],
    ["Resultado operativo", p.operativoCC, p.operativoRev],
    ["Honorarios del CEO", -p.honorariosCeo, -p.honorariosCeo],
    ["Rentabilidad neta", p.netoCC, p.netoRev],
  ];
  const csv = [
    `Estado de resultados,${m.etiqueta}`,
    "Concepto,Sobre lo cobrado,Sobre lo facturado",
    ...filas.map(([c, a, b]) => `"${c}",${a.toFixed(2)},${b.toFixed(2)}`),
  ].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `apicanta-pyl-${m.etiqueta.replace(" ", "-")}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
  void e;
}
