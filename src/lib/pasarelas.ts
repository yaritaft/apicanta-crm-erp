import type { Moneda, Movimiento, ProveedorPasarela } from "./types";
import type { ReembolsoCrudo } from "./reembolsos";

/* ==================================================================
   Pasarelas de cobro.

   Cada pasarela exporta lo mismo con otros nombres: Stripe le dice
   "Amount", PayPal "Gross", Hotmart "total_value". Acá se traduce todo
   a un solo formato — el Movimiento — para que la conciliación no
   tenga que saber de dónde vino la plata.
   ================================================================== */

export interface FichaPasarela {
  id: ProveedorPasarela;
  nombre: string;
  /* Cómo se saca el archivo, en una línea */
  comoExportar: string;
  /* Variables de entorno que hacen falta para traerlos solos */
  claves: string[];
  /* Prefijo típico de sus referencias, para reconocer pegadas sueltas */
  ejemploRef: string;
}

export const PASARELAS: FichaPasarela[] = [
  {
    id: "stripe", nombre: "Stripe",
    comoExportar: "Dashboard → Payments → Export, con las columnas por defecto.",
    claves: ["STRIPE_SECRET_KEY"], ejemploRef: "pi_3Q…",
  },
  {
    id: "hotmart", nombre: "Hotmart",
    comoExportar: "Ventas → Exportar informe de ventas.",
    claves: ["HOTMART_CLIENT_ID", "HOTMART_CLIENT_SECRET", "HOTMART_BASIC"], ejemploRef: "HP…",
  },
  {
    id: "whop", nombre: "Whop",
    comoExportar: "Dashboard → Payments → Export CSV.",
    claves: ["WHOP_API_KEY"], ejemploRef: "pay_…",
  },
  {
    id: "dlocal", nombre: "dLocal",
    comoExportar: "Merchant panel → Payments → Export.",
    claves: ["DLOCAL_X_LOGIN", "DLOCAL_TRANS_KEY", "DLOCAL_SECRET_KEY"], ejemploRef: "D-4-…",
  },
  {
    id: "mercadopago", nombre: "Mercado Pago",
    comoExportar: "Actividad → Reportes → Liberaciones de dinero.",
    claves: ["MERCADOPAGO_ACCESS_TOKEN"], ejemploRef: "1234567890",
  },
  {
    id: "mercury", nombre: "Mercury (ACH / wire)",
    comoExportar: "Mercury → la cuenta → Statements / Export CSV.",
    claves: ["MERCURY_API_TOKEN"], ejemploRef: "txn_…",
  },
  {
    id: "binance", nombre: "Binance (USDT)",
    comoExportar: "Wallet → Transaction History → Export (depósitos de cripto).",
    claves: ["BINANCE_API_KEY", "BINANCE_API_SECRET"], ejemploRef: "hash de la red",
  },
  {
    id: "trust", nombre: "Trust (USDT)",
    comoExportar: "No exporta: se mira la blockchain con la dirección de la billetera.",
    claves: ["TRUST_WALLET_ADDRESS"], ejemploRef: "hash de la red",
  },
  {
    id: "manual", nombre: "Otro (planilla)",
    comoExportar: "Cualquier CSV con fecha, monto y nombre: Galicia, la financiera o efectivo.",
    claves: [], ejemploRef: "—",
  },
];

export const fichaPasarela = (p: ProveedorPasarela): FichaPasarela =>
  PASARELAS.find((x) => x.id === p) ?? {
    id: "manual", nombre: "Carga manual", comoExportar: "Se carga a mano.",
    claves: [], ejemploRef: "—",
  };

export const nombrePasarela = (p: ProveedorPasarela): string => fichaPasarela(p).nombre;

/* ---------- Lectura de CSV ----------
   Un parser chico pero correcto: comillas dobles, el separador adentro de las
   comillas y saltos de línea adentro de una celda. Los export de PayPal
   traen las tres cosas.

   El separador no siempre es la coma: Excel en español, Hotmart y Mercado Pago
   separan con «;» y escriben «1.234,56», y lo que se pega desde una hoja viene
   con tabuladores. Si la coma cortara siempre, «1.234,56» quedaría en dos
   celdas y el monto entraría como 1,234 sin avisar. Por eso el separador se
   lee de la cabecera y los otros dos, ahí, son parte del texto. */

const SEPARADORES = ["\t", ";", ","];

