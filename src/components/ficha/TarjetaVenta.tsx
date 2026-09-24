"use client";

import React from "react";
import { AlertTriangle, Check, Link2, Paperclip, Pencil, Receipt } from "lucide-react";
import { Badge, Bar, Button, IconButton } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { saldoVenta } from "@/lib/finanzas";
import { verComprobante } from "@/lib/comprobantes";
import { fechaLarga, money } from "@/lib/format";
import type { Cuota, EstadoApp, EstadoVenta, Venta } from "@/lib/types";
import { planDePago, tipoDePago } from "@/lib/angelo";
import { CabezaPlegable } from "./Plegable";

/* ==================================================================
   Una venta dentro de la ficha: qué compró, cuánto lleva pagado y cada
   cuota con sus pagos (con qué medio, si se concilió o tiene comprobante).
   Desde acá se registra el pago de cualquier cuota; si paga menos, las
   que siguen se reacomodan solas (RegistrarPago).

   Se pliega: plegada queda la cabeza con el valor total y cómo viene
   el cobro (cobrada, vencida o cuánto falta).
   ================================================================== */

const ESTADO: Record<EstadoVenta, { texto: string; variante: "success" | "neutral" | "danger" }> = {
  activa: { texto: "Activa", variante: "success" },
  cancelada: { texto: "Cancelada", variante: "neutral" },
  reembolsada: { texto: "Reembolsada", variante: "danger" },
};

