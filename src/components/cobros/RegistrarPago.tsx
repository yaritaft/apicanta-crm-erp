"use client";

import React, { useCallback, useMemo, useState } from "react";
import { ArrowRight, Link2, Paperclip } from "lucide-react";
import { Select } from "@/components/ui/ui";
import { Asistente, Pregunta, type PasoAsistente } from "@/components/ui/Asistente";
import {
  agregarMedio, datosDeCobro, EditorCobros, esFinanciera, enPesos, problemaDeCuenta, problemaDeDatos,
  problemaDePasarelas, problemaDePrueba, type CobroBorrador,
} from "@/components/cobros/EditorCobros";
import { bancoDeCbu } from "@/lib/cbu";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import type { Cuota } from "@/lib/types";

/* ==================================================================
   Registrar el pago de una cuota ya cargada.

   Paso a paso, como el asistente de venta: cuánto y por qué cuenta
   entró, cómo se prueba (conciliado con la pasarela o con el
   comprobante), los datos de la transferencia (el tipo de cambio si fue
   en pesos; el CBU/CVU, nombre y CUIT si fue a la Financiera), qué
   hacer si pagó menos y el resumen. Desde la ficha va embebido en la
   columna de la venta; en cualquier otro lado, a pantalla completa.

   Si se paga menos de lo que vale la cuota, las cuotas se reacomodan
   solas (lo elige quien carga, con la vista previa de cómo quedan): la
   plata que falta no se pierde, se mueve.
   ================================================================== */

type Reajuste = "repartir" | "proxima" | "pendiente";
type IdPaso = "cobro" | "prueba" | "datos" | "saldo" | "resumen";

const REAJUSTES: { valor: Reajuste; texto: string }[] = [
  { valor: "repartir", texto: "Repartirlo en las cuotas que siguen" },
  { valor: "proxima", texto: "Sumarlo a la próxima cuota" },
  { valor: "pendiente", texto: "Dejarlo pendiente en esta cuota" },
];

const r2 = (n: number) => Math.round(n * 100) / 100;

