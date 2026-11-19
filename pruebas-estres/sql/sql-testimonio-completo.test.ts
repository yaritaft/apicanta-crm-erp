/* Testimonios completos y recordatorios (supabase/testimonio-completo.sql; Lili, 19/11).

   Con el SQL REAL en un Postgres de verdad (PGlite): las opciones nuevas del resell del testimonio (y que lo ya cargado se pase con respaldo),
   y el botón «Recordar»: a quién le llega (quien grabó y quien lo sigue: el director si grabó un closer, Manu si grabó Yari), qué dice, que sea uno por
   día, que lo mande sólo quien edita Alumnos y que no haya nada para recordar si está completo, no se va a grabar o todavía no pasó.

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
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
  create table public.equipo (id text primary key, nombre text, rol text, email text, activo boolean default true);
  create table public.usuarios_permitidos (email text primary key, nombre text);
  create table public.alumnos (id text primary key, nombre text, email text);
  create table public.testimonios (
    id text primary key, "alumnoId" text not null, "followUp" text default '', "fechaGrabacion" text, "conQuien" text default '',
    resell text default '', "estadoVideo" text default '', link text default '', tecnologias text default '',
    "situacionPrevia" text default '', "situacionActual" text default '', notas text default '', "creadoEn" timestamptz default now()
  );
  create table public.resells (
    id text primary key, "fechaHora" timestamptz not null, nombre text default '', closer text default '', estado text default '', "casoDeExito" boolean not null default false,
    cancelada boolean not null default false, testimonio text default '', "linkTestimonio" text default '', "alumnoId" text, "contactoId" text
  );
  create table public.avisos (id text primary key, para text not null, tipo text not null default 'mencion', titulo text not null, cuerpo text, de text,
    "deEmail" text, "contactoId" text, persona text, "comentarioId" text, "leidoEn" timestamptz, "creadoEn" timestamptz not null default now());
  /* Quién edita Alumnos: la cuenta de Lili (y no la de un closer). */
  create function public.edita(tabla text) returns boolean language sql stable as $$
    select lower(coalesce(auth.jwt() ->> 'email', '')) in ('liliana@apicanta.com') $$;
  /* La función viva que pasa lo del resell al testimonio, con los valores TAL CUAL los tiene hoy (el resto de su cuerpo no importa acá). */
  create function public.resell_testimonio_a_ficha(p_estado text) returns text language sql immutable as $f$
    select case
      when p_estado ~ 'alumno vigente' then 'No corresponde, alumno activo'
      when p_estado ~ '(seguimiento|2da agenda)' then 'Lo piensa'
      when p_estado ~ '(no quiere renovar)' then 'No renueva'
      when p_estado ~ 'renueva' then 'Renueva'
      else null end $f$;
  insert into public.equipo (id, nombre, rol, email) values
    ('eq_yari', 'Yari', 'ceo', 'yari.taft@gmail.com'),
    ('eq_mariano', 'Mariano', 'closer', 'mariano@apicanta.com'),
    ('eq_director', 'Santiago Burghiani', 'director', 'santiago@apicanta.com'),
    ('eq_muexnypwe579r', 'Manuel Pérez', 'otro', 'manuel@apicanta.com'),
    ('eq_noelia', 'Noelia Perelo', 'director', null);
  update public.equipo set activo = false where id = 'eq_noelia';
  insert into public.usuarios_permitidos (email, nombre) values
    ('liliana@apicanta.com', 'Liliana Riveros'), ('yari@apicanta.com', 'Yari Taft'), ('mariano@apicanta.com', 'Mariano Arias');
  insert into public.alumnos (id, nombre, email) values ('a1', 'Mauricio Santos', 'm@x.com'), ('a2', 'Ana Paz', 'a@x.com');
