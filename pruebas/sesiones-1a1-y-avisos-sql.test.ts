import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (03–05/11), supabase/sesiones-1a1-y-avisos-de-resell.sql:
   1) la sesión 1 a 1 que entra por Calendly va sola a la ficha (Bonos) y le avisa al mentor (Mariano Andrés Baliño, 16/11 con Yari);
   2) cuando el closer cierra un resell o un testimonio, le llega un aviso a Customer Success, con lo de los accesos si es alumno viejo;
   3) un testimonio grabado sin link deja la llamada abierta para el closer (Jean Camacho, 14/10 con Mariano). */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

const FUTURO = "2099-11-16T18:00:00Z";

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(`
    alter table public.equipo add column puesto text;
    alter table public.alumnos add column nombre text, add column email text, add column estado text, add column inicio text, add column "leadId" text;
    alter table public.sesiones add column tipo text, add column titulo text, add column inicia timestamptz, add column estado text default 'agendada',
      add column email text, add column invitado text, add column "reprogramadaDe" text, add column "motivoCancelacion" text;
    create table public.seguimiento_alumnos (id text primary key, "alumnoId" text not null unique, "sesionesUnoAUno" jsonb not null default '[]'::jsonb,
      "sesionesMentor" int, "actualizadoEn" timestamptz default now(), notas text not null default '');
    create table public.avisos (id text primary key, para text not null, tipo text not null default 'mencion', titulo text not null, cuerpo text, de text,
      "deEmail" text, "contactoId" text, persona text, "comentarioId" text, "leidoEn" timestamptz, "creadoEn" timestamptz not null default now());
    create table public.testimonios (id text primary key, "alumnoId" text not null references public.alumnos(id) on delete cascade,
      estado text not null default 'pedido', link text not null default '', fecha text, notas text not null default '', "creadoEn" timestamptz not null default now(),
      "followUp" text not null default '', "fechaGrabacion" text, "conQuien" text not null default '', resell text not null default '', "estadoVideo" text not null default '');
    create table public.resells (id text primary key, "fechaHora" timestamptz not null default now(), nombre text not null default '', email text not null default '',
      closer text not null default '', estado text not null default '', "casoDeExito" boolean not null default false, cancelada boolean not null default false,
      testimonio text not null default '', "linkTestimonio" text not null default '', "actualizadoPor" text not null default '', notas text not null default '');
    create table public.accesos_alumno (id text primary key, "alumnoId" text not null, estado text not null default 'pendiente');
    insert into public.equipo (id, nombre, email, activo, puesto) values
      ('eq_yari', 'Yari', 'yari.taft@gmail.com', true, 'CEO'),
      ('eq_lili', 'Liliana Riveros', 'liliana@apicanta.com', true, 'Customer Success Manager'),
      ('eq_mariano', 'Mariano Arias', 'mariano@apicanta.com', true, 'Closer');
    insert into public.usuarios_permitidos (email, nombre, rol) values ('yari@apicanta.com', 'Yari Taft', 'dueno'), ('yari.taft@gmail.com', 'Yari Taft', 'dueno');
    insert into public.alumnos (id, nombre, email, estado, inicio, "leadId") values
      ('alu_mariano', 'Mariano Andrés Baliño', 'mariano.a.balino@gmail.com', 'activo', '2026-10-01', 'lea_balino'),
      ('alu_jean', 'Jean Camacho', 'jeancamacho1999@gmail.com', 'baja', '2026-05-01', null),
      ('alu_nuevo', 'Ana Nueva', 'ana@x.com', 'activo', '2026-10-01', null);
    insert into public.seguimiento_alumnos (id, "alumnoId", "sesionesMentor") values ('seg_alu_mariano', 'alu_mariano', 2);
    insert into public.accesos_alumno (id, "alumnoId", estado) values ('acc_1', 'alu_nuevo', 'dado');
  `);
  await db.exec(sqlDe("sesiones-1a1-y-avisos-de-resell.sql"));
  await db.exec(sqlDe("sesiones-1a1-y-avisos-de-resell.sql"));
  // El disparador es de supabase/resells-testimonio.sql (en producción ya está); acá sólo se cambia su función.
  await db.exec(`create trigger resells_testimonio_a_ficha after insert or update of testimonio, "linkTestimonio", estado on public.resells
    for each row execute function public.resell_testimonio_a_ficha()`);
  const b = armarBanco(db);
  abiertos.push(b);
  return b;
}

