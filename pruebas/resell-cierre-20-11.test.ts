import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLUMNAS_SUMADAS_RESELLS, esDeTestimonio, faltaDeLaFila, faltaDeLaLlamada, JUEGOS_RESELLS, LISTAS_POR_DEFECTO, MOTOR_RESELLS, queFaltaDeLaLlamada,
  resellAbierto, resellNoSePresento, resellResuelto,
} from "@/lib/clientes-cs";
import { tonoDeResell } from "@/components/cs/pastillas";

/* Mariano (closer, 20/11): «ponemos como outboarding y que no quiere renovar, pero sin embargo se me queda en la solapa de "por cerrar"».
   Era una llamada de caso de éxito y faltaba decir si grabó el testimonio: la regla estaba bien, pero nada en su vista decía qué faltaba.
   Lili (20/11): «podemos agregar en estado: "no se presentó"». El SQL (la misma regla en la base), en pruebas-estres/sql/sql-resell-cierre.test.ts. */

const PASADA = "2026-10-15T01:00:00.000Z"; // 14/10 a las 22 h de Argentina
const ahora = Date.parse("2026-11-20T15:00:00.000Z");
const llamada = (x: Partial<Parameters<typeof faltaDeLaLlamada>[0]> = {}) =>
  ({ fechaHora: PASADA, estado: "", casoDeExito: false, testimonio: "" as const, linkTestimonio: "", cancelada: false, ...x });

test("el caso de Mariano: resultado cargado, pero era de testimonio → queda abierta y dice qué falta (sólo el testimonio)", () => {
  const r = llamada({ estado: "No quiere renovar, Outbording", casoDeExito: true });
  assert.equal(resellResuelto(r.estado), true, "el resultado ya cierra el resell");
  assert.equal(resellAbierto(r, ahora), true, "pero la llamada sigue abierta");
  assert.deepEqual(queFaltaDeLaLlamada(r).map((x) => x.corto), ["Si grabó el testimonio"]);
  assert.deepEqual(faltaDeLaLlamada(r), ["si grabó el testimonio"]);
  /* Con «Grabó» y el link, se cierra. */
  assert.equal(resellAbierto({ ...r, testimonio: "Grabó", linkTestimonio: "https://drive.google.com/x" }, ahora), false);
  assert.deepEqual(queFaltaDeLaLlamada({ ...r, testimonio: "Grabó" }).map((x) => x.clave), ["link"]);
  assert.equal(resellAbierto({ ...r, testimonio: "No quiso grabar" }, ahora), false);
});

test("«No se presentó» cierra la llamada, también la de testimonio (no se pudo grabar)", () => {
  assert.ok(LISTAS_POR_DEFECTO.estadosResell.includes("No se presentó"), "está entre las opciones del Estado");
  for (const estado of ["No se presentó", "no se presento", "2da Agenda, No se presentó", " NO SE PRESENTÓ "]) {
    assert.equal(resellNoSePresento(estado), true, estado);
    assert.equal(resellResuelto(estado), true, estado);
    assert.equal(resellAbierto(llamada({ estado }), ahora), false, estado);
    assert.equal(resellAbierto(llamada({ estado, casoDeExito: true }), ahora), false, `${estado} (testimonio)`);
  }
  assert.equal(resellNoSePresento("No responde"), false);
  assert.equal(resellAbierto(llamada({ estado: "No responde" }), ahora), true, "«No responde» la deja abierta: falta una respuesta");
  assert.equal(tonoDeResell("No se presentó"), "aviso", "en amarillo, como todo lo que no es renovar ni salir del programa");
});

