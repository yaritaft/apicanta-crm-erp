"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, Check, ChevronLeft, ChevronRight, ChevronsDownUp, ChevronsUpDown, Copy, Download,
  Lock, LockOpen, Plus, RefreshCw, Trash2, UserRound,
} from "lucide-react";
import {
  Ayuda, Badge, Button, Card, Chip, Empty, IconButton, Input, StatCard, Switch,
} from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useParamsURL } from "@/lib/useParamsURL";
import { useUsuarioActual } from "@/lib/usuario";
import { fechaLarga, num } from "@/lib/format";
import { escribirMonto, infoGrupo, categoriaDe, leerMonto } from "@/lib/gastos";
import { pedirBlue } from "@/lib/dolar";
import {
  calcularLiquidacion, claveEntrada, diferenciasDesdeElCierre, esPeriodo, faltantes, gastosDeLiquidacion,
  idLiquidacion, infoBase, liquidacionCsv, moverPeriodo, nombrePeriodo, periodoDe, plata, textoParaEnviar,
} from "@/lib/honorarios";
import type {
  EntradaLiquidacion, EstadoApp, LineaLiquidada, Liquidacion, Moneda, PersonaLiquidada, ResultadoLiquidacion,
} from "@/lib/types";

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

function vacia(periodo: string): Liquidacion {
  return {
    id: idLiquidacion(periodo), periodo, estado: "abierta", entradas: {}, extras: [],
    pagos: {}, gastoIds: [], creadoEn: new Date().toISOString(),
  };
}

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

