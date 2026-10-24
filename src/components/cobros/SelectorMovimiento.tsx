"use client";

import React, { useMemo, useState } from "react";
import { AlertTriangle, Search, Sparkles } from "lucide-react";
import { Badge, Button, Chip, Empty, Input } from "@/components/ui/ui";
import { Modal } from "@/components/ui/Modal";
import { useEstado } from "@/lib/store";
import { fechaLarga, money } from "@/lib/format";
import { medioDeMovimiento, quienPagoVsCliente } from "@/lib/conciliacion";
import { nombrePasarela } from "@/lib/pasarelas";
import type { ID, Movimiento, ProveedorPasarela } from "@/lib/types";

/* ==================================================================
   Elegir el pago de la pasarela que corresponde a un cobro.

   Muestra TODOS los pagos sin conciliar de esa pasarela, no sólo los que
   parecen del cliente: el nombre en Stripe muchas veces es el de quien
   pagó con su tarjeta (la pareja, la empresa), no el del alumno. Arriba
   van los que son del cliente (mail, o nombre y apellido), después los de
   ese monto y después por fecha. «Coincide» es sólo el del cliente: el
   mismo monto o un nombre en común no alcanzan (dos «Andres» con seña de
   US$ 50 el mismo día, Dante 23/10). Elegir el de otra persona pide
   confirmarlo.

   Un pago puede repartirse entre dos cuotas (pagó la reserva y la
   primera cuota juntas): por eso se muestra lo que QUEDA de cada uno.
   ================================================================== */

export interface PagoDisponible {
  mov: Movimiento;
  disponible: number;
}

/* Lo que queda sin imputar de cada movimiento: lo que ya se imputó en la
   base (pagos con ese movimiento) y lo que ya se usó en el borrador. */
export function disponibleDe(
  mov: Movimiento, pagosDeLaBase: { movimientoId?: ID; monto: number }[], usadoEnBorrador: Map<ID, number>,
): number {
  const enBase = pagosDeLaBase.filter((p) => p.movimientoId === mov.id).reduce((a, p) => a + p.monto, 0);
  return Math.round((mov.monto - enBase - (usadoEnBorrador.get(mov.id) ?? 0)) * 100) / 100;
}

