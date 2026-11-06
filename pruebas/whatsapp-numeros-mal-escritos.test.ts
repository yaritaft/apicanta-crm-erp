import test from "node:test";
import assert from "node:assert/strict";
import { claveSinCodigoRepetido, clavesDeTelefono, colasDeTelefono } from "@/lib/telefonos-wpp";
import { contarRegistros, pasaMarca, nuevoRegistro } from "@/lib/registros-webinar";
import { repartoDelGrupo, resumenDeRegistros, unionDePersona, unionesDeRegistros } from "@/lib/whatsapp";

/* Lo que pasó con el taller del 11/11: el formulario antepone el código del país y la gente
   lo escribe de nuevo, o le falta un dígito, o dejó el +54 de fábrica con un número de otro
   país. Todos estaban en el grupo y la app decía «No está». Números inventados. */

test("código de país repetido: +57 57…, +593 593…, +51 51…, +56 56… dan el número de verdad", () => {
  assert.deepEqual(clavesDeTelefono("+57 573001234567"), ["573001234567"]);
  assert.deepEqual(clavesDeTelefono("+593 593987654321"), ["593987654321"]);
  assert.deepEqual(clavesDeTelefono("+51 51912345678"), ["51912345678"]);
  assert.deepEqual(clavesDeTelefono("+56 56912345678"), ["56912345678"]);
  /* Argentina: 54 + 54 + 11 + 8 dígitos, con y sin el 9. */
  assert.deepEqual(clavesDeTelefono("+54 541155551234"), ["5491155551234"]);
  assert.deepEqual(clavesDeTelefono("+54 5491155551234"), ["5491155551234"]);
});

test("un número válido no se toca, aunque repita dígitos del código (Brasil 55 con área 55)", () => {
  assert.equal(claveSinCodigoRepetido("5555912345678"), null);
  assert.deepEqual(clavesDeTelefono("+55 55 91234-5678"), ["5555912345678"]);
  assert.deepEqual(clavesDeTelefono("+54 9 11 5555-1234"), ["5491155551234"]);
});

test("las colas: los últimos 8 dígitos de cada número escrito", () => {
  assert.deepEqual(colasDeTelefono("+593 98765432"), ["98765432"]);
  assert.deepEqual(colasDeTelefono("11 5555-1234 / 11 4444-3333"), ["55551234", "44443333"]);
  assert.deepEqual(colasDeTelefono("1234"), []);
});

test("un número mal escrito se encuentra por cómo termina: Ecuador sin el 9, país equivocado", () => {
  const dentro = new Set(["593987654321", "573001234567"]);
  const ecuador = unionDePersona("+593 87654321", "Ecuador", dentro);
  assert.equal(ecuador.estado, "unida");
  assert.equal(ecuador.clave, "593987654321");
  assert.equal(ecuador.porTerminacion, true);
  /* Un colombiano que dejó el +54 de fábrica. */
  const colombiano = unionDePersona("+54 3001234567", "Argentina", dentro);
  assert.equal(colombiano.estado, "unida");
  assert.equal(colombiano.clave, "573001234567");
});

test("lo que termina distinto no se da por unido, y lo exacto no pasa por la terminación", () => {
  const dentro = new Set(["593987654321"]);
  assert.equal(unionDePersona("+593 987654399", "Ecuador", dentro).estado, "no-unida");
  const exacto = unionDePersona("+593 987654321", "Ecuador", dentro);
  assert.equal(exacto.estado, "unida");
  assert.equal(exacto.porTerminacion, undefined);
});

test("«Número inválido»: el que está en el grupo igual cuenta; el que no, pasa a «sin teléfono válido»", () => {
  const regs = [
    { id: "a", telefono: "+54 11 5555-1234", pais: "Argentina", grupo: "invalido" },
    { id: "b", telefono: "+54 11 4444-0000", pais: "Argentina", grupo: "invalido" },
    { id: "c", telefono: "+54 11 3333-0000", pais: "Argentina", grupo: "no-unido" },
  ];
  const u = unionesDeRegistros(regs, ["5491155551234"]);
  assert.equal(u.get("a")!.estado, "unida");
  assert.equal(u.get("b")!.estado, "sin-telefono");
  assert.equal(u.get("b")!.numero, "");
  assert.equal(u.get("c")!.estado, "no-unida");
  const r = resumenDeRegistros(regs, u);
  assert.deepEqual([r.dentro, r.fuera, r.sinTelefono, r.conTelefono], [1, 1, 1, 2]);
});

test("el filtro y la cuenta de «Nº inválido»", () => {
  const rs = [
    nuevoRegistro({ email: "a@x.com", grupo: "invalido" }),
    nuevoRegistro({ email: "b@x.com", grupo: "unido" }),
    nuevoRegistro({ email: "c@x.com" }),
  ];
  assert.equal(rs.filter((r) => pasaMarca(r, "invalido")).length, 1);
  const c = contarRegistros(rs);
  assert.deepEqual([c.invalidos, c.unidos, c.sinRevisar], [1, 1, 1]);
});

test("el reparto del grupo suma lo que cuenta WhatsApp: coinciden + otros + ocultos", () => {
  const dentro = new Set(["5491155551234", "5491144443333", "573001234567", "593987654321"]);
  const regs = [
    { id: "a", telefono: "+54 11 5555-1234", pais: "Argentina" },
    { id: "b", telefono: "+57 573001234567", pais: "Colombia" },
    { id: "c", telefono: "+54 11 9999-9999", pais: "Argentina" },
  ];
  const rep = repartoDelGrupo([{ miembros: 4, sinTelefono: 2 }], dentro, unionesDeRegistros(regs, dentro));
  assert.deepEqual(rep, { total: 6, coinciden: 2, otros: 2, ocultos: 2 });
  assert.equal(rep.coinciden + rep.otros + rep.ocultos, rep.total);
});
