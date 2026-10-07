import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { guardarMovimientos, guardarReembolsos, hayServidor } from "@/lib/servidor";
import {
  dinero, moneda, procesadorDe, reembolsoDeHotmart, reembolsoDeStripe, reembolsoDeWhop, reembolsosDeHotmart,
  reembolsosDeStripePorId, traerUno, PROVEEDORES, type MovimientoApi,
} from "@/lib/pasarelas-api";
import type { ReembolsoCrudo } from "@/lib/reembolsos";
import type { ProveedorPasarela } from "@/lib/types";

/* ==================================================================
   Webhooks de las pasarelas: los cobros en tiempo real.

   Cuando alguien paga, la pasarela golpea esta URL. El aviso sólo se
   usa para saber QUÉ cobro llegó; los montos se los volvemos a
   preguntar a la pasarela por API, porque un cuerpo HTTP lo puede
   escribir cualquiera y de acá sale plata. Si no hay claves para
   preguntar, se usa lo que vino en el aviso.

   Puerta de entrada, en este orden:
   1. El token de la URL (lo generamos nosotros, va en el link que se
      pega en cada pasarela).
   2. La firma propia de la pasarela, cuando la tenemos configurada:
      la de Stripe y el hottok de Hotmart.

   Los avisos de reembolso (Stripe «refund.created» o «charge.refunded»,
   Hotmart «PURCHASE_REFUNDED», Whop) NO son cobros: nunca entran como
   movimiento. Se guardan como devolución propuesta, o atadas a la que ya
   cargó alguien (lib/reembolsos.ts), y no restan plata hasta que Finanzas
   las confirma.

   Siempre se responde 200 salvo que el aviso no esté autorizado: un
   500 hace que la pasarela reintente el mismo evento durante días.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Payload = Record<string, unknown>;

const leer = (o: unknown, ...camino: string[]): unknown =>
  camino.reduce<unknown>((x, k) => (x && typeof x === "object" ? (x as Payload)[k] : undefined), o);

const texto = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;

const numero = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

function iguales(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/* La firma de Stripe: t=<segundos>,v1=<hmac de "t.cuerpo"> */
function firmaStripeValida(cuerpo: string, cabecera: string | null, secreto: string): boolean {
  if (!cabecera) return false;
  const partes = Object.fromEntries(
    cabecera.split(",").map((p) => p.split("=") as [string, string]),
  );
  if (!partes.t || !partes.v1) return false;
  const esperado = createHmac("sha256", secreto).update(`${partes.t}.${cuerpo}`).digest("hex");
  return iguales(esperado, partes.v1);
}

/* ---------- Del aviso a un reembolso ---------- */

/* El nombre del evento, donde lo pone cada pasarela. */
const tipoDelAviso = (proveedor: ProveedorPasarela, cuerpo: Payload): string =>
  (proveedor === "hotmart" ? texto(cuerpo.event) : undefined) ?? texto(cuerpo.type) ?? texto(cuerpo.action) ?? texto(cuerpo.event) ?? "";

const ES_REEMBOLSO = /refund|charge.?back|reembols|contracargo/i;

/** Lo que devolvió la pasarela, según el aviso. Los montos se le vuelven a
 *  preguntar por API cuando se puede; el cuerpo es sólo el pitido. */
async function reembolsosDelAviso(proveedor: ProveedorPasarela, cuerpo: Payload, tipo: string): Promise<ReembolsoCrudo[]> {
  switch (proveedor) {
    case "stripe": {
      const obj = leer(cuerpo, "data", "object") as Payload | undefined;
      const id = texto(obj?.id);
      if (!obj || !id) return [];
      /* El aviso trae el reembolso (re_…) o el cargo devuelto (ch_…): se pide el
         de verdad. Si no se puede, se usa lo que vino. */
      const confirmados = await reembolsosDeStripePorId(id).catch(() => []);
      if (confirmados.length) return confirmados;
      const delAviso = id.startsWith("re_") ? reembolsoDeStripe(obj) : null;
      return delAviso ? [delAviso] : [];
    }
    case "hotmart": {
      const compra = leer(cuerpo, "data", "purchase") as Payload | undefined;
      const transaccion = texto(compra?.transaction);
      if (!compra || !transaccion) return [];
      const contracargo = /charge.?back/i.test(tipo);
      const hasta = new Date();
      const confirmados = await reembolsosDeHotmart(new Date(hasta.getTime() - 365 * 86400000), hasta).catch(() => []);
      const confirmado = confirmados.find((r) => r.referenciasCobro?.includes(transaccion));
      if (confirmado) return [confirmado];
      const delAviso = reembolsoDeHotmart({
        purchase: { transaction: transaccion, price: { value: numero(leer(compra, "price", "value")), currency_code: texto(leer(compra, "price", "currency_value")) }, approved_date: numero(compra.approved_date) || numero(compra.order_date) },
        buyer: { name: texto(leer(cuerpo, "data", "buyer", "name")), email: texto(leer(cuerpo, "data", "buyer", "email")) },
      } as never, contracargo);
      return delAviso ? [delAviso] : [];
    }
    case "whop": {
      /* Sin forma verificada del aviso de Whop: se lee lo que suele traer y, si no
         alcanza, no se inventa nada. */
      const d = (leer(cuerpo, "data") ?? cuerpo) as Payload;
      const pagoId = texto(d.payment_id) ?? texto(leer(d, "payment", "id")) ?? texto(d.id);
      if (!pagoId) return [];
      const r = reembolsoDeWhop({
        ...d, id: pagoId,
        refunded_amount: d.refunded_amount ?? d.amount ?? leer(d, "payment", "final_amount"),
        currency: d.currency ?? leer(d, "payment", "currency"),
        user: d.user ?? leer(d, "payment", "user"),
      });
      return r ? [r] : [];
    }
    default:
      return [];
  }
}

