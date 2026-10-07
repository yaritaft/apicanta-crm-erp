import { createHmac } from "node:crypto";
import type { Moneda, ProveedorPasarela } from "./types";
import { cuentaDeContraparte, type Punta } from "./traspasos";
import { clasificarMercury, reglasExtraDeEntorno, type ResumenMercury } from "./mercury";

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
  clienteTelefono?: string;
  metodo?: string;
  descripcion?: string;
}

/* Para la sync: qué cobros necesitan que se pida su detalle (los que ya
   están completos en la base no) y dónde anotar lo que salió mal sin
   frenar al resto. */
export interface OpcionesListar {
  necesitaDetalle?: (m: MovimientoApi) => boolean;
  avisos?: string[];
  /* Dónde anotar la plata que pasó entre cuentas propias (el depósito de
     una pasarela en el banco): no es un cobro, es la punta de un pase
     (lib/traspasos.ts). */
  puntas?: Punta[];
  /* Mercury: lo que se dejó afuera y por qué (pending, internos, anulados). */
  mercury?: ResumenMercury;
}

export const dinero = (n: number) => Math.round(n * 100) / 100;
export const moneda = (s?: string): Moneda => (s ?? "").toUpperCase() === "ARS" ? "ARS" : "USD";

type Obj = Record<string, unknown>;
const txt = (v: unknown): string | undefined => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
/* Un número que vino de verdad: null, "" o undefined no son 0. */
const num = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/* "visa" -> "Visa", "american_express" -> "American Express". */
const marca = (s?: string): string | undefined =>
  s ? s.replace(/[_-]+/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()).replace(/\bAmex\b/i, "American Express") : undefined;

/* "Tarjeta Visa ···4242", con la billetera si pagó con Apple Pay o Google Pay. */
function tarjeta(marcaCruda?: string, ultimos?: string, billetera?: string): string {
  const b = billetera ? ({ apple_pay: "Apple Pay", google_pay: "Google Pay", link: "Link", samsung_pay: "Samsung Pay" } as Record<string, string>)[billetera] ?? marca(billetera) : undefined;
  return [`Tarjeta${marcaCruda ? ` ${marca(marcaCruda)}` : ""}${ultimos ? ` ···${ultimos}` : ""}`, b].filter(Boolean).join(" · ");
}

/* De a pocos a la vez: cada pasarela tiene su límite de pedidos. */
async function enTandas<T>(items: T[], tanda: number, f: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += tanda) await Promise.all(items.slice(i, i + tanda).map(f));
}

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

/* Quién pagó: lo que cargó en el checkout y, si falta algo, lo que Stripe
   sabe del cliente. `sesion` son los datos de la sesión del checkout,
   cuando el aviso vino por ahí. */
function pagadorStripe(c: Obj, sesion?: Obj): { nombre?: string; email?: string; telefono?: string } {
  const b = (c.billing_details ?? {}) as Obj;
  const cliente = (c.customer && typeof c.customer === "object" ? c.customer : {}) as Obj;
  const s = sesion ?? {};
  return {
    nombre: txt(b.name) ?? txt(s.name) ?? txt(cliente.name),
    email: (txt(b.email) ?? txt(c.receipt_email) ?? txt(s.email) ?? txt(cliente.email))?.toLowerCase(),
    telefono: txt(b.phone) ?? txt(s.phone) ?? txt(cliente.phone),
  };
}

/* Cómo pagó dentro de Stripe: tarjeta (con Apple Pay o Link), débito ACH,
   transferencia, Klarna… */
function metodoStripe(c: Obj): string | undefined {
  const d = (c.payment_method_details ?? {}) as Obj;
  const tipo = txt(d.type);
  if (!tipo) return undefined;
  if (tipo === "card") {
    const t = (d.card ?? {}) as Obj;
    return tarjeta(txt(t.brand), txt(t.last4), txt((t.wallet as Obj | undefined)?.type));
  }
  const nombres: Record<string, string> = {
    us_bank_account: "Débito bancario (ACH)", ach_debit: "Débito bancario (ACH)", ach_credit_transfer: "Transferencia ACH",
    customer_balance: "Transferencia bancaria", link: "Link", klarna: "Klarna", affirm: "Affirm",
    afterpay_clearpay: "Afterpay", cashapp: "Cash App", paypal: "PayPal", sepa_debit: "Débito SEPA",
  };
  return nombres[tipo] ?? marca(tipo);
}

