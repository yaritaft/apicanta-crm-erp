"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Check, Download, Pencil, Plus, Trash2, Wallet } from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import { Badge, Button, Card, CardHead, Chip, Empty, Field, IconButton, Input, Select, StatCard, Tabs, Textarea } from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { AreaChart, COLORES, Donut } from "@/components/charts/charts";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { delta, fechaLarga, isoDia, money, pct } from "@/lib/format";
import { egresosMes, ingresosMes, mrr, porCobrar, ultimosMeses, variacion } from "@/lib/metricas";
import type { EstadoMovimiento, Moneda, TipoMovimiento, Transaccion } from "@/lib/types";

const ESTADO: Record<EstadoMovimiento, { texto: string; variante: "success" | "warning" | "danger" }> = {
  "pagado": { texto: "Pagado", variante: "success" },
  "pendiente": { texto: "Pendiente", variante: "warning" },
  "vencido": { texto: "Vencido", variante: "danger" },
};

const VACIA = (tipo: TipoMovimiento, categoria: string, metodo: string): Omit<Transaccion, "id"> => ({
  tipo, categoria, concepto: "", monto: 0, moneda: "USD" as Moneda,
  fecha: new Date().toISOString(), estado: "pagado", metodo, recurrente: false,
  creadoEn: new Date().toISOString(), extra: {},
});

