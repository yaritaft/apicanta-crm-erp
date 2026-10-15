import type { Cuota, EstadoApp, MiembroEquipo, Pago, Sesion, Venta } from "./types";
import { rangoDeFechas, type RangoMes } from "./metricas";
import { comisionesDelMes, comisionSetterDePago, closerDeCuota, pagosDelMes, ventasDelMes, type ComisionVenta } from "./finanzas";
import { cuotasPorCobrarDe, type CuotaPendiente } from "./cuotas-closer";
import { filasTabla, type FilaTabla } from "./crm-tabla";
import { esDelCloser } from "./eod";
import { resumenDelDia, type ResumenDelDia } from "./cuenta-closer";
import { hoyDeNegocio, strikesDe, type StrikesDeCloser } from "./cierre-del-dia";
import { controlDeCobro, conciliacionDe, type ControlDeCobro, type EstadoConciliacion } from "./control-cobros";
import { esIncobrable } from "./cuota-incobrable";
import { CANCELADA, CON_CIERRE, NO_SE_PRESENTO, REPROGRAMO, SIN_CIERRE, HECHA } from "./estados";
import { diaDeNegocio } from "./dia-negocio";
import { normalizarUtm, origenDe } from "./utms";

/* ==================================================================
   «Mi panel» (reunión del 15/10, armado sobre el Mi Panel de Blue OS): lo
   de una persona del equipo en una pantalla. El closer ve sus comisiones,
   lo que tiene por cobrar, cómo le va (agendas, show ups, ventas, cierre),
   sus llamadas de hoy y lo que le pide acción; el setter, las agendas que
   le cargaron y en qué terminaron.

   Todo sale de lo que la app ya tiene cargado: la base le entrega a cada
   cuenta sólo lo suyo, así que a un closer le calcula lo suyo y a un dueño
   que lo mira «como» ese closer, lo mismo (acá se filtra por la persona,
   no por la cuenta). No guarda nada.

   Los números reusan las cuentas de la app (Finanzas, cierre del día,
   control de cobros): este archivo ordena, no inventa otra fórmula.
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
  /* La llamada tal como la ve el CRM (estado, cómo terminó). */
  fila?: FilaTabla;
  /* Si esa persona terminó comprando, la venta. */
  venta?: Venta;
}

/* ---------- Sobre la mesa: lo que queda por cobrar, en dos cifras ---------- */

export interface MesaDeCobro {
  /* Lo que vence este mes y falta cobrar, y el avance de esas cuotas. */
  mesPendiente: number;
  mesProyectado: number;
  mesCobrado: number;
  mesPct: number | null;
  /* Lo que venció antes de este mes y sigue sin cobrarse; y de eso, lo que pasó los 90 días. */
  atrasado: number;
  enRiesgo: number;
  /* Lo que vence más adelante y las que se dieron por incobrables. */
  futuro: number;
  sinFecha: number;
  incobrable: number;
}

/* ---------- Cómo le va: los tiles ---------- */

export interface Rendimiento {
  /* Las llamadas del rango, sin las canceladas ni las que reprogramaron. */
  agendas: number;
  /* De esas, las que ya pasaron. */
  pasaron: number;
  showUps: number;
  noShows: number;
  ofertas: number;
  ventas: number;
  facturado: number;
  cobrado: number;
  /* Sin base (nada que dividir) = null: no se muestra «0%», que se leería como «no cerraste nada». */
  pctCierre: number | null;
  pctShowUp: number | null;
  pctOferta: number | null;
  ticket: number | null;
}

export interface Aviso {
  clave: string;
  tono: "danger" | "warning";
  texto: string;
  /* El nombre en negrita dentro del texto, para que se lea de un vistazo. */
  resaltado?: string;
  accion?: { texto: string; ir: "cerrar-el-dia" | "ficha"; id?: string };
}

