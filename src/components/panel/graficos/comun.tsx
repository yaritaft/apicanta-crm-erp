"use client";

import React from "react";
import { InfoMetrica, type ComponenteMetrica } from "@/components/ui/InfoMetrica";
import { money, num, pct } from "@/lib/format";
import type { ComponenteG, TextoGrafico } from "@/lib/kpis-graficos";
import type { Moneda } from "@/lib/types";

/* Lo que comparten los gráficos del Dashboard: los colores de cada cosa, cómo
   se escriben los números y el ícono «cómo se calcula». Revenue es siempre
   amarillo y Cash Collected (CC) siempre verde, en todos los gráficos. */

export const COLOR_REVENUE = "var(--estrella)";
export const COLOR_CC = "var(--success)";
export const COLOR_UNIDADES = "var(--brand)";
/* El borde de lo amarillo y lo verde: el amarillo claro casi no se ve sobre
   un fondo blanco, así que lleva un borde más oscuro (y más claro en el tema oscuro). */
export const BORDE_REVENUE = "color-mix(in srgb, var(--estrella) 55%, var(--ink))";
export const BORDE_CC = "color-mix(in srgb, var(--success) 60%, var(--ink))";

export type Marca = "circulo" | "rombo" | "cuadrado";

/** Los montos como en toda la app: «US$ 12.400». */
export const formatoPlata = (moneda: Moneda) => (n: number) => money(n, moneda, 0);

/** Para los ejes, donde falta lugar: «US$ 12 mil», «US$ 1,5 M». */
export function plataCorta(n: number, moneda: Moneda): string {
  const a = Math.abs(n);
  const signo = n < 0 ? "−" : "";
  const prefijo = moneda === "USD" ? "US$" : "$";
  if (a >= 1_000_000) return `${signo}${prefijo} ${num(a / 1_000_000, a >= 10_000_000 ? 0 : 1)} M`;
  if (a >= 10_000) return `${signo}${prefijo} ${num(a / 1000, 0)} mil`;
  if (a >= 1000) return `${signo}${prefijo} ${num(a / 1000, 1)} mil`;
  return `${signo}${prefijo} ${num(a, 0)}`;
}

export const formatoPct = (n: number) => pct(n, Math.abs(n) >= 100 ? 0 : 1);

/** Una pieza de «Con tus números», con el valor ya escrito. Con centavos: sumar
 *  a mano lo que muestra la ventana tiene que dar lo mismo que el gráfico. */
export function aComponente(x: ComponenteG, moneda: Moneda): ComponenteMetrica {
  const valor = x.valor === null ? "—"
    : x.formato === "moneda" ? money(x.valor, moneda, 2)
      : x.formato === "pct" ? pct(x.valor, 1)
        : num(x.valor, Number.isInteger(x.valor) ? 0 : 1);
  return { concepto: x.concepto, valor, signo: x.signo, nota: x.nota };
}

/** El ícono ⓘ de un gráfico: qué es, la cuenta escrita y, abierto, los números
 *  del período que se está mirando. */
export function InfoGrafico({ texto, piezas, periodo, moneda, titulo }: {
  texto: TextoGrafico;
  /* Una lista de piezas, o varias secciones (el mapa: una para Revenue y otra para CC). */
  piezas?: () => ComponenteG[] | { titulo: string; filas: ComponenteG[] }[] | null;
  periodo?: string;
  moneda: Moneda;
  titulo?: string;
}) {
  return (
    <InfoMetrica
      titulo={titulo ?? texto.titulo} ayuda={texto.ayuda} formula={texto.formula} ejemplo={texto.ejemplo} periodo={periodo}
      componentes={piezas ? () => {
        const p = piezas();
        if (!p || p.length === 0) return null;
        if ("filas" in p[0]) return (p as { titulo: string; filas: ComponenteG[] }[]).map((s) => ({ titulo: s.titulo, filas: s.filas.map((x) => aComponente(x, moneda)) }));
        return (p as ComponenteG[]).map((x) => aComponente(x, moneda));
      } : undefined}
    />
  );
}

