import type { Arqueo, DetalleDeSaldo, EstadoApp, ID, Moneda, Procesador } from "./types";
import { cajaEsperada, cobrosSinVenta, cobrosSinVentaPorCuenta, efectoDelCambio, monedasDelSaldo, ultimoArqueo, type CobrosSinVentaDeCuenta, type MovimientoCaja } from "./caja";
import { primerConteo, type ResultadoPrimerConteo } from "./primer-conteo";
import { cuentaDeGasto, gastosSinCuenta, saldosEsperados, type SaldoEsperado } from "./traspasos";
import { fechaDePago, montoOriginal } from "./gastos";
import { fechaDeAcreditacion, retenciones } from "./acreditacion";
import { esDevolucionConfirmada, pesosQueSalieron } from "./devoluciones";

/* ==================================================================
   Cuánto tenía que dar un arqueo: UNA sola cuenta para el formulario, la
   tabla de arqueos y el paso del cierre del mes (Aldana, 03/11).

   Antes el formulario calculaba el esperado y lo guardaba como una foto. Dos
   cosas salieron mal: (1) el total y las cuentas se calculaban por caminos
   distintos —el total restaba lo que se le debía al equipo; cuenta por
   cuenta, sólo los pagos—, así que al completar los saldos «no marcaba nada»
   y al guardar daba US$ 30.084; (2) la foto no se movía: arreglada la cuenta
   o cargado el gasto que faltaba, el paso seguía diciendo 30.084 hasta que
   alguien tocaba la base. Ahora el esperado se calcula siempre acá, con los
   datos de hoy, y la diferencia que se muestra es la viva. Lo guardado al
   contar queda como constancia.

   Además la cuenta se controla sola: la suma de lo que tendría que haber en
   cada cuenta y el total tienen que dar lo mismo, salvo lo que tiene nombre
   (gastos sin cuenta, el cambio de las cuentas en pesos). Lo que no tiene
   nombre es `sinExplicar`: si aparece, hay un error de la app, no de quien
   contó (lo controlan las pruebas).

   Sin React ni red.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface CuentaDelArqueo {
  procesador: Procesador;
  moneda: Moneda;
  /* Lo de `saldosEsperados`: el último arqueo, lo que cobró, los pases y lo que salió, en su moneda. */
  saldo: SaldoEsperado;
  /* Cobros que entraron a esta cuenta sin su venta (están en la cuenta, no en lo cobrado); en pesos no se suman. */
  sinVenta?: CobrosSinVentaDeCuenta;
  /* Lo que cambió el valor de lo que había en cada moneda (dLocal). */
  cambio: ReturnType<typeof efectoDelCambio>;
  /* sinVenta + cambio, en la moneda de la cuenta. */
  ajuste: number;
  /* Lo que tendría que haber, en su moneda (undefined: no estaba en el arqueo anterior). */
  esperado?: number;
}

export interface EsperadoDelArqueo {
  previo?: Arqueo;
  mov: MovimientoCaja | null;
  cuentas: CuentaDelArqueo[];
  primer: ResultadoPrimerConteo;
  sinVenta: { n: number; monto: number };
  ajusteTotal: number;
  /* Lo que tenía que dar el total (null: es el primer arqueo, el punto de partida). */
  esperado: number | null;
  diferencia: number | null;
  /* La suma de lo que tendría que haber cada cuenta contra el total, partida por partida. */
  conciliacion: ConciliacionDelArqueo | null;
}

export interface ConciliacionDelArqueo {
  /* Lo que suman las cuentas (las que tienen de dónde partir, más su primer conteo), en la moneda base. */
  sumaDeCuentas: number;
  /* Gastos pagados que no dicen de qué cuenta salieron: el total los resta, ninguna cuenta. */
  sinCuenta: number;
  /* Las cuentas en pesos se pasan al cambio de hoy; el total cuenta cada cobro al cambio con que se cobró. */
  cambioDePesos: number;
  /* Lo que queda: tiene que ser cero (± centavos). */
  sinExplicar: number;
}

/** Las cuentas que entran en un arqueo: las activas, las que se movieron y las que ya estaban en el anterior. */
export function cuentasDelArqueo(e: Pick<EstadoApp, "procesadores">, porCuenta: ReadonlyMap<ID, SaldoEsperado>, previo?: Pick<Arqueo, "saldos">): Procesador[] {
  return e.procesadores.filter((p) => {
    const s = porCuenta.get(p.id);
    return p.activo || Boolean(s && (s.entro || s.pases || s.salio)) || Boolean(previo?.saldos.some((x) => x.procesadorId === p.id));
  });
}