export function RegistrarPago({ cuota, onCerrar, onGuardado, embebido = false }: {
  cuota: Cuota; onCerrar: () => void; onGuardado: (mensaje: string) => void; embebido?: boolean;
}) {
  const e = useEstado();
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon, 2);
  const venta = e.ventas.find((v) => v.id === cuota.ventaId);
  const pagado = e.pagos.filter((p) => p.cuotaId === cuota.id).reduce((a, p) => a + p.monto, 0);
  const resta = r2(cuota.monto - pagado);
  const contacto = venta?.contactoId
    ? e.contactos.find((c) => c.id === venta.contactoId) ?? e.leads.find((l) => l.id === venta.contactoId)
    : undefined;

  const [cobros, setCobros] = useState<CobroBorrador[]>(
    () => agregarMedio([], resta, e.procesadores.find((p) => p.activo)?.id ?? ""),
  );
  const [reajuste, setReajuste] = useState<Reajuste>("repartir");
  const [idPaso, setIdPaso] = useState<IdPaso>("cobro");
  const [subiendo, setSubiendo] = useState<Set<string>>(() => new Set());
  const onSubiendo = useCallback((id: string, si: boolean) => {
    setSubiendo((ya) => {
      if (ya.has(id) === si) return ya;
      const otro = new Set(ya);
      if (si) otro.add(id); else otro.delete(id);
      return otro;
    });
  }, []);

  const cobrado = r2(cobros.reduce((a, p) => a + p.monto, 0));
  const saldo = r2(resta - cobrado);
  const nombreCuota = cuota.esReserva ? "la reserva" : `la cuota ${cuota.numero}`;
  const laCuota = cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`;
  const procDe = (p: CobroBorrador) => e.procesadores.find((x) => x.id === p.procesadorId);
  const aFinanciera = cobros.some((p) => !p.movimientoId && esFinanciera(procDe(p)));

  /* Los pasos dependen de lo que se va cargando: sin cobros a mano no hay
     datos de transferencia que pedir, y si paga todo no hay saldo. */
  const pasos: (PasoAsistente & { id: IdPaso })[] = [
    { id: "cobro", titulo: "Cuánto y por dónde" },
    { id: "prueba", titulo: "Prueba" },
    ...(cobros.some((p) => !p.movimientoId) ? [{ id: "datos" as const, titulo: "Transferencia" }] : []),
    ...(saldo > 0.01 && cobrado > 0 ? [{ id: "saldo" as const, titulo: "Lo que falta" }] : []),
    { id: "resumen", titulo: "Resumen" },
  ];
  const actual = Math.max(0, pasos.findIndex((p) => p.id === idPaso));
  const paso = pasos[actual].id;

  /* Cómo quedarían las cuotas que siguen, para verlo antes de guardar. */
  const vistaPrevia = useMemo(() => {
    if (saldo <= 0.01 || reajuste === "pendiente" || !venta) return [];
    const siguientes = e.cuotas
      .filter((c) => c.ventaId === venta.id && c.id !== cuota.id && c.estado === "pendiente" && c.numero > cuota.numero)
      .sort((a, b) => a.numero - b.numero);
    if (siguientes.length === 0) {
      const ultima = e.cuotas.filter((c) => c.ventaId === venta.id).sort((a, b) => b.numero - a.numero)[0] ?? cuota;
      const vence = new Date(ultima.vence ?? cuota.vence ?? new Date().toISOString());
      vence.setMonth(vence.getMonth() + 1);
      return [{ nombre: `Cuota ${ultima.numero + 1} (nueva)`, antes: 0, despues: saldo, vence: vence.toISOString() }];
    }
    if (reajuste === "proxima") {
      const p = siguientes[0];
      return [{ nombre: `Cuota ${p.numero}`, antes: p.monto, despues: r2(p.monto + saldo), vence: p.vence }];
    }
    const parte = Math.floor((saldo / siguientes.length) * 100) / 100;
    return siguientes.map((c, k) => ({
      nombre: `Cuota ${c.numero}`, antes: c.monto, vence: c.vence,
      despues: r2(c.monto + (k === siguientes.length - 1 ? r2(saldo - parte * (siguientes.length - 1)) : parte)),
    }));
  }, [saldo, reajuste, venta, e.cuotas, cuota]);

  const problemaCobro = cobrado > resta + 0.01
    ? `Se cobra ${M(cobrado)} y a ${nombreCuota} le faltan ${M(resta)}`
    : problemaDeCuenta(cobros, nombreCuota);
  const problemaPrueba = subiendo.size > 0
    ? "Esperá que termine de subir el comprobante"
    : problemaDePrueba(e, cobros, nombreCuota) ?? problemaDePasarelas(e, cobros);
  const problemaDatos = problemaDeDatos(e, cobros, nombreCuota);
  const problemaTotal = problemaCobro ?? problemaPrueba ?? problemaDatos;
  const problema = paso === "cobro" ? problemaCobro
    : paso === "prueba" ? problemaPrueba
      : paso === "datos" ? problemaDatos
        : paso === "resumen" ? problemaTotal : null;

  function guardar() {
    if (problemaTotal) return;
    const ok = acciones.registrarPago({
      cuotaId: cuota.id,
      cobros: cobros.map(datosDeCobro),
      reajuste: saldo > 0.01 ? reajuste : "pendiente",
    });
    if (!ok) return;
    onGuardado(
      saldo <= 0.01 ? "Pago registrado: la cuota quedó saldada."
        : reajuste === "pendiente" ? `Pago registrado. Quedan ${M(saldo)} pendientes en ${nombreCuota}.`
          : "Pago registrado y cuotas reacomodadas.",
    );
  }

  const editor = (partes: ("cuenta" | "prueba" | "datos")[]) => (
    <div className="cobro-bloque">
      <div className="cobro-bloque__body" style={{ borderTop: 0 }}>
        <EditorCobros
          e={e} cobros={cobros} onCambio={setCobros} objetivo={resta} partes={partes}
          cliente={{ nombre: venta?.contactoNombre, email: contacto?.email }}
          onSubiendo={onSubiendo}
        />
      </div>
    </div>
  );

  return (
    <Asistente
      etiqueta={`Registrar un pago de ${venta?.contactoNombre ?? ""}`}
      embebido={embebido}
      pasos={pasos} actual={actual} onCambiarPaso={(i) => setIdPaso(pasos[i].id)}
      problema={problema} problemaEsError
      onCerrar={onCerrar} terminarTexto="Registrar pago" onTerminar={guardar}
    >
      {paso === "cobro" && (
        <>
          <Pregunta
            texto="¿Cuánto pagó y por dónde?"
            sub={`${laCuota} de ${venta?.contactoNombre ?? "la venta"}${cuota.vence ? `, vence ${fechaLarga(cuota.vence)}` : ""}: faltan ${M(resta)}. Si pagó por dos cuentas, agregá la otra.`}
          />
          {editor(["cuenta"])}
          <div className="row t-sm" style={{ gap: 6 }}>
            <span className="t-subtle">Se cobra</span>
            <span className="t-num t-strong">{M(cobrado)}</span>
            <span className="t-subtle">de {M(resta)}</span>
          </div>
        </>
      )}

      {paso === "prueba" && (
        <>
          <Pregunta
            texto="¿Cómo lo probamos?"
            sub="Conciliado con el pago que llegó a la pasarela, o con el comprobante. Sin conciliar, el comprobante es obligatorio."
          />
          {editor(["prueba"])}
        </>
      )}

      {paso === "datos" && (
        <>
          <Pregunta
            texto="Los datos de la transferencia"
            sub={aFinanciera
              ? "Van al reporte para la Financiera: sin el CBU/CVU desde el que transfirió, no la encuentra."
              : "Quién mandó la plata y, si fue en pesos, a qué cambio."}
          />
          {editor(["datos"])}
        </>
      )}

      {paso === "saldo" && (
        <>
          <Pregunta
            texto={`Faltan ${M(saldo)}: ¿qué hacemos con eso?`}
            sub={`${laCuota} vale ${M(cuota.monto)} y con este pago entran ${M(r2(pagado + cobrado))}.`}
          />
          <Select
            value={reajuste} aria-label="Qué hacer con lo que falta"
            onChange={(ev) => setReajuste(ev.target.value as Reajuste)}
            opciones={REAJUSTES}
          />
          {reajuste === "pendiente" ? (
            <p className="t-sm t-subtle">
              {laCuota} queda con {M(saldo)} por cobrar y las demás no cambian.
            </p>
          ) : (
            <div className="stack-2" aria-label="Cómo quedan las cuotas">
              <div className="reajuste-fila">
                <span className="truncate t-strong">{laCuota}</span>
                <span className="t-num t-subtle">{M(cuota.monto)}</span>
                <ArrowRight size={13} className="t-subtle" />
                <span className="t-num t-strong">{M(r2(pagado + cobrado))}</span>
              </div>
              {vistaPrevia.map((f) => (
                <div className="reajuste-fila" key={f.nombre}>
                  <span className="truncate">
                    <span className="t-strong">{f.nombre}</span>
                    {f.vence && <span className="t-subtle"> · {fechaLarga(f.vence)}</span>}
                  </span>
                  <span className="t-num t-subtle">{f.antes ? M(f.antes) : "—"}</span>
                  <ArrowRight size={13} className="t-subtle" />
                  <span className="t-num t-strong" style={{ color: "var(--accent-text)" }}>{M(f.despues)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {paso === "resumen" && (
        <>
          <Pregunta texto="Así queda el pago" sub="Revisá y registralo. Después se puede corregir desde Finanzas." />
          <dl className="dl">
            <dt>Cliente</dt><dd>{venta?.contactoNombre ?? "—"}</dd>
            <dt>Cuota</dt><dd>{laCuota}{cuota.vence ? ` · vence ${fechaLarga(cuota.vence)}` : ""}</dd>
            <dt>Se cobra</dt><dd className="t-num">{M(cobrado)} de {M(resta)}</dd>
            {saldo > 0.01 && (
              <><dt>Lo que falta</dt><dd>{M(saldo)} · {REAJUSTES.find((x) => x.valor === reajuste)?.texto.toLowerCase()}</dd></>
            )}
          </dl>
          <div className="stack-2">
            {cobros.map((p) => {
              const proc = procDe(p);
              const aMano = p.tipoCambio && p.tipoCambioBlue && p.tipoCambio !== p.tipoCambioBlue;
              return (
                <div key={p.id} className="cuota-fila">
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <span className="t-strong">{proc?.nombre ?? "Sin cuenta"}</span>
                    <span className="t-sm t-subtle">{fechaLarga(p.fecha)}</span>
                    <span className="spacer t-num t-strong">{M(p.monto)}</span>
                  </div>
                  <div className="row t-sm t-subtle" style={{ gap: 10, flexWrap: "wrap" }}>
                    {p.movimientoId
                      ? <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success)" }}><Link2 size={12} />conciliado</span>
                      : p.comprobante && <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><Paperclip size={12} />{p.comprobante.nombre}</span>}
                    {enPesos(proc) && p.tipoCambio ? (
                      <span>
                        cambio {money(p.tipoCambio, "ARS", 2)} · {money(p.monto * p.tipoCambio, "ARS", 2)}
                        {aMano ? ` (a mano; el blue era ${money(p.tipoCambioBlue!, "ARS", 2)})` : " (blue venta)"}
                      </span>
                    ) : null}
                    {p.cvu && <span>CBU/CVU {p.cvu}{bancoDeCbu(p.cvu) ? ` · ${bancoDeCbu(p.cvu)}` : ""}</span>}
                    {p.pagador && <span>de {p.pagador}</span>}
                    {p.cuit && <span>CUIT {p.cuit}</span>}
                    {p.chequeado && <span>chequeado</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Asistente>
  );
}
