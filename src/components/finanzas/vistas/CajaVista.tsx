"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRightLeft, Check, ChevronRight, HandCoins, Info, Landmark, Plus, RefreshCw, Trash2 } from "lucide-react";
import { CabeceraVista } from "@/components/finanzas/vistas/CabeceraVista";
import { Ayuda, Badge, Button, Card, CardHead, Empty, Field, IconButton, Input, Select, StatCard, Textarea } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { DataTable } from "@/components/ui/DataTable";
import { Confirmar, Modal, ModalForm } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { fechaLarga, money, num } from "@/lib/format";
import { aMonedaBase, escribirMonto, fechaDePago, leerMonto } from "@/lib/gastos";
import {
  MESES_DE_COLCHON, cajaEsperada, cobrosSinVenta, cobrosSinVentaPorCuenta, detalleDeSaldo, efectoDelCambio, enOtros, monedasDelSaldo, runway, totalDelDetalle, ultimoArqueo, type MovimientoCaja,
} from "@/lib/caja";
import "./arqueo-detalle.css";
import { primerConteo } from "@/lib/primer-conteo";
import { saldosEsperados } from "@/lib/traspasos";
import { controlarSaldos, quePasa, saldoParaElArqueo, textoDeLoPendiente, TOLERANCIA_DE_SALDO, type ControlDeSaldos, type RespuestaDeSaldos } from "@/lib/saldos-reales";
import { traerSaldosReales } from "@/lib/saldos-cliente";
import { nube } from "@/lib/supabase";
import type { Arqueo, EstadoApp, Gasto, Moneda, Procesador, SaldoCuenta, Traspaso } from "@/lib/types";
import { CopiarLink } from "@/components/ui/Filtros";
import { FormTraspaso, PasesEntreCuentas } from "@/components/finanzas/PasesEntreCuentas";
import { MovimientosDeLaCuenta } from "@/components/finanzas/MovimientosDeLaCuenta";
import { useTablaURL } from "@/lib/useParamsURL";

/* ==================================================================
   Caja: cuánta plata hay de verdad, cuántos meses de vida le da al
   negocio y si las cuentas dan (lib/caja.ts).

   Yari: "una vez por semana la asistente de finanzas me decía: ¿cuánta
   plata tenés en Trust? Y así hacía el arqueo". Acá se cuenta cada cuenta
   (las que tienen API y las que no) y la app lo compara con lo que
   esperaba.

   La plata que pasa de una cuenta a otra (lib/traspasos.ts) no mueve el
   total, pero sí lo que tendría que haber en cada una: con los
   movimientos entre cuentas cargados, el arqueo lo dice cuenta por cuenta.
   ================================================================== */

const hoyIso = () => new Date().toISOString();
const diaAr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);

