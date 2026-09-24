"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link2, Plus, Trash2, Unlink } from "lucide-react";
import { Button, IconButton, Input, Select, Switch } from "@/components/ui/ui";
import { CampoComprobante } from "@/components/cobros/CampoComprobante";
import { disponibleDe, SelectorMovimiento, type PagoDisponible } from "@/components/cobros/SelectorMovimiento";
import { nuevoId } from "@/lib/store";
import { fechaLarga, isoDia, money } from "@/lib/format";
import { medioDeMovimiento, procesadorDeMovimiento } from "@/lib/conciliacion";
import { descartarComprobante } from "@/lib/comprobantes";
import { nombrePasarela } from "@/lib/pasarelas";
import { fuenteDe, useBlue } from "@/lib/dolar";
import { bancoDeCbu, validarCbu } from "@/lib/cbu";
import { esCuentaEnPesos } from "@/lib/reporteFinanciera";
import type { Comprobante, EstadoApp, ID, Procesador } from "@/lib/types";

/* ==================================================================
   Los cobros de UNA cuota: uno por medio de pago.

   Cada cobro se prueba de una de dos maneras: conciliándolo con el pago
   que llegó a la pasarela (el monto, la fecha y el fee son los reales) o
   con su comprobante. Sin conciliar, el comprobante es obligatorio.

   Lo usan el asistente de venta (una vez por cuota, todo junto) y
   "Registrar pago" de una venta ya cargada (de a una parte por paso:
   la cuenta, la prueba, los datos de la transferencia). Los cambios
   salen como función (`onCambio(f)`) para que una subida que termina
   tarde no pise lo que se escribió mientras tanto.
   ================================================================== */

export interface CobroBorrador {
  id: string;
  procesadorId: string;      // Cuenta recaudadora
  monto: number;             // Monto abonado USD
  fecha: string;             // Fecha del pago
  referencia: string;
  /* Si sale de un pago que ya entró a la pasarela */
  movimientoId?: ID;
  comprobante?: Comprobante;
  /* Lo demás que pide la planilla de Angelo */
  tipoCambio?: number;       // Tipo de cambio ARS, si pagó en pesos
  pagador?: string;          // Nombre de quien transfirió
  cuit?: string;             // Cuit (Si pagó a financiera)
  cvu?: string;              // CBU/CVU desde el que transfirió (Financiera)
  chequeado?: boolean;       // Pasado Financiera / Chequeado en plataforma
  /* El blue venta que propuso la app, y de dónde salió: si el closer
     cambia el tipo de cambio, esto queda para compararlo. */
  tipoCambioBlue?: number;
  tipoCambioFuente?: string;
}

/* Lo que va al store de un cobro: el mismo borrador, sin el id de pantalla. */
export function datosDeCobro(p: CobroBorrador) {
  return {
    procesadorId: p.procesadorId || undefined, monto: p.monto, fecha: p.fecha,
    referencia: p.referencia, movimientoId: p.movimientoId, comprobante: p.comprobante,
    tipoCambio: p.tipoCambio, pagador: p.pagador, cuit: p.cuit, chequeado: p.chequeado,
    cvu: p.cvu, tipoCambioBlue: p.tipoCambioBlue, tipoCambioFuente: p.tipoCambioFuente,
  };
}

/* A la Financiera se le pasa el reporte con cada transferencia: sin el
   CBU/CVU del cliente no la encuentra. Las cuentas en pesos piden el
   tipo de cambio; una cuenta sin la moneda cargada se reconoce por el
   nombre ("Galicia (ARS)"). */
export const esFinanciera = (proc?: Procesador) => /financiera/i.test(proc?.nombre ?? "");
export const enPesos = (proc?: Procesador) => Boolean(proc && esCuentaEnPesos(proc));

const redondear = (n: number) => Math.round(n * 100) / 100;
const sumar = (xs: { monto: number }[]) => redondear(xs.reduce((a, x) => a + x.monto, 0));

