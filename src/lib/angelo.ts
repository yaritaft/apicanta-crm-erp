import type {
  Contacto, Cuota, Embudo, EstadoApp, ID, IngresoComunidad, Lead, MiembroEquipo, Pago, Procesador,
  Producto, TipoVentaPago, Venta, Webinar,
} from "./types";

/* ==================================================================
   La planilla de Angelo ("Centro de control Apicanta LLC", hoja Ventas).

   Hasta ahora las ventas se cargaban ahí: una fila por cobro, con los
   datos de la venta repetidos en cada fila. Este módulo es el puente:
   el mismo vocabulario (encabezados, listas, valores exactos), cómo se
   calcula lo que la planilla guarda como texto ("Característica de pago",
   "Ventas Nuevas vs Cuotas"), el importador de la hoja y la exportación
   con su misma forma.

   Sin imports en tiempo de ejecución a propósito: así la migración corre
   este mismo archivo con Node, fuera de la app, y no hay dos versiones de
   la regla que decide qué fila es de qué venta.
   ================================================================== */

/* ---------- Vocabulario ---------- */

/** Los encabezados de la hoja Ventas, en orden (columnas A a AJ). */
export const COLUMNAS_VENTAS = [
  "Fecha del pago", "Mes", "Nombre Completo", "Email", "País del cliente", "Teléfono", "Vendedor",
  "Cuentas por cobrar", "Servicio adquirido", "Proyecto", "Estrategia utilizada", "Tipo de pago",
  "Plan de pago", "Característica de pago", "Ventas Nuevas vs Cuotas", "Cuenta recaudadora",
  "Valor total de la venta", "Monto abonado USD", "Pasado Financiera / Chequeado en plataforma",
  "Monto abonado ARS", "Tipo de cambio ARS", "Nombre de quien transfirió", "Cuit (Si pagó a financiera)",
  "Tasa de procesamiento", "Tasa de streaming HM", "Costo total de procesamiento", "Comprobante",
  "Observaciones / Plan de pagos", "¿Tuvo setter?", "Nombre del setter", "Comisión del setter $",
  "¿Es referido?", "Nombre del referidor", "Número de teléfono", "Comisión referidor $",
  "Ingreso a la comunidad",
] as const;

export const CARACTERISTICAS = [
  "Reserva", "Cuota #1", "Cuota #2", "Cuota #3", "Cuota #4", "Cuota #5", "Cuota #6",
  "Paid in full", "Pago completado", "Reembolso",
] as const;

export const TIPOS_VENTA_PAGO: TipoVentaPago[] = ["Venta Nueva", "Cuota", "Solo Reserva"];
export const TIPOS_DE_PAGO = ["Contado", "Cuotas", "Solo Reserva", "Se dio de baja", "Reembolso"] as const;
export const INGRESOS_COMUNIDAD: IngresoComunidad[] = ["Si", "No", "En espera", "N/A"];

/** "País del cliente": la lista de la hoja Configuración, tal cual. */
export const PAISES = [
  "Argentina", "Australia", "Austria", "Bélgica", "Bolivia", "Brasil", "Bulgaria", "Canadá",
  "Chile", "China", "Colombia", "Corea del Sur", "Costa Rica", "Croacia", "Cuba", "Dinamarca",
  "Ecuador", "Egipto", "El Salvador", "Emiratos Árabes Unidos", "Eslovaquia", "Eslovenia", "España",
  "Estados Unidos", "Estonia", "Etiopía", "Filipinas", "Finlandia", "Francia", "Gales", "Georgia",
  "Ghana", "Grecia", "Guatemala", "Haití", "Honduras", "Hungría", "India", "Indonesia", "Irak",
  "Irán", "Irlanda", "Islandia", "Islas Maldivas", "Israel", "Italia", "Jamaica", "Japón", "Jordania",
  "Kazajistán", "Kenia", "Kirguistán", "Letonia", "Líbano", "Lituania", "Luxemburgo", "Malasia",
  "Malta", "Marruecos", "México", "Moldavia", "Mongolia", "Mozambique", "Namibia", "Nepal", "Nicaragua",
  "Nigeria", "Noruega", "Nueva Zelanda", "Omán", "Países Bajos", "Pakistán", "Panamá", "Paraguay",
  "Perú", "Polonia", "Portugal", "Qatar", "Reino Unido", "República Checa", "República Dominicana",
  "Rumania", "Rusia", "Senegal", "Serbia", "Singapur", "Siria", "Sri Lanka", "Sudáfrica", "Suecia",
  "Suiza", "Tailandia", "Tanzania", "Túnez", "Turquía", "Ucrania", "Uganda", "Uruguay", "Uzbekistán",
  "Venezuela", "Vietnam", "Yemen", "Zambia", "Zimbabue",
];

/* ---------- Lo que la planilla guarda como texto, calculado ---------- */

const r2 = (n: number) => Math.round(n * 100) / 100;
const vale = (c: Cuota) => c.estado !== "cancelada";

