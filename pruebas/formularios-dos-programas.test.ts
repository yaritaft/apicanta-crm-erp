import test from "node:test";
import assert from "node:assert/strict";
import { alumnosConProgramaSinReconocer, formularioDe, formulariosDe, formulariosDelAlumnoCon, formulariosQueSeLePiden, programasSinReconocer } from "@/lib/reporte-formularios";
import { armarMailConFormularios, enlaceDeReporte, mensajeConFormularios } from "@/lib/reporte-enlace";
import { planificarReportes } from "@/lib/reportes-webhook";
import { recordarReportes } from "@/lib/reporte-recordatorio";

/* Liliana (29/10): los 13 alumnos de Hackear Biz tienen que completar el formulario semanal de Biz y, además, el de Hackear IA
   (menos Romina Aresu y Rodrigo Mejido, que no son programadores). La app daba UN formulario por alumno: «Hackear IA» no se
   reconocía como Hackear IT, quien cursaba los dos no recibía el recordatorio y el segundo formulario de la semana pisaba al primero. */

const COD = "11111111-1111-4111-8111-111111111111";

test("Hackear IA y Hackear AI son el formulario de Hackear IT; quien cursa Biz e IA tiene los dos", () => {
  assert.deepEqual(formulariosDe(["Hackear Biz", "HACKEAR IA"]).map((f) => f.id), ["hackear-biz", "hackear-it"]);
  assert.deepEqual(formulariosDe(["HACKEAR IA"]).map((f) => f.id), ["hackear-it"]);
  assert.deepEqual(formulariosDe(["Hackear AI"]).map((f) => f.id), ["hackear-it"]);
  assert.deepEqual(formulariosDe(["Hackear IT", "Hackear Biz"]).map((f) => f.id), ["hackear-biz", "hackear-it"]);
  assert.deepEqual(formulariosDe(["Hackear Biz"]).map((f) => f.id), ["hackear-biz"], "Romina y Rodrigo: sólo Biz");
  assert.deepEqual(formulariosDe(["Principals"]), []);
  assert.deepEqual(formulariosDe([]), []);
  assert.deepEqual(formulariosDelAlumnoCon(null, "Mentoría").map((f) => f.id), ["hackear-it"], "sin programas: el plan de la venta");
  assert.equal(formularioDe(["Hackear Biz", "HACKEAR IA"]), null, "con los dos no hay UN formulario: se le da cada link");
  assert.equal(formularioDe(["Hackear Biz"])?.id, "hackear-biz");
});

test("los formularios que se le piden: activo y cursando; los dos si cursa los dos", () => {
  const ia = { programas: ["Hackear Biz", "HACKEAR IA"] };
  assert.deepEqual(formulariosQueSeLePiden({ estado: "activo" }, ia), ["hackear-biz", "hackear-it"]);
  assert.deepEqual(formulariosQueSeLePiden({ estado: "activo" }, { programas: ["Hackear Biz"] }), ["hackear-biz"]);
  assert.deepEqual(formulariosQueSeLePiden({ estado: "activo" }, { ...ia, followUp: "CASO DE EXITO" }), [], "Nahuel Abadia: ya terminó");
  assert.deepEqual(formulariosQueSeLePiden({ estado: "activo" }, { ...ia, followUp: "Outboarding" }), []);
  assert.deepEqual(formulariosQueSeLePiden({ estado: "egresado" }, ia), []);
});

test("cada formulario tiene su link con el mismo código", () => {
  assert.equal(enlaceDeReporte("https://x.app/", COD), `https://x.app/reporte?c=${COD}`);
  assert.equal(enlaceDeReporte("https://x.app", COD, "hackear-biz"), `https://x.app/reporte?c=${COD}&p=biz`);
  assert.equal(enlaceDeReporte("https://x.app", COD, "hackear-it"), `https://x.app/reporte?c=${COD}&p=it`);
  assert.equal(enlaceDeReporte("https://x.app", undefined, "hackear-it"), "https://x.app/reporte", "sin código no hay link personal");
});

