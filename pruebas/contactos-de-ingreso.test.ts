import test from "node:test";
import assert from "node:assert/strict";
import {
  aplicarContacto, CONFIG_POR_DEFECTO, contactosDeIngreso, DIAS_DEL_INGRESO, DIA_CONTACTO_SEMANAL, seguimientoVacio, sumarDias,
} from "@/lib/seguimiento";
import { panelDeServicio, type PanelDeServicio, type SeccionServicio } from "@/lib/panel-servicio";
import { hojaDelAviso } from "@/lib/avisos";
import type { EstadoApp, SeguimientoAlumno } from "@/lib/types";

/* Liliana, 13/11: los contactos del alumno nuevo son día 1 (bienvenida), día 7 (semanal) y después cada 20 días; los dos primeros
   tienen su lista propia en Mi panel y las reservas también reciben la bienvenida. Un día fijo para que los días den siempre lo mismo. */
const HOY = "2026-11-13";
const AHORA = new Date("2026-11-13T15:00:00.000Z");
const dia = (n: number) => sumarDias(HOY, n);

const alumno = (id: string, nombre: string, inicio: string, extra: Record<string, unknown> = {}) => ({
  id, nombre, email: `${id}@mail.com`, estado: "activo", inicio: `${inicio}T15:00:00.000Z`, cohorte: "", plan: "Hackear IA", extra: {}, ...extra,
});
const seg = (alumnoId: string, c: Partial<SeguimientoAlumno> = {}): SeguimientoAlumno => ({ ...seguimientoVacio(alumnoId, CONFIG_POR_DEFECTO), contratoFirmado: "Firmado", ...c });
const estado = (alumnos: unknown[], seguimientos: SeguimientoAlumno[] = [], extra: Partial<EstadoApp> = {}): EstadoApp => ({
  ajustes: {}, alumnos, seguimientos,
  leads: [], contactos: [], ventas: [], cuotas: [], productos: [], equipo: [], etapasServicio: [], reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [],
  ...extra,
}) as unknown as EstadoApp;
const lista = (p: PanelDeServicio, id: SeccionServicio["id"]) => p.secciones.find((s) => s.id === id)!.items.map((i) => i.nombre);

test("el seguimiento arranca cada 20 días: día 1, día 7 y después cada 20", () => {
  assert.equal(CONFIG_POR_DEFECTO.cadenciaPorDefecto, 20);
  assert.equal(seguimientoVacio("x", CONFIG_POR_DEFECTO).cadenciaDias, 20);
  assert.equal(DIA_CONTACTO_SEMANAL, 7);
});

test("contactosDeIngreso: la bienvenida falta desde el día que entra; el semanal, desde el día 7, y los dos se acaban a los 20 días", () => {
  const sin = { contactoInicial: null, contactoSemana: null, ultimoContacto: null };
  const en = (k: number, extra: Partial<typeof sin> = {}) => contactosDeIngreso({ inicio: dia(-k), ...sin, ...extra }, HOY);
  assert.deepEqual([en(0).inicial, en(0).semanal], [true, false], "el día 1: bienvenida");
  assert.deepEqual([en(6).inicial, en(6).semanal], [true, false], "todavía no es el día 7");
  assert.deepEqual([en(7).inicial, en(7).semanal], [true, true], "sin ningún contacto: faltan los dos");
  assert.deepEqual([en(DIAS_DEL_INGRESO).inicial, en(DIAS_DEL_INGRESO).semanal], [true, true], "hasta el último día de la ventana");
  assert.deepEqual([en(DIAS_DEL_INGRESO + 1).inicial, en(DIAS_DEL_INGRESO + 1).semanal], [false, false], "después lo toma el de cada 20 días");
  const futuro = contactosDeIngreso({ inicio: dia(2), ...sin }, HOY);
  assert.deepEqual([futuro.inicial, futuro.semanal], [false, false], "todavía no entró");
});

