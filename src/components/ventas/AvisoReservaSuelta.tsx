"use client";

import React from "react";
import { Button, Switch } from "@/components/ui/ui";
import { fechaLarga, money } from "@/lib/format";
import type { ReservaSuelta } from "@/lib/reservas";
import type { EstadoApp, ID } from "@/lib/types";

/* «¿Está completando su reserva?» en el asistente de venta (Aldana, 18/11: Carlos Juca dejó US$ 400 de reserva y, al pagar
   el resto, se le cargó otra venta de 3.000 con la reserva adentro: 3.400 cobrados). Quien ya dejó una reserva no necesita
   una venta nueva: se completa la misma. En el resumen, para cargar igual otra venta hay que decir que es otra compra. */

export function AvisoReservaSuelta({ e, reservas, nombre, onCompletar, confirmada, onConfirmar }: {
  e: EstadoApp; reservas: ReservaSuelta[];
  /* El nombre de pila de quien compra, para la pregunta. */
  nombre?: string;
  onCompletar: (ventaId: ID) => void;
  /* En el resumen: se tiene que marcar para registrar otra venta. Antes, sólo avisa. */
  confirmada?: boolean; onConfirmar?: (si: boolean) => void;
}) {
  if (reservas.length === 0) return null;
  const quien = (nombre ?? "").trim().split(" ")[0];
  return (
    <div className="aviso-cuotas" role={onConfirmar ? "alert" : "status"} data-aviso="reserva-suelta">
      <span className="t-strong">{quien ? `¿${quien} está completando su reserva?` : "¿Está completando su reserva?"}</span>
      <span className="t-sm t-muted">
        {reservas.length === 1 ? "Ya dejó una reserva." : `Ya dejó ${reservas.length} reservas.`}
        {" "}Si ahora paga lo que falta, <strong>no cargues una venta nueva</strong>: se completa esa misma y queda una sola venta, con la reserva adentro.
      </span>
      {reservas.slice(0, 3).map((r) => {
        const producto = e.productos.find((p) => p.id === r.venta.productoId)?.nombre ?? "Venta";
        return (
          <div className="aviso-cuotas__fila" key={r.venta.id}>
            <span className="t-sm">
              <strong>{producto}</strong>
              <span className="t-subtle"> · reserva de {money(r.pagado, r.venta.moneda)} · {fechaLarga(r.venta.fecha)}</span>
            </span>
            <Button sm variante="primary" onClick={() => onCompletar(r.venta.id)}>Completar esta reserva</Button>
          </div>
        );
      })}
      {onConfirmar && (
        <div className="row-3">
          <Switch checked={Boolean(confirmada)} onChange={onConfirmar} etiqueta="Es otra compra: la reserva queda aparte" />
          <span className="t-body"><strong>Es otra compra</strong> — la reserva queda aparte</span>
        </div>
      )}
    </div>
  );
}
