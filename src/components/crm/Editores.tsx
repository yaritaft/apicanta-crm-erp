"use client";

import React, { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { sinTildes } from "@/lib/crm";
import type { OpcionCrm } from "@/lib/types";
import { Chip, Flotante } from "./piezas";

/* ==================================================================
   Los editores de una celda: la lista de opciones (con el buscador
   «Encuentra una opción», como Airtable) y el texto largo, que se abre
   en una caja más grande encima de la celda.
   ================================================================== */

export function SelectorOpciones({
  ancla, opciones, valor, onElegir, onCerrar, inicial = "", ancho, cubrir,
}: {
  ancla: HTMLElement | null;
  opciones: OpcionCrm[];
  valor: string;
  onElegir: (nombre: string) => void;
  onCerrar: () => void;
  /* La tecla con la que se abrió: arranca buscando eso. */
  inicial?: string;
  ancho?: number;
  cubrir?: boolean;
}) {
  const [q, setQ] = useState(inicial);
  const lista = opciones.filter((o) => sinTildes(o.nombre).includes(sinTildes(q.trim())));
  const [i, setI] = useState(() => Math.max(0, opciones.findIndex((o) => o.nombre === valor)));
  const listaRef = useRef<HTMLDivElement>(null);
  const k = Math.min(i, Math.max(0, lista.length - 1));

  useEffect(() => {
    listaRef.current?.querySelector<HTMLElement>(`[data-i="${k}"]`)?.scrollIntoView({ block: "nearest" });
  }, [k]);

  return (
    <Flotante ancla={ancla} onCerrar={onCerrar} ancho={ancho} className="crm-selector" arriba={0} cubrir={cubrir}>
      <input
        autoFocus className="crm-selector__buscar" placeholder="Encuentra una opción"
        value={q} aria-label="Buscar una opción"
        onChange={(ev) => { setQ(ev.target.value); setI(0); }}
        onKeyDown={(ev) => {
          if (ev.key === "ArrowDown") { ev.preventDefault(); setI(Math.min(k + 1, lista.length - 1)); }
          else if (ev.key === "ArrowUp") { ev.preventDefault(); setI(Math.max(k - 1, 0)); }
          else if (ev.key === "Enter") { ev.preventDefault(); if (lista[k]) onElegir(lista[k].nombre); }
          else if (ev.key === "Tab") { ev.preventDefault(); onCerrar(); }
        }}
      />
      <div className="crm-selector__lista" role="listbox" ref={listaRef}>
        {lista.map((o, n) => (
          <div
            key={o.nombre} data-i={n} role="option" aria-selected={o.nombre === valor}
            className={`crm-selector__op${n === k ? " crm-selector__op--activa" : ""}`}
            onMouseEnter={() => setI(n)}
            onMouseDown={(ev) => { ev.preventDefault(); onElegir(o.nombre); }}
          >
            <Chip texto={o.nombre} color={o.color} />
            {o.nombre === valor && <Check size={14} className="crm-selector__check" aria-hidden />}
          </div>
        ))}
        {lista.length === 0 && <div className="crm-selector__vacio">Ninguna opción coincide</div>}
      </div>
    </Flotante>
  );
}

/* El texto largo se edita en una caja que tapa la celda y se estira hacia
   abajo, como el de Airtable. Esc y el clic afuera guardan: no hay botón
   Guardar, igual que en una planilla. */
export function EditorTextoLargo({ ancla, valor, inicial, onGuardar, onCerrar, titulo }: {
  ancla: HTMLElement | null;
  valor: string;
  inicial?: string;
  onGuardar: (texto: string) => void;
  onCerrar: () => void;
  titulo: string;
}) {
  const [t, setT] = useState(inicial !== undefined ? valor + inicial : valor);
  const hecho = useRef(false);
  const ultimo = useRef(t);
  ultimo.current = t;
  const ref = useRef<HTMLTextAreaElement>(null);
  const cerrar = () => {
    if (hecho.current) return;
    hecho.current = true;
    if (t !== valor) onGuardar(t);
    onCerrar();
  };
  /* Si se cierra desde afuera (se scrolleó la grilla), lo escrito se guarda. */
  useEffect(() => () => {
    if (!hecho.current && ultimo.current !== valor) onGuardar(ultimo.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  const ancho = Math.max(360, ancla?.offsetWidth ?? 0);
  return (
    <Flotante ancla={ancla} onCerrar={cerrar} ancho={ancho} className="crm-largo" cubrir>
      <textarea
        ref={ref} value={t} aria-label={titulo} rows={7}
        onChange={(ev) => setT(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); cerrar(); }
          if (ev.key === "Tab") { ev.preventDefault(); cerrar(); }
        }}
      />
      <div className="crm-largo__pie">⌘ Enter o Esc para guardar</div>
    </Flotante>
  );
}
