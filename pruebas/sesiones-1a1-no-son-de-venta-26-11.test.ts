import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import { esLlamadaDeVenta, esSesionUnoAUno } from "@/lib/llamadas-de-venta";
import { esSesionUnoAUno as desdeBonos } from "@/lib/bonos";
import { llamadasDelDia } from "@/lib/eod";
import { sesionesUnoAUnoQueVienen } from "@/lib/mi-panel";
import type { EstadoApp, Sesion } from "@/lib/types";

/* Liliana, 26/11: pasó el link de Nahuel (calendly.com/nahuel-apicanta/sesion-1-a-1-nahuel) para que cada sesión quede en la ficha del
   alumno. Entran solas (ya estaba: supabase/sesiones-1a1-y-avisos-de-resell.sql), pero a la app llegan como una llamada más y el Dashboard
   y las listas del closer las contaban como llamadas de venta. Son otra cosa: «un bono, un extra que tiene el alumno» que se toma con
   Yari, con Nahuel o con ella, sobre un tema puntual. Con 181 sesiones incluidas en contratos de alumnos activos contra ~300 agendas por
   mes, iban a inflar las agendas y a bajar la asistencia y el % de cierre. Una sola regla: lib/llamadas-de-venta.ts. */

test("qué es una llamada de venta: ni la de resell ni la sesión 1 a 1 (la de Yari y la de Nahuel)", () => {
  for (const tipo of ["Llamada de Asesoramiento - Webinar", "Llamada de Asesoramiento - VSL - Team", "Llamada de Asesoramiento - Setter", "60 Minute Meeting", ""]) {
    assert.equal(esLlamadaDeVenta({ tipo }), true, tipo);
  }
  for (const tipo of ["Sesión 1 a 1", "Sesión 1 a 1 (Nahuel)", "Sesion 1:1", "Auditoría", "Resell", "Próximos pasos", "Testimonio"]) {
    assert.equal(esLlamadaDeVenta({ tipo }), false, tipo);
  }
  assert.equal(esLlamadaDeVenta({ tipo: "Llamada de Asesoramiento - Later", utm: { utm_source: "Resell" } }), false, "la de resell por su link");
  assert.equal(esSesionUnoAUno({ tipo: "Sesión 1 a 1 (Nahuel)" }), true);
  assert.equal(desdeBonos, esSesionUnoAUno, "la de lib/bonos.ts es la misma función");
});

/* El semillero entero más cuatro sesiones 1 a 1 (dos con Nahuel) y, aparte, una de resell. */
const base = construirSemilla();
const corte: Corte = { clave: "total", titulo: "Total", desde: "2026-01-01", hasta: "2026-12-31", foto: true, total: true };
const s1a1 = (id: string, x: Partial<Sesion>): Sesion => ({
  id, titulo: "Sesión 1 a 1 (Nahuel)", tipo: "Sesión 1 a 1 (Nahuel)", invitado: "Alumno Prueba", email: "alumno@x.com", duracionMin: 60, origen: "calendly",
  canal: "otro", anfitrion: "Nahuel Abadia", inicia: "2026-06-10T18:00:00.000Z", creadoEn: "2026-06-01T12:00:00.000Z", estado: "hecha", ...x,
} as Sesion);
const unoAUno: Sesion[] = [
  s1a1("ses_1a1_hecha", {}),
  s1a1("ses_1a1_noshow", { estado: "no-show" as Sesion["estado"] }),
  s1a1("ses_1a1_cancelada", { estado: "cancelada", titulo: "Sesión 1 a 1", tipo: "Sesión 1 a 1", anfitrion: "Yari Taft" }),
  s1a1("ses_1a1_porvenir", { estado: "agendada", inicia: "2099-01-10T18:00:00.000Z", titulo: "Sesión 1 a 1", tipo: "Sesión 1 a 1", anfitrion: "Yari Taft" }),
];
const con = (extra: Sesion[]): EstadoApp => ({ ...base, sesiones: [...base.sesiones, ...extra] });
const LLAMADAS = ["ag_nuevas", "ag_calif", "ag_calif_pct", "ag_hechas", "ag_noshow", "ag_canceladas", "ag_show", "ag_porvenir", "ag_costo"];
const valores = (e: EstadoApp) => {
  const defs = new Map(catalogo(e).map((d) => [d.id, d]));
  const c = new Contexto(e, corte);
  return Object.fromEntries(LLAMADAS.map((id) => { assert.ok(defs.has(id), `falta la fila ${id}`); return [id, valorEn(defs.get(id)!, c)]; }));
};

