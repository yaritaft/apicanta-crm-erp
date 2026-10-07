import type {
  BaseMedicion, DesgloseLinea, ID, ItemDesglose, ListaDesglose, Moneda, Pago, PasoDesglose, Venta,
} from "./types";
import { fechaLarga, money, num, pct } from "./format";

/* ==================================================================
   El desglose de un renglón de la liquidación: la cuenta con la que se
   llegó al monto, con los números del mes.

   No calcula nada por su cuenta. lib/honorarios.ts hace la cuenta de cada
   renglón y, con los MISMOS números que usó (lo cobrado, los procesadores,
   los tramos, los días), le pide acá que la deje escrita. Por eso el
   desglose no puede decir otra cosa que el monto que se ve.

   Una cuenta es una lista de pasos que se lee de arriba hacia abajo
   (PasoDesglose): arranca, suma, resta, multiplica o divide en tramos, y
   cada «igual» es un subtotal que lo anterior tiene que dar.
   `evaluarPasos` hace esa lectura: las pruebas la usan para comprobar que
   la cuenta cierra con el monto de cada renglón.

   Sin React y sin importar el motor (el motor es el que lo importa a este).
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;

/* Con centavos sólo si los tiene, como en toda la liquidación: "US$ 1.700",
   "US$ 3.456,78". */
const M = (n: number, moneda: Moneda) => money(n, moneda, Math.abs(n - Math.round(n)) < 0.005 ? 0 : 2);
const C = (n: number) => num(n, Number.isInteger(n) ? 0 : 2);
const mayus = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const cobros = (n: number) => `${C(n)} ${n === 1 ? "cobro" : "cobros"}`;
const devoluciones = (n: number) => `${C(n)} ${n === 1 ? "devolución" : "devoluciones"}`;
const ventasTxt = (n: number) => `${C(n)} ${n === 1 ? "venta" : "ventas"}`;

/* Un paso, con sólo los campos que dicen algo (el JSON de la foto del mes
   no lleva undefined ni NaN). */
export function paso(
  op: PasoDesglose["op"], texto: string, valor: number, formato: PasoDesglose["formato"],
  extra: { moneda?: Moneda; de?: number; nota?: string } = {},
): PasoDesglose {
  const p: PasoDesglose = { op, texto, valor: Number.isFinite(valor) ? valor : 0, formato };
  if (extra.moneda) p.moneda = extra.moneda;
  if (extra.de !== undefined) p.de = extra.de;
  if (extra.nota) p.nota = extra.nota;
  return p;
}

const plataPaso = (op: PasoDesglose["op"], texto: string, valor: number, moneda: Moneda, nota?: string) =>
  paso(op, texto, valor, "plata", { moneda, nota });

/* ---------- Leer una cuenta ---------- */

/** Hace la cuenta de arriba hacia abajo. `valor` es lo que queda al final y
 *  `fallas` dice en qué «igual» la cuenta no daba lo que el paso dice (con
 *  la tolerancia de un centavo redondeado). Una cuenta bien armada no tiene
 *  fallas. */
export function evaluarPasos(pasos: PasoDesglose[]): { valor: number; fallas: string[] } {
  let acc = 0;
  const fallas: string[] = [];
  pasos.forEach((p, i) => {
    switch (p.op) {
      case "base": acc = p.valor; break;
      case "mas": acc += p.valor; break;
      case "menos": acc -= p.valor; break;
      case "por": acc *= p.formato === "fraccion" ? p.valor / (p.de || 1) : p.valor; break;
      /* Igual que el motor: los tramos completos, con la misma holgura para los decimales. */
      case "tramos": acc = p.valor > 0 ? Math.floor(acc / p.valor + 1e-9) : 0; break;
      case "igual":
        if (Math.abs(acc - p.valor) > 0.005 + 1e-9) fallas.push(`Paso ${i + 1} («${p.texto}»): la cuenta da ${acc} y dice ${p.valor}.`);
        acc = p.valor;
        break;
    }
  });
  return { valor: acc, fallas };
}

/** El monto con el que cierra la cuenta (el último «igual»), o undefined si
 *  no hay ninguno. */