type Ses = { id: string; fecha: string; con: string; sesionId?: string; notas: string; creadoPor: string };
const sesiones = async (b: Banco, alumno: string) =>
  ((await b.servicio<{ s: Ses[] }>(`select "sesionesUnoAUno" s from public.seguimiento_alumnos where "alumnoId" = '${alumno}'`))[0]?.s ?? [])
    .sort((x, y) => x.fecha.localeCompare(y.fecha));
const avisos = (b: Banco, tipo: string) =>
  b.servicio<{ id: string; para: string; titulo: string; cuerpo: string; contactoId: string | null }>(`select id, para, titulo, cuerpo, "contactoId" from public.avisos where tipo = '${tipo}' order by para, id`);

test("la 1 a 1 de Calendly entra a la ficha, usa la que Lili anotó a mano ese día y le avisa a Yari en sus dos mails", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`update public.seguimiento_alumnos set "sesionesUnoAUno" = '[{"id":"ses1a1_mano","fecha":"2099-11-16","con":"Mentor","notas":"","grabacion":"","creadoEn":"2026-11-03T13:08:01.831Z","creadoPor":"Liliana Riveros"}]'`);
  await b.ejecutar(`insert into public.sesiones (id, tipo, titulo, inicia, email, anfitrion, invitado, "leadId") values
    ('cal_1', 'Sesión 1 a 1', 'Sesión 1 a 1', '${FUTURO}', ' Mariano.A.Balino@gmail.com', 'Yari Taft', 'Mariano Andrés Baliño', 'lea_cal_x')`);
  const s = await sesiones(b, "alu_mariano");
  assert.equal(s.length, 1, "no se duplica la que Lili ya había cargado");
  assert.deepEqual([s[0].id, s[0].fecha, s[0].con, s[0].sesionId, s[0].creadoPor], ["ses1a1_mano", "2099-11-16", "Yari", "cal_1", "Liliana Riveros"]);
  const a = await avisos(b, "sesion-1a1");
  assert.deepEqual(a.map((x) => x.para), ["yari.taft@gmail.com", "yari@apicanta.com"]);
  assert.match(a[0].titulo, /Sesión 1 a 1 agendada: Mariano Andrés Baliño/);
  assert.match(a[0].cuerpo, /lunes 16\/11 a las 15:00 \(hora de Argentina\), con Yari\. Es la 1 de 2 que incluye su contrato/);
  assert.equal(a[0].contactoId, "lea_balino", "abre la ficha del alumno");

  // Volver a traerla (el cron cada 30 minutos) no cambia nada ni avisa otra vez.
  await b.ejecutar(`update public.sesiones set anfitrion = 'Yari Taft', notas = 'x' where id = 'cal_1'`);
  assert.equal((await avisos(b, "sesion-1a1")).length, 2);
});

