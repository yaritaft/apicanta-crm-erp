import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Movimiento, Traspaso } from "./types";
import { feeDelPago, parcheDeCobro } from "./completar-cobros";
import { conciliarPuntas, type Punta } from "./traspasos";
import { NOTA_ANULADO } from "./mercury";

/* ==================================================================
   Cliente de Supabase del lado del servidor.

   Las pantallas escriben con la clave anónima y pasan por RLS: quien
   escribe es una persona del equipo. Un webhook no es una persona —
   lo llama Stripe a las tres de la mañana — así que necesita la clave
   de servicio, que saltea RLS. Por eso vive sólo acá, en código que
   nunca se manda al navegador.
   ================================================================== */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY;

export const hayServidor = Boolean(url && servicio);

export function nubeServidor(): SupabaseClient | null {
  if (!url || !servicio) return null;
  return createClient(url, servicio, { auth: { persistSession: false } });
}

export type MovimientoNuevo = Omit<Movimiento, "id" | "estado" | "creadoEn"> & { estado?: Movimiento["estado"] };

/** Guarda cobros de pasarela sin pisar los que ya estaban conciliados. */
export async function guardarMovimientos(filas: MovimientoNuevo[]): Promise<{ guardados: number; completados: number; error?: string }> {
  if (filas.length === 0) return { guardados: 0, completados: 0 };
  const db = nubeServidor();
  if (!db) return { guardados: 0, completados: 0, error: "Falta SUPABASE_SERVICE_ROLE_KEY: el webhook no puede escribir." };

  const ahora = new Date().toISOString();
  const completas = filas.map((f) => ({
    ...f,
    id: `mov_${f.proveedor}_${f.referencia}`.slice(0, 120),
    estado: f.estado ?? ("pendiente" as const),
    creadoEn: ahora,
  }));

  /* ignoreDuplicates: si el cobro ya estaba (la pasarela reintenta el
     webhook, o alguien importó el CSV antes), no se toca. Pisarlo
     volvería a "pendiente" algo que ya se concilió.

     El select() al final es lo que hace honesto al número: con
     ignoreDuplicates, Postgres devuelve sólo las filas que realmente
     insertó. Sin eso, el cron informaría "142 guardados" cada hora
     aunque no hubiera entrado un solo cobro nuevo. */
  const r = await db
    .from("movimientos")
    .upsert(completas, { onConflict: "proveedor,referencia", ignoreDuplicates: true, defaultToNull: false })
    .select("id");

  if (r.error) return { guardados: 0, completados: 0, error: r.error.message };
  const c = await completarGuardados(db, filas);
  return { guardados: (r.data ?? []).length, completados: c.completados, error: c.error };
}

/* Los que ya estaban no se pisan, pero se completa lo que les faltaba:
   quién pagó, cómo pagó y la comisión real, que Stripe calcula después
   del aviso y Whop no mandaba en la lista. La conciliación no se toca;
   si el cobro ya estaba conciliado, sus pagos toman la comisión real
   (salvo los corregidos a mano). La misma regla que el botón Sincronizar. */
async function completarGuardados(db: SupabaseClient, filas: MovimientoNuevo[]): Promise<{ completados: number; error?: string }> {
  const porProveedor = new Map<string, MovimientoNuevo[]>();
  for (const f of filas) porProveedor.set(f.proveedor, [...(porProveedor.get(f.proveedor) ?? []), f]);
  let completados = 0;
  for (const [proveedor, lista] of porProveedor) {
    const traido = new Map(lista.map((f) => [f.referencia, f] as const));
    /* De a 50 referencias: van en la URL del pedido. */
    for (let i = 0; i < lista.length; i += 50) {
      const refs = lista.slice(i, i + 50).map((f) => f.referencia);
      const q = await db.from("movimientos")
        .select("id, proveedor, referencia, monto, fee, neto, clienteNombre, clienteEmail, clienteTelefono, metodo, descripcion, fecha, estado")
        .eq("proveedor", proveedor).in("referencia", refs);
      if (q.error) return { completados, error: q.error.message };
      for (const g of (q.data ?? []) as (Movimiento & { id: string })[]) {
        const f = traido.get(g.referencia);
        const parche = f ? parcheDeCobro(g, f) : null;
        if (!parche) continue;
        const u = await db.from("movimientos").update(parche).eq("id", g.id);
        if (u.error) return { completados, error: u.error.message };
        completados++;
        if (parche.fee === undefined) continue;
        const ps = await db.from("pagos").select("id, monto, feeManual").eq("movimientoId", g.id);
        for (const p of (ps.data ?? []) as { id: string; monto: number; feeManual?: boolean | null }[]) {
          const cambio = feeDelPago({ monto: p.monto, feeManual: p.feeManual ?? false }, g, parche.fee);
          if (cambio) await db.from("pagos").update(cambio).eq("id", p.id);
        }
      }
    }
  }
  return { completados };
}

/** Los cobros de Mercury que el banco anuló (fallaron, se cancelaron, se
 *  revirtieron) y siguen sin conciliar en la bandeja: se descartan solos, con
 *  una nota (no se borran). Los ya conciliados no se tocan (lib/mercury.ts). */