test("el mensaje y el mail de quien completa dos formularios traen los dos links; con uno, queda como siempre", () => {
  const dos = [{ programa: "Hackear Biz", enlace: "https://x/r?c=1&p=biz" }, { programa: "Hackear IT", enlace: "https://x/r?c=1&p=it" }];
  const m = mensajeConFormularios({ nombre: "romina", codigo: COD, formularios: dos });
  assert.match(m, /^Hola Romina!/);
  for (const x of ["• Hackear Biz:", "https://x/r?c=1&p=biz", "• Hackear IT:", "https://x/r?c=1&p=it", COD]) assert.ok(m.includes(x), x);
  const mail = armarMailConFormularios({ nombre: "Ana <b>", formularios: dos });
  assert.equal(mail.asunto, "Tus formularios semanales de Hackear Biz y Hackear IT");
  assert.ok(mail.texto.includes("https://x/r?c=1&p=biz") && mail.texto.includes("https://x/r?c=1&p=it"));
  assert.ok(mail.html.includes("Completar Hackear Biz") && mail.html.includes("Completar Hackear IT"));
  assert.ok(!mail.html.includes("<b>"), "el nombre se escapa");
  const uno = armarMailConFormularios({ nombre: "Ana", formularios: [dos[0]] });
  assert.equal(uno.asunto, "Tu formulario semanal de Hackear Biz");
});

/* ---------- Un reporte por alumno, semana y formulario ---------- */

const ALUMNOS = [{ id: "alu_ana", nombre: "Ana", email: "ana@x.com" }];
const item = (formulario?: string) => ({
  posicion: 1, item: { email: "ana@x.com", alumno: "Ana", horas: 3, ...(formulario ? { detalle: { programa: formulario === "hackear-biz" ? "Hackear Biz" : "Hackear IT", formulario: formulario as "hackear-biz", respuestas: {} } } : {}) },
});

test("los dos formularios de la misma semana son dos reportes; el segundo ya no pisa al primero", () => {
  const biz = planificarReportes([item("hackear-biz")], ALUMNOS, [], "2026-11-03", "2026-11-03T15:00:00Z");
  assert.equal(biz.filas.length, 1);
  const existentes = [{ id: biz.filas[0].id, alumnoId: "alu_ana", semanaDel: biz.filas[0].semanaDel, formulario: "hackear-biz" }];
  const it = planificarReportes([item("hackear-it")], ALUMNOS, existentes, "2026-11-04", "2026-11-04T15:00:00Z");
  assert.equal(it.nuevos, 1, "es uno nuevo, no el que reemplaza");
  assert.notEqual(it.filas[0].id, biz.filas[0].id);
  /* Volver a mandar el mismo formulario sí reemplaza. */
  const otra = planificarReportes([item("hackear-biz")], ALUMNOS, [...existentes, { id: it.filas[0].id, alumnoId: "alu_ana", semanaDel: it.filas[0].semanaDel, formulario: "hackear-it" }], "2026-11-05", "2026-11-05T15:00:00Z");
  assert.equal(otra.actualizados, 1);
  assert.equal(otra.filas[0].id, biz.filas[0].id);
});

test("un reporte viejo sin formulario de esa semana se reemplaza con el primero que entra; el que no dice formulario sigue como antes", () => {
  const viejo = [{ id: "rep_cs_alu_ana_2026-11-02", alumnoId: "alu_ana", semanaDel: "2026-11-02T15:00:00.000Z", formulario: null }];
  const r = planificarReportes([item("hackear-biz")], ALUMNOS, viejo, "2026-11-03", "2026-11-03T15:00:00Z");
  assert.equal(r.actualizados, 1);
  assert.equal(r.filas[0].id, "rep_cs_alu_ana_2026-11-02");
  const sin = planificarReportes([item()], ALUMNOS, [], "2026-11-03", "2026-11-03T15:00:00Z");
  assert.equal(sin.filas[0].id, "rep_cs_alu_ana_2026-11-02", "el webhook sin formulario conserva su id de siempre");
});

/* ---------- El recordatorio de los lunes ---------- */

function base(tablas: Record<string, Record<string, unknown>[]>) {
  return {
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      const q = {
        select: () => q,
        in: (c: string, v: unknown[]) => { filas = filas.filter((f) => v.includes(f[c])); return q; },
        eq: (c: string, v: unknown) => { filas = filas.filter((f) => f[c] === v); return q; },
        gte: (c: string, v: string) => { filas = filas.filter((f) => String(f[c]) >= v); return q; },
        or: () => q,
        maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
        upsert: () => Promise.resolve({ error: null }),
        update: () => q,
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok, mal),
      };
      return q;
    },
  };
}

