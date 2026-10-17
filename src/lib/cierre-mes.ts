import type { EstadoApp, Moneda, Pago } from "./types";
import { diaDeNegocio } from "./dia-negocio";
import { nombrePeriodo, periodoDe } from "./periodos";
import { resumenConciliacion, restoDeMovimiento } from "./conciliacion";
import { controlDeCobro, pasaControl } from "./control-cobros";
import { esIncobrable } from "./cuota-incobrable";
import { filasTabla } from "./crm-tabla";
import { propuestasPendientes } from "./reembolsos";
import { propuestas as gastosFijosPorAprobar } from "./gastos-recurrentes";
import { mesesCerrados } from "./mes-cerrado";
import { situacionDe, TEXTO_SITUACION, type Situacion } from "./traspasos";
import { closerDeCuota } from "./comision";

/* ==================================================================
   El cierre del mes (de la «Bandeja» de la Mesa de Finanzas de Blue OS): el
   camino de pasos que hay que recorrer para que un mes cierre sin que se
   pase nada, cada uno con su estado y lo que falta, y a dónde ir a
   resolverlo. Las cuentas son las de siempre (control de cobros,
   conciliación, caja, gastos fijos, liquidación): acá se ordenan en pasos.

   No guarda nada ni cambia ningún número: el P&L, la Caja y el resto de
   Finanzas siguen como están. Un paso se calcula con lo que ya está cargado.
   ================================================================== */

export type EstadoPaso = "listo" | "pendiente" | "en-curso" | "bloqueado";
export type AreaPaso = "ventas" | "cobros" | "caja" | "gastos" | "equipo" | "control" | "cierre";

export const AREAS_DEL_CIERRE: { id: AreaPaso; nombre: string }[] = [
  { id: "ventas", nombre: "Ventas" },
  { id: "cobros", nombre: "Cobros y conciliación" },
  { id: "caja", nombre: "Caja" },
  { id: "gastos", nombre: "Gastos" },
  { id: "equipo", nombre: "Equipo y comisiones" },
  { id: "control", nombre: "Control y reportes" },
  { id: "cierre", nombre: "Cierre" },
];

/* Cada cuánto se hace un paso: el día de Aldana, su semana y el cierre del mes. */
export type Cadencia = "dia" | "semana" | "mes" | "rango";

/* «auto»: se calcula con lo cargado. «manual»: lo tilda una persona (la weekly, revisar Slack). «revisable»: hay
   datos para mirar, pero el paso es haberlos revisado (la mora, el profit): lo tilda quien los revisó. */
export type TipoPaso = "auto" | "manual" | "revisable";

/** La herramienta de trabajo que se abre dentro del paso (las pantallas de siempre, sin salir del camino). */
export type Herramienta =
  | { tipo: "conciliacion" }
  | { tipo: "cobros"; mostrar: "sin-chequear" | "rechazados" | "sin-comprobante" }
  | { tipo: "mora" }
  | { tipo: "caja" }
  | { tipo: "gastos" }
  | { tipo: "fijos" }
  | { tipo: "devoluciones" }
  | { tipo: "liquidacion" }
  | { tipo: "resultados" };

/** Quién tildó un paso y cuándo. */
export interface Chequeo {
  por?: string; en: string; nota?: string;
  /* Sólo en el cierre del día de Finanzas: «hecho», «no-llegue» o «no-hacia-falta» (lib/eod-finanzas.ts). */
  estado?: string;
}

/** Qué abrir al tocar un renglón: una pantalla, o la ficha de una persona (por el id de su venta). */
export type Destino = { href: string } | { ficha: string };

export interface ItemPaso {
  clave: string;
  titulo: string;
  sub?: string;
  monto?: number;
  moneda?: Moneda;
  destino?: Destino;
}

export interface PasoCierre {
  id: string;
  area: AreaPaso;
  titulo: string;
  detalle: string;
  estado: EstadoPaso;
  /* Cuánto está resuelto: «17 de 20». */
  progreso?: { hecho: number; total: number };
  /* Lo que falta, los primeros renglones; `faltan` es cuántos hay de verdad. */
  items: ItemPaso[];
  faltan: number;
  /* Dónde se resuelve. */
  ir?: { href: string; texto: string };
  /* El primer paso pendiente: por donde seguir. */
  siguiente?: boolean;
  /* Lo hacen y lo ven los dueños: para el resto, el paso aparece bloqueado y no cuenta. */
  soloDuenos?: boolean;
  cadencia?: Cadencia;
  tipo?: TipoPaso;
  herramienta?: Herramienta;
  /* Un paso que junta dos cosas (los cobros y los reembolsos, los gastos fijos y los gastos) abre las dos pantallas. */
  tambien?: Herramienta[];
  chequeo?: Chequeo;
}

