"use client";

import React, { useMemo, useState } from "react";
import { Pencil, Plus, Search, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Card, Chip, Empty, IconButton, Input, Select } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { ConfigColumnas, type DefColumna, useColumnas } from "@/components/ui/ColumnasConfig";
import { fechaHora, fechaLarga, money, num } from "@/lib/format";
import { gastosDelMes } from "@/lib/finanzas";
import { GRUPOS_GASTO, infoGrupo, montoOriginal, normalizar } from "@/lib/gastos";
import type { RangoMes } from "@/lib/metricas";
import type { EstadoApp, Gasto, GrupoGasto } from "@/lib/types";

/* ==================================================================
   La lista de gastos del período.

   Sale de gastosDelMes, la misma función que arma el estado de
   resultados: filtrada por bloque, la lista suma lo mismo que su
   renglón. Las columnas se prenden y se ordenan como en Marketing.
   ================================================================== */

const COLUMNAS: DefColumna[] = [
  { clave: "concepto", titulo: "Concepto", fija: true },
  { clave: "categoria", titulo: "Categoría", grupo: "Clasificación" },
  { clave: "grupo", titulo: "Bloque", grupo: "Clasificación", ayuda: "En qué parte del estado de resultados cae." },
  { clave: "tipo", titulo: "Fijo o variable", grupo: "Clasificación" },
  { clave: "fecha", titulo: "Fecha", grupo: "Cuándo" },
  { clave: "cargado", titulo: "Cargado", grupo: "Cuándo", ayuda: "Cuándo se cargó en el sistema." },
  { clave: "monto", titulo: "Monto", grupo: "Plata" },
  { clave: "original", titulo: "Pagado en", grupo: "Plata", ayuda: "Si se pagó en otra moneda: cuánto y a qué tipo de cambio." },
  { clave: "proveedor", titulo: "Proveedor", grupo: "Detalle" },
  { clave: "webinar", titulo: "Webinar", grupo: "Detalle" },
  { clave: "notas", titulo: "Notas", grupo: "Detalle" },
];

/* Seis, el máximo del design system antes de mandar algo a la ficha. */
const POR_DEFECTO = ["concepto", "categoria", "grupo", "fecha", "tipo", "monto"];

export const VARIANTE_GRUPO: Record<GrupoGasto, "warning" | "neutral" | "brand"> = {
  directo: "warning", operativo: "neutral", dueno: "brand",
};

