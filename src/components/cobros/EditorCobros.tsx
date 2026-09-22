"use client";

import React, { useCallback, useMemo, useState } from "react";
import { Link2, Plus, Trash2, Unlink } from "lucide-react";
import { Button, IconButton, Input, Select } from "@/components/ui/ui";
import { CampoComprobante } from "@/components/cobros/CampoComprobante";
import { disponibleDe, SelectorMovimiento, type PagoDisponible } from "@/components/cobros/SelectorMovimiento";
import { nuevoId } from "@/lib/store";
import { fechaLarga, isoDia, money } from "@/lib/format";
import { medioDeMovimiento, procesadorDeMovimiento } from "@/lib/conciliacion";
import { descartarComprobante } from "@/lib/comprobantes";
import { nombrePasarela } from "@/lib/pasarelas";
import type { Comprobante, EstadoApp, ID } from "@/lib/types";

/* ==================================================================
   Los cobros de UNA cuota: uno por medio de pago.

   Cada cobro se prueba de una de dos maneras: conciliándolo con el pago
   que llegó a la pasarela (el monto, la fecha y el fee son los reales) o
   con su comprobante. Sin conciliar, el comprobante es obligatorio.

   Lo usan el asistente de venta (una vez por cuota) y "Registrar pago"
   de una venta ya cargada. Los cambios salen como función (`onCambio(f)`)
   para que una subida que termina tarde no pise lo que se escribió
   mientras tanto.
   ================================================================== */

export interface CobroBorrador {
  id: string;
  procesadorId: string;
  monto: number;
  fecha: string;
  referencia: string;
  /* Si sale de un pago que ya entró a la pasarela */
  movimientoId?: ID;
  comprobante?: Comprobante;
}

const redondear = (n: number) => Math.round(n * 100) / 100;
const sumar = (xs: { monto: number }[]) => redondear(xs.reduce((a, x) => a + x.monto, 0));

export function cobroNuevo(procesadorId: string, monto: number, extra?: Partial<CobroBorrador>): CobroBorrador {
  return {
    id: nuevoId("cob"), procesadorId, monto: redondear(monto),
    fecha: new Date().toISOString(), referencia: "", ...extra,
  };
}

/* Agregar un medio más. Si todavía falta cobrar, el nuevo arranca con lo
   que falta; si ya estaba cubierto, el objetivo se reparte parejo entre
   los cobros que no están atados a una pasarela (esos traen su monto real
   y no se tocan). */
export function agregarMedio(cobros: CobroBorrador[], objetivo: number, procesadorId: string): CobroBorrador[] {
  const nuevo = cobroNuevo(procesadorId, 0);
  const falta = redondear(objetivo - sumar(cobros));
  if (falta > 0.01 || cobros.length === 0) return [...cobros, { ...nuevo, monto: Math.max(falta, 0) }];
  const fijos = sumar(cobros.filter((p) => p.movimientoId));
  const libres = [...cobros.filter((p) => !p.movimientoId), nuevo];
  const aRepartir = Math.max(redondear(objetivo - fijos), 0);
  const parte = Math.floor((aRepartir / libres.length) * 100) / 100;
  const monto = new Map(libres.map((p, k) => [
    p.id, k === libres.length - 1 ? redondear(aRepartir - parte * (libres.length - 1)) : parte,
  ]));
  return [...cobros, nuevo].map((p) => (monto.has(p.id) ? { ...p, monto: monto.get(p.id)! } : p));
}

/* Lo que falta para poder guardar estos cobros, o null. `nombre` es cómo
   se lee la cuota en la frase: "la reserva", "la cuota 2". */
export function problemaDeCobros(e: EstadoApp, cobros: CobroBorrador[], nombre: string): string | null {
  if (cobros.some((p) => !p.procesadorId)) return `Elegí el medio de pago de ${nombre}`;
  if (cobros.some((p) => !(p.monto > 0))) return `Un cobro de ${nombre} está en cero: poné el monto o sacalo`;
  for (const p of cobros) {
    if (p.movimientoId || p.comprobante) continue;
    const medio = e.procesadores.find((x) => x.id === p.procesadorId);
    return medio?.proveedor
      ? `Falta el comprobante de ${nombre} con ${medio.nombre}, o conciliarlo con un pago de la pasarela`
      : `Falta el comprobante de ${nombre}${medio ? ` con ${medio.nombre}` : ""}`;
  }
  return null;
}

