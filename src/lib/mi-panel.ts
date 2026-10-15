import type { Cuota, EstadoApp, MiembroEquipo, Pago, Sesion, Venta } from "./types";
import type { RangoMes } from "./metricas";
import { comisionesDelMes, comisionSetterDePago, closerDeCuota, pagosDelMes, ventasDelMes, type ComisionVenta } from "./finanzas";
import { cuotasPorCobrarDe, type CuotaPendiente } from "./cuotas-closer";
import { filasTabla, type FilaTabla } from "./crm-tabla";
import { esDelCloser } from "./eod";
import { resumenDelDia, type ResumenDelDia } from "./cuenta-closer";
import { hoyDeNegocio, strikesDe, type StrikesDeCloser } from "./cierre-del-dia";
import { controlDeCobro, conciliacionDe, type ControlDeCobro, type EstadoConciliacion } from "./control-cobros";
import { normalizarUtm } from "./utms";
import { origenDe } from "./utms";

/* ==================================================================
   «Mi panel» (reunión del 15/10): lo de una persona del equipo en una sola
   pantalla, para que el closer vea sus comisiones, sus cuotas por cobrar,
   sus próximas llamadas y qué pasó con los cobros que cargó (si finanzas ya
   los validó o no), y el setter, las agendas que le cargaron.

   Todo sale de lo que la app ya tiene cargado: la base le entrega a cada
   cuenta sólo lo suyo, así que a un closer le calcula lo suyo y a un dueño
   que lo mira «como» ese closer, lo mismo (acá se filtra por la persona,
   no por la cuenta). No guarda nada.
   ================================================================== */

export type VistaDePanel = "closer" | "setter" | "director" | "otro";

/** Qué secciones le corresponden a alguien según su rol en el equipo. */
export function vistaDePanel(m: Pick<MiembroEquipo, "rol">): VistaDePanel {
  if (m.rol === "closer") return "closer";
  if (m.rol === "setter") return "setter";
  if (m.rol === "director") return "director";
  return "otro";
}

/** Quién puede tener un panel: los que venden o comisionan. */
export const conPanel = (m: Pick<MiembroEquipo, "rol" | "activo">) => m.activo && ["closer", "setter", "director"].includes(m.rol);

export interface CobroCargado {
  pago: Pago;
  cuota?: Cuota;
  venta?: Venta;
  control: ControlDeCobro;
  conciliacion: EstadoConciliacion;
}

export interface ResumenControl { total: number; chequeados: number; pendientes: number; rechazados: number }

export interface AgendaDeSetter {
  sesion: Sesion;
  /* Si esa persona terminó comprando, la venta. */
  venta?: Venta;
}

