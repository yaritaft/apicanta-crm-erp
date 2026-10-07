import type {
  ConceptoPago, EsquemaPago, EstadoApp, MiembroEquipo, Pago, Sesion, Venta,
} from "@/lib/types";

/* ==================================================================
   Un septiembre de 2026 armado a mano para probar la liquidación, con las
   cuentas hechas a mano (los tests comprueban contra esos números):

     cobros       p1 1500 (45)  p2 1500 (45)   de v1: Belén, de Mariano, dirige Santiago, agendó Dani
                  p3  500 (15)                  de v2: downsell de Mariano
                  p4 4000 (120)                 de v3: la cerró Yari
                  p5 2000 (60)                  de v4: de Dante, excluida de marketing
     cash 9.500 · procesadores 285 · post pasarelas 9.215
     profit con los sueldos de la liquidación adentro: 1.970,75
   ================================================================== */

export const PERIODO = "2026-09";
export const dia = (d: number, h = 15) => `2026-09-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

export const miembro = (id: string, nombre: string, rol: MiembroEquipo["rol"], comisionRate = 0, extra: Partial<MiembroEquipo> = {}): MiembroEquipo =>
  ({ id, nombre, rol, comisionRate, activo: true, sinComision: false, ...extra });

export const concepto = (c: Partial<ConceptoPago> & Pick<ConceptoPago, "id" | "tipo" | "nombre">): ConceptoPago => ({ moneda: "USD", ...c });
export const esquema = (miembroId: string, conceptos: ConceptoPago[]): EsquemaPago =>
  ({ id: `hon_${miembroId}`, miembroId, conceptos, categoriaGasto: "Equipo / Salarios", actualizadoEn: "" });

export const venta = (v: Partial<Venta> & Pick<Venta, "id" | "contactoNombre" | "precioAcordado" | "fecha">): Venta =>
  ({ moneda: "USD", excluidoMarketing: false, estado: "activa", creadoEn: v.fecha, extra: {}, productoId: "p_ment", ...v });
export const pago = (id: string, cuotaId: string, monto: number, feeMonto: number, fecha: string, procesadorId: string): Pago =>
  ({ id, cuotaId, monto, feeMonto, fecha, procesadorId, moneda: "USD", feeRate: feeMonto / monto, creadoEn: fecha });
export const sesion = (id: string, utm: string, estado: string, creadoEn = dia(12)): Sesion =>
  ({ id, estado, creadoEn, inicia: creadoEn, utm: { utm_source: utm } }) as unknown as Sesion;

export function estadoDePrueba(): EstadoApp {
  const equipo = [
    miembro("yari", "Yari Taft", "ceo", 0, { sinComision: true }),
    miembro("mariano", "Mariano Arias", "closer", 0.15),
    miembro("dante", "Dante Barbieri", "closer", 0.10),
    miembro("santi", "Santiago Burghiani", "director", 0.05, { puesto: "Director comercial" }),
    miembro("dani", "Daniel Rodriguez", "setter", 0.05),
    miembro("agus", "Agustín Sica", "growth", 0.10),
    miembro("manu", "Manuel Pérez", "otro"),
    miembro("lili", "Liliana Riveros", "otro"),
    miembro("nico", "Nico", "otro", 0, { puesto: "Filmmaker" }),
  ];
  const honorarios = [
    esquema("mariano", [concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.15, base: "cash-neto", alcance: "closer" })]),
    esquema("dante", [concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.10, base: "cash-neto", alcance: "closer" })]),
    esquema("santi", [concepto({ id: "c_dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director" })]),
    esquema("dani", [
      concepto({ id: "c_fijo", tipo: "fijo", nombre: "Sueldo", monto: 250 }),
      concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de setter", tasa: 0.05, base: "cash-neto", alcance: "setter" }),
    ]),
    esquema("agus", [
      concepto({ id: "c_fijo", tipo: "fijo", nombre: "Sueldo", monto: 1500, desde: "2026-09-16" }),
      concepto({ id: "c_profit", tipo: "porcentaje", nombre: "Comisión del profit", tasa: 0.10, base: "profit", sinExcluidasMarketing: true }),
    ]),
    esquema("manu", [
      concepto({ id: "c_fijo", tipo: "fijo", nombre: "Sueldo", monto: 1700 }),
      concepto({ id: "c_bono", tipo: "bono", nombre: "Bono", monto: 500, condicion: "Cumplir los objetivos del mes" }),
      concepto({ id: "c_tramo", tipo: "tramo", nombre: "Tramo de cash", monto: 500, cada: 4000, base: "cash-neto", alcance: "todas" }),
    ]),
    esquema("lili", [concepto({ id: "c_tramo", tipo: "tramo", nombre: "Llamadas Resell", monto: 100, cada: 15, base: "llamadas", utmSource: "Resell" })]),
    esquema("nico", [concepto({ id: "c_pieza", tipo: "unidad", nombre: "Sesión", monto: 150, unidad: "sesión de 3 horas" })]),
  ];
  const ventas = [
    venta({ id: "v1", contactoNombre: "Belén Godoy", precioAcordado: 3000, fecha: dia(3), closerId: "mariano", directorId: "santi", setterId: "dani" }),
    venta({ id: "v2", contactoNombre: "Pedro Gómez", precioAcordado: 500, fecha: dia(8), closerId: "mariano", productoId: "p_down" }),
    venta({ id: "v3", contactoNombre: "Cliente de Yari", precioAcordado: 4000, fecha: dia(10), closerId: "yari" }),
    venta({ id: "v4", contactoNombre: "Evento VIP", precioAcordado: 2000, fecha: dia(12), closerId: "dante", excluidoMarketing: true }),
  ];
  const cuotas = [
    { id: "c1a", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false },
    { id: "c1b", ventaId: "v1", numero: 2, monto: 1500, estado: "pagada", esReserva: false },
    { id: "c2", ventaId: "v2", numero: 1, monto: 500, estado: "pagada", esReserva: false },
    { id: "c3", ventaId: "v3", numero: 1, monto: 4000, estado: "pagada", esReserva: false },
    { id: "c4", ventaId: "v4", numero: 1, monto: 2000, estado: "pagada", esReserva: false },
  ];
  const pagos = [
    pago("p1", "c1a", 1500, 45, dia(5), "proc_stripe"),
    pago("p2", "c1b", 1500, 45, dia(20), "proc_stripe"),
    pago("p3", "c2", 500, 15, dia(8), "proc_hotmart"),
    pago("p4", "c3", 4000, 120, dia(10), "proc_stripe"),
    pago("p5", "c4", 2000, 60, dia(14), "proc_hotmart"),
  ];
  const gastos = [
    { id: "g1", categoria: "Facturas Stripe", grupo: "directo", concepto: "Facturas", monto: 300, moneda: "USD", fecha: dia(9), recurrente: false, creadoEn: dia(9), extra: {} },
    { id: "g2", categoria: "Meta Ads", grupo: "operativo", concepto: "Pauta", monto: 1200, moneda: "USD", fecha: dia(10), recurrente: false, creadoEn: dia(10), extra: {} },
  ];
  const sesiones = [
    ...Array.from({ length: 17 }, (_, i) => sesion(`s${i}`, "Resell", "agendada")),
    sesion("sx", "Resell", "cancelada"),
    ...Array.from({ length: 3 }, (_, i) => sesion(`so${i}`, "organico", "agendada")),
  ];
  return {
    ajustes: { monedaBase: "USD", tipoCambio: 1500 },
    equipo, honorarios, ventas, cuotas, pagos, gastos, sesiones, liquidaciones: [],
    productos: [{ id: "p_ment", nombre: "Mentoría" }, { id: "p_down", nombre: "Downsell" }],
    procesadores: [{ id: "proc_stripe", nombre: "Stripe" }, { id: "proc_hotmart", nombre: "Hotmart" }],
  } as unknown as EstadoApp;
}