/** El separador del archivo: el que más aparece en la cabecera (la primera
 *  línea con algo), sin contar lo que va entre comillas. Si empatan gana el
 *  que menos se usa dentro de un texto (tabulador, «;», coma); si no hay
 *  ninguno es un archivo de una sola columna y da lo mismo. */
function separadorDe(texto: string): string {
  const veces = SEPARADORES.map(() => 0);
  let enComillas = false;
  let hayAlgo = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (c === '"') { enComillas = !enComillas; hayAlgo = true; continue; }
    if (enComillas) continue;
    if (c === "\n" || c === "\r") {
      if (hayAlgo || veces.some((n) => n > 0)) break;
      continue;
    }
    const k = SEPARADORES.indexOf(c);
    if (k >= 0) veces[k]++;
    else if (c.trim() !== "") hayAlgo = true;
  }
  let mejor = 2;
  let max = 0;
  veces.forEach((n, k) => { if (n > max) { max = n; mejor = k; } });
  return SEPARADORES[mejor];
}

export function leerCSV(texto: string): string[][] {
  /* El BOM que pone Excel al guardar «CSV UTF-8» no es parte del primer encabezado. */
  if (texto.charCodeAt(0) === 0xfeff) texto = texto.slice(1);
  const separador = separadorDe(texto);
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let enComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { celda += '"'; i++; }
        else enComillas = false;
      } else celda += c;
      continue;
    }
    if (c === '"') { enComillas = true; continue; }
    if (c === separador) { fila.push(celda.trim()); celda = ""; continue; }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && texto[i + 1] === "\n") i++;
      fila.push(celda.trim()); celda = "";
      if (fila.some((x) => x !== "")) filas.push(fila);
      fila = [];
      continue;
    }
    celda += c;
  }
  fila.push(celda.trim());
  if (fila.some((x) => x !== "")) filas.push(fila);
  return filas;
}

/* ---------- Traducción de columnas ----------
   Los alias van de lo más específico a lo más genérico: "Converted Amount"
   antes que "amount", si no un export de Stripe en euros entra con el
   número equivocado. */

const ALIAS: Record<string, string[]> = {
  referencia: [
    "id", "transaction id", "transaction_id", "payment id", "payment_id",
    "charge id", "transaction", "transacción", "id de la operación",
    "número de operación", "order", "order_id", "receipt id", "referencia",
  ],
  fecha: [
    "created date (utc)", "created (utc)", "created_at", "created", "date",
    "order_date", "approval_date", "fecha", "fecha de aprobación",
    "fecha de la operación", "payment_date", "purchase_date",
  ],
  monto: [
    "converted amount", "amount", "gross", "total_value", "total", "valor",
    "valor de la transacción", "monto", "importe", "bruto", "price",
  ],
  fee: [
    "converted fee", "fee", "fees", "commission", "cargos", "comisión",
    "tarifa", "processing_fee", "platform_fee",
  ],
  neto: ["net", "neto", "valor neto recibido", "net_value", "settled"],
  moneda: ["currency", "moneda", "converted currency", "currency_code"],
  clienteNombre: [
    "customer name", "buyer_name", "name", "nombre", "cliente",
    "customer_description", "username", "comprador", "buyer",
  ],
  clienteEmail: [
    "customer email", "buyer_email", "user_email", "from email address",
    "email", "correo", "email del comprador", "payer_email",
  ],
  clienteTelefono: [
    "customer phone", "buyer_phone", "phone", "teléfono", "telefono", "celular", "whatsapp",
  ],
  metodo: [
    "payment method type", "payment method", "card brand", "método de pago", "metodo de pago",
    "forma de pago", "medio de pago", "payment_type",
  ],
  descripcion: [
    "description", "product_name", "producto", "product", "item title",
    "concepto", "descripción", "plan", "subject",
  ],
  estado: ["status", "estado", "payment_status", "transaction_status"],
  /* Lo devuelto del cobro (el export de Stripe lo trae en el mismo renglón del
     cargo) y, si el renglón es un reembolso suelto, el cobro que devuelve. */
  montoDevuelto: ["amount refunded", "refunded amount", "amount_refunded", "monto devuelto", "monto reembolsado", "importe reembolsado"],
  referenciaCobro: ["reference txn id", "original transaction id", "parent transaction id", "paymentintent id", "payment_intent id", "payment intent id"],
};

const limpiarCabecera = (s: string) => s.toLowerCase().replace(/^﻿/, "").trim();