export function CajaVista({ embebido = false, rangoFijo }: {
  embebido?: boolean;
  /* Adentro de un paso: los movimientos entre cuentas son sólo los de esos días. */
  rangoFijo?: { desde: string; hasta: string };
}) {
  const e = useEstado();
  const toast = useToast();
  const mon = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, mon, d);
  /* «traer»: el arqueo se abre ya con los saldos reales leídos de las cuentas. */
  const [arqueando, setArqueando] = useState<false | "vacio" | "traer">(false);
  const [retirando, setRetirando] = useState(false);
  /* El movimiento entre cuentas que se corrige, o uno nuevo. */
  const [pase, setPase] = useState<Traspaso | "nuevo" | null>(null);
  const [ver, setVer] = useState<Arqueo | null>(null);
  const [borrar, setBorrar] = useState<Arqueo | null>(null);
  /* El orden de cada cuadro va en el link: ?orden-arqueos y ?orden-retiros. */
  const tablaArqueos = useTablaURL("arqueos", { clave: "fecha", desc: true }, ["fecha", "total", "esperado", "dif", "por"]);
  const tablaRetiros = useTablaURL("retiros", { clave: "fecha", desc: true }, ["fecha", "concepto", "monto"]);

  const ultimo = ultimoArqueo(e);
  const mov = useMemo(() => (ultimo ? cajaEsperada(e, ultimo, hoyIso()) : null), [e, ultimo]);
  const sinVentaHoy = useMemo(() => cobrosSinVenta(e, ultimo?.fecha ?? null, hoyIso()), [e, ultimo]);
  const caja = mov?.esperado ?? null;
  const vida = useMemo(() => runway(e, caja ?? 0), [e, caja]);
  const arqueos = useMemo(() => [...(e.arqueos ?? [])].sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)), [e.arqueos]);
  const retiros = useMemo(
    () => e.gastos.filter((g) => g.grupo === "retiro").sort((a, b) => +new Date(fechaDePago(b)) - +new Date(fechaDePago(a))),
    [e.gastos],
  );
  const anio = new Date().getFullYear();
  const retirosDelAnio = retiros.filter((g) => new Date(fechaDePago(g)).getFullYear() === anio).reduce((a, g) => a + g.monto, 0);

  return (
    <div className="stack-5">
      <CabeceraVista embebido={embebido}
        titulo="Caja"
        sub="Cuánta plata hay de verdad en las cuentas, si da con lo que la app esperaba y cuántos meses de vida le da al negocio."
        acciones={
          <>
            <CopiarLink sm={false} />
            <Button variante="secondary" icono={<ArrowRightLeft size={16} />} onClick={() => setPase("nuevo")}>Movimiento entre cuentas</Button>
            <Button variante="secondary" icono={<HandCoins size={16} />} onClick={() => setRetirando(true)}>Registrar retiro</Button>
            <Button variante="primary" icono={<Plus size={16} />} onClick={() => setArqueando("vacio")}>Hacer un arqueo</Button>
          </>
        }
      />

      {!ultimo ? (
        <Card>
          <Empty
            icono={<Landmark size={22} />} titulo="Todavía no hay ningún arqueo"
            texto="Contá cuánto hay hoy en cada cuenta (Stripe, Mercury, Trust, la Financiera, el efectivo) y cargalo. Ese es el punto de partida: desde ahí la app sabe cuánto tendría que haber y te avisa si no da."
            accion={<Button variante="primary" icono={<Plus size={16} />} onClick={() => setArqueando("vacio")}>Hacer el primer arqueo</Button>}
          />
        </Card>
      ) : (
        <>
          <div className="grid-stats">
            <StatCard
              hero etiqueta="Caja esperada hoy" valor={M(caja ?? 0)}
              contexto={`Último arqueo: ${M(ultimo.total)} el ${fechaLarga(ultimo.fecha)}${mov && mov.enCamino > 0 ? ` · ${M(mov.enCamino)} están en camino entre cuentas` : ""}`}
              info={{
                ayuda: "Cuánta plata tendría que haber hoy entre todas las cuentas, partiendo de lo que se contó en el último arqueo. Si al contar no da, falta cargar un gasto, una venta o un cobro.",
                formula: "Caja del último arqueo + lo que estaba en camino entre cuentas + lo cobrado − las devoluciones − procesadores − comisiones − gastos pagados − reparto (growth partner y socio) − retiros del dueño\nLo cobrado menos las devoluciones es el Cash Collected (CC) del período.\nUn gasto cuenta el día que se pagó, no el mes al que corresponde (ese es del estado de resultados).",
                periodo: `desde el arqueo del ${fechaLarga(ultimo.fecha)}`,
                componentes: mov ? () => [
                  { concepto: "Caja del último arqueo", valor: M(mov.inicial, 2) },
                  { concepto: "Estaba en camino al contarlo", valor: M(mov.enCaminoAntes, 2), signo: "+" },
                  { concepto: "Cobrado (lo que entró por las cuentas)", valor: M(mov.cobrado, 2), signo: "+" },
                  ...(mov.devoluciones ? [{ concepto: "Devoluciones a clientes", valor: M(mov.devoluciones, 2), signo: "−" as const, nota: "la comisión de la pasarela no vuelve" }] : []),
                  { concepto: "Procesadores de pago", valor: M(mov.procesador, 2), signo: "−" },
                  { concepto: "Comisiones de closers y director", valor: M(mov.comisiones, 2), signo: "−" },
                  { concepto: "Gastos pagados (directos, operativos y honorarios)", valor: M(mov.gastos, 2), signo: "−", nota: "cuentan el día que se pagaron" },
                  { concepto: "Reparto: growth partner y socio", valor: M(mov.reparto, 2), signo: "−" },
                  { concepto: "Retiros del dueño", valor: M(mov.retiros, 2), signo: "−" },
                  { concepto: "Caja esperada", valor: M(mov.esperado, 2), signo: "=" },
                ] : undefined,
              }}
            />
            <StatCard
              etiqueta="Meses de vida" valor={vida.mesesDeVida === null ? "—" : num(vida.mesesDeVida, 1)}
              direccion={vida.mesesDeVida !== null && vida.mesesDeVida >= MESES_DE_COLCHON ? "up" : "down"}
              delta={`objetivo ${MESES_DE_COLCHON}`}
              contexto={`Un mes sin vender cuesta ${M(vida.gastoMensual)} (promedio de ${vida.meses})`}
              info={{
                ayuda: "Cuántos meses aguanta el negocio sin vender nada con la plata que hay. Yari apunta a tener seis.",
                formula: "Caja esperada ÷ Lo que cuesta un mes sin vender\n(gastos operativos + honorarios del CEO, promedio de los últimos tres meses cerrados)",
                ejemplo: "Con US$ 90.000 en caja y gastos de US$ 15.000 por mes: 90.000 ÷ 15.000 = 6 meses de vida.",
                periodo: `promedio de ${vida.meses}`,
                componentes: vida.mesesDeVida === null ? undefined : () => [
                  { concepto: "Caja esperada", valor: M(caja ?? 0, 2) },
                  { concepto: "Lo que cuesta un mes sin vender", valor: M(vida.gastoMensual, 2), signo: "÷" },
                  { concepto: "Meses de vida", valor: num(vida.mesesDeVida!, 1), signo: "=" },
                ],
              }}
            />
            <StatCard
              etiqueta={vida.excedente >= 0 ? "Se puede retirar" : "Falta para 6 meses"}
              valor={M(Math.abs(vida.excedente))}
              direccion={vida.excedente >= 0 ? "up" : "down"}
              contexto={`El colchón de ${MESES_DE_COLCHON} meses es ${M(vida.colchon)}`}
              info={{
                ayuda: "Lo que sobra (o falta) de la caja para tener el colchón de seis meses. Lo que pasa de eso se puede retirar.",
                formula: "Caja esperada − Colchón\nColchón = Lo que cuesta un mes sin vender × 6",
                periodo: `promedio de ${vida.meses}`,
                componentes: () => [
                  { concepto: "Caja esperada", valor: M(caja ?? 0, 2) },
                  { concepto: `Colchón de ${MESES_DE_COLCHON} meses`, valor: M(vida.colchon, 2), signo: "−", nota: `${M(vida.gastoMensual, 2)} × ${MESES_DE_COLCHON}` },
                  { concepto: vida.excedente >= 0 ? "Se puede retirar" : "Falta para el colchón", valor: M(Math.abs(vida.excedente), 2), signo: "=" },
                ],
              }}
            />
            <StatCard
              etiqueta={`Retiros de ${anio}`} valor={M(retirosDelAnio)}
              contexto={retiros.length ? `${retiros.length} en total` : "Todavía ninguno"}
              info={{
                ayuda: "Plata que el dueño sacó de la caja este año. No es un gasto del negocio: no resta del profit, sí de la caja.",
                formula: `Suma de los retiros del dueño pagados en ${anio}`,
              }}
            />
          </div>

          {mov && <Movimiento mov={mov} M={M} sinVenta={sinVentaHoy} />}
        </>
      )}

      <ControlDeSaldosCard e={e} onArquear={() => setArqueando("traer")} />

      <PasesEntreCuentas e={e} rango={rangoFijo} onNuevo={() => setPase("nuevo")} onEditar={(t) => setPase(t)} />

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead titulo="Arqueos" sub="Cada vez que se contó la plata. La diferencia es contra lo que la app esperaba ese día: si no da, falta cargar un gasto, una venta o un cobro." />
        </div>
        <DataTable
          filas={arqueos}
          orden={tablaArqueos.orden} onOrden={tablaArqueos.onOrden}
          onFila={(a) => setVer(a)}
          etiquetaFila={(a) => `Ver el arqueo del ${fechaLarga(a.fecha)}`}
          columnas={[
            { clave: "fecha", titulo: "Fecha", tipo: "primary", orden: (a) => a.fecha, celda: (a) => fechaLarga(a.fecha) },
            { clave: "total", titulo: "Contado", tipo: "num", orden: (a) => a.total, celda: (a) => M(a.total) },
            { clave: "esperado", titulo: "Esperado", tipo: "num", orden: (a) => a.esperado ?? 0, celda: (a) => (a.esperado === null || a.esperado === undefined ? <span className="t-subtle">Punto de partida</span> : M(a.esperado)) },
            { clave: "dif", titulo: "Diferencia", tipo: "num", orden: (a) => a.diferencia ?? 0, celda: (a) => <Diferencia d={a.diferencia} M={M} /> },
            { clave: "por", titulo: "Lo cargó", tipo: "secondary", orden: (a) => a.por ?? "", celda: (a) => a.por ?? "—" },
          ]}
          acciones={(a) => <IconButton etiqueta="Borrar el arqueo" onClick={() => setBorrar(a)}><Trash2 size={15} /></IconButton>}
          vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>Sin arqueos todavía.</p>}
        />
      </Card>

      <Card style={{ padding: 0 }}>
        <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
          <CardHead titulo="Retiros del dueño" sub="La plata que sale de la caja y no es un gasto del negocio (el retiro de fin de año): no resta del profit, sí de la caja." />
        </div>
        <DataTable
          filas={retiros}
          orden={tablaRetiros.orden} onOrden={tablaRetiros.onOrden}
          columnas={[
            { clave: "fecha", titulo: "Fecha", tipo: "primary", orden: (g) => fechaDePago(g), celda: (g) => fechaLarga(fechaDePago(g)) },
            { clave: "concepto", titulo: "Concepto", tipo: "secondary", orden: (g) => g.concepto, celda: (g) => g.concepto },
            { clave: "monto", titulo: "Monto", tipo: "num", orden: (g) => g.monto, celda: (g) => M(g.monto, 2) },
          ]}
          vacio={<p className="t-sm t-muted" style={{ padding: 16 }}>Sin retiros cargados.</p>}
        />
      </Card>

      <Ayuda titulo="Cómo se calcula" icono={<Info size={18} />}>
        La caja esperada parte del último arqueo y le suma lo cobrado, menos procesadores, comisiones de closers y
        director, los gastos pagados (cada uno el día que se pagó, aunque corresponda a otro mes del estado de resultados),
        el growth partner y el socio, y los retiros. Las comisiones se pagan a mes
        vencido: al principio de mes la diferencia puede ser eso. Los meses de vida son la caja sobre lo que cuesta un
        mes sin vender (gastos operativos y honorarios del CEO: sueldos, ads, software). Un movimiento entre cuentas
        no cambia el total: sólo lo que tendría que haber en cada cuenta, y lo que costó el pase, que va como gasto.
        Mientras la plata viaja de una cuenta a otra sigue siendo de la caja, pero no está en ninguna: por eso el
        arqueo la descuenta de lo que tiene que dar al contar.
      </Ayuda>

      {arqueando && <NuevoArqueo e={e} traerAlAbrir={arqueando === "traer"} onCerrar={() => setArqueando(false)} onListo={(a) => {
        setArqueando(false);
        toast(a.diferencia === null || a.diferencia === undefined ? "Arqueo guardado: es el punto de partida."
          : Math.abs(a.diferencia) < 1 ? "Arqueo guardado: las cuentas dan." : `Arqueo guardado: ${a.diferencia > 0 ? "sobran" : "faltan"} ${M(Math.abs(a.diferencia))}.`);
      }} />}
      {pase && (
        <FormTraspaso
          e={e} traspaso={pase === "nuevo" ? null : pase} onCerrar={() => setPase(null)}
          onListo={(mensaje) => { setPase(null); toast(mensaje); }}
        />
      )}
      {retirando && <NuevoRetiro e={e} onCerrar={() => setRetirando(false)} onListo={() => { setRetirando(false); toast("Retiro registrado."); }} />}
      {ver && <VerArqueo e={e} a={ver} onCerrar={() => setVer(null)} />}
      <Confirmar
        abierto={borrar !== null} onCerrar={() => setBorrar(null)} confirmarTexto="Borrar el arqueo"
        titulo="¿Borrar este arqueo?" texto={`Se borra el arqueo del ${borrar ? fechaLarga(borrar.fecha) : ""}. La caja esperada vuelve a partir del anterior.`}
        onConfirmar={() => { if (borrar) { acciones.borrarArqueo(borrar.id); toast("Arqueo borrado."); } }}
      />
    </div>
  );
}

