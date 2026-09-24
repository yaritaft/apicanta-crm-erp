"use client";

import { useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { PRESETS_DE_LOS_DATOS, rangoDePreset, TZ_NEGOCIO, type RangoFechas } from "@/components/ui/DateRangePicker";
import { useEscribirURL, type CambiosURL } from "@/lib/useParamsURL";

/* El rango de fechas vive en la URL, no en el estado de cada pantalla.

   Dos razones. Una: ir de Finanzas a su detalle y volver conserva el periodo,
   que si viviera en useState se perderia en cada navegacion. La otra la pidio
   Yari: poder mandar un link a un periodo concreto, o dejarlo en favoritos,
   en vez de entrar y seleccionar todo de nuevo cada vez.

   Un preset RELATIVO se guarda solo por su nombre (?periodo=semana) y se
   vuelve a calcular contra hoy al leerlo — "esta semana" guardada el lunes
   debe seguir significando esta semana el viernes, no la del lunes. Las
   fechas se guardan cuando no hay forma de reconstruirlas: un rango elegido
   a mano (?periodo=custom&desde=…&hasta=…), o "Maximo" en una pantalla que
   no sabe donde empiezan sus datos. El preset por defecto no se escribe.

   `futuro` son los presets de la Agenda (manana, la semana que viene, todo
   lo proximo). `limites` son la primera y la ultima fecha con datos: con
   ellos, los presets que dependen de los datos (Maximo, todo lo proximo,
   todo lo pasado) tambien se recalculan, y una venta o una llamada nueva
   nunca queda afuera de un link guardado. */
export function useRangoURL(
  porDefecto = "mes",
  opciones: { futuro?: boolean; limites?: { min: string | null; max: string | null } } = {},
): [RangoFechas, (r: RangoFechas, otros?: CambiosURL) => void] {
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const futuro = opciones.futuro ?? false;
  const conLimites = opciones.limites !== undefined;
  const min = opciones.limites?.min ?? null;
  const max = opciones.limites?.max ?? null;

  /* Un preset que se puede volver a calcular: los relativos siempre, los que
     salen de los datos solo si la pantalla paso sus limites. */
  const recalcular = useCallback((preset: string): RangoFechas | null => {
    if (preset === "custom") return null;
    if (!conLimites && PRESETS_DE_LOS_DATOS.has(preset)) return null;
    return rangoDePreset(preset, min, futuro, TZ_NEGOCIO, max);
  }, [conLimites, min, max, futuro]);

  const rango = useMemo<RangoFechas>(() => {
    const preset = params.get("periodo");
    const desde = params.get("desde");
    const hasta = params.get("hasta");

    if (preset) {
      const r = recalcular(preset);
      if (r) return r;
    }
    /* Fechas escritas a mano en la URL: si no son dias validos, se ignoran. */
    if (desde && hasta && esDia(desde) && esDia(hasta) && desde <= hasta) {
      return { preset: preset ?? "custom", desde, hasta };
    }
    return recalcular(porDefecto) ?? rangoDePreset(porDefecto, null) ?? rangoDePreset("mes", null)!;
  }, [params, porDefecto, recalcular]);

  /* replace y no push (ver useEscribirURL): el filtro de fecha no es un paso
     de navegacion, y llenar el historial obligaria a apretar Atras diez veces
     para salir. `otros` va en la misma escritura, como volver a la primera
     pagina cuando cambia el periodo. */
  const setRango = useCallback((r: RangoFechas, otros: CambiosURL = {}) => {
    const relativo = recalcular(r.preset) !== null;
    escribir({
      ...otros,
      periodo: relativo && r.preset === porDefecto ? null : r.preset,
      desde: relativo ? null : r.desde,
      hasta: relativo ? null : r.hasta,
    });
  }, [escribir, porDefecto, recalcular]);

  return [rango, setRango];
}

const esDia = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);
