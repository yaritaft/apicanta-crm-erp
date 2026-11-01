"use client";

import { useCallback, useEffect, useState } from "react";
import { nube } from "./supabase";
import { traerSaldosReales } from "./saldos-cliente";
import type { RespuestaDeSaldos } from "./saldos-reales";

/* El saldo real de las cuentas que se leen solas, leído una sola vez para toda la Caja: lo usan el Control de saldos y los Saldos, y las
   dos pantallas se actualizan juntas con «Volver a mirar». Se lee al abrir y a pedido. Sin la nube (la app local) no hay a quién preguntarle. */

export interface LecturaDeSaldos {
  cargando: boolean;
  resp?: RespuestaDeSaldos;
  error?: string;
  /* Cuándo se leyó (ISO). */
  cuando?: string;
  leer: () => Promise<void>;
}

export function useSaldosReales(): LecturaDeSaldos {
  const [estado, setEstado] = useState<{ cargando: boolean; resp?: RespuestaDeSaldos; error?: string; cuando?: string }>({ cargando: Boolean(nube) });
  const leer = useCallback(async () => {
    setEstado((x) => ({ ...x, cargando: true, error: undefined }));
    try {
      const resp = await traerSaldosReales();
      setEstado({ cargando: false, resp, cuando: new Date().toISOString() });
    } catch (err) {
      setEstado((x) => ({ ...x, cargando: false, error: err instanceof Error ? err.message : "No se pudieron leer los saldos." }));
    }
  }, []);
  useEffect(() => { if (nube) void leer(); }, [leer]);
  return { ...estado, leer };
}