export function cobroNuevo(procesadorId: string, monto: number, extra?: Partial<CobroBorrador>): CobroBorrador {
  return {
    id: nuevoId("cob"), procesadorId, monto: redondear(monto),
    fecha: new Date().toISOString(), referencia: "", ...extra,
  };
}

/* Agregar un medio más. Si todavía falta cobrar, el nuevo arranca con lo
   que falta; si ya estaba cubierto, el objetivo se reparte parejo entre
   los cobros que no están atados a una pasarela (esos traen su monto real
   y no se tocan). */
export function agregarMedio(cobros: CobroBorrador[], objetivo: number, procesadorId: string): CobroBorrador[] {
  const nuevo = cobroNuevo(procesadorId, 0);
  const falta = redondear(objetivo - sumar(cobros));
  if (falta > 0.01 || cobros.length === 0) return [...cobros, { ...nuevo, monto: Math.max(falta, 0) }];
  const fijos = sumar(cobros.filter((p) => p.movimientoId));
  const libres = [...cobros.filter((p) => !p.movimientoId), nuevo];
  const aRepartir = Math.max(redondear(objetivo - fijos), 0);
  const parte = Math.floor((aRepartir / libres.length) * 100) / 100;
  const monto = new Map(libres.map((p, k) => [
    p.id, k === libres.length - 1 ? redondear(aRepartir - parte * (libres.length - 1)) : parte,
  ]));
  return [...cobros, nuevo].map((p) => (monto.has(p.id) ? { ...p, monto: monto.get(p.id)! } : p));
}

/* Lo que falta para poder guardar estos cobros, o null. `nombre` es cómo
   se lee la cuota en la frase: "la reserva", "la cuota 2". Va por partes,
   las mismas del editor, para que cada paso de "Registrar pago" frene
   sólo por lo suyo. */
export function problemaDeCobros(e: EstadoApp, cobros: CobroBorrador[], nombre: string): string | null {
  return problemaDeCuenta(cobros, nombre) ?? problemaDePrueba(e, cobros, nombre) ?? problemaDeDatos(e, cobros, nombre);
}

export function problemaDeCuenta(cobros: CobroBorrador[], nombre: string): string | null {
  if (cobros.some((p) => !p.procesadorId)) return `Elegí la cuenta recaudadora de ${nombre}`;
  if (cobros.some((p) => !(p.monto > 0))) return `Un cobro de ${nombre} está en cero: poné el monto o sacalo`;
  return null;
}

export function problemaDeDatos(e: EstadoApp, cobros: CobroBorrador[], nombre: string): string | null {
  for (const p of cobros) {
    if (p.movimientoId) continue;
    const proc = e.procesadores.find((x) => x.id === p.procesadorId);
    if (enPesos(proc) && !(p.tipoCambio && p.tipoCambio > 0)) return `Poné el tipo de cambio de ${nombre}`;
    if (esFinanciera(proc)) {
      if (!p.cvu?.trim()) return `Falta el CBU/CVU desde el que transfirió (${nombre}): la Financiera lo necesita`;
      if (!validarCbu(p.cvu)) return `El CBU/CVU de ${nombre} no es válido: revisá los 22 números`;
    }
  }
  return null;
}

export function problemaDePrueba(e: EstadoApp, cobros: CobroBorrador[], nombre: string): string | null {
  for (const p of cobros) {
    if (p.movimientoId || p.comprobante) continue;
    const medio = e.procesadores.find((x) => x.id === p.procesadorId);
    return medio?.proveedor
      ? `Falta el comprobante de ${nombre} con ${medio.nombre}, o conciliarlo con un pago de la pasarela`
      : `Falta el comprobante de ${nombre}${medio ? ` con ${medio.nombre}` : ""}`;
  }
  return null;
}

