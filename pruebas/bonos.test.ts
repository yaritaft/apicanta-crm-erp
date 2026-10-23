import test from "node:test";
import assert from "node:assert/strict";
import { conQuien, conSesion, resumenBonos } from "@/lib/bonos";
import type { SesionUnoAUno } from "@/lib/types";

const s = (id: string, fecha: string, con: string): SesionUnoAUno => ({ id, fecha, con, notas: "", grabacion: "", creadoEn: `${fecha}T12:00:00.000Z`, creadoPor: "Lili" });

test("bonos: las sesiones con el mentor se cuentan contra las del contrato y vencen a los 3 meses del inicio", () => {
  const r = resumenBonos({ sesionesMentor: 2, sesionesUnoAUno: [s("a", "2026-08-10", "Yari"), s("b", "2026-08-20", "Lili")] }, "2026-07-01", "2026-09-15");
  assert.deepEqual([r.incluidas, r.tomadas, r.quedan, r.vencen, r.vencidas], [2, 1, 1, "2026-10-01", false]);
  assert.deepEqual(r.conOtros.map((x) => x.id), ["b"], "las de Lili van aparte y no gastan las del contrato");
  assert.equal(resumenBonos({ sesionesMentor: 2, sesionesUnoAUno: [s("a", "2026-08-10", "Yari")] }, "2026-07-01", "2026-10-02").vencidas, true, "pasado el plazo con sesiones sin tomar");
  assert.equal(resumenBonos({ sesionesMentor: 1, sesionesUnoAUno: [s("a", "2026-08-10", "Yari")] }, "2026-07-01", "2026-12-01").vencidas, false, "las tomó todas: no hay nada vencido");
});

test("bonos: sin las del contrato cargadas no se inventa el saldo; tomar de más no da negativo", () => {
  const r = resumenBonos({ sesionesMentor: null, sesionesUnoAUno: [] }, "", "2026-10-21");
  assert.deepEqual([r.incluidas, r.quedan, r.vencen, r.vencidas], [null, null, "", false]);
  assert.equal(resumenBonos({ sesionesMentor: 1, sesionesUnoAUno: [s("a", "2026-08-10", "Yari"), s("b", "2026-08-11", "yari taft")] }, "2026-07-01", "2026-08-12").quedan, 0);
});

test("bonos: agregar, corregir y borrar una sesión por su id", () => {
  const una = conSesion([], s("a", "2026-08-10", "Yari"));
  const corregida = conSesion(una, { ...una[0], notas: "Habló del CV" });
  assert.deepEqual(corregida.map((x) => [x.id, x.notas]), [["a", "Habló del CV"]]);
  assert.deepEqual(conSesion(corregida, corregida[0], true), []);
});

test("bonos: el mentor puede ser cualquiera (Yari, un socio, un closer): sólo Lili queda aparte (Yari, 22/10)", () => {
  const r = resumenBonos({ sesionesMentor: 3, sesionesUnoAUno: [s("a", "2026-08-10", "Mentor"), s("b", "2026-08-11", "Mariano"), s("c", "2026-08-12", "Yari"), s("d", "2026-08-13", "Lili")] }, "2026-07-01", "2026-08-20");
  assert.deepEqual([r.tomadas, r.quedan], [3, 0]);
  assert.deepEqual(r.conOtros.map((x) => x.id), ["d"]);
  assert.equal(conQuien("Mentor"), "el mentor");
  assert.equal(conQuien("Yari"), "Yari");
});