export function resultadoDelDesglose(d: Pick<DesgloseLinea, "pasos">): number | undefined {
  for (let i = d.pasos.length - 1; i >= 0; i--) if (d.pasos[i].op === "igual") return d.pasos[i].valor;
  return undefined;
}

/* ---------- Fijo, bono y pieza ---------- */

export interface ArgsFijo {
  regla: string;
  moneda: Moneda;
  mensual: number;
  /* Lo que dio la cuenta, a centavos. */
  monto: number;
  /* Si el fijo vale sólo una parte del mes: los días que le tocan. */
  prorrateo?: { dias: number; diasMes: number; desde: number; hasta: number; mes: string };
}

export function desgloseFijo(a: ArgsFijo): DesgloseLinea {
  const pasos = [plataPaso("base", "Monto por mes", a.mensual, a.moneda)];
  const avisos: string[] = [];
  if (a.prorrateo) {
    const q = a.prorrateo;
    pasos.push(paso("por", "Días del mes que le corresponden", q.dias, "fraccion", { de: q.diasMes, nota: `${q.dias} de ${q.diasMes} días` }));
    avisos.push(`Le corresponde del ${q.desde} al ${q.hasta} de ${q.mes}: el fijo se prorratea por días.`);
  }
  pasos.push(plataPaso("igual", "Monto del mes", a.monto, a.moneda));
  return { regla: a.regla, moneda: a.moneda, pasos, ...(avisos.length ? { avisos } : {}) };
}

export interface ArgsBono {
  regla: string;
  moneda: Moneda;
  /* Lo que vale el bono si se gana. */
  previsto: number;
  gano: boolean;
  condicion?: string;
  monto: number;
}

export function desgloseBono(a: ArgsBono): DesgloseLinea {
  const pasos = [plataPaso("base", "Bono", a.previsto, a.moneda)];
  if (!a.gano) pasos.push(paso("por", "No lo ganó este mes", 0, "cantidad"));
  pasos.push(plataPaso("igual", "Monto del mes", a.monto, a.moneda));
  const avisos = [
    a.gano ? "El bono viene como ganado: si no lo ganó, se apaga en la liquidación." : "Se apagó en la liquidación: este mes no lo ganó.",
    ...(a.condicion?.trim() ? [`Para ganarlo: ${a.condicion.trim()}.`] : []),
  ];
  return { regla: a.regla, moneda: a.moneda, pasos, avisos };
}

export interface ArgsPieza {
  regla: string;
  moneda: Moneda;
  tarifa: number;
  unidad: string;
  /* Cuántas se cargaron; sin cargar todavía, undefined. */
  cantidad?: number;
  monto: number;
}

export function desglosePieza(a: ArgsPieza): DesgloseLinea {
  const pasos: PasoDesglose[] = [];
  const avisos: string[] = [];
  if (a.cantidad === undefined) {
    pasos.push(paso("base", `Cuántas: ${a.unidad}`, 0, "cantidad", { nota: "Todavía no se cargó" }));
    avisos.push("Falta cargar cuántas: hasta entonces el renglón va en cero.");
  } else {
    pasos.push(paso("base", `Cuántas: ${a.unidad}`, a.cantidad, "cantidad", { nota: "Se carga a mano al liquidar" }));
  }
  pasos.push(plataPaso("por", `Tarifa por ${a.unidad}`, a.tarifa, a.moneda));
  pasos.push(plataPaso("igual", "Monto del mes", a.monto, a.moneda));
  return { regla: a.regla, moneda: a.moneda, pasos, ...(avisos.length ? { avisos } : {}) };
}

/* ---------- Las listas cortas: los cobros o las ventas que entraron ---------- */

/** Cuántos van en la lista; los demás se resumen en una línea. */
export const LIMITE_LISTA = 10;

export interface CobroContado { pago: Pago; venta?: Venta }

export interface NombresDeLista {
  servicio: (id?: ID) => string | undefined;
  procesador: (id?: ID) => string | undefined;
}

const sinVacios = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "")) as T;

const t = (iso: string) => { const n = Date.parse(iso); return Number.isFinite(n) ? n : 0; };

/** Los cobros que entraron en lo medido: los LIMITE_LISTA más grandes, por
 *  fecha, y una línea con los que quedaron afuera. */
