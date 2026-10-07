"use client";

import React, { useMemo } from "react";
import { Badge } from "@/components/ui/ui";
import { estadoDelLector, type EstadoLector } from "@/lib/whatsapp";
import { useAhora, useLector } from "@/lib/whatsapp-cliente";

/* ==================================================================
   Cómo está el lector de WhatsApp, para mostrarlo donde haga falta:
   un hook que da su estado (y lo mantiene al día con la hora que pasa) y
   la pastilla con su color. Lo usan el aviso de Webinars y del Dashboard,
   Ajustes → WhatsApp y la ficha de un webinar.
   ================================================================== */

export function useEstadoDelLector(activo = true) {
  const { datos, cargando, error, sinAcceso, recargar } = useLector(activo);
  const ahora = useAhora();
  const lector = datos?.lector ?? null;
  const estado = useMemo(() => estadoDelLector(lector, ahora), [lector, ahora]);
  return { estado, datos, cargando, error, sinAcceso, recargar, hayLector: lector !== null };
}

const VARIANTE = { success: "success", warning: "warning", danger: "danger", neutral: "neutral" } as const;

export function EstadoLectorBadge({ estado }: { estado: EstadoLector }) {
  return <Badge variante={VARIANTE[estado.tono]}>{estado.titulo}</Badge>;
}
