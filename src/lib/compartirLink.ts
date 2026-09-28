"use client";

import { useEffect, useRef } from "react";

/* ==================================================================
   Lo que un link copiado lleva además de la URL.

   Qué columnas ve cada uno, qué métricas del Dashboard y cómo armó su
   vista del CRM son preferencias de quien mira: viven en su navegador y
   no llenan la URL mientras trabaja. Pero un link copiado tiene que abrir
   lo mismo que se está viendo, con el mismo filtro y todo. Al copiar,
   cada pantalla suma acá lo suyo; quien abre el link lo ve así hasta que
   cambie algo, y ahí pasa a ser suyo.
   ================================================================== */

type Aporte = () => Record<string, string>;

const aportes = new Map<number, { current: Aporte }>();
let proximo = 0;

/* Mientras el componente está en pantalla, su aporte entra en el link. */
export function useAporteAlLink(aporte: Aporte): void {
  const ref = useRef(aporte);
  useEffect(() => { ref.current = aporte; });
  useEffect(() => {
    const id = ++proximo;
    aportes.set(id, ref);
    return () => { aportes.delete(id); };
  }, []);
}

export function aportesAlLink(): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const r of aportes.values()) Object.assign(salida, r.current());
  return salida;
}

/* Las listas van separadas por coma: claves de columnas y de métricas. */
export const aLista = (xs: readonly string[]) => xs.join(",");
export const deLista = (s: string | null): string[] | null => (s === null ? null : s.split(",").filter(Boolean));