export function listaDeCobros(lista: CobroContado[], nombres: NombresDeLista, moneda: Moneda): ListaDesglose | undefined {
  if (lista.length === 0) return undefined;
  const porTamano = [...lista].sort((a, b) => b.pago.monto - a.pago.monto || t(a.pago.fecha) - t(b.pago.fecha));
  const quedan = porTamano.slice(0, LIMITE_LISTA).sort((a, b) => t(a.pago.fecha) - t(b.pago.fecha));
  const resto = porTamano.slice(LIMITE_LISTA);
  const items: ItemDesglose[] = quedan.map(({ pago: p, venta: v }) => sinVacios({
    fecha: p.fecha,
    cliente: v?.contactoNombre?.trim() || "Cobro sin venta",
    servicio: nombres.servicio(v?.productoId),
    procesador: nombres.procesador(p.procesadorId),
    monto: r2(p.monto), fee: r2(p.feeMonto), neto: r2(p.monto - p.feeMonto),
  }));
  return {
    tipo: "cobros", titulo: lista.length > LIMITE_LISTA ? `Los ${LIMITE_LISTA} cobros más grandes` : "Los cobros",
    moneda, total: lista.length, items,
    ...(resto.length ? {
      resto: {
        cantidad: resto.length,
        monto: r2(resto.reduce((a, x) => a + x.pago.monto, 0)),
        fee: r2(resto.reduce((a, x) => a + x.pago.feeMonto, 0)),
        neto: r2(resto.reduce((a, x) => a + (x.pago.monto - x.pago.feeMonto), 0)),
      },
    } : {}),
  };
}

/** Las ventas que entraron en lo medido (facturado, ventas cerradas). */
export function listaDeVentas(ventas: Venta[], nombres: Pick<NombresDeLista, "servicio">, moneda: Moneda): ListaDesglose | undefined {
  if (ventas.length === 0) return undefined;
  const porTamano = [...ventas].sort((a, b) => b.precioAcordado - a.precioAcordado || t(a.fecha) - t(b.fecha));
  const quedan = porTamano.slice(0, LIMITE_LISTA).sort((a, b) => t(a.fecha) - t(b.fecha));
  const resto = porTamano.slice(LIMITE_LISTA);
  return {
    tipo: "ventas", titulo: ventas.length > LIMITE_LISTA ? `Las ${LIMITE_LISTA} ventas más grandes` : "Las ventas",
    moneda, total: ventas.length,
    items: quedan.map((v) => sinVacios({
      fecha: v.fecha, cliente: v.contactoNombre?.trim() || "Venta sin nombre",
      servicio: nombres.servicio(v.productoId), monto: r2(v.precioAcordado),
    })),
    ...(resto.length ? { resto: { cantidad: resto.length, monto: r2(resto.reduce((a, v) => a + v.precioAcordado, 0)) } } : {}),
  };
}

/* ---------- Porcentaje y tramo: lo medido, y qué se hace con eso ---------- */

/* El profit del mes armado con lo mismo que usa el motor: el resultado
   operativo de Finanzas, sin lo que ya cargó esta liquidación, menos lo que
   esta liquidación va a cargar. Todo en la moneda base. */
export interface PartesProfit {
  /* Lo que entró en el mes (los cobros), antes de lo devuelto. */
  cash: number;
  /* Lo que se devolvió a clientes en el mes: resta del cash collected. */
  devoluciones?: number;
  procesadores: number;
  /* Las comisiones de closers y del director: Finanzas las calcula de las ventas. */
  comisiones: number;
  otrosDirectos: number;
  gastosOperativos: number;
  /* Lo que esta misma liquidación carga como sueldos y honorarios. */
  sueldos: number;
}

export type Fuente =
  /* La cantidad se cargó a mano en la liquidación. */
  | { tipo: "mano" }
  /* Nada que medir y nada cargado: el renglón queda en cero. */
  | { tipo: "falta" }
  | { tipo: "profit"; profit: number; parte: number; partes?: PartesProfit }
  | {
    tipo: "medido"; bruto?: number; cuantos: number; lista?: ListaDesglose;
    /* Lo devuelto en el mes que resta de lo medido, y cuántas devoluciones son. */
    devoluciones?: number; nDev?: number;
    /* Lo que da la cuenta antes de no pasar de cero (con más devoluciones que cobros). */
    crudo?: number;
  };

