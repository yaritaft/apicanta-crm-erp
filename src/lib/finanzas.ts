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

/** Lo cobrado: los pagos que entraron en el mes, sin importar cuándo se vendió. */
export function cashCollected(e: EstadoApp, m: RangoMes): number {
  return e.pagos.filter((p) => enRango(p.fecha, m)).reduce((a, p) => a + p.monto, 0);
}

/** Lo que se quedaron Stripe, PayPal y compañía. */
export function feesProcesador(e: EstadoApp, m: RangoMes): number {
  return e.pagos.filter((p) => enRango(p.fecha, m)).reduce((a, p) => a + p.feeMonto, 0);
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

  for (const v of e.ventas) {
    if (v.estado === "cancelada") continue;

    const cuotas = e.cuotas.filter((c) => c.ventaId === v.id).map((c) => c.id);
    const pagosMes = e.pagos.filter((p) => cuotas.includes(p.cuotaId) && enRango(p.fecha, m));
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
  const ventasMes = ventasDelMes(e, m);
  const revTotal = ventasMes.reduce((a, v) => a + v.precioAcordado, 0);
  const revMarketing = ventasMes.filter((v) => !v.excluidoMarketing).reduce((a, v) => a + v.precioAcordado, 0);
  const parteMarketing = revTotal > 0 ? revMarketing / revTotal : 1;

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
    growth: baseReparto * tasaGrowth * parteMarketing,
    socio: baseReparto * tasaSocio,
  };
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

export function porCobrarTotal(e: EstadoApp): number {
  return e.cuotas
    .filter((c) => c.estado === "pendiente")
    .reduce((a, c) => {
      const pagado = e.pagos.filter((p) => p.cuotaId === c.id).reduce((x, p) => x + p.monto, 0);
      return a + Math.max(c.monto - pagado, 0);
    }, 0);
}

/* ---------- Saldo de una venta ---------- */

export function saldoVenta(e: EstadoApp, ventaId: string) {
  const cuotas = e.cuotas.filter((c) => c.ventaId === ventaId);
  const ids = cuotas.map((c) => c.id);
  const cobrado = e.pagos.filter((p) => ids.includes(p.cuotaId)).reduce((a, p) => a + p.monto, 0);
  const total = cuotas.reduce((a, c) => a + (c.estado === "cancelada" ? 0 : c.monto), 0);
  return { total, cobrado, saldo: total - cobrado, cuotas: cuotas.sort((a, b) => a.numero - b.numero) };
}
