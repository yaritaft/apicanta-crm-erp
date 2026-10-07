"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, Filter, Search, X } from "lucide-react";
import { Chip } from "@/components/crm/piezas";
import { num } from "@/lib/format";
import { sinTildes } from "@/lib/crm";
import { hayFiltro, seVe, VACIAS, type FiltroColumna as Filtro } from "@/lib/crm-tabla";
import type { ColorCrm } from "@/lib/types";

/* ==================================================================
   El filtro de una columna, como en Excel: clic en el título y aparece
   todo lo de esa columna, sin ir a otro lado a armar condiciones.

   - Ordenar por ella; y si la tabla ya está ordenada por otra, sumarla
     como criterio siguiente («después de Closer»).
   - La lista de valores con cuántas filas tiene cada uno: se destilda lo
     que no se quiere ver, o «Sólo» deja un único valor con un clic.
   - Lo que en Excel son los filtros de texto y de fecha: se escribe en el
     buscador y se elige «las que contienen» o «las que no contienen»; en
     las columnas de fecha, un desde y un hasta.

   Se aplica en el momento, sin botón de aceptar, y queda en el link.
   ================================================================== */

export interface OrdenDeColumna {
  desc: boolean;
  /* Su lugar entre los criterios (1 es el primero) y cuántos hay. */
  puesto: number;
  de: number;
}