test("contactosDeIngreso: vale el contacto cargado y también un «último contacto» posterior (Lili lo marcaba y la lista seguía diciendo que faltaba)", () => {
  const inicio = dia(-3);
  assert.equal(contactosDeIngreso({ inicio, contactoInicial: dia(-3), contactoSemana: null, ultimoContacto: null }, HOY).inicial, false);
  /* El caso del 13/11: último contacto de hoy y el contacto inicial vacío. */
  assert.equal(contactosDeIngreso({ inicio, contactoInicial: null, contactoSemana: null, ultimoContacto: HOY }, HOY).inicial, false);
  /* Un último contacto ANTERIOR a que entrara no es la bienvenida. */
  assert.equal(contactosDeIngreso({ inicio, contactoInicial: null, contactoSemana: null, ultimoContacto: dia(-10) }, HOY).inicial, true);
  /* Semanal: hecho si está cargado, o si el último contacto ya es de la semana 1 en adelante. */
  const alDia8 = { inicio: dia(-8), contactoInicial: dia(-8), contactoSemana: null };
  assert.equal(contactosDeIngreso({ ...alDia8, ultimoContacto: dia(-7) }, HOY).semanal, true, "el contacto del día 1 no es el semanal");
  assert.equal(contactosDeIngreso({ ...alDia8, ultimoContacto: dia(-1) }, HOY).semanal, false, "hablaron al día 7");
  assert.equal(contactosDeIngreso({ ...alDia8, contactoSemana: dia(-1), ultimoContacto: null }, HOY).semanal, false);
});

test("con demora de inicio, la semana se cuenta desde que arranca de verdad, pero la bienvenida es desde que entró", () => {
  const x = { inicio: dia(-10), inicioReal: dia(-2), contactoInicial: null, contactoSemana: null, ultimoContacto: null };
  const c = contactosDeIngreso(x, HOY);
  assert.equal(c.inicial, true);
  assert.equal(c.semanal, false, "arrancó hace 2 días");
});

test("«Lo contacté» deja marcado el contacto inicial y después el semanal, sólo en las primeras semanas", () => {
  const base = seg("a");
  const dia1 = aplicarContacto(base, HOY, "Lili", undefined, dia(0));
  assert.equal(dia1.contactoInicial, HOY);
  assert.equal(dia1.contactoSemana, null);
  assert.equal(dia1.ultimoContacto, HOY);
  assert.equal(dia1.proximoContacto, dia(20), "el próximo, a los 20 días");
  /* Con el primero hecho, un contacto antes de la semana no es el semanal; desde los 5 días sí. */
  assert.equal(aplicarContacto({ ...base, contactoInicial: dia(-3) }, HOY, "", undefined, dia(-3)).contactoSemana, null);
  const alDia7 = aplicarContacto({ ...base, contactoInicial: dia(-7) }, HOY, "", undefined, dia(-7));
  assert.equal(alDia7.contactoSemana, HOY);
  assert.equal(alDia7.contactoInicial, dia(-7), "no pisa el que ya estaba");
  /* Un alumno viejo no se llena de contactos «iniciales» por apretar el botón. */
  const viejo = aplicarContacto(base, HOY, "", undefined, dia(-100));
  assert.equal(viejo.contactoInicial, null);
  assert.equal(viejo.contactoSemana, null);
  /* Sin el día de ingreso, como antes. */
  assert.equal(aplicarContacto(base, HOY).contactoInicial, null);
});

test("Mi panel: «Alumnos nuevos» incluye las reservas (el 12/11 entraron cuatro y la lista decía uno)", () => {
  const e = estado(
    [alumno("r1", "Reserva Uno", dia(-1)), alumno("r2", "Reserva Dos", dia(0)), alumno("p1", "Pago Completo", dia(0)), alumno("ya", "Ya Contactada", dia(-1))],
    [seg("ya", { contactoInicial: dia(-1), ultimoContacto: dia(-1) })],
    { ventas: [{ id: "v1" }, { id: "v2" }] as never, cuotas: [
      { id: "c1", ventaId: "v1", numero: 0, esReserva: true, estado: "pagada", monto: 100 }, { id: "c2", ventaId: "v1", numero: 1, esReserva: false, estado: "pendiente", monto: 900 },
      { id: "c3", ventaId: "v2", numero: 0, esReserva: true, estado: "pagada", monto: 100 }, { id: "c4", ventaId: "v2", numero: 1, esReserva: false, estado: "pendiente", monto: 900 },
    ] as never },
  );
  e.alumnos[0] = { ...e.alumnos[0], ventaId: "v1" };
  e.alumnos[1] = { ...e.alumnos[1], ventaId: "v2" };
  const p = panelDeServicio(e, HOY, AHORA);
  assert.deepEqual(lista(p, "nuevos").sort(), ["Pago Completo", "Reserva Dos", "Reserva Uno"]);
  const reserva = p.secciones.find((s) => s.id === "nuevos")!.items.find((i) => i.nombre === "Reserva Uno")!;
  assert.match(reserva.detalle, /reserva/);
  assert.match(reserva.detalle, /falta la bienvenida/);
  assert.equal(reserva.tono, "rojo", "entró ayer: ya es tarde");
  assert.equal(p.secciones.find((s) => s.id === "nuevos")!.items.find((i) => i.nombre === "Pago Completo")!.tono, "ambar", "entró hoy: está a tiempo");
});

