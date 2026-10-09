import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { closerDeLlamada, destinosDePase, planDePase } from "@/lib/pasar-llamadas";
import { miembroDeCloser } from "@/lib/crm";
import type { MiembroEquipo, Sesion } from "@/lib/types";
import { crearAzar, enAR, llamada, miembro } from "./azar";

/* ==================================================================
   «El nuevo la ve y el viejo deja de verla», contra la base de verdad:
   las funciones reales de supabase/tipos-cuenta.sql (nombre_corto,
   miembro_de_nombre, son_mios, mis_anfitriones) corridas en un Postgres en
   memoria (PGlite), sin red ni ninguna base de la empresa.

   Se arma un equipo y un montón de llamadas; el director pasa algunas con
   planDePase (lib/pasar-llamadas.ts) y se le pregunta a la base, como cada
   closer, cuáles llamadas ve. Sin PGlite en el disco la prueba se saltea.
   ================================================================== */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PGLITE = pathToFileURL(`${process.env.PGLITE_DIR ?? "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite"}/dist/index.js`).href;

type Db = { exec(sql: string): Promise<unknown>; query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> };

async function abrirBase(): Promise<Db | null> {
  let PGlite: new () => Db;
  try { PGlite = (await import(PGLITE)).PGlite; } catch { return null; }
  const db = new PGlite();
  const sql = readFileSync(join(RAIZ, "supabase", "tipos-cuenta.sql"), "utf8");
  await db.exec(`create schema if not exists auth;
    create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
    create table public.equipo (id text primary key, nombre text, activo boolean default true, email text, rol text);
    create table public.sesiones (id text primary key, anfitrion text);`);
  for (const nombre of ["nombre_corto", "miembro_de_nombre", "mi_miembro_id", "son_mios", "mis_anfitriones", "mis_sesiones"]) {
    const m = sql.match(new RegExp(`create or replace function public\\.${nombre}\\([^]*?\\$\\$;`));
    assert.ok(m, `no está ${nombre} en tipos-cuenta.sql`);
    await db.exec(m[0]);
  }
  return db;
}

/* Una sola base para todas las pruebas de este archivo (arrancar PGlite tarda un segundo). */
let compartida: Promise<Db | null> | undefined;
const base = () => (compartida ??= abrirBase());
after(async () => { const db = await compartida; await db?.close(); });

const comoCloser = async (db: Db, email: string) => { await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ email })]); };
const llamadasQueVe = async (db: Db, email: string): Promise<Set<string>> => {
  await comoCloser(db, email);
  const r = await db.query<{ mis: string[] }>("select public.mis_sesiones() as mis");
  return new Set(r.rows[0].mis);
};

/* Sin «ñ» ni «ç» en minúscula: lo que hace la base con ésas es la prueba «BUG» de abajo. */
const NOMBRES = ["Mariano", "Dante Barbieri", "Valentín Abadía", "Lucía Pérez Gómez", "ÑANDÚ NÚÑEZ", "Ana María", "Juan Cruz", "Günther Müller", "Camila"];
const HOSTS: string[] = ["Mariano Arias", "mariano", "Dante Barbieri", "DANTE BARBIERI", "Dante", "Valentin Abadia", "Valentín Abadía", "V. Abadia", "Lucia Perez", "Lucía Pérez Gómez",
  "Nandu Nunez", "ÑANDÚ NÚÑEZ", "Ana Maria Gomez", "Juan Cruz Lopez", "Juan", "Gunther Muller", "Camila Rojas", "Externo Uno", "  Dante   Barbieri "];

