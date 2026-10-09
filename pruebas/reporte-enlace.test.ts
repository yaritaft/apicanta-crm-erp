import test from "node:test";
import assert from "node:assert/strict";
import {
  armarMail, enlaceDeReporte, esCodigoValido, leerEnvio, limitador, mensajeParaAlumno, primerNombre,
} from "@/lib/reporte-enlace";
import { enviarPorResend, estadoEnResend, recibirDelAlumno } from "@/lib/reporte-servidor";
import type { BaseReportes } from "@/lib/reportes-servidor";
import type { Reporte } from "@/lib/types";

/* ==================================================================
   El reporte semanal con link único: el formulario público, el link, el mensaje
   para pegar, el mail por Resend y el guardado de lo que manda el alumno.
   ================================================================== */

const CODIGO = "3f2b8c1e-9d4a-4e6b-8a57-1c0d2e3f4a5b";

test("un código es un UUID: otra cosa no pasa (ni un número correlativo ni algo armado para romper)", () => {
  assert.equal(esCodigoValido(CODIGO), true);
  assert.equal(esCodigoValido(` ${CODIGO.toUpperCase()} `), true);
  for (const x of ["", "1", "APYON0007", "3f2b8c1e-9d4a-4e6b-8a57", `${CODIGO}'; drop table alumnos;--`, null, undefined, 7, {}]) {
    assert.equal(esCodigoValido(x), false, String(x));
  }
});

test("el link es siempre el mismo y con el código viene lleno; sin barras de más", () => {
  assert.equal(enlaceDeReporte("https://apicanta-erp.vercel.app"), "https://apicanta-erp.vercel.app/reporte");
  assert.equal(enlaceDeReporte("https://apicanta-erp.vercel.app/", CODIGO), `https://apicanta-erp.vercel.app/reporte?c=${CODIGO}`);
});

test("el mensaje para pegar en WhatsApp lleva el nombre, el link y el código", () => {
  const m = mensajeParaAlumno({ nombre: "ana lópez", enlace: "https://x.test/reporte?c=abc", codigo: CODIGO });
  assert.match(m, /^Hola Ana!/);
  assert.match(m, /https:\/\/x\.test\/reporte\?c=abc/);
  assert.ok(m.includes(CODIGO));
  assert.equal(primerNombre("  "), "");
  assert.match(mensajeParaAlumno({ nombre: "", enlace: "https://x.test", codigo: CODIGO }), /^Hola!/);
});

test("el mail escapa lo que escribe cualquiera: el nombre no puede meter HTML", () => {
  const m = armarMail({ nombre: "<img src=x onerror=alert(1)> Pepe", enlace: 'https://x.test/reporte?c=1"><script>' });
  assert.ok(!m.html.includes("<img"), m.html);
  assert.ok(!m.html.includes("<script>"), m.html);
  assert.match(m.html, /&lt;img/);
  assert.match(m.asunto, /reporte semanal/i);
  assert.match(m.texto, /https:\/\/x\.test/);
});

test("lo que manda el formulario: las tres cifras son obligatorias y se redondean; el bloqueo es opcional", () => {
  const ok = leerEnvio({ codigo: CODIGO, horas: "7,5", entrevistas: 2, postulaciones: "0", bloqueo: "  me trabé con Docker  " });
  assert.deepEqual(ok, { ok: true, valor: { codigo: CODIGO, horas: 8, entrevistas: 2, postulaciones: 0, bloqueo: "me trabé con Docker" } });
  const sin = leerEnvio({ codigo: CODIGO, horas: 0, entrevistas: 0, postulaciones: 0 });
  assert.equal(sin.ok && "bloqueo" in sin.valor, false);
});

test("los errores del formulario se dicen para el alumno y marcan el campo", () => {
  const f = (o: Record<string, unknown>) => leerEnvio({ codigo: CODIGO, horas: 1, entrevistas: 1, postulaciones: 1, ...o });
  const falta = f({ horas: "" });
  assert.equal(falta.ok, false);
  if (!falta.ok) { assert.equal(falta.campo, "horas"); assert.match(falta.error, /horas de estudio/); }
  const raro = f({ entrevistas: "muchas" });
  if (!raro.ok) { assert.equal(raro.campo, "entrevistas"); assert.match(raro.error, /número/); } else assert.fail();
  for (const [campo, valor] of [["horas", -1], ["horas", 169], ["postulaciones", 1001], ["entrevistas", Infinity]] as const) {
    assert.equal(f({ [campo]: valor }).ok, false, `${campo}=${valor}`);
  }
  const sinCodigo = leerEnvio({ horas: 1, entrevistas: 1, postulaciones: 1 });
  if (!sinCodigo.ok) assert.equal(sinCodigo.campo, "codigo"); else assert.fail();
  assert.equal(leerEnvio("hola").ok, false);
  assert.equal(leerEnvio([1]).ok, false);
  assert.equal(leerEnvio(null).ok, false);
});

test("el bloqueo se corta en 2000 caracteres", () => {
  const r = leerEnvio({ codigo: CODIGO, horas: 1, entrevistas: 1, postulaciones: 1, bloqueo: "x".repeat(5000) });
  assert.equal(r.ok && r.valor.bloqueo?.length, 2000);
});