/* El cobro de Stripe es siempre el cargo (ch_ o py_): es el que tiene la
   comisión, en su balance_transaction. */
function deCargoStripe(c: Obj, sesion?: Obj): MovimientoApi {
  const bt = (c.balance_transaction && typeof c.balance_transaction === "object" ? c.balance_transaction : null) as Obj | null;
  const monto = dinero(Number(c.amount ?? 0) / 100);
  const fee = dinero((num(bt?.fee) ?? 0) / 100);
  const neto = num(bt?.net);
  const quien = pagadorStripe(c, sesion);
  return {
    metodo: metodoStripe(c),
    proveedor: "stripe",
    referencia: String(c.id),
    monto, fee,
    neto: neto !== undefined ? dinero(neto / 100) : dinero(monto - fee),
    moneda: moneda(c.currency as string),
    fecha: new Date(Number(c.created ?? 0) * 1000).toISOString(),
    clienteNombre: quien.nombre,
    clienteEmail: quien.email,
    clienteTelefono: quien.telefono,
    descripcion: txt(c.description),
  };
}

export async function stripe(desde: Date): Promise<MovimientoApi[]> {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) return [];
  const salida: MovimientoApi[] = [];
  let despuesDe: string | undefined;
  /* Stripe devuelve de a 100: se sigue pidiendo mientras haya más. */
  for (let pagina = 0; pagina < 10; pagina++) {
    const q = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(desde.getTime() / 1000)) });
    q.append("expand[]", "data.balance_transaction");
    q.append("expand[]", "data.customer");
    if (despuesDe) q.set("starting_after", despuesDe);
    const r = await fetch(`https://api.stripe.com/v1/charges?${q}`, {
      headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
    });
    const data = await json(r);
    if (!r.ok) throw rechazo("Stripe", r, data);
    const filas = (data.data ?? []) as Obj[];
    salida.push(...filas.filter((c) => c.status === "succeeded" && !c.refunded).map((c) => deCargoStripe(c)));
    if (!data.has_more || filas.length === 0) break;
    despuesDe = String(filas[filas.length - 1].id);
  }
  return salida;
}

/* Los retiros de Stripe al banco no son cobros: son la SALIDA de un pase
   entre cuentas propias (lib/traspasos.ts). Stripe sabe cuándo lo mandó;
   la llegada la ve el banco. Un retiro negativo es Stripe debitando del
   banco: plata que le llega. */
export function puntaDeRetiroStripe(p: Record<string, unknown>): Punta | null {
  const estado = String(p.status ?? "");
  if (estado === "failed" || estado === "canceled") return null;
  const monto = dinero(Number(p.amount ?? 0) / 100);
  const creado = Number(p.created ?? 0);
  if (!monto || !p.id || !(creado > 0)) return null;
  return {
    lado: monto > 0 ? "salida" : "llegada",
    cuentaId: procesadorDe("stripe"),
    monto: Math.abs(monto),
    moneda: moneda(p.currency as string),
    fecha: new Date(creado * 1000).toISOString(),
    ref: `stripe:${String(p.id)}`,
    contraparte: txt(p.statement_descriptor) ?? txt(p.description),
    seguro: true,
  };
}

export async function retirosDeStripe(desde: Date): Promise<Punta[]> {
  const clave = process.env.STRIPE_SECRET_KEY;
  if (!clave) return [];
  const salida: Punta[] = [];
  let despuesDe: string | undefined;
  for (let pagina = 0; pagina < 5; pagina++) {
    const q = new URLSearchParams({ limit: "100", "created[gte]": String(Math.floor(desde.getTime() / 1000)) });
    if (despuesDe) q.set("starting_after", despuesDe);
    const r = await fetch(`https://api.stripe.com/v1/payouts?${q}`, {
      headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
    });
    const data = await json(r);
    if (!r.ok) throw rechazo("Stripe (retiros)", r, data);
    const filas = (data.data ?? []) as Obj[];
    for (const f of filas) { const x = puntaDeRetiroStripe(f); if (x) salida.push(x); }
    if (!data.has_more || filas.length === 0) break;
    despuesDe = String(filas[filas.length - 1].id);
  }
  return salida;
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

function metodoHotmart(tipo?: string, cuotas?: number): string | undefined {
  if (!tipo) return undefined;
  const nombres: Record<string, string> = {
    CREDIT_CARD: "Tarjeta", PIX: "PIX", BILLET: "Boleto", PAYPAL: "PayPal", GOOGLE_PAY: "Google Pay",
    APPLE_PAY: "Apple Pay", DIRECT_DEBIT: "Débito", HOTCARD: "Hotcard", SAMSUNG_PAY: "Samsung Pay",
  };
  const base = nombres[tipo] ?? marca(tipo.toLowerCase());
  return cuotas && cuotas > 1 ? `${base} en ${cuotas} cuotas` : base;
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
    const comprador = (it.buyer ?? {}) as { name?: string; email?: string; phone?: string; checkout_phone?: string };
    const pago = (compra.payment ?? {}) as { type?: string; installments_number?: number };
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
      clienteTelefono: txt(comprador.phone) ?? txt(comprador.checkout_phone),
      metodo: metodoHotmart(pago.type, pago.installments_number),
      descripcion: producto.name ?? undefined,
    };
  }).filter((m) => m.referencia && m.monto > 0);
}

