"use client";

import React, { useState } from "react";
import { CalendarClock, Ban, RotateCcw } from "lucide-react";
import { Button, Field, Input, Textarea } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { fechaLarga } from "@/lib/format";
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
  const [abierto, setAbierto] = useState<"fecha" | "incobrable" | null>(null);
  const toast = useToast();

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
      {abierto === "fecha" && <ModalFecha cuota={cuota} onCerrar={() => setAbierto(null)} />}
      {abierto === "incobrable" && <ModalIncobrable cuota={cuota} onCerrar={() => setAbierto(null)} />}
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
