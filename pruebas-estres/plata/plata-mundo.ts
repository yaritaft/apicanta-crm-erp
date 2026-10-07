/* ==================================================================
   Frente «la plata» · ayudas compartidas de las pruebas de estrés.

   - Un generador con semilla (mulberry32).
   - Un «mundo» al azar: equipo, ventas, cuotas, cobros en varias cuentas y
     monedas, gastos con dos fechas y devoluciones, repartidos en varios
     meses y con instantes en los bordes de mes y de zona horaria.
   - Ayudas chicas (congelar, comparar, pasar a plata).

   Todo se arma en la hora de Argentina (UTC-3, sin horario de verano): plata-tz
   fija TZ antes de cargar nada para que las pruebas den lo mismo en cualquier
   máquina (la app corta los meses con la hora del navegador).
   ================================================================== */
import "./plata-tz";
import { tasaParaFinanzas, tasasPorServicio } from "@/lib/honorarios";
import type {
  ConceptoPago, Devolucion, EsquemaPago, EstadoApp, Gasto, GrupoGasto, Liquidacion, MiembroEquipo, Pago, ResultadoLiquidacion, Venta,
} from "@/lib/types";

/* ---------- Azar con semilla ---------- */

export function azar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    n: siguiente,
    entre: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    elige: <T,>(xs: readonly T[]): T => xs[Math.floor(siguiente() * xs.length)],
    si: (p = 0.5) => siguiente() < p,
    plata: (min: number, max: number) => Math.round((min + siguiente() * (max - min)) * 100) / 100,
    /* Plata con más decimales que centavos: donde se juega el redondeo. */
    fraccion: (min: number, max: number) => min + siguiente() * (max - min),
    baraja: <T,>(xs: readonly T[]): T[] => {
      const ys = [...xs];
      for (let i = ys.length - 1; i > 0; i--) { const j = Math.floor(siguiente() * (i + 1)); [ys[i], ys[j]] = [ys[j], ys[i]]; }
      return ys;
    },
  };
}
export type Azar = ReturnType<typeof azar>;

export const r2 = (n: number) => Math.round(n * 100) / 100;
export const cerca = (a: number, b: number, tol = 0.005) => Math.abs(a - b) <= tol + 1e-9;

/* ---------- Instantes en la hora de Argentina ---------- */

/** El instante (ISO, UTC) de una hora de Argentina. */
export const art = (a: number, m: number, d: number, h = 12, mi = 0, s = 0, ms = 0): string =>
  new Date(Date.UTC(a, m - 1, d, h + 3, mi, s, ms)).toISOString();

export const MESES_MUNDO = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12"] as const;

const partes = (periodo: string) => periodo.split("-").map(Number) as [number, number];
const ultimoDia = (periodo: string) => { const [a, m] = partes(periodo); return new Date(a, m, 0).getDate(); };

/** Instantes que rompen las cuentas ingenuas: los bordes de mes en Argentina y en UTC. `conGap`:
 *  incluye la última fracción de segundo del mes (23:59:59,001 a 23:59:59,999), que ningún rango de la
 *  app cubre (los meses terminan en 23:59:59,000). */
export function bordesDeMes(periodo: string, conGap = false): string[] {
  const [a, m] = partes(periodo);
  const u = ultimoDia(periodo);
  const base = [
    art(a, m, 1, 0, 0, 0, 0),                    // el primer instante del mes
    art(a, m, 1, 0, 0, 0, 1),
    art(a, m, u, 23, 59, 59, 0),                 // el último segundo (hasta del rango)
    art(a, m, u, 23, 59, 58, 999),
    new Date(Date.UTC(a, m - 1, 1, 0, 0, 0, 0)).toISOString(),      // 00:00 UTC del 1: en Argentina es 21:00 del mes anterior
    new Date(Date.UTC(a, m - 1, 1, 2, 59, 59, 0)).toISOString(),    // todavía el mes anterior en Argentina
    new Date(Date.UTC(a, m - 1, 1, 3, 0, 0, 0)).toISOString(),      // 00:00 en Argentina: ya es este mes
    new Date(Date.UTC(a, m - 1, u, 23, 59, 59, 0)).toISOString(),   // 20:59:59 del último día en Argentina
    new Date(Date.UTC(a, m - 1, u, 21, 0, 0, 0)).toISOString(),     // 18:00 en Argentina
  ];
  return conGap ? [...base, art(a, m, u, 23, 59, 59, 500), art(a, m, u, 23, 59, 59, 999)] : base;
}