export function FiltroColumna({ titulo, opciones, filtro, onFiltro, orden, onOrdenar, onSumarOrden, onQuitarOrden, ordenaPrimero, fecha, pinta, numerica }: {
  titulo: string;
  /* Se calculan al abrir: con miles de llamadas, no en cada render de la tabla. */
  opciones: () => { valor: string; cuenta: number }[];
  filtro?: Filtro;
  onFiltro: (f: Filtro | null) => void;
  /* Si la tabla está ordenada por esta columna. */
  orden?: OrdenDeColumna;
  /* Ordenar sólo por ésta. */
  onOrdenar: (desc: boolean) => void;
  /* Sumarla a las que ya ordenan, o cambiarle el sentido. */
  onSumarOrden?: (desc: boolean) => void;
  onQuitarOrden?: () => void;
  /* El título de la columna que ordena primero, si es otra. */
  ordenaPrimero?: string;
  /* Los valores son fechas aaaa-mm-dd: se muestran como fechas y se filtran desde / hasta. */
  fecha?: boolean;
  /* El color de cada valor, si son opciones con color (los estados). */
  pinta?: (valor: string) => ColorCrm | undefined;
  /* La columna se ordena por un número (lo cobrado): «de menor a mayor», aunque sus valores tengan color. */
  numerica?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const cerrar = useCallback(() => setAbierto(false), []);
  const boton = useRef<HTMLButtonElement>(null);
  const activo = hayFiltro(filtro);
  return (
    <>
      <button
        ref={boton} type="button" className="xl-th" data-activo={activo || undefined} aria-haspopup="dialog" aria-expanded={abierto}
        onClick={() => setAbierto((v) => !v)} title={`Filtrar u ordenar por ${titulo.toLowerCase()}`}
      >
        <span className="xl-th__titulo">{titulo}</span>
        {orden && (
          <span className="xl-th__orden" aria-label={orden.desc ? "Ordenada de mayor a menor" : "Ordenada de menor a mayor"}>
            {orden.desc ? <ArrowDown size={13} /> : <ArrowUp size={13} />}
            {orden.de > 1 && <span className="xl-th__puesto t-num">{orden.puesto}</span>}
          </span>
        )}
        {activo ? <Filter size={13} className="xl-th__filtro" aria-label="Filtrada" /> : <ChevronDown size={13} className="xl-th__flecha" />}
      </button>
      {abierto && boton.current && (
        <Panel
          ancla={boton.current} titulo={titulo} opciones={opciones} filtro={filtro} fecha={fecha} pinta={pinta} numerica={numerica}
          onFiltro={onFiltro} orden={orden} ordenaPrimero={ordenaPrimero}
          onOrdenar={(d) => { onOrdenar(d); setAbierto(false); }}
          onSumarOrden={onSumarOrden ? (d) => { onSumarOrden(d); setAbierto(false); } : undefined}
          onQuitarOrden={onQuitarOrden ? () => { onQuitarOrden(); setAbierto(false); } : undefined}
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

/* El filtro con un cambio; null si ya no recorta nada. */
function con(f: Filtro | undefined, cambios: Partial<Filtro>): Filtro | null {
  const nuevo: Filtro = { modo: "solo", valores: [], ...f, ...cambios };
  return hayFiltro(nuevo) ? nuevo : null;
}

function Panel({ ancla, titulo, opciones: obtener, filtro, onFiltro, orden, onOrdenar, onSumarOrden, onQuitarOrden, ordenaPrimero, onCerrar, fecha, pinta, numerica }: {
  ancla: HTMLElement; titulo: string; opciones: () => { valor: string; cuenta: number }[]; filtro?: Filtro;
  onFiltro: (f: Filtro | null) => void; orden?: OrdenDeColumna; onOrdenar: (desc: boolean) => void;
  onSumarOrden?: (desc: boolean) => void; onQuitarOrden?: () => void; ordenaPrimero?: string;
  onCerrar: () => void; fecha?: boolean; pinta?: (valor: string) => ColorCrm | undefined; numerica?: boolean;
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
    const ancho = 310;
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
  const buscado = q.trim();
  const visibles = useMemo(() => {
    const t = sinTildes(buscado);
    return t ? opciones.filter((o) => sinTildes(texto(o.valor)).includes(t)) : opciones;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opciones, buscado, fecha]);

  const todos = opciones.map((o) => o.valor);
  /* Destildar todo deja la lista vacía para elegir de cero, como en Excel;
     la tabla no se vacía: el filtro vale cuando se tilda algo. */
  const [nada, setNada] = useState(false);
  const tildados = nada ? [] : todos.filter((v) => seVe(v, filtro));
  const todosTildados = tildados.length === todos.length;

  /* Tildar y destildar: se guarda de la forma más corta (lo que se ve o lo
     que no), y todo tildado es "sin filtro de valores". Lo de «contiene» y
     las fechas de esta misma columna queda. */
  function dejar(visiblesNuevos: string[]) {
    setNada(visiblesNuevos.length === 0);
    if (visiblesNuevos.length === 0) return;
    if (visiblesNuevos.length === todos.length) { onFiltro(con(filtro, { valores: [] })); return; }
    const ocultos = todos.filter((v) => !visiblesNuevos.includes(v));
    onFiltro(con(filtro, visiblesNuevos.length <= ocultos.length ? { modo: "solo", valores: visiblesNuevos } : { modo: "sin", valores: ocultos }));
  }
  const alternar = (v: string) => dejar(tildados.includes(v) ? tildados.filter((x) => x !== v) : [...tildados, v]);
  const condicion = (cambios: Partial<Filtro>) => { setNada(false); onFiltro(con(filtro, cambios)); };

  /* Cómo se llama cada sentido: las fechas, de vieja a nueva; las opciones
     con color (los estados), en su orden, que no es el alfabético. */
  const sube = fecha ? "De la más vieja a la más nueva" : numerica ? "De menor a mayor" : pinta ? "En el orden de las opciones" : "De la A a la Z";
  const baja = fecha ? "De la más nueva a la más vieja" : numerica ? "De mayor a menor" : pinta ? "En el orden inverso" : "De la Z a la A";
  const conValores = Boolean(filtro?.valores.length);
  const pie = nada ? "Tildá lo que querés ver"
    : !hayFiltro(filtro) ? "Sin filtro"
      : conValores ? `${num(tildados.length)} de ${num(todos.length)}` : "Con condición";

  if (!pos) return null;
  return createPortal(
    <div
      ref={panel} className="xl-pop" role="dialog" aria-label={`Filtrar ${titulo}`} data-flotante-abierto
      style={{ top: pos.top, left: pos.left }}
    >
      <div className="xl-pop__orden">
        <button type="button" className="xl-pop__item" aria-pressed={orden?.puesto === 1 && !orden.desc} onClick={() => onOrdenar(false)}>
          <ArrowUp size={14} aria-hidden />{sube}
        </button>
        <button type="button" className="xl-pop__item" aria-pressed={orden?.puesto === 1 && orden.desc} onClick={() => onOrdenar(true)}>
          <ArrowDown size={14} aria-hidden />{baja}
        </button>
        {/* La tabla ya está ordenada por otra columna: ésta, como criterio siguiente. */}
        {ordenaPrimero && onSumarOrden && (
          <div className="xl-pop__despues">
            <span className="t-sm t-subtle truncate">Después de {ordenaPrimero}:</span>
            <button type="button" className="xl-pop__mini" aria-pressed={Boolean(orden && !orden.desc)} onClick={() => onSumarOrden(false)}
              title={sube}><ArrowUp size={13} aria-hidden />{fecha ? "Vieja" : pinta ? "Orden" : "A–Z"}</button>
            <button type="button" className="xl-pop__mini" aria-pressed={Boolean(orden?.desc)} onClick={() => onSumarOrden(true)}
              title={baja}><ArrowDown size={13} aria-hidden />{fecha ? "Nueva" : pinta ? "Inverso" : "Z–A"}</button>
            {orden && onQuitarOrden && (
              <button type="button" className="xl-pop__mini" onClick={onQuitarOrden} title="Dejar de ordenar por esta columna"><X size={13} aria-hidden />Quitar</button>
            )}
          </div>
        )}
      </div>

      {fecha && (
        <div className="xl-pop__fechas">
          <label>
            <span className="t-sm t-subtle">Desde</span>
            <input type="date" value={filtro?.desde ?? ""} max={filtro?.hasta || undefined} aria-label={`${titulo} desde`}
              onChange={(ev) => condicion({ desde: ev.target.value || undefined })} />
          </label>
          <label>
            <span className="t-sm t-subtle">Hasta</span>
            <input type="date" value={filtro?.hasta ?? ""} min={filtro?.desde || undefined} aria-label={`${titulo} hasta`}
              onChange={(ev) => condicion({ hasta: ev.target.value || undefined })} />
          </label>
        </div>
      )}

      <label className="xl-pop__buscar">
        <Search size={14} aria-hidden />
        <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={fecha ? "Buscar" : "Buscar o filtrar por texto"} aria-label={`Buscar en ${titulo}`}
          onKeyDown={(ev) => { if (ev.key === "Enter" && buscado && !fecha) { ev.preventDefault(); condicion({ contiene: buscado }); setQ(""); } }} />
        {q && <button type="button" onClick={() => setQ("")} aria-label="Borrar la búsqueda"><X size={13} /></button>}
      </label>

      {(filtro?.contiene || filtro?.noContiene) && (
        <div className="xl-pop__condiciones">
          {filtro.contiene && (
            <span className="xl-pop__condicion">
              <span className="truncate">Contiene «{filtro.contiene}»</span>
              <button type="button" onClick={() => condicion({ contiene: undefined })} aria-label="Quitar «contiene»"><X size={12} /></button>
            </span>
          )}
          {filtro.noContiene && (
            <span className="xl-pop__condicion">
              <span className="truncate">No contiene «{filtro.noContiene}»</span>
              <button type="button" onClick={() => condicion({ noContiene: undefined })} aria-label="Quitar «no contiene»"><X size={12} /></button>
            </span>
          )}
        </div>
      )}

      <div className="xl-pop__lista">
        {/* Con algo escrito: filtrar por ese texto, como los «filtros de texto» de Excel. */}
        {buscado && !fecha && (
          <div className="xl-pop__texto-filtro">
            <button type="button" className="xl-pop__item" onClick={() => { condicion({ contiene: buscado }); setQ(""); }}>
              <Filter size={13} aria-hidden /><span className="truncate">Las que contienen «{buscado}»</span>
            </button>
            <button type="button" className="xl-pop__item" onClick={() => { condicion({ noContiene: buscado }); setQ(""); }}>
              <Filter size={13} aria-hidden /><span className="truncate">Las que no contienen «{buscado}»</span>
            </button>
          </div>
        )}
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
        {visibles.length === 0 && (fecha || !buscado) && <p className="t-sm t-subtle" style={{ padding: "8px 10px" }}>Ningún valor coincide.</p>}
        {visibles.map((o) => {
          const color = pinta?.(o.valor);
          return (
            <div key={o.valor} className="xl-pop__fila">
              <label className="xl-pop__valor">
                <input type="checkbox" checked={tildados.includes(o.valor)} onChange={() => alternar(o.valor)} />
                <span className="xl-pop__texto" title={texto(o.valor)}>{color ? <Chip texto={o.valor} color={color} /> : texto(o.valor)}</span>
                <span className="xl-pop__cuenta t-num">{num(o.cuenta)}</span>
              </label>
              <button type="button" className="xl-pop__solo" onClick={() => { setNada(false); onFiltro(con(filtro, { modo: "solo", valores: [o.valor] })); }}
                title={`Ver sólo «${texto(o.valor)}»`}>Sólo</button>
            </div>
          );
        })}
      </div>
      <div className="xl-pop__pie">
        <span className="t-sm t-subtle">{pie}</span>
        <span className="spacer" />
        {hayFiltro(filtro) ? (
          <button type="button" className="hk-btn hk-btn--ghost hk-btn--sm" onClick={() => { setNada(false); onFiltro(null); }}>Quitar el filtro</button>
        ) : null}
        <button type="button" className="hk-btn hk-btn--secondary hk-btn--sm" onClick={onCerrar}>Listo</button>
      </div>
    </div>,
    document.body,
  );
}