export interface Opciones {
  ahora?: number;
  esDueno: boolean;
}

/** Cuántos renglones se listan de cada paso: el resto se cuenta en `faltan`. */
const TOPE = 40;
const DIA = 86400000;

const pl = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;
const ultimoDia = (mes: string) => String(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0).getDate()).padStart(2, "0");

/** El período del mes como lo entienden las pantallas por link: ?periodo=custom&desde=…&hasta=…. */
export const queryDelMes = (mes: string) => `periodo=custom&desde=${mes}-01&hasta=${mes}-${ultimoDia(mes)}`;

/** Un tramo de días «aaaa-mm-dd» para revisar. Con `mes`, es un mes completo (y ahí también van la liquidación y el cierre). */
export interface Tramo { desde: string; hasta: string; nombre: string; mes?: string }

const sumarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const textoDia = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export const tramoDelMes = (mes: string): Tramo => ({ desde: `${mes}-01`, hasta: `${mes}-${ultimoDia(mes)}`, nombre: nombrePeriodo(mes).split(" ")[0].toLowerCase(), mes });

/** Un rango cualquiera («de tal día a tal día»): los pasos que se pueden calcular para esos días. */
export const tramoDeDias = (desde: string, hasta: string): Tramo => ({ desde, hasta, nombre: "ese período" });
export const textoDelRango = (desde: string, hasta: string) => (desde === hasta ? `el ${textoDia(desde)}` : `del ${textoDia(desde)} al ${textoDia(hasta)}`);

export function pasosDelMes(e: EstadoApp, mes: string, opciones: Opciones): PasoCierre[] {
  return pasosDelTramo(e, tramoDelMes(mes), opciones);
}

