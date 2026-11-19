/* De quién es una llamada de resell (supabase/resells-vinculo-alumno.sql; Lili, 19/11: Nicolás González).

   Con el SQL REAL en un Postgres de verdad (PGlite). Nicolás agendó el resell con un mail de Gmail y es alumno con uno de Hotmail: la misma
   persona. La base unía la llamada con el alumno sólo por mail igual y, sin ese vínculo, su ficha no tenía la llamada y el testimonio no se
   enteraba. Ahora hay una sola función (alumno_de_resell) y el vínculo se guarda en la fila.

   Se prueba: cada camino de la función, que un mail vacío NO una con un alumno sin mail (el conteo viejo lo hacía), el disparador al insertar y
   al cambiar el mail, que un alumno nuevo ate las llamadas que lo esperaban, que el SQL se pueda volver a correr y que las funciones que
   unían por mail (acá, resell_agenda_a_testimonio, la REAL) ahora encuentren a la persona.

   Necesita PGlite (ver pg-arnes.ts; PGLITE_DIR); sin él, se saltea. */
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
  create table public.alumnos (id text primary key, nombre text, email text, estado text default 'activo', inicio timestamptz default now(), "leadId" text, "ventaId" text);
  create table public.seguimiento_alumnos (id text primary key, "alumnoId" text not null unique, "otrosMails" jsonb default '[]'::jsonb);
  create table public.contactos (id text primary key, nombre text, email text, "creadoEn" timestamptz default now());
  create table public.leads (id text primary key, email text, "contactoId" text);
  create table public.ventas (id text primary key, "contactoId" text);
  create table public.sesiones (id text primary key, "contactoId" text, "leadId" text);
  create table public.testimonios (
    id text primary key, "alumnoId" text not null, "followUp" text default '', "fechaGrabacion" text, "conQuien" text default '',
    resell text default '', "estadoVideo" text default '', link text default '', tecnologias text default '',
    "situacionPrevia" text default '', "situacionActual" text default '', notas text default '', "creadoEn" timestamptz default now()
  );
  create table public.resells (
    id text primary key, "sesionId" text, "fechaHora" timestamptz not null, nombre text default '', email text default '', telefono text default '', closer text default '',
    estado text default '', "casoDeExito" boolean not null default false, cancelada boolean not null default false, testimonio text default '', "linkTestimonio" text default ''
  );
`;

/* Las funciones vivas que unían por mail y que el SQL reescribe: acá, con la condición TAL CUAL la tienen en la base (el SQL real del
   resto de los lotes necesita medio esquema). resell_agenda_a_testimonio es la real. */
const FUNCIONES_VIVAS = `
  create function public.resell_testimonio_a_ficha() returns trigger language plpgsql as $f$
  declare v_alumno text;
  begin
    select a.id into v_alumno from public.alumnos a
    where btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    return new;
  end $f$;
  create function public.avisar_resell_cerrado() returns trigger language plpgsql as $f$
  declare v_alumno text;
  begin
    select a.id into v_alumno from public.alumnos a
    where btrim(coalesce(new.email, '')) <> '' and lower(btrim(a.email)) = lower(btrim(new.email))
    order by (a.estado = 'activo') desc, a.inicio desc nulls last limit 1;
    return new;
  end $f$;
  create function public.testimonio_pendiente_a_resell() returns trigger language plpgsql as $f$
  begin
    update public.resells r set "casoDeExito" = true
    where not r."casoDeExito"
      and exists (select 1 from public.alumnos a where a.id = new."alumnoId" and lower(btrim(a.email)) = lower(btrim(r.email)));
    return new;
  end $f$;