test("el Dashboard no cuenta las sesiones 1 a 1: agendadas, calificadas, hechas, no vinieron, canceladas, asistencia y por venir quedan igual", () => {
  const antes = valores(base);
  assert.ok((antes.ag_nuevas as number) > 0 && (antes.ag_hechas as number) > 0, "el semillero tiene llamadas");
  assert.deepEqual(valores(con(unoAUno)), antes);
  assert.equal(new Contexto(con(unoAUno), corte).sesiones()?.some((s) => esSesionUnoAUno(s)), false);
});

test("las de resell siguen contando en el Dashboard como hasta ahora (lo que cambia son sólo las 1 a 1)", () => {
  const resell = s1a1("ses_resell", { titulo: "Auditoría", tipo: "Auditoría", anfitrion: "Mariano Arias" });
  const antes = valores(base), despues = valores(con([resell]));
  assert.equal(despues.ag_nuevas, (antes.ag_nuevas as number) + 1);
  assert.equal(despues.ag_hechas, (antes.ag_hechas as number) + 1);
});

test("con un filtro de webinar tampoco: aunque el alumno haya venido de ese webinar, su 1 a 1 no es una agenda del webinar", () => {
  const w = base.webinars[0];
  const lead = base.leads.find((l) => l.webinarId === w.id) ?? base.leads[0];
  const e = con([s1a1("ses_1a1_del_webinar", { leadId: lead.id, contactoId: lead.contactoId, canal: "webinar" })]);
  const delWebinar = (x: EstadoApp) => new Contexto(x, { ...corte, filtro: { webinarId: w.id } }).sesiones() ?? [];
  assert.ok(delWebinar(base).length > 0, "el filtro atribuye llamadas a ese webinar");
  assert.deepEqual(delWebinar(e).map((s) => s.id), delWebinar(base).map((s) => s.id));
  /* Sin la regla, esa sesión entraría: la misma llamada con nombre de venta sí es del webinar. */
  const comoVenta = con([s1a1("ses_venta_del_webinar", { leadId: lead.id, contactoId: lead.contactoId, canal: "webinar", titulo: "Llamada de Asesoramiento - Webinar", tipo: "Llamada de Asesoramiento - Webinar" })]);
  assert.equal(delWebinar(comoVenta).some((s) => s.id === "ses_venta_del_webinar"), true);
});

test("al mentor que también vende no se le pide cargar el cierre de una 1 a 1, y le sigue saliendo en «Tus sesiones 1 a 1»", () => {
  const equipo = [{ id: "eq_m", nombre: "Mariano Arias", rol: "closer", activo: true }] as unknown as EstadoApp["equipo"];
  const venta = { id: "ses_venta", titulo: "x", tipo: "Llamada de Asesoramiento - Webinar", inicia: "2099-01-10T15:00:00.000Z", estado: "agendada", anfitrion: "Mariano Arias", creadoEn: "2026-11-01T00:00:00Z", duracionMin: 45, origen: "calendly" } as Sesion;
  const suya = s1a1("ses_1a1_de_mariano", { estado: "agendada", inicia: "2099-01-10T18:00:00.000Z", anfitrion: "Mariano Arias" });
  const e = { sesiones: [venta, suya], equipo, alumnos: [], seguimientos: [] } as unknown as EstadoApp;
  assert.deepEqual(llamadasDelDia(e, "Mariano Arias", "2099-01-10").map((s) => s.id), ["ses_venta"], "el cierre del día es de las llamadas de venta");
  assert.deepEqual(sesionesUnoAUnoQueVienen(e, { nombre: "Mariano Arias" }, Date.parse("2099-01-01T12:00:00Z")).map((x) => x.sesion.id), ["ses_1a1_de_mariano"]);
});