export interface ArgsMedido {
  regla: string;
  tipo: "porcentaje" | "tramo";
  base: BaseMedicion;
  /* Lo medido es plata (y no una cantidad). */
  plataBase: boolean;
  /* La moneda del negocio, en la que se mide la plata. */
  monedaBase: Moneda;
  /* La moneda en la que se paga el renglón. */
  moneda: Moneda;
  fuente: Fuente;
  /* Lo medido, a centavos: el número con el que se hizo la cuenta. */
  valor: number;
  tasa?: number;
  /* Tramo: cada cuánto, cuántos completos y cuánto por cada uno. */
  cada?: number;
  veces?: number;
  montoPorTramo?: number;
  /* Lo que dio la cuenta, a centavos. */
  monto: number;
  unidad?: string;
  utm?: string;
  /* Si la regla vale sólo parte del mes: los días que se miden. */
  vigencia?: { desde: number; hasta: number; mes: string };
}

const NOMBRE_BASE: Record<BaseMedicion, string> = {
  "cash": "cash collected", "cash-neto": "cash collected post pasarelas", "facturado": "facturado",
  "profit": "profit del mes", "ventas": "ventas cerradas", "llamadas": "llamadas agendadas",
  "llamadas-hechas": "llamadas hechas", "manual": "cantidad",
};

/* Qué se cuenta: "cash collected post pasarelas", "llamadas agendadas", o la
   pieza que se carga a mano ("clases dadas"). */
const queSeCuenta = (a: Pick<ArgsMedido, "base" | "unidad">) =>
  a.base === "manual" ? (a.unidad?.trim() || NOMBRE_BASE.manual) : NOMBRE_BASE[a.base];

/** El profit, de cobrado a lo que le cuenta a quien lo cobra. Termina en un «igual». */
function pasosDeProfit(f: Extract<Fuente, { tipo: "profit" }>, valor: number, B: Moneda): { pasos: PasoDesglose[]; avisos: string[] } {
  const pasos: PasoDesglose[] = [];
  const avisos: string[] = [];
  const p = f.partes;
  if (p) {
    const dev = p.devoluciones ?? 0;
    pasos.push(plataPaso("base", "Cobrado en el mes (cash collected)", p.cash, B));
    if (dev > 0) pasos.push(plataPaso("menos", "Devoluciones del mes", dev, B, "La plata que se devolvió a clientes"));
    pasos.push(plataPaso("menos", "Lo que se quedaron los procesadores de pago", p.procesadores, B));
    pasos.push(plataPaso("menos", "Comisiones de closers y del director", p.comisiones, B, "Finanzas las calcula de las ventas"));
    pasos.push(plataPaso("menos", "Otros costos directos", p.otrosDirectos, B));
    pasos.push(plataPaso("menos", "Gastos operativos", p.gastosOperativos, B));
    pasos.push(plataPaso("menos", "Sueldos y honorarios de esta liquidación", p.sueldos, B, "Los que entran a Finanzas al cerrar"));
    /* Cada parte va a centavos y el profit se redondea una sola vez: si por
       eso difieren un centavo, se dice. */
    const suma = r2(p.cash - dev - p.procesadores - p.comisiones - p.otrosDirectos - p.gastosOperativos - p.sueldos);
    const ajuste = r2(f.profit - suma);
    if (Math.abs(ajuste) >= 0.005) pasos.push(plataPaso(ajuste > 0 ? "mas" : "menos", "Ajuste de centavos por redondeo", Math.abs(ajuste), B));
    pasos.push(plataPaso("igual", "Profit del mes", f.profit, B));
  } else {
    pasos.push(plataPaso("base", "Profit del mes", f.profit, B));
  }
  if (f.profit <= 0) {
    pasos.push(paso("por", "Con pérdida no hay profit para repartir", 0, "cantidad"));
    pasos.push(plataPaso("igual", "Profit que se reparte", 0, B));
    avisos.push("El mes dio pérdida: no hay profit para repartir.");
  } else if (f.parte < 1) {
    const afuera = r2(f.profit - valor);
    const excluida = (1 - f.parte) * 100;
    pasos.push(plataPaso(
      "menos", "Lo que corresponde a ventas excluidas de marketing", afuera, B,
      `Son el ${pct(excluida, Number.isInteger(r2(excluida)) ? 0 : 1)} de lo facturado del mes`,
    ));
    pasos.push(plataPaso("igual", "Profit que le cuenta", valor, B));
    avisos.push("A esta regla no le cuentan las ventas marcadas «Excluida de marketing»: se saca su parte del profit, medida sobre lo facturado.");
  }
  avisos.push("El profit sale de lo que está cargado en Finanzas y con los sueldos de esta misma liquidación adentro: un gasto que falte cargar lo infla.");
  return { pasos, avisos };
}

