import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Liliana, 13/11, supabase/avisos-de-ventas.sql: «ayer hubo nuevos ingresos y la app no me notificó; necesito una notificación por cada
   nueva venta que se cargue, incluyendo las reservas». La campanita sólo recibía avisos de otros procesos (el roadmap de un contrato
   firmado): una venta, y sobre todo una reserva, no avisaba a nadie. Ahora la base escribe el aviso al insertarse la venta. */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(`
    alter table public.equipo add column puesto text;
    alter table public.ventas add column "contactoNombre" text, add column "productoId" text, add column fecha timestamptz default now();
    alter table public.alumnos add column nombre text, add column "leadId" text;
    create table public.productos (id text primary key, nombre text);
    create table public.avisos (id text primary key, para text not null, tipo text not null default 'mencion', titulo text not null, cuerpo text, de text,
      "deEmail" text, "contactoId" text, persona text, "comentarioId" text, "leidoEn" timestamptz, "creadoEn" timestamptz not null default now());
    create table public.seguimiento_alumnos (id text primary key, "alumnoId" text not null unique, "cadenciaDias" int not null default 15, "ultimoContacto" text, "proximoContacto" text);
    create function public.mails_de_servicio() returns setof text language sql stable security definer set search_path = public as $$
      select distinct lower(btrim(q.email)) from public.equipo q
      where q.activo and btrim(coalesce(q.email, '')) like '%@%' and (q.puesto ilike '%customer success%' or q.puesto ilike '%servicio%' or q.puesto ilike '%csm%') $$;
    insert into public.equipo (id, nombre, email, activo, puesto) values
      ('eq_lili', 'Liliana Riveros', ' Liliana@Apicanta.com ', true, 'Customer Success Manager'),
      ('eq_ex', 'Ex Servicio', 'ex@apicanta.com', false, 'Customer Success Manager'),
      ('eq_mariano', 'Mariano Arias', 'mariano@apicanta.com', true, 'Closer');
    insert into public.productos (id, nombre) values ('prod_ia', 'Hackear IA MID'), ('prod_down', 'Downsell');
    insert into public.seguimiento_alumnos (id, "alumnoId", "cadenciaDias", "ultimoContacto", "proximoContacto") values
      ('s1', 'a1', 15, '2026-11-01', '2026-11-16'),   -- «Lo contacté» con cadencia 15: pasa a +20
      ('s2', 'a2', 15, '2026-11-01', '2026-11-05'),   -- un reintento («no contestó»): la fecha no se toca
      ('s3', 'a3', 7, '2026-11-01', '2026-11-08'),    -- otra cadencia: no se toca
      ('s4', 'a4', 15, null, null);
  `);
  await db.exec(sqlDe("avisos-de-ventas.sql"));
  await db.exec(sqlDe("avisos-de-ventas.sql")); // se puede volver a correr
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

const avisos = (b: Banco) => b.servicio<{ id: string; para: string; tipo: string; titulo: string; cuerpo: string; contactoId: string | null; persona: string | null }>(
  `select id, para, tipo, titulo, cuerpo, "contactoId", persona from public.avisos order by "creadoEn", id`);