export async function descartarAnuladosMercury(referencias: string[]): Promise<{ descartados: number; error?: string }> {
  const refs = [...new Set(referencias.filter(Boolean))];
  if (refs.length === 0) return { descartados: 0 };
  const db = nubeServidor();
  if (!db) return { descartados: 0 };
  let descartados = 0;
  for (let i = 0; i < refs.length; i += 50) {
    const q = await db.from("movimientos").select("id, descripcion")
      .eq("proveedor", "mercury").eq("estado", "pendiente").in("referencia", refs.slice(i, i + 50));
    if (q.error) return { descartados, error: q.error.message };
    for (const m of (q.data ?? []) as { id: string; descripcion?: string | null }[]) {
      const u = await db.from("movimientos").update({
        estado: "ignorado", descripcion: [m.descripcion, NOTA_ANULADO].filter(Boolean).join(" · "),
      }).eq("id", m.id);
      if (u.error) return { descartados, error: u.error.message };
      descartados++;
    }
  }
  return { descartados };
}

/** Los cobros de una pasarela que ya tienen todo en la base: no hace falta
 *  volver a pedir su detalle en cada pasada del cron. */
export async function referenciasCompletas(proveedor: string): Promise<Set<string> | null> {
  const db = nubeServidor();
  if (!db) return null;
  const r = await db.from("movimientos").select("referencia, clienteEmail, metodo, fee").eq("proveedor", proveedor);
  if (r.error) return null;
  return new Set(((r.data ?? []) as { referencia: string; clienteEmail?: string | null; metodo?: string | null; fee: number }[])
    .filter((m) => m.clienteEmail && m.metodo && m.fee > 0).map((m) => m.referencia));
}

/* ---------- Movimientos entre cuentas ---------- */

const faltaLaTabla = (e: { code?: string; message?: string }) =>
  e.code === "PGRST205" || e.code === "42P01" || /schema cache|does not exist/i.test(e.message ?? "");

/** Guarda lo que la sincronización vio pasar entre cuentas propias (el
 *  depósito de Stripe en Mercury, un retiro de Stripe): la punta que ya
 *  estaba no se repite, la que es de un pase cargado se le ata y el resto
 *  entran como pases nuevos (lib/traspasos.ts: las mismas reglas que usa la
 *  pantalla). Sin la tabla (falta correr supabase/traspasos.sql) no guarda
 *  nada y lo dice, sin tumbar al resto de la sincronización. */
export async function guardarPuntas(puntas: Punta[]): Promise<{ nuevos: number; conciliados: number; sinTabla?: boolean; error?: string }> {
  if (puntas.length === 0) return { nuevos: 0, conciliados: 0 };
  const db = nubeServidor();
  if (!db) return { nuevos: 0, conciliados: 0, error: "Falta SUPABASE_SERVICE_ROLE_KEY: no se pueden guardar los movimientos entre cuentas." };

  /* Los pases de esos días, con margen: un pase está a lo sumo a diez días de sus puntas. */
  const primera = Math.min(...puntas.map((p) => Date.parse(p.fecha)).filter(Number.isFinite));
  const desde = new Date((Number.isFinite(primera) ? primera : Date.now()) - 15 * 86400000).toISOString();
  const ya = await db.from("traspasos").select("*").gte("fecha", desde);
  if (ya.error) return faltaLaTabla(ya.error) ? { nuevos: 0, conciliados: 0, sinTabla: true } : { nuevos: 0, conciliados: 0, error: ya.error.message };
  const existentes = new Map(((ya.data ?? []) as Traspaso[]).map((t) => [t.id, t]));
  /* Y los que ya tienen alguna de estas puntas, estén donde estén: a un
     pase le pueden haber corregido la fecha, y su punta no entra dos veces. */
  const refs = [...new Set(puntas.map((p) => p.ref).filter(Boolean))];
  for (let i = 0; i < refs.length; i += 80) {
    const lote = refs.slice(i, i + 80);
    for (const columna of ["salidaRef", "llegadaRef"]) {
      const mas = await db.from("traspasos").select("*").in(columna, lote);
      if (mas.error) return { nuevos: 0, conciliados: 0, error: mas.error.message };
      for (const t of (mas.data ?? []) as Traspaso[]) existentes.set(t.id, t);
    }
  }

  const r = conciliarPuntas([...existentes.values()], puntas, new Date().toISOString());
  let nuevos = 0;
  if (r.nuevos.length) {
    /* El id sale de la punta: si otra pasada (o la pantalla) ya lo guardó, no se pisa. */
    const ins = await db.from("traspasos").upsert(r.nuevos, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false }).select("id");
    if (ins.error) return { nuevos: 0, conciliados: 0, error: ins.error.message };
    nuevos = (ins.data ?? []).length;
  }
  for (const c of r.cambios) {
    const u = await db.from("traspasos").update(c.cambios).eq("id", c.id);
    if (u.error) return { nuevos, conciliados: 0, error: u.error.message };
  }
  return { nuevos, conciliados: r.conciliados };
}
