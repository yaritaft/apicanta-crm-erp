"use client";

import React, { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { FiltroColumna, textoFecha } from "@/components/crm-tabla/FiltroColumna";
import { textoDeFiltro, type FiltroColumna as Filtro } from "@/lib/crm-tabla";
import {
  filtroAURL, filtrosDeURL, MAX_ORDENES, opcionesDeColumna, ordenarFilas, ordenesAURL, ordenesDeURL, pasaFiltros,
  type ColumnasDe, type FiltrosDe, type OrdenDe,
} from "@/lib/tabla-filtros";
import { useEscribirURL } from "@/lib/useParamsURL";

/* ==================================================================
   Los filtros «como en Excel» de una tabla, con lo que hace falta para ponerlos
   en cualquier pantalla: el hook que lee filtros y orden del link y filtra y
   ordena las filas, el encabezado de cada columna (el menú del CRM) y las
   pastillas de lo que está filtrando. Lo usa Grupos de WhatsApp; Formularios
   lo arma a mano con las mismas piezas (lib/tabla-filtros.ts).
   ================================================================== */

export function useFiltrosExcel<F>(defs: ColumnasDe<F>, base: readonly F[], porDefecto: OrdenDe[]) {
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const texto = params.toString();
  const filtros = useMemo(() => filtrosDeURL(defs, new URLSearchParams(texto)), [defs, texto]);
  const ordenes = useMemo(() => ordenesDeURL(defs, params.get("orden"), porDefecto), [defs, params, porDefecto]);
  const filtradas = useMemo(() => base.filter((f) => pasaFiltros(defs, f, filtros)), [base, defs, filtros]);
  const ordenadas = useMemo(() => ordenarFilas(defs, filtradas, ordenes), [defs, filtradas, ordenes]);
  const cambiarFiltro = (clave: string, fc: Filtro | null) => escribir({ ...filtroAURL(clave, fc), pag: null });
  const ordenar = (os: OrdenDe[]) => escribir({ orden: ordenesAURL(os, porDefecto), pag: null });
  const limpiarFiltros = () => escribir({ ...Object.assign({}, ...Object.keys(defs).map((k) => filtroAURL(k, null))), orden: null, pag: null });
  return {
    filtros, ordenes, filtradas, ordenadas, cambiarFiltro, ordenar, limpiarFiltros,
    conFiltro: Object.keys(filtros), ordenDeSiempre: ordenesAURL(ordenes, porDefecto) === null,
  };
}

/** El título de una columna con su menú: ordenar por una o varias, tildar valores con su cuenta, «contiene», desde/hasta. */
export function EncabezadoExcel<F>({ defs, clave, base, filtros, ordenes, onFiltro, onOrdenar }: {
  defs: ColumnasDe<F>; clave: string; base: readonly F[]; filtros: FiltrosDe; ordenes: OrdenDe[];
  onFiltro: (clave: string, fc: Filtro | null) => void; onOrdenar: (os: OrdenDe[]) => void;
}) {
  const def = defs[clave];
  const puesto = ordenes.findIndex((o) => o.clave === clave);
  return (
    <FiltroColumna
      titulo={def.titulo}
      opciones={() => opcionesDeColumna(defs, base, filtros, clave)}
      filtro={filtros[clave]} onFiltro={(fc) => onFiltro(clave, fc)}
      orden={puesto >= 0 ? { desc: ordenes[puesto].desc, puesto: puesto + 1, de: ordenes.length } : undefined}
      onOrdenar={(desc) => onOrdenar([{ clave, desc }])}
      /* Como criterio siguiente; si ya ordena, le cambia el sentido. */
      onSumarOrden={(desc) => onOrdenar(puesto >= 0 ? ordenes.map((o) => (o.clave === clave ? { ...o, desc } : o)) : [...ordenes.slice(0, MAX_ORDENES - 1), { clave, desc }])}
      onQuitarOrden={() => onOrdenar(ordenes.filter((o) => o.clave !== clave))}
      ordenaPrimero={ordenes[0] && ordenes[0].clave !== clave ? defs[ordenes[0].clave]?.titulo : undefined}
      fecha={def.fecha} numerica={def.numerica}
    />
  );
}

/** Lo que está filtrando u ordenando, como pastillas que se sacan con la ×, y «Limpiar todo». `extra` es lo que la pantalla sume (la búsqueda, un chip). */
export function PastillasExcel<F>({ defs, filtros, conFiltro, ordenes, ordenDeSiempre, ordenPorDefecto, onFiltro, onOrdenar, onLimpiar, hayAlgo, children }: {
  defs: ColumnasDe<F>; filtros: FiltrosDe; conFiltro: string[]; ordenes: OrdenDe[]; ordenDeSiempre: boolean; ordenPorDefecto: OrdenDe[];
  onFiltro: (clave: string, fc: Filtro | null) => void; onOrdenar: (os: OrdenDe[]) => void; onLimpiar: () => void; hayAlgo: boolean; children?: React.ReactNode;
}) {
  return (
    <div className="crm-t__filtros">
      {children}
      {conFiltro.map((k) => (
        <span key={k} className="crm-t__pastilla">
          <span className="t-subtle">{defs[k].titulo}:</span>
          <span className="truncate">{textoDeFiltro(filtros[k], (x) => (defs[k].fecha ? textoFecha(x) : x))}</span>
          <button type="button" onClick={() => onFiltro(k, null)} aria-label={`Quitar el filtro de ${defs[k].titulo}`}><X size={13} /></button>
        </span>
      ))}
      {!ordenDeSiempre && (
        <span className="crm-t__pastilla">
          <span className="t-subtle">Orden:</span>
          <span className="truncate crm-t__orden">
            {ordenes.map((o) => (
              <span key={o.clave}>{defs[o.clave]?.titulo}{o.desc ? <ArrowDown size={12} aria-label="de mayor a menor" /> : <ArrowUp size={12} aria-label="de menor a mayor" />}</span>
            ))}
          </span>
          <button type="button" onClick={() => onOrdenar(ordenPorDefecto)} aria-label="Volver al orden de siempre"><X size={13} /></button>
        </span>
      )}
      {hayAlgo && <button type="button" className="link t-sm" onClick={onLimpiar}>Limpiar todo</button>}
    </div>
  );
}
