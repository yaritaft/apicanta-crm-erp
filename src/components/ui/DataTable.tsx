"use client";

import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";

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
  filas, columnas, onFila, acciones, ordenInicial, vacio, etiquetaFila, alto,
}: {
  filas: T[];
  columnas: Columna<T>[];
  onFila?: (fila: T) => void;
  acciones?: (fila: T) => React.ReactNode;
  ordenInicial?: { clave: string; desc: boolean };
  vacio: React.ReactNode;
  etiquetaFila?: (fila: T) => string;
  /* Alto maximo en px. Con esto la tabla scrollea adentro y la pagina deja de
     estirarse: 52 cuotas vencidas hacian que Finanzas no terminara nunca. El
     encabezado queda fijo, asi que se sigue sabiendo que columna es cual. */
  alto?: number;
}) {
  const [orden, setOrden] = useState(ordenInicial ?? null);

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
          {ordenadas.map((f) => (
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
    </div>
  );
}