/** La "Característica de pago" de un cobro, en el momento en que entra.
 *  - La reserva es "Reserva".
 *  - El cobro que salda la venta es "Paid in full" si es el primero (se
 *    pagó de contado) y "Pago completado" si cierra un plan en cuotas.
 *  - El resto es "Cuota #n", por la cuota que paga.
 *  Un cobro partido en varios medios lleva la misma en cada parte: así
 *  lo carga la planilla (800 + 2.000 + 50, los tres "Paid in full"). */
export function caracteristicaDePago(o: {
  cuota: Cuota;
  cuotasVenta: Cuota[];
  /* Lo que ya estaba cobrado de la venta, sin este cobro. */
  cobradoAntes: number;
  /* Lo que entra ahora en la venta, contando este cobro y los que vienen
     con él (el alta de una venta trae varios juntos). */
  cobradoAhora: number;
}): string {
  if (o.cuota.esReserva) return "Reserva";
  const total = r2(o.cuotasVenta.filter(vale).reduce((a, c) => a + c.monto, 0));
  const salda = total > 0 && r2(o.cobradoAntes + o.cobradoAhora) >= total - 0.01;
  if (salda) {
    const regularesAntes = o.cobradoAntes - o.cuotasVenta
      .filter((c) => c.esReserva && vale(c)).reduce((a, c) => a + c.monto, 0);
    return regularesAntes > 0.01 ? "Pago completado" : "Paid in full";
  }
  return `Cuota #${Math.max(1, o.cuota.numero)}`;
}

/** "Ventas Nuevas vs Cuotas": lo que entra con el alta de la venta es
 *  "Venta Nueva"; lo que entra después, "Cuota". Una venta que es sólo
 *  una reserva es "Solo Reserva". */
export function tipoVentaDePago(o: { cuotasVenta: Cuota[]; esAlta: boolean }): TipoVentaPago {
  const regulares = o.cuotasVenta.filter((c) => !c.esReserva && vale(c));
  if (regulares.length === 0) return "Solo Reserva";
  return o.esAlta ? "Venta Nueva" : "Cuota";
}

/** Si pagó en pesos: lo que entró en ARS, como la planilla (USD × TC). */
export function montoArsDe(montoUsd: number, tipoCambio?: number): number | undefined {
  return tipoCambio && tipoCambio > 0 ? r2(montoUsd * tipoCambio) : undefined;
}

/** "Tipo de pago" de la venta: Contado, Cuotas, Solo Reserva, Se dio de
 *  baja o Reembolso. */
export function tipoDePago(v: Venta, cuotasVenta: Cuota[]): string {
  if (v.estado === "cancelada") return "Se dio de baja";
  if (v.estado === "reembolsada") return "Reembolso";
  const regulares = cuotasVenta.filter((c) => !c.esReserva);
  if (regulares.length === 0) return "Solo Reserva";
  return regulares.length === 1 ? "Contado" : "Cuotas";
}

/** "Plan de pago": "1 Cuota", "3 Cuotas"… o "Se dio de baja". */
export function planDePago(v: Venta, cuotasVenta: Cuota[]): string {
  if (v.estado === "cancelada" || v.estado === "reembolsada") return "Se dio de baja";
  const n = Math.max(1, cuotasVenta.filter((c) => !c.esReserva).length);
  return n === 1 ? "1 Cuota" : `${n} Cuotas`;
}

/** Una venta que es sólo una reserva: no es una venta para Yari ("una
 *  reserva no la considero una venta"), aunque la plata haya entrado. */
export function esSoloReserva(cuotasVenta: Cuota[]): boolean {
  return cuotasVenta.length > 0 && cuotasVenta.every((c) => c.esReserva);
}

/* ---------- Proyecto ↔ webinar ---------- */

const dosDigitos = (n: number) => String(n).padStart(2, "0");

/** El proyecto de un webinar, como los nombra la planilla: WEB-13/04/26. */
export function proyectoDeWebinar(fechaIso: string): string {
  const d = new Date(fechaIso);
  return `WEB-${dosDigitos(d.getDate())}/${dosDigitos(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)}`;
}

/** El webinar de un proyecto WEB-día/mes(/año). Los viejos no traen el año
 *  ("WEB-1/10"): se toma el webinar de ese día y mes más cercano a la
 *  fecha de la venta. */