export interface MiPanel {
  miembro: MiembroEquipo;
  vista: VistaDePanel;
  mes: RangoMes;
  /* ---- closer y director ---- */
  /* Lo que cobró el closer en el mes (lo que entró por sus ventas). */
  cobradoMes: number;
  /* Su comisión del mes como closer, ya sin lo que se descuenta por el cierre del día. */
  comisionCloser: number;
  descuentoCierre: number;
  /* Su comisión del mes como director, si lo es. */
  comisionDirector: number;
  /* Su comisión del mes como setter (sobre las ventas que le cargaron). */
  comisionSetter: number;
  /* Venta por venta, lo que le toca en el mes. */
  comisiones: ComisionVenta[];
  ventasDelMes: Venta[];
  facturadoMes: number;
  porCobrar: CuotaPendiente[];
  porCobrarTotal: number;
  porCobrarVencido: number;
  /* ---- llamadas ---- */
  proximasLlamadas: FilaTabla[];
  dia: ResumenDelDia;
  strikes: StrikesDeCloser;
  /* ---- los cobros que cargó ---- */
  cobros: CobroCargado[];
  controlDeCobros: ResumenControl;
  /* ---- setter ---- */
  agendasDeSetter: AgendaDeSetter[];
  ventasDeSetter: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Los cobros que tocaron a esta persona, del último mes y medio. */
const DIAS_DE_COBROS = 45;

export function miPanelDe(e: EstadoApp, m: MiembroEquipo, mes: RangoMes, ahora = Date.now()): MiPanel {
  const vista = vistaDePanel(m);
  const hoy = hoyDeNegocio(ahora);

  /* Comisiones del mes. */
  const delMes = comisionesDelMes(e, mes);
  const comisiones = delMes.filter((c) => c.closerId === m.id || (c.directorId === m.id && c.comisionDirector !== 0));
  const comisionCloser = r2(delMes.filter((c) => c.closerId === m.id).reduce((a, c) => a + c.comisionCloser, 0));
  const descuentoCierre = r2(delMes.filter((c) => c.closerId === m.id).reduce((a, c) => a + (c.descuentoCierre ?? 0), 0));
  const comisionDirector = r2(delMes.filter((c) => c.directorId === m.id).reduce((a, c) => a + c.comisionDirector, 0));
  const cobradoMes = r2(delMes.filter((c) => c.closerId === m.id).reduce((a, c) => a + c.cobradoEnMes, 0));

  /* Setter: lo que le toca de las ventas que le cargaron. */
  const cuotaPorId = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaPorId = new Map(e.ventas.map((v) => [v.id, v] as const));
  let comisionSetter = 0;
  for (const p of pagosDelMes(e, mes)) {
    const v = ventaPorId.get(cuotaPorId.get(p.cuotaId)?.ventaId ?? "");
    if (v?.setterId === m.id) comisionSetter += comisionSetterDePago(e, v, p);
  }

  const suyas = ventasDelMes(e, mes).filter((v) => v.closerId === m.id && v.estado !== "cancelada");

  /* Lo que le queda por cobrar. */
  const porCobrar = cuotasPorCobrarDe(e, m.id);
  const porCobrarTotal = r2(porCobrar.reduce((a, x) => a + x.falta, 0));
  const porCobrarVencido = r2(porCobrar.filter((x) => x.cuota.vence && new Date(x.cuota.vence).getTime() < ahora).reduce((a, x) => a + x.falta, 0));

  /* Sus llamadas. */
  const filas = filasTabla(e, ahora).filter((f) => esDelCloser(f.sesion, m.nombre, e.equipo));
  const proximasLlamadas = filas
    .filter((f) => f.sesion.estado !== "cancelada" && new Date(f.llamada).getTime() >= ahora - 30 * 60000)
    .sort((a, b) => a.llamada.localeCompare(b.llamada))
    .slice(0, 8);
  const dia = resumenDelDia(filas, hoy);
  const strikes = strikesDe(e, m.nombre, hoy);

  /* Los cobros de sus ventas (o los que cargó él), para ver si ya los validaron. */
  const desde = ahora - DIAS_DE_COBROS * 86400000;
  const correo = m.email?.trim().toLowerCase();
  const cobros: CobroCargado[] = [];
  for (const p of e.pagos) {
    if (new Date(p.fecha).getTime() < desde) continue;
    const cuota = cuotaPorId.get(p.cuotaId);
    const venta = cuota ? ventaPorId.get(cuota.ventaId) : undefined;
    const suyo = (venta && closerDeCuota(venta, cuota) === m.id) || (correo && p.cargadoPor?.trim().toLowerCase() === correo);
    if (!suyo) continue;
    cobros.push({ pago: p, cuota, venta, control: controlDeCobro(p), conciliacion: conciliacionDe(e.procesadores, p) });
  }
  cobros.sort((a, b) => b.pago.fecha.localeCompare(a.pago.fecha));
  const controlDeCobros: ResumenControl = {
    total: cobros.length,
    chequeados: cobros.filter((c) => c.control.estado === "chequeado" || c.control.conciliado).length,
    rechazados: cobros.filter((c) => c.control.estado === "rechazado").length,
    pendientes: cobros.filter((c) => c.control.estado === "pendiente" && !c.control.conciliado).length,
  };

  /* Las agendas que le cargaron como setter: las que entraron por su link (utm_campaign=setter_nombre). */
  const agendasDeSetter: AgendaDeSetter[] = [];
  if (vista === "setter") {
    const ventasPorContacto = new Map<string, Venta>();
    for (const v of e.ventas) if (v.contactoId && v.estado !== "cancelada") ventasPorContacto.set(v.contactoId, v);
    for (const s of e.sesiones) {
      const utm = normalizarUtm(s.utm);
      if (!utm.campaign && !utm.source) continue;
      if (origenDe(e, utm, s.inicia)?.setterId !== m.id) continue;
      agendasDeSetter.push({ sesion: s, venta: s.contactoId ? ventasPorContacto.get(s.contactoId) : undefined });
    }
    agendasDeSetter.sort((a, b) => b.sesion.inicia.localeCompare(a.sesion.inicia));
  }
  const ventasDeSetter = e.ventas.filter((v) => v.setterId === m.id && v.estado !== "cancelada").length;

  return {
    miembro: m, vista, mes,
    cobradoMes, comisionCloser, descuentoCierre, comisionDirector, comisionSetter: r2(comisionSetter), comisiones,
    ventasDelMes: suyas, facturadoMes: r2(suyas.reduce((a, v) => a + v.precioAcordado, 0)),
    porCobrar, porCobrarTotal, porCobrarVencido,
    proximasLlamadas, dia, strikes,
    cobros, controlDeCobros,
    agendasDeSetter, ventasDeSetter,
  };
}
