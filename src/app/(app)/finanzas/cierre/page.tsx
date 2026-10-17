"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* El cierre del mes ahora es la pestaña «Este mes» de Finanzas: este link de antes lleva ahí. */
export default function CierrePagina() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const q = new URLSearchParams({ cad: "mes" });
    for (const k of ["mes", "paso"]) { const x = params.get(k); if (x) q.set(k, x); }
    router.replace(`/finanzas?${q.toString()}`);
  }, [router, params]);
  return null;
}
