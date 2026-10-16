"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Link2, Paperclip, Trash2 } from "lucide-react";
import { Button, Select } from "@/components/ui/ui";
import { Asistente, Pregunta, type PasoAsistente } from "@/components/ui/Asistente";
import {
  agregarMedio, datosDeCobro, EditorCobros, esFinanciera, enPesos, problemaDeCuenta, problemaDeDatos,
  problemaDePasarelas, problemaDePrueba, type CobroBorrador,
} from "@/components/cobros/EditorCobros";
import { acciones, nuevoId, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { nube } from "@/lib/supabase";
import { candadoDeCobro, corrigeSiempre } from "@/lib/candado-cobro";
import { fechaLarga, money } from "@/lib/format";
import type { Cuota, Pago } from "@/lib/types";

/* ==================================================================
   Registrar el pago de una cuota ya cargada.

   Paso a paso, como el asistente de venta: cuánto y por qué cuenta
   entró, cómo se prueba (conciliado con la pasarela o con el
   comprobante), los datos de la transferencia (el tipo de cambio si fue
   en pesos; nombre y CUIT si fue a la Financiera), qué
   hacer si pagó menos y el resumen. Desde la ficha va embebido en la
   columna de la venta; en cualquier otro lado, a pantalla completa.

   Con `pagoAEditar` es el mismo asistente para CORREGIR un cobro ya cargado
   (daily con los closers, 16/10): trae todo precargado, no agrega ni quita
   cuentas, y guarda los cambios sobre ese cobro. También lo puede borrar.
   El candado (lib/candado-cobro.ts) lo frena si Finanzas ya lo chequeó o el
   mes está liquidado; lo mismo repite la base.

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

/* El cobro tal como está, como borrador para volver a pasarlo por el asistente. */
function borradorDe(p: Pago): CobroBorrador {
  return {
    id: nuevoId("cob"), procesadorId: p.procesadorId ?? "", monto: p.monto, fecha: p.fecha, referencia: p.referencia ?? "",
    movimientoId: p.movimientoId, comprobante: p.comprobante, tipoCambio: p.tipoCambio, montoArs: p.montoArs,
    pagador: p.pagador, cuit: p.cuit, cvu: p.cvu, tipoCambioBlue: p.tipoCambioBlue, tipoCambioFuente: p.tipoCambioFuente,
  };
}

export function RegistrarPago({ cuota, onCerrar, onGuardado, embebido = false, pagoAEditar }: {
  cuota: Cuota; onCerrar: () => void; onGuardado: (mensaje: string) => void; embebido?: boolean;
  /* Corregir este cobro en lugar de registrar uno nuevo. */
  pagoAEditar?: Pago;
}) {
  const e = useEstado();
  const { acceso } = useAcceso();
  const editando = pagoAEditar;
  const mon = e.ajustes.monedaBase;
  const M = (n: number) => money(n, mon, 2);
  const venta = e.ventas.find((v) => v.id === cuota.ventaId);
  const pagado = e.pagos.filter((p) => p.cuotaId === cuota.id && p.id !== editando?.id).reduce((a, p) => a + p.monto, 0);
  const resta = r2(cuota.monto - pagado);
  const contacto = venta?.contactoId
    ? e.contactos.find((c) => c.id === venta.contactoId) ?? e.leads.find((l) => l.id === venta.contactoId)
    : undefined;

  const [cobros, setCobros] = useState<CobroBorrador[]>(
    () => (editando ? [borradorDe(editando)] : agregarMedio([], resta, e.procesadores.find((p) => p.activo)?.id ?? "")),
  );
  const [borrando, setBorrando] = useState(false);
  /* El mes cerrado sólo lo sabe quien ve las liquidaciones (los dueños); para
     el resto lo contesta la base. */
  const [mesCerrado, setMesCerrado] = useState(false);
  useEffect(() => {
    if (!editando || !nube || corrigeSiempre(acceso)) return;
    let vivo = true;
    void nube.rpc("mes_de_cobro_cerrado", { p_fecha: editando.fecha }).then((r) => { if (vivo && r.data === true) setMesCerrado(true); });
    return () => { vivo = false; };
  }, [editando, acceso]);
  const candado = editando ? candadoDeCobro(editando, acceso, mesCerrado) : { bloqueado: false };
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
    ...(saldo > 0.01 && cobrado > 0 && !editando ? [{ id: "saldo" as const, titulo: "Lo que falta" }] : []),
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
  /* Corrigiendo, el cobro que se está cambiando no cuenta como «ya usado» del pago de la pasarela. */
  const eSinElCobro = useMemo(
    () => (editando ? { ...e, pagos: e.pagos.filter((p) => p.id !== editando.id) } : e),
    [e, editando],
  );
  /* Un cobro viejo que nunca tuvo prueba (de la planilla) se puede corregir sin pedirle una: no queda peor que antes. */
  const sinExigirPrueba = Boolean(editando && !editando.comprobante && !editando.movimientoId);
  const problemaPrueba = subiendo.size > 0
    ? "Esperá que termine de subir el comprobante"
    : (sinExigirPrueba ? null : problemaDePrueba(e, cobros, nombreCuota)) ?? problemaDePasarelas(eSinElCobro, cobros);
  const problemaDatos = problemaDeDatos(e, cobros, nombreCuota);
  const problemaTotal = problemaCobro ?? problemaPrueba ?? problemaDatos;
  const problema = paso === "cobro" ? problemaCobro
    : paso === "prueba" ? problemaPrueba
      : paso === "datos" ? problemaDatos
        : paso === "resumen" ? problemaTotal : null;

  function guardar() {
    if (problemaTotal) return;
    if (editando) {
      if (!acciones.corregirPago(editando.id, { cobro: datosDeCobro(cobros[0]) })) return;
      onGuardado(saldo > 0.01 ? `Cobro corregido. ${nombreCuota[0].toUpperCase()}${nombreCuota.slice(1)} queda con ${M(saldo)} por cobrar.` : "Cobro corregido.");
      return;
    }
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

  function borrar() {
    if (!editando) return;
    if (acciones.eliminarPago(editando.id)) onGuardado(`Se borró el cobro de ${M(editando.monto)}. ${nombreCuota[0].toUpperCase()}${nombreCuota.slice(1)} queda con ${M(resta + editando.monto)} por cobrar.`);
  }

  const editor = (partes: ("cuenta" | "prueba" | "datos")[]) => (
    <div className="cobro-bloque">
      <div className="cobro-bloque__body" style={{ borderTop: 0 }}>
        <EditorCobros
          e={e} cobros={cobros} onCambio={setCobros} objetivo={resta} partes={partes}
          cliente={{ nombre: venta?.contactoNombre, email: contacto?.email }}
          onSubiendo={onSubiendo}
          unico={Boolean(editando)}
          liberar={editando ? { pagoId: editando.id, movimientoId: editando.movimientoId } : undefined}
        />
      </div>
    </div>
  );

  if (editando && candado.bloqueado) {
    return (
      <Asistente
        etiqueta={`Corregir un pago de ${venta?.contactoNombre ?? ""}`} embebido={embebido}
        pasos={[{ id: "cobro", titulo: "Cobro" }]} actual={0} onCambiarPaso={() => undefined}
        problema={candado.motivo ?? "Este cobro ya no se puede corregir."} problemaEsError
        onCerrar={onCerrar} terminarTexto="Guardar cambios" onTerminar={onCerrar}
      >
        <Pregunta
          texto="Este cobro ya no se puede corregir"
          sub={`${candado.motivo ?? ""} Si hay que cambiarlo, pedíselo a Finanzas.`}
        />
      </Asistente>
    );
  }

  return (
    <Asistente
      etiqueta={editando ? `Corregir un pago de ${venta?.contactoNombre ?? ""}` : `Registrar un pago de ${venta?.contactoNombre ?? ""}`}
      embebido={embebido}
      pasos={pasos} actual={actual} onCambiarPaso={(i) => setIdPaso(pasos[i].id)}
      problema={problema} problemaEsError
      onCerrar={onCerrar} terminarTexto={editando ? "Guardar cambios" : "Registrar pago"} onTerminar={guardar}
    >
      {paso === "cobro" && (
        <>
          <Pregunta
            texto={editando ? "Corregí el pago" : "¿Cuánto pagó y por dónde?"}
            sub={editando
              ? `${laCuota} de ${venta?.contactoNombre ?? "la venta"}: está cargado así y se puede cambiar todo. Si lo que falta es otro pago, registralo aparte.`
              : `${laCuota} de ${venta?.contactoNombre ?? "la venta"}${cuota.vence ? `, vence ${fechaLarga(cuota.vence)}` : ""}: faltan ${M(resta)}. Si pagó por dos cuentas, agregá la otra.`}
          />
          {editor(["cuenta"])}
          {editando && (
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {borrando ? (
                <>
                  <span className="t-sm">¿Borrar este cobro de {M(editando.monto)}? Lo que se había conciliado con la pasarela se libera.</span>
                  <Button sm variante="danger" onClick={borrar}>Sí, borrarlo</Button>
                  <Button sm variante="ghost" onClick={() => setBorrando(false)}>No</Button>
                </>
              ) : (
                <Button sm variante="ghost" icono={<Trash2 size={14} />} onClick={() => setBorrando(true)}>Eliminar este pago</Button>
              )}
            </div>
          )}
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
              ? "Van al reporte para la Financiera: con el nombre y el CUIT de quien transfirió la encuentra."
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
          <Pregunta texto="Así queda el pago" sub={editando ? "Revisá los cambios y guardalos." : "Revisá y registralo. Después se puede corregir desde la ficha de la venta, mientras Finanzas no lo haya chequeado."} />
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
                        cambio {money(p.tipoCambio, "ARS", 2)} · {money(p.montoArs ?? p.monto * p.tipoCambio, "ARS", 2)}
                        {aMano ? ` (a mano; el promedio era ${money(p.tipoCambioBlue!, "ARS", 2)})` : " (promedio blue y cripto)"}
                      </span>
                    ) : null}
                    {p.pagador && <span>de {p.pagador}</span>}
                    {p.cuit && <span>CUIT {p.cuit}</span>}
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
