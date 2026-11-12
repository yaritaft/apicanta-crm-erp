"use client";

import React, { useMemo, useState } from "react";
import { Check } from "lucide-react";
import { Field, Input, Select } from "@/components/ui/ui";
import { InputMonto } from "@/components/ui/InputMonto";
import { ModalForm } from "@/components/ui/Modal";
import { acciones } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { escribirMonto, fechaDePago, leerMonto } from "@/lib/gastos";
import {
  candidatosDePago, candidatosElegidos, cuentaSugerida, totalRegistrado, type PagoARegistrar,
} from "@/lib/pagos-liquidacion";
import { cuentaDeGasto } from "@/lib/traspasos";
import { nombrePeriodo } from "@/lib/honorarios";
import type { EstadoApp, Liquidacion, PersonaLiquidada } from "@/lib/types";
import "./pagar-equipo.css";

/* ==================================================================
   «Marcar como pagado» que deja el pago registrado en la caja (lib/pagos-liquidacion.ts).

   Por cada persona: lo que ya está cargado y es su pago (lo que trajo el banco o se cargó a mano: se enlaza y se marca como pago al equipo, así no
   cuenta dos veces como costo) y lo que falta: de qué cuenta salió y qué día. Daniel, por ejemplo, cobra por Binance: se elige Binance y la caja de
   Binance baja; la próxima vez ya viene elegida.
   ================================================================== */

const hoyIso = () => new Date().toISOString();
const diaAr = (iso: string) => new Date(new Date(iso).getTime() - 3 * 3600000).toISOString().slice(0, 10);
const r2 = (n: number) => Math.round(n * 100) / 100;

interface Fila {
  persona: PersonaLiquidada;
  /* Lo que ya estaba registrado antes (pagos a cuenta o un registro anterior), en la moneda base. */
  yaRegistrado: number;
  elegidos: Set<string>;
  dia: string;
  cuentaId: string;
  monto: string;
}

