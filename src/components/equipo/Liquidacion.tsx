"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Calculator, Check, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download,
  Lock, LockOpen, Plus, RefreshCw, StickyNote, Trash2, UserRound,
} from "lucide-react";
import {
  Avatar, Ayuda, Badge, Button, Card, Chip, Empty, IconButton, Input, Select, Switch,
} from "@/components/ui/ui";
import { InfoMetrica } from "@/components/ui/InfoMetrica";
import { InputMonto } from "@/components/ui/InputMonto";
import { Avance, PartesDeUnTotal, Segmentado, Senal, Senales } from "@/components/finanzas/visual/visual";
import { equipoPorTipo } from "@/lib/equipo-por-tipo";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useParamsURL } from "@/lib/useParamsURL";
import { reglasSinConfirmar } from "@/lib/reglas";
import { useUsuarioActual } from "@/lib/usuario";
import { fechaLarga, money, num } from "@/lib/format";
import { escribirMonto, infoGrupo, categoriaDe, leerMonto } from "@/lib/gastos";
import { pedirBlue } from "@/lib/dolar";
import {
  calcularLiquidacion, claveEntrada, diferenciasDesdeElCierre, esPeriodo, extrasPorVenir, faltantes, gastosDeLiquidacion,
  infoBase, liquidacionCsv, liquidacionVacia, mesesParaExtra, moverPeriodo, nombrePeriodo, periodoDe, plata, rangoDePeriodo, textoParaEnviar,
} from "@/lib/honorarios";
import type {
  EntradaLiquidacion, EstadoApp, ExtraLiquidacion, LineaLiquidada, Liquidacion, Moneda, PersonaLiquidada, ResultadoLiquidacion,
} from "@/lib/types";
import { DesgloseRenglon } from "./DesgloseRenglon";
import { GastosQueCuentan } from "./GastosQueCuentan";
import Link from "next/link";
import { EquipoPorTipo } from "./EquipoPorTipo";
import { mesDelAviso, settersConComisionInusual } from "@/lib/comision-inusual";
import { pagosSospechosos } from "@/lib/pagos-equipo";

/* ==================================================================
   La liquidación del mes.

   Abierta, se calcula sola con los datos de hoy: las comisiones con los
   cobros del mes, los tramos con el cash o la agenda, el profit con
   Finanzas. Lo que la app no puede saber —cuántos reels editó Nacho, si
   Manuel ganó el bono— se carga acá mismo, en el renglón.

   Cerrarla guarda la foto de lo que se paga (un cobro que se concilie
   tarde ya no la mueve) y carga los sueldos en Finanzas como gastos del
   mes. Después se marca a quién ya se le pagó.
   ================================================================== */

const hoyPeriodo = () => periodoDe(new Date());

/* Los nombres cortos de cada tipo de pago, para la barra de arriba. */
const CORTO_DE_GRUPO: Record<string, string> = { fijos: "Fijos y bonos", closers: "Closers y setters", directores: "Directores", socio: "Socio", externos: "Externos" };

/* "US$ 2.700 + $ 50.000": lo que se transfiere, por moneda. */
function aPagarTexto(a: Partial<Record<Moneda, number>>): string {
  const partes = (Object.entries(a) as [Moneda, number][])
    .filter(([, n]) => Math.abs(n) >= 0.005)
    .sort(([x], [y]) => (x === "USD" ? -1 : y === "USD" ? 1 : 0))
    .map(([m, n]) => plata(n, m));
  return partes.length ? partes.join(" + ") : plata(0, "USD");
}

/* Sin los campos vacíos: una entrada sin nada es lo mismo que no tenerla. */
function limpiar(x: EntradaLiquidacion): EntradaLiquidacion | null {
  const out: EntradaLiquidacion = {};
  if (x.cantidad !== undefined && Number.isFinite(x.cantidad)) out.cantidad = x.cantidad;
  if (x.cumplido === false) out.cumplido = false;
  if (x.monto !== undefined && Number.isFinite(x.monto)) out.monto = x.monto;
  if (x.nota?.trim()) out.nota = x.nota.trim();
  return Object.keys(out).length ? out : null;
}

/* `soloMirar`: quien sólo ve la liquidación (permiso «Liquidación» en «ver») no la cierra ni carga nada. `onVerPersona` falta para quien no es dueño:
   lo que cobra cada uno (su ficha) es de los dueños. */