test("el limitador frena a quien insiste y deja pasar a los demás y a quien espera", () => {
  const l = limitador(3, 60_000);
  assert.deepEqual([1, 2, 3, 4].map(() => l.golpea("a", 1_000)), [false, false, false, true]);
  assert.equal(l.golpea("b", 1_000), false);
  assert.equal(l.golpea("a", 1_000 + 61_000), false);
});

/* ---------- Guardar lo que mandó el alumno ---------- */

const ALUMNO = { id: "alu_1", nombre: "Ana López", email: "ana@mail.com" };
const OTRO = { id: "alu_2", nombre: "Ana López", email: "otra@mail.com" };

function baseDePrueba(existentes: { id: string; alumnoId: string; semanaDel: string }[] = []) {
  const guardados: Reporte[] = [];
  const base: BaseReportes = {
    alumnos: async () => [ALUMNO, OTRO],            // la base conoce a los dos: igual tiene que ser sólo ALUMNO
    reportesDe: async () => existentes,
    guardar: async (filas) => { guardados.push(...filas); },
  };
  return { base, guardados };
}

test("el reporte se guarda para el alumno del código, aunque otro se llame igual", async () => {
  const { base, guardados } = baseDePrueba();
  const r = await recibirDelAlumno(base, ALUMNO, { horas: 10, entrevistas: 2, postulaciones: 5, bloqueo: "nada" }, "2026-10-08", "2026-10-08T15:00:00.000Z");
  assert.ok(r.ok);
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0].alumnoId, "alu_1");
  assert.equal(guardados[0].horasEstudio, 10);
  assert.equal(guardados[0].estado, "completado");
  /* La semana del jueves 8/10 arranca el lunes 5/10. */
  assert.match(guardados[0].semanaDel, /^2026-10-05/);
  assert.equal(r.ok && r.nuevos, 1);
});

test("mandarlo de nuevo la misma semana reemplaza el reporte, no lo duplica", async () => {
  const primero = baseDePrueba();
  await recibirDelAlumno(primero.base, ALUMNO, { horas: 10, entrevistas: 2, postulaciones: 5 }, "2026-10-08", "2026-10-08T15:00:00.000Z");
  const id = primero.guardados[0].id;
  const segundo = baseDePrueba([{ id, alumnoId: "alu_1", semanaDel: primero.guardados[0].semanaDel }]);
  const r = await recibirDelAlumno(segundo.base, ALUMNO, { horas: 12, entrevistas: 3, postulaciones: 6 }, "2026-10-09", "2026-10-09T15:00:00.000Z");
  assert.ok(r.ok);
  assert.equal(r.ok && r.actualizados, 1);
  assert.equal(segundo.guardados[0].id, id);
  assert.equal(segundo.guardados[0].horasEstudio, 12);
});

/* ---------- Resend ---------- */

const CFG = { clave: "re_clave_secreta", desde: "Hackear IT <avisos@ejemplo.com>" };
const MAIL = { para: "ana@mail.com", asunto: "Tu reporte", texto: "hola", html: "<p>hola</p>" };
const respuesta = (cuerpo: unknown, status = 200) => async () => new Response(JSON.stringify(cuerpo), { status });

test("Resend: el mail sale con la clave y el remitente, y devuelve el id", async () => {
  let visto: { url: string; init: RequestInit } | null = null;
  const r = await enviarPorResend(CFG, MAIL, (async (url: string, init: RequestInit) => { visto = { url, init }; return new Response(JSON.stringify({ id: "env_1" })); }) as never);
  assert.deepEqual(r, { ok: true, id: "env_1" });
  assert.equal(visto!.url, "https://api.resend.com/emails");
  assert.equal((visto!.init.headers as Record<string, string>).Authorization, "Bearer re_clave_secreta");
  const cuerpo = JSON.parse(String(visto!.init.body));
  assert.deepEqual(cuerpo.to, ["ana@mail.com"]);
  assert.equal(cuerpo.from, CFG.desde);
});

test("Resend: un error no filtra la dirección ni la clave", async () => {
  const r = await enviarPorResend(CFG, MAIL, respuesta({ message: "The ana@mail.com address is not verified" }, 422) as never);
  assert.equal(r.ok, false);
  if (!r.ok) { assert.ok(!r.error.includes("ana@mail.com")); assert.ok(!r.error.includes("re_clave")); }
  const sinRed = await enviarPorResend(CFG, MAIL, (async () => { throw new Error("ECONNRESET re_clave_secreta"); }) as never);
  assert.deepEqual(sinRed, { ok: false, error: "No se pudo conectar con Resend." });
  const sinId = await enviarPorResend(CFG, MAIL, respuesta({}) as never);
  assert.equal(sinId.ok, false);
});

test("Resend: el estado de un envío es lo último que le pasó", async () => {
  assert.deepEqual(await estadoEnResend(CFG, "env_1", respuesta({ last_event: "delivered" }) as never), { ok: true, estado: "delivered" });
  assert.deepEqual(await estadoEnResend(CFG, "env_1", respuesta({}) as never), { ok: true, estado: "sent" });
  const mal = await estadoEnResend(CFG, "env_1", respuesta({ message: "no existe" }, 404) as never);
  assert.equal(mal.ok, false);
});
