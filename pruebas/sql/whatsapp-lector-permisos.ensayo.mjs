/* Ensayo del SQL de permisos de WhatsApp (supabase/whatsapp-lector-permisos.sql) en un Postgres de verdad, en
   memoria, con las políticas REALES: tipos-cuenta.sql entero, después whatsapp-lector.sql y whatsapp-lector-qr.sql
   (dos veces cada uno) y, encima, el SQL nuevo —tres veces: tiene que ser idempotente—. Se prueba:
   - que cada tipo de cuenta que NO es «sólo lo suyo» ve exactamente lo mismo que antes del SQL nuevo;
   - que «sólo lo suyo» con Webinars en «ver» ya no lee los teléfonos de los grupos;
   - que el código QR sale sólo para quien edita Ajustes y sólo si tiene menos de 60 segundos, y que anon no ejecuta
     la función ni lee la tabla.

   No es parte de `npm test`: necesita PGlite (Postgres en WASM), que no es una dependencia del proyecto.
     PGLITE_DIR=/ruta/a/node_modules/@electric-sql/pglite node pruebas/sql/whatsapp-lector-permisos.ensayo.mjs
   Sale con código 1 si algo falla. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const aqui = (ruta) => new URL(`../../${ruta}`, import.meta.url);
const dir = process.env.PGLITE_DIR;
const { PGlite } = dir ? await import(pathToFileURL(`${dir}/dist/index.js`).href) : await import("@electric-sql/pglite");
const sql = (nombre) => readFileSync(aqui(`supabase/${nombre}`), "utf8");

const db = new PGlite();
await db.exec(`
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create role anon;
  create role authenticated;
  create role service_role bypassrls;
  -- Lo que Supabase da por defecto a todo lo que se crea en public (los SQL de WhatsApp después recortan lo suyo).
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create table public.usuarios_permitidos (email text primary key, nombre text, rol text not null default 'equipo', "creadoEn" timestamptz default now());
  create table public.equipo (id text primary key, nombre text, email text, activo boolean default true);
  create table public.webinars (id text primary key);
  create table public.ventas (id text primary key, "closerId" text, "setterId" text, "contactoId" text);
  create table public.cuotas (id text primary key, "ventaId" text, "closerId" text);
  create table public.pagos (id text primary key, "cuotaId" text, monto numeric not null default 0, fecha text, comprobante jsonb, "comprobanteLink" text, "movimientoId" text, chequeado boolean);
  create table public.sesiones (id text primary key, anfitrion text, "leadId" text, "contactoId" text);
  create table public.leads (id text primary key, responsable text, "contactoId" text);
  create table public.contactos (id text primary key);
  create table public.comentarios (id text primary key, "contactoId" text);
  create table public.alumnos (id text primary key, "ventaId" text);
  create table public.gastos (id text primary key, "webinarId" text);
  create table public.actividad (id text primary key, entidad text, "entidadId" text);
  create function public.es_dueno() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')) and rol = 'dueno') $$;
  create function public.puede_entrar() returns boolean language sql stable security definer as $$
    select exists (select 1 from public.usuarios_permitidos where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))) $$;
`);
await db.exec(sql("tipos-cuenta.sql"));
await db.exec(sql("whatsapp-lector.sql"));
await db.exec(sql("whatsapp-lector.sql"));
await db.exec(sql("whatsapp-lector-qr.sql"));
await db.exec(sql("whatsapp-lector-qr.sql"));
await db.exec(`
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.jwt() to anon, authenticated, service_role;
  insert into public.tipos_cuenta (id, nombre, areas, "soloLoSuyo") values
    ('solo_ajustes', 'Sólo Ajustes', '{"ajustes":"editar"}', false),
    ('ajustes_ver', 'Ajustes en ver', '{"ajustes":"ver","webinars":"ver"}', false),
    ('suyo_con_webinars', 'Lo suyo con Webinars', '{"crm":"editar","ventas":"editar","webinars":"ver"}', true),
    ('suyo_con_ajustes', 'Lo suyo con Ajustes', '{"crm":"editar","ajustes":"editar"}', true);
  insert into public.usuarios_permitidos (email, rol) values
    ('yari@x.com', 'dueno'), ('santi@x.com', 'director'), ('dante@x.com', 'closer'), ('aldana@x.com', 'admin'),
    ('mar@x.com', 'marketing'), ('nico@x.com', 'solo_ajustes'), ('vera@x.com', 'ajustes_ver'),
    ('suyo@x.com', 'suyo_con_webinars'), ('suyoaj@x.com', 'suyo_con_ajustes');
  insert into public.webinars (id) values ('w1');
  insert into public.whatsapp_lector (id, estado, conectado) values (1, 'esperando_qr', false);
  insert into public.whatsapp_grupos (id, nombre, "webinarId", miembros) values ('g1@g.us', 'Grupo 1', 'w1', 2);
  insert into public.whatsapp_miembros ("grupoId", telefono) values ('g1@g.us', '5491100000001'), ('g1@g.us', '5491100000002');
  insert into public.whatsapp_qr (id, qr, en) values (1, 'data:image/svg+xml;base64,AAAA', now());
`);
/* PGlite corre como superusuario: `reset role` + `set role` para ver lo que ve cada rol. */
const como = async (email, rol = "authenticated") => {
  await db.exec(`reset role`);
  await db.exec(`select set_config('request.jwt.claims', '${email ? JSON.stringify({ email, role: rol }) : ""}', false)`);
  await db.exec(`set role ${rol}`);
};
const intentar = async (consulta) => { try { return (await db.query(consulta)).rows; } catch (e) { return `ERROR: ${e.message}`; } };
const foto = async (email) => {
  await como(email);
  const f = await intentar(`select (select count(*)::int from public.whatsapp_lector) lector, (select count(*)::int from public.whatsapp_grupos) grupos, (select count(*)::int from public.whatsapp_miembros) miembros, public.nivel_area('webinars') web, public.nivel_area('ajustes') aj`);
  return JSON.stringify(f);
};
const USUARIOS = ["yari@x.com", "santi@x.com", "dante@x.com", "aldana@x.com", "mar@x.com", "nico@x.com", "vera@x.com", "suyo@x.com", "suyoaj@x.com"];
const antes = {};
for (const u of USUARIOS) antes[u] = await foto(u);

