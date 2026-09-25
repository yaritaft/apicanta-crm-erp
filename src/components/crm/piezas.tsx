"use client";

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AtSign, Calendar, Check, CircleChevronDown, Link, List, Phone, TextAlignStart, X, Zap,
} from "lucide-react";
import { estiloColor, type TipoCampo } from "@/lib/crm";
import type { ColorCrm } from "@/lib/types";

/* ==================================================================
   Las piezas chicas del CRM: la etiqueta de color, el ícono de cada
   tipo de campo (los de Airtable), el rayito de lo que llega solo de la
   agenda y el menú flotante que usan la barra y la grilla.
   ================================================================== */

export function Chip({ texto, color, onQuitar, grande }: {
  texto: string; color: ColorCrm; onQuitar?: () => void; grande?: boolean;
}) {
  const c = estiloColor(color);
  return (
    <span
      className={`crm-chip${c.suave ? " crm-chip--suave" : ""}${grande ? " crm-chip--grande" : ""}`}
      style={{ "--c": c.fondo, "--t": c.texto } as React.CSSProperties}
      title={texto}
    >
      <span className="crm-chip__txt">{texto}</span>
      {onQuitar && (
        <button
          type="button" className="crm-chip__x" aria-label={`Quitar ${texto}`}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={(ev) => { ev.stopPropagation(); onQuitar(); }}
        >
          <X size={12} />
        </button>
      )}
    </span>
  );
}

/* La «A» del texto de una línea y la «fx» de las fórmulas no están en
   lucide: van dibujadas como en Airtable. */
function IconoTexto() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.6 12.8 8 3.2l4.4 9.6M5.3 9.3h5.4" />
    </svg>
  );
}

function IconoFormula() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8.2 3.1c-1.5-.4-2.4.3-2.7 1.8L4.3 12.2c-.3 1.4-1.1 1.9-2.3 1.5M3.8 6.6h4" />
      <path d="m9.6 7.6 3.8 4.8M13.4 7.6l-3.8 4.8" />
    </svg>
  );
}

export function IconoCampo({ tipo, size = 16 }: { tipo: TipoCampo; size?: number }) {
  const p = { size, strokeWidth: 1.6, "aria-hidden": true } as const;
  switch (tipo) {
    case "texto": return <IconoTexto />;
    case "texto-largo": return <TextAlignStart {...p} />;
    case "seleccion": return <CircleChevronDown {...p} />;
    case "multiple": return <List {...p} />;
    case "url": return <Link {...p} />;
    case "fecha": return <Calendar {...p} />;
    case "email": return <AtSign {...p} />;
    case "telefono": return <Phone {...p} />;
    case "formula": return <IconoFormula />;
  }
}

/* Lo que se llena solo desde la agenda de Calendly. */
export function MarcaAuto({ titulo = "Se llena sola con la agenda de Calendly" }: { titulo?: string }) {
  return (
    <span className="crm-auto" title={titulo} aria-label={titulo}>
      <Zap size={11} fill="currentColor" strokeWidth={0} aria-hidden />
    </span>
  );
}

export function Casilla({ marcada, onCambiar, etiqueta, mixta }: {
  marcada: boolean; onCambiar: (v: boolean) => void; etiqueta: string; mixta?: boolean;
}) {
  return (
    <button
      type="button" role="checkbox" aria-checked={mixta ? "mixed" : marcada} aria-label={etiqueta}
      className={`crm-casilla${marcada || mixta ? " crm-casilla--on" : ""}`}
      onMouseDown={(ev) => ev.stopPropagation()}
      onClick={(ev) => { ev.stopPropagation(); onCambiar(!marcada); }}
    >
      {marcada && <Check size={12} strokeWidth={3} aria-hidden />}
      {mixta && !marcada && <span className="crm-casilla__raya" aria-hidden />}
    </button>
  );
}

/* ---------- El menú flotante ----------
   Se dibuja en el body (así no lo recorta el scroll de la grilla), pegado
   al elemento que lo abre: abajo y alineado a su izquierda, o a su derecha
   si no entra. Se cierra con Esc, con un clic afuera o si se achica la
   ventana. */

export function Flotante({
  ancla, onCerrar, children, className, alinear = "izquierda", ancho, arriba = 4, cubrir,
}: {
  ancla: HTMLElement | null;
  onCerrar: () => void;
  children: React.ReactNode;
  className?: string;
  alinear?: "izquierda" | "derecha";
  ancho?: number;
  arriba?: number;
  /* Encima del ancla en vez de abajo: el editor de una celda la tapa. */
  cubrir?: boolean;
}) {
  const caja = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; maxH: number } | null>(null);
  const cerrar = useRef(onCerrar);
  cerrar.current = onCerrar;

  useLayoutEffect(() => {
    if (!ancla) return;
    const ubicar = () => {
      /* El ancla se fue de la pantalla (la fila se scrolleó lejos y la
         grilla dejó de dibujarla): el menú se cierra en vez de quedar suelto. */
      if (!ancla.isConnected) { cerrar.current(); return; }
      const r = ancla.getBoundingClientRect();
      const w = caja.current?.offsetWidth ?? ancho ?? 280;
      const h = caja.current?.offsetHeight ?? 200;
      let left = alinear === "derecha" ? r.right - w : r.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      let top = cubrir ? r.top : r.bottom + arriba;
      const abajo = window.innerHeight - top - 8;
      /* Si abajo no entra y arriba sí, se abre para arriba. */
      if (!cubrir && h > abajo && r.top - arriba - h > 8) top = r.top - arriba - h;
      if (cubrir && top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - h);
      setPos({ top, left, maxH: Math.max(160, window.innerHeight - top - 8) });
    };
    ubicar();
    const obs = new ResizeObserver(ubicar);
    if (caja.current) obs.observe(caja.current);
    /* Sigue al ancla si se scrollea lo que la contiene (la grilla). */
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => { obs.disconnect(); window.removeEventListener("resize", ubicar); window.removeEventListener("scroll", ubicar, true); };
  }, [ancla, alinear, ancho, arriba, cubrir]);

  useEffect(() => {
    const fuera = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (caja.current?.contains(t) || ancla?.contains(t)) return;
      /* Un menú abierto desde éste (el color de una opción) vive en otro
         portal: no cuenta como afuera. */
      if ((t as HTMLElement).closest?.("[data-crm-flotante]")) return;
      cerrar.current();
    };
    /* En captura: el Esc cierra el menú y nada más (ni la ficha de abajo,
       ni la selección de la grilla). */
    const esc = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape") return;
      ev.stopPropagation();
      cerrar.current();
    };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc, true); };
  }, [ancla]);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={caja}
      data-crm-flotante
      className={`crm-pop${className ? ` ${className}` : ""}`}
      style={{
        position: "fixed", top: pos?.top ?? -9999, left: pos?.left ?? -9999,
        /* Transparente (no oculto) hasta ubicarse: así el campo de adentro
           ya puede tomar el foco al montarse. */
        width: ancho, maxHeight: pos?.maxH, opacity: pos ? 1 : 0,
      }}
      onMouseDown={(ev) => ev.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

/* Un botón que abre un Flotante y guarda dónde está. */
export function useAncla<T extends HTMLElement = HTMLButtonElement>() {
  const ref = useRef<T>(null);
  const [abierto, setAbierto] = useState(false);
  return { ref, abierto, abrir: () => setAbierto(true), cerrar: () => setAbierto(false), alternar: () => setAbierto((v) => !v) };
}
