"use client";

import { useCallback, useEffect, useState } from "react";
import { nube } from "./supabase";
import { acciones } from "./store";
import { PASARELAS_A_PEDIDO, type EstadoPasarela } from "./pasarelas-estado";
import type { ProveedorPasarela } from "./types";

/* ==================================================================
   El selector de pagos al día (lib/pasarelas-estado.ts).

   Mientras está abierto: trae de la base los cobros que guardaron el
   cron o los webhooks (sin esto se veía la lista de cuando se abrió la
   app), lee cuándo se revisó la pasarela y vuelve a mirar cada 30
   segundos. «Buscar pagos nuevos» le pregunta ahora a la pasarela
   (api/pasarelas/al-dia) y después vuelve a traer los cobros.
   ================================================================== */

export interface RespuestaAlDia { ok: boolean; nuevos: number; reciente?: boolean; error?: string }

const CADA_MS = 30_000;

export function usePasarelaAlDia(proveedor: ProveedorPasarela | undefined, abierto: boolean) {
  const [estado, setEstado] = useState<EstadoPasarela | null>(null);
  const [buscando, setBuscando] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  const sePuedeBuscar = Boolean(nube && proveedor && PASARELAS_A_PEDIDO.includes(proveedor));

  const leerEstado = useCallback(async () => {
    if (!nube || !proveedor) { setEstado(null); return; }
    const r = await nube.from("pasarelas_estado").select("*").eq("proveedor", proveedor).maybeSingle();
    /* Sin la tabla todavía o sin permiso, no se dice nada (el selector vuelve a mostrar sólo el último cobro). */
    setEstado(r.error ? null : ((r.data ?? null) as EstadoPasarela | null));
    setAhora(Date.now());
  }, [proveedor]);

  useEffect(() => {
    if (!abierto) return;
    void acciones.traerMovimientos();
    void leerEstado();
    const t = window.setInterval(() => {
      setAhora(Date.now());
      if (document.visibilityState !== "visible") return;
      void acciones.traerMovimientos();
      void leerEstado();
    }, CADA_MS);
    return () => window.clearInterval(t);
  }, [abierto, leerEstado]);

  const buscar = useCallback(async (): Promise<RespuestaAlDia> => {
    if (!nube || !proveedor) return { ok: false, nuevos: 0, error: "No hay conexión con la base." };
    setBuscando(true);
    try {
      const sesion = (await nube.auth.getSession()).data.session;
      const r = await fetch("/api/pasarelas/al-dia", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(sesion ? { Authorization: `Bearer ${sesion.access_token}` } : {}) },
        body: JSON.stringify({ proveedor }),
      });
      const data = (await r.json().catch(() => ({}))) as RespuestaAlDia & { estado?: EstadoPasarela | null };
      if (!r.ok) return { ok: false, nuevos: 0, error: data.error ?? "No se pudo revisar la pasarela." };
      if (data.estado) setEstado(data.estado);
      setAhora(Date.now());
      await acciones.traerMovimientos();
      return { ok: data.ok, nuevos: data.nuevos ?? 0, reciente: data.reciente, error: data.error };
    } catch (err) {
      return { ok: false, nuevos: 0, error: err instanceof Error ? err.message : "No se pudo revisar la pasarela." };
    } finally {
      setBuscando(false);
    }
  }, [proveedor]);

  return { estado, ahora, buscando, buscar, sePuedeBuscar };
}
