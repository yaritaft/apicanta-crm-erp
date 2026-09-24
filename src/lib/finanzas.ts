import type { EstadoApp, Gasto, Venta } from "./types";
import type { RangoMes } from "./metricas";

/* ==================================================================
   El P&L de Yari, calculado igual que en su planilla.

   Dos columnas siempre: Revenue (lo facturado) y Cash Collected (lo
   que realmente entró). Casi todo el negocio se lee comparando esas
   dos cifras, porque las ventas se cobran en cuotas.
   ================================================================== */

const enRango = (iso: string, m: RangoMes) => {
  const d = new Date(iso).getTime();
  return d >= m.desde.getTime() && d <= m.hasta.getTime();
};

/* ---------- Bloques base ---------- */

export function ventasDelMes(e: EstadoApp, m: RangoMes): Venta[] {
  return e.ventas.filter((v) => v.estado !== "cancelada" && enRango(v.fecha, m));
}

/** Lo facturado: el precio acordado de las ventas cerradas en el mes. */
export function revenue(e: EstadoApp, m: RangoMes): number {
  return ventasDelMes(e, m).reduce((a, v) => a + v.precioAcordado, 0);
}

/** Los pagos que entraron en el mes. Lo usan el total y el desglose del
 *  Panel: los dos salen de la misma lista, así el panel lateral no puede
 *  sumar distinto que la tarjeta. */
export function pagosDelMes(e: EstadoApp, m: RangoMes) {
  return e.pagos.filter((p) => enRango(p.fecha, m));
}

/** Lo cobrado: los pagos que entraron en el mes, sin importar cuándo se vendió. */
export function cashCollected(e: EstadoApp, m: RangoMes): number {
  return pagosDelMes(e, m).reduce((a, p) => a + p.monto, 0);
}

/** Lo que se quedaron Stripe, PayPal y compañía. */
export function feesProcesador(e: EstadoApp, m: RangoMes): number {
  return pagosDelMes(e, m).reduce((a, p) => a + p.feeMonto, 0);
}

/** Cash collected sobre revenue: de todo lo que vendemos, cuánto entra. */
export function tasaDeCobro(e: EstadoApp, m: RangoMes): number {
  const r = revenue(e, m);
  return r > 0 ? (cashCollected(e, m) / r) * 100 : 0;
}

/* ---------- Comisiones ----------
   El closer cobra sobre el cash collected neto de procesador, no sobre
   el profit. El director, lo mismo con su porcentaje. Si la venta la
   cerró Yari, no comisiona nadie.                                      */

export interface ComisionVenta {
  ventaId: string;
  cobradoEnMes: number;
  netoProcesador: number;
  closerId?: string;
  closerNombre: string;
  comisionCloser: number;
  directorId?: string;
  comisionDirector: number;
  sinComision: boolean;
}

export function comisionesDelMes(e: EstadoApp, m: RangoMes): ComisionVenta[] {
  const out: ComisionVenta[] = [];

  /* Los pagos del período agrupados por venta, de una pasada. Buscarlos venta
     por venta recorría todas las cuotas y todos los pagos para cada una, y
     el Dashboard hace esta cuenta una vez por cada día del rango. */
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const pagosPorVenta = new Map<string, typeof e.pagos>();
  for (const p of pagosDelMes(e, m)) {
    const v = ventaDeCuota.get(p.cuotaId);
    if (!v) continue;
    const xs = pagosPorVenta.get(v);
    if (xs) xs.push(p); else pagosPorVenta.set(v, [p]);
  }

  for (const v of e.ventas) {
    if (v.estado === "cancelada") continue;

    const pagosMes = pagosPorVenta.get(v.id) ?? [];
    if (pagosMes.length === 0) continue;

    const cobrado = pagosMes.reduce((a, p) => a + p.monto, 0);
    const neto = pagosMes.reduce((a, p) => a + (p.monto - p.feeMonto), 0);

    const closer = e.equipo.find((x) => x.id === v.closerId);
    const director = e.equipo.find((x) => x.id === v.directorId);
    const sinComision = Boolean(closer?.sinComision);

    out.push({
      ventaId: v.id,
      cobradoEnMes: cobrado,
      netoProcesador: neto,
      closerId: v.closerId,
      closerNombre: closer?.nombre ?? "Sin asignar",
      comisionCloser: sinComision ? 0 : neto * (closer?.comisionRate ?? 0),
      directorId: v.directorId,
      comisionDirector: sinComision ? 0 : neto * (director?.comisionRate ?? 0),
      sinComision,
    });
  }
  return out;
}

