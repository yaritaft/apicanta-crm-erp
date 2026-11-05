import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  CAMPO, CAMPOS, CAMPOS_DE_OPCIONES, cumple, enPeriodo, filasCrm, OPCIONES_POR_DEFECTO, opcionesDe, TITULO_DE_OPCIONES, vistasDe,
} from "@/lib/crm";
import {
  CAMPO_DE_OPCIONES, COLUMNA, COLUMNAS_SUMADAS, EDITOR, escrituraDe, filasTabla, followUpVisible, hayFiltro, pasaFiltros, SIN_RECONTACTAR,
  VISIBLES_POR_DEFECTO, type FilaTabla,
} from "@/lib/crm-tabla";
import { NO_SE_PRESENTO } from "@/lib/estados";
import { acciones } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   Estado follow-up (Daniel, setter, 06/11): a quién se recontactó después de
   un no-show y a quién todavía no. Es una columna más de la llamada, y esta
   prueba cubre también la RAÍZ de por qué costó una sesión entera: cada
   campo «de opciones» (Pre-Call, Estado Pre-Call, Estado de Llamada…) estaba
   nombrado a mano en ocho pantallas distintas, y sumar uno dejaba alguna a
   medias. Ahora todas recorren CAMPOS_DE_OPCIONES y esta prueba falla si
   alguien vuelve a escribir la lista a mano.
   ================================================================== */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const AHORA = Date.parse("2026-11-06T15:00:00-03:00");
const CTX = (e: EstadoApp) => ({ ajustes: e.ajustes, quien: "Daniel", cuando: "2026-11-06T15:00:00.000Z" });

/* Una llamada de la demo en la que no vinieron, sin follow-up. */
function unNoShow() {
  const e = estado();
  const f = filasTabla(e, AHORA).find((x) => x.resultado === NO_SE_PRESENTO && !x.followUp && x.sesion.origen === "calendly");
  assert.ok(f, "la demo trae llamadas en las que no vinieron");
  return { e, f };
}

test("el follow-up es un campo de opciones del CRM, con sus opciones, su título y su columna", () => {
  assert.ok(CAMPOS_DE_OPCIONES.includes("followUp"));
  assert.ok(OPCIONES_POR_DEFECTO.followUp.length >= 5);
  assert.equal(TITULO_DE_OPCIONES.followUp, "Estado follow-up");
  assert.equal(CAMPO.followUp.titulo, "Estado follow-up");
  assert.equal(CAMPO.followUp.opciones, "followUp");
  assert.equal(COLUMNA.followUp.titulo, "Estado follow-up");
  assert.equal(CAMPO_DE_OPCIONES.followUp, "followUp");
  assert.equal(EDITOR.followUp, "opciones");
  /* Se ve de entrada, justo después del Estado de Llamada. */
  const i = VISIBLES_POR_DEFECTO.indexOf("followUp");
  assert.ok(i > 0 && VISIBLES_POR_DEFECTO[i - 1] === "estadoLlamada");
  /* Y quien ya tenía sus columnas guardadas la recibe una vez, en el mismo lugar. */
  const sumada = COLUMNAS_SUMADAS.find((x) => x.claves.includes("followUp"));
  assert.equal(sumada?.despuesDe, "estadoLlamada");
});

