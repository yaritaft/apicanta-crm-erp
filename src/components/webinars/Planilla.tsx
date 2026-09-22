"use client";

import React, { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Pencil } from "lucide-react";
import { CeldaEditable, type Direccion } from "./CeldaEditable";

/* ==================================================================
   Planilla: una tabla que se usa como Excel.

   - Las celdas editables se cargan en el lugar (ver CeldaEditable).
   - Las flechas se mueven entre celdas; Inicio/Fin van a la punta de la
     fila y RePág/AvPág saltan de a diez.
   - Toda la grilla es UNA parada del Tab (tab roving): entrar y salir
     con Tab no obliga a recorrer cien celdas.
   - La primera columna queda fija al scrollear de costado, el encabezado
     arriba y los totales abajo, así nunca se pierde qué es cada número.
   ================================================================== */

export interface NavCelda {
  tabIndex: number;
  "data-celda": string;
}

export interface ColumnaPlanilla<T> {
  clave: string;
  titulo: string;
  ayuda?: string;
  num?: boolean;
  /* Valor para ordenar; sin esto la columna no ordena. */
  orden?: (f: T) => string | number;
  /* La columna fija: recibe lo que la hace navegable con el teclado, para
     ponérselo al enlace que tenga adentro. */
  enlace?: (f: T, nav: NavCelda) => React.ReactNode;
  /* Una celda que se calcula sola. */
  celda?: (f: T) => React.ReactNode;
  /* Una celda que se carga a mano. */
  editable?: {
    valor: (f: T) => number;
    guardar: (f: T, n: number) => void;
    formato: (n: number) => string;
    decimales?: number;
    etiqueta: (f: T) => string;
  };
  /* Lo que va en la fila de totales. */
  total?: React.ReactNode;
}

