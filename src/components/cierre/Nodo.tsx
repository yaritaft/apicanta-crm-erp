import React from "react";
import { Check, Lock } from "lucide-react";
import type { EstadoPaso, PasoCierre } from "@/lib/cierre-mes";

/* El circulito de cada paso: tilde si está listo, candado si no se puede todavía, y el número en los demás. */
export function Nodo({ estado, n }: { estado: EstadoPaso; n: number }) {
  return (
    <span className={`cm-nodo cm-nodo--${estado}`} aria-hidden>
      {estado === "listo" ? <Check size={17} strokeWidth={2.5} /> : estado === "bloqueado" ? <Lock size={14} /> : n}
    </span>
  );
}

export const TEXTO_ESTADO: Record<EstadoPaso, string> = { listo: "Listo", pendiente: "Pendiente", "en-curso": "En curso", bloqueado: "Bloqueado" };

/** Lo que dice el lado derecho de un paso: cuántos faltan, o que está listo. */
export function Cuenta({ p }: { p: PasoCierre }) {
  if (p.estado === "pendiente" && p.faltan > 0) return <span className="cm-cuenta" title={`${p.faltan} por resolver`}>{p.faltan}</span>;
  if (p.estado === "listo") return <span className="cm-cuenta cm-cuenta--listo">Listo</span>;
  return <span className="cm-cuenta cm-cuenta--neutra">{TEXTO_ESTADO[p.estado]}</span>;
}
