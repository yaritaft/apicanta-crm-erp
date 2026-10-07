"use client";

import { useEffect, useState } from "react";
import { nube } from "./supabase";
import type { CotizacionBlue } from "./cambio";

/* ==================================================================
   El dólar para los cobros en pesos: el blue (venta) y el cripto (venta) de
   DolarHoy / DolarApi si el cobro es de hoy, el cierre de ese día si es de
   otro (ver app/api/dolar), y el promedio de los dos, que es lo que propone
   la app (lib/cambio). El closer lo puede cambiar y el cobro guarda las dos
   cosas.
   ================================================================== */

export { fuenteDe, promedioDolar, type CotizacionBlue } from "./cambio";

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