export function totalComisiones(cs: ComisionVenta[]) {
  return {
    closers: cs.reduce((a, c) => a + c.comisionCloser, 0),
    director: cs.reduce((a, c) => a + c.comisionDirector, 0),
  };
}

/* ---------- Setter y referidor ----------
   Como en la planilla de Angelo: un porcentaje de lo que entra (bruto, sin
   descontar el procesador). El del setter es el de su fila de Equipo; el
   del referidor, el de Ajustes → Ventas. Si la venta la cerró Yari no
   comisiona nadie. Es informativo: lo que se les paga entra al P&L como
   gasto (Setters, Referidores), igual que en la planilla, así no se cuenta
   dos veces. */

export function comisionSetterDePago(e: EstadoApp, venta: Venta | undefined, monto: number): number {
  if (!venta?.setterId) return 0;
  if (e.equipo.find((x) => x.id === venta.closerId)?.sinComision) return 0;
  const setter = e.equipo.find((x) => x.id === venta.setterId);
  return setter ? Math.round(monto * setter.comisionRate * 100) / 100 : 0;
}

export function comisionReferidorDePago(e: EstadoApp, venta: Venta | undefined, monto: number): number {
  if (!venta?.referidorNombre?.trim()) return 0;
  if (e.equipo.find((x) => x.id === venta.closerId)?.sinComision) return 0;
  return Math.round(monto * (e.ajustes.comisionReferidor ?? 0) * 100) / 100;
}

/** Lo que les toca a setters y referidores por lo que entró en el período. */
export function comisionesSetterYReferidor(e: EstadoApp, m: RangoMes) {
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  let setter = 0, referidor = 0;
  const porPersona = new Map<string, number>();
  for (const p of pagosDelMes(e, m)) {
    const cuota = cuotaDe.get(p.cuotaId);
    const venta = cuota ? ventaDe.get(cuota.ventaId) : undefined;
    const cs = comisionSetterDePago(e, venta, p.monto);
    const cr = comisionReferidorDePago(e, venta, p.monto);
    setter += cs; referidor += cr;
    if (cs) {
      const nombre = e.equipo.find((x) => x.id === venta?.setterId)?.nombre ?? "Setter";
      porPersona.set(nombre, (porPersona.get(nombre) ?? 0) + cs);
    }
    if (cr) {
      const nombre = `${venta?.referidorNombre?.trim()} (referidor)`;
      porPersona.set(nombre, (porPersona.get(nombre) ?? 0) + cr);
    }
  }
  return {
    setter, referidor,
    porPersona: [...porPersona.entries()].map(([nombre, total]) => ({ nombre, total })).sort((a, b) => b.total - a.total),
  };
}

/* ---------- Gastos ---------- */

export function gastosDelMes(e: EstadoApp, m: RangoMes, grupo?: Gasto["grupo"]): Gasto[] {
  return e.gastos.filter((g) => enRango(g.fecha, m) && (!grupo || g.grupo === grupo));
}

export function totalGastos(e: EstadoApp, m: RangoMes, grupo?: Gasto["grupo"]): number {
  return gastosDelMes(e, m, grupo).reduce((a, g) => a + g.monto, 0);
}

export function gastosPorCategoria(e: EstadoApp, m: RangoMes, grupo?: Gasto["grupo"]) {
  const acc = new Map<string, number>();
  for (const g of gastosDelMes(e, m, grupo)) acc.set(g.categoria, (acc.get(g.categoria) ?? 0) + g.monto);
  return [...acc.entries()].sort((a, b) => b[1] - a[1]).map(([categoria, monto]) => ({ categoria, monto }));
}

export function inversionPublicidad(e: EstadoApp, m: RangoMes): number {
  const ads = ["Meta Ads", "Google Ads", "TikTok Ads"];
  return gastosDelMes(e, m).filter((g) => ads.includes(g.categoria)).reduce((a, g) => a + g.monto, 0);
}

/* ---------- El P&L completo ---------- */