/* Un pago de pasarela no puede usarse por más de lo que trajo. */
export function problemaDePasarelas(e: EstadoApp, cobros: CobroBorrador[]): string | null {
  const usado = new Map<ID, number>();
  for (const p of cobros) if (p.movimientoId) usado.set(p.movimientoId, (usado.get(p.movimientoId) ?? 0) + p.monto);
  for (const [id, monto] of usado) {
    const mov = e.movimientos.find((m) => m.id === id);
    if (!mov) continue;
    const libre = disponibleDe(mov, e.pagos, new Map());
    if (monto > libre + 0.01) {
      return `El pago de ${mov.clienteNombre || mov.referencia} no alcanza: quedan ${money(libre, mov.moneda, 2)}`;
    }
  }
  return null;
}

export function EditorCobros({ e, cobros, onCambio, objetivo, cliente, usadoFuera, onSubiendo }: {
  e: EstadoApp;
  cobros: CobroBorrador[];
  onCambio: (f: (cobros: CobroBorrador[]) => CobroBorrador[]) => void;
  /* Lo que se espera cobrar en esta cuota: guía el reparto entre medios */
  objetivo: number;
  cliente: { nombre?: string; email?: string };
  /* Lo que usan de cada pago de pasarela los cobros de OTRAS cuotas */
  usadoFuera?: Map<ID, number>;
  onSubiendo: (cobroId: string, subiendo: boolean) => void;
}) {
  const procesadores = e.procesadores.filter((p) => p.activo);
  const mon = e.ajustes.monedaBase;
  const [eligiendo, setEligiendo] = useState<string | null>(null);

  const editar = useCallback((id: string, cambios: Partial<CobroBorrador>) =>
    onCambio((xs) => xs.map((p) => (p.id === id ? { ...p, ...cambios } : p))), [onCambio]);

  const quitar = (p: CobroBorrador) => {
    if (p.comprobante) void descartarComprobante(p.comprobante);
    onSubiendo(p.id, false);
    onCambio((xs) => xs.filter((x) => x.id !== p.id));
  };

  /* Lo usado de cada pago de pasarela por todos los demás cobros */
  const usadoSin = useCallback((cobroId: string) => {
    const usado = new Map(usadoFuera ?? []);
    for (const p of cobros) {
      if (!p.movimientoId || p.id === cobroId) continue;
      usado.set(p.movimientoId, (usado.get(p.movimientoId) ?? 0) + p.monto);
    }
    return usado;
  }, [cobros, usadoFuera]);

  const pendientesPorPasarela = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of e.movimientos) if (m.estado === "pendiente") n.set(m.proveedor, (n.get(m.proveedor) ?? 0) + 1);
    return n;
  }, [e.movimientos]);

  /* Atar un cobro a un pago de la pasarela: medio, fecha y referencia pasan
     a ser los reales; el monto, lo que ese pago cubre de lo que falta. */
  function elegirPago({ mov, disponible }: PagoDisponible) {
    const cobro = cobros.find((p) => p.id === eligiendo);
    if (!cobro) { setEligiendo(null); return; }
    const falta = redondear(objetivo - sumar(cobros.filter((p) => p.id !== cobro.id)));
    const monto = redondear(Math.min(disponible, falta > 0.01 ? falta : cobro.monto || disponible));
    editar(cobro.id, {
      movimientoId: mov.id,
      procesadorId: procesadorDeMovimiento(e, mov)?.id ?? cobro.procesadorId,
      fecha: mov.fecha, referencia: mov.referencia, monto,
    });
    setEligiendo(null);
  }

  const elegido = cobros.find((p) => p.id === eligiendo);

  return (
    <>
      {cobros.map((p) => {
        const proc = e.procesadores.find((x) => x.id === p.procesadorId);
        const mov = p.movimientoId ? e.movimientos.find((m) => m.id === p.movimientoId) : undefined;
        const pendientes = proc?.proveedor ? pendientesPorPasarela.get(proc.proveedor) ?? 0 : 0;
        return (
          <div className="cobro-item" key={p.id}>
            <div className="cobro-linea">
              <Select
                value={p.procesadorId} placeholder="Medio de pago" aria-label="Medio de pago"
                disabled={Boolean(p.movimientoId)}
                onChange={(ev) => editar(p.id, { procesadorId: ev.target.value })}
                opciones={procesadores.map((x) => ({ valor: x.id, texto: x.nombre }))}
              />
              <Input type="number" min={0} step="0.01" value={p.monto} aria-label="Monto del cobro"
                onChange={(ev) => editar(p.id, { monto: Number(ev.target.value) })} />
              <Input type="date" value={isoDia(p.fecha)} aria-label="Fecha del cobro" disabled={Boolean(p.movimientoId)}
                onChange={(ev) => { if (ev.target.value) editar(p.id, { fecha: new Date(ev.target.value + "T12:00:00").toISOString() }); }} />
              <IconButton etiqueta="Quitar este cobro" onClick={() => quitar(p)}>
                <Trash2 size={15} />
              </IconButton>
            </div>

            <div className="cobro-prueba">
              {p.movimientoId ? (
                <div className="conciliado-caja">
                  <Link2 size={16} style={{ flexShrink: 0, color: "var(--success)" }} />
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="t-sm t-strong" style={{ display: "block" }}>
                      Conciliado con {mov ? medioDeMovimiento(e, mov) : "la pasarela"}
                    </span>
                    <span className="truncate t-sm t-subtle" style={{ display: "block" }}>
                      {mov
                        ? `${mov.clienteNombre || "Sin nombre"} · ${fechaLarga(mov.fecha)} · ${money(mov.monto, mov.moneda ?? mon, 2)} · ${mov.referencia}`
                        : p.referencia}
                    </span>
                  </span>
                  <Button sm variante="ghost" onClick={() => setEligiendo(p.id)}>Cambiar</Button>
                  <IconButton etiqueta="Desconciliar este cobro" onClick={() => editar(p.id, { movimientoId: undefined, referencia: "" })}>
                    <Unlink size={15} />
                  </IconButton>
                </div>
              ) : proc?.proveedor ? (
                <button type="button" className="conciliar-btn" onClick={() => setEligiendo(p.id)}>
                  <Link2 size={16} style={{ flexShrink: 0, color: "var(--brand)" }} />
                  <span style={{ minWidth: 0 }}>
                    <span className="t-strong" style={{ display: "block" }}>Conciliar con un pago de {nombrePasarela(proc.proveedor)}</span>
                    <span className="t-sm t-subtle">
                      {pendientes === 0 ? "No hay pagos sin conciliar" : `${pendientes} ${pendientes === 1 ? "pago sin conciliar" : "pagos sin conciliar"}`}
                    </span>
                  </span>
                </button>
              ) : (
                <div className="conciliar-btn" aria-disabled="true" style={{ cursor: "default" }}>
                  <Link2 size={16} style={{ flexShrink: 0 }} className="t-subtle" />
                  <span className="t-sm t-subtle">
                    {proc ? `${proc.nombre} no tiene pagos automáticos: se prueba con el comprobante.` : "Elegí el medio de pago."}
                  </span>
                </div>
              )}
              <CampoComprobante
                valor={p.comprobante} obligatorio={!p.movimientoId}
                onCambio={(comprobante) => editar(p.id, { comprobante })}
                onSubiendo={(s) => onSubiendo(p.id, s)}
              />
            </div>

            {!p.movimientoId && (
              <Input value={p.referencia} placeholder="Referencia del pago (opcional)" aria-label="Referencia del pago"
                onChange={(ev) => editar(p.id, { referencia: ev.target.value })} />
            )}
          </div>
        );
      })}

      <Button
        sm variante="ghost" icono={<Plus size={14} />} style={{ alignSelf: "flex-start" }}
        onClick={() => onCambio((xs) => agregarMedio(xs, objetivo, procesadores[0]?.id ?? ""))}
      >
        Agregar otro medio de pago
      </Button>

      {elegido && (
        <SelectorMovimiento
          abierto onCerrar={() => setEligiendo(null)}
          proveedor={e.procesadores.find((x) => x.id === elegido.procesadorId)?.proveedor}
          cliente={cliente}
          monto={elegido.monto}
          usado={usadoSin(elegido.id)}
          onElegir={elegirPago}
        />
      )}
    </>
  );
}
