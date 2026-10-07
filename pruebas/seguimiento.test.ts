import test from "node:test";
import assert from "node:assert/strict";
import {
  aContactarHoy, aplicarCadencia, aplicarContacto, aplicarCorreccion, aplicarDejoDeContestar, aplicarNoContesto,
  configSeguimiento, CONFIG_POR_DEFECTO, diasEntre, filasDeSeguimiento, filtrarSeguimiento, idSeguimiento,
  formatoDia, proximoDe, resumenDeSeguimiento, seguimientoVacio, SIN_FILTROS, sumarDias, textoDeAtraso,
} from "@/lib/seguimiento";
import type { EstadoApp, SeguimientoAlumno, Testimonio } from "@/lib/types";

const HOY = "2026-10-07";
const CFG = CONFIG_POR_DEFECTO;

/* Cinco alumnos: Ana (entró hace 40 días y nunca la contactaron), Beto (contactado hace 20 días, cada 15),
   Cris (contactada hace 3 días, cada 7), Dani (dejó de contestar) y Eli (egresada). */
function estado(extra: Partial<EstadoApp> = {}): EstadoApp {
  const alumno = (id: string, nombre: string, inicio: string, estado = "activo", leadId?: string) =>
    ({ id, nombre, email: `${nombre.toLowerCase()}@mail.com`, estado, inicio, leadId, cohorte: "C1", plan: "Mentoría", extra: {} });
  const seg = (alumnoId: string, c: Partial<SeguimientoAlumno>): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CFG), ...c });
  return {
    ajustes: {},
    alumnos: [
      alumno("a1", "Ana", "2026-08-28T12:00:00.000Z", "activo", "l1"),
      alumno("a2", "Beto", "2026-06-01T12:00:00.000Z"),
      alumno("a3", "Cris", "2026-06-01T12:00:00.000Z"),
      alumno("a4", "Dani", "2026-06-01T12:00:00.000Z"),
      alumno("a5", "Eli", "2026-06-01T12:00:00.000Z", "egresado"),
    ],
    leads: [{ id: "l1", nombre: "Ana", email: "ana@mail.com", contactoId: "c1" }],
    contactos: [{ id: "c1", nombre: "Ana", email: "ana@mail.com", pais: "Chile", aniosExperiencia: 4, tecnologias: "React y Node" }],
    seguimientos: [
      seg("a2", { cadenciaDias: 15, ultimoContacto: "2026-09-17" }),
      seg("a3", { cadenciaDias: 7, ultimoContacto: "2026-10-04", cvCorregido: true }),
      seg("a4", { dejoDeContestar: true, ultimoContacto: "2026-08-01" }),
    ],
    testimonios: [],
    ...extra,
  } as unknown as EstadoApp;
}

test("los días se suman y se restan sin mezclar horas", () => {
  assert.equal(sumarDias("2026-10-07", 7), "2026-10-14");
  assert.equal(sumarDias("2026-10-30", 3), "2026-11-02");
  assert.equal(sumarDias("2026-01-02", -3), "2025-12-30");
  assert.equal(diasEntre("2026-10-01", "2026-10-07"), 6);
  assert.equal(diasEntre("2026-10-07", "2026-10-01"), -6);
});

test("la configuración se sanea y la cadencia de arranque es una de las elegibles", () => {
  assert.deepEqual(configSeguimiento(null), CONFIG_POR_DEFECTO);
  const c = configSeguimiento({ cadencias: [30, 10, 10, 0, -5, 999], cadenciaPorDefecto: 15, reintentoDias: 0, intentosHastaDejar: 4 });
  assert.deepEqual(c.cadencias, [10, 30]);
  assert.equal(c.cadenciaPorDefecto, 10, "15 no está entre las elegibles: queda la primera");
  assert.equal(c.reintentoDias, CONFIG_POR_DEFECTO.reintentoDias);
  assert.equal(c.intentosHastaDejar, 4);
});

test("a quien nunca se contactó le toca desde que entró, con la cadencia de arranque", () => {
  const f = filasDeSeguimiento(estado(), HOY).find((x) => x.id === "a1")!;
  /* Entró el 28/08 y la cadencia es 15: tocaba el 12/09, hace 25 días. */
  assert.equal(f.cadenciaDias, 15);
  assert.equal(f.ultimoContacto, null);
  assert.equal(f.proximoContacto, "2026-09-12");
  assert.equal(f.atraso, 25);
  assert.equal(f.situacion, "vencido");
  /* Los datos de la persona salen del contacto, por el lead. */
  assert.equal(f.pais, "Chile");
  assert.equal(f.aniosExperiencia, 4);
  assert.equal(f.tecnologias, "React y Node");
});

