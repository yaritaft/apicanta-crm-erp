"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, ClipboardPaste, CreditCard, Plus, Search } from "lucide-react";
import { CabeceraVista } from "@/components/finanzas/vistas/CabeceraVista";
import { Badge, Button, Card, Chip, Empty, Input, Select, StatCard } from "@/components/ui/ui";
import { type Columna, DataTable } from "@/components/ui/DataTable";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CopiarLink } from "@/components/ui/Filtros";
import { FichaGasto } from "@/components/finanzas/FichaGasto";
import { AsistenteGasto } from "@/components/finanzas/AsistenteGasto";
import { CargaDeGastosMasiva } from "@/components/finanzas/CargaDeGastosMasiva";
import { AyudaDeFinanzas } from "@/components/finanzas/AyudaDeFinanzas";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { acciones, useEstado } from "@/lib/store";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { fechaLarga, money, num } from "@/lib/format";
import { nombrePeriodo } from "@/lib/periodos";
import { cuentasDe, resumenDe, transaccionesDe, type Transaccion } from "@/lib/transacciones";
import { normalizar } from "@/lib/gastos";
import { esPagoDeTarjeta } from "@/lib/reparto-tarjeta";
import { esGastoDeComisionDeProcesador } from "@/lib/gastos-mercury";
import { useBusquedaURL, useParamsURL, useTablaURL } from "@/lib/useParamsURL";
import type { Gasto } from "@/lib/types";

/* ==================================================================
   Transacciones: todo lo que entró y salió, de todas las cuentas, en una
   sola lista (lib/transacciones.ts). Es el lugar de lo que antes se cargaba
   en la planilla de Transacciones: cobros, gastos, devoluciones, lo que volvió
   y los pases entre cuentas, cada uno una sola vez.

   Lo que se mira vive en la URL (se puede mandar el link):
   - mes: aaaa-mm, o «todos»; vacío es el mes en curso
   - dia: aaaa-mm-dd; un solo día (los ingresos de hoy, de ayer), sin importar el mes
   - tipo: entradas (todo lo que entró, también lo que todavía espera su venta), ingresos, egresos, pases, sin-conciliar o sin-venta
   - cuenta: el nombre de la cuenta, o «sin-cuenta»
   - q: lo que se busca
   ================================================================== */

const VISTA = { mes: "", tipo: "", cuenta: "", dia: "" };
const TIPOS = [
  ["", "Todo"],
  ["entradas", "Lo que entró"],
  ["ingresos", "Ingresos"],
  ["egresos", "Egresos"],
  ["sin-conciliar", "Sin conciliar"],
  ["sin-venta", "Sin venta"],
  ["pases", "Entre cuentas"],
] as const;
type FiltroTipo = (typeof TIPOS)[number][0];
const SIN_CUENTA = "sin-cuenta";

const pasaTipo = (f: Transaccion, t: FiltroTipo): boolean => {
  switch (t) {
    case "entradas": return f.tipo === "ingreso" && f.origen !== "sin-venta";
    case "ingresos": return f.tipo === "ingreso" && f.origen !== "sin-conciliar";
    case "egresos": return f.tipo === "egreso";
    case "sin-conciliar": return f.origen === "sin-conciliar" || f.origen === "reembolso-propuesto";
    case "sin-venta": return f.origen === "sin-venta" || f.origen === "sin-devolucion";
    case "pases": return f.tipo === "pase";
    default: return true;
  }
};

