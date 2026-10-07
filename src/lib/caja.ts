import type { Arqueo, EstadoApp, Procesador } from "./types";
import type { RangoMes } from "./metricas";
import { calcularPyL, gastosPagadosEn } from "./finanzas";
import { enCamino } from "./traspasos";

/* ==================================================================
   La caja: cuánta plata hay de verdad y si las cuentas dan.

   "Si los gastos están bien cargados, las cuentas deberían dar" (Yari).
   Cada arqueo es lo que había contado en cada cuenta. Entre un arqueo y
   el siguiente, la app sabe lo que tendría que haber pasado:

     caja del arqueo anterior
     + lo cobrado
     − lo que se devolvió a clientes
     − lo que se quedaron los procesadores
     − las comisiones de closers y del director
     − los gastos que se pagaron (directos, operativos y los honorarios del
       CEO), el día que se pagaron: un gasto de septiembre pagado el 2 de
       octubre resta en el estado de resultados de septiembre y en la caja
       de octubre (Gasto.fechaPago; sin ella, es el mismo día)
     − el growth partner y el socio (su parte del profit)
     − los retiros del dueño
     = la caja esperada

   Si lo contado no da con lo esperado, falta cargar algo (un gasto, una
   venta) o hay un cobro que no entró. Las comisiones se pagan a mes
   vencido: al principio de mes la diferencia puede ser eso.

   La plata que pasa de una cuenta a otra (lib/traspasos.ts) no cambia la
   caja, pero mientras viaja no está en ninguna cuenta: lo que tiene que
   dar al contar es la caja esperada menos lo que está en camino. Y lo que
   estaba en camino cuando se contó el arqueo anterior no se contó en
   ninguna: se suma, porque después llegó.

   Los meses de vida son la caja sobre lo que cuesta un mes sin vender
   (gastos operativos y honorarios del CEO: sueldos, ads, software), con
   el promedio de los últimos tres meses cerrados. Yari apunta a tener
   seis; lo que pasa de eso se puede retirar.
   ================================================================== */

export const MESES_DE_COLCHON = 6;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Un rango de instantes, sin incluir el primero (el del arqueo anterior). */
export function rangoEntre(desdeIso: string, hastaIso: string): RangoMes {
  return {
    clave: `${desdeIso}_${hastaIso}`, etiqueta: "Desde el último arqueo",
    desde: new Date(new Date(desdeIso).getTime() + 1), hasta: new Date(hastaIso),
  };
}

export interface MovimientoCaja {
  desde: string;
  hasta: string;
  inicial: number;
  /* Lo que al contar el arqueo anterior estaba en camino entre dos
     cuentas: no se contó en ninguna y es plata de la caja. */
  enCaminoAntes: number;
  cobrado: number;
  /* Lo que se devolvió a clientes: salió de la caja (la comisión de la
     pasarela no vuelve: sigue en «procesador»). */
  devoluciones: number;
  procesador: number;
  comisiones: number;
  gastos: number;
  reparto: number;
  retiros: number;
  /* La plata del negocio, esté en una cuenta o viajando entre dos. */
  esperado: number;
  /* La que ahora está en camino: salió de una cuenta y no llegó a la otra. */
  enCamino: number;
  /* Lo que tendría que dar al contar las cuentas: la esperada menos la
     que está en camino. */
  enCuentas: number;
}

/** Lo que la app espera que haya en la caja en `hasta`, partiendo de un
    arqueo. El tipo de cambio es para lo que viaje entre cuentas en pesos. */
