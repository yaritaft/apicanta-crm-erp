"use client";

import React, { useCallback, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Chip } from "@/components/ui/ui";
import { ModalForm } from "@/components/ui/Modal";
import {
  agregarMedio, EditorCobros, problemaDeCobros, problemaDePasarelas, type CobroBorrador,
} from "@/components/cobros/EditorCobros";
import { acciones, useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import type { Cuota } from "@/lib/types";

/* ==================================================================
   Registrar el pago de una cuota ya cargada.

   Mismo formato que el paso de cobros del asistente de venta: uno o
   varios medios, cada uno conciliado contra la pasarela o con su
   comprobante. Si se paga menos de lo que vale la cuota, las cuotas se
   reacomodan solas (lo elige quien carga, con la vista previa de cómo
   quedan): la plata que falta no se pierde, se mueve.
   ================================================================== */

type Reajuste = "repartir" | "proxima" | "pendiente";

const r2 = (n: number) => Math.round(n * 100) / 100;

export function RegistrarPago({ cuota, onCerrar, onGuardado }: {
  cuota: Cuota; onCerrar: () => void; onGuardado: (mensaje: string) => void;
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

  const problema = cobrado > resta + 0.01
    ? `Se cobra ${M(cobrado)} y a ${nombreCuota} le faltan ${M(resta)}`
    : subiendo.size > 0
      ? "Esperá que termine de subir el comprobante"
      : problemaDeCobros(e, cobros, nombreCuota) ?? problemaDePasarelas(e, cobros);

  function guardar() {
    if (problema) return;
    const ok = acciones.registrarPago({
      cuotaId: cuota.id,
      cobros: cobros.map((p) => ({
        procesadorId: p.procesadorId || undefined, monto: p.monto, fecha: p.fecha,
        referencia: p.referencia, movimientoId: p.movimientoId, comprobante: p.comprobante,
      })),
      reajuste: saldo > 0.01 ? reajuste : "pendiente",
    });
    if (!ok) return;
    onGuardado(
      saldo <= 0.01 ? "Pago registrado: la cuota quedó saldada."
        : reajuste === "pendiente" ? `Pago registrado. Quedan ${M(saldo)} pendientes en ${nombreCuota}.`
          : "Pago registrado y cuotas reacomodadas.",
    );
  }

  return (
    <ModalForm
      abierto onCerrar={onCerrar} ancho
      titulo={`Registrar un pago · ${venta?.contactoNombre ?? ""}`}
      sub={`${cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`}${cuota.vence ? ` · vence ${fechaLarga(cuota.vence)}` : ""} · faltan ${M(resta)}`}
      guardarTexto="Registrar pago"
      puedeGuardar={problema === null}
      onGuardar={guardar}
    >
      <div className="cobro-bloque">
        <div className="cobro-bloque__body" style={{ borderTop: 0 }}>
          <EditorCobros
            e={e} cobros={cobros} onCambio={setCobros} objetivo={resta}
            cliente={{ nombre: venta?.contactoNombre, email: contacto?.email }}
            onSubiendo={onSubiendo}
          />
        </div>
      </div>

      <div className="row t-sm" style={{ gap: 8 }}>
        <span className="t-subtle">Se cobra</span>
        <span className="t-num t-strong">{M(cobrado)}</span>
        <span className="t-subtle">de {M(resta)}</span>
        {problema && <span className="spacer" style={{ color: "var(--warning)", textAlign: "right" }}>{problema}</span>}
      </div>

      {saldo > 0.01 && cobrado > 0 && (
        <div className="stack-3">
          <div>
            <div className="t-label">Faltan {M(saldo)}: ¿qué hacemos con eso?</div>
          </div>
          <div className="row-wrap" role="group" aria-label="Qué hacer con el saldo">
            <Chip activo={reajuste === "repartir"} onClick={() => setReajuste("repartir")}>Repartirlo en las cuotas que siguen</Chip>
            <Chip activo={reajuste === "proxima"} onClick={() => setReajuste("proxima")}>Sumarlo a la próxima cuota</Chip>
            <Chip activo={reajuste === "pendiente"} onClick={() => setReajuste("pendiente")}>Dejarlo pendiente en esta cuota</Chip>
          </div>
          {reajuste === "pendiente" ? (
            <p className="t-sm t-subtle">
              {nombreCuota.charAt(0).toUpperCase() + nombreCuota.slice(1)} queda con {M(saldo)} por cobrar y las demás no cambian.
            </p>
          ) : (
            <div className="stack-2" aria-label="Cómo quedan las cuotas">
              <div className="reajuste-fila">
                <span className="truncate t-strong">{cuota.esReserva ? "Reserva" : `Cuota ${cuota.numero}`}</span>
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
        </div>
      )}
    </ModalForm>
  );
}
