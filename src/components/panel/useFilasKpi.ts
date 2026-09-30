"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { SECCIONES, type DefKpi } from "@/lib/kpis";
import { aLista, deLista, useAporteAlLink } from "@/lib/compartirLink";
import { usePreferencia } from "@/lib/preferencias";
import { useEscribirURL } from "@/lib/useParamsURL";

/* Qué métricas se ven en el Dashboard y en qué orden. Es el mismo trato que
   las columnas de Leads o Webinars (ColumnasConfig): se prenden, se apagan
   y se arrastran, o se ocultan desde la fila misma.

   Es una preferencia de quien mira, no un dato del negocio: se guarda en su
   usuario (lib/preferencias), así lo sigue a cualquier compu ("que yo, como
   usuario, pueda dejar guardado que se oculten algunas filas", Yari 29/09).
   Se guarda el orden y lo apagado, no lo prendido: así una métrica nueva
   (una categoría de gasto que aparece, una etapa de servicio que se crea)
   se ve sola, al final de su área, en vez de quedar escondida hasta que
   alguien la busque.

   Un link copiado sí lleva las de quien lo mandó (?metricas-ocultas y
   ?metricas-orden, lib/compartirLink): quien lo abre ve esas hasta que
   prenda, apague o mueva alguna, y ahí pasan a ser las suyas. "-" es
   "ninguna oculta". */

/* Antes se guardaba sólo en el navegador, con esta clave: se adopta una vez. */
const CLAVE_VIEJA = "apicanta:kpis:filas";

interface Guardado { orden: string[]; ocultas: string[] }
const VACIO: Guardado = { orden: [], ocultas: [] };

const textos = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string") : null);
function validar(x: unknown): Guardado | null {
  const g = x as Partial<Guardado> | null;
  const orden = textos(g?.orden), ocultas = textos(g?.ocultas);
  return orden && ocultas ? { orden, ocultas } : null;
}

export function useFilasKpi(defs: DefKpi[]) {
  const pref = usePreferencia("dashboard:filas", validar, CLAVE_VIEJA);
  const propio = pref.valor ?? VACIO;
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

  /* Tocar una métrica hace propias las del link: se guardan y el link deja
     de mandar. */
  const { guardar: guardarPref, borrar: borrarPref } = pref;
  const guardar = useCallback((n: Guardado) => {
    guardarPref(n);
    if (delLink) escribirURL({ "metricas-ocultas": null, "metricas-orden": null });
  }, [guardarPref, delLink, escribirURL]);

  /* Lo último que se ve, para lo que se toca después (el «Deshacer» del
     aviso al ocultar una fila): no puede partir de un render viejo. */
  const ultimo = useRef(g);
  useEffect(() => { ultimo.current = g; }, [g]);

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
    const x = ultimo.current;
    guardar({ ...x, ocultas: x.ocultas.includes(id) ? x.ocultas.filter((y) => y !== id) : [...x.ocultas, id] });
  }, [guardar]);

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
    borrarPref();
    if (delLink) escribirURL({ "metricas-ocultas": null, "metricas-orden": null });
  }, [borrarPref, delLink, escribirURL]);

  useAporteAlLink(() => ({
    "metricas-ocultas": aLista(g.ocultas) || "-",
    ...(g.orden.length ? { "metricas-orden": aLista(g.orden) } : {}),
  }));

  return { ordenadas, ocultas, alternar, mover, restaurar };
}
