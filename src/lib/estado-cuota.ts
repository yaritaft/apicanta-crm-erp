import type { Cuota, Pago } from "./types";
import { esIncobrable } from "./cuota-incobrable";

/* ==================================================================
   Cómo viene el cobro de una cuota: lo pagado, lo que falta y si ya
   venció. Lo leen la tarjeta de la venta (Ventas) y la solapa Pagos del
   Servicio (Mariano, 04/11: «en esta pantalla dónde podemos ver el tema
   de los pagos»), así las dos dicen lo mismo de la misma cuota.
   ================================================================== */

export type EstadoCuota = "cobrada" | "vencida" | "en-parte" | "pendiente" | "incobrable" | "cancelada";

export interface CobroDeCuota {
  pagos: Pago[];
  pagado: number;
  resta: number;
  estado: EstadoCuota;
}

export function cobroDeCuota(c: Cuota, pagosDeLaApp: readonly Pago[], ahora = Date.now()): CobroDeCuota {
  const pagos = pagosDeLaApp.filter((p) => p.cuotaId === c.id);
  const pagado = pagos.reduce((a, p) => a + p.monto, 0);
  const resta = c.monto - pagado;
  const estado: EstadoCuota = c.estado === "cancelada" ? (esIncobrable(c) ? "incobrable" : "cancelada")
    : resta <= 0.01 ? "cobrada"
      : c.estado === "pendiente" && c.vence && new Date(c.vence).getTime() < ahora ? "vencida"
        : pagado > 0 ? "en-parte"
          : "pendiente";
  return { pagos, pagado, resta, estado };
}