test("la base y la app unen cada anfitrión con la misma persona: acentos, mayúsculas, espacios en el medio y nombres de una o tres palabras (equipos al azar)", async (t) => {
  const db = await base();
  if (!db) return t.skip("PGlite no está en el disco");
  {
    let comparados = 0, ambiguos = 0;
    for (let semilla = 1; semilla <= 60; semilla++) {
      const r = crearAzar(semilla);
      const equipo: MiembroEquipo[] = [];
      const cortos = new Set<string>();
      const corto = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().split(/\s+/).slice(0, 2).join(" ");
      for (const n of r.mezclar(NOMBRES)) {
        if (r.si(0.3) || cortos.has(corto(n))) continue;
        cortos.add(corto(n));
        equipo.push(miembro(`m${equipo.length}`, n, "closer", { activo: r.si(0.85), email: `m${equipo.length}@a.com` }));
      }
      await db.exec("delete from public.equipo");
      for (const m of equipo) await db.query("insert into public.equipo (id, nombre, activo, email, rol) values ($1,$2,$3,$4,$5)", [m.id, m.nombre, m.activo, m.email, m.rol]);
      for (const h of HOSTS) {
        const c = corto(h);
        const cs = equipo.filter((m) => corto(m.nombre) === c || (corto(m.nombre) !== "" && (c.startsWith(`${corto(m.nombre)} `) || corto(m.nombre).startsWith(`${c} `))));
        /* Con dos candidatos sin uno exacto, cuál elige cada lado es la prueba «BUG» de pasar-llamadas.test.ts. */
        if (cs.length > 1 && !cs.some((m) => corto(m.nombre) === c)) { ambiguos++; continue; }
        const deLaBase: { rows: { m: string | null }[] } = await db.query("select public.miembro_de_nombre($1) as m", [h]);
        const app = miembroDeCloser(h.trim(), equipo)?.id ?? null;
        assert.equal(deLaBase.rows[0].m, app, `«${h}» en [${equipo.map((m) => m.nombre).join(", ")}]`);
        comparados++;
      }
    }
    assert.ok(comparados > 500, `comparados ${comparados}, ambiguos ${ambiguos}`);
  }
});

test("pasar llamadas contra la base real: el nuevo closer la ve y el viejo deja de verla, y nadie más nota nada (60 semillas)", async (t) => {
  const db = await base();
  if (!db) return t.skip("PGlite no está en el disco");
  {
    let pases = 0, vistasPorElNuevo = 0;
    for (let semilla = 1; semilla <= 60; semilla++) {
      const r = crearAzar(semilla);
      /* Equipo sin nombres parecidos: cada anfitrión sólo puede ser de uno. */
      const equipo: MiembroEquipo[] = [
        miembro("mariano", "Mariano", "closer", { email: "mariano@a.com" }),
        miembro("dante", "Dante Barbieri", "closer", { email: "dante@a.com" }),
        miembro("valentin", "Valentín Abadía", "closer", { email: "valentin@a.com" }),
        miembro("lucia", "Lucía Pérez Gómez", "closer", { email: "lucia@a.com" }),
        miembro("nandu", "ÑANDÚ NÚÑEZ", "closer", { email: "nandu@a.com", activo: r.si(0.8) }),
      ];
      const sesiones: Sesion[] = Array.from({ length: r.entre(4, 14) }, (_, i) => llamada(`s${i}`, r.elige(HOSTS), enAR("2026-10-20", 15)));
      await db.exec("delete from public.equipo; delete from public.sesiones");
      for (const m of equipo) await db.query("insert into public.equipo (id, nombre, activo, email, rol) values ($1,$2,$3,$4,$5)", [m.id, m.nombre, m.activo, m.email, m.rol]);
      const escribir = async (s: Sesion) => { await db.query("insert into public.sesiones (id, anfitrion) values ($1,$2) on conflict (id) do update set anfitrion = excluded.anfitrion", [s.id, s.anfitrion ?? null]); };
      for (const s of sesiones) await escribir(s);

      const antes = new Map<string, Set<string>>();
      for (const m of equipo) antes.set(m.id, await llamadasQueVe(db, m.email!));
      /* La base ve lo mismo que la app para cada una (sin pase todavía). */
      for (const m of equipo) for (const s of sesiones) assert.equal(antes.get(m.id)!.has(s.id), closerDeLlamada(s, equipo).miembro?.id === m.id, `${m.nombre} y ${s.anfitrion}`);

      const elegidas = sesiones.filter(() => r.si(0.4));
      for (const s of elegidas) {
        const destinos = destinosDePase({ equipo, sesiones });
        const d = r.elige(destinos);
        const plan = planDePase(s, d, { equipo, por: "Santi", cuando: "2026-10-08T14:00:00.000Z" });
        if (!plan) continue;
        const duenoAntes = closerDeLlamada(s, equipo).miembro;
        Object.assign(s, { anfitrion: plan.cambios.anfitrion, extra: plan.cambios.extra });
        await escribir(s);
        pases++;
        const nuevo = await llamadasQueVe(db, d.miembro.email!);
        assert.ok(nuevo.has(s.id), `${d.miembro.nombre} no ve la llamada que le pasaron (anfitrión «${s.anfitrion}»)`);
        vistasPorElNuevo++;
        if (duenoAntes && duenoAntes.id !== d.miembro.id) assert.ok(!(await llamadasQueVe(db, duenoAntes.email!)).has(s.id), `${duenoAntes.nombre} sigue viendo la llamada que pasó`);
        for (const m of equipo) if (m.id !== d.miembro.id && m.id !== duenoAntes?.id) assert.equal((await llamadasQueVe(db, m.email!)).has(s.id), false, `${m.nombre} no tendría que ver la llamada`);
      }
      /* Al final, cada closer ve exactamente lo que la app dice que es suyo. */
      for (const m of equipo) {
        const ve = await llamadasQueVe(db, m.email!);
        assert.deepEqual([...ve].sort(), sesiones.filter((s) => closerDeLlamada(s, equipo).miembro?.id === m.id).map((s) => s.id).sort(), m.nombre);
      }
    }
    assert.ok(pases > 100 && vistasPorElNuevo === pases, `pases ${pases}`);
  }
});