test("RAÍZ: todo campo de opciones está cableado en la grilla, la tabla y la edición; ninguna pantalla repite la lista a mano", () => {
  for (const campo of CAMPOS_DE_OPCIONES) {
    assert.ok(OPCIONES_POR_DEFECTO[campo].length > 0, `${campo}: sin opciones de entrada`);
    assert.ok(TITULO_DE_OPCIONES[campo], `${campo}: sin título`);
    assert.ok(CAMPOS.some((c) => c.opciones === campo), `${campo}: no tiene columna en la grilla (CAMPOS)`);
    const columna = Object.entries(CAMPO_DE_OPCIONES).find(([, c]) => c === campo)?.[0];
    assert.ok(columna, `${campo}: no tiene columna en la tabla (CAMPO_DE_OPCIONES)`);
    assert.equal(EDITOR[columna as keyof typeof EDITOR], "opciones", `${campo}: la tabla no la edita con la lista de opciones`);
    assert.ok(COLUMNA[columna as keyof typeof COLUMNA], `${campo}: no está en COLUMNAS`);
  }
  /* Los nombres de las opciones no se repiten dentro de un campo (se guardan por nombre). */
  for (const campo of CAMPOS_DE_OPCIONES) {
    const nombres = OPCIONES_POR_DEFECTO[campo].map((o) => o.nombre);
    assert.equal(new Set(nombres).size, nombres.length, `${campo}: opciones repetidas`);
  }

  /* Ninguna pantalla vuelve a nombrar los campos de opciones a mano: la lista literal de tres o más de ellos es la que se rompió. */
  const lista = /["']preCall["']\s*,\s*["']estadoLlamada["']\s*,\s*["']estadoPreCall["']|["']estadoLlamada["']\s*,\s*["']estadoPreCall["']\s*,\s*["']preCall["']/;
  const sueltas: string[] = [];
  const recorrer = (dir: string) => {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) { recorrer(ruta); continue; }
      if (!/\.(ts|tsx)$/.test(nombre) || nombre === "types.ts" || ruta.endsWith("lib/seed.ts")) continue;
      if (lista.test(readFileSync(ruta, "utf8"))) sueltas.push(ruta.replace(`${process.cwd()}/`, ""));
    }
  };
  recorrer(join(process.cwd(), "src"));
  assert.deepEqual(sueltas, [], `Estos archivos nombran a mano los campos de opciones del CRM; usá CAMPOS_DE_OPCIONES (lib/crm.ts): ${sueltas.join(", ")}`);
});

test("un no-show sin follow-up dice «Sin recontactar»; con follow-up, lo cargado; una llamada que se hizo, nada", () => {
  const { f } = unNoShow();
  assert.equal(followUpVisible(f), SIN_RECONTACTAR);
  assert.deepEqual(COLUMNA.followUp.valores(f), [SIN_RECONTACTAR]);
  assert.equal(followUpVisible({ ...f, followUp: "Respondió" }), "Respondió");
  assert.equal(followUpVisible({ followUp: "", resultado: "Con cierre" }), "");
  /* Una llamada traída del Airtable viejo no es tarea de nadie: sin follow-up no dice «Sin recontactar» (sí lo que se le haya cargado). */
  assert.equal(followUpVisible({ ...f, sesion: { ...f.sesion, origen: "airtable" as never } }), "");
  assert.equal(followUpVisible({ ...f, followUp: "Llamado", sesion: { ...f.sesion, origen: "airtable" as never } }), "Llamado");
  assert.deepEqual(COLUMNA.followUp.valores({ ...f, followUp: "", resultado: "Con cierre" } as FilaTabla), ["(Vacías)"]);
});

