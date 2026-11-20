/* Una llamada de resell se cierra con UNA regla en la app y en la base (supabase/resell-cierre-unico.sql; Mariano y Lili, 20/11).

   1) La lista de estados que cierran un resell es la misma en la app (RESELL_RESUELTO) y en la base (estados_que_cierran_resell): antes
      estaba copiada a mano en cada función y nada avisaba si una cambiaba. Esta prueba corre siempre (no necesita PGlite).
   2) Con el SQL REAL en un Postgres de verdad (PGlite): «qué falta» da lo mismo en la base que en la app para cada combinación; lo que Lili
      carga en la ficha del testimonio llega a la llamada sin reescribir la ficha ni avisar «el closer cerró»; «No se presentó» devuelve el
      testimonio a «Pendiente de agendar»; el recordatorio usa la regla; lo ya cargado se completa con respaldo; y se puede volver a correr.

   La parte de PGlite necesita PGLITE_DIR (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, leerSql } from "./pg-arnes";
import { faltaDeLaLlamada, RESELL_RESUELTO } from "@/lib/clientes-cs";
import type { Resell } from "@/lib/types";

/* Se carga antes de declarar cualquier prueba: un `await` del módulo después de un test() deja al corredor esperando para siempre. */
const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pg-arnes.ts)";

test("la lista de estados que cierran un resell es la misma en la app y en la base", () => {
  const sql = leerSql("supabase/resell-cierre-unico.sql");
  const m = sql.match(/function public\.estados_que_cierran_resell\(\)[\s\S]*?select array\[([^\]]*)\]/);
  assert.ok(m, "estados_que_cierran_resell está en el SQL");
  const enLaBase = [...m![1].matchAll(/'([^']*)'/g)].map((x) => x[1]);
  assert.deepEqual([...enLaBase].sort(), [...RESELL_RESUELTO].sort());
  /* Y ninguna función del archivo vuelve a escribir la lista a mano. */
  assert.equal((sql.match(/'no quiere renovar'/g) ?? []).length, 1, "la lista está una sola vez");
});

const ESQUEMA = `
  do $$ begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  end $$;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table public.equipo (id text primary key, nombre text, rol text, email text, activo boolean default true);
  create table public.usuarios_permitidos (email text primary key, nombre text);
  create table public.alumnos (id text primary key, nombre text, email text);
  create table public.testimonios (
    id text primary key, "alumnoId" text not null, "followUp" text default '', "fechaGrabacion" text, "conQuien" text default '',
    resell text default '', "estadoVideo" text default '', link text default '', notas text default '', "creadoEn" timestamptz default now()
  );
  create table public.resells (
    id text primary key, "fechaHora" timestamptz not null, nombre text default '', email text default '', closer text default '', estado text default '',
    "casoDeExito" boolean not null default false, cancelada boolean not null default false, testimonio text default '', "linkTestimonio" text default '',
    "alumnoId" text, "contactoId" text, "sesionId" text
  );
  create table public.avisos (id text primary key, para text not null, tipo text not null default 'mencion', titulo text not null, cuerpo text, de text,
    "deEmail" text, "contactoId" text, persona text, "comentarioId" text, "leidoEn" timestamptz, "creadoEn" timestamptz not null default now());
  create function public.edita(tabla text) returns boolean language sql stable as $$
    select lower(coalesce(auth.jwt() ->> 'email', '')) in ('lili@x.com') $$;
  create function public.alumno_de_resell(p_email text, p_sesion text, p_alumno text) returns text language sql stable as $$
    select coalesce(p_alumno, (select a.id from public.alumnos a where lower(a.email) = lower(btrim(p_email)) limit 1)) $$;
  /* Las dos funciones de la llamada que escriben la ficha y avisan: acá sólo anotan que corrieron (su cuerpo real no importa). */
  create table public.bitacora (que text, id text);
  create function public.resell_testimonio_a_ficha() returns trigger language plpgsql as $f$
begin
  insert into public.bitacora values ('a_ficha', new.id);
  return new;
end;
$f$;
  create function public.avisar_resell_cerrado() returns trigger language plpgsql as $f$
declare
  x int;
begin
  insert into public.bitacora values ('aviso', new.id);
  return new;
end;
$f$;
  create trigger resells_testimonio_a_ficha after insert or update of testimonio, "linkTestimonio", estado on public.resells
    for each row execute function public.resell_testimonio_a_ficha();
  create trigger resells_avisar_cerrado after update of estado, testimonio, "linkTestimonio" on public.resells
    for each row execute function public.avisar_resell_cerrado();
  insert into public.equipo (id, nombre, rol, email) values ('eq_m', 'Martín Closer', 'closer', 'martin@x.com'), ('eq_d', 'Diego Director', 'director', 'diego@x.com');
  insert into public.usuarios_permitidos (email, nombre) values ('lili@x.com', 'Laura Servicio'), ('martin@x.com', 'Martín Closer');
  insert into public.alumnos (id, nombre, email) values ('a1', 'Ana Uno', 'ana@x.com'), ('a2', 'Bruno Dos', 'bruno@x.com'), ('a3', 'Carla Tres', 'carla@x.com');
`;

