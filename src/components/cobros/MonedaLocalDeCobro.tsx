"use client";

import React, { useCallback, useMemo, useState } from "react";
import { AlertTriangle, Globe, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { CampoMonedaLocal } from "@/components/cobros/EditorCobros";
import { acciones, useEstado } from "@/lib/store";
import { useAcceso } from "@/lib/acceso";
import { puedeCompletarMonedaLocal } from "@/lib/candado-cobro";
import { verComprobante } from "@/lib/comprobantes";
import { fechaLarga, money } from "@/lib/format";
import { enMoneda, enSuMoneda, faltaMonedaLocal, pideMonedaLocal, textoDeCambio } from "@/lib/moneda-local";
import type { Pago } from "@/lib/types";

/* ==================================================================
   Lo que pagó la persona en su moneda, en un cobro de dLocal ya cargado
   (lib/moneda-local.ts). Aldana (13/11): sin eso no lo puede pasar a la
   Financiera.

   - `MonedaLocalDeCobro`: en la fila del cobro, el dato adentro de su
     casillero: verde con lo que pagó y el cambio, ámbar «Falta lo que pagó»
     con el botón para completarlo.
   - `CompletarMonedaLocal`: el formulario, en línea (la ventana de chequeo,
     al lado del comprobante) o en su propia ventana.
   ================================================================== */

/** La persona de la venta del cobro: propone la moneda por su país o su teléfono. */
function usePersonaDelCobro(pago: Pago) {
  const e = useEstado();
  return useMemo(() => {
    const cuota = e.cuotas.find((c) => c.id === pago.cuotaId);
    const venta = cuota ? e.ventas.find((v) => v.id === cuota.ventaId) : undefined;
    if (!venta) return undefined;
    /* `venta.contactoId` es el lead; la persona (contacto) cuelga de él. */
    const lead = venta.contactoId ? e.leads.find((l) => l.id === venta.contactoId) : undefined;
    const contacto = e.contactos.find((c) => c.id === (lead?.contactoId ?? venta.contactoId));
    return { pais: contacto?.pais ?? lead?.pais, telefono: contacto?.telefono ?? lead?.telefono };
  }, [e.cuotas, e.ventas, e.contactos, e.leads, pago.cuotaId]);
}

export function CompletarMonedaLocal({ pago, onListo, enLinea }: { pago: Pago; onListo?: () => void; enLinea?: boolean }) {
  const toast = useToast();
  const persona = usePersonaDelCobro(pago);
  const habia = enSuMoneda(pago);
  const [borrador, setBorrador] = useState<{ monto: number; monedaLocal?: string; montoLocal?: number }>({
    monto: pago.monto, monedaLocal: habia?.moneda ?? pago.monedaLocal, montoLocal: habia?.monto,
  });
  const onCambio = useCallback((c: { monedaLocal?: string; montoLocal?: number }) => setBorrador((b) => ({ ...b, ...c })), []);
  const listo = Boolean(borrador.monedaLocal && borrador.montoLocal && borrador.montoLocal > 0);

  function guardar() {
    if (!listo) return;
    if (acciones.completarMonedaLocal(pago.id, { moneda: borrador.monedaLocal!, montoLocal: borrador.montoLocal! })) {
      toast(`Listo: pagó ${enMoneda(borrador.montoLocal!, borrador.monedaLocal!)}.`);
      onListo?.();
    } else toast("No se pudo guardar: tu cuenta no puede cambiar este cobro.", "err");
  }

  return (
    <div className={`stack-2${enLinea ? " moneda-local__en-linea" : ""}`}>
      <CampoMonedaLocal cobro={borrador} persona={persona} onCambio={onCambio} />
      <div className="row-wrap" style={{ gap: 8, justifyContent: enLinea ? "flex-start" : "flex-end" }}>
        {!enLinea && pago.comprobante && (
          <Button sm variante="ghost" icono={<Paperclip size={13} />} onClick={() => {
            verComprobante(pago.comprobante!).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err"));
          }}>Ver el comprobante</Button>
        )}
        <Button sm={enLinea} variante="primary" disabled={!listo} onClick={guardar}>
          {habia ? "Guardar el cambio" : "Guardar lo que pagó"}
        </Button>
      </div>
    </div>
  );
}

/** En la fila del cobro: lo que pagó en su moneda (verde) o que falta (ámbar), con el botón para completarlo. Nada si la cuenta no lo pide. */
export function MonedaLocalDeCobro({ pago }: { pago: Pago }) {
  const e = useEstado();
  const { acceso } = useAcceso();
  const [abierto, setAbierto] = useState(false);
  const proc = e.procesadores.find((x) => x.id === pago.procesadorId);
  if (!pideMonedaLocal(proc) || pago.movimientoId) return null;
  const local = enSuMoneda(pago);
  const puede = puedeCompletarMonedaLocal(pago, acceso);
  const falta = faltaMonedaLocal(e.procesadores, pago);
  const cerrar = () => setAbierto(false);

  const pildora = local ? (
    <button
      type="button" className="hk-badge hk-badge--success moneda-local__pildora" disabled={!puede}
      title={`Lo que pagó en su moneda y el tipo de cambio.${puede ? " Clic para corregirlo." : ""}`}
      onClick={() => setAbierto(true)}
    >
      <Globe size={12} aria-hidden />pagó {enMoneda(local.monto, local.moneda)} · {textoDeCambio(local.tipoCambio, local.moneda)}
    </button>
  ) : falta ? (
    puede ? (
      <button
        type="button" className="hk-badge hk-badge--warning moneda-local__pildora"
        title="La Financiera necesita cuánto pagó la persona en su moneda y el tipo de cambio. Mirá el comprobante y completalo."
        onClick={() => setAbierto(true)}
      >
        <AlertTriangle size={12} aria-hidden />Falta lo que pagó en su moneda · Completar
      </button>
    ) : (
      <span className="hk-badge hk-badge--warning" title="La Financiera necesita cuánto pagó la persona en su moneda y el tipo de cambio.">
        <AlertTriangle size={12} aria-hidden />Falta lo que pagó en su moneda
      </span>
    )
  ) : null;

  return (
    <>
      {pildora}
      {abierto && (
        <Modal
          abierto onCerrar={cerrar}
          titulo={local ? "Corregir lo que pagó en su moneda" : "¿Cuánto pagó en su moneda?"}
          sub={`dLocal · ${fechaLarga(pago.fecha)} · ${money(pago.monto, "USD", 2)}`}
        >
          <p className="t-sm t-muted" style={{ marginBottom: 12 }}>
            dLocal le cobra a la persona en la moneda de su país. Escribí lo que pagó como figura en el comprobante: el tipo de cambio sale solo y va con el cobro a la Financiera.
          </p>
          <CompletarMonedaLocal pago={pago} onListo={cerrar} />
        </Modal>
      )}
    </>
  );
}