test("reprogramada: la sesión se mueve de día sin duplicarse; cancelada: sale de la ficha (si nadie le escribió) y avisa", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.sesiones (id, tipo, inicia, email, anfitrion) values ('cal_a', 'Sesión 1 a 1', '${FUTURO}', 'mariano.a.balino@gmail.com', 'Yari Taft')`);
  // La nueva entra antes que la cancelación de la vieja (Calendly no garantiza el orden).
  await b.ejecutar(`insert into public.sesiones (id, tipo, inicia, email, anfitrion, "reprogramadaDe") values ('cal_b', 'Sesión 1 a 1', '2099-11-20T18:00:00Z', 'mariano.a.balino@gmail.com', 'Yari Taft', 'cal_a')`);
  await b.ejecutar(`update public.sesiones set estado = 'cancelada', "motivoCancelacion" = 'Reprogramada' where id = 'cal_a'`);
  assert.deepEqual((await sesiones(b, "alu_mariano")).map((x) => [x.fecha, x.sesionId]), [["2099-11-20", "cal_b"]]);

  await b.ejecutar(`update public.sesiones set estado = 'cancelada', "motivoCancelacion" = 'No puede' where id = 'cal_b'`);
  assert.deepEqual(await sesiones(b, "alu_mariano"), []);
  const titulos = (await avisos(b, "sesion-1a1")).map((x) => x.titulo);
  assert.ok(titulos.some((t) => t.startsWith("Se canceló la sesión 1 a 1 de Mariano Andrés Baliño")));

  // Con notas cargadas, una cancelada se queda: la decide Customer Success.
  await b.ejecutar(`insert into public.sesiones (id, tipo, inicia, email, anfitrion) values ('cal_c', 'Sesion 1:1', '${FUTURO}', 'mariano.a.balino@gmail.com', 'Yari Taft')`);
  await b.ejecutar(`select set_config('apicanta.sesiones_1a1', 'on', false); update public.seguimiento_alumnos set "sesionesUnoAUno" = jsonb_set("sesionesUnoAUno", '{0,notas}', '"hablamos del CV"'); select set_config('apicanta.sesiones_1a1', 'off', false);`);
  await b.ejecutar(`update public.sesiones set estado = 'cancelada' where id = 'cal_c'`);
  assert.equal((await sesiones(b, "alu_mariano")).length, 1);
});

test("una pestaña vieja que guarda la ficha sin la sesión de Calendly no la borra (y una cancelada sí se puede sacar)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.sesiones (id, tipo, inicia, email, anfitrion) values ('cal_v', 'Sesión 1 a 1', '${FUTURO}', 'mariano.a.balino@gmail.com', 'Yari Taft')`);
  await b.ejecutar(`update public.seguimiento_alumnos set "sesionesUnoAUno" = '[{"id":"ses1a1_otra","fecha":"2026-10-02","con":"Lili","notas":"","grabacion":"","creadoEn":"x","creadoPor":"Lili"}]', notas = 'lo contacté'`);
  assert.deepEqual((await sesiones(b, "alu_mariano")).map((x) => x.id), ["ses1a1_otra", "ses1a1_cal_v"]);
  // La misma, sin `sesionId` (la versión de antes): se le devuelve.
  await b.ejecutar(`update public.seguimiento_alumnos set "sesionesUnoAUno" = '[{"id":"ses1a1_cal_v","fecha":"2099-11-16","con":"Yari","notas":"nota","grabacion":"","creadoEn":"x","creadoPor":"Calendly"}]'`);
  assert.deepEqual((await sesiones(b, "alu_mariano")).map((x) => [x.notas, x.sesionId]), [["nota", "cal_v"]]);
});

test("sin alumno con ese mail: avisa a Yari y a Customer Success, y no toca ninguna ficha; otros eventos no cuentan", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.sesiones (id, tipo, inicia, email, anfitrion, invitado) values
    ('cal_x', 'Sesión 1 a 1', '${FUTURO}', 'nadie@x.com', 'Yari Taft', 'Ianco'),
    ('cal_v1', 'Llamada de Asesoramiento - VSL - Team', '${FUTURO}', 'ana@x.com', 'Yari Taft', 'Ana'),
    ('cal_11', 'Clase 11 a 12', '${FUTURO}', 'ana@x.com', 'Yari Taft', 'Ana')`);
  const a = await avisos(b, "sesion-1a1");
  assert.deepEqual(a.map((x) => x.para), ["liliana@apicanta.com", "yari.taft@gmail.com", "yari@apicanta.com"]);
  assert.match(a[0].cuerpo, /No encontramos un alumno con el mail nadie@x\.com/);
  assert.deepEqual(await sesiones(b, "alu_nuevo"), []);
});

test("una que ya pasó entra a la ficha sin avisar (el relleno de lo que ya estaba)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.sesiones (id, tipo, inicia, email, anfitrion) values ('cal_p', 'Sesión 1 a 1', '2026-10-05T15:00:00Z', 'ana@x.com', 'Yari Taft')`);
  assert.deepEqual((await sesiones(b, "alu_nuevo")).map((x) => [x.fecha, x.con, x.creadoPor]), [["2026-10-05", "Yari", "Calendly"]]);
  assert.deepEqual(await avisos(b, "sesion-1a1"), []);
});

