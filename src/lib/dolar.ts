"use client";

import { useEffect, useState } from "react";
import { nube } from "./supabase";

/* ==================================================================
   El dólar blue (venta) para los cobros en pesos: el de DolarHoy si el
   cobro es de hoy, el cierre de ese día si es de otro (ver
   app/api/dolar). Es lo que propone la app; el closer lo puede cambiar
   y el cobro guarda las dos cosas.
   ================================================================== */

export interface CotizacionBlue {
  venta: number;
  compra?: number;
  /* El día de la cotización, YYYY-MM-DD (Argentina). */
  fecha: string;
  fuente: "DolarHoy" | "DolarApi" | "ArgentinaDatos";
  /* Cómo lo dice la fuente: "23/09/26 09:20 PM", "cierre del 22/09/2026". */
  actualizado?: string;
}

/* "DolarHoy · 23/09/26 09:20 PM": lo que queda guardado en el cobro. */
export function fuenteDe(c: CotizacionBlue): string {
  return c.actualizado ? `${c.fuente} · ${c.actualizado}` : c.fuente;
}

const pedidos = new Map<string, Promise<CotizacionBlue>>();

export function pedirBlue(dia: string): Promise<CotizacionBlue> {
  const ya = pedidos.get(dia);
  if (ya) return ya;
  const p = (async () => {
    const headers: Record<string, string> = {};
    if (nube) {
      const { data } = await nube.auth.getSession();
      if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`;
    }
    const r = await fetch(`/api/dolar?fecha=${encodeURIComponent(dia)}`, { headers, cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j as { error?: string }).error ?? "No pude traer el dólar blue.");
    return j as CotizacionBlue;
  })();
  pedidos.set(dia, p);
  /* Un error no queda guardado: el próximo intento vuelve a preguntar. Uno
     bueno dura lo mismo que en el servidor. */
  p.then(() => setTimeout(() => pedidos.delete(dia), 5 * 60 * 1000), () => pedidos.delete(dia));
  return p;
}

/* El blue de un día, o null mientras no se pida (`dia` null). */
export function useBlue(dia: string | null): { cotizacion: CotizacionBlue | null; error: string | null; cargando: boolean } {
  const [estado, setEstado] = useState<{ dia: string | null; cotizacion: CotizacionBlue | null; error: string | null }>(
    { dia: null, cotizacion: null, error: null },
  );
  useEffect(() => {
    if (!dia) return;
    let vivo = true;
    pedirBlue(dia).then(
      (cotizacion) => { if (vivo) setEstado({ dia, cotizacion, error: null }); },
      (err: unknown) => { if (vivo) setEstado({ dia, cotizacion: null, error: err instanceof Error ? err.message : "No pude traer el dólar blue." }); },
    );
    return () => { vivo = false; };
  }, [dia]);
  const alDia = estado.dia === dia;
  return {
    cotizacion: alDia ? estado.cotizacion : null,
    error: alDia ? estado.error : null,
    cargando: Boolean(dia) && !alDia,
  };
}
