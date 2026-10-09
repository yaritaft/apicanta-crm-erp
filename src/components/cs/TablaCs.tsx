"use client";

import React, { useCallback, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowUp, FileSpreadsheet, Search, X } from "lucide-react";
import { Button, Card, Empty, Input } from "@/components/ui/ui";
import { DataTable, type Columna } from "@/components/ui/DataTable";
import { ConfigColumnas, useColumnas, type DefColumna } from "@/components/ui/ColumnasConfig";
import { CopiarLink } from "@/components/ui/Filtros";
import { VistasGuardadas } from "@/components/ui/VistasGuardadas";
import { useToast } from "@/components/ui/Toast";
import { FiltroColumna, textoFecha } from "@/components/crm-tabla/FiltroColumna";
import { hayFiltro, MAX_ORDENES, textoDeFiltro } from "@/lib/crm-tabla";
import { aLista } from "@/lib/compartirLink";
import { PARAM_VISTA } from "@/lib/vistas-guardadas";
import { bajarExcel } from "@/lib/excelCobros";
import { excelDeTabla, nombreArchivoCs, type ColumnaExcelCs } from "@/lib/excel-cs";
import { paginaDeURL, useBusquedaURL, useEscribirURL } from "@/lib/useParamsURL";
import { num } from "@/lib/format";
import type { ColumnaCs, Motor, OrdenCs } from "@/lib/tabla-cs";
import "./cs.css";

/* ==================================================================
   La tabla de Customer Success, fácil como un Excel: el armazón que comparten
   Clientes, Testimonios y la Agenda de resells (lib/tabla-cs.ts).

   Todo lo de una columna está en su título: ordenar por ella (y por más de
   una), tildar los valores que se quieren ver, o filtrar por un texto o entre
   dos fechas. La búsqueda, los filtros, el orden y las columnas van en el link
   y se guardan como una vista con nombre, sólo para uno o para todo el equipo
   (components/ui/VistasGuardadas). Qué muestra y cómo se corrige cada celda lo
   decide quien la usa (`celda`).
   ================================================================== */

export interface PropsTablaCs<F extends { id: string }, K extends string> {
  motor: Motor<F, K>;
  /* Para guardar las columnas y las vistas de esta tabla: «clientes-cs». */
  pantalla: string;
  filas: F[];
  coincide: (f: F, q: string) => boolean;
  visiblesPorDefecto: readonly K[];
  ordenPorDefecto: OrdenCs<K>[];
  /* La columna que identifica la fila: va siempre primera, fija a la izquierda. */
  fija: K;
  /* Si además hay otra fija antes (el N.º de alumno, antes del nombre): las dos quedan a la izquierda al correr las columnas. */
  fijaAntes?: K;
  /* El orden propio de los valores de una columna (las opciones de una lista, como se cargaron). */
  ordenValores?: Partial<Record<K, string[]>>;
  celda: (col: ColumnaCs<F, K>, f: F) => React.ReactNode;
  /* Qué lleva el Excel en cada celda. Sin esto, no hay botón. */
  excel?: { nombre: string; hoy: string; valor: (col: ColumnaCs<F, K>, f: F) => string | number | null };
  /* Los botones de la derecha de la barra. */
  acciones?: React.ReactNode;
  /* Lo que va junto a la búsqueda (atajos, como «CV pendiente»). */
  atajos?: React.ReactNode;
  singular: string;
  plural: string;
  /* Lo que se muestra cuando no hay nada que listar (sin filtros). */
  vacio: { titulo: string; texto: string; accion?: React.ReactNode };
  placeholder?: string;
  onFila?: (f: F) => void;
  etiquetaFila?: (f: F) => string;
  /* Los botones del final de cada fila. */
  filaAcciones?: (f: F) => React.ReactNode;
  /* Se llama con lo que se ve (filtrado y ordenado) y las columnas visibles, por si quien la usa lo necesita. */
  onVista?: (v: { filas: F[]; visibles: K[] }) => void;
}