export function TarjetaVenta({ e, venta, resaltada, abierta, onAlternar, onPagar, onEditar, onCancelar }: {
  e: EstadoApp; venta: Venta; resaltada?: boolean;
  abierta: boolean; onAlternar: () => void;
  onPagar: (cuota: Cuota) => void;
  onEditar: () => void;
  onCancelar: () => void;
}) {
  const toast = useToast();
  const M = (n: number, d = 0) => money(n, venta.moneda, d);
  const saldo = saldoVenta(e, venta.id);
  const producto = e.productos.find((x) => x.id === venta.productoId)?.nombre ?? "Venta";
  const closer = e.equipo.find((x) => x.id === venta.closerId)?.nombre;
  const embudo = e.embudos.find((x) => x.id === venta.embudoId)?.nombre;
  const webinar = e.webinars.find((x) => x.id === venta.webinarId)?.titulo;
  const setter = e.equipo.find((x) => x.id === venta.setterId)?.nombre;
  const activa = venta.estado === "activa";
  const cuotasVenta = e.cuotas.filter((c) => c.ventaId === venta.id);
  const filas = saldo.cuotas.map((c) => {
    const pagos = e.pagos.filter((p) => p.cuotaId === c.id);
    const pagado = pagos.reduce((a, p) => a + p.monto, 0);
    const resta = c.monto - pagado;
    const vencida = c.estado === "pendiente" && c.vence && new Date(c.vence) < new Date() && resta > 0.01;
    return { c, pagos, pagado, resta, vencida };
  });

  /* Plegada, lo que importa del cobro en una palabra. */
  const resumen = !activa ? null
    : saldo.saldo <= 0.01 ? <Badge variante="success"><Check size={13} />Cobrada</Badge>
    : filas.some((f) => f.vencida) ? <Badge variante="danger"><AlertTriangle size={13} />Vencida · faltan {M(saldo.saldo)}</Badge>
    : <Badge variante="accent">Faltan {M(saldo.saldo)}</Badge>;

  return (
    <div className="venta-card" data-resaltada={resaltada || undefined} id={`venta-${venta.id}`}>
      <CabezaPlegable
        abierta={abierta} onAlternar={onAlternar} cuerpoId={`venta-${venta.id}-cuerpo`}
        accion={<IconButton etiqueta="Editar la venta" onClick={onEditar}><Pencil size={15} /></IconButton>}
      >
        <span style={{ minWidth: 0, flex: 1 }}>
          <span className="row-wrap" style={{ gap: 8 }}>
            <span className="t-strong" style={{ fontSize: 16 }}>{producto}</span>
            <Badge variante={ESTADO[venta.estado].variante}>{ESTADO[venta.estado].texto}</Badge>
            {venta.excluidoMarketing && <Badge variante="warning">Excluida de marketing</Badge>}
          </span>
          <span className="t-sm t-subtle" style={{ display: "block", marginTop: 2 }}>
            {fechaLarga(venta.fecha)}
            {closer ? ` · vendedor ${closer}` : ""}
            {embudo ? ` · ${embudo}` : ""}
            {venta.proyecto ? ` · ${venta.proyecto}` : ""}
            {webinar && !venta.proyecto ? ` · ${webinar}` : ""}
          </span>
          {abierta && (
            <span className="t-sm t-subtle" style={{ display: "block" }}>
              {tipoDePago(venta, cuotasVenta)} · {planDePago(venta, cuotasVenta)}
              {setter ? ` · setter ${setter}` : ""}
              {venta.referidorNombre ? ` · referido por ${venta.referidorNombre}` : ""}
            </span>
          )}
        </span>
        <span className="venta-card__monto">
          <span className="t-num t-strong" style={{ fontSize: 17 }}>{M(venta.precioAcordado)}</span>
          {!abierta && resumen}
        </span>
      </CabezaPlegable>

      {abierta && (
        <div className="venta-card__cuerpo" id={`venta-${venta.id}-cuerpo`}>
          <div>
            <div className="row t-sm" style={{ marginBottom: 6 }}>
              <span className="t-subtle">Cobrado</span>
              <span className="spacer t-num t-strong">{M(saldo.cobrado)} de {M(saldo.total)}</span>
            </div>
            <Bar valor={saldo.total > 0 ? (saldo.cobrado / saldo.total) * 100 : 0} tono={saldo.saldo <= 0.01 ? "success" : "accent"} />
          </div>

          <div className="stack-2">
            {filas.map(({ c, pagos, pagado, resta, vencida }) => (
              <div key={c.id} className="cuota-fila">
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <span className="t-strong">{c.esReserva ? "Reserva" : `Cuota ${c.numero}`}</span>
                  {c.vence && <span className="t-sm t-subtle">vence {fechaLarga(c.vence)}</span>}
                  <span className="spacer t-num t-strong">{M(c.monto, 2)}</span>
                  {c.estado === "cancelada"
                    ? <Badge variante="neutral">Cancelada</Badge>
                    : vencida
                      ? <Badge variante="danger"><AlertTriangle size={13} />Vencida</Badge>
                      : resta <= 0.01
                        ? <Badge variante="success"><Check size={13} />Cobrada</Badge>
                        : pagado > 0
                          ? <Badge variante="accent">Faltan {M(resta, 2)}</Badge>
                          : <Badge variante="neutral">Pendiente</Badge>}
                </div>
                {pagos.length > 0 && (
                  <div className="cobro-subitems">
                    {pagos.map((p) => (
                      <div key={p.id} className="row t-sm" style={{ gap: 8, flexWrap: "wrap" }}>
                        <Receipt size={13} className="t-subtle" />
                        <span className="t-muted">{e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "Sin cuenta"}</span>
                        <span className="t-subtle">{fechaLarga(p.fecha)}</span>
                        {p.caracteristica && <Badge variante="neutral">{p.caracteristica}</Badge>}
                        {p.chequeado && !p.movimientoId && (
                          <span className="t-subtle" title="Pasado Financiera / Chequeado en plataforma" style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <Check size={12} />chequeado
                          </span>
                        )}
                        {p.pagador && <span className="t-subtle" title="Nombre de quien transfirió">de {p.pagador}</span>}
                        {p.tipoCambio && (
                          <span
                            className="t-subtle t-num"
                            title={p.tipoCambioBlue ? `Blue venta ${p.tipoCambioFuente ?? ""}: ${money(p.tipoCambioBlue, "ARS", 2)}` : "Tipo de cambio ARS"}
                          >
                            cambio {money(p.tipoCambio, "ARS", 2)}
                            {p.tipoCambioBlue && p.tipoCambioBlue !== p.tipoCambio ? ` · a mano (blue ${money(p.tipoCambioBlue, "ARS", 2)})` : ""}
                          </span>
                        )}
                        {p.cvu && <span className="t-subtle t-num" title="CBU/CVU desde el que transfirió">CBU/CVU …{p.cvu.slice(-6)}</span>}
                        {p.comprobanteLink && !p.comprobante && (
                          /^https?:\/\//.test(p.comprobanteLink)
                            ? <a className="link t-sm" href={p.comprobanteLink} target="_blank" rel="noreferrer"><Paperclip size={12} /> comprobante</a>
                            : <span className="t-subtle" title="Comprobante (de la planilla)"><Paperclip size={12} /> {p.comprobanteLink}</span>
                        )}
                        {p.movimientoId && (
                          <span className="t-subtle" title="Conciliado con el pago de la pasarela" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--success)" }}>
                            <Link2 size={12} />conciliado
                          </span>
                        )}
                        {p.comprobante && (
                          <button type="button" className="link t-sm" onClick={() => {
                            verComprobante(p.comprobante!).catch((err) => toast(err instanceof Error ? err.message : "No se pudo abrir.", "err"));
                          }}>
                            <Paperclip size={12} /> comprobante
                          </button>
                        )}
                        <span className="spacer t-num">{M(p.monto, 2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {activa && c.estado !== "cancelada" && resta > 0.01 && (
                  <Button sm variante="secondary" style={{ alignSelf: "flex-start", marginTop: 6 }} onClick={() => onPagar(c)}>
                    Registrar pago de {M(resta, 2)}
                  </Button>
                )}
              </div>
            ))}
          </div>

          {venta.notas && <p className="t-sm t-muted" style={{ whiteSpace: "pre-wrap" }}>{venta.notas}</p>}

          {activa && (
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <Button sm variante="ghost" onClick={onCancelar}>Cancelar venta</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