test("se carga con el mismo camino que los otros estados: se guarda en la llamada, se puede vaciar y las opciones inventadas no entran", () => {
  const { e, f } = unNoShow();
  const w = escrituraDe(f, "followUp", "1° Mje Enviado", CTX(e));
  assert.ok(w && w.tipo === "llamada");
  assert.deepEqual(w.cambios, { followUp: "1° Mje Enviado" });
  assert.match(w.detalle, /Estado follow-up → 1° Mje Enviado/);
  assert.equal(escrituraDe(f, "followUp", "algo que no existe", CTX(e)), null);
  assert.equal(escrituraDe(f, "followUp", "", CTX(e)), null, "ya estaba vacío: nada que guardar");
  const cargado = { ...f, followUp: "Respondió" };
  const vaciar = escrituraDe(cargado, "followUp", "", CTX(e));
  assert.ok(vaciar && vaciar.tipo === "llamada");
  assert.deepEqual(vaciar.cambios, { followUp: "" });

  /* Por el store de verdad: queda en la llamada, no toca el Estado de Llamada ni la agenda, y vaciarlo lo borra. */
  const antes = estado().sesiones.find((s) => s.id === f.sesion.id)!;
  acciones.editarLlamadas([{ id: f.sesion.id, cambios: { followUp: "2° Mje Enviado" }, detalle: "Daniel: Estado follow-up → 2° Mje Enviado." }]);
  const despues = estado().sesiones.find((s) => s.id === f.sesion.id)!;
  assert.equal(despues.followUp, "2° Mje Enviado");
  assert.equal(despues.estadoLlamada, antes.estadoLlamada);
  assert.equal(despues.estado, antes.estado);
  assert.equal(despues.estadoLlamadaEn, antes.estadoLlamadaEn, "no es un estado de llamada: no corre la marca de la primera carga");
  const fila = filasTabla(estado(), AHORA).find((x) => x.sesion.id === f.sesion.id)!;
  assert.equal(followUpVisible(fila), "2° Mje Enviado");
  acciones.editarLlamadas([{ id: f.sesion.id, cambios: { followUp: "" }, detalle: "Daniel: se vació Estado follow-up." }]);
  assert.equal(estado().sesiones.find((s) => s.id === f.sesion.id)!.followUp, undefined);
});

test("la columna se filtra como las otras: «Sin recontactar» deja sólo los no-show que nadie recontactó", () => {
  const e = estado();
  const filas = filasTabla(e, AHORA);
  const hechos = filas.filter((x) => x.resultado === NO_SE_PRESENTO);
  assert.ok(hechos.length >= 2, "la demo trae varios no-show");
  /* Uno recontactado, el resto no. */
  const [uno, ...resto] = hechos;
  const conUno = filas.map((x) => (x.id === uno.id ? { ...x, followUp: "Reagendó" } : x));
  const filtro = { followUp: { modo: "solo" as const, valores: [SIN_RECONTACTAR] } };
  assert.ok(hayFiltro(filtro.followUp));
  const quedan = conUno.filter((x) => pasaFiltros(x, filtro));
  assert.deepEqual(quedan.map((x) => x.id).sort(), resto.map((x) => x.id).sort());
  assert.ok(quedan.every((x) => x.resultado === NO_SE_PRESENTO && !x.followUp));
});

test("«los últimos 30 días» incluye hoy y el día 30 hacia atrás, y deja afuera el 31 y el futuro", () => {
  const ahora = Date.parse("2026-11-06T15:00:00-03:00");
  const dia = (iso: string) => enPeriodo(`${iso}T12:00:00-03:00`, "ultimos-30", ahora);
  assert.equal(dia("2026-11-06"), true);
  assert.equal(dia("2026-10-08"), true, "hace 29 días: el último que entra");
  assert.equal(dia("2026-10-07"), false);
  assert.equal(dia("2026-11-07"), false);
});

test("el setter tiene su vista «No-shows sin recontactar»: los que no vinieron y siguen sin follow-up, los más viejos primero", () => {
  const e = construirSemilla();
  const filas = filasCrm(e);
  const secciones = vistasDe(filas, e, "booking");
  const vista = secciones.flatMap((s) => s.vistas).find((v) => v.nombre === "No-shows sin recontactar");
  assert.ok(vista, "hay una vista de no-shows sin recontactar para el setter");
  assert.deepEqual(vista.orden, [{ campo: "llamada", desc: false }]);
  const vienen = filas.filter((f) => vista.filtros.every((c) => cumple(f, c)));
  assert.ok(vienen.length > 0, "la demo trae no-shows");
  const noShow = new Set(opcionesDe(e.ajustes, "estadoLlamada").filter((o) => o.llamada === "no-show").map((o) => o.nombre));
  assert.ok(vienen.every((f) => noShow.has(f.estadoLlamada) && !f.followUp));
  /* Con follow-up cargado, sale de la vista. */
  const f0 = vienen[0];
  assert.ok(!vista.filtros.every((c) => cumple({ ...f0, followUp: "Respondió" }, c)));
});
