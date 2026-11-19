import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { faltaDelTestimonio, LISTAS_POR_DEFECTO, RESELL_DE_TESTIMONIO, TESTIMONIO_A_COMPLETAR_DESDE } from "@/lib/clientes-cs";
import { cuantosIncompletos, filasDeTestimonios, listaDeTestimonios } from "@/lib/testimonios-panel";
import { panelDeServicio } from "@/lib/panel-servicio";
import { CONFIG_POR_DEFECTO, seguimientoVacio } from "@/lib/seguimiento";
import { hojaDelAviso, dondeEs } from "@/lib/avisos";
import type { EstadoApp, Testimonio } from "@/lib/types";

/* Lo de Liliana del 19/11 sobre los testimonios:
   1. «Resell después del testimonio» con sus cuatro opciones (alumno activo, seguimiento, no renueva / outbording, reservó).
   2. Poder borrar la fecha de grabación (no se presentó, se canceló, se reagendó).
   3. Mi panel → Testimonios: lo que tiene cada uno a la vista, y que hasta que no esté completo quede como tarea pendiente.
   4. Un botón para recordar que falten completarlo («Liliana te recuerda que falta cargar la grabación de testimonio de Mauricio Santos»).
   El SQL (nombres nuevos, recordatorio y a quién le llega), en pruebas-estres/sql/sql-testimonio-completo.test.ts. */

const HOY = "2026-11-19";
const tes = (extra: Partial<Testimonio> = {}): Testimonio => ({
  id: "t1", alumnoId: "a1", followUp: "Llamada agendada", fechaGrabacion: "2026-11-10", conQuien: "Mariano", resell: "Alumno activo", estadoVideo: "Subido a Drive",
  link: "https://drive.google.com/v", tecnologias: "", situacionPrevia: "Sin trabajo", situacionActual: "Dev en una fintech", notas: "", creadoEn: "2026-11-01T10:00:00.000Z", ...extra,
});

test("«Resell después del testimonio»: las opciones son las de Lili, y lo que carga el cierre de la llamada es una de ellas", () => {
  const l = LISTAS_POR_DEFECTO.resellsTestimonio;
  for (const o of ["Alumno activo", "Seguimiento", "No renueva / Outbording", "Reservó"]) assert.ok(l.includes(o), o);
  for (const viejo of ["Pendiente", "Lo piensa", "No corresponde, alumno activo"]) assert.ok(!l.includes(viejo), `«${viejo}» ya no`);
  for (const v of Object.values(RESELL_DE_TESTIMONIO)) assert.ok(l.includes(v), `${v} está en la lista`);
  /* El cierre de la llamada guardaba «sigue como alumno activo» como «No renueva»: tres testimonios de la semana eran alumnos activos. */
  const cierre = readFileSync("src/components/mi-panel/CerrarLlamada.tsx", "utf8");
  assert.match(cierre, /resultado === "activo" \? RESELL_DE_TESTIMONIO\.activo/);
  assert.match(cierre, /resultado === "outboarding" \? RESELL_DE_TESTIMONIO\.noRenueva/);
  assert.match(cierre, /resultado === "seguimiento" \? RESELL_DE_TESTIMONIO\.seguimiento/);
});

test("qué le falta a un testimonio: el link, el resultado del resell, la situación previa y actual y el follow-up", () => {
  assert.deepEqual(faltaDelTestimonio(tes(), HOY), [], "completo");
  /* El caso real de Mauricio Santos: reunión del 23/9 con Mariano, sin link ni resultado. */
  assert.deepEqual(faltaDelTestimonio(tes({ fechaGrabacion: "2026-09-23", followUp: "Agendado", link: "", resell: "" }), HOY), ["el link de la grabación", "el resultado del resell"]);
  assert.deepEqual(faltaDelTestimonio(tes({ situacionPrevia: "", situacionActual: "" }), HOY), ["su situación previa y actual"]);
  assert.deepEqual(faltaDelTestimonio(tes({ situacionPrevia: "" }), HOY), ["su situación previa"]);
  assert.deepEqual(faltaDelTestimonio(tes({ situacionActual: "  " }), HOY), ["su situación actual"]);
  assert.deepEqual(faltaDelTestimonio(tes({ followUp: "" }), HOY), ["el follow-up"]);
  assert.deepEqual(faltaDelTestimonio(tes({ link: "", resell: "", situacionPrevia: "", situacionActual: "", followUp: "" }), HOY),
    ["el link de la grabación", "el resultado del resell", "su situación previa y actual", "el follow-up"]);
});

test("todavía no toca, no se va a grabar o es de antes de septiembre: no falta nada", () => {
  const vacio = { link: "", resell: "", situacionPrevia: "", situacionActual: "" };
  assert.deepEqual(faltaDelTestimonio(tes({ ...vacio, fechaGrabacion: null }), HOY), [], "sin fecha: falta agendar, no completar");
  assert.deepEqual(faltaDelTestimonio(tes({ ...vacio, fechaGrabacion: "2026-11-25" }), HOY), [], "es en el futuro");
  assert.deepEqual(faltaDelTestimonio(tes({ ...vacio, fechaGrabacion: HOY }), HOY).length > 0, true, "el día de la grabación ya toca");
  assert.deepEqual(faltaDelTestimonio(tes({ ...vacio, followUp: "No se graba, porque no se concretó" }), HOY), []);
  assert.deepEqual(faltaDelTestimonio(tes({ ...vacio, followUp: "No quiere grabar" }), HOY), []);
  assert.deepEqual(faltaDelTestimonio(tes({ ...vacio, fechaGrabacion: "2026-08-30" }), HOY), [], "lo de antes viene del Airtable");
  assert.equal(TESTIMONIO_A_COMPLETAR_DESDE, "2026-09-01");
});

