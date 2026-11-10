import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { retiroDelTestimonioAgendado } from "@/lib/clientes-cs";
import {
  estadoDelTestimonio, filasDeTestimonios, listaDeTestimonios, resumenDeTestimonios,
} from "@/lib/testimonios-panel";
import type { EstadoApp, Resell, Testimonio } from "@/lib/types";

/* Lo de Lili del 10/11: el testimonio que una llamada dejó en la ficha de Darío Vargas sin ser caso de éxito (la agenda lo escribía y
   nadie lo retiraba), y un lugar donde ver TODOS los testimonios, grabados o no. «Caso de éxito» que no anula el próximo contacto: en
   pruebas/panel-servicio.test.ts. El SQL, en pruebas-estres/sql/sql-testimonio-se-desescribe.test.ts. */

const HOY = "2026-11-10";
const DIA = "2026-10-28";

const tes = (id: string, extra: Partial<Testimonio> = {}): Testimonio => ({
  id, alumnoId: "a1", followUp: "Llamada agendada", fechaGrabacion: DIA, conQuien: "Mariano", resell: "", estadoVideo: "", link: "",
  tecnologias: "", situacionPrevia: "", situacionActual: "", notas: "", creadoEn: "2026-10-29T00:42:47.843Z", ...extra,
});

/* ---------- La regla de retiro (la misma de la base) ---------- */

test("lo que creó la agenda y nadie tocó, se borra; lo que ya existía, vuelve a «por agendar»", () => {
  assert.deepEqual(retiroDelTestimonioAgendado([tes("tes_rs_cal_dario")], "a1", DIA), { tipo: "borrar", id: "tes_rs_cal_dario" }, "Darío");
  assert.deepEqual(retiroDelTestimonioAgendado([tes("tes_viejo")], "a1", DIA), { tipo: "volver", id: "tes_viejo" });
  assert.deepEqual(retiroDelTestimonioAgendado([tes("tes_rs_cal_x", { notas: "ojo con esto" })], "a1", DIA), { tipo: "volver", id: "tes_rs_cal_x" }, "con algo cargado a mano no se borra");
});

test("nunca toca lo grabado, con estado de video o de otro día / otro alumno", () => {
  assert.equal(retiroDelTestimonioAgendado([tes("tes_rs_a", { link: "https://youtu.be/x" })], "a1", DIA), null);
  assert.equal(retiroDelTestimonioAgendado([tes("tes_rs_a", { estadoVideo: "Pendiente de subir" })], "a1", DIA), null);
  assert.equal(retiroDelTestimonioAgendado([tes("tes_rs_a", { followUp: "Pendiente de agendar" })], "a1", DIA), null, "no era el de una llamada agendada");
  assert.equal(retiroDelTestimonioAgendado([tes("tes_rs_a")], "a1", "2026-11-02"), null, "otro día");
  assert.equal(retiroDelTestimonioAgendado([tes("tes_rs_a")], "otro", DIA), null, "otro alumno");
  assert.equal(retiroDelTestimonioAgendado([], "a1", DIA), null);
});

/* ---------- En el store: lo que ve quien cambia la llamada ---------- */

fijarAcceso(null);
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;

test("«No era para testimonio» (casoDeExito → no): el testimonio que la agenda había puesto desaparece de la ficha al instante", () => {
  const a = estado().alumnos[0];
  const ahora = estado();
  const llamada: Resell = {
    id: "rs_cal_dario", sesionId: null, fechaHora: `${DIA}T21:00:00.000-03:00`, nombre: "Darío Vargas", email: a.email, telefono: "", closer: "Mariano Arias",
    estado: "", cashCollect: null, casoDeExito: true, notas: "", grabacion: "", cancelada: false, testimonio: "", linkTestimonio: "", linkPitch: "", origen: "calendly",
  } as unknown as Resell;
  acciones.guardarResell(llamada);
  acciones.guardarTestimonio(tes("tes_rs_cal_dario", { alumnoId: a.id }));
  assert.ok((estado().testimonios ?? []).some((t) => t.id === "tes_rs_cal_dario"));
  assert.equal((estado().testimonios ?? []).length, (ahora.testimonios ?? []).length + 1);

  acciones.guardarResell({ ...llamada, casoDeExito: false, estado: "Outbording" });
  assert.ok(!(estado().testimonios ?? []).some((t) => t.id === "tes_rs_cal_dario"), "ya no figura como testimonio");
  assert.equal((estado().resells ?? []).find((r) => r.id === "rs_cal_dario")?.estado, "Outbording", "y la llamada conserva lo que se cargó");
});

