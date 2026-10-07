import test from "node:test";
import assert from "node:assert/strict";
import { avisoDeCuenta, evaluarClosers, resumenDelDia, seParecen, type AccesoDeCuenta } from "@/lib/cuenta-closer";
import { TIPOS_POR_DEFECTO } from "@/lib/permisos";
import { construirSemilla } from "@/lib/seed";
import type { MiembroEquipo, Sesion } from "@/lib/types";

const miembro = (id: string, nombre: string, extra: Partial<MiembroEquipo> = {}): MiembroEquipo =>
  ({ id, nombre, rol: "closer", comisionRate: 0.1, activo: true, sinComision: false, ...extra });

const AHORA = Date.parse("2026-10-08T14:00:00.000Z");
const llamada = (anfitrion: string, dias = 1): Pick<Sesion, "anfitrion" | "inicia"> =>
  ({ anfitrion, inicia: new Date(AHORA + dias * 86_400_000).toISOString() });
const acceso = (email: string, rol: string, nombre = ""): AccesoDeCuenta => ({ email, rol, nombre });

/* Los closers del seed: ninguno tiene su correo en Equipo, y Calendly trae a Dante Barbieri,
   Valentín Abadía y Mariano Arias. */
test("los closers del ejemplo: ninguno tiene correo; los que Calendly no trae no ven llamadas", () => {
  const e = construirSemilla();
  const r = evaluarClosers(e, null, TIPOS_POR_DEFECTO);
  const por = new Map(r.closers.map((c) => [c.miembro.nombre, c]));
  assert.deepEqual([...por.keys()].sort(), ["Dante Barbieri", "Marianela", "Mariano", "Martín", "Valentin Abadia", "Valentín"]);
  /* Sin correo no hay quién entre: nadie ve nada. */
  for (const c of r.closers) {
    assert.equal(c.estado, "no-ve", c.miembro.nombre);
    assert.ok(c.problemas.some((p) => p.tipo === "sin-correo"), c.miembro.nombre);
    /* Sin la lista de accesos no se afirma nada de ella. */
    assert.equal(c.acceso, undefined);
    assert.ok(!c.problemas.some((p) => p.tipo === "sin-acceso"));
  }
  /* Los tres que Calendly trae tienen sus llamadas; los otros tres, ninguna. */
  const conLlamadas = r.closers.filter((c) => c.anfitriones.length > 0).map((c) => c.miembro.nombre).sort();
  assert.deepEqual(conLlamadas, ["Dante Barbieri", "Mariano", "Valentin Abadia"]);
  const sinLlamadas = r.closers.filter((c) => c.problemas.some((p) => p.tipo === "sin-anfitrion")).map((c) => c.miembro.nombre).sort();
  assert.deepEqual(sinLlamadas, ["Marianela", "Martín", "Valentín"]);
  /* Los tres anfitriones de Calendly son de alguien: no queda ninguno suelto. */
  assert.deepEqual(r.anfitrionesSinDueno, []);
  assert.equal(r.sinVer, 6);
});

const EQUIPO: MiembroEquipo[] = [
  miembro("mariano", "Mariano", { email: "mariano@apicanta.com" }),
  miembro("dante", "Dante Barbieri", { email: "dante@apicanta.com" }),
  miembro("valentin", "Valentin Abadia", { email: "valentin@apicanta.com" }),
  miembro("santi", "Santiago Burghiani", { rol: "director", email: "santi@apicanta.com" }),
  miembro("viejo", "Eduardo Viejo", { activo: false }),
];

test("todo en orden: correo en Equipo, acceso de closer y su nombre en Calendly", () => {
  const e = { equipo: EQUIPO.slice(0, 1), sesiones: [llamada("Mariano Arias")] };
  const r = evaluarClosers(e, [acceso("mariano@apicanta.com", "closer", "Mariano Arias")], TIPOS_POR_DEFECTO, AHORA);
  assert.equal(r.closers.length, 1);
  assert.equal(r.closers[0].estado, "ok");
  assert.deepEqual(r.closers[0].problemas, []);
  assert.deepEqual(r.closers[0].anfitriones, [{ nombre: "Mariano Arias", llamadas: 1 }]);
  assert.equal(r.sinVer, 0);
});

