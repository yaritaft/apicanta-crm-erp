import type { Acceso, Plataforma } from "./accesos-servidor";

/* ==================================================================
   «¿Le quitamos los accesos?» al cargar o confirmar un reembolso (reunión del 21/10).

   No va solo: a veces se reembolsa sólo para cambiar el medio de pago, y el alumno sigue.
   Aldana lo coordina con Lili (Customer Success) para saber si se va. Si se marca, se
   sacan TODOS sus accesos (Wisboo, Telegram, Zoom) con lo mismo que la ficha → Servicio →
   Accesos → «Quitar todo» (POST /api/accesos-alumnos { accion: "quitar" }).

   Sin React ni red: lo que se le muestra a quien carga (a qué tiene acceso hoy).
   ================================================================== */

const ORDEN: Plataforma[] = ["wisboo", "telegram", "zoom"];
const NOMBRE: Record<Plataforma, string> = { wisboo: "Wisboo", telegram: "Telegram", zoom: "Zoom" };

/** Los accesos que se pueden quitar: los que ya se dieron (o el alumno ya usó). Un pendiente, un error o uno ya quitado no cuentan. */
export const accesosQuitables = <T extends Pick<Acceso, "estado">>(xs: readonly T[]): T[] => xs.filter((x) => x.estado === "dado" || x.estado === "entro");

/** «Wisboo 2 · Telegram 1 · Zoom 1»: a qué tiene acceso hoy (sólo lo que se puede quitar). Vacío si no tiene nada. */
export function resumenDeAccesos(xs: readonly Pick<Acceso, "plataforma" | "estado">[]): string {
  const por = new Map<Plataforma, number>();
  for (const x of accesosQuitables(xs)) por.set(x.plataforma, (por.get(x.plataforma) ?? 0) + 1);
  return ORDEN.filter((p) => por.has(p)).map((p) => `${NOMBRE[p]} ${por.get(p)}`).join(" · ");
}

/** Lo que se le cuenta a quien cargó el reembolso cuando pidió quitar los accesos. */
export function avisoDeAccesosQuitados(r: { quitados?: number; fallaron?: number }): { texto: string; error: boolean } {
  const quitados = Number(r.quitados ?? 0);
  const fallaron = Number(r.fallaron ?? 0);
  if (fallaron > 0) return { texto: `Accesos: ${quitados} quitados y ${fallaron} con error. Mirá cuáles en la ficha → Servicio → Accesos y reintentá.`, error: true };
  if (quitados === 0) return { texto: "No había accesos para quitar.", error: false };
  return { texto: `Accesos quitados: ${quitados}.`, error: false };
}