function mapaDeColumnas(cabecera: string[]): Record<string, number> {
  const norm = cabecera.map(limpiarCabecera);
  const mapa: Record<string, number> = {};
  for (const [campo, alias] of Object.entries(ALIAS)) {
    for (const a of alias) {
      const i = norm.indexOf(a);
      if (i >= 0) { mapa[campo] = i; break; }
    }
    /* Segunda pasada: coincidencia parcial, por si viene "Amount (USD)". */
    if (mapa[campo] === undefined) {
      for (const a of alias) {
        const i = norm.findIndex((c) => c.startsWith(a) || c.includes(a));
        if (i >= 0) { mapa[campo] = i; break; }
      }
    }
  }
  return mapa;
}

/* Un monto como lo escribe una pasarela, en español o en inglés. Sigue la misma
   regla que leerMonto (lib/monto.ts), la de los campos de plata de la app:
   - con los dos separadores, el último es el decimal: «1.234,56» y «1,234.56»
     son 1234,56;
   - un punto solo es decimal («12.5», «1234.56») salvo que sea de miles: varios
     puntos o un grupo de exactamente tres cifras detrás («15.000», «1.500.000»);
   - una coma sola es decimal («15,5», «1234,56») y varias son de miles
     («1,234,567»).
   Con símbolos de moneda y espacios («US$ 1.500,00»). Un menos adelante o
   atrás, o el monto entre paréntesis, es negativo. Lo que no se puede leer da 0.

   Una diferencia con leerMonto, a propósito: un grupo de miles no empieza con
   cero, así que «0.500» es medio y no quinientos.

   `puntoEsDecimal`: las billeteras de cripto (Binance, Trust) exportan con el
   punto siempre decimal y sin ceros de más («12.345» son doce y pico, no doce
   mil): ahí «un punto y tres cifras» no es de miles. */
export function aNumero(crudo: string, puntoEsDecimal = false): number {
  if (!crudo) return 0;
  /* Quedan las cifras, los separadores y el menos (también el tipográfico). */
  const solo = crudo.replace(/[\u2212\u2013\u2014]/g, "-").replace(/[^\d,.\-]/g, "");
  const negativo = /^-|-$/.test(solo) || /^\s*\(.*\)\s*$/.test(crudo);
  const s = solo.replace(/^-|-$/g, "");
  /* Sin cifras, o con un menos en el medio («2026-10-01»): no es un monto. */
  if (!/^[\d,.]+$/.test(s) || !/\d/.test(s)) return 0;

  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  let limpio: string;
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    limpio = ultimaComa > ultimoPunto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    if (s.indexOf(",") === ultimaComa) limpio = s.replace(",", ".");
    else if (/^[1-9]\d{0,2}(,\d{3})+$/.test(s)) limpio = s.replace(/,/g, "");
    else return 0;
  } else if (ultimoPunto >= 0) {
    if (!puntoEsDecimal && /^[1-9]\d{0,2}(\.\d{3})+$/.test(s)) limpio = s.replace(/\./g, "");
    else if (s.indexOf(".") === ultimoPunto) limpio = s;
    else return 0;
  } else limpio = s;
  const n = Number(limpio);
  if (!Number.isFinite(n) || n === 0) return 0;
  return negativo ? -n : n;
}

/* ---------- Fechas ----------
   Lo que importa es en qué DÍA de Argentina cae el cobro: de eso depende el mes
   en que se cuenta. Por eso nada de new Date(texto) como primer intento: lee
   «10/09/2026» como mes/día, «2026-10-01» como medianoche de UTC (el 30/09 a las
   21 en Argentina) y un «2026-10-01 01:00» sin zona con la hora de la máquina.

   - aaaa-mm-dd y dd/mm/aaaa (también con «.» o «-», y año de dos cifras); el día
     va SIEMPRE antes que el mes, como en Excel en español, Mercado Pago y Hotmart.
     La única excepción es un archivo que lo desmiente él solo: si trae una fecha
     con el segundo número pasado de 12 («09/13/2026») y ninguna con el primero
     pasado de 12, viene mes/día (Mercury, PayPal en inglés) y se lee así entero.
   - Sin hora, el mediodía de Argentina: cae en ese día con cualquier huso.
   - Con hora («14:30», «14:30:05.123», «2:30 p. m.»): si trae zona («Z», «UTC»,
     «-03:00», «-0300») se respeta; si no, es la de Argentina, o la de UTC si la
     columna se llama «Created date (UTC)». */