test("falta su correo en Equipo, pero hay un acceso de closer con su nombre: se le sugiere", () => {
  const e = {
    equipo: [miembro("mariano", "Mariano"), miembro("dante", "Dante Barbieri", { email: "dante@apicanta.com" })],
    sesiones: [llamada("Mariano Arias"), llamada("Dante Barbieri")],
  };
  const accesos = [acceso("mariano.arias@gmail.com", "closer", "Mariano Arias"), acceso("dante@apicanta.com", "closer", "Dante Barbieri")];
  const r = evaluarClosers(e, accesos, TIPOS_POR_DEFECTO, AHORA);
  const m = r.closers.find((c) => c.miembro.id === "mariano")!;
  assert.equal(m.estado, "no-ve");
  assert.deepEqual(m.problemas, [{ tipo: "sin-correo", sugerido: accesos[0] }]);
  /* El mismo problema, visto desde el acceso: entra como closer y la app no sabe quién es. */
  assert.deepEqual(r.accesosSinMiembro.map((x) => [x.acceso.email, x.candidatos.map((c) => c.nombre)]), [["mariano.arias@gmail.com", ["Mariano"]]]);
  /* Dante está bien. */
  assert.equal(r.closers.find((c) => c.miembro.id === "dante")!.estado, "ok");
  assert.equal(r.sinVer, 2);
});

test("su nombre no coincide con el anfitrión de Calendly: no ve llamadas, y se dice cuál es el parecido", () => {
  const e = {
    equipo: [miembro("valentin", "Valentin Abadia", { email: "valentin@apicanta.com" }), miembro("marianela", "Marianela", { email: "marianela@apicanta.com" })],
    sesiones: [llamada("V. Abadia"), llamada("V. Abadia"), llamada("Pedro Prueba")],
  };
  const accesos = [acceso("valentin@apicanta.com", "closer"), acceso("marianela@apicanta.com", "closer")];
  const r = evaluarClosers(e, accesos, TIPOS_POR_DEFECTO, AHORA);
  const v = r.closers.find((c) => c.miembro.id === "valentin")!;
  assert.equal(v.estado, "no-ve");
  assert.deepEqual(v.problemas, [{ tipo: "sin-anfitrion", candidatos: [{ nombre: "V. Abadia", llamadas: 2 }] }]);
  /* Los dos anfitriones sueltos, con a quién se parecen: «Pedro Prueba» no se parece a nadie. */
  assert.deepEqual(r.anfitrionesSinDueno.map((a) => [a.nombre, a.llamadas, a.candidatos.map((c) => c.id)]), [["V. Abadia", 2, ["valentin"]], ["Pedro Prueba", 1, []]]);
  /* Marianela tiene correo y acceso, pero Calendly no tiene nada a su nombre: tampoco ve llamadas (todavía). */
  const m = r.closers.find((c) => c.miembro.id === "marianela")!;
  assert.deepEqual(m.problemas, [{ tipo: "sin-anfitrion", candidatos: [] }]);
});

test("con correo pero sin acceso todavía no puede entrar: es un aviso, no «no ve nada»", () => {
  const e = { equipo: [miembro("dante", "Dante Barbieri", { email: "dante@apicanta.com" })], sesiones: [llamada("Dante Barbieri")] };
  const r = evaluarClosers(e, [], TIPOS_POR_DEFECTO, AHORA);
  assert.equal(r.closers[0].estado, "sin-acceso");
  assert.deepEqual(r.closers[0].problemas, [{ tipo: "sin-acceso" }]);
  assert.equal(r.sinVer, 0, "todavía no entra: no cuenta como alguien que no ve");
});

test("quien tiene un acceso que ve todo no depende de su nombre ni de Calendly", () => {
  const e = { equipo: [miembro("santi", "Santiago Burghiani", { email: "santi@apicanta.com" })], sesiones: [llamada("Dante Barbieri")] };
  const r = evaluarClosers(e, [acceso("santi@apicanta.com", "director")], TIPOS_POR_DEFECTO, AHORA);
  assert.equal(r.closers[0].estado, "ok");
  assert.deepEqual(r.closers[0].problemas, []);
});