export default function Finanzas() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [tipo, setTipo] = useState<"todos" | TipoMovimiento>("todos");
  const [estado, setEstado] = useState<"todos" | EstadoMovimiento>("todos");
  const [mes, setMes] = useState("todos");
  const [form, setForm] = useState<(Omit<Transaccion, "id"> & { id?: string }) | null>(null);
  const [borrar, setBorrar] = useState<Transaccion | null>(null);

  const meses = useMemo(() => ultimosMeses(6), []);
  const actual = meses[meses.length - 1];
  const previo = meses[meses.length - 2];

  useEffect(() => {
    if (url.nuevo) { setForm(VACIA("ingreso", e.ajustes.categoriasIngreso[0] ?? "", e.ajustes.metodosPago[0] ?? "")); url.limpiar(); }
  }, [url, e.ajustes]);

  const ingresos = ingresosMes(e, actual);
  const egresos = egresosMes(e, actual);
  const neto = ingresos - egresos;

  const serie = meses.map((m) => ({ etiqueta: m.etiqueta, valor: ingresosMes(e, m), valor2: egresosMes(e, m) }));

  const porCategoria = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of e.transacciones) {
      if (t.tipo !== "egreso") continue;
      const d = new Date(t.fecha);
      if (d < meses[0].desde) continue;
      m.set(t.categoria, (m.get(t.categoria) ?? 0) + t.monto);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
      .map(([etiqueta, valor], i) => ({ etiqueta, valor, color: COLORES[i % COLORES.length] }));
  }, [e.transacciones, meses]);

  const filtradas = useMemo(() => {
    return e.transacciones.filter((t) => {
      if (tipo !== "todos" && t.tipo !== tipo) return false;
      if (estado !== "todos" && t.estado !== estado) return false;
      if (mes !== "todos") {
        const m = meses.find((x) => x.clave === mes);
        if (m) { const d = new Date(t.fecha); if (d < m.desde || d > m.hasta) return false; }
      }
      return true;
    });
  }, [e.transacciones, tipo, estado, mes, meses]);

  function guardar() {
    if (!form) return;
    if (!form.concepto.trim()) { toast("Escribí de qué se trata el movimiento.", "err"); return; }
    if (form.id) { acciones.actualizar<Transaccion>("transacciones", form.id, form, form.concepto); toast("Movimiento actualizado."); }
    else { acciones.crear<Transaccion>("transacciones", form, form.concepto); toast(`${form.tipo === "ingreso" ? "Ingreso" : "Egreso"} registrado.`); }
    setForm(null);
  }

  const columnas: Columna<Transaccion>[] = [
    {
      clave: "concepto", titulo: "Concepto", tipo: "primary", orden: (t) => t.concepto,
      celda: (t) => (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
          <span style={{
            display: "grid", placeItems: "center", width: 28, height: 28, borderRadius: 8, flex: "none",
            background: t.tipo === "ingreso" ? "var(--success-soft)" : "var(--danger-soft)",
            color: t.tipo === "ingreso" ? "var(--success)" : "var(--danger)",
          }}>
            {t.tipo === "ingreso" ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
          </span>
          <span className="truncate" style={{ maxWidth: 280, display: "block" }}>{t.concepto}</span>
        </span>
      ),
    },
    { clave: "categoria", titulo: "Categoría", tipo: "secondary", orden: (t) => t.categoria, celda: (t) => t.categoria },
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (t) => t.fecha, celda: (t) => fechaLarga(t.fecha) },
    { clave: "metodo", titulo: "Método", tipo: "secondary", orden: (t) => t.metodo, celda: (t) => t.metodo || "—" },
    { clave: "estado", titulo: "Estado", orden: (t) => t.estado, celda: (t) => <Badge variante={ESTADO[t.estado].variante}>{ESTADO[t.estado].texto}</Badge> },
    {
      clave: "monto", titulo: "Monto", tipo: "num", orden: (t) => (t.tipo === "ingreso" ? t.monto : -t.monto),
      celda: (t) => (
        <span style={{ color: t.tipo === "ingreso" ? "var(--success)" : "var(--ink)", fontWeight: 600 }}>
          {t.tipo === "ingreso" ? "+" : "−"}{money(t.monto, t.moneda).replace("−", "")}
        </span>
      ),
    },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Finanzas"
        sub="Todo lo que entra y todo lo que sale. Cargá un movimiento y los totales se rehacen solos."
        acciones={
          <>
            <Button variante="secondary" icono={<Download size={16} />} onClick={() => exportar(e.transacciones)}>Exportar</Button>
            <Button variante="secondary" icono={<ArrowDownRight size={16} />} onClick={() => setForm(VACIA("egreso", e.ajustes.categoriasEgreso[0] ?? "", e.ajustes.metodosPago[0] ?? ""))}>Nuevo egreso</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(VACIA("ingreso", e.ajustes.categoriasIngreso[0] ?? "", e.ajustes.metodosPago[0] ?? ""))}>Nuevo ingreso</Button>
          </>
        }
      />

      <div className="grid-stats">
        <StatCard
          hero etiqueta={`Ingresos de ${actual.etiqueta}`} valor={money(ingresos, e.ajustes.monedaBase)}
          delta={delta(variacion(ingresos, ingresosMes(e, previo)))} direccion={ingresos >= ingresosMes(e, previo) ? "up" : "down"}
          contexto={`vs. ${previo.etiqueta}`}
        />
        <StatCard
          etiqueta="Egresos" valor={money(egresos, e.ajustes.monedaBase)}
          delta={delta(variacion(egresos, egresosMes(e, previo)))} direccion={egresos <= egresosMes(e, previo) ? "up" : "down"}
          contexto={`vs. ${previo.etiqueta}`}
        />
        <StatCard
          etiqueta="Resultado" valor={money(neto, e.ajustes.monedaBase)}
          delta={ingresos > 0 ? pct((neto / ingresos) * 100) : "—"} direccion={neto >= 0 ? "up" : "down"}
          contexto="de margen este mes"
        />
        <StatCard
          etiqueta="Por cobrar" valor={money(porCobrar(e), e.ajustes.monedaBase)}
          delta={porCobrar(e) > 0 ? "Revisar" : undefined} direccion="accent"
          contexto={`${e.transacciones.filter((t) => t.tipo === "ingreso" && t.estado !== "pagado").length} facturas abiertas`}
        />
      </div>

      <div className="grid-2">
        <Card>
          <CardHead titulo="Ingresos y egresos" sub="Últimos 6 meses." />
          <AreaChart datos={serie} serie2="Egresos" formato={(n) => money(n, e.ajustes.monedaBase)} alto={220} />
        </Card>
        <Card>
          <CardHead titulo="En qué se va la plata" sub="Egresos por categoría, últimos 6 meses." />
          <Donut datos={porCategoria} formato={(n) => money(n, e.ajustes.monedaBase)} total={money(porCategoria.reduce((a, x) => a + x.valor, 0), e.ajustes.monedaBase)} totalEtiqueta="en egresos" />
        </Card>
      </div>

      <div className="grid-3">
        <Card><div className="t-label" style={{ marginBottom: 6 }}>MRR</div><div className="t-num" style={{ fontSize: 26, fontWeight: 600 }}>{money(mrr(e), e.ajustes.monedaBase)}</div><div className="t-sm t-subtle" style={{ marginTop: 4 }}>Ingreso recurrente por cuotas de alumnos activos</div></Card>
        <Card><div className="t-label" style={{ marginBottom: 6 }}>Promedio mensual</div><div className="t-num" style={{ fontSize: 26, fontWeight: 600 }}>{money(meses.reduce((a, m) => a + ingresosMes(e, m), 0) / meses.length, e.ajustes.monedaBase)}</div><div className="t-sm t-subtle" style={{ marginTop: 4 }}>Ingresos promedio de los últimos 6 meses</div></Card>
        <Card><div className="t-label" style={{ marginBottom: 6 }}>Acumulado del período</div><div className="t-num" style={{ fontSize: 26, fontWeight: 600 }}>{money(meses.reduce((a, m) => a + ingresosMes(e, m) - egresosMes(e, m), 0), e.ajustes.monedaBase)}</div><div className="t-sm t-subtle" style={{ marginTop: 4 }}>Resultado sumado de los 6 meses</div></Card>
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <div className="toolbar" style={{ marginBottom: "var(--space-3)" }}>
            <Tabs valor={tipo} onChange={setTipo} opciones={[{ valor: "todos", texto: "Todo" }, { valor: "ingreso", texto: "Ingresos" }, { valor: "egreso", texto: "Egresos" }]} />
            <span className="spacer" />
            <div style={{ width: 180 }}>
              <Select value={mes} onChange={(ev) => setMes(ev.target.value)} aria-label="Filtrar por mes"
                opciones={[{ valor: "todos", texto: "Todos los meses" }, ...[...meses].reverse().map((m) => ({ valor: m.clave, texto: m.etiqueta }))]} />
            </div>
          </div>
          <div className="toolbar">
            <Chip activo={estado === "todos"} onClick={() => setEstado("todos")}>Cualquier estado</Chip>
            {(Object.keys(ESTADO) as EstadoMovimiento[]).map((k) => (
              <Chip key={k} activo={estado === k} onClick={() => setEstado(k)} count={e.transacciones.filter((t) => t.estado === k).length}>{ESTADO[k].texto}</Chip>
            ))}
          </div>
        </div>

        <DataTable
          filas={filtradas} columnas={columnas} ordenInicial={{ clave: "fecha", desc: true }}
          acciones={(t) => (
            <>
              {t.estado !== "pagado" && (
                <IconButton etiqueta="Marcar como pagado" onClick={() => { acciones.actualizar<Transaccion>("transacciones", t.id, { estado: "pagado" }, t.concepto, `Se cobró «${t.concepto}».`); toast("Marcado como pagado."); }}>
                  <Check size={15} />
                </IconButton>
              )}
              <IconButton etiqueta="Editar" onClick={() => setForm({ ...t })}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(t)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty
              icono={<Wallet size={22} />}
              titulo={e.transacciones.length === 0 ? "Todavía no cargaste movimientos" : "Nada con esos filtros"}
              texto={e.transacciones.length === 0 ? "Cargá tu primer ingreso o gasto y empiezo a armarte los gráficos y el resultado del mes." : "Probá sacando algún filtro."}
              accion={
                e.transacciones.length === 0
                  ? <Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(VACIA("ingreso", e.ajustes.categoriasIngreso[0] ?? "", e.ajustes.metodosPago[0] ?? ""))}>Cargar un ingreso</Button>
                  : <Button variante="secondary" onClick={() => { setTipo("todos"); setEstado("todos"); setMes("todos"); }}>Limpiar filtros</Button>
              }
            />
          }
        />
      </Card>

      {form && (
        <ModalForm
          abierto onCerrar={() => setForm(null)} onGuardar={guardar} ancho
          titulo={form.id ? "Editar movimiento" : form.tipo === "ingreso" ? "Nuevo ingreso" : "Nuevo egreso"}
          sub="Con el concepto, el monto y la fecha alcanza."
          guardarTexto={form.id ? "Guardar cambios" : "Registrar"}
          puedeGuardar={form.concepto.trim().length > 0}
        >
          <div className="form-grid">
            <Field label="Tipo">
              <Select
                value={form.tipo}
                onChange={(ev) => {
                  const t = ev.target.value as TipoMovimiento;
                  const cats = t === "ingreso" ? e.ajustes.categoriasIngreso : e.ajustes.categoriasEgreso;
                  setForm({ ...form, tipo: t, categoria: cats[0] ?? "" });
                }}
                opciones={[{ valor: "ingreso", texto: "Ingreso (entra plata)" }, { valor: "egreso", texto: "Egreso (sale plata)" }]}
              />
            </Field>
            <Field label="Categoría">
              <Select value={form.categoria} onChange={(ev) => setForm({ ...form, categoria: ev.target.value })}
                opciones={form.tipo === "ingreso" ? e.ajustes.categoriasIngreso : e.ajustes.categoriasEgreso} />
            </Field>
            <Field label="Concepto" span2 ayuda="Qué es, en pocas palabras.">
              <Input value={form.concepto} onChange={(ev) => setForm({ ...form, concepto: ev.target.value })} placeholder={form.tipo === "ingreso" ? "Cuota Hackear IT Full — Martín Quiroga" : "Meta Ads — inversión de septiembre"} autoFocus />
            </Field>
            <Field label="Monto"><Input type="number" min={0} step="0.01" value={form.monto} onChange={(ev) => setForm({ ...form, monto: Number(ev.target.value) })} /></Field>
            <Field label="Moneda"><Select value={form.moneda} onChange={(ev) => setForm({ ...form, moneda: ev.target.value as Moneda })} opciones={["USD", "ARS"]} /></Field>
            <Field label="Fecha"><Input type="date" value={isoDia(form.fecha)} onChange={(ev) => setForm({ ...form, fecha: new Date(ev.target.value + "T12:00:00").toISOString() })} /></Field>
            <Field label="Estado">
              <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoMovimiento })}
                opciones={(Object.keys(ESTADO) as EstadoMovimiento[]).map((k) => ({ valor: k, texto: ESTADO[k].texto }))} />
            </Field>
            <Field label="Método de pago"><Select value={form.metodo} onChange={(ev) => setForm({ ...form, metodo: ev.target.value })} opciones={e.ajustes.metodosPago} /></Field>
            <Field label="Alumno" ayuda="Opcional. Vincula el pago a su ficha.">
              <Select value={form.alumnoId ?? ""} onChange={(ev) => setForm({ ...form, alumnoId: ev.target.value || undefined })}
                placeholder="Sin vincular" opciones={e.alumnos.map((a) => ({ valor: a.id, texto: a.nombre }))} />
            </Field>
            <CamposExtra campos={e.campos} entidad="transaccion" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
          </div>
        </ModalForm>
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo="¿Eliminar este movimiento?"
        texto={`Se borra «${borrar?.concepto}» y deja de contar en los totales.`}
        onConfirmar={() => { if (borrar) { acciones.eliminar("transacciones", borrar.id, borrar.concepto); toast("Movimiento eliminado."); } }}
      />
    </div>
  );
}

function exportar(txs: Transaccion[]) {
  const cab = ["fecha", "tipo", "categoria", "concepto", "monto", "moneda", "estado", "metodo"];
  const filas = txs.map((t) => [t.fecha.slice(0, 10), t.tipo, t.categoria, t.concepto, String(t.monto), t.moneda, t.estado, t.metodo]
    .map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  const blob = new Blob([[cab.join(","), ...filas].join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `apicanta-finanzas-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}
