import type {
  ConceptoPago, Devolucion, EsquemaPago, EstadoApp, Liquidacion, MiembroEquipo, Pago, Venta,
} from "@/lib/types";

/* ==================================================================
   El caso de Yari (02/10), armado a mano para probar las devoluciones:

     Belén Godoy compra Mentoría por US$ 3.000 el 28/09 (la cerró Mariano,
     que comisiona el 15%; la dirige Santi, que comisiona el 5%) y la paga
     en dos cuotas por Stripe, que se queda el 3% de cada una:

       cuota 1 · 28/09 · 1.500 (fee 45)      → septiembre
       cuota 2 · 01/10 · 1.500 (fee 45)      → octubre

     Post pasarelas entran 1.455 de cada una. Lo que se comisionó:

       Mariano  15% de 1.455 = 218,25 por cuota  (436,50 las dos)
       Santi     5% de 1.455 =  72,75 por cuota  (145,50 las dos)

     El 03/10 Belén pide la plata de vuelta, con septiembre ya cerrado.
   ================================================================== */

export const SEPTIEMBRE = "2026-09";
export const OCTUBRE = "2026-10";
export const NOVIEMBRE = "2026-11";

export const iso = (mes: string, d: number, h = 15) => `${mes}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

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

export const liquidacionCerrada = (periodo: string, resultado: Liquidacion["resultado"]): Liquidacion => ({
  id: `liq_${periodo}`, periodo, estado: "cerrada", entradas: {}, extras: [], pagos: {}, gastoIds: [],
  resultado, cerradaEn: "2026-10-01T12:00:00.000Z", creadoEn: "2026-09-01T12:00:00.000Z",
});

/** Septiembre y octubre del caso de Yari, sin la devolución todavía. */
export function estadoDeYari(extra: Partial<EstadoApp> = {}): EstadoApp {
  const equipo = [
    miembro("yari", "Yari Taft", "ceo", 0, { sinComision: true }),
    miembro("mariano", "Mariano Arias", "closer", 0.15),
    miembro("dante", "Dante Barbieri", "closer", 0.10),
    miembro("santi", "Santiago Burghiani", "director", 0.05, { puesto: "Director comercial" }),
  ];
  const honorarios = [
    esquema("mariano", [concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.15, base: "cash-neto", alcance: "closer" })]),
    esquema("dante", [concepto({ id: "c_com", tipo: "porcentaje", nombre: "Comisión de closer", tasa: 0.10, base: "cash-neto", alcance: "closer" })]),
    esquema("santi", [concepto({ id: "c_dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director" })]),
  ];
  const venta: Venta = {
    id: "v1", contactoNombre: "Belén Godoy", precioAcordado: 3000, fecha: iso("2026-09", 28), moneda: "USD",
    productoId: "p_ment", closerId: "mariano", directorId: "santi", excluidoMarketing: false, estado: "activa",
    creadoEn: iso("2026-09", 28), extra: {},
  };
  const cuotas = [
    { id: "c1a", ventaId: "v1", numero: 1, monto: 1500, estado: "pagada", esReserva: false },
    { id: "c1b", ventaId: "v1", numero: 2, monto: 1500, estado: "pagada", esReserva: false },
  ];
  const pagos = [
    pago("p1", "c1a", 1500, 45, iso("2026-09", 28)),
    pago("p2", "c1b", 1500, 45, iso("2026-10", 1)),
  ];
  return {
    ajustes: { monedaBase: "USD", tipoCambio: 1500 },
    equipo, honorarios, ventas: [venta], cuotas, pagos, gastos: [], sesiones: [], liquidaciones: [], devoluciones: [],
    productos: [{ id: "p_ment", nombre: "Mentoría" }],
    procesadores: [{ id: "proc_stripe", nombre: "Stripe", moneda: "USD" }, { id: "proc_fin", nombre: "Financiera ARS", moneda: "ARS" }],
    embudos: [], movimientos: [], arqueos: [], traspasos: [],
    ...extra,
  } as unknown as EstadoApp;
}
