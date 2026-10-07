import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crearAzar } from "./azar";

/* ==================================================================
   El trigger de la primera carga (supabase/cierre-del-dia.sql:
   sesiones_marca_primera_carga) corrido de verdad en un Postgres en memoria
   (PGlite), contra la regla que usa el store de la app (store.ts:
   cargarLlamadas): la marca de cuándo se cargó un estado por primera vez

   - se pone al pasar de vacío a cargado (con la hora que venga, o la del
     servidor si no vino);
   - no se corre al cambiar a otro estado ni al volver a cargarlo después de
     vaciarlo;
   - no se borra al vaciar;
   - sólo la saca un cambio que la manda en NULL a la vez que vacía el estado
     (el «Deshacer» de la primera carga).

   Es la pieza que cuida los strikes cuando la carga la hace una pestaña vieja
   de la app, que no manda la marca. Sin PGlite en el disco se saltea.
   ================================================================== */

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PGLITE = "file:///Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite/dist/index.js";
type Db = { exec(sql: string): Promise<unknown>; query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>; close(): Promise<void> };

let compartida: Promise<Db | null> | undefined;
async function abrir(): Promise<Db | null> {
  let PGlite: new () => Db;
  try { PGlite = (await import(PGLITE)).PGlite; } catch { return null; }
  const db = new PGlite();
  const sql = readFileSync(join(RAIZ, "supabase", "cierre-del-dia.sql"), "utf8");
  await db.exec(`create table public.sesiones (id text primary key, "estadoLlamada" text, "estadoLlamadaEn" timestamptz, "estadoPreCall" text, "estadoPreCallEn" timestamptz);`);
  const f = sql.match(/create or replace function public\.sesiones_marca_primera_carga\(\)[^]*?end \$\$;/);
  assert.ok(f, "no está la función del trigger");
  await db.exec(f[0]);
  await db.exec("create trigger sesiones_marca_primera_carga before update on public.sesiones for each row execute function public.sesiones_marca_primera_carga();");
  return db;
}
const base = () => (compartida ??= abrir());
after(async () => { await (await compartida)?.close(); });

const T1 = "2026-10-01T10:00:00.000Z", T2 = "2026-10-03T10:00:00.000Z";

async function fila(db: Db, id: string) {
  const r = await db.query<{ e: string | null; m: string | null; p: string | null; pm: string | null }>(
    `select "estadoLlamada" as e, to_char("estadoLlamadaEn" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as m, "estadoPreCall" as p, to_char("estadoPreCallEn" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as pm from public.sesiones where id = $1`, [id]);
  return r.rows[0];
}

test("la marca de la primera carga, en la base: se pone, no se corre, no se borra al vaciar, y sólo la saca deshacer la primera carga", async (t) => {
  const db = await base();
  if (!db) return t.skip("PGlite no está en el disco");
  await db.query("insert into public.sesiones (id) values ('a')");
  /* Una pestaña vieja carga el estado sin mandar la marca: la pone el servidor. */
  await db.query(`update public.sesiones set "estadoLlamada" = 'Compra Full' where id = 'a'`);
  const primera = (await fila(db, "a")).m;
  assert.ok(primera, "la completa con la hora del servidor");
  /* Cambiar a otro estado, aunque mande otra marca: no se corre. */
  await db.query(`update public.sesiones set "estadoLlamada" = 'Seguimiento Nutrición', "estadoLlamadaEn" = $1 where id = 'a'`, [T2]);
  assert.equal((await fila(db, "a")).m, primera);
  /* Vaciar: la marca queda. */
  await db.query(`update public.sesiones set "estadoLlamada" = null where id = 'a'`);
  assert.deepEqual([(await fila(db, "a")).e, (await fila(db, "a")).m], [null, primera]);
  /* Volver a cargarlo: la primera vez sigue siendo la primera. */
  await db.query(`update public.sesiones set "estadoLlamada" = 'Compra Cuotas', "estadoLlamadaEn" = $1 where id = 'a'`, [T2]);
  assert.equal((await fila(db, "a")).m, primera);
  /* Una carga con marca desde vacío, sin marca previa: vale la que viene. */
  await db.query("insert into public.sesiones (id) values ('b')");
  await db.query(`update public.sesiones set "estadoLlamada" = 'Compra Full', "estadoLlamadaEn" = $1 where id = 'b'`, [T1]);
  assert.equal((await fila(db, "b")).m, T1);
  /* Deshacer la primera carga: vacía el estado y manda la marca en NULL. */
  await db.query(`update public.sesiones set "estadoLlamada" = null, "estadoLlamadaEn" = null where id = 'b'`);
  assert.deepEqual([(await fila(db, "b")).e, (await fila(db, "b")).m], [null, null]);
  /* Y la siguiente carga vuelve a ser la primera. */
  await db.query(`update public.sesiones set "estadoLlamada" = 'Inasistió' where id = 'b'`);
  assert.ok((await fila(db, "b")).m);
  /* El Estado Pre-Call se cuida igual y no se mezcla con el otro. */
  await db.query("insert into public.sesiones (id) values ('c')");
  await db.query(`update public.sesiones set "estadoPreCall" = 'Confirmado' where id = 'c'`);
  const f = await fila(db, "c");
  assert.ok(f.pm && !f.m, "cada estado tiene su marca");
  /* Una fila nueva (INSERT) con un estado no inventa marca: sólo mira los UPDATE. */
  await db.query(`insert into public.sesiones (id, "estadoLlamada") values ('d', 'Compra Full')`);
  assert.equal((await fila(db, "d")).m, null);
});

