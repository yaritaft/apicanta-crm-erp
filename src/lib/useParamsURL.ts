"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

/* ==================================================================
   Lo que se está mirando vive en la URL.

   Lo pidió Yari: armar un reporte una vez y después entrar con un clic
   desde favoritos, o mandarle el link a otro y que lo vea TAL CUAL, sin
   que tenga que volver a tocar cada filtro. Filtros, orden, página y
   vista van en la query; lo que no es parte del reporte (un borrador, un
   modal abierto) sigue en el estado de React.

   Las reglas, para que los links queden cortos y no se pisen entre sí:
   - Un parámetro igual a su valor por defecto no se escribe: se borra.
   - Se escribe con replace y no con push: cambiar un filtro no es navegar,
     y Atrás tiene que sacar de la pantalla, no deshacer clics.
   - Se tocan sólo las claves que cambian. El resto de la query — el
     período, la ficha abierta, lo que puso otra pantalla — queda igual.
   ================================================================== */

export type CambiosURL = Record<string, string | null | undefined>;

/* Lo que se pidió en el mismo tick se escribe en UNA sola navegación. Sin
   esto, dos llamadas seguidas (el período y volver a la página 1, por
   ejemplo) partirían de la misma URL y la segunda borraría lo que escribió
   la primera: router.replace no cambia la URL en el acto, recién cuando
   termina la navegación. */
let tanda: URLSearchParams | null = null;

/* Escribe varios parámetros de una vez y deja el resto como está. Un valor
   vacío o null borra el parámetro. La función es estable (sólo depende del
   router): lee la URL recién al llamarla, así se puede usar desde un efecto
   o un timer sin que cambie en cada render. */
export function useEscribirURL(): (cambios: CambiosURL) => void {
  const router = useRouter();
  return useCallback((cambios: CambiosURL) => {
    if (typeof window === "undefined") return;
    let q = tanda;
    if (!q) {
      const nueva = new URLSearchParams(window.location.search);
      const ruta = window.location.pathname;
      tanda = q = nueva;
      queueMicrotask(() => {
        tanda = null;
        const s = nueva.toString();
        router.replace(s ? `${ruta}?${s}` : ruta, { scroll: false });
      });
    }
    for (const [k, v] of Object.entries(cambios)) {
      if (v) q.set(k, v); else q.delete(k);
    }
  }, [router]);
}

/* Varios parámetros con su valor por defecto. Devuelve los valores (el de
   la URL, o el por defecto si no está) y una función para cambiar varios
   juntos; `otros` suma claves que no son de esta pantalla, como el período
   o la búsqueda al limpiar todo. */
export function useParamsURL<T extends Record<string, string>>(porDefecto: T): [
  Record<keyof T & string, string>,
  (cambios: Partial<Record<keyof T & string, string | null>>, otros?: CambiosURL) => void,
] {
  const params = useSearchParams();
  const escribir = useEscribirURL();
  /* Por valor y no por identidad: así se puede pasar un objeto literal sin
     que los valores se recalculen en cada render. */
  const clave = JSON.stringify(porDefecto);

  const valores = useMemo(() => {
    const d = JSON.parse(clave) as Record<string, string>;
    const out: Record<string, string> = {};
    for (const k of Object.keys(d)) out[k] = params.get(k) ?? d[k];
    return out as Record<keyof T & string, string>;
  }, [params, clave]);

  const cambiar = useCallback((cambios: Partial<Record<keyof T & string, string | null>>, otros: CambiosURL = {}) => {
    const d = JSON.parse(clave) as Record<string, string>;
    const salida: CambiosURL = { ...otros };
    for (const [k, v] of Object.entries(cambios) as [string, string | null | undefined][]) {
      salida[k] = v === null || v === undefined || v === d[k] ? null : v;
    }
    escribir(salida);
  }, [clave, escribir]);

  return [valores, cambiar];
}

/* Una búsqueda de texto en la URL (?q=). El cuadro responde al instante con
   su propio estado y la URL se escribe cuando se deja de tipear: una
   navegación por tecla trabaría el cuadro y pediría la página diez veces.

   Si la URL cambia DESDE AFUERA (Limpiar filtros, el menú, un link), el
   cuadro la sigue. Si lo que llega es el eco de lo que se tipeó, no: para
   entonces pudo haberse seguido escribiendo, y volver al texto viejo se
   comería las últimas letras. `reinicia` son los parámetros que se borran
   al buscar, como la página: buscar arranca desde la primera. */
const ESPERA_BUSQUEDA = 300;

export function useBusquedaURL(clave = "q", reinicia: readonly string[] = []): [string, (texto: string) => void] {
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const enURL = params.get(clave) ?? "";
  const [texto, setTexto] = useState(enURL);
  /* Lo que ya se mandó a la URL y todavía puede estar por llegar. */
  const enviados = useRef<string[]>([]);
  const aReiniciar = reinicia.join(",");

  useEffect(() => {
    const i = enviados.current.indexOf(enURL);
    if (i >= 0) { enviados.current = enviados.current.slice(i + 1); return; }
    enviados.current = [];
    setTexto(enURL);
  }, [enURL]);

  useEffect(() => {
    const destino = texto.trim();
    const pedido = enviados.current;
    if (destino === (pedido.length ? pedido[pedido.length - 1] : enURL)) return;
    const t = window.setTimeout(() => {
      enviados.current.push(destino);
      const cambios: CambiosURL = { [clave]: destino || null };
      for (const k of aReiniciar.split(",").filter(Boolean)) cambios[k] = null;
      escribir(cambios);
    }, ESPERA_BUSQUEDA);
    return () => window.clearTimeout(t);
  }, [texto, enURL, clave, aReiniciar, escribir]);

  return [texto, setTexto];
}

/* ---------- Orden y página de una tabla, en la URL ---------- */

export interface OrdenTabla { clave: string; desc: boolean }

/* "-fecha" es por fecha de la más nueva a la más vieja; "precio", del más
   barato al más caro. Un solo parámetro y se lee de un vistazo. */
export const ordenAURL = (o: OrdenTabla) => `${o.desc ? "-" : ""}${o.clave}`;

/* Una columna que no existe (un link viejo, uno escrito a mano) vuelve al
   orden de siempre en vez de dejar la tabla sin ordenar. */
export function ordenDeURL(valor: string, validas: readonly string[], porDefecto: OrdenTabla): OrdenTabla {
  const desc = valor.startsWith("-");
  const clave = desc ? valor.slice(1) : valor;
  return validas.includes(clave) ? { clave, desc } : porDefecto;
}

/* La página va contada desde 1, como se lee. */
export function paginaDeURL(valor: string): number {
  const n = Number.parseInt(valor, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