export interface PyL {
  revenue: number;
  cashCollected: number;
  tasaCobro: number;
  /* Costos directos */
  comisionCloser: number;
  comisionDirector: number;
  feesProcesador: number;
  otrosDirectos: number;
  totalDirectos: number;
  /* Utilidad bruta */
  brutoCC: number;
  brutoRev: number;
  /* Operativos */
  gastosOperativos: number;
  inversionAds: number;
  /* Resultado */
  operativoCC: number;
  operativoRev: number;
  honorariosCeo: number;
  netoCC: number;
  netoRev: number;
  /* Adquisición */
  ventas: number;
  roasCC: number;
  roasRev: number;
  cac: number;
  /* Reparto */
  growth: number;
  socio: number;
}

export function calcularPyL(e: EstadoApp, m: RangoMes): PyL {
  const rev = revenue(e, m);
  const cc = cashCollected(e, m);
  const fees = feesProcesador(e, m);

  const cs = comisionesDelMes(e, m);
  const { closers, director } = totalComisiones(cs);

  const otrosDirectos = totalGastos(e, m, "directo");
  const totalDirectos = closers + director + fees + otrosDirectos;

  const brutoCC = cc - totalDirectos;
  const brutoRev = rev - totalDirectos;

  const gastosOperativos = totalGastos(e, m, "operativo");
  const inversionAds = inversionPublicidad(e, m);

  const operativoCC = brutoCC - gastosOperativos;
  const operativoRev = brutoRev - gastosOperativos;

  const honorariosCeo = totalGastos(e, m, "dueno");
  const netoCC = operativoCC - honorariosCeo;
  const netoRev = operativoRev - honorariosCeo;

  const nVentas = ventasDelMes(e, m).length;

  /* Growth partner y socio cobran del profit. El growth no cobra de las
     ventas marcadas como excluidas de marketing, así que se prorratea. */
  const parte = parteMarketing(e, m);

  const tasaGrowth = e.equipo.find((x) => x.rol === "growth")?.comisionRate ?? 0;
  const tasaSocio = e.equipo.find((x) => x.rol === "socio")?.comisionRate ?? 0;
  const baseReparto = Math.max(operativoCC, 0);

  return {
    revenue: rev, cashCollected: cc, tasaCobro: rev > 0 ? (cc / rev) * 100 : 0,
    comisionCloser: closers, comisionDirector: director, feesProcesador: fees,
    otrosDirectos, totalDirectos,
    brutoCC, brutoRev,
    gastosOperativos, inversionAds,
    operativoCC, operativoRev,
    honorariosCeo, netoCC, netoRev,
    ventas: nVentas,
    roasCC: inversionAds > 0 ? cc / inversionAds : 0,
    roasRev: inversionAds > 0 ? rev / inversionAds : 0,
    cac: nVentas > 0 ? inversionAds / nVentas : 0,
    growth: baseReparto * tasaGrowth * parte,
    socio: baseReparto * tasaSocio,
  };
}

/** Qué parte de lo vendido en el período no está excluida de marketing: la
 *  del profit que le toca al growth partner. Se mide sobre lo facturado, como
 *  siempre calculó el reparto; la liquidación de sueldos usa esta misma. */
export function parteMarketing(e: EstadoApp, m: RangoMes): number {
  const ventasMes = ventasDelMes(e, m);
  const revTotal = ventasMes.reduce((a, v) => a + v.precioAcordado, 0);
  const revMarketing = ventasMes.filter((v) => !v.excluidoMarketing).reduce((a, v) => a + v.precioAcordado, 0);
  return revTotal > 0 ? revMarketing / revTotal : 1;
}

/* ---------- Mora: lo que Yari quiere ver con alarmas ---------- */

export interface CuotaVencida {
  cuotaId: string;
  ventaId: string;
  contacto: string;
  numero: number;
  monto: number;
  vence: string;
  diasAtraso: number;
  pagado: number;
  saldo: number;
}

export function cuotasVencidas(e: EstadoApp): CuotaVencida[] {
  const hoy = Date.now();
  const out: CuotaVencida[] = [];

  for (const c of e.cuotas) {
    if (c.estado !== "pendiente" || !c.vence) continue;
    const vence = new Date(c.vence).getTime();
    if (vence >= hoy) continue;

    const venta = e.ventas.find((v) => v.id === c.ventaId);
    if (!venta || venta.estado === "cancelada") continue;

    const pagado = e.pagos.filter((p) => p.cuotaId === c.id).reduce((a, p) => a + p.monto, 0);
    const saldo = c.monto - pagado;
    if (saldo <= 0.01) continue;

    out.push({
      cuotaId: c.id, ventaId: venta.id, contacto: venta.contactoNombre,
      numero: c.numero, monto: c.monto, vence: c.vence,
      diasAtraso: Math.floor((hoy - vence) / 86400000),
      pagado, saldo,
    });
  }
  return out.sort((a, b) => b.diasAtraso - a.diasAtraso);
}

