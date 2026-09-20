import { NextResponse } from "next/server";
import type { Moneda, ProveedorPasarela } from "@/lib/types";

/* ==================================================================
   Traer los cobros de las pasarelas.

   Cada pasarela se conecta sola si están sus claves en el entorno; la
   que no las tenga se saltea sin romper nada, y el front sigue pudiendo
   importar el CSV a mano. Un proveedor que falla tampoco tumba a los
   demás: su error viaja en la respuesta y se muestra tal cual.

   Docs:
   - Stripe        https://docs.stripe.com/api/charges/list
   - PayPal        https://developer.paypal.com/docs/api/transaction-search/v1/
   - Hotmart       https://developers.hotmart.com/docs/en/v1/sales/sales-history/
   - Whop          https://dev.whop.com/api-reference
   - Mercado Pago  https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_search/get
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MovimientoApi {
  proveedor: ProveedorPasarela;
  referencia: string;
  monto: number;
  moneda: Moneda;
  fee: number;
  neto: number;
  fecha: string;
  clienteNombre?: string;
  clienteEmail?: string;
  descripcion?: string;
}

const dinero = (n: number) => Math.round(n * 100) / 100;
const moneda = (s?: string): Moneda => (s ?? "").toUpperCase() === "ARS" ? "ARS" : "USD";

/* Ventana por defecto: 60 días. Alcanza para las cuotas del mes y para
   las que se atrasaron, sin traer años de historia en cada click. */
function desdeHasta(url: URL) {
  const dias = Number(url.searchParams.get("dias") ?? 60);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - Math.min(Math.max(dias, 1), 365) * 86400000);
  return { desde, hasta };
}

async function json(r: Response): Promise<Record<string, unknown>> {
  const texto = await r.text();
  try { return JSON.parse(texto) as Record<string, unknown>; }
  catch { throw new Error(texto.slice(0, 200)); }
}

/* ---------- Stripe ---------- */