const VARIANTE_ESTADO: Record<Transaccion["origen"], "success" | "warning" | "neutral" | "info"> = {
  cobro: "success", "ingreso-cargado": "success", "sin-conciliar": "warning", "reembolso-propuesto": "warning",
  "sin-venta": "neutral", "sin-devolucion": "neutral", gasto: "neutral", devolucion: "warning", pase: "info",
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

  /* Un solo día (Aldana, 22/10: «un lugar donde pueda ver los ingresos del día»): hoy, ayer o el que se elija. Manda sobre el mes. */
  const hoy = diaDeNegocio(new Date().toISOString());
  const ayer = diaDeNegocio(new Date(Date.now() - 86400000).toISOString());
  const dia = /^\d{4}-\d{2}-\d{2}$/.test(vista.dia) ? vista.dia : "";
  const delMes = useMemo(
    () => (dia ? todas.filter((f) => f.dia === dia) : mes === "todos" ? todas : todas.filter((f) => f.dia.startsWith(mes))),
    [todas, mes, dia],
  );
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
  const [masiva, setMasiva] = useState(false);
  const [borrar, setBorrar] = useState<Gasto | null>(null);
  const gVista = verId ? e.gastos.find((g) => g.id === verId) ?? null : null;
  /* Los pagos de la tarjeta de crédito que siguen siendo un solo gasto: las compras de adentro no tienen su categoría (Aldana, 24/10). */
  const tarjetasSinRepartir = useMemo(
    () => e.gastos.filter(esPagoDeTarjeta).sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha)),
    [e.gastos],
  );

  /* Las comisiones de procesador cargadas como gasto (de una planilla): el sistema ya las calcula de cada cobro, así que cuentan dos veces. */
  const comisionesDuplicadas = useMemo(() => e.gastos.filter(esGastoDeComisionDeProcesador), [e.gastos]);
  const [quitandoComisiones, setQuitandoComisiones] = useState(false);

  const abrir = (f: Transaccion) => {
    if (f.gastoId) { setVerId(f.gastoId); return; }
    if (f.origen === "cobro" && f.ventaId) { abrirFicha(f.ventaId); return; }
    if (f.origen === "sin-conciliar" || f.origen === "reembolso-propuesto") { router.push(`/conciliacion?mes=${f.dia.slice(0, 7)}`); return; }
    if (f.origen === "sin-venta" || f.origen === "sin-devolucion") { router.push(`/conciliacion?mes=${f.dia.slice(0, 7)}&estado=ignorado`); return; }
    if (f.origen === "devolucion") { router.push(`/finanzas/detalle?seccion=devoluciones&periodo=custom&desde=${f.dia}&hasta=${f.dia}`); return; }
    if (f.origen === "pase") router.push("/finanzas/caja");
  };

  const monto = (f: Transaccion) => {
    const s = M(f.monto, 2, f.moneda);
    if (f.tipo === "pase") return <span className="t-subtle">{s}</span>;
    if (f.origen === "sin-conciliar") return <span style={{ color: "var(--warning)" }} title="Entró pero todavía no cuenta como cobrado">{s}</span>;
    if (f.origen === "sin-venta" || f.origen === "sin-devolucion" || f.origen === "reembolso-propuesto") return <span className="t-subtle" title="Se ve con su motivo, pero no suma en los totales">{s}</span>;
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

  const nombreDia = (d: string) => (d === hoy ? "hoy" : d === ayer ? "ayer" : `el ${d.slice(8, 10)}/${d.slice(5, 7)}`);
  const nombreMes = dia ? nombreDia(dia) : mes === "todos" ? "todos los meses" : nombrePeriodo(mes);
  const hayFiltro = Boolean(busca.trim() || cuenta || tipo || dia);

  return (
    <div className="stack-5">
      <CabeceraVista embebido={embebido}
        titulo="Transacciones"
        sub="Todo lo que entró y salió, de todas las cuentas, en un solo lugar: cobros, gastos, devoluciones, lo que volvió y los pases entre cuentas."
        acciones={(
          <div className="row-wrap">
            <AyudaDeFinanzas />
            <Button variante="secondary" icono={<ClipboardPaste size={16} />} onClick={() => setMasiva(true)}
              title="Pegá las filas de una planilla de Excel y cargá muchos gastos de una vez.">Cargar varios</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setAsistente({ gasto: null })}>Cargar gasto o ingreso</Button>
          </div>
        )}
      />

      {comisionesDuplicadas.length > 0 && (
        <div className="aviso-duplicado" role="status">
          <div className="aviso-duplicado__fila">
            <CreditCard size={16} aria-hidden />
            <span className="aviso-duplicado__texto">
              <strong>{comisionesDuplicadas.length === 1 ? "1 gasto es la comisión de un procesador" : `${comisionesDuplicadas.length} gastos son comisiones de procesadores`} ({M(comisionesDuplicadas.reduce((a, g) => a + g.monto, 0), 2)}): </strong>
              el sistema ya calcula la comisión de cada cobro, así que cargadas además como gasto cuentan dos veces y bajan el profit.
            </span>
            <span className="aviso-duplicado__acciones">
              <Button sm variante="primary" onClick={() => setQuitandoComisiones(true)}>Quitarlas</Button>
            </span>
          </div>
        </div>
      )}

      {tarjetasSinRepartir.length > 0 && (
        <div className="aviso-duplicado" role="status">
          <div className="aviso-duplicado__fila">
            <CreditCard size={16} aria-hidden />
            <span className="aviso-duplicado__texto">
              <strong>{tarjetasSinRepartir.length === 1 ? "1 pago de la tarjeta de crédito" : `${tarjetasSinRepartir.length} pagos de la tarjeta de crédito`} sin repartir: </strong>
              {M(tarjetasSinRepartir.reduce((a, g) => a + g.monto, 0), 2)} en un solo gasto cada uno. El banco no detalla las compras: repartilas para que cada una caiga en su categoría.
            </span>
            <span className="aviso-duplicado__acciones">
              <Button sm variante="primary" onClick={() => setVerId(tarjetasSinRepartir[0].id)}>Repartir el último</Button>
            </span>
          </div>
        </div>
      )}

      <div className="grid-stats">
        <StatCard
          etiqueta="Ingresos" valor={M(resumen.ingresos, 0)} direccion="up"
          contexto={`${nombreMes}${resumen.sinConciliarN ? ` · ${resumen.sinConciliarN} sin conciliar aparte (${M(resumen.sinConciliar, 0)})` : ""}${resumen.sinVentaN ? ` · ${resumen.sinVentaN} sin venta aparte` : ""}`}
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

          <div className="row-wrap" style={{ marginTop: "var(--space-3)" }} role="group" aria-label="Día">
            <span className="t-label" style={{ marginRight: 4 }}>Día</span>
            <Chip activo={dia === hoy} onClick={() => setVista({ dia: dia === hoy ? null : hoy, tipo: dia === hoy ? null : "entradas" })}>Hoy</Chip>
            <Chip activo={dia === ayer} onClick={() => setVista({ dia: dia === ayer ? null : ayer, tipo: dia === ayer ? null : "entradas" })}>Ayer</Chip>
            <div style={{ width: 170 }}>
              <Input type="date" aria-label="Elegir un día" value={dia} max={hoy}
                onChange={(ev) => setVista({ dia: ev.target.value || null, ...(ev.target.value && !tipo ? { tipo: "entradas" } : {}) })} />
            </div>
            {dia && <Button sm variante="ghost" onClick={() => setVista({ dia: null })}>Ver el mes</Button>}
          </div>

          <div className="row-wrap" style={{ marginTop: "var(--space-3)" }}>
            {!dia && (
              <>
                <span className="t-label" style={{ marginRight: 4 }}>Mes</span>
                <div style={{ minWidth: 200 }}>
                  <Select
                    aria-label="Mes" value={mes}
                    onChange={(ev) => setVista({ mes: ev.target.value === mesActual ? null : ev.target.value })}
                    opciones={[...meses.map((m) => ({ valor: m, texto: nombrePeriodo(m) })), { valor: "todos", texto: "Todos los meses" }]}
                  />
                </div>
              </>
            )}
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
              accion={hayFiltro ? <Button variante="secondary" onClick={() => { setBusca(""); setVista({ tipo: null, cuenta: null, dia: null }); }}>Sacar los filtros</Button> : undefined}
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

      {masiva && (
        <CargaDeGastosMasiva
          e={e} onCerrar={() => setMasiva(false)}
          onListo={({ loteId, cargados, quitados }) => {
            setMasiva(false);
            toast(
              `Se ${cargados === 1 ? "cargó 1 gasto" : `cargaron ${cargados} gastos`}${quitados ? ` y se ${quitados === 1 ? "quitó 1 pago" : `quitaron ${quitados} pagos`} de la tarjeta que ya estaban en esas compras` : ""}. Si no eran, los sacás todos juntos${quitados ? " (los pagos quitados no vuelven)" : ""}.`,
              "ok",
              { texto: "Deshacer", onClick: () => { const n = acciones.deshacerCargaDeGastos(loteId); toast(n ? `Se deshizo la carga: ${n} ${n === 1 ? "gasto" : "gastos"} menos.` : "Esa carga ya no estaba."); } },
            );
          }}
        />
      )}

      <Confirmar
        abierto={quitandoComisiones} onCerrar={() => setQuitandoComisiones(false)}
        titulo="¿Quitar las comisiones de procesador cargadas como gasto?"
        texto={`Se quitan ${comisionesDuplicadas.length} gastos (${M(comisionesDuplicadas.reduce((a, g) => a + g.monto, 0), 2)}): ${comisionesDuplicadas.slice(0, 5).map((g) => g.concepto).join(", ")}${comisionesDuplicadas.length > 5 ? "…" : ""}. La comisión de cada cobro sigue restando sola.`}
        onConfirmar={() => {
          const n = acciones.quitarGastos(comisionesDuplicadas.map((g) => g.id), "comisiones de procesador: ya se calculan de cada cobro");
          toast(`Se quitaron ${n} ${n === 1 ? "gasto" : "gastos"}.`);
        }}
      />

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
