"use client";

import React from "react";
import { Link2 } from "lucide-react";
import { Button, Select } from "./ui";
import { useToast } from "./Toast";
import { num } from "@/lib/format";

/* ==================================================================
   Las piezas de una pantalla que se lee como reporte: el filtro
   desplegable y el botón que copia el link de lo que se está viendo.
   Los valores viven en la URL (lib/useParamsURL.ts); acá sólo se dibujan.
   ================================================================== */

export interface OpcionFiltro { valor: string; texto: string; cuenta?: number }

/* El valor de "no tiene": sin vendedor, sin proyecto, sin anfitrión. Las
   ventas que vienen de la planilla traen huecos, y encontrarlas también es
   un reporte. Los ids llevan prefijo (`eq_…`, `prod_…`), así que no choca. */
export const SIN = "sin";

/* Las opciones que existen en los datos, sin repetir, por nombre y con
   "Sin …" al final. Un filtro que ofrece algo que nunca pasó hace elegir
   para ver una tabla vacía. */
export function opcionesDe(valores: Iterable<string>, texto: (valor: string) => string, textoSin: string): OpcionFiltro[] {
  return [...new Set(valores)]
    .map((valor) => ({ valor, texto: valor === SIN ? textoSin : texto(valor) }))
    .sort((a, b) => (a.valor === SIN ? 1 : b.valor === SIN ? -1 : a.texto.localeCompare(b.texto, "es")));
}

/* Un filtro desplegable. Vacío es "todos": se ve apagado, como un
   placeholder, y con algo elegido se prende igual que un chip, para ver de un
   vistazo qué está recortando la lista. `cuenta` va entre paréntesis. */
export function Filtro({ etiqueta, todos, valor, opciones, onCambiar }: {
  etiqueta: string;
  todos: string;
  valor: string;
  opciones: OpcionFiltro[];
  onCambiar: (valor: string) => void;
}) {
  return (
    <div className={`filtro${valor ? " filtro--on" : ""}`}>
      <Select
        value={valor} placeholder={todos} aria-label={etiqueta}
        onChange={(ev) => onCambiar(ev.target.value)}
        opciones={opciones.map((o) => ({
          valor: o.valor,
          texto: o.cuenta === undefined ? o.texto : `${o.texto} (${num(o.cuenta)})`,
        }))}
      />
    </div>
  );
}

/* Copia la dirección de lo que se está viendo, con los filtros puestos. Es
   lo que pidió Yari: pasarle el reporte a otro TAL CUAL, sin que tenga que
   armarlo a clics. ?nuevo y ?ver se sacan: abren algo una sola vez (un
   asistente, una ficha) y al que recibe el link le saltaría un modal. */
export function CopiarLink({ sm = true }: { sm?: boolean }) {
  const toast = useToast();

  function copiar() {
    const url = new URL(window.location.href);
    url.searchParams.delete("nuevo");
    url.searchParams.delete("ver");
    const fallo = () => toast("No se pudo copiar. Copiá la dirección desde la barra del navegador.", "err");
    if (!navigator.clipboard) { fallo(); return; }
    navigator.clipboard.writeText(url.toString()).then(
      () => toast("Link copiado: el que lo abra ve este mismo reporte."),
      fallo,
    );
  }

  /* En la barra de arriba del teléfono queda sólo el ícono (globals.css):
     por eso el nombre va también en aria-label. */
  return (
    <Button
      sm={sm} variante="secondary" icono={<Link2 size={16} />} onClick={copiar} className="copiar-link"
      aria-label="Copiar link" title="Copia la dirección con los filtros puestos, para guardarla o mandarla"
    >
      <span className="copiar-link__texto">Copiar link</span>
    </Button>
  );
}
