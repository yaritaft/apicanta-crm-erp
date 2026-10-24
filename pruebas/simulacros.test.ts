import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  claseDeEntrada, codigoEnTexto, enlaceDeSimulacro, literalParaIlike, mailDeSimulacro, martesDeLaClase, mensajeDeSimulacro, otroMartes,
  problemaDeInscripcion, problemaDeResultado, resumenDeClase, resumenDeSimulacros, TIPOS_PEDIDOS,
} from "@/lib/simulacros";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (23/10): los simulacros de entrevista de los martes (condición del contrato: al menos uno). La inscripción pasa
   del Google Form a la app y después de la clase se carga cómo fue; queda en la ficha. */

test("el martes de la clase: hoy si es martes; si no, el próximo. Y la clase que se ve de entrada, la de esta semana", () => {
  assert.equal(martesDeLaClase("2026-10-27"), "2026-10-27", "martes");
  assert.equal(martesDeLaClase("2026-10-24"), "2026-10-27", "sábado: el martes que viene");
  assert.equal(martesDeLaClase("2026-10-28"), "2026-11-03", "miércoles: el de la semana siguiente");
  assert.equal(claseDeEntrada("2026-10-24"), "2026-10-20", "sábado: la del martes que pasó, para cargar cómo fue");
  assert.equal(claseDeEntrada("2026-10-27"), "2026-10-27");
  assert.equal(claseDeEntrada("2026-10-26"), "2026-10-20", "lunes: todavía la de la semana pasada");
  assert.equal(otroMartes("2026-10-27", -1), "2026-10-20");
  assert.equal(otroMartes("2026-10-27", 1), "2026-11-03");
});

test("la inscripción pide lo del Google Form menos quién es: eso lo dice su código", () => {
  const ok = { stack: "Full Stack", tipoPedido: TIPOS_PEDIDOS[1], preparado: true };
  assert.equal(problemaDeInscripcion(ok), null);
  assert.match(problemaDeInscripcion({ ...ok, stack: " " }) ?? "", /stack/);
  assert.match(problemaDeInscripcion({ ...ok, tipoPedido: "Cualquiera" }) ?? "", /tipo de entrevista/);
  assert.match(problemaDeInscripcion({ ...ok, preparado: false }) ?? "", /preparado/);
});

/* Juan Cruz (24/10): un solo código por alumno, el del reporte; el link personal ya lo trae. */
const CODIGO = "3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f";

test("el link personal trae el código; el general, no", () => {
  assert.equal(enlaceDeSimulacro("https://app.x/", CODIGO), `https://app.x/simulacro?c=${CODIGO}`);
  assert.equal(enlaceDeSimulacro("https://app.x"), "https://app.x/simulacro");
});

test("el código se encuentra en lo que pegue: el código, su link o el mensaje entero", () => {
  assert.equal(codigoEnTexto(CODIGO), CODIGO);
  assert.equal(codigoEnTexto(` ${CODIGO.toUpperCase()} `), CODIGO);
  assert.equal(codigoEnTexto(`Hola Ana! Tu link: https://app.x/reporte?c=${CODIGO}\nSi te pide tu código, es: ${CODIGO}`), CODIGO);
  assert.equal(codigoEnTexto("hola"), "");
  assert.equal(codigoEnTexto("12345"), "");
});

test("el mensaje para su WhatsApp y el mail llevan su link con el código", () => {
  const enlace = enlaceDeSimulacro("https://app.x", CODIGO);
  const m = mensajeDeSimulacro({ nombre: "santiago ayala", enlace });
  assert.match(m, /^Hola Santiago!/);
  assert.ok(m.includes(enlace));
  const mail = mailDeSimulacro({ nombre: "Ana", enlace, codigo: CODIGO });
  assert.ok(mail.texto.includes(enlace) && mail.texto.includes(`Tu código es ${CODIGO}`));
});

test("buscar un mail no deja que «_» o «%» hagan de comodín", () => {
  assert.equal(literalParaIlike("ana_perez@x.com"), "ana\\_perez@x.com");
  assert.equal(literalParaIlike("a%b@x.com"), "a\\%b@x.com");
});

test("cargar cómo fue: si se hizo, qué entrevista y quién la tomó; si fue otro motivo, cuál", () => {
  assert.match(problemaDeResultado({ estado: "inscripto" }) ?? "", /Elegí cómo fue/);
  assert.match(problemaDeResultado({ estado: "hecho" }) ?? "", /qué entrevista/);
  assert.match(problemaDeResultado({ estado: "hecho", tipoTomado: "Técnica" }) ?? "", /quién la tomó/);
  assert.equal(problemaDeResultado({ estado: "hecho", tipoTomado: "Técnica", responsable: "Yari" }), null);
  assert.equal(problemaDeResultado({ estado: "no_se_presento" }), null);
  assert.match(problemaDeResultado({ estado: "otro", motivo: " " }) ?? "", /qué pasó/);
});

