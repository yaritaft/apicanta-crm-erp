import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  cambiosDeResultado, enLaClase, juevesDeLaConsulta, NOMBRE_ESTADO_CONSULTA, otroJueves, problemaDeConsulta, resumenDeConsultas, ultimoJueves,
} from "@/lib/consultas";
import { codigoEnTexto, enlaceDelAlumno, esLinkDelAlumno, LINKS_DEL_ALUMNO, mailDelLink, mensajeDelLink } from "@/lib/links-alumno";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (24/10): las consultas de los jueves dejan el Google Form y entran a la app con el código del alumno (el mismo del
   reporte); después de la clase se carga quién la dio y qué pasó con cada una. */

test("la consulta es del jueves de la clase: el de hoy hasta las 18 h de Argentina; después, el siguiente", () => {
  assert.equal(juevesDeLaConsulta("2026-10-29T20:59:00.000Z"), "2026-10-29", "jueves 17:59 en Argentina");
  assert.equal(juevesDeLaConsulta("2026-10-29T21:00:00.000Z"), "2026-11-05", "jueves 18:00: ya empezó la clase");
  assert.equal(juevesDeLaConsulta("2026-10-30T02:30:00.000Z"), "2026-11-05", "jueves 23:30 en Argentina (ya viernes en UTC)");
  assert.equal(juevesDeLaConsulta("2026-10-24T15:00:00.000Z"), "2026-10-29", "sábado");
  assert.equal(juevesDeLaConsulta("2026-10-28T23:00:00.000Z"), "2026-10-29", "miércoles a la noche");
  assert.equal(otroJueves("2026-10-29", 1), "2026-11-05");
  assert.equal(otroJueves("2026-10-29", -1), "2026-10-22");
  assert.equal(ultimoJueves("2026-10-24"), "2026-10-22");
  assert.equal(ultimoJueves("2026-10-29"), "2026-10-29");
});

test("la consulta pide texto; quién es lo dice su código", () => {
  assert.match(problemaDeConsulta("") ?? "", /Escribí tu consulta/);
  assert.match(problemaDeConsulta("hola") ?? "", /Escribí tu consulta/);
  assert.equal(problemaDeConsulta("¿Cómo armo el take home?"), null);
  assert.match(problemaDeConsulta("x".repeat(3001)) ?? "", /muy larga/);
});

test("respondida y no se respondió quedan en su clase; «queda para la próxima» pasa al jueves siguiente sin responder", () => {
  const c = { fecha: "2026-10-29", postergada: 0 };
  assert.deepEqual(cambiosDeResultado(c, "respondida", "Yari", " minuto 12 ", "Lili"),
    { estado: "respondida", fecha: "2026-10-29", postergada: 0, responsable: "Yari", comentario: "minuto 12", cargadoPor: "Lili" });
  assert.equal(cambiosDeResultado(c, "no_respondida", "Nahuel", "", "Nahuel").estado, "no_respondida");
  const pasa = cambiosDeResultado(c, "proxima", "Yari", "", "Yari");
  assert.deepEqual([pasa.estado, pasa.fecha, pasa.postergada, pasa.comentario], ["recibida", "2026-11-05", 1, null]);
  assert.equal(cambiosDeResultado({ fecha: "2026-11-05", postergada: 1 }, "proxima", "Yari", "", "Yari").postergada, 2);
});

test("en la lista de una clase: las suyas y las que se hicieron antes y pasaron a otra", () => {
  assert.equal(enLaClase({ fecha: "2026-10-29", primeraFecha: "2026-10-29" }, "2026-10-29"), "de-la-clase");
  assert.equal(enLaClase({ fecha: "2026-11-05", primeraFecha: "2026-10-29" }, "2026-10-29"), "paso", "la de la clase del 29 que pasó al 5");
  assert.equal(enLaClase({ fecha: "2026-11-05", primeraFecha: "2026-10-29" }, "2026-11-05"), "de-la-clase", "y en la del 5 es de esa clase");
  assert.equal(enLaClase({ fecha: "2026-11-05", primeraFecha: "2026-10-29" }, "2026-10-22"), null);
  assert.equal(resumenDeConsultas([{ estado: "respondida" }, { estado: "recibida" }, { estado: "no_respondida" }]).texto, "3 consultas · 1 respondida · 1 sin cargar");
  assert.equal(resumenDeConsultas([]).texto, "Todavía no llegó ninguna consulta");
});

/* ---------- Un solo código para todo (Juan Cruz, 24/10) ---------- */
const CODIGO = "3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f";

test("los links del alumno: reporte, simulacro y consulta, todos con el mismo código", () => {
  assert.equal(enlaceDelAlumno("reporte", "https://app.x", CODIGO), `https://app.x/reporte?c=${CODIGO}`);
  assert.equal(enlaceDelAlumno("simulacro", "https://app.x/", CODIGO), `https://app.x/simulacro?c=${CODIGO}`);
  assert.equal(enlaceDelAlumno("consulta", "https://app.x"), "https://app.x/consulta");
  assert.ok(esLinkDelAlumno("consulta") && !esLinkDelAlumno("otra cosa") && !esLinkDelAlumno(undefined));
  for (const que of Object.keys(LINKS_DEL_ALUMNO) as (keyof typeof LINKS_DEL_ALUMNO)[]) {
    const enlace = enlaceDelAlumno(que, "https://app.x", CODIGO);
    assert.ok(mensajeDelLink(que, { nombre: "ana", enlace }).startsWith("Hola Ana!"), que);
    const mail = mailDelLink(que, { nombre: "Ana", enlace, codigo: CODIGO });
    assert.ok(mail.texto.includes(enlace) && mail.texto.includes(CODIGO), que);
    assert.equal(codigoEnTexto(mail.texto), CODIGO, "del mail se puede pegar el texto entero");
  }
  assert.match(mailDelLink("consulta", { enlace: "x", codigo: CODIGO }).texto, /dejar tu consulta para la clase de los jueves/);
});

