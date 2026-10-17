"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Plus, Search } from "lucide-react";
import { CabeceraVista } from "@/components/finanzas/vistas/CabeceraVista";
import { Badge, Button, Card, Chip, Empty, Input, Select, StatCard } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CopiarLink } from "@/components/ui/Filtros";
import { FichaGasto } from "@/components/finanzas/FichaGasto";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { acciones, useEstado } from "@/lib/store";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { fechaLarga, money, num } from "@/lib/format";
import { nombrePeriodo } from "@/lib/periodos";
import { cuentasDe, resumenDe, transaccionesDe, type Transaccion } from "@/lib/transacciones";
import { normalizar } from "@/lib/gastos";
import { useBusquedaURL, useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import type { Gasto } from "@/lib/types";

/* ==================================================================
   Transacciones: todo lo que entró y salió, de todas las cuentas, en una
   sola lista (lib/transacciones.ts). Es el lugar de lo que antes se cargaba
   en la planilla de Transacciones: cobros, gastos, devoluciones, lo que volvió
   y los pases entre cuentas, cada uno una sola vez.

   Lo que se mira vive en la URL (se puede mandar el link):
   - mes: aaaa-mm, o «todos»; vacío es el mes en curso
   - tipo: ingresos, egresos, pases o sin-conciliar
   - cuenta: el nombre de la cuenta, o «sin-cuenta»
   - q: lo que se busca
   ================================================================== */

const VISTA = { mes: "", tipo: "", cuenta: "" };
const TIPOS = [
  ["", "Todo"],
  ["ingresos", "Ingresos"],
  ["egresos", "Egresos"],
  ["sin-conciliar", "Sin conciliar"],
  ["pases", "Entre cuentas"],
] as const;
type FiltroTipo = (typeof TIPOS)[number][0];
const SIN_CUENTA = "sin-cuenta";

const pasaTipo = (f: Transaccion, t: FiltroTipo): boolean => {
  switch (t) {
    case "ingresos": return f.tipo === "ingreso" && f.origen !== "sin-conciliar";
    case "egresos": return f.tipo === "egreso";
    case "sin-conciliar": return f.origen === "sin-conciliar";
    case "pases": return f.tipo === "pase";
    default: return true;
  }
};

const VARIANTE_ESTADO: Record<Transaccion["origen"], "success" | "warning" | "neutral" | "info"> = {
  cobro: "success", "ingreso-cargado": "success", "sin-conciliar": "warning", gasto: "neutral", devolucion: "warning", pase: "info",
};

export function TransaccionesVista({ embebido = false }: { embebido?: boolean }) {
  const e = useEstado();
  const toast = useToast();
  const router = useRouter();
  const abrirFicha = useAbrirFicha();
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 2, moneda = mon) => money(n, moneda, d);

  const [vista, setVista] = useParamsURL(VISTA);
  const [busca, setBusca] = useBusquedaURL("q");
  const tabla = useTablaURL("transacciones", { clave: "fecha", desc: true }, ["fecha", "titulo", "cuenta", "estado", "comision", "monto"]);

  /* Todo, una vez por cambio de datos; el mes y los filtros recortan esa lista. */
  const todas = useMemo(() => transaccionesDe(e).filas, [e]);
  const mesActual = diaDeNegocio(new Date().toISOString()).slice(0, 7);
  const mes = /^\d{4}-\d{2}$/.test(vista.mes) || vista.mes === "todos" ? vista.mes : mesActual;
  const meses = useMemo(() => {
    const k = new Set<string>([mesActual]);
    for (const f of todas) k.add(f.dia.slice(0, 7));
    return [...k].sort().reverse();
  }, [todas, mesActual]);

  const delMes = useMemo(() => (mes === "todos" ? todas : todas.filter((f) => f.dia.startsWith(mes))), [todas, mes]);
  const tipo = (TIPOS.some(([k]) => k === vista.tipo) ? vista.tipo : "") as FiltroTipo;
  const cuentas = useMemo(() => cuentasDe(delMes), [delMes]);
  const cuenta = vista.cuenta === SIN_CUENTA || cuentas.some((c) => c.cuenta === vista.cuenta) ? vista.cuenta : "";

  /* Primero cuenta y búsqueda: los números de cada pestaña salen de ahí, y la pestaña recorta después. */
  const base = useMemo(() => {
    const q = normalizar(busca);
    return delMes.filter((f) =>
      (!cuenta || (cuenta === SIN_CUENTA ? f.cuenta === "" : f.cuenta === cuenta))
      && (!q || normalizar([f.titulo, f.detalle, f.cuenta, f.estado].join(" ")).includes(q)));
  }, [delMes, cuenta, busca]);
  const filas = useMemo(() => base.filter((f) => pasaTipo(f, tipo)), [base, tipo]);
  const resumen = useMemo(() => resumenDe(base), [base]);
  const cuentaN = (t: FiltroTipo) => base.filter((f) => pasaTipo(f, t)).length;

  const [verId, setVerId] = useState<string | null>(null);
  const [asistente, setAsistente] = useState<{ gasto: Gasto | null } | null>(null);
  const [borrar, setBorrar] = useState<Gasto | null>(null);
  const gVista = verId ? e.gastos.find((g) => g.id === verId) ?? null : null;

  const abrir = (f: Transaccion) => {
    if (f.gastoId) { setVerId(f.gastoId); return; }
    if (f.origen === "cobro" && f.ventaId) { abrirFicha(f.ventaId); return; }
    if (f.origen === "sin-conciliar") { router.push(`/conciliacion?mes=${f.dia.slice(0, 7)}`); return; }
    if (f.origen === "devolucion") { router.push(`/finanzas/detalle?seccion=devoluciones&periodo=custom&desde=${f.dia}&hasta=${f.dia}`); return; }
    if (f.origen === "pase") router.push("/finanzas/caja");
  };

  const monto = (f: Transaccion) => {
    const s = M(f.monto, 2, f.moneda);
    if (f.tipo === "pase") return <span className="t-subtle">{s}</span>;
    if (f.origen === "sin-conciliar") return <span style={{ color: "var(--warning)" }} title="Entró pero todavía no cuenta como cobrado">{s}</span>;
    return f.tipo === "ingreso" ? <span style={{ color: "var(--success)" }}>+{s}</span> : <span>−{s}</span>;
  };

  const columnas: Columna<Transaccion>[] = [
    { clave: "fecha", titulo: "Fecha", tipo: "secondary", orden: (f) => f.fecha, celda: (f) => fechaLarga(f.fecha) },
    {
      clave: "titulo", titulo: "Qué", tipo: "primary", orden: (f) => f.titulo,
      celda: (f) => (
        <span style={{ display: "block", minWidth: 0 }}>
          <span className="truncate" style={{ display: "block", maxWidth: 320 }} title={f.titulo}>{f.titulo}</span>
          {f.detalle && <span className="t-sm t-subtle truncate" style={{ display: "block", maxWidth: 320 }} title={f.detalle}>{f.detalle}</span>}
        </span>
      ),
    },
    { clave: "cuenta", titulo: "Cuenta", tipo: "secondary", orden: (f) => f.cuenta, celda: (f) => f.cuenta || <span className="t-subtle">—</span> },
    { clave: "estado", titulo: "Estado", orden: (f) => f.estado, celda: (f) => <Badge variante={VARIANTE_ESTADO[f.origen]}>{f.estado}</Badge> },
    {
      clave: "comision", titulo: "Comisión", tipo: "num", orden: (f) => f.comision ?? 0,
      celda: (f) => (f.comision ? M(f.comision, 2, f.moneda) : <span className="t-subtle">—</span>),
    },
    { clave: "monto", titulo: "Monto", tipo: "num", orden: (f) => (f.tipo === "egreso" ? -f.monto : f.monto), celda: monto },
  ];

  const nombreMes = mes === "todos" ? "todos los meses" : nombrePeriodo(mes);
  const hayFiltro = Boolean(busca.trim() || cuenta || tipo);

  return (
    <div className="stack-5">
      <CabeceraVista embebido={embebido}
        titulo="Transacciones"
        sub="Todo lo que entró y salió, de todas las cuentas, en un solo lugar: cobros, gastos, devoluciones, lo que volvió y los pases entre cuentas."
        acciones={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setAsistente({ gasto: null })}>Cargar gasto o ingreso</Button>}
      />

      <div className="grid-stats">
        <StatCard
          etiqueta="Ingresos" valor={M(resumen.ingresos, 0)} direccion="up"
          contexto={`${nombreMes}${resumen.sinConciliarN ? ` · ${resumen.sinConciliarN} sin conciliar aparte` : ""}`}
          onClick={() => setVista({ tipo: "ingresos" })}
          info={{
            ayuda: "Lo que entró: cobros imputados a una cuota y plata que volvió (un reembolso). Lo que entró a una pasarela y todavía no se ató a una cuota no se suma: está en «Sin conciliar».",
            formula: "Cobros del período + ingresos cargados\n(sin lo sin conciliar ni los pases entre cuentas)",
          }}
        />
        <StatCard
          etiqueta="Egresos" valor={M(resumen.egresos, 0)} direccion="down"
          contexto={nombreMes}
          onClick={() => setVista({ tipo: "egresos" })}
          info={{
            ayuda: "Lo que salió: gastos (el día que se pagaron), retiros y devoluciones a clientes.",
            formula: "Gastos pagados + retiros + devoluciones del período\n(sin los pases entre cuentas)",
          }}
        />
        <StatCard
          etiqueta="Neto" valor={M(resumen.neto, 0)} direccion={resumen.neto >= 0 ? "up" : "down"}
          contexto="Ingresos − egresos"
          info={{ ayuda: "Lo que quedó en el período entre lo que entró y lo que salió, sin contar lo sin conciliar ni los pases entre cuentas.", formula: "Ingresos − Egresos" }}
        />
        <StatCard
          etiqueta="Sin conciliar" valor={M(resumen.sinConciliar, 0)} direccion={resumen.sinConciliarN ? "down" : "neutral"}
          contexto={`${num(resumen.sinConciliarN)} ${resumen.sinConciliarN === 1 ? "cobro" : "cobros"} · todavía no cuentan`}
          onClick={() => setVista({ tipo: "sin-conciliar" })}
          info={{ ayuda: "Plata que entró a una pasarela o al banco y todavía no se ató a una cuota. Se resuelve en Conciliación.", formula: "Suma de los cobros en estado Pendiente del período", href: "/conciliacion" }}
        />
      </div>

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "var(--space-4)" }}>
          <div className="toolbar" style={{ marginBottom: 0 }} role="group" aria-label="Tipo de movimiento">
            {TIPOS.map(([k, t]) => (
              <Chip key={k || "todo"} activo={tipo === k} onClick={() => setVista({ tipo: k || null })} count={cuentaN(k)}>{t}</Chip>
            ))}
            <span className="spacer" />
            <CopiarLink />
          </div>

          <div className="row-wrap" style={{ marginTop: "var(--space-3)" }}>
            <span className="t-label" style={{ marginRight: 4 }}>Mes</span>
            <div style={{ minWidth: 200 }}>
              <Select
                aria-label="Mes" value={mes}
                onChange={(ev) => setVista({ mes: ev.target.value === mesActual ? null : ev.target.value })}
                opciones={[...meses.map((m) => ({ valor: m, texto: nombrePeriodo(m) })), { valor: "todos", texto: "Todos los meses" }]}
              />
            </div>
            <span className="t-label" style={{ marginLeft: 8, marginRight: 4 }}>Cuenta</span>
            <div style={{ minWidth: 200 }}>
              <Select
                aria-label="Cuenta" value={cuenta} placeholder="Todas las cuentas"
                onChange={(ev) => setVista({ cuenta: ev.target.value || null })}
                opciones={cuentas.map((c) => ({ valor: c.cuenta || SIN_CUENTA, texto: `${c.cuenta || "Sin cuenta"} (${c.n})` }))}
              />
            </div>
          </div>

          <div style={{ marginTop: "var(--space-3)", maxWidth: 520 }}>
            <Input
              icono={<Search size={15} />} value={busca} onChange={(ev) => setBusca(ev.target.value)}
              placeholder="Buscar por nombre, concepto, categoría, proveedor o cuenta" aria-label="Buscar transacciones"
            />
          </div>
        </div>

        <DataTable
          alto={560} porPagina={50}
          filas={filas} columnas={columnas}
          orden={tabla.orden} onOrden={tabla.onOrden}
          pagina={tabla.pagina} onPagina={tabla.onPagina}
          onFila={abrir} etiquetaFila={(f) => `Ver ${f.titulo}`}
          vacio={
            <Empty
              icono={<ArrowLeftRight size={22} />}
              titulo={hayFiltro ? "Nada con estos filtros" : `Sin movimientos en ${nombreMes}`}
              texto={hayFiltro ? "Probá con otra búsqueda, otra cuenta u otro tipo." : "Cuando entre un cobro o se cargue un gasto, aparece acá."}
              accion={hayFiltro ? <Button variante="secondary" onClick={() => { setBusca(""); setVista({ tipo: null, cuenta: null }); }}>Sacar los filtros</Button> : undefined}
            />
          }
        />
      </Card>

      {gVista && !asistente && (
        <FichaGasto
          gasto={gVista} e={e}
          onCerrar={() => setVerId(null)}
          onEditar={() => setAsistente({ gasto: gVista })}
          onBorrar={() => setBorrar(gVista)}
        />
      )}

      {asistente && (
        <AsistenteGasto
          gasto={asistente.gasto}
          onCerrar={() => setAsistente(null)}
          onListo={(g, editado) => {
            setAsistente(null);
            const mesDelGasto = diaDeNegocio(g.fecha).slice(0, 7);
            const fuera = mes !== "todos" && mesDelGasto !== mes;
            const que = g.monto < 0 ? "Ingreso" : "Gasto";
            toast(fuera
              ? `${que} ${editado ? "guardado" : "cargado"}. Es de ${nombrePeriodo(mesDelGasto)}: no entra en el mes que estás mirando.`
              : editado ? `${que} actualizado.` : `${que} cargado: ${g.concepto}.`, fuera ? "info" : undefined);
          }}
        />
      )}

      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)}
        titulo={borrar && borrar.monto < 0 ? "¿Eliminar este ingreso?" : "¿Eliminar este gasto?"}
        texto={`Se borra «${borrar?.concepto}» y el estado de resultados se recalcula.`}
        onConfirmar={() => {
          if (!borrar) return;
          acciones.eliminar("gastos", borrar.id, borrar.concepto);
          if (verId === borrar.id) setVerId(null);
          toast(borrar.monto < 0 ? "Ingreso eliminado." : "Gasto eliminado.");
        }}
      />
    </div>
  );
}