export function SelectorMovimiento({ abierto, onCerrar, proveedor, cliente, monto, usado, onElegir, liberar }: {
  abierto: boolean;
  onCerrar: () => void;
  /* La pasarela del medio elegido. Sin proveedor, se ven todas. */
  proveedor?: ProveedorPasarela;
  cliente?: { nombre?: string; email?: string };
  /* Lo que se espera cobrar: sube los pagos de ese monto. */
  monto?: number;
  /* Lo ya usado en OTROS cobros del mismo formulario, por movimiento */
  usado: Map<ID, number>;
  onElegir: (p: PagoDisponible) => void;
  /* Corrigiendo un cobro: el pago de la pasarela que tenía vuelve a ofrecerse
     (aunque figure conciliado) y lo que ese cobro imputaba no cuenta. */
  liberar?: { pagoId: ID; movimientoId?: ID };
}) {
  const e = useEstado();
  const [q, setQ] = useState("");
  const [todas, setTodas] = useState(!proveedor);
  const [tope, setTope] = useState(60);
  /* El pago de otra persona que se tocó: se pide confirmarlo antes de elegirlo. */
  const [dudoso, setDudoso] = useState<ID | null>(null);

  const lista = useMemo(() => {
    const texto = q.trim().toLowerCase();
    const numero = Number(texto.replace(/\./g, "").replace(",", "."));
    return e.movimientos
      .filter((m) => (m.estado === "pendiente" || (liberar?.movimientoId && m.id === liberar.movimientoId)) && (todas || !proveedor || m.proveedor === proveedor))
      .map((m) => ({ mov: m, disponible: disponibleDe(m, liberar ? e.pagos.filter((p) => p.id !== liberar.pagoId) : e.pagos, usado) }))
      .filter((x) => x.disponible > 0.009)
      .filter(({ mov }) => {
        if (!texto) return true;
        if (Number.isFinite(numero) && numero > 0 && Math.abs(mov.monto - numero) < 1) return true;
        return [mov.clienteNombre, mov.clienteEmail, mov.referencia, mov.descripcion]
          .some((c) => c?.toLowerCase().includes(texto));
      })
      .map((x) => {
        const quien = quienPagoVsCliente(x.mov, cliente);
        const mismoMonto = Boolean(monto && Math.abs(x.disponible - monto) < 0.5);
        return { ...x, quien, mismoMonto, puntaje: (quien === "es" ? 2 : 0) + (mismoMonto ? 1 : 0) };
      })
      .sort((a, b) => b.puntaje - a.puntaje || +new Date(b.mov.fecha) - +new Date(a.mov.fecha));
  }, [e.movimientos, e.pagos, usado, q, todas, proveedor, cliente?.nombre, cliente?.email, monto, liberar]);

  const nombre = proveedor ? nombrePasarela(proveedor) : "las pasarelas";
  const mon = e.ajustes.monedaBase;

  return (
    <Modal
      abierto={abierto} onCerrar={onCerrar} ancho
      titulo={todas ? "Pagos sin conciliar" : `Pagos de ${nombre} sin conciliar`}
      sub="Elegí el que corresponde a este cobro. Arriba, los de este cliente (mismo mail o nombre y apellido) y después los de este monto."
    >
      <div className="stack-3">
        <Input
          icono={<Search size={16} />} value={q} onChange={(ev) => { setQ(ev.target.value); setTope(60); }}
          placeholder="Buscar por nombre, email, referencia o monto" aria-label="Buscar pagos"
        />
        {proveedor && (
          <div className="row-wrap">
            <Chip activo={!todas} onClick={() => setTodas(false)}>Sólo {nombre}</Chip>
            <Chip activo={todas} onClick={() => setTodas(true)}>Todas las pasarelas</Chip>
          </div>
        )}

        {lista.length === 0 ? (
          <Empty
            icono={<Search size={22} />}
            titulo={q ? "Ningún pago coincide" : `No hay pagos de ${nombre} sin conciliar`}
            texto="Si la plata entró por otro lado, cerrá esto y subí el comprobante."
          />
        ) : (
          <div className="pagos-lista" role="list">
            {lista.slice(0, tope).map(({ mov, disponible, quien, mismoMonto }) => (
              <div key={mov.id} role="listitem" className="pago-fila__caja" data-duda={dudoso === mov.id || undefined}>
                <button
                  type="button" className="pago-fila"
                  onClick={() => (quien === "otra-persona" && cliente?.nombre ? setDudoso(mov.id) : onElegir({ mov, disponible }))}
                >
                  <span className="pago-fila__fecha t-sm t-subtle">{fechaLarga(mov.fecha)}</span>
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="truncate t-strong" style={{ display: "block" }}>
                      {mov.clienteNombre || "Sin nombre"}
                    </span>
                    <span className="truncate t-sm t-subtle" style={{ display: "block" }}>
                      {[mov.clienteEmail, mov.referencia, mov.descripcion].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  {quien === "es"
                    ? <Badge variante="success"><Sparkles size={12} />Coincide</Badge>
                    : mismoMonto && <Badge variante="neutral">Mismo monto</Badge>}
                  {todas && <Badge variante="neutral">{medioDeMovimiento(e, mov)}</Badge>}
                  <span className="pago-fila__monto">
                    <span className="t-num t-strong">{money(disponible, mov.moneda ?? mon, 2)}</span>
                    {disponible < mov.monto - 0.009 && (
                      <span className="t-sm t-subtle" style={{ display: "block" }}>quedan de {money(mov.monto, mov.moneda ?? mon, 2)}</span>
                    )}
                  </span>
                </button>
                {dudoso === mov.id && (
                  <div className="pago-fila__duda" role="alert">
                    <AlertTriangle size={16} aria-hidden />
                    <span className="t-sm" style={{ flex: 1, minWidth: 0 }}>
                      Este pago lo hizo <strong>{mov.clienteNombre || mov.clienteEmail}</strong>, no {cliente?.nombre}. ¿Es de este cliente igual (pagó otra persona por él)?
                    </span>
                    <Button sm variante="ghost" onClick={() => setDudoso(null)}>No, otro</Button>
                    <Button sm onClick={() => { setDudoso(null); onElegir({ mov, disponible }); }}>Sí, es este</Button>
                  </div>
                )}
              </div>
            ))}
            {lista.length > tope && (
              <Button variante="ghost" onClick={() => setTope((t) => t + 60)}>
                Mostrar más ({lista.length - tope})
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
