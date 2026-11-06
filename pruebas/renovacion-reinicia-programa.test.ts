import test from "node:test";
import assert from "node:assert/strict";
import { alumnoRenovadoPor, renuevaElPrograma } from "@/lib/alumnos";
import { egresoDelPrograma, egresoEscritoAMano } from "@/lib/clientes-cs";
import { inicioReal, pausasDelCiclo, problemaDePausa } from "@/lib/pausas";
import type { EstadoApp, PausaServicio, Venta } from "@/lib/types";

/* Liliana (07/11): Gerardo Nava renovó el 06/11 (venta, contrato y accesos cargados) y la ficha seguía diciendo que inició el
   30/10/25. Al «Demorar el inicio» contaba desde ahí: 433 días en lugar de los 61 hasta el 06/01/2027. */

const productos = [
  { id: "prod_hackear_it", tipo: "principal" }, { id: "prod_upsell", tipo: "upsell" }, { id: "prod_upgrade_ai", tipo: "upsell" },
  { id: "prod_mastermind", tipo: "evento" }, { id: "prod_resultados", tipo: "downsell" },
] as EstadoApp["productos"];

const primera = { id: "ven_1", contactoId: "l1", contactoNombre: "Gerardo Nava", estado: "activa", productoId: "prod_hackear_it", fecha: "2025-10-30T15:00:00.000Z" } as Venta;
const renovacion = { id: "ven_2", contactoId: "l1", contactoNombre: "Gerardo Nava", estado: "activa", productoId: "prod_upsell", fecha: "2026-11-06T15:17:26.980Z" } as Venta;

const estado = (): EstadoApp => ({
  productos, leads: [{ id: "l1", nombre: "Gerardo Nava", email: "g@mail.com" }], contactos: [],
  ventas: [primera], seguimientos: [],
  alumnos: [{ id: "alu_1", nombre: "Gerardo Nava", email: "g@mail.com", leadId: "l1", ventaId: "ven_1", inicio: "2025-10-30T15:00:00.000Z" }],
} as unknown as EstadoApp);

const demora = (desde: string, hasta: string, extra: Partial<PausaServicio> = {}): PausaServicio =>
  ({ id: "d1", tipo: "demora", desde, hasta, motivo: "", creadoEn: "", creadoPor: "", ...extra });

test("una compra de upsell o upgrade renueva: el inicio del alumno pasa a la fecha de la compra", () => {
  const e = estado();
  const a = alumnoRenovadoPor(e, renovacion);
  assert.equal(a?.inicio, "2026-11-06T15:17:26.980Z");
  assert.equal(a?.ventaId, "ven_1", "sigue atado a su primera venta");
  assert.equal(alumnoRenovadoPor(e, { ...renovacion, productoId: "prod_upgrade_ai" })?.inicio, "2026-11-06T15:17:26.980Z");
});

test("lo que no renueva no mueve el inicio: eventos, downsell, canceladas, la primera compra y las cargadas con fecha anterior", () => {
  const e = estado();
  assert.equal(renuevaElPrograma(e, { ...renovacion, productoId: "prod_mastermind" }), false);
  assert.equal(alumnoRenovadoPor(e, { ...renovacion, productoId: "prod_mastermind" }), null, "Mastermind");
  assert.equal(alumnoRenovadoPor(e, { ...renovacion, productoId: "prod_resultados" }), null, "downsell");
  assert.equal(alumnoRenovadoPor(e, { ...renovacion, estado: "cancelada" }), null, "cancelada");
  assert.equal(alumnoRenovadoPor(e, primera), null, "la primera compra nace con su fecha");
  const movido = { ...e, alumnos: [{ ...e.alumnos[0], inicio: "2026-12-01T15:00:00.000Z" }] } as EstadoApp;
  assert.equal(alumnoRenovadoPor(movido, renovacion), null, "una venta cargada tarde no atrasa un inicio posterior");
});

test("la demora de Gerardo desde la renovación son 61 días (dos meses) y no pide autorización", () => {
  const inicio = "2026-11-06";
  const d = demora(inicio, "2027-01-06");
  assert.equal(problemaDePausa(d, inicio, []), null);
  /* Con el inicio viejo era lo que le mostraba el cartel: de 433 días y con pedido de autorización. */
  assert.match(problemaDePausa(demora("2025-10-30", "2027-01-06"), "2025-10-30", []) ?? "", /serían 433/);
});

test("lo que terminó antes de la renovación es del programa anterior y no corre el fin del programa nuevo", () => {
  const vieja = demora("2025-10-30", "2025-12-29");
  const pausaVieja = { ...demora("2026-02-01", "2026-03-01"), id: "p1", tipo: "pausa" as const };
  const nueva = demora("2026-11-06", "2027-01-06", { id: "d2" });
  assert.deepEqual(pausasDelCiclo([vieja, pausaVieja, nueva], "2026-11-06").map((x) => x.id), ["d2"]);
  assert.equal(inicioReal("2026-11-06", [vieja]), "2026-11-06", "la demora vieja no mueve el arranque");
  assert.equal(inicioReal("2026-11-06", [vieja, nueva]), "2027-01-06");
  /* 12 meses desde el 06/01/2027, sin sumarle los 60 días de la demora de 2025 ni los 28 de la pausa. */
  assert.equal(egresoDelPrograma("2026-11-06", null, 12, [vieja, pausaVieja, nueva]), "2028-01-06");
  /* Sin renovar, todo cuenta como siempre. */
  assert.equal(egresoDelPrograma("2025-10-30", null, 12, [vieja, pausaVieja]), "2027-01-26");
});

test("un fin guardado que cae antes del inicio nuevo es del programa anterior, no la fecha definitiva", () => {
  assert.equal(egresoEscritoAMano("2026-11-06", "2026-10-30", 12), false);
  assert.equal(egresoDelPrograma("2026-11-06", "2026-10-30", 12, []), "2027-11-06");
  /* Uno escrito a mano para el programa nuevo se respeta. */
  assert.equal(egresoDelPrograma("2026-11-06", "2028-03-01", 12, []), "2028-03-01");
});
