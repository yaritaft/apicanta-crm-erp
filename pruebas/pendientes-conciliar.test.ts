import test from "node:test";
import assert from "node:assert/strict";
import { caminoSugerido, contactosDelMes, marcadosDelMes, otroCaminoDe, pendientesDelMes, propuestasPara, resumirPendientes, type DatosPendientes } from "@/lib/pendientes-conciliar";
import { nuevoRegistro } from "@/lib/registros-webinar";
import type { Contacto } from "@/lib/types";

/* Octubre 2026. Ana agendó y ya tiene formulario; Beto compró y no tiene; Carla agendó por Setter y no tiene;
   Dora compró en septiembre (no es del mes); Eli agendó y canceló; Fer compró pero la venta no cuenta para Marketing;
   Gus agendó y ya fue marcado «vino por otro camino». */
const contactos = [
  { id: "c1", nombre: "Ana Pérez", email: "ana@mail.com", extra: {} },
  { id: "c2", nombre: "Beto Gómez", email: "beto@mail.com", telefono: "+54 9 351 444 2222", pais: "Argentina", extra: {} },
  { id: "c3", nombre: "Carla Ruiz", email: "carla@mail.com", extra: {} },
  { id: "c4", nombre: "Dora Díaz", email: "dora@mail.com", extra: {} },
  { id: "c5", nombre: "Eli Sosa", email: "eli@mail.com", extra: {} },
  { id: "c6", nombre: "Fer Luna", email: "fer@mail.com", extra: {} },
  { id: "c7", nombre: "Gus Vera", email: "gus@mail.com", extra: { conciliacion: { camino: "referido", por: "Aldana", en: "2026-10-20T12:00:00.000Z" } } },
] as unknown as Contacto[];

const datos: DatosPendientes = {
  contactos,
  sesiones: [
    { id: "s1", contactoId: "c1", email: "ana@mail.com", invitado: "Ana Pérez", inicia: "2026-10-10T15:00:00.000Z", estado: "hecha", tipo: "Llamada Webinar", titulo: "x", canal: "webinar" },
    { id: "s3", contactoId: "c3", email: "carla@mail.com", invitado: "Carla Ruiz", inicia: "2026-10-12T15:00:00.000Z", estado: "agendada", tipo: "Llamada Setter", titulo: "x", canal: "setter" },
    { id: "s5", contactoId: "c5", email: "eli@mail.com", invitado: "Eli Sosa", inicia: "2026-10-13T15:00:00.000Z", estado: "cancelada", tipo: "Llamada Webinar", titulo: "x", canal: "webinar" },
    { id: "s7", contactoId: "c7", email: "gus@mail.com", invitado: "Gus Vera", inicia: "2026-10-14T15:00:00.000Z", estado: "hecha", tipo: "Llamada Webinar", titulo: "x", canal: "webinar" },
    /* A las 22:30 de Argentina del 31/10 ya es 01/11 en UTC: es de octubre. */
    { id: "s2b", contactoId: "c2", email: "beto@mail.com", invitado: "Beto Gómez", inicia: "2026-11-01T01:30:00.000Z", estado: "agendada", tipo: "Llamada Webinar", titulo: "x", canal: "webinar" },
  ],
  leads: [
    { id: "l2", contactoId: "c2", nombre: "Beto Gómez", email: "beto@mail.com", telefono: "+54 9 351 444 2222", pais: "Argentina" },
    { id: "l4", contactoId: "c4", nombre: "Dora Díaz", email: "dora@mail.com" },
    { id: "l6", contactoId: "c6", nombre: "Fer Luna", email: "fer@mail.com" },
  ],
  ventas: [
    { id: "v2", contactoId: "l2", contactoNombre: "Beto Gómez", fecha: "2026-10-12T15:00:00.000Z", estado: "activa", excluidoMarketing: false, precioAcordado: 3000, moneda: "USD", notas: "Plan de 3 cuotas" },
    { id: "v4", contactoId: "l4", contactoNombre: "Dora Díaz", fecha: "2026-09-28T15:00:00.000Z", estado: "activa", excluidoMarketing: false, precioAcordado: 2000, moneda: "USD" },
    { id: "v6", contactoId: "l6", contactoNombre: "Fer Luna", fecha: "2026-10-15T15:00:00.000Z", estado: "activa", excluidoMarketing: true, precioAcordado: 500, moneda: "USD" },
  ],
} as unknown as DatosPendientes;

const con = (...ids: string[]) => new Set(ids);