test("el closer cierra la llamada: Lili recibe el aviso; si no renueva y es alumno viejo, que le saque los accesos a mano", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.resells (id, "fechaHora", nombre, email, closer) values
    ('rs_jean', '2026-10-15T01:00:00Z', 'Jean Carlo', 'jeancamacho1999@gmail.com', 'Mariano'),
    ('rs_ana', '2026-10-20T15:00:00Z', 'Ana', 'ana@x.com', 'Mariano Arias')`);
  await b.ejecutar(`update public.resells set estado = 'No quiere renovar, Outbording', "actualizadoPor" = 'Mariano Arias' where id = 'rs_jean'`);
  await b.ejecutar(`update public.resells set estado = 'Outbording', testimonio = 'Grabó', "actualizadoPor" = 'Mariano Arias' where id = 'rs_ana'`);
  const a = await b.servicio<{ id: string; para: string; tipo: string; titulo: string; cuerpo: string; persona: string }>(`select * from public.avisos where tipo like 'resell%' order by persona`);
  assert.deepEqual(a.map((x) => [x.para, x.tipo, x.persona]), [["liliana@apicanta.com", "resell-outboarding", "Ana Nueva"], ["liliana@apicanta.com", "resell-outboarding", "Jean Camacho"]]);
  assert.equal(a[1].titulo, "Mariano cerró la llamada de Jean Camacho");
  assert.match(a[1].cuerpo, /^Resell: No quiere renovar, Outbording\. Es alumno viejo: la app nunca le dio los accesos/);
  assert.match(a[0].cuerpo, /Grabó el testimonio; falta el link .* la app le saca sola los accesos/);

  // Guardar lo mismo otra vez no avisa de nuevo; lo que carga Lili misma, tampoco.
  await b.ejecutar(`update public.resells set estado = 'No quiere renovar, Outbording', notas = 'x' where id = 'rs_jean'`);
  await b.ejecutar(`update public.resells set estado = 'Renueva', "actualizadoPor" = 'Liliana Riveros' where id = 'rs_jean'`);
  await b.ejecutar(`update public.resells set estado = 'No renueva', "actualizadoPor" = 'Corrección Airtable 21/10' where id = 'rs_jean'`);
  assert.equal((await b.servicio(`select 1 from public.avisos where tipo like 'resell%'`)).length, 2);
});

test("testimonio grabado con el closer y sin link: la llamada de ese día pasa a caso de éxito (queda en su panel)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.resells (id, "fechaHora", nombre, email, closer, estado, "actualizadoPor") values
    ('rs_jean', '2026-10-15T01:00:00Z', 'Jean Carlo', 'jeancamacho1999@gmail.com', 'Mariano', 'No quiere renovar', 'Mariano Arias'),
    ('rs_otro_dia', '2026-10-25T15:00:00Z', 'Jean Carlo', 'jeancamacho1999@gmail.com', 'Mariano', '', '')`);
  await b.ejecutar(`insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion", "conQuien", link, "estadoVideo", "creadoEn") values
    ('tes_1', 'alu_jean', 'Agendado', null, '', 'https://drive.google.com/viejo', 'Raw en drive', '2026-10-19T22:56:36Z'),
    ('tes_2', 'alu_jean', 'Agendado', '2026-10-14', 'Mariano', '', '', '2026-10-19T22:56:36Z')`);
  const caso = await b.servicio<{ id: string; casoDeExito: boolean }>(`select id, "casoDeExito" from public.resells order by id`);
  assert.deepEqual(caso.map((x) => [x.id, x.casoDeExito]), [["rs_jean", true], ["rs_otro_dia", false]], "las 22:00 del 14 en Argentina");

  // Mariano cierra: grabó, con el link → va al testimonio del 14 (no al otro, creado en el mismo momento).
  await b.ejecutar(`update public.resells set testimonio = 'Grabó', "linkTestimonio" = 'https://drive.google.com/jean' where id = 'rs_jean'`);
  const t = await b.servicio<{ id: string; link: string; estadoVideo: string }>(`select id, link, "estadoVideo" from public.testimonios order by id`);
  assert.deepEqual(t.map((x) => [x.id, x.link]), [["tes_1", "https://drive.google.com/viejo"], ["tes_2", "https://drive.google.com/jean"]]);

  // «Llamada agendada» la puso la agenda de una llamada que ya era caso de éxito: si hoy dice que no, eligieron «No era para testimonio».
  await b.ejecutar(`insert into public.resells (id, "fechaHora", email, closer) values ('rs_dario', '2026-10-28T15:00:00Z', 'ana@x.com', 'Mariano Arias')`);
  await b.ejecutar(`insert into public.testimonios (id, "alumnoId", "followUp", "fechaGrabacion", "conQuien") values ('tes_ana', 'alu_nuevo', 'Llamada agendada', '2026-10-28', 'Mariano')`);
  assert.deepEqual((await b.servicio<{ c: boolean }>(`select "casoDeExito" c from public.resells where id = 'rs_dario'`))[0].c, false);
});