/* BUG: nombre_corto (supabase/tipos-cuenta.sql) lleva en translate() una lista de salida de 49 letras para una de entrada de 48
   (sobra una «u» antes de «nc»): las letras de la «ñ» y la «ç» en minúscula quedan corridas y la base las lee como «u» y «n».
   «Nuñez» pasa a ser «nuuez» para la base y «nunez» para la app (miembroDeCloser, que usa normalize("NFD")). Mientras los dos
   lados escriban igual (los dos con «ñ») no se nota; pero si Equipo dice «Mariano Nunez» y Calendly «Mariano Nuñez» (o al
   revés), la app le pone la llamada a Mariano en el CRM, en el cierre del día y en los strikes y la base no se la muestra: entra
   y no ve nada, y «Equipo → Accesos» (evaluarClosers) dice que está todo bien. Núñez, Muñoz, Peña, Ibáñez, Castaño, Niño... */
test("BUG: la base une «Nuñez» y «Nunez» como la app (la «ñ» minúscula no se corre en nombre_corto)", async (t) => {
  const db = await base();
  if (!db) return t.skip("PGlite no está en el disco");
  await db.exec("delete from public.equipo; delete from public.sesiones");
  await db.query("insert into public.equipo (id, nombre, activo, email, rol) values ('mariano', 'Mariano Nunez', true, 'mariano@a.com', 'closer')");
  await db.query("insert into public.sesiones (id, anfitrion) values ('s1', 'Mariano Nuñez')");
  const equipo = [miembro("mariano", "Mariano Nunez", "closer", { email: "mariano@a.com" })];
  assert.equal(miembroDeCloser("Mariano Nuñez", equipo)?.id, "mariano", "la app lo une");
  assert.equal((await db.query<{ c: string }>("select public.nombre_corto('Mariano Nuñez') as c")).rows[0].c, "mariano nunez", "nombre_corto de la base");
  assert.equal((await db.query<{ m: string | null }>("select public.miembro_de_nombre('Mariano Nuñez') as m")).rows[0].m, "mariano");
  assert.ok((await llamadasQueVe(db, "mariano@a.com")).has("s1"), "Mariano no ve la llamada de «Mariano Nuñez»");
});