/* ---------- Del aviso a un movimiento ---------- */

function delPayload(proveedor: ProveedorPasarela, cuerpo: Payload): { id?: string; movimiento?: MovimientoApi } {
  switch (proveedor) {
    case "stripe": {
      const obj = leer(cuerpo, "data", "object") as Payload | undefined;
      const id = texto(obj?.id);
      if (!obj || !id) return {};
      /* Un reembolso (re_…), una disputa (dp_…) o cualquier otro objeto de Stripe
         no es un cobro: sólo el cargo, el intento de pago o la sesión lo son. */
      if (!/^(ch|py|pi|cs)_/.test(id)) return {};
      /* La sesión del checkout (cs_…) no es un cobro: es el mismo pago que
         llega también como cargo. Sólo sirve para ir a buscar su cargo; si
         no se puede, el cargo entra por su propio aviso y por la sync. */
      if (id.startsWith("cs_")) return { id };
      const monto = dinero(numero(obj.amount ?? obj.amount_total) / 100);
      return {
        id,
        movimiento: monto > 0 ? {
          proveedor: "stripe", referencia: id, monto, fee: 0, neto: monto,
          moneda: moneda(texto(obj.currency)),
          fecha: new Date(numero(obj.created) * 1000 || Date.now()).toISOString(),
          clienteNombre: texto(leer(obj, "billing_details", "name")),
          clienteEmail: texto(leer(obj, "billing_details", "email"))?.toLowerCase(),
          clienteTelefono: texto(leer(obj, "billing_details", "phone")),
          descripcion: texto(obj.description),
        } : undefined,
      };
    }
    case "dlocal": {
      /* dLocal manda el pago entero en el aviso, pero igual se le
         vuelve a preguntar: el id es lo único que se le cree. */
      const id = texto(cuerpo.id) ?? texto(leer(cuerpo, "payment", "id"));
      if (!id) return {};
      const monto = dinero(numero(cuerpo.amount ?? leer(cuerpo, "payment", "amount")));
      return {
        id,
        movimiento: monto > 0 ? {
          proveedor: "dlocal", referencia: id, monto, fee: 0, neto: monto,
          moneda: moneda(texto(cuerpo.currency)),
          fecha: texto(cuerpo.approved_date) ?? texto(cuerpo.created_date) ?? new Date().toISOString(),
          clienteNombre: texto(leer(cuerpo, "payer", "name")),
          clienteEmail: texto(leer(cuerpo, "payer", "email"))?.toLowerCase(),
          clienteTelefono: texto(leer(cuerpo, "payer", "phone")),
          descripcion: texto(cuerpo.description) ?? texto(cuerpo.order_id),
        } : undefined,
      };
    }
    case "hotmart": {
      const compra = leer(cuerpo, "data", "purchase") as Payload | undefined;
      const id = texto(compra?.transaction);
      if (!compra || !id) return {};
      const monto = dinero(numero(leer(compra, "price", "value")));
      return {
        id,
        movimiento: monto > 0 ? {
          proveedor: "hotmart", referencia: id, monto, fee: 0, neto: monto,
          moneda: moneda(texto(leer(compra, "price", "currency_value"))),
          fecha: new Date(numero(compra.order_date) || Date.now()).toISOString(),
          clienteNombre: texto(leer(cuerpo, "data", "buyer", "name")),
          clienteEmail: texto(leer(cuerpo, "data", "buyer", "email"))?.toLowerCase(),
          clienteTelefono: texto(leer(cuerpo, "data", "buyer", "checkout_phone")) ?? texto(leer(cuerpo, "data", "buyer", "phone")),
          descripcion: texto(leer(cuerpo, "data", "product", "name")),
        } : undefined,
      };
    }
    case "whop": {
      const d = (leer(cuerpo, "data") ?? cuerpo) as Payload;
      const id = texto(d.id);
      if (!id) return {};
      const monto = dinero(numero(d.final_amount ?? d.subtotal ?? d.amount));
      const fee = dinero(numero(d.payment_processing_fee) + numero(d.whop_fee));
      return {
        id,
        movimiento: monto > 0 ? {
          proveedor: "whop", referencia: id, monto, fee, neto: dinero(monto - fee),
          moneda: moneda(texto(d.currency)),
          fecha: new Date(numero(d.paid_at ?? d.created_at) * 1000 || Date.now()).toISOString(),
          clienteNombre: texto(leer(d, "user", "name")) ?? texto(leer(d, "billing_address", "name")) ?? texto(leer(d, "user", "username")),
          clienteEmail: texto(leer(d, "user", "email"))?.toLowerCase(),
          clienteTelefono: texto(leer(d, "member", "phone")) ?? texto(d.customer_phone),
          descripcion: texto(d.product_title),
        } : undefined,
      };
    }
    case "mercadopago": {
      /* Mercado Pago sólo manda el id: hay que ir a buscar el pago. */
      return { id: texto(leer(cuerpo, "data", "id")) ?? texto(cuerpo.id) };
    }
    default:
      return {};
  }
}

