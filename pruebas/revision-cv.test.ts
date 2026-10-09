import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { ESTADOS_CV, revisionCvNormal } from "@/lib/revision-cv";
import { EDITAN, LEEN, TIPOS_POR_DEFECTO, puedeEditar, puedeLeer, type MiAcceso } from "@/lib/permisos";
import type { EstadoApp } from "@/lib/types";

/* La revisión de CVs de Customer Success (lib/revision-cv.ts, supabase/revision-cv.sql): lo que se guarda de cada una, cómo se
   carga y se corrige en el almacén, y quién la ve y la edita. Con datos inventados: nada de alumnos reales. */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
fijarAcceso(null);

/* ---------- Lo que se guarda ---------- */

test("una revisión sin datos queda con todas sus columnas vacías, sin inventar nada", () => {
  const r = revisionCvNormal({ id: "cv_vacia" });
  assert.deepEqual({ ...r, creadoEn: "", actualizadoEn: "" }, {
    id: "cv_vacia", nombre: "", telefono: "", alumnoId: null, estado: "", cvRecibido: false, correccion1: false, correccion2: false,
    fechaInicio: null, linkCv: "", linkLinkedin: "", linkCorreccion: "", linkLoom: "", notas: "", mensajes: "", origen: "manual",
    creadoEn: "", actualizadoEn: "", actualizadoPor: "",
  });
  assert.ok(!Number.isNaN(Date.parse(r.creadoEn)) && !Number.isNaN(Date.parse(r.actualizadoEn)), "las marcas de tiempo son fechas de verdad");
});

test("se limpian los textos, las casillas y el día; el día se guarda como texto «aaaa-mm-dd» (no se corre un día en Argentina)", () => {
  const r = revisionCvNormal({
    id: "cv_1", nombre: "  Ana Prueba  ", telefono: " +54 9 11 5555-0000 ", estado: " Con Yari ", linkCorreccion: "  https://docs.google.com/document/d/abc  ",
    cvRecibido: true, correccion1: "true" as unknown as boolean, correccion2: "false" as unknown as boolean, fechaInicio: "2026-10-09T23:30:00.000-03:00",
    alumnoId: "", origen: "importado", notas: "  sin recortar  ",
  });
  assert.deepEqual([r.nombre, r.telefono, r.estado, r.linkCorreccion], ["Ana Prueba", "+54 9 11 5555-0000", "Con Yari", "https://docs.google.com/document/d/abc"]);
  assert.deepEqual([r.cvRecibido, r.correccion1, r.correccion2], [true, true, false]);
  assert.equal(r.fechaInicio, "2026-10-09", "el día que escribió quien lo cargó, sin pasar por una zona horaria");
  assert.equal(r.alumnoId, null, "un texto vacío no es un alumno");
  assert.equal(r.origen, "importado");
  assert.equal(r.notas, "  sin recortar  ", "las notas se guardan como se escribieron");
  /* Lo que no es un día de verdad no entra. */
  for (const malo of ["9/10/2026", "9 de octubre de 2026", "", "mañana", 20261009, null, undefined]) {
    assert.equal(revisionCvNormal({ id: "x", fechaInicio: malo as never }).fechaInicio, null, `fechaInicio ${String(malo)}`);
  }
  /* Un origen raro es «manual». */
  assert.equal(revisionCvNormal({ id: "x", origen: "calendly" as never }).origen, "manual");
});

test("los estados de fábrica son los seis de la base de Notion, en el orden del proceso, sin repetir", () => {
  assert.deepEqual([...ESTADOS_CV], ["En proceso", "Esperando cliente", "Segunda ronda", "Con Yari", "Cerrado", "Outboarding"]);
  assert.equal(new Set(ESTADOS_CV.map((e) => e.toLowerCase())).size, ESTADOS_CV.length);
});

/* ---------- El almacén ---------- */