export interface OpcionesDelArqueo {
  /* El arqueo del que se parte. Por defecto, el último antes de `fecha`. */
  previo?: Arqueo | null;
  /* El tipo de cambio de cada moneda de cada cuenta que se usa hoy (el formulario, mientras se escribe). Por defecto, el del detalle de lo contado. */
  cambios?: ReadonlyMap<ID, readonly { moneda: string; tipoCambio: number }[]>;
  /* Para la constancia del primer conteo. */
  dinero?: (monto: number, moneda: Moneda) => string;
}

/** Lo que tenía que dar un arqueo contado en `a.fecha` con esos saldos, con los datos de hoy. */
export function esperadoDelArqueo(
  e: EstadoApp, a: Pick<Arqueo, "fecha" | "saldos" | "total"> & { tipoCambio?: number | null }, o: OpcionesDelArqueo = {},
): EsperadoDelArqueo {
  const previo = o.previo === null ? undefined : (o.previo ?? ultimoArqueo(e, a.fecha));
  const tipoCambio = a.tipoCambio && a.tipoCambio > 0 ? a.tipoCambio : e.ajustes.tipoCambio;
  const base = e.ajustes.monedaBase;
  const porCuenta = saldosEsperados(e, previo, a.fecha);
  const sinVentaPorCuenta = cobrosSinVentaPorCuenta(e, previo?.fecha ?? null, a.fecha, tipoCambio);
  const dinero = o.dinero ?? ((m: number, mo: Moneda) => `${mo} ${m.toFixed(2)}`);

  const cuentas: CuentaDelArqueo[] = cuentasDelArqueo(e, porCuenta, previo).map((p) => {
    const moneda: Moneda = p.moneda ?? "USD";
    const saldo = porCuenta.get(p.id)!;
    const sinVenta = moneda === "ARS" ? undefined : sinVentaPorCuenta.get(p.id);
    const anterior: DetalleDeSaldo[] | undefined = previo?.saldos.find((x) => x.procesadorId === p.id)?.detalle;
    const hoy = o.cambios?.get(p.id) ?? a.saldos.find((x) => x.procesadorId === p.id)?.detalle?.map((l) => ({ moneda: l.moneda, tipoCambio: l.tipoCambio })) ?? [];
    const cambio = monedasDelSaldo(p).length && anterior?.length ? efectoDelCambio(anterior, hoy) : { total: 0, lineas: [] };
    const ajuste = r2((sinVenta?.monto ?? 0) + cambio.total);
    return { procesador: p, moneda, saldo, sinVenta, cambio, ajuste, esperado: saldo.esperado === undefined ? undefined : r2(saldo.esperado + ajuste) };
  });

  const mov = previo ? cajaEsperada(e, previo, a.fecha, tipoCambio) : null;
  const primer = primerConteo(a.saldos, porCuenta, Boolean(previo), dinero);
  const ajusteTotal = r2(cuentas.reduce((s, c) => s + c.ajuste, 0));
  const esperado = mov ? r2(mov.enCuentas + primer.totalBase + ajusteTotal) : null;
  const diferencia = esperado === null ? null : r2(a.total - esperado);

  let conciliacion: ConciliacionDelArqueo | null = null;
  if (mov && previo) {
    /* Lo que tendría que haber en cada cuenta, en la base: las que partían de algo, más lo que ya tenían las que se cuentan por primera vez
       (lo contado menos lo que se movió: su partida + lo que se movió = lo contado, que es lo que tendría que haber). */
    let suma = 0, cambioDePesos = 0;
    const desde = Date.parse(previo.fecha), hasta = Date.parse(a.fecha);
    const enVentana = (iso: string) => { const t = Date.parse(iso); return t > desde && t <= hasta; };
    const retencion = retenciones(e.procesadores);
    for (const c of cuentas) {
      const primera = primer.cuentas.find((x) => x.procesadorId === c.procesador.id);
      const enSuMoneda = c.esperado ?? (primera ? r2(primera.partida + c.saldo.entro + c.saldo.pases - c.saldo.salio) : undefined);
      if (enSuMoneda === undefined) continue;
      if (c.moneda === base) { suma += enSuMoneda; continue; }
      const contada = a.saldos.find((x) => x.procesadorId === c.procesador.id);
      const tc = contada && contada.monto ? contada.monto / contada.montoBase : tipoCambio;
      if (!(tc > 0)) continue;
      suma += enSuMoneda / tc;
      /* Cada cosa de una cuenta en pesos vale sus pesos al cambio de hoy en la suma y los dólares con que se anotó en el total: la diferencia es el
         cambio, no plata que falte. Se calcula partida por partida con los pesos de cada una —no como lo que sobra de la cuenta—, así un cobro o un
         gasto que la cuenta se olvide de contar no queda escondido como «cambio» (03/11: un cobro sin su cambio y un gasto en dólares desde la
         Financiera ARS no bajaban la cuenta). */
      const id = c.procesador.id;
      const tcAjustes = e.ajustes.tipoCambio;
      const anterior = previo.saldos.find((x) => x.procesadorId === id);
      if (anterior && !primera) cambioDePesos += anterior.monto / tc - anterior.montoBase;
      for (const p of e.pagos) {
        if (p.procesadorId !== id || !enVentana(fechaDeAcreditacion(p, retencion))) continue;
        const tcp = p.tipoCambio ?? tcAjustes;
        const pesos = (p.montoArs ?? (tcp > 0 ? p.monto * tcp : NaN)) - (tcp > 0 ? p.feeMonto * tcp : 0);
        cambioDePesos += Number.isFinite(pesos) ? pesos / tc - (p.monto - p.feeMonto) : 0;
      }
      for (const d of e.devoluciones ?? []) {
        if (d.procesadorId !== id || !esDevolucionConfirmada(d) || !enVentana(d.fecha)) continue;
        const pesos = pesosQueSalieron(e, d);
        cambioDePesos += Number.isFinite(pesos) ? d.monto - pesos / tc : 0;
      }
      for (const g of e.gastos) {
        if (g.extra?.traspasoId || cuentaDeGasto(g, e.procesadores) !== id || !enVentana(fechaDePago(g))) continue;
        const original = montoOriginal(g);
        const pesos = original?.moneda === "ARS" ? original.monto : tcAjustes > 0 ? g.monto * tcAjustes : NaN;
        cambioDePesos += Number.isFinite(pesos) ? g.monto - pesos / tc : 0;
      }
      /* El total no ve los pases entre pesos y dólares; la suma ve las dos puntas (cada una en su moneda). */
      for (const t of e.traspasos ?? []) {
        if (t.estado !== "confirmado" || !enVentana(t.fecha) || t.monedaSale === t.monedaLlega) continue;
        if (t.origenId === id) cambioDePesos += t.montoLlega - t.montoSale / tc;
        else if (t.destinoId === id) cambioDePesos += t.montoLlega / tc - t.montoSale;
      }
    }
    const sinCuenta = gastosSinCuenta(e, previo.fecha, a.fecha).total;
    const sumaDeCuentas = r2(suma);
    conciliacion = {
      sumaDeCuentas, sinCuenta, cambioDePesos: r2(cambioDePesos),
      /* Lo que viaja entre cuentas ya está de los dos lados: en el total como «en camino» y en las cuentas como los pases que salieron y llegaron. */
      sinExplicar: r2(sumaDeCuentas - cambioDePesos - sinCuenta - (esperado ?? 0)),
    };
  }

  return { previo, mov, cuentas, primer, sinVenta: cobrosSinVenta(e, previo?.fecha ?? null, a.fecha, tipoCambio), ajusteTotal, esperado, diferencia, conciliacion };
}