export function pasosDelTramo(e: EstadoApp, tramo: Tramo, { ahora = Date.now(), esDueno }: Opciones): PasoCierre[] {
  const { desde, hasta, nombre, mes } = tramo;
  const hoy = diaDeNegocio(new Date(ahora).toISOString());
  const terminado = hasta < hoy;
  const qs = `periodo=custom&desde=${desde}&hasta=${hasta}`;
  const unidad = mes ? "mes" : "período";
  const dentro = (iso: string | undefined | null) => { if (!iso) return false; const d = diaDeNegocio(iso); return d >= desde && d <= hasta; };
  const pasos: PasoCierre[] = [];

  /* Un paso con lo que falta: sin pendientes está listo si el mes terminó, y «en curso» si todavía entran cosas. */
  const paso = (p: Omit<PasoCierre, "estado" | "items" | "faltan"> & { pendientes: ItemPaso[]; faltan?: number; estado?: EstadoPaso }): void => {
    const faltan = p.faltan ?? p.pendientes.length;
    const { pendientes, faltan: _f, estado, ...resto } = p;
    void _f;
    pasos.push({
      ...resto, faltan, items: pendientes.slice(0, TOPE),
      estado: estado ?? (faltan > 0 ? "pendiente" : terminado ? "listo" : "en-curso"),
    });
  };

  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const ventasDelMes = e.ventas.filter((v) => v.estado !== "cancelada" && dentro(v.fecha));
  const pagosDelMes = e.pagos.filter((p) => dentro(p.fecha));
  const nombreDelPago = (p: Pago) => ventas.get(ventaDeCuota.get(p.cuotaId) ?? "")?.contactoNombre ?? p.pagador ?? "Cobro";
  const fichaDelPago = (p: Pago): Destino | undefined => { const v = ventaDeCuota.get(p.cuotaId); return v ? { ficha: v } : undefined; };

  /* ---------- Ventas ---------- */

  const sinEmbudo = ventasDelMes.filter((v) => !v.embudoId);
  paso({
    id: "ventas-embudo", area: "ventas", titulo: "Atribuir cada venta a su embudo",
    detalle: sinEmbudo.length
      ? `${pl(sinEmbudo.length, "venta de " + nombre + " no tiene", "ventas de " + nombre + " no tienen")} estrategia: Marketing no las cuenta. Hay que decir de qué embudo vino cada una.`
      : `Todas las ventas de ${nombre} tienen su estrategia: Marketing cuenta lo mismo que la empresa.`,
    progreso: { hecho: ventasDelMes.length - sinEmbudo.length, total: ventasDelMes.length },
    pendientes: sinEmbudo.map((v) => ({ clave: v.id, titulo: v.contactoNombre, sub: e.productos.find((x) => x.id === v.productoId)?.nombre, monto: v.precioAcordado, moneda: v.moneda, destino: { ficha: v.id } })),
    ir: { href: `/ventas?estrategia=sin&${qs}`, texto: "Ver las ventas sin estrategia" },
  });

  const conPago = new Set(e.cuotas.filter((c) => e.pagos.some((p) => p.cuotaId === c.id)).map((c) => c.ventaId));
  const sinCobro = ventasDelMes.filter((v) => !conPago.has(v.id) && v.estado === "activa");
  paso({
    id: "ventas-sin-cobro", area: "ventas", titulo: "Ventas sin ningún cobro cargado",
    detalle: sinCobro.length
      ? `${pl(sinCobro.length, "venta de " + nombre + " no tiene", "ventas de " + nombre + " no tienen")} ni un cobro: o falta cargarlo, o el cliente todavía no pagó nada.`
      : `Cada venta de ${nombre} tiene al menos un cobro cargado.`,
    pendientes: sinCobro.map((v) => ({ clave: v.id, titulo: v.contactoNombre, sub: e.productos.find((x) => x.id === v.productoId)?.nombre, monto: v.precioAcordado, moneda: v.moneda, destino: { ficha: v.id } })),
    ir: { href: `/ventas?${qs}`, texto: "Ver las ventas" },
  });

  const llamadas = filasTabla(e, ahora).filter((f) => f.dia >= desde && f.dia <= hasta);
  const sinCargar = llamadas.filter((f) => f.sinCargar);
  paso({
    id: "llamadas-sin-cargar", area: "ventas", titulo: "Llamadas sin cargar cómo terminaron",
    detalle: sinCargar.length
      ? `${pl(sinCargar.length, "llamada de " + nombre + " ya pasó", "llamadas de " + nombre + " ya pasaron")} y nadie cargó cómo terminó: sin eso no se concilian las comisiones de los closers.`
      : `Todas las llamadas de ${nombre} que ya pasaron tienen su estado.`,
    progreso: { hecho: llamadas.filter((f) => f.pasada).length - sinCargar.length, total: llamadas.filter((f) => f.pasada).length },
    pendientes: sinCargar.map((f) => ({ clave: f.id, titulo: f.nombre, sub: `con ${f.closer || "nadie"} · ${f.dia.slice(8, 10)}/${f.dia.slice(5, 7)}`, destino: { ficha: f.personaId } })),
    ir: { href: "/crm", texto: "Ir al CRM" },
  });

  /* ---------- Cobros y conciliación ---------- */

  /* Lo que entró a una pasarela y nadie atató a una cuota: no cuenta como cobrado. Se miran también los de meses
     anteriores que siguen sin atar: «que nada se pase». */
  const sinAtar = e.movimientos.filter((m) => m.estado === "pendiente" && diaDeNegocio(m.fecha) <= hasta);
  const sinAtarDelMes = sinAtar.filter((m) => dentro(m.fecha));
  const antes = sinAtar.length - sinAtarDelMes.length;
  const resumen = resumenConciliacion(e);
  paso({
    id: "movs-sin-atar", area: "cobros", titulo: "Atar cada cobro de pasarela a su cuota",
    detalle: sinAtar.length
      ? `${pl(sinAtar.length, "cobro entró", "cobros entraron")} a una pasarela y sigue sin atarse a una cuota${antes ? ` (${antes} de meses anteriores)` : ""}: no cuenta como cobrado ni genera comisión.${resumen.automaticos ? ` ${resumen.automaticos} se pueden atar solos.` : ""}`
      : "Todo lo que entró a las pasarelas está atado a una cuota.",
    pendientes: [...sinAtar].sort((a, b) => b.fecha.localeCompare(a.fecha)).map((m) => ({
      clave: m.id, titulo: m.clienteNombre || m.descripcion || m.referencia, sub: `${m.proveedor} · ${diaDeNegocio(m.fecha).slice(8, 10)}/${diaDeNegocio(m.fecha).slice(5, 7)}`,
      monto: restoDeMovimiento(e, m), moneda: m.moneda, destino: { href: "/conciliacion" },
    })),
    ir: { href: "/conciliacion", texto: "Ir a Conciliación" },
  });

  const aValidar = pagosDelMes.filter((p) => !p.movimientoId && controlDeCobro(p).estado === "pendiente");
  paso({
    id: "cobros-validar", area: "cobros", titulo: "Validar los cobros contra el comprobante",
    detalle: aValidar.length
      ? `${pl(aValidar.length, "cobro espera", "cobros esperan")} que el director o finanzas compare el comprobante con lo cargado. Los conciliados con la pasarela ya están validados.`
      : `Todos los cobros de ${nombre} están validados o conciliados con su pasarela.`,
    progreso: { hecho: pagosDelMes.length - aValidar.length, total: pagosDelMes.length },
    pendientes: aValidar.map((p) => ({ clave: p.id, titulo: nombreDelPago(p), sub: e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "Sin cuenta", monto: p.monto, moneda: p.moneda, destino: fichaDelPago(p) })),
    ir: { href: `/ventas?seccion=cobros&${qs}`, texto: "Ver los cobros" },
  });

  const rechazados = pagosDelMes.filter((p) => controlDeCobro(p).estado === "rechazado");
  paso({
    id: "cobros-rechazados", area: "cobros", titulo: "Arreglar los cobros rechazados",
    detalle: rechazados.length
      ? `${pl(rechazados.length, "cobro fue rechazado", "cobros fueron rechazados")} al mirar el comprobante: el closer tiene que corregirlo o quien lo rechazó darlo por bueno.`
      : "Ningún cobro rechazado.",
    pendientes: rechazados.map((p) => ({ clave: p.id, titulo: nombreDelPago(p), sub: controlDeCobro(p).rechazos[0]?.nota ?? "Rechazado", monto: p.monto, moneda: p.moneda, destino: fichaDelPago(p) })),
    ir: { href: `/ventas?seccion=cobros&${qs}`, texto: "Ver los cobros" },
  });

  const sinComprobante = pagosDelMes.filter((p) => pasaControl(p, e.procesadores, "sin-comprobante"));
  paso({
    id: "cobros-comprobante", area: "cobros", titulo: "Cobros sin comprobante",
    detalle: sinComprobante.length
      ? `${pl(sinComprobante.length, "cobro no está", "cobros no están")} conciliado con una pasarela ni tiene comprobante: no hay con qué probar que la plata entró.`
      : "Cada cobro tiene su comprobante o está conciliado con la pasarela.",
    pendientes: sinComprobante.map((p) => ({ clave: p.id, titulo: nombreDelPago(p), sub: e.procesadores.find((x) => x.id === p.procesadorId)?.nombre ?? "Sin cuenta", monto: p.monto, moneda: p.moneda, destino: fichaDelPago(p) })),
    ir: { href: `/ventas?seccion=cobros&${qs}`, texto: "Ver los cobros" },
  });

  const reembolsos = propuestasPendientes(e);
  paso({
    id: "reembolsos", area: "cobros", titulo: "Devolver lo que las pasarelas ya devolvieron",
    detalle: reembolsos.length
      ? `${pl(reembolsos.length, "reembolso aparece", "reembolsos aparecen")} en una pasarela sin una devolución cargada: hay que atarlo a la venta para que se descuente.`
      : "Todos los reembolsos de las pasarelas tienen su devolución.",
    pendientes: reembolsos.map((d) => ({ clave: d.id, titulo: d.motivo || "Reembolso de una pasarela", sub: d.fecha ? diaDeNegocio(d.fecha) : undefined, monto: d.monto, moneda: d.moneda, destino: { href: "/finanzas/detalle?seccion=devoluciones" } })),
    ir: { href: "/finanzas/detalle?seccion=devoluciones", texto: "Ver las devoluciones" },
  });

  /* Las cuotas que vencen en el mes: cobradas o dadas por incobrables están resueltas; las demás se cobran, se pasan de mes o se dan de baja. */
  const cuotasDelMes = e.cuotas.filter((c) => c.estado !== "cancelada" || esIncobrable(c)).filter((c) => {
    const v = ventas.get(c.ventaId);
    return v && v.estado !== "cancelada" && dentro(c.vence);
  });
  const pagadoPor = new Map<string, number>();
  for (const p of e.pagos) pagadoPor.set(p.cuotaId, (pagadoPor.get(p.cuotaId) ?? 0) + p.monto);
  const resuelta = (c: (typeof cuotasDelMes)[number]) => esIncobrable(c) || c.monto - (pagadoPor.get(c.id) ?? 0) <= 0.01;
  const sinResolver = cuotasDelMes.filter((c) => !resuelta(c) && (terminado || diaDeNegocio(c.vence!) < diaDeNegocio(new Date(ahora).toISOString())));
  paso({
    id: "cuotas-mes", area: "cobros", titulo: `Cuotas del ${unidad} cobradas o resueltas`,
    detalle: sinResolver.length
      ? `${cuotasDelMes.filter(resuelta).length} de ${cuotasDelMes.length} cuotas de ${nombre} están resueltas. ${pl(sinResolver.length, "venció y sigue", "vencieron y siguen")} sin cobrar: hay que cobrarlas, pasarlas de mes (Cambiar fecha) o darlas por incobrables.`
      : `Las ${cuotasDelMes.length} cuotas de ${nombre} que ya vencieron están cobradas o resueltas.`,
    progreso: { hecho: cuotasDelMes.filter(resuelta).length, total: cuotasDelMes.length },
    pendientes: sinResolver.map((c) => {
      const v = ventas.get(c.ventaId)!;
      return { clave: c.id, titulo: v.contactoNombre, sub: `${c.esReserva ? "Reserva" : `Cuota ${c.numero}`} · venció el ${diaDeNegocio(c.vence!).slice(8, 10)}/${diaDeNegocio(c.vence!).slice(5, 7)}${closerDeCuota(v, c) ? "" : " · sin closer"}`, monto: c.monto - (pagadoPor.get(c.id) ?? 0), moneda: v.moneda, destino: { ficha: v.id } };
    }),
    ir: { href: `/finanzas/detalle?seccion=cobros&${qs}`, texto: "Ver las cuotas" },
  });

  /* ---------- Caja ---------- */

  const situaciones: Situacion[] = ["por-confirmar", "no-llego", "falta-comision", "diferencia"];
  const pasesSueltos = (e.traspasos ?? []).map((t) => ({ t, s: situacionDe(t, ahora) })).filter((x) => situaciones.includes(x.s) && diaDeNegocio(x.t.fecha) <= hasta);
  paso({
    id: "pases", area: "caja", titulo: "Movimientos entre cuentas al día",
    detalle: pasesSueltos.length
      ? `${pl(pasesSueltos.length, "movimiento entre cuentas necesita", "movimientos entre cuentas necesitan")} una decisión: confirmarlos, descartarlos o buscar qué pasó con lo que salió y no llegó.`
      : "Ningún movimiento entre cuentas espera una decisión.",
    pendientes: pasesSueltos.map(({ t, s }) => ({ clave: t.id, titulo: t.contraparte || "Movimiento entre cuentas", sub: TEXTO_SITUACION[s], monto: t.montoSale, moneda: t.monedaSale, destino: { href: "/finanzas/caja" } })),
    ir: { href: "/finanzas/caja", texto: "Ir a la Caja" },
  });

  /* El arqueo: se cuenta la caja de verdad al terminar el mes (en la última semana o en los primeros diez días del siguiente). */
  const arqueos = (e.arqueos ?? []).filter((a) => { const d = diaDeNegocio(a.fecha); return d >= sumarDias(hasta, -6) && d <= sumarDias(hasta, 10); })
    .sort((a, b) => b.fecha.localeCompare(a.fecha));
  const ultimo = arqueos[0];
  const conDiferencia = ultimo && Math.abs(ultimo.diferencia ?? 0) > 1;
  paso({
    id: "arqueo", area: "caja", titulo: "Arqueo de caja al cierre",
    detalle: !terminado
      ? `El ${unidad} sigue en curso: el arqueo se hace con los saldos reales cuando termine ${nombre}.`
      : !ultimo ? `Falta contar la caja de verdad: no hay un arqueo de los últimos días de ${nombre}.`
        : conDiferencia ? `El arqueo del ${diaDeNegocio(ultimo.fecha).slice(8, 10)}/${diaDeNegocio(ultimo.fecha).slice(5, 7)} tiene una diferencia de US$ ${Math.round(ultimo.diferencia ?? 0).toLocaleString("es-AR")} contra lo que la app esperaba: hay que explicarla.`
          : `Arqueo hecho el ${diaDeNegocio(ultimo.fecha).slice(8, 10)}/${diaDeNegocio(ultimo.fecha).slice(5, 7)}: la caja cuadra con lo que la app esperaba.`,
    pendientes: !terminado ? [] : !ultimo || conDiferencia ? [{ clave: "arqueo", titulo: !ultimo ? "Sin arqueo al cierre" : "Arqueo con diferencia", monto: ultimo?.diferencia ?? undefined, moneda: "USD", destino: { href: "/finanzas/caja" } }] : [],
    estado: !terminado ? "bloqueado" : undefined,
    ir: { href: "/finanzas/caja", texto: "Ir a la Caja" },
  });

  /* ---------- Gastos ---------- */

  const fijos = gastosFijosPorAprobar(e, new Date(ahora).toISOString()).filter((p) => p.mes <= hasta.slice(0, 7));
  paso({
    id: "gastos-fijos", area: "gastos", titulo: `Aprobar los gastos fijos del ${unidad}`,
    detalle: fijos.length
      ? `${pl(fijos.length, "gasto fijo falta", "gastos fijos faltan")} aprobar o saltear (alquileres, herramientas, suscripciones): hasta que se carguen, el P&L queda sin esos costos.`
      : "Todos los gastos fijos están aprobados o salteados.",
    pendientes: fijos.map((p) => ({ clave: `${p.plantilla.id}|${p.mes}`, titulo: p.plantilla.concepto, sub: `${nombrePeriodo(p.mes)}${p.atrasada ? " · de un mes anterior" : ""}`, monto: p.monto, moneda: p.plantilla.moneda, destino: { href: "/finanzas/detalle?seccion=fijos" } })),
    ir: { href: "/finanzas/detalle?seccion=fijos", texto: "Ver los gastos fijos" },
  });

  const gastosDelMes = e.gastos.filter((g) => dentro(g.fecha));
  const sinProveedor = gastosDelMes.filter((g) => !g.proveedor?.trim());
  paso({
    id: "gastos-proveedor", area: "gastos", titulo: "Cada gasto con su proveedor",
    detalle: sinProveedor.length
      ? `${pl(sinProveedor.length, "gasto de " + nombre + " no dice", "gastos de " + nombre + " no dicen")} a quién se le pagó: sin proveedor no se puede conciliar con el extracto.`
      : `Todos los gastos de ${nombre} tienen su proveedor.`,
    progreso: { hecho: gastosDelMes.length - sinProveedor.length, total: gastosDelMes.length },
    pendientes: sinProveedor.map((g) => ({ clave: g.id, titulo: g.concepto, sub: g.categoria, monto: g.monto, moneda: g.moneda, destino: { href: `/finanzas/detalle?seccion=gastos&ver=${encodeURIComponent(g.id)}&${qs}` } })),
    ir: { href: `/finanzas/detalle?seccion=gastos&${qs}`, texto: "Ver los gastos" },
  });

  /* ---------- Equipo y comisiones: sólo en un mes completo ---------- */

  if (mes) {

  const liq = (e.liquidaciones ?? []).find((l) => l.periodo === mes);
  const cerrada = mesesCerrados(e).has(mes);
  const hrefLiq = `/equipo?seccion=liquidacion&mes=${mes}`;
  const deLosDuenos = (p: Parameters<typeof paso>[0]) => paso(esDueno ? p : { ...p, estado: "bloqueado", soloDuenos: true, pendientes: [], faltan: 0, detalle: "Lo ven y lo hacen los dueños: no cuenta para tu cierre." });

  deLosDuenos({
    id: "liq-revisar", area: "equipo", titulo: "Revisar la liquidación del mes", soloDuenos: true,
    detalle: !terminado && !liq ? `El mes sigue en curso: la liquidación se revisa cuando termine ${nombre}.`
      : cerrada ? "La liquidación está cerrada: ya no se reescribe."
        : liq ? "La liquidación está abierta: revisá lo que cobra cada persona, los descuentos por cierre del día y las disputas antes de cerrarla."
          : `Todavía no se abrió la liquidación de ${nombre}.`,
    pendientes: cerrada || (!terminado && !liq) ? [] : [{ clave: "liq", titulo: liq ? "Liquidación abierta" : "Sin abrir", destino: { href: hrefLiq } }],
    estado: !terminado && !liq && !cerrada ? "bloqueado" : undefined,
    ir: { href: hrefLiq, texto: "Ir a la liquidación" },
  });

  const aPagar = liq?.resultado?.personas.filter((p) => p.total > 0) ?? [];
  const pagados = aPagar.filter((p) => liq?.pagos[p.miembroId]).length;
  deLosDuenos({
    id: "liq-pagar", area: "equipo", titulo: "Pagarle al equipo", soloDuenos: true,
    detalle: !cerrada ? "Se paga una vez cerrada la liquidación: ahí queda la foto de lo que se le debe a cada uno."
      : aPagar.length === 0 ? "No hay nadie a quien pagarle en esta liquidación."
        : pagados === aPagar.length ? `Se les pagó a las ${aPagar.length} personas de la liquidación.`
          : `Se les pagó a ${pagados} de ${aPagar.length} personas: faltan ${aPagar.length - pagados}.`,
    progreso: cerrada && aPagar.length ? { hecho: pagados, total: aPagar.length } : undefined,
    pendientes: cerrada ? aPagar.filter((p) => !liq?.pagos[p.miembroId]).map((p) => ({ clave: p.miembroId, titulo: p.nombre, monto: p.total, moneda: "USD" as Moneda, destino: { href: hrefLiq } })) : [],
    estado: !cerrada ? "bloqueado" : undefined,
    ir: { href: hrefLiq, texto: "Ir a la liquidación" },
  });

  /* ---------- Cierre ---------- */

  const previos = pasos.filter((p) => p.estado === "pendiente" && !(p.soloDuenos && !esDueno)).length;
  pasos.push(pasoCerrar({ mes, nombre, previos, terminado, cerrada, hrefLiq, esDueno }));
  }

  const primero = pasos.find((p) => p.estado === "pendiente");
  if (primero) primero.siguiente = true;
  return pasos;
}


