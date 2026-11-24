import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  conEgresoEscrito, egresoDeEsteCiclo, escrituraCliente, finDelPrograma, listasCs, seguimientoCompleto, type FilaCliente,
} from "@/lib/clientes-cs";
import { configSeguimiento } from "@/lib/seguimiento";

/* 24/11: Juan Ignacio Ledesma renovó a Principals. La venta le corrió el inicio al 24/11, pero en su ficha quedó guardado el fin del
   Upgrade AI (18/12). Como cae después del inicio nuevo, la app lo tomaba como «escrito a mano» y el outboarding le iba a sacar los
   accesos el 18/12 (también a Rino el 13/12 y a Andrés el 02/01). LA RAÍZ: el fin guardado no decía para qué inicio valía. */

const cfg = configSeguimiento(undefined);
const ficha = (fechaEgreso: string | null, egresoDelInicio?: string | null) =>
  seguimientoCompleto({ alumnoId: "alu_cs_wcocdr", duracionMeses: 3, fechaEgreso, ...(egresoDelInicio !== undefined ? { egresoDelInicio } : {}) }, cfg);

test("Juan Ignacio: el fin del Upgrade AI (marcado para el inicio del 18/09) no cuenta en Principals: termina el 24/02", () => {
  const seg = ficha("2026-12-18", "2026-09-18");
  assert.equal(egresoDeEsteCiclo("2026-11-24", seg), null);
  assert.equal(finDelPrograma("2026-11-24", seg, "Principals", []), "2027-02-24");
});

test("un fin escrito para este inicio sí es la fecha definitiva; uno sin marca (de antes) sigue como estaba", () => {
  assert.equal(finDelPrograma("2026-11-24", ficha("2027-03-10", "2026-11-24"), "Principals", []), "2027-03-10");
  assert.equal(egresoDeEsteCiclo("2026-11-24", ficha("2026-12-18", null)), "2026-12-18", "sin marca: lo sella la base cuando el inicio avanza");
  assert.equal(egresoDeEsteCiclo("2026-11-24", ficha("2026-12-18")), "2026-12-18");
  assert.equal(egresoDeEsteCiclo("2026-11-24", { fechaEgreso: "2027-03-10", egresoDelInicio: "2026-11-24T15:00:00.000Z" }), "2027-03-10", "compara el día");
});

test("si el inicio vuelve atrás al ciclo para el que se escribió, el fin vuelve a valer", () => {
  const seg = ficha("2026-12-18", "2026-09-18");
  assert.equal(egresoDeEsteCiclo("2026-09-18", seg), "2026-12-18");
});

test("escribir el fin lo guarda con el inicio para el que vale; borrarlo, sin marca", () => {
  assert.deepEqual(conEgresoEscrito("2027-03-10", "2026-11-24"), { fechaEgreso: "2027-03-10", egresoDelInicio: "2026-11-24" });
  assert.deepEqual(conEgresoEscrito(null, "2026-11-24"), { fechaEgreso: null, egresoDelInicio: null });
  const f = { inicio: "2026-11-24" } as FilaCliente;
  const r = escrituraCliente(f, "egreso", "2027-03-10", listasCs(undefined));
  assert.equal(r.tipo, "seguimiento");
  assert.deepEqual(r.tipo === "seguimiento" && { fechaEgreso: r.cambios.fechaEgreso, egresoDelInicio: r.cambios.egresoDelInicio }, { fechaEgreso: "2027-03-10", egresoDelInicio: "2026-11-24" });
  const vacia = escrituraCliente(f, "egreso", "", listasCs(undefined));
  assert.deepEqual(vacia.tipo === "seguimiento" && vacia.cambios, { fechaEgreso: null, egresoDelInicio: null });
});

test("la ficha completa conserva la marca que trae y no inventa una (una fila de antes no manda la columna)", () => {
  assert.equal(ficha("2026-12-18", "2026-09-18").egresoDelInicio, "2026-09-18");
  assert.ok(!("egresoDelInicio" in ficha("2026-12-18")));
});

test("la base sella el fin del ciclo anterior cuando el inicio avanza y una pestaña vieja no borra la marca", () => {
  const sql = readFileSync(new URL("../supabase/egreso-de-cada-ciclo-24-11.sql", import.meta.url), "utf8");
  assert.match(sql, /add column if not exists "egresoDelInicio" text/);
  assert.match(sql, /after update of inicio on public\.alumnos/);
  assert.match(sql, /ahora <= antes then return new/, "sólo cuando avanza");
  assert.match(sql, /"egresoDelInicio" is null;/, "sólo al que no tiene marca");
  assert.match(sql, /security definer/, "también cuando lo mueve la venta de un closer, que no ve el seguimiento");
  assert.match(sql, /before update on public\.seguimiento_alumnos/);
  assert.match(sql, /is not distinct from old\."fechaEgreso"/);
});
