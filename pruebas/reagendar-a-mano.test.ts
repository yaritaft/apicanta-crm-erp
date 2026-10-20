import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import { EDITOR, escrituraDe, filasTabla, isoDeLocal, localDeLlamada, POR_QUE_NO, valorEditable } from "@/lib/crm-tabla";

/* Dante (19/10): «tengo un lead que reagendó para el lunes pero en el sistema no se actualizó, quedó la llamada en el sábado: estaría
   bueno poder modificarlo manualmente». La fecha y la hora de la llamada se cambian en la celda de la tabla del CRM. */

const ctx = (e: ReturnType<typeof construirSemilla>) => ({ ajustes: e.ajustes, quien: "Dante Barbieri", cuando: "2026-10-19T15:00:00.000Z" });

test("la hora de una llamada se lee y se escribe en hora de Argentina", () => {
  assert.equal(localDeLlamada("2026-10-17T19:00:00.000Z"), "2026-10-17T16:00", "el sábado 17/10 a las 16:00 de Tomás");
  assert.equal(localDeLlamada("2026-10-18T02:59:00.000Z"), "2026-10-17T23:59", "borde de la medianoche");
  assert.equal(localDeLlamada("2026-10-18T03:00:00.000Z"), "2026-10-18T00:00", "medianoche exacta, no «24:00»");
  assert.equal(isoDeLocal("2026-10-19T16:00"), "2026-10-19T19:00:00.000Z");
  assert.equal(isoDeLocal("2026-10-19T16:00"), isoDeLocal(" 2026-10-19T16:00 "));
  for (const mal of ["", "lunes", "2026-10-19", "2026-13-40T10:00", "2026-10-19 16:00"]) assert.equal(isoDeLocal(mal), null, mal);
  const iso = "2026-10-20T12:30:00.000Z";
  assert.equal(isoDeLocal(localDeLlamada(iso)), iso, "ida y vuelta");
});

test("la columna Llamada se edita (y ya no dice «la pone Calendly»)", () => {
  assert.equal(EDITOR.llamada, "fechahora");
  assert.equal(POR_QUE_NO.llamada, undefined);
});

test("pasar la llamada al lunes: cambia el día y la hora, y deja marcado lo que decía Calendly", () => {
  const e = construirSemilla();
  const f = filasTabla(e).find((x) => x.sesion.estado !== "cancelada")!;
  const original = f.sesion.inicia;
  const w = escrituraDe(f, "llamada", "2030-01-07T18:30", ctx(e));
  assert.ok(w && w.tipo === "llamada");
  assert.equal(w.cambios.inicia, "2030-01-07T21:30:00.000Z");
  assert.deepEqual(w.cambios.extra?.inicioManual, { antes: original, por: "Dante Barbieri", en: "2026-10-19T15:00:00.000Z" });
  assert.match(w.detalle, /la llamada se pasó del .* al 2030-01-07 18:30/);
});

test("pasarla otra vez no pierde lo que decía Calendly; volver a ese horario saca la marca", () => {
  const e = construirSemilla();
  const f = filasTabla(e).find((x) => x.sesion.estado !== "cancelada")!;
  const original = f.sesion.inicia;
  const primera = escrituraDe(f, "llamada", "2030-01-07T18:30", ctx(e));
  assert.ok(primera && primera.tipo === "llamada");
  const e2 = { ...e, sesiones: e.sesiones.map((s) => (s.id === f.sesion.id ? { ...s, ...primera.cambios } : s)) };
  const f2 = filasTabla(e2).find((x) => x.id === f.id)!;
  assert.equal(valorEditable(f2, "llamada"), "2030-01-07T18:30");
  const segunda = escrituraDe(f2, "llamada", "2030-01-08T10:00", ctx(e2));
  assert.ok(segunda && segunda.tipo === "llamada");
  assert.equal((segunda.cambios.extra?.inicioManual as { antes: string }).antes, original, "sigue siendo la hora de Calendly");
  const vuelta = escrituraDe(f2, "llamada", localDeLlamada(original), ctx(e2));
  assert.ok(vuelta && vuelta.tipo === "llamada");
  assert.equal(vuelta.cambios.inicia, original);
  assert.equal(vuelta.cambios.extra?.inicioManual, undefined, "ya no está cambiada a mano");
});

test("lo que no es una fecha, o es la misma, no escribe nada", () => {
  const e = construirSemilla();
  const f = filasTabla(e)[0];
  for (const v of ["", "mañana", "2030-01-07", valorEditable(f, "llamada")]) assert.equal(escrituraDe(f, "llamada", v, ctx(e)), null, v);
});
