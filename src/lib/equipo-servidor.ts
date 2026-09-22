import { createClient } from "@supabase/supabase-js";

/* ==================================================================
   ¿La que pide es una persona del equipo? Para las rutas de /api que
   sólo le contestan al equipo.

   Es la misma regla que ya usa /api/pasarelas/sync (copiada, no
   movida: esa ruta no se toca). La pantalla manda su sesión de
   Supabase y se le pregunta a la base si puede entrar, con la MISMA
   función que usan las políticas de RLS: una sola regla para decidir
   quién ve qué, no dos que se puedan desalinear.
   ================================================================== */

/* Sin Supabase configurado la app corre local, sin login: no hay equipo
   contra el cual chequear y las rutas contestan igual. */
export function hayEquipoConfigurado(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function esDelEquipo(peticion: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonima || !jwt) return false;

  const db = createClient(url, anonima, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const r = await db.rpc("puede_entrar");
  return !r.error && r.data === true;
}