export function LiquidacionMes({ onVerPersona, soloMirar = false, onVerReglas }: { onVerPersona?: (miembroId: string) => void; soloMirar?: boolean; onVerReglas?: () => void }) {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
  const [p, cambiar] = useParamsURL({ mes: hoyPeriodo() });
  const periodo = esPeriodo(p.mes) ? p.mes : hoyPeriodo();

  const guardada = e.liquidaciones.find((x) => x.periodo === periodo);
  const liq = useMemo(() => guardada ?? liquidacionVacia(periodo), [guardada, periodo]);
  const cerrada = liq.estado === "cerrada" && Boolean(liq.resultado);

  /* Abierta, con los datos de hoy; cerrada, con su foto. */
  const vivo = useMemo(() => calcularLiquidacion(e, periodo, liq), [e, periodo, liq]);
  const r: ResultadoLiquidacion = cerrada ? liq.resultado! : vivo;
  const falta = useMemo(() => faltantes(r), [r]);
  const corte = r.corte;
  /* Las reglas de comisión de este mes que nadie confirmó: se avisa antes de pagar (lib/reglas.ts). */
  const sinConfirmar = useMemo(() => (cerrada ? [] : reglasSinConfirmar(e, periodo)), [cerrada, e, periodo]);
  const cambios = useMemo(() => (cerrada ? diferenciasDesdeElCierre(e, liq) : []), [cerrada, e, liq]);
  /* Un setter que cobra mucho más que su mejor mes: se mira antes de pagar (Aldana, 31/10). */
  const settersInusuales = useMemo(() => settersConComisionInusual(e, periodo), [e, periodo]);

  /* Las notas para quien paga: los montos a mano que traen una. */
  const notas = useMemo(
    () => r.personas.flatMap((persona) => persona.lineas.filter((l) => l.nota).map((linea) => ({ persona, linea }))),
    [r],
  );
  /* Lo que se anotó para los meses que vienen, por persona. */
  const porVenir = useMemo(() => {
    const m = new Map<string, ReturnType<typeof extrasPorVenir>>();
    for (const x of extrasPorVenir(e.liquidaciones, periodo)) m.set(x.extra.miembroId, [...(m.get(x.extra.miembroId) ?? []), x]);
    return m;
  }, [e.liquidaciones, periodo]);
  /* En qué meses se puede anotar un monto: el que se mira y los que vienen, sin los cerrados. */
  const mesesParaMonto = useMemo(() => mesesParaExtra(e.liquidaciones, periodo, hoyPeriodo()), [e.liquidaciones, periodo]);
  const [verDesglose, setVerDesglose] = useState<{ miembroId: string; clave: string } | null>(null);

  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  /* Al cambiar de mes se abren las personas a las que les falta cargar algo: es lo
     primero que hay que hacer. Las notas para quien paga ya están arriba, en las señales. */
  useEffect(() => {
    setAbiertos(new Set(falta.lineas.map((x) => x.persona.miembroId)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodo]);
  const alternar = (id: string) => setAbiertos((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const todoAbierto = r.personas.length > 0 && r.personas.every((x) => abiertos.has(x.miembroId));

  const [cerrando, setCerrando] = useState(false);
  const [reabriendo, setReabriendo] = useState(false);

  const guardar = (cambio: Partial<Liquidacion>) => acciones.guardarLiquidacion({ ...liq, ...cambio });

  const guardarEntrada = (miembroId: string, conceptoId: string, cambio: Partial<EntradaLiquidacion> | null) => {
    const k = claveEntrada(miembroId, conceptoId);
    const entradas = { ...liq.entradas };
    const nueva = cambio === null ? null : limpiar({ ...entradas[k], ...cambio });
    if (nueva) entradas[k] = nueva; else delete entradas[k];
    guardar({ entradas });
  };

  /* Un monto a mano para este mes o para uno que viene: se anota en la
     liquidación de ese mes (se crea si todavía no existe). */
  const agregarExtra = (persona: PersonaLiquidada, x: { concepto: string; monto: number; moneda: Moneda; nota: string; periodo: string }): boolean => {
    const extra: ExtraLiquidacion = {
      id: nuevoId("ext"), miembroId: persona.miembroId, concepto: x.concepto, monto: x.monto, moneda: x.moneda,
      ...(x.nota ? { nota: x.nota } : {}),
      creadoEn: new Date().toISOString(), creadoPor: yo.nombre,
      ...(x.periodo !== periodo ? { desdePeriodo: periodo } : {}),
    };
    if (!acciones.agregarExtraLiquidacion(x.periodo, extra)) {
      toast(`La liquidación de ${nombrePeriodo(x.periodo)} ya está cerrada: reabrila para sumarle un monto.`, "err");
      return false;
    }
    if (x.periodo !== periodo) {
      toast(`Anotado para la liquidación de ${nombrePeriodo(x.periodo)}: ${x.monto < 0 ? "descuento" : "monto"} de ${plata(Math.abs(x.monto), x.moneda)} a ${persona.nombre.split(" ")[0]}.`);
    }
    return true;
  };
  const quitarExtra = (liquidacionId: string, extraId: string) => {
    if (!acciones.quitarExtraLiquidacion(liquidacionId, extraId)) toast("No se pudo sacar: esa liquidación ya se cerró.", "err");
  };

  /* Quién tiene algo para cobrar: a quien le toca cero no se le paga nada, así que no cuenta en «pagados». Lo mismo en el paso «Pagarle al equipo». */
  const aCobrar = useMemo(() => r.personas.filter((x) => x.total > 0), [r.personas]);
  const pagados = aCobrar.filter((x) => liq.pagos[x.miembroId]).length;
  const pagadoPlata = aCobrar.filter((x) => liq.pagos[x.miembroId]).reduce((a, x) => a + x.total, 0);
  const porTipo = useMemo(() => equipoPorTipo(r.personas, e.equipo), [r.personas, e.equipo]);
  const [vistaLista, setVistaLista] = useState<"persona" | "tipo">("persona");
  const [verSinNada, setVerSinNada] = useState(false);
  const sumaCambios = cambios.reduce((a, x) => a + (x.hoy - x.cerrado), 0);
  const topeCambios = Math.max(1, ...cambios.map((x) => Math.max(x.hoy, x.cerrado)));
  /* Lo que hay que hacer primero, arriba: lo que falta pagar o cargar y, dentro de eso, lo más grande. Quien no cobra nada queda aparte. */
  const quedaAparte = (x: PersonaLiquidada) => Math.abs(x.total) < 0.005 && (cerrada || (!x.lineas.some((l) => l.falta) && !x.pendiente && !x.sinCargar));
  const porMonto = (a: PersonaLiquidada, b: PersonaLiquidada) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es");
  const conMonto = r.personas.filter((x) => !quedaAparte(x));
  const sinNada = r.personas.filter(quedaAparte);
  const topeMonto = Math.max(1, ...conMonto.map((x) => x.total));
  const gruposLista: { id: string; titulo: string; personas: PersonaLiquidada[] }[] = cerrada
    ? [
      { id: "por-pagar", titulo: "Por pagar", personas: conMonto.filter((x) => !liq.pagos[x.miembroId]).sort(porMonto) },
      { id: "pagados", titulo: "Pagados", personas: conMonto.filter((x) => liq.pagos[x.miembroId]).sort(porMonto) },
    ].filter((g) => g.personas.length > 0)
    : [{ id: "todos", titulo: "", personas: [...conMonto].sort((a, b) => Number(b.lineas.some((l) => l.falta)) - Number(a.lineas.some((l) => l.falta)) || porMonto(a, b)) }];
  const fila = (persona: PersonaLiquidada) => (
    <FilaPersona
      key={persona.miembroId} persona={persona} liq={liq} cerrada={cerrada} soloMirar={soloMirar} tope={topeMonto}
      abierta={abiertos.has(persona.miembroId)} onAlternar={() => alternar(persona.miembroId)}
      onEntrada={(conceptoId, cambio) => guardarEntrada(persona.miembroId, conceptoId, cambio)}
      meses={mesesParaMonto} porVenir={porVenir.get(persona.miembroId)}
      onAgregarExtra={(x) => agregarExtra(persona, x)} onQuitarExtra={quitarExtra}
      onVerDesglose={(clave) => setVerDesglose({ miembroId: persona.miembroId, clave })}
      onPagado={(v) => acciones.marcarPagado(liq, persona.miembroId, v, yo.nombre)}
      onVerPersona={onVerPersona ? () => onVerPersona(persona.miembroId) : undefined}
      onCopiar={async () => {
        try { await navigator.clipboard.writeText(textoParaEnviar(persona, periodo, corte)); toast(`Copiado: pegáselo a ${persona.nombre.split(" ")[0]}.`); }
        catch { toast("No pude copiar. Probá de nuevo.", "err"); }
      }}
    />
  );
  /* Alguien cobra en pesos: hace falta el tipo de cambio. Y si ya hay pesos
     para transferir, el total se dice en las dos monedas. */
  const hayPesos = r.personas.some((x) => x.lineas.some((l) => l.moneda !== "USD"));
  const pagaPesos = Math.abs(r.aPagar.ARS ?? 0) >= 0.005;
  const base = e.ajustes.monedaBase;

  function exportar() {
    const blob = new Blob([liquidacionCsv(r, periodo)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `apicanta-liquidacion-${periodo}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const estado = cerrada
    ? pagados === aCobrar.length && aCobrar.length > 0
      ? <Badge variante="success" icono={<Check size={12} />}>Pagada</Badge>
      : <Badge variante="brand" icono={<Lock size={12} />}>Cerrada</Badge>
    : <Badge variante="neutral">Abierta</Badge>;
  const mesQueSigue = nombrePeriodo(moverPeriodo(periodo, 1));
  const haySenales = cambios.length > 0 || settersInusuales.length > 0 || sinConfirmar.length > 0 || notas.length > 0;

  return (
    <div className="stack-4">
      <div className="liq-cabecera">
        <div className="liq-mes">
          <div className="liq-mes__nav">
            <IconButton etiqueta="Mes anterior" onClick={() => cambiar({ mes: moverPeriodo(periodo, -1) })}><ChevronLeft size={18} /></IconButton>
            <h2 className="t-h2 liq-mes__nombre">{nombrePeriodo(periodo)}</h2>
            <IconButton etiqueta="Mes siguiente" onClick={() => cambiar({ mes: moverPeriodo(periodo, 1) })}><ChevronRight size={18} /></IconButton>
          </div>
          {estado}
          {corte && <Badge variante="brand">Hasta el {diaCorto(corte)}</Badge>}
          {periodo !== hoyPeriodo() && (
            <button type="button" className="link t-sm" onClick={() => cambiar({ mes: null })}>Ir a este mes</button>
          )}
          {cerrada && <span className="t-sm t-subtle liq-mes__quien">Cerrada el {fechaLarga(liq.cerradaEn)}{liq.cerradaPor ? ` por ${liq.cerradaPor.split(" ")[0]}` : ""}</span>}
        </div>
        <div className="row-wrap">
          <Button variante="secondary" icono={<Download size={16} />} onClick={exportar} disabled={r.personas.length === 0}>Exportar</Button>
          {!soloMirar && (cerrada
            ? <Button variante="secondary" icono={<LockOpen size={16} />} onClick={() => setReabriendo(true)}>Reabrir</Button>
            : <Button variante="primary" icono={<Lock size={16} />} onClick={() => setCerrando(true)} disabled={r.personas.length === 0}>Cerrar liquidación</Button>)}
        </div>
      </div>

      {/* Un solo número y lo que lo explica: cuánto, cuánto va pagado y en qué se va. */}
      <section className="fz-hero" aria-label="Lo que se paga este mes">
        <div>
          <span className="fz-hero__etiqueta">
            A pagar
            <InfoMetrica
              titulo="A pagar" periodo={nombrePeriodo(periodo)}
              ayuda="Todo lo que hay que pagarle al equipo por este mes: lo fijo más lo variable de todas las personas, en la moneda base."
              formula="Fijo + Variable, sumados de todas las personas"
              componentes={() => [
                { concepto: "Fijo: sueldos y abonos", valor: money(r.fijo, base, 2) },
                { concepto: "Variable: comisiones, bonos y piezas", valor: money(r.variable, base, 2), signo: "+" },
                { concepto: "A pagar", valor: money(r.total, base, 2), signo: "=" },
              ]}
            />
          </span>
          <span className="fz-hero__valor">{money(r.total, base)}</span>
          <p className="fz-hero__sub">
            {aCobrar.length} {aCobrar.length === 1 ? "persona" : "personas"}{pagaPesos ? ` · ${aPagarTexto(r.aPagar)}` : ""}
          </p>
        </div>
        <div className="fz-hero__der">
          {cerrada ? (
            <Avance
              hecho={pagadoPlata} total={r.total}
              izquierda={pagados === aCobrar.length ? <b>Ya se les pagó a todos</b> : <><b>{money(pagadoPlata, base)}</b> pagados</>}
              derecha={pagados === aCobrar.length ? undefined : <>Faltan <b>{money(r.total - pagadoPlata, base)}</b> · {aCobrar.length - pagados} de {aCobrar.length}</>}
            />
          ) : (
            <Avance
              hecho={r.personas.reduce((a, x) => a + x.lineas.filter((l) => !l.falta).length, 0)}
              total={r.personas.reduce((a, x) => a + x.lineas.length, 0)} tono={falta.lineas.length ? "alerta" : "brand"}
              izquierda={falta.lineas.length ? <><b>Falta cargar {falta.lineas.length}</b> {falta.lineas.length === 1 ? "renglón" : "renglones"}: valen cero hasta que se carguen</> : <b>Está todo cargado: se puede cerrar</b>}
            />
          )}
          {r.personas.length > 0 && (
            <PartesDeUnTotal
              etiqueta="En qué se va"
              onElegir={() => setVistaLista("tipo")}
              partes={porTipo.grupos.map((g) => ({ id: g.id, nombre: CORTO_DE_GRUPO[g.id] ?? g.titulo, valor: g.total, texto: money(g.total, base), ayuda: g.ayuda }))}
            />
          )}
        </div>
      </section>

      {haySenales && (
        <Senales titulo={cerrada && pagados < aCobrar.length ? "Antes de pagar" : "Para tener en cuenta"}>
          {notas.map(({ persona, linea }) => (
            <Senal
              key={`${persona.miembroId}:${linea.clave}`} tono="atencion" icono={<StickyNote size={16} />}
              titulo={<><b>{persona.nombre}</b> · {linea.nota}</>} sub="Nota para quien paga"
              der={<span className="t-num t-strong">{plata(linea.monto, linea.moneda)}</span>}
            />
          ))}
          {settersInusuales.map((x) => (
            <Senal
              key={x.miembroId} tono="atencion" icono={<AlertTriangle size={16} />}
              titulo={<><b>{x.nombre}</b> cobra {String(x.veces).replace(".", ",")} veces su mejor mes como setter</>}
              sub="Conviene mirar las ventas antes de pagar: puede que se hayan marcado agendas de más."
              der={(
                <>
                  <span className="fz-comparar" aria-hidden>
                    <span>Este mes</span><i data-fuerte style={{ width: 44 }} /><b>{money(x.esteMes, base)}</b>
                    <span>{mesDelAviso(x).split(" ")[0].replace(/^./, (c) => c.toUpperCase())}</span><i style={{ width: Math.max(4, 44 / x.veces) }} /><span>{money(x.mejorAntes, base)}</span>
                  </span>
                  <Link href={`/ventas?setter=${x.miembroId}`} className="hk-btn hk-btn--secondary hk-btn--sm">Ver sus ventas</Link>
                </>
              )}
            />
          ))}
          {sinConfirmar.length > 0 && (
            <Senal
              tono="atencion" icono={<AlertTriangle size={16} />}
              titulo={sinConfirmar.length === 1 ? <>Hay <b>una regla de comisión</b> sin confirmar</> : <>Hay <b>{sinConfirmar.length} reglas de comisión</b> sin confirmar</>}
              sub={sinConfirmar.map((x) => x.miembro.nombre.split(" ")[0]).filter((n, i, xs) => xs.indexOf(n) === i).join(", ")}
              der={onVerReglas && <Button sm variante="secondary" onClick={onVerReglas}>Ver las reglas</Button>}
            />
          )}
          {cambios.length > 0 && (
            <Senal
              icono={<RefreshCw size={16} />}
              titulo={corte
                ? <>Después del {diaCorto(corte)} entraron comisiones por <b>{money(sumaCambios, base)}</b></>
                : <>Algo del mes cambió después de cerrar: <b>{money(sumaCambios, base)}</b></>}
              sub={corte ? `Pasan solas a ${mesQueSigue}, a cada uno lo suyo. Lo pagado no se toca.` : "Lo pagado no se toca: se suma a mano en el mes que viene, o se reabre esta."}
              der={<span className="t-sm t-muted">{cambios.length} {cambios.length === 1 ? "persona" : "personas"}</span>}
            >
              <ul className="liq-difs">
                {cambios.map((x) => (
                  <li key={x.miembroId} className="liq-difs__fila">
                    <span className="truncate">{x.nombre}</span>
                    <span className="liq-difs__barra" aria-hidden>
                      <i style={{ width: `${(x.cerrado / topeCambios) * 100}%` }} /><i data-suma style={{ width: `${(Math.max(x.hoy - x.cerrado, 0) / topeCambios) * 100}%` }} />
                    </span>
                    <span className="t-num t-sm t-subtle">{plata(x.cerrado, base)}</span>
                    <span className="t-num t-sm t-strong">{x.hoy >= x.cerrado ? "+" : "−"}{plata(Math.abs(x.hoy - x.cerrado), base)}</span>
                  </li>
                ))}
              </ul>
            </Senal>
          )}
        </Senales>
      )}

      {!cerrada && !soloMirar && (
        <div className="liq-ajustes">
          <CorteDeLiquidacion periodo={periodo} valor={liq.corte ?? ""} activo={Boolean(corte)} onCambiar={(c) => guardar({ corte: c })} />
          {hayPesos && <TipoCambio valor={liq.tipoCambio ?? e.ajustes.tipoCambio} onCambiar={(tipoCambio) => guardar({ tipoCambio })} />}
        </div>
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="liq-lista-cab">
          <Segmentado
            etiqueta="Cómo mirar al equipo" valor={vistaLista} onCambiar={setVistaLista}
            opciones={[{ valor: "persona", texto: "Por persona" }, { valor: "tipo", texto: "Por tipo de pago" }]}
          />
          {vistaLista === "persona" && conMonto.length > 0 && (
            <span className="liq-leyenda" aria-hidden><i data-tipo="fijo" />Fijo<i data-tipo="variable" />Variable</span>
          )}
          {vistaLista === "persona" && r.personas.length > 0 && (
            <Button
              sm variante="ghost" icono={todoAbierto ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
              onClick={() => setAbiertos(todoAbierto ? new Set() : new Set(r.personas.map((x) => x.miembroId)))}
            >
              {todoAbierto ? "Contraer todo" : "Expandir todo"}
            </Button>
          )}
        </div>

        {r.personas.length === 0 ? (
          <div style={{ padding: "0 var(--space-5) var(--space-5)" }}>
            <Empty
              icono={<UserRound size={22} />} titulo="No hay a quién liquidar"
              texto="Cargá lo que cobra cada persona en «Equipo y lo que cobra» y la liquidación se arma sola."
            />
          </div>
        ) : vistaLista === "tipo" ? (
          <EquipoPorTipo e={e} r={r} />
        ) : (
          <div className="liq" role="table" aria-label={`Liquidación de ${nombrePeriodo(periodo)}`}>
            {gruposLista.map((g) => (
              <React.Fragment key={g.id}>
                {gruposLista.length > 1 && (
                  <div className="liq-grupo" role="row">
                    <span role="cell">{g.titulo} · {g.personas.length}</span>
                    <span role="cell" className="t-num">{money(g.personas.reduce((a, x) => a + x.total, 0), base)}</span>
                  </div>
                )}
                {g.personas.map(fila)}
              </React.Fragment>
            ))}
            {sinNada.length > 0 && (
              <>
                <button type="button" className="liq-sinnada" aria-expanded={verSinNada} onClick={() => setVerSinNada((v) => !v)}>
                  <ChevronRight size={15} className="liq-sinnada__chev" aria-hidden />
                  {sinNada.length === 1 ? "1 persona no cobra nada este mes" : `${sinNada.length} personas no cobran nada este mes`}
                </button>
                {verSinNada && sinNada.map(fila)}
              </>
            )}
            <div role="row" className="liq__fila liq__fila--total">
              <div role="rowheader" className="liq__concepto"><span className="liq__titulo">Todo el equipo</span></div>
              <div role="cell" className="liq__monto">{aPagarTexto(r.aPagar)}</div>
              <span aria-hidden />
            </div>
          </div>
        )}
      </Card>

      {r.personas.length > 0 && <GastosQueCuentan e={e} periodo={periodo} r={r} soloMirar={soloMirar} />}

      <p className="liq-pie">
        Con esta liquidación adentro, el profit de {nombrePeriodo(periodo).split(" ")[0]} da <b className="t-num">{plata(r.profit, base)}</b>
        <InfoMetrica
          titulo="Qué pasa con Finanzas" periodo={nombrePeriodo(periodo)}
          ayuda="Las comisiones de closers y del director y el reparto del profit, Finanzas ya las calcula solas de las ventas: acá se ven para pagarlas, pero no se cargan de nuevo. Todo lo demás entra al cerrar, como un gasto por categoría del mes y sin nombres, porque Finanzas la ve todo el equipo."
          formula="El profit sale de lo que hay cargado en Finanzas: un gasto que falte cargar lo infla."
        />
      </p>

      {verDesglose && (
        <DesgloseRenglon
          miembroId={verDesglose.miembroId} clave={verDesglose.clave} periodo={periodo}
          onCerrar={() => setVerDesglose(null)}
        />
      )}

      {cerrando && (
        <ModalCerrar
          e={e} liq={liq} r={vivo} onCerrar={() => setCerrando(false)}
          onConfirmar={() => {
            const resultado = calcularLiquidacion(e, periodo, liq);
            const gastos = gastosDeLiquidacion(e, liq, resultado);
            acciones.cerrarLiquidacion(liq, resultado, gastos, yo.nombre);
            setCerrando(false);
            toast(`Liquidación de ${nombrePeriodo(periodo)} cerrada: ${plata(resultado.total, base)}.`);
          }}
        />
      )}

      {reabriendo && (
        <Modal
          abierto onCerrar={() => setReabriendo(false)} titulo={`Reabrir ${nombrePeriodo(periodo)}`}
          pie={
            <>
              <Button variante="ghost" onClick={() => setReabriendo(false)}>Cancelar</Button>
              <span className="spacer" />
              <Button variante="danger" onClick={() => { acciones.reabrirLiquidacion(liq); setReabriendo(false); toast("Liquidación reabierta."); }}>Reabrir</Button>
            </>
          }
        >
          <p className="t-body t-muted">
            Se vuelve a calcular con los datos de hoy, sus gastos salen de Finanzas hasta que la vuelvas a cerrar y se
            desmarca lo que estaba marcado como pagado. Lo que cargaste a mano (piezas, bonos, correcciones) queda.
          </p>
        </Modal>
      )}
    </div>
  );
}

/* «2026-10-25» → «25/10». */
const diaCorto = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const aISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/* ---------- Hasta qué día cuenta ----------
   «En la liquidación incluye las ventas del día de hoy. Pero como el día aún no cerró estaría bueno poder
   discriminar las de hoy y que sea el cierre sólo hasta el 25/10» (Aldana, 26/10). */
function CorteDeLiquidacion({ periodo, valor, activo, onCambiar }: {
  periodo: string; valor: string; activo: boolean; onCambiar: (corte: string | null) => void;
}) {
  const [a, m] = periodo.split("-").map(Number);
  const primero = `${periodo}-01`, ultimo = aISO(new Date(a, m, 0));
  const ayer = new Date(); ayer.setDate(ayer.getDate() - 1);
  const ayerISO = aISO(ayer);
  const ayerEsDeEsteMes = ayerISO >= primero && ayerISO <= ultimo;
  return (
    <div className="liq-ajuste">
      <span className="liq-ajuste__nombre" title={activo
        ? `Las ventas, cobros y llamadas desde el ${diaCorto(addDia(valor))} no entran en esta liquidación; los sueldos fijos y bonos van enteros.`
        : "Para pagar a mitad de mes o sin contar un día que todavía no cerró. Sin fecha, cuenta el mes entero, hoy incluido."}>Cuenta hasta</span>
      <div style={{ width: 170 }}>
        <Input type="date" value={valor} min={primero} max={ultimo} aria-label="Cuenta hasta el día" onChange={(ev) => onCambiar(ev.target.value || null)} />
      </div>
      <Button variante="secondary" sm disabled={!ayerEsDeEsteMes || valor === ayerISO} onClick={() => onCambiar(ayerISO)}>Hasta ayer</Button>
      <Button variante="ghost" sm disabled={!valor} onClick={() => onCambiar(null)}>Todo el mes</Button>
    </div>
  );
}
/* El día siguiente a «2026-10-25», para decir «desde el 26/10». */
function addDia(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return aISO(new Date(a, m - 1, d + 1));
}

/* ---------- El tipo de cambio de lo que se paga en pesos ---------- */

function TipoCambio({ valor, onCambiar }: { valor: number; onCambiar: (n: number) => void }) {
  const toast = useToast();
  const [trayendo, setTrayendo] = useState(false);
  return (
    <div className="liq-ajuste">
      <span className="liq-ajuste__nombre" title="Pesos por dólar para lo que se paga en pesos: con esto se suma al total y entra a Finanzas.">Tipo de cambio</span>
      <div className="row-wrap">
        <div style={{ width: 140 }}>
          <CampoNumero valor={valor} onCambiar={(n) => { if (n !== undefined && n > 0) onCambiar(n); }} etiqueta="Tipo de cambio" />
        </div>
        <Button
          variante="secondary" sm cargando={trayendo}
          onClick={async () => {
            setTrayendo(true);
            try {
              const hoy = new Date();
              const dia = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;
              const c = await pedirBlue(dia);
              onCambiar(c.venta);
              toast(`Blue venta de hoy: ${num(c.venta, 2)} (${c.fuente}).`);
            } catch (err) {
              toast(err instanceof Error ? err.message : "No pude traer el dólar blue.", "err");
            } finally { setTrayendo(false); }
          }}
        >
          Usar el blue de hoy
        </Button>
      </div>
    </div>
  );
}

/* Un número que se escribe como se escribe acá ("25.000", "12,5") y se
   guarda al salir del campo o con Enter. Vacío es "sin dato". */
function CampoNumero({ valor, onCambiar, etiqueta, placeholder, autoFocus }: {
  valor: number | undefined; onCambiar: (n: number | undefined) => void; etiqueta: string;
  placeholder?: string; autoFocus?: boolean;
}) {
  const [texto, setTexto] = useState(valor === undefined ? "" : escribirMonto(valor));
  useEffect(() => { setTexto(valor === undefined ? "" : escribirMonto(valor)); }, [valor]);
  const aplicar = () => {
    const t = texto.trim();
    if (!t) { if (valor !== undefined) onCambiar(undefined); return; }
    const n = leerMonto(t);
    if (!Number.isFinite(n)) { setTexto(valor === undefined ? "" : escribirMonto(valor)); return; }
    if (n !== valor) onCambiar(n);
  };
  return (
    <InputMonto
      aria-label={etiqueta} placeholder={placeholder}
      value={texto} autoFocus={autoFocus}
      onChange={(ev) => setTexto(ev.target.value)} onBlur={aplicar}
      onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
      onClick={(ev) => ev.stopPropagation()}
    />
  );
}

/* ---------- Una persona ---------- */

function FilaPersona({
  persona, liq, cerrada, soloMirar, tope, abierta, onAlternar, onEntrada, meses, porVenir, onAgregarExtra, onQuitarExtra, onVerDesglose,
  onPagado, onVerPersona, onCopiar,
}: {
  persona: PersonaLiquidada; liq: Liquidacion; cerrada: boolean; soloMirar: boolean;
  /* Lo que cobra el que más cobra: de ahí sale el largo de la barra de cada uno. */
  tope: number;
  abierta: boolean; onAlternar: () => void;
  onEntrada: (conceptoId: string, cambio: Partial<EntradaLiquidacion> | null) => void;
  /* Los meses en los que se puede anotar un monto, y lo ya anotado para los que vienen. */
  meses: string[];
  porVenir?: ReturnType<typeof extrasPorVenir>;
  onAgregarExtra: (x: { concepto: string; monto: number; moneda: Moneda; nota: string; periodo: string }) => boolean;
  onQuitarExtra: (liquidacionId: string, extraId: string) => void;
  onVerDesglose: (clave: string) => void;
  onPagado: (v: boolean) => void; onVerPersona?: () => void; onCopiar: () => void;
}) {
  const faltan = persona.lineas.filter((l) => l.falta).length;
  const conNota = persona.lineas.some((l) => l.nota);
  const pago = liq.pagos[persona.miembroId];
  const [agregando, setAgregando] = useState(false);

  return (
    <div role="rowgroup" className="liq__persona" data-abierta={abierta || undefined}>
      <div role="row" className="liq__fila liq__fila--persona" onClick={onAlternar} data-pagado={cerrada && pago ? true : undefined}>
        <div role="rowheader" className="liq__concepto">
          <button type="button" className="liq__toggle" aria-expanded={abierta} onClick={(ev) => { ev.stopPropagation(); onAlternar(); }}>
            <ChevronRight size={16} className="liq__chevron" aria-hidden />
            <Avatar nombre={persona.nombre} size={32} />
            <span className="liq__textos">
              <span className="liq__titulo">{persona.nombre}</span>
              {persona.puesto && <span className="liq__sub liq__sub--una">{persona.puesto}</span>}
            </span>
          </button>
          <span className="liq__marcas">
            {persona.inactivo && <Badge variante="neutral">Ya no está</Badge>}
            {conNota && <Badge variante="warning" icono={<StickyNote size={12} />}>Con nota</Badge>}
            {persona.pendiente
              ? <Badge variante="warning">A definir</Badge>
              : persona.sinCargar && !persona.inactivo && <Badge variante="neutral">Sin cargar</Badge>}
            {!cerrada && faltan > 0 && <Badge variante="accent">Falta cargar {faltan}</Badge>}
          </span>
          {persona.total > 0 && (
            <span className="liq__prop" aria-hidden title={`Fijo ${plata(persona.fijo, "USD")} · Variable ${plata(persona.variable, "USD")}`}>
              {persona.fijo > 0 && <i data-tipo="fijo" style={{ width: `${(persona.fijo / tope) * 100}%` }} />}
              {persona.variable > 0 && <i data-tipo="variable" style={{ width: `${(persona.variable / tope) * 100}%` }} />}
            </span>
          )}
        </div>
        <div role="cell" className="liq__monto liq__monto--persona">{aPagarTexto(persona.aPagar)}</div>
        <div role="cell" className="liq__pagar" onClick={(ev) => ev.stopPropagation()}>
          {cerrada && persona.total > 0 && (soloMirar
            ? (pago ? <span className="liq-check" data-hecho title={`Pagado el ${fechaLarga(pago.pagadoEn)}${pago.por ? ` por ${pago.por}` : ""}`}><Check size={15} strokeWidth={2.5} aria-label="Pagado" /></span> : <span className="liq-check" title="Por pagar" />)
            : (
              <button
                type="button" className="liq-check" data-hecho={pago ? true : undefined} aria-pressed={Boolean(pago)}
                aria-label={`${persona.nombre}: ${pago ? "pagado, tocá para desmarcar" : "marcar como pagado"}`}
                title={pago ? `Pagado el ${fechaLarga(pago.pagadoEn)}${pago.por ? ` por ${pago.por}` : ""}. Tocá para desmarcar.` : "Marcar como pagado"}
                onClick={() => onPagado(!pago)}
              >
                <Check size={15} strokeWidth={2.5} aria-hidden />
              </button>
            ))}
        </div>
      </div>

      {abierta && (
        <>
          {(persona.pendiente || persona.sinCargar) && (
            <div role="row" className="liq__fila liq__fila--nota">
              <div role="cell" className="liq__nota liq__nota--aviso">
                <AlertTriangle size={14} />
                <span>
                {persona.inactivo
                  ? "Ya no está en el equipo, pero este mes entraron cuotas de ventas suyas y Finanzas le cuenta la comisión. Si no le corresponde, corregila a cero acá y en su ficha cargale una comisión de 0%."
                  : persona.pendiente ?? (persona.lineas.length
                    ? "No tiene cargado lo que cobra: su comisión sale con la tasa que usa Finanzas."
                    : "Todavía no tiene cargado lo que cobra: no se le liquida nada.")}
                {onVerPersona && <>{" "}<button type="button" className="link" onClick={onVerPersona}>{persona.sinCargar ? "Cargar lo que cobra" : "Ver lo que cobra"}</button></>}
                </span>
              </div>
            </div>
          )}
          {persona.deuda && Object.values(persona.deuda).some((x) => (x ?? 0) > 0.005) && (
            <div role="row" className="liq__fila liq__fila--nota">
              <div role="cell" className="liq__nota liq__nota--aviso">
                <AlertTriangle size={14} />
                <span>
                  <b>Queda debiendo {aPagarTexto(persona.deuda)}.</b> Este mes las devoluciones descontaron más de lo que cobraba: no se le paga nada y
                  la deuda pasa a la liquidación del mes que sigue, donde entra como una línea «Deuda de …» y se descuenta de lo que cobre.
                </span>
              </div>
            </div>
          )}
          {persona.lineas.length === 0 && !persona.pendiente && !persona.sinCargar && (
            <div role="row" className="liq__fila liq__fila--nota">
              <div role="cell" className="liq__nota">Nada que pagarle este mes.{onVerPersona && <> <button type="button" className="link" onClick={onVerPersona}>Ver lo que cobra</button></>}</div>
            </div>
          )}
          {persona.lineas.map((l) => (
            <Linea
              key={l.clave} l={l} cerrada={cerrada} soloMirar={soloMirar} entrada={l.conceptoId ? liq.entradas[claveEntrada(persona.miembroId, l.conceptoId)] : undefined}
              onEntrada={(cambio) => l.conceptoId && onEntrada(l.conceptoId, cambio)}
              onBorrarExtra={() => l.extraId && onQuitarExtra(liq.id, l.extraId)}
              onVerDesglose={() => onVerDesglose(l.clave)}
            />
          ))}
          {porVenir && porVenir.length > 0 && (
            <div role="row" className="liq__fila liq__fila--nota">
              <div role="cell" className="liq__nota liq__porvenir">
                <span className="liq__porvenir-titulo">Anotado para los meses que vienen</span>
                <ul className="liq__porvenir-lista">
                  {porVenir.map(({ liquidacionId, periodo: mes, extra: x }) => (
                    <li key={x.id}>
                      <span>
                        <b>{nombrePeriodo(mes)}</b> · {x.concepto}: {plata(x.monto, x.moneda)}
                        {x.nota ? <span className="liq__sub"> Nota: {x.nota}</span> : null}
                      </span>
                      {!soloMirar && <IconButton etiqueta={`Sacar lo anotado para ${nombrePeriodo(mes)}`} onClick={() => onQuitarExtra(liquidacionId, x.id)}><Trash2 size={14} /></IconButton>}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {agregando && (
            <NuevoExtra
              periodo={liq.periodo} meses={meses}
              onCancelar={() => setAgregando(false)}
              onAgregar={(x) => { if (onAgregarExtra(x)) setAgregando(false); }}
            />
          )}
          <div role="row" className="liq__fila liq__fila--acciones">
            <div role="cell" className="liq__acciones">
              {!soloMirar && !agregando && meses.length > 0 && (
                <Button sm variante="ghost" icono={<Plus size={15} />} onClick={() => setAgregando(true)}>Sumar o descontar un monto</Button>
              )}
              <Button sm variante="ghost" icono={<Copy size={15} />} onClick={onCopiar}>Copiar para mandarle</Button>
              {onVerPersona && <Button sm variante="ghost" icono={<UserRound size={15} />} onClick={onVerPersona}>Ver lo que cobra</Button>}
              {cerrada && pago && <span className="t-sm t-subtle liq__pagado">Pagado el {fechaLarga(pago.pagadoEn)}{pago.por ? ` por ${pago.por}` : ""}</span>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Un renglón ---------- */

function Linea({ l, cerrada, soloMirar, entrada, onEntrada, onBorrarExtra, onVerDesglose }: {
  l: LineaLiquidada; cerrada: boolean; soloMirar: boolean; entrada?: EntradaLiquidacion;
  onEntrada: (cambio: Partial<EntradaLiquidacion> | null) => void;
  onBorrarExtra: () => void;
  onVerDesglose: () => void;
}) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const base = infoBase(l.base);
  /* Lo que se carga en el renglón mismo: cuántas piezas, o cuántas ventas o
     llamadas si lo contado por la app no es lo real. */
  const cuentaPiezas = l.tipo === "unidad";
  const cuentaCantidad = (l.tipo === "porcentaje" || l.tipo === "tramo") && !base.plata;

  return (
    <>
      <div role="row" className="liq__fila liq__fila--linea" data-falta={l.falta ? true : undefined} data-cero={!l.falta && Math.abs(l.monto) < 0.005 ? true : undefined} data-tipo={l.tipo}>
        <div role="rowheader" className="liq__concepto liq__concepto--linea">
          <span className="liq__textos">
            <span className="liq__titulo">
              {l.nombre}
              {l.enFinanzas && <span className="liq__enfin" title="Finanzas ya la calcula de las ventas: al cerrar no se carga de nuevo.">en Finanzas</span>}
              {l.corregido && <span className="tag liq__tag">Corregido</span>}
            </span>
            <span className="liq__sub">{l.detalle}</span>
            {l.nota && (
              <span className="liq__notapago" role="note">
                <AlertTriangle size={14} aria-hidden />
                <span><b>Nota para quien paga:</b> {l.nota}</span>
              </span>
            )}
            {l.cargado && <span className="liq__sub">{l.cargado}</span>}
          </span>
          <span className="liq__carga" onClick={(ev) => ev.stopPropagation()}>
            {!cerrada && !soloMirar && (<>
              {l.tipo === "bono" && (
                <label className="row" style={{ gap: 8 }}>
                  <Switch checked={entrada?.cumplido !== false} onChange={(v) => onEntrada({ cumplido: v ? undefined : false })} etiqueta={`${l.nombre}: lo ganó`} />
                  <span className="t-sm">Lo ganó</span>
                </label>
              )}
              {(cuentaPiezas || cuentaCantidad) && (
                <span className="liq__cantidad">
                  <CampoNumero
                    valor={entrada?.cantidad} etiqueta={`${l.nombre}: cantidad`}
                    placeholder={cuentaPiezas ? "¿Cuántas?" : l.medido !== undefined ? num(l.medido) : "0"}
                    onCambiar={(n) => onEntrada({ cantidad: n })}
                  />
                  <span className="t-sm t-subtle">{cuentaPiezas ? l.unidad || "piezas" : l.base === "manual" ? l.unidad || "cantidad" : infoBase(l.base).nombre.toLowerCase()}</span>
                </span>
              )}
              {l.tipo === "extra" ? (
                <IconButton etiqueta="Sacar este monto" onClick={onBorrarExtra}><Trash2 size={15} /></IconButton>
              ) : l.tipo === "descuento" ? null /* Lo calcula la app (el interruptor del cierre del día de Ajustes → CRM, o el % propio de una venta del setter): no se corrige acá. */
              : l.tipo === "devolucion" || l.tipo === "arrastre" ? null /* Lo calcula la devolución cargada (Finanzas → Devoluciones): se corrige allá. */
              : l.corregido ? (
                <button type="button" className="link t-sm" onClick={() => onEntrada({ monto: undefined, nota: undefined })}>Volver a la cuenta</button>
              ) : (
                <button type="button" className="link t-sm" onClick={() => setCorrigiendo((v) => !v)}>{corrigiendo ? "Cancelar" : "Corregir"}</button>
              )}
            </>)}
            {/* Siempre al final, pegado al monto: así queda en la misma columna en todos los renglones. */}
            {l.tipo !== "extra" && (
              <button type="button" className="link t-sm liq__ver" onClick={onVerDesglose}>
                <Calculator size={14} aria-hidden /> Cómo se calculó
              </button>
            )}
          </span>
        </div>
        <div role="cell" className="liq__monto">{plata(l.monto, l.moneda)}</div>
        <span aria-hidden />
      </div>
      {corrigiendo && !cerrada && !soloMirar && (
        <Corregir
          l={l}
          onGuardar={(monto, nota) => { onEntrada({ monto, nota }); setCorrigiendo(false); }}
        />
      )}
    </>
  );
}

function Corregir({ l, onGuardar }: { l: LineaLiquidada; onGuardar: (monto: number, nota: string) => void }) {
  const [monto, setMonto] = useState(escribirMonto(l.monto));
  const [nota, setNota] = useState("");
  const n = leerMonto(monto);
  return (
    <div role="row" className="liq__fila liq__fila--form">
      <div role="cell" className="liq__form">
        <div className="hk-field">
          <label className="hk-label">Monto a pagar ({l.moneda === "USD" ? "US$" : "$"})</label>
          <InputMonto negativos value={monto} onChange={(ev) => setMonto(ev.target.value)} autoFocus aria-label="Monto a pagar" />
        </div>
        <div className="hk-field" style={{ flex: "2 1 240px" }}>
          <label className="hk-label">Por qué (opcional)</label>
          <Input value={nota} onChange={(ev) => setNota(ev.target.value)} placeholder="Arrancó el 15, se acordó otro número…" aria-label="Por qué se corrige" />
        </div>
        <Button sm variante="secondary" disabled={!Number.isFinite(n)} onClick={() => onGuardar(n, nota)}>Guardar</Button>
      </div>
    </div>
  );
}

/* «Qué mes»: el que se está mirando y los que vienen. Se puede anotar un
   descuento para el mes que viene, con una nota para quien paga. */
function etiquetaMes(mes: string, mirando: string): string {
  const hoy = periodoDe(new Date());
  const marca = mes === mirando ? " · el que mirás" : mes === hoy ? " · este mes" : mes === moverPeriodo(hoy, 1) ? " · el que viene" : "";
  return `${nombrePeriodo(mes)}${marca}`;
}

function NuevoExtra({ periodo, meses, onCancelar, onAgregar }: {
  periodo: string; meses: string[];
  onCancelar: () => void;
  onAgregar: (x: { concepto: string; monto: number; moneda: Moneda; nota: string; periodo: string }) => void;
}) {
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<Moneda>("USD");
  const [resta, setResta] = useState(false);
  const [nota, setNota] = useState("");
  /* Por defecto el mes que se está mirando; si ya está cerrado, el primero que sigue abierto. */
  const [destino, setDestino] = useState(meses.includes(periodo) ? periodo : meses[0]);
  const n = leerMonto(monto);
  const listo = concepto.trim().length >= 2 && n > 0 && Boolean(destino);
  const paraOtroMes = destino !== periodo;
  return (
    <div role="row" className="liq__fila liq__fila--form">
      <div role="cell" className="liq__form">
        <div className="hk-field" style={{ flex: "2 1 220px" }}>
          <label className="hk-label">Qué es</label>
          <Input value={concepto} onChange={(ev) => setConcepto(ev.target.value)} placeholder="Adelanto, reintegro de viáticos, cobro en su cuenta personal" autoFocus aria-label="Qué es" />
        </div>
        <div className="hk-field" style={{ flex: "1 1 120px" }}>
          <label className="hk-label">Monto</label>
          <InputMonto value={monto} onChange={(ev) => setMonto(ev.target.value)} aria-label="Monto" placeholder="0" />
        </div>
        <div className="row-wrap" style={{ alignSelf: "flex-end", paddingBottom: 6 }}>
          <Chip activo={moneda === "USD"} onClick={() => setMoneda("USD")}>US$</Chip>
          <Chip activo={moneda === "ARS"} onClick={() => setMoneda("ARS")}>$</Chip>
          <Chip activo={!resta} onClick={() => setResta(false)}>Suma</Chip>
          <Chip activo={resta} onClick={() => setResta(true)}>Descuenta</Chip>
        </div>
        <div className="hk-field" style={{ flex: "1 1 260px" }}>
          <label className="hk-label">En qué liquidación</label>
          <Select
            value={destino} aria-label="En qué liquidación"
            opciones={meses.map((m) => ({ valor: m, texto: etiquetaMes(m, periodo) }))}
            onChange={(ev) => setDestino(ev.target.value)}
          />
        </div>
        <div className="hk-field" style={{ flex: "2 1 100%" }}>
          <label className="hk-label">Nota para quien paga (opcional)</label>
          <Input
            value={nota} onChange={(ev) => setNota(ev.target.value)} aria-label="Nota para quien paga"
            placeholder="Cobró US$ 500 en su cuenta personal: descontárselos de este pago"
          />
          <span className="hk-help">
            {paraOtroMes
              ? `Queda anotado para la liquidación de ${nombrePeriodo(destino)}: se ve en la persona, en «Copiar para mandarle» y al cerrar.`
              : "Se ve en la persona, en «Copiar para mandarle» y al cerrar."}
          </span>
        </div>
        <div className="row" style={{ alignSelf: "flex-end" }}>
          <Button sm variante="ghost" onClick={onCancelar}>Cancelar</Button>
          <Button
            sm variante="secondary" disabled={!listo}
            onClick={() => onAgregar({ concepto: concepto.trim(), monto: resta ? -n : n, moneda, nota: nota.trim(), periodo: destino })}
          >
            {paraOtroMes ? `Anotar para ${nombrePeriodo(destino)}` : "Agregar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Cerrar ---------- */

function ModalCerrar({ e, liq, r, onCerrar, onConfirmar }: {
  e: EstadoApp; liq: Liquidacion; r: ResultadoLiquidacion; onCerrar: () => void; onConfirmar: () => void;
}) {
  const base = e.ajustes.monedaBase;
  const falta = faltantes(r);
  const sinConfirmar = reglasSinConfirmar(e, liq.periodo);
  /* Pagos al equipo cargados como gasto sin marcar: al cerrar, el mismo sueldo entra otra vez a Finanzas. */
  const dobles = pagosSospechosos(e, r, rangoDePeriodo(liq.periodo));
  const gastos = gastosDeLiquidacion(e, liq, r);
  const bonos = r.personas.flatMap((p) => p.lineas.filter((l) => l.tipo === "bono" && l.monto > 0).map(() => p.nombre.split(" ")[0]));
  /* Lo que tiene que saber quien ejecuta los pagos. */
  const notas = r.personas.flatMap((p) => p.lineas.filter((l) => l.nota).map((l) => ({ p, l })));
  const enFinanzas = r.personas.reduce((a, p) => a + p.lineas.filter((l) => l.enFinanzas).reduce((x, l) => x + l.montoBase, 0), 0);

  return (
    <Modal
      abierto onCerrar={onCerrar} titulo={`Cerrar ${nombrePeriodo(liq.periodo)}`} ancho
      sub="Los montos quedan fijos y los sueldos entran a Finanzas. Se puede reabrir."
      pie={
        <>
          <Button variante="ghost" onClick={onCerrar}>Cancelar</Button>
          <span className="spacer" />
          <Button variante="primary" icono={<Lock size={16} />} disabled={falta.sinCambio} onClick={onConfirmar}>
            Cerrar y cargar en Finanzas
          </Button>
        </>
      }
    >
      <div className="stack-4">
        <div className="liq-cierre__total">
          <span className="t-label">A pagar</span>
          <span className="liq-cierre__monto">{aPagarTexto(r.aPagar)}</span>
          <span className="t-sm t-subtle">{r.personas.length} personas · {plata(r.total, base)} en total</span>
        </div>

        {falta.sinCambio && (
          <Ayuda titulo="Falta el tipo de cambio" icono={<AlertTriangle size={18} />}>
            Hay montos en pesos: poné el tipo de cambio arriba de la liquidación para poder cerrarla.
          </Ayuda>
        )}
        {falta.lineas.length > 0 && (
          <Ayuda titulo={`${falta.lineas.length === 1 ? "Un renglón" : `${falta.lineas.length} renglones`} sin cargar: van en cero`} icono={<AlertTriangle size={18} />}>
            {[...new Set(falta.lineas.map((x) => x.persona.nombre))].join(", ")}. Si trabajaron este mes, cargá cuántas piezas antes de cerrar.
          </Ayuda>
        )}
        {sinConfirmar.length > 0 && (
          <Ayuda titulo={`${sinConfirmar.length === 1 ? "Una regla" : `${sinConfirmar.length} reglas`} sin confirmar`} icono={<AlertTriangle size={18} />}>
            {sinConfirmar.map((x) => `${x.miembro.nombre} (${x.concepto.nombre})`).join(" · ")}. Se pagan como están cargadas; están en la solapa «Reglas».
          </Ayuda>
        )}
        {dobles.length > 0 && (
          <Ayuda titulo={`${dobles.length === 1 ? "Un gasto parece" : `${dobles.length} gastos parecen`} un pago al equipo ya cargado`} icono={<AlertTriangle size={18} />}>
            {plata(dobles.reduce((a, x) => a + x.gasto.monto, 0), base)} ({[...new Set(dobles.map((x) => x.nombre.split(" ")[0]))].join(", ")}). Al cerrar, los sueldos entran a Finanzas y esos pagos se cuentan dos veces.
            Marcalos en «Gastos que cuentan en los costos del mes» antes de cerrar.
          </Ayuda>
        )}
        {falta.pendientes.length > 0 && (
          <Ayuda titulo="Con algo a definir" icono={<AlertTriangle size={18} />}>
            {falta.pendientes.map((p) => `${p.nombre}: ${p.pendiente ?? "no tiene nada cargado"}`).join(" · ")}. Lo que no está cargado no se liquida.
          </Ayuda>
        )}
        {notas.length > 0 && (
          <div className="liq-notas" role="note">
            <AlertTriangle size={18} aria-hidden />
            <div>
              <div className="liq-notas__titulo">{notas.length === 1 ? "Una nota para quien paga" : `${notas.length} notas para quien paga`}</div>
              <ul className="liq-notas__lista">
                {notas.map(({ p, l }) => (
                  <li key={`${p.miembroId}:${l.clave}`}><b>{p.nombre}</b> · {l.nombre} ({plata(l.monto, l.moneda)}): {l.nota}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        <dl className="dl">
          {bonos.length > 0 && (<><dt>Bonos</dt><dd>Se pagan los de {bonos.join(", ")}. Si alguno no lo ganó, apagalo en su renglón.</dd></>)}
          {r.corte && (<><dt>Cuenta hasta</dt><dd>El {diaCorto(r.corte)}: lo que se cobró, vendió o llamó después va en la liquidación que sigue. Los sueldos fijos y bonos van enteros.</dd></>)}
          <dt>A Finanzas</dt>
          <dd>
            {gastos.length === 0
              ? "No se carga ningún gasto."
              : gastos.map((g) => `${g.categoria} (${infoGrupo(categoriaDe(e, g.categoria)?.grupo ?? g.grupo).corto.toLowerCase()}): ${plata(g.monto, base)}`).join(" · ")}
          </dd>
          {enFinanzas > 0 && (
            <><dt>Ya están</dt><dd>{plata(enFinanzas, base)} de comisiones de closers y del director y del reparto del profit: Finanzas ya los calcula de las ventas.</dd></>
          )}
        </dl>
      </div>
    </Modal>
  );
}
