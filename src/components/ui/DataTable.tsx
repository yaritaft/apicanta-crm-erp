"use client";

import React, { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";

export interface Columna<T> {
  clave: string;
  titulo: string;
  /* Cómo se pinta la celda */
  celda: (fila: T) => React.ReactNode;
  /* Valor para ordenar; si falta, la columna no ordena */
  orden?: (fila: T) => string | number;
  tipo?: "primary" | "num" | "secondary";
  ancho?: number;
}

export function DataTable<T extends { id: string }>({
  filas, columnas, onFila, acciones, ordenInicial, vacio, etiquetaFila, alto, porPagina,
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
}) {
  const [orden, setOrden] = useState(ordenInicial ?? null);
  const [pagina, setPagina] = useState(0);

  /* Volver a la primera al cambiar el filtro o el orden: quedarse en la pagina
     7 de un resultado que ahora tiene 2 muestra una tabla vacia y parece que
     no hay nada. */
  useEffect(() => { setPagina(0); }, [filas, orden]);

  const ordenadas = useMemo(() => {
    if (!orden) return filas;
    const col = columnas.find((c) => c.clave === orden.clave);
    if (!col?.orden) return filas;
    const fn = col.orden;
    return [...filas].sort((a, b) => {
      const va = fn(a), vb = fn(b);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "es");
      return orden.desc ? -cmp : cmp;
    });
  }, [filas, columnas, orden]);

  const total = ordenadas.length;
  const paginas = porPagina ? Math.max(1, Math.ceil(total / porPagina)) : 1;
  const actual = Math.min(pagina, paginas - 1);
  const visibles = porPagina
    ? ordenadas.slice(actual * porPagina, actual * porPagina + porPagina)
    : ordenadas;

  function alternar(clave: string) {
    setOrden((o) => (o?.clave === clave ? { clave, desc: !o.desc } : { clave, desc: false }));
  }

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
          {visibles.map((f) => (
            <tr
              key={f.id}
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
      </table>

      {porPagina && paginas > 1 && (
        <div className="hk-paginador">
          <span className="t-sm t-subtle">
            {actual * porPagina + 1}–{Math.min((actual + 1) * porPagina, total)} de {total}
          </span>
          <span className="spacer" />
          <button
            type="button" className="hk-btn hk-btn--ghost hk-btn--sm"
            disabled={actual === 0} onClick={() => setPagina(actual - 1)}
          >
            <ArrowLeft size={15} />Anterior
          </button>
          <span className="t-sm t-muted">{actual + 1} / {paginas}</span>
          <button
            type="button" className="hk-btn hk-btn--ghost hk-btn--sm"
            disabled={actual >= paginas - 1} onClick={() => setPagina(actual + 1)}
          >
            Siguiente<ArrowRight size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
