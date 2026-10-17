import type { EstadoApp } from "./types";
import { diaDeNegocio } from "./dia-negocio";
import { nombrePeriodo, periodoDe } from "./periodos";
import { restoDeMovimiento } from "./conciliacion";
import { controlDeCobro } from "./control-cobros";
import { cuotasVencidas, calcularPyL } from "./finanzas";
import { llamadasEnDevolucionSinCargar } from "./devoluciones";
import { propuestasPendientes } from "./reembolsos";
import { propuestas as gastosFijosPorAprobar } from "./gastos-recurrentes";
import { mesesCerrados } from "./mes-cerrado";
import { ultimoArqueo } from "./caja";
import { situacionDe, TEXTO_SITUACION, type Situacion } from "./traspasos";
import { rangoDeFechas } from "./metricas";
import {
  pasoCerrar, pasosDelMes, pasosDelTramo, tramoDeDias,
  type AreaPaso, type Cadencia, type Chequeo, type EstadoPaso, type Herramienta, type ItemPaso, type PasoCierre, type TipoPaso,
} from "./cierre-mes";

/* ==================================================================
   Finanzas en pasos: lo que hace el equipo de finanzas cada día, cada
   semana y cada mes, uno abajo del otro (como la Bandeja de Blue OS). Es la
   lista de tareas de Aldana —su «EOD»— con las pantallas de siempre adentro.

   Hay tres clases de paso:
   - auto: se calcula con lo que ya está cargado (conciliar, validar, cuotas,
     reembolsos, la caja, los gastos fijos, la liquidación);
   - manual: lo tilda una persona porque pasa fuera de la app (la weekly,
     revisar Slack, la auditoría de softwares): queda quién y cuándo;
   - revisable: hay datos para mirar (la mora, el profit) y el paso es
     haberlos revisado: lo tilda quien los revisó.

   Lo que se tilda se guarda aparte (lib/chequeos-finanzas.ts). Nada de esto
   cambia un número: el P&L, la Caja y la liquidación siguen siendo los de siempre.
   ================================================================== */

export type Chequeos = Record<string, Chequeo>;

export const CADENCIAS: { id: Cadencia; nombre: string }[] = [
  { id: "dia", nombre: "Hoy" },
  { id: "semana", nombre: "Esta semana" },
  { id: "mes", nombre: "Este mes" },
];

/** La llave con la que se guarda lo tildado: la cadencia, el período (el día, la semana o el mes) y el paso. */
export const claveChequeo = (cadencia: Cadencia, periodo: string, paso: string) => `${cadencia}|${periodo}|${paso}`;

/* ---------- Períodos ---------- */