/** Lo medido, de lo que entró a un número. Termina en el valor con el que se hizo la cuenta. */
function pasosDeLoMedido(a: ArgsMedido, f: Extract<Fuente, { tipo: "medido" }>): PasoDesglose[] {
  const B = a.monedaBase;
  const utm = a.utm?.trim() ? ` con utm_source ${a.utm.trim()}` : "";
  const dev = f.devoluciones ?? 0;
  /* Con devoluciones, lo medido es lo que entró menos lo que se devolvió; si
     se devolvió más de lo que entró, no hay base (no se paga sobre un mes en
     negativo). Sin devoluciones, las cuentas son las de siempre. */
  const devolucionesYPiso = (crudo: number): PasoDesglose[] => (crudo < -0.004
    ? [paso("por", "Con más devoluciones que cobros no hay base para pagar", 0, "cantidad"), plataPaso("igual", "Lo que se mide", a.valor, B)]
    : []);
  switch (a.base) {
    case "cash-neto": {
      const bruto = f.bruto ?? a.valor;
      const crudo = f.crudo ?? a.valor;
      return [
        plataPaso("base", "Cobrado en el mes", bruto, B, cobros(f.cuantos)),
        ...(dev > 0 ? [plataPaso("menos", "Devoluciones del mes", dev, B, devoluciones(f.nDev ?? 0))] : []),
        plataPaso("menos", "Lo que se quedaron los procesadores de pago", r2(bruto - dev - crudo), B),
        plataPaso("igual", "Cash collected post pasarelas", crudo, B),
        ...devolucionesYPiso(crudo),
      ];
    }
    case "cash": {
      if (dev <= 0) return [plataPaso("base", "Cash collected del mes", a.valor, B, cobros(f.cuantos))];
      const crudo = f.crudo ?? a.valor;
      return [
        plataPaso("base", "Cobrado en el mes", f.bruto ?? a.valor, B, cobros(f.cuantos)),
        plataPaso("menos", "Devoluciones del mes", dev, B, devoluciones(f.nDev ?? 0)),
        plataPaso("igual", "Cash collected del mes", crudo, B),
        ...devolucionesYPiso(crudo),
      ];
    }
    case "facturado": return [plataPaso("base", "Facturado: el valor de las ventas cerradas en el mes", a.valor, B, ventasTxt(f.cuantos))];
    case "ventas": return [paso("base", "Ventas cerradas en el mes", a.valor, "cantidad")];
    case "llamadas": return [paso("base", `Llamadas agendadas en el mes${utm}`, a.valor, "cantidad", { nota: "Según la Agenda, sin las canceladas" })];
    case "llamadas-hechas": return [paso("base", `Llamadas hechas en el mes${utm}`, a.valor, "cantidad", { nota: "Según la Agenda" })];
    default: return [paso("base", mayus(queSeCuenta(a)), a.valor, "cantidad")];
  }
}