test("vencido, hoy y al día según la cadencia de cada uno", () => {
  const filas = filasDeSeguimiento(estado(), HOY);
  const de = (id: string) => filas.find((x) => x.id === id)!;
  /* Beto: 17/09 + 15 = 02/10, hace 5 días. */
  assert.equal(de("a2").proximoContacto, "2026-10-02");
  assert.equal(de("a2").situacion, "vencido");
  /* Cris: 04/10 + 7 = 11/10, faltan 4. */
  assert.equal(de("a3").atraso, -4);
  assert.equal(de("a3").situacion, "al-dia");
  assert.equal(de("a4").situacion, "no-contesta");
  assert.equal(de("a5").situacion, "fuera", "un egresado no entra al seguimiento");
  /* Justo hoy. */
  const hoy = filasDeSeguimiento(estado({ seguimientos: [{ ...seguimientoVacio("a3", CFG), cadenciaDias: 7, ultimoContacto: "2026-09-30" }] }), HOY);
  assert.equal(hoy.find((x) => x.id === "a3")!.situacion, "hoy");
});

test("la lista de hoy deja afuera a los que dejaron de contestar y a los inactivos, con lo más vencido arriba", () => {
  const lista = aContactarHoy(filasDeSeguimiento(estado(), HOY));
  assert.deepEqual(lista.map((f) => f.alumno.nombre), ["Ana", "Beto"]);
});

test("a igual atraso, primero el que lleva más intentos sin respuesta", () => {
  const e = estado({
    seguimientos: [
      { ...seguimientoVacio("a2", CFG), ultimoContacto: "2026-09-22", intentosSinRespuesta: 0 },
      { ...seguimientoVacio("a3", CFG), ultimoContacto: "2026-09-22", intentosSinRespuesta: 2 },
    ],
  });
  const lista = aContactarHoy(filasDeSeguimiento(e, HOY)).filter((f) => f.id === "a2" || f.id === "a3");
  assert.deepEqual(lista.map((f) => f.alumno.nombre), ["Cris", "Beto"]);
});

test("«lo contacté» pone el último contacto hoy, mueve el próximo y corta la racha", () => {
  const antes = { ...seguimientoVacio("a2", CFG), cadenciaDias: 20, intentosSinRespuesta: 2, ultimoIntento: "2026-10-05", dejoDeContestar: true };
  const despues = aplicarContacto(antes, HOY, "Lili");
  assert.equal(despues.ultimoContacto, HOY);
  assert.equal(despues.proximoContacto, "2026-10-27");
  assert.equal(despues.intentosSinRespuesta, 0);
  assert.equal(despues.dejoDeContestar, false, "si contestó, ya no «dejó de contestar»");
  assert.equal(despues.actualizadoPor, "Lili");
});

test("«no contestó» cuenta un intento, no cuenta como contacto y reintenta a los pocos días", () => {
  const s = seguimientoVacio("a2", CFG);
  const uno = aplicarNoContesto({ ...s, ultimoContacto: "2026-09-20" }, HOY, CFG);
  assert.equal(uno.ultimoContacto, "2026-09-20");
  assert.equal(uno.intentosSinRespuesta, 1);
  assert.equal(uno.proximoContacto, "2026-10-10");
  /* A los tres intentos seguidos se sugiere marcarlo; no se marca solo. */
  let seg = s;
  for (let i = 0; i < 3; i++) seg = aplicarNoContesto(seg, HOY, CFG);
  const f = filasDeSeguimiento(estado({ seguimientos: [{ ...seg, alumnoId: "a2" }] }), HOY).find((x) => x.id === "a2")!;
  assert.equal(f.sugerirDejoDeContestar, true);
  assert.equal(f.dejoDeContestar, false);
  assert.equal(f.situacion, "al-dia", "reintenta en 3 días: hoy no toca");
});

test("«dejó de contestar» saca al alumno de la lista de hoy, y desmarcarlo lo vuelve a poner", () => {
  const s = { ...seguimientoVacio("a2", CFG), ultimoContacto: "2026-09-01" };
  const e = estado({ seguimientos: [aplicarDejoDeContestar(s, true)] });
  assert.ok(!aContactarHoy(filasDeSeguimiento(e, HOY)).some((f) => f.id === "a2"));
  const e2 = estado({ seguimientos: [aplicarDejoDeContestar(aplicarDejoDeContestar(s, true), false)] });
  assert.ok(aContactarHoy(filasDeSeguimiento(e2, HOY)).some((f) => f.id === "a2"));
});

test("cambiar la cadencia recalcula el próximo desde el último contacto", () => {
  const s = { ...seguimientoVacio("a2", CFG), cadenciaDias: 15, ultimoContacto: "2026-09-30" };
  const a = aplicarCadencia(s, 7, { inicio: "2026-06-01T12:00:00.000Z" });
  assert.equal(a.cadenciaDias, 7);
  assert.equal(a.proximoContacto, "2026-10-07");
  /* Sin contacto, cuenta desde que entró. */
  const b = aplicarCadencia(seguimientoVacio("a1", CFG), 20, { inicio: "2026-08-28T12:00:00.000Z" });
  assert.equal(b.proximoContacto, "2026-09-17");
  assert.equal(proximoDe({ ultimoContacto: null, proximoContacto: null, cadenciaDias: 7 }, { inicio: "2026-08-28T12:00:00.000Z" }), "2026-09-04");
});

