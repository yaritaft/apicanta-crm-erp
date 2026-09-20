import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Movimiento } from "./types";

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

export type MovimientoNuevo = Omit<Movimiento, "id" | "estado" | "creadoEn">;

/** Guarda cobros de pasarela sin pisar los que ya estaban conciliados. */
export async function guardarMovimientos(filas: MovimientoNuevo[]): Promise<{ guardados: number; error?: string }> {
  if (filas.length === 0) return { guardados: 0 };
  const db = nubeServidor();
  if (!db) return { guardados: 0, error: "Falta SUPABASE_SERVICE_ROLE_KEY: el webhook no puede escribir." };

  const ahora = new Date().toISOString();
  const completas = filas.map((f) => ({
    ...f,
    id: `mov_${f.proveedor}_${f.referencia}`.slice(0, 120),
    estado: "pendiente" as const,
    creadoEn: ahora,
  }));

  /* ignoreDuplicates: si el cobro ya estaba (la pasarela reintenta el
     webhook, o alguien importó el CSV antes), no se toca. Pisarlo
     volvería a "pendiente" algo que ya se concilió. */
  const r = await db
    .from("movimientos")
    .upsert(completas, { onConflict: "proveedor,referencia", ignoreDuplicates: true, defaultToNull: false });

  if (r.error) return { guardados: 0, error: r.error.message };
  return { guardados: completas.length };
}