export function cajaEsperada(
  e: EstadoApp, desde: Pick<Arqueo, "fecha" | "total">, hasta: string, tipoCambio = e.ajustes.tipoCambio,
): MovimientoCaja {
  const m = rangoEntre(desde.fecha, hasta);
  const p = calcularPyL(e, m);
  /* La plata que salió: cada gasto cuenta el día que se pagó, no el mes al
     que corresponde (ese es del estado de resultados). Con las dos fechas
     iguales da lo mismo que `p.otrosDirectos + p.gastosOperativos +
     p.honorariosCeo`. */
  const pagados = gastosPagadosEn(e, m);
  const retiros = pagados.filter((g) => g.grupo === "retiro").reduce((a, g) => a + g.monto, 0);
  const gastos = pagados.filter((g) => g.grupo !== "retiro").reduce((a, g) => a + g.monto, 0);
  const comisiones = p.comisionCloser + p.comisionDirector;
  const reparto = p.growth + p.socio;
  const enCaminoAntes = enCamino(e, desde.fecha, tipoCambio);
  const viajando = enCamino(e, hasta, tipoCambio);
  /* `cashCollected` ya viene sin lo devuelto: acá se parte en lo que entró y
     lo que salió para que se vean las dos cosas. */
  const esperado = r2(desde.total + enCaminoAntes + p.cobrado - p.devoluciones - p.feesProcesador - comisiones - gastos - reparto - retiros);
  return {
    desde: desde.fecha, hasta,
    inicial: desde.total, enCaminoAntes,
    cobrado: r2(p.cobrado), devoluciones: r2(p.devoluciones), procesador: r2(p.feesProcesador), comisiones: r2(comisiones),
    gastos: r2(gastos), reparto: r2(reparto), retiros: r2(retiros),
    esperado, enCamino: viajando, enCuentas: r2(esperado - viajando),
  };
}

/* Lo que tendría que haber en cada cuenta (lo que cobró, lo que pasó de
   una a otra, lo que se retiró) está en lib/traspasos.ts: saldosEsperados. */

export interface Runway {
  /* Lo que cuesta un mes sin vender, promedio de los últimos tres cerrados. */
  gastoMensual: number;
  /* De qué meses sale el promedio: "jun, jul y ago". */
  meses: string;
  mesesDeVida: number | null;
  colchon: number;
  /* Lo que pasa de los seis meses: se puede retirar. Negativo, falta. */
  excedente: number;
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

export function runway(e: EstadoApp, caja: number, hoy = new Date()): Runway {
  const cerrados: RangoMes[] = [];
  for (let i = 3; i >= 1; i--) {
    const desde = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const hasta = new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0, 23, 59, 59);
    cerrados.push({ clave: `${desde.getFullYear()}-${desde.getMonth() + 1}`, etiqueta: MESES[desde.getMonth()], desde, hasta });
  }
  const costos = cerrados.map((m) => {
    const p = calcularPyL(e, m);
    return p.gastosOperativos + p.honorariosCeo;
  });
  const gastoMensual = r2(costos.reduce((a, x) => a + x, 0) / cerrados.length);
  const colchon = r2(gastoMensual * MESES_DE_COLCHON);
  const nombres = cerrados.map((m) => m.etiqueta);
  return {
    gastoMensual,
    meses: `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`,
    mesesDeVida: gastoMensual > 0 ? caja / gastoMensual : null,
    colchon,
    excedente: r2(caja - colchon),
  };
}

/** El último arqueo hecho hasta ahora. */
export function ultimoArqueo(e: EstadoApp, antesDe?: string): Arqueo | undefined {
  const tope = antesDe ? new Date(antesDe).getTime() : Infinity;
  return [...(e.arqueos ?? [])]
    .filter((a) => new Date(a.fecha).getTime() < tope)
    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha))[0];
}

/* Las cuentas que no se usan seguido van en «Otros», al final del arqueo: a
   mano lo que se usa todo el tiempo y lo demás un clic más abajo (Yari, 02/10:
   Mercado Pago, Galicia, Efectivo USD y Binance «van a molestar todo el
   tiempo»). Cada cuenta lo dice con `cajaOtros` (Ajustes → Ventas → Cuentas
   recaudadoras); si no dice nada, valen estos nombres. */
export const CUENTAS_SIN_USO = /mercado\s*pago|galicia|efectivo|binance/i;
export const enOtros = (p: Pick<Procesador, "nombre" | "cajaOtros">): boolean =>
  p.cajaOtros ?? CUENTAS_SIN_USO.test(p.nombre);