test("si el testimonio ya existía por agendar, vuelve a «Pendiente de agendar» y sin fecha; y marcar caso de éxito no borra nada", () => {
  const a = estado().alumnos[1];
  const llamada = {
    id: "rs_cal_pablo", sesionId: null, fechaHora: `${DIA}T21:00:00.000-03:00`, nombre: "Pablo", email: a.email, telefono: "", closer: "Yari",
    estado: "", cashCollect: null, casoDeExito: false, notas: "", grabacion: "", cancelada: false, testimonio: "", linkTestimonio: "", linkPitch: "", origen: "manual",
  } as unknown as Resell;
  acciones.guardarTestimonio(tes("tes_pablo_viejo", { alumnoId: a.id }));
  acciones.guardarResell(llamada); // sin caso de éxito: no cambia nada
  assert.equal((estado().testimonios ?? []).find((t) => t.id === "tes_pablo_viejo")?.followUp, "Llamada agendada");
  acciones.guardarResell({ ...llamada, casoDeExito: true }); // se marca: tampoco
  assert.equal((estado().testimonios ?? []).find((t) => t.id === "tes_pablo_viejo")?.followUp, "Llamada agendada");
  acciones.guardarResell({ ...llamada, casoDeExito: false }); // se desmarca
  const t = (estado().testimonios ?? []).find((x) => x.id === "tes_pablo_viejo")!;
  assert.equal(t.followUp, "Pendiente de agendar");
  assert.equal(t.fechaGrabacion, null);
});

test("un testimonio con link no lo toca el desmarcado", () => {
  const a = estado().alumnos[2];
  const llamada = {
    id: "rs_cal_con_link", sesionId: null, fechaHora: `${DIA}T21:00:00.000-03:00`, nombre: "Con link", email: a.email, telefono: "", closer: "Yari",
    estado: "", cashCollect: null, casoDeExito: true, notas: "", grabacion: "", cancelada: false, testimonio: "", linkTestimonio: "", linkPitch: "", origen: "manual",
  } as unknown as Resell;
  acciones.guardarResell(llamada);
  acciones.guardarTestimonio(tes("tes_rs_con_link", { alumnoId: a.id, link: "https://youtu.be/abc" }));
  acciones.guardarResell({ ...llamada, casoDeExito: false });
  assert.equal((estado().testimonios ?? []).find((x) => x.id === "tes_rs_con_link")?.followUp, "Llamada agendada");
});

/* ---------- Todos los testimonios en Mi panel ---------- */

test("el estado de cada testimonio: el link manda, después que no quiere, después la fecha", () => {
  const e = (t: Partial<Testimonio>) => estadoDelTestimonio({ link: "", followUp: "", estadoVideo: "", fechaGrabacion: null, ...t }, HOY);
  assert.equal(e({ link: "https://youtu.be/x", followUp: "Llamada agendada", fechaGrabacion: DIA }), "con-link");
  assert.equal(e({ link: "https://youtu.be/x", fechaGrabacion: null }), "con-link", "con link está grabado aunque no tenga fecha");
  assert.equal(e({ fechaGrabacion: DIA }), "sin-link");
  assert.equal(e({ followUp: "Llamada agendada", fechaGrabacion: "2026-11-12" }), "agendado");
  assert.equal(e({ fechaGrabacion: HOY }), "sin-link", "hoy ya contó");
  assert.equal(e({ followUp: "Llamada agendada" }), "agendado", "agendado sin fecha");
  assert.equal(e({ followUp: "Pendiente de agendar" }), "por-agendar");
  assert.equal(e({ followUp: "No agendada" }), "por-agendar");
  assert.equal(e({}), "por-agendar");
  assert.equal(e({ followUp: "No quiere grabar" }), "no-quiere");
  assert.equal(e({ estadoVideo: "No quiso grabar" }), "no-quiere");
  assert.equal(e({ estadoVideo: "Subido a Drive" }), "sin-link", "el video está subido pero falta el link");
  assert.equal(e({ followUp: "No Quiere Grabar" }), "no-quiere", "mayúsculas y tildes no importan");
});

