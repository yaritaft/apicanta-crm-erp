/* Lo que la agenda escribe en el testimonio, la agenda lo desescribe (supabase/testimonio-se-desescribe.sql; Lili, 10/11: Darío Vargas).

   Con el SQL REAL en un Postgres de verdad (PGlite): una llamada que era caso de éxito y deja de serlo retira el testimonio que ella
   había puesto («Llamada agendada»), pero nunca uno con link, con estado de video o con algo cargado a mano, y nunca si otra llamada
   del mismo mail ese día lo sostiene. Y el testimonio fantasma de Darío que ya estaba cargado se limpia (con respaldo), una sola vez.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, leerSql } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pg-arnes.ts)";

const ESQUEMA = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
  create table public.alumnos (id text primary key, nombre text, email text, estado text default 'activo', inicio timestamptz);
  create table public.testimonios (
    id text primary key, "alumnoId" text not null, "followUp" text default '', "fechaGrabacion" text, "conQuien" text default '',
    resell text default '', "estadoVideo" text default '', link text default '', tecnologias text default '',
    "situacionPrevia" text default '', "situacionActual" text default '', notas text default '', "creadoEn" timestamptz default now()
  );
  create table public.resells (
    id text primary key, "fechaHora" timestamptz not null, nombre text default '', email text default '', closer text default '',
    "casoDeExito" boolean not null default false, cancelada boolean not null default false, testimonio text default ''
  );
`;

let compartido: Promise<InstanceType<NonNullable<typeof Pg>>> | null = null;
const banco = () => (compartido ??= (async () => {
  const db = new Pg!();
  await db.exec(ESQUEMA);
  await db.exec(leerSql("supabase/testimonio-se-desescribe.sql"));
  return db;
})());
after(async () => { if (compartido) await (await compartido).close(); });

let n = 0;
/* Un alumno nuevo por prueba, para que nada se pise. */
async function alumno(): Promise<{ id: string; email: string }> {
  const db = await banco();
  n += 1;
  const a = { id: `a${n}`, email: `alumno${n}@x.com` };
  await db.query(`insert into public.alumnos (id, nombre, email) values ($1, $2, $3)`, [a.id, `Alumno ${n}`, a.email]);
  return a;
}
const EN_3_DIAS = `now() + interval '3 days'`;
async function llamada(id: string, email: string, caso: boolean, extra = ""): Promise<void> {
  const db = await banco();
  await db.exec(`insert into public.resells (id, "fechaHora", email, closer, "casoDeExito" ${extra ? ", " + extra.split("=")[0] : ""}) values ('${id}', ${EN_3_DIAS}, '${email}', 'Mariano Arias', ${caso} ${extra ? ", " + extra.split("=")[1] : ""})`);
}
const desmarcar = async (id: string) => (await banco()).exec(`update public.resells set "casoDeExito" = false where id = '${id}'`);
async function testimonios(alumnoId: string) {
  const db = await banco();
  return (await db.query<{ id: string; followUp: string; fechaGrabacion: string | null; conQuien: string; notas: string }>(
    `select id, "followUp", "fechaGrabacion", "conQuien", notas from public.testimonios where "alumnoId" = $1 order by "creadoEn", id`, [alumnoId])).rows;
}

test("sin testimonio previo: la llamada lo crea «agendado» y, al dejar de ser caso de éxito, se borra", { skip: saltear }, async () => {
  const a = await alumno();
  await llamada(`rs_cal_${a.id}`, a.email, true);
  const antes = await testimonios(a.id);
  assert.equal(antes.length, 1);
  assert.equal(antes[0].id, `tes_rs_cal_${a.id}`);
  assert.equal(antes[0].followUp, "Llamada agendada");
  assert.equal(antes[0].conQuien, "Mariano");
  assert.ok(antes[0].fechaGrabacion);

  await desmarcar(`rs_cal_${a.id}`);
  assert.deepEqual(await testimonios(a.id), [], "Darío: «No era para testimonio» no puede dejar un testimonio en la ficha");
});

test("con un testimonio que ya existía por agendar: vuelve a «Pendiente de agendar», sin fecha, y la fila queda", { skip: saltear }, async () => {
  const db = await banco();
  const a = await alumno();
  await db.exec(`insert into public.testimonios (id, "alumnoId", "followUp") values ('tes_viejo_${a.id}', '${a.id}', 'Pendiente de agendar')`);
  await llamada(`rs_cal_${a.id}`, a.email, true);
  assert.equal((await testimonios(a.id))[0].followUp, "Llamada agendada");

  await desmarcar(`rs_cal_${a.id}`);
  const despues = await testimonios(a.id);
  assert.equal(despues.length, 1, "el testimonio era de antes: no se borra");
  assert.equal(despues[0].followUp, "Pendiente de agendar");
  assert.equal(despues[0].fechaGrabacion, null);
});

test("un testimonio con link, o con estado de video, no se toca nunca", { skip: saltear }, async () => {
  const db = await banco();
  for (const campo of [`link = 'https://youtu.be/abc'`, `"estadoVideo" = 'Pendiente de subir'`]) {
    const a = await alumno();
    await llamada(`rs_cal_${a.id}`, a.email, true);
    await db.exec(`update public.testimonios set ${campo} where "alumnoId" = '${a.id}'`);
    await desmarcar(`rs_cal_${a.id}`);
    const t = await testimonios(a.id);
    assert.equal(t.length, 1, campo);
    assert.equal(t[0].followUp, "Llamada agendada", `${campo}: es trabajo de una persona, no se retira`);
  }
});

