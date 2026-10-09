import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { seguimientoCompleto, siguienteNumero } from "@/lib/clientes-cs";
import { configSeguimiento } from "@/lib/seguimiento";
import type { Alumno, EstadoApp, Reporte, Resell, SeguimientoAlumno, Testimonio } from "@/lib/types";

/* El store de verdad, sin nube (la semilla de ejemplo): lo que hacen las acciones de Customer Success. */
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
fijarAcceso(null);

const CFG = configSeguimiento();
const seg = (id: string) => (estado().seguimientos ?? []).find((s) => s.alumnoId === id);

test("la primera vez que se carga algo de un alumno nace su ficha, con su N.º de alumno, y después no se renumera", () => {
  const a = estado().alumnos[0];
  assert.equal(seg(a.id), undefined);
  const mayor = siguienteNumero(estado().seguimientos ?? []);
  const antes = acciones.guardarSeguimiento(a.id, (s) => ({ ...s, stack: "Backend", dni: "30.111.222" }), () => "Se cargó el stack.");
  assert.ok(antes, "devuelve cómo estaba, para el «Deshacer»");
  const ficha = seg(a.id)!;
  assert.deepEqual([ficha.numero, ficha.stack, ficha.dni, ficha.id], [mayor, "Backend", "30.111.222", `seg_${a.id}`]);
  /* Otra edición no cambia el número. */
  acciones.guardarSeguimiento(a.id, (s) => ({ ...s, edad: 31 }), () => "Edad.");
  assert.equal(seg(a.id)!.numero, mayor);
  assert.equal(seg(a.id)!.edad, 31);
  /* Deshacer vuelve a la ficha de antes. */
  acciones.restaurarSeguimiento(antes!, "Se deshizo.");
  assert.equal(seg(a.id)!.stack, "");
  assert.equal(seg(a.id)!.numero, mayor, "el número ya era de esa ficha");
  assert.match(estado().actividad[0].detalle, /se deshizo/i);
});

test("una ficha de antes (sin las columnas nuevas) se completa al tocarla y no pierde lo que tenía", () => {
  const a = estado().alumnos[1];
  /* Simula una ficha cargada antes de este lote: sin ninguno de los campos nuevos. */
  const vieja = { id: `seg_${a.id}`, alumnoId: a.id, cadenciaDias: 7, ultimoContacto: "2026-10-01", proximoContacto: null, intentosSinRespuesta: 0, ultimoIntento: null, dejoDeContestar: false, cvCorregido: true, cvCorregidoEn: "2026-10-02", linkedinCorregido: false, linkedinCorregidoEn: null, notas: "ojo", actualizadoEn: "2026-10-01T10:00:00.000Z", actualizadoPor: "Lili" } as SeguimientoAlumno;
  const e = estado();
  acciones.importarClientesCs({ alumnos: [], seguimientos: [vieja], testimonios: [], resells: [], reportes: [], detalle: "Se carga una ficha vieja." });
  assert.equal(seg(a.id)!.notas, "ojo");
  acciones.guardarSeguimiento(a.id, (s) => ({ ...s, followUp: "Módulo 2" }), () => "Follow-up.");
  const f = seg(a.id)!;
  assert.deepEqual([f.cadenciaDias, f.cvCorregido, f.notas, f.followUp], [7, true, "ojo", "Módulo 2"]);
  assert.deepEqual([f.programas, f.accesoWhatsapp, f.reporteManual], [[], false, null], "las columnas nuevas, vacías");
  assert.equal(typeof f.numero, "number", "al tocarla recibe su número");
  assert.equal(e.alumnos.length, estado().alumnos.length);
});

test("numerar alumnos le da su número a los que no tienen, del más viejo al más nuevo, y no repite ninguno", () => {
  const antes = estado();
  const sinNumero = antes.alumnos.filter((a) => (seg(a.id)?.numero ?? null) === null);
  assert.ok(sinNumero.length >= 3, "la semilla tiene alumnos sin numerar");
  const n = acciones.numerarAlumnos();
  assert.equal(n, sinNumero.length);
  const despues = estado();
  const numeros = despues.alumnos.map((a) => seg(a.id)?.numero ?? null);
  assert.ok(numeros.every((x) => typeof x === "number"), "todos tienen número");
  assert.equal(new Set(numeros).size, numeros.length, "ninguno repetido");
  /* Entre los que se numeraron ahora, el más viejo tiene el número más bajo. */
  const nuevos = sinNumero.map((a) => ({ inicio: +new Date(a.inicio), numero: seg(a.id)!.numero as number }));
  const porInicio = [...nuevos].sort((x, y) => x.inicio - y.inicio || x.numero - y.numero);
  for (let i = 1; i < porInicio.length; i++) assert.ok(porInicio[i].numero > porInicio[i - 1].numero, "el más viejo, el número más bajo");
  assert.equal(acciones.numerarAlumnos(), 0, "la segunda vez no hay nadie");
  assert.match(despues.actividad[0].detalle, /numeró a \d+ alumnos?/);
});

