"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Link2, Search } from "lucide-react";
import { Button, Select } from "./ui";
import { Panel, useClicAfuera, usePosicion } from "./Campos";
import { textoDelFiltro } from "@/lib/filtro-multiple";
import { useToast } from "./Toast";
import { num } from "@/lib/format";
import { aportesAlLink } from "@/lib/compartirLink";

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

/* El mismo filtro, con varias opciones a la vez: el panel queda abierto para tildar
   las que se quieran (Inasistió y Reagendó) y se cierra al tocar afuera o con Esc.
   Sin nada tildado es "todos". `cuenta` va entre paréntesis, como en `Filtro`. */
export function FiltroMulti({ etiqueta, todos, valores, opciones, onCambiar }: {
  etiqueta: string;
  todos: string;
  valores: string[];
  opciones: OpcionFiltro[];
  onCambiar: (valores: string[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(0);
  const [q, setQ] = useState("");
  const boton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const idLista = useId();
  const conBuscador = opciones.length > 8;
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? opciones.filter((o) => o.texto.toLowerCase().includes(t)) : opciones;
  }, [opciones, q]);
  const textoDe = (v: string) => opciones.find((o) => o.valor === v)?.texto ?? v;
  const pos = usePosicion(boton, abierto, Math.min(visibles.length * 38 + (conBuscador ? 96 : 56), 380), 220);
  const cerrar = useCallback(() => { setAbierto(false); setQ(""); }, []);
  const refs = useMemo(() => [boton, panel], []);
  useClicAfuera(abierto, refs, cerrar);

  /* Con el panel abierto el foco va al buscador (o a la lista), para manejarlo con el teclado. */
  useEffect(() => {
    if (!abierto) return;
    const h = window.setTimeout(() => (panel.current?.querySelector<HTMLElement>(".sel__buscar input") ?? lista.current)?.focus(), 0);
    return () => window.clearTimeout(h);
  }, [abierto]);

  const alternar = (valor: string) => onCambiar(valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);
  function tecla(ev: React.KeyboardEvent) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActiva((i) => Math.min(i + 1, visibles.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActiva((i) => Math.max(i - 1, 0)); }
    else if (ev.key === "Enter" || ev.key === " ") {
      if ((ev.target as HTMLElement).tagName === "INPUT" && ev.key === " ") return;
      ev.preventDefault(); ev.stopPropagation(); const o = visibles[activa]; if (o) alternar(o.valor);
    } else if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); cerrar(); boton.current?.focus(); }
    else if (ev.key === "Tab") cerrar();
  }

  return (
    <div className={`filtro${valores.length ? " filtro--on" : ""}`}>
      <div className="sel-caja">
        <button
          ref={boton} type="button" className="hk-input hk-input--select sel" aria-label={etiqueta}
          aria-haspopup="listbox" aria-expanded={abierto} aria-controls={abierto ? idLista : undefined}
          title={valores.length > 1 ? valores.map(textoDe).join(", ") : undefined}
          onClick={() => { if (abierto) cerrar(); else { setActiva(0); setAbierto(true); } }}
          onKeyDown={(ev) => { if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); ev.stopPropagation(); setActiva(0); setAbierto(true); } }}
        >
          <span className={`sel__valor${valores.length === 0 ? " sel__valor--vacio" : ""}`}>{textoDelFiltro(valores, textoDe, todos)}</span>
        </button>
        {abierto && pos && (
          <Panel pos={pos} panelRef={panel} className="sel__panel">
            <div onKeyDown={tecla} style={{ display: "flex", flexDirection: "column", minHeight: 0, maxHeight: "inherit" }}>
              {conBuscador && (
                <div className="sel__buscar">
                  <Search size={15} />
                  <input value={q} placeholder="Buscar…" aria-label="Buscar opción" onChange={(ev) => { setQ(ev.target.value); setActiva(0); }} />
                </div>
              )}
              <div id={idLista} role="listbox" aria-multiselectable="true" aria-label={etiqueta} tabIndex={-1} className="sel__lista" ref={lista}>
                {visibles.length === 0 && <div className="sel__vacio">Nada coincide</div>}
                {visibles.map((o, i) => {
                  const on = valores.includes(o.valor);
                  return (
                    <div key={o.valor} role="option" aria-selected={on}
                      className={`sel__opcion${i === activa ? " sel__opcion--activa" : ""}`}
                      onMouseEnter={() => setActiva(i)} onClick={() => alternar(o.valor)}>
                      <span className={`sel__marca${on ? " sel__marca--on" : ""}`} aria-hidden>{on && <Check size={12} strokeWidth={3} />}</span>
                      <span className="truncate">{o.texto}</span>
                      {o.cuenta !== undefined && <span className="sel__cuenta t-num">{num(o.cuenta)}</span>}
                    </div>
                  );
                })}
              </div>
              {valores.length > 0 && (
                <button type="button" className="sel__limpiar" onClick={() => { onCambiar([]); }}>Quitar {valores.length === 1 ? "el filtro" : `los ${valores.length} filtros`}</button>
              )}
            </div>
          </Panel>
        )}
      </div>
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
    for (const k of ["nuevo", "ver", "code"]) url.searchParams.delete(k);
    /* Lo que es de cada uno (columnas, métricas, la vista del CRM) viaja en
       el link: quien lo abre ve lo mismo (lib/compartirLink). */
    for (const [k, v] of Object.entries(aportesAlLink())) url.searchParams.set(k, v);
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
