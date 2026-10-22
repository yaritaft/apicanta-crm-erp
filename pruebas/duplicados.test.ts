import test from "node:test";
import assert from "node:assert/strict";
import { claveEmail } from "@/lib/contactos";
import {
  buscarMismaPersona, duplicadosDe, esLaMismaPersona, otrosEmails, planSeparar, planUnificar, posiblesDuplicados,
} from "@/lib/duplicados";
import type { Contacto } from "@/lib/types";

/* Lili (22/10): Juan Camilo López estaba dos veces, con un mail en cada ficha, porque todas las entradas buscaban a la
   persona sólo por el mail. Los casos son los de producción. */

const c = (id: string, nombre: string, email: string, telefono?: string, extra: Record<string, unknown> = {}): Contacto =>
  ({ id, nombre, email, telefono, creadoEn: "2026-09-01T00:00:00Z", extra });

test("un mail con caracteres invisibles es el mismo mail", () => {
  assert.equal(claveEmail("‪‬nacho.lf@live.com.ar"), "nacho.lf@live.com.ar");
  assert.equal(claveEmail(" Nacho.LF@live.com.ar​"), "nacho.lf@live.com.ar");
});

test("mismo teléfono y dos palabras del nombre: la misma persona; con otro nombre, no sola", () => {
  assert.ok(esLaMismaPersona({ nombre: "Juan Camilo López ", telefono: "+57 311 3652301" }, { nombre: "Juan Camilo López", telefono: "57 311 3652301" }));
  assert.ok(esLaMismaPersona({ nombre: "Facundo aguirre", telefono: "+54 11 3165-5584" }, { nombre: "Facundo Nahuel Aguirre", telefono: "5491131655584" }));
  assert.ok(esLaMismaPersona({ nombre: "Alexander Torres", telefono: "57 315 4928257" }, { nombre: "Jhonny Alexander Torres Castro", telefono: "57 315 4928257" }));
  /* El mismo número con otra gente (David Vera y Gustavo Ruiz): se avisa, no se junta. */
  assert.ok(!esLaMismaPersona({ nombre: "David Vera Castillo", telefono: "54 221 6097371" }, { nombre: "Gustavo Ruiz", telefono: "54 221 6097371" }));
  /* Un solo nombre en común no alcanza («Martin Cardul» y «Martín Cardozo»). */
  assert.ok(!esLaMismaPersona({ nombre: "Martin Cardul", telefono: "+54 1135896340" }, { nombre: "Martín Cardozo", telefono: "+54 11 3589-6340" }));
  /* El mismo nombre con otro teléfono, tampoco. */
  assert.ok(!esLaMismaPersona({ nombre: "Juan Camilo López", telefono: "+57 311 3652301" }, { nombre: "Juan Camilo López", telefono: "+57 300 1112233" }));
});

test("buscarMismaPersona: primero el mail (también los otros mails), después teléfono y nombre", () => {
  const juan = c("con_ef_9rwhz6", "Juan Camilo López", "jukaloma@gmail.com", "57 311 3652301", { emails: ["viejo@x.com"] });
  const otros = [c("x", "Otra Persona", "otra@x.com", "+54 11 1111-2222"), juan];
  assert.equal(buscarMismaPersona(otros, { email: "JUKALOMA@gmail.com " })?.por, "email");
  assert.equal(buscarMismaPersona(otros, { email: "viejo@x.com" })?.contacto.id, "con_ef_9rwhz6");
  const r = buscarMismaPersona(otros, { email: "jukamilo2010@hotmail.com", nombre: "Juan Camilo López ", telefono: "+57 311 3652301" });
  assert.equal(r?.contacto.id, "con_ef_9rwhz6");
  assert.equal(r?.por, "telefono");
  assert.equal(buscarMismaPersona(otros, { email: "nuevo@x.com", nombre: "Pedro Gómez", telefono: "+57 311 3652301" }), null);
});

test("posibles duplicados: los pares con el mismo teléfono, sin los descartados", () => {
  const a = c("a", "Juan Camilo López", "jukaloma@gmail.com", "57 311 3652301");
  const b = c("b", "Juan Camilo López", "jukamilo2010@hotmail.com", "+57 311 3652301");
  const d = c("d", "David Vera Castillo", "david@x.com", "+54 221 609-7371");
  const g = c("g", "Gustavo Ruiz", "gus@x.com", "54 221 6097371");
  const pares = posiblesDuplicados([a, b, d, g]);
  assert.equal(pares.length, 2);
  assert.equal(pares[0].seguro, true, "los seguros primero");
  assert.equal(pares[1].seguro, false);
  assert.deepEqual(duplicadosDe([a, b, d, g], "a").map((x) => x.otro.id), ["b"]);
  /* Alguien dijo que David y Gustavo no son la misma persona: no se vuelve a proponer. */
  const d2 = { ...d, extra: { noEsLaMismaPersona: ["g"] } };
  assert.equal(posiblesDuplicados([a, b, d2, g]).length, 1);
});

test("unificar mueve todo del otro, guarda su mail y se puede deshacer", () => {
  const principal = c("con_ef_9rwhz6", "Juan Camilo López", "jukaloma@gmail.com", "57 311 3652301");
  const otro = { ...c("lea_cal_d9", "Juan Camilo López ", "jukamilo2010@hotmail.com", "+57 311 3652301"), pais: "Colombia", tecnologias: "Java" };
  const plan = planUnificar(principal, otro, {
    leads: [{ id: "lea_cal_d9", contactoId: "lea_cal_d9" }],
    sesiones: [{ id: "ses_1", contactoId: "lea_cal_d9" }],
    comentarios: [{ id: "com_1", contactoId: "lea_cal_d9" }],
    alumnosSinLead: [{ id: "alu_x", leadId: undefined }],
  }, "lili@apicanta.com", "2026-10-22T12:00:00Z");
  assert.equal(plan.borrar, "lea_cal_d9");
  assert.deepEqual(plan.leads, [{ id: "lea_cal_d9", contactoId: "con_ef_9rwhz6" }]);
  assert.deepEqual(plan.sesiones, [{ id: "ses_1", contactoId: "con_ef_9rwhz6" }]);
  assert.deepEqual(plan.comentarios, [{ id: "com_1", contactoId: "con_ef_9rwhz6" }]);
  assert.deepEqual(plan.alumnos, [{ id: "alu_x", leadId: "lea_cal_d9" }]);
  assert.deepEqual(otrosEmails(plan.contacto), ["jukamilo2010@hotmail.com"]);
  assert.equal(plan.contacto.pais, "Colombia", "completa los huecos");
  assert.equal(plan.contacto.tecnologias, "Java");
  assert.match(plan.resumen, /pasaron 1 oportunidad, 1 llamada, 1 mensaje del chat, 1 servicio/);

  const sep = planSeparar(plan.contacto, "lea_cal_d9");
  assert.ok(sep);
  assert.equal(sep.recrear.id, "lea_cal_d9");
  assert.deepEqual(sep.leads, [{ id: "lea_cal_d9", contactoId: "lea_cal_d9" }]);
  assert.deepEqual(sep.alumnos, [{ id: "alu_x", leadId: null }]);
  assert.deepEqual(otrosEmails(sep.contacto), []);
  assert.equal(planSeparar(sep.contacto, "lea_cal_d9"), null, "ya no está unificada");
});
