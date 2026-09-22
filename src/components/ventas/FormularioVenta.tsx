"use client";

import React, { useState } from "react";
import { Field, Input, Select, Switch, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { isoDia, money } from "@/lib/format";
import type { Cuota, EstadoVenta, Moneda, Venta } from "@/lib/types";

/* Editar una venta ya cargada (y el alta vieja, en un solo formulario).
   Vive aparte porque lo usan la pantalla de Ventas y la ficha de la
   persona. El alta nueva es el asistente (AsistenteVenta). */

/* ================= Formulario de venta ================= */

export interface BorradorVenta {
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

export function desdeVenta(e: ReturnType<typeof useEstado>, v: Venta): BorradorVenta {
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

export function FormularioVenta({ borrador, onCerrar, onGuardado }: {
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
