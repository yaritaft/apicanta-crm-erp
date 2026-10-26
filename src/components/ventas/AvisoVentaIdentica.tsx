"use client";

import React from "react";
import { Copy } from "lucide-react";
import { Switch } from "@/components/ui/ui";
import { fechaLarga, money } from "@/lib/format";
import { cobradoDeVenta } from "@/lib/ventas-repetidas";
import type { EstadoApp, Venta } from "@/lib/types";

/* «Ya hay una venta idéntica cargada» en el asistente de venta (Aldana, 24/10: la venta de Jorge David Llamas Olivero se
   cargó dos veces, una con el pago chequeado a mano y otra con el que concilió la pasarela). Es un aviso, no una
   prohibición: a veces es de verdad otra compra. En el resumen pide marcar «es otra compra» para poder registrarla. */

export function AvisoVentaIdentica({ e, identicas, confirmada, onConfirmar }: {
  e: EstadoApp; identicas: Venta[];
  /* En el resumen: se tiene que marcar para registrar. Antes, sólo avisa. */
  confirmada?: boolean; onConfirmar?: (si: boolean) => void;
}) {
  if (identicas.length === 0) return null;
  const v = identicas[0];
  const producto = e.productos.find((x) => x.id === v.productoId)?.nombre ?? "la venta";
  const conReembolso = (e.devoluciones ?? []).some((d) => d.ventaId === v.id && d.estado !== "ignorada");
  const estado = v.estado === "activa" ? "activa" : v.estado === "cancelada" ? "cancelada" : "reembolsada";
  return (
    <div className="aviso-duplicado" role="alert">
      <div className="aviso-duplicado__fila">
        <Copy size={16} aria-hidden />
        <span className="aviso-duplicado__texto">
          <strong>Ya hay una venta idéntica cargada: </strong>
          {v.contactoNombre} · {producto} · {money(v.precioAcordado, v.moneda)} · {fechaLarga(v.fecha)}
          <span className="t-subtle">
            {" "}({estado}, {money(cobradoDeVenta(e, v.id), v.moneda)} cobrados){identicas.length > 1 ? ` y ${identicas.length - 1} más` : ""}.
            {" "}Si es la misma compra, no la cargues de nuevo: sumale el pago a esa venta desde la ficha.
          </span>
          {/* Sebastián Vega (26/10): pagó por Whop, se lo reembolsaron y pagó de nuevo por dLocal; se cargó otra venta en vez de sumar el pago a la original. */}
          {conReembolso && (
            <strong style={{ display: "block", marginTop: 4 }}>
              Esa venta tiene un reembolso: si la persona volvió a pagar, no es otra venta. Sumale el pago nuevo a esa misma (su ficha → Ventas → Registrar pago).
            </strong>
          )}
        </span>
      </div>
      {onConfirmar && (
        <div className="row-3">
          <Switch checked={Boolean(confirmada)} onChange={onConfirmar} etiqueta="Es otra compra: cargarla igual" />
          <span className="t-body"><strong>Es otra compra</strong> — cargarla igual</span>
        </div>
      )}
    </div>
  );
}