test("un testimonio se guarda con las columnas de Lili, sin el primer modelo, y se borra", () => {
  const a = estado().alumnos[2];
  const t: Testimonio = {
    id: "tes_prueba_1", alumnoId: a.id, followUp: "Llamada agendada", fechaGrabacion: "2026-10-05", conQuien: "Yari", resell: "Renueva",
    estadoVideo: "Subido a Drive", link: "https://drive.example/1", tecnologias: "React", situacionPrevia: "Antes", situacionActual: "Ahora", notas: "n",
    creadoEn: "2026-10-05T10:00:00.000Z",
    /* Un resto del primer modelo: no tiene que quedar guardado. */
    estado: "pedido", fecha: "2026-01-01",
  } as Testimonio;
  acciones.guardarTestimonio(t);
  const guardado = (estado().testimonios ?? []).find((x) => x.id === "tes_prueba_1")!;
  assert.deepEqual([guardado.estadoVideo, guardado.conQuien, guardado.fechaGrabacion, guardado.situacionActual], ["Subido a Drive", "Yari", "2026-10-05", "Ahora"]);
  assert.equal("estado" in guardado, false);
  assert.equal("fecha" in guardado, false);
  assert.match(estado().actividad[0].detalle, /Testimonio: Subido a Drive/);
  acciones.guardarTestimonio({ ...guardado, estadoVideo: "Subido a YouTube" });
  assert.equal((estado().testimonios ?? []).filter((x) => x.id === "tes_prueba_1").length, 1, "uno solo");
  acciones.borrarTestimonio("tes_prueba_1");
  assert.equal((estado().testimonios ?? []).some((x) => x.id === "tes_prueba_1"), false);
});

test("un resell se guarda, se corrige y se borra", () => {
  const r: Resell = {
    id: "rs_prueba_1", sesionId: null, fechaHora: "2026-10-12T14:00:00.000Z", nombre: "Luis", email: "luis@mail.com", telefono: "", closer: "Mariano",
    estado: "Renueva", cashCollect: 1200, casoDeExito: true, notas: "", cancelada: false, origen: "manual", creadoEn: "2026-10-09T10:00:00.000Z",
    actualizadoEn: "2026-10-09T10:00:00.000Z", actualizadoPor: "",
  };
  acciones.guardarResell(r);
  const g = (estado().resells ?? []).find((x) => x.id === "rs_prueba_1")!;
  assert.deepEqual([g.estado, g.cashCollect, g.casoDeExito, g.origen], ["Renueva", 1200, true, "manual"]);
  assert.notEqual(g.actualizadoEn, r.actualizadoEn, "queda marcada cuándo se tocó");
  acciones.guardarResell({ ...g, estado: "No renueva", cashCollect: null });
  const h = (estado().resells ?? []).filter((x) => x.id === "rs_prueba_1");
  assert.equal(h.length, 1);
  assert.deepEqual([h[0].estado, h[0].cashCollect], ["No renueva", null]);
  acciones.borrarResell("rs_prueba_1");
  assert.equal((estado().resells ?? []).some((x) => x.id === "rs_prueba_1"), false);
  acciones.borrarResell("no_existe");
});

test("importar un lote de Customer Success: alumnos, fichas, testimonios, resells y reportes entran juntos y reemplazan por id", () => {
  const antes = estado();
  const alumno: Alumno = {
    id: "alu_cs_prueba", nombre: "Zoe Prueba", email: "zoe@prueba.com", estado: "graduado", inicio: "2026-02-01", cohorte: "", plan: "Hackear IT",
    cuotaMensual: 0, moneda: "USD", progreso: 0, notas: "", creadoEn: "2026-10-09T10:00:00.000Z", extra: {},
  };
  const ficha = seguimientoCompleto({ alumnoId: alumno.id, numero: 500, stack: "Frontend", programas: ["Hackear IT"] }, CFG);
  const reporte: Reporte = { id: "rep_cs_prueba", alumnoId: alumno.id, semanaDel: "2026-10-05", estado: "completado", horasEstudio: 7 };
  const lote = {
    alumnos: [alumno], seguimientos: [ficha], reportes: [reporte], detalle: "Importación de prueba.",
    testimonios: [{ id: "tes_cs_prueba_1", alumnoId: alumno.id, followUp: "", fechaGrabacion: null, conQuien: "", resell: "", estadoVideo: "Subido a YouTube", link: "", tecnologias: "", situacionPrevia: "", situacionActual: "", notas: "", creadoEn: "x" }] as Testimonio[],
    resells: [{ id: "rs_imp_prueba", sesionId: null, fechaHora: "2026-10-12T14:00:00.000Z", nombre: "Zoe", email: "zoe@prueba.com", telefono: "", closer: "", estado: "Renueva", cashCollect: 500, casoDeExito: false, notas: "", cancelada: false, origen: "importado", creadoEn: "x", actualizadoEn: "x", actualizadoPor: "" }] as Resell[],
  };
  acciones.importarClientesCs(lote);
  const e = estado();
  assert.equal(e.alumnos.length, antes.alumnos.length + 1);
  assert.equal(e.alumnos[0].id, "alu_cs_prueba");
  assert.equal(seg("alu_cs_prueba")!.numero, 500);
  assert.equal((e.testimonios ?? []).some((t) => t.id === "tes_cs_prueba_1"), true);
  assert.equal((e.resells ?? []).some((r) => r.id === "rs_imp_prueba"), true);
  assert.equal(e.reportes.some((r) => r.id === "rep_cs_prueba"), true);
  assert.equal(e.actividad[0].detalle, "Importación de prueba.");

  /* Importar lo mismo otra vez no duplica nada: reemplaza por id. */
  acciones.importarClientesCs({ ...lote, seguimientos: [{ ...ficha, stack: "Backend" }] });
  const f = estado();
  assert.equal(f.alumnos.length, e.alumnos.length);
  assert.equal((f.seguimientos ?? []).filter((s) => s.alumnoId === "alu_cs_prueba").length, 1);
  assert.equal(seg("alu_cs_prueba")!.stack, "Backend", "la ficha del lote gana sobre la que había");
  assert.equal((f.testimonios ?? []).filter((t) => t.id === "tes_cs_prueba_1").length, 1);
  assert.equal(f.reportes.filter((r) => r.id === "rep_cs_prueba").length, 1);
  assert.equal(f.seguimientos?.length, e.seguimientos?.length);
});
