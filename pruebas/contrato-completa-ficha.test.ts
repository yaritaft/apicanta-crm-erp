import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (24/10): Simon Perez ya había firmado y su ficha seguía con «Falta» en DNI y domicilio, que el closer había cargado
   para el contrato. supabase/contrato-completa-ficha.sql: el contrato completa lo VACÍO de la ficha, nunca lo pisa. */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(`
    alter table public.alumnos add column nombre text, add column pais text, add column email text;
    -- Como en producción: dni, domicilio y teléfono son «not null default ''» (un null explícito no toma el default).
    create table public.seguimiento_alumnos (id text primary key, "alumnoId" text not null, dni text not null default '', domicilio text not null default '', telefono text not null default '');
    create table public.contratos (id text primary key, "alumnoId" text, estado text, datos jsonb not null default '{}', "creadoEn" timestamptz not null default now());
    insert into public.alumnos (id, nombre, pais, email) values ('alu_simon', 'Simon Perez', 'Chile', ''), ('alu_lili', 'Ya Cargado', '', 'propio@x.com'), ('alu_nuevo', 'Sin Seguimiento', null, null);
    insert into public.seguimiento_alumnos (id, "alumnoId", dni, domicilio, telefono) values
      ('seg_alu_simon', 'alu_simon', '', '', '+56 9 9761 2361'),
      ('seg_alu_lili', 'alu_lili', '12.345.678', 'Lo que cargó Lili', '');
  `);
  await db.exec(sqlDe("nacimiento.sql"));
  await db.exec(sqlDe("contrato-completa-ficha.sql"));
  await db.exec(sqlDe("contrato-completa-ficha.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

const ficha = async (b: Banco, id: string) =>
  (await b.servicio<{ dni: string | null; domicilio: string | null; telefono: string | null; pais: string | null; email: string | null; nacimiento: string | null }>(
    `select s.dni, s.domicilio, s.telefono, a.pais, a.email, s.nacimiento::text as nacimiento from public.alumnos a left join public.seguimiento_alumnos s on s."alumnoId" = a.id where a.id = '${id}'`))[0];

test("el contrato completa DNI, domicilio, teléfono, país y mail que la ficha tiene vacíos", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.contratos (id, "alumnoId", estado, datos) values ('ctr_1', 'alu_simon', 'enviado',
    '{"documento": " 19.876.543-2 ", "domicilio": "Av. Siempreviva 742", "telefono": "+56 9 1111 1111", "pais": "Chile", "email": "Simon@X.com", "nacimiento": "1993-05-10"}')`);
  assert.deepEqual(await ficha(b, "alu_simon"), { dni: "19.876.543-2", domicilio: "Av. Siempreviva 742", telefono: "+56 9 9761 2361", pais: "Chile", email: "simon@x.com", nacimiento: "1993-05-10" },
    "lo vacío se completa (también la fecha de nacimiento); el teléfono que ya estaba no se toca");
  await b.ejecutar(`update public.contratos set datos = datos || '{"nacimiento": "1980-01-01"}' where id = 'ctr_1'`);
  assert.equal((await ficha(b, "alu_simon")).nacimiento, "1993-05-10", "la fecha que ya está no se pisa");
});

test("lo que Lili ya cargó no se pisa nunca", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.contratos (id, "alumnoId", estado, datos) values ('ctr_2', 'alu_lili', 'firmado',
    '{"documento": "99.999.999", "domicilio": "Otro", "telefono": "+54 11 5555 5555", "pais": "Argentina", "email": "otro@x.com"}')`);
  assert.deepEqual(await ficha(b, "alu_lili"), { dni: "12.345.678", domicilio: "Lo que cargó Lili", telefono: "+54 11 5555 5555", pais: "Argentina", email: "propio@x.com", nacimiento: null });
});

test("sin seguimiento se le crea; uno anulado no completa nada; atar el alumno después también completa", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.contratos (id, "alumnoId", estado, datos) values ('ctr_3', 'alu_nuevo', 'anulado', '{"documento": "1"}')`);
  assert.equal((await ficha(b, "alu_nuevo")).dni, null, "anulado: nada");
  await b.ejecutar(`insert into public.contratos (id, "alumnoId", estado, datos) values ('ctr_4', null, 'enviado', '{"documento": "30.111.222", "domicilio": "Calle 1"}')`);
  await b.ejecutar(`update public.contratos set "alumnoId" = 'alu_nuevo' where id = 'ctr_4'`);
  const f = await ficha(b, "alu_nuevo");
  assert.deepEqual([f.dni, f.domicilio], ["30.111.222", "Calle 1"]);
  const filas = await b.servicio<{ n: number }>(`select count(*)::int as n from public.seguimiento_alumnos where "alumnoId" = 'alu_nuevo'`);
  assert.equal(filas[0].n, 1, "una sola ficha de seguimiento");
});

test("un contrato con datos a medias crea la ficha igual (los vacíos van como «»), y una fecha mal escrita se ignora", { skip: saltear }, async () => {
  const b = await banco();
  /* El 24/10 el insert mandaba null explícito a domicilio y teléfono («not null default ''») y fallaba. */
  await b.ejecutar(`insert into public.contratos (id, "alumnoId", estado, datos) values ('ctr_5', 'alu_nuevo', 'enviado', '{"documento": "40.000.000", "nacimiento": "1993-02-30"}')`);
  const f = await ficha(b, "alu_nuevo");
  assert.deepEqual([f.dni, f.domicilio, f.telefono, f.nacimiento], ["40.000.000", "", "", null]);
});

test("completar la ficha nunca frena guardar el contrato", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`alter table public.seguimiento_alumnos rename to seguimiento_roto`);
  const r = await b.intentar(null, `insert into public.contratos (id, "alumnoId", estado, datos) values ('ctr_6', 'alu_nuevo', 'enviado', '{"documento": "1"}')`);
  assert.ok(r.ok, "el contrato se guarda aunque la ficha no se pueda completar");
  assert.equal((await b.servicio<{ n: number }>(`select count(*)::int as n from public.contratos where id = 'ctr_6'`))[0].n, 1);
});
