/* ==================================================================
   El dólar para un cobro en pesos.

   Quien paga en pesos transfiere a la Financiera, que lo pasa a dólares a un
   tipo de cambio intermedio: «cobro más caro que el blue pero un poquito
   menos que el cripto» (Angelo, 02/10). Lo que propone la app es el
   **promedio entre el dólar blue (venta) y el dólar cripto (venta)**: con el
   blue en 1.560 y el cripto en 1.600, 1.580. El closer lo puede cambiar y el
   cobro guarda el que propuso la app para compararlo.

   Esto es lo puro, para que lo compartan el servidor (app/api/dolar), la
   pantalla (lib/dolar) y las pruebas.
   ================================================================== */

export interface CotizacionBlue {
  /** El dólar blue, venta. Es lo que usa la liquidación para pasar pesos a dólares. */
  venta: number;
  compra?: number;
  /** El dólar cripto, venta, del mismo día, si la fuente lo trajo. */
  cripto?: number;
  /** Lo que propone la app para un cobro en pesos: el promedio del blue venta
   *  y el cripto venta. Sin el cripto, el blue. */
  promedio: number;
  /** El día de la cotización, YYYY-MM-DD (Argentina). */
  fecha: string;
  fuente: "DolarHoy" | "DolarApi" | "ArgentinaDatos";
  /** Cómo lo dice la fuente: "23/09/26 09:20 PM", "cierre del 22/09/2026". */
  actualizado?: string;
}

/** El promedio del blue y el cripto, a centavos. Sin cripto, el blue.
 *  Se cuenta en centavos para que 1.578,685 dé 1.578,69 y no 1.578,68. */
export function promedioDolar(blue: number, cripto?: number): number {
  if (!(cripto !== undefined && cripto > 0)) return blue;
  return Math.round((Math.round(blue * 100) + Math.round(cripto * 100)) / 2) / 100;
}

const pesos = (n: number) => n.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Lo que queda guardado en el cobro, de dónde salió el tipo de cambio que
 *  propuso la app: "Promedio blue 1.550,00 y cripto 1.607,37 · DolarHoy 23/09/26 09:20 PM". */
export function fuenteDe(c: CotizacionBlue): string {
  const origen = c.actualizado ? `${c.fuente} · ${c.actualizado}` : c.fuente;
  return c.cripto && c.cripto > 0
    ? `Promedio blue ${pesos(c.venta)} y cripto ${pesos(c.cripto)} · ${origen}`
    : `Blue ${pesos(c.venta)} (sin cripto) · ${origen}`;
}