test("la ficha dice si cumple la condición del contrato, y el panel cuántos faltan cargar", () => {
  assert.deepEqual(resumenDeSimulacros([]), { hechos: 0, ultimo: null, cumple: false, texto: "Todavía no hizo ningún simulacro" });
  assert.equal(resumenDeSimulacros([{ estado: "no_se_presento", fecha: "2026-10-21" }]).texto, "Se anotó pero todavía no hizo ningún simulacro");
  const dos = resumenDeSimulacros([{ estado: "hecho", fecha: "2026-10-14" }, { estado: "hecho", fecha: "2026-10-21" }]);
  assert.deepEqual([dos.cumple, dos.hechos, dos.ultimo, dos.texto], [true, 2, "2026-10-21", "Hizo 2 simulacros"]);
  assert.equal(resumenDeClase([{ estado: "hecho" }, { estado: "inscripto" }, { estado: "no_se_preparo" }]).texto, "3 inscriptos · 1 hecho · 1 sin cargar");
  assert.equal(resumenDeClase([]).texto, "Todavía no se anotó nadie");
  /* Las del Google Form (importadas el 24/10) no dicen si se hizo: ni «hizo» ni «no hizo ninguno», y no son «sin cargar» de la clase. */
  const gf = resumenDeSimulacros([{ estado: "sin_registro", fecha: "2026-06-02" }, { estado: "sin_registro", fecha: "2026-06-09" }]);
  assert.deepEqual([gf.cumple, gf.texto], [false, "Se anotó 2 veces por el Google Form: falta cargar si lo hizo"]);
  assert.equal(resumenDeSimulacros([{ estado: "sin_registro", fecha: "2026-06-02" }, { estado: "hecho", fecha: "2026-10-20" }]).texto, "Hizo 1 simulacro");
  assert.equal(resumenDeClase([{ estado: "sin_registro" }]).sinCargar, 0);
});

/* ---------- supabase/simulacros.sql en un Postgres en memoria (PGlite) ---------- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(`
    alter table public.alumnos add column nombre text, add column estado text default 'activo', add column inicio date, add column "leadId" text;
    create table public.seguimiento_alumnos (id text primary key, "alumnoId" text, telefono text);
    alter table public.leads add column telefono text;
    alter table public.contactos add column telefono text;
  `);
  await db.exec(sqlDe("alumnos-sin-duplicar.sql").match(/create or replace function public\.telefono_de_alumno[\s\S]*?\$\$;/)![0]);
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(sqlDe("simulacros.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  await b.ejecutar(`
    insert into public.alumnos (id, nombre, "ventaId", estado, inicio) values
      ('alu_santi', 'Santiago Ayala Restrepo', 'ven_1', 'activo', '2026-10-23'),
      ('alu_viejo', 'Santiago Viejo', null, 'graduado', '2025-01-01');
    insert into public.seguimiento_alumnos (id, "alumnoId", telefono) values
      ('seg_santi', 'alu_santi', '+57 319 282 2424'), ('seg_viejo', 'alu_viejo', '57 319 2822424');
    insert into public.usuarios_permitidos (email, rol) values ('dueno@x.com', 'dueno'), ('closer@x.com', 'closer');
  `);
  return b;
}

test("una inscripción se ata sola al alumno por el teléfono (el activo, con venta, primero)", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.simulacros (id, fecha, nombre, telefono, stack, "tipoPedido", preparado)
    values ('sim_1', '2026-10-27', 'Santi Ayala', '+57 3192822424', 'Full Stack', 'Algoritmia', true),
           ('sim_2', '2026-10-27', 'Alguien', '+54 9 11 0000 0000', 'Java', 'Algoritmia', true)`);
  const filas = await b.servicio<{ id: string; alumnoId: string | null }>(`select id, "alumnoId" from public.simulacros order by id`);
  assert.deepEqual(filas, [{ id: "sim_1", alumnoId: "alu_santi" }, { id: "sim_2", alumnoId: null }]);
});

test("los simulacros los ve y los carga quien edita alumnos; un closer no", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.simulacros (id, fecha, nombre) values ('sim_3', '2026-10-27', 'Alguien Más')`);
  const dueno = await b.intentar("dueno@x.com", `update public.simulacros set estado = 'hecho', "tipoTomado" = 'Técnica', responsable = 'Yari' where id = 'sim_3'`);
  assert.ok(dueno.ok && dueno.n === 1);
  const closer = await b.intentar<{ id: string }>("closer@x.com", `select id from public.simulacros`);
  assert.ok(closer.ok && closer.rows.length === 0, "el closer no los ve");
  const nadie = await b.intentar<{ id: string }>("nadie@x.com", `select id from public.simulacros`);
  assert.ok(nadie.ok && nadie.rows.length === 0, "una cuenta que no está habilitada, nada");
  const malo = await b.intentar("dueno@x.com", `update public.simulacros set estado = 'cualquiera' where id = 'sim_3'`);
  assert.equal(malo.ok, false, "sólo los estados conocidos");
});

test("la fecha de la clase no se corre un día por la hora de Argentina (salía «19 oct» para el martes 20)", async () => {
  const { diaDeClase } = await import("@/lib/simulacros");
  const { fechaLarga } = await import("@/lib/format");
  assert.match(diaDeClase("2026-10-20", fechaLarga), /^20 /);
  assert.match(diaDeClase("2026-10-27", fechaLarga), /^27 /);
});