export function TablaCs<F extends { id: string }, K extends string>(p: PropsTablaCs<F, K>) {
  const { motor, pantalla, filas, coincide, ordenPorDefecto, fija, fijaAntes, ordenValores, singular, plural } = p;
  const params = useSearchParams();
  const escribir = useEscribirURL();
  const toast = useToast();
  const [q, setQ] = useBusquedaURL(motor.paramBusqueda, [motor.paramPagina]);
  const [bajando, setBajando] = useState(false);

  const textoParams = params.toString();
  const filtros = useMemo(() => motor.filtrosDeURL(new URLSearchParams(textoParams)), [motor, textoParams]);
  const base = useMemo(() => filas.filter((f) => coincide(f, q)), [filas, coincide, q]);
  const filtradas = useMemo(() => base.filter((f) => motor.pasaFiltros(f, filtros)), [base, motor, filtros]);
  const ordenes = useMemo(
    () => motor.ordenesDeURL(params.get(motor.paramOrden), ordenPorDefecto),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [motor, params.get(motor.paramOrden), ordenPorDefecto],
  );
  const ordenadas = useMemo(() => motor.ordenarFilas(filtradas, ordenes, ordenValores), [motor, filtradas, ordenes, ordenValores]);
  const ordenar = useCallback(
    (os: OrdenCs<K>[]) => escribir({ [motor.paramOrden]: motor.ordenesAURL(os, ordenPorDefecto), [motor.paramPagina]: null }),
    [escribir, motor, ordenPorDefecto],
  );
  const ordenDeSiempre = motor.ordenesAURL(ordenes, ordenPorDefecto) === null;

  /* Las columnas: las que se ven de entrada, y las que cada uno prendió o apagó. */
  const defs = useMemo<DefColumna[]>(
    () => motor.columnas.map((c) => ({ clave: c.clave, titulo: c.titulo, grupo: c.grupo, ayuda: c.ayuda, fija: c.clave === fija || c.clave === fijaAntes })),
    [motor, fija, fijaAntes],
  );
  const porDefecto = useMemo(() => [...p.visiblesPorDefecto] as string[], [p.visiblesPorDefecto]);
  const cols = useColumnas(pantalla, defs, porDefecto);
  const visibles = useMemo(() => cols.visibles.filter((k): k is K => motor.esColumna(k)), [cols.visibles, motor]);

  const cambiarFiltro = useCallback(
    (clave: K, fc: Parameters<Motor<F, K>["filtroAURL"]>[1]) => escribir({ ...motor.filtroAURL(clave, fc), [motor.paramPagina]: null }),
    [escribir, motor],
  );
  const conFiltro = (Object.keys(filtros) as K[]).filter((k) => hayFiltro(filtros[k]));
  const hayAlgo = conFiltro.length > 0 || Boolean(q);
  const limpiar = () => escribir({
    ...Object.assign({}, ...(Object.keys(filtros) as K[]).map((k) => motor.filtroAURL(k, null))),
    [motor.paramBusqueda]: null, [motor.paramPagina]: null, [PARAM_VISTA]: null,
  });

  const vista = useMemo(() => ({ filas: ordenadas, visibles }), [ordenadas, visibles]);
  const { onVista } = p;
  React.useEffect(() => { onVista?.(vista); }, [onVista, vista]);

  async function descargar() {
    if (!p.excel || bajando || ordenadas.length === 0) return;
    setBajando(true);
    try {
      const { nombre, hoy, valor } = p.excel;
      const columnasExcel: ColumnaExcelCs<F>[] = visibles.map((k) => {
        const c = motor.columna[k];
        return {
          titulo: c.titulo, ancho: Math.max(10, Math.round((c.ancho ?? 140) / 7)),
          tipo: c.fecha ? "fecha" : c.numerica ? "numero" : "texto",
          celda: (f: F) => valor(c, f),
        };
      });
      const datos = await excelDeTabla(nombre, columnasExcel, ordenadas);
      bajarExcel(nombreArchivoCs(nombre, hoy), datos);
      toast(`Se bajó el Excel con ${num(ordenadas.length)} ${ordenadas.length === 1 ? singular : plural}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo armar el Excel.", "err");
    } finally {
      setBajando(false);
    }
  }

  const columnas: Columna<F>[] = visibles.map((k) => {
    const col = motor.columna[k];
    const puesto = ordenes.findIndex((o) => o.clave === col.clave);
    return {
      clave: col.clave,
      titulo: col.titulo,
      ancho: col.ancho,
      tipo: col.clave === fija ? "primary" as const : undefined,
      encabezado: (
        <span title={col.ayuda}>
          <FiltroColumna
            titulo={col.titulo}
            opciones={() => motor.opcionesDeColumna(base, filtros, col.clave, ordenValores?.[col.clave])}
            filtro={filtros[col.clave]}
            onFiltro={(fc) => cambiarFiltro(col.clave, fc)}
            orden={puesto >= 0 ? { desc: ordenes[puesto].desc, puesto: puesto + 1, de: ordenes.length } : undefined}
            onOrdenar={(desc) => ordenar([{ clave: col.clave, desc }])}
            /* Como criterio siguiente; si ya ordena, le cambia el sentido. */
            onSumarOrden={(desc) => ordenar(puesto >= 0
              ? ordenes.map((o) => (o.clave === col.clave ? { ...o, desc } : o))
              : [...ordenes.slice(0, MAX_ORDENES - 1), { clave: col.clave, desc }])}
            onQuitarOrden={() => ordenar(ordenes.filter((o) => o.clave !== col.clave))}
            ordenaPrimero={ordenes[0] && ordenes[0].clave !== col.clave ? motor.columna[ordenes[0].clave].titulo : undefined}
            fecha={col.fecha} numerica={col.numerica}
          />
        </span>
      ),
      celda: (f: F) => p.celda(col, f),
    };
  });

  return (
    <div className={`crm-t cs-t${fijaAntes ? " cs-t--doble" : ""}`}>
      <Card className="crm-t__card">
        <div className="crm-t__barra">
          <VistasGuardadas pantalla={pantalla} todas={`Todos los ${plural}`} extra={{ [`cols-${pantalla}`]: aLista(cols.visibles.filter((k) => k !== fija && k !== fijaAntes)) }} />
          <div className="crm-t__buscar">
            <Input icono={<Search size={16} />} value={q} onChange={(ev) => setQ(ev.target.value)} placeholder={p.placeholder ?? "Buscar"} aria-label="Buscar" />
          </div>
          {p.atajos}
          <div className="crm-t__acciones">
            <ConfigColumnas todas={defs} visibles={visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} compacto />
            <CopiarLink />
            {p.excel && (
              <Button sm variante="secondary" icono={<FileSpreadsheet size={15} />} disabled={ordenadas.length === 0 || bajando} onClick={() => void descargar()}
                title={`Los ${plural} que ves, con las columnas que ves, en un Excel`}>
                {bajando ? "Armando el Excel…" : "Excel"}
              </Button>
            )}
            {p.acciones}
          </div>
        </div>

        <div className="crm-t__filtros">
          <span className="t-sm t-subtle t-num crm-t__cuenta">
            {num(ordenadas.length)} {ordenadas.length === 1 ? singular : plural}
            {ordenadas.length !== filas.length ? ` de ${num(filas.length)}` : ""}
          </span>
          {conFiltro.map((k) => (
            <span key={k} className="crm-t__pastilla">
              <span className="t-subtle">{motor.columna[k].titulo}:</span>
              <span className="truncate">{textoDeFiltro(filtros[k]!, (v) => (motor.columna[k].fecha ? textoFecha(v) : v))}</span>
              <button type="button" onClick={() => cambiarFiltro(k, null)} aria-label={`Quitar el filtro de ${motor.columna[k].titulo}`}><X size={13} /></button>
            </span>
          ))}
          {!ordenDeSiempre && (
            <span className="crm-t__pastilla">
              <span className="t-subtle">Orden:</span>
              <span className="truncate crm-t__orden">
                {ordenes.map((o) => (
                  <span key={o.clave}>{motor.columna[o.clave].titulo}{o.desc ? <ArrowDown size={12} aria-label="de mayor a menor" /> : <ArrowUp size={12} aria-label="de menor a mayor" />}</span>
                ))}
              </span>
              <button type="button" onClick={() => ordenar(ordenPorDefecto)} aria-label="Volver al orden de siempre"><X size={13} /></button>
            </span>
          )}
          {hayAlgo && <button type="button" className="link t-sm" onClick={limpiar}>Limpiar todo</button>}
        </div>

        <DataTable
          filas={ordenadas}
          columnas={columnas}
          onFila={p.onFila} etiquetaFila={p.etiquetaFila} acciones={p.filaAcciones}
          pagina={paginaDeURL(params.get(motor.paramPagina) ?? "1") - 1}
          onPagina={(pg) => escribir({ [motor.paramPagina]: pg ? String(pg + 1) : null })}
          porPagina={50}
          vacio={
            hayAlgo
              ? <Empty icono={<Search size={22} />} titulo={`Ningún ${singular} coincide`} texto="Probá sacando algún filtro." accion={<Button variante="secondary" onClick={limpiar}>Limpiar filtros</Button>} />
              : <Empty icono={<Search size={22} />} titulo={p.vacio.titulo} texto={p.vacio.texto} accion={p.vacio.accion} />
          }
        />
      </Card>
    </div>
  );
}

/* ---------- Pedazos que se repiten en las celdas ---------- */

export const NADA = <span className="t-subtle">—</span>;

/** Un texto recortado con su valor completo al pasar el mouse. */
export function Recorte({ texto }: { texto: string }) {
  return texto ? <span className="truncate" title={texto}>{texto}</span> : NADA;
}