export interface OpcionesDeInstantes { meses: readonly string[]; bordes?: number; conGap?: boolean }

export function instante(r: Azar, o: OpcionesDeInstantes): string {
  const periodo = r.elige(o.meses);
  if (r.si(o.bordes ?? 0.2)) return r.elige(bordesDeMes(periodo, o.conGap));
  const [a, m] = partes(periodo);
  return art(a, m, r.entre(1, ultimoDia(periodo)), r.entre(0, 23), r.entre(0, 59), r.entre(0, 59), r.entre(0, 999));
}

/** A mediodía de un día de Argentina (como guarda las fechas el formulario de devoluciones). */
export const mediodiaArg = (periodo: string, dia: number) => { const [a, m] = partes(periodo); return art(a, m, dia, 12); };

/* ---------- El equipo y sus esquemas ---------- */

export const miembro = (id: string, nombre: string, rol: MiembroEquipo["rol"], comisionRate = 0, extra: Partial<MiembroEquipo> = {}): MiembroEquipo =>
  ({ id, nombre, rol, comisionRate, activo: true, sinComision: false, ...extra });
export const concepto = (c: Partial<ConceptoPago> & Pick<ConceptoPago, "id" | "tipo" | "nombre">): ConceptoPago => ({ moneda: "USD", ...c });
export const esquema = (miembroId: string, conceptos: ConceptoPago[]): EsquemaPago =>
  ({ id: `hon_${miembroId}`, miembroId, conceptos, categoriaGasto: "Equipo / Salarios", actualizadoEn: "" });

export const pago = (id: string, cuotaId: string, monto: number, feeMonto: number, fecha: string, procesadorId = "proc_stripe"): Pago =>
  ({ id, cuotaId, monto, feeMonto, fecha, procesadorId, moneda: "USD", feeRate: monto > 0 ? feeMonto / monto : 0, creadoEn: fecha });

export const devolucion = (d: Partial<Devolucion> & Pick<Devolucion, "id" | "monto" | "fecha">): Devolucion => ({
  ventaId: "v1", moneda: "USD", procesadorId: "proc_stripe", noDescontarAlCloser: false, estado: "confirmada",
  creadoEn: d.fecha, extra: {}, ...d,
});

export const gasto = (g: Partial<Gasto> & Pick<Gasto, "id" | "monto" | "fecha">): Gasto => ({
  categoria: "Software", grupo: "operativo", concepto: "Gasto", moneda: "USD", recurrente: false, creadoEn: g.fecha, extra: {}, ...g,
});

export const liquidacionCerradaCon = (periodo: string, resultado: ResultadoLiquidacion): Liquidacion => ({
  id: `liq_${periodo}`, periodo, estado: "cerrada", entradas: {}, extras: [], pagos: {}, gastoIds: [],
  resultado: JSON.parse(JSON.stringify(resultado)) as ResultadoLiquidacion,
  cerradaEn: "2026-10-01T12:00:00.000Z", creadoEn: "2026-07-01T12:00:00.000Z",
});

/* ---------- El mundo al azar ---------- */

export const PROCESADORES = [
  { id: "proc_stripe", nombre: "Stripe", moneda: "USD" as const, feeRate: 0.029 },
  { id: "proc_hotmart", nombre: "Hotmart", moneda: "USD" as const, feeRate: 0.06 },
  { id: "proc_mercury", nombre: "Mercury", moneda: "USD" as const, feeRate: 0 },
  { id: "proc_fin", nombre: "Financiera ARS", moneda: "ARS" as const, feeRate: 0.05 },
];

export interface OpcionesDeMundo {
  meses?: readonly string[];
  /* Cuántas ventas como mucho. */
  ventas?: number;
  /* Incluir cuentas en pesos. */
  pesos?: boolean;
  /* Instantes en la última fracción de segundo del mes. */
  conGap?: boolean;
  /* Cuántos instantes caen en un borde de mes. */
  bordes?: number;
  /* Devoluciones: hasta cuántas, y si pueden pasarse de lo cobrado. */
  devoluciones?: number;
  deMas?: boolean;
  /* Gastos: hasta cuántos. */
  gastos?: number;
  /* Con esquemas de honorarios (para la liquidación). */
  esquemas?: boolean;
  /* Con el interruptor del cierre del día prendido y llamadas atadas a las ventas (usar meses pasados: el día de hoy corta lo que cuenta). */
  cierreDelDia?: boolean;
  /* Algún closer ya no está en el equipo (con su fecha de salida). */
  inactivos?: boolean;
  /* Datos sueltos como los que dejan los imports: cobros cuya cuota no existe, cuotas de una venta que no está,
     devoluciones sin venta o de una venta que no existe. */
  huerfanos?: boolean;
}