export function ListaGastos({ e, mes, onNuevo, onVer, onEditar, onBorrar }: {
  e: EstadoApp;
  mes: RangoMes;
  onNuevo: () => void;
  onVer: (g: Gasto) => void;
  onEditar: (g: Gasto) => void;
  onBorrar: (g: Gasto) => void;
}) {
  const M = (n: number, d = 2) => money(n, e.ajustes.monedaBase, d);
  const cols = useColumnas("gastos", COLUMNAS, POR_DEFECTO);

  const [busca, setBusca] = useState("");
  const [grupo, setGrupo] = useState<GrupoGasto | "">("");
  const [categoria, setCategoria] = useState("");

  const delPeriodo = useMemo(() => gastosDelMes(e, mes), [e, mes]);

  const porGrupo = useMemo(() => {
    const n: Record<string, number> = {};
    for (const g of delPeriodo) n[g.grupo] = (n[g.grupo] ?? 0) + 1;
    return n;
  }, [delPeriodo]);

  /* Las categorías del selector son las que hay en el período (y en el
     bloque elegido), con cuántos gastos tiene cada una. */
  const categorias = useMemo(() => {
    const n = new Map<string, number>();
    for (const g of delPeriodo) if (!grupo || g.grupo === grupo) n.set(g.categoria, (n.get(g.categoria) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0], "es"));
  }, [delPeriodo, grupo]);

  const filtrados = useMemo(() => {
    const q = normalizar(busca);
    return delPeriodo.filter((g) =>
      (!grupo || g.grupo === grupo)
      && (!categoria || g.categoria === categoria)
      && (!q || [g.concepto, g.categoria, g.proveedor ?? "", g.notas ?? ""].some((x) => normalizar(x).includes(q))));
  }, [delPeriodo, grupo, categoria, busca]);

  const total = filtrados.reduce((a, g) => a + g.monto, 0);
  const totalPeriodo = delPeriodo.reduce((a, g) => a + g.monto, 0);
  const hayFiltro = Boolean(busca.trim() || grupo || categoria);
  const sacarFiltros = () => { setBusca(""); setGrupo(""); setCategoria(""); };

  const webinar = (id?: string) => (id ? e.webinars.find((w) => w.id === id)?.titulo : undefined);

  const DEF: Record<string, Columna<Gasto>> = {
    concepto: {
      clave: "concepto", titulo: "Concepto", tipo: "primary", orden: (g) => g.concepto,
      celda: (g) => <span className="truncate" style={{ display: "block", maxWidth: 300 }} title={g.concepto}>{g.concepto || g.categoria}</span>,
    },
    categoria: { clave: "categoria", titulo: "Categoría", tipo: "secondary", orden: (g) => g.categoria, celda: (g) => g.categoria },
    grupo: {
      clave: "grupo", titulo: "Bloque", orden: (g) => GRUPOS_GASTO.findIndex((x) => x.grupo === g.grupo),
      celda: (g) => <Badge variante={VARIANTE_GRUPO[g.grupo] ?? "neutral"}>{infoGrupo(g.grupo).corto}</Badge>,
    },
    tipo: { clave: "tipo", titulo: "Fijo o variable", tipo: "secondary", orden: (g) => (g.recurrente ? 0 : 1), celda: (g) => (g.recurrente ? "Fijo" : "Variable") },
    fecha: { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (g) => g.fecha, celda: (g) => fechaLarga(g.fecha) },
    cargado: { clave: "cargado", titulo: "Cargado", tipo: "secondary", orden: (g) => g.creadoEn ?? "", celda: (g) => fechaHora(g.creadoEn) },
    monto: { clave: "monto", titulo: "Monto", tipo: "num", orden: (g) => g.monto, celda: (g) => M(g.monto) },
    original: {
      clave: "original", titulo: "Pagado en", tipo: "secondary",
      orden: (g) => montoOriginal(g)?.monto ?? 0,
      celda: (g) => {
        const o = montoOriginal(g);
        return o ? `${money(o.monto, o.moneda, 2)} a ${num(o.tipoCambio, 2)}` : "—";
      },
    },
    proveedor: { clave: "proveedor", titulo: "Proveedor", orden: (g) => g.proveedor ?? "", celda: (g) => g.proveedor || "—" },
    webinar: {
      clave: "webinar", titulo: "Webinar", orden: (g) => webinar(g.webinarId) ?? "",
      celda: (g) => <span className="truncate" style={{ display: "block", maxWidth: 220 }}>{webinar(g.webinarId) ?? "—"}</span>,
    },
    notas: {
      clave: "notas", titulo: "Notas",
      celda: (g) => <span className="truncate" style={{ display: "block", maxWidth: 260 }} title={g.notas}>{g.notas || "—"}</span>,
    },
  };
  const columnas = cols.visibles.map((k) => DEF[k]).filter(Boolean);

  return (
    <div className="stack-4">
      <div className="gastos-filtros">
        <div className="gastos-filtros__busca">
          <Input
            value={busca} onChange={(ev) => setBusca(ev.target.value)} icono={<Search size={16} />}
            placeholder="Buscar por concepto, proveedor o nota" aria-label="Buscar gastos"
          />
        </div>
        <div className="gastos-filtros__categoria">
          <Select
            value={categoria} onChange={(ev) => setCategoria(ev.target.value)} placeholder="Todas las categorías"
            aria-label="Categoría"
            opciones={[
              /* Si la elegida ya no está en el período, igual tiene que verse. */
              ...(categoria && !categorias.some(([c]) => c === categoria) ? [{ valor: categoria, texto: `${categoria} (0)` }] : []),
              ...categorias.map(([c, n]) => ({ valor: c, texto: `${c} (${n})` })),
            ]}
          />
        </div>
        <span className="spacer" />
        <ConfigColumnas todas={COLUMNAS} visibles={cols.visibles} alternar={cols.alternar} mover={cols.mover} restaurar={cols.restaurar} />
      </div>

      <div className="row-wrap" role="group" aria-label="Bloque del estado de resultados">
        <Chip activo={grupo === ""} onClick={() => setGrupo("")} count={delPeriodo.length}>Todos</Chip>
        {GRUPOS_GASTO.map((g) => (
          <Chip key={g.grupo} activo={grupo === g.grupo} onClick={() => { setGrupo(grupo === g.grupo ? "" : g.grupo); setCategoria(""); }} count={porGrupo[g.grupo] ?? 0}>
            {g.titulo}
          </Chip>
        ))}
      </div>

      <Card className="gastos-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="gastos-total">
          <span className="t-strong">
            {num(filtrados.length)} {filtrados.length === 1 ? "gasto" : "gastos"}
            <span className="t-subtle" style={{ fontWeight: 400 }}> · {mes.etiqueta}</span>
          </span>
          <span className="spacer t-num t-strong">{M(total)}</span>
          {hayFiltro && <span className="t-sm t-subtle t-num">de {M(totalPeriodo)} en el período</span>}
        </div>
        <DataTable
          alto={520} porPagina={50}
          filas={filtrados} columnas={columnas}
          ordenInicial={{ clave: "fecha", desc: true }}
          onFila={onVer} etiquetaFila={(g) => `Ver ${g.concepto || g.categoria}`}
          acciones={(g) => (
            <>
              <IconButton etiqueta="Editar" onClick={() => onEditar(g)}><Pencil size={15} /></IconButton>
              <IconButton etiqueta="Eliminar" onClick={() => onBorrar(g)}><Trash2 size={15} /></IconButton>
            </>
          )}
          vacio={delPeriodo.length === 0 ? (
            <Empty
              icono={<Wallet size={22} />} titulo={`Sin gastos en ${mes.etiqueta}`}
              texto="Cargá lo que gastaste y el estado de resultados se rehace solo."
              accion={<Button variante="brand" icono={<Plus size={16} />} onClick={onNuevo}>Cargar un gasto</Button>}
            />
          ) : (
            <Empty
              icono={<Search size={22} />} titulo="Ningún gasto con estos filtros"
              texto="Probá con otra búsqueda, otra categoría u otro bloque."
              accion={<Button variante="secondary" onClick={sacarFiltros}>Sacar los filtros</Button>}
            />
          )}
        />
      </Card>
    </div>
  );
}