test("los que ya no están no se evalúan, y un anfitrión de hace meses no es un problema de hoy", () => {
  const e = { equipo: EQUIPO, sesiones: [llamada("Eduardo Viejo", -200), llamada("Nadie Conocido", -90), llamada("Otro Suelto", 3)] };
  const r = evaluarClosers(e, null, TIPOS_POR_DEFECTO, AHORA);
  assert.ok(!r.closers.some((c) => c.miembro.id === "viejo" || c.miembro.id === "santi"), "ni el que se fue ni el director");
  assert.deepEqual(r.anfitrionesSinDueno.map((a) => a.nombre), ["Otro Suelto"]);
});

test("un tipo de cuenta propio de «sólo lo suyo» también cuenta como closer", () => {
  const tipos = [...TIPOS_POR_DEFECTO, { id: "closer-jr", nombre: "Closer junior", descripcion: "", areas: {}, soloLoSuyo: true, orden: 9 }];
  const e = { equipo: [miembro("dante", "Dante Barbieri", { email: "dante@apicanta.com" })], sesiones: [llamada("Dante Barbieri")] };
  const r = evaluarClosers(e, [acceso("pedro@x.com", "closer-jr", "Pedro"), acceso("yari@x.com", "dueno", "Yari")], tipos, AHORA);
  assert.deepEqual(r.accesosSinMiembro.map((x) => x.acceso.email), ["pedro@x.com"], "el dueño no es un closer sin ficha");
});

test("se parecen si comparten el nombre de pila o el apellido", () => {
  assert.ok(seParecen("V. Abadia", "Valentin Abadia"));
  assert.ok(seParecen("Valentín", "Valentin Abadia"));
  assert.ok(seParecen("DANTE B.", "Dante Barbieri"));
  assert.ok(!seParecen("Pedro Prueba", "Dante Barbieri"));
  assert.ok(!seParecen("", "Dante Barbieri"));
});

/* ---------- Del lado del closer ---------- */

test("el closer que entra y no ve nada sabe por qué", () => {
  const base = { soloLoSuyo: true, email: "dante@apicanta.com", llamadasVisibles: 0, cargado: true };
  assert.deepEqual(avisoDeCuenta(base), { tipo: "sin-miembro", email: "dante@apicanta.com" });
  assert.deepEqual(avisoDeCuenta({ ...base, miembro: { nombre: "Dante Barbieri" } }), { tipo: "sin-llamadas", nombre: "Dante Barbieri" });
  /* Con llamadas, o sin saber todavía, o si ve todo, o sin sesión (la app local): nada. */
  assert.equal(avisoDeCuenta({ ...base, miembro: { nombre: "Dante Barbieri" }, llamadasVisibles: 3 }), null);
  assert.equal(avisoDeCuenta({ ...base, cargado: false }), null);
  assert.equal(avisoDeCuenta({ ...base, soloLoSuyo: false }), null);
  assert.equal(avisoDeCuenta({ ...base, email: null }), null);
});

test("el día: cuántas llamadas hay hoy y cuántas faltan cargar, hoy y de los días anteriores", () => {
  const fila = (dia: string, resultado = "Por venir", sinCargar = false) => ({ dia, resultado, sinCargar });
  const filas = [
    fila("2026-10-08"), fila("2026-10-08", "Sin cargar", true), fila("2026-10-08", "Con cierre"), fila("2026-10-08", "Cancelada"),
    fila("2026-10-07", "Sin cargar", true), fila("2026-10-01", "Sin cargar", true),
    /* Hace más de dos semanas, o mañana: no cuentan. */
    fila("2026-09-20", "Sin cargar", true), fila("2026-10-09"),
  ];
  assert.deepEqual(resumenDelDia(filas, "2026-10-08"), { hoy: 3, sinCargarHoy: 1, sinCargarAntes: 2 });
  assert.deepEqual(resumenDelDia([], "2026-10-08"), { hoy: 0, sinCargarHoy: 0, sinCargarAntes: 0 });
});
