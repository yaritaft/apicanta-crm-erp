"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, HandCoins, Info, Pencil, Plus, Receipt, Trash2,
} from "lucide-react";
import { PageHead } from "@/components/shell/PageHead";
import {
  Ayuda, Badge, Bar, Button, Card, Chip, Empty, Field, IconButton, Input,
  Select, StatCard, Switch, Textarea,
} from "@/components/ui/ui";
import { Columna, DataTable } from "@/components/ui/DataTable";
import { ModalForm, Confirmar } from "@/components/ui/Modal";
import { Drawer, Dato } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useAbrirDesdeURL } from "@/lib/useQuery";
import { fechaLarga, isoDia, money, num, pct } from "@/lib/format";
import { porCobrarTotal, saldoVenta } from "@/lib/finanzas";
import type { Cuota, EstadoVenta, Moneda, Pago, Venta } from "@/lib/types";

const ESTADO: Record<EstadoVenta, { texto: string; variante: "success" | "neutral" | "danger" }> = {
  "activa":      { texto: "Activa",      variante: "success" },
  "cancelada":   { texto: "Cancelada",   variante: "neutral" },
  "reembolsada": { texto: "Reembolsada", variante: "danger" },
};

export default function Ventas() {
  const e = useEstado();
  const toast = useToast();
  const url = useAbrirDesdeURL();
  const [filtro, setFiltro] = useState<"todas" | EstadoVenta | "conSaldo">("todas");
  const [form, setForm] = useState<BorradorVenta | null>(null);
  const [ver, setVer] = useState<string | null>(null);
  const [borrar, setBorrar] = useState<Venta | null>(null);
  const [cobrar, setCobrar] = useState<Cuota | null>(null);

  const estadoRef = useRef(e);
  estadoRef.current = e;

  /* `e` a propósito fuera de las dependencias: sólo hace falta su valor
     en el momento en que la URL pide abrir el formulario. */
  useEffect(() => {
    if (url.nuevo) { setForm(nuevoBorrador(estadoRef.current)); url.limpiar(); }
    else if (url.ver) { setVer(url.ver); url.limpiar(); }
  }, [url]);

  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);

  const filas = useMemo(() => {
    let xs = e.ventas;
    if (filtro === "conSaldo") xs = xs.filter((v) => saldoVenta(e, v.id).saldo > 0.01 && v.estado === "activa");
    else if (filtro !== "todas") xs = xs.filter((v) => v.estado === filtro);
    return xs;
  }, [e, filtro]);

  const activas = e.ventas.filter((v) => v.estado === "activa");
  const facturado = activas.reduce((a, v) => a + v.precioAcordado, 0);
  const cobradoTotal = e.pagos.reduce((a, p) => a + p.monto, 0);

  const vVista = e.ventas.find((v) => v.id === ver) ?? null;
  const saldo = vVista ? saldoVenta(e, vVista.id) : null;

  const columnas: Columna<Venta>[] = [
    { clave: "contacto", titulo: "Cliente", tipo: "primary", orden: (v) => v.contactoNombre, celda: (v) => v.contactoNombre },
    { clave: "producto", titulo: "Producto", tipo: "secondary", orden: (v) => v.productoId ?? "", celda: (v) => e.productos.find((p) => p.id === v.productoId)?.nombre ?? "—" },
    { clave: "closer", titulo: "Closer", tipo: "secondary", orden: (v) => v.closerId ?? "", celda: (v) => e.equipo.find((x) => x.id === v.closerId)?.nombre ?? "—" },
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (v) => v.fecha, celda: (v) => fechaLarga(v.fecha) },
    { clave: "precio", titulo: "Precio", tipo: "num", orden: (v) => v.precioAcordado, celda: (v) => M(v.precioAcordado) },
    {
      clave: "saldo", titulo: "Cobrado", orden: (v) => { const s = saldoVenta(e, v.id); return s.total > 0 ? s.cobrado / s.total : 0; },
      celda: (v) => {
        const s = saldoVenta(e, v.id);
        const p = s.total > 0 ? (s.cobrado / s.total) * 100 : 0;
        return (
          <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
            <span style={{ flex: 1 }}><Bar valor={p} tono={p >= 99 ? "success" : "accent"} /></span>
            <span className="t-sm t-num t-subtle">{Math.round(p)}%</span>
          </span>
        );
      },
    },
  ];

  return (
    <div className="stack-5">
      <PageHead
        titulo="Ventas"
        sub="Cada venta con su plan de cuotas. Una cuota puede cobrarse con varios métodos y cada pago queda atado a su procesador."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setForm(nuevoBorrador(e))}>Nueva venta</Button>}
      />

      <div className="grid-stats">
        <StatCard hero etiqueta="Facturado" valor={M(facturado)} contexto={`${activas.length} ventas activas`} />
        <StatCard etiqueta="Cobrado" valor={M(cobradoTotal)} delta={facturado > 0 ? pct((cobradoTotal / facturado) * 100, 0) : undefined} direccion="up" contexto="de lo vendido" />
        <StatCard etiqueta="Por cobrar" valor={M(porCobrarTotal(e))} contexto="en cuotas pendientes" />
        <StatCard etiqueta="Ticket promedio" valor={M(activas.length ? facturado / activas.length : 0)} contexto="por venta" />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4)" }}>
          <div className="toolbar" style={{ marginBottom: 0 }}>
            <Chip activo={filtro === "todas"} onClick={() => setFiltro("todas")} count={e.ventas.length}>Todas</Chip>
            <Chip activo={filtro === "conSaldo"} onClick={() => setFiltro("conSaldo")} count={e.ventas.filter((v) => v.estado === "activa" && saldoVenta(e, v.id).saldo > 0.01).length}>Con saldo</Chip>
            {(Object.keys(ESTADO) as EstadoVenta[]).map((k) => (
              <Chip key={k} activo={filtro === k} onClick={() => setFiltro(k)} count={e.ventas.filter((v) => v.estado === k).length}>{ESTADO[k].texto}</Chip>
            ))}
          </div>
        </div>
        <DataTable
          filas={filas} columnas={columnas} ordenInicial={{ clave: "fecha", desc: true }}
          onFila={(v) => setVer(v.id)} etiquetaFila={(v) => `Ver la venta de ${v.contactoNombre}`}
          acciones={(v) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => setForm(desdeVenta(e, v))}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => setBorrar(v)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={
            <Empty icono={<HandCoins size={22} />} titulo="Todavía no cargaste ventas"
              texto="Cargá una venta con su plan de cuotas y los cobros empiezan a aparecer solos en Finanzas."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={() => setForm(nuevoBorrador(e))}>Cargar una venta</Button>} />
          }
        />
      </Card>

      <Ayuda titulo="Cómo se arma una venta" icono={<Info size={18} />}>
        Elegís el producto y el precio que cerró el closer, y decís en cuántas cuotas.
        Apicanta arma el plan solo. Después, a medida que entra la plata, registrás cada pago
        con su método — y si una cuota se pagó mitad por Stripe y mitad por transferencia,
        cargás dos pagos sobre la misma cuota.
      </Ayuda>

      {/* ---------- Alta / edición ---------- */}
      {form && (
        <FormularioVenta
          borrador={form} onCerrar={() => setForm(null)}
          onGuardado={(nombre) => { toast(`Venta de ${nombre} guardada.`); setForm(null); }}
        />
      )}

      {/* ---------- Detalle ---------- */}
      {vVista && saldo && (
        <Drawer
          abierto onCerrar={() => setVer(null)} titulo={vVista.contactoNombre}
          sub={`${e.productos.find((p) => p.id === vVista.productoId)?.nombre ?? "—"} · ${fechaLarga(vVista.fecha)}`}
          pie={
            <>
              <Button variante="secondary" icono={<Pencil size={16} />} onClick={() => { setForm(desdeVenta(e, vVista)); setVer(null); }}>Editar</Button>
              {vVista.estado === "activa" && (
                <Button variante="danger" onClick={() => {
                  acciones.actualizar<Venta>("ventas", vVista.id, { estado: "cancelada" }, vVista.contactoNombre,
                    `Se canceló la venta de ${vVista.contactoNombre}. Las cuotas quedan registradas.`);
                  toast("Venta cancelada. Las cuotas quedan como historial.");
                }}>Cancelar venta</Button>
              )}
            </>
          }
        >
          <div className="stack-5">
            <div className="row-wrap">
              <Badge variante={ESTADO[vVista.estado].variante}>{ESTADO[vVista.estado].texto}</Badge>
              {vVista.excluidoMarketing && <Badge variante="warning">Excluida de marketing</Badge>}
              {e.equipo.find((x) => x.id === vVista.closerId)?.sinComision && <Badge variante="neutral">Sin comisión</Badge>}
            </div>

            <div>
              <div className="row" style={{ marginBottom: 8 }}>
                <span className="t-label">Cobrado</span>
                <span className="spacer t-num t-strong">{M(saldo.cobrado)} de {M(saldo.total)}</span>
              </div>
              <Bar valor={saldo.total > 0 ? (saldo.cobrado / saldo.total) * 100 : 0} tono={saldo.saldo <= 0.01 ? "success" : "accent"} />
              {saldo.saldo > 0.01 && <p className="t-sm t-subtle" style={{ marginTop: 6 }}>Faltan {M(saldo.saldo)}.</p>}
            </div>

            <dl className="dl">
              <Dato label="Precio">{M(vVista.precioAcordado)}</Dato>
              <Dato label="Closer">{e.equipo.find((x) => x.id === vVista.closerId)?.nombre ?? "—"}</Dato>
              <Dato label="Director">{e.equipo.find((x) => x.id === vVista.directorId)?.nombre ?? "—"}</Dato>
              <Dato label="Embudo">{e.embudos.find((x) => x.id === vVista.embudoId)?.nombre ?? "—"}</Dato>
              <Dato label="Webinar">{e.webinars.find((w) => w.id === vVista.webinarId)?.titulo ?? "—"}</Dato>
            </dl>

            <div>
              <div className="t-label" style={{ marginBottom: 12 }}>Cuotas</div>
              <div className="stack-2">
                {saldo.cuotas.map((c) => {
                  const pagos = e.pagos.filter((p) => p.cuotaId === c.id);
                  const pagado = pagos.reduce((a, p) => a + p.monto, 0);
                  const resta = c.monto - pagado;
                  const vencida = c.estado === "pendiente" && c.vence && new Date(c.vence) < new Date() && resta > 0.01;
                  return (
                    <div key={c.id} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-md)", padding: "10px 12px", background: "var(--surface-200)" }}>
                      <div className="row" style={{ gap: 8 }}>
                        <span className="t-strong" style={{ color: "var(--ink)" }}>
                          {c.esReserva ? "Reserva" : `Cuota ${c.numero}`}
                        </span>
                        {c.vence && <span className="t-sm t-subtle">vence {fechaLarga(c.vence)}</span>}
                        <span className="spacer t-num t-strong">{M(c.monto)}</span>
                        {vencida
                          ? <Badge variante="danger"><AlertTriangle size={13} />Vencida</Badge>
                          : resta <= 0.01
                            ? <Badge variante="success"><Check size={13} />Cobrada</Badge>
                            : <Badge variante="accent">Pendiente</Badge>}
                      </div>
                      {pagos.length > 0 && (
                        <div className="stack-2" style={{ marginTop: 8 }}>
                          {pagos.map((p) => (
                            <div key={p.id} className="row t-sm" style={{ gap: 8, color: "var(--ink-subtle)" }}>
                              <Receipt size={13} />
                              <span>{e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "—"}</span>
                              <span className="spacer t-num">{M(p.monto, 2)}</span>
                              {p.feeMonto > 0 && <span className="t-num">fee {M(p.feeMonto, 2)}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                      {resta > 0.01 && (
                        <Button sm variante="secondary" style={{ marginTop: 10 }} onClick={() => setCobrar(c)}>
                          Registrar pago de {M(resta, 2)}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {vVista.notas && (
              <div>
                <div className="t-label" style={{ marginBottom: 8 }}>Notas</div>
                <p className="t-body t-muted" style={{ whiteSpace: "pre-wrap" }}>{vVista.notas}</p>
              </div>
            )}
          </div>
        </Drawer>
      )}

      {cobrar && (
        <FormularioPago
          cuota={cobrar} onCerrar={() => setCobrar(null)}
          onGuardado={() => { toast("Pago registrado."); setCobrar(null); }}
        />
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={`¿Eliminar la venta de ${borrar?.contactoNombre}?`}
        texto="Se borran también sus cuotas y pagos, y el estado de resultados se recalcula. Si sólo se cayó el cliente, mejor cancelala en vez de borrarla."
        onConfirmar={() => { if (borrar) { acciones.eliminar("ventas", borrar.id, borrar.contactoNombre); toast("Venta eliminada."); } }}
      />
    </div>
  );
}

/* ================= Formulario de venta ================= */

interface BorradorVenta {
  id?: string;
  contactoId?: string;
  contactoNombre: string;
  productoId: string;
  precioAcordado: number;
  fecha: string;
  closerId: string;
  directorId: string;
  embudoId: string;
  webinarId: string;
  excluidoMarketing: boolean;
  estado: EstadoVenta;
  notas: string;
  planCuotas: number;
  reserva: number;
}

function nuevoBorrador(e: ReturnType<typeof useEstado>): BorradorVenta {
  return {
    contactoNombre: "", productoId: e.productos[0]?.id ?? "", precioAcordado: e.productos[0]?.precioLista ?? 0,
    fecha: new Date().toISOString(), closerId: "", directorId: "eq_director",
    embudoId: "emb_webinar", webinarId: "", excluidoMarketing: false, estado: "activa",
    notas: "", planCuotas: 1, reserva: 0,
  };
}

function desdeVenta(e: ReturnType<typeof useEstado>, v: Venta): BorradorVenta {
  const cuotas = e.cuotas.filter((c) => c.ventaId === v.id);
  return {
    id: v.id, contactoId: v.contactoId, contactoNombre: v.contactoNombre,
    productoId: v.productoId ?? "", precioAcordado: v.precioAcordado, fecha: v.fecha,
    closerId: v.closerId ?? "", directorId: v.directorId ?? "", embudoId: v.embudoId ?? "",
    webinarId: v.webinarId ?? "", excluidoMarketing: v.excluidoMarketing, estado: v.estado,
    notas: v.notas ?? "",
    planCuotas: Math.max(cuotas.filter((c) => !c.esReserva).length, 1),
    reserva: cuotas.find((c) => c.esReserva)?.monto ?? 0,
  };
}

function FormularioVenta({ borrador, onCerrar, onGuardado }: {
  borrador: BorradorVenta; onCerrar: () => void; onGuardado: (n: string) => void;
}) {
  const e = useEstado();
  const toast = useToast();
  const [f, setF] = useState(borrador);
  const mon = e.ajustes.monedaBase;

  const closerElegido = e.equipo.find((x) => x.id === f.closerId);
  const sinComision = Boolean(closerElegido?.sinComision);
  const resto = f.precioAcordado - f.reserva;
  const porCuota = f.planCuotas > 0 ? resto / f.planCuotas : 0;

  function guardar() {
    if (!f.contactoNombre.trim()) { toast("Poné el nombre del cliente.", "err"); return; }

    const ventaId = f.id ?? nuevoId("ven");
    const datos: Omit<Venta, "id"> = {
      contactoId: f.contactoId, contactoNombre: f.contactoNombre.trim(),
      productoId: f.productoId || undefined, webinarId: f.webinarId || undefined,
      embudoId: f.embudoId || undefined, precioAcordado: f.precioAcordado,
      moneda: mon as Moneda, closerId: f.closerId || undefined,
      directorId: sinComision ? undefined : (f.directorId || undefined),
      excluidoMarketing: f.excluidoMarketing || sinComision,
      estado: f.estado, fecha: f.fecha, notas: f.notas,
      creadoEn: new Date().toISOString(), extra: {},
    };

    if (f.id) {
      acciones.actualizar<Venta>("ventas", f.id, datos, f.contactoNombre);
    } else {
      acciones.crear<Venta>("ventas", { ...datos, id: ventaId }, f.contactoNombre);
      /* Plan de cuotas: la reserva es la cuota 0 */
      if (f.reserva > 0) {
        acciones.crear<Cuota>("cuotas", {
          id: nuevoId("cuo"), ventaId, numero: 0, monto: f.reserva,
          vence: f.fecha, estado: "pendiente", esReserva: true,
        }, `Reserva de ${f.contactoNombre}`);
      }
      for (let k = 1; k <= f.planCuotas; k++) {
        const vence = new Date(f.fecha);
        vence.setMonth(vence.getMonth() + (k - 1));
        acciones.crear<Cuota>("cuotas", {
          id: nuevoId("cuo"), ventaId, numero: k,
          monto: k === f.planCuotas ? resto - porCuota * (f.planCuotas - 1) : porCuota,
          vence: vence.toISOString(), estado: "pendiente", esReserva: false,
        }, `Cuota ${k} de ${f.contactoNombre}`);
      }
    }
    onGuardado(f.contactoNombre);
  }

  return (
    <ModalForm
      abierto onCerrar={onCerrar} onGuardar={guardar} ancho
      titulo={f.id ? "Editar venta" : "Nueva venta"}
      sub={f.id ? "El plan de cuotas no se toca desde acá: editá las cuotas en la ficha de la venta." : "Elegí el producto, el precio que cerró y en cuántas cuotas."}
      guardarTexto={f.id ? "Guardar cambios" : "Registrar venta"}
      puedeGuardar={f.contactoNombre.trim().length > 0}
    >
      <div className="form-grid">
        <Field label="Cliente" span2 ayuda="Si ya está cargado como lead, elegilo de la lista de abajo.">
          <Input value={f.contactoNombre} onChange={(ev) => setF({ ...f, contactoNombre: ev.target.value })} placeholder="Martín Quiroga" autoFocus />
        </Field>
        <Field label="Vincular a un lead" span2 ayuda="Opcional. Sirve para ver toda su historia junta.">
          <Select value={f.contactoId ?? ""} placeholder="Sin vincular"
            onChange={(ev) => {
              const l = e.leads.find((x) => x.id === ev.target.value);
              setF({ ...f, contactoId: ev.target.value || undefined, contactoNombre: l?.nombre ?? f.contactoNombre });
            }}
            opciones={e.leads.slice(0, 200).map((l) => ({ valor: l.id, texto: `${l.nombre} — ${l.email}` }))} />
        </Field>

        <Field label="Producto">
          <Select value={f.productoId}
            onChange={(ev) => {
              const p = e.productos.find((x) => x.id === ev.target.value);
              setF({ ...f, productoId: ev.target.value, precioAcordado: p?.precioLista ?? f.precioAcordado });
            }}
            opciones={e.productos.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre }))} />
        </Field>
        <Field label="Precio cerrado" ayuda="Lo que realmente acordó el closer.">
          <Input type="number" min={0} value={f.precioAcordado} onChange={(ev) => setF({ ...f, precioAcordado: Number(ev.target.value) })} />
        </Field>

        <Field label="Closer" ayuda={sinComision ? "Con Yari como closer no comisiona nadie." : undefined}>
          <Select value={f.closerId} placeholder="Sin asignar"
            onChange={(ev) => setF({ ...f, closerId: ev.target.value })}
            opciones={e.equipo.filter((x) => x.activo && (x.rol === "closer" || x.rol === "ceo")).map((x) => ({ valor: x.id, texto: x.nombre }))} />
        </Field>
        <Field label="Director">
          <Select value={sinComision ? "" : f.directorId} disabled={sinComision} placeholder={sinComision ? "No aplica" : "Sin asignar"}
            onChange={(ev) => setF({ ...f, directorId: ev.target.value })}
            opciones={e.equipo.filter((x) => x.rol === "director").map((x) => ({ valor: x.id, texto: x.nombre }))} />
        </Field>

        <Field label="Embudo">
          <Select value={f.embudoId} onChange={(ev) => setF({ ...f, embudoId: ev.target.value })}
            opciones={e.embudos.filter((x) => x.activo).map((x) => ({ valor: x.id, texto: x.nombre }))} />
        </Field>
        <Field label="Fecha">
          <Input type="date" value={isoDia(f.fecha)} onChange={(ev) => setF({ ...f, fecha: new Date(ev.target.value + "T12:00:00").toISOString() })} />
        </Field>

        <Field label="Webinar de origen" span2 ayuda="Si vino de un webinar, atribuilo: así el profit de ese webinar sale bien.">
          <Select value={f.webinarId} placeholder="Sin atribuir" onChange={(ev) => setF({ ...f, webinarId: ev.target.value })}
            opciones={e.webinars.map((w) => ({ valor: w.id, texto: w.titulo }))} />
        </Field>

        {!f.id && (
          <>
            <Field label="Reserva" ayuda="Lo que dejó de seña. 0 si pagó todo en cuotas.">
              <Input type="number" min={0} value={f.reserva} onChange={(ev) => setF({ ...f, reserva: Number(ev.target.value) })} />
            </Field>
            <Field label="En cuántas cuotas" ayuda={f.planCuotas > 0 ? `${f.planCuotas} × ${money(porCuota, mon, 2)}` : undefined}>
              <Input type="number" min={1} max={12} value={f.planCuotas} onChange={(ev) => setF({ ...f, planCuotas: Math.max(1, Number(ev.target.value)) })} />
            </Field>
          </>
        )}

        <div className="span-2 row-3" style={{ padding: "8px 0" }}>
          <Switch checked={f.excluidoMarketing || sinComision} onChange={(x) => setF({ ...f, excluidoMarketing: x })} etiqueta="Excluida de marketing" />
          <span className="t-body t-muted">
            <strong>Excluida de marketing</strong> — el growth partner no comisiona esta venta
            {sinComision && <span className="t-subtle"> (se marca sola cuando el closer es Yari)</span>}
          </span>
        </div>

        <Field label="Notas" span2><Textarea value={f.notas} onChange={(ev) => setF({ ...f, notas: ev.target.value })} rows={2} /></Field>
      </div>
    </ModalForm>
  );
}

/* ================= Registrar un pago ================= */

function FormularioPago({ cuota, onCerrar, onGuardado }: {
  cuota: Cuota; onCerrar: () => void; onGuardado: () => void;
}) {
  const e = useEstado();
  const pagado = e.pagos.filter((p) => p.cuotaId === cuota.id).reduce((a, p) => a + p.monto, 0);
  const resta = cuota.monto - pagado;

  const [monto, setMonto] = useState(Math.round(resta * 100) / 100);
  const [procesadorId, setProcesadorId] = useState(e.procesadores[0]?.id ?? "");
  const [fecha, setFecha] = useState(isoDia(new Date().toISOString()));
  const [referencia, setReferencia] = useState("");

  const proc = e.procesadores.find((p) => p.id === procesadorId);
  const fee = Math.round(monto * (proc?.feeRate ?? 0) * 100) / 100;
  const mon = e.ajustes.monedaBase;

  return (
    <ModalForm
      abierto onCerrar={onCerrar}
      titulo="Registrar un pago"
      sub={`${cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`} · faltan ${money(resta, mon, 2)}`}
      guardarTexto="Registrar"
      puedeGuardar={monto > 0}
      onGuardar={() => {
        acciones.crear<Pago>("pagos", {
          cuotaId: cuota.id, procesadorId: procesadorId || undefined,
          monto, moneda: mon as Moneda, feeRate: proc?.feeRate ?? 0, feeMonto: fee,
          fecha: new Date(fecha + "T12:00:00").toISOString(),
          referencia: referencia || undefined, creadoEn: new Date().toISOString(),
        }, `Pago de ${money(monto, mon)}`);
        /* Si con esto la cuota queda saldada, se marca cobrada. */
        if (pagado + monto >= cuota.monto - 0.01) {
          acciones.actualizarSilencioso<Cuota>("cuotas", cuota.id, { estado: "pagada" });
        }
        onGuardado();
      }}
    >
      <div className="form-grid">
        <Field label="Monto" ayuda={resta > monto ? `Queda un saldo de ${money(resta - monto, mon, 2)}` : "Salda la cuota"}>
          <Input type="number" min={0} step="0.01" value={monto} onChange={(ev) => setMonto(Number(ev.target.value))} autoFocus />
        </Field>
        <Field label="Método" ayuda={proc ? `Comisión ${pct((proc.feeRate) * 100, 1)} — ${money(fee, mon, 2)}` : undefined}>
          <Select value={procesadorId} onChange={(ev) => setProcesadorId(ev.target.value)}
            opciones={e.procesadores.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre }))} />
        </Field>
        <Field label="Fecha"><Input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} /></Field>
        <Field label="Referencia" ayuda="El ID del pago en Stripe, PayPal, etc.">
          <Input value={referencia} onChange={(ev) => setReferencia(ev.target.value)} placeholder="pi_3Q…" />
        </Field>
      </div>
      <Ayuda titulo="Se puede pagar en varias partes" icono={<Info size={18} />}>
        Si la cuota se cobró con dos métodos, registrá un pago por cada uno sobre la misma cuota.
        Apicanta suma los dos y la marca cobrada cuando llega al total.
      </Ayuda>
    </ModalForm>
  );
}