test("si ya alguien le cargó algo a mano (notas), no se borra: sólo vuelve a por agendar", { skip: saltear }, async () => {
  const db = await banco();
  const a = await alumno();
  await llamada(`rs_cal_${a.id}`, a.email, true);
  await db.exec(`update public.testimonios set notas = 'Quiere grabar con el logo' where "alumnoId" = '${a.id}'`);
  await desmarcar(`rs_cal_${a.id}`);
  const t = await testimonios(a.id);
  assert.equal(t.length, 1);
  assert.equal(t[0].followUp, "Pendiente de agendar");
  assert.equal(t[0].notas, "Quiere grabar con el logo");
});

test("si otra llamada activa del mismo mail ese día la sostiene, el testimonio se queda", { skip: saltear }, async () => {
  const a = await alumno();
  await llamada(`rs_cal_a_${a.id}`, a.email, true);
  await llamada(`rs_cal_b_${a.id}`, a.email, true);
  await desmarcar(`rs_cal_a_${a.id}`);
  const t = await testimonios(a.id);
  assert.equal(t.length, 1);
  assert.equal(t[0].followUp, "Llamada agendada");
});

test("una llamada que ya tiene resultado de testimonio (Grabó) no retira nada al desmarcarse", { skip: saltear }, async () => {
  const db = await banco();
  const a = await alumno();
  await llamada(`rs_cal_${a.id}`, a.email, true);
  await db.exec(`update public.resells set testimonio = 'Grabó' where id = 'rs_cal_${a.id}'`);
  await desmarcar(`rs_cal_${a.id}`);
  const t = await testimonios(a.id);
  assert.equal(t.length, 1, "lo de «Grabó» lo maneja resell_testimonio_a_ficha, no este retiro");
  assert.equal(t[0].followUp, "Llamada agendada");
});

test("cancelar la llamada sigue devolviéndolo a «Pendiente de agendar» (lo de siempre)", { skip: saltear }, async () => {
  const db = await banco();
  const a = await alumno();
  await db.exec(`insert into public.testimonios (id, "alumnoId", "followUp") values ('tes_c_${a.id}', '${a.id}', 'Pendiente de agendar')`);
  await llamada(`rs_cal_${a.id}`, a.email, true);
  await db.exec(`update public.resells set cancelada = true where id = 'rs_cal_${a.id}'`);
  assert.equal((await testimonios(a.id))[0].followUp, "Pendiente de agendar");
});

test("lo ya cargado: el testimonio fantasma de Darío se limpia (con respaldo) y volver a correr no hace nada más", { skip: saltear }, async () => {
  const db = await banco();
  const dario = await alumno();
  const otro = await alumno();
  const real = await alumno();
  /* Darío: llamada que ya no es caso de éxito + testimonio «Llamada agendada» que había creado la agenda. */
  await db.exec(`
    insert into public.resells (id, "fechaHora", email, closer, "casoDeExito") values ('rs_cal_${dario.id}', now() - interval '12 days', '${dario.email}', 'Mariano Arias', false);
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion", "conQuien") values ('tes_rs_cal_${dario.id}', '${dario.id}', 'Llamada agendada', '2026-10-28', 'Mariano');
    -- Otro: el fantasma pero ya con un link: no se toca.
    insert into public.resells (id, "fechaHora", email, closer, "casoDeExito") values ('rs_cal_${otro.id}', now() - interval '12 days', '${otro.email}', 'Mariano Arias', false);
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion", link) values ('tes_rs_cal_${otro.id}', '${otro.id}', 'Llamada agendada', '2026-10-28', 'https://youtu.be/x');
    -- Real: su llamada SIGUE siendo caso de éxito: no se toca.
    insert into public.resells (id, "fechaHora", email, closer, "casoDeExito") values ('rs_cal_${real.id}', now() - interval '12 days', '${real.email}', 'Yari', true);
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion") values ('tes_rs_cal_${real.id}', '${real.id}', 'Llamada agendada', '2026-10-28');
  `);
  await db.exec(leerSql("supabase/testimonio-se-desescribe.sql"));

  assert.deepEqual(await testimonios(dario.id), [], "el de Darío se fue");
  assert.equal((await testimonios(otro.id)).length, 1, "el que tiene link se queda");
  assert.equal((await testimonios(real.id)).length, 1, "el de una llamada que sigue siendo caso de éxito se queda");
  const copia = await db.query<{ id: string }>(`select id from respaldo.testimonios_1011 where id = 'tes_rs_cal_${dario.id}'`);
  assert.equal(copia.rows.length, 1, "queda en el respaldo para volver atrás");

  await db.exec(leerSql("supabase/testimonio-se-desescribe.sql"));
  const todas = await db.query<{ n: number }>(`select count(*)::int as n from respaldo.testimonios_1011 where id = 'tes_rs_cal_${dario.id}'`);
  assert.equal(todas.rows[0].n, 1, "correrlo dos veces no duplica el respaldo");
});
