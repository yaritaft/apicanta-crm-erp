"use client";

import { useSesion } from "./auth";
import { useEstado } from "./store";
import type { MiembroEquipo } from "./types";

/* Quién está usando la app: el email de la sesión y, si ese email es de
   alguien del equipo, su nombre. Sin nube (modo local) no hay sesión y se
   usa el responsable de Ajustes. Lo usan el chat de la ficha (quién
   escribió) y, más adelante, el closer que se elige solo. */
export function miembroActual(equipo: MiembroEquipo[], email: string | null | undefined): MiembroEquipo | undefined {
  if (!email) return undefined;
  const clave = email.trim().toLowerCase();
  return equipo.find((m) => m.email?.trim().toLowerCase() === clave);
}

export function useUsuarioActual(): { email: string | null; nombre: string; miembro?: MiembroEquipo } {
  const { email } = useSesion();
  const e = useEstado();
  const miembro = miembroActual(e.equipo, email);
  if (miembro) return { email, nombre: miembro.nombre, miembro };
  if (email) {
    const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    return { email, nombre: local.replace(/\b\p{L}/gu, (l) => l.toUpperCase()) };
  }
  return { email: null, nombre: e.ajustes.responsable || "Yo" };
}
