import type { EstadoApp, ID } from "./types";
import { fechaDeAcreditacion, retenciones } from "./acreditacion";
import { saldoDeCuota } from "./conciliacion";
import { diaDeNegocio } from "./dia-negocio";
import { fechaDePago } from "./gastos";
import type { SaldoDeCuenta } from "./saldos-vista";

/* ==================================================================
   Flujo de fondos: cuánta plata hay para operar hoy y cómo sigue, día por día, con lo que se sabe que entra y sale.

   Juan Cruz (03/11): «todo el flujo de caja, de acuerdo a cuándo nos van a pagar, cuándo va a entrar el dinero de Stripe, cuánto realmente
   tenemos líquido y cuándo se esperan los próximos gastos y los próximos ingresos», como el de Blue OS (Marcos) y el de Moneo. Las reglas
   salen de lo que contestó Aldana el 04/11 (traspaso/aldana-flujo-04-11):

     · Disponible: lo que hay en los bancos y en las pasarelas que transfieren solas (Whop todos los días, Stripe cada 1 a 3 días hábiles,
       Hotmart una vez por mes). Lo demás (la Financiera, dLocal, USDT, el efectivo, Galicia, Mercado Pago) queda «aparte»: según Aldana,
       «el dinero queda ahí salvo que Yari decida transferirlo», y de la Financiera hoy no se puede ver el saldo.
     · Entra: las cuotas que vencen, menos la comisión promedio de las pasarelas del mes pasado (con la opción de contar sólo la parte que
       se suele cobrar), y lo que Hotmart retiene, el día que lo acredita. Las ventas nuevas NO: es lo que pasa si no se vende nada más.
     · Sale: lo que salió el mes pasado, el mismo día de cada mes (sueldos del 1 al 5, el software el día de su cargo, los honorarios del
       CEO, las comisiones). La tarjeta de Mercury se paga todos los días por lo gastado, así que un gasto con tarjeta sale el día del
       cargo. La publicidad va aparte: al ritmo de los últimos 7 días, porque la campaña se prende y se apaga. Los retiros del dueño no.

   Sin React ni red: la pantalla y las pruebas usan las mismas reglas.
   ================================================================== */

/* Las cuentas cuya plata se puede usar para operar: los bancos y las pasarelas que pasan solas a los bancos. */
export const CUENTAS_DISPONIBLES: ReadonlySet<ID> = new Set(["proc_mercury", "proc_bofa", "proc_relay", "proc_stripe", "proc_whop", "proc_hotmart"]);

/* La publicidad: un gasto de Meta no se repite como el mes pasado, se proyecta al ritmo de los últimos días. */
export const esPublicidad = (categoria: string): boolean => /meta ads|publicidad|facebook/i.test(categoria);
export const DIAS_DE_PUBLICIDAD = 7;
/* La parte de las cuotas que se cobra: se mide con las que vencieron entre 105 y 15 días atrás (dio tiempo a cobrarlas). */
const VENTANA_DE_COBRO = { desde: 105, hasta: 15 };
const MINIMO_PARA_TASA = 10;

export type TipoDeMovimiento = "cuota" | "acreditacion" | "gasto" | "publicidad";

export interface MovimientoFuturo {
  dia: string;
  tipo: TipoDeMovimiento;
  concepto: string;
  detalle?: string;
  /* En la moneda base: positivo entra, negativo sale. */
  monto: number;
}

export interface DiaDelFlujo { dia: string; entra: number; sale: number; saldo: number }
export interface SemanaDelFlujo { desde: string; hasta: string; entra: number; sale: number; saldo: number }
export interface SalidaDelMesBase { categoria: string; monto: number; veces: number }