/** Un arqueo guardado, con la diferencia de hoy: si se cargó lo que faltaba (o se arregló una cuenta de la app), se mueve sola. `guardada` es la de
 *  cuando se contó, como constancia. */
export interface ArqueoVivo { arqueo: Arqueo; esperado: number | null; diferencia: number | null; guardada: { esperado: number | null; diferencia: number | null }; cambio: boolean }

export function arqueoVivo(e: EstadoApp, a: Arqueo): ArqueoVivo {
  const guardada = { esperado: a.esperado ?? null, diferencia: a.diferencia ?? null };
  /* El primero no tiene contra qué compararse: es el punto de partida. */
  if (guardada.esperado === null) return { arqueo: a, esperado: null, diferencia: null, guardada, cambio: false };
  const x = esperadoDelArqueo(e, a);
  /* Sin el arqueo anterior (se borró) no hay de dónde recalcular: vale lo guardado. */
  if (x.esperado === null) return { arqueo: a, esperado: guardada.esperado, diferencia: guardada.diferencia, guardada, cambio: false };
  const cambio = x.diferencia !== null && Math.abs(x.diferencia - (guardada.diferencia ?? 0)) >= 1;
  return { arqueo: a, esperado: x.esperado, diferencia: x.diferencia, guardada, cambio };
}

