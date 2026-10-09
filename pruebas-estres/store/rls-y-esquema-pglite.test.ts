/* Estrés del almacén, frentes 1 y 2 contra un Postgres de verdad (PGlite, en memoria).

   Se corre supabase/tipos-cuenta.sql sobre las tablas mínimas que pide (como pruebas/sql/control-cruzado.ensayo.mjs) y, encima, los SQL
   de las tablas nuevas del 07/10 —dos veces cada uno: tienen que ser idempotentes—. Después:
   - el esquema que el SQL dejó (information_schema) es el que lee _sql.ts: así las pruebas estáticas de columnas↔tipos son confiables;
   - cada fila que el store podría mandar (al azar) la acepta o la rechaza Postgres igual que la nube falsa (NOT NULL, tipos, CHECK):
     si no, las pruebas contra la nube falsa afirmarían cosas que la base real no hace;
   - las políticas de RLS reales dicen lo mismo que permisos.ts (puedeLeer/puedeEditar) para cada tipo de cuenta de fábrica, en las tablas
     nuevas (devoluciones —el closer sólo ve las de sus ventas—, gastos_recurrentes, seguimiento_alumnos, testimonios), en registros_webinar
     (lo ve y lo escribe quien ve/edita Webinars, menos el closer) y en whatsapp_* (sólo leer);
   - los tipos de cuenta que siembra el SQL son los de TIPOS_POR_DEFECTO.
   No es parte del `npm test` de siempre si PGlite no está: se saltea (PGLITE_DIR=/ruta/a/@electric-sql/pglite para elegir dónde). */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { RAIZ, azar, filaDeInterface, porJson } from "./_aleatorio";
import { leerEsquema, violacion } from "./_sql";
import { AREAS, TIPOS_POR_DEFECTO, nivelDeAreas, nivelEn, puedeEditar, puedeLeer, type MiAcceso } from "@/lib/permisos";
import { INTERFAZ_DE_TABLA } from "./_modelo";

const DIR = process.env.PGLITE_DIR ?? "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite";
const hay = existsSync(resolve(DIR, "dist/index.js"));
const sql = (n: string) => readFileSync(resolve(RAIZ, n), "utf8");
const esquema = leerEsquema();

/* El orden en que se corren en producción (los que no hacen falta para estas tablas se omiten). */
const ARCHIVOS = ["supabase/tipos-cuenta.sql", "supabase/customer-success.sql", "supabase/customer-success-lili.sql", "supabase/devoluciones.sql", "supabase/gastos-recurrentes.sql",
  "supabase/registros-webinar.sql", "supabase/whatsapp-lector.sql", "supabase/gastos-devengo.sql", "supabase/procesadores-otros.sql", "supabase/cierre-del-dia.sql",
  "supabase/control-cruzado.sql"];

type Db = { exec(s: string): Promise<unknown>; query(s: string, p?: unknown[]): Promise<{ rows: Record<string, unknown>[]; affectedRows?: number }>; close(): Promise<void> };

async function armar(): Promise<Db> {
  const { PGlite } = await import(pathToFileURL(resolve(DIR, "dist/index.js")).href);
  const db = new PGlite() as Db;
  await db.exec(`
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create role authenticated; create role anon;
    create table public.usuarios_permitidos (email text primary key, nombre text, rol text not null default 'equipo', "creadoEn" timestamptz default now());
    create table public.equipo (id text primary key, nombre text, email text, activo boolean default true);
    create table public.ventas (id text primary key, "closerId" text, "setterId" text, "contactoId" text, estado text default 'activa');
    create table public.cuotas (id text primary key, "ventaId" text, "closerId" text);
    create table public.pagos (id text primary key, "cuotaId" text, monto numeric not null default 0, moneda text default 'USD', fecha text, "montoArs" numeric, comprobante jsonb, "comprobanteLink" text, "movimientoId" text, chequeado boolean);
    create table public.sesiones (id text primary key, anfitrion text, "leadId" text, "contactoId" text, "estadoLlamada" text, "estadoPreCall" text,
      inicia timestamptz, invitado text, email text, estado text, tipo text, utm jsonb, "creadoEn" timestamptz default now());
    create table public.leads (id text primary key, responsable text, "contactoId" text);
    create table public.contactos (id text primary key, telefono text);
    create table public.comentarios (id text primary key, "contactoId" text);
    create table public.alumnos (id text primary key, "ventaId" text);
    create table public.gastos (id text primary key, "webinarId" text, fecha timestamptz default now());
    create table public.actividad (id text primary key, entidad text, "entidadId" text);
    create table public.procesadores (id text primary key, nombre text);
    create table public.webinars (id text primary key);
    create table public.ajustes (id integer primary key);
    create function public.es_dueno() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and rol = 'dueno') $$;
    create function public.puede_entrar() returns boolean language sql stable security definer as $$
      select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
  `);
  for (const f of ARCHIVOS) { await db.exec(sql(f)); await db.exec(sql(f)); }
  await db.exec(`
    grant usage on schema public, auth to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant execute on all functions in schema public to authenticated;
    grant execute on function auth.jwt() to authenticated;
  `);
  return db;
}

