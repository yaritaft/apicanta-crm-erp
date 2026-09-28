"use client";

/* Configurador de columnas, como el del Ads Manager: se prenden y apagan
   métricas y se arrastran para cambiar el orden.

   La configuración vive en localStorage y no en la base: es una preferencia
   de quien mira, no un dato del negocio. Si se guardara en `ajustes`, Yari
   moviendo una columna se la movería a todo el equipo.

   Un link copiado sí las lleva (?cols-<tabla>, lib/compartirLink): quien lo
   abre ve las columnas de quien lo mandó hasta que toque alguna, y ahí
   pasan a ser las suyas. */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Columns3, GripVertical, RotateCcw, X } from "lucide-react";
import { aLista, deLista, useAporteAlLink } from "@/lib/compartirLink";
import { useEscribirURL } from "@/lib/useParamsURL";

export interface DefColumna {
  clave: string;
  titulo: string;
  /* Identifica la fila: no se apaga ni se mueve, siempre va primera. */
  fija?: boolean;
  /* Agrupa el listado del popover. Sin grupo cae en "Otras". */
  grupo?: string;
  /* Se explica en el popover, para no tener que adivinar qué mide. */
  ayuda?: string;
}

const clave = (tabla: string) => `apicanta:columnas:${tabla}`;

export function useColumnas(tabla: string, todas: DefColumna[], porDefecto: string[]) {
  const fijas = useMemo(() => todas.filter((c) => c.fija).map((c) => c.clave), [todas]);
  const [orden, setOrden] = useState<string[]>(porDefecto);

  /* Se lee después del montado: leer localStorage en el primer render rompe
     la hidratación, porque el servidor no lo tiene. */
  useEffect(() => {
    try {
      const guardado = localStorage.getItem(clave(tabla));
      if (!guardado) return;
      const leido = JSON.parse(guardado) as string[];
      /* Se filtra contra `todas` a propósito: si una versión vieja guardó una
         columna que ya no existe, ignorarla es mejor que romper la tabla. */
      const validas = leido.filter((k) => todas.some((c) => c.clave === k));
      if (validas.length) setOrden(validas);
    } catch { /* modo privado, o JSON de una versión anterior */ }
  }, [tabla, todas]);

  /* Las columnas que trae un link copiado, si trae. */
  const params = useSearchParams();
  const escribirURL = useEscribirURL();
  const enURL = `cols-${tabla}`;
  const delLinkCrudo = params.get(enURL);
  const delLink = useMemo(() => {
    const ks = deLista(delLinkCrudo)?.filter((k) => todas.some((c) => c.clave === k)) ?? [];
    return ks.length ? ks : null;
  }, [delLinkCrudo, todas]);
  const actual = delLink ?? orden;

  /* Tocar una columna la hace propia: se guarda y el link deja de mandar. */
  const guardar = useCallback((nuevo: string[]) => {
    setOrden(nuevo);
    try { localStorage.setItem(clave(tabla), JSON.stringify(nuevo)); } catch { /* modo privado */ }
    if (delLinkCrudo !== null) escribirURL({ [enURL]: null });
  }, [tabla, delLinkCrudo, enURL, escribirURL]);

  const alternar = useCallback((k: string) => {
    if (fijas.includes(k)) return;
    guardar(actual.includes(k) ? actual.filter((x) => x !== k) : [...actual, k]);
  }, [actual, fijas, guardar]);

  const mover = useCallback((desde: string, hasta: string) => {
    if (desde === hasta || fijas.includes(desde)) return;
    const sin = actual.filter((k) => k !== desde);
    const i = sin.indexOf(hasta);
    guardar([...sin.slice(0, i), desde, ...sin.slice(i)]);
  }, [actual, fijas, guardar]);

  const restaurar = useCallback(() => {
    try { localStorage.removeItem(clave(tabla)); } catch { /* modo privado */ }
    setOrden(porDefecto);
    if (delLinkCrudo !== null) escribirURL({ [enURL]: null });
  }, [tabla, porDefecto, delLinkCrudo, enURL, escribirURL]);

  /* Las fijas van siempre adelante, existan o no en lo guardado. */
  const visibles = useMemo(
    () => [...fijas, ...actual.filter((k) => !fijas.includes(k))],
    [fijas, actual],
  );

  useAporteAlLink(() => ({ [enURL]: aLista(visibles.filter((k) => !fijas.includes(k))) }));

  return { visibles, alternar, mover, restaurar, esVisible: (k: string) => visibles.includes(k) };
}