export function LiquidacionMes({ onVerPersona }: { onVerPersona: (miembroId: string) => void }) {
  const e = useEstado();
  const toast = useToast();
  const yo = useUsuarioActual();
  const [p, cambiar] = useParamsURL({ mes: hoyPeriodo() });
  const periodo = esPeriodo(p.mes) ? p.mes : hoyPeriodo();

  const guardada = e.liquidaciones.find((x) => x.periodo === periodo);
  const liq = useMemo(() => guardada ?? vacia(periodo), [guardada, periodo]);
  const cerrada = liq.estado === "cerrada" && Boolean(liq.resultado);

  /* Abierta, con los datos de hoy; cerrada, con su foto. */
  const vivo = useMemo(() => calcularLiquidacion(e, periodo, liq), [e, periodo, liq]);
  const r: ResultadoLiquidacion = cerrada ? liq.resultado! : vivo;
  const falta = useMemo(() => faltantes(r), [r]);
  const cambios = useMemo(() => (cerrada ? diferenciasDesdeElCierre(e, liq) : []), [cerrada, e, liq]);

  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());
  /* Al cambiar de mes se abren las personas a las que les falta cargar algo:
     es lo primero que hay que hacer. */
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

  const pagados = r.personas.filter((x) => liq.pagos[x.miembroId]).length;
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
    ? pagados === r.personas.length && r.personas.length > 0
      ? <Badge variante="success" icono={<Check size={12} />}>Pagada</Badge>
      : <Badge variante="brand" icono={<Lock size={12} />}>Cerrada</Badge>
    : <Badge variante="neutral">Abierta</Badge>;

  return (
    <div className="stack-4">
      <div className="liq-cabecera">
        <div className="liq-mes">
          <div className="liq-mes__nav">
            <IconButton etiqueta="Mes anterior" onClick={() => cambiar({ mes: moverPeriodo(periodo, -1) })}><ChevronLeft size={18} /></IconButton>
            <h2 className="t-h2 liq-mes__nombre">Liquidación de {nombrePeriodo(periodo)}</h2>
            <IconButton etiqueta="Mes siguiente" onClick={() => cambiar({ mes: moverPeriodo(periodo, 1) })}><ChevronRight size={18} /></IconButton>
          </div>
          {estado}
          {periodo !== hoyPeriodo() && (
            <button type="button" className="link t-sm" onClick={() => cambiar({ mes: null })}>Ir a este mes</button>
          )}
        </div>
        <div className="row-wrap">
          <Button variante="secondary" icono={<Download size={16} />} onClick={exportar} disabled={r.personas.length === 0}>Exportar</Button>
          {cerrada
            ? <Button variante="secondary" icono={<LockOpen size={16} />} onClick={() => setReabriendo(true)}>Reabrir</Button>
            : <Button variante="primary" icono={<Lock size={16} />} onClick={() => setCerrando(true)} disabled={r.personas.length === 0}>Cerrar liquidación</Button>}
        </div>
      </div>

      {cerrada && (
        <p className="t-sm t-subtle" style={{ marginTop: -8 }}>
          Cerrada el {fechaLarga(liq.cerradaEn)}{liq.cerradaPor ? ` por ${liq.cerradaPor}` : ""}: los montos quedaron fijos y los sueldos ya están en Finanzas.
        </p>
      )}

      <div className="grid-stats">
        <StatCard hero etiqueta="A pagar" valor={plata(r.total, base)} contexto={pagaPesos ? aPagarTexto(r.aPagar) : `${r.personas.length} personas`} />
        <StatCard etiqueta="Fijo" valor={plata(r.fijo, base)} contexto="Sueldos y abonos" />
        <StatCard etiqueta="Variable" valor={plata(r.variable, base)} contexto="Comisiones, bonos y piezas" />
        {cerrada
          ? <StatCard etiqueta="Pagados" valor={`${pagados} de ${r.personas.length}`} contexto={pagados === r.personas.length ? "No queda nadie" : "Marcalos al transferir"} />
          : <StatCard
              etiqueta="Falta cargar" valor={String(falta.lineas.length)}
              direccion={falta.lineas.length ? "accent" : "neutral"}
              contexto={falta.lineas.length ? "Piezas y cantidades del mes" : "Está todo"}
            />}
      </div>

      {cambios.length > 0 && (
        <Ayuda titulo="Algo del mes cambió después de cerrar" icono={<RefreshCw size={18} />}>
          {cambios.map((x) => `${x.nombre}: cerrado en ${plata(x.cerrado, base)}, hoy daría ${plata(x.hoy, base)}`).join(" · ")}.
          {" "}Lo pagado no se toca: la diferencia se puede sumar a mano en la liquidación del mes que viene, o reabrir esta.
        </Ayuda>
      )}

      {!cerrada && hayPesos && (
        <TipoCambio valor={liq.tipoCambio ?? e.ajustes.tipoCambio} onCambiar={(tipoCambio) => guardar({ tipoCambio })} />
      )}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        <div className="pyl-head">
          <div className="pyl-head__texto">
            <h3 className="card-head__title">Persona por persona</h3>
            <p className="card-head__sub">
              {cerrada
                ? "Lo que se le paga a cada uno. Tocá una persona para ver de dónde sale y marcar que ya se le pagó."
                : "Tocá una persona para ver de dónde sale cada monto y cargar lo que falta."}
            </p>
          </div>
          <Button
            sm variante="ghost" icono={todoAbierto ? <ChevronsDownUp size={15} /> : <ChevronsUpDown size={15} />}
            onClick={() => setAbiertos(todoAbierto ? new Set() : new Set(r.personas.map((x) => x.miembroId)))}
          >
            {todoAbierto ? "Contraer todo" : "Expandir todo"}
          </Button>
        </div>

        {r.personas.length === 0 ? (
          <div style={{ padding: "0 var(--space-5) var(--space-5)" }}>
            <Empty
              icono={<UserRound size={22} />} titulo="No hay a quién liquidar"
              texto="Cargá lo que cobra cada persona en «Equipo y lo que cobra» y la liquidación se arma sola."
            />
          </div>
        ) : (
          <div className="liq" role="table" aria-label={`Liquidación de ${nombrePeriodo(periodo)}`}>
            {r.personas.map((persona) => (
              <FilaPersona
                key={persona.miembroId} persona={persona} liq={liq} cerrada={cerrada}
                abierta={abiertos.has(persona.miembroId)} onAlternar={() => alternar(persona.miembroId)}
                onEntrada={(conceptoId, cambio) => guardarEntrada(persona.miembroId, conceptoId, cambio)}
                onExtras={(extras) => guardar({ extras })}
                onPagado={(v) => acciones.marcarPagado(liq, persona.miembroId, v, yo.nombre)}
                onVerPersona={() => onVerPersona(persona.miembroId)}
                onCopiar={async () => {
                  try { await navigator.clipboard.writeText(textoParaEnviar(persona, periodo)); toast(`Copiado: pegáselo a ${persona.nombre.split(" ")[0]}.`); }
                  catch { toast("No pude copiar. Probá de nuevo.", "err"); }
                }}
              />
            ))}
            <div role="row" className="liq__fila liq__fila--total">
              <div role="rowheader" className="liq__concepto"><span className="liq__titulo">Todo el equipo</span></div>
              <div role="cell" className="liq__monto">{aPagarTexto(r.aPagar)}</div>
            </div>
          </div>
        )}
      </Card>

      <Ayuda titulo="Qué pasa con Finanzas" icono={<AlertTriangle size={18} />}>
        Las comisiones de closers y del director, y el reparto del profit, Finanzas ya las calcula solas de las ventas: acá
        se ven para pagarlas, pero no se cargan de nuevo. Todo lo demás entra al cerrar, como un gasto por categoría del mes
        y sin nombres, porque Finanzas la ve todo el equipo. El profit de {nombrePeriodo(periodo)} con esta liquidación
        adentro da {plata(r.profit, base)}: sale de lo que hay cargado en Finanzas, así que un gasto que falte cargar lo infla.
      </Ayuda>

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

/* ---------- El tipo de cambio de lo que se paga en pesos ---------- */

function TipoCambio({ valor, onCambiar }: { valor: number; onCambiar: (n: number) => void }) {
  const toast = useToast();
  const [trayendo, setTrayendo] = useState(false);
  return (
    <Card className="liq-tc">
      <div style={{ minWidth: 0, flex: "1 1 280px" }}>
        <h3 className="card-head__title">Tipo de cambio</h3>
        <p className="card-head__sub">Pesos por dólar para lo que se paga en pesos: con esto se suma al total y entra a Finanzas.</p>
      </div>
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
    </Card>
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
    <Input
      type="text" inputMode="decimal" autoComplete="off" aria-label={etiqueta} placeholder={placeholder}
      value={texto} autoFocus={autoFocus}
      onChange={(ev) => setTexto(ev.target.value)} onBlur={aplicar}
      onKeyDown={(ev) => { if (ev.key === "Enter") (ev.target as HTMLInputElement).blur(); }}
      onClick={(ev) => ev.stopPropagation()}
    />
  );
}

/* ---------- Una persona ---------- */

function FilaPersona({
  persona, liq, cerrada, abierta, onAlternar, onEntrada, onExtras, onPagado, onVerPersona, onCopiar,
}: {
  persona: PersonaLiquidada; liq: Liquidacion; cerrada: boolean;
  abierta: boolean; onAlternar: () => void;
  onEntrada: (conceptoId: string, cambio: Partial<EntradaLiquidacion> | null) => void;
  onExtras: (extras: Liquidacion["extras"]) => void;
  onPagado: (v: boolean) => void; onVerPersona: () => void; onCopiar: () => void;
}) {
  const faltan = persona.lineas.filter((l) => l.falta).length;
  const pago = liq.pagos[persona.miembroId];
  const [agregando, setAgregando] = useState(false);

  return (
    <div role="rowgroup" className="liq__persona" data-abierta={abierta || undefined}>
      <div role="row" className="liq__fila liq__fila--persona" onClick={onAlternar}>
        <div role="rowheader" className="liq__concepto">
          <button type="button" className="liq__toggle" aria-expanded={abierta} onClick={(ev) => { ev.stopPropagation(); onAlternar(); }}>
            <ChevronRight size={16} className="liq__chevron" aria-hidden />
            <span className="liq__textos">
              <span className="liq__titulo">{persona.nombre}</span>
              {persona.puesto && <span className="liq__sub">{persona.puesto}</span>}
            </span>
          </button>
          <span className="liq__marcas">
            {persona.inactivo && <Badge variante="neutral">Ya no está</Badge>}
            {persona.pendiente
              ? <Badge variante="warning">A definir</Badge>
              : persona.sinCargar && !persona.inactivo && <Badge variante="neutral">Sin cargar</Badge>}
            {!cerrada && faltan > 0 && <Badge variante="accent">Falta cargar {faltan}</Badge>}
            {cerrada && (pago ? <Badge variante="success" icono={<Check size={12} />}>Pagado</Badge> : <Badge variante="neutral">Por pagar</Badge>)}
          </span>
        </div>
        <div role="cell" className="liq__monto liq__monto--persona">{aPagarTexto(persona.aPagar)}</div>
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
                {" "}<button type="button" className="link" onClick={onVerPersona}>{persona.sinCargar ? "Cargar lo que cobra" : "Ver lo que cobra"}</button>
                </span>
              </div>
            </div>
          )}
          {persona.lineas.length === 0 && !persona.pendiente && !persona.sinCargar && (
            <div role="row" className="liq__fila liq__fila--nota">
              <div role="cell" className="liq__nota">Nada que pagarle este mes. <button type="button" className="link" onClick={onVerPersona}>Ver lo que cobra</button></div>
            </div>
          )}
          {persona.lineas.map((l) => (
            <Linea
              key={l.clave} l={l} cerrada={cerrada} entrada={l.conceptoId ? liq.entradas[claveEntrada(persona.miembroId, l.conceptoId)] : undefined}
              onEntrada={(cambio) => l.conceptoId && onEntrada(l.conceptoId, cambio)}
              onBorrarExtra={() => onExtras(liq.extras.filter((x) => `extra:${x.id}` !== l.clave))}
            />
          ))}
          {agregando && (
            <NuevoExtra
              onCancelar={() => setAgregando(false)}
              onAgregar={(x) => { onExtras([...liq.extras, { ...x, id: nuevoId("ext"), miembroId: persona.miembroId }]); setAgregando(false); }}
            />
          )}
          <div role="row" className="liq__fila liq__fila--acciones">
            <div role="cell" className="liq__acciones">
              {!cerrada && !agregando && (
                <Button sm variante="ghost" icono={<Plus size={15} />} onClick={() => setAgregando(true)}>Sumar o descontar un monto</Button>
              )}
              <Button sm variante="ghost" icono={<Copy size={15} />} onClick={onCopiar}>Copiar para mandarle</Button>
              <Button sm variante="ghost" icono={<UserRound size={15} />} onClick={onVerPersona}>Ver lo que cobra</Button>
              {cerrada && (
                <label className="row liq__pagado">
                  <Switch checked={Boolean(pago)} onChange={onPagado} etiqueta={`${persona.nombre}: pagado`} />
                  <span className="t-sm">{pago ? `Pagado el ${fechaLarga(pago.pagadoEn)}${pago.por ? ` por ${pago.por}` : ""}` : "Marcar como pagado"}</span>
                </label>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Un renglón ---------- */

function Linea({ l, cerrada, entrada, onEntrada, onBorrarExtra }: {
  l: LineaLiquidada; cerrada: boolean; entrada?: EntradaLiquidacion;
  onEntrada: (cambio: Partial<EntradaLiquidacion> | null) => void;
  onBorrarExtra: () => void;
}) {
  const [corrigiendo, setCorrigiendo] = useState(false);
  const base = infoBase(l.base);
  /* Lo que se carga en el renglón mismo: cuántas piezas, o cuántas ventas o
     llamadas si lo contado por la app no es lo real. */
  const cuentaPiezas = l.tipo === "unidad";
  const cuentaCantidad = (l.tipo === "porcentaje" || l.tipo === "tramo") && !base.plata;

  return (
    <>
      <div role="row" className="liq__fila liq__fila--linea" data-falta={l.falta ? true : undefined}>
        <div role="rowheader" className="liq__concepto liq__concepto--linea">
          <span className="liq__textos">
            <span className="liq__titulo">
              {l.nombre}
              {l.enFinanzas && <span className="tag liq__tag" title="Finanzas ya la calcula de las ventas: al cerrar no se carga de nuevo.">Ya está en Finanzas</span>}
              {l.corregido && <span className="tag liq__tag">Corregido</span>}
            </span>
            <span className="liq__sub">{l.detalle}</span>
          </span>
          {!cerrada && (
            <span className="liq__carga" onClick={(ev) => ev.stopPropagation()}>
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
              ) : l.corregido ? (
                <button type="button" className="link t-sm" onClick={() => onEntrada({ monto: undefined, nota: undefined })}>Volver a la cuenta</button>
              ) : (
                <button type="button" className="link t-sm" onClick={() => setCorrigiendo((v) => !v)}>{corrigiendo ? "Cancelar" : "Corregir"}</button>
              )}
            </span>
          )}
        </div>
        <div role="cell" className="liq__monto">{plata(l.monto, l.moneda)}</div>
      </div>
      {corrigiendo && !cerrada && (
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
          <Input type="text" inputMode="decimal" value={monto} onChange={(ev) => setMonto(ev.target.value)} autoFocus aria-label="Monto a pagar" />
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

function NuevoExtra({ onCancelar, onAgregar }: {
  onCancelar: () => void;
  onAgregar: (x: { concepto: string; monto: number; moneda: Moneda }) => void;
}) {
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [moneda, setMoneda] = useState<Moneda>("USD");
  const [resta, setResta] = useState(false);
  const n = leerMonto(monto);
  const listo = concepto.trim().length >= 2 && n > 0;
  return (
    <div role="row" className="liq__fila liq__fila--form">
      <div role="cell" className="liq__form">
        <div className="hk-field" style={{ flex: "2 1 220px" }}>
          <label className="hk-label">Qué es</label>
          <Input value={concepto} onChange={(ev) => setConcepto(ev.target.value)} placeholder="Adelanto, reintegro de viáticos, diferencia de agosto" autoFocus aria-label="Qué es" />
        </div>
        <div className="hk-field" style={{ flex: "1 1 120px" }}>
          <label className="hk-label">Monto</label>
          <Input type="text" inputMode="decimal" value={monto} onChange={(ev) => setMonto(ev.target.value)} aria-label="Monto" placeholder="0" />
        </div>
        <div className="row-wrap" style={{ alignSelf: "flex-end", paddingBottom: 6 }}>
          <Chip activo={moneda === "USD"} onClick={() => setMoneda("USD")}>US$</Chip>
          <Chip activo={moneda === "ARS"} onClick={() => setMoneda("ARS")}>$</Chip>
          <Chip activo={!resta} onClick={() => setResta(false)}>Suma</Chip>
          <Chip activo={resta} onClick={() => setResta(true)}>Descuenta</Chip>
        </div>
        <div className="row" style={{ alignSelf: "flex-end" }}>
          <Button sm variante="ghost" onClick={onCancelar}>Cancelar</Button>
          <Button sm variante="secondary" disabled={!listo} onClick={() => onAgregar({ concepto: concepto.trim(), monto: resta ? -n : n, moneda })}>Agregar</Button>
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
  const gastos = gastosDeLiquidacion(e, liq, r);
  const bonos = r.personas.flatMap((p) => p.lineas.filter((l) => l.tipo === "bono" && l.monto > 0).map(() => p.nombre.split(" ")[0]));
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
        {falta.pendientes.length > 0 && (
          <Ayuda titulo="Con algo a definir" icono={<AlertTriangle size={18} />}>
            {falta.pendientes.map((p) => `${p.nombre}: ${p.pendiente ?? "no tiene nada cargado"}`).join(" · ")}. Lo que no está cargado no se liquida.
          </Ayuda>
        )}

        <dl className="dl">
          {bonos.length > 0 && (<><dt>Bonos</dt><dd>Se pagan los de {bonos.join(", ")}. Si alguno no lo ganó, apagalo en su renglón.</dd></>)}
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
