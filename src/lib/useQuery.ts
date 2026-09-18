"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* Lee ?nuevo=1 y ?ver=<id> para abrir modales desde enlaces.

   El objeto que devuelve es estable: si cambiara de identidad en cada
   render, el useEffect de cada página se dispararía siempre y algunas
   entrarían en bucle. */
export function useAbrirDesdeURL(): { nuevo: boolean; ver: string | null; limpiar: () => void } {
  const params = useSearchParams();
  const router = useRouter();
  const [estado, setEstado] = useState<{ nuevo: boolean; ver: string | null }>({ nuevo: false, ver: null });
  const consumido = useRef(false);

  useEffect(() => {
    if (consumido.current) return;
    const nuevo = params.get("nuevo") === "1";
    const ver = params.get("ver");
    if (nuevo || ver) { consumido.current = true; setEstado({ nuevo, ver }); }
  }, [params]);

  const limpiar = useCallback(() => {
    setEstado({ nuevo: false, ver: null });
    if (typeof window !== "undefined" && window.location.search) {
      router.replace(window.location.pathname);
    }
  }, [router]);

  return useMemo(
    () => ({ nuevo: estado.nuevo, ver: estado.ver, limpiar }),
    [estado.nuevo, estado.ver, limpiar],
  );
}
