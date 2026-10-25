import type { Arqueo, DetalleDeSaldo, EstadoApp, Procesador } from "./types";
import { aMonedaBase } from "./gastos";
import type { RangoMes } from "./metricas";
import { calcularPyL, gastosPagadosEn } from "./finanzas";
import { enCamino } from "./traspasos";
import { finDelDia } from "./periodos";

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

/** Lo que entró a una cuenta y todavía no tiene su venta: cuántos cobros, cuánta plata (en la moneda base, neta de la comisión de la pasarela) y de quién. */
export interface CobrosSinVentaDeCuenta { n: number; monto: number; quienes: string[] }

/** La plata que entró a cada cuenta desde el último arqueo y todavía no tiene su venta cargada (cobros pendientes en Conciliación). No está en lo
 *  cobrado —un cobro cuenta cuando se ata a su cuota—, pero sí está en la cuenta: al contar, sobra esa plata. Por cuenta, para ponérsela a lo que
 *  esa cuenta tendría que tener. (Aldana, 22/10: «si el closer no lo carga no tengo forma de registrarlo… va a ser un problema cuando se hagan los
 *  arqueos»; 24/10: dos cobros de Whop sin venta —US$ 2.029— se veían como una diferencia de Whop.) */
export function cobrosSinVentaPorCuenta(
  e: Pick<EstadoApp, "movimientos" | "ajustes">, desdeIso: string | null, hastaIso: string, tipoCambio = 0,
): Map<string, CobrosSinVentaDeCuenta> {
  const desde = desdeIso ? Date.parse(desdeIso) : -Infinity;
  const hasta = Date.parse(hastaIso);
  const out = new Map<string, CobrosSinVentaDeCuenta>();
  for (const m of e.movimientos ?? []) {
    if (m.estado !== "pendiente") continue;
    const t = Date.parse(m.fecha);
    if (!(t > desde && t <= hasta)) continue;
    const c = out.get(m.procesadorId ?? "") ?? { n: 0, monto: 0, quienes: [] };
    c.n++;
    c.monto += aMonedaBase(Math.max(0, m.monto - m.fee), m.moneda, e.ajustes.monedaBase, tipoCambio);
    if (m.clienteNombre) c.quienes.push(m.clienteNombre);
    out.set(m.procesadorId ?? "", c);
  }
  for (const c of out.values()) c.monto = r2(c.monto);
  return out;
}

/** Lo mismo, todo junto: cuántos cobros y cuánta plata. */
export function cobrosSinVenta(
  e: Pick<EstadoApp, "movimientos" | "ajustes">, desdeIso: string | null, hastaIso: string, tipoCambio = 0,
): { n: number; monto: number } {
  let n = 0, monto = 0;
  for (const c of cobrosSinVentaPorCuenta(e, desdeIso, hastaIso, tipoCambio).values()) { n += c.n; monto += c.monto; }
  return { n, monto: r2(monto) };
}

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
    const hasta = finDelDia(new Date(hoy.getFullYear(), hoy.getMonth() - i + 1, 0));
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
export function ultimoArqueo(e: Pick<EstadoApp, "arqueos">, antesDe?: string): Arqueo | undefined {
  const tope = antesDe ? new Date(antesDe).getTime() : Infinity;
  return [...(e.arqueos ?? [])]
    .filter((a) => new Date(a.fecha).getTime() < tope)
    .sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha))[0];
}

/** Si algo que salió o entró ese día cuenta en lo que la app espera HOY en la caja y en cada cuenta (`cajaEsperada` y `saldosEsperados`): sólo
    cuenta lo posterior al último arqueo, porque el saldo que se contó ahí ya traía todo lo anterior. Sin ningún arqueo, cuenta todo.
    Una devolución cargada con fecha de un mes pasado resta en ESE mes (Cash Collected y estado de resultados), pero no mueve la caja de hoy. */
export function cuentaEnLaCajaDeHoy(e: Pick<EstadoApp, "arqueos">, fechaIso: string): { cuenta: boolean; arqueo?: Arqueo } {
  const arqueo = ultimoArqueo(e);
  return { cuenta: !arqueo || Date.parse(fechaIso) > Date.parse(arqueo.fecha), arqueo };
}