/* ---------- Handler ---------- */

export async function POST(peticion: Request, ctx: { params: Promise<{ proveedor: string }> }) {
  const { proveedor: crudo } = await ctx.params;
  const proveedor = crudo as ProveedorPasarela;
  if (!PROVEEDORES.includes(proveedor)) {
    return NextResponse.json({ error: "Pasarela desconocida." }, { status: 404 });
  }

  const cuerpoTexto = await peticion.text();
  const url = new URL(peticion.url);

  /* 1. El token del link */
  const token = process.env.PASARELAS_WEBHOOK_TOKEN;
  let autorizado = Boolean(token) && url.searchParams.get("token") === token;

  /* 2. La firma propia de la pasarela */
  const secretoStripe = process.env.STRIPE_WEBHOOK_SECRET;
  if (!autorizado && proveedor === "stripe" && secretoStripe) {
    autorizado = firmaStripeValida(cuerpoTexto, peticion.headers.get("stripe-signature"), secretoStripe);
  }
  const hottok = process.env.HOTMART_HOTTOK;
  if (!autorizado && proveedor === "hotmart" && hottok) {
    autorizado = peticion.headers.get("x-hotmart-hottok") === hottok;
  }
  /* Sin ningún secreto configurado no se acepta nada: una URL abierta
     que escribe cobros es una invitación a inventar plata. */
  if (!autorizado) {
    return NextResponse.json({ error: "Aviso sin autorizar." }, { status: 401 });
  }

  let cuerpo: Payload = {};
  try { cuerpo = JSON.parse(cuerpoTexto) as Payload; } catch { /* algunos mandan form-urlencoded */ }

  /* Un aviso de reembolso nunca es un cobro: se guarda aparte, como devolución. */
  const tipo = tipoDelAviso(proveedor, cuerpo);
  if (ES_REEMBOLSO.test(tipo)) {
    const reembolsos = await reembolsosDelAviso(proveedor, cuerpo, tipo);
    if (reembolsos.length === 0) return NextResponse.json({ ok: true, ignorado: "El aviso no trae un reembolso que se pueda leer." });
    if (!hayServidor) return NextResponse.json({ ok: true, guardados: 0, aviso: "Falta SUPABASE_SERVICE_ROLE_KEY." });
    const g = await guardarReembolsos(reembolsos);
    return NextResponse.json({ ok: true, reembolsos: g.nuevas + g.atadas, propuestas: g.nuevas, atadas: g.atadas, sinTabla: g.sinTabla, error: g.error });
  }

  const { id, movimiento: delAviso } = delPayload(proveedor, cuerpo);
  if (!id) return NextResponse.json({ ok: true, ignorado: "El aviso no trae un cobro." });

  /* Lo que diga la pasarela por API gana; el aviso es sólo el pitido. */
  const confirmado = await traerUno(proveedor, id);
  const movimiento = confirmado ?? delAviso;
  if (!movimiento) return NextResponse.json({ ok: true, ignorado: "El aviso no es un cobro aprobado." });

  if (!hayServidor) {
    return NextResponse.json({ ok: true, guardados: 0, aviso: "Falta SUPABASE_SERVICE_ROLE_KEY." });
  }

  const r = await guardarMovimientos([{
    ...movimiento,
    procesadorId: procesadorDe(proveedor),
    origen: "webhook",
  }]);

  return NextResponse.json({ ok: true, guardados: r.guardados, error: r.error });
}

/* Varias pasarelas prueban la URL con un GET antes de habilitarla. */
export async function GET() {
  return NextResponse.json({ ok: true, listo: hayServidor });
}