/* Un solo Postgres para las tres pruebas (arrancarlo tarda entre 1 y 5 segundos). */
const db: Db | null = hay ? await armar() : null;
after(async () => { await db?.close(); });

const como = async (db: Db, email: string | null) => {
  await db.exec("reset role");
  if (email) { await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email, role: "authenticated" })}', false)`); await db.exec("set role authenticated"); }
  else await db.exec(`select set_config('request.jwt.claims', '', false)`);
};
const acceso = (id: string): MiAcceso => { const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!; return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo }; };

/* Escrita contra la versión anterior del lote de WhatsApp (tablas sin whatsapp_qr ni la columna «estado», con whatsapp_contactados, estados del lector sin «esperando-qr» y leerJson por caracteres): hay que actualizarla al esquema nuevo. */
test("los SQL de las tablas nuevas corren dos veces sobre tipos-cuenta.sql y dejan el esquema que lee la prueba estática; los tipos de cuenta siembran lo de TIPOS_POR_DEFECTO", { skip: !hay && "PGlite no está instalado", timeout: 60_000, todo: true }, async (t) => {
  if (!db) return;
  {
    /* Esquema: columnas, tipos y obligatoriedad de cada tabla creada por un SQL nuevo. */
    const tablas = ["devoluciones", "gastos_recurrentes", "seguimiento_alumnos", "testimonios", "resells", "registros_webinar", "whatsapp_lector", "whatsapp_grupos", "whatsapp_miembros", "whatsapp_contactados", "tipos_cuenta"];
    for (const tabla of tablas) {
      const real: Record<string, unknown>[] = (await db.query(`select column_name, data_type, is_nullable, column_default from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`, [tabla])).rows;
      const mio = esquema.tablas.get(tabla)!;
      assert.deepEqual(real.map((r) => String(r.column_name)).sort(), [...mio.columnas.keys()].sort(), `${tabla}: las columnas del SQL no son las que lee _sql.ts`);
      for (const r of real) {
        const c = mio.columnas.get(String(r.column_name))!;
        assert.equal(c.noNulo, r.is_nullable === "NO", `${tabla}.${r.column_name}: obligatoriedad`);
        assert.equal(c.porDefecto !== null, r.column_default !== null, `${tabla}.${r.column_name}: default`);
      }
    }
    /* Tipos de cuenta de fábrica. */
    const filas = (await db.query(`select id, "soloLoSuyo", orden, areas from public.tipos_cuenta order by orden`)).rows;
    /* Se comparan el nivel EFECTIVO de cada área (nivelDeAreas): Clientes cuelga de Ventas, así que un tipo sin la clave «clientes» y con
       Ventas igual ve lo mismo (el SQL de siembra de dueno y equipo no lleva «clientes»; los TIPOS_POR_DEFECTO de la app, sí). */
    const efectivo = (areas: Record<string, string>) => Object.fromEntries(AREAS.map((a) => [a.id, nivelDeAreas(areas, a.id)]));
    assert.deepEqual(filas.map((f) => ({ id: f.id, soloLoSuyo: f.soloLoSuyo, orden: f.orden, areas: efectivo(f.areas as Record<string, string>) })),
      [...TIPOS_POR_DEFECTO].sort((a, b) => a.orden - b.orden).map((x) => ({ id: x.id, soloLoSuyo: x.soloLoSuyo, orden: x.orden, areas: efectivo(x.areas as Record<string, string>) })), "TIPOS_POR_DEFECTO ≠ los que siembra el SQL");
    /* Y las columnas que esos mismos SQL le agregan a tablas de antes (ventas, sesiones, pagos, gastos, procesadores). */
    const corridos = new Set(ARCHIVOS);
    for (const tabla of ["ventas", "sesiones", "pagos", "gastos", "procesadores", "ajustes"]) {
      const reales = new Set((await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1`, [tabla])).rows.map((r) => String(r.column_name)));
      for (const [nombre, c] of esquema.tablas.get(tabla)!.columnas) {
        if (c.archivos.every((a) => corridos.has(a))) assert.ok(reales.has(nombre), `${tabla}.${nombre} (de ${c.archivos.join(", ")}) no quedó en la base`);
      }
    }
    t.diagnostic("esquema, columnas agregadas y tipos de cuenta de fábrica: iguales");
  }
});

test("Postgres acepta o rechaza las filas al azar igual que la nube falsa (NOT NULL, tipos y CHECK)", { skip: !hay && "PGlite no está instalado", timeout: 60_000 }, async () => {
  if (!db) return;
  {
    await db.exec(`insert into public.alumnos (id) values ('alu_1'), ('alu_2')`);
    const a = azar(31337);
    const desacuerdos: string[] = [];
    for (const tabla of ["devoluciones", "gastos_recurrentes", "seguimiento_alumnos", "testimonios"]) {
      const t = esquema.tablas.get(tabla)!;
      for (let i = 0; i < 70; i++) {
        const fila = filaDeInterface(a, INTERFAZ_DE_TABLA[tabla], { ids: { alumnos: ["alu_1", "alu_2"] } });
        /* A veces, un valor que se sabe malo (decimal en un entero, null en un obligatorio, texto fuera de la lista). */
        if (a.prob(0.35)) {
          const col = a.pick([...t.columnas.keys()].filter((c) => c !== "id"));
          fila[col] = a.pick([2.5, null, "zzz", -7, 400, 0, ""]);
        }
        if (tabla === "seguimiento_alumnos") { fila.alumnoId = "alu_1"; fila.id = `seg_${i}`; await db.exec(`delete from public.seguimiento_alumnos`); }
        if (["seguimiento_alumnos", "testimonios"].includes(tabla)) fila.alumnoId = "alu_1";
        const limpia = porJson(fila);
        const prediccion = violacion(t, limpia, true);
        const columnas = Object.keys(limpia).filter((k) => t.columnas.has(k));
        let real: string | null = null;
        try {
          await db.query(`insert into public.${tabla} (${columnas.map((c) => `"${c}"`).join(",")}) select ${columnas.map((c) => `"${c}"`).join(",")} from json_populate_record(null::public.${tabla}, $1::json)`, [JSON.stringify(limpia)]);
        } catch (e) { real = (e as { code?: string }).code ?? String(e); }
        if ((prediccion === null) !== (real === null)) desacuerdos.push(`${tabla}: ${JSON.stringify(limpia).slice(0, 160)} → la nube falsa ${prediccion ? `rechaza (${prediccion.code})` : "acepta"}, Postgres ${real ? `rechaza (${real})` : "acepta"}`);
        if (real === null) await db.exec(`delete from public.${tabla} where id = '${String(limpia.id).replace(/'/g, "''")}'`);
      }
    }
    assert.deepEqual(desacuerdos, []);
    await db.exec(`delete from public.alumnos where id in ('alu_1', 'alu_2')`);
  }
});

