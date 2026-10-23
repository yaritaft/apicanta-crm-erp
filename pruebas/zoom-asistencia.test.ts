import test from "node:test";
import assert from "node:assert/strict";
import { agruparParticipantes, avisoDePermisoZoom, clasesDelDia, clasesParaTraer, resumenGeneralZoom, resumirAsistencia, uuidEnLaDireccion } from "@/lib/zoom-asistencia";

const clase = { reunion: "84681899646", instancia: "abc==", tema: "Clase en vivo", inicio: "2026-10-20T22:00:00Z" };

test("zoom: quien se va y vuelve es una sola fila, con los minutos sumados", () => {
  const r = agruparParticipantes(clase, [
    { name: "Ana", user_email: "Ana@Mail.com", join_time: "2026-10-20T22:01:00Z", leave_time: "2026-10-20T22:30:00Z", duration: 1740 },
    { name: "Ana", user_email: "ana@mail.com", join_time: "2026-10-20T22:40:00Z", leave_time: "2026-10-20T23:10:00Z", duration: 1800 },
    { name: "Beto", user_email: "beto@mail.com", join_time: "2026-10-20T22:05:00Z", leave_time: "2026-10-20T22:15:00Z", duration: 600 },
  ]);
  assert.equal(r.length, 2);
  const ana = r.find((x) => x.email === "ana@mail.com")!;
  assert.equal(ana.minutos, 59);
  assert.equal(ana.entro, "2026-10-20T22:01:00Z");
  assert.equal(ana.salio, "2026-10-20T23:10:00Z");
  assert.equal(ana.id, "zoom_abc___ana@mail.com", "el id es de la clase y la persona: traerla de nuevo no la duplica");
});

test("zoom: sin mail no se puede atar a nadie, y no rompe", () => {
  assert.deepEqual(agruparParticipantes(clase, [{ name: "iPhone de Juan", duration: 100 }, { user_email: "", duration: 5 }, { user_email: "sin-arroba" }]), []);
});

test("zoom: el uuid con «/» o «//» se codifica dos veces; el resto una", () => {
  assert.equal(uuidEnLaDireccion("abc=="), "abc%3D%3D");
  assert.equal(uuidEnLaDireccion("/abc//d"), encodeURIComponent(encodeURIComponent("/abc//d")));
});

test("zoom: qué clases traer: las en curso esperan, las recientes se repiten cada 3 horas, las viejas una sola vez", () => {
  const ahora = +new Date("2026-10-22T12:00:00Z");
  const h = (n: number) => new Date(ahora - n * 3_600_000).toISOString();
  const inst = [
    { uuid: "encurso", start_time: h(1) },
    { uuid: "reciente-sin-traer", start_time: h(5) },
    { uuid: "reciente-traida-hace-1h", start_time: h(10) },
    { uuid: "reciente-traida-hace-5h", start_time: h(12) },
    { uuid: "vieja-traida", start_time: h(24 * 5) },
    { uuid: "vieja-sin-traer", start_time: h(24 * 6) },
    { uuid: "muy-vieja", start_time: h(24 * 60) },
  ];
  const traidas = new Map([
    ["reciente-traida-hace-1h", { traidoEn: h(1) }], ["reciente-traida-hace-5h", { traidoEn: h(5) }], ["vieja-traida", { traidoEn: h(24 * 4) }],
  ]);
  assert.deepEqual(clasesParaTraer(inst, traidas, ahora).map((x) => x.uuid), ["reciente-sin-traer", "reciente-traida-hace-5h", "vieja-sin-traer"]);
});

test("zoom: el aviso de permiso lista los scopes que hay que agregar, y otros errores no se confunden", () => {
  const a = avisoDePermisoZoom(400, { code: 4711, message: "Invalid access token, does not contain scopes:[meeting:read:list_past_instances, meeting:read:list_past_instances:admin]." });
  assert.match(a ?? "", /list_past_instances:admin.*list_past_participants:admin.*past_meeting:admin/);
  assert.equal(avisoDePermisoZoom(404, { message: "Meeting does not exist" }), null);
  assert.equal(avisoDePermisoZoom(429, null), null);
});

test("zoom: «asistió a X de Y» cuenta las clases desde que empezó, y una a la que fue siempre cuenta", () => {
  const clases = [
    { instancia: "a", reunion: "1", tema: "Clase 1", inicio: "2026-09-01T22:00:00Z", participantes: 40 },
    { instancia: "b", reunion: "1", tema: "Clase 2", inicio: "2026-10-06T22:00:00Z", participantes: 35 },
    { instancia: "c", reunion: "1", tema: "Clase 3", inicio: "2026-10-20T22:00:00Z", participantes: 30 },
  ];
  const r = resumirAsistencia(clases, [{ instancia: "c", minutos: 62.4 }, { instancia: "a", minutos: 10 }], { desde: "2026-10-01", hoy: +new Date("2026-10-22T12:00:00Z") });
  assert.deepEqual([r.asistio, r.deClases, r.minutos, r.activo], [2, 3, 72, true]);
  assert.deepEqual(r.lista.map((x) => [x.tema, x.fue]), [["Clase 3", true], ["Clase 2", false], ["Clase 1", true]]);
  assert.equal(r.ultima, "2026-10-20");
  const nunca = resumirAsistencia(clases, [], { desde: "2026-10-01", hoy: +new Date("2026-10-22T12:00:00Z") });
  assert.deepEqual([nunca.asistio, nunca.deClases, nunca.activo], [0, 2, false]);
});

