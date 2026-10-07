/* Ensayo del SQL del control cruzado (supabase/control-cruzado.sql) en un Postgres de verdad, en memoria,
   con las políticas de RLS REALES: se corre supabase/tipos-cuenta.sql entero (sobre las tablas mínimas que
   pide), después el SQL del control —dos veces: tiene que ser idempotente— y se prueba como closer, director
   comercial, administración, dueño y sin sesión (la clave de servicio).

   No es parte de `npm test`: necesita PGlite (Postgres en WASM), que no es una dependencia del proyecto.
     PGLITE_DIR=/ruta/a/node_modules/@electric-sql/pglite node pruebas/sql/control-cruzado.ensayo.mjs
   (o, con `@electric-sql/pglite` instalado a mano, sin la variable). Sale con código 1 si algo falla.

   Es el ensayo que pide el flujo de publicación para todo lo que toca permisos: antes de correr el SQL de
   verdad en Supabase, el mismo comportamiento en un lugar donde equivocarse no cuesta nada. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const aqui = (ruta) => new URL(`../../${ruta}`, import.meta.url);
const dir = process.env.PGLITE_DIR;
const { PGlite } = dir ? await import(pathToFileURL(`${dir}/dist/index.js`).href) : await import("@electric-sql/pglite");
const tipos = readFileSync(aqui("supabase/tipos-cuenta.sql"), "utf8");
const control = readFileSync(aqui("supabase/control-cruzado.sql"), "utf8");
const frenos = readFileSync(aqui("supabase/solo-lo-suyo-seguro.sql"), "utf8");

const db = new PGlite();
await db.exec(`
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create role authenticated;
  create table public.usuarios_permitidos (email text primary key, nombre text, rol text not null default 'equipo', "creadoEn" timestamptz default now());
  create table public.equipo (id text primary key, nombre text, email text, activo boolean default true);
  create table public.ventas (id text primary key, "closerId" text, "setterId" text, "contactoId" text, "sesionId" text);
  create table public.cuotas (id text primary key, "ventaId" text, "closerId" text);
  create table public.pagos (
    id text primary key, "cuotaId" text, monto numeric not null default 0, moneda text default 'USD', fecha text, "montoArs" numeric,
    comprobante jsonb, "comprobanteLink" text, "movimientoId" text, chequeado boolean, notas text
  );
  create table public.sesiones (id text primary key, anfitrion text, "leadId" text, "contactoId" text);
  create table public.leads (id text primary key, responsable text, "contactoId" text);
  create table public.contactos (id text primary key);
  create table public.comentarios (id text primary key, "contactoId" text);
  create table public.alumnos (id text primary key, "ventaId" text);
  create table public.gastos (id text primary key, "webinarId" text);
  create table public.actividad (id text primary key, entidad text, "entidadId" text);
  -- lo que traen otros SQL del proyecto (honorarios.sql y la base) y tipos-cuenta.sql da por existente
  create function public.es_dueno() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and rol = 'dueno') $$;
  create function public.puede_entrar() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
`);
await db.exec(tipos);
await db.exec(`
  grant usage on schema public, auth to authenticated;
  grant select, insert, update, delete on all tables in schema public to authenticated;
  grant execute on all functions in schema public to authenticated;
  grant execute on function auth.jwt() to authenticated;
  insert into public.equipo (id, nombre, email) values ('m_dante', 'Dante', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com');
  insert into public.usuarios_permitidos (email, rol) values
    ('yari@x.com', 'dueno'), ('santi@x.com', 'director'), ('dante@x.com', 'closer'), ('aldana@x.com', 'admin'), ('seti@x.com', 'setter');
  insert into public.ventas (id, "closerId") values ('v1', 'm_dante'), ('v2', 'm_otro');
  insert into public.cuotas (id, "ventaId") values ('c1', 'v1'), ('c2', 'v2');
  insert into public.pagos (id, "cuotaId", monto, chequeado, comprobante) values ('p1', 'c1', 100, null, '{"ruta":"a"}'), ('p2', 'c2', 200, null, '{"ruta":"b"}');
`);
await db.exec(control);
await db.exec(control);
await db.exec(frenos);
console.log("tipos-cuenta.sql y, encima, control-cruzado.sql (dos veces) y solo-lo-suyo-seguro.sql: corrieron sin error");

const como = async (email) => {
  await db.exec(`reset role`);
  if (email) {
    await db.exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email, role: "authenticated" })}', false)`);
    await db.exec(`set role authenticated`);
  } else await db.exec(`select set_config('request.jwt.claims', '', false)`);
};
let fallas = 0;
const es = (cond, texto) => { if (!cond) { fallas++; console.log("  FALLA:", texto); } else console.log("  ok:", texto); };
const fila = async (id) => { await como(null); return (await db.query(`select * from public.pagos where id = $1`, [id])).rows[0]; };
const ids = async () => (await db.query(`select id from public.pagos order by id`)).rows.map((r) => r.id).join();

console.log("el closer, con el RLS de verdad:");
await como("dante@x.com");
es((await ids()) === "p1", "ve sólo su cobro, no el de otro closer");
await db.exec(`update public.pagos set monto = 101 where id = 'p1'`);
es((await fila("p1")).monto == 101, "puede editar su cobro");
await como("dante@x.com");
await db.exec(`update public.pagos set "chequeoDirector" = 'chequeado', "chequeoFinanzas" = 'chequeado', chequeado = true where id = 'p1'`);
let p = await fila("p1");
es(p.chequeoDirector === null && p.chequeoFinanzas === null && p.chequeado === null, "no puede chequearse el cobro, ni con el sí/no de antes (y no da error)");
await como("dante@x.com");
await db.exec(`update public.pagos set monto = 999 where id = 'p2'`);
es((await fila("p2")).monto == 200, "no puede tocar el cobro de otro closer");
await como("dante@x.com");
await db.exec(`insert into public.pagos (id, "cuotaId", monto, chequeado, "chequeoDirector") values ('p3', 'c1', 50, true, 'chequeado')`);
p = await fila("p3");
es(p.cargadoPor === "dante@x.com" && p.chequeado === null && p.chequeoDirector === null, "carga un cobro nuevo: queda a su nombre y pendiente, aunque mande el tilde");
await como("dante@x.com");
await db.exec(`insert into public.pagos (id, "cuotaId", monto, chequeado, "movimientoId") values ('p4', 'c1', 60, true, 'mov-inventado')`);
p = await fila("p4");
es(p.chequeado === null && p.movimientoId === null, "con un movimiento inventado no queda «atado a la pasarela» ni chequeado: el closer no ata cobros");
await como(null);
await db.exec(`insert into public.pagos (id, "cuotaId", monto, chequeado, "movimientoId") values ('p6', 'c1', 60, true, 'mov1')`);
await como("dante@x.com");
await db.exec(`update public.pagos set "movimientoId" = null, notas = 'lo desato' where id = 'p6'`);
p = await fila("p6");
es(p.chequeado === true && p.movimientoId === "mov1" && p.notas === "lo desato", "un cobro atado a la pasarela por la conciliación conserva su marca y su atadura: el closer no lo desata");
await como("dante@x.com");
await db.exec(`update public.pagos set "movimientoId" = 'mov-inventado', monto = 5000 where id = 'p6'`);
p = await fila("p6");
es(p.movimientoId === "mov1", "ni lo cambia a otro movimiento");
await como("dante@x.com");
await db.exec(`update public.pagos set comprobante = '{"ruta":"nuevo"}' where id = 'p3'`);
es((await fila("p3")).comprobante?.ruta === "nuevo", "puede subir el comprobante de su cobro");

console.log("el director comercial:");
await como("santi@x.com");
es((await db.query(`select count(*)::int n from public.pagos`)).rows[0].n === 5, "ve los cobros de todos los closers");
await db.exec(`update public.pagos set "chequeoDirector" = 'chequeado', "chequeoDirectorPor" = 'otro@falso.com', "chequeoDirectorEn" = '2000-01-01' where id = 'p2'`);
p = await fila("p2");
es(p.chequeoDirector === "chequeado" && p.chequeoDirectorPor === "santi@x.com" && new Date(p.chequeoDirectorEn).getFullYear() >= 2026, "chequea el de otro closer, con su nombre y su hora (no se pueden falsificar)");
await como("santi@x.com");
await db.exec(`update public.pagos set "chequeoFinanzas" = 'chequeado' where id = 'p2'`);
es((await fila("p2")).chequeoFinanzas === null, "no puede llenar el casillero de finanzas");

console.log("administración (finanzas):");
await como("aldana@x.com");
await db.exec(`update public.pagos set "chequeoFinanzas" = 'rechazado', "chequeoFinanzasNota" = 'no se lee' where id = 'p2'`);
p = await fila("p2");
es(p.chequeoFinanzas === "rechazado" && p.chequeoFinanzasPor === "aldana@x.com" && p.chequeoFinanzasNota === "no se lee", "rechaza con motivo, a su nombre");
es(p.chequeoDirector === "chequeado" && p.chequeoDirectorPor === "santi@x.com", "lo que dijo el director sigue");
await como("aldana@x.com");
await db.exec(`update public.pagos set notas = 'una nota' where id = 'p2'`);
p = await fila("p2");
es(p.notas === "una nota" && p.chequeoDirectorPor === "santi@x.com" && p.chequeoDirector === "chequeado", "editar otra cosa del cobro (las notas) no toca quién ni cuándo");
await como("aldana@x.com");
await db.exec(`update public.pagos set monto = 201 where id = 'p2'`);
p = await fila("p2");
es(p.monto == 201 && p.chequeoDirector === null && p.chequeoFinanzas === null, "cambiar el monto del cobro reinicia los dos chequeos (se chequeó contra el de antes)");
await como("aldana@x.com");
await db.exec(`update public.pagos set "chequeoFinanzas" = 'rechazado', "chequeoFinanzasNota" = 'otro monto' where id = 'p2'`);
await como("aldana@x.com");
await db.exec(`update public.pagos set "chequeoFinanzas" = null where id = 'p2'`);
p = await fila("p2");
es(p.chequeoFinanzas === null && p.chequeoFinanzasPor === null && p.chequeoFinanzasEn === null && p.chequeoFinanzasNota === null, "quitar lo que dijo deja el casillero en blanco, con su quién, cuándo y motivo");

console.log("cambiar el comprobante:");
await como("dante@x.com");
await db.exec(`update public.pagos set comprobante = '{"ruta":"a"}', monto = 102 where id = 'p1'`);
await como("santi@x.com");
await db.exec(`update public.pagos set "chequeoDirector" = 'chequeado' where id = 'p1'`);
await como("dante@x.com");
await db.exec(`update public.pagos set comprobante = '{"ruta":"a"}', notas = 'mismo archivo' where id = 'p1'`);
es((await fila("p1")).chequeoDirector === "chequeado", "el mismo archivo (y otra nota) no reinicia el chequeo");
await como("dante@x.com");
await db.exec(`update public.pagos set monto = 103 where id = 'p1'`);
es((await fila("p1")).chequeoDirector === null, "cambiar el monto sí lo reinicia");
await como("santi@x.com");
await db.exec(`update public.pagos set "chequeoDirector" = 'chequeado' where id = 'p1'`);
await como("dante@x.com");
await db.exec(`update public.pagos set comprobante = '{"ruta":"otro"}' where id = 'p1'`);
p = await fila("p1");
es(p.chequeoDirector === null && p.chequeoDirectorPor === null, "otro archivo: el chequeo vuelve a pendiente");

console.log("el sí/no de antes (cobros de la planilla, con un link):");
await como(null);
await db.exec(`insert into public.pagos (id, "cuotaId", monto, chequeado, "comprobanteLink") values ('p5', 'c1', 10, true, 'https://drive/x')`);
await como("dante@x.com");
await db.exec(`update public.pagos set comprobante = '{"ruta":"z"}' where id = 'p5'`);
es((await fila("p5")).chequeado === true, "agregar un archivo a un cobro que sólo traía el link no lo reinicia");
await como("dante@x.com");
await db.exec(`update public.pagos set "comprobanteLink" = 'https://drive/otro' where id = 'p5'`);
es((await fila("p5")).chequeado === null, "pero cambiar el link de la planilla sí");

console.log("el dueño, el setter y la clave de servicio:");
await como("yari@x.com");
await db.exec(`update public.pagos set "chequeoDirector" = 'chequeado', "chequeoFinanzas" = 'chequeado' where id = 'p2'`);
p = await fila("p2");
es(p.chequeoDirector === "chequeado" && p.chequeoFinanzas === "chequeado" && p.chequeoFinanzasPor === "yari@x.com", "el dueño llena los dos casilleros");
await como("seti@x.com");
await db.exec(`update public.pagos set "chequeoDirector" = null, "chequeoFinanzas" = null where id = 'p2'`);
p = await fila("p2");
es(p.chequeoDirector === "chequeado" && p.chequeoFinanzas === "chequeado", "el setter no puede borrar los chequeos");
await como(null);
await db.exec(`update public.pagos set "chequeoDirector" = 'rechazado', "chequeoDirectorPor" = 'servidor' where id = 'p2'`);
p = await fila("p2");
es(p.chequeoDirector === "rechazado" && p.chequeoDirectorPor === "servidor", "sin sesión de una persona (clave de servicio, editor SQL) pasa tal cual");
let rechazo = false;
try { await db.exec(`update public.pagos set "chequeoDirector" = 'ok' where id = 'p2'`); } catch { rechazo = true; }
es(rechazo, "la base no acepta otro valor que chequeado o rechazado");

await como(null);
console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien");
process.exit(fallas ? 1 : 0);
