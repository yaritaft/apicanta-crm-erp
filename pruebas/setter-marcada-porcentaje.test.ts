import test from "node:test";
import assert from "node:assert/strict";
import { acciones } from "@/lib/store";
import { porcentajeDelSetterMarcado } from "@/lib/setter-agendas";
import type { Cuota, EstadoApp, Lead, MiembroEquipo, Sesion, Venta } from "@/lib/types";

/* ==================================================================
   Fede (02/11): «Daniel setter comisión 2%». Daniel se marca él mismo las agendas y casi todas son leads del webinar a los que sólo les manda un mensaje:
   esas ventas le comisionan el 2% y no el 5% de siempre. Para que no dependa de que alguien se acuerde en cada venta nueva, el setter tiene un
   «% cuando marca la agenda él» (`comisionSetterMarcada`) y la venta que sale de una agenda que ÉL marcó lo trae ya escrito en `comisionSetter`
   —lo mismo que cargaría Aldana a mano— (la base lo hace al guardar: supabase/comision-setter-marcada.sql; la app, para mostrarlo ya).
   ================================================================== */

const DIA = 86_400_000;
const T = (dia: number) => new Date(Date.parse("2026-11-01T15:00:00.000Z") + dia * DIA).toISOString();
const ses = (id: string, dia: number, extra: Partial<Sesion> = {}) => ({ id, inicia: T(dia), contactoId: `lea_${id}`, leadId: `lea_${id}`, ...extra }) as Pick<Sesion, "id" | "contactoId" | "leadId" | "inicia" | "setterId" | "setterMarcadoEn">;
const equipo = (porc?: number | null) => [{ id: "eq_daniel", comisionSetterMarcada: porc }, { id: "eq_otro" }];

test("la venta que sale de una agenda que marcó el setter toma su % de las marcadas", () => {
  const sesiones = [ses("a", -3, { setterId: "eq_daniel", setterMarcadoEn: T(-2) })];
  const e = { sesiones, equipo: equipo(0.02) };
  assert.equal(porcentajeDelSetterMarcado(e, { setterId: "eq_daniel", contactoId: "lea_a", fecha: T(0) }), 0.02, "por la persona (dentro de los 45 días)");
  assert.equal(porcentajeDelSetterMarcado(e, { setterId: "eq_daniel", sesionId: "a", fecha: T(0) }), 0.02, "por la llamada misma");
  assert.equal(porcentajeDelSetterMarcado({ sesiones, equipo: equipo(0) }, { setterId: "eq_daniel", contactoId: "lea_a", fecha: T(0) }), 0, "0% también es un porcentaje: no comisiona");
});

test("no corresponde si no la marcó él, si es de otro setter, si pasaron más de 45 días o si no hay regla", () => {
  const link = [ses("l", -3, { setterId: "eq_daniel" })]; // entró por su link: tiene setter pero nadie la marcó
  assert.equal(porcentajeDelSetterMarcado({ sesiones: link, equipo: equipo(0.02) }, { setterId: "eq_daniel", contactoId: "lea_l", fecha: T(0) }), undefined, "sin marca");
  const marcada = [ses("m", -3, { setterId: "eq_daniel", setterMarcadoEn: T(-2) })];
  const dePrueba = (e: Parameters<typeof porcentajeDelSetterMarcado>[0], v: Parameters<typeof porcentajeDelSetterMarcado>[1]) => porcentajeDelSetterMarcado(e, v);
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(0.02) }, { setterId: "eq_otro", contactoId: "lea_m", fecha: T(0) }), undefined, "la marcó otro");
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(0.02) }, { setterId: "eq_daniel", contactoId: "lea_m", fecha: T(60) }), undefined, "60 días después ya no cuenta");
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(0.02) }, { setterId: "eq_daniel", contactoId: "lea_m", fecha: T(-10) }), undefined, "una agenda posterior a la venta no cuenta");
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(0.02) }, { setterId: "eq_daniel", contactoId: "lea_otra", fecha: T(0) }), undefined, "otra persona");
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(null) }, { setterId: "eq_daniel", contactoId: "lea_m", fecha: T(0) }), undefined, "sin regla: lo de siempre");
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(undefined) }, { setterId: "eq_daniel", contactoId: "lea_m", fecha: T(0) }), undefined);
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(1.5) }, { setterId: "eq_daniel", contactoId: "lea_m", fecha: T(0) }), undefined, "un % imposible se ignora");
  assert.equal(dePrueba({ sesiones: marcada, equipo: equipo(0.02) }, { contactoId: "lea_m", fecha: T(0) }), undefined, "sin setter");
});

/* ---------- Con el store de verdad ---------- */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const ventaDe = (id: string) => estado().ventas.find((v) => v.id === id)!;