`;

let compartido: Promise<InstanceType<NonNullable<typeof Pg>>> | null = null;
const banco = () => (compartido ??= (async () => {
  const db = new Pg!();
  await db.exec(ESQUEMA);
  await db.exec(`
    insert into public.testimonios (id, "alumnoId", resell) values
      ('t_a', 'a1', 'Outbording'), ('t_b', 'a1', 'No renueva'), ('t_c', 'a1', 'No corresponde, alumno activo'), ('t_d', 'a1', 'Lo piensa'),
      ('t_e', 'a1', 'SI - HACKEAR AI'), ('t_f', 'a1', 'Renueva');`);
  await db.exec(leerSql("supabase/testimonio-completo.sql"));
  await db.exec(leerSql("supabase/resell-recordar.sql")); // reemplaza recordar_testimonio con los mismos destinos
  return db;
})());
after(async () => { if (compartido) await (await compartido).close(); });

const yo = async (email: string) => (await banco()).exec(`select set_config('request.jwt.claims', '${JSON.stringify({ email, role: "authenticated" })}', false)`);
const ayer = (dias: number) => `to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date - ${dias}, 'YYYY-MM-DD')`;
let n = 0;
async function testimonio(campos: Record<string, string | null>): Promise<string> {
  const db = await banco();
  const id = `t${++n}_x`;
  const base: Record<string, string | null> = { id, alumnoId: "a1", followUp: "Llamada agendada", conQuien: "Mariano", resell: "", link: "", situacionPrevia: "", situacionActual: "", ...campos };
  const cols = Object.keys(base).map((c) => `"${c}"`).join(", ");
  const vals = Object.entries(base).map(([k, v]) => (v === null ? "null" : v.startsWith("@") ? v.slice(1) : `'${v.replace(/'/g, "''")}'`)).join(", ");
  await db.exec(`insert into public.testimonios (${cols}) values (${vals})`);
  return id;
}
const recordar = async (id: string) => (await (await banco()).query<{ r: { avisados: string[]; yaHoy: boolean } }>(`select public.recordar_testimonio('${id}') as r`)).rows[0].r;
const avisosDe = async (id: string) => (await (await banco()).query<{ para: string; titulo: string; cuerpo: string; tipo: string; de: string; contactoId: string }>(
  `select para, titulo, cuerpo, tipo, de, "contactoId" from public.avisos where id like 'av_tes_%' and cuerpo is not null and persona = 'Mauricio Santos' order by para`)).rows
  .filter(() => id !== "");

test("las opciones nuevas: lo cargado con los nombres viejos pasa a los nuevos, con respaldo; lo suelto del Airtable no se toca", { skip: saltear }, async () => {
  const db = await banco();
  const r = Object.fromEntries((await db.query<{ id: string; resell: string }>(`select id, resell from public.testimonios where id like 't\\_%' escape '\\' and id in ('t_a','t_b','t_c','t_d','t_e','t_f')`)).rows.map((x) => [x.id, x.resell]));
  assert.deepEqual(r, { t_a: "No renueva / Outbording", t_b: "No renueva / Outbording", t_c: "Alumno activo", t_d: "Seguimiento", t_e: "SI - HACKEAR AI", t_f: "Renueva" });
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from respaldo.testimonios_resell_1911`)).rows[0].n), 4, "los 4 cambiados quedaron respaldados");
  await db.exec(leerSql("supabase/testimonio-completo.sql")); // se puede volver a correr
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from respaldo.testimonios_resell_1911`)).rows[0].n), 4, "y no se respalda dos veces");
  const f = await db.query<{ a: string; b: string; c: string }>(`select public.resell_testimonio_a_ficha('alumno vigente') a, public.resell_testimonio_a_ficha('seguimiento') b, public.resell_testimonio_a_ficha('no quiere renovar') c`);
  assert.deepEqual(f.rows[0], { a: "Alumno activo", b: "Seguimiento", c: "No renueva / Outbording" }, "la función que pasa lo del closer al testimonio usa los nombres nuevos");
});

test("Mauricio Santos: Liliana le recuerda a Mariano y se lo avisa a Santiago, con la fecha y los días", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const id = await testimonio({ fechaGrabacion: `@${ayer(56)}` });
  const r = await recordar(id);
  assert.deepEqual([...r.avisados].sort(), ["Mariano", "Santiago"]);
  assert.equal(r.yaHoy, false);
  const a = (await avisosDe(id)).filter((x) => x.titulo.includes("Mauricio"));
  const mariano = a.find((x) => x.para === "mariano@apicanta.com")!;
  assert.equal(mariano.titulo, "Liliana te recuerda que falta cargar la grabación de testimonio de Mauricio Santos");
  assert.match(mariano.cuerpo, /^Tuviste la reunión el \d{1,2}\/\d{1,2}\. Urgente de completar: ya pasaron 56 días\. Falta el link de la grabación, el resultado del resell, su situación previa y actual\.$/);
  assert.equal(mariano.tipo, "testimonio-pendiente");
  assert.equal(mariano.contactoId, "a1");
  const santi = a.find((x) => x.para === "santiago@apicanta.com")!;
  assert.equal(santi.titulo, "Liliana le recuerda a Mariano que falta cargar el testimonio de Mauricio Santos");
  assert.match(santi.cuerpo, /Ayudá con el seguimiento/);
  assert.ok(!a.some((x) => x.para === "manuel@apicanta.com"), "Manu no, es de un closer");
});

