"use client";

import React, { useEffect, useState } from "react";
import { ModalForm } from "@/components/ui/Modal";
import { Field, Textarea } from "@/components/ui/ui";
import { Opcion } from "@/components/ui/Asistente";
import { motivoCompleto, textoDeMotivo, type OpcionMotivo } from "@/lib/motivos";

/* ==================================================================
   «¿Por qué no es una venta?» / «¿Por qué no es una devolución?»

   Ningún ingreso ni egreso de una pasarela se deja de lado sin decir por qué
   (Juan Cruz, 19/10). Esta ventana pide el motivo —uno de la lista y, si hace
   falta, unas palabras— y devuelve el texto que queda guardado y que lee el
   equipo en «Sin venta» y en Transacciones.
   ================================================================== */

export function MotivoDeDescarte({ abierto, titulo, sub, opciones, guardarTexto = "Dejar sin venta", inicial, onGuardar, onCerrar }: {
  abierto: boolean;
  titulo: string;
  sub?: string;
  opciones: readonly OpcionMotivo[];
  guardarTexto?: string;
  /* Al corregir un motivo ya escrito: arranca con ese texto en «Otro motivo». */
  inicial?: string;
  onGuardar: (motivo: string) => void;
  onCerrar: () => void;
}) {
  const [elegida, setElegida] = useState<string>("");
  const [detalle, setDetalle] = useState("");

  /* Cada vez que se abre arranca de cero (o con lo que ya estaba escrito). */
  useEffect(() => {
    if (!abierto) return;
    if (inicial?.trim()) { setElegida("otro"); setDetalle(inicial.trim()); } else { setElegida(""); setDetalle(""); }
  }, [abierto, inicial]);

  const opcion = opciones.find((o) => o.id === elegida);
  const completo = motivoCompleto(opcion, detalle);

  return (
    <ModalForm
      abierto={abierto} onCerrar={onCerrar} titulo={titulo} sub={sub} guardarTexto={guardarTexto} puedeGuardar={completo}
      onGuardar={() => { if (opcion && completo) onGuardar(textoDeMotivo(opcion, detalle)); }}
    >
      <div className="opciones opciones--lista" role="group" aria-label="Motivo">
        {opciones.map((o) => (
          <Opcion key={o.id} nombre={o.texto} sub={o.ayuda} activo={elegida === o.id} onClick={() => setElegida(o.id)} />
        ))}
      </div>
      {opcion?.pideDetalle && (
        <Field label={opcion.pideDetalle === "obligatorio" ? "Contá el motivo" : "Algo más (opcional)"}>
          <Textarea
            rows={2} value={detalle} onChange={(ev) => setDetalle(ev.target.value)} aria-label="Detalle del motivo"
            placeholder={opcion.pideDetalle === "obligatorio" ? "Por ejemplo: lo devolvió la financiera el 12/10" : "Por ejemplo: lo devolvió Whop el 05/10"}
          />
        </Field>
      )}
    </ModalForm>
  );
}
