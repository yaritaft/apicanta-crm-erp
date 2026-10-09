/* Arnés de las pruebas de estrés del SQL (supabase/*.sql) en un Postgres de verdad, en memoria (PGlite).

   No es una prueba (no termina en .test.ts, `npm test` no lo corre solo): lo importan las pruebas de esta carpeta.
   PGlite no es una dependencia del proyecto. Se busca en $PGLITE_DIR o, si no, en la copia que ya está en disco
   (menlab-app); si no hay ninguna, las pruebas se saltean en vez de romper `npm test`.

   Monta las tablas mínimas que piden los SQL (con las columnas que usan), simula auth.jwt() con
   set_config('request.jwt.claims', …) y corre los SQL REALES del proyecto, no copias. */
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { AREAS, TIPOS_POR_DEFECTO, type AreasDeTipo, type MiAcceso } from "@/lib/permisos";

const RAIZ = new URL("../../", import.meta.url);
export const leerSql = (ruta: string): string => readFileSync(new URL(ruta, RAIZ), "utf8");

const DIR_POR_DEFECTO = "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite";

export interface Resultado<T = Record<string, unknown>> { rows: T[]; affectedRows?: number }
export interface Pg {
  exec(sql: string): Promise<unknown>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Resultado<T>>;
  close(): Promise<void>;
}
type ConstructorPg = new () => Pg;

/** El constructor de PGlite, o null si no está en el disco. */
export async function cargarPglite(): Promise<ConstructorPg | null> {
  const dir = process.env.PGLITE_DIR ?? DIR_POR_DEFECTO;
  const ruta = `${dir}/dist/index.js`;
  if (!existsSync(ruta)) return null;
  const especificador: string = pathToFileURL(ruta).href;
  const modulo = (await import(especificador)) as { PGlite: ConstructorPg };
  return modulo.PGlite;
}

/* ---------- el azar con semilla ---------- */