test("una revisión se guarda, se corrige y se borra, sin tocar nada más del estado", () => {
  const antes = estado();
  const sinRevisiones = (e: EstadoApp) => JSON.stringify({ ...e, revisionesCv: undefined, actividad: undefined });
  const id = "cv_prueba_1";
  assert.equal((antes.revisionesCv ?? []).some((x) => x.id === id), false);

  acciones.guardarRevisionCv(revisionCvNormal({ id, nombre: "  Ana Prueba ", estado: "En proceso", fechaInicio: "2026-10-05", cvRecibido: true }));
  const a = (estado().revisionesCv ?? []).find((x) => x.id === id)!;
  assert.deepEqual([a.nombre, a.estado, a.fechaInicio, a.cvRecibido, a.correccion1], ["Ana Prueba", "En proceso", "2026-10-05", true, false]);
  assert.equal(typeof a.actualizadoPor, "string");
  assert.equal(estado().revisionesCv![0].id, id, "la última que se guardó va primera");
  assert.equal(sinRevisiones(estado()), sinRevisiones(antes), "no cambió ninguna otra colección");

  /* Corregir: la misma fila, no una nueva. */
  acciones.guardarRevisionCv({ ...a, estado: "Esperando cliente", correccion1: true, linkCorreccion: "https://docs.google.com/document/d/x" });
  const filas = (estado().revisionesCv ?? []).filter((x) => x.id === id);
  assert.equal(filas.length, 1);
  assert.deepEqual([filas[0].estado, filas[0].correccion1, filas[0].linkCorreccion], ["Esperando cliente", true, "https://docs.google.com/document/d/x"]);
  assert.equal(filas[0].creadoEn, a.creadoEn, "corregir no cambia cuándo nació");

  /* Otra distinta convive. */
  acciones.guardarRevisionCv(revisionCvNormal({ id: "cv_prueba_2", nombre: "Ana Prueba", estado: "Cerrado" }));
  assert.equal((estado().revisionesCv ?? []).filter((x) => x.nombre === "Ana Prueba").length, 2, "el nombre no es único: puede haber dos con el mismo");

  acciones.borrarRevisionCv(id);
  assert.equal((estado().revisionesCv ?? []).some((x) => x.id === id), false);
  assert.equal((estado().revisionesCv ?? []).some((x) => x.id === "cv_prueba_2"), true, "sólo se borra la que se pidió");
  /* Borrar una que no está no hace nada. */
  const medio = JSON.stringify(estado().revisionesCv);
  acciones.borrarRevisionCv("cv_que_no_existe");
  assert.equal(JSON.stringify(estado().revisionesCv), medio);
  acciones.borrarRevisionCv("cv_prueba_2");
});

/* ---------- Quién la ve y la edita ---------- */

const acceso = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("la revisión de CVs es del área Alumnos: la ve y la edita quien ve y edita el seguimiento de alumnos, y nadie más", () => {
  assert.deepEqual([LEEN.revisiones_cv, EDITAN.revisiones_cv], [["alumnos"], ["alumnos"]]);
  for (const t of TIPOS_POR_DEFECTO) {
    const a = acceso(t.id);
    assert.equal(puedeLeer(a, "revisiones_cv"), puedeLeer(a, "seguimiento_alumnos"), `lee: ${t.id}`);
    assert.equal(puedeEditar(a, "revisiones_cv"), puedeEditar(a, "seguimiento_alumnos"), `edita: ${t.id}`);
  }
  assert.deepEqual([puedeLeer(acceso("customer_success"), "revisiones_cv"), puedeEditar(acceso("customer_success"), "revisiones_cv")], [true, true], "Customer Success (Aldana)");
  assert.deepEqual([puedeLeer(acceso("dueno"), "revisiones_cv"), puedeEditar(acceso("dueno"), "revisiones_cv")], [true, true], "el dueño");
  for (const sinAlumnos of ["closer", "setter", "marketing"]) {
    assert.deepEqual([puedeLeer(acceso(sinAlumnos), "revisiones_cv"), puedeEditar(acceso(sinAlumnos), "revisiones_cv")], [false, false], `${sinAlumnos} no ve los CVs de los alumnos`);
  }
  assert.equal(puedeLeer(null, "revisiones_cv"), false, "sin sesión no se lee");
});

/* ---------- La tabla: filas, búsqueda y el contador por estado ---------- */

import {
  COLUMNAS_REVISIONES_CV, coincideRevisionCv, contadoresCv, ESTADOS_FINALES_CV, filasRevisionesCv, MOTOR_REVISIONES_CV, ORDEN_REVISIONES_CV,
  SIN_ESTADO_CV, VISIBLES_REVISIONES_CV,
} from "@/lib/revision-cv";
import { LISTAS_POR_DEFECTO, listasCs } from "@/lib/clientes-cs";
import { configSeguimiento, listasPropias } from "@/lib/seguimiento";
import type { Alumno, RevisionCv } from "@/lib/types";

const rev = (id: string, estado: string, resto: Partial<RevisionCv> = {}) => revisionCvNormal({ id, nombre: `Alumno ${id}`, estado, ...resto });
const alumno = (id: string, nombre: string) => ({ id, nombre } as Alumno);

test("las filas de la tabla traen el estado (o «Sin estado») y el alumno de la app si la revisión está atada a uno", () => {
  const filas = filasRevisionesCv({
    revisionesCv: [rev("a", "En proceso", { alumnoId: "al1" }), rev("b", ""), rev("c", "Cerrado", { alumnoId: "no_esta" })],
    alumnos: [alumno("al1", "Ana de la App")],
  });
  assert.deepEqual(filas.map((f) => [f.id, f.estado, f.alumno?.nombre ?? null]), [["a", "En proceso", "Ana de la App"], ["b", SIN_ESTADO_CV, null], ["c", "Cerrado", null]]);
  assert.deepEqual(filasRevisionesCv({ revisionesCv: undefined, alumnos: [] }), [], "sin la tabla creada, ninguna fila");
});