test("si grabó Yari: Yari (sus dos cuentas) y Manu; el director no", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const id = await testimonio({ conQuien: "Yari", fechaGrabacion: `@${ayer(3)}`, link: "https://x.com/v" });
  const r = await recordar(id);
  assert.deepEqual([...r.avisados].sort(), ["Manuel", "Yari"]);
  const para = (await (await banco()).query<{ para: string; cuerpo: string }>(`select para, cuerpo from public.avisos where id like 'av_tes_%' and cuerpo like '%Ya pasaron 3 días%'`)).rows;
  const mails = para.map((x) => x.para);
  assert.ok(mails.includes("yari.taft@gmail.com") && mails.includes("yari@apicanta.com") && mails.includes("manuel@apicanta.com"));
  assert.ok(!mails.includes("santiago@apicanta.com"));
  assert.ok(para.some((x) => /^Tuviste la reunión el \d{1,2}\/\d{1,2}\. Ya pasaron 3 días\. Falta el resultado del resell, su situación previa y actual\.$/.test(x.cuerpo)), "menos de una semana: sin «urgente»");
});

test("un recordatorio por testimonio y por día; sólo lo manda quien edita Alumnos", { skip: saltear }, async () => {
  const db = await banco();
  await yo("liliana@apicanta.com");
  const id = await testimonio({ fechaGrabacion: `@${ayer(10)}` });
  assert.equal((await recordar(id)).yaHoy, false);
  const otra = await recordar(id);
  assert.deepEqual(otra, { avisados: [], yaHoy: true }, "la segunda vez del día no manda otro");
  assert.equal(Number((await db.query<{ n: number }>(`select count(*)::int as n from public.avisos where id like 'av_tes_%'`)).rows[0].n) >= 2, true);

  await yo("mariano@apicanta.com");
  await assert.rejects(() => recordar(id), /Sólo quien edita Alumnos/);
  await yo("liliana@apicanta.com");
});

test("nada para recordar: completo, no se va a grabar, sin fecha, futuro o de antes de septiembre", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const completo = await testimonio({ fechaGrabacion: `@${ayer(5)}`, link: "https://x.com/v", resell: "Alumno activo", situacionPrevia: "a", situacionActual: "b" });
  await assert.rejects(() => recordar(completo), /ya está completo/);
  const noSeGraba = await testimonio({ fechaGrabacion: `@${ayer(5)}`, followUp: "No se graba, porque no se concretó" });
  await assert.rejects(() => recordar(noSeGraba), /no se va a grabar/);
  const sinFecha = await testimonio({ fechaGrabacion: null });
  await assert.rejects(() => recordar(sinFecha), /Todavía no hay una grabación/);
  const futuro = await testimonio({ fechaGrabacion: `@to_char((now() at time zone 'America/Argentina/Buenos_Aires')::date + 3, 'YYYY-MM-DD')` });
  await assert.rejects(() => recordar(futuro), /Todavía no hay una grabación/);
  const viejo = await testimonio({ fechaGrabacion: "2026-08-23" });
  await assert.rejects(() => recordar(viejo), /Todavía no hay una grabación/);
  await assert.rejects(() => recordar("no_existe"), /No encuentro ese testimonio/);
});

test("sin quién grabó: se le avisa al director, y a quien lo manda nunca", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const id = await testimonio({ conQuien: "", fechaGrabacion: `@${ayer(8)}`, link: "https://x.com/v" });
  const r = await recordar(id);
  assert.deepEqual(r.avisados, ["Santiago"]);
});

/* ---------- Resells (supabase/resell-recordar.sql): «botón recordar: el closer y Santi» ---------- */