const nuevo = sql("whatsapp-lector-permisos.sql");
await db.exec(`reset role`);
/* Lo que deja el SQL: las políticas y la función con sus permisos. Correrlo de nuevo no tiene que cambiar nada. */
const huella = async () => JSON.stringify([
  (await db.query(`select tablename, policyname, cmd, roles::text, qual from pg_policies where schemaname = 'public' and tablename like 'whatsapp%' order by 1, 2`)).rows,
  (await db.query(`select proname, prosrc, prosecdef, proacl::text from pg_proc where proname = 'whatsapp_qr_vigente'`)).rows,
]);
await db.exec(nuevo);
const trasLaPrimera = await huella();
await db.exec(nuevo);
await db.exec(nuevo);
console.log("el SQL nuevo corrió tres veces seguidas sin error");
if ((await huella()) !== trasLaPrimera) { console.log("  FALLA: correrlo de nuevo cambió algo"); process.exit(1); }
console.log("  ok: la segunda y la tercera corrida no cambian nada");

let fallas = 0;
const es = (cond, texto) => { if (!cond) { fallas++; console.log("  FALLA:", texto); } else console.log("  ok:", texto); };
const soloLoSuyo = new Set(["dante@x.com", "suyo@x.com", "suyoaj@x.com"]);

console.log("quien NO es «sólo lo suyo» ve lo mismo que antes:");
for (const u of USUARIOS.filter((x) => !soloLoSuyo.has(x))) es((await foto(u)) === antes[u], `${u} ${antes[u]}`);

console.log("«sólo lo suyo»:");
for (const u of ["suyo@x.com", "dante@x.com", "suyoaj@x.com"]) {
  const d = JSON.parse(await foto(u))[0];
  es(d.lector === 0 && d.grupos === 0 && d.miembros === 0, `${u} no ve el lector, ni los grupos, ni los teléfonos`);
}
es(JSON.parse(antes["suyo@x.com"])[0].miembros === 2, "(antes del SQL nuevo, con Webinars en «ver», sí los leía: el hallazgo era real)");

console.log("el código QR:");
const qr = async (email) => { await como(email); return (await intentar(`select public.whatsapp_qr_vigente() as qr`)); };
es((await qr("yari@x.com"))[0].qr?.startsWith("data:image"), "el dueño recibe el código");
es((await qr("nico@x.com"))[0].qr?.startsWith("data:image"), "quien sólo edita Ajustes (sin Webinars) lo recibe");
es((await qr("suyoaj@x.com"))[0].qr?.startsWith("data:image"), "quien edita Ajustes recibe el código aunque vea sólo lo suyo (la credencial es de Ajustes)");
for (const u of ["santi@x.com", "mar@x.com", "aldana@x.com", "dante@x.com", "vera@x.com", "suyo@x.com"]) es((await qr(u))[0].qr === null, `${u} (sin editar Ajustes) recibe null`);
await como("desconocido@x.com");
es((await intentar(`select public.whatsapp_qr_vigente() as qr`))[0].qr === null, "una sesión que no es del equipo recibe null");
await como(null, "anon");
es(String(await intentar(`select public.whatsapp_qr_vigente() as qr`)).startsWith("ERROR"), "anon no puede ejecutar la función");
es(String(await intentar(`select * from public.whatsapp_qr`)).startsWith("ERROR"), "anon no lee la tabla del código");
await como("yari@x.com");
es(String(await intentar(`select * from public.whatsapp_qr`)).startsWith("ERROR"), "ni el dueño lee la tabla del código directo (sólo por la función)");
await db.exec(`reset role`);
await db.exec(`update public.whatsapp_qr set en = now() - interval '61 seconds'`);
es((await qr("yari@x.com"))[0].qr === null, "pasado el minuto el código no sale, ni para el dueño");
await db.exec(`reset role`);
await db.exec(`update public.whatsapp_qr set en = now() - interval '59 seconds'`);
es((await qr("yari@x.com"))[0].qr?.startsWith("data:image"), "a los 59 segundos todavía sale");

console.log(fallas ? `\n${fallas} FALLAS` : "\nTodo bien");
process.exit(fallas ? 1 : 0);
