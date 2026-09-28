"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { SECCIONES, type DefKpi } from "@/lib/kpis";
import { aLista, deLista, useAporteAlLink } from "@/lib/compartirLink";
import { useEscribirURL } from "@/lib/useParamsURL";

/* Qué métricas se ven en el Dashboard y en qué orden. Es el mismo trato que
   las columnas de Leads o Webinars (ColumnasConfig): se prenden, se apagan
   y se arrastran.

   Se guarda en este navegador y no en la base: es una preferencia de quien
   mira, no un dato del negocio. Se guarda el orden y lo apagado, no lo
   prendido: así una métrica nueva (una categoría de gasto que aparece, una
   etapa de servicio que se crea) se ve sola, al final de su área, en vez de
   quedar escondida hasta que alguien la busque.

   Un link copiado sí lleva las de quien lo mandó (?metricas-ocultas y
   ?metricas-orden, lib/compartirLink): quien lo abre ve esas hasta que
   prenda, apague o mueva alguna, y ahí pasan a ser las suyas. "-" es
   "ninguna oculta". */

const CLAVE = "apicanta:kpis:filas";

interface Guardado { orden: string[]; ocultas: string[] }
const VACIO: Guardado = { orden: [], ocultas: [] };

export function useFilasKpi(defs: DefKpi[]) {
  const [propio, setG] = useState<Guardado>(VACIO);
  const params = useSearchParams();
  const escribirURL = useEscribirURL();
  const ocultasURL = params.get("metricas-ocultas");
  const ordenURL = params.get("metricas-orden");
  const delLink = ocultasURL !== null || ordenURL !== null;
  const g = useMemo<Guardado>(
    () => (delLink
      ? { ocultas: ocultasURL === "-" ? [] : deLista(ocultasURL) ?? [], orden: deLista(ordenURL) ?? [] }
      : propio),
    [delLink, ocultasURL, ordenURL, propio],
  );

  /* Después del montado: en el primer render localStorage no existe. */
  useEffect(() => {
    try {
      const x = JSON.parse(localStorage.getItem(CLAVE) ?? "null");
      if (x && Array.isArray(x.orden) && Array.isArray(x.ocultas)) setG({ orden: x.orden, ocultas: x.ocultas });
    } catch { /* modo privado, o algo que no es JSON */ }
  }, []);

  /* Tocar una métrica hace propias las del link: se guardan y el link deja
     de mandar. */
  const guardar = useCallback((n: Guardado) => {
    setG(n);
    try { localStorage.setItem(CLAVE, JSON.stringify(n)); } catch { /* modo privado */ }
    if (delLink) escribirURL({ "metricas-ocultas": null, "metricas-orden": null });
  }, [delLink, escribirURL]);

  /* El orden de la tabla: primero el área (de TOFU a servicio, eso no se
     mueve) y adentro, el que eligió la persona. Lo que no está guardado va
     después, en el orden del catálogo. */
  const ordenadas = useMemo(() => {
    const pos = new Map(g.orden.map((id, i) => [id, i]));
    const seccion = new Map(SECCIONES.map((s, i) => [s.id, i]));
    return defs
      .map((d, i) => ({ d, s: seccion.get(d.seccion) ?? 0, p: pos.get(d.id) ?? g.orden.length + i }))
      .sort((a, b) => a.s - b.s || a.p - b.p)
      .map((x) => x.d);
  }, [defs, g.orden]);

  const ocultas = useMemo(() => new Set(g.ocultas), [g.ocultas]);

  const alternar = useCallback((id: string) => {
    guardar({ ...g, ocultas: ocultas.has(id) ? g.ocultas.filter((x) => x !== id) : [...g.ocultas, id] });
  }, [g, ocultas, guardar]);

  /* `desde` va a quedar justo antes de `hasta`. Se guarda el orden completo
     de lo que se ve, así el resultado es exactamente lo que se soltó. */
  const mover = useCallback((desde: string, hasta: string) => {
    if (desde === hasta) return;
    const sin = ordenadas.map((d) => d.id).filter((id) => id !== desde);
    const i = sin.indexOf(hasta);
    if (i < 0) return;
    guardar({ ...g, orden: [...sin.slice(0, i), desde, ...sin.slice(i)] });
  }, [ordenadas, g, guardar]);

  const restaurar = useCallback(() => {
    try { localStorage.removeItem(CLAVE); } catch { /* modo privado */ }
    setG(VACIO);
    if (delLink) escribirURL({ "metricas-ocultas": null, "metricas-orden": null });
  }, [delLink, escribirURL]);

  useAporteAlLink(() => ({
    "metricas-ocultas": aLista(g.ocultas) || "-",
    ...(g.orden.length ? { "metricas-orden": aLista(g.orden) } : {}),
  }));

  return { ordenadas, ocultas, alternar, mover, restaurar };
}
