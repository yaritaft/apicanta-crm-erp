import type { Moneda, ProveedorPasarela } from "./types";

/* ==================================================================
   Los adaptadores de cada pasarela, del lado del servidor.

   Cada una devuelve lo mismo con otro nombre y en otra unidad: Stripe
   habla en centavos, Hotmart en milisegundos, PayPal manda el fee en
   negativo. Acá se traduce todo a un solo formato y el resto de la app
   no vuelve a saber de dónde vino la plata.

   Docs:
   - Stripe        https://docs.stripe.com/api/charges/list
   - PayPal        https://developer.paypal.com/docs/api/transaction-search/v1/
   - Hotmart       https://developers.hotmart.com/docs/en/v1/sales/sales-history/
   - Whop          https://dev.whop.com/api-reference
   - Mercado Pago  https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_search/get
   ================================================================== */

export interface MovimientoApi {
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

export const dinero = (n: number) => Math.round(n * 100) / 100;
export const moneda = (s?: string): Moneda => (s ?? "").toUpperCase() === "ARS" ? "ARS" : "USD";

/* Ventana por defecto: 60 días. Alcanza para las cuotas del mes y para
   las que se atrasaron, sin traer años de historia en cada click. */
function desdeHasta(url: URL) {
  const dias = Number(url.searchParams.get("dias") ?? 60);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - Math.min(Math.max(dias, 1), 365) * 86400000);
  return { desde, hasta };
}

export async function json(r: Response): Promise<Record<string, unknown>> {
  const texto = await r.text();
  try { return JSON.parse(texto) as Record<string, unknown>; }
  catch { throw new Error(texto.slice(0, 200)); }
}

/* ---------- Stripe ---------- */

