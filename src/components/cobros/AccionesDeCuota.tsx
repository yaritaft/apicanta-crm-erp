"use client";

import React, { useState } from "react";
import { CalendarClock, Ban, CheckCheck, RotateCcw, Pencil, Trash2 } from "lucide-react";
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
  const [abierto, setAbierto] = useState<"fecha" | "incobrable" | "monto" | "quitar" | "saldar" | null>(null);
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
  /* Cobrada en parte: lo que falta se puede dar por perdido de un clic (Manu, 24/10: Demian pagó 976 de 979 y no había cómo cerrarla). */
  const enParte = cobrado > 0.005 && cobrado < cuota.monto - 0.005;

  return (
    <>
      <Button sm variante="ghost" icono={<CalendarClock size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("fecha")}>Cambiar fecha</Button>
      <Button sm variante="ghost" icono={<Ban size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("incobrable")}>Incobrable</Button>
      {enParte && <Button sm variante="ghost" icono={<CheckCheck size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("saldar")}>Dar por saldada</Button>}
      <Button sm variante="ghost" icono={<Pencil size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("monto")}>Corregir monto</Button>
      {cobrado === 0 && <Button sm variante="ghost" icono={<Trash2 size={14} />} style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => setAbierto("quitar")}>Quitar cuota</Button>}
      {abierto === "fecha" && <ModalFecha cuota={cuota} onCerrar={() => setAbierto(null)} />}
      {abierto === "incobrable" && <ModalIncobrable cuota={cuota} onCerrar={() => setAbierto(null)} />}
      {abierto === "monto" && <ModalCorregir cuota={cuota} cobrado={cobrado} onCerrar={() => setAbierto(null)} />}
      {abierto === "saldar" && <ModalCorregir cuota={cuota} cobrado={cobrado} saldar onCerrar={() => setAbierto(null)} />}
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

/* Corregir cuánto vale una cuota o quitarla (Dante, 21/10): el precio de la venta se ajusta solo.
   `saldar` es corregirla a lo ya cobrado sin escribir el monto: lo que falta no se cobra. */
function ModalCorregir({ cuota, cobrado, quitar, saldar, onCerrar }: { cuota: Cuota; cobrado: number; quitar?: boolean; saldar?: boolean; onCerrar: () => void }) {
  const toast = useToast();
  const e = useEstado();
  const venta = e.ventas.find((v) => v.id === cuota.ventaId);
  const mon = venta?.moneda ?? "USD";
  const [montoEscrito, setMonto] = useState(cuota.monto);
  const [motivo, setMotivo] = useState("");
  const monto = saldar ? Math.round(cobrado * 100) / 100 : montoEscrito;
  const nuevoMonto = quitar ? 0 : monto;
  const precioNuevo = venta ? Math.max(0, Math.round((venta.precioAcordado - cuota.monto + nuevoMonto) * 100) / 100) : undefined;
  /* Igual a lo cobrado se puede: la cuota queda saldada (Demian, 24/10: la diferencia de redondeo del plan). */
  const menosDeLoCobrado = !quitar && monto < cobrado - 0.005;
  const saldada = !quitar && cobrado > 0 && monto > 0 && Math.abs(monto - cobrado) < 0.005;
  /* Lo que falta para poder guardar, al lado del botón (Manu, 24/10: el botón quedaba apagado sin decir por qué). */
  const falta = quitar ? null
    : menosDeLoCobrado ? `No puede ser menos de lo ya cobrado (${money(cobrado, mon, 2)})`
      : monto <= 0 ? "Escribí el monto correcto"
        : monto === cuota.monto ? "Es el mismo monto que ya tiene"
          : null;
  const problema = falta ?? (motivo.trim() ? null : "Falta escribir por qué");
  function guardar() {
    const cambio = quitar ? { quitar: true as const } : { monto };
    if (acciones.corregirCuota(cuota.id, cambio, motivo)) {
      toast(quitar ? `Se quitó ${nombreDe(cuota)}.`
        : saldada ? `Listo: ${nombreDe(cuota)} quedó saldada en ${money(monto, mon, 2)}.`
          : `Listo: ${nombreDe(cuota)} ahora es de ${money(monto, mon, 2)}.`);
    } else toast("No se pudo cambiar la cuota.", "err");
    onCerrar();
  }
  const titulo = quitar ? `Quitar ${nombreDe(cuota)}` : saldar ? `Dar por saldada ${nombreDe(cuota)}` : `Corregir el monto de ${nombreDe(cuota)}`;
  const sub = saldar
    ? `Es de ${money(cuota.monto, mon, 2)} y se cobraron ${money(cobrado, mon, 2)}: los ${money(cuota.monto - cobrado, mon, 2)} que faltan no se cobran y la cuota queda pagada.`
    : `Hoy es de ${money(cuota.monto, mon, 2)}${cobrado > 0 ? ` y ya se cobraron ${money(cobrado, mon, 2)}` : ""}.`;
  return (
    <Modal
      abierto onCerrar={onCerrar} titulo={titulo} sub={sub}
      pie={<><span className="spacer" />
        {problema && <span className="modal__falta">{problema}</span>}
        <Button variante="secondary" onClick={onCerrar}>Cancelar</Button>
        <Button variante={quitar ? "danger" : "primary"} disabled={problema !== null} onClick={guardar}>{quitar ? "Quitar la cuota" : saldar ? "Dar por saldada" : "Guardar el monto"}</Button></>}
    >
      {!quitar && !saldar && (
        <Field label="Monto correcto" ayuda={cobrado > 0
          ? saldada ? `Igual a lo ya cobrado: la cuota queda saldada.` : `Si es igual a lo ya cobrado (${money(cobrado, mon, 2)}), la cuota queda saldada.`
          : undefined}>
          <InputMonto value={montoEscrito} error={menosDeLoCobrado} onChange={(ev) => setMonto(montoDe(ev.target.value))} />
        </Field>
      )}
      <Field label="Por qué" ayuda="Es obligatorio: queda anotado en la cuota y en la actividad.">
        <Textarea
          rows={3} value={motivo} onChange={(ev) => setMotivo(ev.target.value)} autoFocus={saldar}
          placeholder={quitar ? "Ej.: el precio real era 450, esta cuota sobraba" : saldar ? "Ej.: diferencia de redondeo del plan, Stripe le cobra 976 por mes" : "Ej.: el cliente acordó 450 en total"}
        />
      </Field>
      {venta && precioNuevo !== undefined && precioNuevo !== venta.precioAcordado && (
        <p className="t-sm t-subtle">El valor total de la venta pasa de {money(venta.precioAcordado, mon, 2)} a {money(precioNuevo, mon, 2)}.</p>
      )}
    </Modal>
  );
}
