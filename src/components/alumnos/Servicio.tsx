"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import { ArrowRight, Link2 } from "lucide-react";
import { Badge, Field, Input, Select, Textarea } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { CamposExtra } from "@/components/ui/CamposExtra";
import { useToast } from "@/components/ui/Toast";
import { ESTADO_ALUMNO, ESTADOS_ALUMNO } from "@/components/alumnos/comun";
import { acciones, useEstado } from "@/lib/store";
import { etapaDelAlumno, etapasDeServicio, opcionesDePlan, planDeVenta, ventasParaEnlazar } from "@/lib/alumnos";
import { fechaLarga, isoDia, money } from "@/lib/format";
import type { Alumno, EstadoAlumno, Venta } from "@/lib/types";

/* Piezas del servicio de un alumno que usan la pantalla de Alumnos y la
   ficha de la persona (pestaña Servicio): la venta que lo trajo (o enlazar
   una) y el formulario para editarlo. */

/* ---------- La venta de la ficha ----------
   Enlazada: se ve y lleva a su detalle en Ventas. Sin enlazar: se puede elegir
   ahí mismo entre las ventas que no tienen alumno, empezando por las que
   parecen suyas. */

export function VentaDelAlumno({ alumno }: { alumno: Alumno }) {
  const e = useEstado();
  const toast = useToast();
  const venta = alumno.ventaId ? e.ventas.find((v) => v.id === alumno.ventaId) : undefined;
  const candidatas = useMemo(
    () => (venta ? [] : ventasParaEnlazar(e, alumno).slice(0, 60)),
    [e, alumno, venta],
  );

  if (venta) {
    return (
      <div>
        <div className="t-label" style={{ marginBottom: 12 }}>Venta</div>
        <Link href={`/ventas?ver=${venta.id}`} className="agenda-item alu-venta">
          <Link2 size={16} className="alu-venta__ico" />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span className="alu-venta__titulo truncate">{planDeVenta(e, venta) || "Venta sin producto"}</span>
            <span className="t-sm t-subtle t-num">{fechaLarga(venta.fecha)} · {money(venta.precioAcordado, venta.moneda)}</span>
          </span>
          {venta.estado !== "activa" && (
            <Badge variante={venta.estado === "reembolsada" ? "danger" : "neutral"}>
              {venta.estado === "reembolsada" ? "Reembolsada" : "Cancelada"}
            </Badge>
          )}
          <ArrowRight size={16} className="alu-venta__ico" />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <div className="t-label" style={{ marginBottom: 8 }}>Venta</div>
      <p className="t-sm t-subtle" style={{ marginBottom: candidatas.length ? 10 : 0 }}>
        {alumno.ventaId ? "La venta que tenía enlazada ya no existe." : "No tiene una venta enlazada."}{" "}
        {candidatas.length ? "Si ya está cargada, elegila:" : "No hay ventas sin alumno para enlazarle."}
      </p>
      {candidatas.length > 0 && (
        <Select
          value="" placeholder="Enlazar una venta…" aria-label="Enlazar una venta"
          onChange={(ev) => {
            const v = candidatas.find((x) => x.id === ev.target.value);
            if (!v) return;
            acciones.actualizar<Alumno>("alumnos", alumno.id, { ventaId: v.id }, alumno.nombre, `Se enlazó a ${alumno.nombre} la venta de ${v.contactoNombre}.`);
            toast("Venta enlazada.");
          }}
          opciones={candidatas.map((v) => ({ valor: v.id, texto: textoVenta(e.productos, v) }))}
        />
      )}
    </div>
  );
}

export function textoVenta(productos: { id: string; nombre: string }[], v: Venta): string {
  const producto = productos.find((p) => p.id === v.productoId)?.nombre ?? "Sin producto";
  return `${v.contactoNombre} · ${producto} · ${fechaLarga(v.fecha)}`;
}

/* ---------- Editar ----------
   El alta es el asistente; editar sigue en un modal, con todo a la vista. */

export function EditarAlumno({ form, setForm, onGuardar }: {
  form: Alumno; setForm: (a: Alumno | null) => void; onGuardar: () => void;
}) {
  const e = useEstado();
  const etapas = etapasDeServicio(e);
  const ventas = useMemo(() => {
    const libres = ventasParaEnlazar(e, form).slice(0, 80);
    /* La que ya tiene tiene que estar en la lista aunque la regla de
       duplicados se la atribuya a otro: si no, el desplegable mostraría
       "Sin venta" y guardar la desenlazaría sin querer. */
    const actual = form.ventaId ? e.ventas.find((v) => v.id === form.ventaId) : undefined;
    return actual && !libres.some((v) => v.id === actual.id) ? [actual, ...libres] : libres;
  }, [e, form]);

  return (
    <ModalForm
      abierto onCerrar={() => setForm(null)} onGuardar={onGuardar} ancho
      titulo="Editar alumno" sub="El progreso lo vas actualizando a mano a medida que avanza."
      guardarTexto="Guardar cambios" puedeGuardar={form.nombre.trim().length > 0}
    >
      <div className="form-grid">
        <Field label="Nombre y apellido"><Input value={form.nombre} onChange={(ev) => setForm({ ...form, nombre: ev.target.value })} placeholder="Martín Quiroga" autoFocus /></Field>
        <Field label="Email"><Input type="email" value={form.email} onChange={(ev) => setForm({ ...form, email: ev.target.value })} /></Field>
        <Field label="País"><Input value={form.pais ?? ""} onChange={(ev) => setForm({ ...form, pais: ev.target.value })} /></Field>
        <Field label="Cohorte" ayuda="El grupo con el que entró."><Input value={form.cohorte} onChange={(ev) => setForm({ ...form, cohorte: ev.target.value })} placeholder="C9" /></Field>
        <Field label="Plan"><Select value={form.plan} onChange={(ev) => setForm({ ...form, plan: ev.target.value })} opciones={opcionesDePlan(e, form.plan)} /></Field>
        <Field label="Estado">
          <Select value={form.estado} onChange={(ev) => setForm({ ...form, estado: ev.target.value as EstadoAlumno })}
            opciones={ESTADOS_ALUMNO.map((k) => ({ valor: k, texto: ESTADO_ALUMNO[k].texto }))} />
        </Field>
        <Field label="Etapa del servicio" ayuda="La columna del pipeline de alumnos.">
          <Select value={etapaDelAlumno(etapas, form)?.id ?? ""} onChange={(ev) => setForm({ ...form, etapaServicioId: ev.target.value })}
            opciones={etapas.map((et) => ({ valor: et.id, texto: et.nombre }))} />
        </Field>
        <Field label="Venta" ayuda="La venta que lo trajo.">
          <Select value={form.ventaId ?? ""} placeholder="Sin venta enlazada"
            onChange={(ev) => setForm({ ...form, ventaId: ev.target.value || undefined })}
            opciones={ventas.map((v) => ({ valor: v.id, texto: textoVenta(e.productos, v) }))} />
        </Field>
        <Field label="Cuota mensual" ayuda="0 si pagó todo junto."><Input type="number" min={0} value={form.cuotaMensual} onChange={(ev) => setForm({ ...form, cuotaMensual: Number(ev.target.value) })} /></Field>
        <Field label="Fecha de inicio">
          <Input type="date" value={isoDia(form.inicio)}
            /* Mediodía: la medianoche UTC en Argentina es el día anterior. */
            onChange={(ev) => { if (ev.target.value) setForm({ ...form, inicio: new Date(`${ev.target.value}T12:00:00`).toISOString() }); }} />
        </Field>
        <Field label="Progreso" span2 ayuda={`${form.progreso}% del programa completado.`}>
          <Input type="range" min={0} max={100} step={5} value={form.progreso} onChange={(ev) => setForm({ ...form, progreso: Number(ev.target.value) })} />
        </Field>
        <Field label="Notas" span2><Textarea value={form.notas ?? ""} onChange={(ev) => setForm({ ...form, notas: ev.target.value })} rows={3} /></Field>
        <CamposExtra campos={e.campos} entidad="alumno" valores={form.extra} onChange={(k, v) => setForm({ ...form, extra: { ...form.extra, [k]: v } })} />
      </div>
    </ModalForm>
  );
}
