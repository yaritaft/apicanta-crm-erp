"use client";

import React, { useState } from "react";
import { Button, Field, Textarea } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { acciones, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { fecha, money } from "@/lib/format";
import { personaDe } from "@/lib/persona";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { hoyDeNegocio } from "@/lib/cierre-del-dia";
import { closerDeCuota } from "@/lib/comision";
import { esIncobrable, motivoIncobrable } from "@/lib/cuota-incobrable";
import type { MiPanel as Datos } from "@/lib/mi-panel";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Lo que se abre al tocar una cifra de arriba: el detalle de las
   comisiones (con «Disputar» en cada venta) y las cuotas de cada tramo de
   la mesa de cobro.
   ================================================================== */

/* Cómo empieza el comentario de una disputa: así se las encuentra después. Sin emoji: es la UI del producto. */
export const MARCA_DISPUTA = "Disputa de comisión";

export function DetalleComisiones({ datos, e, comoOtro, esDueno, onCerrar }: { datos: Datos; e: EstadoApp; comoOtro: boolean; esDueno: boolean; onCerrar: () => void }) {
  const abrirFicha = useAbrirFicha();
  const [disputa, setDisputa] = useState<string | null>(null);
  const m = datos.miembro;
  const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "Venta";
  const puedeDisputar = !comoOtro && !esDueno;

  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Comisiones · ${datos.rango.etiqueta}`} sub="Cada venta con lo que se cobró y lo que te toca. Si algo no cierra, disputalo." ancho>
      {datos.comisiones.length === 0 ? (
        <p className="mp-vacio">En este rango todavía no se cobró nada de tus ventas.</p>
      ) : (
        <div className="mp-det__scroll">
          <div className="mp-det">
            <div className="mp-det__cab">
              <span>Cliente</span><span>Servicio</span><span className="mp-det__der">Cobrado</span><span className="mp-det__der">%</span><span className="mp-det__der">Te toca</span><span />
            </div>
            {datos.comisiones.map((c) => {
              const venta = e.ventas.find((x) => x.id === c.ventaId);
              const toca = c.closerId === m.id ? c.comisionCloser : c.comisionDirector;
              const tasa = c.closerId === m.id ? c.tasaCloser : c.tasaDirector;
              return (
                <div key={c.id} className="mp-det__fila">
                  <span style={{ minWidth: 0 }}>
                    <button type="button" className="link" onClick={() => venta && (onCerrar(), abrirFicha(venta.id, "ventas", { venta: venta.id }))}>{venta?.contactoNombre ?? "—"}</button>
                    {c.heredadaDe && <span className="t-sm t-subtle"> · cuota heredada de {c.heredadaDe}</span>}
                  </span>
                  <span className="t-muted">{productoDe(c.productoId)}</span>
                  <span className="mp-det__der">{money(c.cobradoEnMes, "USD", 2)}</span>
                  <span className="mp-det__der">{c.sinComision ? "—" : `${Math.round(tasa * 1000) / 10}%`}</span>
                  <span className="mp-det__der t-strong" title={c.descuentoCierre ? `Se descontaron ${money(c.descuentoCierre, "USD", 2)} por un día sin cierre` : undefined}>
                    {money(toca, "USD", 2)}{c.descuentoCierre ? "*" : ""}
                  </span>
                  <span className="mp-det__der">
                    {venta && puedeDisputar && <Button sm variante="ghost" onClick={() => setDisputa(venta.id)}>Disputar</Button>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {datos.descuentoCierre > 0 && <p className="t-sm t-subtle" style={{ marginTop: 12 }}>* Hay {money(datos.descuentoCierre, "USD", 2)} que no se pagan por llamadas de un día sin el cierre del día cargado.</p>}
      <Disputas e={e} nombre={m.nombre} />
      {disputa && <ModalDisputa ventaId={disputa} rango={datos.rango.etiqueta} onCerrar={() => setDisputa(null)} />}
    </Modal>
  );
}

function Disputas({ e, nombre }: { e: EstadoApp; nombre: string }) {
  const mias = (e.comentarios ?? [])
    .filter((c) => c.texto.startsWith(MARCA_DISPUTA) && c.autor === nombre)
    .sort((a, b) => b.creadoEn.localeCompare(a.creadoEn))
    .slice(0, 5);
  if (mias.length === 0) return null;
  return (
    <div className="mp-disputas">
      <span className="t-sm t-strong">Disputas que abriste</span>
      {mias.map((c) => (
        <p key={c.id} className="t-sm t-muted" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          <span className="t-subtle">{fecha(c.creadoEn)} · </span>{c.texto.replace(MARCA_DISPUTA, "").replace(/^\s*·?\s*/, "")}
        </p>
      ))}
    </div>
  );
}

function ModalDisputa({ ventaId, rango, onCerrar }: { ventaId: string; rango: string; onCerrar: () => void }) {
  const e = useEstado();
  const yo = useUsuarioActual();
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const venta = e.ventas.find((x) => x.id === ventaId);
  const producto = e.productos.find((x) => x.id === venta?.productoId)?.nombre ?? "Venta";
  /* El chat de la ficha cuelga de la persona (su contacto), no de la venta. */
  const clave = personaDe(e, ventaId)?.clave;

  const enviar = () => {
    if (!clave || !texto.trim()) return;
    acciones.comentar(clave, `${MARCA_DISPUTA} · ${producto} · ${rango}\n${texto.trim()}`, yo.nombre, yo.email ?? undefined);
    toast("Listo: dejamos la disputa en la ficha para que la vean los dueños.");
    onCerrar();
  };

  return (
    <Modal
      abierto onCerrar={onCerrar} titulo="Disputar una comisión"
      sub={venta ? `${venta.contactoNombre} · ${producto} · ${rango}` : undefined}
      pie={<><span className="spacer" /><Button variante="secondary" onClick={onCerrar}>Cancelar</Button><Button disabled={!texto.trim() || !clave} onClick={enviar}>Enviar la disputa</Button></>}
    >
      <Field label="¿Qué no cierra?" ayuda="Contá qué esperabas y qué ves: el %, un cobro que falta, un descuento. Queda en la ficha de esta persona y lo ven los dueños.">
        <Textarea rows={4} value={texto} onChange={(ev) => setTexto(ev.target.value)} placeholder="Ej.: este cliente pagó 1.500 y acá figura 1.300" />
      </Field>
    </Modal>
  );
}

/* ---------- La mesa de cobro: las cuotas de cada tramo ---------- */

export type TramoMesa = "mes" | "atrasado" | "riesgo" | "futuro" | "incobrable";
const TITULO_TRAMO: Record<TramoMesa, string> = {
  mes: "Vence este mes", atrasado: "Vencido de antes", riesgo: "Vencido hace más de 90 días", futuro: "Vence más adelante", incobrable: "Incobrables",
};

export function DetalleMesa({ tramo, datos, e, onCerrar }: { tramo: TramoMesa; datos: Datos; e: EstadoApp; onCerrar: () => void }) {
  const abrirFicha = useAbrirFicha();
  const hoy = hoyDeNegocio();
  const mes = hoy.slice(0, 7);
  const hace90 = diaDeNegocio(new Date(Date.parse(`${hoy}T12:00:00Z`) - 90 * 86400000).toISOString());
  const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "Venta";

  type R = { id: string; ventaId: string; nombre: string; vence: string; cuota: string; producto: string; monto: number; nota?: string };
  let filas: R[];
  if (tramo === "incobrable") {
    const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
    filas = e.cuotas.filter((c) => esIncobrable(c)).flatMap((c) => {
      const v = ventas.get(c.ventaId);
      if (!v || v.estado === "cancelada" || closerDeCuota(v, c) !== datos.miembro.id) return [];
      return [{ id: c.id, ventaId: v.id, nombre: v.contactoNombre, vence: c.vence ? diaDeNegocio(c.vence) : "", cuota: c.esReserva ? "Reserva" : `Cuota ${c.numero}`, producto: productoDe(v.productoId), monto: c.monto, nota: motivoIncobrable(c) }];
    });
  } else {
    filas = datos.porCobrar.filter((x) => {
      const d = x.cuota.vence ? diaDeNegocio(x.cuota.vence) : "";
      if (tramo === "mes") return d.slice(0, 7) === mes;
      if (tramo === "atrasado") return d !== "" && d.slice(0, 7) < mes;
      if (tramo === "riesgo") return d !== "" && d < hace90 && d.slice(0, 7) < mes;
      return d !== "" && d.slice(0, 7) > mes;
    }).map((x) => ({ id: x.cuota.id, ventaId: x.venta.id, nombre: x.venta.contactoNombre, vence: x.cuota.vence ? diaDeNegocio(x.cuota.vence) : "", cuota: x.cuota.esReserva ? "Reserva" : `Cuota ${x.cuota.numero}`, producto: productoDe(x.venta.productoId), monto: x.falta }));
  }
  filas.sort((a, b) => a.vence.localeCompare(b.vence));
  const total = filas.reduce((a, f) => a + f.monto, 0);

  return (
    <Modal abierto onCerrar={onCerrar} titulo={TITULO_TRAMO[tramo]} sub={`${filas.length} ${filas.length === 1 ? "cuota" : "cuotas"} · ${money(total, "USD", 0)}`} ancho>
      {filas.length === 0 ? <p className="mp-vacio">No hay cuotas en este tramo.</p> : (
        <div className="mp-cobros">
          {filas.map((f) => (
            <div key={f.id} className="mp-cobros__fila">
              <span className="mp-cobros__fecha" style={{ minWidth: 76, color: tramo === "atrasado" || tramo === "riesgo" ? "var(--danger)" : undefined }}>{f.vence ? fecha(f.vence) : "Sin fecha"}</span>
              <span className="mp-cobros__nombre"><button type="button" className="link" onClick={() => { onCerrar(); abrirFicha(f.ventaId, "ventas", { venta: f.ventaId }); }}>{f.nombre}</button></span>
              <span className="t-sm t-subtle">{f.cuota} · {f.producto}{f.nota ? ` · ${f.nota}` : ""}</span>
              <span className="mp-cobros__monto">{money(f.monto, "USD", 0)}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
