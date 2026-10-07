import { azar, art, devolucion, instante, miembro, pago, r2, MESES_MUNDO, type Azar } from "./plata-mundo";
import { devolvibleDeVenta } from "@/lib/devoluciones";
import type { Devolucion, EstadoApp, Pago, Venta } from "@/lib/types";

/* Escenarios chicos para mirar una sola venta de cerca (compartidos por las pruebas del frente «la plata»). */
const HORIZONTE = MESES_MUNDO;

/* Una venta con sus cobros y el equipo que la comisiona, para mirar una sola cuenta de cerca. */
export function escenarioVenta(semilla: number, o: { cuotasHeredadas?: boolean } = {}) {
  const r = azar(semilla);
  const tA = r.elige([0.1, 0.125, 0.15, 0.0725]);
  const tB = r.elige([0.1, 0.2]);
  const tD = r.elige([0.05, 0.03]);
  const conServicio = r.si(0.3);
  const equipo = [
    miembro("yari", "Yari", "ceo", 0, { sinComision: true }),
    miembro("cA", "Closer A", "closer", tA, {
      ...(r.si(0.25) ? { hasta: `2026-${r.elige(["08", "09", "10"])}-${String(r.entre(1, 28)).padStart(2, "0")}` } : {}),
      ...(conServicio ? { comisionServicios: { p2: 0.25 } } : {}),
    }),
    miembro("cB", "Closer B", "closer", tB),
    miembro("dir", "Director", "director", tD, r.si(0.2) ? { hasta: "2026-09-20" } : {}),
  ];
  const venta: Venta = {
    id: "v1", contactoNombre: "Belén", precioAcordado: 5000, fecha: art(2026, 7, 10), moneda: "USD", productoId: r.elige(["p1", "p2"]),
    closerId: r.si(0.1) ? "yari" : "cA", ...(r.si(0.85) ? { directorId: "dir" } : {}), excluidoMarketing: false, estado: "activa", creadoEn: art(2026, 7, 10), extra: {},
  } as Venta;
  const nCuotas = r.entre(1, 4);
  const cuotas = Array.from({ length: nCuotas }, (_, j) => ({
    id: `c${j}`, ventaId: "v1", numero: j + 1, monto: 100, estado: "pagada", esReserva: false,
    ...((o.cuotasHeredadas ?? true) && j > 0 && r.si(0.35) ? { closerId: "cB" } : {}),
  }));
  const pagos: Pago[] = cuotas.map((c, j) => {
    const monto = r.plata(80, 2200);
    const fee = r.si(0.5) ? monto * r.elige([0.029, 0.045, 0.06]) : r2(monto * 0.029);
    return { ...pago(`p${j}`, c.id, monto, fee, instante(r, { meses: HORIZONTE.slice(0, 4), bordes: 0.15 })), feeMonto: fee };
  });
  const ultimoPago = Math.max(...pagos.map((p) => Date.parse(p.fecha)));
  return { r, equipo, venta, cuotas, pagos, ultimoPago };
}

/* Devoluciones cargadas como las carga la app: a mediodía de un día, después del último cobro, sin pasarse de lo que queda. */
export function devolucionesValidas(r: Azar, ultimoPago: number, ventaId: string, e: Pick<EstadoApp, "pagos" | "cuotas"> & { devoluciones: Devolucion[] }, n: number): Devolucion[] {
  const out: Devolucion[] = [];
  let desde = ultimoPago + 86400000;
  for (let i = 0; i < n; i++) {
    const dia = new Date(desde + r.entre(0, 12) * 86400000);
    const fecha = art(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), 12);
    desde = Date.parse(fecha) + 3600000;
    const { queda } = devolvibleDeVenta({ ...e, devoluciones: [...e.devoluciones, ...out] }, ventaId, fecha);
    if (queda <= 0.01) break;
    const monto = i === n - 1 && r.si(0.5) ? queda : r2(queda * r.elige([0.2, 0.33, 0.5, 0.75]));
    if (!(monto > 0)) continue;
    out.push(devolucion({ id: `d${i}`, ventaId, monto, fecha, noDescontarAlCloser: r.si(0.25) }));
  }
  return out;
}

