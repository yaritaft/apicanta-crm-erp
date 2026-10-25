import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (24/10): lo que se carga al cerrar una llamada de testimonio (si grabó, el link, cómo salió el pitch) tiene que quedar en
   la ficha del alumno. Mariano y el director comercial cierran sus llamadas pero no editan alumnos: lo pasa la base
   (supabase/resells-testimonio.sql, resell_testimonio_a_ficha). */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(`
    alter table public.alumnos add column nombre text, add column email text, add column estado text, add column inicio text;
    create table public.testimonios (id text primary key, "alumnoId" text not null references public.alumnos(id) on delete cascade,
      estado text not null default 'pedido', link text not null default '', fecha text, notas text not null default '', "creadoEn" timestamptz not null default now(),
      "followUp" text not null default '', "fechaGrabacion" text, "conQuien" text not null default '', resell text not null default '', "estadoVideo" text not null default '');
    create table public.resells (id text primary key, "fechaHora" timestamptz not null default now(), nombre text not null default '', email text not null default '',
      closer text not null default '', estado text not null default '', "casoDeExito" boolean not null default false, cancelada boolean not null default false);
    insert into public.alumnos (id, nombre, email, estado, inicio) values
      ('alu_ana', 'Ana', 'ana@x.com', 'activo', '2026-03-01'), ('alu_ana_vieja', 'Ana', 'ANA@x.com', 'egresado', '2025-01-01'), ('alu_beto', 'Beto', 'beto@x.com', 'activo', '2026-01-01');
    insert into public.testimonios (id, "alumnoId", "followUp", "estadoVideo", resell, "creadoEn") values ('tes_beto', 'alu_beto', 'Pendiente de agendar', 'No quiso grabar', 'Pendiente', '2026-09-01');
  `);
  await db.exec(sqlDe("resells-testimonio.sql"));
  await db.exec(sqlDe("resells-testimonio.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

const testimonio = async (b: Banco, alumno: string) =>
  b.servicio<{ id: string; followUp: string; fechaGrabacion: string | null; conQuien: string; link: string; estadoVideo: string; resell: string }>(
    `select id, "followUp", "fechaGrabacion", "conQuien", link, "estadoVideo", resell from public.testimonios where "alumnoId" = '${alumno}' order by id`);

test("grabó: el testimonio del alumno (el activo de ese mail) queda con el link, el día, con quién y cómo salió el pitch", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.resells (id, "fechaHora", email, closer, "casoDeExito") values ('rs_1', '2026-10-28T23:30:00Z', ' Ana@X.com ', 'Mariano Arias', true)`);
  assert.deepEqual(await testimonio(b, "alu_ana"), [], "sin resultado todavía no se toca nada");
  await b.ejecutar(`update public.resells set testimonio = 'Grabó', "linkTestimonio" = 'https://drive.google.com/v1', estado = 'Upgrade a Hackear IA' where id = 'rs_1'`);
  assert.deepEqual(await testimonio(b, "alu_ana"), [{
    id: "tes_rs_1", followUp: "Llamada agendada", fechaGrabacion: "2026-10-28", conQuien: "Mariano", link: "https://drive.google.com/v1", estadoVideo: "Pendiente de subir", resell: "Renueva",
  }], "las 20:30 de Argentina todavía son el 28");
  assert.deepEqual(await testimonio(b, "alu_ana_vieja"), []);
  await b.ejecutar(`update public.resells set estado = 'Upgrade a Hackear IA', "linkTestimonio" = 'https://drive.google.com/v1' where id = 'rs_1'`);
  assert.equal((await testimonio(b, "alu_ana")).length, 1, "volver a guardarla no lo duplica");
});

test("usa el testimonio que ya tenía; «Se reagenda» sólo cambia el Follow Up; «No quiso grabar» lo marca", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.resells (id, email, closer, testimonio) values ('rs_2', 'beto@x.com', 'Yari Taft', 'Se reagenda')`);
  assert.deepEqual((await testimonio(b, "alu_beto")).map((t) => [t.id, t.followUp, t.resell, t.estadoVideo]), [["tes_beto", "Pendiente de agendar", "Pendiente", "No quiso grabar"]]);
  await b.ejecutar(`update public.resells set testimonio = 'Grabó', "linkTestimonio" = 'https://youtu.be/x', estado = 'Seguimiento' where id = 'rs_2'`);
  const t = (await testimonio(b, "alu_beto"))[0];
  assert.deepEqual([t.followUp, t.conQuien, t.link, t.estadoVideo, t.resell], ["Llamada agendada", "Yari", "https://youtu.be/x", "Pendiente de subir", "Lo piensa"]);
  await b.ejecutar(`update public.resells set testimonio = 'No quiso grabar', estado = 'No quiere renovar, Outbording' where id = 'rs_2'`);
  const n = (await testimonio(b, "alu_beto"))[0];
  assert.deepEqual([n.followUp, n.estadoVideo, n.resell, n.link], ["No quiere grabar", "No quiso grabar", "No renueva", "https://youtu.be/x"]);
});

test("sin alumno con ese mail, cancelada o sin testimonio: no hace nada; y nunca frena guardar el resell", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.resells (id, email, testimonio) values ('rs_3', 'nadie@x.com', 'Grabó'), ('rs_4', 'ana@x.com', '')`);
  await b.ejecutar(`insert into public.resells (id, email, testimonio, cancelada) values ('rs_5', 'ana@x.com', 'Grabó', true)`);
  assert.deepEqual(await testimonio(b, "alu_ana"), []);
  await b.ejecutar(`alter table public.testimonios rename to testimonios_rotos`);
  const r = await b.intentar(null, `insert into public.resells (id, email, testimonio) values ('rs_6', 'ana@x.com', 'Grabó')`);
  assert.ok(r.ok, "el resell se guarda aunque la ficha no se pueda tocar");
});
