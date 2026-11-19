import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tonoDeResell } from "@/components/cs/pastillas";

/* Lili, 19/11, sobre la agenda de resells: «follow up Upgrade en verde; outbording / no quiere grabar en rojo; las otras opciones en amarillo
   (porque se me marean los colores). Botón recordar (closer y Santi). Filtro: incompleto». El SQL del recordatorio, en
   pruebas-estres/sql/sql-testimonio-completo.test.ts. */

test("una sola regla de colores: Upgrade verde, lo que sale del programa rojo, todo lo demás amarillo", () => {
  for (const v of ["Upgrade a Hackear IA", "upgrade a hackear ia", "Renueva"]) assert.equal(tonoDeResell(v), "ok", v);
  for (const v of ["Outbording", "Outboarding", "No quiere renovar", "No renueva", "No renueva / Outbording", "No quiere grabar", "No quiso grabar", "OUTBORDING"]) assert.equal(tonoDeResell(v), "malo", v);
  for (const v of ["2da Agenda", "Seguimiento", "Garantía Extendida", "Alumno vigente", "Alumno activo", "Reservó", "No responde", "Lo piensa"]) assert.equal(tonoDeResell(v), "aviso", v);
  assert.equal(tonoDeResell(""), "neutra");
  assert.equal(tonoDeResell("   "), "neutra");
});

test("la agenda, la ficha, el panel y los testimonios pintan los estados con esa regla", () => {
  for (const archivo of ["src/components/cs/ResellsCs.tsx", "src/components/mi-panel/ResellsDelMes.tsx", "src/components/cs/TestimoniosCs.tsx", "src/components/ficha/HojaServicio.tsx"]) {
    assert.match(readFileSync(archivo, "utf8"), /tonoDeResell\(/, archivo);
  }
  /* La ficha ya no decide el color con su propio texto. */
  assert.doesNotMatch(readFileSync("src/components/ficha/HojaServicio.tsx", "utf8"), /\/no quiere\|outbo\/i\.test/);
});

test("el resumen de la agenda: «Incompletos» en amarillo y los que no renuevan en rojo", () => {
  const src = readFileSync("src/components/cs/ResellsCs.tsx", "utf8");
  assert.match(src, /id: "no", nombre: "No renovaron", tono: "malo"/);
  assert.match(src, /id: "cerrar", nombre: "Incompletos", tono: "alerta"/);
  assert.doesNotMatch(src, /nombre: "Por cerrar"/);
  assert.match(readFileSync("src/components/finanzas/visual/visual.tsx", "utf8"), /p\.tono === "malo" \? "var\(--danger\)"/);
});

test("«Recordar» en cada llamada incompleta, sólo para quien lleva el servicio; el aviso lleva al panel", () => {
  const src = readFileSync("src/components/cs/ResellsCs.tsx", "utf8");
  assert.match(src, /puedeRecordar && resellAbierto\(f\.resell, Date\.now\(\)\)/, "sólo en las abiertas");
  assert.match(src, /const puedeRecordar = puedeEditar\(acceso, "testimonios"\)/, "el closer, que edita resells, no lo ve");
  assert.match(src, /recordarResell\(f\.resell\.id\)/);
  assert.match(readFileSync("src/lib/recordar-testimonio.ts", "utf8"), /rpc\(funcion, parametro\)[\s\S]*recordar_resell/);
  assert.match(readFileSync("src/components/avisos/Campanita.tsx", "utf8"), /"testimonio-pendiente" \|\| a\.tipo === "resell-pendiente"\) \{ router\.push\("\/mi-panel"\)/);
});
