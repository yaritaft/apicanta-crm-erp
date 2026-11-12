import type { EstadoApp, Gasto, ID, Liquidacion, PersonaLiquidada, Procesador } from "./types";
import { esDeLaLiquidacion } from "./caja";
import { aMonedaBase, categoriaDe, fechaDePago } from "./gastos";
import { coincideConNombre, NUNCA } from "./pagos-equipo";
import { cuentaDeGasto } from "./traspasos";
import { nombrePeriodo } from "./periodos";

/* ==================================================================
   Marcar un pago de la liquidación = registrar de qué cuenta salió la plata.

   Aldana (11/11): «marqué como pagos los que están pagos, pero hay un caso excepcional que no se paga por Mercury, que es Daniel, el setter,
   que se paga a través de Binance. No me apareció ningún descuento… no sé cómo se hace para que eso quede registrado. Yo no pasé esos gastos
   porque entiendo que ya quedaron pasados en el cierre del mes pasado, y si lo volvía a pasar iba a quedar duplicado».

   Tenía razón en las dos cosas: «Marcar como pagado» era sólo una marca en la liquidación —no movía la caja—, y el pago real (la transferencia
   desde Mercury, o desde Binance) es otro gasto. Cargado como un gasto más, el sueldo contaba dos veces como costo; marcado como «pago al
   equipo» (`extra.pagoDeEquipo`) resta de la caja y no suma al costo. Ahora el pago se registra desde la liquidación: se dice de qué cuenta
   salió, se enlazan los gastos que ya estaban (los que trajo el banco) y lo que falta se crea ya marcado. Nada cuenta dos veces.

   Sin React ni red.
   ================================================================== */

const r2 = (n: number) => Math.round(n * 100) / 100;
const DIA = 86400000;

/* De dónde sale casi todo (la cuenta de los pagos), cuando no hay otra pista. */
export const CUENTA_DE_PAGOS = "proc_mercury";

export interface PagoCandidato {
  gasto: Gasto;
  /* Cómo se reconoce: lo dice el gasto (`proveedorEquipoId`), el nombre está en el texto, o el monto es justo lo que se le liquida. */
  motivo: "id" | "nombre" | "monto";
  /* Ya estaba marcado como pago al equipo (por ejemplo, el pago a cuenta del 26/10). */
  yaMarcado: boolean;
}

/** Los gastos que ya están enlazados a algún pago de alguna liquidación: no se ofrecen para otro. */
export function gastosEnlazados(e: Pick<EstadoApp, "liquidaciones">, salvoLiquidacion?: ID, salvoMiembro?: ID): Set<ID> {
  const out = new Set<ID>();
  for (const l of e.liquidaciones) {
    for (const [miembroId, p] of Object.entries(l.pagos ?? {})) {
      if (l.id === salvoLiquidacion && miembroId === salvoMiembro) continue;
      for (const id of p.gastoIds ?? []) out.add(id);
    }
  }
  return out;
}

/** El día desde el que se buscan pagos de esta liquidación: el 20 del mes (los pagos a cuenta de fin de mes y los de principios del que sigue). */
export const desdeDeLosPagos = (periodo: string): number => Date.parse(`${periodo}-20T03:00:00.000Z`);

/** Los gastos ya cargados que parecen un pago de esta persona por esta liquidación (los más viejos primero). */
export function candidatosDePago(e: Pick<EstadoApp, "gastos" | "liquidaciones">, liq: Pick<Liquidacion, "id" | "periodo">, persona: Pick<PersonaLiquidada, "miembroId" | "nombre" | "total">): PagoCandidato[] {
  const desde = desdeDeLosPagos(liq.periodo);
  const enlazados = gastosEnlazados(e, liq.id, persona.miembroId);
  const out: PagoCandidato[] = [];
  for (const g of e.gastos) {
    if (esDeLaLiquidacion(g) || g.extra?.traspasoId || g.grupo === "dueno" || g.grupo === "retiro" || NUNCA.has(g.categoria) || enlazados.has(g.id)) continue;
    if (Date.parse(fechaDePago(g)) < desde) continue;
    const texto = `${g.proveedor ?? ""} ${g.concepto}`;
    const motivo: PagoCandidato["motivo"] | null = g.extra?.proveedorEquipoId === persona.miembroId ? "id"
      : coincideConNombre(texto, persona.nombre) ? "nombre"
        : g.monto >= 50 && persona.total > 0 && Math.abs(g.monto - persona.total) <= 0.05 ? "monto" : null;
    if (motivo) out.push({ gasto: g, motivo, yaMarcado: g.extra?.pagoDeEquipo === true });
  }
  return out.sort((a, b) => Date.parse(fechaDePago(a.gasto)) - Date.parse(fechaDePago(b.gasto)));
}

/** De los candidatos, los que probablemente son el pago: en orden, mientras no pasen de lo que se le liquida (dos pagos, uno a cuenta y el resto). */
export function candidatosElegidos(candidatos: readonly PagoCandidato[], total: number): ID[] {
  const out: ID[] = [];
  let suma = 0;
  for (const c of candidatos) {
    if (suma + c.gasto.monto > total + 0.5) continue;
    out.push(c.gasto.id);
    suma += c.gasto.monto;
  }
  return out;
}

