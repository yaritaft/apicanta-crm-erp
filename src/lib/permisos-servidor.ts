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

/** La base no tiene esa función: no se corrió supabase/tipos-cuenta.sql. Es el ÚNICO error que se
    toma como «no hay tipos de cuenta»; cualquier otro (JWT vencido, 429, 5xx, red cortada) es «no sé quién
    es», y ante la duda no se deja pasar. */
export const faltaLaFuncion = (e: { code?: string; message?: string }) =>
  e.code === "PGRST202" || e.code === "42883" || /could not find the function/i.test(e.message ?? "");

/** `noSePudo`: la base no contestó bien (JWT vencido, 429, 5xx, red cortada). No es «sin permiso»: es «no sé», y se
    contesta 503 para que las pantallas vuelvan a preguntar en vez de darse por vencidas. Ante la duda no se deja pasar. */
interface DelPedido { nivel: number; soloLoSuyo: boolean; noSePudo?: boolean }
const NO_SE_PUDO: DelPedido = { nivel: 0, soloLoSuyo: false, noSePudo: true };

/* El nivel más alto en esas áreas y, si se pide, si la cuenta ve sólo lo suyo. Una sola sesión de
   base y las mismas funciones que usan las políticas. */
async function consultar(peticion: Request, areas: AreaId[], pideSoloLoSuyo: boolean): Promise<DelPedido | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonima || !jwt) return null;
  const db = createClient(url, anonima, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  let entra: Awaited<ReturnType<typeof db.rpc>>;
  try { entra = await db.rpc("puede_entrar"); } catch { return NO_SE_PUDO; }
  /* Un 429, un 5xx o la red cortada (estado 0) no dicen que no sea del equipo: no se pudo comprobar. */
  if (entra.error && (entra.status === 0 || entra.status === 408 || entra.status === 429 || entra.status >= 500)) return NO_SE_PUDO;
  if (entra.error || entra.data !== true) return null;
  let mayor = 0;
  for (const area of areas) {
    let r: Awaited<ReturnType<typeof db.rpc>>;
    try { r = await db.rpc("nivel_area", { area }); } catch { return NO_SE_PUDO; }
    if (r.error) {
      /* Una base sin supabase/tipos-cuenta.sql: el que entra, entra a todo. */
      if (faltaLaFuncion(r.error)) return { nivel: 2, soloLoSuyo: false };
      /* Cualquier otro error no es «sin tipos de cuenta»: no se deja pasar, pero tampoco es un «no» firme. */
      return NO_SE_PUDO;
    }
    mayor = Math.max(mayor, Number(r.data) || 0);
    if (mayor === 2) break;
  }
  let soloLoSuyo = false;
  if (pideSoloLoSuyo) {
    let r: Awaited<ReturnType<typeof db.rpc>>;
    try { r = await db.rpc("solo_lo_suyo"); } catch { return NO_SE_PUDO; }
    /* Sin la función no hay tipos de cuenta y nadie ve «sólo lo suyo». Con cualquier otro error no se sabe: no pasa. */
    if (r.error && !faltaLaFuncion(r.error)) return NO_SE_PUDO;
    soloLoSuyo = r.error ? false : r.data !== false;
  }
  return { nivel: mayor, soloLoSuyo };
}

/** El nivel más alto de quien pide en esas áreas (0, 1 o 2), o null si no
    inició sesión o no está entre los accesos. */
export async function nivelDelPedido(peticion: Request, areas: AreaId[]): Promise<number | null> {
  return (await consultar(peticion, areas, false))?.nivel ?? null;
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

export interface OpcionesDeArea {
  /** Además del nivel, la cuenta no puede ser de las que ven «sólo lo suyo» (el closer): las rutas que leen con
      la clave de servicio saltean RLS y no la recortan por sí solas. */
  sinSoloLoSuyo?: boolean;
  /** Falla cerrado también sin Supabase configurado (401), en vez de «la app local, sin login, todo abierto».
      Para lo que es una credencial: en producción no hay modo local. */
  cerrado?: boolean;
}

/** null si puede; si no, la respuesta que corresponde: 401 (sin sesión), 403 (sin permiso) o 503 (no se pudo comprobar). */
export async function exigirArea(peticion: Request, areas: AreaId[], minimo: 1 | 2, opciones: OpcionesDeArea = {}): Promise<NextResponse | null> {
  if (!hayEquipoConfigurado()) {
    return opciones.cerrado ? NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 }) : null;
  }
  const p = await consultar(peticion, areas, Boolean(opciones.sinSoloLoSuyo));
  if (p === null) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  if (p.noSePudo) return NextResponse.json({ error: "No pudimos comprobar tu permiso, probá de nuevo." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (p.nivel < minimo) {
    return NextResponse.json(
      { error: minimo === 2 ? "Tu tipo de cuenta no puede cambiar esto." : "Tu tipo de cuenta no ve esto." },
      { status: 403 },
    );
  }
  if (p.soloLoSuyo) return NextResponse.json({ error: "Tu tipo de cuenta ve sólo lo suyo, y esto es de todo el equipo." }, { status: 403 });
  return null;
}