/** La semana (lunes a domingo) de un día, como «2026-W42». */
export function semanaDe(dia: string): string {
  const d = new Date(`${dia}T12:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7;                 // lunes = 0
  d.setUTCDate(d.getUTCDate() - dow + 3);              // el jueves de esa semana fija el año ISO
  const anio = d.getUTCFullYear();
  const primero = new Date(Date.UTC(anio, 0, 4));
  const n = 1 + Math.round(((d.getTime() - primero.getTime()) / 86400000 - 3 + ((primero.getUTCDay() + 6) % 7)) / 7);
  return `${anio}-W${String(n).padStart(2, "0")}`;
}

/** De lunes a domingo de una semana «2026-W42», en días «aaaa-mm-dd». */
export function diasDeLaSemana(semana: string): { desde: string; hasta: string } {
  const [a, w] = semana.split("-W").map(Number);
  const cuatro = new Date(Date.UTC(a, 0, 4));
  const lunes = new Date(cuatro.getTime() + ((w - 1) * 7 - ((cuatro.getUTCDay() + 6) % 7)) * 86400000);
  const domingo = new Date(lunes.getTime() + 6 * 86400000);
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: iso(lunes), hasta: iso(domingo) };
}

/** El período vigente de cada cadencia: hoy, esta semana, este mes (un rango lo elige quien mira: «desde_hasta»). */
export function periodoActual(cadencia: Cadencia, ahora = Date.now()): string {
  const hoy = diaDeNegocio(new Date(ahora).toISOString());
  return cadencia === "dia" ? hoy : cadencia === "semana" ? semanaDe(hoy) : cadencia === "rango" ? `${hoy}_${hoy}` : periodoDe(new Date(`${hoy}T12:00:00`));
}

/** Un rango como «2026-10-01_2026-10-15», en sus dos días. */
export function diasDelRango(periodo: string): { desde: string; hasta: string } {
  const [desde, hasta] = periodo.split("_");
  return { desde, hasta: hasta ?? desde };
}

/* ---------- Lo que se tilda ---------- */

interface Tarea { id: string; area: AreaPaso; titulo: string; detalle: string; tipo: TipoPaso; herramienta?: Herramienta; ir?: { href: string; texto: string } }

/* La lista de Aldana, tal cual la pasó Juan Cruz (15/10): lo que va en la app se calcula; el resto se tilda. */
const MANUALES: Record<Exclude<Cadencia, "rango">, Tarea[]> = {
  dia: [],
  semana: [],
  mes: [],
};

const t = (id: string, area: AreaPaso, titulo: string, detalle: string, extra: Partial<Tarea> = {}): Tarea => ({ id, area, titulo, detalle, tipo: "manual", ...extra });

MANUALES.dia = [
  t("d-tareas", "control", "Revisar el estado de las tareas", "Mirar qué tareas están abiertas, cuáles se vencieron y a quién le toca cada una."),
  t("d-proveedores", "gastos", "Revisar los pagos por pagar a proveedores", "Ver si hay solicitudes de pago pendientes en la financiera y que se paguen a tiempo."),
  t("d-slack", "control", "Revisar los grupos de Slack con Ventas", "Mirar si Ventas preguntó algo o espera una respuesta de finanzas."),
  t("d-financiera", "caja", "Mantener al día las cajas con la financiera", "Que lo que entró y salió por la financiera esté anotado y cuadre con su extracto."),
  t("d-pasarelas", "cobros", "Revisar Stripe, Hotmart y Whop", "Que todo esté en orden: sin disputas ni contracargos abiertos, sin cobros trabados y sin pagos fallidos."),
];
MANUALES.semana = [
  t("s-weekly", "control", "Asistir a la weekly", "La reunión semanal del equipo."),
  t("s-kpis-reportes", "control", "Asegurar que los targets, KPIs y reportes estén al día", "Que cada área haya cargado sus números y los reportes estén completos."),
  t("s-suscripciones", "cobros", "Revisar las suscripciones de Stripe y Whop", "Que cada suscripción tenga fecha de finalización y no siga cobrando de más."),
  t("s-corte-financiera", "caja", "Hacer el corte con la financiera", "Cerrar la semana con la financiera: lo que entró, lo que salió y el saldo."),
  t("s-informe", "control", "Mandar el informe semanal con la caja actualizada", "El informe de la semana con la caja al día."),
  t("s-kpis-ceo", "control", "Entregar los KPIs semanales al CEO", "Los números de la semana, en manos del CEO."),
];
MANUALES.mes = [
  t("m-reporte", "control", "Completar el reporte mensual y revisar las métricas", "El reporte del mes completo y las métricas revisadas."),
  t("m-kpis-ceo", "control", "Entregar los KPIs mensuales al CEO", "Los números del mes, en manos del CEO."),
  t("m-software", "control", "Auditar los softwares", "Qué herramientas se pagan, cuáles se usan y cuáles se pueden dar de baja."),
  t("m-manual-ventas", "control", "Revisar y actualizar el manual de ventas", "Que el manual diga cómo se vende hoy."),
];

/* Las pantallas de los pasos que se arman tal cual; los que juntan dos cosas llevan las suyas en `consolidar`. */
const HERRAMIENTA_DEL_MES: Record<string, Herramienta> = {
  "cuotas-mes": { tipo: "mora" },
  "pases": { tipo: "caja" },
  "arqueo": { tipo: "caja" },
  "liq-revisar": { tipo: "liquidacion" },
  "liq-pagar": { tipo: "liquidacion" },
  "cerrar": { tipo: "liquidacion" },
};

/* ---------- Armar los pasos ---------- */

interface Opciones { ahora?: number; esDueno: boolean; chequeos?: Chequeos }

const DIA = 86400000;
const TOPE = 40;
const pl = (n: number, una: string, varias: string) => `${n} ${n === 1 ? una : varias}`;
const fechaCorta = (iso: string) => { const d = diaDeNegocio(iso); return `${d.slice(8, 10)}/${d.slice(5, 7)}`; };

/** Los pasos de una cadencia, en el orden en que se hacen. Cada uno sabe si está listo, qué falta y dónde se resuelve. */
export function pasosDeFinanzas(e: EstadoApp, cadencia: Cadencia, periodo: string, { ahora = Date.now(), esDueno, chequeos = {} }: Opciones): PasoCierre[] {
  const pasos = cadencia === "rango" ? pasosDelRango(e, periodo, { ahora, esDueno })
    : cadencia === "mes" ? pasosDelMesCompleto(e, periodo, { ahora, esDueno, chequeos })
      : cadencia === "dia" ? pasosDelDia(e, ahora) : pasosDeLaSemana(e, ahora);
  /* Lo que se tilda: manual y revisable están listos cuando alguien los tildó. */
  for (const p of pasos) {
    p.cadencia = cadencia;
    p.tipo ??= "auto";
    if (p.tipo === "auto") continue;
    const c = chequeos[claveChequeo(cadencia, periodo, p.id)];
    if (c) { p.chequeo = c; p.estado = "listo"; continue; }
    /* Un paso de revisar sin nada para revisar ya está hecho; el resto espera a que alguien lo tilde. */
    if (p.tipo === "revisable" && p.faltan === 0 && p.estado === "listo" && p.items.length === 0 && p.detalle) continue;
    if (p.estado !== "bloqueado") p.estado = "pendiente";
  }
  for (const p of pasos) p.siguiente = false;
  const primero = pasos.find((p) => p.estado === "pendiente");
  if (primero) primero.siguiente = true;
  return pasos;
}

function manual(tarea: Tarea, extra: Partial<PasoCierre> = {}): PasoCierre {
  return { id: tarea.id, area: tarea.area, titulo: tarea.titulo, detalle: tarea.detalle, estado: "pendiente", items: [], faltan: 0, tipo: tarea.tipo, herramienta: tarea.herramienta, ir: tarea.ir, ...extra };
}

/** Un paso que se calcula: sin nada pendiente está listo. */
function auto(p: Omit<PasoCierre, "estado" | "items" | "faltan" | "tipo"> & { pendientes: ItemPaso[]; faltan?: number; tipo?: TipoPaso; estado?: PasoCierre["estado"] }): PasoCierre {
  const { pendientes, faltan: f, tipo, estado, ...resto } = p;
  const faltan = f ?? pendientes.length;
  return { ...resto, tipo: tipo ?? "auto", faltan, items: pendientes.slice(0, TOPE), estado: estado ?? (faltan > 0 ? "pendiente" : "listo") };
}

/* ---------- El día ---------- */

function pasosDelDia(e: EstadoApp, ahora: number): PasoCierre[] {
  const hoyIso = new Date(ahora).toISOString();
  const hoy = diaDeNegocio(hoyIso);
  const ventas = new Map(e.ventas.map((v) => [v.id, v] as const));
  const ventaDeCuota = new Map(e.cuotas.map((c) => [c.id, c.ventaId] as const));
  const nombreDelPago = (id: string) => ventas.get(ventaDeCuota.get(id) ?? "")?.contactoNombre ?? "Cobro";

  /* 1. El banco y las pasarelas contra el CRM: lo que entró y nadie ató, y los movimientos entre cuentas sin decidir. */
  const sinAtar = e.movimientos.filter((m) => m.estado === "pendiente" && diaDeNegocio(m.fecha) <= hoy);
  const situaciones: Situacion[] = ["por-confirmar", "no-llego", "falta-comision", "diferencia"];
  const pases = (e.traspasos ?? []).map((tr) => ({ tr, s: situacionDe(tr, ahora) })).filter((x) => situaciones.includes(x.s));
  const banco = auto({
    id: "d-banco", area: "cobros", titulo: "Revisar los movimientos del banco y conciliar",
    detalle: sinAtar.length + pases.length
      ? `${[sinAtar.length ? pl(sinAtar.length, "cobro entró", "cobros entraron") + " a una pasarela o al banco y sigue sin atarse a su cuota" : "", pases.length ? pl(pases.length, "movimiento entre cuentas espera", "movimientos entre cuentas esperan") + " una decisión" : ""].filter(Boolean).join(" · ")}.`
      : "Todo lo que entró a Mercury y a las pasarelas está atado a su cuota, y no hay movimientos entre cuentas sin decidir.",
    pendientes: [
      ...[...sinAtar].sort((a, b) => b.fecha.localeCompare(a.fecha)).map((m) => ({ clave: m.id, titulo: m.clienteNombre || m.descripcion || m.referencia, sub: `${m.proveedor} · ${fechaCorta(m.fecha)}`, monto: restoDeMovimiento(e, m), moneda: m.moneda })),
      ...pases.map(({ tr, s }) => ({ clave: tr.id, titulo: tr.contraparte || "Movimiento entre cuentas", sub: TEXTO_SITUACION[s], monto: tr.montoSale, moneda: tr.monedaSale })),
    ],
    herramienta: { tipo: "conciliacion" },
  });

  /* 2. Los ingresos validados y las cuentas por cobrar. */
  const desde45 = ahora - 45 * DIA;
  const aValidar = e.pagos.filter((p) => new Date(p.fecha).getTime() >= desde45 && !p.movimientoId && controlDeCobro(p).estado !== "chequeado");
  const ingresos = auto({
    id: "d-ingresos", area: "cobros", titulo: "Validar los ingresos contra el comprobante",
    detalle: aValidar.length
      ? `${pl(aValidar.length, "cobro de los últimos 45 días espera", "cobros de los últimos 45 días esperan")} que alguien compare el comprobante con lo cargado (o lo rechace).`
      : "Todos los cobros de los últimos 45 días están validados o conciliados con su pasarela.",
    pendientes: aValidar.map((p) => ({ clave: p.id, titulo: nombreDelPago(p.cuotaId), sub: `${controlDeCobro(p).estado === "rechazado" ? "Rechazado" : "Sin validar"} · ${fechaCorta(p.fecha)}`, monto: p.monto, moneda: p.moneda })),
    herramienta: { tipo: "cobros", mostrar: "sin-chequear" },
  });

  const vencidas = cuotasVencidas(e).filter((c) => c.diasAtraso <= 7);
  const cuotas = auto({
    id: "d-cuotas", area: "cobros", titulo: "Cuentas por cobrar: lo que venció esta semana",
    detalle: vencidas.length
      ? `${pl(vencidas.length, "cuota venció", "cuotas vencieron")} en los últimos 7 días y sigue sin cobrarse: hay que cobrarla, pasarla de fecha o darla por incobrable.`
      : "Ninguna cuota venció en los últimos 7 días sin cobrarse.",
    pendientes: vencidas.map((c) => ({ clave: c.cuotaId, titulo: c.contacto, sub: `Cuota ${c.numero} · hace ${c.diasAtraso} ${c.diasAtraso === 1 ? "día" : "días"}`, monto: c.saldo })),
    herramienta: { tipo: "mora" },
  });

  /* 7. La caja al día: un arqueo reciente y que cuadre. */
  const ult = ultimoArqueo(e);
  const edad = ult ? Math.floor((ahora - new Date(ult.fecha).getTime()) / DIA) : null;
  const dif = Math.abs(ult?.diferencia ?? 0);
  const caja = auto({
    id: "d-caja", area: "caja", titulo: "Mantener la caja al día",
    detalle: !ult ? "Todavía no hay ningún arqueo: contá lo que hay en cada cuenta para que la app pueda controlar la caja."
      : edad! > 7 ? `El último arqueo es de hace ${edad} días: toca volver a contar lo que hay en cada cuenta.`
        : dif > 1 ? `El último arqueo (${fechaCorta(ult.fecha)}) tiene una diferencia de US$ ${Math.round(dif).toLocaleString("es-AR")} contra lo que la app esperaba: hay que explicarla.`
          : `Arqueo de hace ${edad === 0 ? "hoy" : `${edad} ${edad === 1 ? "día" : "días"}`}: la caja cuadra con lo que la app esperaba.`,
    pendientes: !ult || edad! > 7 || dif > 1 ? [{ clave: "arqueo", titulo: !ult ? "Sin arqueo" : edad! > 7 ? "Arqueo atrasado" : "Arqueo con diferencia", monto: ult ? ult.diferencia ?? undefined : undefined, moneda: "USD" }] : [],
    herramienta: { tipo: "caja" },
  });

  /* 9. Los reembolsos: los que las pasarelas ya devolvieron y los que Ventas marcó como devolución. */
  const reembolsos = propuestasPendientes(e);
  const enDevolucion = llamadasEnDevolucionSinCargar(e);
  const devoluciones = auto({
    id: "d-reembolsos", area: "cobros", titulo: "Seguimiento de reembolsos",
    detalle: reembolsos.length + enDevolucion.length
      ? `${[reembolsos.length ? pl(reembolsos.length, "reembolso de una pasarela", "reembolsos de pasarelas") + " sin atar a su devolución" : "", enDevolucion.length ? pl(enDevolucion.length, "llamada marcada", "llamadas marcadas") + " como devolución sin cargar" : ""].filter(Boolean).join(" · ")}.`
      : "No hay reembolsos esperando: todos tienen su devolución cargada.",
    pendientes: [
      ...reembolsos.map((d) => ({ clave: d.id, titulo: d.motivo || "Reembolso de una pasarela", sub: d.fecha ? fechaCorta(d.fecha) : undefined, monto: d.monto, moneda: d.moneda })),
      ...enDevolucion.map((x) => ({ clave: x.sesion.id, titulo: x.sesion.invitado, sub: "Marcada como devolución, sin cargar" })),
    ],
    herramienta: { tipo: "devoluciones" },
  });

  /* En el orden de la lista de Aldana. */
  const m = Object.fromEntries(MANUALES.dia.map((x) => [x.id, manual(x)]));
  return [banco, ingresos, cuotas, m["d-tareas"], m["d-proveedores"], m["d-slack"], m["d-financiera"], caja, m["d-pasarelas"], devoluciones];
}

/* ---------- La semana ---------- */

function pasosDeLaSemana(e: EstadoApp, ahora: number): PasoCierre[] {
  const hoyIso = new Date(ahora).toISOString();
  const semana = diasDeLaSemana(semanaDe(diaDeNegocio(hoyIso)));

  /* Actualizar Finanzas (ingresos y gastos): los fijos por aprobar y los gastos de la semana sin proveedor. */
  const fijos = gastosFijosPorAprobar(e, hoyIso).filter((p) => p.leToca);
  const sinProveedor = e.gastos.filter((g) => { const d = diaDeNegocio(g.fecha); return d >= semana.desde && d <= semana.hasta && !g.proveedor?.trim(); });
  const finanzas = auto({
    id: "s-finanzas", area: "gastos", titulo: "Actualizar Finanzas: ingresos y gastos",
    detalle: fijos.length + sinProveedor.length
      ? `${[fijos.length ? pl(fijos.length, "gasto fijo falta", "gastos fijos faltan") + " aprobar" : "", sinProveedor.length ? pl(sinProveedor.length, "gasto de la semana no dice", "gastos de la semana no dicen") + " a quién se le pagó" : ""].filter(Boolean).join(" · ")}.`
      : "Los gastos fijos están aprobados y cada gasto de la semana tiene su proveedor.",
    pendientes: [
      ...fijos.map((p) => ({ clave: `${p.plantilla.id}|${p.mes}`, titulo: p.plantilla.concepto, sub: `Gasto fijo · ${nombrePeriodo(p.mes)}`, monto: p.monto, moneda: p.plantilla.moneda })),
      ...sinProveedor.map((g) => ({ clave: g.id, titulo: g.concepto, sub: `Sin proveedor · ${g.categoria}`, monto: g.monto, moneda: g.moneda })),
    ],
    herramienta: fijos.length ? { tipo: "fijos" } : { tipo: "gastos" },
  });

  /* Control de cuentas por cobrar: hablar con los closers. Hay datos, y el paso es haberlos mirado. */
  const mora = cuotasVencidas(e).filter((c) => c.diasAtraso >= 7);
  const clientes = new Set(mora.map((c) => c.ventaId)).size;
  const total = mora.reduce((a, c) => a + c.saldo, 0);
  const cuentas = auto({
    id: "s-mora", area: "cobros", titulo: "Control de cuentas por cobrar", tipo: "revisable",
    detalle: mora.length
      ? `${pl(clientes, "cliente lleva", "clientes llevan")} 7 días o más de atraso, por US$ ${Math.round(total).toLocaleString("es-AR")}. Hablá con los closers para que cobren y que no se acumulen los atrasados.`
      : "Nadie lleva más de 7 días de atraso.",
    pendientes: mora.map((c) => ({ clave: c.cuotaId, titulo: c.contacto, sub: `Cuota ${c.numero} · ${c.diasAtraso} días de atraso`, monto: c.saldo })),
    herramienta: { tipo: "mora" },
  });

  const m = Object.fromEntries(MANUALES.semana.map((x) => [x.id, manual(x)]));
  return [m["s-weekly"], m["s-kpis-reportes"], finanzas, m["s-suscripciones"], cuentas, m["s-corte-financiera"], m["s-informe"], m["s-kpis-ceo"]];
}

/* ---------- El mes ---------- */

function pasosDelMesCompleto(e: EstadoApp, mes: string, { ahora, esDueno, chequeos }: Required<Opciones>): PasoCierre[] {
  const nombre = nombrePeriodo(mes).split(" ")[0].toLowerCase();
  /* Los pasos del cierre, sin el último: el de cerrar se arma al final, con todo lo que se agrega. */
  const base = pasosDelMes(e, mes, { ahora, esDueno }).filter((p) => p.id !== "cerrar");
  const calculados = consolidar(e, base, { nombre, conLlamadas: false, esDueno });

  const p = calcularPyL(e, rangoDeFechas(`${mes}-01`, `${mes}-${String(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5)), 0).getDate()).padStart(2, "0")}`, mes));
  const profit = manual(
    { id: "m-profit", area: "control", titulo: "Revisar el profit del mes", tipo: "revisable", herramienta: { tipo: "resultados" },
      detalle: `El profit neto de ${nombre} va en US$ ${Math.round(p.netoCC).toLocaleString("es-AR")} sobre lo cobrado. Revisalo antes de pasárselo a Nahuel, Agustín y Yari.` },
  );
  const manuales = MANUALES.mes.map((x) => manual(x));

  /* El pago del equipo es «asegurar que se pague en tiempo y forma». */
  const lista = [...calculados, profit, ...manuales];
  const terminado = mes < periodoDe(new Date(ahora));
  const cerrada = mesesCerrados(e).has(mes);
  const tildado = (x: PasoCierre) => (x.tipo === "manual" || x.tipo === "revisable") && !!chequeos[claveChequeo("mes", mes, x.id)];
  const previos = lista.filter((x) => x.estado === "pendiente" && !tildado(x) && !(x.soloDuenos && !esDueno)).length;
  lista.push({ ...pasoCerrar({ mes, nombre, previos, terminado, cerrada, hrefLiq: `/equipo?seccion=liquidacion&mes=${mes}`, esDueno }), herramienta: { tipo: "liquidacion" } });
  return lista;
}

/* ---------- Juntar los pasos que son lo mismo ---------- */

const URGENCIA: Record<EstadoPaso, number> = { pendiente: 3, "en-curso": 2, listo: 1, bloqueado: 0 };

/** Varios pasos hermanos en uno: lo que falta de cada uno sin repetir, el estado del más urgente y las pantallas de todos. */
function unir(hijos: PasoCierre[], p: { id: string; area: AreaPaso; titulo: string; ok: string; herramienta?: Herramienta; tambien?: Herramienta[]; progresoDe?: PasoCierre; nota?: string }): PasoCierre {
  const items = new Map<string, ItemPaso>();
  let mostrados = 0;
  for (const h of hijos) for (const it of h.items) { mostrados++; if (!items.has(it.clave)) items.set(it.clave, it); }
  /* Si un renglón está en dos pasos (un cobro sin validar y sin comprobante) se cuenta una vez. */
  const faltan = Math.max(items.size, hijos.reduce((a, h) => a + h.faltan, 0) - (mostrados - items.size));
  const conFalta = hijos.filter((h) => h.faltan > 0);
  const referencia = conFalta[0] ?? hijos[0];
  const estado = hijos.reduce<EstadoPaso>((a, h) => (URGENCIA[h.estado] > URGENCIA[a] ? h.estado : a), "listo");
  const detalle = (conFalta.length ? conFalta.map((h) => h.detalle).join(" ") : p.ok) + (p.nota ? ` ${p.nota}` : "");
  const hecho = p.progresoDe?.progreso;
  return {
    id: p.id, area: p.area, titulo: p.titulo, detalle, estado: faltan > 0 ? "pendiente" : estado,
    items: [...items.values()].slice(0, TOPE), faltan, ir: referencia.ir,
    progreso: hecho ? { hecho: Math.max(0, hecho.total - faltan), total: hecho.total } : undefined,
    herramienta: p.herramienta, tambien: p.tambien,
  };
}

/** De los pasos de siempre a los del mes de Aldana: lo que era el mismo trabajo en tres filas pasa a ser una. */
function consolidar(e: EstadoApp, pasos: PasoCierre[], { nombre, conLlamadas, esDueno }: { nombre: string; conLlamadas: boolean; esDueno: boolean }): PasoCierre[] {
  const por = new Map(pasos.map((x) => [x.id, x] as const));
  const de = (...ids: string[]) => ids.map((i) => por.get(i)).filter((x): x is PasoCierre => !!x);
  const fijoNoCargado = (e.gastosRecurrentes ?? []).length === 0;
  const salida: PasoCierre[] = [];

  salida.push(unir(de("ventas-embudo", "ventas-sin-cobro"), {
    id: "ventas-completas", area: "ventas", titulo: "Ventas completas: cada una con su embudo y su cobro",
    ok: `Todas las ventas de ${nombre} tienen su estrategia y al menos un cobro cargado.`, progresoDe: por.get("ventas-embudo"),
  }));

  const llamadas = por.get("llamadas-sin-cargar");
  if (conLlamadas && llamadas) salida.push(llamadas);

  salida.push(unir(de("movs-sin-atar", "reembolsos"), {
    id: "cobros-atar", area: "cobros", titulo: "Atar los cobros y los reembolsos de las pasarelas",
    ok: "Todo lo que entró y salió por las pasarelas está atado a su cuota o a su devolución.",
    herramienta: { tipo: "conciliacion" }, tambien: [{ tipo: "devoluciones" }],
  }));

  salida.push(unir(de("cobros-validar", "cobros-rechazados", "cobros-comprobante"), {
    id: "cobros-validar", area: "cobros", titulo: "Validar los cobros contra el comprobante",
    ok: `Todos los cobros de ${nombre} están validados, con su comprobante o conciliados con su pasarela, y ninguno está rechazado.`,
    herramienta: { tipo: "cobros", mostrar: "sin-chequear" }, progresoDe: por.get("cobros-validar"),
  }));

  for (const x of de("cuotas-mes", "pases", "arqueo")) salida.push({ ...x, herramienta: HERRAMIENTA_DEL_MES[x.id] });

  const fijos = por.get("gastos-fijos");
  salida.push(unir(de("gastos-fijos", "gastos-proveedor"), {
    id: "gastos", area: "gastos", titulo: "Gastos: los fijos aprobados y cada uno con su proveedor",
    ok: `Los gastos fijos están aprobados o salteados y cada gasto de ${nombre} tiene su proveedor.`,
    herramienta: fijos && fijos.faltan > 0 ? { tipo: "fijos" } : { tipo: "gastos" },
    tambien: [fijos && fijos.faltan > 0 ? { tipo: "gastos" } : { tipo: "fijos" }], progresoDe: por.get("gastos-proveedor"),
    nota: fijoNoCargado ? "Ojo: todavía no hay ningún gasto fijo cargado, así que no hay nada para aprobar." : undefined,
  }));

  /* Las llamadas sin cargar dejan de ser un paso del mes: es el cierre del día de los closers. Pero frenan las comisiones, y se avisa donde se liquida. */
  for (const x of de("liq-revisar", "liq-pagar")) {
    const aviso = x.id === "liq-revisar" && llamadas && llamadas.faltan > 0 && (esDueno || !x.soloDuenos) ? ` Ojo: ${llamadas.detalle}` : "";
    salida.push({ ...x, detalle: x.detalle + aviso, herramienta: HERRAMIENTA_DEL_MES[x.id] });
  }
  return salida;
}

/* ---------- Un rango de fechas ---------- */

/** «De tal día a tal día»: los pasos que se calculan con lo cargado en esos días. Los que se tildan (la weekly, Slack…) son de
 *  cada día, semana o mes y no tienen sentido para un rango; tampoco la liquidación ni el cierre, que son de un mes. */
function pasosDelRango(e: EstadoApp, periodo: string, { ahora, esDueno }: Required<Omit<Opciones, "chequeos">>): PasoCierre[] {
  const { desde, hasta } = diasDelRango(periodo);
  const pasos = pasosDelTramo(e, tramoDeDias(desde, hasta), { ahora, esDueno });
  return consolidar(e, pasos, { nombre: "ese período", conLlamadas: true, esDueno });
}

/** Cuántos pasos están listos de los que cuentan para quien mira. */
export function avanceDeFinanzas(pasos: PasoCierre[], esDueno: boolean): { listos: number; total: number } {
  const cuentan = pasos.filter((p) => esDueno || !p.soloDuenos);
  return { listos: cuentan.filter((p) => p.estado === "listo").length, total: cuentan.length };
}