/** El último paso del mes: cerrar. Lo calcula quien arma la lista, porque depende de cuántos pasos quedan. */
export function pasoCerrar({ nombre, previos, terminado, cerrada, hrefLiq, esDueno }: {
  mes: string; nombre: string; previos: number; terminado: boolean; cerrada: boolean; hrefLiq: string; esDueno: boolean;
}): PasoCierre {
  return {
    id: "cerrar", area: "cierre", titulo: `Cerrar ${nombre}`, soloDuenos: true, items: [], faltan: 0,
    detalle: (cerrada ? `${nombre[0].toUpperCase()}${nombre.slice(1)} está cerrado: lo que llegue tarde entra en el mes que sigue.`
      : !terminado ? `El mes sigue en curso: se cierra cuando termine ${nombre}.`
        : previos > 0 ? `Faltan ${pl(previos, "paso", "pasos")} antes de cerrar. Se puede cerrar igual, pero lo que falte entra en el mes que sigue.`
          : "Todo está al día: ya se puede cerrar la liquidación y dar el mes por terminado.") + (esDueno ? "" : " El cierre lo hacen los dueños."),
    estado: cerrada ? "listo" : !terminado || previos > 0 ? "bloqueado" : "pendiente",
    ir: { href: hrefLiq, texto: cerrada ? "Ver la liquidación" : "Cerrar la liquidación" },
  };
}

/** Cuántos pasos están listos de los que cuentan (los de los dueños no cuentan para el resto). */
export function avanceDelMes(pasos: PasoCierre[], esDueno: boolean): { listos: number; total: number } {
  const cuentan = pasos.filter((p) => esDueno || !p.soloDuenos);
  return { listos: cuentan.filter((p) => p.estado === "listo").length, total: cuentan.length };
}
