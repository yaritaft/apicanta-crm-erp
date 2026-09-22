"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";

/* ==================================================================
   La ficha de una persona vive en la URL: ?ficha=<id>&vista=ventas.

   Así la abre cualquier pantalla (Leads, Pipeline, Ventas, Alumnos,
   Agenda) sin pasar estado de una a otra, el link se puede compartir y
   en el celular el botón Atrás la cierra. `id` puede ser de un contacto,
   un lead, una venta, un alumno o una llamada: persona.ts resuelve a
   quién pertenece.
   ================================================================== */

export type VistaFicha = "ventas" | "servicio";

/* Si la abrimos nosotros con push, cerrarla es volver atrás (el Atrás del
   navegador y la ✕ hacen lo mismo). Si se entró por un link directo, no
   hay a dónde volver: se saca el parámetro y listo. */
let abiertaConPush = false;

export function useAbrirFicha() {
  const router = useRouter();
  return useCallback((id: string, vista: VistaFicha = "ventas", extra?: Record<string, string>) => {
    const url = new URL(window.location.href);
    url.searchParams.set("ficha", id);
    url.searchParams.set("vista", vista);
    url.searchParams.delete("ver");
    for (const [k, v] of Object.entries(extra ?? {})) url.searchParams.set(k, v);
    abiertaConPush = true;
    router.push(url.pathname + url.search, { scroll: false });
  }, [router]);
}

export function useCerrarFicha() {
  const router = useRouter();
  return useCallback(() => {
    if (abiertaConPush) {
      abiertaConPush = false;
      router.back();
      return;
    }
    const url = new URL(window.location.href);
    for (const k of ["ficha", "vista", "venta"]) url.searchParams.delete(k);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);
}

export function useVistaFicha() {
  const router = useRouter();
  return useCallback((vista: VistaFicha) => {
    const url = new URL(window.location.href);
    url.searchParams.set("vista", vista);
    router.replace(url.pathname + url.search, { scroll: false });
  }, [router]);
}