/* Argentina no tiene horario de verano desde 2009: es UTC-3 todo el año. */
const DESFASE_ARGENTINA = -180;
const MINUTO = 60_000;

/** Cuántos minutos se adelanta (+) o atrasa (-) una zona respecto de UTC:
 *  «Z», «UTC», «GMT», «-03:00», «+0530», «-03», «UTC-3». */
function desfaseDeZona(zona: string): number | null {
  const m = /^(?:(Z|UTC|GMT)|(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?)$/i.exec(zona.trim());
  if (!m) return null;
  if (m[1]) return 0;
  const minutos = Number(m[3]) * 60 + Number(m[4] ?? 0);
  return m[2] === "-" ? -minutos : minutos;
}

/** La hora de las fechas sin zona de una columna: la de Argentina, salvo que su
 *  encabezado diga «UTC» o «GMT» (Stripe: «Created date (UTC)»). */
function desfaseDelEncabezado(encabezado: string): number {
  const m = /(?<![a-z])(?:utc|gmt)(?:[+-]\d{1,2}(?::?\d{2})?)?(?![a-z])/i.exec(encabezado);
  return (m && desfaseDeZona(m[0])) ?? DESFASE_ARGENTINA;
}

/* Con o sin una palabra delante («lun 10/09/2026», Excel con el día de la semana). */
const FECHA_AAAA_MM_DD = /^\D*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)([\s\S]*)$/;
const FECHA_DD_MM_AAAA = /^\D*(\d{1,2})[-/.](\d{1,2})[-/.](\d{4}|\d{2})(?!\d)([\s\S]*)$/;
const HORA = /^[T\s,]*(\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d+))?)?(?:\s*([ap])\.?\s?m\b\.?)?\s*(Z\b|(?:UTC|GMT)(?:[+-]\d{1,2}(?::?\d{2})?)?|[+-]\d{2}(?::?\d{2})?)?/i;
/* Lo que tiene la forma de una fecha con números: si no existe («31/02/2026») no
   se le pregunta al navegador, que la leería a su manera. */
const FORMA_NUMERICA = /^\D*\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}/;

/** ¿Las fechas de una columna vienen mes/día/año? Sólo si alguna lo dice sin
 *  dudas: tiene el segundo número pasado de 12 y ninguna tiene el primero
 *  pasado de 12 (las dos cosas juntas no se pueden: queda día/mes). */
function vienenMesDia(fechas: string[]): boolean {
  let mesDia = false;
  for (const f of fechas) {
    const m = FECHA_DD_MM_AAAA.exec(f.trim());
    if (!m) continue;
    if (Number(m[1]) > 12) return false;
    if (Number(m[2]) > 12) mesDia = true;
  }
  return mesDia;
}

/** El instante (ms desde 1970) de una fecha en texto, o null si no es una fecha
 *  aaaa-mm-dd / dd/mm/aaaa que exista. */
function instanteDe(texto: string, desfaseSinZona: number, mesPrimero: boolean): number | null {
  let anio: number, mes: number, dia: number, resto: string;
  const aaaa = FECHA_AAAA_MM_DD.exec(texto);
  const dma = aaaa ? null : FECHA_DD_MM_AAAA.exec(texto);
  if (aaaa) {
    anio = Number(aaaa[1]); mes = Number(aaaa[2]); dia = Number(aaaa[3]); resto = aaaa[4];
  } else if (dma) {
    [dia, mes] = mesPrimero ? [Number(dma[2]), Number(dma[1])] : [Number(dma[1]), Number(dma[2])];
    resto = dma[4];
    anio = dma[3].length === 2 ? 2000 + Number(dma[3]) : Number(dma[3]);
    /* Un «mes» de 13 en adelante no existe: es el otro orden (el 09/13 es el 13 de septiembre). */
    if (mes > 12 && dia <= 12) [dia, mes] = [mes, dia];
  } else return null;

  /* Sin hora: el mediodía de Argentina, sea cual sea la zona de la columna. */
  let hora = 12, minuto = 0, segundo = 0, ms = 0, desfase = DESFASE_ARGENTINA;
  const h = HORA.exec(resto);
  if (h) {
    hora = Number(h[1]); minuto = Number(h[2]); segundo = h[3] ? Number(h[3]) : 0;
    ms = h[4] ? Number(h[4].slice(0, 3).padEnd(3, "0")) : 0;
    if (h[5]) {
      if (hora < 1 || hora > 12) return null;
      hora = (hora % 12) + (h[5].toLowerCase() === "p" ? 12 : 0);
    }
    desfase = (h[6] ? desfaseDeZona(h[6]) : null) ?? desfaseSinZona;
  }
  if (hora > 23 || minuto > 59 || segundo > 59) return null;

  const utc = Date.UTC(anio, mes - 1, dia, hora, minuto, segundo, ms);
  const f = new Date(utc);
  /* Date.UTC corre las fechas que no existen (31/02, mes 13, año 26 → 1926). */
  if (f.getUTCFullYear() !== anio || f.getUTCMonth() !== mes - 1 || f.getUTCDate() !== dia) return null;
  return utc - desfase * MINUTO;
}