function persona(n: number, sesion: Partial<Sesion>): { lead: string; sesionId: string } {
  const lead = acciones.crear<Lead>("leads", {
    id: `lead_marcada_${n}`, nombre: `Persona ${n}`, email: `marcada${n}@mail.com`, fuente: "Webinar", etapaId: estado().etapas[0].id, monto: 0, moneda: "USD",
    responsable: "", etiquetas: [], creadoEn: "2026-10-20T12:00:00.000Z", actualizadoEn: "2026-10-20T12:00:00.000Z", extra: {},
  }, `Persona ${n}`);
  const sesionId = acciones.crear<Sesion>("sesiones", {
    id: `ses_marcada_${n}`, titulo: "Llamada de asesoramiento", tipo: "Llamada de Asesoramiento - Webinar - Team", invitado: `Persona ${n}`, leadId: lead,
    inicia: "2026-10-26T15:00:00.000Z", duracionMin: 45, estado: "hecha", origen: "calendly", creadoEn: "2026-10-24T12:00:00.000Z", extra: {}, anfitrion: "Dante Barbieri", ...sesion,
  }, `Llamada ${n}`);
  return { lead, sesionId };
}

function venderA(n: number, lead: string, sesionId: string, extra: Partial<Venta> = {}) {
  const id = `v_marcada_${n}`;
  const fecha = "2026-10-27T15:00:00.000Z";
  const venta: Venta = {
    id, contactoId: lead, contactoNombre: `Persona ${n}`, productoId: estado().productos[0].id, precioAcordado: 3000, moneda: "USD", excluidoMarketing: false,
    estado: "activa", fecha, creadoEn: fecha, extra: {}, closerId: estado().equipo.find((m) => m.rol === "closer")?.id, ...extra,
  };
  const cuotas: Cuota[] = [{ id: `${id}_c1`, ventaId: id, numero: 1, monto: 3000, estado: "pendiente", esReserva: false, vence: fecha }];
  acciones.registrarVenta({ venta, cuotas, cobros: [], sesionId });
  return ventaDe(id);
}

test("al cargar la venta de una agenda que marcó Daniel, la venta ya trae su 2% (propio, como si lo hubiera cargado Aldana); el closer no hace nada", () => {
  const daniel: MiembroEquipo = { id: "eq_daniel_prueba", nombre: "Daniel de prueba", rol: "setter", comisionRate: 0.05, activo: true, sinComision: false, comisionSetterMarcada: 0.02 };
  acciones.guardarMiembro(daniel);
  const { lead, sesionId } = persona(1, { setterId: daniel.id, setterMarcadoEn: "2026-10-25T12:00:00.000Z" });
  const v = venderA(1, lead, sesionId);
  assert.equal(v.setterId, daniel.id, "la venta toma al setter que marcó la agenda");
  assert.equal(v.comisionSetter, 0.02);
});

test("lo que entra por el link del setter (sin marcar) o con un % ya fijado queda como estaba", () => {
  const daniel = estado().equipo.find((m) => m.id === "eq_daniel_prueba")!;
  assert.equal(daniel.comisionSetterMarcada, 0.02);
  /* Con setter pero nadie marcó la agenda (entró por su link): lo de siempre. */
  const porLink = persona(2, { setterId: daniel.id });
  assert.equal(venderA(2, porLink.lead, porLink.sesionId).comisionSetter, undefined);
  /* Marcada, pero la venta ya trae un % que alguien fijó: no se pisa. */
  const fijada = persona(3, { setterId: daniel.id, setterMarcadoEn: "2026-10-25T12:00:00.000Z" });
  assert.equal(venderA(3, fijada.lead, fijada.sesionId, { comisionSetter: 0.05 }).comisionSetter, 0.05);
  /* Y un 0% fijado tampoco: «no comisiona» es una decisión. */
  const cero = persona(4, { setterId: daniel.id, setterMarcadoEn: "2026-10-25T12:00:00.000Z" });
  assert.equal(venderA(4, cero.lead, cero.sesionId, { comisionSetter: 0 }).comisionSetter, 0);
});

test("sin el % de las marcadas en la ficha del setter, todo sigue como antes", () => {
  const daniel = estado().equipo.find((m) => m.id === "eq_daniel_prueba")!;
  acciones.guardarMiembro({ ...daniel, comisionSetterMarcada: null });
  const { lead, sesionId } = persona(5, { setterId: daniel.id, setterMarcadoEn: "2026-10-25T12:00:00.000Z" });
  const v = venderA(5, lead, sesionId);
  assert.equal(v.setterId, daniel.id);
  assert.equal(v.comisionSetter, undefined, "comisiona el 5% de siempre");
});