/* Un pago de pasarela no puede usarse por más de lo que trajo. */
export function problemaDePasarelas(e: EstadoApp, cobros: CobroBorrador[]): string | null {
  const usado = new Map<ID, number>();
  for (const p of cobros) if (p.movimientoId) usado.set(p.movimientoId, (usado.get(p.movimientoId) ?? 0) + p.monto);
  for (const [id, monto] of usado) {
    const mov = e.movimientos.find((m) => m.id === id);
    if (!mov) continue;
    const libre = disponibleDe(mov, e.pagos, new Map());
    if (monto > libre + 0.01) {
      return `El pago de ${mov.clienteNombre || mov.referencia} no alcanza: quedan ${money(libre, mov.moneda, 2)}`;
    }
  }
  return null;
}

export type ParteCobro = "cuenta" | "prueba" | "datos";
const TODAS: ParteCobro[] = ["cuenta", "prueba", "datos"];

export function EditorCobros({ e, cobros, onCambio, objetivo, cliente, usadoFuera, onSubiendo, partes = TODAS }: {
  e: EstadoApp;
  cobros: CobroBorrador[];
  onCambio: (f: (cobros: CobroBorrador[]) => CobroBorrador[]) => void;
  /* Lo que se espera cobrar en esta cuota: guía el reparto entre medios */
  objetivo: number;
  cliente: { nombre?: string; email?: string };
  /* Lo que usan de cada pago de pasarela los cobros de OTRAS cuotas */
  usadoFuera?: Map<ID, number>;
  onSubiendo: (cobroId: string, subiendo: boolean) => void;
  /* Qué mostrar de cada cobro. Sin esto, todo junto. */
  partes?: ParteCobro[];
}) {
  const procesadores = e.procesadores.filter((p) => p.activo);
  const mon = e.ajustes.monedaBase;
  const [eligiendo, setEligiendo] = useState<string | null>(null);
  const ver = (parte: ParteCobro) => partes.includes(parte);
  /* Mostrando una sola parte, cada cobro lleva arriba de qué cuenta es:
     con dos medios en la misma cuota, si no, no se sabe cuál es cuál. */
  const conTitulo = !ver("cuenta") && cobros.length > 1;

  const editar = useCallback((id: string, cambios: Partial<CobroBorrador>) =>
    onCambio((xs) => xs.map((p) => (p.id === id ? { ...p, ...cambios } : p))), [onCambio]);

  const quitar = (p: CobroBorrador) => {
    if (p.comprobante) void descartarComprobante(p.comprobante);
    onSubiendo(p.id, false);
    onCambio((xs) => xs.filter((x) => x.id !== p.id));
  };

  /* Lo usado de cada pago de pasarela por todos los demás cobros */
  const usadoSin = useCallback((cobroId: string) => {
    const usado = new Map(usadoFuera ?? []);
    for (const p of cobros) {
      if (!p.movimientoId || p.id === cobroId) continue;
      usado.set(p.movimientoId, (usado.get(p.movimientoId) ?? 0) + p.monto);
    }
    return usado;
  }, [cobros, usadoFuera]);

  const pendientesPorPasarela = useMemo(() => {
    const n = new Map<string, number>();
    for (const m of e.movimientos) if (m.estado === "pendiente") n.set(m.proveedor, (n.get(m.proveedor) ?? 0) + 1);
    return n;
  }, [e.movimientos]);

  /* Atar un cobro a un pago de la pasarela: medio, fecha y referencia pasan
     a ser los reales; el monto, lo que ese pago cubre de lo que falta. */
  function elegirPago({ mov, disponible }: PagoDisponible) {
    const cobro = cobros.find((p) => p.id === eligiendo);
    if (!cobro) { setEligiendo(null); return; }
    const falta = redondear(objetivo - sumar(cobros.filter((p) => p.id !== cobro.id)));
    const monto = redondear(Math.min(disponible, falta > 0.01 ? falta : cobro.monto || disponible));
    editar(cobro.id, {
      movimientoId: mov.id,
      procesadorId: procesadorDeMovimiento(e, mov)?.id ?? cobro.procesadorId,
      fecha: mov.fecha, referencia: mov.referencia, monto,
    });
    setEligiendo(null);
  }

  const elegido = cobros.find((p) => p.id === eligiendo);

  return (
    <>
      {cobros.map((p) => {
        const proc = e.procesadores.find((x) => x.id === p.procesadorId);
        const mov = p.movimientoId ? e.movimientos.find((m) => m.id === p.movimientoId) : undefined;
        const pendientes = proc?.proveedor ? pendientesPorPasarela.get(proc.proveedor) ?? 0 : 0;
        return (
          <div className="cobro-item" key={p.id}>
            {conTitulo && (
              <div className="row t-sm" style={{ gap: 6 }}>
                <span className="t-strong">{proc?.nombre ?? "Sin cuenta"}</span>
                <span className="t-subtle t-num">{money(p.monto, mon, 2)}</span>
              </div>
            )}

            {ver("cuenta") && (
              <div className="cobro-linea">
                <Select
                  value={p.procesadorId} placeholder="Cuenta recaudadora" aria-label="Cuenta recaudadora"
                  disabled={Boolean(p.movimientoId)}
                  onChange={(ev) => editar(p.id, { procesadorId: ev.target.value })}
                  opciones={procesadores.map((x) => ({ valor: x.id, texto: x.nombre }))}
                />
                <Input type="number" min={0} step="0.01" value={p.monto} aria-label="Monto abonado USD" title="Monto abonado USD"
                  onChange={(ev) => editar(p.id, { monto: Number(ev.target.value) })} />
                <Input type="date" value={isoDia(p.fecha)} aria-label="Fecha del pago" title="Fecha del pago" disabled={Boolean(p.movimientoId)}
                  onChange={(ev) => { if (ev.target.value) editar(p.id, { fecha: new Date(ev.target.value + "T12:00:00").toISOString() }); }} />
                <IconButton etiqueta="Quitar este cobro" onClick={() => quitar(p)}>
                  <Trash2 size={15} />
                </IconButton>
              </div>
            )}

            {ver("prueba") && (
              <div className="cobro-prueba">
                {p.movimientoId ? (
                  <div className="conciliado-caja">
                    <Link2 size={16} style={{ flexShrink: 0, color: "var(--success)" }} />
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <span className="t-sm t-strong" style={{ display: "block" }}>
                        Conciliado con {mov ? medioDeMovimiento(e, mov) : "la pasarela"}
                      </span>
                      <span className="truncate t-sm t-subtle" style={{ display: "block" }}>
                        {mov
                          ? `${mov.clienteNombre || "Sin nombre"} · ${fechaLarga(mov.fecha)} · ${money(mov.monto, mov.moneda ?? mon, 2)} · ${mov.referencia}`
                          : p.referencia}
                      </span>
                    </span>
                    <Button sm variante="ghost" onClick={() => setEligiendo(p.id)}>Cambiar</Button>
                    <IconButton etiqueta="Desconciliar este cobro" onClick={() => editar(p.id, { movimientoId: undefined, referencia: "" })}>
                      <Unlink size={15} />
                    </IconButton>
                  </div>
                ) : proc?.proveedor ? (
                  <button type="button" className="conciliar-btn" onClick={() => setEligiendo(p.id)}>
                    <Link2 size={16} style={{ flexShrink: 0, color: "var(--brand)" }} />
                    <span style={{ minWidth: 0 }}>
                      <span className="t-strong" style={{ display: "block" }}>Conciliar con un pago de {nombrePasarela(proc.proveedor)}</span>
                      <span className="t-sm t-subtle">
                        {pendientes === 0 ? "No hay pagos sin conciliar" : `${pendientes} ${pendientes === 1 ? "pago sin conciliar" : "pagos sin conciliar"}`}
                      </span>
                    </span>
                  </button>
                ) : (
                  <div className="conciliar-btn" aria-disabled="true" style={{ cursor: "default" }}>
                    <Link2 size={16} style={{ flexShrink: 0 }} className="t-subtle" />
                    <span className="t-sm t-subtle">
                      {proc ? `${proc.nombre} no tiene pagos automáticos: se prueba con el comprobante.` : "Elegí el medio de pago."}
                    </span>
                  </div>
                )}
                <CampoComprobante
                  valor={p.comprobante} obligatorio={!p.movimientoId}
                  onCambio={(comprobante) => editar(p.id, { comprobante })}
                  onSubiendo={(s) => onSubiendo(p.id, s)}
                />
              </div>
            )}

            {ver("datos") && (p.movimientoId ? (
              !ver("prueba") && (
                <p className="t-sm t-subtle">Conciliado con la pasarela: los datos de la transferencia vienen de ahí.</p>
              )
            ) : (
              <>
                {/* Lo demás que pide la planilla: con qué cambio entró si fue
                    en pesos, quién mandó la plata y, para la Financiera, su
                    CBU/CVU y su CUIT. Es lo que después se usa para
                    conciliar a mano y lo que va en el reporte. */}
                {enPesos(proc) && <CampoCambio cobro={p} onCambio={(c) => editar(p.id, c)} />}
                {esFinanciera(proc) && <CampoCbu valor={p.cvu ?? ""} onCambio={(cvu) => editar(p.id, { cvu })} />}
                <div className="cobro-extra">
                  <Input
                    value={p.pagador ?? ""} placeholder="Nombre de quien transfirió" aria-label="Nombre de quien transfirió"
                    onChange={(ev) => editar(p.id, { pagador: ev.target.value })}
                  />
                  {esFinanciera(proc) && (
                    <Input
                      value={p.cuit ?? ""} placeholder="Cuit (Si pagó a financiera)" aria-label="Cuit (Si pagó a financiera)"
                      onChange={(ev) => editar(p.id, { cuit: ev.target.value })}
                    />
                  )}
                </div>
                <label className="row" style={{ gap: 8 }}>
                  <Switch
                    checked={Boolean(p.chequeado)} etiqueta="Pasado Financiera / Chequeado en plataforma"
                    onChange={(v) => editar(p.id, { chequeado: v })}
                  />
                  <span className="t-sm t-muted">Pasado Financiera / Chequeado en plataforma</span>
                </label>
                <Input value={p.referencia} placeholder="Referencia del pago (opcional)" aria-label="Referencia del pago"
                  onChange={(ev) => editar(p.id, { referencia: ev.target.value })} />
              </>
            ))}
          </div>
        );
      })}

      {ver("cuenta") && (
        <Button
          sm variante="ghost" icono={<Plus size={14} />} style={{ alignSelf: "flex-start" }}
          onClick={() => onCambio((xs) => agregarMedio(xs, objetivo, procesadores[0]?.id ?? ""))}
        >
          Agregar otra cuenta recaudadora
        </Button>
      )}

      {elegido && (
        <SelectorMovimiento
          abierto onCerrar={() => setEligiendo(null)}
          proveedor={e.procesadores.find((x) => x.id === elegido.procesadorId)?.proveedor}
          cliente={cliente}
          monto={elegido.monto}
          usado={usadoSin(elegido.id)}
          onElegir={elegirPago}
        />
      )}
    </>
  );
}

