import type React from "react";

/* Un elemento que no es un botón y se puede tocar: con teclado y para lectores de pantalla. */
export function clic(onClick: () => void) {
  return {
    role: "button" as const, tabIndex: 0, onClick,
    onKeyDown: (ev: React.KeyboardEvent) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); onClick(); }
    },
  };
}

/** «Buen día» según la hora de Argentina. */
export function saludoDe(ahora: number): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", hour12: false }).format(new Date(ahora)));
  if (h < 6) return "Buenas noches";
  if (h < 13) return "Buen día";
  if (h < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** 23,4% — sin base, «—» no: un guión obliga a adivinar; se dice «sin dato». */
export const pctTxt = (v: number | null) => (v == null ? "Sin dato" : `${v.toFixed(1).replace(".", ",")}%`);

export const plural = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;