/* ---------- Whop ----------
   La lista (API v5) trae el monto y la fecha, pero no quién pagó ni cuánto
   se quedó Whop: los 50 cobros de Whop entraban sin nombre, sin correo y
   con comisión 0. Eso está en el detalle de cada pago de la API nueva
   (v1), que se pide sólo para los cobros que todavía no lo tienen. */

interface DetalleWhop { nombre?: string; email?: string; telefono?: string; metodo?: string; fee?: number; descripcion?: string }

function metodoWhop(p: Obj): string | undefined {
  const tipo = txt(p.payment_method_type) ?? txt((p.payment_method as Obj | undefined)?.payment_method_type);
  if (tipo === "card" || txt(p.card_brand)) return tarjeta(txt(p.card_brand), txt(p.card_last4));
  if (!tipo) return undefined;
  const nombres: Record<string, string> = { crypto: "Cripto", paypal: "PayPal", apple_pay: "Apple Pay", google_pay: "Google Pay", ach: "Débito bancario (ACH)", bank_transfer: "Transferencia" };
  return nombres[tipo] ?? marca(tipo);
}

async function detalleWhop(id: string, clave: string): Promise<DetalleWhop> {
  const r = await fetch(`https://api.whop.com/api/v1/payments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
  });
  const p = await json(r);
  if (!r.ok) throw rechazo("Whop (detalle del pago)", r, p);
  const usuario = (p.user ?? {}) as Obj;
  const miembro = (p.member ?? {}) as Obj;
  const membresia = (p.membership ?? {}) as Obj;
  const facturacion = (p.billing_address ?? {}) as Obj;
  const producto = (p.product ?? {}) as Obj;
  /* La comisión es lo que va de lo cobrado a lo que queda después de las
     comisiones; si no viene, la suma de las comisiones que lista. */
  const total = num(p.total) ?? num(p.subtotal);
  const despues = num(p.amount_after_fees);
  const listadas = Array.isArray(p.fees) ? (p.fees as Obj[]).reduce((a, f) => a + Math.abs(num(f.amount) ?? 0), 0) : 0;
  const fee = total !== undefined && despues !== undefined && total >= despues ? total - despues : listadas;
  return {
    nombre: txt(usuario.name) ?? txt(facturacion.name) ?? txt(usuario.username),
    email: txt(usuario.email)?.toLowerCase(),
    telefono: txt(miembro.phone) ?? txt(p.customer_phone) ?? txt(membresia.phone_number),
    metodo: metodoWhop(p),
    fee: fee > 0 ? dinero(fee) : undefined,
    descripcion: txt(producto.title),
  };
}

export async function whop(desde: Date, opciones: OpcionesListar = {}): Promise<MovimientoApi[]> {
  const clave = process.env.WHOP_API_KEY;
  if (!clave) return [];

  const filas: Obj[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await fetch(`https://api.whop.com/api/v5/company/payments?per=50&status=paid&page=${pagina}`, {
      headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
    });
    const data = await json(r);
    if (!r.ok) throw rechazo("Whop", r, data);
    const estas = (data.data ?? []) as Obj[];
    filas.push(...estas);
    /* Vienen de la más nueva a la más vieja: cuando la página ya es anterior
       a la ventana, no hace falta seguir. */
    const paginas = num((data.pagination as Obj | undefined)?.total_pages) ?? 1;
    const masVieja = estas.length ? Number(estas[estas.length - 1].paid_at ?? estas[estas.length - 1].created_at ?? 0) * 1000 : 0;
    if (estas.length === 0 || pagina >= paginas || masVieja < desde.getTime()) break;
  }

  const vistos = new Set<string>();
  const lista: MovimientoApi[] = filas
    .filter((p) => { const id = String(p.id ?? ""); if (vistos.has(id)) return false; vistos.add(id); return true; })
    .map((p) => {
      const monto = dinero(Number(p.final_amount ?? p.subtotal ?? 0));
      const fee = dinero((num(p.payment_processing_fee) ?? 0) + (num(p.whop_fee) ?? 0));
      const usuario = (p.user && typeof p.user === "object" ? p.user : {}) as Obj;
      return {
        proveedor: "whop" as const,
        referencia: String(p.id ?? ""),
        monto, fee, neto: dinero(monto - fee),
        moneda: moneda(p.currency as string),
        fecha: new Date(Number(p.paid_at ?? p.created_at ?? 0) * 1000).toISOString(),
        clienteNombre: txt(usuario.name) ?? txt(usuario.username),
        clienteEmail: txt(usuario.email)?.toLowerCase(),
        metodo: metodoWhop(p),
        descripcion: txt(p.product_title),
      };
    })
    .filter((m) => m.referencia && m.monto > 0 && new Date(m.fecha) >= desde);

  const faltan = lista.filter((m) => (!m.clienteEmail || !m.metodo || m.fee === 0) && (opciones.necesitaDetalle?.(m) ?? true));
  let fallo: string | undefined;
  await enTandas(faltan, 4, async (m) => {
    if (fallo) return;
    try {
      const d = await detalleWhop(m.referencia, clave);
      m.clienteNombre ??= d.nombre;
      m.clienteEmail ??= d.email;
      m.clienteTelefono ??= d.telefono;
      m.metodo ??= d.metodo;
      m.descripcion ??= d.descripcion;
      if (m.fee === 0 && d.fee !== undefined && d.fee < m.monto) { m.fee = d.fee; m.neto = dinero(m.monto - d.fee); }
    } catch (err) {
      /* Si la clave no tiene permiso para ver el detalle, falla igual para
         todos: se avisa una vez y los cobros entran como antes. */
      fallo = err instanceof Error ? err.message : "Error desconocido.";
    }
  });
  if (fallo) opciones.avisos?.push(`No se pudo ver quién pagó ni la comisión: ${fallo}`);
  return lista;
}