/* Escrita contra la versión anterior del lote de WhatsApp (tablas sin whatsapp_qr ni la columna «estado», con whatsapp_contactados, estados del lector sin «esperando-qr» y leerJson por caracteres): hay que actualizarla al esquema nuevo. */
test("las políticas de RLS reales dicen lo mismo que permisos.ts para cada tipo de cuenta, en las tablas nuevas", { skip: !hay && "PGlite no está instalado", timeout: 60_000, todo: true }, async () => {
  if (!db) return;
  {
    await db.exec(`
      insert into public.equipo (id, nombre, email) values ('m_closer', 'Closer', 'closer@x.com'), ('m_otro', 'Otro', 'otro@x.com');
      insert into public.ventas (id, "closerId") values ('v1', 'm_closer'), ('v2', 'm_otro');
      insert into public.devoluciones (id, "ventaId", monto) values ('d1', 'v1', 10), ('d2', 'v2', 20);
      insert into public.gastos_recurrentes (id, concepto, categoria, desde) values ('r1', 'x', 'y', '2026-10');
      insert into public.alumnos (id) values ('a0'), ${TIPOS_POR_DEFECTO.map((t) => `('a_${t.id}')`).join(", ")};
      insert into public.seguimiento_alumnos (id, "alumnoId") values ('seg_a0', 'a0');
      insert into public.testimonios (id, "alumnoId") values ('t1', 'a0');
      insert into public.webinars (id) values ('w1');
      insert into public.registros_webinar (id, email) values ('reg1', 'x@y.com');
      insert into public.whatsapp_lector (id) values (1);
      insert into public.whatsapp_grupos (id, nombre, "webinarId") values ('g1', 'g', 'w1');
      insert into public.whatsapp_miembros ("grupoId", telefono) values ('g1', '5491111');
      insert into public.whatsapp_contactados ("webinarId", "personaId") values ('w1', 'p1');
      insert into public.usuarios_permitidos (email, rol) values ${TIPOS_POR_DEFECTO.map((t) => `('${t.id}@x.com', '${t.id}')`).join(", ")};
      update public.equipo set email = 'closer@x.com' where id = 'm_closer';
      update public.usuarios_permitidos set email = 'closer@x.com' where rol = 'closer';
    `);
    /* Cómo se arma una fila nueva de cada tabla para probar el INSERT. */
    const nueva = (tabla: string, tipo: string): string => ({
      devoluciones: `insert into public.devoluciones (id, "ventaId", monto) values ('n_${tipo}', 'v1', 1)`,
      gastos_recurrentes: `insert into public.gastos_recurrentes (id, concepto, categoria, desde) values ('n_${tipo}', 'x', 'y', '2026-10')`,
      seguimiento_alumnos: `insert into public.seguimiento_alumnos (id, "alumnoId") values ('n_${tipo}', 'a_${tipo}')`,
      testimonios: `insert into public.testimonios (id, "alumnoId") values ('n_${tipo}', 'a0')`,
      registros_webinar: `insert into public.registros_webinar (id, email) values ('n_${tipo}', 'n@y.com')`,
      whatsapp_grupos: `insert into public.whatsapp_grupos (id, nombre) values ('n_${tipo}', 'g')`,
    }[tabla] as string);
    const problemas: string[] = [];
    for (const tipo of TIPOS_POR_DEFECTO) {
      const a = acceso(tipo.id);
      const esperado: Record<string, { lee: boolean; escribe: boolean }> = {
        devoluciones: { lee: puedeLeer(a, "devoluciones"), escribe: puedeEditar(a, "devoluciones") },
        gastos_recurrentes: { lee: puedeLeer(a, "gastos_recurrentes"), escribe: puedeEditar(a, "gastos_recurrentes") },
        seguimiento_alumnos: { lee: puedeLeer(a, "seguimiento_alumnos"), escribe: puedeEditar(a, "seguimiento_alumnos") },
        testimonios: { lee: puedeLeer(a, "testimonios"), escribe: puedeEditar(a, "testimonios") },
        /* La pantalla Formularios: se ve con Webinars, se edita con Webinars editable; el closer (sólo lo suyo) no ve la tabla. */
        registros_webinar: { lee: nivelEn(a, "webinars") >= 1 && !a.soloLoSuyo, escribe: nivelEn(a, "webinars") === 2 && !a.soloLoSuyo },
        whatsapp_grupos: { lee: nivelEn(a, "webinars") >= 1, escribe: false },
      };
      for (const [tabla, { lee, escribe }] of Object.entries(esperado)) {
        await como(db, `${tipo.id}@x.com`);
        const n = Number((await db.query(`select count(*)::int n from public.${tabla}`)).rows[0].n);
        /* El closer ve de las devoluciones sólo las de sus ventas. */
        const vistas = tabla === "devoluciones" && tipo.soloLoSuyo && tipo.id !== "dueno" ? 1 : 1;
        if (lee !== (n >= 1)) problemas.push(`${tipo.id} · ${tabla}: la app dice lee=${lee}, la base le muestra ${n} fila(s)`);
        if (lee && tabla === "devoluciones" && tipo.soloLoSuyo && n !== vistas) problemas.push(`${tipo.id} · devoluciones: el closer ve ${n}, tendría que ver sólo la de su venta`);
        if (lee && tabla === "devoluciones" && !tipo.soloLoSuyo && n !== 2) problemas.push(`${tipo.id} · devoluciones: ve ${n}, tendría que ver las 2`);
        let pudo = true;
        try { await db.query(nueva(tabla, tipo.id)); } catch (e) { if ((e as { code?: string }).code !== "42501") throw e; pudo = false; }
        if (pudo !== escribe) problemas.push(`${tipo.id} · ${tabla}: la app dice escribe=${escribe}, la base ${pudo ? "lo deja" : "lo rechaza (42501)"}`);
        await como(db, null);
        await db.exec(`delete from public.${tabla} where id = 'n_${tipo.id}'`);
      }
    }
    /* Borrar y corregir lo de otro: el closer no puede con una devolución (sólo la ve). */
    await como(db, "closer@x.com");
    const borradas = (await db.query(`delete from public.devoluciones where id = 'd1' returning id`)).rows.length;
    if (borradas !== 0) problemas.push("closer · devoluciones: pudo borrar una devolución de su venta");
    await como(db, null);
    assert.deepEqual(problemas, []);
  }
});
