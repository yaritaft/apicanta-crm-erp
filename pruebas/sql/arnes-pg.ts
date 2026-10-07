/* Arnés mínimo para probar el SQL de supabase/ en un Postgres de verdad, en memoria (PGlite).

   No es una prueba (no termina en .test.ts): lo importan las pruebas de pruebas/ que ensayan RLS y triggers. PGlite no es una
   dependencia del proyecto; se busca en $PGLITE_DIR o en la copia que ya está en el disco (menlab-app). Si no hay ninguna, las pruebas
   se saltean en vez de romper `npm test`.

   Con SQL_DIR_PRUEBA=/otra/carpeta se leen los .sql de ahí (para comprobar que una prueba de regresión FALLA con el SQL de antes de un
   arreglo); un archivo que esa carpeta no tiene se toma como vacío. */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RAIZ = new URL("../../", import.meta.url);
const DIR_POR_DEFECTO = "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite";

export interface Pg {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[]; affectedRows?: number }>;
  close(): Promise<void>;
}
type ConstructorPg = new () => Pg;

/** El constructor de PGlite, o null si no está en el disco. */
export async function cargarPglite(): Promise<ConstructorPg | null> {
  const dir = process.env.PGLITE_DIR ?? DIR_POR_DEFECTO;
  const ruta = `${dir}/dist/index.js`;
  if (!existsSync(ruta)) return null;
  const especificador: string = pathToFileURL(ruta).href;
  return ((await import(especificador)) as { PGlite: ConstructorPg }).PGlite;
}

export function sqlDe(archivo: string): string {
  const dir = process.env.SQL_DIR_PRUEBA;
  if (dir) return existsSync(`${dir}/${archivo}`) ? readFileSync(`${dir}/${archivo}`, "utf8") : "";
  return readFileSync(new URL(`supabase/${archivo}`, RAIZ), "utf8");
}

/** Lo que los SQL del proyecto dan por existente (la base de producción tiene más columnas; éstas son las que se usan). */
export const ESQUEMA_MINIMO = `
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create role authenticated;
  create table public.usuarios_permitidos (email text primary key, nombre text, rol text not null default 'equipo', "creadoEn" timestamptz default now());
  create table public.equipo (id text primary key, nombre text, email text, activo boolean default true);
  create table public.ventas (id text primary key, "closerId" text, "setterId" text, "contactoId" text, estado text default 'activa', "sesionId" text, monto numeric default 0);
  create table public.cuotas (id text primary key, "ventaId" text, "closerId" text);
  create table public.pagos (
    id text primary key, "cuotaId" text, monto numeric not null default 0, moneda text default 'USD', fecha text, "montoArs" numeric,
    comprobante jsonb, "comprobanteLink" text, "movimientoId" text, chequeado boolean, notas text
  );
  create table public.sesiones (id text primary key, anfitrion text, "leadId" text, "contactoId" text, "estadoLlamada" text, "estadoPreCall" text, notas text);
  create table public.leads (id text primary key, responsable text, "contactoId" text, nombre text);
  create table public.contactos (id text primary key, nombre text);
  create table public.comentarios (id text primary key, "contactoId" text, texto text);
  create table public.alumnos (id text primary key, "ventaId" text, notas text);
  create table public.gastos (id text primary key, "webinarId" text);
  create table public.actividad (id text primary key, entidad text, "entidadId" text);
  create table public.ajustes (id text primary key);
  create table public.procesadores (id text primary key);
  create table public.webinars (id text primary key);
  create function public.es_dueno() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and rol = 'dueno') $$;
  create function public.puede_entrar() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
`;

export const PERMISOS_DE_ENSAYO = `
  grant usage on schema public, auth to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant execute on function auth.jwt() to authenticated;
`;

export type Resultado<T> = { ok: true; rows: T[]; n: number } | { ok: false; codigo: string; mensaje: string };

export interface Banco {
  db: Pg;
  /** Corre una consulta como esa persona (RLS de verdad) y devuelve el error en vez de lanzarlo. */
  intentar<T = Record<string, unknown>>(email: string | null, sql: string): Promise<Resultado<T>>;
  /** Consulta como la clave de servicio (sin sesión de una persona). */
  servicio<T = Record<string, unknown>>(sql: string): Promise<T[]>;
  ejecutar(sql: string): Promise<void>;
}

export function armarBanco(db: Pg): Banco {
  const como = async (email: string | null) => {
    await db.exec(`reset role`);
    if (email !== null) {
      await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email, role: "authenticated" })}', false)`);
      await db.exec(`set role authenticated`);
    } else await db.exec(`select set_config('request.jwt.claims', '', false)`);
  };
  return {
    db,
    async intentar<T>(email: string | null, sql: string): Promise<Resultado<T>> {
      await como(email);
      try {
        const r = await db.query<T>(sql);
        return { ok: true, rows: r.rows, n: r.affectedRows ?? r.rows.length };
      } catch (e) {
        const x = e as { code?: string; message?: string };
        return { ok: false, codigo: x.code ?? "?", mensaje: x.message ?? String(e) };
      } finally {
        await db.exec(`reset role`);
        await db.exec(`select set_config('request.jwt.claims', '', false)`);
      }
    },
    async servicio<T>(sql: string) { await como(null); return (await db.query<T>(sql)).rows; },
    async ejecutar(sql: string) { await como(null); await db.exec(sql); },
  };
}

/** Postgres en memoria con el esquema mínimo, tipos-cuenta.sql y los archivos pedidos (en ese orden), sin personas. */
export async function montarBanco(Pg: ConstructorPg, archivos: string[] = []): Promise<Banco> {
  const db = new Pg();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  for (const a of archivos) await db.exec(sqlDe(a));
  await db.exec(PERMISOS_DE_ENSAYO);
  return armarBanco(db);
}