export interface MiPanel {
  miembro: MiembroEquipo;
  vista: VistaDePanel;
  rango: RangoMes;
  /* ---- closer y director ---- */
  cobradoRango: number;
  comisionCloser: number;
  descuentoCierre: number;
  comisionDirector: number;
  comisionSetter: number;
  /* Venta por venta, lo que le toca en el rango. */
  comisiones: ComisionVenta[];
  ventasDelRango: Venta[];
  porCobrar: CuotaPendiente[];
  porCobrarTotal: number;
  mesa: MesaDeCobro;
  rendimiento: Rendimiento;
  /* ---- llamadas ---- */
  /* Todas las suyas del rango, con su estado. */
  llamadas: FilaTabla[];
  /* Las de hoy, por hora. */
  llamadasDeHoy: FilaTabla[];
  porVenirHoy: number;
  dia: ResumenDelDia;
  strikes: StrikesDeCloser;
  avisos: Aviso[];
  /* Cuántos avisos hay de verdad (la lista muestra los primeros de cada tipo). */
  totalAvisos: number;
  /* ---- los cobros que cargó ---- */
  cobros: CobroCargado[];
  controlDeCobros: ResumenControl;
  /* ---- setter ---- */
  agendasDeSetter: AgendaDeSetter[];
  ventasDeSetter: number;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pct1 = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);

/** Los cobros que tocaron a esta persona, del último mes y medio. */
const DIAS_DE_COBROS = 45;
const DIA = 86400000;

/** El rango del panel (días «aaaa-mm-dd») como lo piden las cuentas de Finanzas. */
export const rangoDelPanel = (desde: string, hasta: string, etiqueta: string): RangoMes => rangoDeFechas(desde, hasta, etiqueta);

/** La mesa de cobro de un closer: se lee siempre contra HOY (no sigue el rango), porque «lo que
 *  vence este mes» y «lo vencido de antes» son del día en que se mira. */
export function mesaDe(e: Pick<EstadoApp, "cuotas" | "ventas" | "pagos">, closerId: string, hoy: string): MesaDeCobro {
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const pagado = new Map<string, number>();
  for (const p of e.pagos) pagado.set(p.cuotaId, (pagado.get(p.cuotaId) ?? 0) + p.monto);
  const mes = hoy.slice(0, 7);
  const hace90 = diaDeNegocio(new Date(Date.parse(`${hoy}T12:00:00Z`) - 90 * DIA).toISOString());
  const m: MesaDeCobro = { mesPendiente: 0, mesProyectado: 0, mesCobrado: 0, mesPct: null, atrasado: 0, enRiesgo: 0, futuro: 0, sinFecha: 0, incobrable: 0 };
  for (const c of e.cuotas) {
    const v = ventas.get(c.ventaId);
    if (!v || v.estado === "cancelada" || closerDeCuota(v, c) !== closerId) continue;
    if (esIncobrable(c)) { m.incobrable += c.monto - (pagado.get(c.id) ?? 0); continue; }
    if (c.estado === "cancelada") continue;
    const cobrado = Math.min(c.monto, pagado.get(c.id) ?? 0);
    const falta = c.monto - cobrado;
    const dia = c.vence ? diaDeNegocio(c.vence) : "";
    if (dia.slice(0, 7) === mes) {
      m.mesProyectado += c.monto;
      m.mesCobrado += cobrado;
      if (falta > 0.01) m.mesPendiente += falta;
      continue;
    }
    if (falta <= 0.01) continue;
    if (!dia) m.sinFecha += falta;
    else if (dia < mes) {
      m.atrasado += falta;
      if (dia < hace90) m.enRiesgo += falta;
    } else m.futuro += falta;
  }
  for (const k of ["mesPendiente", "mesProyectado", "mesCobrado", "atrasado", "enRiesgo", "futuro", "sinFecha", "incobrable"] as const) m[k] = r2(m[k]);
  m.mesPct = pct1(m.mesCobrado, m.mesProyectado);
  return m;
}

/** Cómo le va a un closer en el rango: sus llamadas y sus ventas. */
export function rendimientoDe(filas: FilaTabla[], ventas: Venta[], cobrado: number): Rendimiento {
  const validas = filas.filter((f) => f.resultado !== CANCELADA && f.resultado !== REPROGRAMO);
  const pasaron = validas.filter((f) => f.pasada);
  const showUps = validas.filter((f) => f.resultado === CON_CIERRE || f.resultado === SIN_CIERRE || f.resultado === HECHA).length;
  const noShows = validas.filter((f) => f.resultado === NO_SE_PRESENTO).length;
  const ofertas = validas.filter((f) => f.oferta === "Sí").length;
  const facturado = r2(ventas.reduce((a, v) => a + v.precioAcordado, 0));
  return {
    agendas: validas.length, pasaron: pasaron.length, showUps, noShows, ofertas, ventas: ventas.length, facturado, cobrado: r2(cobrado),
    pctCierre: pct1(ventas.length, showUps),
    pctShowUp: pct1(showUps, pasaron.length),
    pctOferta: pct1(ofertas, showUps),
    ticket: ventas.length > 0 ? r2(facturado / ventas.length) : null,
  };
}