let compartido: Promise<InstanceType<NonNullable<typeof Pg>>> | null = null;
const banco = () => (compartido ??= (async () => {
  const db = new Pg!();
  await db.exec(ESQUEMA);
  /* Lo que ya había antes de correr el SQL: una llamada de testimonio sin resultado cuyo testimonio ya tiene el link (lo cargó Lili). */
  await db.exec(`
    insert into public.resells (id, "fechaHora", nombre, email, closer, "casoDeExito", "alumnoId") values ('rs_viejo', '2026-11-18 18:00+00', 'Carla Tres', 'carla@x.com', 'Martín Closer', true, 'a3');
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion", link, "estadoVideo") values ('t_viejo', 'a3', 'Llamada agendada', '2026-11-18', 'https://drive.google.com/viejo', 'Subido a Drive');
    delete from public.bitacora;`);
  await db.exec(leerSql("supabase/resell-recordar.sql"));
  await db.exec(leerSql("supabase/resell-cierre-unico.sql"));
  return db;
})());
after(async () => { if (compartido) await (await compartido).close(); });

const q = async <T = Record<string, unknown>>(sql: string) => (await (await banco()).query<T>(sql)).rows;
const uno = async <T = Record<string, unknown>>(sql: string) => (await q<T>(sql))[0];
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`;

test("lo ya cargado: la llamada cuyo testimonio tiene el link queda «Grabó» con ese link, con respaldo y sin avisos", { skip: saltear }, async () => {
  assert.deepEqual(await uno(`select testimonio, "linkTestimonio" from public.resells where id = 'rs_viejo'`), { testimonio: "Grabó", linkTestimonio: "https://drive.google.com/viejo" });
  assert.deepEqual(await uno(`select testimonio from respaldo.resells_2011 where id = 'rs_viejo'`), { testimonio: "" }, "el respaldo es de antes");
  assert.equal((await q(`select * from public.bitacora where id = 'rs_viejo'`)).length, 0, "ni reescribió la ficha ni avisó");
  assert.deepEqual(await uno(`select "followUp", "estadoVideo" from public.testimonios where id = 't_viejo'`), { followUp: "Llamada agendada", estadoVideo: "Subido a Drive" });
});

test("«qué falta» da lo mismo en la base que en la app, para cada combinación", { skip: saltear }, async () => {
  const db = await banco();
  const estados = ["", "Seguimiento", "2da Agenda, Seguimiento", "No quiere renovar, Outbording", "Upgrade a Hackear IA", "Renueva", "Alumno vigente",
    "Garantía Extendida", "No responde", "No se presentó", "2da Agenda, No se presentó", "Outboarding"];
  const fechas = ["2026-09-30T23:30:00-03:00", "2026-10-01T00:30:00-03:00", "2026-11-10T15:00:00-03:00"];
  const testimonios: Resell["testimonio"][] = ["", "Grabó", "Se reagenda", "No quiso grabar"];
  let n = 0;
  for (const estado of estados) for (const fechaHora of fechas) for (const casoDeExito of [false, true]) for (const testimonio of testimonios) for (const linkTestimonio of ["", "https://x.com/v"]) {
    const id = `p${++n}`;
    await db.exec(`insert into public.resells (id, "fechaHora", estado, "casoDeExito", testimonio, "linkTestimonio") values (${lit(id)}, ${lit(fechaHora)}, ${lit(estado)}, ${casoDeExito}, ${lit(testimonio ?? "")}, ${lit(linkTestimonio)})`);
    const base = (await db.query<{ f: string[] }>(`select public.falta_de_la_llamada(r) as f from public.resells r where id = ${lit(id)}`)).rows[0].f;
    const app = faltaDeLaLlamada({ fechaHora: new Date(fechaHora).toISOString(), estado, casoDeExito, testimonio, linkTestimonio });
    assert.deepEqual(base, app, `${estado} · ${fechaHora} · caso ${casoDeExito} · ${testimonio} · link ${Boolean(linkTestimonio)}`);
  }
  assert.ok(n > 500);
});

test("Lili carga el link en la ficha: la llamada de ese día dice «Grabó» con el link; ni reescribe la ficha ni avisa que «el closer cerró»", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(`
    insert into public.resells (id, "fechaHora", nombre, email, closer, "casoDeExito", estado, "alumnoId") values
      ('rs_a', '2026-11-18 18:00+00', 'Ana Uno', 'ana@x.com', 'Martín Closer', true, '', 'a1'),
      ('rs_a_otro_dia', '2026-11-25 18:00+00', 'Ana Uno', 'ana@x.com', 'Martín Closer', true, '', 'a1'),
      ('rs_a_no_testimonio', '2026-11-18 19:00+00', 'Ana Uno', 'ana@x.com', 'Martín Closer', false, '', 'a1');
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion") values ('t_a', 'a1', 'Llamada agendada', '2026-11-18');
    delete from public.bitacora;`);
  await db.exec(`update public.testimonios set link = 'https://drive.google.com/a', "estadoVideo" = 'Subido a Drive' where id = 't_a'`);
  assert.deepEqual(await uno(`select testimonio, "linkTestimonio" from public.resells where id = 'rs_a'`), { testimonio: "Grabó", linkTestimonio: "https://drive.google.com/a" });
  assert.deepEqual(await uno(`select testimonio from public.resells where id = 'rs_a_otro_dia'`), { testimonio: "" }, "la de otro día no");
  assert.deepEqual(await uno(`select testimonio from public.resells where id = 'rs_a_no_testimonio'`), { testimonio: "" }, "la que no es de testimonio no");
  assert.equal((await q(`select * from public.bitacora`)).length, 0, "no volvió a escribir la ficha ni avisó");
  assert.deepEqual(await uno(`select "followUp", "estadoVideo" from public.testimonios where id = 't_a'`), { followUp: "Llamada agendada", estadoVideo: "Subido a Drive" }, "la ficha quedó como la dejó Lili");
  /* La marca no queda puesta: un cambio del closer después sí avisa y pasa a la ficha. */
  await db.exec(`update public.resells set estado = 'Renueva' where id = 'rs_a'`);
  assert.deepEqual((await q<{ que: string }>(`select que from public.bitacora order by que`)).map((x) => x.que), ["a_ficha", "aviso"]);
  /* Lo que ya cargó el closer no se pisa. */
  await db.exec(`update public.testimonios set link = 'https://drive.google.com/otro' where id = 't_a'`);
  assert.deepEqual(await uno(`select "linkTestimonio" from public.resells where id = 'rs_a'`), { linkTestimonio: "https://drive.google.com/a" });
});

test("si la ficha dice que no quiso grabar, la llamada también; la del día de al lado (hora de Argentina) cuenta", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(`
    insert into public.resells (id, "fechaHora", email, "casoDeExito", "alumnoId") values ('rs_b', '2026-11-20 01:30+00', 'bruno@x.com', true, 'a2');
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion") values ('t_b', 'a2', 'Llamada agendada', '2026-11-19');`);
  await db.exec(`update public.testimonios set "followUp" = 'No quiere grabar' where id = 't_b'`);
  assert.deepEqual(await uno(`select testimonio from public.resells where id = 'rs_b'`), { testimonio: "No quiso grabar" });
});