export interface OpcionesFecha {
  /** En qué hora están escritas las fechas que no traen zona, en minutos respecto
   *  de UTC: Argentina (-180) por defecto, 0 en una columna «(UTC)». */
  desfase?: number;
  /** Las fechas con barras vienen mes/día/año (por defecto, día/mes/año). */
  mesPrimero?: boolean;
}

/** La fecha de una celda como instante ISO. Una celda vacía o que no es una
 *  fecha es el momento de la importación. */
export function aFecha(crudo: string, { desfase = DESFASE_ARGENTINA, mesPrimero = false }: OpcionesFecha = {}): string {
  const t = (crudo ?? "").trim();
  if (!t) return new Date().toISOString();
  const instante = instanteDe(t, desfase, mesPrimero);
  if (instante !== null) return new Date(instante).toISOString();
  /* Cualquier otro texto de fecha («Sep 10, 2026») lo lee el navegador. */
  if (!FORMA_NUMERICA.test(t)) {
    const directo = new Date(t);
    if (!Number.isNaN(directo.getTime())) return directo.toISOString();
  }
  return new Date().toISOString();
}

const RECHAZADOS = /fail|refund|reembols|cancel|charge.?back|denied|rechaz|expired|pending|dispute/i;
/* Lo que no es un cobro pero SÍ es plata devuelta: se propone como devolución
   (lib/reembolsos.ts) en vez de perderse. Una disputa abierta todavía no es
   plata que salió. */
const REEMBOLSADO = /refund|reembols|devuelt|devoluci|charge.?back|contracargo/i;

export type MovimientoCrudo = Omit<Movimiento, "id" | "estado" | "creadoEn" | "origen">;

export interface ResultadoImportacion {
  movimientos: MovimientoCrudo[];
  /* La plata que el archivo dice que se devolvió: no entra como cobro, se
     propone como devolución para atarla a la que se cargó (lib/reembolsos.ts). */
  reembolsos: ReembolsoCrudo[];
  /* Filas que se saltearon y por qué: se muestran antes de importar */
  descartadas: { fila: number; motivo: string; reembolso?: boolean }[];
}

/** Traduce un CSV de cualquier pasarela al formato de Apicanta. Entiende el
 *  separador «,», «;» o tabulador (también lo pegado desde Excel), los montos
 *  «1.234,56» y «1,234.56», y las fechas dd/mm/aaaa y aaaa-mm-dd. */