export function webinarDeProyecto(proyecto: string | undefined, webinars: Webinar[], fechaVenta?: string): Webinar | undefined {
  const m = /^WEB-(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/i.exec((proyecto ?? "").trim());
  if (!m) return undefined;
  const dia = Number(m[1]), mes = Number(m[2]);
  const anio = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : undefined;
  const candidatos = webinars.filter((w) => {
    const d = new Date(w.fecha);
    return d.getDate() === dia && d.getMonth() + 1 === mes && (anio === undefined || d.getFullYear() === anio);
  });
  if (candidatos.length <= 1 || !fechaVenta) return candidatos[0];
  const t = new Date(fechaVenta).getTime();
  return [...candidatos].sort((a, b) => Math.abs(+new Date(a.fecha) - t) - Math.abs(+new Date(b.fecha) - t))[0];
}


/* ==================================================================
   Importador de la hoja Ventas

   La hoja es un libro de cobros: una fila por pago, con los datos de la
   venta repetidos. Reglas, sacadas de los datos (no de una suposición):

   - La fila con "Valor total de la venta" > 0 abre una venta; las que
     siguen de la misma persona y el mismo servicio con valor 0 son cobros
     de esa venta (un pago partido en varios medios, las cuotas, una cuota
     pagada en partes).
   - Una reserva suelta ("Solo Reserva") seguida de una venta del mismo
     servicio es la seña de esa venta.
   - Cada cobro va a su cuota por su "Característica de pago": Reserva a
     la reserva, "Cuota #n" a la n, "Paid in full" a la única, y "Pago
     completado" a la que cierra el plan.
   - Lo que falta cobrar es el valor total menos lo cobrado, como lo calcula
     la hoja Estado_Clientes: "Paid in full" o "Pago completado" son la
     etiqueta del pago, no una condonación, y una reserva con el valor del
     programa deja el resto por cobrar. Se arma en cuotas pendientes que
     vencen cada 30 días desde el último pago (el plazo de la hoja Config)
     o desde la próxima fecha estimada, si viene (Estado_Clientes).
   - Una venta que se dio de baja conserva sus cuotas, canceladas: borrado
     lógico, como pidió Yari.

   Los ids salen del contenido de la fila, no de su posición: importar la
   misma planilla dos veces actualiza en vez de duplicar, así se puede
   seguir cargando en la planilla mientras conviven las dos.
   ================================================================== */

export interface FilaVentas {
  /* El número de fila en la hoja, para los avisos. */
  fila: number;
  fecha: string;
  nombre: string;
  email: string;
  pais: string;
  telefono: string;
  vendedor: string;
  servicio: string;
  proyecto: string;
  estrategia: string;
  tipoPago: string;
  plan: string;
  caracteristica: string;
  tipoVenta: string;
  cuenta: string;
  valorTotal: number;
  montoUsd: number;
  chequeado: boolean;
  montoArs?: number;
  tipoCambio?: number;
  pagador: string;
  cuit: string;
  comprobante: string;
  observaciones: string;
  setter: string;
  referidor: string;
  referidorTelefono: string;
  ingresoComunidad: string;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
export const normalizarTexto = (s: string) => sinTildes(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/** Un número como lo escribe una planilla en español o en inglés:
 *  "2.128", "2.128,50", "$ 2,128.50", "2128.5". */
export function numeroPlanilla(crudo: string | number | undefined | null): number {
  if (typeof crudo === "number") return Number.isFinite(crudo) ? crudo : 0;
  if (!crudo) return 0;
  const negativo = /^\s*-|\(.*\)/.test(crudo);
  const s = crudo.replace(/[^\d,.]/g, "");
  if (!s) return 0;
  const coma = s.lastIndexOf(","), punto = s.lastIndexOf(".");
  let limpio: string;
  if (coma > -1 && punto > -1) {
    limpio = coma > punto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (coma > -1) {
    /* Sólo comas: decimal si lo que sigue a la última no son 3 dígitos. */
    const partes = s.split(",");
    limpio = partes.length > 2 || partes[partes.length - 1].length === 3 ? partes.join("") : s.replace(",", ".");
  } else if (punto > -1) {
    const partes = s.split(".");
    limpio = partes.length > 2 || partes[partes.length - 1].length === 3 ? partes.join("") : s;
  } else limpio = s;
  const n = Number(limpio);
  return Number.isFinite(n) ? (negativo ? -n : n) : 0;
}

/** Una fecha de la planilla ("13/8/2025", "2025-08-13", "2025-08-13
 *  00:00:00") como el mediodía de Argentina de ese día: así cae en el día
 *  correcto en cualquier huso. */
export function fechaPlanilla(crudo: string): string | null {
  const t = (crudo ?? "").trim();
  if (!t) return null;
  /* El serial de Excel (días desde el 30/12/1899), como viene del .xlsx. */
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const f = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(t)) * 86400000);
    return `${f.getUTCFullYear()}-${String(f.getUTCMonth() + 1).padStart(2, "0")}-${String(f.getUTCDate()).padStart(2, "0")}T15:00:00.000Z`;
  }
  let y: number, m: number, d: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(t);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = dmy[3].length === 2 ? 2000 + +dmy[3] : +dmy[3]; }
  else return null;
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00.000Z`;
}

const siNo = (s: string) => /^(true|verdadero|si|sí|x|1|yes)$/i.test((s ?? "").trim());

/** Las filas de la hoja a partir de la tabla (la primera fila son los
 *  encabezados). Las columnas se buscan por nombre: el orden no importa. */
export function leerFilasVentas(tabla: string[][]): { filas: FilaVentas[]; faltan: string[] } {
  if (tabla.length === 0) return { filas: [], faltan: [...COLUMNAS_VENTAS] };
  const cab = tabla[0].map((h) => normalizarTexto(h));
  const col = (nombre: string) => cab.indexOf(normalizarTexto(nombre));
  const imprescindibles = ["Fecha del pago", "Email", "Servicio adquirido", "Monto abonado USD", "Valor total de la venta"];
  const faltan = imprescindibles.filter((n) => col(n) < 0);
  if (faltan.length) return { filas: [], faltan };
  const idx: Record<string, number> = {};
  for (const n of COLUMNAS_VENTAS) idx[n] = col(n);
  const v = (fila: string[], n: string) => (idx[n] >= 0 ? (fila[idx[n]] ?? "").trim() : "");

  const filas: FilaVentas[] = [];
  tabla.slice(1).forEach((f, k) => {
    const fecha = fechaPlanilla(v(f, "Fecha del pago"));
    if (!fecha) return;
    const tc = numeroPlanilla(v(f, "Tipo de cambio ARS"));
    const ars = numeroPlanilla(v(f, "Monto abonado ARS"));
    filas.push({
      fila: k + 2, fecha,
      nombre: v(f, "Nombre Completo"), email: v(f, "Email").toLowerCase(),
      pais: v(f, "País del cliente"), telefono: v(f, "Teléfono"),
      vendedor: v(f, "Vendedor"), servicio: v(f, "Servicio adquirido"),
      proyecto: v(f, "Proyecto"), estrategia: v(f, "Estrategia utilizada"),
      tipoPago: v(f, "Tipo de pago"), plan: v(f, "Plan de pago"),
      caracteristica: v(f, "Característica de pago"), tipoVenta: v(f, "Ventas Nuevas vs Cuotas"),
      cuenta: v(f, "Cuenta recaudadora"),
      valorTotal: numeroPlanilla(v(f, "Valor total de la venta")),
      montoUsd: numeroPlanilla(v(f, "Monto abonado USD")),
      chequeado: siNo(v(f, "Pasado Financiera / Chequeado en plataforma")),
      montoArs: tc > 0 && ars > 0 ? ars : undefined,
      tipoCambio: tc > 0 ? tc : undefined,
      pagador: v(f, "Nombre de quien transfirió"), cuit: v(f, "Cuit (Si pagó a financiera)"),
      comprobante: v(f, "Comprobante"), observaciones: v(f, "Observaciones / Plan de pagos"),
      setter: v(f, "Nombre del setter"), referidor: v(f, "Nombre del referidor"),
      referidorTelefono: v(f, "Número de teléfono"), ingresoComunidad: v(f, "Ingreso a la comunidad"),
    });
  });
  return { filas, faltan: [] };
}

/** La "Próxima fecha estimada de pagos" de la hoja Estado_Clientes, por
 *  persona y servicio: es la que el equipo de cobranza escribe a mano, y
 *  es el vencimiento de la primera cuota pendiente al importar. */
export function proximasFechasDesde(tabla: string[][] | null): Map<string, string> {
  const out = new Map<string, string>();
  if (!tabla || tabla.length < 2) return out;
  const cab = tabla[0].map((h) => normalizarTexto(h));
  const email = cab.indexOf("email"), servicio = cab.indexOf("servicio adquirido");
  const fecha = cab.findIndex((h) => h.startsWith("proxima fecha estimada"));
  if (email < 0 || servicio < 0 || fecha < 0) return out;
  for (const f of tabla.slice(1)) {
    const d = fechaPlanilla(f[fecha] ?? "");
    const e = (f[email] ?? "").trim().toLowerCase();
    if (d && e) out.set(`${e}|${normalizarTexto(f[servicio] ?? "")}`, d);
  }
  return out;
}

/* Un id estable a partir de un texto: FNV-1a de 32 bits, en base 36. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export interface AvisoImport { tipo: string; texto: string; filas: number[] }

export interface ResultadoImport {
  contactos: Contacto[];
  /* La venta cuelga de un lead (en la base, ventas.contactoId → leads):
     quien compró y no tenía uno queda como lead inscripto, como hace el
     asistente de venta. */
  leads: Lead[];
  ventas: Venta[];
  cuotas: Cuota[];
  pagos: Pago[];
  /* Cuotas de ventas ya importadas que el plan nuevo ya no tiene. */
  cuotasQueSobran: ID[];
  /* Lo que la planilla nombra y la app no tenía: se crea. */
  equipo: MiembroEquipo[];
  productos: Producto[];
  procesadores: Procesador[];
  embudos: Embudo[];
  proyectos: string[];
  avisos: AvisoImport[];
  resumen: {
    filas: number; personas: number; personasNuevas: number; ventas: number; cobros: number;
    cuotasPendientes: number; cobrado: number; facturado: number; porCobrar: number;
  };
}

export interface OpcionesImport {
  /* "email|servicio" → próxima fecha estimada de pago (hoja Estado_Clientes). */
  proximasFechas?: Map<string, string>;
  /* Servicios sobre los que comisiona el director (hoja Config). */
  serviciosDirector?: string[];
  /* Días entre cuotas (hoja Config: DIAS_PLAZO_CUOTA). */
  diasEntreCuotas?: number;
}

type Grupo = { filas: FilaVentas[]; soloReserva: boolean };

export function importarPlanilla(e: EstadoApp, filasCrudas: FilaVentas[], opciones: OpcionesImport = {}): ResultadoImport {
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const avisos = new Map<string, AvisoImport>();
  const avisar = (tipo: string, texto: string, fila?: number) => {
    const a = avisos.get(tipo) ?? { tipo, texto, filas: [] };
    if (fila) a.filas.push(fila);
    avisos.set(tipo, a);
  };
  const dias = opciones.diasEntreCuotas ?? 30;
  const serviciosDirector = new Set((opciones.serviciosDirector ?? ["Mentoría", "Upsell"]).map(normalizarTexto));

  /* ---------- Catálogos: por nombre, y lo que falta se crea ---------- */
  const equipo = [...e.equipo], productos = [...e.productos], procesadores = [...e.procesadores], embudos = [...e.embudos];
  const creados = { equipo: [] as MiembroEquipo[], productos: [] as Producto[], procesadores: [] as Procesador[], embudos: [] as Embudo[] };

  const miembro = (nombre: string, rol: "closer" | "setter", fila: number): MiembroEquipo | undefined => {
    const n = normalizarTexto(nombre);
    if (!n) return undefined;
    const exacto = equipo.find((x) => normalizarTexto(x.nombre) === n);
    if (exacto) return exacto;
    /* "Yari" en la planilla es "Yari Taft" en la app, si hay uno solo así. */
    const empieza = equipo.filter((x) => normalizarTexto(x.nombre).split(" ")[0] === n);
    if (empieza.length === 1) return empieza[0];
    const nuevo: MiembroEquipo = {
      id: `eq_ef_${hash(n)}`, nombre: nombre.trim(), rol, comisionRate: rol === "setter" ? 0.1 : 0.15,
      activo: true, sinComision: false,
      notas: "Lo trajo la planilla de Angelo: revisá lo que cobra en Equipo y honorarios.",
    };
    equipo.push(nuevo); creados.equipo.push(nuevo);
    avisar(`nuevo-${rol}`, `${rol === "setter" ? "Setters" : "Vendedores"} que no estaban en el equipo: se agregaron con ${rol === "setter" ? "10" : "15"}% de comisión.`, fila);
    return nuevo;
  };
  const producto = (nombre: string, fila: number): Producto | undefined => {
    const n = normalizarTexto(nombre);
    if (!n) return undefined;
    const x = productos.find((p) => normalizarTexto(p.nombre) === n);
    if (x) return x;
    const nuevo: Producto = { id: `prod_ef_${hash(n)}`, nombre: nombre.trim(), precioLista: 0, tipo: "principal", activo: true, orden: productos.length };
    productos.push(nuevo); creados.productos.push(nuevo);
    avisar("nuevo-servicio", "Servicios que no estaban en la lista: se agregaron como Programa (revisalos en Ajustes → Ventas).", fila);
    return nuevo;
  };
  const cuenta = (nombre: string, fila: number): Procesador | undefined => {
    const n = normalizarTexto(nombre);
    if (!n) return undefined;
    const x = procesadores.find((p) => normalizarTexto(p.nombre) === n);
    if (x) return x;
    const nuevo: Procesador = { id: `proc_ef_${hash(n)}`, nombre: nombre.trim(), feeRate: 0, activo: true, automatico: false };
    procesadores.push(nuevo); creados.procesadores.push(nuevo);
    avisar("nueva-cuenta", "Cuentas recaudadoras que no estaban: se agregaron sin comisión.", fila);
    return nuevo;
  };
  const estrategia = (nombre: string, fila: number): Embudo | undefined => {
    const n = normalizarTexto(nombre);
    if (!n) return undefined;
    const x = embudos.find((p) => normalizarTexto(p.nombre) === n);
    if (x) return x;
    const nuevo: Embudo = { id: `emb_ef_${hash(n)}`, nombre: nombre.trim(), activo: true, orden: embudos.length };
    embudos.push(nuevo); creados.embudos.push(nuevo);
    avisar("nueva-estrategia", "Estrategias que no estaban: se agregaron.", fila);
    return nuevo;
  };

  /* ---------- Personas ---------- */
  const contactoPorEmail = new Map(e.contactos.filter((c) => c.email).map((c) => [c.email.trim().toLowerCase(), c]));
  const contactosNuevos = new Map<string, Contacto>();
  const personaDe = (f: FilaVentas): Contacto => {
    const clave = f.email || `sin-email:${normalizarTexto(f.nombre)}`;
    const existente = f.email ? contactoPorEmail.get(f.email) : undefined;
    if (existente) return existente;
    const ya = contactosNuevos.get(clave);
    if (ya) {
      /* Se completa con lo que traigan las filas siguientes. */
      if (!ya.pais && f.pais) ya.pais = f.pais;
      if (!ya.telefono && f.telefono) ya.telefono = f.telefono;
      if (!ya.nombre && f.nombre) ya.nombre = f.nombre;
      return ya;
    }
    const nuevo: Contacto = {
      id: `con_ef_${hash(clave)}`, nombre: f.nombre || f.email, email: f.email,
      telefono: f.telefono || undefined, pais: f.pais || undefined,
      creadoEn: f.fecha, extra: {},
    };
    if (!f.email) avisar("sin-email", "Cobros sin email: la persona se identificó por el nombre.", f.fila);
    contactosNuevos.set(clave, nuevo);
    return nuevo;
  };

  /* La oportunidad de la persona: la que ya tenía (la más nueva) o una
     inscripta nueva, etiquetada para encontrarla. */
  const leadDeContacto = new Map<ID, Lead>();
  for (const l of e.leads ?? []) {
    const c = l.contactoId ?? l.id;
    const previo = leadDeContacto.get(c);
    if (!previo || l.creadoEn > previo.creadoEn) leadDeContacto.set(c, l);
  }
  const ganada = (e.etapas ?? []).find((x) => x.esGanada)?.id ?? (e.etapas ?? [])[0]?.id ?? "";
  const leadsNuevos = new Map<ID, Lead>();
  const leadDe = (persona: Contacto, venta: { fecha: string; precio: number; vendedor: string; estrategia: string; webinarId?: ID }): Lead => {
    const ya = leadDeContacto.get(persona.id) ?? leadsNuevos.get(persona.id);
    if (ya) return ya;
    const nuevo: Lead = {
      id: `lead_ef_${hash(persona.id)}`, contactoId: persona.id,
      nombre: persona.nombre, email: persona.email, telefono: persona.telefono, pais: persona.pais,
      fuente: venta.estrategia, etapaId: ganada, monto: venta.precio, moneda: "USD",
      responsable: venta.vendedor, etiquetas: ["Planilla de Angelo"], webinarId: venta.webinarId,
      creadoEn: venta.fecha, actualizadoEn: venta.fecha, extra: {},
    };
    leadsNuevos.set(persona.id, nuevo);
    return nuevo;
  };

  /* ---------- Filas → ventas ---------- */
  const ordenadas = [...filasCrudas].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.fila - b.fila);
  const porGrupo = new Map<string, FilaVentas[]>();
  for (const f of ordenadas) {
    const clave = `${f.email || normalizarTexto(f.nombre)}|${normalizarTexto(f.servicio)}`;
    porGrupo.set(clave, [...(porGrupo.get(clave) ?? []), f]);
  }

  const grupos: Grupo[] = [];
  for (const filas of porGrupo.values()) {
    let abierta: Grupo | null = null;
    for (const f of filas) {
      const esSoloReserva = normalizarTexto(f.tipoVenta) === "solo reserva";
      if (f.valorTotal > 0) {
        /* La reserva suelta que precede a la venta es su seña. */
        if (abierta?.soloReserva && !esSoloReserva) {
          abierta.filas.push(f);
          abierta.soloReserva = false;
          avisar("reserva-y-venta", "Reservas sueltas seguidas de la venta: la reserva quedó como la seña de esa venta.", f.fila);
          continue;
        }
        abierta = { filas: [f], soloReserva: esSoloReserva };
        grupos.push(abierta);
      } else if (abierta) {
        abierta.filas.push(f);
        if (!esSoloReserva) abierta.soloReserva = false;
      } else {
        abierta = { filas: [f], soloReserva: esSoloReserva };
        grupos.push(abierta);
        if (f.montoUsd > 0 && !esSoloReserva) {
          avisar("sin-apertura", "Cobros sin la fila de la venta (empezó antes que la planilla): la venta se armó con lo cobrado.", f.fila);
        }
      }
    }
  }

  const ventas: Venta[] = [], cuotas: Cuota[] = [], pagos: Pago[] = [];
  const usados = new Map<string, number>();
  const idUnico = (base: string) => {
    const n = usados.get(base) ?? 0;
    usados.set(base, n + 1);
    return n === 0 ? base : `${base}_${n}`;
  };
  const director = equipo.find((x) => x.rol === "director" && x.activo);
  const idsContactos = new Set<string>();

  for (const g of grupos) {
    const apertura = g.filas.find((f) => f.valorTotal > 0) ?? g.filas[0];
    const ultima = g.filas[g.filas.length - 1];
    const persona = personaDe(apertura);
    idsContactos.add(persona.id);
    const cobradas = g.filas.filter((f) => f.montoUsd > 0);
    const cobrado = r2(cobradas.reduce((a, f) => a + f.montoUsd, 0));

    const tipoFinal = normalizarTexto(ultima.tipoPago);
    const caractFinal = normalizarTexto(ultima.caracteristica);
    const estado: Venta["estado"] = tipoFinal === "reembolso" || caractFinal === "reembolso"
      ? "reembolsada"
      : tipoFinal === "se dio de baja" || normalizarTexto(ultima.plan) === "se dio de baja" ? "cancelada" : "activa";

    /* Sin fila de apertura (la venta empezó antes que la planilla) no se
       sabe el valor total: se toma lo cobrado. */
    const valorTotal = apertura.valorTotal > 0 ? apertura.valorTotal : cobrado;
    if (g.soloReserva && apertura.valorTotal > cobrado + 0.5 && estado === "activa") {
      avisar("reserva-con-saldo", "Reservas con el valor del programa: quedan con la seña cobrada y el resto por cobrar, como en Estado_Clientes.", apertura.fila);
    }

    const closer = miembro(apertura.vendedor || g.filas.find((f) => f.vendedor)?.vendedor || "", "closer", apertura.fila);
    const prod = producto(apertura.servicio, apertura.fila);
    const emb = estrategia(apertura.estrategia || g.filas.find((f) => f.estrategia)?.estrategia || "", apertura.fila);
    const setterNombre = g.filas.find((f) => f.setter)?.setter ?? "";
    const setter = setterNombre ? miembro(setterNombre, "setter", apertura.fila) : undefined;
    const referidor = g.filas.find((f) => f.referidor);
    const proyecto = apertura.proyecto || g.filas.find((f) => f.proyecto)?.proyecto || "";
    const comunidad = [...g.filas].reverse().find((f) => f.ingresoComunidad)?.ingresoComunidad ?? "";
    const observaciones = [...new Set(g.filas.map((f) => f.observaciones).filter(Boolean))].join("\n");
    const sinComision = Boolean(closer?.sinComision);
    const conDirector = Boolean(director && !sinComision && prod && serviciosDirector.has(normalizarTexto(prod.nombre))
      && (!director.desde || apertura.fecha >= director.desde));

    const ventaId = idUnico(`ven_ef_${hash(`${persona.id}|${normalizarTexto(apertura.servicio)}|${apertura.fecha}|${apertura.valorTotal}|${apertura.montoUsd}`)}`);
    const webinarId = webinarDeProyecto(proyecto, e.webinars, apertura.fecha)?.id;
    const lead = leadDe(persona, {
      fecha: apertura.fecha, precio: valorTotal, vendedor: closer?.nombre ?? "",
      estrategia: emb?.nombre ?? "", webinarId,
    });
    const venta: Venta = {
      id: ventaId, contactoId: lead.id, contactoNombre: persona.nombre || apertura.nombre,
      productoId: prod?.id, webinarId,
      embudoId: emb?.id, precioAcordado: r2(valorTotal), moneda: "USD",
      closerId: closer?.id, directorId: conDirector ? director!.id : undefined,
      excluidoMarketing: sinComision, estado, fecha: apertura.fecha,
      notas: observaciones || undefined, creadoEn: apertura.fecha,
      extra: {
        planilla: true, filasPlanilla: g.filas.map((f) => f.fila),
        ...(apertura.valorTotal !== valorTotal ? { valorTotalPlanilla: apertura.valorTotal } : {}),
      },
      proyecto: proyecto || undefined, setterId: setter?.id,
      referidorNombre: referidor?.referidor || undefined, referidorTelefono: referidor?.referidorTelefono || undefined,
      ingresoComunidad: (INGRESOS_COMUNIDAD as string[]).includes(comunidad) ? comunidad as IngresoComunidad : undefined,
    };
    ventas.push(venta);

    /* ---------- Cada cobro a su cuota ---------- */
    type Linea = { numero: number; esReserva: boolean; pagos: FilaVentas[] };
    const lineas = new Map<string, Linea>();
    const linea = (numero: number, esReserva: boolean) => {
      const k = esReserva ? "R" : String(numero);
      let l = lineas.get(k);
      if (!l) { l = { numero, esReserva, pagos: [] }; lineas.set(k, l); }
      return l;
    };
    let ultimaCuota = 0;
    for (const f of cobradas) {
      const c = normalizarTexto(f.caracteristica);
      const n = /cuota #?(\d+)/.exec(c);
      if (c === "reserva" || (g.soloReserva && !n)) linea(0, true).pagos.push(f);
      else if (n) { const k = Number(n[1]); linea(k, false).pagos.push(f); ultimaCuota = Math.max(ultimaCuota, k); }
      else if (c === "paid in full") { linea(Math.max(1, ultimaCuota || 1), false).pagos.push(f); ultimaCuota = Math.max(ultimaCuota, 1); }
      else if (c === "pago completado") {
        /* Cierra el plan: va a la cuota que sigue a la última pagada, salvo
           que venga partido (varias filas el mismo día). */
        const previa = [...lineas.values()].find((l) => !l.esReserva && l.pagos.some((p) => normalizarTexto(p.caracteristica) === "pago completado"));
        const k = previa ? previa.numero : ultimaCuota + 1;
        linea(k, false).pagos.push(f); ultimaCuota = Math.max(ultimaCuota, k);
      } else { const k = Math.max(1, ultimaCuota || 1); linea(k, false).pagos.push(f); ultimaCuota = Math.max(ultimaCuota, k); }
    }

    const cuotasVenta: Cuota[] = [];
    for (const l of [...lineas.values()].sort((a, b) => Number(b.esReserva) - Number(a.esReserva) || a.numero - b.numero)) {
      const monto = r2(l.pagos.reduce((a, f) => a + f.montoUsd, 0));
      const cuota: Cuota = {
        id: `cuo_ef_${hash(`${ventaId}|${l.esReserva ? "R" : l.numero}`)}`, ventaId,
        numero: l.esReserva ? 0 : l.numero, monto, vence: l.pagos[0].fecha, estado: "pagada", esReserva: l.esReserva,
      };
      cuotasVenta.push(cuota);
      for (const f of l.pagos) {
        const proc = cuenta(f.cuenta, f.fila);
        if (!proc) avisar("sin-cuenta", "Cobros sin cuenta recaudadora.", f.fila);
        const fee = r2(f.montoUsd * (proc?.feeRate ?? 0));
        pagos.push({
          id: idUnico(`pag_ef_${hash(`${persona.id}|${f.fecha}|${f.montoUsd}|${normalizarTexto(f.cuenta)}|${normalizarTexto(f.caracteristica)}|${f.comprobante}`)}`),
          cuotaId: cuota.id, procesadorId: proc?.id, monto: r2(f.montoUsd), moneda: "USD",
          feeRate: proc?.feeRate ?? 0, feeMonto: fee, fecha: f.fecha, creadoEn: f.fecha,
          caracteristica: f.caracteristica || undefined,
          tipoVenta: (TIPOS_VENTA_PAGO as string[]).includes(f.tipoVenta) ? f.tipoVenta as TipoVentaPago : undefined,
          tipoCambio: f.tipoCambio, montoArs: f.montoArs ?? montoArsDe(f.montoUsd, f.tipoCambio),
          pagador: f.pagador || undefined, cuit: f.cuit || undefined, chequeado: f.chequeado || undefined,
          comprobanteLink: f.comprobante || undefined,
        });
      }
    }

    /* ---------- Lo que falta cobrar ---------- */
    const saldo = r2(valorTotal - cobrado);
    const planN = Number(/^(\d+)/.exec(ultima.plan.trim())?.[1] ?? /^(\d+)/.exec(apertura.plan.trim())?.[1] ?? 0);
    const cerrada = cobradas.some((f) => /paid in full|pago completado/.test(normalizarTexto(f.caracteristica)));
    if (saldo > 1 && cerrada && estado === "activa") {
      avisar("completa-con-saldo", "Ventas con \"Paid in full\" o \"Pago completado\" que cobraron menos que el valor total: la diferencia queda por cobrar, como en Estado_Clientes.", apertura.fila);
    }
    if (saldo < -1) {
      avisar("de-mas", "Ventas que cobraron más que su valor total (la planilla suma cobros de otra venta del mismo servicio, o el valor está mal).", apertura.fila);
    }
    if (saldo > 1 && estado !== "reembolsada") {
      const cantidad = Math.max(1, planN - ultimaCuota);
      const ultimoPago = cobradas[cobradas.length - 1]?.fecha ?? apertura.fecha;
      const proxima = opciones.proximasFechas?.get(`${persona.email}|${normalizarTexto(apertura.servicio)}`);
      const base = new Date(proxima ?? ultimoPago);
      if (!proxima) base.setUTCDate(base.getUTCDate() + dias);
      const parte = Math.floor((saldo / cantidad) * 100) / 100;
      for (let k = 1; k <= cantidad; k++) {
        const numero = ultimaCuota + k;
        const vence = new Date(base);
        vence.setUTCDate(vence.getUTCDate() + dias * (k - 1));
        cuotasVenta.push({
          id: `cuo_ef_${hash(`${ventaId}|${numero}`)}`, ventaId, numero,
          monto: k === cantidad ? r2(saldo - parte * (cantidad - 1)) : parte,
          vence: vence.toISOString(), estado: estado === "cancelada" ? "cancelada" : "pendiente", esReserva: false,
        });
      }
    }
    cuotas.push(...cuotasVenta);
  }

  /* Cuotas de ventas ya importadas que el plan de ahora no tiene. */
  const idsVentas = new Set(ventas.map((v) => v.id));
  const idsCuotas = new Set(cuotas.map((c) => c.id));
  const cuotasQueSobran = e.cuotas.filter((c) => idsVentas.has(c.ventaId) && !idsCuotas.has(c.id)).map((c) => c.id);

  /* Proyectos que la lista no tenía. */
  const lista = new Set(e.ajustes.proyectos ?? []);
  const proyectos = [...new Set(ventas.map((v) => v.proyecto).filter((x): x is string => Boolean(x) && !lista.has(x!)))];

  const personas = new Set(ventas.map((v) => v.contactoId));
  return {
    contactos: [...contactosNuevos.values()],
    leads: [...leadsNuevos.values()],
    ventas, cuotas, pagos, cuotasQueSobran,
    equipo: creados.equipo, productos: creados.productos, procesadores: creados.procesadores, embudos: creados.embudos,
    proyectos,
    avisos: [...avisos.values()],
    resumen: {
      filas: filasCrudas.length,
      personas: personas.size,
      personasNuevas: contactosNuevos.size,
      ventas: ventas.length,
      cobros: pagos.length,
      cuotasPendientes: cuotas.filter((c) => c.estado === "pendiente").length,
      cobrado: r2(pagos.reduce((a, p) => a + p.monto, 0)),
      facturado: r2(ventas.filter((v) => v.estado !== "cancelada").reduce((a, v) => a + v.precioAcordado, 0)),
      porCobrar: r2(cuotas.filter((c) => c.estado === "pendiente").reduce((a, c) => a + c.monto, 0)),
    },
  };
}