test("corregir el CV o el LinkedIn guarda el día; desmarcarlo lo borra", () => {
  const s = seguimientoVacio("a1", CFG);
  const cv = aplicarCorreccion(s, "cv", true, HOY);
  assert.equal(cv.cvCorregido, true);
  assert.equal(cv.cvCorregidoEn, HOY);
  assert.equal(cv.linkedinCorregido, false);
  const sin = aplicarCorreccion(cv, "cv", false, HOY);
  assert.equal(sin.cvCorregido, false);
  assert.equal(sin.cvCorregidoEn, null);
  assert.equal(aplicarCorreccion(s, "linkedin", true, HOY).linkedinCorregidoEn, HOY);
});

test("el id del seguimiento sale del alumno: dos personas escriben la misma fila", () => {
  assert.equal(idSeguimiento("alu_123"), "seg_alu_123");
  assert.equal(seguimientoVacio("alu_123", CFG).id, "seg_alu_123");
});

test("el resumen cuenta sólo a los activos y los pendientes de CV y LinkedIn", () => {
  const r = resumenDeSeguimiento(filasDeSeguimiento(estado(), HOY));
  assert.equal(r.activos, 4);
  assert.equal(r.vencidos, 2);
  assert.equal(r.hoy, 0);
  assert.equal(r.alDia, 1);
  assert.equal(r.noContestan, 1);
  assert.equal(r.sinCv, 3);
  assert.equal(r.sinLinkedin, 4);
});

test("los filtros combinan: situación, CV, país, cadencia, testimonio y búsqueda sin tildes", () => {
  const t: Testimonio = { id: "t1", alumnoId: "a3", estado: "grabado", link: "", fecha: "2026-10-01", notas: "", creadoEn: "2026-10-01T10:00:00.000Z" };
  const filas = filasDeSeguimiento(estado({ testimonios: [t] }), HOY);
  const nombres = (f: Partial<typeof SIN_FILTROS>) => filtrarSeguimiento(filas, { ...SIN_FILTROS, ...f }).map((x) => x.alumno.nombre);
  assert.deepEqual(nombres({ situacion: "vencido" }), ["Ana", "Beto"]);
  assert.deepEqual(nombres({ cv: "si" }), ["Cris"]);
  assert.deepEqual(nombres({ cv: "no", situacion: "vencido" }), ["Ana", "Beto"]);
  assert.deepEqual(nombres({ pais: "chile" }), ["Ana"]);
  assert.deepEqual(nombres({ cadencia: 7 }), ["Cris"]);
  assert.deepEqual(nombres({ testimonio: "grabado" }), ["Cris"]);
  assert.deepEqual(nombres({ testimonio: "sin" }), ["Ana", "Beto", "Dani", "Eli"]);
  assert.deepEqual(nombres({ q: "react" }), ["Ana"]);
  assert.deepEqual(nombres({ q: "BETO" }), ["Beto"]);
});

test("sin contacto ni lead, el país y los datos salen del alumno o del mail", () => {
  const e = estado({
    alumnos: [{ id: "a9", nombre: "Gus", email: "GUS@mail.com", pais: "Perú", estado: "activo", inicio: "2026-10-01T12:00:00.000Z", extra: {} }] as never,
    contactos: [{ id: "c9", nombre: "Gus", email: "gus@mail.com", aniosExperiencia: 2 }] as never,
    seguimientos: [],
  });
  const f = filasDeSeguimiento(e, HOY)[0];
  assert.equal(f.aniosExperiencia, 2, "el contacto se encuentra por el mail");
  assert.equal(f.pais, "Perú");
  assert.equal(f.situacion, "al-dia", "entró hace 6 días y la cadencia es 15");
});

test("el texto del atraso se lee en castellano", () => {
  assert.equal(textoDeAtraso(0), "Hoy");
  assert.equal(textoDeAtraso(1), "Venció ayer");
  assert.equal(textoDeAtraso(5), "Vencido hace 5 días");
  assert.equal(textoDeAtraso(-1), "Mañana");
  assert.equal(textoDeAtraso(-4), "En 4 días");
});

test("el día se lee corto, con el año sólo si no es el actual", () => {
  assert.equal(formatoDia("2026-10-07", HOY), "7 oct");
  assert.equal(formatoDia("2025-12-30", HOY), "30 dic 2025");
  assert.equal(formatoDia(null, HOY), "—");
});