export function importarCSV(
  texto: string,
  proveedor: ProveedorPasarela,
  procesadorId: string | undefined,
  feeRatePorDefecto = 0,
): ResultadoImportacion {
  const filas = leerCSV(texto);
  const descartadas: { fila: number; motivo: string; reembolso?: boolean }[] = [];
  if (filas.length < 2) return { movimientos: [], reembolsos: [], descartadas: [{ fila: 0, motivo: "El archivo no tiene filas." }] };

  const mapa = mapaDeColumnas(filas[0]);
  const dato = (f: string[], campo: string) => {
    const i = mapa[campo];
    return i === undefined ? "" : (f[i] ?? "");
  };
  /* Las fechas sin zona están en hora de Argentina, salvo que la columna diga «(UTC)»;
     y vienen día/mes salvo que el archivo muestre sin dudas que son mes/día. */
  const desfase = desfaseDelEncabezado(mapa.fecha === undefined ? "" : (filas[0][mapa.fecha] ?? ""));
  const mesPrimero = vienenMesDia(filas.slice(1).map((f) => dato(f, "fecha")));
  const fechaDe = (f: string[]) => aFecha(dato(f, "fecha"), { desfase, mesPrimero });
  /* En cripto el punto es siempre decimal; en todo lo demás, «15.000» son quince mil. */
  const puntoEsDecimal = proveedor === "binance" || proveedor === "trust";
  const numero = (f: string[], campo: string) => aNumero(dato(f, campo), puntoEsDecimal);

  const movimientos: MovimientoCrudo[] = [];
  const reembolsos: ReembolsoCrudo[] = [];

  /* Un reembolso del archivo: el id es el del cobro (el archivo no trae uno
     propio) y la fecha, la de ese renglón, que no dice cuándo se devolvió. */
  const reembolso = (f: string[], i: number, monto: number, motivo?: string) => {
    const cobro = dato(f, "referencia");
    const refs = [cobro, dato(f, "referenciaCobro")].filter(Boolean);
    const moneda = (dato(f, "moneda") || "USD").toUpperCase().includes("ARS") ? "ARS" : "USD";
    reembolsos.push({
      proveedor, procesadorId,
      referencia: cobro ? `reembolso:${cobro}` : `reembolso:${proveedor}-${fechaDe(f).slice(0, 10)}-${monto}-${i}`,
      referenciasCobro: refs.length ? refs : undefined,
      monto: Math.round(monto * 100) / 100, moneda: moneda as Moneda,
      fecha: fechaDe(f), fechaDelCobro: true,
      clienteNombre: dato(f, "clienteNombre") || undefined,
      clienteEmail: dato(f, "clienteEmail")?.toLowerCase() || undefined,
      motivo,
    });
  };

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const monto = numero(f, "monto");
    const estadoCrudo = dato(f, "estado");
    const devuelto = Math.abs(numero(f, "montoDevuelto"));

    /* Un renglón en negativo es un reembolso suelto (PayPal): la plata que salió. */
    if (monto < 0) {
      reembolso(f, i, Math.abs(monto), estadoCrudo || undefined);
      descartadas.push({ fila: i + 1, motivo: "Es un reembolso: no entra como cobro, se propone como devolución.", reembolso: true });
      continue;
    }
    if (monto <= 0) { descartadas.push({ fila: i + 1, motivo: "Sin monto positivo (fila de resumen)." }); continue; }

    if (estadoCrudo && REEMBOLSADO.test(estadoCrudo)) {
      /* El cargo devuelto (Stripe lo marca «Refunded» en el mismo renglón): lo
         devuelto es el monto devuelto o, sin él, todo. No entra como cobro. */
      reembolso(f, i, devuelto > 0.005 ? devuelto : monto, /charge.?back|contracargo/i.test(estadoCrudo) ? "Contracargo" : undefined);
      descartadas.push({ fila: i + 1, motivo: `Estado "${estadoCrudo}": no entra como cobro, se propone como devolución.`, reembolso: true });
      continue;
    }
    if (estadoCrudo && RECHAZADOS.test(estadoCrudo)) {
      descartadas.push({ fila: i + 1, motivo: `Estado "${estadoCrudo}".` });
      continue;
    }
    /* Devuelto en parte: el cobro entra entero (así entró la plata) y lo que se
       devolvió se propone aparte. */
    if (devuelto > 0.005) reembolso(f, i, Math.min(devuelto, monto));

    /* El fee viene negativo en PayPal y positivo en Stripe. */
    const feeCrudo = Math.abs(numero(f, "fee"));
    const fee = feeCrudo > 0 ? feeCrudo : Math.round(monto * feeRatePorDefecto * 100) / 100;
    const netoCrudo = Math.abs(numero(f, "neto"));
    const moneda = (dato(f, "moneda") || "USD").toUpperCase().includes("ARS") ? "ARS" : "USD";

    const referencia = dato(f, "referencia") || `${proveedor}-${fechaDe(f).slice(0, 10)}-${monto}-${i}`;

    movimientos.push({
      proveedor,
      procesadorId,
      referencia,
      monto: Math.round(monto * 100) / 100,
      moneda: moneda as Moneda,
      fee: Math.round(fee * 100) / 100,
      neto: Math.round((netoCrudo > 0 ? netoCrudo : monto - fee) * 100) / 100,
      fecha: fechaDe(f),
      clienteNombre: dato(f, "clienteNombre") || undefined,
      clienteEmail: dato(f, "clienteEmail")?.toLowerCase() || undefined,
      clienteTelefono: dato(f, "clienteTelefono") || undefined,
      metodo: dato(f, "metodo") || undefined,
      descripcion: dato(f, "descripcion") || undefined,
    });
  }

  return { movimientos, reembolsos, descartadas };
}