test("los lunes: quien cursa Biz e IA recibe un mail con el link de cada formulario que le falta; los de sólo Biz, el suyo", async () => {
  const cod = (n: number) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
  const db = base({
    alumnos: [
      { id: "a1", nombre: "Dos Sin Hacer", email: "dos@x.com", plan: "", estado: "activo" },
      { id: "a2", nombre: "Dos Hizo Biz", email: "biz@x.com", plan: "", estado: "activo" },
      { id: "a3", nombre: "Dos Todo", email: "todo@x.com", plan: "", estado: "activo" },
      { id: "a4", nombre: "Romina Sólo Biz", email: "romina@x.com", plan: "", estado: "activo" },
      { id: "a5", nombre: "Nahuel Caso de Éxito", email: "nahuel@x.com", plan: "", estado: "activo" },
    ],
    seguimiento_alumnos: [
      { alumnoId: "a1", programas: ["Hackear Biz", "HACKEAR IA"], followUp: "" },
      { alumnoId: "a2", programas: ["Hackear Biz", "HACKEAR IA"], followUp: "" },
      { alumnoId: "a3", programas: ["Hackear Biz", "HACKEAR IA"], followUp: "" },
      { alumnoId: "a4", programas: ["Hackear Biz"], followUp: "Avanzando" },
      { alumnoId: "a5", programas: ["Hackear Biz", "HACKEAR IA"], followUp: "CASO DE EXITO" },
    ],
    reportes: [
      { alumnoId: "a2", estado: "completado", semanaDel: "2026-11-02T15:00:00.000Z", formulario: "hackear-biz" },
      { alumnoId: "a3", estado: "completado", semanaDel: "2026-11-02T15:00:00.000Z", formulario: "hackear-biz" },
      { alumnoId: "a3", estado: "completado", semanaDel: "2026-11-02T15:00:00.000Z", formulario: "hackear-it" },
    ],
    reporte_codigos: [1, 2, 3, 4, 5].map((n) => ({ alumnoId: `a${n}`, codigo: cod(n) })),
    ajustes: [{ id: 1, bienvenida: {} }], equipo: [],
  });
  const mails: { para: string; asunto: string; texto: string }[] = [];
  const enviar = (async (_c: unknown, m: { para: string; asunto: string; texto: string }) => { mails.push(m); return { ok: true, id: `re_${mails.length}` }; }) as never;
  const r = await recordarReportes(db as never, "https://app.test", new Date("2026-11-02T13:00:00.000Z"), enviar, { clave: "x", desde: "y" });

  const de = (mail: string) => mails.find((m) => m.para === mail)!;
  assert.deepEqual(mails.map((m) => m.para).sort(), ["biz@x.com", "dos@x.com", "romina@x.com"], "Dos Todo ya hizo los dos; Nahuel ya terminó");
  assert.match(de("dos@x.com").asunto, /Hackear Biz y Hackear IT/);
  assert.match(de("dos@x.com").texto, /&p=biz/);
  assert.match(de("dos@x.com").texto, /&p=it/);
  assert.doesNotMatch(de("biz@x.com").texto, /&p=biz/, "le falta sólo el de IA");
  assert.match(de("biz@x.com").texto, /&p=it/);
  assert.match(de("biz@x.com").asunto, /Hackear IT/);
  assert.match(de("romina@x.com").asunto, /Hackear Biz/);
  assert.doesNotMatch(de("romina@x.com").texto, /&p=it/, "Romina no es programadora: sólo Biz");
  assert.deepEqual(r.salteados, { yaLoCompleto: 1, avisadoHace: 0, sinMail: 0, termino: 1 });
  assert.deepEqual(r.porPrograma, { "hackear-biz": 2, "hackear-it": 2 });
});

/* ---------- La raíz: un programa que la app no reconoce no puede dejar a nadie sin formulario en silencio ---------- */


/* Los programas y planes que tienen hoy los alumnos activos en producción (29/10). */
const REALES = ["Hackear IT", "HACKEAR IA", "Hackear AI", "Hackear Biz", "DOWNSELL", "Downsell", "Principals", "Devolución"];