export function desgloseMedido(a: ArgsMedido): DesgloseLinea {
  const B = a.monedaBase;
  const avisos: string[] = [];
  let pasos: PasoDesglose[] = [];
  const f = a.fuente;
  const formatoBase: PasoDesglose["formato"] = a.plataBase ? "plata" : "cantidad";
  const monedaDeBase = a.plataBase ? B : undefined;

  if (f.tipo === "mano") {
    pasos = [paso("base", `${mayus(queSeCuenta(a))}: cargado a mano`, a.valor, formatoBase, { moneda: monedaDeBase })];
    avisos.push("Esta cantidad se cargó a mano en la liquidación: no es lo que mide la app.");
  } else if (f.tipo === "falta") {
    pasos = [paso("base", mayus(queSeCuenta(a)), 0, "cantidad", { nota: "Todavía no se cargó" })];
    avisos.push("Falta cargar la cantidad: hasta entonces el renglón va en cero.");
  } else if (f.tipo === "profit") {
    const r = pasosDeProfit(f, a.valor, B);
    pasos = r.pasos;
    avisos.push(...r.avisos);
  } else {
    pasos = pasosDeLoMedido(a, f);
    if ((f.devoluciones ?? 0) > 0) avisos.push("Lo que se devolvió a clientes en el mes resta de lo que se mide, igual que en el Cash Collected de Finanzas (la comisión de la pasarela no se devuelve).");
    if (a.vigencia) avisos.push(`Se mide del ${a.vigencia.desde} al ${a.vigencia.hasta} de ${a.vigencia.mes}: la regla vale sólo esos días.`);
  }

  if (a.tipo === "porcentaje") {
    pasos.push(paso("por", "Porcentaje", a.tasa ?? 0, "tasa"));
  } else {
    const cada = a.cada ?? 0;
    const veces = a.veces ?? 0;
    pasos.push(paso("tramos", "Se divide en tramos de", cada, formatoBase, {
      moneda: monedaDeBase, nota: a.plataBase ? undefined : queSeCuenta(a),
    }));
    const sobra = r2(a.valor - veces * cada);
    pasos.push(paso("igual", "Tramos completos", veces, "cantidad", {
      nota: sobra > 0.004 ? `Sobran ${a.plataBase ? M(sobra, B) : C(sobra)}: un tramo incompleto no paga` : undefined,
    }));
    pasos.push(plataPaso("por", "Monto por cada tramo", a.montoPorTramo ?? 0, a.moneda));
  }
  pasos.push(plataPaso("igual", "Monto del mes", a.monto, a.moneda));

  return {
    regla: a.regla, moneda: a.moneda, pasos,
    ...(f.tipo === "medido" && f.lista ? { lista: f.lista } : {}),
    ...(avisos.length ? { avisos } : {}),
  };
}

/* ---------- Devoluciones: lo que se revierte y la deuda que queda ---------- */

export interface ArgsReversa {
  regla: string;
  /* La moneda del negocio, en la que se mide la plata. */
  moneda: Moneda;
  tasa: number;
  /* Lo cobrado de esa venta hasta el día de la devolución (lo que le comisionó
     a esta persona), lo que se quedaron los procesadores y lo que quedó. */
  cobrado: number;
  fees: number;
  neto: number;
  /* Cuántos cobros son. */
  cuantos: number;
  /* Lo que se le calculó por esos cobros, lo que ya se le había revertido con
     devoluciones anteriores y lo que quedaba por revertir. */
  comision: number;
  yaRevertido: number;
  quedaba: number;
  /* Qué parte de lo cobrado se devolvió: «devuelto» de «deCuanto». */
  devuelto: number;
  deCuanto: number;
  /* Lo que se revierte, a centavos (positivo). */
  reversa: number;
  /* Los cobros que formaron lo comisionado. */
  lista?: ListaDesglose;
  fecha: string;
  heredadaDe?: string;
}

/** La cuenta de una línea «Devolución de …»: lo que se le comisionó por lo
 *  cobrado de esa venta, y la parte que se devolvió. El renglón es lo que se
 *  descuenta, en negativo. Se arma con los mismos números con los que
 *  Finanzas revierte la comisión (lib/devoluciones.ts). */