export interface Mundo { e: EstadoApp; semilla: number; meses: readonly string[]; tc: number }

export function mundo(semilla: number, o: OpcionesDeMundo = {}): Mundo {
  const r = azar(semilla);
  const meses = o.meses ?? MESES_MUNDO;
  /* Un solo tipo de cambio por mundo: así lo cobrado en pesos se puede volver a dólares sin ambigüedad. */
  const tcMundo = r.elige([1100, 1250, 1400, 1500]);
  const inst = (bordes = o.bordes ?? 0.2) => instante(r, { meses, bordes, conGap: o.conGap });

  /* ----- Equipo (los % salen del esquema, como en la app) ----- */
  const tasa = (xs: number[]) => r.elige(xs);
  const rolesBase: MiembroEquipo[] = [
    miembro("yari", "Yari Taft", "ceo", 0, { sinComision: true }),
    miembro("c1", "Closer Uno", "closer", tasa([0.1, 0.125, 0.15, 0.0725]), r.si(0.2) ? { hasta: `2026-${r.elige(["08", "09", "10"])}-${String(r.entre(5, 28)).padStart(2, "0")}` } : {}),
    miembro("c2", "Closer Dos", "closer", tasa([0.1, 0.12, 0.2])),
    miembro("c3", "Closer Tres", "closer", tasa([0.05, 0.0725])),
    miembro("d1", "Director Uno", "director", tasa([0.05, 0.03]), r.si(0.15) ? { hasta: "2026-09-15" } : {}),
    miembro("d2", "Director Dos", "director", 0.04),
    miembro("set", "Setter", "setter", 0.05),
    miembro("gro", "Growth", "growth", 0.1),
    miembro("soc", "Socio", "socio", 0.05),
    miembro("otro", "Gerencia", "otro"),
  ];
  const tasaServicio = r.si(0.6) ? tasa([0.15, 0.2, 0.25]) : null;
  const honorarios: EsquemaPago[] = [];
  const equipo = rolesBase.map((m) => {
    const cs: ConceptoPago[] = [];
    if (m.rol === "closer") {
      cs.push(concepto({ id: "com", tipo: "porcentaje", nombre: "Comisión", tasa: m.comisionRate, base: "cash-neto", alcance: "closer" }));
      if (m.id === "c2" && tasaServicio) cs.push(concepto({ id: "comp2", tipo: "porcentaje", nombre: "Comisión Mentoría", tasa: tasaServicio, base: "cash-neto", alcance: "closer", productoIds: ["p2"] }));
    }
    if (m.rol === "director") cs.push(concepto({ id: "dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: m.comisionRate, base: "cash-neto", alcance: "director" }));
    if (m.rol === "setter") cs.push(concepto({ id: "set", tipo: "porcentaje", nombre: "Comisión de setter", tasa: m.comisionRate, base: "cash-neto", alcance: "setter" }));
    if (m.rol === "growth") cs.push(concepto({ id: "gro", tipo: "porcentaje", nombre: "Profit", tasa: m.comisionRate, base: "profit", sinExcluidasMarketing: true }));
    if (m.rol === "socio") cs.push(concepto({ id: "soc", tipo: "porcentaje", nombre: "Profit", tasa: m.comisionRate, base: "profit" }));
    if (o.esquemas) {
      if (m.rol !== "ceo" && r.si(0.7)) {
        const enPesos = r.si(0.35);
        cs.push(concepto({ id: "fijo", tipo: "fijo", nombre: "Sueldo", monto: enPesos ? r.plata(100000, 2500000) : r.plata(100, 3000), moneda: enPesos ? "ARS" : "USD" }));
      }
      if (m.rol === "otro") {
        cs.push(concepto({ id: "tramo", tipo: "tramo", nombre: "Tramo", monto: r.plata(50, 400), cada: r.elige([500, 1000, 2500]), base: "cash-neto", alcance: "todas" }));
        cs.push(concepto({ id: "pct", tipo: "porcentaje", nombre: "Porcentaje", tasa: 0.02, base: "cash", alcance: "todas" }));
        cs.push(concepto({ id: "pieza", tipo: "unidad", nombre: "Pieza", monto: r.plata(10000, 90000), moneda: "ARS", unidad: "reel" }));
      }
    }
    if (cs.length) honorarios.push(esquema(m.id, cs));
    return m;
  }).map((m) => {
    const esq = honorarios.find((h) => h.miembroId === m.id);
    const t = tasaParaFinanzas(m, esq);
    const ts = tasasPorServicio(m, esq);
    return { ...m, ...(t !== undefined ? { comisionRate: t } : {}), ...(ts && Object.keys(ts).length ? { comisionServicios: ts } : {}) };
  });

  if (o.inactivos) {
    const sale = equipo.findIndex((m) => m.id === "c2");
    if (sale >= 0 && r.si(0.7)) equipo[sale] = { ...equipo[sale], activo: false, hasta: `2026-${r.elige(["08", "09"])}-${String(r.entre(1, 28)).padStart(2, "0")}` };
  }

  /* ----- Ventas, cuotas y cobros ----- */
  const ventas: Venta[] = [];
  const cuotas: { id: string; ventaId: string; numero: number; monto: number; estado: string; esReserva: boolean; closerId?: string }[] = [];
  const pagos: Pago[] = [];
  const cuentas = o.pesos === false ? PROCESADORES.filter((p) => p.moneda === "USD") : PROCESADORES;
  const nVentas = r.entre(3, o.ventas ?? 14);
  for (let i = 0; i < nVentas; i++) {
    const fechaVenta = inst();
    ventas.push({
      id: `v${i}`, contactoNombre: `Cliente ${i}`, precioAcordado: r.plata(500, 6000), fecha: fechaVenta, moneda: "USD",
      productoId: r.elige(["p1", "p2"]), closerId: r.elige(["yari", "c1", "c1", "c2", "c2", "c3"]),
      ...(r.si(0.7) ? { directorId: r.elige(["d1", "d2"]) } : {}), ...(r.si(0.4) ? { setterId: "set" } : {}),
      excluidoMarketing: r.si(0.2), estado: r.si(0.1) ? "cancelada" : r.si(0.08) ? "reembolsada" : "activa", creadoEn: fechaVenta, extra: {},
    } as Venta);
    const k = r.entre(1, 3);
    for (let j = 0; j < k; j++) {
      cuotas.push({ id: `c${i}_${j}`, ventaId: `v${i}`, numero: j + 1, monto: 100, estado: "pagada", esReserva: false, ...(r.si(0.12) ? { closerId: r.elige(["c1", "c2", "c3"]) } : {}) });
      const np = r.si(0.85) ? (r.si(0.15) ? 2 : 1) : 0;
      for (let q = 0; q < np; q++) {
        const cuenta = r.elige(cuentas);
        const monto = r.plata(50, 2500);
        const fee = r.si(0.5) ? monto * cuenta.feeRate : r2(monto * cuenta.feeRate);
        const fecha = inst();
        const p: Pago = { ...pago(`p${i}_${j}_${q}`, `c${i}_${j}`, monto, fee, fecha, cuenta.id), feeMonto: fee };
        if (cuenta.moneda === "ARS") {
          p.tipoCambio = tcMundo;
          p.montoArs = Math.round(monto * tcMundo);
        }
        pagos.push(p);
      }
    }
  }

  /* ----- Gastos con dos fechas ----- */
  const gastos: Gasto[] = [];
  const nGastos = r.entre(0, o.gastos ?? 10);
  const CATEGORIAS: [string, GrupoGasto][] = [
    ["Facturas Stripe", "directo"], ["Setters", "directo"], ["Meta Ads", "operativo"], ["Software", "operativo"],
    ["Equipo / Salarios", "operativo"], ["Honorarios del CEO", "dueno"], ["Retiro de beneficios", "retiro"],
  ];
  for (let i = 0; i < nGastos; i++) {
    const [categoria, grupo] = r.elige(CATEGORIAS);
    const fecha = inst();
    gastos.push(gasto({
      id: `g${i}`, categoria, grupo, monto: r.plata(10, 5000), fecha,
      ...(r.si(0.5) ? { fechaPago: inst() } : {}),
      ...(r.si(0.3) ? { extra: { cuentaId: r.elige(["proc_stripe", "proc_mercury", "proc_hotmart"]) } } : {}),
    }));
  }

  /* ----- Devoluciones ----- */
  const devoluciones: Devolucion[] = [];
  const conCobros = ventas.filter((v) => pagos.some((p) => cuotas.find((c) => c.id === p.cuotaId)?.ventaId === v.id));
  const nDev = conCobros.length ? r.entre(0, Math.min(o.devoluciones ?? 6, conCobros.length * 2)) : 0;
  for (let i = 0; i < nDev; i++) {
    const v = r.elige(conCobros);
    const suyos = pagos.filter((p) => cuotas.find((c) => c.id === p.cuotaId)?.ventaId === v.id);
    const cobrado = suyos.reduce((a, p) => a + p.monto, 0);
    const factor = o.deMas ? r.elige([0.2, 0.5, 1, 1, 1.3]) : r.elige([0.1, 0.25, 0.5, 0.75, 1]);
    const cuenta = r.elige(cuentas);
    const fecha = inst();
    const monto = r2(cobrado * factor);
    if (!(monto > 0)) continue;
    devoluciones.push(devolucion({
      id: `d${i}`, ventaId: v.id, monto, fecha, procesadorId: cuenta.id,
      ...(cuenta.moneda === "ARS" ? { tipoCambio: tcMundo, montoArs: Math.round(monto * tcMundo) } : {}),
      noDescontarAlCloser: r.si(0.2), estado: r.si(0.08) ? "propuesta" : r.si(0.05) ? "ignorada" : "confirmada",
    }));
  }

  /* ----- El cierre del día: llamadas de cada venta, algunas cargadas tarde ----- */
  const sesiones: unknown[] = [];
  if (o.cierreDelDia) {
    for (const v of ventas) {
      const closer = equipo.find((m) => m.id === v.closerId);
      if (!closer || closer.sinComision || !r.si(0.75)) continue;
      const dia = new Date(Date.parse(v.fecha) - 86400000 * r.entre(0, 2));
      const inicia = art(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 14);
      const tarde = r.si(0.4);
      sesiones.push({
        id: `s_${v.id}`, titulo: "Asesoramiento", tipo: "Llamada de Asesoramiento - Webinar - Team", invitado: v.contactoNombre, inicia, duracionMin: 45,
        estado: "hecha", origen: "calendly", creadoEn: inicia, extra: {}, anfitrion: closer.nombre, estadoLlamada: "Compra Cuotas",
        estadoLlamadaEn: tarde ? new Date(Date.parse(inicia) + 86400000 * r.entre(1, 3)).toISOString() : new Date(Date.parse(inicia) + 3600000 * 5).toISOString(),
      });
      (v as Venta & { sesionId?: string }).sesionId = `s_${v.id}`;
    }
  }

  if (o.huerfanos) {
    pagos.forEach((p, i) => { if (r.si(0.1)) pagos[i] = { ...p, cuotaId: r.elige(["no-existe", "c_sin_venta"]) }; });
    cuotas.push({ id: "c_sin_venta", ventaId: "v_fantasma", numero: 1, monto: 100, estado: "pagada", esReserva: false });
    devoluciones.forEach((d, i) => { if (r.si(0.15)) devoluciones[i] = { ...d, ventaId: r.si(0.5) ? undefined : "v_fantasma" }; });
  }

  const e = {
    ajustes: {
      monedaBase: "USD", tipoCambio: 1500,
      ...(o.cierreDelDia ? { crm: { cierreDelDia: { cuentaDesde: "2026-06-01", descuenta: true, descuentaDesde: "2026-06-01" } } } : {}),
    },
    equipo, honorarios, ventas, cuotas, pagos, gastos, devoluciones,
    sesiones, liquidaciones: [], productos: [{ id: "p1", nombre: "Mentoría" }, { id: "p2", nombre: "Downsell" }],
    procesadores: cuentas.map((p) => ({ id: p.id, nombre: p.nombre, moneda: p.moneda, feeRate: p.feeRate, activo: true, automatico: false })),
    embudos: [], movimientos: [], arqueos: [], traspasos: [], contactos: [], leads: [],
  } as unknown as EstadoApp;
  return { e, semilla, meses, tc: tcMundo };
}

/* ---------- Ayudas ---------- */

/** Congela el objeto entero: cualquier función de la app que lo toque (escribir, ordenar en el lugar) falla en voz alta. */
export function congelar<T>(x: T): T {
  if (x && typeof x === "object" && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x as Record<string, unknown>)) congelar(v);
  }
  return x;
}

export const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Una liquidación sin el instante en que se calculó. */
export const sinCalculadoEn = (res: ResultadoLiquidacion) => { const { calculadoEn: _c, ...resto } = res; return resto; };

/** Para el mensaje de error: la semilla y qué se hizo, así se puede repetir. */
export const donde = (semilla: number, ...mas: (string | number)[]) => `semilla ${semilla}${mas.length ? ` · ${mas.join(" · ")}` : ""}`;