/** La cabecera de una tarjeta de gráfico: título con su ⓘ, una línea de
 *  contexto y, a la derecha, lo que se puede tocar (un selector). */
export function CabezaGrafico({ id, titulo, info, sub, acciones }: {
  id: string; titulo: string; info?: React.ReactNode; sub?: React.ReactNode; acciones?: React.ReactNode;
}) {
  return (
    <div className="gr-cabeza">
      <div className="gr-cabeza__texto">
        {/* El nombre de la tarjeta es sólo el título: el botón del ⓘ queda afuera de lo que lee el lector de pantalla. */}
        <h2 className="gr-cabeza__titulo"><span id={id}>{titulo}</span>{info}</h2>
        {sub && <p className="gr-cabeza__sub">{sub}</p>}
      </div>
      {acciones && <div className="gr-cabeza__acciones">{acciones}</div>}
    </div>
  );
}

/** La marca de una serie en la leyenda y el tooltip: círculo, rombo o cuadrado,
 *  además del color — para quien no distingue el amarillo del verde. */
export function Forma({ forma, color, borde, tam = 10, patron }: { forma: Marca; color: string; borde?: string; tam?: number; patron?: boolean }) {
  const c = tam / 2;
  return (
    <svg className="gr-forma" width={tam} height={tam} viewBox={`0 0 ${tam} ${tam}`} aria-hidden>
      {forma === "circulo" && <circle cx={c} cy={c} r={c - 1} fill={color} stroke={borde} strokeWidth="1" />}
      {forma === "rombo" && <rect x={c - (c - 1.2) * 0.9} y={c - (c - 1.2) * 0.9} width={(c - 1.2) * 1.8} height={(c - 1.2) * 1.8} transform={`rotate(45 ${c} ${c})`} fill={color} stroke={borde} strokeWidth="1" />}
      {forma === "cuadrado" && <rect x="1" y="1" width={tam - 2} height={tam - 2} rx="1.5" fill={color} stroke={borde} strokeWidth="1" />}
      {patron && <path d={`M0 ${tam}L${tam} 0M-2 ${tam / 2}L${tam / 2} -2M${tam / 2} ${tam + 2}L${tam + 2} ${tam / 2}`} stroke="var(--surface-100)" strokeWidth="1.2" opacity=".6" />}
    </svg>
  );
}

/** Texto sólo para lectores de pantalla. */
export function SoloLector({ children, vivo }: { children: React.ReactNode; vivo?: boolean }) {
  return <span className="gr-sr" {...(vivo ? { "aria-live": "polite" as const, "aria-atomic": true } : {})}>{children}</span>;
}

/** Un selector de a uno, como pestañas (cambia lo que se ve) o como opciones
 *  (cambia cómo se mide). Con las flechas se pasa de una a otra. */
export function Selector<T extends string>({ valor, opciones, onCambiar, etiqueta, modo = "opciones", chico }: {
  valor: T;
  opciones: { id: T; titulo: string; icono?: React.ReactNode; ayuda?: string }[];
  onCambiar: (id: T) => void;
  etiqueta: string;
  modo?: "tabs" | "opciones";
  chico?: boolean;
}) {
  const tabs = modo === "tabs";
  return (
    <div className={`gr-selector${chico ? " gr-selector--chico" : ""}`} role={tabs ? "tablist" : "radiogroup"} aria-label={etiqueta}>
      {opciones.map((o, i) => {
        const activo = o.id === valor;
        return (
          <button
            key={o.id} type="button" className="gr-selector__op" title={o.ayuda}
            {...(tabs ? { role: "tab", "aria-selected": activo } : { role: "radio", "aria-checked": activo })}
            tabIndex={activo ? 0 : -1}
            onClick={() => onCambiar(o.id)}
            onKeyDown={(ev) => {
              const paso = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
              if (!paso) return;
              ev.preventDefault();
              const j = (i + paso + opciones.length) % opciones.length;
              onCambiar(opciones[j].id);
              (ev.currentTarget.parentElement?.children[j] as HTMLElement | undefined)?.focus();
            }}
          >
            {o.icono}
            {o.titulo}
          </button>
        );
      })}
    </div>
  );
}
