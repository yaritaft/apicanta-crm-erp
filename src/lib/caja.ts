import type { Arqueo, EstadoApp, ID } from "./types";
import type { RangoMes } from "./metricas";
import { calcularPyL, gastosDelMes } from "./finanzas";

/* ==================================================================
   La caja: cuánta plata hay de verdad y si las cuentas dan.

   "Si los gastos están bien cargados, las cuentas deberían dar" (Yari).
   Cada arqueo es lo que había contado en cada cuenta. Entre un arqueo y
   el siguiente, la app sabe lo que tendría que haber pasado:

     caja del arqueo anterior
     + lo cobrado
     − lo que se quedaron los procesadores
     − las comisiones de closers y del director
     − los gastos cargados (directos, operativos y los honorarios del CEO)
     − el growth partner y el socio (su parte del profit)
     − los retiros del dueño
     = la caja esperada

   Si lo contado no da con lo esperado, falta cargar algo (un gasto, una
   venta) o hay un cobro que no entró. Las comisiones se pagan a mes
   vencido: al principio de mes la diferencia puede ser eso.

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
  cobrado: number;
  procesador: number;
  comisiones: number;
  gastos: number;
  reparto: number;
  retiros: number;
  esperado: number;
}

/** Lo que la app espera que haya en la caja en `hasta`, partiendo de un arqueo. */
export function cajaEsperada(e: EstadoApp, desde: Pick<Arqueo, "fecha" | "total">, hasta: string): MovimientoCaja {
  const m = rangoEntre(desde.fecha, hasta);
  const p = calcularPyL(e, m);
  const retiros = gastosDelMes(e, m, "retiro").reduce((a, g) => a + g.monto, 0);
  const gastos = p.otrosDirectos + p.gastosOperativos + p.honorariosCeo;
  const comisiones = p.comisionCloser + p.comisionDirector;
  const reparto = p.growth + p.socio;
  return {
    desde: desde.fecha, hasta,
    inicial: desde.total,
    cobrado: r2(p.cashCollected), procesador: r2(p.feesProcesador), comisiones: r2(comisiones),
    gastos: r2(gastos), reparto: r2(reparto), retiros: r2(retiros),
    esperado: r2(desde.total + p.cashCollected - p.feesProcesador - comisiones - gastos - reparto - retiros),
  };
}

/** Lo que entró a cada cuenta (neto de su comisión) entre dos momentos. */
export function entradasPorCuenta(e: EstadoApp, desdeIso: string | null, hastaIso: string): Map<ID, number> {
  const desde = desdeIso ? new Date(desdeIso).getTime() : -Infinity;
  const hasta = new Date(hastaIso).getTime();
  const out = new Map<ID, number>();
  for (const p of e.pagos) {
    const t = new Date(p.fecha).getTime();
    if (t <= desde || t > hasta || !p.procesadorId) continue;
    out.set(p.procesadorId, r2((out.get(p.procesadorId) ?? 0) + p.monto - p.feeMonto));
  }
  return out;
}

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