export function miPanelDe(e: EstadoApp, m: MiembroEquipo, rango: RangoMes, ahora = Date.now()): MiPanel {
  const vista = vistaDePanel(m);
  const hoy = hoyDeNegocio(ahora);
  const desdeDia = diaDeNegocio(rango.desde.toISOString());
  const hastaDia = diaDeNegocio(rango.hasta.toISOString());

  /* Comisiones del rango. */
  const delRango = comisionesDelMes(e, rango);
  const comisiones = delRango.filter((c) => c.closerId === m.id || (c.directorId === m.id && c.comisionDirector !== 0));
  const suyas = delRango.filter((c) => c.closerId === m.id);
  const comisionCloser = r2(suyas.reduce((a, c) => a + c.comisionCloser, 0));
  const descuentoCierre = r2(suyas.reduce((a, c) => a + (c.descuentoCierre ?? 0), 0));
  const comisionDirector = r2(delRango.filter((c) => c.directorId === m.id).reduce((a, c) => a + c.comisionDirector, 0));
  const cobradoRango = r2(suyas.reduce((a, c) => a + c.cobradoEnMes, 0));

  /* Setter: lo que le toca de las ventas que le cargaron. */
  const cuotaPorId = new Map(e.cuotas.map((c) => [c.id, c] as const));
  const ventaPorId = new Map(e.ventas.map((v) => [v.id, v] as const));
  let comisionSetter = 0;
  for (const p of pagosDelMes(e, rango)) {
    const v = ventaPorId.get(cuotaPorId.get(p.cuotaId)?.ventaId ?? "");
    if (v?.setterId === m.id) comisionSetter += comisionSetterDePago(e, v, p);
  }

  const ventasDelRango = ventasDelMes(e, rango).filter((v) => v.closerId === m.id && v.estado !== "cancelada");

  /* Lo que le queda por cobrar. */
  const porCobrar = cuotasPorCobrarDe(e, m.id);
  const porCobrarTotal = r2(porCobrar.reduce((a, x) => a + x.falta, 0));
  const mesa = mesaDe(e, m.id, hoy);

  /* Sus llamadas. */
  const todas = filasTabla(e, ahora).filter((f) => esDelCloser(f.sesion, m.nombre, e.equipo));
  const llamadas = todas.filter((f) => f.dia >= desdeDia && f.dia <= hastaDia).sort((a, b) => a.llamada.localeCompare(b.llamada));
  const llamadasDeHoy = todas.filter((f) => f.dia === hoy).sort((a, b) => a.llamada.localeCompare(b.llamada));
  const porVenirHoy = llamadasDeHoy.filter((f) => f.resultado !== CANCELADA && new Date(f.llamada).getTime() > ahora).length;
  const dia = resumenDelDia(todas, hoy);
  const strikes = strikesDe(e, m.nombre, hoy);
  const rendimiento = rendimientoDe(llamadas, ventasDelRango, cobradoRango);

  /* Los cobros de sus ventas (o los que cargó él), para ver si ya los validaron. */
  const desde = ahora - DIAS_DE_COBROS * DIA;
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

  /* Lo que le pide acción. */
  const { avisos, total: totalAvisos } = avisosDe(e, { dia, porCobrar, cobros, ahora });

  /* Las agendas que le cargaron como setter: las que entraron por su link (utm_campaign=setter_nombre). */
  const agendasDeSetter: AgendaDeSetter[] = [];
  if (vista === "setter") {
    const ventasPorContacto = new Map<string, Venta>();
    for (const v of e.ventas) if (v.contactoId && v.estado !== "cancelada") ventasPorContacto.set(v.contactoId, v);
    const filaPorSesion = new Map(filasTabla(e, ahora).map((f) => [f.sesion.id, f] as const));
    for (const s of e.sesiones) {
      const utm = normalizarUtm(s.utm);
      if (!utm.campaign && !utm.source) continue;
      if (origenDe(e, utm, s.inicia)?.setterId !== m.id) continue;
      const dia = diaDeNegocio(s.inicia);
      if (dia < desdeDia || dia > hastaDia) continue;
      agendasDeSetter.push({ sesion: s, fila: filaPorSesion.get(s.id), venta: s.contactoId ? ventasPorContacto.get(s.contactoId) : undefined });
    }
    agendasDeSetter.sort((a, b) => b.sesion.inicia.localeCompare(a.sesion.inicia));
  }
  const ventasDeSetter = e.ventas.filter((v) => v.setterId === m.id && v.estado !== "cancelada").length;

  return {
    miembro: m, vista, rango,
    cobradoRango, comisionCloser, descuentoCierre, comisionDirector, comisionSetter: r2(comisionSetter), comisiones,
    ventasDelRango, porCobrar, porCobrarTotal, mesa, rendimiento,
    llamadas, llamadasDeHoy, porVenirHoy, dia, strikes, avisos, totalAvisos,
    cobros, controlDeCobros,
    agendasDeSetter, ventasDeSetter,
  };
}