export async function stripe(desde: Date): Promise<MovimientoApi[]> {
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

export async function paypal(desde: Date, hasta: Date): Promise<MovimientoApi[]> {
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

export async function hotmart(desde: Date, hasta: Date): Promise<MovimientoApi[]> {
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

export async function whop(desde: Date): Promise<MovimientoApi[]> {
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

export async function mercadopago(desde: Date): Promise<MovimientoApi[]> {
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


/* ---------- Está configurada esta pasarela ---------- */

export function hayClaves(p: ProveedorPasarela): boolean {
  switch (p) {
    case "stripe": return Boolean(process.env.STRIPE_SECRET_KEY);
    case "paypal": return Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);
    case "hotmart": return Boolean(process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET && process.env.HOTMART_BASIC);
    case "whop": return Boolean(process.env.WHOP_API_KEY);
    case "mercadopago": return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
    default: return false;
  }
}

export const PROVEEDORES: ProveedorPasarela[] = ["stripe", "paypal", "hotmart", "whop", "mercadopago"];

/** Lo que trae cada pasarela en una ventana de tiempo. */
/* Los ids del catálogo de procesadores son fijos, así que el cobro ya
   entra sabiendo con qué medio de pago se va a registrar. */
export const procesadorDe = (p: ProveedorPasarela): string => `proc_${p}`;

export function listar(p: ProveedorPasarela, desde: Date, hasta: Date): Promise<MovimientoApi[]> {
  switch (p) {
    case "stripe": return stripe(desde);
    case "paypal": return paypal(desde, hasta);
    case "hotmart": return hotmart(desde, hasta);
    case "whop": return whop(desde);
    case "mercadopago": return mercadopago(desde);
    default: return Promise.resolve([]);
  }
}

/* ---------- Un cobro puntual ----------
   Lo que pide el webhook: llega un aviso con un id y le preguntamos a
   la pasarela cuánto entró de verdad. Nunca le creemos los montos al
   cuerpo del aviso si podemos preguntar. Si falla, devuelve null y el
   que llama se arregla con lo que vino en el aviso. */

export async function traerUno(p: ProveedorPasarela, id: string): Promise<MovimientoApi | null> {
  try {
    switch (p) {
      case "stripe": return await unStripe(id);
      case "mercadopago": return await unMercadoPago(id);
      case "paypal": return await unPayPal(id);
      case "hotmart": return await unHotmart(id);
      default: return null;
    }
  } catch {
    return null;
  }
}

async function unStripe(id: string): Promise<MovimientoApi | null> {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) return null;

  /* El aviso puede traer el intento o el cargo. Del intento se llega al
     cargo, que es el que tiene el fee. */
  const esIntento = id.startsWith("pi_");
  const ruta = esIntento
    ? `payment_intents/${id}?expand[]=latest_charge.balance_transaction`
    : `charges/${id}?expand[]=balance_transaction`;

  const r = await fetch(`https://api.stripe.com/v1/${ruta}`, {
    headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) return null;

  const c = (esIntento ? data.latest_charge : data) as Record<string, never> | null;
  if (!c || c.status !== "succeeded") return null;

  const bt = c.balance_transaction as { fee?: number; net?: number } | null;
  const monto = dinero(Number(c.amount ?? 0) / 100);
  const fee = dinero(Number(bt?.fee ?? 0) / 100);
  const detalles = (c.billing_details ?? {}) as { name?: string; email?: string };

  return {
    proveedor: "stripe",
    referencia: String(c.id),
    monto, fee,
    neto: bt?.net !== undefined ? dinero(Number(bt.net) / 100) : dinero(monto - fee),
    moneda: moneda(c.currency as string),
    fecha: new Date(Number(c.created ?? 0) * 1000).toISOString(),
    clienteNombre: detalles.name ?? undefined,
    clienteEmail: (detalles.email ?? (c.receipt_email as string | undefined))?.toLowerCase(),
    descripcion: (c.description as string | undefined) ?? undefined,
  };
}

async function unMercadoPago(id: string): Promise<MovimientoApi | null> {
  const clave = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!clave) return null;
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
  });
  const p = await json(r);
  if (!r.ok || p.status !== "approved") return null;

  const monto = dinero(Number(p.transaction_amount ?? 0));
  const detalle = (p.transaction_details ?? {}) as { net_received_amount?: number };
  const neto = dinero(Number(detalle.net_received_amount ?? monto));
  const pagador = (p.payer ?? {}) as { email?: string; first_name?: string; last_name?: string };

  return {
    proveedor: "mercadopago",
    referencia: String(p.id),
    monto, fee: dinero(monto - neto), neto,
    moneda: moneda(p.currency_id as string),
    fecha: String(p.date_approved ?? p.date_created ?? new Date().toISOString()),
    clienteNombre: [pagador.first_name, pagador.last_name].filter(Boolean).join(" ") || undefined,
    clienteEmail: pagador.email?.toLowerCase(),
    descripcion: (p.description as string | undefined) ?? undefined,
  };
}

async function unPayPal(id: string): Promise<MovimientoApi | null> {
  const cliente = process.env.PAYPAL_CLIENT_ID;
  const secreto = process.env.PAYPAL_CLIENT_SECRET;
  if (!cliente || !secreto) return null;
  const base = process.env.PAYPAL_ENV === "sandbox"
    ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

  const auth = await fetch(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${cliente}:${secreto}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });
  const tok = await json(auth);
  if (!auth.ok) return null;

  const r = await fetch(`${base}/v2/payments/captures/${id}`, {
    headers: { Authorization: `Bearer ${tok.access_token as string}` }, cache: "no-store",
  });
  const c = await json(r);
  if (!r.ok) return null;

  const importe = (c.amount ?? {}) as { value?: string; currency_code?: string };
  const reparto = (c.seller_receivable_breakdown ?? {}) as {
    paypal_fee?: { value?: string }; net_amount?: { value?: string };
  };
  const monto = dinero(Number(importe.value ?? 0));
  const fee = dinero(Number(reparto.paypal_fee?.value ?? 0));

  return {
    proveedor: "paypal",
    referencia: String(c.id),
    monto, fee,
    neto: dinero(Number(reparto.net_amount?.value ?? monto - fee)),
    moneda: moneda(importe.currency_code),
    fecha: String(c.create_time ?? new Date().toISOString()),
  };
}

async function unHotmart(transaccion: string): Promise<MovimientoApi | null> {
  /* Hotmart no expone el cobro suelto: se pide el historial filtrado
     por la transacción del aviso. */
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 365 * 86400000);
  const todos = await hotmart(desde, hasta);
  return todos.find((m) => m.referencia === transaccion) ?? null;
}