export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Azar {
  private readonly r: () => number;
  constructor(readonly semilla: number) { this.r = mulberry32(semilla); }
  siguiente(): number { return this.r(); }
  entero(n: number): number { return Math.floor(this.r() * n); }
  bool(p = 0.5): boolean { return this.r() < p; }
  elegir<T>(xs: readonly T[]): T { return xs[this.entero(xs.length)]; }
  mezclar<T>(xs: readonly T[]): T[] {
    const a = [...xs];
    for (let i = a.length - 1; i > 0; i--) { const j = this.entero(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
}

/* ---------- las personas de la base de ensayo ---------- */

export interface Persona { email: string; tipo: string; miembroId?: string }
/** Una de cada tipo, más un segundo closer para probar lo ajeno. */
export const PERSONAS: Persona[] = [
  { email: "yari@x.com", tipo: "dueno" },
  { email: "equipo@x.com", tipo: "equipo" },
  { email: "santi@x.com", tipo: "director" },
  { email: "dante@x.com", tipo: "closer", miembroId: "m_dante" },
  { email: "otro@x.com", tipo: "closer", miembroId: "m_otro" },
  { email: "seti@x.com", tipo: "setter" },
  { email: "aldana@x.com", tipo: "admin" },
  { email: "marta@x.com", tipo: "marketing" },
  { email: "lili@x.com", tipo: "customer_success" },
];

/* ---------- el esquema mínimo ---------- */

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
  create table public.sesiones (id text primary key, anfitrion text, "leadId" text, "contactoId" text, "estadoLlamada" text, "estadoPreCall" text, notas text,
    /* Lo que lee customer-success-lili.sql al pasar las agendas de «Llamada de Auditoría» a resells. */
    inicia timestamptz, invitado text, email text, estado text, tipo text, utm jsonb, "creadoEn" timestamptz default now());
  create table public.leads (id text primary key, responsable text, "contactoId" text, nombre text);
  create table public.contactos (id text primary key, nombre text, telefono text);
  create table public.comentarios (id text primary key, "contactoId" text, texto text);
  create table public.alumnos (id text primary key, "ventaId" text, notas text);
  create table public.gastos (id text primary key, "webinarId" text);
  create table public.actividad (id text primary key, entidad text, "entidadId" text);
  create table public.ajustes (id text primary key);
  create table public.procesadores (id text primary key);
  create table public.webinars (id text primary key);
  -- lo que traen otros SQL del proyecto (honorarios.sql y la base) y tipos-cuenta.sql da por existente
  create function public.es_dueno() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and rol = 'dueno') $$;
  create function public.puede_entrar() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
`;

export const PERMISOS_DE_ENSAYO = `
  grant usage on schema public, auth to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant select on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant execute on function auth.jwt() to authenticated;
`;

/** Los archivos de supabase/ por nombre → su texto. Con STRESS_SQL_DIR se leen de otra carpeta (para probar las pruebas con una
 *  copia del SQL a la que se le rompió algo a propósito: si no fallan, la prueba no sirve). */
export const sqlDe = (archivo: string): string => (process.env.STRESS_SQL_DIR
  ? readFileSync(`${process.env.STRESS_SQL_DIR}/${archivo}`, "utf8")
  : leerSql(`supabase/${archivo}`));

export interface Banco {
  db: Pg;
  /** Se pone la sesión de esa persona (RLS de verdad); null = sin sesión de una persona (la clave de servicio). */
  como(email: string | null): Promise<void>;
  /** Corre una consulta como esa persona y devuelve el error en vez de lanzarlo. */
  intentar<T = Record<string, unknown>>(email: string | null, sql: string, params?: unknown[]): Promise<{ ok: true; rows: T[]; n: number } | { ok: false; codigo: string; mensaje: string }>;
  /** Consulta como la clave de servicio (sin RLS). */
  servicio<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Varias sentencias seguidas como la clave de servicio (sin RLS). */
  ejecutar(sql: string): Promise<void>;
}

export interface OpcionesBanco {
  /** Los archivos de supabase/ que se corren después de tipos-cuenta.sql, en este orden. */
  archivos?: string[];
  /** Cuántas veces se corre cada uno (1 por defecto; 2 para probar la idempotencia como el ensayo). */
  veces?: number;
  /** Se salta el alta de las personas (cuando se prueba el orden de los SQL). */
  sinPersonas?: boolean;
}

/** Postgres en memoria con el esquema mínimo, tipos-cuenta.sql y lo que se pida, y las personas dadas de alta. */
export async function montarBanco(Pg: ConstructorPg, opciones: OpcionesBanco = {}): Promise<Banco> {
  const db = new Pg();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  for (const a of opciones.archivos ?? []) {
    for (let i = 0; i < (opciones.veces ?? 1); i++) await db.exec(sqlDe(a));
  }
  await db.exec(PERMISOS_DE_ENSAYO);
  if (!opciones.sinPersonas) await altaDePersonas(db);
  return armarBanco(db);
}

export async function altaDePersonas(db: Pg): Promise<void> {
  const tipos = new Set((await db.query<{ id: string }>(`select id from public.tipos_cuenta`)).rows.map((r) => r.id));
  await db.exec(`insert into public.equipo (id, nombre, email) values
    ('m_dante', 'Dante Closer', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com'), ('m_santi', 'Santi Director', 'santi@x.com')`);
  for (const p of PERSONAS) {
    if (!tipos.has(p.tipo)) continue;
    await db.exec(`insert into public.usuarios_permitidos (email, rol) values ('${p.email}', '${p.tipo}')`);
  }
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
    como,
    async intentar<T>(email: string | null, sql: string, params?: unknown[]) {
      await como(email);
      try {
        const r = await db.query<T>(sql, params);
        return { ok: true as const, rows: r.rows, n: r.affectedRows ?? r.rows.length };
      } catch (e) {
        const x = e as { code?: string; message?: string };
        return { ok: false as const, codigo: x.code ?? "?", mensaje: x.message ?? String(e) };
      } finally {
        await db.exec(`reset role`);
        await db.exec(`select set_config('request.jwt.claims', '', false)`);
      }
    },
    async servicio<T>(sql: string, params?: unknown[]) {
      await como(null);
      return (await db.query<T>(sql, params)).rows;
    },
    async ejecutar(sql: string) {
      await como(null);
      await db.exec(sql);
    },
  };
}

/** Dos valores como los compara una prueba: por contenido, con las claves en cualquier orden. */
export function igualesJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a as object).sort(), kb = Object.keys(b as object).sort();
  if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i])) return false;
  return ka.every((k) => igualesJson((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** Un texto SQL con comillas simples escapadas, o NULL. */
export const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

/** "col" = valor, "col" = valor … para un UPDATE. */
export const asignaciones = (cambios: Record<string, unknown>): string =>
  Object.entries(cambios).map(([k, v]) => `"${k}" = ${lit(v)}`).join(", ");

/* ---------- personas con su acceso (el de permisos.ts) ---------- */

export interface PersonaConAcceso extends Persona { acceso: MiAcceso }

/** Las personas de fábrica con el acceso que dice permisos.ts para su tipo. */
export function personasPorDefecto(): PersonaConAcceso[] {
  return PERSONAS.map((p) => {
    const t = TIPOS_POR_DEFECTO.find((x) => x.id === p.tipo)!;
    return { ...p, acceso: { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo, miembroId: p.miembroId } };
  });
}

/** Combinaciones de áreas en los bordes de las reglas (Ver vs Editar de Ventas y Finanzas, con y sin «sólo lo suyo»): siempre se prueban. */
export const TIPOS_DE_BORDE: { areas: AreasDeTipo; soloLoSuyo: boolean }[] = [
  { areas: { ventas: "editar", finanzas: "ver" }, soloLoSuyo: false },
  { areas: { ventas: "ver", finanzas: "editar" }, soloLoSuyo: false },
  { areas: { ventas: "editar", finanzas: "ver" }, soloLoSuyo: true },
  { areas: { ventas: "ver", finanzas: "editar" }, soloLoSuyo: true },
  { areas: { finanzas: "editar" }, soloLoSuyo: false },
  { areas: { ventas: "editar" }, soloLoSuyo: false },
  { areas: { ventas: "ver", finanzas: "ver", webinars: "editar" }, soloLoSuyo: false },
  { areas: { clientes: "editar", alumnos: "editar" }, soloLoSuyo: false },
  { areas: { ventas: "editar", webinars: "ver", marketing: "ver" }, soloLoSuyo: true },
];

/** Da de alta `n` tipos de cuenta con áreas y «sólo lo suyo» al azar (los primeros son los de TIPOS_DE_BORDE si `conBordes`), cada uno con una persona (y su lugar en Equipo). */
export async function altaDeTiposAlAzar(b: Banco, az: Azar, n: number, prefijo = "tz", conBordes = true): Promise<PersonaConAcceso[]> {
  const niveles = [undefined, undefined, "ver", "editar"] as const;
  const personas: PersonaConAcceso[] = [];
  for (let i = 1; i <= n; i++) {
    const borde = conBordes ? TIPOS_DE_BORDE[i - 1] : undefined;
    const areas: AreasDeTipo = {};
    if (borde) Object.assign(areas, borde.areas);
    else for (const a of AREAS) { const nivel = az.elegir(niveles); if (nivel) areas[a.id] = nivel; }
    const soloLoSuyo = borde ? borde.soloLoSuyo : az.bool(0.4);
    const email = `${prefijo}${i}@x.com`, tipo = `${prefijo}_${i}`, miembroId = `m_${prefijo}${i}`;
    await b.servicio(`insert into public.tipos_cuenta (id, nombre, areas, "soloLoSuyo") values (${lit(tipo)}, ${lit(`T${i}`)}, ${lit(areas)}, ${soloLoSuyo})`);
    await b.servicio(`insert into public.equipo (id, nombre, email) values (${lit(miembroId)}, ${lit(`Persona ${prefijo}${i}`)}, ${lit(email)})`);
    await b.servicio(`insert into public.usuarios_permitidos (email, rol) values (${lit(email)}, ${lit(tipo)})`);
    personas.push({ email, tipo, miembroId, acceso: { tipo, nombre: `T${i}`, areas, soloLoSuyo, miembroId } });
  }
  return personas;
}