test("el contador cuenta lo pendiente de cada estado de la lista sin distinguir mayúsculas ni tildes, y no cuenta lo que ya terminó", () => {
  const filas = filasRevisionesCv({
    revisionesCv: [
      rev("1", "En proceso"), rev("2", "esperando cliente"), rev("3", "Esperando cliente"), rev("4", "ESPERANDO CLIENTE"), rev("5", "Con yari"), rev("6", "Con Yari"),
      rev("7", "Segunda ronda"), rev("8", "cerrado"), rev("9", "Cerrado"), rev("10", "outboarding"), rev("11", "Outboarding"),
    ],
    alumnos: [],
  });
  const c = contadoresCv(filas, LISTAS_POR_DEFECTO.estadosCv);
  assert.deepEqual(c.map((x) => [x.estado, x.n]), [["En proceso", 1], ["Esperando cliente", 3], ["Segunda ronda", 1], ["Con Yari", 2]],
    "Cerrado y Outboarding no se cuentan (ya terminó la corrección); «Segunda ronda» sí");
  assert.deepEqual(ESTADOS_FINALES_CV, ["Cerrado", "Outboarding"]);
  /* Para filtrar la tabla se necesitan los textos tal como están escritos en las filas. */
  assert.deepEqual([...c[1].valores].sort(), ["ESPERANDO CLIENTE", "Esperando cliente", "esperando cliente"]);
  assert.deepEqual([...c[3].valores].sort(), ["Con Yari", "Con yari"]);
  /* El filtro de la tabla con esos valores deja exactamente las que se contaron. */
  const motor = MOTOR_REVISIONES_CV;
  assert.equal(filas.filter((f) => motor.pasaFiltros(f, { estado: { modo: "solo", valores: c[1].valores } })).length, 3);
});

test("el contador suma «Sin estado» sólo si hay, sigue la lista que ajustó Customer Success y no repite un estado escrito dos veces", () => {
  const filas = filasRevisionesCv({ revisionesCv: [rev("1", ""), rev("2", "Revisando"), rev("3", "En proceso")], alumnos: [] });
  assert.deepEqual(contadoresCv(filas, ["En proceso", "en proceso", "Revisando", "Cerrado"]).map((x) => [x.estado, x.n]),
    [["En proceso", 1], ["Revisando", 1], [SIN_ESTADO_CV, 1]], "una lista propia; el repetido cuenta una vez; Cerrado queda afuera");
  assert.deepEqual(contadoresCv(filasRevisionesCv({ revisionesCv: [rev("1", "En proceso")], alumnos: [] }), LISTAS_POR_DEFECTO.estadosCv).map((x) => x.estado),
    ["En proceso", "Esperando cliente", "Segunda ronda", "Con Yari"], "sin filas sin estado, no aparece «Sin estado»; los que no tienen ninguna salen en 0");
  assert.deepEqual(contadoresCv([], LISTAS_POR_DEFECTO.estadosCv).map((x) => x.n), [0, 0, 0, 0]);
});

test("los estados de las revisiones se ajustan desde Customer Success: la lista de fábrica son los seis de Notion y una propia la reemplaza", () => {
  assert.deepEqual(listasCs(null).estadosCv, ["En proceso", "Esperando cliente", "Segunda ronda", "Con Yari", "Cerrado", "Outboarding"]);
  assert.deepEqual(listasCs(configSeguimiento({ listas: { estadosCv: ["Nuevo", "Cerrado"] } })).estadosCv, ["Nuevo", "Cerrado"]);
  assert.deepEqual(listasPropias({ estadosCv: ["  A ", "A", "", "B"] })?.estadosCv, ["A", "B"], "se limpia como las otras listas");
  assert.deepEqual(listasCs(configSeguimiento({ listas: { stacks: ["X"] } })).estadosCv, LISTAS_POR_DEFECTO.estadosCv, "ajustar otra lista no toca ésta");
});

test("la tabla: las columnas visibles existen, las claves no se repiten, el orden de fábrica es por fecha de inicio y la búsqueda ignora tildes y mayúsculas", () => {
  const claves = COLUMNAS_REVISIONES_CV.map((c) => c.clave);
  assert.equal(new Set(claves).size, claves.length);
  for (const v of VISIBLES_REVISIONES_CV) assert.ok(claves.includes(v), `la columna visible ${v} no existe`);
  assert.deepEqual(ORDEN_REVISIONES_CV, [{ clave: "fechaInicio", desc: true }]);
  /* Lo que ya tenía Notion está a la vista; el CV, el LinkedIn y el alumno atado se suman desde «Columnas». */
  for (const oculta of ["linkCv", "linkLinkedin", "alumno"]) assert.equal(VISIBLES_REVISIONES_CV.includes(oculta as never), false, oculta);
  const f = filasRevisionesCv({
    revisionesCv: [rev("1", "En proceso", { nombre: "Valentín Núñez", telefono: "+54 9 11 5555-0000", notas: "No tiene experiencia real", linkCorreccion: "https://docs.google.com/document/d/abc" })],
    alumnos: [],
  })[0];
  for (const q of ["valentin", "NUÑEZ", "5555", "experiencia", "docs.google", ""]) assert.equal(coincideRevisionCv(f, q), true, `«${q}»`);
  assert.equal(coincideRevisionCv(f, "otra persona"), false);
});
