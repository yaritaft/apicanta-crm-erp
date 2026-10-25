import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  alumnoSugerido, idSinAlumno, leerEnvioSinCodigo, PREGUNTAS_IDENTIDAD, problemaDeIdentidad, reporteParaAtar, separarIdentidad,
} from "@/lib/reporte-sin-codigo";
import { leerEnvio } from "@/lib/reporte-enlace";
import { FORMULARIOS } from "@/lib/reporte-formularios";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";

/* Lili (24/10): «un link general (como el de simulacros y consultas), y si no tienen clave, cargando su mail lo pueden completar;
   y los ~100 alumnos de 2024 y 2025 que no están en la app, que completen nombre, apellido y teléfono para rescatar la info». */

const IT = { horas: 6, entrevistas: 1, postulaciones: 12, bloqueo: "Docker" };
const DATOS = { email: " Ana@Gmail.com ", nombre: " Ana ", apellido: "López  Díaz", telefono: "+54 9 11 5555-1111" };

test("sin código se pide mail, nombre, apellido y WhatsApp, uno por vez y antes de las preguntas del programa", () => {
  assert.deepEqual(PREGUNTAS_IDENTIDAD.map((p) => p.id), ["_email", "_nombre", "_apellido", "_telefono"]);
  assert.equal(problemaDeIdentidad("_email", "ana@"), "Escribí tu mail.");
  assert.equal(problemaDeIdentidad("_email", "Ana@Gmail.com"), null);
  assert.equal(problemaDeIdentidad("_nombre", "A"), "Escribí tu nombre.");
  assert.equal(problemaDeIdentidad("_telefono", "1234"), "Escribí tu WhatsApp.");
  assert.equal(problemaDeIdentidad("_telefono", "+54 9 11 5555-1111"), null);
  assert.deepEqual(separarIdentidad({ _email: "a@b.co", _nombre: "Ana", horas: 3 }), { datos: { email: "a@b.co", nombre: "Ana" }, respuestas: { horas: 3 } });
});

test("lo que manda sin código se revisa igual que con código: los datos de quién es y las respuestas de su programa", () => {
  const v = leerEnvioSinCodigo({ sinCodigo: DATOS, formulario: "hackear-it", respuestas: IT });
  assert.ok(v.ok);
  assert.deepEqual(v.valor.datos, { email: "ana@gmail.com", nombre: "Ana", apellido: "López Díaz", telefono: "+54 9 11 5555-1111" });
  assert.equal(v.valor.formulario.id, "hackear-it");
  const sinMail = leerEnvioSinCodigo({ sinCodigo: { ...DATOS, email: "" }, formulario: "hackear-it", respuestas: IT });
  assert.ok(!sinMail.ok && sinMail.campo === "_email", "vuelve a la pregunta del mail");
  const sinTel = leerEnvioSinCodigo({ sinCodigo: { ...DATOS, telefono: "123" }, formulario: "hackear-it", respuestas: IT });
  assert.ok(!sinTel.ok && sinTel.campo === "_telefono");
  const mal = leerEnvioSinCodigo({ sinCodigo: DATOS, formulario: "hackear-it", respuestas: { ...IT, horas: -1 } });
  assert.ok(!mal.ok && mal.campo === "horas", "una respuesta del programa mal, igual que con código");
  assert.equal(leerEnvio({ codigo: "x", formulario: "hackear-it", respuestas: IT }).ok, false, "con código sigue pidiendo un código válido");
});

test("uno por mail y semana: mandarlo dos veces lo reemplaza; y al atarlo se copia como el reporte con código", () => {
  assert.equal(idSinAlumno("Ana@Gmail.com ", "2026-10-26"), idSinAlumno("ana@gmail.com", "2026-10-26"));
  assert.notEqual(idSinAlumno("ana@gmail.com", "2026-10-26"), idSinAlumno("ana@gmail.com", "2026-11-02"));
  assert.notEqual(idSinAlumno("ana@gmail.com", "2026-10-26"), idSinAlumno("beto@gmail.com", "2026-10-26"));
  assert.match(idSinAlumno("ana@gmail.com", "2026-10-26"), /^rsa_20261026_[0-9a-z]+$/);
  assert.deepEqual(reporteParaAtar(FORMULARIOS["hackear-it"], IT), {
    programa: "Hackear IT", formulario: "hackear-it", respuestas: IT, horasEstudio: 6, entrevistas: 1, postulaciones: 12, bloqueo: "Docker",
  });
});

