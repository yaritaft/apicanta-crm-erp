import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { hayEquipoConfigurado } from "./equipo-servidor";
import type { AreaId } from "./types";

/* ==================================================================
   Las rutas de /api que contestan con datos del negocio, según el tipo
   de cuenta de quien pide. Leen con la clave de servicio (que saltea RLS),
   así que antes le preguntan a la base, con la sesión de quien pide, qué
   nivel tiene en esas áreas: nivel_area(), la MISMA función que usan las
   políticas (supabase/tipos-cuenta.sql). Una sola regla.

   Sin Supabase configurado la app corre local, sin login, y las rutas
   contestan igual, como siempre.
   ================================================================== */

/** El nivel más alto de quien pide en esas áreas (0, 1 o 2), o null si no
    inició sesión o no está entre los accesos. */
export async function nivelDelPedido(peticion: Request, areas: AreaId[]): Promise<number | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonima || !jwt) return null;
  const db = createClient(url, anonima, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const entra = await db.rpc("puede_entrar");
  if (entra.error || entra.data !== true) return null;
  let mayor = 0;
  for (const area of areas) {
    const r = await db.rpc("nivel_area", { area });
    /* Una base sin supabase/tipos-cuenta.sql: el que entra, entra a todo. */
    if (r.error) return 2;
    mayor = Math.max(mayor, Number(r.data) || 0);
    if (mayor === 2) break;
  }
  return mayor;
}

/** La base con la sesión de quien pide: lo que lea pasa por sus políticas
    (el closer, sólo lo suyo). Para las rutas que tocan UNA cosa a pedido de
    alguien: antes de hacerlo con la clave de servicio, se fijan si la ve. */
export function baseDelPedido(peticion: Request): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonima || !jwt) return null;
  return createClient(url, anonima, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } });
}

/** null si puede; si no, la respuesta que corresponde (401 o 403). */
export async function exigirArea(peticion: Request, areas: AreaId[], minimo: 1 | 2): Promise<NextResponse | null> {
  if (!hayEquipoConfigurado()) return null;
  const n = await nivelDelPedido(peticion, areas);
  if (n === null) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  if (n < minimo) {
    return NextResponse.json(
      { error: minimo === 2 ? "Tu tipo de cuenta no puede cambiar esto." : "Tu tipo de cuenta no ve esto." },
      { status: 403 },
    );
  }
  return null;
}
