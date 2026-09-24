"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useEscribirURL } from "@/lib/useParamsURL";

/* Lee ?nuevo=1 y ?ver=<id> para abrir modales desde enlaces.

   El objeto que devuelve es estable: si cambiara de identidad en cada
   render, el useEffect de cada página se dispararía siempre y algunas
   entrarían en bucle. */
export function useAbrirDesdeURL(): { nuevo: boolean; ver: string | null; limpiar: () => void } {
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const [estado, setEstado] = useState<{ nuevo: boolean; ver: string | null }>({ nuevo: false, ver: null });
  const consumido = useRef(false);

  useEffect(() => {
    if (consumido.current) return;
    const nuevo = params.get("nuevo") === "1";
    const ver = params.get("ver");
    if (nuevo || ver) { consumido.current = true; setEstado({ nuevo, ver }); }
  }, [params]);

  /* Saca sólo ?nuevo y ?ver, que son de un solo uso. Antes borraba la query
     entera, y con ella los filtros, el orden y el período que ahora viven en
     la URL: abrir "Nueva venta" desde un link te dejaba el reporte pelado.
     `escribir` es estable (lee la URL al llamarlo), así que `limpiar`
     también, y el objeto de arriba no cambia por esto. */
  const limpiar = useCallback(() => {
    setEstado({ nuevo: false, ver: null });
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    if (q.has("nuevo") || q.has("ver")) escribir({ nuevo: null, ver: null });
  }, [escribir]);

  return useMemo(
    () => ({ nuevo: estado.nuevo, ver: estado.ver, limpiar }),
    [estado.nuevo, estado.ver, limpiar],
  );
}
