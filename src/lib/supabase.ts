"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/* Si las dos variables estan, la app usa la nube. Si no, sigue andando
   contra el navegador exactamente como antes. Nunca se rompe por esto. */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const clave = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hayNube: boolean = Boolean(url && clave);

export const nube: SupabaseClient | null = hayNube
  ? createClient(url as string, clave as string, {
      auth: { persistSession: false },
    })
  : null;

/* Las tablas se llaman igual que las colecciones del estado y sus columnas
   igual que los campos de types.ts, asi que no hace falta mapear nada. */
export const TABLAS = [
  "etapas", "webinars", "leads", "alumnos", "sesiones", "reportes",
  "campanias", "transacciones", "metas", "campos", "actividad",
] as const;

export type Tabla = (typeof TABLAS)[number];
