import { createHmac } from "node:crypto";
import type { Moneda, ProveedorPasarela } from "./types";

/* ==================================================================
   Los adaptadores de cada pasarela, del lado del servidor.

   Cada una devuelve lo mismo con otro nombre y en otra unidad: Stripe
   habla en centavos, Hotmart en milisegundos, Binance devuelve los
   depósitos sin dueño. Acá se traduce todo a un solo formato y el resto de la app
   no vuelve a saber de dónde vino la plata.

   Docs:
   - Stripe        https://docs.stripe.com/api/charges/list
   - dLocal        https://docs.dlocal.com/reference/retrieve-a-payment
   - Mercury       https://docs.mercury.com/reference/get-transactions
   - Binance       https://developers.binance.com/docs/wallet/capital/deposite-history
   - Tronscan      https://docs.tronscan.org/api-endpoints/account-and-transfer
   - Hotmart       https://developers.hotmart.com/docs/en/v1/sales/sales-history/
   - Whop          https://dev.whop.com/api-reference
   - Mercado Pago  https://www.mercadopago.com.ar/developers/es/reference/payments/_payments_search/get
   ================================================================== */

export interface MovimientoApi {
  /* Casi siempre queda "pendiente" y lo define quien guarda. Se llena acá
     sólo cuando ya sabemos que ese cobro no hay que conciliarlo. */
  estado?: "pendiente" | "ignorado";
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
  catch { return { crudo: texto.slice(0, 300) }; }
}

/* Cuando una plataforma dice que no, el error tiene que decir QUÉ dijo:
   el status HTTP y su mensaje. "X rechazó la consulta" no sirve para
   arreglar nada. Nunca se incluyen nuestras claves, sólo su respuesta. */
