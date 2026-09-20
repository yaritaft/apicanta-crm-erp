import type { Moneda, Movimiento, ProveedorPasarela } from "./types";

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
   Un parser chico pero correcto: comillas dobles, comas adentro de las
   comillas y saltos de línea adentro de una celda. Los export de PayPal
   traen las tres cosas. */

export function leerCSV(texto: string): string[][] {
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
    if (c === "," || c === ";" || c === "\t") { fila.push(celda.trim()); celda = ""; continue; }
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
  descripcion: [
    "description", "product_name", "producto", "product", "item title",
    "concepto", "descripción", "plan", "subject",
  ],
  estado: ["status", "estado", "payment_status", "transaction_status"],
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

/* "1.234,56" (es) y "1,234.56" (en) son el mismo número escrito distinto.
   Se decide por cuál separador aparece último. */
export function aNumero(crudo: string): number {
  if (!crudo) return 0;
  const s = crudo.replace(/[^\d,.\-]/g, "");
  if (!s) return 0;
  const ultimaComa = s.lastIndexOf(",");
  const ultimoPunto = s.lastIndexOf(".");
  let limpio = s;
  if (ultimaComa > ultimoPunto) limpio = s.replace(/\./g, "").replace(",", ".");
  else limpio = s.replace(/,/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : 0;
}

function aFecha(crudo: string): string {
  if (!crudo) return new Date().toISOString();
  const directo = new Date(crudo);
  if (!Number.isNaN(directo.getTime())) return directo.toISOString();
  /* dd/mm/aaaa, el formato de los reportes en español */
  const m = crudo.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const [, d, mes, a] = m;
    const anio = a.length === 2 ? 2000 + Number(a) : Number(a);
    const f = new Date(anio, Number(mes) - 1, Number(d), 12);
    if (!Number.isNaN(f.getTime())) return f.toISOString();
  }
  return new Date().toISOString();
}

const RECHAZADOS = /fail|refund|reembols|cancel|charge.?back|denied|rechaz|expired|pending|dispute/i;

export type MovimientoCrudo = Omit<Movimiento, "id" | "estado" | "creadoEn" | "origen">;

export interface ResultadoImportacion {
  movimientos: MovimientoCrudo[];
  /* Filas que se saltearon y por qué: se muestran antes de importar */
  descartadas: { fila: number; motivo: string }[];
}

/** Traduce un CSV de cualquier pasarela al formato de Apicanta. */
export function importarCSV(
  texto: string,
  proveedor: ProveedorPasarela,
  procesadorId: string | undefined,
  feeRatePorDefecto = 0,
): ResultadoImportacion {
  const filas = leerCSV(texto);
  const descartadas: { fila: number; motivo: string }[] = [];
  if (filas.length < 2) return { movimientos: [], descartadas: [{ fila: 0, motivo: "El archivo no tiene filas." }] };

  const mapa = mapaDeColumnas(filas[0]);
  const dato = (f: string[], campo: string) => {
    const i = mapa[campo];
    return i === undefined ? "" : (f[i] ?? "");
  };

  const movimientos: MovimientoCrudo[] = [];

  for (let i = 1; i < filas.length; i++) {
    const f = filas[i];
    const monto = aNumero(dato(f, "monto"));
    if (monto <= 0) { descartadas.push({ fila: i + 1, motivo: "Sin monto positivo (reembolso o fila de resumen)." }); continue; }

    const estadoCrudo = dato(f, "estado");
    if (estadoCrudo && RECHAZADOS.test(estadoCrudo)) {
      descartadas.push({ fila: i + 1, motivo: `Estado "${estadoCrudo}".` });
      continue;
    }

    /* El fee viene negativo en PayPal y positivo en Stripe. */
    const feeCrudo = Math.abs(aNumero(dato(f, "fee")));
    const fee = feeCrudo > 0 ? feeCrudo : Math.round(monto * feeRatePorDefecto * 100) / 100;
    const netoCrudo = Math.abs(aNumero(dato(f, "neto")));
    const moneda = (dato(f, "moneda") || "USD").toUpperCase().includes("ARS") ? "ARS" : "USD";

    const referencia = dato(f, "referencia") || `${proveedor}-${aFecha(dato(f, "fecha")).slice(0, 10)}-${monto}-${i}`;

    movimientos.push({
      proveedor,
      procesadorId,
      referencia,
      monto: Math.round(monto * 100) / 100,
      moneda: moneda as Moneda,
      fee: Math.round(fee * 100) / 100,
      neto: Math.round((netoCrudo > 0 ? netoCrudo : monto - fee) * 100) / 100,
      fecha: aFecha(dato(f, "fecha")),
      clienteNombre: dato(f, "clienteNombre") || undefined,
      clienteEmail: dato(f, "clienteEmail")?.toLowerCase() || undefined,
      descripcion: dato(f, "descripcion") || undefined,
    });
  }

  return { movimientos, descartadas };
}