test("la lista trae TODOS (los grabados y los que no), cuenta cada estado, filtra y busca por alumno", () => {
  const alumnos = [
    { id: "a1", nombre: "Ana Pérez" }, { id: "a2", nombre: "Beto Gómez" }, { id: "a3", nombre: "Carla Díaz" },
    { id: "a4", nombre: "Dani Ruiz" }, { id: "a5", nombre: "Eli Soto" }, { id: "a6", nombre: "Fede Paz" },
  ];
  const testimonios = [
    tes("t1", { alumnoId: "a1", link: "https://youtu.be/1", estadoVideo: "Subido a YouTube", fechaGrabacion: "2026-10-01" }),
    tes("t2", { alumnoId: "a2", fechaGrabacion: "2026-10-20" }),
    tes("t3", { alumnoId: "a3", followUp: "Llamada agendada", fechaGrabacion: "2026-11-15" }),
    tes("t4", { alumnoId: "a4", followUp: "Pendiente de agendar", fechaGrabacion: null }),
    tes("t5", { alumnoId: "a5", followUp: "No quiere grabar", fechaGrabacion: null }),
    tes("t6", { alumnoId: "borrado", followUp: "Pendiente de agendar", fechaGrabacion: null }),
  ];
  const filas = filasDeTestimonios(testimonios, alumnos, HOY);
  const r = resumenDeTestimonios(filas);
  assert.equal(r.total, 6, "los seis, también el ya grabado con su video");
  assert.deepEqual(r.porEstado, { "con-link": 1, "sin-link": 1, agendado: 1, "por-agendar": 2, "no-quiere": 1 });

  const todos = listaDeTestimonios(filas, "todos", "");
  assert.deepEqual(todos.map((f) => f.id).sort(), ["t1", "t2", "t3", "t4", "t5", "t6"], "sin repetir ni perder");
  assert.equal(todos[0].id, "t3", "arriba lo que viene");
  assert.equal(todos[1].id, "t2", "después lo grabado más reciente");
  assert.deepEqual(listaDeTestimonios(filas, "con-link", "").map((f) => f.id), ["t1"]);
  assert.deepEqual(listaDeTestimonios(filas, "por-agendar", "").map((f) => f.id).sort(), ["t4", "t6"]);
  assert.deepEqual(listaDeTestimonios(filas, "todos", "perez").map((f) => f.id), ["t1"], "sin tildes");
  assert.deepEqual(listaDeTestimonios(filas, "sin-link", "ana"), [], "el filtro y la búsqueda se suman");
  assert.equal(filas.find((f) => f.id === "t6")!.nombre, "", "el alumno que ya no existe no rompe la lista");
});

test("sin testimonios (o con filas incompletas) no se rompe", () => {
  assert.deepEqual(filasDeTestimonios(undefined, [], HOY), []);
  assert.deepEqual(filasDeTestimonios([{ id: "", alumnoId: "x" }, { id: "y" }] as never, [], HOY), []);
  assert.deepEqual(resumenDeTestimonios([]), { total: 0, porEstado: { "con-link": 0, "sin-link": 0, agendado: 0, "por-agendar": 0, "no-quiere": 0 } });
});