async function stripe(desde: Date): Promise<MovimientoApi[]> {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) return [];
  const q = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(desde.getTime() / 1000)) });
  q.append("expand[]", "data.balance_transaction");
  const r = await fetch(`https://api.stripe.com/v1/charges?${q}`, {
    headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw new Error((data.error as { message?: string })?.message ?? "Stripe rechazó la consulta.");

  const filas = (data.data ?? []) as Record<string, never>[];
  return filas
    .filter((c) => c.status === "succeeded" && !c.refunded)
    .map((c) => {
      const bt = c.balance_transaction as { fee?: number; net?: number } | null;
      const monto = dinero(Number(c.amount ?? 0) / 100);
      const fee = dinero(Number(bt?.fee ?? 0) / 100);
      const detalles = (c.billing_details ?? {}) as { name?: string; email?: string };
      return {
        proveedor: "stripe" as const,
        referencia: String(c.id),
        monto, fee,
        neto: bt?.net !== undefined ? dinero(Number(bt.net) / 100) : dinero(monto - fee),
        moneda: moneda(c.currency as string),
        fecha: new Date(Number(c.created ?? 0) * 1000).toISOString(),
        clienteNombre: detalles.name ?? undefined,
        clienteEmail: (detalles.email ?? (c.receipt_email as string | undefined))?.toLowerCase(),
        descripcion: (c.description as string | undefined) ?? undefined,
      };
    });
}

/* ---------- PayPal ---------- */

async function paypal(desde: Date, hasta: Date): Promise<MovimientoApi[]> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secreto = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secreto) return [];
  const base = process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secreto}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const tok = await json(auth);
  if (!auth.ok) throw new Error(String(tok.error_description ?? "No se pudo autenticar con PayPal."));

  /* La búsqueda de transacciones sólo acepta ventanas de 31 días. */
  const inicio = new Date(Math.max(desde.getTime(), hasta.getTime() - 31 * 86400000));
  const q = new URLSearchParams({
    start_date: inicio.toISOString(),
    end_date: hasta.toISOString(),
    fields: "transaction_info,payer_info,cart_info",
    page_size: "100",
  });
  const r = await fetch(`${base}/v1/reporting/transactions?${q}`, {
    headers: { Authorization: `Bearer ${tok.access_token as string}` }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw new Error(String((data.message ?? data.error_description) ?? "PayPal rechazó la consulta."));

  const detalles = (data.transaction_details ?? []) as Record<string, never>[];
  return detalles
    .map((d) => {
      const t = (d.transaction_info ?? {}) as Record<string, never>;
      const p = (d.payer_info ?? {}) as Record<string, never>;
      const monto = dinero(Number((t.transaction_amount as { value?: string })?.value ?? 0));
      const fee = Math.abs(dinero(Number((t.fee_amount as { value?: string })?.value ?? 0)));
      const nombre = (p.payer_name ?? {}) as { alternate_full_name?: string };
      return {
        proveedor: "paypal" as const,
        referencia: String(t.transaction_id ?? ""),
        monto, fee, neto: dinero(monto - fee),
        moneda: moneda((t.transaction_amount as { currency_code?: string })?.currency_code),
        fecha: String(t.transaction_initiation_date ?? new Date().toISOString()),
        clienteNombre: nombre.alternate_full_name ?? undefined,
        clienteEmail: (p.email_address as string | undefined)?.toLowerCase(),
        descripcion: (t.transaction_subject as string | undefined) ?? undefined,
      };
    })
    .filter((m) => m.monto > 0 && m.referencia);
}

/* ---------- Hotmart ---------- */

async function hotmart(desde: Date, hasta: Date): Promise<MovimientoApi[]> {
  const id = process.env.HOTMART_CLIENT_ID;
  const secreto = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;
  if (!id || !secreto || !basic) return [];

  const auth = await fetch(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${id}&client_secret=${secreto}`,
    { method: "POST", headers: { Authorization: `Basic ${basic}` }, cache: "no-store" },
  );
  const tok = await json(auth);
  if (!auth.ok) throw new Error(String(tok.error_description ?? "No se pudo autenticar con Hotmart."));

  const q = new URLSearchParams({
    start_date: String(desde.getTime()),
    end_date: String(hasta.getTime()),
    max_results: "100",
    transaction_status: "APPROVED",
  });
  const r = await fetch(`https://developers.hotmart.com/payments/api/v1/sales/history?${q}`, {
    headers: { Authorization: `Bearer ${tok.access_token as string}` }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw new Error(String(data.message ?? "Hotmart rechazó la consulta."));

  const items = (data.items ?? []) as Record<string, never>[];
  return items.map((it) => {
    const compra = (it.purchase ?? {}) as Record<string, never>;
    const precio = (compra.price ?? {}) as { value?: number; currency_code?: string };
    const comision = (it.commissions ?? []) as { commission?: { value?: number }; source?: string }[];
    const nuestra = comision.find((c) => c.source === "PRODUCER")?.commission?.value;
    const monto = dinero(Number(precio.value ?? 0));
    const neto = nuestra !== undefined ? dinero(Number(nuestra)) : monto;
    const comprador = (it.buyer ?? {}) as { name?: string; email?: string };
    const producto = (it.product ?? {}) as { name?: string };
    return {
      proveedor: "hotmart" as const,
      referencia: String(compra.transaction ?? ""),
      monto, fee: dinero(monto - neto), neto,
      moneda: moneda(precio.currency_code),
      fecha: new Date(Number(compra.order_date ?? Date.now())).toISOString(),
      clienteNombre: comprador.name ?? undefined,
      clienteEmail: comprador.email?.toLowerCase(),
      descripcion: producto.name ?? undefined,
    };
  }).filter((m) => m.referencia && m.monto > 0);
}

/* ---------- Whop ---------- */

async function whop(desde: Date): Promise<MovimientoApi[]> {
  const clave = process.env.WHOP_API_KEY;
  if (!clave) return [];
  const r = await fetch("https://api.whop.com/api/v5/company/payments?per=50&status=paid", {
    headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw new Error(String(data.error ?? "Whop rechazó la consulta."));

  const filas = (data.data ?? []) as Record<string, never>[];
  return filas
    .map((p) => {
      const monto = dinero(Number(p.final_amount ?? p.subtotal ?? 0));
      const fee = dinero(Number(p.payment_processing_fee ?? 0) + Number(p.whop_fee ?? 0));
      const usuario = (p.user ?? {}) as { email?: string; name?: string; username?: string };
      return {
        proveedor: "whop" as const,
        referencia: String(p.id ?? ""),
        monto, fee, neto: dinero(monto - fee),
        moneda: moneda(p.currency as string),
        fecha: new Date(Number(p.paid_at ?? p.created_at ?? 0) * 1000).toISOString(),
        clienteNombre: usuario.name ?? usuario.username ?? undefined,
        clienteEmail: usuario.email?.toLowerCase(),
        descripcion: (p.product_title as string | undefined) ?? undefined,
      };
    })
    .filter((m) => m.referencia && m.monto > 0 && new Date(m.fecha) >= desde);
}

/* ---------- Mercado Pago ---------- */

async function mercadopago(desde: Date): Promise<MovimientoApi[]> {
  const clave = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!clave) return [];
  const q = new URLSearchParams({
    status: "approved", limit: "100", sort: "date_approved", criteria: "desc",
    "range": "date_created", "begin_date": desde.toISOString(), "end_date": "NOW",
  });
  const r = await fetch(`https://api.mercadopago.com/v1/payments/search?${q}`, {
    headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw new Error(String(data.message ?? "Mercado Pago rechazó la consulta."));

  const filas = (data.results ?? []) as Record<string, never>[];
  return filas.map((p) => {
    const monto = dinero(Number(p.transaction_amount ?? 0));
    const detalle = (p.transaction_details ?? {}) as { net_received_amount?: number };
    const neto = dinero(Number(detalle.net_received_amount ?? monto));
    const pagador = (p.payer ?? {}) as { email?: string; first_name?: string; last_name?: string };
    return {
      proveedor: "mercadopago" as const,
      referencia: String(p.id ?? ""),
      monto, fee: dinero(monto - neto), neto,
      moneda: moneda(p.currency_id as string),
      fecha: String(p.date_approved ?? p.date_created ?? new Date().toISOString()),
      clienteNombre: [pagador.first_name, pagador.last_name].filter(Boolean).join(" ") || undefined,
      clienteEmail: pagador.email?.toLowerCase(),
      descripcion: (p.description as string | undefined) ?? undefined,
    };
  }).filter((m) => m.monto > 0);
}

/* ---------- Handler ---------- */

export async function GET(peticion: Request) {
  const { desde, hasta } = desdeHasta(new URL(peticion.url));

  const fuentes: [ProveedorPasarela, () => Promise<MovimientoApi[]>][] = [
    ["stripe", () => stripe(desde)],
    ["paypal", () => paypal(desde, hasta)],
    ["hotmart", () => hotmart(desde, hasta)],
    ["whop", () => whop(desde)],
    ["mercadopago", () => mercadopago(desde)],
  ];

  const movimientos: MovimientoApi[] = [];
  const conectadas: ProveedorPasarela[] = [];
  const errores: { proveedor: string; mensaje: string }[] = [];

  await Promise.all(fuentes.map(async ([proveedor, traer]) => {
    try {
      const filas = await traer();
      /* Sin claves el adaptador devuelve vacío: no está conectada. */
      if (filas.length === 0 && !hayClaves(proveedor)) return;
      conectadas.push(proveedor);
      movimientos.push(...filas);
    } catch (err) {
      errores.push({ proveedor, mensaje: err instanceof Error ? err.message : "Error desconocido." });
    }
  }));

  return NextResponse.json({
    conectadas,
    errores,
    desde: desde.toISOString(),
    movimientos: movimientos.sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha)),
  });
}

function hayClaves(p: ProveedorPasarela): boolean {
  switch (p) {
    case "stripe": return Boolean(process.env.STRIPE_SECRET_KEY);
    case "paypal": return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
    case "hotmart": return Boolean(process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET && process.env.HOTMART_BASIC);
    case "whop": return Boolean(process.env.WHOP_API_KEY);
    case "mercadopago": return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
    default: return false;
  }
}