/* ---------- Cuentas con saldo en varias monedas ----------
   Aldana (23/10): dLocal guarda un saldo en cada moneda (pesos argentinos, mexicanos, soles peruanos, pesos colombianos) y el arqueo pedía un solo
   número en dólares: «como todos tienen distinto tipo de cambio, no sé a qué valor se toma cada uno». Ahora esa cuenta se cuenta moneda por
   moneda, con el tipo de cambio de cada una (se acuerda del último), y el saldo en dólares es la suma. */

export const MONEDAS_DE_DLOCAL: readonly { codigo: string; nombre: string }[] = [
  { codigo: "ARS", nombre: "Pesos argentinos" },
  { codigo: "MXN", nombre: "Pesos mexicanos" },
  { codigo: "PEN", nombre: "Soles peruanos" },
  { codigo: "COP", nombre: "Pesos colombianos" },
];

/** Las monedas en las que una cuenta guarda saldo, si son varias (si no, vacío: se cuenta con un solo número). */
export const monedasDelSaldo = (p: Pick<Procesador, "proveedor">): readonly { codigo: string; nombre: string }[] =>
  p.proveedor === "dlocal" ? MONEDAS_DE_DLOCAL : [];

/** Lo que dice cada línea escrita (monto y tipo de cambio por dólar) pasado a dólares. Las que no tienen monto o tipo de cambio no cuentan. */
export function detalleDeSaldo(lineas: readonly { moneda: string; monto: number; tipoCambio: number }[]): DetalleDeSaldo[] {
  return lineas
    .filter((l) => Number.isFinite(l.monto) && l.monto !== 0 && l.tipoCambio > 0)
    .map((l) => ({ moneda: l.moneda, monto: l.monto, tipoCambio: l.tipoCambio, montoBase: r2(l.monto / l.tipoCambio) }));
}

export const totalDelDetalle = (d: readonly DetalleDeSaldo[]): number => r2(d.reduce((a, l) => a + l.montoBase, 0));

/** Lo que cambió el valor en dólares de lo que ya había en cada moneda por moverse el tipo de cambio entre un arqueo y el otro: 4.000.000 pesos
 *  a 1.600 son US$ 2.500 y a 1.545 son US$ 2.589; nadie puso ni sacó plata, es el cambio. Sólo cuenta lo que había en el arqueo anterior (lo
 *  que entró después ya se anotó a su cambio) y las monedas que se cuentan en los dos arqueos con tipo de cambio. (Aldana, 24/10: con dLocal en
 *  cuatro monedas «me da como mil usd de diferencia».) */
export function efectoDelCambio(
  anterior: readonly Pick<DetalleDeSaldo, "moneda" | "monto" | "tipoCambio">[] | undefined,
  ahora: readonly { moneda: string; tipoCambio: number }[],
): { total: number; lineas: { moneda: string; monto: number; antes: number; ahora: number; efecto: number }[] } {
  const lineas: { moneda: string; monto: number; antes: number; ahora: number; efecto: number }[] = [];
  for (const prev of anterior ?? []) {
    const hoy = ahora.find((l) => l.moneda === prev.moneda);
    if (!hoy || !(hoy.tipoCambio > 0) || !(prev.tipoCambio > 0) || !prev.monto) continue;
    const antes = r2(prev.monto / prev.tipoCambio), valeAhora = r2(prev.monto / hoy.tipoCambio);
    const efecto = r2(valeAhora - antes);
    if (efecto !== 0) lineas.push({ moneda: prev.moneda, monto: prev.monto, antes, ahora: valeAhora, efecto });
  }
  return { total: r2(lineas.reduce((a, l) => a + l.efecto, 0)), lineas };
}

/* Las cuentas que no se usan seguido van en «Otros», al final del arqueo: a
   mano lo que se usa todo el tiempo y lo demás un clic más abajo (Yari, 02/10:
   Mercado Pago, Galicia, Efectivo USD y Binance «van a molestar todo el
   tiempo»). Cada cuenta lo dice con `cajaOtros` (Ajustes → Ventas → Cuentas
   recaudadoras); si no dice nada, valen estos nombres. */
export const CUENTAS_SIN_USO = /mercado\s*pago|galicia|efectivo|binance/i;
export const enOtros = (p: Pick<Procesador, "nombre" | "cajaOtros">): boolean =>
  p.cajaOtros ?? CUENTAS_SIN_USO.test(p.nombre);
