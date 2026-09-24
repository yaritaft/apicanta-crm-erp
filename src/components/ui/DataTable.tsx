"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { num } from "@/lib/format";

export interface Columna<T> {
  clave: string;
  titulo: string;
  /* Cómo se pinta la celda */
  celda: (fila: T) => React.ReactNode;
  /* Valor para ordenar; si falta, la columna no ordena */
  orden?: (fila: T) => string | number;
  tipo?: "primary" | "num" | "secondary";
  ancho?: number;
  /* Lo que va en la fila de totales, al pie. Con que una columna lo tenga, la
     tabla dibuja esa fila: el total se lee debajo de su columna, no aparte. */
  pie?: React.ReactNode;
}

type Orden = { clave: string; desc: boolean };

export function DataTable<T extends { id: string }>({
  filas, columnas, onFila, acciones, ordenInicial, vacio, etiquetaFila, alto, porPagina,
  mostrarMas, filaActiva, orden: ordenDeAfuera, onOrden, pagina: paginaDeAfuera, onPagina,
}: {
  filas: T[];
  columnas: Columna<T>[];
  onFila?: (fila: T) => void;
  acciones?: (fila: T) => React.ReactNode;
  ordenInicial?: { clave: string; desc: boolean };
  vacio: React.ReactNode;
  etiquetaFila?: (fila: T) => string;
  /* Filas por pagina. Sin esto la tabla dibuja TODAS: con 124 leads ya son 124
     nodos, y el dia que sean 5.000 el navegador se arrastra. Es lo que pidio
     Yari — "al no estar paginado esto se va a trabar en algun momento". */
  porPagina?: number;
  /* Alto maximo en px. Con esto la tabla scrollea adentro y la pagina deja de
     estirarse: 52 cuotas vencidas hacian que Finanzas no terminara nunca. El
     encabezado queda fijo, asi que se sigue sabiendo que columna es cual. */
  alto?: number;
  /* La otra forma de cortar: de a N filas, con un boton al final para traer
     N mas. Para listas que se leen de corrido, como los anuncios de Meta, donde
     la fila de totales tiene que quedar pegada abajo. No se combina con
     `porPagina`. */
  mostrarMas?: number;
  /* La fila que esta abierta en un detalle, o la que filtra a otra tabla: se
     pinta, para no perder de vista donde se esta parado. */
  filaActiva?: (fila: T) => boolean;
  /* Orden y pagina manejados desde afuera, para las pantallas que los guardan
     en la URL (ver useParamsURL): con `onOrden` la tabla muestra `orden` y
     avisa cada clic en vez de acordarse ella; con `onPagina`, lo mismo con la
     pagina (cuenta desde 0). Volver a la primera cuando cambia el filtro o el
     orden pasa a ser de quien la maneja: la tabla no puede escribir la URL
     por su cuenta, y si lo hiciera al montarse pisaria la pagina del link.
     Sin estos props, la tabla hace todo sola, como siempre. */
  orden?: Orden | null;
  onOrden?: (orden: Orden) => void;
  pagina?: number;
  onPagina?: (pagina: number) => void;
}) {
  const [ordenPropio, setOrdenPropio] = useState<Orden | null>(ordenInicial ?? null);
  const [paginaPropia, setPaginaPropia] = useState(0);
  const [limite, setLimite] = useState(mostrarMas ?? 0);
  const orden = onOrden ? ordenDeAfuera ?? null : ordenPropio;
  const pagina = onPagina ? paginaDeAfuera ?? 0 : paginaPropia;
  const paginaPropiaActiva = !onPagina;
  /* Por valor: un orden que llega de afuera es un objeto nuevo en cada
     render, y eso no quiere decir que haya cambiado. */
  const claveOrden = orden?.clave;
  const descOrden = orden?.desc ?? false;

  /* Mismo criterio que la pagina: otro filtro u otro orden arrancan de nuevo
     desde las primeras. */
  useEffect(() => { setLimite(mostrarMas ?? 0); }, [filas, claveOrden, descOrden, mostrarMas]);

  /* Volver a la primera al cambiar el filtro o el orden: quedarse en la pagina
     7 de un resultado que ahora tiene 2 muestra una tabla vacia y parece que
     no hay nada. */
  useEffect(() => { if (paginaPropiaActiva) setPaginaPropia(0); }, [filas, claveOrden, descOrden, paginaPropiaActiva]);

  const ordenadas = useMemo(() => {
    if (!claveOrden) return filas;
    const col = columnas.find((c) => c.clave === claveOrden);
    if (!col?.orden) return filas;
    const fn = col.orden;
    return [...filas].sort((a, b) => {
      const va = fn(a), vb = fn(b);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "es");
      return descOrden ? -cmp : cmp;
    });
  }, [filas, columnas, claveOrden, descOrden]);

  const total = ordenadas.length;
  const paginas = porPagina ? Math.max(1, Math.ceil(total / porPagina)) : 1;
  const actual = Math.min(pagina, paginas - 1);
  const visibles = porPagina
    ? ordenadas.slice(actual * porPagina, actual * porPagina + porPagina)
    : ordenadas;
  const mostradas = mostrarMas ? visibles.slice(0, limite) : visibles;
  const conPie = columnas.some((c) => c.pie !== undefined);

  function alternar(clave: string) {
    const siguiente = (o: Orden | null): Orden => (o?.clave === clave ? { clave, desc: !o.desc } : { clave, desc: false });
    if (onOrden) onOrden(siguiente(orden));
    else setOrdenPropio(siguiente);
  }

  const irA = (p: number) => (onPagina ? onPagina(p) : setPaginaPropia(p));

  if (filas.length === 0) return <div className="hk-table-wrap">{vacio}</div>;

  return (
    <div
      className={`hk-table-wrap${alto ? " hk-table-wrap--alto" : ""}`}
      style={alto ? { maxHeight: alto } : undefined}
    >
      <table className="hk-table">
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c.clave}
                className={`${c.tipo === "num" ? "hk-th--num " : ""}${c.orden ? "sortable" : ""}`}
                style={c.ancho ? { width: c.ancho } : undefined}
                onClick={c.orden ? () => alternar(c.clave) : undefined}
                aria-sort={orden?.clave === c.clave ? (orden.desc ? "descending" : "ascending") : undefined}
              >
                {c.titulo}
                {orden?.clave === c.clave && (
                  <span className="sort-ico">
                    {orden.desc ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
                  </span>
                )}
              </th>
            ))}
            {acciones && <th style={{ width: 96 }} aria-label="Acciones" />}
          </tr>
        </thead>
        <tbody>
          {mostradas.map((f) => (
            <tr
              key={f.id}
              data-activa={filaActiva?.(f) ? "true" : undefined}
              onClick={onFila ? () => onFila(f) : undefined}
              tabIndex={onFila ? 0 : undefined}
              role={onFila ? "button" : undefined}
              aria-label={etiquetaFila?.(f)}
              onKeyDown={onFila ? (e) => { if (e.key === "Enter") { e.preventDefault(); onFila(f); } } : undefined}
              style={onFila ? undefined : { cursor: "default" }}
            >
              {columnas.map((c) => (
                <td key={c.clave} className={c.tipo ? `hk-td--${c.tipo}` : undefined}>
                  {c.celda(f)}
                </td>
              ))}
              {acciones && (
                <td onClick={(e) => e.stopPropagation()}>
                  <div className="row-actions">{acciones(f)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
        {conPie && (
          <tfoot>
            <tr>
              {columnas.map((c) => (
                <td key={c.clave} className={c.tipo ? `hk-td--${c.tipo}` : undefined}>{c.pie}</td>
              ))}
              {acciones && <td />}
            </tr>
          </tfoot>
        )}
      </table>

      {!!mostrarMas && limite < total && (
        <div className="hk-mas">
          <span className="t-sm t-subtle t-num">{num(limite)} de {num(total)}</span>
          <button
            type="button" className="hk-btn hk-btn--secondary hk-btn--sm"
            onClick={() => setLimite((l) => l + mostrarMas)}
          >
            Mostrar {num(Math.min(mostrarMas, total - limite))} más
          </button>
        </div>
      )}

      {porPagina && paginas > 1 && (
        <div className="hk-paginador">
          <span className="t-sm t-subtle">
            {actual * porPagina + 1}–{Math.min((actual + 1) * porPagina, total)} de {total}
          </span>
          <span className="spacer" />
          <button
            type="button" className="hk-btn hk-btn--ghost hk-btn--sm"
            disabled={actual === 0} onClick={() => irA(actual - 1)}
          >
            <ArrowLeft size={15} />Anterior
          </button>
          <span className="t-sm t-muted">{actual + 1} / {paginas}</span>
          <button
            type="button" className="hk-btn hk-btn--ghost hk-btn--sm"
            disabled={actual >= paginas - 1} onClick={() => irA(actual + 1)}
          >
            Siguiente<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
