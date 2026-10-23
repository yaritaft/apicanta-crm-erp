import type { EstadoApp, Gasto, ID } from "./types";
import { clasificarMercury } from "./mercury";
import { cuentaDeGasto } from "./traspasos";
import { diaDeNegocio } from "./dia-negocio";

/* ==================================================================
   Qué pasó de verdad en una cuenta (Mercury, Stripe) y cuánto de eso ya está en la app.

   Aldana (22/10): el saldo de Mercury «está bien» pero no encuentra dónde queda lo que consume Yari (un café, el teatro) ni el
   cashback, y Stripe «marca diferencia si sólo hubo un movimiento». La app sólo trae del banco lo que entra como cobro y los
   pases entre cuentas: lo que SALE (compras con tarjeta, comisiones, ajustes) y el cashback no se guardan en ningún lado, así
   que cuando el saldo real no da con el esperado no hay forma de ver por qué.

   Acá se juntan los movimientos reales de la cuenta (los trae el servidor) y se cruzan con lo que la app ya tiene: un cobro, un
   movimiento entre cuentas, un gasto que ya apunta a ese movimiento (`extra.bancoRef`) o uno que se le parece (mismo monto, la
   misma cuenta, días cerca). Lo que no está se puede cargar de una como gasto o como ingreso.

   Sin React ni red.
   ================================================================== */

export type TipoDelBanco =
  | "compra-tarjeta"      // una compra con tarjeta (Mercury): es un gasto
  | "pago-tarjeta"        // el pago de la tarjeta de crédito: no es un gasto, son las compras que ya se cargan una por una
  | "cashback"            // lo que devuelve la tarjeta
  | "cobro"               // plata que entra de un tercero (un cliente, una pasarela cobrando)
  | "pase"                // plata entre cuentas propias (un retiro de Stripe, un depósito de Whop)
  | "interno"             // entre cuentas del mismo banco, Treasury: ni ingreso ni gasto
  | "comision"            // lo que cobra la pasarela (Stripe)
  | "reembolso"           // plata devuelta a un cliente (Stripe) o a la empresa (una compra reembolsada)
  | "ajuste"              // un ajuste o una disputa
  | "salida"              // otra plata que sale (una transferencia, un cheque)
  | "entrada"             // otra plata que entra
  | "otro";

export const TEXTO_DEL_TIPO: Record<TipoDelBanco, string> = {
  "compra-tarjeta": "Compra con tarjeta", "pago-tarjeta": "Pago de la tarjeta", cashback: "Cashback", cobro: "Cobro", pase: "Entre cuentas",
  interno: "Entre cuentas del banco", comision: "Comisión", reembolso: "Reembolso", ajuste: "Ajuste", salida: "Salió plata", entrada: "Entró plata", otro: "Otro",
};

