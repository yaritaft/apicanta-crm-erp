"use client";

import React, { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { fecha, money } from "@/lib/format";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { closerDeCuota } from "@/lib/finanzas";
import { cuotasPorCobrarDe } from "@/lib/cuotas-closer";
import { esIncobrable } from "@/lib/cuota-incobrable";
import { mesaDe } from "@/lib/mi-panel";
import { hoyDeNegocio } from "@/lib/cierre-del-dia";
import type { EstadoApp } from "@/lib/types";
import { TarjetaMesa } from "./Tarjetas";

/* ==================================================================
   Las cuotas de TODO el equipo en el panel del director (Santiago, 20/11: «me das acceso al panel cuotas por vencer y a las cuotas por
   cobrar»). Un closer ve las suyas en «Sobre la mesa»; el director, que no tiene cuotas propias, no veía ninguna. Acá es la misma mesa
   (vence este mes, vencido de antes, más adelante) sumando a todos los closers, y al abrir un tramo, cada cuota con su closer.
   ================================================================== */

type Tramo = "mes" | "atrasado" | "riesgo" | "futuro" | "incobrable";
const TITULO: Record<Tramo, string> = {
  mes: "Vence este mes", atrasado: "Vencido de antes", riesgo: "Vencido hace más de 90 días", futuro: "Vence más adelante", incobrable: "Incobrables",
};

export function CuotasDelEquipo({ e }: { e: EstadoApp }) {
  const abrirFicha = useAbrirFicha();
  const [tramo, setTramo] = useState<Tramo | null>(null);
  const hoy = hoyDeNegocio();
  const mesa = useMemo(() => mesaDe(e, null, hoy), [e, hoy]);

  const filas = useMemo(() => {
    if (!tramo) return [];
    const mes = hoy.slice(0, 7);
    const hace90 = diaDeNegocio(new Date(Date.parse(`${hoy}T12:00:00Z`) - 90 * 86400000).toISOString());
    const nombre = (id?: string) => e.equipo.find((m) => m.id === id)?.nombre ?? "Sin closer";
    const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "Venta";
    const quePasa = (c: { vence?: string }) => {
      const d = c.vence ? diaDeNegocio(c.vence) : "";
      if (tramo === "mes") return d.slice(0, 7) === mes;
      if (tramo === "atrasado") return d !== "" && d.slice(0, 7) < mes;
      if (tramo === "riesgo") return d !== "" && d < hace90 && d.slice(0, 7) < mes;
      return d !== "" && d.slice(0, 7) > mes;
    };
    const base = tramo === "incobrable"
      ? cuotasPorCobrarDe(e, null).filter((x) => esIncobrable(x.cuota))
      : cuotasPorCobrarDe(e, null).filter((x) => !esIncobrable(x.cuota) && quePasa(x.cuota));
    return base
      .map((x) => ({
        id: x.cuota.id, ventaId: x.venta.id, nombre: x.venta.contactoNombre, vence: x.cuota.vence ? diaDeNegocio(x.cuota.vence) : "",
        closer: nombre(closerDeCuota(x.venta, x.cuota)), cuota: x.cuota.esReserva ? "Reserva" : `Cuota ${x.cuota.numero}`,
        producto: productoDe(x.venta.productoId), monto: x.falta,
      }))
      .sort((a, b) => a.vence.localeCompare(b.vence));
  }, [tramo, e, hoy]);
  const total = filas.reduce((a, f) => a + f.monto, 0);

  return (
    <>
      <TarjetaMesa titulo="Sobre la mesa · por cobrar · todo el equipo" mesa={mesa} onAbrir={setTramo} />
      {tramo && (
        <Modal abierto onCerrar={() => setTramo(null)} titulo={`${TITULO[tramo]} · todo el equipo`} sub={`${filas.length} ${filas.length === 1 ? "cuota" : "cuotas"} · ${money(total, "USD", 0)}`} ancho>
          {filas.length === 0 ? <p className="mp-vacio">No hay cuotas en este tramo.</p> : (
            <div className="mp-cobros">
              {filas.map((f) => (
                <div key={f.id} className="mp-cobros__fila">
                  <span className="mp-cobros__fecha" style={{ minWidth: 76, color: tramo === "atrasado" || tramo === "riesgo" ? "var(--danger)" : undefined }}>{f.vence ? fecha(f.vence) : "Sin fecha"}</span>
                  <span className="mp-cobros__nombre"><button type="button" className="link" onClick={() => { setTramo(null); abrirFicha(f.ventaId, "ventas", { venta: f.ventaId }); }}>{f.nombre}</button></span>
                  <span className="t-sm t-subtle">{f.cuota} · {f.producto} · {f.closer}</span>
                  <span className="mp-cobros__monto">{money(f.monto, "USD", 0)}</span>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