test("Mi panel: el semanal aparece al día 7 y se va cuando se lo hace; no hay dobles con «Alumnos nuevos» ni con el de 20 días", () => {
  const e = estado(
    [
      alumno("s6", "Seis Dias", dia(-6)), alumno("s7", "Siete Dias", dia(-7)), alumno("s9", "Nueve Dias", dia(-9)), alumno("hecho", "Ya Hablada", dia(-9)),
      alumno("sin", "Nunca Contactado", dia(-12)), alumno("v25", "Veinticinco Dias", dia(-25)),
    ],
    [
      seg("s6", { contactoInicial: dia(-6), ultimoContacto: dia(-6) }), seg("s7", { contactoInicial: dia(-7), ultimoContacto: dia(-7) }),
      seg("s9", { contactoInicial: dia(-9), ultimoContacto: dia(-9) }), seg("hecho", { contactoInicial: dia(-9), contactoSemana: dia(-2), ultimoContacto: dia(-2) }),
      /* Entró hace 25 días y le hablaron a los 8: le toca el de 20 días a los 28. */
      seg("v25", { contactoInicial: dia(-25), contactoSemana: dia(-17), ultimoContacto: dia(-17) }),
    ],
  );
  const p = panelDeServicio(e, HOY, AHORA);
  assert.deepEqual(lista(p, "semanal").sort(), ["Nueve Dias", "Nunca Contactado", "Siete Dias"].sort());
  assert.deepEqual(lista(p, "nuevos"), ["Nunca Contactado"], "al que nunca le hablaron le falta también la bienvenida");
  const s7 = p.secciones.find((s) => s.id === "semanal")!.items.find((i) => i.nombre === "Siete Dias")!;
  assert.equal(s7.cuando, "hoy");
  assert.equal(s7.tono, "ambar");
  assert.equal(p.secciones.find((s) => s.id === "semanal")!.items.find((i) => i.nombre === "Nueve Dias")!.tono, "rojo", "dos días tarde");
  /* El de 20 días no repite a quien ya está en las listas del ingreso. */
  assert.deepEqual(lista(p, "contactar"), [], "ninguno cumplió todavía los 20 días desde su último contacto");
  assert.equal(p.secciones.find((s) => s.id === "semanal")!.titulo, "Contacto semanal");
  assert.equal(p.secciones.find((s) => s.id === "contactar")!.titulo, "Seguimiento 20D");
});

test("Seguimiento 20D: a los 20 días del último contacto, no a los 15; y el que pasó los 20 sin ningún contacto cae ahí, no se pierde", () => {
  const e = estado(
    [alumno("a", "Dia Diecinueve", dia(-60)), alumno("b", "Dia Veinte", dia(-60)), alumno("c", "Nunca Hablado", dia(-40))],
    [seg("a", { contactoInicial: dia(-60), ultimoContacto: dia(-19) }), seg("b", { contactoInicial: dia(-60), ultimoContacto: dia(-20) }), seg("c")],
  );
  const p = panelDeServicio(e, HOY, AHORA);
  assert.deepEqual(lista(p, "contactar").sort(), ["Dia Veinte", "Nunca Hablado"]);
  assert.deepEqual(lista(p, "nuevos"), [], "pasó la ventana del ingreso");
});

test("la campanita abre la solapa Seguimiento con el aviso de una venta nueva", () => {
  assert.equal(hojaDelAviso("venta-nueva"), "seguimiento");
});