test("«No se presentó» en una llamada de testimonio: el testimonio de ese día vuelve a «Pendiente de agendar» y sin fecha", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(`
    insert into public.resells (id, "fechaHora", email, "casoDeExito", "alumnoId") values ('rs_c', '2026-11-19 18:00+00', 'carla@x.com', true, 'a3'),
      ('rs_c2', '2026-11-12 18:00+00', 'carla@x.com', false, 'a3');
    insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion") values ('t_c', 'a3', 'Llamada agendada', '2026-11-19'),
      ('t_c2', 'a3', 'Llamada agendada', '2026-11-12');`);
  await db.exec(`update public.resells set estado = 'No se presentó' where id = 'rs_c'`);
  assert.deepEqual(await uno(`select "followUp", "fechaGrabacion" from public.testimonios where id = 't_c'`), { followUp: "Pendiente de agendar", fechaGrabacion: null });
  assert.deepEqual(await uno(`select public.falta_de_la_llamada(r) as f from public.resells r where id = 'rs_c'`), { f: [] }, "y la llamada queda cerrada");
  await db.exec(`update public.resells set estado = 'No se presentó' where id = 'rs_c2'`);
  assert.deepEqual(await uno(`select "followUp" from public.testimonios where id = 't_c2'`), { followUp: "Llamada agendada" }, "la que no era de testimonio no toca nada");
});