/* El tipo de cambio de un cobro en pesos. Arranca con el blue venta (el de
   DolarHoy si el pago es de hoy, el cierre de ese día si es de otro) y el
   closer lo puede cambiar; el cobro guarda los dos. Si cambia la fecha,
   se vuelve a pedir: si el closer no lo había tocado, se actualiza; si lo
   había tocado, sólo cambia la referencia contra la que se compara. */
function CampoCambio({ cobro, onCambio }: { cobro: CobroBorrador; onCambio: (c: Partial<CobroBorrador>) => void }) {
  const { cotizacion, error, cargando } = useBlue(isoDia(cobro.fecha) || null);

  useEffect(() => {
    if (!cotizacion) return;
    const fuente = fuenteDe(cotizacion);
    if (cobro.tipoCambioBlue === cotizacion.venta && cobro.tipoCambioFuente === fuente) return;
    const aMano = cobro.tipoCambio !== undefined && cobro.tipoCambio !== cobro.tipoCambioBlue;
    onCambio({ tipoCambioBlue: cotizacion.venta, tipoCambioFuente: fuente, ...(aMano ? {} : { tipoCambio: cotizacion.venta }) });
  }, [cotizacion, cobro.tipoCambio, cobro.tipoCambioBlue, cobro.tipoCambioFuente, onCambio]);

  const aMano = cobro.tipoCambio !== undefined && cobro.tipoCambioBlue !== undefined && cobro.tipoCambio !== cobro.tipoCambioBlue;
  const pesos = cobro.tipoCambio && cobro.monto > 0 ? cobro.monto * cobro.tipoCambio : 0;

  return (
    <div className="cambio-campo">
      <div className="cambio-campo__fila">
        <Input
          type="number" min={0} step="0.01" value={cobro.tipoCambio ?? ""} placeholder="Tipo de cambio ARS"
          aria-label="Tipo de cambio ARS" title="Tipo de cambio ARS"
          onChange={(ev) => onCambio({ tipoCambio: ev.target.value ? Number(ev.target.value) : undefined })}
        />
        {pesos > 0 && (
          <span className="t-sm">
            <span className="t-subtle">Transfiere </span>
            <span className="t-num t-strong">{money(pesos, "ARS", 2)}</span>
          </span>
        )}
      </div>
      <span className="t-sm t-subtle">
        {cargando ? "Buscando el dólar blue…"
          : error ? error
            : cotizacion && aMano ? (
              <>
                Lo cambiaste a mano: el blue venta era {money(cotizacion.venta, "ARS", 2)} ({fuenteDe(cotizacion)}).{" "}
                <button type="button" className="link t-sm" onClick={() => onCambio({ tipoCambio: cotizacion.venta })}>Usar el blue</button>
              </>
            ) : cotizacion ? `Blue venta ${fuenteDe(cotizacion)}. Si el cambio fue otro, cambialo: queda registrado el de DolarHoy también.`
              : null}
      </span>
    </div>
  );
}