export function Planilla<T extends { id: string }>({
  filas, columnas, ordenInicial, vacio, etiqueta, totalEtiqueta, onError,
}: {
  filas: T[];
  columnas: ColumnaPlanilla<T>[];
  ordenInicial?: { clave: string; desc: boolean };
  vacio: React.ReactNode;
  /* Nombre de la grilla para lectores de pantalla. */
  etiqueta: string;
  /* Primera celda de la fila de totales. Sin esto no hay fila de totales. */
  totalEtiqueta?: React.ReactNode;
  onError?: (mensaje: string) => void;
}) {
  const [orden, setOrden] = useState(ordenInicial ?? null);
  const [activa, setActiva] = useState<[number, number]>([0, 0]);
  const cajaRef = useRef<HTMLDivElement>(null);
  const tablaRef = useRef<HTMLTableElement>(null);

  /* El orden se calcula cuando cambia el conjunto de filas o el criterio,
     NO cuando cambia un valor. Si no, ordenando por formularios, cargar un
     número haría saltar la fila a otro lado en medio de la carga, y el
     Enter "bajaría" a una fila que ya no es la de abajo. Una planilla
     ordena cuando se lo pedís, no mientras escribís. */
  const conjunto = filas.map((f) => f.id).join("|");
  const ordenIds = useMemo(() => {
    const col = orden ? columnas.find((c) => c.clave === orden.clave) : undefined;
    if (!orden || !col?.orden) return filas.map((f) => f.id);
    const fn = col.orden;
    return [...filas].sort((a, b) => {
      const va = fn(a), vb = fn(b);
      const cmp = typeof va === "number" && typeof vb === "number"
        ? va - vb
        : String(va).localeCompare(String(vb), "es");
      return orden.desc ? -cmp : cmp;
    }).map((f) => f.id);
    // Sólo el conjunto y el criterio: ver el comentario de arriba.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conjunto, orden]);

  const porId = new Map(filas.map((f) => [f.id, f] as const));
  const ordenadas = ordenIds.map((id) => porId.get(id)).filter((f): f is T => Boolean(f));

  const nFilas = ordenadas.length;
  const nCols = columnas.length;
  const editables = columnas.map((c, i) => (c.editable ? i : -1)).filter((i) => i >= 0);

  /* La celda activa puede quedar afuera si se filtró o se sacó una columna. */
  const ar = Math.max(0, Math.min(activa[0], nFilas - 1));
  const ac = Math.max(0, Math.min(activa[1], nCols - 1));
  const nav = (r: number, c: number): NavCelda => ({
    tabIndex: r === ar && c === ac ? 0 : -1,
    "data-celda": `${r}:${c}`,
  });

  /* Lo que queda tapado por la columna fija no cuenta como visible: sin
     esto, ir con las flechas hacia la izquierda dejaba la celda debajo de
     los títulos. */
  useLayoutEffect(() => {
    const caja = cajaRef.current;
    const primera = caja?.querySelector("thead th");
    if (caja && primera) caja.style.setProperty("--planilla-fija", `${Math.round(primera.getBoundingClientRect().width)}px`);
  });

  function enfocar(r: number, c: number) {
    const f = Math.max(0, Math.min(r, nFilas - 1));
    const k = Math.max(0, Math.min(c, nCols - 1));
    const el = tablaRef.current?.querySelector<HTMLElement>(`[data-celda="${f}:${k}"]`);
    if (!el) return;
    setActiva([f, k]);
    el.focus();
  }

  /* Enter baja por la misma columna; Tab va a la próxima celda que se
     carga a mano, saltando las calculadas, y al final de la fila sigue en
     la de abajo, como cuando se completa un formulario. */
  function mover(r: number, c: number, hacia: Direccion) {
    if (hacia === "abajo") return enfocar(r + 1, c);
    if (hacia === "arriba") return enfocar(r - 1, c);
    const paso = hacia === "derecha" ? 1 : -1;
    const i = editables.indexOf(c) + paso;
    if (i >= 0 && i < editables.length) return enfocar(r, editables[i]);
    const r2 = r + paso;
    if (r2 < 0 || r2 >= nFilas) return enfocar(r, c);
    enfocar(r2, paso > 0 ? editables[0] : editables[editables.length - 1]);
  }

  function onKeyDown(ev: React.KeyboardEvent<HTMLTableElement>) {
    const el = ev.target as HTMLElement;
    if (el.tagName === "INPUT") return;
    const pos = el.getAttribute("data-celda");
    if (!pos) return;
    const [r, c] = pos.split(":").map(Number);
    const salto: Record<string, [number, number]> = {
      ArrowUp: [r - 1, c], ArrowDown: [r + 1, c],
      ArrowLeft: [r, c - 1], ArrowRight: [r, c + 1],
      Home: [ev.ctrlKey || ev.metaKey ? 0 : r, 0],
      End: [ev.ctrlKey || ev.metaKey ? nFilas - 1 : r, nCols - 1],
      PageUp: [r - 10, c], PageDown: [r + 10, c],
    };
    const d = salto[ev.key];
    if (!d) return;
    ev.preventDefault();
    enfocar(d[0], d[1]);
  }

  function onFocus(ev: React.FocusEvent<HTMLTableElement>) {
    const pos = (ev.target as HTMLElement).getAttribute("data-celda");
    if (!pos) return;
    const [r, c] = pos.split(":").map(Number);
    if (r !== activa[0] || c !== activa[1]) setActiva([r, c]);
  }

  function alternar(c: ColumnaPlanilla<T>) {
    /* Los números arrancan de mayor a menor: lo primero que se quiere ver
       es el que más vendió, no el que menos. */
    setOrden((o) => (o?.clave === c.clave ? { clave: c.clave, desc: !o.desc } : { clave: c.clave, desc: Boolean(c.num) }));
  }

  if (filas.length === 0) return <>{vacio}</>;

  return (
    <div className="planilla-caja" ref={cajaRef}>
      <table className="planilla" role="grid" aria-label={etiqueta} ref={tablaRef} onKeyDown={onKeyDown} onFocus={onFocus}>
        <thead>
          <tr>
            {columnas.map((c, i) => {
              const ordenada = orden?.clave === c.clave;
              const clases = [
                i === 0 ? "planilla__fija" : "",
                c.num ? "planilla__num" : "",
                c.editable ? "planilla__th--ed" : "",
              ].filter(Boolean).join(" ");
              const texto = (
                <>
                  {c.editable && <Pencil size={11} className="planilla__lapiz" aria-hidden />}
                  <span>{c.titulo}</span>
                  {ordenada && (orden.desc ? <ArrowDown size={13} aria-hidden /> : <ArrowUp size={13} aria-hidden />)}
                </>
              );
              return (
                <th
                  key={c.clave} scope="col" className={clases || undefined}
                  aria-sort={ordenada ? (orden.desc ? "descending" : "ascending") : undefined}
                  title={c.ayuda ? `${c.ayuda}${c.editable ? " Se carga a mano." : ""}` : undefined}
                >
                  {c.orden
                    ? <button type="button" className="planilla__orden" onClick={() => alternar(c)}>{texto}</button>
                    : <span className="planilla__orden planilla__orden--quieto">{texto}</span>}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((f, r) => (
            <tr key={f.id}>
              {columnas.map((c, i) => {
                if (c.enlace) {
                  return (
                    <th key={c.clave} scope="row" className={i === 0 ? "planilla__fija" : undefined}>
                      {c.enlace(f, nav(r, i))}
                    </th>
                  );
                }
                if (c.editable) {
                  const ed = c.editable;
                  const n = nav(r, i);
                  return (
                    <td key={c.clave} className="planilla__celda planilla__num">
                      <CeldaEditable
                        valor={ed.valor(f)} formato={ed.formato} decimales={ed.decimales}
                        etiqueta={ed.etiqueta(f)} onGuardar={(x) => ed.guardar(f, x)}
                        tabIndex={n.tabIndex} celda={n["data-celda"]}
                        onMover={(hacia) => mover(r, i, hacia)} onError={onError}
                      />
                    </td>
                  );
                }
                return (
                  <td key={c.clave} aria-readonly="true" className={`planilla__celda${c.num ? " planilla__num" : ""}${i === 0 ? " planilla__fija" : ""}`}>
                    <div className="planilla__ro" title="Se calcula solo" {...nav(r, i)}>
                      {c.celda?.(f)}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
        {totalEtiqueta !== undefined && (
          <tfoot>
            <tr>
              {columnas.map((c, i) => (
                <td key={c.clave} className={`${i === 0 ? "planilla__fija" : ""}${c.num ? " planilla__num" : ""}`.trim() || undefined}>
                  {i === 0 ? totalEtiqueta : c.total ?? ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}
