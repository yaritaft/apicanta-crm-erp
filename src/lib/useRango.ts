"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { rangoDePreset, type RangoFechas } from "@/components/ui/DateRangePicker";

/* El rango de fechas vive en la URL, no en el estado de cada pantalla.

   Dos razones. Una: ir de Finanzas a su detalle y volver conserva el periodo,
   que si viviera en useState se perderia en cada navegacion. La otra la pidio
   Yari: poder mandar un link a un periodo concreto, o dejarlo en favoritos,
   en vez de entrar y seleccionar todo de nuevo cada vez.

   Se guardan las dos cosas, el preset y las fechas. El preset porque un rango
   RELATIVO tiene que volver a calcularse contra hoy — "esta semana" guardada
   el lunes debe seguir significando esta semana el viernes, no la del lunes.
   Las fechas porque un rango elegido a mano, o "Maximo", no se puede
   reconstruir sin ellas. */
export function useRangoURL(porDefecto = "mes"): [RangoFechas, (r: RangoFechas) => void] {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rango = useMemo<RangoFechas>(() => {
    const preset = params.get("periodo");
    const desde = params.get("desde");
    const hasta = params.get("hasta");

    /* Relativo: se re-materializa contra hoy. */
    if (preset && preset !== "custom" && preset !== "max") {
      const r = rangoDePreset(preset, null);
      if (r) return r;
    }
    if (desde && hasta) return { preset: preset ?? "custom", desde, hasta };
    return rangoDePreset(porDefecto, null) ?? rangoDePreset("mes", null)!;
  }, [params, porDefecto]);

  const setRango = useCallback((r: RangoFechas) => {
    const q = new URLSearchParams(params.toString());
    q.set("periodo", r.preset);
    q.set("desde", r.desde);
    q.set("hasta", r.hasta);
    /* replace y no push: el filtro de fecha no es un paso de navegacion, y
       llenar el historial obligaria a apretar Atras diez veces para salir. */
    router.replace(`${pathname}?${q.toString()}`, { scroll: false });
  }, [params, pathname, router]);

  return [rango, setRango];
}