const haceDias = (d: number) => `(now() - interval '${d} days')`;
async function resell(campos: Record<string, string | null>): Promise<string> {
  const db = await banco();
  const id = `rs${++n}_x`;
  const base: Record<string, string | null> = { id, fechaHora: `@${haceDias(9)}`, nombre: "Nicolás González", closer: "Mariano", estado: "", alumnoId: "a1", ...campos };
  const cols = Object.keys(base).map((c) => `"${c}"`).join(", ");
  const vals = Object.entries(base).map(([k, v]) => (v === null ? "null" : v.startsWith("@") ? v.slice(1) : `'${v.replace(/'/g, "''")}'`)).join(", ");
  await db.exec(`insert into public.resells (${cols}) values (${vals})`);
  return id;
}
const recordarResell = async (id: string) => (await (await banco()).query<{ r: { avisados: string[]; yaHoy: boolean } }>(`select public.recordar_resell('${id}') as r`)).rows[0].r;

test("resell: Liliana le recuerda a Mariano y se lo avisa a Santiago, con la fecha, los días y lo que falta", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const id = await resell({ estado: "2da Agenda, Seguimiento" });
  const r = await recordarResell(id);
  assert.deepEqual([...r.avisados].sort(), ["Mariano", "Santiago"]);
  const a = (await (await banco()).query<{ para: string; titulo: string; cuerpo: string; tipo: string; contactoId: string }>(
    `select para, titulo, cuerpo, tipo, "contactoId" from public.avisos where id like 'av_res_%' and persona = 'Nicolás González' order by para`)).rows;
  const mariano = a.find((x) => x.para === "mariano@apicanta.com")!;
  assert.equal(mariano.titulo, "Liliana te recuerda que falta cargar cómo salió la llamada de resell de Nicolás González");
  assert.match(mariano.cuerpo, /^La llamada fue el \d{1,2}\/\d{1,2}\. Urgente de completar: ya pasaron 9 días\. Falta: en qué terminó el resell \(está en «2da Agenda, Seguimiento»\)\.$/);
  assert.equal(mariano.tipo, "resell-pendiente");
  assert.equal(mariano.contactoId, "a1");
  const santi = a.find((x) => x.para === "santiago@apicanta.com")!;
  assert.equal(santi.titulo, "Liliana le recuerda a Mariano que falta cargar la llamada de resell de Nicolás González");
  assert.match(santi.cuerpo, /Ayudá con el seguimiento/);
});

test("resell tomado por Yari: Yari y Manu; con testimonio, también pide si grabó y el link", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const id = await resell({ closer: "Yari Taft", nombre: "Ana Paz", casoDeExito: "true", testimonio: "Grabó" });
  const r = await recordarResell(id);
  assert.deepEqual([...r.avisados].sort(), ["Manuel", "Yari"]);
  const c = (await (await banco()).query<{ para: string; cuerpo: string }>(`select para, cuerpo from public.avisos where id like 'av_res_%' and persona = 'Ana Paz'`)).rows;
  assert.ok(c.every((x) => /Falta: el link de la grabación, si compró \(el resell\)\./.test(x.cuerpo)));
  assert.ok(!c.some((x) => x.para === "santiago@apicanta.com"));
});

test("resell: uno por día, sólo quien edita Alumnos, y nada para recordar si está resuelta, cancelada, futura o se reagenda", { skip: saltear }, async () => {
  await yo("liliana@apicanta.com");
  const id = await resell({});
  assert.equal((await recordarResell(id)).yaHoy, false);
  assert.deepEqual(await recordarResell(id), { avisados: [], yaHoy: true });
  await yo("mariano@apicanta.com");
  await assert.rejects(() => recordarResell(id), /Sólo quien edita Alumnos/);
  await yo("liliana@apicanta.com");
  for (const estado of ["Upgrade a Hackear IA", "No quiere renovar, Outbording", "Alumno vigente", "Garantía Extendida", "Renueva"]) {
    const resuelta = await resell({ estado });
    await assert.rejects(() => recordarResell(resuelta), /ya está completa/, estado);
  }
  await assert.rejects(async () => recordarResell(await resell({ cancelada: "true" })), /se canceló/);
  await assert.rejects(async () => recordarResell(await resell({ fechaHora: "@now() + interval '2 days'" })), /todavía no pasó/);
  await assert.rejects(async () => recordarResell(await resell({ testimonio: "Se reagenda" })), /Se reagenda/);
  await assert.rejects(() => recordarResell("no_existe"), /No encuentro esa llamada/);
});
