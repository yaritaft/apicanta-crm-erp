import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (26/10): los resells que agenda en el mes son parte de su sueldo. supabase/resells-agendado-en.sql: cada fila de la agenda
   sabe cuándo se reservó (la reserva ORIGINAL si se reprogramó), lo ponga quien lo ponga, y el concepto de la liquidación que
   contaba «llamadas con utm_source Resell» pasa a contar la agenda. */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(`
    alter table public.sesiones add column "creadoEn" timestamptz, add column "reprogramadaDe" text;
    create table public.resells (id text primary key, "sesionId" text, "fechaHora" timestamptz not null default now(), nombre text not null default '',
      origen text not null default 'manual', cancelada boolean not null default false, estado text not null default '',
      "creadoEn" timestamptz not null default now());
    create table public.honorarios (id text primary key, "miembroId" text, conceptos jsonb not null default '[]', "actualizadoEn" timestamptz default now(), "actualizadoPor" text);
    -- Agendó el 28/09; el 02/10 lo reprogramó (B), y el 05/10 otra vez (C).
    insert into public.sesiones (id, "creadoEn", "reprogramadaDe") values
      ('cal_a', '2026-09-28 15:00Z', null), ('cal_b', '2026-10-02 15:00Z', 'cal_a'), ('cal_c', '2026-10-05 15:00Z', 'cal_b'),
      ('cal_sola', '2026-10-10 15:00Z', null), ('cal_vieja', '2026-10-12 15:00Z', null),
      ('cal_x', '2026-10-01 15:00Z', 'cal_y'), ('cal_y', '2026-09-01 15:00Z', 'cal_x');
    insert into public.resells (id, "sesionId", origen) values ('rs_ya', 'cal_sola', 'calendly');
    insert into public.honorarios (id, "miembroId", conceptos) values
      ('hon_lili', 'lili', '[{"id":"c1","tipo":"fijo","nombre":"Sueldo","monto":1},{"id":"c2","tipo":"tramo","nombre":"Llamadas de Resell","base":"llamadas","utmSource":"Resell","cada":15,"monto":2}]'),
      ('hon_setter', 'dani', '[{"id":"c1","tipo":"tramo","nombre":"Llamadas","base":"llamadas","utmSource":"setter-ia","cada":10,"monto":3}]');
  `);
  await db.exec(sqlDe("resells-agendado-en.sql"));
  await db.exec(sqlDe("resells-agendado-en.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

const agendado = async (b: Banco, id: string) =>
  (await b.servicio<{ a: string | null }>(`select to_char("agendadoEn" at time zone 'UTC', 'YYYY-MM-DD') as a from public.resells where id = '${id}'`))[0]?.a ?? null;

test("la de Calendly toma cuándo se reservó y, si se reprogramó, la reserva original", { skip: saltear }, async () => {
  const b = await banco();
  assert.equal(await agendado(b, "rs_ya"), "2026-10-10", "lo que ya había se completa");
  await b.ejecutar(`insert into public.resells (id, "sesionId", origen) values ('rs_c', 'cal_c', 'calendly')`);
  assert.equal(await agendado(b, "rs_c"), "2026-09-28", "dos reprogramaciones: cuenta el 28/09, no el 05/10");
  await b.ejecutar(`insert into public.resells (id, "sesionId", origen) values ('rs_x', 'cal_x', 'calendly')`);
  assert.equal(await agendado(b, "rs_x"), "2026-09-01", "una cadena rota que vuelve sobre sí misma no cuelga");
});

test("a mano: cuando se cargó; del Airtable sin llamada: vacía; y atarla a su llamada la completa", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.resells (id, origen, "creadoEn") values ('rs_mano', 'manual', '2026-10-15 12:00Z'), ('rs_imp', 'importado', '2026-10-19 12:00Z')`);
  assert.equal(await agendado(b, "rs_mano"), "2026-10-15");
  assert.equal(await agendado(b, "rs_imp"), null);
  await b.ejecutar(`update public.resells set "sesionId" = 'cal_vieja' where id = 'rs_imp'`);
  assert.equal(await agendado(b, "rs_imp"), "2026-10-12");
});

test("una pestaña vieja que guarda la fila sin el dato no lo borra (update y upsert)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`update public.resells set "agendadoEn" = null, estado = 'Seguimiento' where id = 'rs_ya'`);
  assert.equal(await agendado(b, "rs_ya"), "2026-10-10");
  await b.ejecutar(`insert into public.resells (id, "sesionId", origen, "agendadoEn") values ('rs_ya', 'cal_sola', 'calendly', null)
    on conflict (id) do update set "agendadoEn" = excluded."agendadoEn", estado = 'Upgrade'`);
  assert.equal(await agendado(b, "rs_ya"), "2026-10-10");
});

test("el concepto de Lili pasa a contar la agenda de resells; el resto no se toca, y hay respaldo", { skip: saltear }, async () => {
  const b = await banco();
  const conceptos = async (id: string) =>
    (await b.servicio<{ c: Array<Record<string, unknown>> }>(`select conceptos as c from public.honorarios where id = '${id}'`))[0].c;
  const lili = await conceptos("hon_lili");
  assert.deepEqual(lili.map((c) => c.id), ["c1", "c2"], "el orden se mantiene");
  assert.equal(lili[1].base, "resells");
  assert.equal(lili[1].utmSource, undefined);
  assert.equal(lili[1].cada, 15);
  assert.deepEqual(lili[0], { id: "c1", tipo: "fijo", nombre: "Sueldo", monto: 1 });
  assert.equal((await conceptos("hon_setter"))[0].base, "llamadas", "otra fuente de llamadas no cambia");
  const resp = await b.servicio<{ id: string; c: Array<Record<string, unknown>> }>(`select id, conceptos as c from respaldo.honorarios_2610`);
  assert.deepEqual(resp.map((r) => r.id), ["hon_lili"], "una sola vez aunque el archivo corra dos veces");
  assert.equal(resp[0].c[1].utmSource, "Resell", "el respaldo es el de antes");
});
