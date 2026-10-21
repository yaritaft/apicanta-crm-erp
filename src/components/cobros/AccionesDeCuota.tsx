"use client";

import React, { useState } from "react";
import { CalendarClock, Ban, RotateCcw, Pencil, Trash2 } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { montoDe } from "@/lib/monto";
import { esIncobrable, motivoIncobrable } from "@/lib/cuota-incobrable";
import type { Cuota } from "@/lib/types";

/* ==================================================================
   Qué se puede hacer con una cuota que no se cobró en fecha (reunión del
   15/10): pasarla a otra fecha («el cliente pide arrastrarla al mes que
   viene») o darla por incobrable («se dio de baja, no se va a cobrar») con
   el motivo. Una incobrable se puede volver a cobrar.
   ================================================================== */

const nombreDe = (c: Cuota) => (c.esReserva ? "la reserva" : `la cuota ${c.numero}`);
const aaaammdd = (iso?: string) => (iso ? iso.slice(0, 10) : "");

export function AccionesDeCuota({ cuota }: { cuota: Cuota }) {
  const [abierto, setAbierto] = useState<"fecha" | "incobrable" | "monto" | "quitar" | null>(null);
  const toast = useToast();
  const e = useEstado();
  const cobrado = e.pagos.filter((p) => p.cuotaId === cuota.id).reduce((t, p) => t + p.monto, 0);

  if (esIncobrable(cuota)) {
    return (
      <div className="row" style={{ gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span className="t-sm t-subtle">No se va a cobrar{motivoIncobrable(cuota) ? `: ${motivoIncobrable(cuota)}` : ""}</span>
        <Button
          sm variante="ghost" icono={<RotateCcw size={14} />}
          onClick={() => { acciones.reactivarCuota(cuota.id); toast(`Volvió a quedar por cobrar ${nombreDe(cuota)}.`); }}
        >
          Volver a cobrar
        </Button>
      </div>
    );
  }
  if (cuota.estado !== "pendiente") return null;

  return (
    <>
      <Button sm variante="ghost" icono={<CalendarClock size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("fecha")}>Cambiar fecha</Button>
      <Button sm variante="ghost" icono={<Ban size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("incobrable")}>Incobrable</Button>
      <Button sm variante="ghost" icono={<Pencil size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("monto")}>Corregir monto</Button>
      {cobrado === 0 && <Button sm variante="ghost" icono={<Trash2 size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("quitar")}>Quitar cuota</Button>}
      {abierto === "fecha" && <ModalFecha cuota={cuota} onCerrar={() => setAbierto(null)} />}
      {abierto === "incobrable" && <ModalIncobrable cuota={cuota} onCerrar={() => setAbierto(null)} />}
      {abierto === "monto" && <ModalCorregir cuota={cuota} cobrado={cobrado} onCerrar={() => setAbierto(null)} />}
      {abierto === "quitar" && <ModalCorregir cuota={cuota} cobrado={cobrado} quitar onCerrar={() => setAbierto(null)} />}
    </>
  );
}

function ModalFecha({ cuota, onCerrar }: { cuota: Cuota; onCerrar: () => void }) {
  const toast = useToast();
  const [fecha, setFecha] = useState(aaaammdd(cuota.vence));
  const [motivo, setMotivo] = useState("");
  const cambio = fecha !== "" && fecha !== aaaammdd(cuota.vence);
  return (
    <Modal
      abierto onCerrar={onCerrar} titulo={`Cambiar la fecha de ${nombreDe(cuota)}`}
      sub={cuota.vence ? `Hoy vence el ${fechaLarga(cuota.vence)}.` : "Hoy no tiene fecha."}
      pie={<><span className="spacer" /><Button variante="secondary" onClick={onCerrar}>Cancelar</Button>
        <Button disabled={!cambio} onClick={() => { acciones.reprogramarCuota(cuota.id, fecha, motivo); toast(`Listo: ${nombreDe(cuota)} ahora vence el ${fechaLarga(new Date(`${fecha}T12:00:00-03:00`).toISOString())}.`); onCerrar(); }}>Guardar la fecha</Button></>}
    >
      <Field label="Nueva fecha de vencimiento">
        <Input type="date" value={fecha} onChange={(ev) => setFecha(ev.target.value)} />
      </Field>
      <Field label="Por qué (opcional)" ayuda="Queda anotado en la cuota.">
        <Input value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ej.: el cliente pidió pagar a fin de mes" />
      </Field>
    </Modal>
  );
}

function ModalIncobrable({ cuota, onCerrar }: { cuota: Cuota; onCerrar: () => void }) {
  const toast = useToast();
  const [motivo, setMotivo] = useState("");
  return (
    <Modal
      abierto onCerrar={onCerrar} titulo={`Dar por incobrable ${nombreDe(cuota)}`}
      sub="Deja de figurar como pendiente y de contar como mora. Si después paga, se puede volver a cobrar."
      pie={<><span className="spacer" /><Button variante="secondary" onClick={onCerrar}>Cancelar</Button>
        <Button disabled={!motivo.trim()} onClick={() => { acciones.marcarIncobrable(cuota.id, motivo); toast(`Quedó como incobrable ${nombreDe(cuota)}.`); onCerrar(); }}>Dar por incobrable</Button></>}
    >
      <Field label="¿Por qué no se va a cobrar?" ayuda="Es obligatorio: queda anotado en la cuota y en la actividad.">
        <Textarea rows={3} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder="Ej.: se dio de baja, no le gustó la mentoría" />
      </Field>
    </Modal>
  );
}

/* Corregir cuánto vale una cuota o quitarla (Dante, 21/10): el precio de la venta se ajusta solo. */
function ModalCorregir({ cuota, cobrado, quitar, onCerrar }: { cuota: Cuota; cobrado: number; quitar?: boolean; onCerrar: () => void }) {
  const toast = useToast();
  const e = useEstado();
  const venta = e.ventas.find((v) => v.id === cuota.ventaId);
  const mon = venta?.moneda ?? "USD";
  const [monto, setMonto] = useState(cuota.monto);
  const [motivo, setMotivo] = useState("");
  const nuevoMonto = quitar ? 0 : monto;
  const precioNuevo = venta ? Math.max(0, Math.round((venta.precioAcordado - cuota.monto + nuevoMonto) * 100) / 100) : undefined;
  const sirve = motivo.trim().length > 0 && (quitar || (monto > cobrado && monto !== cuota.monto));
  function guardar() {
    const cambio = quitar ? { quitar: true as const } : { monto };
    if (acciones.corregirCuota(cuota.id, cambio, motivo)) toast(quitar ? `Se quitó ${nombreDe(cuota)}.` : `Listo: ${nombreDe(cuota)} ahora es de ${money(monto, mon, 2)}.`);
    else toast("No se pudo cambiar la cuota.", "err");
    onCerrar();
  }
  return (
    <Modal
      abierto onCerrar={onCerrar} titulo={quitar ? `Quitar ${nombreDe(cuota)}` : `Corregir el monto de ${nombreDe(cuota)}`}
      sub={`Hoy es de ${money(cuota.monto, mon, 2)}${cobrado > 0 ? ` y ya se cobraron ${money(cobrado, mon, 2)}` : ""}.`}
      pie={<><span className="spacer" /><Button variante="secondary" onClick={onCerrar}>Cancelar</Button>
        <Button variante={quitar ? "danger" : "primary"} disabled={!sirve} onClick={guardar}>{quitar ? "Quitar la cuota" : "Guardar el monto"}</Button></>}
    >
      {!quitar && (
        <Field label="Monto correcto" ayuda={cobrado > 0 ? `Tiene que ser más de lo ya cobrado (${money(cobrado, mon, 2)}).` : undefined}>
          <InputMonto value={monto} onChange={(ev) => setMonto(montoDe(ev.target.value))} />
        </Field>
      )}
      <Field label="Por qué" ayuda="Es obligatorio: queda anotado en la cuota y en la actividad.">
        <Textarea rows={3} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} placeholder={quitar ? "Ej.: el precio real era 450, esta cuota sobraba" : "Ej.: el cliente acordó 450 en total"} />
      </Field>
      {venta && precioNuevo !== undefined && precioNuevo !== venta.precioAcordado && (
        <p className="t-sm t-subtle">El valor total de la venta pasa de {money(venta.precioAcordado, mon, 2)} a {money(precioNuevo, mon, 2)}.</p>
      )}
    </Modal>
  );
}