test("el mes trae a quien agendó o compró y no tiene formulario, primero los que compraron", () => {
  const ps = pendientesDelMes(datos, "2026-10", con("c1"));
  assert.deepEqual(ps.map((p) => p.id), ["c2", "c3"], "Beto (compró) antes que Carla (sólo agendó)");
  const beto = ps[0];
  assert.equal(beto.tipo, "ambas", "compró y además agendó, las dos cosas son de octubre");
  assert.equal(beto.eventos.length, 2);
  assert.equal(beto.dia, "2026-10-31", "el día es el del negocio (Argentina), no el de UTC");
  assert.equal(ps[1].canal, "setter");
});

test("quien ya tiene un formulario atado, quien se marcó por otro camino, la llamada cancelada y la venta excluida de Marketing no figuran", () => {
  const todos = pendientesDelMes(datos, "2026-10", con()).map((p) => p.id);
  assert.ok(todos.includes("c1"), "sin formulario atado, Ana sí figura");
  assert.ok(!todos.includes("c7"), "Gus ya está marcado por otro camino");
  assert.ok(!todos.includes("c5"), "una llamada cancelada no cuenta");
  assert.ok(!todos.includes("c6"), "una venta excluida de Marketing no se atribuye a ningún anuncio");
  assert.ok(!pendientesDelMes(datos, "2026-10", con("c1", "c2", "c3")).length);
});

test("cada mes trae lo suyo: septiembre sólo tiene a Dora", () => {
  assert.deepEqual(pendientesDelMes(datos, "2026-09", con()).map((p) => p.id), ["c4"]);
  assert.deepEqual(pendientesDelMes(datos, "2026-08", con()), []);
});

test("el resumen cuenta ventas, sólo agenda y lo vendido sin origen", () => {
  const r = resumirPendientes(pendientesDelMes(datos, "2026-10", con("c1")));
  assert.deepEqual(r, { total: 2, conVenta: 1, soloAgenda: 1, montos: { USD: 3000 } });
});

test("«vino por otro camino» se lee de la ficha, y el canal de la llamada sugiere cuál", () => {
  assert.equal(otroCaminoDe(contactos[6])?.camino, "referido");
  assert.equal(otroCaminoDe(contactos[0]), undefined);
  assert.equal(otroCaminoDe({ extra: { conciliacion: "basura" } } as unknown as Contacto), undefined);
  assert.equal(caminoSugerido("setter"), "setter");
  assert.equal(caminoSugerido("webinar"), undefined);
});

test("las propuestas: el mismo mail o teléfono firme primero, el nombre parecido después, los «No es» no vuelven", () => {
  const beto = pendientesDelMes(datos, "2026-10", con("c1")).find((p) => p.id === "c2")!;
  const porMail = nuevoRegistro({ email: "beto@mail.com", nombre: "B. Gómez", origen: "excel", registradoEn: "2026-09-01T12:00:00.000Z" } as never);
  const porTel = nuevoRegistro({ email: "otro@mail.com", nombre: "Alguien", telefono: "+54 9 351 444 2222", origen: "excel", registradoEn: "2026-09-02T12:00:00.000Z" } as never);
  const porNombre = nuevoRegistro({ email: "nada@mail.com", nombre: "Beto Gómez", origen: "excel", registradoEn: "2026-09-03T12:00:00.000Z" } as never);
  const otraPersona = nuevoRegistro({ email: "zzz@mail.com", nombre: "Zoe Quiroga", origen: "excel", registradoEn: "2026-09-03T12:00:00.000Z" } as never);
  const yaUnido = { ...nuevoRegistro({ email: "beto@mail.com", origen: "excel", registradoEn: "2026-09-04T12:00:00.000Z" } as never), contactoId: "c9" };
  const descartado = { ...nuevoRegistro({ email: "beto@mail.com", nombre: "Beto", origen: "excel", registradoEn: "2026-09-05T12:00:00.000Z" } as never), descartados: ["c2"] };

  const ps = propuestasPara(beto, [porNombre, porTel, porMail, otraPersona, yaUnido, descartado]);
  assert.deepEqual(ps.map((x) => x.registro.id), [porMail.id, porTel.id, porNombre.id]);
  assert.deepEqual(ps.map((x) => [x.candidato.metodo, x.candidato.segura]), [["mail", true], ["telefono", true], ["nombre", false]]);
});

test("los marcados del mes se pueden ver para deshacerlos, y los contactos del mes son de quienes hay que averiguar si tienen formulario", () => {
  assert.deepEqual(marcadosDelMes(datos, "2026-10").map((p) => p.id), ["c7"]);
  assert.deepEqual(marcadosDelMes(datos, "2026-09"), []);
  assert.deepEqual(contactosDelMes(datos, "2026-10").sort(), ["c1", "c2", "c3", "c7"], "sin la cancelada ni la venta excluida de Marketing");
});
