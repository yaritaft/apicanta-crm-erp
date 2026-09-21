"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* Si las dos variables estan, la app usa la nube y pide login.
   Si no, sigue andando contra el navegador, sin login. */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hayNube: boolean = Boolean(url && clave);

export const nube: SupabaseClient | null = hayNube
  ? createClient(url as string, clave as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        /* El magic link vuelve con la sesion en el hash de la URL. */
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    })
  : null;

/* Las tablas se llaman igual que las colecciones del estado y sus columnas
   igual que los campos de types.ts, asi que no hace falta mapear nada. */
export const TABLAS = [
  "etapas", "webinars", "leads", "alumnos", "sesiones", "reportes",
  "campanias", "metas", "campos", "actividad",
  "productos", "procesadores", "embudos", "equipo",
  "ventas", "cuotas", "pagos", "gastos", "movimientos",
  /* Jerarquia de Meta. `ad_insights` es la unica cuyo nombre no coincide con
     su coleccion (`adInsights`): Postgres va en snake_case y la app en
     camelCase, asi que store.ts la mapea a mano. */
  "campaigns", "adsets", "ads", "ad_insights",
] as const;

export type Tabla = (typeof TABLAS)[number];

/* Tablas que pueden no existir todavia en una base creada con una version
   anterior del modelo. Si faltan, la app sigue andando con esa coleccion
   vacia en vez de caerse entera: el SQL se corre cuando se pueda. */
export const TABLAS_OPCIONALES = new Set<string>([
  "movimientos",
  /* `campanias` quedo huerfana: Marketing lee de la jerarquia de Meta y ya
     nadie le escribe. Se pasa a opcional ANTES de tirarla, no despues: si se
     borrara de la base estando en TABLAS a secas, el SELECT de cargarDeLaNube
     devolveria PGRST205 y no se romperia Marketing — se romperia la app
     entera al entrar. Asi el dia que se tire, no pasa nada. */
  "campanias",
  /* Las cuatro de Meta entran como opcionales hasta que el ALTER este corrido
     en todas las bases. Mientras tanto la app sigue con esas colecciones
     vacias en vez de caerse entera. */
  "campaigns", "adsets", "ads", "ad_insights",
]);

/* PostgREST avisa que la tabla no esta en el esquema con PGRST205 (y con
   42P01 si la consulta llego a Postgres). Cualquier otro error es real. */
export function tablaFaltante(e: { code?: string; message?: string } | null): boolean {
  if (!e) return false;
  if (e.code === "PGRST205" || e.code === "42P01") return true;
  return /schema cache|does not exist/i.test(e.message ?? "");
}
