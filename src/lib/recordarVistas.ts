"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { NAV } from "@/components/shell/nav";

/* ==================================================================
   Cada pantalla vuelve como se dejó.

   Los filtros viven en la URL (useParamsURL), así que recargar ya los
   conserva. Esto cubre el resto: entrar desde el menú, abrir la app otro
   día o volver de otra pantalla. Se guarda en este navegador lo último
   que se miró en cada pantalla:
   - El menú lateral lleva directo ahí.
   - Si se entra a una pantalla SIN nada en la URL (la app recién abierta,
     un favorito pelado), se vuelve a eso.
   Un link con filtros manda siempre: se ve tal cual, y pasa a ser lo
   último visto.

   Lo que es de un solo uso no se guarda: la ficha abierta, un asistente
   por abrir, un registro del CRM, la vuelta del login o de conectar Meta.
   Si la URL trae algo de eso tampoco se restaura nada: la pantalla lo está
   usando y cambiarle la URL por abajo se lo pisaría.
   ================================================================== */

const CLAVE = "apicanta.vistas.v1";

const DE_UN_USO = new Set([
  "nuevo", "ver", "editar", "ficha", "vista", "venta", "registro", "persona", "anuncio", "compartida",
  "meta", "code", "error", "error_code", "error_description",
]);

/* Un item del menú puede ser una vista de otra pantalla (/alumnos?seccion=
   pipeline): cada una se recuerda aparte, así «Alumnos» abre la lista y
   «Pipeline de servicio» el pipeline, cada uno con sus filtros. */
const DEL_MENU = new Map<string, string[]>();
for (const item of NAV.flatMap((g) => g.items)) {
  const [ruta, query] = item.href.split("?");
  if (!query) continue;
  const claves = [...new URLSearchParams(query).keys()];
  DEL_MENU.set(ruta, [...new Set([...(DEL_MENU.get(ruta) ?? []), ...claves])]);
}

const claveDe = (ruta: string, q: URLSearchParams) =>
  [ruta, ...(DEL_MENU.get(ruta) ?? []).map((k) => `${k}=${q.get(k) ?? ""}`)].join("|");

function leer(): Record<string, string> {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE) ?? "{}");
    return x && typeof x === "object" ? x : {};
  } catch { return {}; }
}

function escribir(v: Record<string, string>) {
  try { localStorage.setItem(CLAVE, JSON.stringify(v)); } catch { /* modo privado */ }
}

/* Al salir: lo que vio este usuario no queda para el que entre después. */
export function olvidarVistas() {
  try { localStorage.removeItem(CLAVE); } catch { /* modo privado */ }
}

/* El enlace por correo vuelve al inicio de la app, no al link que se estaba
   abriendo: se anota antes de mandarlo y, al entrar, se va ahí. Vale una
   hora; después ya no es "el link que estaba abriendo". */
const CLAVE_DESTINO = "apicanta.volverA";
const VIGENCIA_DESTINO = 60 * 60 * 1000;

export function anotarDestino() {
  try {
    localStorage.setItem(CLAVE_DESTINO, JSON.stringify({ url: location.pathname + location.search, t: Date.now() }));
  } catch { /* modo privado */ }
}

function tomarDestino(): string | null {
  try {
    const x = JSON.parse(localStorage.getItem(CLAVE_DESTINO) ?? "null");
    localStorage.removeItem(CLAVE_DESTINO);
    return x && typeof x.url === "string" && x.url.startsWith("/") && Date.now() - Number(x.t) < VIGENCIA_DESTINO ? x.url : null;
  } catch { return null; }
}

/* Devuelve, para un link del menú, la dirección de lo último que se vio ahí. */
export function useRecordarVistas(): (href: string) => string {
  const ruta = usePathname();
  const params = useSearchParams();
  const router = useRouter();
  const anterior = useRef<string | null>(null);
  const [vistas, setVistas] = useState<Record<string, string>>({});

  useEffect(() => {
    /* La primera vez, si se entró por el enlace del correo: al link que se
       estaba abriendo. */
    if (anterior.current === null) {
      const destino = tomarDestino();
      const aca = params.toString() ? `${ruta}?${params.toString()}` : ruta;
      if (destino && destino !== aca) {
        anterior.current = destino.split("?")[0];
        router.replace(destino, { scroll: false });
        return;
      }
    }

    const q = new URLSearchParams(params.toString());
    const propios = new URLSearchParams();
    for (const [k, v] of q) if (!DE_UN_USO.has(k)) propios.append(k, v);
    const delMenu = DEL_MENU.get(ruta) ?? [];
    const clave = claveDe(ruta, q);
    const guardadas = leer();

    /* Recién se entra a la pantalla y la URL no trae nada propio: vuelve lo
       último. */
    const entro = anterior.current !== ruta;
    anterior.current = ruta;
    const pelada = [...q.keys()].every((k) => delMenu.includes(k));
    if (entro && pelada && guardadas[clave]) {
      const destino = new URLSearchParams(guardadas[clave]);
      for (const [k, v] of q) destino.set(k, v);
      router.replace(`${ruta}?${destino.toString()}`, { scroll: false });
      setVistas(guardadas);
      return;
    }

    /* Una ficha o un asistente abiertos desde un link (?ver=, ?nuevo=) no
       son lo último que se vio de la pantalla: lo guardado queda. */
    const s = propios.toString();
    const soloDeUnUso = !s && [...q.keys()].some((k) => DE_UN_USO.has(k));
    if (!soloDeUnUso) {
      if (s) guardadas[clave] = s;
      else delete guardadas[clave];
      escribir(guardadas);
    }
    setVistas(guardadas);
  }, [ruta, params, router]);

  return useCallback((href: string) => {
    const [r, query = ""] = href.split("?");
    const guardada = vistas[claveDe(r, new URLSearchParams(query))];
    return guardada ? `${r}?${guardada}` : href;
  }, [vistas]);
}