test("unificar dos alumnos mueve TODAS las tablas con alumnoId: la lista ya no se escribe a mano", () => {
  const sql = sqlDe("unificar-alumnos.sql");
  assert.match(sql, /information_schema\.columns/);
  assert.match(sql, /column_name = 'alumnoId'/);
  /* Las únicas que se tratan aparte son las que tienen datos únicos o se combinan. */
  assert.match(sql, /not in \('alumnos', 'seguimiento_alumnos', 'reporte_codigos', 'accesos_alumno', 'reportes'\)/);
  for (const t of ["contratos", "simulacros", "consultas_clase", "testimonios"]) {
    assert.doesNotMatch(sql, new RegExp(`update (public\\.)?${t} set "alumnoId"`), `${t} no se escribe a mano`);
  }
});

test("las consultas viejas del Google Form entran como «Sin registro»: no cuentan como pendientes ni se inventa que se respondieron", () => {
  assert.equal(NOMBRE_ESTADO_CONSULTA.sin_registro, "Sin registro (Google Form)");
  assert.equal(resumenDeConsultas([{ estado: "sin_registro" }, { estado: "sin_registro" }]).sinCargar, 0);
  assert.match(sqlDe("consultas-clase.sql"), /'recibida', 'respondida', 'no_respondida', 'sin_registro'/);
  /* Quien sabe qué pasó la puede editar: el resultado la saca de «sin registro». */
  assert.equal(cambiosDeResultado({ fecha: "2026-09-10", postergada: 0 }, "respondida", "Yari", "", "Lili").estado, "respondida");
});

test("la página pública y las rutas no piden nombre, mail ni celular: sólo el código y la consulta", () => {
  const pagina = readFileSync("src/app/consulta/page.tsx", "utf8");
  assert.doesNotMatch(pagina, /Nombre completo|Correo electrónico|Número de celular/);
  assert.match(pagina, /\/api\/consultas\/enviar/);
  assert.match(pagina, /para: "consulta"/, "«No tengo mi código» le manda el link de consultas");
});

/* ---------- supabase/consultas-clase.sql en un Postgres en memoria (PGlite) ---------- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

async function banco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(sqlDe("consultas-clase.sql"));
  await db.exec(sqlDe("consultas-clase.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  await b.ejecutar(`
    insert into public.alumnos (id) values ('alu_1');
    insert into public.usuarios_permitidos (email, rol) values ('dueno@x.com', 'dueno'), ('closer@x.com', 'closer');
  `);
  return b;
}

test("las consultas las ve y las carga quien edita alumnos; un closer no; y la base frena lo que no tiene sentido", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(`insert into public.consultas_clase (id, fecha, "primeraFecha", "alumnoId", consulta) values ('cq_1', '2026-10-29', '2026-10-29', 'alu_1', '¿Docker o no?')`);
  const dueno = await b.intentar("dueno@x.com", `update public.consultas_clase set estado = 'respondida', responsable = 'Yari' where id = 'cq_1'`);
  assert.ok(dueno.ok && dueno.n === 1);
  const pasa = await b.intentar("dueno@x.com", `update public.consultas_clase set fecha = '2026-11-05', postergada = 1, estado = 'recibida' where id = 'cq_1'`);
  assert.ok(pasa.ok && pasa.n === 1, "pasar a la próxima clase corre la fecha");
  const closer = await b.intentar<{ id: string }>("closer@x.com", `select id from public.consultas_clase`);
  assert.ok(closer.ok && closer.rows.length === 0, "el closer no las ve");
  const nadie = await b.intentar<{ id: string }>("nadie@x.com", `select id from public.consultas_clase`);
  assert.ok(nadie.ok && nadie.rows.length === 0);
  assert.equal((await b.intentar("dueno@x.com", `update public.consultas_clase set estado = 'cualquiera' where id = 'cq_1'`)).ok, false, "sólo los estados conocidos");
  assert.equal((await b.intentar("dueno@x.com", `update public.consultas_clase set fecha = '2026-10-22' where id = 'cq_1'`)).ok, false, "no puede responderse antes de hacerla");
  assert.equal((await b.intentar("dueno@x.com", `insert into public.consultas_clase (id, fecha, "primeraFecha", consulta) values ('cq_2', '2026-10-29', '2026-10-29', '  ')`)).ok, false, "sin texto no");
  const tocada = await b.servicio<{ actualizado: boolean }>(`select "actualizadoEn" > "creadoEn" as actualizado from public.consultas_clase where id = 'cq_1'`);
  assert.equal(tocada[0].actualizado, true, "cada cambio deja cuándo");
});
