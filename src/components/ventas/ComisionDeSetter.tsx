"use client";

import { useState } from "react";
import { Button, Field, Input } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { tasaDeComision, tasaDeSetterEnVenta } from "@/lib/comision";
import { tasaDeTexto, textoDeTasa, textoParaEditar } from "@/lib/comision-setter";
import { acciones, useEstado } from "@/lib/store";
import type { Venta } from "@/lib/types";

/* El % que cobra el setter de UNA venta (Aldana, 31/10): el de siempre de esa persona, 0 si la venta no le comisiona, u otro. Lo fija
   quien liquida; la liquidación lo muestra en un renglón aparte («Ajuste por porcentaje propio»). */
export function ComisionDeSetter({ venta }: { venta: Venta }) {
  const e = useEstado();
  const toast = useToast();
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const setter = e.equipo.find((x) => x.id === venta.setterId);
  if (!setter) return null;

  const propia = typeof venta.comisionSetter === "number";
  const deSiempre = tasaDeComision(setter, venta.productoId);
  const efectiva = tasaDeSetterEnVenta(setter, venta);
  const nueva = tasaDeTexto(texto);

  function guardar() {
    if (nueva === undefined) { toast("Poné un número de 0 a 100, por ejemplo 2,5.", "err"); return; }
    const antes = propia ? (venta.comisionSetter as number) : null;
    if (nueva === antes) { setAbierto(false); return; }
    const como = (t: number | null) => (t === null ? `la de siempre (${textoDeTasa(deSiempre)})` : textoDeTasa(t));
    acciones.actualizarParcial<Venta>(
      "ventas", venta.id, { comisionSetter: nueva }, venta.contactoNombre,
      `Comisión de ${setter!.nombre} en esta venta: ${como(nueva)} (antes ${como(antes)}).`,
    );
    toast(`Venta de ${venta.contactoNombre}: ${setter!.nombre.split(" ")[0]} comisiona ${como(nueva)}.`);
    setAbierto(false);
  }

  return (
    /* Dentro de una fila que abre la ficha al tocarla: ni el botón ni el modal (que cuelga del cuerpo pero sube por acá) la abren. */
    <span onClick={(ev) => ev.stopPropagation()} onKeyDown={(ev) => ev.stopPropagation()}>
      <button
        type="button" className="link t-sm" style={propia ? { color: "var(--warning)" } : undefined}
        title="Cambiar el porcentaje que cobra el setter de esta venta"
        onClick={() => { setTexto(textoParaEditar(venta.comisionSetter)); setAbierto(true); }}
      >
        Comisión {textoDeTasa(efectiva)}{propia ? " · propia" : ""}
      </button>
      <ModalForm
        abierto={abierto} onCerrar={() => setAbierto(false)} onGuardar={guardar}
        titulo="Comisión del setter en esta venta" sub={`${venta.contactoNombre} · ${setter.nombre}`}
        puedeGuardar={nueva !== undefined}
      >
        <Field
          label="Porcentaje para esta venta"
          ayuda={`Vacío: el de siempre de ${setter.nombre.split(" ")[0]} (${textoDeTasa(deSiempre)}). 0: esta venta no le comisiona. Se aplica a todo lo que se cobró y se cobre de esta venta.`}
          error={nueva === undefined ? "Poné un número de 0 a 100." : undefined}
        >
          <Input value={texto} inputMode="decimal" autoFocus placeholder={textoParaEditar(deSiempre)}
            onChange={(ev) => setTexto(ev.target.value)} aria-label="Porcentaje del setter en esta venta" />
        </Field>
        <div className="row-wrap" style={{ gap: 8 }}>
          <Button sm variante="ghost" onClick={() => setTexto("")}>Lo de siempre ({textoDeTasa(deSiempre)})</Button>
          <Button sm variante="ghost" onClick={() => setTexto("0")}>Sin comisión (0%)</Button>
        </div>
        <p className="t-sm t-subtle" style={{ marginTop: 10 }}>
          En la liquidación sale un renglón aparte, «Ajuste por porcentaje propio», con la diferencia contra el {textoDeTasa(deSiempre)}.
          Lo que ya se pagó en un mes cerrado queda como diferencia en el mes siguiente.
        </p>
      </ModalForm>
    </span>
  );
}