export function rechazo(quien: string, r: Response, data: Record<string, unknown>): Error {
  const candidato = data.message ?? data.error_description ?? data.error ?? data.msg
    ?? data.errors ?? data.detail ?? data.crudo;
  const texto = typeof candidato === "string"
    ? candidato
    : JSON.stringify(candidato ?? data);
  return new Error(`${quien} respondió ${r.status}: ${texto.slice(0, 240)}`);
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
  if (!r.ok) throw rechazo("Stripe", r, data);

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

/* ---------- Hotmart ---------- */

/* Hotmart pagina con un cursor: se sigue pidiendo hasta que no haya
   próxima página, con un tope para no quedarse dando vueltas. */
async function paginasHotmart(
  ruta: string, parametros: Record<string, string>, token: string,
): Promise<Record<string, never>[]> {
  const items: Record<string, never>[] = [];
  let cursor: string | undefined;
  for (let pagina = 0; pagina < 20; pagina++) {
    const q = new URLSearchParams({ ...parametros, max_results: "100" });
    if (cursor) q.set("page_token", cursor);
    const r = await fetch(`https://developers.hotmart.com/payments/api/v1/${ruta}?${q}`, {
      /* Sin Content-Type, Hotmart contesta 400 aunque sea un GET. */
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      cache: "no-store",
    });
    const data = await json(r);
    if (!r.ok) throw rechazo(`Hotmart (${ruta})`, r, data);
    items.push(...((data.items ?? []) as Record<string, never>[]));
    cursor = (data.page_info as { next_page_token?: string } | undefined)?.next_page_token;
    if (!cursor) break;
  }
  return items;
}

export async function hotmart(desde: Date, hasta: Date): Promise<MovimientoApi[]> {
  const id = process.env.HOTMART_CLIENT_ID;
  const secreto = process.env.HOTMART_CLIENT_SECRET;
  const basic = process.env.HOTMART_BASIC;
  if (!id || !secreto || !basic) return [];

  const auth = await fetch(
    `https://api-sec-vlc.hotmart.com/security/oauth/token?grant_type=client_credentials&client_id=${id}&client_secret=${secreto}`,
    {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      cache: "no-store",
    },
  );
  const tok = await json(auth);
  if (!auth.ok) throw rechazo("Hotmart (login)", auth, tok);
  const token = tok.access_token as string;

  /* Sin filtro de estado, Hotmart devuelve sólo APPROVED y COMPLETE, que
     es justo la plata que entró. Filtrar por APPROVED dejaba afuera las
     compras ya completadas. */
  const rango = { start_date: String(desde.getTime()), end_date: String(hasta.getTime()) };

  const [ventas, comisiones] = await Promise.all([
    paginasHotmart("sales/history", rango, token),
    /* La comisión no viene en el historial: va en otro endpoint. Es lo
       que le queda al productor después de Hotmart, coproductores y
       afiliados — o sea, la plata que efectivamente llega. */
    paginasHotmart("sales/commissions", { ...rango, commission_as: "PRODUCER" }, token).catch(() => []),
  ]);

  const netoPorTransaccion = new Map<string, number>();
  for (const c of comisiones) {
    const lista = (c.commissions ?? []) as { commission?: { value?: number }; source?: string }[];
    const nuestra = lista.find((x) => x.source === "PRODUCER")?.commission?.value;
    if (nuestra !== undefined) netoPorTransaccion.set(String(c.transaction ?? ""), Number(nuestra));
  }

  return ventas.map((it) => {
    const compra = (it.purchase ?? {}) as Record<string, never>;
    const precio = (compra.price ?? {}) as { value?: number; currency_code?: string };
    const referencia = String(compra.transaction ?? "");
    const monto = dinero(Number(precio.value ?? 0));
    const nuestra = netoPorTransaccion.get(referencia);
    const neto = nuestra !== undefined ? dinero(nuestra) : monto;
    const comprador = (it.buyer ?? {}) as { name?: string; email?: string };
    const producto = (it.product ?? {}) as { name?: string };
    return {
      proveedor: "hotmart" as const,
      referencia,
      monto, fee: dinero(Math.max(monto - neto, 0)), neto,
      moneda: moneda(precio.currency_code),
      /* La fecha que importa es cuándo se aprobó el pago, no cuándo se
         generó la orden: un boleto puede aprobarse días después. */
      fecha: new Date(Number(compra.approved_date ?? compra.order_date ?? Date.now())).toISOString(),
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
  if (!r.ok) throw rechazo("Whop", r, data);

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
  if (!r.ok) throw rechazo("Mercado Pago", r, data);

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
    case "hotmart": return Boolean(process.env.HOTMART_CLIENT_ID && process.env.HOTMART_CLIENT_SECRET && process.env.HOTMART_BASIC);
    case "whop": return Boolean(process.env.WHOP_API_KEY);
    case "dlocal": return Boolean(process.env.DLOCAL_X_LOGIN && process.env.DLOCAL_TRANS_KEY && process.env.DLOCAL_SECRET_KEY);
    case "mercury": return Boolean(process.env.MERCURY_API_TOKEN);
    case "binance": return Boolean(process.env.BINANCE_API_KEY && process.env.BINANCE_API_SECRET);
    case "trust": return Boolean(process.env.TRUST_WALLET_ADDRESS);
    case "mercadopago": return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN);
    default: return false;
  }
}

export const PROVEEDORES: ProveedorPasarela[] = [
  "stripe", "mercadopago", "hotmart", "whop", "dlocal", "mercury", "binance", "trust",
];

/** Lo que trae cada pasarela en una ventana de tiempo. */
/* Los ids del catálogo de procesadores son fijos, así que el cobro ya
   entra sabiendo con qué medio de pago se va a registrar. */
export const procesadorDe = (p: ProveedorPasarela): string => `proc_${p}`;

export function listar(p: ProveedorPasarela, desde: Date, hasta: Date): Promise<MovimientoApi[]> {
  switch (p) {
    case "stripe": return stripe(desde);
    case "hotmart": return hotmart(desde, hasta);
    case "whop": return whop(desde);
    case "mercadopago": return mercadopago(desde);
    case "dlocal": return dlocal(desde, hasta);
    case "mercury": return mercury(desde);
    case "binance": return binance(desde);
    case "trust": return trust(desde);
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
      case "dlocal": return await unDlocal(id);
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

async function unHotmart(transaccion: string): Promise<MovimientoApi | null> {
  /* Hotmart no expone el cobro suelto: se pide el historial filtrado
     por la transacción del aviso. */
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - 365 * 86400000);
  const todos = await hotmart(desde, hasta);
  return todos.find((m) => m.referencia === transaccion) ?? null;
}

/* ---------- dLocal ----------
   Firma propia: HMAC del login + la fecha + el cuerpo, con la clave
   secreta. Sin la cabecera X-Date exacta que se firmó, rebota. */

function cabecerasDlocal(cuerpo = ""): Record<string, string> | null {
  const login = process.env.DLOCAL_X_LOGIN;
  const trans = process.env.DLOCAL_TRANS_KEY;
  const secreto = process.env.DLOCAL_SECRET_KEY;
  if (!login || !trans || !secreto) return null;
  const fecha = new Date().toISOString();
  const firma = createHmac("sha256", secreto).update(`${login}${fecha}${cuerpo}`).digest("hex");
  return {
    "X-Date": fecha,
    "X-Login": login,
    "X-Trans-Key": trans,
    "Content-Type": "application/json",
    Authorization: `V2-HMAC-SHA256, Signature: ${firma}`,
  };
}

const APROBADO_DLOCAL = /paid|authorized/i;

function unaDeDlocal(p: Record<string, never>): MovimientoApi | null {
  const monto = dinero(Number(p.amount ?? 0));
  if (monto <= 0) return null;
  const pagador = (p.payer ?? {}) as { name?: string; email?: string };
  return {
    proveedor: "dlocal",
    referencia: String(p.id ?? ""),
    monto, fee: 0, neto: monto,
    moneda: moneda(p.currency as string),
    fecha: String(p.approved_date ?? p.created_date ?? new Date().toISOString()),
    clienteNombre: pagador.name ?? undefined,
    clienteEmail: pagador.email?.toLowerCase(),
    descripcion: (p.description as string | undefined) ?? (p.order_id as string | undefined),
  };
}

export async function dlocal(desde: Date, hasta: Date): Promise<MovimientoApi[]> {
  const cabeceras = cabecerasDlocal();
  if (!cabeceras) return [];
  const q = new URLSearchParams({
    page: "1", page_size: "100",
    created_date_from: desde.toISOString(),
    created_date_to: hasta.toISOString(),
  });
  const r = await fetch(`https://api.dlocal.com/payments?${q}`, { headers: cabeceras, cache: "no-store" });
  const data = await json(r);
  if (!r.ok) throw rechazo("dLocal", r, data);

  const filas = (Array.isArray(data) ? data : (data.data ?? [])) as Record<string, never>[];
  return filas
    .filter((p) => APROBADO_DLOCAL.test(String(p.status ?? "")))
    .map(unaDeDlocal)
    .filter((m): m is MovimientoApi => m !== null && m.referencia !== "");
}

async function unDlocal(id: string): Promise<MovimientoApi | null> {
  const cabeceras = cabecerasDlocal();
  if (!cabeceras) return null;
  const r = await fetch(`https://api.dlocal.com/payments/${id}`, { headers: cabeceras, cache: "no-store" });
  const p = await json(r);
  if (!r.ok || !APROBADO_DLOCAL.test(String(p.status ?? ""))) return null;
  return unaDeDlocal(p as Record<string, never>);
}

/* Lo que entra a Mercury desde estas contrapartes NO es un cliente: es
   una pasarela depositando lo que ya cobró (y que ya entró cobro por
   cobro desde esa pasarela), o el propio banco devolviendo cashback.
   Dejarlo pasar contaría la misma plata dos veces: en 60 días eran
   US$ 113.000 de Stripe, Hotmart y Whop repetidos. */
const NO_ES_CLIENTE = /\b(stripe|hotmart|whop|dlocal|mercado\s*pago|paypal|mercury)\b/i;

/* Estos tres son, según Yari, vías por las que Hotmart liquida la plata —
   pero dijo "creo que", así que no se descartan: entran marcados como
   ignorados. Quedan a la vista en su pestaña, fuera del camino, y si
   alguno resulta ser un cliente se recupera con un clic desde la
   pantalla, sin tocar el código. */
const LIQUIDACION_PROBABLE = /\b(arx|bridge|masspay)\b/i;

/* ---------- Mercury ----------
   El banco no avisa: se le pregunta. Sólo entra lo que suma (amount
   positivo) y ya está acreditado, no lo que todavía está en camino. */

export async function mercury(desde: Date): Promise<MovimientoApi[]> {
  const crudo = process.env.MERCURY_API_TOKEN?.trim();
  if (!crudo) return [];
  /* El token de Mercury es "secret-token:mercury_production_…" entero. Al
     copiarlo del panel es muy fácil quedarse sólo con la segunda parte, y
     Mercury responde 401 sin más. Se completa acá en vez de pedirle a
     nadie que lo vuelva a pegar. */
  const clave = crudo.startsWith("secret-token:") ? crudo : `secret-token:${crudo}`;
  const cabeceras = { Authorization: `Bearer ${clave}` };

  const rc = await fetch("https://api.mercury.com/api/v1/accounts", { headers: cabeceras, cache: "no-store" });
  const cuentas = await json(rc);
  if (!rc.ok) throw rechazo("Mercury (cuentas)", rc, cuentas);

  const lista = (cuentas.accounts ?? []) as { id?: string; kind?: string }[];
  const salida: MovimientoApi[] = [];

  for (const cuenta of lista) {
    if (!cuenta.id) continue;
    const q = new URLSearchParams({ limit: "500", start: desde.toISOString().slice(0, 10) });
    const rt = await fetch(`https://api.mercury.com/api/v1/account/${cuenta.id}/transactions?${q}`, {
      headers: cabeceras, cache: "no-store",
    });
    const data = await json(rt);
    if (!rt.ok) throw rechazo(`Mercury (movimientos de ${cuenta.id})`, rt, data);

    for (const t of (data.transactions ?? []) as Record<string, never>[]) {
      const monto = dinero(Number(t.amount ?? 0));
      /* Negativo es plata que sale: no es un cobro. */
      if (monto <= 0) continue;
      /* Entre cuentas propias de Mercury tampoco. */
      if (String(t.kind ?? "") === "internalTransfer") continue;
      const contraparte = String(t.counterpartyName ?? t.counterpartyNickname ?? "");
      if (NO_ES_CLIENTE.test(contraparte)) continue;
      if (String(t.status ?? "").toLowerCase() === "failed") continue;
      const fecha = String(t.postedAt ?? t.createdAt ?? "");
      if (fecha && new Date(fecha) < desde) continue;

      salida.push({
        proveedor: "mercury",
        estado: LIQUIDACION_PROBABLE.test(contraparte) ? "ignorado" : "pendiente",
        referencia: String(t.id ?? ""),
        monto, fee: 0, neto: monto,
        moneda: "USD",
        fecha: fecha || new Date().toISOString(),
        clienteNombre: (t.counterpartyName as string | undefined) ?? (t.counterpartyNickname as string | undefined),
        descripcion: (t.externalMemo as string | undefined) ?? (t.bankDescription as string | undefined) ?? undefined,
      });
    }
  }
  return salida.filter((m) => m.referencia !== "");
}

/* ---------- Binance ----------
   Los depósitos de USDT. La API firma cada consulta con el secreto y
   exige que el reloj no esté corrido más de unos segundos. */

export async function binance(desde: Date): Promise<MovimientoApi[]> {
  const clave = process.env.BINANCE_API_KEY;
  const secreto = process.env.BINANCE_API_SECRET;
  if (!clave || !secreto) return [];

  const q = new URLSearchParams({
    startTime: String(desde.getTime()),
    timestamp: String(Date.now()),
    recvWindow: "20000",
  });
  const firma = createHmac("sha256", secreto).update(q.toString()).digest("hex");

  const r = await fetch(`https://api.binance.com/sapi/v1/capital/deposit/hisrec?${q}&signature=${firma}`, {
    headers: { "X-MBX-APIKEY": clave }, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw rechazo("Binance", r, data);

  const filas = (Array.isArray(data) ? data : []) as Record<string, never>[];
  return filas
    /* 1 = acreditado. 0 es pendiente y 6 está en revisión: no es plata todavía. */
    .filter((d) => Number(d.status) === 1)
    .map((d) => {
      const monto = dinero(Number(d.amount ?? 0));
      return {
        proveedor: "binance" as const,
        referencia: String(d.txId ?? d.id ?? ""),
        monto, fee: 0, neto: monto,
        moneda: "USD" as Moneda,
        fecha: new Date(Number(d.insertTime ?? Date.now())).toISOString(),
        descripcion: `Depósito ${String(d.coin ?? "USDT")}${d.network ? ` (${String(d.network)})` : ""}`,
      };
    })
    .filter((m) => m.monto > 0 && m.referencia !== "");
}

/* ---------- Trust (USDT en la blockchain) ----------
   Una billetera propia no tiene API ni dueño: lo que hay es la cadena,
   que es pública. Se mira quién le transfirió USDT a la dirección. */

const USDT_TRC20 = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";

export async function trust(desde: Date): Promise<MovimientoApi[]> {
  const direccion = process.env.TRUST_WALLET_ADDRESS;
  if (!direccion) return [];

  const q = new URLSearchParams({
    limit: "50", start: "0", sort: "-timestamp", count: "true",
    relatedAddress: direccion, contract_address: USDT_TRC20,
  });
  const cabeceras: Record<string, string> = {};
  if (process.env.TRONSCAN_API_KEY) cabeceras["TRON-PRO-API-KEY"] = process.env.TRONSCAN_API_KEY;

  const r = await fetch(`https://apilist.tronscanapi.com/api/token_trc20/transfers?${q}`, {
    headers: cabeceras, cache: "no-store",
  });
  const data = await json(r);
  if (!r.ok) throw rechazo("Tronscan", r, data);

  const filas = (data.token_transfers ?? []) as Record<string, never>[];
  return filas
    /* Sólo lo que entró a nuestra dirección, no lo que salió. */
    .filter((t) => String(t.to_address ?? "").toLowerCase() === direccion.toLowerCase())
    .map((t) => {
      const info = (t.tokenInfo ?? {}) as { tokenDecimal?: number; tokenAbbr?: string };
      const decimales = Number(info.tokenDecimal ?? 6);
      const monto = dinero(Number(t.quant ?? 0) / 10 ** decimales);
      return {
        proveedor: "trust" as const,
        referencia: String(t.transaction_id ?? ""),
        monto, fee: 0, neto: monto,
        moneda: "USD" as Moneda,
        fecha: new Date(Number(t.block_ts ?? Date.now())).toISOString(),
        descripcion: `${info.tokenAbbr ?? "USDT"} de ${String(t.from_address ?? "").slice(0, 10)}…`,
      };
    })
    .filter((m) => m.monto > 0 && m.referencia !== "" && new Date(m.fecha) >= desde);
}