test("lo que sigue igual: sin estado, Seguimiento y 2da Agenda abren; Se reagenda cierra; futura o cancelada no cuentan", () => {
  assert.deepEqual(queFaltaDeLaLlamada(llamada()).map((x) => x.corto), ["Cómo salió"]);
  assert.deepEqual(queFaltaDeLaLlamada(llamada({ estado: "2da Agenda, Seguimiento" })).map((x) => x.corto), ["En qué terminó"]);
  assert.deepEqual(faltaDeLaLlamada(llamada({ estado: "Seguimiento" })), ["en qué terminó el resell (está en «Seguimiento»)"]);
  assert.deepEqual(faltaDeLaLlamada(llamada({ testimonio: "Se reagenda", casoDeExito: true })), []);
  assert.deepEqual(faltaDeLaLlamada(llamada({ estado: "Upgrade a Hackear IA" })), []);
  assert.deepEqual(faltaDeLaFila({ resell: { ...llamada(), fechaHora: "2026-12-01T15:00:00.000Z" } as never }, ahora), [], "todavía no pasó");
  assert.deepEqual(faltaDeLaFila({ resell: { ...llamada(), cancelada: true } as never }, ahora), [], "cancelada");
  assert.deepEqual(faltaDeLaFila({ resell: llamada() as never }, ahora).map((x) => x.clave), ["resultado"]);
});

test("de testimonio por el día de Argentina, como la base: el 30/09 a las 23 h todavía es septiembre", () => {
  assert.equal(esDeTestimonio({ fechaHora: "2026-10-01T02:00:00.000Z", casoDeExito: true }), false, "30/09 23 h en Argentina");
  assert.equal(esDeTestimonio({ fechaHora: "2026-10-01T03:00:00.000Z", casoDeExito: true }), true, "01/10 00 h en Argentina");
  assert.equal(esDeTestimonio({ fechaHora: PASADA, casoDeExito: false }), false);
});

test("la columna «Falta» está en la vista Agenda, se suma a quien ya guardó sus columnas y filtra por lo que falta", () => {
  const agenda = JUEGOS_RESELLS.find((j) => j.id === "agenda")!;
  assert.deepEqual([...agenda.claves], ["fechaHora", "nombre", "closer", "estado", "falta", "cash", "telefono"]);
  assert.deepEqual(COLUMNAS_SUMADAS_RESELLS.find((x) => x.claves.includes("falta")), { id: "falta-2011", despuesDe: "estado", claves: ["falta"] });
  const col = MOTOR_RESELLS.columna.falta;
  assert.equal(col.corto, "Falta");
  const fila = (x: Partial<ReturnType<typeof llamada>>) => ({ id: "r", resell: { ...llamada(x), fechaHora: "2026-10-15T01:00:00.000Z" }, dia: "2026-10-14", estado: x.estado ?? "", grabacion: "" }) as never;
  assert.deepEqual(col.valores(fila({ estado: "No quiere renovar, Outbording", casoDeExito: true })), ["Si grabó el testimonio"]);
  assert.deepEqual(col.valores(fila({ estado: "Renueva" })), ["Nada"]);
  assert.deepEqual(col.valores(fila({ cancelada: true })), ["Cancelada"]);
});

test("cada lista de llamadas abiertas dice qué falta, no sólo el estado", () => {
  const resells = readFileSync("src/components/cs/ResellsCs.tsx", "utf8");
  assert.match(resells, /case "falta":/, "la tabla pinta la columna");
  assert.match(resells, /<CerrarLlamada /, "y tocarla abre el asistente para cerrarla");
  assert.match(resells, /Para cerrarla falta/, "al guardar un resultado que no alcanza, lo dice en el momento");
  const eod = readFileSync("src/components/crm-tabla/Eod.tsx", "utf8");
  assert.match(eod, /queFaltaDeLaLlamada\(/, "el cierre del día dice qué falta");
  assert.doesNotMatch(eod, /<Badge variante="neutral">\{r\.estado\}<\/Badge>/, "y ya no muestra sólo el estado");
  const asistente = readFileSync("src/components/mi-panel/CerrarLlamada.tsx", "utf8");
  assert.match(asistente, /resultadoDeEstado\(r\.estado\)/, "el asistente trae elegido el resultado que ya tiene la fila");
  assert.match(asistente, /"no-se-presento"/, "y ofrece «No se presentó»");
});