export function tasaDeMora(e: EstadoApp): number {
  const exigibles = e.cuotas.filter((c) => c.vence && new Date(c.vence).getTime() < Date.now() && c.estado !== "cancelada");
  if (exigibles.length === 0) return 0;
  return (cuotasVencidas(e).length / exigibles.length) * 100;
}

/** Cada cuota pendiente con lo que falta cobrarle. Misma lista para el total
 *  y para el desglose del Panel. */
export function cuotasPorCobrar(e: EstadoApp) {
  return e.cuotas
    .filter((c) => c.estado === "pendiente")
    .map((c) => {
      const pagado = e.pagos.filter((p) => p.cuotaId === c.id).reduce((x, p) => x + p.monto, 0);
      return { cuota: c, pagado, saldo: Math.max(c.monto - pagado, 0) };
    })
    .filter((x) => x.saldo > 0);
}

export function porCobrarTotal(e: EstadoApp): number {
  return cuotasPorCobrar(e).reduce((a, x) => a + x.saldo, 0);
}

/* ---------- Saldo de una venta ---------- */

export function saldoVenta(e: EstadoApp, ventaId: string) {
  const cuotas = e.cuotas.filter((c) => c.ventaId === ventaId);
  const ids = cuotas.map((c) => c.id);
  const cobrado = e.pagos.filter((p) => ids.includes(p.cuotaId)).reduce((a, p) => a + p.monto, 0);
  const total = cuotas.reduce((a, c) => a + (c.estado === "cancelada" ? 0 : c.monto), 0);
  return { total, cobrado, saldo: total - cobrado, cuotas: cuotas.sort((a, b) => a.numero - b.numero) };
}

/* ==================================================================
   El detalle de cada renglón del estado de resultados.

   Cada función devuelve, agrupada, la MISMA lista que calcularPyL ya
   suma: pagosDelMes, ventasDelMes, comisionesDelMes y gastosDelMes. No
   hay una cuenta paralela, así que el detalle no puede sumar distinto
   que el renglón que lo abre — y si mañana cambia una fórmula, el
   detalle cambia con ella.
   ================================================================== */

type PagoApp = EstadoApp["pagos"][number];
type CuotaApp = EstadoApp["cuotas"][number];

const normalNombre = (s: string) =>
  s.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ");

export interface PagoDetallado { pago: PagoApp; cuota?: CuotaApp; venta?: Venta }

/** Ingresos por cliente: lo cobrado (sus pagos del período) y lo facturado
 *  (sus ventas del período), lado a lado. Un pago cuya cuota no tiene venta
 *  igual suma al cobrado, así que va a un grupo propio en vez de perderse. */
export interface IngresoCliente {
  clave: string;
  nombre: string;
  cobrado: number;
  facturado: number;
  pagos: PagoDetallado[];
  ventas: Venta[];
}

export function ingresosPorCliente(e: EstadoApp, m: RangoMes): IngresoCliente[] {
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  const grupos = new Map<string, IngresoCliente>();

  /* La persona es el contacto si la venta lo tiene; si no, el nombre tal
     como se escribió, para no juntar a dos personas distintas sin nombre. */
  const grupoDe = (v?: Venta): IngresoCliente => {
    const clave = !v ? "sin-venta" : v.contactoId ? `c:${v.contactoId}` : `n:${normalNombre(v.contactoNombre)}`;
    let g = grupos.get(clave);
    if (!g) {
      g = {
        clave, nombre: v ? (v.contactoNombre.trim() || "Sin nombre") : "Pagos sin venta",
        cobrado: 0, facturado: 0, pagos: [], ventas: [],
      };
      grupos.set(clave, g);
    }
    return g;
  };

  for (const p of pagosDelMes(e, m)) {
    const cuota = cuotaDe.get(p.cuotaId);
    const venta = cuota ? ventaDe.get(cuota.ventaId) : undefined;
    const g = grupoDe(venta);
    g.cobrado += p.monto;
    g.pagos.push({ pago: p, cuota, venta });
  }
  for (const v of ventasDelMes(e, m)) {
    const g = grupoDe(v);
    g.facturado += v.precioAcordado;
    g.ventas.push(v);
  }

  for (const g of grupos.values()) {
    g.pagos.sort((a, b) => +new Date(b.pago.fecha) - +new Date(a.pago.fecha));
    g.ventas.sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));
  }
  return [...grupos.values()].sort((a, b) =>
    b.cobrado - a.cobrado || b.facturado - a.facturado || a.nombre.localeCompare(b.nombre, "es"));
}

