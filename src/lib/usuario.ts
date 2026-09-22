"use client";

import { useSesion } from "./auth";
import { useEstado } from "./store";

/* Quién está usando la app: el email de la sesión y, si ese email es de
   alguien del equipo, su nombre. Sin nube (modo local) no hay sesión y se
   usa el responsable de Ajustes. Lo usan el chat de la ficha (quién
   escribió) y, más adelante, el closer que se elige solo. */
export function useUsuarioActual(): { email: string | null; nombre: string } {
  const { email } = useSesion();
  const e = useEstado();
  const miembro = email
    ? e.equipo.find((m) => (m as { email?: string }).email?.trim().toLowerCase() === email.toLowerCase())
    : undefined;
  if (miembro) return { email, nombre: miembro.nombre };
  if (email) {
    const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    return { email, nombre: local.replace(/\b\p{L}/gu, (l) => l.toUpperCase()) };
  }
  return { email: null, nombre: e.ajustes.responsable || "Yo" };
}
