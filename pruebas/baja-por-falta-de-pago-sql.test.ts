import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Liliana, 23/11, supabase/baja-por-falta-de-pago.sql: «necesito que la app sí o sí me avise cuando el closer pone "darlo de baja por
   falta de pago"». La marca quedaba en la cuota y sólo la veía Finanzas; ahora la base le avisa a Customer Success apenas se marca
   (desde la pantalla que sea), y una @ en la nota le avisa a quien se nombra (Mariano intentó etiquetarla así en el video). */

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
    alter table public.ventas add column "contactoNombre" text, add column "productoId" text, add column moneda text default 'USD';
    alter table public.cuotas add column numero int, add column "esReserva" boolean default false, add column monto numeric, add column vence timestamptz,
      add column estado text default 'pendiente', add column "seguimientoCobro" jsonb;
    alter table public.alumnos add column nombre text, add column "leadId" text, add column estado text default 'activo';
    create table public.productos (id text primary key, nombre text);
    create table public.accesos_alumno (id text primary key, "alumnoId" text, estado text);
    create table public.avisos (id text primary key, para text not null, tipo text not null default 'mencion', titulo text not null, cuerpo text, de text,
      "deEmail" text, "contactoId" text, persona text, "comentarioId" text, "leidoEn" timestamptz, "creadoEn" timestamptz not null default now());
    create function public.mails_de_servicio() returns setof text language sql stable security definer set search_path = public as $$
      select distinct lower(btrim(q.email)) from public.equipo q
      where q.activo and btrim(coalesce(q.email, '')) like '%@%' and (q.puesto ilike '%customer success%' or q.puesto ilike '%servicio%' or q.puesto ilike '%csm%') $$;
    create function public.mails_de_la_persona(p_nombre text) returns setof text language sql stable security definer set search_path = public as $$
      select distinct lower(btrim(x.email)) from (
        select q.email from public.equipo q where q.activo and lower(split_part(btrim(q.nombre), ' ', 1)) = lower(split_part(btrim(coalesce(p_nombre, '')), ' ', 1))
        union all
        select u.email from public.usuarios_permitidos u where lower(split_part(btrim(coalesce(u.nombre, '')), ' ', 1)) = lower(split_part(btrim(coalesce(p_nombre, '')), ' ', 1))
      ) x where btrim(coalesce(p_nombre, '')) <> '' and btrim(coalesce(x.email, '')) like '%@%' $$;
    insert into public.equipo (id, nombre, email, activo, puesto) values
      ('eq_lili', 'Liliana Riveros', ' Liliana@Apicanta.com ', true, 'Customer Success Manager'),
      ('eq_ex', 'Ex Servicio', 'ex@apicanta.com', false, 'Customer Success Manager'),
      ('eq_mariano', 'Mariano Arias', 'mariano@apicanta.com', true, 'Closer'),
      ('eq_aldana', 'Aldana Gómez', 'aldana@apicanta.com', true, 'Finanzas');
    insert into public.usuarios_permitidos (email, nombre, rol) values ('lili.personal@mail.com', 'Liliana Riveros', 'customer_success');
    insert into public.productos (id, nombre) values ('prod_ai', 'Hackear AI'), ('prod_it', 'Hackear IT');
    insert into public.ventas (id, "contactoId", "contactoNombre", "productoId", estado) values
      ('v_jorge', 'lead_jorge', 'Bruno Ibáñez Castro', 'prod_ai', 'activa'),
      ('v_julian', 'lead_julian', 'Tomas Rios', 'prod_ai', 'activa'),
      ('v_alex', 'lead_alex', 'Diego Soler', 'prod_it', 'activa'),
      ('v_cancelada', 'lead_c', 'Venta Cancelada', 'prod_it', 'cancelada'),
      ('v_huerfana', 'lead_h', 'Sin Ficha', 'prod_it', 'activa');
    insert into public.alumnos (id, "ventaId", nombre, "leadId") values
      ('alu_jorge', 'v_jorge', 'Bruno Ibáñez Castro', 'lead_jorge'),
      ('alu_julian', null, 'Tomás Ríos', 'lead_julian'),
      ('alu_alex', 'v_alex', 'Diego Soler', 'lead_alex');
    insert into public.accesos_alumno (id, "alumnoId", estado) values ('acc1', 'alu_julian', 'dado'), ('acc2', 'alu_jorge', 'quitado');
    insert into public.cuotas (id, "ventaId", numero, monto, vence) values
      ('c_jorge', 'v_jorge', 3, 449.08, '2026-09-07T15:00:00Z'),
      ('c_julian', 'v_julian', 2, 1200, '2026-09-05T15:00:00Z'),
      ('c_alex2', 'v_alex', 2, 1099.85, '2026-09-14T15:00:00Z'),
      ('c_alex3', 'v_alex', 3, 1099.86, '2026-10-14T15:00:00Z'),
      ('c_cancelada', 'v_cancelada', 1, 500, '2026-09-01T15:00:00Z'),
      ('c_huerfana', 'v_huerfana', 1, 400, '2026-09-01T15:00:00Z'),
      ('c_pagada', 'v_julian', 1, 300, '2026-08-05T15:00:00Z');
    insert into public.pagos (id, "cuotaId", monto) values ('pg1', 'c_pagada', 300), ('pg2', 'c_julian', 200);
  `);
  await db.exec(sqlDe("baja-por-falta-de-pago.sql"));
  await db.exec(sqlDe("baja-por-falta-de-pago.sql")); // se puede volver a correr
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

const marcar = (b: Banco, cuota: string, estado: string | null, nota = "", por = "Mariano Arias") =>
  b.ejecutar(`update public.cuotas set "seguimientoCobro" = ${estado
    ? `jsonb_build_object('estado', '${estado}', 'por', '${por}', 'en', now()::text${nota ? `, 'nota', '${nota.replace(/'/g, "''")}'` : ""})`
    : "null"} where id = '${cuota}'`);
const avisos = (b: Banco) => b.servicio<{ id: string; para: string; tipo: string; titulo: string; cuerpo: string; de: string; contactoId: string | null; persona: string | null }>(
  `select id, para, tipo, titulo, cuerpo, de, "contactoId", persona from public.avisos order by id`);

test("pedir la baja le avisa a Customer Success con qué no pagó y que el outboarding es a mano (alumno de antes)", { skip: saltear }, async () => {
  const b = await banco();
  await marcar(b, "c_jorge", "baja");
  const a = await avisos(b);
  assert.equal(a.length, 1, "una sola persona activa de Servicio");
  assert.equal(a[0].para, "liliana@apicanta.com", "al mail de Equipo, en minúsculas; la inactiva no");
  assert.equal(a[0].tipo, "baja-falta-de-pago");
  assert.equal(a[0].titulo, "Mariano Arias pidió la baja de Bruno Ibáñez Castro por falta de pago");
  assert.equal(a[0].cuerpo, "No pagó la cuota 3 de Hackear AI (USD 449, vencía el 07/09). Sus accesos no los dio la app (alumno de antes): hacé el outboarding a mano."
    + " Queda en tu panel, en «Bajas por falta de pago», hasta que lo pases a Outboarding.", "un acceso ya quitado no cuenta como de la app");
  assert.equal(a[0].contactoId, "lead_jorge", "abre su ficha");
  assert.equal(a[0].de, "Mariano Arias");
});

test("con accesos de la app dice que salen solos; lo que falta pagar descuenta lo cobrado; la nota viaja", { skip: saltear }, async () => {
  const b = await banco();
  await marcar(b, "c_julian", "baja", "Lo quitaron del trabajo, no tiene ingresos");
  const [a] = await avisos(b);
  assert.equal(a.persona, "Tomás Ríos", "el nombre de su ficha (encontrada por el lead)");
  assert.match(a.cuerpo, /^No pagó la cuota 2 de Hackear AI \(USD 1\.000, vencía el 05\/09\)\. «Lo quitaron del trabajo, no tiene ingresos»\./);
  assert.match(a.cuerpo, /Tiene accesos que dio la app: se los sacamos solos en la próxima pasada/);
});

test("dos cuotas de la misma venta son un aviso; cambiar la nota no repite; sacar la marca lo borra si nadie más la pide", { skip: saltear }, async () => {
  const b = await banco();
  await marcar(b, "c_alex3", "baja");
  await marcar(b, "c_alex2", "baja");
  await marcar(b, "c_alex2", "baja", "sigue sin contestar");
  assert.equal((await avisos(b)).length, 1);
  await marcar(b, "c_alex3", "contactado");
  assert.equal((await avisos(b)).length, 1, "la otra cuota todavía pide la baja");
  await marcar(b, "c_alex2", null);
  assert.equal((await avisos(b)).length, 0, "fue un error o pagó: no le queda un aviso falso");
  await marcar(b, "c_alex2", "baja");
  assert.equal((await avisos(b)).length, 1, "si se vuelve a pedir, vuelve a avisar");
  await b.ejecutar(`update public.avisos set "leidoEn" = now()`);
  await marcar(b, "c_alex2", null);
  assert.equal((await avisos(b)).length, 1, "uno ya leído queda (lo vio)");
});

test("no avisa si la cuota ya está paga, si la venta no está activa ni por las otras marcas; sin ficha, lo dice", { skip: saltear }, async () => {
  const b = await banco();
  await marcar(b, "c_pagada", "baja");
  await marcar(b, "c_cancelada", "baja");
  await marcar(b, "c_jorge", "no-responde");
  assert.equal((await avisos(b)).length, 0);
  await marcar(b, "c_huerfana", "baja");
  const [a] = await avisos(b);
  assert.equal(a.persona, "Sin Ficha");
  assert.match(a.cuerpo, /No encontramos su ficha de alumno: buscalo y hacé el outboarding a mano\./);
  assert.equal(a.contactoId, "lead_h");
});

test("@ en la nota le avisa a quien se nombra («@lili» = Liliana, con sus dos mails), no a quien escribe", { skip: saltear }, async () => {
  const b = await banco();
  await marcar(b, "c_jorge", "contactado", "@lili paga el viernes, avisale a @Aldana y a @Mariano");
  const a = (await avisos(b)).filter((x) => x.tipo === "mencion");
  assert.deepEqual(a.map((x) => x.para).sort(), ["aldana@apicanta.com", "lili.personal@mail.com", "liliana@apicanta.com"], "Mariano escribió: no se avisa a sí mismo");
  assert.equal(a[0].titulo, "Mariano Arias te mencionó en la cobranza de Bruno Ibáñez Castro");
  assert.equal(a[0].cuerpo, "La cuota 3: «@lili paga el viernes, avisale a @Aldana y a @Mariano»");
  await marcar(b, "c_jorge", "contactado", "@lili paga el viernes, avisale a @Aldana y a @Mariano");
  assert.equal((await avisos(b)).length, 3, "la misma nota no repite");
  await marcar(b, "c_jorge", "contactado", "mail de contacto: alguien@lili.com, @li");
  assert.equal((await avisos(b)).length, 3, "un mail no es una mención, y dos letras no alcanzan");
});

test("una marca de hace días dice cuándo se pidió", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`update public.cuotas set "seguimientoCobro" = '{"estado":"baja","por":"Dante Barbieri","en":"2026-10-29T18:48:00.000Z"}' where id = 'c_jorge'`);
  const [a] = await avisos(b);
  assert.match(a.cuerpo, /^Lo pidió el 29\/10\. No pagó la cuota 3/);
  assert.equal(a.titulo, "Dante Barbieri pidió la baja de Bruno Ibáñez Castro por falta de pago");
});

test("si algo falla, la cuota se guarda igual", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar("drop table public.accesos_alumno");
  await marcar(b, "c_julian", "baja");
  const r = await b.servicio<{ estado: string }>(`select "seguimientoCobro"->>'estado' as estado from public.cuotas where id = 'c_julian'`);
  assert.equal(r[0].estado, "baja");
});