test("zoom: el total sólo cuenta las reuniones de su programa (a un alumno de AI no se le cuenta la clase de Biz), salvo las que fue", () => {
  const clases = [
    { instancia: "a", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-01T22:00:00Z", participantes: 5 },
    { instancia: "b", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-08T22:00:00Z", participantes: 5 },
    { instancia: "c", reunion: "biz", tema: "Marketing", inicio: "2026-10-08T22:00:00Z", participantes: 5 },
    { instancia: "d", reunion: "biz", tema: "Marketing", inicio: "2026-10-15T22:00:00Z", participantes: 5 },
  ];
  const hoy = +new Date("2026-10-20T12:00:00Z");
  assert.equal(resumirAsistencia(clases, [{ instancia: "a", minutos: 30 }], { reuniones: ["ai"], hoy }).deClases, 2);
  assert.equal(resumirAsistencia(clases, [{ instancia: "a", minutos: 30 }, { instancia: "d", minutos: 5 }], { reuniones: ["ai"], hoy }).deClases, 3, "una a la que fue cuenta aunque sea de otra reunión");
  assert.equal(resumirAsistencia(clases, [], { hoy }).deClases, 4, "sin saber sus reuniones, todas");
});

test("zoom: una clase es una reunión en un día: las instancias partidas se juntan y las de uno o dos participantes no cuentan", () => {
  const clases = [
    { instancia: "i1", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-21T21:48:00Z", participantes: 40 },
    { instancia: "i2", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-21T22:10:00Z", participantes: 30 },
    { instancia: "i3", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-22T21:03:00Z", participantes: 1 },
    { instancia: "i4", reunion: "it", tema: "Seguimiento", inicio: "2026-10-21T20:00:00Z", participantes: 2 },
  ];
  const d = clasesDelDia(clases);
  assert.equal(d.length, 1, "la del 22 es el anfitrión solo y la de IT son dos personas");
  assert.deepEqual([d[0].instancias, d[0].participantes, d[0].dia], [["i1", "i2"], 70, "2026-10-21"]);
  const r = resumirAsistencia(clases, [{ instancia: "i2", minutos: 20 }, { instancia: "i1", minutos: 15 }], { hoy: +new Date("2026-10-23T12:00:00Z") });
  assert.deepEqual([r.asistio, r.deClases, r.minutos], [1, 1, 35], "entró a las dos partes de la misma clase: una sola clase, con los minutos sumados");
});

test("zoom: el general cuenta clases, personas, activos y quiénes nunca entraron", () => {
  const clases = [
    { instancia: "a", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-20T22:00:00Z", participantes: 10 },
    { instancia: "b", reunion: "ai", tema: "Consultas IA", inicio: "2026-10-22T22:00:00Z", participantes: 10 },
    { instancia: "x", reunion: "ai", tema: "Consultas IA", inicio: "2026-08-01T22:00:00Z", participantes: 10 },
  ];
  const asist = [
    { instancia: "a", email: "ana@mail.com", minutos: 60 }, { instancia: "b", email: "ana@mail.com", minutos: 50 },
    { instancia: "a", email: "beto@mail.com", minutos: 30 }, { instancia: "a", email: "externo@mail.com", minutos: 5 },
  ];
  const alumnos = [
    { id: "1", nombre: "Ana", email: "ANA@mail.com", estado: "activo", inicio: "2026-10-01" },
    { id: "2", nombre: "Beto", email: "beto@mail.com", estado: "activo", inicio: "2026-10-01" },
    { id: "3", nombre: "Cata", email: "cata@mail.com", estado: "activo", inicio: "2026-10-01" },
    { id: "4", nombre: "Dani", email: "dani@mail.com", estado: "baja", inicio: "2026-10-01" },
  ];
  const g = resumenGeneralZoom(clases, asist, alumnos, +new Date("2026-10-23T12:00:00Z"));
  assert.deepEqual([g.clases30, g.clasesTotal, g.personas30, g.promedio30], [2, 3, 3, 2], "2 clases en 30 días; ana, beto y un externo; (3 + 1) / 2 por clase");
  assert.deepEqual([g.activos, g.activosConAsistencia, g.activosNunca], [3, 2, 1]);
  assert.deepEqual(g.alumnos.map((f) => [f.nombre, f.asistio, f.deClases]), [["Ana", 2, 2], ["Beto", 1, 2], ["Cata", 0, 2], ["Dani", 0, 2]]);
  assert.equal(g.alumnos[0].pct, 100);
});