/* El CBU/CVU desde el que transfirió el cliente: se valida con sus dígitos
   verificadores, así un número mal copiado del comprobante se ve acá y no
   cuando la Financiera no encuentra la transferencia. */
function CampoCbu({ valor, onCambio }: { valor: string; onCambio: (v: string) => void }) {
  const limpio = valor.replace(/[\s.-]/g, "");
  const completo = limpio.length >= 22;
  const valido = validarCbu(limpio);
  const banco = valido ? bancoDeCbu(limpio) : "";
  return (
    <div className="cambio-campo">
      <Input
        value={valor} inputMode="numeric" placeholder="CBU/CVU desde el que transfirió" aria-label="CBU/CVU desde el que transfirió"
        error={completo && !valido} onChange={(ev) => onCambio(ev.target.value)}
      />
      <span className="t-sm" style={{ color: completo && !valido ? "var(--warning)" : "var(--ink-subtle)" }}>
        {!limpio ? "Obligatorio si pagó a la Financiera: está en el comprobante (22 números)."
          : !completo ? `${limpio.length} de 22 números.`
            : !valido ? "No es un CBU/CVU válido: revisá los números."
              : banco ? `CBU/CVU válido · ${banco}` : "CBU/CVU válido."}
      </span>
    </div>
  );
}