export function desgloseReversa(a: ArgsReversa): DesgloseLinea {
  const B = a.moneda;
  const pasos: PasoDesglose[] = [
    plataPaso("base", "Cobrado de esta venta hasta la devolución", a.cobrado, B, cobros(a.cuantos)),
    plataPaso("menos", "Lo que se quedaron los procesadores de pago", a.fees, B),
    plataPaso("igual", "Cash collected post pasarelas de esta venta", a.neto, B),
    paso("por", "Porcentaje de la comisión", a.tasa, "tasa"),
    plataPaso("igual", "Comisión que se le calculó por esos cobros", a.comision, B),
  ];
  if (a.yaRevertido > 0) {
    pasos.push(plataPaso("menos", "Ya revertido con devoluciones anteriores de esta venta", a.yaRevertido, B));
    pasos.push(plataPaso("igual", "Comisión que quedaba por revertir", a.quedaba, B));
  }
  pasos.push(paso("por", "Parte de lo cobrado que se devolvió", a.devuelto, "fraccion", { de: a.deCuanto, nota: `${M(a.devuelto, B)} de ${M(a.deCuanto, B)}` }));
  pasos.push(plataPaso("igual", "Comisión que se revierte", a.reversa, B));
  pasos.push(paso("por", "Se descuenta de esta liquidación", -1, "cantidad"));
  pasos.push(plataPaso("igual", "Monto del mes", -a.reversa, B));

  const avisos = [
    "Se revierte lo que se le comisionó (sobre lo cobrado menos lo que se quedó el procesador), no el porcentaje de lo devuelto: eso daría un poco más.",
    ...(a.devuelto < a.deCuanto - 0.004 ? [`Se devolvió una parte (${M(a.devuelto, B)} de ${M(a.deCuanto, B)}): se revierte esa parte de lo comisionado.`] : []),
    ...(a.heredadaDe ? [`Son cuotas de una venta de ${a.heredadaDe} que le pasaron: comisionaron para esta persona.`] : []),
    `La devolución se hizo el ${fechaLarga(a.fecha)}. La comisión que se quedó la pasarela no se devuelve: sigue en Finanzas.`,
  ];
  return { regla: a.regla, moneda: B, pasos, ...(a.lista ? { lista: a.lista } : {}), avisos };
}

/** Lo que quedó debiendo de la liquidación anterior, que se descuenta de ésta. */
export function desgloseDeudaQueEntra(a: { regla: string; moneda: Moneda; deuda: number; mesAnterior: string }): DesgloseLinea {
  return {
    regla: a.regla, moneda: a.moneda,
    pasos: [
      plataPaso("base", `Lo que quedó debiendo de ${a.mesAnterior}`, a.deuda, a.moneda),
      paso("por", "Se descuenta de este mes", -1, "cantidad"),
      plataPaso("igual", "Monto del mes", -a.deuda, a.moneda),
    ],
    avisos: [`Quedó debiendo porque las devoluciones que se le descontaron en ${a.mesAnterior} fueron más que lo que cobraba ese mes. Si no corresponde, se puede corregir el monto a mano.`],
  };
}

/** El mes da en negativo: no se le paga nada y lo que queda debiendo pasa al mes siguiente. */
export function desgloseDeudaQueSale(a: { regla: string; moneda: Moneda; suma: number; deuda: number; mesSiguiente: string }): DesgloseLinea {
  return {
    regla: a.regla, moneda: a.moneda,
    pasos: [
      plataPaso("base", "Lo que da la suma de sus renglones de este mes", a.suma, a.moneda, "Da en negativo"),
      paso("por", "Pasa al mes siguiente", -1, "cantidad"),
      plataPaso("igual", "Queda debiendo", a.deuda, a.moneda),
    ],
    avisos: [`No se le paga nada este mes. Lo que queda debiendo se descuenta de la liquidación de ${a.mesSiguiente}, cuando se abra: ahí va a aparecer como un renglón en negativo.`],
  };
}

/** El mismo desglose, dicho como corregido a mano: la cuenta daba lo que
 *  dice y el renglón se paga con el monto corregido. La última fila deja de
 *  llamarse «Monto del mes»: es lo que da la cuenta, no lo que se paga. */
export function conCorreccion(d: DesgloseLinea, cuentaDaba: number, nota?: string): DesgloseLinea {
  const ultimo = d.pasos.length - 1;
  const pasos = d.pasos.map((p, i) => (i === ultimo && p.op === "igual" ? { ...p, texto: "Lo que da la cuenta" } : p));
  return { ...d, pasos, correccion: { cuentaDaba, ...(nota?.trim() ? { nota: nota.trim() } : {}) } };
}