`;

let compartido: Promise<InstanceType<NonNullable<typeof Pg>>> | null = null;
const banco = () => (compartido ??= (async () => {
  const db = new Pg!();
  await db.exec(ESQUEMA);
  await db.exec(leerSql("supabase/testimonio-se-desescribe.sql")); // resell_agenda_a_testimonio, la real
  await db.exec(FUNCIONES_VIVAS);
  await db.exec(leerSql("supabase/resells-vinculo-alumno.sql"));
  return db;
})());
after(async () => { if (compartido) await (await compartido).close(); });

let n = 0;
const id = (p: string) => `${p}${++n}`;
async function sql(q: string, params: unknown[] = []) { return (await (await banco()).query<Record<string, unknown>>(q, params)).rows; }
const quien = async (email: string, sesion: string | null = null, alumno: string | null = null) =>
  (await sql(`select public.alumno_de_resell($1, $2, $3) as a`, [email, sesion, alumno]))[0].a as string | null;

/* La persona de Nicolás: su contacto (con el Gmail con el que agendó) y su alumno (con el Hotmail) colgado del contacto por leadId. */
async function nicolas() {
  const c = id("con"), a = id("alu");
  await sql(`insert into public.contactos (id, nombre, email) values ($1, 'Nicolás González', $2)`, [c, `nico${n}@gmail.com`]);
  await sql(`insert into public.alumnos (id, nombre, email, "leadId") values ($1, 'Nicolás González', $2, $3)`, [a, `nico${n}@hotmail.com`, c]);
  return { contacto: c, alumno: a, gmail: `nico${n}@gmail.com`, hotmail: `nico${n}@hotmail.com` };
}

test("la migración se puede volver a correr y las funciones vivas usan la regla única", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(leerSql("supabase/resells-vinculo-alumno.sql")); // segunda vez: no rompe
  const f = await sql(`select p.proname, pg_get_functiondef(p.oid) like '%alumno_de_resell%' as nueva, pg_get_functiondef(p.oid) like '%lower(btrim(a.email)) = lower(btrim(new.email))%' as vieja
    from pg_proc p where p.proname in ('resell_testimonio_a_ficha', 'avisar_resell_cerrado', 'testimonio_pendiente_a_resell', 'resell_agenda_a_testimonio') order by 1`);
  assert.equal(f.length, 4);
  for (const x of f) { assert.equal(x.nueva, true, `${x.proname} usa alumno_de_resell`); assert.equal(x.vieja, false, `${x.proname} ya no une sólo por mail`); }
});

test("Nicolás: el Gmail de la llamada y el Hotmail del alumno son la misma persona", { skip: saltear }, async () => {
  const p = await nicolas();
  assert.equal(await quien(p.gmail), p.alumno, "por la persona con ese mail (su contacto) y el alumno que cuelga de ella");
  assert.equal(await quien(p.hotmail), p.alumno, "y el mail de su ficha de alumno, como siempre");
  assert.equal(await quien(p.gmail.toUpperCase().replace("@", " @").replace(" @", "@")), p.alumno, "mayúsculas no importan");
});

test("cada camino: otros mails anotados, la venta del alumno, la llamada, el lead de la persona", { skip: saltear }, async () => {
  // otros mails del alumno (Lili: «Wisboo con uno y Zoom con otro»)
  const a1 = id("alu");
  await sql(`insert into public.alumnos (id, nombre, email) values ($1, 'Uno', $2)`, [a1, `uno${n}@x.com`]);
  await sql(`insert into public.seguimiento_alumnos (id, "alumnoId", "otrosMails") values ($1, $2, $3::jsonb)`, [`seg_${a1}`, a1, JSON.stringify([`Otro${n}@Y.com`])]);
  assert.equal(await quien(`otro${n}@y.com`), a1, "otros mails");

  // la venta del alumno cuelga de la persona
  const c2 = id("con"), a2 = id("alu"), v2 = id("ven");
  await sql(`insert into public.contactos (id, nombre, email) values ($1, 'Dos', $2)`, [c2, `dos${n}@x.com`]);
  await sql(`insert into public.ventas (id, "contactoId") values ($1, $2)`, [v2, c2]);
  await sql(`insert into public.alumnos (id, nombre, email, "ventaId") values ($1, 'Dos', $2, $3)`, [a2, `dos-alumno${n}@x.com`, v2]);
  assert.equal(await quien(`dos${n}@x.com`), a2, "por la venta del alumno");

  // la llamada (sólo la base la puede leer): ningún mail coincide, pero la sesión es de esa persona
  const c3 = id("con"), a3 = id("alu"), s3 = id("cal");
  await sql(`insert into public.contactos (id, nombre, email) values ($1, 'Tres', $2)`, [c3, `tres${n}@x.com`]);
  await sql(`insert into public.sesiones (id, "contactoId") values ($1, $2)`, [s3, c3]);
  await sql(`insert into public.alumnos (id, nombre, email, "leadId") values ($1, 'Tres', $2, $3)`, [a3, `tres-alumno${n}@x.com`, c3]);
  assert.equal(await quien("un-mail-distinto@z.com", s3), a3, "por la llamada");

  // un lead con ese mail, de un contacto con otro mail
  const c4 = id("con"), l4 = id("lea"), a4 = id("alu");
  await sql(`insert into public.contactos (id, nombre, email) values ($1, 'Cuatro', $2)`, [c4, `cuatro${n}@x.com`]);
  await sql(`insert into public.leads (id, email, "contactoId") values ($1, $2, $3)`, [l4, `lead-cuatro${n}@x.com`, c4]);
  await sql(`insert into public.alumnos (id, nombre, email, "leadId") values ($1, 'Cuatro', $2, $3)`, [a4, `cuatro-alumno${n}@x.com`, c4]);
  assert.equal(await quien(`lead-cuatro${n}@x.com`), a4, "por el lead de la persona");
});

test("un mail vacío NO se une a un alumno sin mail, ni un mail de nadie a un alumno cualquiera", { skip: saltear }, async () => {
  await sql(`insert into public.alumnos (id, nombre, email) values ($1, 'Sin mail', '')`, [id("alu")]);
  assert.equal(await quien(""), null, "el conteo viejo unía 3 llamadas sin mail con alumnos sin mail");
  assert.equal(await quien("   "), null);
  assert.equal(await quien("nadie@nunca.com"), null);
});

test("de una persona con dos alumnos, el activo; el vínculo guardado manda si el alumno existe, y si no, se vuelve a buscar", { skip: saltear }, async () => {
  const c = id("con"), baja = id("alu"), activo = id("alu");
  await sql(`insert into public.contactos (id, nombre, email) values ($1, 'Doble', $2)`, [c, `doble${n}@x.com`]);
  await sql(`insert into public.alumnos (id, nombre, email, estado, inicio, "leadId") values ($1, 'Doble', $2, 'baja', now(), $3)`, [baja, `d1-${n}@x.com`, c]);
  await sql(`insert into public.alumnos (id, nombre, email, estado, inicio, "leadId") values ($1, 'Doble', $2, 'activo', now() - interval '1 year', $3)`, [activo, `d2-${n}@x.com`, c]);
  assert.equal(await quien(`doble${n}@x.com`), activo, "el activo aunque sea el más viejo");
  assert.equal(await quien(`doble${n}@x.com`, null, baja), baja, "el vínculo guardado manda");
  assert.equal(await quien(`doble${n}@x.com`, null, "alu_que_ya_no_existe"), activo, "un vínculo a un alumno que ya no existe se vuelve a buscar");
});

test("el disparador guarda alumno y contacto al insertar, los vuelve a buscar si cambia el mail y no pisa un vínculo puesto a mano", { skip: saltear }, async () => {
  const p = await nicolas();
  const r = id("rs");
  await sql(`insert into public.resells (id, "fechaHora", nombre, email) values ($1, now() - interval '5 days', 'Nicolás González', $2)`, [r, p.gmail]);
  let fila = (await sql(`select "alumnoId", "contactoId" from public.resells where id = $1`, [r]))[0];
  assert.equal(fila.alumnoId, p.alumno);
  assert.equal(fila.contactoId, p.contacto, "y la persona, para abrir su ficha aunque no sea alumno");

  const otra = await nicolas();
  await sql(`update public.resells set email = $2 where id = $1`, [r, otra.gmail]);
  fila = (await sql(`select "alumnoId", "contactoId" from public.resells where id = $1`, [r]))[0];
  assert.equal(fila.alumnoId, otra.alumno, "cambió el mail: ya no es la misma persona");
  assert.equal(fila.contactoId, otra.contacto);

  await sql(`update public.resells set "alumnoId" = $2 where id = $1`, [r, p.alumno]);
  fila = (await sql(`select "alumnoId" from public.resells where id = $1`, [r]))[0];
  assert.equal(fila.alumnoId, p.alumno, "un vínculo puesto a mano (sin cambiar el mail) se respeta");
});

test("una llamada sin alumno queda con su persona; y cuando el alumno aparece, se ata sola", { skip: saltear }, async () => {
  const c = id("con"), r = id("rs");
  const mail = `espera${n}@gmail.com`;
  await sql(`insert into public.contactos (id, nombre, email) values ($1, 'Espera', $2)`, [c, mail]);
  await sql(`insert into public.resells (id, "fechaHora", nombre, email) values ($1, now() - interval '2 days', 'Espera', $2)`, [r, mail]);
  let fila = (await sql(`select "alumnoId", "contactoId" from public.resells where id = $1`, [r]))[0];
  assert.equal(fila.alumnoId, null, "todavía no es alumno");
  assert.equal(fila.contactoId, c, "pero su ficha de persona existe: el clic abre esa");

  await sql(`insert into public.alumnos (id, nombre, email, "leadId") values ($1, 'Espera', $2, $3)`, [id("alu"), `espera-hotmail${n}@x.com`, c]);
  fila = (await sql(`select "alumnoId" from public.resells where id = $1`, [r]))[0];
  assert.ok(fila.alumnoId, "el alumno nuevo (con otro mail) ató la llamada que lo esperaba");
});

test("lo que antes no andaba: una llamada de caso de éxito con OTRO mail ahora crea el testimonio del alumno (resell_agenda_a_testimonio)", { skip: saltear }, async () => {
  const p = await nicolas();
  const r = id("rs");
  await sql(`insert into public.resells (id, "fechaHora", nombre, email, closer, "casoDeExito") values ($1, now() + interval '3 days', 'Nicolás González', $2, 'Mariano Arias', true)`, [r, p.gmail]);
  const t = await sql(`select id, "followUp", "conQuien" from public.testimonios where "alumnoId" = $1`, [p.alumno]);
  assert.equal(t.length, 1, "antes quedaba sin testimonio: no encontraba al alumno por el Gmail");
  assert.equal(t[0].followUp, "Llamada agendada");
  assert.equal(t[0].conQuien, "Mariano");
});