function Diferencia({ d, M }: { d?: number | null; M: (n: number, dec?: number) => string }) {
  if (d === null || d === undefined) return <span className="t-subtle">—</span>;
  if (Math.abs(d) < 1) return <Badge variante="success">Da</Badge>;
  return <Badge variante={d < 0 ? "danger" : "warning"}>{d > 0 ? "Sobran " : "Faltan "}{M(Math.abs(d))}</Badge>;
}

function Movimiento({ mov, M, sinVenta }: { mov: MovimientoCaja; M: (n: number, d?: number) => string; sinVenta?: { n: number; monto: number } }) {
  const filas: [string, number, string?][] = [
    ["Caja del último arqueo", mov.inicial],
    ...(mov.enCaminoAntes ? [["+ Estaba en camino al contar", mov.enCaminoAntes, "Había salido de una cuenta y no había llegado a la otra"] as [string, number, string]] : []),
    ["+ Cobrado", mov.cobrado, "Todo lo que entró por las cuentas"],
    ...(mov.devoluciones ? [["− Devoluciones a clientes", -mov.devoluciones, "La plata devuelta; la comisión de la pasarela no vuelve"] as [string, number, string]] : []),
    ["− Procesadores", -mov.procesador],
    ["− Comisiones de closers y director", -mov.comisiones, "Se pagan a mes vencido"],
    ["− Gastos pagados", -mov.gastos, "Directos, operativos y honorarios del CEO, el día que se pagaron"],
    ["− Growth partner y socio", -mov.reparto],
    ["− Retiros del dueño", -mov.retiros],
  ];
  return (
    <Card>
      <CardHead titulo={`Desde el último arqueo (${fechaLarga(mov.desde)})`} sub="Lo que la app sabe que pasó con la plata. Si al contar no da, lo que falta está acá." />
      <dl className="caja-mov">
        {filas.map(([t, n, ayuda]) => (
          <React.Fragment key={t}>
            <dt>{t}{ayuda && <span className="t-sm t-subtle"> · {ayuda}</span>}</dt>
            <dd className="t-num">{M(n)}</dd>
          </React.Fragment>
        ))}
        <dt className="caja-mov__total">= Caja esperada hoy</dt>
        <dd className="caja-mov__total t-num">{M(mov.esperado)}</dd>
        {mov.enCamino > 0 && (
          <>
            <dt>− En camino entre cuentas<span className="t-sm t-subtle"> · Salió de una y todavía no llegó a la otra: al contar no está en ninguna</span></dt>
            <dd className="t-num">{M(-mov.enCamino)}</dd>
            <dt>= Lo que tendría que dar al contar las cuentas</dt>
            <dd className="t-num">{M(mov.enCuentas)}</dd>
          </>
        )}
      </dl>
      {sinVenta && sinVenta.n > 0 && (
        <p className="t-sm t-subtle" style={{ margin: "var(--space-3) 0 0" }}>
          Además {sinVenta.n === 1 ? "entró 1 cobro" : `entraron ${sinVenta.n} cobros`} por {M(sinVenta.monto)} que todavía no tiene{sinVenta.n === 1 ? "" : "n"} su venta cargada: están en la cuenta
          pero no en «Cobrado» hasta que se concilien. Si al contar sobra plata, puede ser esto.
        </p>
      )}
    </Card>
  );
}

/* ---------- Control de saldos: lo que hay de verdad contra lo que la app esperaba ----------
   Aldana (20/10): si el saldo real de una cuenta se puede leer solo, que la app lo compare con lo que esperaba y avise: si no da,
   falta cargar algo (un gasto, un retiro, un cobro, un movimiento entre cuentas). Se lee al abrir la Caja y a pedido. */