export function ConfigColumnas({ todas, visibles, alternar, mover, restaurar, titulo = "Columnas", icono, conCuenta = true }: {
  todas: DefColumna[];
  visibles: string[];
  alternar: (k: string) => void;
  mover: (desde: string, hasta: string) => void;
  restaurar: () => void;
  /* Sirve igual para filas: el Dashboard lo usa con sus métricas. */
  titulo?: string;
  icono?: React.ReactNode;
  conCuenta?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const [arrastrando, setArrastrando] = useState<string | null>(null);
  const [sobre, setSobre] = useState<string | null>(null);
  const raiz = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(ev.target as Node)) setAbierto(false);
    };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierto(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierto]);

  /* Primero las prendidas en su orden — que es el de la tabla y el que se
     arrastra — y después las apagadas, agrupadas. */
  const prendidas = visibles
    .map((k) => todas.find((c) => c.clave === k))
    .filter((c): c is DefColumna => Boolean(c));
  const apagadas = todas.filter((c) => !visibles.includes(c.clave));

  const grupos = apagadas.reduce<Record<string, DefColumna[]>>((acc, c) => {
    const g = c.grupo ?? "Otras";
    (acc[g] ??= []).push(c);
    return acc;
  }, {});

  return (
    <div ref={raiz} style={{ position: "relative" }}>
      <button type="button" className={`dp-pill${abierto ? " dp-pill--open" : ""}`} onClick={() => setAbierto((v) => !v)}>
        {icono ?? <Columns3 size={14} />}
        {conCuenta ? `${titulo} · ${visibles.length}` : titulo}
        <span className="dp-caret">▾</span>
      </button>

      {abierto && (
        <div className="cc-pop">
          <div className="cc-head">
            <strong>{titulo}</strong>
            <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={restaurar}>
              <RotateCcw size={14} />Restaurar
            </button>
          </div>

          <div className="cc-body">
            <div className="cc-grupo">En la tabla · arrastrá para ordenar</div>
            {prendidas.map((c) => (
              <div
                key={c.clave}
                className={`cc-item${sobre === c.clave ? " cc-item--sobre" : ""}${c.fija ? " cc-item--fija" : ""}`}
                draggable={!c.fija}
                onDragStart={() => setArrastrando(c.clave)}
                onDragEnd={() => { setArrastrando(null); setSobre(null); }}
                onDragOver={(ev) => { ev.preventDefault(); if (arrastrando) setSobre(c.clave); }}
                onDrop={() => { if (arrastrando) mover(arrastrando, c.clave); setArrastrando(null); setSobre(null); }}
              >
                <span className="cc-grip">{c.fija ? null : <GripVertical size={14} />}</span>
                <span className="cc-txt" title={c.ayuda}>{c.titulo}</span>
                {c.fija
                  ? <span className="cc-fija">fija</span>
                  : <button type="button" className="cc-quitar" aria-label={`Quitar ${c.titulo}`} onClick={() => alternar(c.clave)}><X size={14} /></button>}
              </div>
            ))}

            {Object.entries(grupos).map(([g, cols]) => (
              <React.Fragment key={g}>
                <div className="cc-grupo">{g}</div>
                {cols.map((c) => (
                  <div key={c.clave} className="cc-item cc-item--off" onClick={() => alternar(c.clave)}>
                    <span className="cc-grip" />
                    <span className="cc-txt" title={c.ayuda}>{c.titulo}</span>
                    <span className="cc-sumar">+</span>
                  </div>
                ))}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
