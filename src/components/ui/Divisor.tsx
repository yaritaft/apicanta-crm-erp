"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/* ==================================================================
   Un divisor que se ARRASTRA entre dos paneles, como el de Blue OS
   (components/ui/Splitter): la línea que separa la ficha del chat del
   equipo se agarra y se desliza para darle más lugar a uno o al otro.

     · El ancho vive en una variable CSS del contenedor (`--chat-w`), escrita
       directo en el DOM: arrastrar no re-dibuja React en cada movimiento y no
       hay diferencias entre el servidor y el navegador al cargar.
     · Se recuerda en este navegador (localStorage); sin preferencia manda el CSS.
     · Doble clic vuelve al ancho original. Con el foco en el divisor, las
       flechas lo mueven de a 16 px y Inicio lo devuelve al original.
     · Anda con mouse, dedo o lápiz (pointer events).
   ================================================================== */

export function useAnchoPanel({ variable, clave, min = 280, minResto = 600, lado = "derecha" }: {
  /* La variable CSS donde se escribe el ancho del panel que se mide. */
  variable: string;
  /* Si viene, el ancho elegido se recuerda con esta clave. */
  clave?: string;
  /* El piso del panel, en px. */
  min?: number;
  /* Lo que como mínimo le queda a lo demás del contenedor. */
  minResto?: number;
  /* De qué lado está el panel que se mide: a la derecha crece arrastrando hacia la izquierda. */
  lado?: "derecha" | "izquierda";
}) {
  const signo = lado === "izquierda" ? 1 : -1;
  const contRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const ultimo = useRef<number | null>(null);
  const [arrastrando, setArrastrando] = useState(false);

  const aplicar = useCallback((n: number | null) => {
    ultimo.current = n;
    const cont = contRef.current;
    if (!cont) return;
    if (n === null) cont.style.removeProperty(variable);
    else cont.style.setProperty(variable, `${Math.round(n)}px`);
  }, [variable]);

  const acotar = useCallback((n: number) => {
    const total = contRef.current?.offsetWidth ?? window.innerWidth;
    return Math.max(min, Math.min(Math.max(min, total - minResto), n));
  }, [min, minResto]);

  const guardar = useCallback(() => {
    if (!clave) return;
    try {
      if (ultimo.current === null) window.localStorage.removeItem(clave);
      else window.localStorage.setItem(clave, String(Math.round(ultimo.current)));
    } catch { /* modo privado: no se recuerda, nada más */ }
  }, [clave]);

  /* El ancho guardado se aplica después de montar. */
  useEffect(() => {
    if (!clave) return;
    try {
      const g = Number(window.localStorage.getItem(clave));
      if (Number.isFinite(g) && g >= min) aplicar(acotar(g));
    } catch { /* sin preferencia: manda el CSS */ }
  }, [clave, min, aplicar, acotar]);

  const empezar = useCallback((ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const desde = ev.clientX;
    const anchoInicial = panelRef.current?.offsetWidth ?? ultimo.current ?? min;
    setArrastrando(true);
    const antes = { sel: document.body.style.userSelect, cursor: document.body.style.cursor };
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    const mover = (e: PointerEvent) => aplicar(acotar(anchoInicial + signo * (e.clientX - desde)));
    const soltar = () => {
      document.removeEventListener("pointermove", mover);
      document.removeEventListener("pointerup", soltar);
      document.removeEventListener("pointercancel", soltar);
      document.body.style.userSelect = antes.sel;
      document.body.style.cursor = antes.cursor;
      setArrastrando(false);
      guardar();
    };
    document.addEventListener("pointermove", mover);
    document.addEventListener("pointerup", soltar);
    document.addEventListener("pointercancel", soltar);
  }, [min, signo, aplicar, acotar, guardar]);

  const teclas = useCallback((ev: React.KeyboardEvent) => {
    const base = panelRef.current?.offsetWidth ?? ultimo.current ?? min;
    if (ev.key === "ArrowLeft") { ev.preventDefault(); aplicar(acotar(base - signo * 16)); guardar(); }
    if (ev.key === "ArrowRight") { ev.preventDefault(); aplicar(acotar(base + signo * 16)); guardar(); }
    if (ev.key === "Home") { ev.preventDefault(); aplicar(null); guardar(); }
  }, [min, signo, aplicar, acotar, guardar]);

  const reiniciar = useCallback(() => { aplicar(null); guardar(); }, [aplicar, guardar]);

  return { contRef, panelRef, arrastrando, empezar, teclas, reiniciar };
}

/* El tirador: una franja invisible sobre el borde, que se marca al pasar, al arrastrar o con el foco. */
export function Divisor({ empezar, teclas, reiniciar, arrastrando, etiqueta, className }: {
  empezar: (ev: React.PointerEvent) => void;
  teclas: (ev: React.KeyboardEvent) => void;
  reiniciar: () => void;
  arrastrando: boolean;
  etiqueta: string;
  className?: string;
}) {
  return (
    <span
      role="separator" aria-orientation="vertical" aria-label={etiqueta} tabIndex={0}
      onPointerDown={empezar} onKeyDown={teclas} onDoubleClick={reiniciar}
      title="Arrastrá para cambiar el ancho · doble clic para volver al original"
      data-arrastrando={arrastrando ? "true" : undefined}
      className={`divisor${className ? ` ${className}` : ""}`}
    />
  );
}