export function PagarEquipo({ e, liq, personas, onCerrar, onListo }: {
  e: EstadoApp;
  liq: Liquidacion;
  personas: readonly PersonaLiquidada[];
  onCerrar: () => void;
  onListo: (mensaje: string) => void;
}) {
  const base = e.ajustes.monedaBase;
  const M = (n: number) => money(n, base, 2);
  const hoy = diaAr(hoyIso());
  const cuentas = useMemo(() => e.procesadores.filter((p) => p.activo).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")), [e.procesadores]);

  const [filas, setFilas] = useState<Fila[]>(() => personas.map((persona) => {
    const pago = liq.pagos[persona.miembroId];
    const yaRegistrado = totalRegistrado(e, pago);
    const propios = new Set(pago?.gastoIds ?? []);
    const candidatos = candidatosDePago(e, liq, persona).filter((c) => !propios.has(c.gasto.id));
    const restante = Math.max(0, r2(persona.total - yaRegistrado));
    const elegidos = new Set(candidatosElegidos(candidatos, restante));
    const suma = candidatos.filter((c) => elegidos.has(c.gasto.id)).reduce((a, c) => a + c.gasto.monto, 0);
    return {
      persona, yaRegistrado, elegidos,
      /* Si ya figuraba pagado, el día en que se marcó; si no, hoy. */
      dia: pago ? diaAr(pago.pagadoEn) : hoy,
      cuentaId: pago?.cuentaId ?? cuentaSugerida(e, persona.miembroId, candidatos.filter((c) => elegidos.has(c.gasto.id)).map((c) => c.gasto)),
      monto: escribirMonto(Math.max(0, r2(restante - suma))),
    };
  }));

  const cambiar = (i: number, cambio: Partial<Fila>) => setFilas((fs) => fs.map((f, k) => (k === i ? { ...f, ...cambio } : f)));
  const nombreCuenta = (id: string) => e.procesadores.find((p) => p.id === id)?.nombre ?? "otra cuenta";

  /* Lo que se va a registrar de cada una, con los números de ahora. */
  const detalle = filas.map((f) => {
    const pago = liq.pagos[f.persona.miembroId];
    const candidatos = candidatosDePago(e, liq, f.persona).filter((c) => !new Set(pago?.gastoIds ?? []).has(c.gasto.id));
    const elegidos = candidatos.filter((c) => f.elegidos.has(c.gasto.id));
    const monto = f.monto.trim() ? leerMonto(f.monto) : 0;
    const sumaElegidos = r2(elegidos.reduce((a, c) => a + c.gasto.monto, 0));
    const registrado = r2(f.yaRegistrado + sumaElegidos + (Number.isFinite(monto) ? monto : 0));
    const problema = !Number.isFinite(monto) || monto < 0 ? "Poné un monto válido."
      : f.dia > hoy ? "Ese día todavía no llegó."
        : monto > 0 && !f.cuentaId ? "Elegí de qué cuenta salió."
          : monto <= 0 && elegidos.length === 0 && f.yaRegistrado <= 0 ? "Elegí un pago ya cargado o poné el monto que salió." : null;
    return { f, candidatos, elegidos, monto: Number.isFinite(monto) ? monto : 0, registrado, problema };
  });
  const sinProblema = detalle.every((d) => !d.problema);

  function guardar() {
    if (!sinProblema) return;
    const items: PagoARegistrar[] = detalle.map((d) => ({
      miembroId: d.f.persona.miembroId, dia: d.f.dia, cuentaId: d.f.cuentaId, elegidos: d.elegidos.map((c) => c.gasto.id), monto: d.monto,
    }));
    const r = acciones.registrarPagosDeEquipo(liq.id, items);
    if (r.personas === 0) return;
    const quienes = detalle.length === 1 ? detalle[0].f.persona.nombre : `${detalle.length} personas`;
    onListo(`Listo: pago de ${quienes} registrado${r.creados ? `, con ${r.creados === 1 ? "1 gasto nuevo" : `${r.creados} gastos nuevos`} en la caja` : ""}${r.enlazados ? ` y ${r.enlazados === 1 ? "1 pago ya cargado" : `${r.enlazados} pagos ya cargados`} marcados como pago al equipo` : ""}.`);
  }

  const uno = filas.length === 1;
  return (
    <ModalForm
      abierto ancho onCerrar={onCerrar} onGuardar={guardar} puedeGuardar={sinProblema}
      guardarTexto={uno && !liq.pagos[filas[0].persona.miembroId] ? "Marcar como pagado" : "Registrar"}
      titulo={uno ? `Pago a ${filas[0].persona.nombre}` : "Registrar de qué cuenta salieron los pagos"}
      sub={`${nombrePeriodo(liq.periodo)}. Para que la caja sepa de dónde salió cada pago: lo que ya está cargado se enlaza (no cuenta dos veces como costo) y lo que falta se registra con su cuenta.`}
    >
      <div className="pagar">
        {detalle.map(({ f, candidatos, elegidos, monto, registrado, problema }, i) => {
          const dif = r2(registrado - f.persona.total);
          return (
            <section key={f.persona.miembroId} className="pagar__persona" aria-label={f.persona.nombre}>
              <header className="pagar__cabeza">
                <strong className="pagar__nombre">{f.persona.nombre}</strong>
                <span className="t-sm t-muted">A pagar <b className="t-num">{M(f.persona.total)}</b></span>
              </header>

              {f.yaRegistrado > 0 && (
                <p className="t-sm t-muted pagar__nota"><Check size={14} aria-hidden /> Ya registrado: {M(f.yaRegistrado)}.</p>
              )}

              {candidatos.length > 0 && (
                <div className="pagar__ya" role="group" aria-label={`Pagos ya cargados de ${f.persona.nombre}`}>
                  <span className="t-sm t-muted">Ya cargado en la caja: ¿es parte de este pago?</span>
                  {candidatos.map((c) => (
                    <label key={c.gasto.id} className="pagar__gasto">
                      <input
                        type="checkbox" checked={f.elegidos.has(c.gasto.id)}
                        onChange={(ev) => {
                          const s = new Set(f.elegidos);
                          if (ev.target.checked) s.add(c.gasto.id); else s.delete(c.gasto.id);
                          const suma = candidatos.filter((x) => s.has(x.gasto.id)).reduce((a, x) => a + x.gasto.monto, 0);
                          cambiar(i, { elegidos: s, monto: escribirMonto(Math.max(0, r2(f.persona.total - f.yaRegistrado - suma))) });
                        }}
                      />
                      <span className="pagar__gasto-texto">
                        <span className="truncate">{c.gasto.proveedor || c.gasto.concepto}</span>
                        <span className="t-sm t-subtle">
                          {fechaLarga(fechaDePago(c.gasto))}{(() => { const cu = cuentaDeGasto(c.gasto, e.procesadores); return cu ? ` · ${nombreCuenta(cu)}` : ""; })()}
                          {c.yaMarcado ? " · ya marcado como pago al equipo" : ""}
                          {c.motivo === "monto" ? " · mismo monto que se le liquida" : ""}
                        </span>
                      </span>
                      <span className="t-num">{M(c.gasto.monto)}</span>
                    </label>
                  ))}
                </div>
              )}

              <div className="pagar__falta">
                <Field label="Falta registrar" ayuda={monto > 0 ? "Se carga como un gasto de esa cuenta, marcado como pago al equipo." : "Nada más: lo ya cargado cubre el pago."}>
                  <InputMonto value={f.monto} onChange={(ev) => cambiar(i, { monto: ev.target.value })} aria-label={`Lo que falta registrar de ${f.persona.nombre}`} icono={<span className="gasto-signo">US$</span>} />
                </Field>
                <Field label="De qué cuenta salió">
                  <Select
                    value={f.cuentaId} onChange={(ev) => cambiar(i, { cuentaId: ev.target.value })} aria-label={`Cuenta de la que salió el pago de ${f.persona.nombre}`}
                    opciones={cuentas.map((p) => ({ valor: p.id, texto: p.nombre }))}
                  />
                </Field>
                <Field label="Día que salió">
                  <Input type="date" value={f.dia} max={hoy} onChange={(ev) => cambiar(i, { dia: ev.target.value || hoy })} aria-label={`Día del pago de ${f.persona.nombre}`} />
                </Field>
              </div>

              <p className={`t-sm pagar__resumen${problema || Math.abs(dif) > 1 ? " pagar__resumen--ojo" : ""}`} role="status">
                {problema
                  ?? (Math.abs(dif) <= 1
                    ? <>Queda registrado {M(registrado)}: justo lo que se le liquidó.</>
                    : dif > 0
                      ? <>Queda registrado {M(registrado)}: {M(dif)} más de lo que se le liquidó.</>
                      : <>Queda registrado {M(registrado)}: faltan {M(-dif)} para lo que se le liquidó.</>)}
              </p>
            </section>
          );
        })}
      </div>
    </ModalForm>
  );
}