test("todos los programas que existen hoy están clasificados: con formulario o sin formulario a propósito", () => {
  for (const p of REALES) assert.deepEqual(programasSinReconocer([p], null), [], p);
  for (const plan of ["Mentoría", "Hackear IT Full", "Upgrade AI", "Upsell", "Hackear Biz - 6 meses"]) {
    /* El plan de la venta sólo cuenta cuando el alumno no tiene programa cargado. */
    if (/upsell|upgrade/i.test(plan)) continue;
    assert.deepEqual(programasSinReconocer(null, plan), [], plan);
  }
});

test("un programa nuevo, o un alumno sin ninguno, se marca como sin reconocer", () => {
  assert.deepEqual(programasSinReconocer(["Hackear Pro"], null), ["Hackear Pro"]);
  assert.deepEqual(programasSinReconocer(["Hackear IT", "Hackear Pro"], null), ["Hackear Pro"], "los demás sí se reconocen");
  assert.deepEqual(programasSinReconocer([], ""), ["(sin programa ni plan)"]);
  assert.deepEqual(programasSinReconocer(null, null), ["(sin programa ni plan)"]);
  assert.deepEqual(programasSinReconocer(["  "], "Mentoría"), [], "un programa vacío cae al plan");
});

test("la lista de alumnos con programa sin reconocer: sólo los activos", () => {
  const segs = new Map<string, { programas?: unknown }>([["a1", { programas: ["Hackear Pro"] }], ["a2", { programas: ["Principals"] }], ["a3", { programas: ["Hackear Pro"] }]]);
  const lista = alumnosConProgramaSinReconocer([
    { id: "a1", nombre: "Ana", estado: "activo", plan: "" }, { id: "a2", nombre: "Beto", estado: "activo", plan: "" },
    { id: "a3", nombre: "Caro", estado: "egresado", plan: "" },
  ], segs);
  assert.deepEqual(lista, [{ id: "a1", nombre: "Ana", programas: ["Hackear Pro"] }]);
});

test("los lunes, quien tiene un programa nuevo no pasa desapercibido: Customer Success recibe el aviso con su nombre", async () => {
  const db = {
    escritos: [] as { tabla: string; datos: unknown }[],
    from(tabla: string) {
      const filas: Record<string, Record<string, unknown>[]> = {
        alumnos: [{ id: "a1", nombre: "Ana Pro", email: "ana@x.com", plan: "", estado: "activo" }, { id: "a2", nombre: "Beto IT", email: "beto@x.com", plan: "Mentoría", estado: "activo" }],
        seguimiento_alumnos: [{ alumnoId: "a1", programas: ["Hackear Pro"], followUp: "" }],
        equipo: [{ email: "lili@apicanta.com", activo: true }], reportes: [], reporte_codigos: [], ajustes: [{ id: 1, bienvenida: {} }],
      };
      const q = {
        select: () => q, in: () => q, eq: () => q, gte: () => q, or: () => q, update: () => q,
        maybeSingle: () => Promise.resolve({ data: (filas[tabla] ?? [])[0] ?? null, error: null }),
        upsert: (datos: unknown) => { db.escritos.push({ tabla, datos }); return Promise.resolve({ error: null }); },
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve({ data: filas[tabla] ?? [], error: null }).then(ok, mal),
      };
      return q;
    },
  };
  const r = await recordarReportes(db as never, "https://app.test", new Date("2026-11-02T13:00:00.000Z"), (async () => ({ ok: true, id: "x" })) as never, { clave: "x", desde: "y" });
  assert.deepEqual(r.sinReconocer, [{ id: "a1", nombre: "Ana Pro", programas: ["Hackear Pro"] }]);
  const avisos = db.escritos.filter((x) => x.tabla === "avisos").flatMap((x) => x.datos as Record<string, unknown>[]);
  assert.equal(avisos.length, 1, "aunque no haya salido ningún mail");
  assert.equal(avisos[0].para, "lili@apicanta.com");
  assert.match(String(avisos[0].titulo), /programa sin reconocer/);
  assert.match(String(avisos[0].cuerpo), /Ana Pro \(«Hackear Pro»\)/);
});
