"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowRightLeft, Check } from "lucide-react";
import { Badge, type VarianteBadge } from "@/components/ui/ui";
import type { EstadoAlumno, EtapaServicio } from "@/lib/types";

/* Piezas que comparten las pantallas de alumnos: la lista, el pipeline de
   servicio, el asistente de alta y las etapas en Ajustes. */

export const ESTADO_ALUMNO: Record<EstadoAlumno, { texto: string; variante: "success" | "warning" | "brand" | "neutral" }> = {
  "activo": { texto: "Activo", variante: "success" },
  "pausado": { texto: "Pausado", variante: "warning" },
  "graduado": { texto: "Graduado", variante: "brand" },
  "baja": { texto: "Baja", variante: "neutral" },
};

export const ESTADOS_ALUMNO = Object.keys(ESTADO_ALUMNO) as EstadoAlumno[];

/* Los colores de una etapa son las variantes del Badge: el punto de la
   columna y el cartelito de la ficha salen del mismo token. */
export const COLOR_ETAPA: Record<VarianteBadge, string> = {
  info: "var(--info)", brand: "var(--brand)", accent: "var(--accent)", warning: "var(--warning)",
  success: "var(--success)", danger: "var(--danger)", neutral: "var(--ink-subtle)",
};

/* Los mismos nombres que usa el selector de color de las etapas de ventas. */
export const NOMBRE_COLOR: Record<VarianteBadge, string> = {
  info: "Violeta claro", brand: "Violeta", accent: "Naranja", warning: "Amarillo",
  success: "Verde", danger: "Rojo", neutral: "Gris",
};

export const COLORES_ETAPA = Object.keys(NOMBRE_COLOR) as VarianteBadge[];

export function PuntoEtapa({ color }: { color: VarianteBadge }) {
  return <span className="etapa-punto" style={{ background: COLOR_ETAPA[color] }} aria-hidden />;
}

export function BadgeEtapa({ etapa }: { etapa?: EtapaServicio }) {
  if (!etapa) return <span className="t-subtle">—</span>;
  return <Badge variante={etapa.color}>{etapa.nombre}</Badge>;
}

/* "Empezó hace 3 meses" / "Empieza en 4 días", a partir de `relativo`. */
export function cuandoEmpezo(relativo: string): string {
  if (relativo === "—") return "Sin fecha de inicio";
  if (relativo === "recién") return "Empezó hoy";
  if (relativo === "mañana" || relativo.startsWith("en ")) return `Empieza ${relativo}`;
  return `Empezó ${relativo}`;
}

/* ------------------------------------------------------------------
   "Mover a…": el menú de cada tarjeta del pipeline.

   Arrastrar no sirve en un teléfono ni con teclado, así que cada tarjeta
   lleva este botón. El menú se dibuja fijo sobre la pantalla (en un portal):
   adentro de la columna, que scrollea, quedaría recortado. Flechas arriba y
   abajo recorren las etapas, Enter elige, Esc vuelve al botón.
------------------------------------------------------------------- */

export function MoverA({ etapas, actual, nombre, onElegir }: {
  etapas: EtapaServicio[];
  actual?: string;
  nombre: string;
  onElegir: (etapaId: string) => void;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const abierto = pos !== null;

  const cerrar = useCallback((devolverFoco: boolean) => {
    setPos(null);
    if (devolverFoco) boton.current?.focus();
  }, []);

  function abrir() {
    const r = boton.current?.getBoundingClientRect();
    if (!r) return;
    const ancho = 232;
    const alto = 44 + etapas.length * 36;
    const left = Math.max(8, Math.min(r.right - ancho, window.innerWidth - ancho - 8));
    const entraAbajo = r.bottom + 6 + alto <= window.innerHeight - 8;
    setPos({ left, top: entraAbajo ? r.bottom + 6 : Math.max(8, r.top - 6 - alto) });
  }

  useEffect(() => {
    if (!abierto) return;
    const t = window.setTimeout(() => {
      const elegido = menu.current?.querySelector<HTMLElement>('[aria-checked="true"]');
      (elegido ?? menu.current?.querySelector<HTMLElement>("[role=menuitemradio]"))?.focus();
    }, 0);
    const fuera = (ev: MouseEvent) => {
      const donde = ev.target as Node;
      if (menu.current?.contains(donde) || boton.current?.contains(donde)) return;
      cerrar(false);
    };
    /* Está fijo en la pantalla: si la columna o la página scrollean, quedaría
       flotando lejos de su tarjeta. Se cierra. */
    const alScroll = (ev: Event) => { if (!menu.current?.contains(ev.target as Node)) cerrar(false); };
    const alCambiarTamano = () => cerrar(false);
    document.addEventListener("mousedown", fuera);
    window.addEventListener("scroll", alScroll, true);
    window.addEventListener("resize", alCambiarTamano);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("scroll", alScroll, true);
      window.removeEventListener("resize", alCambiarTamano);
    };
  }, [abierto, cerrar]);

  function onTecla(ev: React.KeyboardEvent) {
    /* Las teclas del menú son del menú: no tienen que llegar a la tarjeta,
       que con las flechas mueve al alumno de columna. */
    ev.stopPropagation();
    const items = [...(menu.current?.querySelectorAll<HTMLElement>("[role=menuitemradio]") ?? [])];
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (ev.key === "ArrowDown") { ev.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (ev.key === "Home") { ev.preventDefault(); items[0].focus(); }
    else if (ev.key === "End") { ev.preventDefault(); items[items.length - 1].focus(); }
    else if (ev.key === "Escape") { ev.preventDefault(); cerrar(true); }
    else if (ev.key === "Tab") { cerrar(false); }
  }

  return (
    <>
      <button
        ref={boton} type="button" className="alu-mover"
        aria-haspopup="menu" aria-expanded={abierto}
        aria-label={`Mover a ${nombre} a otra etapa`} title="Mover a otra etapa"
        onClick={(ev) => { ev.stopPropagation(); if (abierto) cerrar(false); else abrir(); }}
        onKeyDown={(ev) => {
          ev.stopPropagation();
          if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); abrir(); }
        }}
      >
        <ArrowRightLeft size={15} />
      </button>
      {pos && createPortal(
        <div
          ref={menu} role="menu" aria-label={`Mover a ${nombre}`} className="alu-menu"
          data-flotante-abierto="" style={{ top: pos.top, left: pos.left }}
          onKeyDown={onTecla} onClick={(ev) => ev.stopPropagation()}
        >
          <div className="alu-menu__titulo">Mover a</div>
          {etapas.map((et) => (
            <button
              key={et.id} type="button" role="menuitemradio" aria-checked={et.id === actual}
              className="alu-menu__item"
              onClick={() => {
                if (et.id === actual) { cerrar(true); return; }
                /* La tarjeta cambia de columna y este botón deja de existir:
                   el foco lo acomoda quien mueve, no el menú. */
                cerrar(false);
                onElegir(et.id);
              }}
            >
              <PuntoEtapa color={et.color} />
              <span className="truncate" style={{ flex: 1, minWidth: 0 }}>{et.nombre}</span>
              {et.id === actual && <Check size={14} />}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