export interface MovimientoDelBanco {
  /* «mercury:<id>» o «stripe:<id>»: es lo que se guarda en el gasto (`extra.bancoRef`) para no mostrarlo dos veces. */
  ref: string;
  /* El id con el que aparece en la app: el cobro de Mercury (su referencia), el cargo de Stripe (ch_…), el retiro (po_…). */
  refApp: string[];
  cuentaId: ID;
  fecha: string;
  /* Dólares con signo: entra +, sale −. */
  monto: number;
  contraparte: string;
  detalle?: string;
  tipo: TipoDelBanco;
  /* El banco todavía no lo asentó. */
  pendiente?: boolean;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Un movimiento de Mercury (de una cuenta, de la tarjeta de crédito o de una subcuenta) como lo ve la pantalla. null si no es plata (anulado). */
export function movimientoDeMercury(t: Record<string, unknown>, cuentaId: ID, extras: readonly string[] = []): MovimientoDelBanco | null {
  const id = texto(t.id);
  const monto = Number(t.amount ?? 0);
  if (!id || !Number.isFinite(monto) || monto === 0) return null;
  const c = clasificarMercury(t, extras);
  if (c.tipo === "anulado") return null;
  const kind = texto(t.kind);
  const contraparte = texto(t.counterpartyName) || texto(t.counterpartyNickname);
  const descripcion = [texto(t.externalMemo), texto(t.bankDescription), texto(t.note)].filter(Boolean).join(" · ");
  const todo = `${kind} ${contraparte} ${descripcion}`;

  /* Una compra con tarjeta se reconoce por su tipo, no por lo que diga el comercio («Stripe Payments», «Cashback Bar»). */
  const esCompra = /cardtransaction/i.test(kind);
  let tipo: TipoDelBanco;
  if (esCompra) tipo = monto < 0 ? "compra-tarjeta" : "reembolso";
  /* Lo que sale hacia la tarjeta es el pago de la tarjeta (aunque se llame «Mercury IO Cashback Credit Card»); lo que entra de Mercury, cashback. */
  else if (/creditcardpayment|autopay/i.test(todo) || c.motivo === "Pago de la tarjeta de crédito" || (monto < 0 && /credit\s*card/i.test(todo))) tipo = "pago-tarjeta";
  else if (monto > 0 && (/cashback/i.test(todo) || /^mercury$/i.test(contraparte))) tipo = "cashback";
  else if (c.tipo === "pase") tipo = "pase";
  else if (c.tipo === "interno") tipo = "interno";
  else tipo = monto > 0 ? (c.tipo === "cobro" || c.tipo === "en-proceso" ? "cobro" : "entrada") : "salida";

  return {
    ref: `mercury:${id}`, refApp: [id], cuentaId, fecha: texto(t.postedAt) || texto(t.createdAt), monto: r2(monto),
    contraparte: contraparte || (tipo === "cashback" ? "Mercury" : ""), detalle: descripcion || undefined, tipo,
    ...(c.tipo === "en-proceso" ? { pendiente: true } : {}),
  };
}

/** Un movimiento de la cuenta de Stripe (balance transaction). El monto es el neto (lo que de verdad sube o baja el saldo). */
export function movimientoDeStripe(t: Record<string, unknown>, cuentaId: ID): MovimientoDelBanco | null {
  const id = texto(t.id);
  const neto = Number(t.net);
  const bruto = Number(t.amount);
  const monto = Number.isFinite(neto) ? neto : bruto;
  if (!id || !Number.isFinite(monto) || monto === 0) return null;
  const tipoCrudo = texto(t.type);
  const origen = texto(t.source);
  const descripcion = texto(t.description);
  let tipo: TipoDelBanco;
  if (/^(charge|payment)$/.test(tipoCrudo)) tipo = "cobro";
  else if (/refund/.test(tipoCrudo)) tipo = "reembolso";
  else if (/^payout/.test(tipoCrudo) || /withdrawal/i.test(descripcion)) tipo = "pase";
  else if (/fee/.test(tipoCrudo)) tipo = "comision";
  else if (/adjustment|dispute|chargeback|reserve/.test(tipoCrudo)) tipo = "ajuste";
  else tipo = monto > 0 ? "entrada" : "salida";
  const creado = Number(t.created);
  return {
    ref: `stripe:${id}`, refApp: [id, origen].filter(Boolean), cuentaId,
    fecha: Number.isFinite(creado) ? new Date(creado * 1000).toISOString() : "",
    monto: r2(monto / 100), contraparte: tipo === "cobro" ? "Cobro" : descripcion || tipoCrudo, detalle: descripcion || undefined, tipo,
    ...(texto(t.status) === "pending" ? { pendiente: true } : {}),
  };
}

/* ---------- Cruzar con lo que la app ya tiene ---------- */

export type EstadoEnLaApp = "cargado" | "parecido" | "no-se-carga" | "falta";

export interface MovimientoCruzado extends MovimientoDelBanco {
  estadoApp: EstadoEnLaApp;
  /* Dónde está, o por qué no se carga. */
  donde?: string;
  /* El gasto con el que se parece (para mirarlo). */
  gastoId?: ID;
}

const DIA = 86400000;
const DIAS_DE_MARGEN = 4;

const gastoApunta = (g: Gasto, ref: string) => g.extra?.bancoRef === ref;

/** Cada movimiento del banco con su estado en la app. */
export function cruzarConLaApp(
  e: Pick<EstadoApp, "movimientos" | "traspasos" | "gastos" | "devoluciones" | "procesadores">, movs: readonly MovimientoDelBanco[],
): MovimientoCruzado[] {
  const cobros = new Set((e.movimientos ?? []).map((m) => `${m.proveedor}:${m.referencia}`));
  const pases = new Set((e.traspasos ?? []).flatMap((t) => [t.salidaRef, t.llegadaRef]).filter((x): x is string => Boolean(x)));
  const devoluciones = new Set((e.devoluciones ?? []).map((d) => d.referencia).filter((x): x is string => Boolean(x)));
  const usados = new Set<ID>();

  return movs.map((m): MovimientoCruzado => {
    const proveedor = m.ref.split(":")[0];
    if (m.tipo === "pago-tarjeta") return { ...m, estadoApp: "no-se-carga", donde: "Es el pago de la tarjeta: lo que se gastó con la tarjeta se carga compra por compra, no acá." };
    if (m.tipo === "interno") return { ...m, estadoApp: "no-se-carga", donde: "Plata entre cuentas del mismo banco: no es ingreso ni gasto." };
    if (m.refApp.some((r) => cobros.has(`${proveedor}:${r}`))) return { ...m, estadoApp: "cargado", donde: "Está como cobro en Conciliación." };
    if (m.refApp.some((r) => pases.has(`${proveedor}:${r}`)) || pases.has(m.ref)) return { ...m, estadoApp: "cargado", donde: "Está como movimiento entre cuentas." };
    if (m.refApp.some((r) => devoluciones.has(`${proveedor}:${r}`))) return { ...m, estadoApp: "cargado", donde: "Está como reembolso." };
    const propio = (e.gastos ?? []).find((g) => gastoApunta(g, m.ref));
    if (propio) return { ...m, estadoApp: "cargado", donde: `Está como ${propio.monto < 0 ? "ingreso" : "gasto"}: ${propio.concepto}.`, gastoId: propio.id };
    /* Algo que alguien cargó a mano: el mismo monto, de esa cuenta, en esos días. Se ofrece mirarlo, no se da por hecho. */
    if (m.tipo !== "cobro" && m.tipo !== "pase") {
      const t = Date.parse(m.fecha);
      const parecido = (e.gastos ?? []).find((g) => {
        if (usados.has(g.id) || g.extra?.bancoRef) return false;
        if (cuentaDeGasto(g, e.procesadores) !== m.cuentaId) return false;
        if (Math.abs(Math.abs(g.monto) - Math.abs(m.monto)) > 0.01) return false;
        if ((g.monto < 0) !== (m.monto > 0)) return false;
        return Math.abs(Date.parse(g.fecha) - t) <= DIAS_DE_MARGEN * DIA;
      });
      if (parecido) { usados.add(parecido.id); return { ...m, estadoApp: "parecido", donde: `Parece ser «${parecido.concepto}» (${diaDeNegocio(parecido.fecha).slice(8, 10)}/${diaDeNegocio(parecido.fecha).slice(5, 7)}).`, gastoId: parecido.id }; }
    }
    return { ...m, estadoApp: "falta" };
  });
}

/** Lo que falta cargar: cuántos movimientos y cuánto sube o baja el saldo. Lo pendiente no cuenta (el banco todavía no lo asentó). */
export function resumenDeLoQueFalta(movs: readonly MovimientoCruzado[]): { n: number; sale: number; entra: number } {
  let n = 0, sale = 0, entra = 0;
  for (const m of movs) {
    if (m.estadoApp !== "falta" || m.pendiente) continue;
    n++;
    if (m.monto < 0) sale += -m.monto; else entra += m.monto;
  }
  return { n, sale: r2(sale), entra: r2(entra) };
}

/** Lo que se le pone al asistente de gastos para cargar este movimiento: el concepto, el monto, el día y la cuenta ya puestos. */
export function borradorDesdeElBanco(
  m: MovimientoDelBanco, nombreDeLaCuenta: string, comoIngreso: boolean,
): { concepto: string; monto: string; fecha: string; cuenta: string; ingreso: boolean; bancoRef: string; proveedor: string; notas: string } {
  const abs = Math.abs(m.monto);
  const concepto = m.tipo === "cashback" ? "Cashback Mercury" : m.contraparte || TEXTO_DEL_TIPO[m.tipo];
  return {
    concepto, monto: abs.toLocaleString("es-AR", { minimumFractionDigits: Number.isInteger(abs) ? 0 : 2, maximumFractionDigits: 2 }),
    fecha: m.fecha, cuenta: nombreDeLaCuenta, ingreso: comoIngreso, bancoRef: m.ref,
    proveedor: m.tipo === "cashback" ? "Mercury" : m.contraparte,
    notas: [`Del movimiento del banco del ${diaDeNegocio(m.fecha).slice(8, 10)}/${diaDeNegocio(m.fecha).slice(5, 7)}`, m.detalle].filter(Boolean).join(" · "),
  };
}