test("en la app sugiere el alumno por mail, por WhatsApp o por nombre (si es uno solo)", () => {
  const alumnos = [
    { id: "a1", nombre: "Ana López Díaz", email: "ana.vieja@hotmail.com" },
    { id: "a2", nombre: "Beto Pérez", email: "beto@gmail.com" },
    { id: "a3", nombre: "Juan García", email: "" }, { id: "a4", nombre: "Juan García", email: "" },
  ];
  const tel = (id: string) => ({ a2: "+54 9 11 4444 2222" } as Record<string, string>)[id];
  const r = (x: Partial<{ email: string; nombre: string; apellido: string; telefono: string }>) => ({ email: "", nombre: "", apellido: "", telefono: "", ...x });
  assert.equal(alumnoSugerido(r({ email: "BETO@gmail.com" }), alumnos, tel)?.por, "mail");
  assert.deepEqual(alumnoSugerido(r({ email: "otro@x.com", telefono: "11 4444-2222" }), alumnos, tel), { alumno: alumnos[1], por: "WhatsApp" });
  assert.deepEqual(alumnoSugerido(r({ nombre: "ana", apellido: "lopez diaz" }), alumnos, tel), { alumno: alumnos[0], por: "nombre" });
  assert.equal(alumnoSugerido(r({ nombre: "Juan", apellido: "García" }), alumnos, tel), null, "dos con el mismo nombre: no adivina");
});

test("la página y el servidor: «No tengo mi código» entra sin código, y la respuesta no dice si el mail es de un alumno", () => {
  const pagina = readFileSync("src/app/reporte/page.tsx", "utf8");
  assert.match(pagina, /No tengo mi código/);
  assert.match(pagina, /PREGUNTAS_IDENTIDAD/);
  const ruta = readFileSync("src/app/api/reportes/enviar/route.ts", "utf8");
  assert.match(ruta, /recibirSinCodigo/);
  const sinCodigo = ruta.slice(ruta.indexOf("async function sinCodigo"));
  assert.match(sinCodigo, /NextResponse\.json\(\{ ok: true, reemplazo: r\.reemplazo \}/, "sin nombre ni nada que diga si encontró al alumno");
});

/* ---------- supabase/reportes-sin-alumno.sql en un Postgres en memoria (PGlite) ---------- */

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
  await db.exec(sqlDe("reportes-sin-alumno.sql"));
  await db.exec(sqlDe("reportes-sin-alumno.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  await b.ejecutar(`
    insert into public.alumnos (id) values ('alu_1');
    insert into public.usuarios_permitidos (email, rol) values ('dueno@x.com', 'dueno'), ('closer@x.com', 'closer');
    insert into public.reportes_sin_alumno (id, email, nombre, apellido, telefono, "semanaDel") values ('rsa_1', 'ana@x.com', 'Ana', 'López', '+54 9 11 5555 1111', '2026-10-26T15:00:00Z');
  `);
  return b;
}

test("los reportes sin alumno los ve y los ata quien edita alumnos; un closer no; atado sin alumno no", { skip: saltear }, async () => {
  const b = await banco();
  const atar = await b.intentar("dueno@x.com", `update public.reportes_sin_alumno set estado = 'atado', "alumnoId" = 'alu_1', "reporteId" = 'rep_1' where id = 'rsa_1'`);
  assert.ok(atar.ok && atar.n === 1, JSON.stringify(atar));
  const closer = await b.intentar<{ id: string }>("closer@x.com", `select id from public.reportes_sin_alumno`);
  assert.ok(closer.ok && closer.rows.length === 0, "el closer no los ve");
  const nadie = await b.intentar("nadie@x.com", `update public.reportes_sin_alumno set estado = 'descartado' where id = 'rsa_1'`);
  assert.ok(!nadie.ok || nadie.n === 0);
  assert.equal((await b.intentar("dueno@x.com", `update public.reportes_sin_alumno set estado = 'atado', "alumnoId" = null where id = 'rsa_1'`)).ok, false, "atado sin alumno no");
  assert.equal((await b.intentar("dueno@x.com", `update public.reportes_sin_alumno set estado = 'cualquiera' where id = 'rsa_1'`)).ok, false);
  const crear = await b.intentar("dueno@x.com", `insert into public.reportes_sin_alumno (id, "semanaDel") values ('rsa_2', now())`);
  assert.equal(crear.ok, false, "sólo los crea el servidor (el formulario público)");
});
