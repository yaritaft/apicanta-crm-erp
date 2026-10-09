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