/** Comisiones de closers por persona, y dentro, venta por venta. Quien no
 *  comisiona (Yari) aparece igual, en cero: explica por qué esas ventas no
 *  suman. */
export interface ComisionesCloser {
  clave: string;
  closerId?: string;
  nombre: string;
  tasa: number;
  sinComision: boolean;
  total: number;
  ventas: ComisionVenta[];
}

export function comisionesPorCloser(e: EstadoApp, m: RangoMes): ComisionesCloser[] {
  const grupos = new Map<string, ComisionesCloser>();
  for (const c of comisionesDelMes(e, m)) {
    const clave = c.closerId ?? "sin-closer";
    let g = grupos.get(clave);
    if (!g) {
      const x = e.equipo.find((q) => q.id === c.closerId);
      g = {
        clave, closerId: c.closerId, nombre: c.closerNombre,
        tasa: x?.comisionRate ?? 0, sinComision: c.sinComision, total: 0, ventas: [],
      };
      grupos.set(clave, g);
    }
    g.total += c.comisionCloser;
    g.ventas.push(c);
  }
  for (const g of grupos.values()) g.ventas.sort((a, b) => b.comisionCloser - a.comisionCloser);
  return [...grupos.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
}

/** Comisión del director, venta por venta. Las que no le dejan nada (las
 *  cerró Yari, o no tienen director) suman cero: se cuentan aparte. */
export function comisionesDelDirector(e: EstadoApp, m: RangoMes): { ventas: ComisionVenta[]; sinComision: number } {
  const todas = comisionesDelMes(e, m);
  const ventas = todas.filter((c) => c.comisionDirector !== 0).sort((a, b) => b.comisionDirector - a.comisionDirector);
  return { ventas, sinComision: todas.length - ventas.length };
}

/** Lo que se quedó cada procesador, pago por pago. Los pagos sin fee
 *  (transferencias, USDT) no suman nada: se cuentan aparte. */
export interface FeesProcesador {
  clave: string;
  procesadorId?: string;
  nombre: string;
  total: number;
  pagos: PagoDetallado[];
}

export function feesPorProcesador(e: EstadoApp, m: RangoMes): { procesadores: FeesProcesador[]; sinFee: number } {
  const cuotaDe = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaDe = new Map(e.ventas.map((v) => [v.id, v] as const));
  const grupos = new Map<string, FeesProcesador>();
  let sinFee = 0;
  for (const p of pagosDelMes(e, m)) {
    if (p.feeMonto === 0) { sinFee++; continue; }
    const clave = p.procesadorId ?? "sin-medio";
    let g = grupos.get(clave);
    if (!g) {
      g = {
        clave, procesadorId: p.procesadorId,
        nombre: e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "Sin medio de pago",
        total: 0, pagos: [],
      };
      grupos.set(clave, g);
    }
    const cuota = cuotaDe.get(p.cuotaId);
    g.total += p.feeMonto;
    g.pagos.push({ pago: p, cuota, venta: cuota ? ventaDe.get(cuota.ventaId) : undefined });
  }
  for (const g of grupos.values()) g.pagos.sort((a, b) => b.pago.feeMonto - a.pago.feeMonto);
  return {
    procesadores: [...grupos.values()].sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es")),
    sinFee,
  };
}

/** Los gastos de un bloque del P&L por categoría, cada una con sus gastos.
 *  Es gastosPorCategoria con la lista adentro. */
export interface GastosCategoria { categoria: string; total: number; gastos: Gasto[] }

export function gastosPorCategoriaDetalle(e: EstadoApp, m: RangoMes, grupo?: Gasto["grupo"]): GastosCategoria[] {
  const grupos = new Map<string, GastosCategoria>();
  for (const g of gastosDelMes(e, m, grupo)) {
    let c = grupos.get(g.categoria);
    if (!c) { c = { categoria: g.categoria, total: 0, gastos: [] }; grupos.set(g.categoria, c); }
    c.total += g.monto;
    c.gastos.push(g);
  }
  for (const c of grupos.values()) c.gastos.sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha) || b.monto - a.monto);
  return [...grupos.values()].sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, "es"));
}
