/* ==================================================================
   Un trimestre (agosto a octubre de 2026) armado al azar para estresar el
   descuento por el cierre del día en Finanzas, la liquidación, el webinar y
   las devoluciones. Las tasas de cada closer salen de su esquema de
   honorarios (tasaParaFinanzas / tasasPorServicio), que es como la app las
   escribe en Equipo: así lo que dice Finanzas y lo que dice la liquidación
   parten de la misma verdad y cualquier diferencia es un hallazgo.
   ================================================================== */
import type { ConceptoPago, ConfigCierreDelDia, Devolucion, EsquemaPago, EstadoApp, MiembroEquipo, Pago, Sesion, Venta, Webinar } from "@/lib/types";
import { tasaParaFinanzas, tasasPorServicio } from "@/lib/honorarios";
import { TIPO_VENTA, llamada, enAR, sumarDias, type Azar } from "./azar";

/* A las 12 UTC: es el mismo día en cualquier huso de la máquina entre UTC-11 y UTC+11 (Finanzas y la liquidación cortan los meses con la hora de «acá»). */
const iso = (mes: number, d: number, h = 12) => `2026-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

export const MESES = ["2026-08", "2026-09", "2026-10"] as const;

const concepto = (c: Partial<ConceptoPago> & Pick<ConceptoPago, "id" | "tipo" | "nombre">): ConceptoPago => ({ moneda: "USD", ...c });
const esquema = (miembroId: string, conceptos: ConceptoPago[]): EsquemaPago =>
  ({ id: `hon_${miembroId}`, miembroId, conceptos, categoriaGasto: "Equipo / Salarios", actualizadoEn: "" });

export interface Opciones {
  /* Con devoluciones confirmadas al azar. */
  devoluciones?: boolean;
  /* Cuotas heredadas por otro closer. */
  heredadas?: boolean;
  /* Llamada pasada a otro closer después de cargada la venta. */
  pasadas?: boolean;
  /* Servicios con % propio y miembros que se van. */
  tasasPorServicio?: boolean;
  salidas?: boolean;
  /* La base de la comisión de closer: cash-neto (lo que calcula Finanzas) o mezclado con cash bruto. */
  bases?: "neto" | "mezcla";
}

export function escenario(r: Azar, cierre?: ConfigCierreDelDia, op: Opciones = {}): EstadoApp {
  const o = { devoluciones: true, heredadas: true, pasadas: false, tasasPorServicio: true, salidas: true, bases: "neto" as const, ...op };

  const base: MiembroEquipo[] = [
    { id: "yari", nombre: "Yari Taft", rol: "ceo", comisionRate: 0, activo: true, sinComision: true },
    { id: "c1", nombre: "Closer Uno", rol: "closer", comisionRate: 0, activo: true, sinComision: false },
    { id: "c2", nombre: "Closer Dos", rol: "closer", comisionRate: 0, activo: true, sinComision: false, ...(o.salidas && r.si(0.3) ? { hasta: iso(9, r.entre(8, 25)).slice(0, 10) } : {}) },
    /* El tercero se fue a fin de agosto (inactivo, con fecha de salida: la liquidación lo cuenta sólo hasta ahí) o sigue. */
    ...(o.salidas && r.si(0.4)
      ? [{ id: "c3", nombre: "Tercer Closer", rol: "closer" as const, comisionRate: 0, activo: false, sinComision: false, hasta: "2026-08-31" }]
      : [{ id: "c3", nombre: "Tercer Closer", rol: "closer" as const, comisionRate: 0, activo: true, sinComision: false }]),
    { id: "dir", nombre: "Director Uno", rol: "director", comisionRate: 0.05, activo: true, sinComision: false, ...(o.salidas && r.si(0.2) ? { hasta: iso(9, r.entre(5, 25)).slice(0, 10) } : {}) },
  ];
  const honorarios: EsquemaPago[] = [];
  const equipo = base.map((m) => {
    if (m.rol !== "closer") return m;
    const general = r.elige([0.1, 0.125, 0.0725, 0.15, 0.2]);
    const conceptos = [concepto({ id: "com", tipo: "porcentaje", nombre: "Comisión", tasa: general, base: o.bases === "mezcla" && r.si(0.25) ? "cash" : "cash-neto", alcance: "closer" })];
    if (o.tasasPorServicio && r.si(0.5)) {
      conceptos.push(concepto({ id: "com_pa", tipo: "porcentaje", nombre: "Comisión · Mentoría", tasa: r.elige([0.05, 0.3, 0.1]), base: "cash-neto", alcance: "closer", productoIds: ["pa"] }));
    }
    const esq = r.si(0.85) ? esquema(m.id, conceptos) : undefined;
    if (esq) honorarios.push(esq);
    /* Sin esquema cargado, Finanzas usa lo que tiene el miembro. */
    const tasa = esq ? tasaParaFinanzas(m, esq) : general;
    const porServicio = esq ? tasasPorServicio(m, esq) : (o.tasasPorServicio && r.si(0.4) ? { pa: 0.3 } : undefined);
    return { ...m, comisionRate: tasa ?? general, ...(porServicio && Object.keys(porServicio).length ? { comisionServicios: porServicio } : {}) };
  });
  honorarios.push(esquema("dir", [concepto({ id: "dir", tipo: "porcentaje", nombre: "Comisión de director", tasa: 0.05, base: "cash-neto", alcance: "director" })]));

  const closers = ["c1", "c1", "c2", "c2", "c3", "yari"] as const;
  const nombreDe = (id?: string) => equipo.find((m) => m.id === id)?.nombre;

  const ventas: Venta[] = [];
  const cuotas: { id: string; ventaId: string; numero: number; monto: number; estado: string; esReserva: boolean; closerId?: string }[] = [];
  const pagos: Pago[] = [];
  const sesiones: Sesion[] = [];

  const n = r.entre(6, 32);
  for (let i = 0; i < n; i++) {
    const closerId = r.elige([...closers, undefined] as const);
    const mes = r.elige([8, 8, 9, 9, 9, 10]);
    const fechaVenta = iso(mes === 10 ? 9 : mes, r.entre(3, 27));
    const id = `v${i}`;
    /* La llamada de la que salió, con todos los casos de cierre. */
    let sesionId: string | undefined;
    if (r.si(0.8)) {
      /* Día de la llamada: de fines de agosto al 25/09. */
      const dia = sumarDias("2026-08-20", r.entre(0, 36));
      sesionId = `ll${i}`;
      /* Atiende quien cerró la venta, salvo a veces otro (la llamada la atendió uno y la venta la cargó otro). */
      const atiende = closerId && closerId !== "yari" && r.si(0.85) ? closerId : r.elige(["c1", "c2", "c3"]);
      const cierre1 = r.elige(["a-tiempo", "a-tiempo", "tarde", "sin-cargar", "sin-marca", "venta-tarde"] as const);
      const s = llamada(sesionId, nombreDe(atiende), enAR(dia, r.elige([10, 15, 21]), 0), {
        ...(cierre1 === "sin-cargar" || cierre1 === "venta-tarde" ? {} : {
          estadoLlamada: "Compra Full",
          ...(cierre1 === "sin-marca" ? {} : { estadoLlamadaEn: cierre1 === "a-tiempo" ? enAR(dia, r.elige([13, 18, 23]), r.elige([0, 59])) : enAR(sumarDias(dia, r.entre(1, 3)), 12) }),
        }),
        ...(r.si(0.08) ? { estado: "cancelada" as const } : {}),
      });
      sesiones.push(s);
      /* Otras llamadas del mismo closer ese día: arrastran el día entero. */
      for (let k = 0; k < r.entre(0, 2); k++) {
        sesiones.push(llamada(`x${i}_${k}`, nombreDe(atiende), enAR(dia, r.elige([9, 12, 17, 20]), 0), r.elige([
          { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: enAR(dia, 21) }, { estadoLlamada: "Seguimiento Nutrición", estadoLlamadaEn: enAR(sumarDias(dia, 1), 10) },
          {}, { estado: "no-show" as const }, { estado: "cancelada" as const },
        ])));
      }
      if (cierre1 === "venta-tarde") { /* la venta se carga recién días después (creadoEn abajo) */ }
    }
    const ventaTarde = sesionId && r.si(0.3);
    ventas.push({
      id, contactoNombre: `Cliente ${i}`, precioAcordado: r.plata(300, 6000), moneda: "USD", fecha: fechaVenta,
      productoId: r.elige(["pa", "pb"]), webinarId: r.elige(["w1", "w2", undefined]),
      ...(closerId ? { closerId } : {}), ...(r.si(0.6) ? { directorId: "dir" } : {}),
      excluidoMarketing: r.si(0.2), estado: r.si(0.08) ? "cancelada" : r.si(0.05) ? "reembolsada" : "activa",
      creadoEn: ventaTarde ? enAR(sumarDias(fechaVenta.slice(0, 10), r.entre(1, 3)), 11) : fechaVenta, extra: {},
      ...(sesionId ? { sesionId } : {}),
    } as Venta);
    const nCuotas = r.entre(1, 3);
    for (let k = 0; k < nCuotas; k++) {
      cuotas.push({
        id: `c${i}_${k}`, ventaId: id, numero: k + 1, monto: 100, estado: "pagada", esReserva: false,
        ...(o.heredadas && r.si(0.15) ? { closerId: r.elige(["c1", "c2", "c3"]) } : {}),
      });
      if (r.si(0.9)) {
        const monto = r.plata(50, 3000);
        const fee = Math.round(monto * r.elige([0.029, 0.045, 0.06, 0.1]) * 100) / 100;
        const m = r.elige([8, 9, 9, 10]);
        pagos.push({ id: `p${i}_${k}`, cuotaId: `c${i}_${k}`, monto, feeMonto: fee, fecha: iso(m, r.entre(3, 27)), procesadorId: "s", moneda: "USD", feeRate: fee / monto, creadoEn: iso(m, 3) } as Pago);
      }
    }
  }
  /* Llamadas sueltas de cada closer: ruido (y días con strike sin ventas). */
  for (let i = 0; i < r.entre(0, 20); i++) {
    const dia = sumarDias("2026-08-20", r.entre(0, 36));
    sesiones.push(llamada(`z${i}`, nombreDe(r.elige(["c1", "c2", "c3"])), enAR(dia, 16, 0), r.elige([{}, { estadoLlamada: "NO Calificado", estadoLlamadaEn: enAR(sumarDias(dia, 2), 9) }, { estadoLlamada: "Compra Full", estadoLlamadaEn: enAR(dia, 22) }])));
  }

  const devoluciones: Devolucion[] = [];
  if (o.devoluciones) {
    for (const v of ventas) {
      if (v.estado === "cancelada" || !r.si(0.18)) continue;
      const cobrado = pagos.filter((p) => cuotas.find((c) => c.id === p.cuotaId)?.ventaId === v.id).reduce((a, p) => a + p.monto, 0);
      if (cobrado <= 0) continue;
      devoluciones.push({
        id: `d_${v.id}`, ventaId: v.id, monto: Math.round(cobrado * r.elige([0.25, 0.5, 1]) * 100) / 100, moneda: "USD", fecha: iso(r.elige([9, 10]), r.entre(10, 27)),
        procesadorId: "s", noDescontarAlCloser: r.si(0.2), estado: "confirmada", creadoEn: iso(10, 1), extra: {},
      } as Devolucion);
    }
  }

  const webinar = (id: string): Webinar => ({
    id, titulo: id, fecha: iso(8, 1, 22), duracionMin: 75, estado: "finalizado", registrados: 0, asistentes: 0, inversion: 0, formularios: 0,
    grupoWpp: 0, llamadasVivo: 0, llamadasPosterior: 0, llamadasCanceladas: 0, llamadasInasistidas: 0, llamadasNoCalificadas: 0,
    llamadasCalificadas: 0, inversionDmAds: 0, costoWhatsappApi: 0, creadoEn: iso(8, 1), extra: {},
  }) as Webinar;

  return {
    ajustes: { monedaBase: "USD", tipoCambio: 1500, ...(cierre ? { crm: { cierreDelDia: cierre } } : {}) },
    equipo, honorarios, ventas, cuotas, pagos, gastos: [], sesiones, liquidaciones: [], webinars: [webinar("w1"), webinar("w2")],
    devoluciones,
    productos: [{ id: "pa", nombre: "Mentoría" }, { id: "pb", nombre: "Downsell" }],
    procesadores: [{ id: "s", nombre: "Stripe" }],
    embudos: [], movimientos: [], arqueos: [], traspasos: [],
  } as unknown as EstadoApp;
}

export const PRENDIDO: ConfigCierreDelDia = { cuentaDesde: "2026-08-20", descuenta: true, descuentaDesde: "2026-08-20" };
export { TIPO_VENTA };
