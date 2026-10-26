/* El servicio de SUS alumnos para el closer (supabase/servicio-del-closer.sql): con el RLS de verdad (Postgres en memoria, PGlite).
   El closer lee el seguimiento y los accesos de los alumnos de SUS ventas —no los de otro closer ni los que no tienen venta— y no
   puede escribir nada. Nadie que antes no los leía los pasa a leer (director, Administración, setter, Marketing), y los que ya los
   leían (dueño, equipo, Customer Success) siguen igual.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, leerSql, montarBanco, type Banco } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= (async () => {
  const b = await montarBanco(Pg!, { archivos: ["customer-success.sql"], veces: 1 });
  /* accesos_alumno vive en contratos-y-accesos.sql, que pide medio proyecto: acá va la misma tabla y la misma política de siempre. */
  await b.ejecutar(`
    create table if not exists public.accesos_alumno (id text primary key, "alumnoId" text not null, plataforma text not null default 'wisboo');
    alter table public.accesos_alumno enable row level security;
    drop policy if exists ver_accesos_alumno on public.accesos_alumno;
    create policy ver_accesos_alumno on public.accesos_alumno for select to authenticated using ((select public.ve('alumnos')));
    grant select, insert, update, delete on public.accesos_alumno to authenticated;
  `);
  await b.ejecutar(leerSql("supabase/servicio-del-closer.sql"));
  await b.ejecutar(`
    truncate public.seguimiento_alumnos, public.accesos_alumno, public.alumnos, public.ventas cascade;
    insert into public.ventas (id, "closerId") values ('v_dante', 'm_dante'), ('v_otro', 'm_otro');
    insert into public.alumnos (id, "ventaId") values ('a_dante', 'v_dante'), ('a_otro', 'v_otro'), ('a_suelto', null);
    insert into public.seguimiento_alumnos (id, "alumnoId") values ('s_dante', 'a_dante'), ('s_otro', 'a_otro'), ('s_suelto', 'a_suelto');
    insert into public.accesos_alumno (id, "alumnoId") values ('x_dante', 'a_dante'), ('x_otro', 'a_otro'), ('x_suelto', 'a_suelto');
  `);
  return b;
})());
after(async () => { if (compartido) await (await compartido).db.close(); });

const ids = (rows: { id: string }[]) => rows.map((r) => r.id).sort();

test("el closer ve el seguimiento y los accesos de los alumnos de SUS ventas, y nada más", { skip: saltear }, async () => {
  const b = await banco();
  for (const [correo, suyo, otro] of [["dante@x.com", "dante", "otro"], ["otro@x.com", "otro", "dante"]] as const) {
    const seg = await b.intentar<{ id: string }>(correo, `select id from public.seguimiento_alumnos`);
    const acc = await b.intentar<{ id: string }>(correo, `select id from public.accesos_alumno`);
    assert.ok(seg.ok && acc.ok);
    assert.deepEqual(ids(seg.rows), [`s_${suyo}`], `${correo}: su seguimiento`);
    assert.deepEqual(ids(acc.rows), [`x_${suyo}`], `${correo}: sus accesos`);
    assert.ok(!ids(seg.rows).includes(`s_${otro}`) && !ids(seg.rows).includes("s_suelto"), `${correo}: no ve el de otro ni el de un alumno sin venta`);
  }
});

test("el closer no escribe ni el seguimiento ni los accesos", { skip: saltear }, async () => {
  const b = await banco();
  const cambios = [
    `update public.seguimiento_alumnos set "alumnoId" = "alumnoId" where id = 's_dante'`,
    `delete from public.seguimiento_alumnos where id = 's_dante'`,
    `insert into public.seguimiento_alumnos (id, "alumnoId") values ('s_nuevo', 'a_dante')`,
    `update public.accesos_alumno set plataforma = 'telegram' where id = 'x_dante'`,
    `delete from public.accesos_alumno where id = 'x_dante'`,
    `insert into public.accesos_alumno (id, "alumnoId") values ('x_nuevo', 'a_dante')`,
  ];
  for (const sql of cambios) {
    const r = await b.intentar("dante@x.com", sql);
    assert.ok(!r.ok || r.n === 0, `no debería poder: ${sql}`);
  }
  const quedan = await b.servicio<{ n: number }>(`select (select count(*) from public.seguimiento_alumnos)::int + (select count(*) from public.accesos_alumno)::int as n`);
  assert.equal(quedan[0].n, 6);
});

test("los que no lo leían siguen sin leerlo y los que sí, igual", { skip: saltear }, async () => {
  const b = await banco();
  const quien: [string, number][] = [
    ["yari@x.com", 3], ["equipo@x.com", 3], ["lili@x.com", 3], // ven todo (Alumnos)
    ["santi@x.com", 0], ["aldana@x.com", 0], ["seti@x.com", 0], ["marta@x.com", 0], // no tienen Alumnos ni «sólo lo suyo»
    ["nadie@x.com", 0],
  ];
  for (const [correo, cuantos] of quien) {
    const seg = await b.intentar<{ id: string }>(correo, `select id from public.seguimiento_alumnos`);
    const acc = await b.intentar<{ id: string }>(correo, `select id from public.accesos_alumno`);
    assert.ok(seg.ok && acc.ok, correo);
    assert.equal(seg.rows.length, cuantos, `${correo}: seguimiento`);
    assert.equal(acc.rows.length, cuantos, `${correo}: accesos`);
  }
});

test("se puede volver a correr y no toca las políticas de siempre", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(leerSql("supabase/servicio-del-closer.sql"));
  const p = await b.servicio<{ policyname: string }>(
    `select policyname from pg_policies where schemaname = 'public' and tablename in ('seguimiento_alumnos', 'accesos_alumno') and cmd = 'SELECT'`);
  const nombres = p.map((x) => x.policyname).sort();
  assert.ok(nombres.includes("ver_accesos_alumno") && nombres.includes("ver_seguimiento_alumnos"), "las de siempre siguen");
  assert.equal(nombres.filter((n) => n.startsWith("servicio_closer_")).length, 2, "una por tabla, sin repetirse");
});
