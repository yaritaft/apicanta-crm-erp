import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* Lili (24/10): Jorge Llamas quedó dos veces. El closer cargó la venta (que crea el alumno sola) y minutos después Lili lo creó a
   mano desde una pantalla que estaba abierta de antes y no lo tenía. «Nuevo alumno» no se fía de la pantalla: antes de crear le
   pregunta a la base por la misma venta, la misma persona del CRM o el mismo mail. */

test("«Nuevo alumno» le pregunta a la base antes de crear, y si ya está no lo crea", () => {
  const s = readFileSync("src/components/alumnos/AsistenteAlumno.tsx", "utf8");
  const crear = s.slice(s.indexOf("async function crear()"));
  const pregunta = crear.indexOf("await alumnoEnLaBase(");
  const crea = crear.indexOf('acciones.crear<Alumno>("alumnos"');
  assert.ok(pregunta > 0 && crea > pregunta, "primero pregunta, después crea");
  assert.match(crear.slice(pregunta, crea), /if \(existente\) \{[\s\S]*return;/, "si existe, corta antes de crear");
  const base = readFileSync("src/components/alumnos/alumno-en-la-base.ts", "utf8");
  for (const campo of ["ventaId.eq.", "leadId.eq.", "email.ilike."]) assert.ok(base.includes(campo), campo);
});