test("Mi panel → Testimonios: cada fila trae lo que tiene cargado y se filtra por «Incompletos»", () => {
  const alumnos = [{ id: "a1", nombre: "Mauricio Santos" }, { id: "a2", nombre: "Ana Paz" }, { id: "a3", nombre: "Beto Gil" }];
  const filas = filasDeTestimonios([
    tes({ id: "t_mau", alumnoId: "a1", fechaGrabacion: "2026-09-23", followUp: "Agendado", link: "", resell: "" }),
    tes({ id: "t_ana", alumnoId: "a2" }),
    tes({ id: "t_beto", alumnoId: "a3", situacionActual: "" }),
  ], alumnos, HOY);
  const mau = filas.find((f) => f.id === "t_mau")!;
  assert.deepEqual([mau.nombre, mau.conQuien, mau.fecha, mau.followUp, mau.resell, mau.previa, mau.actual, mau.falta],
    ["Mauricio Santos", "Mariano", "2026-09-23", "Agendado", "", true, true, ["el link de la grabación", "el resultado del resell"]]);
  assert.equal(cuantosIncompletos(filas), 2);
  assert.deepEqual(listaDeTestimonios(filas, "incompletos", "").map((f) => f.id).sort(), ["t_beto", "t_mau"]);
  assert.deepEqual(listaDeTestimonios(filas, "incompletos", "mauricio").map((f) => f.id), ["t_mau"], "y se busca por alumno");
  assert.equal(listaDeTestimonios(filas, "todos", "").length, 3);
});

const firmado = { contratoFirmado: "Firmado", contactoInicial: "2026-09-01", ultimoContacto: "2026-11-10" };
const alumno = (id: string, nombre: string) => ({ id, nombre, email: `${id}@mail.com`, estado: "activo", inicio: "2026-08-01T12:00:00.000Z", cohorte: "", plan: "", extra: {} });
function estado(testimonios: Testimonio[]): EstadoApp {
  return {
    ajustes: {}, leads: [], contactos: [], ventas: [], cuotas: [], productos: [], equipo: [], etapasServicio: [], reportes: [], sesiones: [], resells: [], revisionesCv: [],
    alumnos: [alumno("a1", "Mauricio Santos"), alumno("a2", "Ana Paz"), alumno("a3", "Beto Gil"), alumno("a4", "Cata Ruiz")],
    seguimientos: ["a1", "a2", "a3", "a4"].map((id) => ({ ...seguimientoVacio(id, CONFIG_POR_DEFECTO), ...firmado })),
    testimonios,
  } as unknown as EstadoApp;
}

test("hasta que no esté completo, queda como tarea pendiente en «Para hoy»; completo, o que no se graba, sale", () => {
  const p = panelDeServicio(estado([
    tes({ id: "t_mau", alumnoId: "a1", fechaGrabacion: "2026-09-23", followUp: "Agendado", link: "", resell: "" }),
    tes({ id: "t_ana", alumnoId: "a2", resell: "" }), // tiene el link pero no el resultado del resell
    tes({ id: "t_beto", alumnoId: "a3" }), // completo
    tes({ id: "t_cata", alumnoId: "a4", link: "", resell: "", followUp: "No se graba, porque no se concretó" }),
  ]), HOY, new Date("2026-11-19T15:00:00.000Z"));
  const s = p.secciones.find((x) => x.id === "testimonios")!;
  assert.deepEqual(s.items.map((i) => i.nombre).sort(), ["Ana Paz", "Mauricio Santos"]);
  const mau = s.items.find((i) => i.nombre === "Mauricio Santos")!;
  assert.match(mau.detalle, /Grabó el .* con Mariano · falta el link del video, el resultado del resell/);
  assert.equal(mau.tono, "rojo", "56 días: en rojo");
  assert.match(s.items.find((i) => i.nombre === "Ana Paz")!.detalle, /falta el resultado del resell/, "antes sólo se pedía el link");
  assert.match(s.regla, /resultado del resell/);
});

test("el recordatorio y la fecha borrable están donde Lili los usa", () => {
  const panel = readFileSync("src/components/mi-panel/TestimoniosDelPanel.tsx", "utf8");
  assert.match(panel, /Recordar/);
  assert.match(panel, /recordarTestimonio\(f\.id\)/);
  assert.match(panel, /puedeRecordar/);
  assert.match(readFileSync("src/components/mi-panel/PanelServicio.tsx", "utf8"), /<TestimoniosDelPanel hoy=\{hoy\} puedeRecordar=\{puedeEscribir\}/, "sólo quien puede escribir en Alumnos y no mirando el panel de otro");
  assert.match(readFileSync("src/lib/recordar-testimonio.ts", "utf8"), /rpc\("recordar_testimonio"/);
  assert.match(readFileSync("src/components/cs/TestimoniosCs.tsx", "utf8"), /Borrar la fecha/);
  /* El aviso llega a la campanita y lleva al panel (donde está lo pendiente), no a una ficha que el closer no puede abrir. */
  assert.match(readFileSync("src/components/avisos/Campanita.tsx", "utf8"), /a\.tipo === "testimonio-pendiente"\) \{ router\.push\("\/mi-panel"\)/);
  assert.equal(hojaDelAviso("testimonio-pendiente"), undefined);
  assert.match(dondeEs({ persona: "", tipo: "testimonio-pendiente" }), /Testimonio sin completar/);
});