function ControlDeSaldosCard({ e, onArquear }: { e: EstadoApp; onArquear: () => void }) {
  const [estado, setEstado] = useState<{ cargando: boolean; resp?: RespuestaDeSaldos; error?: string; cuando?: string }>({ cargando: Boolean(nube) });
  const leer = useCallback(async () => {
    setEstado((x) => ({ ...x, cargando: true, error: undefined }));
    try {
      const resp = await traerSaldosReales();
      setEstado({ cargando: false, resp, cuando: new Date().toISOString() });
    } catch (err) {
      setEstado((x) => ({ ...x, cargando: false, error: err instanceof Error ? err.message : "No se pudieron leer los saldos." }));
    }
  }, []);
  useEffect(() => { if (nube) void leer(); }, [leer]);
  const control: ControlDeSaldos | null = useMemo(
    () => (estado.resp && estado.cuando ? controlarSaldos(e, estado.resp.saldos, estado.cuando) : null),
    [e, estado.resp, estado.cuando],
  );
  /* Qué movió de verdad una cuenta desde el último arqueo (Mercury, Stripe): lo que falta cargar es lo que hace que el saldo no dé. */
  const [verCuenta, setVerCuenta] = useState<string | null>(null);
  const desdeElArqueo = ultimoArqueo(e)?.fecha ?? new Date(Date.now() - 14 * 86400000).toISOString();
  if (!nube) return null;

  const nombre = (id: string) => e.procesadores.find((p) => p.id === id)?.nombre ?? id;
  const resp = estado.resp;
  const hora = estado.cuando ? new Date(estado.cuando).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" }) : "";
  const cuentasQueNoDan = control ? control.filas.filter((f) => f.lectura === "sobra" || f.lectura === "falta") : [];

  return (
    <Card style={{ padding: 0 }}>
      <div style={{ padding: "var(--space-4) var(--space-4) 0" }}>
        <CardHead
          titulo="Control de saldos"
          sub={`Lo que hay de verdad en las cuentas que se leen solas (USDT Trust, Mercury, Stripe), contra lo que la app esperaba.${hora ? ` Leído a las ${hora}.` : ""}`}
          acciones={<Button sm variante="secondary" icono={<RefreshCw size={15} />} cargando={estado.cargando} onClick={() => void leer()}>Volver a mirar</Button>}
        />
      </div>
      <div className="cs-cuerpo">
        {control?.hayAlarma && (
          <div className="cs-alarma" role="alert">
            <AlertTriangle size={18} aria-hidden />
            <div>
              <strong>No da: falta cargar algo.</strong>{" "}
              {cuentasQueNoDan.length === 1 ? "Una cuenta no coincide" : `${cuentasQueNoDan.length} cuentas no coinciden`} con lo que la app esperaba.
              Si hay menos, falta cargar un gasto, un retiro o un movimiento entre cuentas; si hay más, un cobro o un movimiento.
            </div>
          </div>
        )}
        {estado.error && <p className="t-sm" style={{ color: "var(--danger)", margin: 0 }} role="status">{estado.error}</p>}
        {control && control.filas.length > 0 && (
          <div className="cs-tabla" role="table" aria-label="Saldo real de cada cuenta contra lo que la app esperaba">
            <div className="cs-fila cs-fila--cabeza" role="row">
              <span role="columnheader">Cuenta</span><span role="columnheader" className="cs-num">Hay de verdad</span>
              <span role="columnheader" className="cs-num">La app esperaba</span><span role="columnheader" className="cs-num">Diferencia</span><span role="columnheader">Qué pasa</span>
            </div>
            {control.filas.map((f) => (
              <div className="cs-fila" role="row" key={f.cuentaId} data-lectura={f.lectura}>
                <span role="cell" className="t-strong">{f.nombre}<span className="t-sm t-subtle"> · {f.fuente}</span></span>
                <span role="cell" className="cs-num t-num" title={f.nota}>{money(f.real, f.moneda)}</span>
                <span role="cell" className="cs-num t-num t-muted">{f.esperado !== undefined ? money(f.esperado, f.moneda) : "—"}</span>
                <span role="cell" className="cs-num t-num cs-dif">
                  {f.lectura === "da" ? <Check size={16} aria-label="Da" />
                    : f.lectura === "da-con-pendientes" ? (
                      <>
                        <Check size={16} aria-label="Da, con plata que el banco todavía no asentó" />
                        {f.diferencia !== undefined && <span className="t-sm cs-dif__camino">{f.diferencia > 0 ? "+" : "−"}{money(Math.abs(f.diferencia), f.moneda)} en camino</span>}
                      </>
                    ) : f.diferencia !== undefined ? `${f.diferencia > 0 ? "+" : "−"}${money(Math.abs(f.diferencia), f.moneda)}` : "—"}
                </span>
                {/* Si lo que está en camino ya explica la diferencia, la frase lo dice con sus montos: la nota (que repite lo mismo) queda en el globito del saldo. */}
                <span role="cell" className="t-sm t-muted">
                  {quePasa(f)}{f.nota && f.lectura !== "da-con-pendientes" ? ` ${f.nota}` : ""}
                  {(f.cuentaId === "proc_mercury" || f.cuentaId === "proc_stripe") && (
                    <> <button type="button" className="link" onClick={() => setVerCuenta(f.cuentaId)}>Ver qué pasó en la cuenta</button></>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {control && control.filas.length === 0 && !estado.cargando && !estado.error && (
          <p className="t-sm t-muted" style={{ margin: 0 }}>Ninguna cuenta se pudo leer ahora: contalas a mano en el arqueo.</p>
        )}
        {control && control.sinCuenta.n > 0 && (
          <p className="t-sm t-muted" style={{ margin: 0 }}>
            Desde el último arqueo hay <strong>{control.sinCuenta.n} {control.sinCuenta.n === 1 ? "gasto" : "gastos"} ({money(control.sinCuenta.total, "USD", 0)})</strong> que no dice
            de qué cuenta salió: la app no lo puede descontar de ninguna, así que en la cuenta desde la que se pagó va a sobrar eso. Ponele la cuenta al cargarlo.
          </p>
        )}
        {resp?.errores.map((x) => <p key={x.cuentaId} className="t-sm" style={{ color: "var(--warning)", margin: 0 }}>{nombre(x.cuentaId)}: {x.mensaje}</p>)}
        {resp && resp.sinConexion.length > 0 && (
          <p className="t-sm t-subtle" style={{ margin: 0 }}>Sin conectar (se cuentan a mano): {resp.sinConexion.map(nombre).join(", ")}. La Financiera, Galicia y el efectivo tampoco se pueden leer solos.</p>
        )}
        {control && control.filas.length > 0 && (
          <div className="row-wrap">
            <Button variante={control.hayAlarma ? "secondary" : "primary"} onClick={onArquear}>Hacer un arqueo con estos saldos</Button>
          </div>
        )}
      </div>
      {verCuenta && <MovimientosDeLaCuenta cuentaId={verCuenta} desde={desdeElArqueo} onCerrar={() => setVerCuenta(null)} />}
    </Card>
  );
}

/* ---------- Un arqueo nuevo ---------- */

function NuevoArqueo({ e, onCerrar, onListo, traerAlAbrir = false }: { e: EstadoApp; onCerrar: () => void; onListo: (a: Arqueo) => void; traerAlAbrir?: boolean }) {
  const base = e.ajustes.monedaBase;
  const M = (n: number, d = 0) => money(n, base, d);
  const [dia, setDia] = useState(diaAr(hoyIso()));
  const [tc, setTc] = useState(e.ajustes.tipoCambio > 0 ? escribirMonto(e.ajustes.tipoCambio) : "");
  const [textos, setTextos] = useState<Record<string, string>>({});
  /* Las cuentas con saldo en varias monedas (dLocal) se cuentan moneda por moneda: cuenta → moneda → lo escrito. */
  const [detalles, setDetalles] = useState<Record<string, Record<string, { monto?: string; tc?: string }>>>({});
  const [verDetalle, setVerDetalle] = useState<Record<string, boolean>>({});
  const [notas, setNotas] = useState("");
  /* Los saldos que trajo la app solos (no los escribió nadie): cuenta → de dónde y a qué hora. */
  const [automaticos, setAutomaticos] = useState<Record<string, { fuente: string; al: string; nota?: string; ajuste?: { delBanco: number; nota: string } }>>({});
  const [leyendo, setLeyendo] = useState(false);
  const [avisos, setAvisos] = useState<string[]>([]);

  /* Si es hoy, ahora; si es otro día, a las 20 de ese día. */
  const fecha = dia === diaAr(hoyIso()) ? hoyIso() : new Date(`${dia}T23:00:00.000Z`).toISOString();
  const previo = ultimoArqueo(e, fecha);
  /* Lo que tendría que haber en cada cuenta, en su moneda. */
  const porCuenta = useMemo(() => saldosEsperados(e, previo, fecha), [e, previo, fecha]);
  const cuentas = e.procesadores.filter((p) => {
    const s = porCuenta.get(p.id);
    return p.activo || Boolean(s && (s.entro || s.pases || s.salio)) || previo?.saldos.some((x) => x.procesadorId === p.id);
  });
  const tipoCambio = leerMonto(tc);
  /* El tipo de cambio de cada moneda arranca en el del último arqueo (dLocal usa el suyo, no el de Ajustes); los pesos argentinos, en el del arqueo. */
  const tcInicial = (p: Procesador, moneda: string): number =>
    previo?.saldos.find((x) => x.procesadorId === p.id)?.detalle?.find((l) => l.moneda === moneda)?.tipoCambio ?? (moneda === "ARS" && tipoCambio > 0 ? tipoCambio : 0);
  const lineasDe = (p: Procesador, det = detalles) => monedasDelSaldo(p).map((m) => {
    const d = det[p.id]?.[m.codigo];
    const tcTxt = d?.tc ?? (tcInicial(p, m.codigo) > 0 ? escribirMonto(tcInicial(p, m.codigo)) : "");
    const montoTxt = d?.monto ?? "";
    return { ...m, montoTxt, tcTxt, monto: montoTxt.trim() ? leerMonto(montoTxt) : NaN, tipoCambio: leerMonto(tcTxt) };
  });
  const detalleDe = (p: Procesador, det = detalles) => detalleDeSaldo(lineasDe(p, det).map((l) => ({ moneda: l.codigo, monto: l.monto, tipoCambio: l.tipoCambio })));
  function cambiarLinea(p: Procesador, moneda: string, campo: "monto" | "tc", valor: string) {
    const nuevo = { ...detalles, [p.id]: { ...(detalles[p.id] ?? {}), [moneda]: { ...(detalles[p.id]?.[moneda] ?? {}), [campo]: valor } } };
    setDetalles(nuevo);
    const det = detalleDe(p, nuevo);
    /* El saldo de la cuenta es la suma en dólares; sin ninguna línea, queda vacío. */
    setTextos((t) => ({ ...t, [p.id]: det.length ? escribirMonto(totalDelDetalle(det)) : "" }));
    if (automaticos[p.id]) setAutomaticos(({ [p.id]: _x, ...resto }) => resto);
  }
  const hayPases = cuentas.some((p) => porCuenta.get(p.id)?.pases);
  /* Lo que se usa todo el tiempo arriba; lo demás, en «Otros» (plegado salvo que ya tenga un saldo escrito). */
  const [verOtros, setVerOtros] = useState(false);
  const principales = cuentas.filter((p) => !enOtros(p));
  const otros = cuentas.filter(enOtros);
  const otrosAbiertos = verOtros || otros.some((p) => textos[p.id]?.trim());

  const saldos: SaldoCuenta[] = cuentas.flatMap((p) => {
    const t = textos[p.id];
    if (t === undefined || t.trim() === "") return [];
    const monto = leerMonto(t);
    if (!Number.isFinite(monto)) return [];
    const moneda: Moneda = p.moneda ?? "USD";
    const ajuste = automaticos[p.id]?.ajuste;
    const det = monedasDelSaldo(p).length ? detalleDe(p) : [];
    return [{
      procesadorId: p.id, monto, moneda, montoBase: Math.round(aMonedaBase(monto, moneda, base, tipoCambio) * 100) / 100,
      ...(ajuste ? { nota: ajuste.nota } : {}), ...(det.length ? { detalle: det } : {}),
    }];
  });
  const total = Math.round(saldos.reduce((a, s) => a + s.montoBase, 0) * 100) / 100;
  /* Contra lo que tiene que dar al contar: lo que viaja entre cuentas no está en ninguna. */
  const mov = previo ? cajaEsperada(e, previo, fecha, tipoCambio) : null;
  /* Una cuenta que no estaba en el arqueo anterior (dLocal y las Financieras, «en revisión» el 7/10) no tiene de dónde partir: lo que ya tenía se
     deduce de lo contado menos lo que se movió, y se suma a lo esperado. Queda dicho en cada cuenta (lib/primer-conteo.ts). */
  const primer = primerConteo(saldos, porCuenta, Boolean(previo), (m, mo) => money(m, mo, 2));
  const sinVenta = useMemo(() => cobrosSinVenta(e, previo?.fecha ?? null, fecha, tipoCambio), [e, previo?.fecha, fecha, tipoCambio]);
  /* Lo que ya entró a cada cuenta y todavía no tiene su venta (está en la cuenta, no en «Cobrado») y lo que cambió el valor de lo que había en cada
     moneda por moverse el tipo de cambio: es plata que está o que vale distinto, no plata que falte. Se le suma a lo que esa cuenta tendría que tener
     (Aldana, 24/10: «había diferencia en Whop y en dLocal»: eran dos cobros de Whop sin venta y el cambio). */
  const sinVentaPorCuenta = useMemo(() => cobrosSinVentaPorCuenta(e, previo?.fecha ?? null, fecha, tipoCambio), [e, previo?.fecha, fecha, tipoCambio]);
  const sinVentaDe = (p: Procesador) => (p.moneda === "ARS" ? undefined : sinVentaPorCuenta.get(p.id));
  const cambioDe = (p: Procesador) => {
    const anterior = previo?.saldos.find((x) => x.procesadorId === p.id)?.detalle;
    return monedasDelSaldo(p).length && anterior?.length
      ? efectoDelCambio(anterior, lineasDe(p).map((l) => ({ moneda: l.codigo, tipoCambio: l.tipoCambio })))
      : { total: 0, lineas: [] };
  };
  const ajusteDe = (p: Procesador) => Math.round(((sinVentaDe(p)?.monto ?? 0) + cambioDe(p).total) * 100) / 100;
  const ajusteTotal = Math.round(cuentas.reduce((a, p) => a + ajusteDe(p), 0) * 100) / 100;
  const esperado = mov ? Math.round((mov.enCuentas + primer.totalBase + ajusteTotal) * 100) / 100 : null;
  const deEstaCuenta = (id: string) => primer.cuentas.find((c) => c.procesadorId === id);
  const hayPesos = cuentas.some((p) => p.moneda === "ARS");
  const faltaTc = hayPesos && saldos.some((s) => s.moneda === "ARS") && !(tipoCambio > 0);

  /* Lee de las cuentas conectadas lo que hay de verdad (a esa fecha, si es un día pasado) y lo pone en «Hay de verdad». */
  async function traerSaldos() {
    setLeyendo(true);
    try {
      const esHoy = dia === diaAr(hoyIso());
      const r = await traerSaldosReales(esHoy ? undefined : fecha);
      const nombre = (id: string) => e.procesadores.find((p) => p.id === id)?.nombre ?? id;
      const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
      /* Si lo que el banco todavía no asentó explica la diferencia, se guarda lo que va a quedar cuando lo asiente (lib/saldos-reales.ts). */
      const paraArqueo = new Map(r.saldos.map((x) => [x.cuentaId, saldoParaElArqueo(x, porCuenta.get(x.cuentaId)?.esperado)]));
      setTextos((t) => ({ ...t, ...Object.fromEntries(r.saldos.map((x) => [x.cuentaId, escribirMonto(paraArqueo.get(x.cuentaId)!.monto)])) }));
      setAutomaticos((a) => ({
        ...a,
        ...Object.fromEntries(r.saldos.map((x) => {
          const p = paraArqueo.get(x.cuentaId)!;
          return [x.cuentaId, { fuente: x.fuente, al: x.al, nota: x.nota, ajuste: p.ajuste && p.nota ? { delBanco: p.delBanco, nota: p.nota } : undefined }];
        })),
      }));
      const nuevos: string[] = [];
      if (r.saldos.length) nuevos.push(`Traje ${r.saldos.length === 1 ? "el saldo" : `${r.saldos.length} saldos`} de ${r.saldos.map((x) => nombre(x.cuentaId)).join(", ")}${esHoy ? ` (a las ${hora(r.saldos[0].al)})` : ` al cierre del ${fechaLarga(fecha)}`}. Revisalos: son lo que hay de verdad.`);
      for (const x of r.saldos) {
        const p = paraArqueo.get(x.cuentaId)!;
        if (p.ajuste) nuevos.push(`${nombre(x.cuentaId)} marca ${money(p.delBanco, x.moneda, 2)} pero tiene ${textoDeLoPendiente(p.ajuste, x.moneda)}: puse ${money(p.monto, x.moneda, 2)}, lo que va a quedar cuando el banco lo asiente. Así el próximo arqueo no marca una falta que no es. Si querés el saldo del banco tal cual, escribilo encima.`);
        else if (x.pendientes?.nSalidas && (p.diferencia ?? 0) >= TOLERANCIA_DE_SALDO) nuevos.push(`${nombre(x.cuentaId)} tiene ${money(x.pendientes.salidas, x.moneda, 2)} en salidas que el banco todavía no debitó, pero no explican toda la diferencia: no se descontó nada del saldo.`);
      }
      if (r.soloHoy.length) nuevos.push(`${r.soloHoy.map(nombre).join(", ")} sólo se leen de hoy: este arqueo es de otro día, contalos vos.`);
      if (r.sinConexion.length) nuevos.push(`${r.sinConexion.map(nombre).join(", ")} no está${r.sinConexion.length === 1 ? "" : "n"} conectada${r.sinConexion.length === 1 ? "" : "s"}: contala${r.sinConexion.length === 1 ? "" : "s"} vos.`);
      for (const x of r.errores) nuevos.push(`${nombre(x.cuentaId)}: ${x.mensaje}`);
      nuevos.push("La Financiera, Galicia y el efectivo no se pueden leer solos: esos los contás vos.");
      setAvisos(nuevos);
    } catch (err) {
      setAvisos([err instanceof Error ? err.message : "No se pudieron leer los saldos."]);
    } finally {
      setLeyendo(false);
    }
  }
  const yaTrajo = useRef(false);
  useEffect(() => {
    if (traerAlAbrir && !yaTrajo.current) { yaTrajo.current = true; void traerSaldos(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function guardar() {
    /* Las cuentas que se cuentan por primera vez llevan su constancia (se ve en el arqueo guardado). */
    const conNota = saldos.map((s) => { const c = deEstaCuenta(s.procesadorId); return c ? { ...s, nota: [s.nota, c.nota].filter(Boolean).join(" ") } : s; });
    const a: Arqueo = {
      id: nuevoId("arq"), fecha, saldos: conNota, total,
      tipoCambio: tipoCambio > 0 ? tipoCambio : undefined,
      esperado, diferencia: esperado === null ? null : Math.round((total - esperado) * 100) / 100,
      notas: notas.trim() || undefined, por: e.ajustes.responsable || undefined, creadoEn: hoyIso(),
    };
    acciones.guardarArqueo(a);
    onListo(a);
  }

  /* Una cuenta del arqueo. */
  const fila = (p: Procesador) => {
      const s = porCuenta.get(p.id);
      const moneda = p.moneda ?? "USD";
      const enSuMoneda = (n: number, signo = false) => `${signo && n > 0 ? "+ " : n < 0 ? "− " : ""}${money(Math.abs(n), moneda)}`;
      const contado = textos[p.id]?.trim() ? leerMonto(textos[p.id]) : NaN;
      const sinVentaCuenta = sinVentaDe(p);
      const cambio = cambioDe(p);
      const ajuste = ajusteDe(p);
      const esperadoCuenta = s?.esperado !== undefined ? Math.round((s.esperado + ajuste) * 100) / 100 : undefined;
      const dif = esperadoCuenta !== undefined && Number.isFinite(contado) ? Math.round((contado - esperadoCuenta) * 100) / 100 : null;
      /* Lo contado contra lo que tendría que haber: el casillero se pinta
         (verde si da, ámbar si no) y adentro va el tilde o la diferencia. */
      const da = dif !== null && Math.abs(dif) < 1;
      /* En pesos la diferencia puede ser de millones: adentro va corta (−1,25 M) y entera al pasar el mouse. */
      const cuanto = dif === null ? 0 : Math.abs(dif);
      const marca = dif === null || da ? ""
        : `${dif > 0 ? "+" : "−"}${cuanto >= 1e6 ? `${(cuanto / 1e6).toLocaleString("es-AR", { maximumFractionDigits: 2 })} M` : num(cuanto)}`;
      const dice = dif === null ? undefined : da ? "Da con lo que tendría que haber en esta cuenta"
        : `${dif > 0 ? "Sobran" : "Faltan"} ${money(Math.abs(dif), moneda)} contra lo que tendría que haber en esta cuenta`;
      const monedas = monedasDelSaldo(p);
      const lineas = monedas.length ? lineasDe(p) : [];
      const conDetalle = monedas.length > 0 && detalleDe(p).length > 0;
      const panelAbierto = monedas.length > 0 && (verDetalle[p.id] || conDetalle);
      return (
        <React.Fragment key={p.id}>
        <div className="arqueo-fila" role="row">
          <span role="cell" className="t-strong">
            {p.nombre}{moneda === "ARS" && <span className="t-sm t-subtle"> · en pesos</span>}
            {monedas.length > 0 && (
              <button
                type="button" className="link t-sm" style={{ marginLeft: 8 }} aria-expanded={panelAbierto}
                title="Esta cuenta guarda un saldo en cada moneda: contalas una por una y se suman en dólares."
                onClick={() => setVerDetalle((v) => ({ ...v, [p.id]: !panelAbierto }))}
              >
                {panelAbierto ? "Ocultar monedas" : "Contar por moneda"}
              </button>
            )}
            {p.id === "proc_stripe" && (
              <span className="t-sm t-subtle" title="Poné el saldo TOTAL de Stripe (disponible + pendiente de acreditarse, el «saldo total» del panel), no el «disponible para instant payouts»: ese es sólo una parte. «Traer los saldos reales» lo completa solo."> · saldo total, no «instant payouts»</span>
            )}
            {automaticos[p.id] && (
              <span className="t-sm arqueo-auto" title={`Leído de ${automaticos[p.id].fuente} a las ${new Date(automaticos[p.id].al).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" })}.${automaticos[p.id].ajuste ? ` ${automaticos[p.id].ajuste!.nota}` : ""}${automaticos[p.id].nota ? ` ${automaticos[p.id].nota}` : ""}`}> · automático{automaticos[p.id].ajuste ? ", ajustado" : ""}</span>
            )}
          </span>
          <span role="cell" data-titulo="Último arqueo" className="t-num t-muted">{s?.anterior !== undefined ? money(s.anterior, moneda) : "—"}</span>
          <span role="cell" data-titulo="Cobró (neto)" className="t-num t-muted" title="Lo cobrado por esta cuenta desde el último arqueo, neto de su comisión">{s?.entro ? enSuMoneda(s.entro, true) : "—"}</span>
          <span role="cell" data-titulo="Pases" className="t-num t-muted" title="Lo que recibió de otras cuentas menos lo que les mandó">{s?.pases ? enSuMoneda(s.pases, true) : "—"}</span>
          <span role="cell" data-titulo="Salió" className="t-num t-muted" title="Lo que salió de esta cuenta desde el último arqueo: los gastos que dicen de qué cuenta se pagaron, los retiros y las devoluciones (lo que volvió, como un reembolso, suma)">
            {s?.salio ? enSuMoneda(-s.salio, true) : "—"}
          </span>
          <span role="cell" data-titulo="Tendría que haber" className="t-num">
            {esperadoCuenta !== undefined ? money(esperadoCuenta, moneda) : deEstaCuenta(p.id)
              ? <span className="t-sm t-subtle" title={deEstaCuenta(p.id)!.nota}>Primer conteo</span> : "—"}
            {sinVentaCuenta && sinVentaCuenta.monto > 0 && (
              <span
                className="t-subtle arqueo-ajuste" data-ajuste="sin-venta"
                title={`${sinVentaCuenta.n === 1 ? "Entró 1 cobro" : `Entraron ${sinVentaCuenta.n} cobros`} a esta cuenta que todavía no ${sinVentaCuenta.n === 1 ? "tiene" : "tienen"} su venta cargada${sinVentaCuenta.quienes.length ? ` (${sinVentaCuenta.quienes.join(", ")})` : ""}: la plata está en la cuenta pero no en «Cobró» hasta que se concilie. Ya está sumada acá.`}
              >
                incl. {money(sinVentaCuenta.monto, moneda)} sin venta
              </span>
            )}
            {cambio.total !== 0 && (
              <span
                className="t-subtle arqueo-ajuste" data-ajuste="cambio"
                title={`Lo que ya había en cada moneda en el último arqueo, al tipo de cambio de hoy contra el de entonces: ${cambio.lineas.map((l) => `${l.moneda} ${money(l.antes, base, 2)} → ${money(l.ahora, base, 2)}`).join("; ")}. Nadie puso ni sacó plata: es el cambio.`}
              >
                incl. {cambio.total > 0 ? "+" : "−"}{money(Math.abs(cambio.total), moneda)} por el cambio
              </span>
            )}
          </span>
          <span
            role="cell" className="arqueo-hay" title={dice} data-estado={dif === null ? undefined : da ? "da" : "difiere"}
            style={marca ? { "--marca": `${Math.round(marca.length * 6.5)}px` } as React.CSSProperties : undefined}
          >
            <InputMonto
              aria-label={`Saldo de ${p.nombre}`} placeholder={moneda === "ARS" ? "$ 0" : "US$ 0"} negativos
              readOnly={conDetalle} title={conDetalle ? "Es la suma de las monedas de abajo, en dólares." : undefined}
              value={textos[p.id] ?? ""}
              onChange={(ev) => { setTextos({ ...textos, [p.id]: ev.target.value }); if (automaticos[p.id]) setAutomaticos(({ [p.id]: _x, ...resto }) => resto); }}
            />
            {dif !== null && (da
              ? <Check size={16} className="arqueo-hay__marca" aria-label={dice} />
              : <span className="arqueo-hay__marca" aria-label={dice}>{marca}</span>)}
          </span>
        </div>
        {panelAbierto && (
          <div className="arqueo-detalle" role="group" aria-label={`Saldo de ${p.nombre} por moneda`}>
            <p className="t-sm t-subtle" style={{ margin: 0 }}>
              {p.nombre} tiene un saldo en cada moneda. Escribí el de cada una (como lo muestra su panel) y su tipo de cambio en unidades por dólar: acá se suman en
              dólares. El tipo de cambio de cada moneda queda guardado para el próximo arqueo.
            </p>
            <div className="arqueo-detalle__fila arqueo-detalle__fila--cabeza" aria-hidden>
              <span>Moneda</span><span>Saldo</span><span>Por dólar</span><span>En dólares</span>
            </div>
            {lineas.map((l) => {
              const dolares = Number.isFinite(l.monto) && l.tipoCambio > 0 ? Math.round((l.monto / l.tipoCambio) * 100) / 100 : null;
              return (
                <div className="arqueo-detalle__fila" key={l.codigo}>
                  <span>{l.nombre} <span className="t-subtle">({l.codigo})</span></span>
                  <InputMonto
                    aria-label={`Saldo de ${p.nombre} en ${l.codigo}`} placeholder="0" negativos value={l.montoTxt}
                    onChange={(ev) => cambiarLinea(p, l.codigo, "monto", ev.target.value)}
                  />
                  <InputMonto
                    aria-label={`Tipo de cambio de ${l.codigo} por dólar`} placeholder="0" decimales={4} value={l.tcTxt}
                    error={Number.isFinite(l.monto) && l.monto !== 0 && !(l.tipoCambio > 0)}
                    onChange={(ev) => cambiarLinea(p, l.codigo, "tc", ev.target.value)}
                  />
                  <span className="t-num">{dolares === null ? "—" : money(dolares, base, 2)}</span>
                </div>
              );
            })}
            <div className="arqueo-detalle__total"><span>Total en dólares</span><span className="t-num">{money(totalDelDetalle(detalleDe(p)), base, 2)}</span></div>
            {monedas.length > 0 && previo?.saldos.some((x) => x.procesadorId === p.id && !x.detalle?.length) && (
              <p className="t-sm t-subtle" style={{ margin: 0 }}>
                El arqueo anterior contó {p.nombre} como un solo número en dólares, así que no se puede separar lo que cambió por el tipo de cambio: si no da, parte de la
                diferencia puede ser el cambio de las monedas. Guardando éste por moneda, el próximo lo separa solo.
              </p>
            )}
            {cambio.total !== 0 && (
              <p className="t-sm t-subtle" style={{ margin: 0 }}>
                Lo que ya había en el último arqueo vale {cambio.total > 0 ? "+" : "−"} {money(Math.abs(cambio.total), base, 2)} por el tipo de cambio de hoy
                ({cambio.lineas.map((l) => `${l.moneda}: ${money(l.antes, base, 2)} → ${money(l.ahora, base, 2)}`).join(" · ")}). Ya está en «Tendría que haber»: no es plata que falte.
              </p>
            )}
          </div>
        )}
        </React.Fragment>
      );
  };

  return (
    <ModalForm
      abierto ancho onCerrar={onCerrar} onGuardar={guardar} guardarTexto="Guardar el arqueo"
      puedeGuardar={saldos.length > 0 && !faltaTc}
      titulo="Arqueo de caja"
      sub="Escribí cuánto hay hoy en cada cuenta, en su moneda. Las que no tocás no se cuentan."
    >
      <div className="form-grid">
        <Field label="Día del arqueo"><Input type="date" value={dia} onChange={(ev) => setDia(ev.target.value || diaAr(hoyIso()))} /></Field>
        {hayPesos && (
          <Field label="Tipo de cambio (pesos por dólar)" ayuda="Para pasar a dólares las cuentas en pesos." error={faltaTc ? "Poné el tipo de cambio." : undefined}>
            <InputMonto decimales={4} value={tc} onChange={(ev) => setTc(ev.target.value)} />
          </Field>
        )}
      </div>
      {nube && (
        <div className="arqueo-traer">
          <Button variante="secondary" icono={<RefreshCw size={15} />} cargando={leyendo} onClick={() => void traerSaldos()}
            title="Lee solo el saldo real de las cuentas conectadas: USDT Trust (la red), Mercury y Stripe. Las demás las contás vos.">
            Traer los saldos reales
          </Button>
          <div className="arqueo-traer__avisos" role="status">
            {avisos.map((a, i) => <p key={i} className="t-sm t-muted">{a}</p>)}
          </div>
        </div>
      )}
      <div className="arqueo-tabla" role="table" aria-label="Saldo de cada cuenta">
        <div className="arqueo-fila arqueo-fila--cabeza" role="row">
          <span role="columnheader">Cuenta</span>
          <span role="columnheader">Último arqueo</span>
          <span role="columnheader" title="Lo cobrado por la cuenta, neto de la comisión de la pasarela: es lo que entra de verdad. Una planilla que cuenta el bruto da más.">Cobró (neto)</span>
          <span role="columnheader">Pases</span>
          <span role="columnheader">Salió</span>
          <span role="columnheader">Tendría que haber</span>
          <span role="columnheader">Hay de verdad</span>
        </div>
        {principales.map(fila)}
        {otros.length > 0 && (
          <>
            <button type="button" className="arqueo-otros" aria-expanded={otrosAbiertos} onClick={() => setVerOtros(!otrosAbiertos)}>
              <ChevronRight size={14} aria-hidden />
              <span>Otros ({otros.length})</span>
              <span className="t-sm t-subtle">cuentas que no se usan seguido</span>
            </button>
            {otrosAbiertos && otros.map(fila)}
          </>
        )}
      </div>
      {previo && (
        <p className="t-sm t-subtle arqueo-nota">
          «Tendría que haber» es lo del último arqueo más lo que cobró la cuenta (neto de la comisión de la pasarela: una planilla que cuenta el bruto da más), más o menos los movimientos entre cuentas
          {hayPases ? "" : " (todavía no hay ninguno cargado desde entonces)"} y menos los retiros, las devoluciones y los gastos que dicen de qué cuenta
          salieron. Un gasto que no dice la cuenta (o los sueldos y las comisiones) no se descuenta de ninguna: en la cuenta desde la que
          se pagó va a sobrar eso. El control que tiene que dar es el del total.
        </p>
      )}
      <div className="arqueo-resumen">
        <span>Contado <strong className="t-num">{M(total)}</strong></span>
        {esperado !== null ? (
          <>
            <span>Esperado <strong className="t-num">{M(esperado)}</strong></span>
            {saldos.length > 0 && <Diferencia d={Math.round((total - esperado) * 100) / 100} M={M} />}
          </>
        ) : <span className="t-subtle">Es el primer arqueo: queda como punto de partida.</span>}
        {primer.cuentas.length > 0 && (
          <span className="t-sm t-subtle arqueo-resumen__nota">
            El esperado incluye {M(primer.totalBase)} que ya tenían {new Intl.ListFormat("es", { style: "long", type: "conjunction" }).format(primer.cuentas.map((c) => e.procesadores.find((p) => p.id === c.procesadorId)?.nombre ?? "una cuenta"))} al arqueo anterior:
            {primer.cuentas.length === 1 ? " no estaba" : " no estaban"} en ese arqueo, así que es su primer conteo y se parte de lo que se movió desde entonces.
          </span>
        )}
        {mov && mov.enCamino > 0 && (
          <span className="t-sm t-subtle arqueo-resumen__nota">
            El esperado ya descuenta {M(mov.enCamino)} que están en camino entre cuentas: salieron de una y todavía no se vieron llegar a la otra.
          </span>
        )}
        {sinVenta.n > 0 && (
          <span className="t-sm t-subtle arqueo-resumen__nota">
            El esperado ya incluye {sinVenta.n === 1 ? "1 cobro" : `${sinVenta.n} cobros`} por {M(sinVenta.monto)} que {sinVenta.n === 1 ? "entró" : "entraron"} a las cuentas y todavía no tiene{sinVenta.n === 1 ? "" : "n"} su venta cargada
            (están en Conciliación): la plata está en la cuenta pero no cuenta como cobrada hasta que se concilie.
          </span>
        )}
      </div>
      <Field label="Notas" span2><Textarea rows={2} value={notas} onChange={(ev) => setNotas(ev.target.value)} placeholder="Qué se revisó, qué no dio" /></Field>
    </ModalForm>
  );
}

function VerArqueo({ e, a, onCerrar }: { e: EstadoApp; a: Arqueo; onCerrar: () => void }) {
  const M = (n: number) => money(n, e.ajustes.monedaBase);
  return (
    <Modal abierto onCerrar={onCerrar} titulo={`Arqueo del ${fechaLarga(a.fecha)}`} sub={a.por ? `Lo cargó ${a.por}` : undefined}>
      <dl className="caja-mov">
        {a.saldos.map((s) => (
          <React.Fragment key={s.procesadorId}>
            <dt>{e.procesadores.find((p) => p.id === s.procesadorId)?.nombre ?? "Cuenta borrada"}</dt>
            <dd className="t-num">{money(s.monto, s.moneda)}{s.moneda !== e.ajustes.monedaBase && <span className="t-sm t-subtle"> · {M(s.montoBase)}</span>}</dd>
            {/* La constancia de un saldo corregido (lo que el banco marcaba y por qué se guardó otro) va debajo, a todo el ancho. */}
            {s.nota && <dd className="t-sm t-subtle" style={{ gridColumn: "1 / -1", textAlign: "left", marginTop: -4 }}>{s.nota}</dd>}
            {/* Una cuenta con varias monedas (dLocal) deja dicho cuánto había en cada una y a qué tipo de cambio se pasó. */}
            {s.detalle?.map((l) => (
              <dd key={l.moneda} className="t-sm t-subtle" style={{ gridColumn: "1 / -1", textAlign: "left", marginTop: -4 }}>
                {num(l.monto)} {l.moneda} a {l.tipoCambio.toLocaleString("es-AR", { maximumFractionDigits: 4 })} por dólar = {M(l.montoBase)}
              </dd>
            ))}
          </React.Fragment>
        ))}
        <dt className="caja-mov__total">Total</dt>
        <dd className="caja-mov__total t-num">{M(a.total)}</dd>
        {a.esperado !== null && a.esperado !== undefined && (<><dt>Esperado</dt><dd className="t-num">{M(a.esperado)}</dd></>)}
      </dl>
      {a.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap", marginTop: 12 }}>{a.notas}</p>}
    </Modal>
  );
}

/* ---------- Un retiro del dueño ---------- */

function NuevoRetiro({ e, onCerrar, onListo }: { e: EstadoApp; onCerrar: () => void; onListo: () => void }) {
  const [dia, setDia] = useState(diaAr(hoyIso()));
  const [monto, setMonto] = useState("");
  const [cuenta, setCuenta] = useState("");
  const [concepto, setConcepto] = useState("Retiro de beneficios");
  const n = leerMonto(monto);
  function guardar() {
    const g: Gasto = {
      id: nuevoId("gas"), categoria: "Retiro de beneficios", grupo: "retiro", concepto: concepto.trim() || "Retiro de beneficios",
      monto: Math.round(n * 100) / 100, moneda: e.ajustes.monedaBase, fecha: new Date(`${dia}T15:00:00.000Z`).toISOString(),
      recurrente: false, proveedor: e.procesadores.find((p) => p.id === cuenta)?.nombre, creadoEn: hoyIso(),
      extra: cuenta ? { cuentaId: cuenta } : {},
    };
    acciones.crear<Gasto>("gastos", g, g.concepto);
    onListo();
  }
  return (
    <ModalForm
      abierto onCerrar={onCerrar} onGuardar={guardar} guardarTexto="Registrar retiro" puedeGuardar={n > 0}
      titulo="Retiro del dueño" sub="Plata que sacás de la caja del negocio. No es un gasto: no resta del profit, sí de la caja."
    >
      <div className="form-grid">
        <Field label="Monto (US$)"><InputMonto autoFocus value={monto} onChange={(ev) => setMonto(ev.target.value)} placeholder="30.000" /></Field>
        <Field label="Día"><Input type="date" value={dia} onChange={(ev) => setDia(ev.target.value || diaAr(hoyIso()))} /></Field>
        <Field label="De qué cuenta salió">
          <Select value={cuenta} placeholder="Sin especificar" onChange={(ev) => setCuenta(ev.target.value)}
            opciones={e.procesadores.filter((p) => p.activo).map((p) => ({ valor: p.id, texto: p.nombre }))} />
        </Field>
        <Field label="Concepto"><Input value={concepto} onChange={(ev) => setConcepto(ev.target.value)} /></Field>
      </div>
    </ModalForm>
  );
}
