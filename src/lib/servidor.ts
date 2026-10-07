import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Devolucion, Movimiento, Pago, Procesador, Traspaso, Venta } from "./types";
import { feeDelPago, parcheDeCobro } from "./completar-cobros";
import { conciliarPuntas, type Punta } from "./traspasos";
import { conciliarReembolsos, referenciaDeReembolso, type ReembolsoCrudo } from "./reembolsos";

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
        .select("id, proveedor, referencia, monto, fee, neto, clienteNombre, clienteEmail, clienteTelefono, metodo, descripcion")
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

/* ---------- Reembolsos de las pasarelas ---------- */

/** Guarda lo que las pasarelas dicen que devolvieron: lo ata a la devolución
 *  que ya cargó alguien (si es una sola que calza) o lo deja como PROPUESTA
 *  —no cuenta en Finanzas hasta que alguien la confirme— con las mismas reglas
 *  que usa la pantalla (lib/reembolsos.ts: conciliarReembolsos). Sin la tabla
 *  `devoluciones` (falta correr supabase/devoluciones.sql) no guarda nada y lo
 *  dice, sin tumbar al resto. El id de cada propuesta sale de su referencia:
 *  guardar dos veces el mismo aviso no duplica nada. */
export async function guardarReembolsos(
  crudos: ReembolsoCrudo[],
): Promise<{ nuevas: number; atadas: number; yaEstaban: number; sinTabla?: boolean; error?: string }> {
  const vacio = { nuevas: 0, atadas: 0, yaEstaban: 0 };
  if (crudos.length === 0) return vacio;
  const db = nubeServidor();
  if (!db) return { ...vacio, error: "Falta SUPABASE_SERVICE_ROLE_KEY: no se pueden guardar los reembolsos." };

  const ahora = new Date().toISOString();
  const refs = [...new Set(crudos.map(referenciaDeReembolso))];
  const cobros = [...new Set(crudos.flatMap((c) => c.referenciasCobro ?? []))];
  const fechas = crudos.map((c) => Date.parse(c.fecha)).filter(Number.isFinite);
  const margen = 15 * 86400000;
  const desde = new Date((fechas.length ? Math.min(...fechas) : Date.now()) - margen).toISOString();
  const hasta = new Date((fechas.length ? Math.max(...fechas) : Date.now()) + margen).toISOString();

  /* Las devoluciones de esos días y las que ya tienen alguna de estas referencias. */
  const devoluciones = new Map<string, Devolucion>();
  const delDia = await db.from("devoluciones").select("*").gte("fecha", desde).lte("fecha", hasta);
  if (delDia.error) return faltaLaTabla(delDia.error) ? { ...vacio, sinTabla: true } : { ...vacio, error: delDia.error.message };
  for (const d of (delDia.data ?? []) as Devolucion[]) devoluciones.set(d.id, d);
  for (let i = 0; i < refs.length; i += 80) {
    const q = await db.from("devoluciones").select("*").in("referencia", refs.slice(i, i + 80));
    if (q.error) return { ...vacio, error: q.error.message };
    for (const d of (q.data ?? []) as Devolucion[]) devoluciones.set(d.id, d);
  }

  /* El cobro que se devuelve: su pago (o su cobro de la pasarela ya conciliado)
     y de ahí la cuota y la venta. Lo que no se encuentre, no se adivina. */
  const movimientos: Movimiento[] = [];
  const pagos: Pago[] = [];
  for (let i = 0; i < cobros.length; i += 80) {
    const lote = cobros.slice(i, i + 80);
    const m = await db.from("movimientos").select("*").in("referencia", lote);
    if (m.error) return { ...vacio, error: m.error.message };
    movimientos.push(...((m.data ?? []) as Movimiento[]));
    const p = await db.from("pagos").select("*").in("referencia", lote);
    if (p.error) return { ...vacio, error: p.error.message };
    pagos.push(...((p.data ?? []) as Pago[]));
  }
  const cuotaIds = [...new Set([...pagos.map((p) => p.cuotaId), ...movimientos.map((m) => m.cuotaId).filter(Boolean) as string[]])];
  const cuotas: { id: string; ventaId: string }[] = [];
  for (let i = 0; i < cuotaIds.length; i += 80) {
    const q = await db.from("cuotas").select("id, ventaId").in("id", cuotaIds.slice(i, i + 80));
    if (q.error) return { ...vacio, error: q.error.message };
    cuotas.push(...((q.data ?? []) as { id: string; ventaId: string }[]));
  }
  const ventaIds = [...new Set([
    ...cuotas.map((c) => c.ventaId), ...movimientos.map((m) => m.ventaId).filter(Boolean) as string[],
    ...[...devoluciones.values()].map((d) => d.ventaId).filter(Boolean) as string[],
  ])];
  const ventas: Venta[] = [];
  for (let i = 0; i < ventaIds.length; i += 80) {
    const q = await db.from("ventas").select("*").in("id", ventaIds.slice(i, i + 80));
    if (q.error) return { ...vacio, error: q.error.message };
    ventas.push(...((q.data ?? []) as Venta[]));
  }
  const pr = await db.from("procesadores").select("id, nombre, proveedor, moneda");
  const procesadores = (pr.error ? [] : (pr.data ?? [])) as Procesador[];

  const r = conciliarReembolsos({
    ventas, cuotas: cuotas as never, pagos, movimientos, procesadores,
    devoluciones: [...devoluciones.values()], contactos: [], leads: [],
  }, crudos, ahora);

  let nuevas = 0;
  if (r.nuevas.length) {
    const ins = await db.from("devoluciones").upsert(r.nuevas, { onConflict: "id", ignoreDuplicates: true, defaultToNull: false }).select("id");
    if (ins.error) return { ...vacio, yaEstaban: r.yaEstaban, error: ins.error.message };
    nuevas = (ins.data ?? []).length;
  }
  for (const a of r.atadas) {
    const u = await db.from("devoluciones").update(a.cambios).eq("id", a.devolucionId);
    if (u.error) return { nuevas, atadas: 0, yaEstaban: r.yaEstaban, error: u.error.message };
  }
  return { nuevas, atadas: r.atadas.length, yaEstaban: r.yaEstaban };
}