test("el recordatorio usa la regla: dice qué falta y no recuerda una llamada cerrada por «No se presentó»", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(`select set_config('request.jwt.claims', '{"email":"lili@x.com"}', false)`);
  await db.exec(`create or replace function public.destinos_de_recordatorio(p_quien text) returns table (email text, nombre text, es_resp boolean, resp_corto text)
    language sql stable as $$ select 'martin@x.com'::text, 'Martín Closer'::text, true, 'Martín'::text $$`);
  await db.exec(`insert into public.resells (id, "fechaHora", nombre, closer, "casoDeExito", estado) values
    ('rs_d', now() - interval '3 days', 'Dora', 'Martín Closer', true, 'No quiere renovar, Outbording'),
    ('rs_e', now() - interval '3 days', 'Eva', 'Martín Closer', true, 'No se presentó')`);
  await db.exec(`select public.recordar_resell('rs_d')`);
  assert.match((await uno<{ cuerpo: string }>(`select cuerpo from public.avisos where persona = 'Dora'`)).cuerpo, /Falta: si grabó el testimonio\.$/);
  await assert.rejects(db.query(`select public.recordar_resell('rs_e')`), /ya está completa/);
});

test("se puede volver a correr: la línea de las funciones de la llamada se agrega una sola vez y el respaldo no se pisa", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(leerSql("supabase/resell-cierre-unico.sql"));
  for (const f of ["resell_testimonio_a_ficha", "avisar_resell_cerrado"]) {
    const d = (await uno<{ d: string }>(`select pg_get_functiondef('public.${f}()'::regprocedure) as d`)).d;
    assert.equal(d.split("apicanta.llamada_desde_ficha").length - 1, 1, f);
  }
  assert.deepEqual(await uno(`select testimonio from respaldo.resells_2011 where id = 'rs_viejo'`), { testimonio: "" });
});