/* ---------- Mercado Pago ---------- */

const telefonoMP = (t?: { area_code?: string; number?: string }): string | undefined =>
  [txt(t?.area_code), txt(t?.number)].filter(Boolean).join(" ") || undefined;

function metodoMP(p: Obj): string | undefined {
  const tipo = txt(p.payment_type_id);
  const medio = txt(p.payment_method_id);
  const ultimos = txt((p.card as Obj | undefined)?.last_four_digits);
  if (tipo === "credit_card" || tipo === "debit_card" || tipo === "prepaid_card") {
    return `${tarjeta(medio, ultimos)}${tipo === "debit_card" ? " (débito)" : ""}`;
  }
  const nombres: Record<string, string> = { account_money: "Dinero en cuenta", ticket: "Efectivo (cupón)", bank_transfer: "Transferencia", atm: "Cajero" };
  return tipo ? nombres[tipo] ?? marca(tipo) : undefined;
}

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
    const pagador = (p.payer ?? {}) as { email?: string; first_name?: string; last_name?: string; phone?: { area_code?: string; number?: string } };
    return {
      proveedor: "mercadopago" as const,
      referencia: String(p.id ?? ""),
      monto, fee: dinero(monto - neto), neto,
      moneda: moneda(p.currency_id as string),
      fecha: String(p.date_approved ?? p.date_created ?? new Date().toISOString()),
      clienteNombre: [pagador.first_name, pagador.last_name].filter(Boolean).join(" ") || undefined,
      clienteEmail: pagador.email?.toLowerCase(),
      clienteTelefono: telefonoMP(pagador.phone),
      metodo: metodoMP(p as Obj),
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

export function listar(p: ProveedorPasarela, desde: Date, hasta: Date, opciones: OpcionesListar = {}): Promise<MovimientoApi[]> {
  switch (p) {
    case "stripe": return stripe(desde);
    case "hotmart": return hotmart(desde, hasta);
    case "whop": return whop(desde, opciones);
    case "mercadopago": return mercadopago(desde);
    case "dlocal": return dlocal(desde, hasta);
    case "mercury": return mercury(desde, opciones);
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
  const pedir = async (ruta: string): Promise<Obj | null> => {
    const r = await fetch(`https://api.stripe.com/v1/${ruta}`, {
      headers: { Authorization: `Bearer ${clave}` }, cache: "no-store",
    });
    const data = await json(r);
    return r.ok ? data : null;
  };

  /* El aviso puede traer el cargo, el intento de pago o la sesión del
     checkout (cs_…). El cobro se guarda siempre como el cargo: es el que
     tiene la comisión, y guardar la sesión aparte contaba dos veces el
     mismo pago, sin nombre ni correo. De la sesión se toman los datos que
     cargó la persona en el checkout. */
  let cargo: Obj | null = null;
  let sesion: Obj | undefined;
  if (id.startsWith("cs_")) {
    const s = await pedir(`checkout/sessions/${id}?expand[]=payment_intent.latest_charge.balance_transaction&expand[]=payment_intent.latest_charge.customer`);
    sesion = (s?.customer_details ?? undefined) as Obj | undefined;
    const intento = s?.payment_intent;
    cargo = (intento && typeof intento === "object" ? (intento as Obj).latest_charge : null) as Obj | null;
  } else if (id.startsWith("pi_")) {
    const intento = await pedir(`payment_intents/${id}?expand[]=latest_charge.balance_transaction&expand[]=latest_charge.customer`);
    cargo = (intento?.latest_charge ?? null) as Obj | null;
  } else {
    cargo = await pedir(`charges/${id}?expand[]=balance_transaction&expand[]=customer`);
  }
  if (!cargo || typeof cargo !== "object" || cargo.status !== "succeeded") return null;
  return deCargoStripe(cargo, sesion);
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
  const pagador = (p.payer ?? {}) as { email?: string; first_name?: string; last_name?: string; phone?: { area_code?: string; number?: string } };

  return {
    proveedor: "mercadopago",
    referencia: String(p.id),
    monto, fee: dinero(monto - neto), neto,
    moneda: moneda(p.currency_id as string),
    fecha: String(p.date_approved ?? p.date_created ?? new Date().toISOString()),
    clienteNombre: [pagador.first_name, pagador.last_name].filter(Boolean).join(" ") || undefined,
    clienteEmail: pagador.email?.toLowerCase(),
    clienteTelefono: telefonoMP(pagador.phone),
    metodo: metodoMP(p),
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

function metodoDlocal(p: Obj): string | undefined {
  const tipo = txt(p.payment_method_type) ?? txt(p.payment_method_flow);
  const t = (p.card ?? {}) as Obj;
  if (tipo === "CARD" || txt(t.brand)) return tarjeta(txt(t.brand), txt(t.last4));
  const nombres: Record<string, string> = { BANK_TRANSFER: "Transferencia", TICKET: "Efectivo (cupón)", WALLET: "Billetera" };
  return tipo ? nombres[tipo] ?? marca(tipo.toLowerCase()) : undefined;
}

function unaDeDlocal(p: Record<string, never>): MovimientoApi | null {
  const monto = dinero(Number(p.amount ?? 0));
  if (monto <= 0) return null;
  const pagador = (p.payer ?? {}) as { name?: string; email?: string; phone?: string };
  return {
    proveedor: "dlocal",
    referencia: String(p.id ?? ""),
    monto, fee: 0, neto: monto,
    moneda: moneda(p.currency as string),
    fecha: String(p.approved_date ?? p.created_date ?? new Date().toISOString()),
    clienteNombre: pagador.name ?? undefined,
    clienteEmail: pagador.email?.toLowerCase(),
    clienteTelefono: txt(pagador.phone),
    metodo: metodoDlocal(p as Obj),
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

/* Mercury junta ACH y wire en una sola cuenta: el tipo de movimiento dice cuál fue. */
function metodoMercury(kind: string): string | undefined {
  const nombres: Record<string, string> = {
    externalTransfer: "Transferencia ACH", incomingDomesticWire: "Wire", incomingInternationalWire: "Wire internacional",
    checkDeposit: "Cheque", treasuryTransfer: "Transferencia desde Treasury", other: "Otro",
  };
  return kind ? nombres[kind] ?? marca(kind.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()) : undefined;
}

/* Un movimiento de Mercury con una cuenta propia del otro lado es la punta
   de un pase entre cuentas (lib/traspasos.ts), no un cobro: lo que entra
   desde una pasarela es la LLEGADA; lo que sale hacia una, la SALIDA (ésa
   se propone: también podría ser un pago). Entre cuentas del mismo Mercury
   no hay pase: para la app es una sola cuenta. Sólo lo ya acreditado. */
export function puntaDeMercury(t: Record<string, unknown>, extras: readonly string[] = []): Punta | null {
  const monto = dinero(Number(t.amount ?? 0));
  if (!monto || !t.id) return null;
  /* Sólo lo que las reglas (lib/mercury.ts) dicen que es un pase: no lo anulado,
     ni lo interno (tarjeta, subcuentas), ni lo que sigue pending. */
  if (clasificarMercury(t, extras).tipo !== "pase") return null;
  const contraparte = String(t.counterpartyName ?? t.counterpartyNickname ?? "").trim();
  const otra = cuentaDeContraparte(contraparte);
  if (!otra) return null;
  const fecha = String(t.postedAt ?? t.createdAt ?? "");
  if (!fecha || Number.isNaN(Date.parse(fecha))) return null;
  return {
    lado: monto > 0 ? "llegada" : "salida",
    cuentaId: procesadorDe("mercury"),
    otraCuentaId: otra.cuentaId,
    monto: Math.abs(monto),
    moneda: "USD",
    fecha: new Date(fecha).toISOString(),
    ref: `mercury:${String(t.id)}`,
    contraparte: contraparte || undefined,
    seguro: monto > 0 && otra.seguro,
  };
}

/* ---------- Mercury ----------
   El banco no avisa: se le pregunta. Como cobro sólo entra lo que suma
   (amount positivo) y ya está acreditado, no lo que todavía está en
   camino. Lo que es de una cuenta propia se anota aparte, como punta de
   un pase (`opciones.puntas`). */

export async function mercury(desde: Date, opciones: OpcionesListar = {}): Promise<MovimientoApi[]> {
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
  const extras = reglasExtraDeEntorno(process.env.MERCURY_REGLAS_INTERNAS);

  for (const cuenta of lista) {
    if (!cuenta.id) continue;
    /* Una tarjeta de crédito no es una cuenta que cobra: todo lo suyo es el
       pago de la tarjeta o un gasto (que hoy no se trae). */
    if (/credit/i.test(String(cuenta.kind ?? ""))) continue;
    const q = new URLSearchParams({ limit: "500", start: desde.toISOString().slice(0, 10) });
    const rt = await fetch(`https://api.mercury.com/api/v1/account/${cuenta.id}/transactions?${q}`, {
      headers: cabeceras, cache: "no-store",
    });
    const data = await json(rt);
    if (!rt.ok) throw rechazo(`Mercury (movimientos de ${cuenta.id})`, rt, data);

    for (const t of (data.transactions ?? []) as Record<string, never>[]) {
      /* Qué es, según las reglas de lib/mercury.ts. */
      const c = clasificarMercury(t, extras);
      if (c.tipo === "anulado") { opciones.mercury?.anulados.push(String(t.id ?? "")); continue; }
      if (c.tipo === "interno") { if (opciones.mercury) opciones.mercury.internos++; continue; }
      /* Un pending no cuenta hasta asentarse: entonces entra con su fecha de
         asentado (postedAt), que puede ser otro día (y otro mes) que la de creación. */
      if (c.tipo === "en-proceso") { if (opciones.mercury) opciones.mercury.enProceso++; continue; }
      const punta = opciones.puntas ? puntaDeMercury(t, extras) : null;
      if (punta && new Date(punta.fecha) >= desde) opciones.puntas!.push(punta);
      const monto = dinero(Number(t.amount ?? 0));
      /* Negativo es plata que sale: no es un cobro. */
      if (monto <= 0) continue;
      const contraparte = String(t.counterpartyName ?? t.counterpartyNickname ?? "");
      if (NO_ES_CLIENTE.test(contraparte)) continue;
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
        metodo: metodoMercury(String(t.kind ?? "")),
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
        metodo: `${String(d.coin ?? "USDT")}${d.network ? ` (${String(d.network)})` : ""}`,
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
        /* La billetera entera: es lo único que dice quién pagó, y con ella la
           conciliación reconoce a quien ya pagó antes desde ahí. */
        metodo: `${info.tokenAbbr ?? "USDT"} (TRC20)`,
        descripcion: `${info.tokenAbbr ?? "USDT"} de ${String(t.from_address ?? "")}`,
      };
    })
    .filter((m) => m.monto > 0 && m.referencia !== "" && new Date(m.fecha) >= desde);
}