test("cada venta nueva le avisa a Customer Success, también una reserva (sin contrato, que era lo único que avisaba)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.ventas (id, "contactoId", "contactoNombre", "productoId", "closerId", estado, fecha) values
    ('v_res', 'lead_res', 'Ana Reserva', 'prod_down', 'eq_mariano', 'activa', now()),
    ('v_ia', 'lead_ia', 'Beto Completo', 'prod_ia', 'eq_mariano', 'activa', now())`);
  const a = await avisos(b);
  assert.equal(a.length, 2, "uno por venta (y por persona de Servicio: una sola activa)");
  assert.deepEqual([...new Set(a.map((x) => x.para))], ["liliana@apicanta.com"], "al mail de Equipo, en minúsculas y sin espacios; la inactiva no recibe");
  assert.ok(a.every((x) => x.tipo === "venta-nueva"));
  const ana = a.find((x) => x.persona === "Ana Reserva")!;
  assert.equal(ana.titulo, "Nueva venta: Ana Reserva");
  assert.equal(ana.contactoId, "lead_res", "al tocarlo se abre su ficha");
  assert.match(ana.cuerpo, /Downsell · la cargó Mariano Arias\./);
  assert.match(ana.cuerpo, /bienvenida por WhatsApp \(también si es una reserva\)/);
});

test("una compra de alguien que ya es alumno dice que es una compra más; la del alumno que Lili dio de alta antes, que la venta se unió", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.alumnos (id, nombre, "leadId", "ventaId") values
    ('alu_viejo', 'Carlos Viejo', 'lead_viejo', 'v_primera'),
    ('alu_lili', 'Diana Dada De Alta', 'lead_lili', null),
    ('alu_mismo', 'Eva Misma Venta', 'lead_eva', 'v_eva')`);
  await b.ejecutar(`insert into public.ventas (id, "contactoId", "contactoNombre", "productoId", estado) values
    ('v_up', 'lead_viejo', 'Carlos Viejo', 'prod_ia', 'activa'),
    ('v_lili', 'lead_lili', 'Diana Dada De Alta', 'prod_ia', 'activa'),
    ('v_eva', 'lead_eva', 'Eva Misma Venta', 'prod_ia', 'activa')`);
  const t = Object.fromEntries((await avisos(b)).map((x) => [x.persona, x]));
  assert.equal(t["Carlos Viejo"].titulo, "Nueva compra de Carlos Viejo");
  assert.match(t["Carlos Viejo"].cuerpo, /Ya es alumno/);
  assert.equal(t["Diana Dada De Alta"].titulo, "Cargaron la venta de Diana Dada De Alta");
  assert.match(t["Diana Dada De Alta"].cuerpo, /Ya lo tenías dado de alta/);
  /* El alumno que la propia app creó con esa venta (alumnos se escribe antes que ventas) es un ingreso nuevo, no una compra más. */
  assert.equal(t["Eva Misma Venta"].titulo, "Nueva venta: Eva Misma Venta");
});

test("no avisa de ventas que no están activas ni de planillas viejas, y nunca frena la venta", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.ventas (id, "contactoNombre", estado, fecha) values
    ('v_baja', 'De Baja', 'baja', now()),
    ('v_vieja', 'Planilla Vieja', 'activa', now() - interval '40 days'),
    ('v_ok', 'Venta De Hoy', 'activa', now())`);
  assert.deepEqual((await avisos(b)).map((x) => x.persona), ["Venta De Hoy"]);
  /* Aunque el aviso falle (acá, sin tabla de avisos), la venta queda guardada. */
  await b.ejecutar(`alter table public.avisos rename to avisos_x`);
  await b.ejecutar(`insert into public.ventas (id, "contactoNombre", estado) values ('v_sin_avisos', 'Igual Se Guarda', 'activa')`);
  assert.equal((await b.servicio<{ n: number }>(`select count(*)::int n from public.ventas where id = 'v_sin_avisos'`))[0].n, 1);
});

test("un aviso por venta y por persona: repetir no duplica", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.ventas (id, "contactoNombre", estado) values ('v1', 'Una Sola', 'activa')`);
  await b.ejecutar(`delete from public.ventas where id = 'v1'`);
  await b.ejecutar(`insert into public.ventas (id, "contactoNombre", estado) values ('v1', 'Una Sola', 'activa')`);
  assert.equal((await avisos(b)).length, 1);
});

test("el seguimiento pasa de 15 a 20 días con respaldo; un reintento u otra cadencia no se tocan", { skip: saltear }, async () => {
  const b = await banco();
  const s = Object.fromEntries((await b.servicio<{ alumnoId: string; cadenciaDias: number; proximoContacto: string | null }>(
    `select "alumnoId", "cadenciaDias", "proximoContacto" from public.seguimiento_alumnos`)).map((x) => [x.alumnoId, x]));
  assert.deepEqual([s.a1.cadenciaDias, s.a1.proximoContacto], [20, "2026-11-21"], "«último contacto + 15» pasa a +20");
  assert.deepEqual([s.a2.cadenciaDias, s.a2.proximoContacto], [20, "2026-11-05"], "el reintento conserva su fecha");
  assert.deepEqual([s.a3.cadenciaDias, s.a3.proximoContacto], [7, "2026-11-08"]);
  assert.equal(s.a4.cadenciaDias, 20);
  const r = await b.servicio<{ n: number }>(`select count(*)::int n from respaldo.seguimiento_cadencia_1311`);
  assert.equal(r[0].n, 3, "los tres que estaban en 15, tal como estaban");
  /* El alumno nuevo arranca en 20. */
  await b.ejecutar(`insert into public.seguimiento_alumnos (id, "alumnoId") values ('s9', 'a9')`);
  assert.equal((await b.servicio<{ c: number }>(`select "cadenciaDias" c from public.seguimiento_alumnos where "alumnoId" = 'a9'`))[0].c, 20);
});
