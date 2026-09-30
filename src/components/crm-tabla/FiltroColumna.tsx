"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, Filter, Search, X } from "lucide-react";
import { num } from "@/lib/format";
import { sinTildes } from "@/lib/crm";
import { seVe, VACIAS, type FiltroColumna as Filtro } from "@/lib/crm-tabla";

/* ==================================================================
   El filtro de una columna, como en Excel: clic en el título y aparece
   la lista de valores con cuántas filas tiene cada uno. Se destilda lo
   que no se quiere ver, o «Sólo» deja un único valor con un clic. Arriba,
   ordenar. Se aplica en el momento, sin botón de aceptar.
   ================================================================== */

export function FiltroColumna({ titulo, opciones, filtro, onFiltro, orden, onOrdenar, fecha }: {
  titulo: string;
  /* Se calculan al abrir: con miles de llamadas, no en cada render de la tabla. */
  opciones: () => { valor: string; cuenta: number }[];
  filtro?: Filtro;
  onFiltro: (f: Filtro | null) => void;
  /* "asc" / "desc" si la tabla está ordenada por esta columna. */
  orden?: "asc" | "desc";
  onOrdenar: (desc: boolean) => void;
  /* Los valores son fechas aaaa-mm-dd: se muestran como fechas. */
  fecha?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  const boton = useRef<HTMLButtonElement>(null);
  const activo = Boolean(filtro?.valores.length);
  return (
    <>
      <button
        ref={boton} type="button" className="xl-th" data-activo={activo || undefined} aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)} title={`Filtrar u ordenar por ${titulo.toLowerCase()}`}
      >
        <span className="xl-th__titulo">{titulo}</span>
        {orden && (orden === "desc" ? <ArrowDown size={13} className="xl-th__orden" /> : <ArrowUp size={13} className="xl-th__orden" />)}
        {activo ? <Filter size={13} className="xl-th__filtro" aria-label="Filtrada" /> : <ChevronDown size={13} className="xl-th__flecha" />}
      </button>
      {abierto && boton.current && (
        <Panel
          ancla={boton.current} titulo={titulo} opciones={opciones} filtro={filtro} fecha={fecha}
          onFiltro={onFiltro} orden={orden} onOrdenar={(d) => { onOrdenar(d); setAbierto(false); }}
          onCerrar={cerrar}
        />
      )}
    </>
  );
}

const DIAS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
export function textoFecha(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return v;
  const d = new Date(`${v}T12:00:00Z`);
  return `${DIAS[d.getUTCDay()]} ${m[3]}/${m[2]}/${m[1].slice(2)}`;
}