/* ---------- «Para vos»: lo que pide acción ---------- */

/** Cuántos avisos de cada tipo se listan; el resto se cuenta en el título. */
const POR_TIPO = 2;
/** Hasta cuántos días atrás se avisa de una cuota vencida. */
const DIAS_VENCIDAS = 30;

function avisosDe(
  e: Pick<EstadoApp, "productos">,
  c: { dia: ResumenDelDia; porCobrar: CuotaPendiente[]; cobros: CobroCargado[]; ahora: number },
): { avisos: Aviso[]; total: number } {
  const avisos: Aviso[] = [];
  let total = 0;
  const productoDe = (id?: string) => e.productos.find((x) => x.id === id)?.nombre ?? "venta";

  /* El cierre del día. */
  const sinCargar = c.dia.sinCargarHoy + c.dia.sinCargarAntes;
  if (sinCargar > 0) {
    total += 1;
    avisos.push({
      clave: "eod", tono: "warning",
      texto: `Te ${sinCargar === 1 ? "falta" : "faltan"} cargar cómo ${sinCargar === 1 ? "terminó" : "terminaron"} ${sinCargar} ${sinCargar === 1 ? "llamada" : "llamadas"}: sin eso no se concilia tu comisión.`,
      accion: { texto: "Cerrar el día", ir: "cerrar-el-dia" },
    });
  }

  /* Cobros que rechazó quien los miró: hay que arreglarlos. */
  const rechazados = c.cobros.filter((x) => x.control.estado === "rechazado");
  total += rechazados.length;
  for (const x of rechazados.slice(0, POR_TIPO)) {
    avisos.push({
      clave: `rc|${x.pago.id}`, tono: "danger", resaltado: x.venta?.contactoNombre ?? "Un cobro",
      texto: `tiene un cobro rechazado: revisá el comprobante.`,
      accion: x.venta ? { texto: "Ver", ir: "ficha", id: x.venta.id } : undefined,
    });
  }

  /* Cuotas que vencieron en los últimos 30 días: las que todavía se pueden ir a cobrar. Lo más viejo ya es mora
     y se ve en «Sobre la mesa». */
  const ahora = c.ahora;
  const vencidas = c.porCobrar.filter((x) => {
    const t = x.cuota.vence ? new Date(x.cuota.vence).getTime() : NaN;
    return t < ahora && t >= ahora - DIAS_VENCIDAS * DIA;
  });
  total += vencidas.length;
  for (const x of vencidas.slice(0, POR_TIPO)) {
    avisos.push({
      clave: `cv|${x.cuota.id}`, tono: "danger", resaltado: x.venta.contactoNombre,
      texto: `la ${x.cuota.esReserva ? "reserva" : `cuota ${x.cuota.numero}`} de ${productoDe(x.venta.productoId)} (US$ ${Math.round(x.falta).toLocaleString("es-AR")}) venció el ${x.cuota.vence!.slice(8, 10)}/${x.cuota.vence!.slice(5, 7)}.`,
      accion: { texto: "Ver", ir: "ficha", id: x.venta.id },
    });
  }

  return { avisos, total };
}