test("100 secuencias al azar: la base y la regla de la app dicen lo mismo de cuándo hay marca y cuándo no", async (t) => {
  const db = await base();
  if (!db) return t.skip("PGlite no está en el disco");
  const ESTADOS = ["Compra Full", "Seguimiento Nutrición", "Inasistió", "NO Calificado", "Reserva"];
  let marcas = 0, vaciados = 0;
  for (let semilla = 1; semilla <= 100; semilla++) {
    const r = crearAzar(semilla);
    const id = `s${semilla}`;
    await db.query("insert into public.sesiones (id) values ($1)", [id]);
    /* La regla de la app (store.ts): estado actual, marca actual. `NUEVA` es «la pone el servidor». */
    let estado: string | null = null, marca: string | null = null;
    for (let paso = 0; paso < r.entre(2, 10); paso++) {
      const que = r.elige(["cargar", "cargar", "cambiar", "vaciar"] as const);
      const llevaMarca = r.si(0.5);
      if (que === "cargar" && !estado) {
        const nuevo = r.elige(ESTADOS);
        await db.query(`update public.sesiones set "estadoLlamada" = $2 ${llevaMarca ? `, "estadoLlamadaEn" = '${T1}'` : ""} where id = $1`, [id, nuevo]);
        if (!marca) { marca = llevaMarca ? T1 : "SERVIDOR"; marcas++; }
        estado = nuevo;
      } else if (que === "cambiar" && estado) {
        const nuevo = r.elige(ESTADOS);
        await db.query(`update public.sesiones set "estadoLlamada" = $2 ${llevaMarca ? `, "estadoLlamadaEn" = '${T2}'` : ""} where id = $1`, [id, nuevo]);
        estado = nuevo;
        /* Con marca ya puesta no se corre; sin ella (estado de antes de la función), vale la que viene o ninguna. */
        if (!marca && llevaMarca) marca = T2;
      } else if (que === "vaciar" && estado) {
        await db.query(`update public.sesiones set "estadoLlamada" = null where id = $1`, [id]);
        estado = null; vaciados++;
      }
      const ahora = await fila(db, id);
      assert.equal(ahora.e, estado, `semilla ${semilla}: estado`);
      assert.equal(Boolean(ahora.m), Boolean(marca), `semilla ${semilla} paso ${paso} (${que}): marca ${ahora.m} y la regla dice ${marca}`);
      if (marca && marca !== "SERVIDOR") assert.equal(ahora.m, marca, `semilla ${semilla} paso ${paso}: la marca se corrió`);
      if (marca === "SERVIDOR") marca = ahora.m;
    }
  }
  assert.ok(marcas > 60 && vaciados > 25, `marcas ${marcas}, vaciados ${vaciados}`);
});
