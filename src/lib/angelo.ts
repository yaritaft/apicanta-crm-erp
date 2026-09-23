import type {
  Cuota, IngresoComunidad, TipoVentaPago, Venta, Webinar,
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