/** De qué cuenta se le suele pagar: la del último pago registrado, la de los gastos que se enlazan, y si no hay nada, la cuenta de los pagos. */
export function cuentaSugerida(
  e: Pick<EstadoApp, "liquidaciones" | "gastos" | "procesadores">, miembroId: ID, elegidos: readonly Gasto[] = [],
): ID {
  const activas = new Set(e.procesadores.filter((p) => p.activo).map((p) => p.id));
  const ultima = [...e.liquidaciones].sort((a, b) => b.periodo.localeCompare(a.periodo)).map((l) => l.pagos?.[miembroId]?.cuentaId).find((c) => c && activas.has(c));
  if (ultima) return ultima;
  for (const g of elegidos) {
    const c = cuentaDeGasto(g, e.procesadores);
    if (c && activas.has(c)) return c;
  }
  return activas.has(CUENTA_DE_PAGOS) ? CUENTA_DE_PAGOS : e.procesadores.find((p) => p.activo)?.id ?? CUENTA_DE_PAGOS;
}

/** Las personas de la liquidación cerrada que figuran pagadas pero la caja no sabe de dónde salió su plata (o salió menos de lo que cobraban). */
export function pagosSinRegistrar(e: Pick<EstadoApp, "gastos">, liq: Liquidacion): PersonaLiquidada[] {
  if (liq.estado !== "cerrada" || !liq.resultado) return [];
  return liq.resultado.personas.filter((p) => {
    const pago = liq.pagos?.[p.miembroId];
    if (!pago || !(p.total > 0)) return false;
    const ids = new Set(pago.gastoIds ?? []);
    const registrado = r2(e.gastos.filter((g) => ids.has(g.id)).reduce((a, g) => a + g.monto, 0));
    return registrado < p.total - 0.5;
  });
}

/** Lo que ya está registrado para esta persona en esta liquidación (en la moneda base). */
export function totalRegistrado(e: Pick<EstadoApp, "gastos">, pago: { gastoIds?: ID[] } | undefined): number {
  const ids = new Set(pago?.gastoIds ?? []);
  return r2(e.gastos.filter((g) => ids.has(g.id)).reduce((a, g) => a + g.monto, 0));
}

export interface PagoARegistrar {
  miembroId: ID;
  /* aaaa-mm-dd: el día que salió la plata. */
  dia: string;
  /* Las cuentas en las que se pueden pagar los gastos: de cuál salió. */
  cuentaId: ID;
  /* Los gastos que ya estaban cargados y son este pago. */
  elegidos: ID[];
  /* Lo que falta registrar, en la moneda base: se crea un gasto por eso (0: nada). */
  monto: number;
}

/** El gasto que registra lo que falta pagarle: ya marcado como pago al equipo (resta de la caja, no suma al costo) y con la cuenta de la que salió. */
export function gastoDelPago(
  e: EstadoApp,
  liq: Pick<Liquidacion, "id" | "periodo" | "tipoCambio">, persona: Pick<PersonaLiquidada, "miembroId" | "nombre" | "categoriaGasto">,
  p: Pick<PagoARegistrar, "dia" | "cuentaId" | "monto">, id: ID, ahoraIso: string,
): Gasto {
  const base = e.ajustes.monedaBase;
  const cuenta: Procesador | undefined = e.procesadores.find((x) => x.id === p.cuentaId);
  const enPesos = (cuenta?.moneda ?? base) !== base;
  const tc = liq.tipoCambio && liq.tipoCambio > 0 ? liq.tipoCambio : e.ajustes.tipoCambio;
  const fecha = new Date(`${p.dia}T15:00:00.000Z`).toISOString();
  const monto = r2(p.monto);
  return {
    id,
    categoria: persona.categoriaGasto,
    grupo: categoriaDe(e, persona.categoriaGasto)?.grupo ?? "operativo",
    concepto: `Pago de ${nombrePeriodo(liq.periodo)} a ${persona.nombre}`,
    monto, moneda: base, fecha, recurrente: false, proveedor: persona.nombre,
    notas: "Lo registró la liquidación al marcar el pago: sale de la caja, no suma otra vez como costo.",
    creadoEn: ahoraIso,
    extra: {
      pagoDeEquipo: true, cuentaId: p.cuentaId, cuenta: cuenta?.nombre, proveedorEquipoId: persona.miembroId, pagoDeLiquidacion: liq.id,
      /* Una cuenta en pesos recibe los pesos: el monto se guarda también como salió de la cuenta. */
      ...(enPesos && tc > 0 ? { montoOriginal: r2(aMonedaBase(monto, base, cuenta!.moneda ?? "ARS", tc)), monedaOriginal: cuenta!.moneda ?? "ARS", tipoCambio: tc } : {}),
    },
  };
}

/** Lo que cambia al desmarcar un pago registrado: los gastos que creó el registro se van y los que sólo marcó vuelven a como estaban. */
export function alDesmarcar(pago: { creados?: ID[]; marcados?: ID[] } | undefined): { borrar: ID[]; desmarcar: ID[] } {
  return { borrar: [...(pago?.creados ?? [])], desmarcar: [...(pago?.marcados ?? [])] };
}
