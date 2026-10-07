"use client";

import { useSyncExternalStore } from "react";
import type { ID } from "./types";

/* ==================================================================
   Abrir «Cargar una devolución» desde cualquier pantalla.

   La devolución se pide desde cuatro lugares: la ficha de la venta, una
   llamada que quedó en «Devolución» (CRM, cierre del día, Agenda o ficha),
   la lista de devoluciones de Finanzas y una devolución que informó una
   pasarela. Todos piden lo mismo —la venta o la persona— y el formulario
   (components/devoluciones/CargarDevolucion) está montado una vez en el
   layout, así que se abre con una llamada, sin pasar estado de una pantalla
   a otra.
   ================================================================== */

export interface PedidoDevolucion {
  /* La venta que se devuelve, si ya se sabe. */
  ventaId?: ID;
  /* O la persona (su contacto, lead, venta o llamada): se elige entre sus ventas. */
  personaId?: ID;
  /* La llamada que quedó en «Devolución». */
  sesionId?: ID;
  /* Una devolución que informó la pasarela y se confirma con este formulario. */
  propuestaId?: ID;
  /* Una devolución ya cargada que se corrige. */
  devolucionId?: ID;
}

let pedido: PedidoDevolucion | null = null;
const oyentes = new Set<() => void>();
const avisar = () => oyentes.forEach((f) => f());

export function abrirDevolucion(p: PedidoDevolucion = {}) {
  pedido = p;
  avisar();
}

export function cerrarDevolucion() {
  if (pedido === null) return;
  pedido = null;
  avisar();
}

export function usePedidoDevolucion(): PedidoDevolucion | null {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => { oyentes.delete(f); }; },
    () => pedido,
    () => null,
  );
}