function Panel({ ancla, titulo, opciones: obtener, filtro, onFiltro, orden, onOrdenar, onCerrar, fecha }: {
  ancla: HTMLElement; titulo: string; opciones: () => { valor: string; cuenta: number }[]; filtro?: Filtro;
  onFiltro: (f: Filtro | null) => void; orden?: "asc" | "desc"; onOrdenar: (desc: boolean) => void; onCerrar: () => void; fecha?: boolean;
}) {
  const opciones = useMemo(() => obtener(), [obtener]);
  const panel = useRef<HTMLDivElement>(null);
  const [q, setQ] = useState("");
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  /* Debajo del título, sin salirse de la pantalla; si la tabla se mueve, lo
     sigue, y si el título sale de la pantalla, se cierra. */
  const ubicar = useCallback(() => {
    const r = ancla.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth) { onCerrar(); return; }
    const ancho = 300;
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)) });
  }, [ancla, onCerrar]);
  useLayoutEffect(() => { ubicar(); }, [ubicar]);

  /* Se cierra con Esc o con un clic afuera. */
  useEffect(() => {
    const fuera = (ev: MouseEvent) => {
      const t = ev.target as Node;
      if (!panel.current?.contains(t) && !ancla.contains(t)) onCerrar();
    };
    const tecla = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopPropagation(); onCerrar(); ancla.focus(); } };
    const mover = (ev: Event) => { if (!panel.current?.contains(ev.target as Node)) ubicar(); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", tecla, true);
    window.addEventListener("scroll", mover, true);
    window.addEventListener("resize", ubicar);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", tecla, true);
      window.removeEventListener("scroll", mover, true);
      window.removeEventListener("resize", ubicar);
    };
  }, [ancla, onCerrar, ubicar]);

  const texto = (v: string) => (fecha && v !== VACIAS ? textoFecha(v) : v);
  const visibles = useMemo(() => {
    const t = sinTildes(q.trim());
    return t ? opciones.filter((o) => sinTildes(texto(o.valor)).includes(t)) : opciones;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opciones, q, fecha]);

  const todos = opciones.map((o) => o.valor);
  /* Destildar todo deja la lista vacía para elegir de cero, como en Excel;
     la tabla no se vacía: el filtro vale cuando se tilda algo. */
  const [nada, setNada] = useState(false);
  const tildados = nada ? [] : todos.filter((v) => seVe(v, filtro));
  const todosTildados = tildados.length === todos.length;

  /* Tildar y destildar: se guarda de la forma más corta (lo que se ve o lo
     que no), y todo tildado es "sin filtro". */
  function dejar(visiblesNuevos: string[]) {
    setNada(visiblesNuevos.length === 0);
    if (visiblesNuevos.length === 0) return;
    if (visiblesNuevos.length === todos.length) { onFiltro(null); return; }
    const ocultos = todos.filter((v) => !visiblesNuevos.includes(v));
    onFiltro(visiblesNuevos.length <= ocultos.length ? { modo: "solo", valores: visiblesNuevos } : { modo: "sin", valores: ocultos });
  }
  const alternar = (v: string) => dejar(tildados.includes(v) ? tildados.filter((x) => x !== v) : [...tildados, v]);

  if (!pos) return null;
  return createPortal(
    <div
      ref={panel} className="xl-pop" role="dialog" aria-label={`Filtrar ${titulo}`} data-flotante-abierto
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="xl-pop__orden">
        <button type="button" className="xl-pop__item" aria-pressed={orden === "asc"} onClick={() => onOrdenar(false)}>
          <ArrowUp size={14} aria-hidden />{fecha ? "De la más vieja a la más nueva" : "De la A a la Z"}
        </button>
        <button type="button" className="xl-pop__item" aria-pressed={orden === "desc"} onClick={() => onOrdenar(true)}>
          <ArrowDown size={14} aria-hidden />{fecha ? "De la más nueva a la más vieja" : "De la Z a la A"}
        </button>
      </div>
      <label className="xl-pop__buscar">
        <Search size={14} aria-hidden />
        <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Buscar" aria-label={`Buscar en ${titulo}`} />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Borrar la búsqueda"><X size={13} /></button>}
      </label>
      <div className="xl-pop__lista">
        {!q && (
          <label className="xl-pop__valor xl-pop__valor--todos">
            <input
              type="checkbox" checked={todosTildados}
              ref={(el) => { if (el) el.indeterminate = !todosTildados && tildados.length > 0; }}
              onChange={() => dejar(todosTildados ? [] : todos)}
            />
            <span className="xl-pop__texto">(Seleccionar todo)</span>
          </label>
        )}
        {visibles.length === 0 && <p className="t-sm t-subtle" style={{ padding: "8px 10px" }}>Nada coincide.</p>}
        {visibles.map((o) => (
          <div key={o.valor} className="xl-pop__fila">
            <label className="xl-pop__valor">
              <input type="checkbox" checked={tildados.includes(o.valor)} onChange={() => alternar(o.valor)} />
              <span className="xl-pop__texto" title={texto(o.valor)}>{texto(o.valor)}</span>
              <span className="xl-pop__cuenta t-num">{num(o.cuenta)}</span>
            </label>
            <button type="button" className="xl-pop__solo" onClick={() => { setNada(false); onFiltro({ modo: "solo", valores: [o.valor] }); }}
              title={`Ver sólo «${texto(o.valor)}»`}>Sólo</button>
          </div>
        ))}
      </div>
      <div className="xl-pop__pie">
        <span className="t-sm t-subtle">{nada ? "Tildá lo que querés ver" : todosTildados ? "Sin filtro" : `${num(tildados.length)} de ${num(todos.length)}`}</span>
        <span className="spacer" />
        {filtro?.valores.length ? (
          <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={() => { setNada(false); onFiltro(null); }}>Quitar el filtro</button>
        ) : null}
        <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" onClick={onCerrar}>Listo</button>
      </div>
    </div>,
    document.body,
  );
}
