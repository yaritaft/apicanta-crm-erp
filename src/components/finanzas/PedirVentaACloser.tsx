"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ModalForm } from "@/components/ui/Modal";
import { Opcion } from "@/components/ui/Asistente";
import { acciones, useEstado } from "@/lib/store";
import { useUsuarioActual } from "@/lib/usuario";
import { fechaLarga } from "@/lib/format";
import { closerSugerido, closersPosibles } from "@/lib/pedidos-de-venta";
import type { Movimiento } from "@/lib/types";

/* ==================================================================
   «Pedir la venta a un closer» (Aldana, 20/10).

   Un cobro de una pasarela sin venta cargada: se elige de qué closer es
   (la app propone el que tuvo la llamada con esa persona) y el pedido le
   aparece en «Pendientes» de su panel, con el botón para cargarla, hasta
   que el cobro se concilie. Si no lo hace, se pone amarillo al día y rojo
   a los dos (lib/pedidos-de-venta.ts).
   ================================================================== */

const POR: Record<"correo" | "ficha" | "nombre", string> = {
  correo: "agendó con el mismo correo",
  ficha: "es de su ficha",
  nombre: "agendó con el mismo nombre",
};

export function PedirVentaACloser({ abierto, mov, onCerrar, onListo }: {
  abierto: boolean; mov: Movimiento; onCerrar: () => void; onListo: (mensaje: string) => void;
}) {
  const e = useEstado();
  const yo = useUsuarioActual();
  const closers = useMemo(() => closersPosibles(e.equipo), [e.equipo]);
  const sugerido = useMemo(() => (abierto ? closerSugerido(e, mov) : undefined), [abierto, e, mov]);
  const [elegido, setElegido] = useState("");

  /* Cada vez que se abre arranca con el closer sugerido (o con el que ya tiene el pedido). */
  useEffect(() => {
    if (!abierto) return;
    setElegido(mov.pedidoACloserId ?? sugerido?.miembro.id ?? "");
  }, [abierto, mov.pedidoACloserId, sugerido?.miembro.id]);

  /* El sugerido va primero. */
  const orden = useMemo(() => [...closers].sort((a, b) => Number(b.id === sugerido?.miembro.id) - Number(a.id === sugerido?.miembro.id)), [closers, sugerido?.miembro.id]);

  return (
    <ModalForm
      abierto={abierto} onCerrar={onCerrar} titulo="¿De qué closer es esta venta?"
      sub={`Cobro de ${mov.clienteNombre?.trim() || mov.referencia}. Le aparece en Pendientes de su panel, con el botón para cargarla.`}
      guardarTexto={mov.pedidoACloserId ? "Cambiar el pedido" : "Pedir la venta"} puedeGuardar={Boolean(elegido)}
      onGuardar={() => {
        const closer = closers.find((c) => c.id === elegido);
        if (!closer) return;
        if (acciones.pedirVentaACloser(mov.id, closer.id, yo.miembro?.nombre ?? yo.email ?? undefined)) onListo(`Le pediste la venta a ${closer.nombre}. Le aparece en su panel.`);
      }}
    >
      {closers.length === 0 ? (
        <p className="t-sm t-muted">No hay closers activos en Equipo.</p>
      ) : (
        <div className="opciones opciones--lista" role="group" aria-label="Closer">
          {orden.map((c) => {
            const esSugerido = c.id === sugerido?.miembro.id;
            return (
              <Opcion
                key={c.id} nombre={c.nombre} activo={elegido === c.id} onClick={() => setElegido(c.id)}
                sub={esSugerido && sugerido ? `Sugerido: tuvo la llamada con esta persona el ${fechaLarga(sugerido.llamada.inicia)} (${POR[sugerido.por]})` : undefined}
              />
            );
          })}
        </div>
      )}
      {!sugerido && closers.length > 0 && (
        <p className="t-sm t-muted">No encontré una llamada de esta persona: elegí vos de qué closer es.</p>
      )}
    </ModalForm>
  );
}
