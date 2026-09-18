"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* Lee ?nuevo=1 y ?ver=<id> para abrir modales desde enlaces y desde
   el botón Crear de la barra superior. Limpia la URL al consumirlos. */
export function useAbrirDesdeURL(): { nuevo: boolean; ver: string | null; limpiar: () => void } {
  const params = useSearchParams();
  const router = useRouter();
  const [estado, setEstado] = useState<{ nuevo: boolean; ver: string | null }>({ nuevo: false, ver: null });

  useEffect(() => {
    const nuevo = params.get("nuevo") === "1";
    const ver = params.get("ver");
    if (nuevo || ver) setEstado({ nuevo, ver });
  }, [params]);

  function limpiar() {
    setEstado({ nuevo: false, ver: null });
    if (typeof window !== "undefined" && window.location.search) {
      router.replace(window.location.pathname);
    }
  }

  return { ...estado, limpiar };
}