export interface FlujoDeFondos {
  hoy: string;
  hasta: string;
  disponible: number;
  aparte: number;
  cuentasDisponibles: SaldoDeCuenta[];
  cuentasAparte: SaldoDeCuenta[];
  movimientos: MovimientoFuturo[];
  dias: DiaDelFlujo[];
  semanas: SemanaDelFlujo[];
  entra: number;
  sale: number;
  final: number;
  /* El día en que queda menos plata disponible. */
  minimo: { dia: string; saldo: number };
  supuestos: {
    /* La comisión de las pasarelas del mes pasado, sobre lo cobrado (0,05 = 5%). */
    comision: number;
    /* La parte de las cuotas que se termina cobrando; null si hay muy pocas para medirla. */
    tasaDeCobro: number | null;
    ponderado: boolean;
    vencidas: { cuotas: number; monto: number };
    publicidadDiaria: number;
    mesBase: string;
    salidasDelMesBase: SalidaDelMesBase[];
  };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const DIA_MS = 86_400_000;
export const sumarDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T12:00:00.000Z`) + n * DIA_MS).toISOString().slice(0, 10);
const diasDelMes = (mes: string): number => new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).getUTCDate();
const mesAnterior = (mes: string): string => {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};

/** La parte de las cuotas que se termina cobrando: de las que vencieron hace entre 105 y 15 días, cuántas (en plata) ya se pagaron. */
export function tasaDeCobro(e: Pick<EstadoApp, "cuotas" | "ventas">, hoy: string): number | null {
  const desde = sumarDias(hoy, -VENTANA_DE_COBRO.desde), hasta = sumarDias(hoy, -VENTANA_DE_COBRO.hasta);
  const activas = new Set(e.ventas.filter((v) => v.estado === "activa").map((v) => v.id));
  const medidas = e.cuotas.filter((c) => c.vence && c.estado !== "cancelada" && activas.has(c.ventaId) && c.vence.slice(0, 10) >= desde && c.vence.slice(0, 10) <= hasta);
  if (medidas.length < MINIMO_PARA_TASA) return null;
  const total = medidas.reduce((a, c) => a + c.monto, 0);
  const cobrado = medidas.filter((c) => c.estado === "pagada").reduce((a, c) => a + c.monto, 0);
  return total > 0 ? cobrado / total : null;
}

/** La comisión de las pasarelas sobre lo cobrado en el mes: lo que se descuenta de cada cuota que entra. */
export function comisionPromedio(e: Pick<EstadoApp, "pagos">, mes: string): number {
  const delMes = e.pagos.filter((p) => diaDeNegocio(p.fecha).slice(0, 7) === mes && p.monto > 0);
  const cobrado = delMes.reduce((a, p) => a + p.monto, 0);
  return cobrado > 0 ? delMes.reduce((a, p) => a + (p.feeMonto ?? 0), 0) / cobrado : 0;
}

export function flujoDeFondos(
  e: EstadoApp,
  cuentas: readonly SaldoDeCuenta[],
  hoyIso: string,
  opciones: { dias: number; ponderar: boolean },
): FlujoDeFondos {
  const hoy = diaDeNegocio(hoyIso);
  const hasta = sumarDias(hoy, opciones.dias);
  const enRango = (dia: string) => dia >= hoy && dia <= hasta;
  const movimientos: MovimientoFuturo[] = [];

  /* ---------- Lo que hay hoy ---------- */
  const conSaldo = cuentas.filter((c) => c.saldoBase !== undefined);
  const cuentasDisponibles = conSaldo.filter((c) => CUENTAS_DISPONIBLES.has(c.cuentaId));
  const cuentasAparte = conSaldo.filter((c) => !CUENTAS_DISPONIBLES.has(c.cuentaId) && Math.abs(c.saldoBase!) >= 0.5);
  const disponible = r2(cuentasDisponibles.reduce((a, c) => a + c.saldoBase!, 0));
  const aparte = r2(cuentasAparte.reduce((a, c) => a + c.saldoBase!, 0));

  /* ---------- Entra: las cuotas ---------- */
  const mesBase = mesAnterior(hoy.slice(0, 7));
  const comision = comisionPromedio(e, mesBase);
  const tasa = tasaDeCobro(e, hoy);
  const factor = (1 - comision) * (opciones.ponderar && tasa !== null ? tasa : 1);
  const ventas = new Map(e.ventas.map((v) => [v.id, v]));
  const nombre = (contactoId?: ID) => (contactoId ? e.leads.find((l) => l.id === contactoId)?.nombre : undefined);
  let vencidas = 0, montoVencido = 0;
  for (const c of e.cuotas) {
    if (c.estado !== "pendiente" || !c.vence) continue;
    const v = ventas.get(c.ventaId);
    if (!v || v.estado !== "activa" || c.seguimientoCobro?.estado === "baja") continue;
    const falta = saldoDeCuota(e, c);
    if (falta < 0.01) continue;
    const dia = c.vence.slice(0, 10);
    if (dia < hoy) { vencidas++; montoVencido += falta; continue; }
    if (!enRango(dia)) continue;
    const quien = nombre(v.contactoId);
    movimientos.push({ dia, tipo: "cuota", concepto: quien ?? `Cuota ${c.numero}`, detalle: quien ? `cuota ${c.numero}` : undefined, monto: r2(falta * factor) });
  }

  /* ---------- Entra: lo que Hotmart (o la cuenta que retenga) acredita más adelante ---------- */
  const ret = retenciones(e.procesadores);
  if (ret.size) {
    const cuenta = (id?: ID) => e.procesadores.find((p) => p.id === id)?.nombre ?? "la cuenta";
    for (const p of e.pagos) {
      if (!p.procesadorId || !CUENTAS_DISPONIBLES.has(p.procesadorId)) continue;
      const acredita = fechaDeAcreditacion(p, ret);
      if (acredita === p.fecha) continue;
      const dia = diaDeNegocio(acredita);
      if (dia <= hoy || dia > hasta) continue;
      movimientos.push({ dia, tipo: "acreditacion", concepto: `${cuenta(p.procesadorId)} acredita un cobro`, detalle: `cobrado el ${diaDeNegocio(p.fecha).slice(8, 10)}/${diaDeNegocio(p.fecha).slice(5, 7)}`, monto: r2(p.monto - (p.feeMonto ?? 0)) });
    }
  }

  /* ---------- Sale: lo del mes pasado, el mismo día de cada mes ---------- */
  const porCategoria = new Map<string, SalidaDelMesBase>();
  const porDiaYCategoria = new Map<string, number>();
  for (const g of e.gastos) {
    if (g.grupo === "retiro" || esPublicidad(g.categoria)) continue;
    const pagado = diaDeNegocio(fechaDePago(g));
    if (pagado.slice(0, 7) !== mesBase) continue;
    const s = porCategoria.get(g.categoria) ?? { categoria: g.categoria, monto: 0, veces: 0 };
    s.monto += g.monto; s.veces++;
    porCategoria.set(g.categoria, s);
    const clave = `${Number(pagado.slice(8, 10))}|${g.categoria}`;
    porDiaYCategoria.set(clave, (porDiaYCategoria.get(clave) ?? 0) + g.monto);
  }
  for (let mes = hoy.slice(0, 7); mes <= hasta.slice(0, 7); mes = sumarDias(`${mes}-${String(diasDelMes(mes)).padStart(2, "0")}`, 1).slice(0, 7)) {
    for (const [clave, monto] of porDiaYCategoria) {
      const [d, categoria] = [Number(clave.split("|")[0]), clave.slice(clave.indexOf("|") + 1)];
      const dia = `${mes}-${String(Math.min(d, diasDelMes(mes))).padStart(2, "0")}`;
      /* Lo de hoy no: puede ya estar pagado y estar en el saldo. */
      if (dia <= hoy || dia > hasta || Math.abs(monto) < 0.01) continue;
      movimientos.push({ dia, tipo: "gasto", concepto: categoria, detalle: "como el mes pasado", monto: r2(-monto) });
    }
  }

  /* ---------- Sale: la publicidad, al ritmo de los últimos días ---------- */
  const desdePub = sumarDias(hoy, -DIAS_DE_PUBLICIDAD);
  const deMeta = (e.adInsights ?? []).filter((a) => a.dia >= desdePub && a.dia < hoy).reduce((a, x) => a + (x.inversion ?? 0), 0);
  const cargada = e.gastos.filter((g) => esPublicidad(g.categoria) && diaDeNegocio(fechaDePago(g)) >= desdePub && diaDeNegocio(fechaDePago(g)) < hoy).reduce((a, g) => a + g.monto, 0);
  const publicidadDiaria = r2((deMeta > 0 ? deMeta : cargada) / DIAS_DE_PUBLICIDAD);
  if (publicidadDiaria > 0) {
    for (let dia = sumarDias(hoy, 1); dia <= hasta; dia = sumarDias(dia, 1)) {
      movimientos.push({ dia, tipo: "publicidad", concepto: "Publicidad de Meta", detalle: `al ritmo de los últimos ${DIAS_DE_PUBLICIDAD} días`, monto: -publicidadDiaria });
    }
  }

  movimientos.sort((a, b) => a.dia.localeCompare(b.dia) || b.monto - a.monto);

  /* ---------- Día por día ---------- */
  const dias: DiaDelFlujo[] = [];
  let saldo = disponible;
  let minimo = { dia: hoy, saldo: disponible };
  let i = 0;
  for (let dia = hoy; dia <= hasta; dia = sumarDias(dia, 1)) {
    let entra = 0, sale = 0;
    while (i < movimientos.length && movimientos[i].dia === dia) {
      const m = movimientos[i++];
      if (m.monto >= 0) entra += m.monto; else sale -= m.monto;
    }
    saldo = r2(saldo + entra - sale);
    dias.push({ dia, entra: r2(entra), sale: r2(sale), saldo });
    if (saldo < minimo.saldo) minimo = { dia, saldo };
  }

  const semanas: SemanaDelFlujo[] = [];
  for (let k = 0; k < dias.length; k += 7) {
    const tramo = dias.slice(k, k + 7);
    semanas.push({
      desde: tramo[0].dia, hasta: tramo[tramo.length - 1].dia,
      entra: r2(tramo.reduce((a, d) => a + d.entra, 0)), sale: r2(tramo.reduce((a, d) => a + d.sale, 0)), saldo: tramo[tramo.length - 1].saldo,
    });
  }

  const entra = r2(dias.reduce((a, d) => a + d.entra, 0));
  const sale = r2(dias.reduce((a, d) => a + d.sale, 0));
  return {
    hoy, hasta, disponible, aparte, cuentasDisponibles, cuentasAparte, movimientos, dias, semanas, entra, sale,
    final: dias[dias.length - 1]?.saldo ?? disponible, minimo,
    supuestos: {
      comision, tasaDeCobro: tasa, ponderado: opciones.ponderar && tasa !== null,
      vencidas: { cuotas: vencidas, monto: r2(montoVencido) },
      publicidadDiaria, mesBase,
      salidasDelMesBase: [...porCategoria.values()].map((s) => ({ ...s, monto: r2(s.monto) })).sort((a, b) => b.monto - a.monto),
    },
  };
}
