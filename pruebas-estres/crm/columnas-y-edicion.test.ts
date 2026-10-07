import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPO_DE_OPCIONES, COLUMNA, COLUMNAS, COLUMNAS_DE_ANTES, COLUMNAS_DE_COBROS, DIMENSIONES, EDITOR, escrituraDe, filasDePersona, ORDEN_POR_DEFECTO, perfilDe, POR_QUE_NO,
  valorEditable, valorParaGuardar, VISIBLES_POR_DEFECTO, type ClaveColumna,
} from "@/lib/crm-tabla";
import { opcionesDe } from "@/lib/crm";
import { filasTabla } from "@/lib/crm-tabla";
import { AHORA, Azar, conSemilla, filasDeMundo, mundoAzar } from "./gen";

/* ==================================================================
   La definición de las columnas y lo que se escribe al corregir una celda.
   Un cambio que no cambia nada no escribe nada; vaciar no borra lo que no
   se puede borrar; y la definición de cada columna es consistente (se edita
   o dice por qué no).
   ================================================================== */

const CLAVES = COLUMNAS.map((c) => c.clave);

test("la definición de las columnas es consistente: claves únicas, cada una se edita o dice por qué no, y todo lo que las nombra existe", () => {
  assert.equal(new Set(CLAVES).size, CLAVES.length, "claves repetidas");
  for (const c of COLUMNAS) {
    assert.ok(c.titulo.trim() && c.ancho && c.ancho > 0, c.clave);
    assert.equal(COLUMNA[c.clave], c);
    /* Una columna se edita o dice por qué no (y no las dos cosas). */
    assert.ok(Boolean(EDITOR[c.clave]) !== Boolean(POR_QUE_NO[c.clave]), `${c.clave}: ${EDITOR[c.clave] ? "se edita y además dice que no" : "ni se edita ni dice por qué no"}`);
  }
  const existe = (xs: readonly string[], que: string) => { for (const x of xs) assert.ok(CLAVES.includes(x as ClaveColumna), `${que}: ${x}`); };
  existe(VISIBLES_POR_DEFECTO, "visibles"); existe(COLUMNAS_DE_COBROS, "cobros"); existe(DIMENSIONES, "dimensiones"); existe(Object.keys(EDITOR), "editor");
  existe(Object.keys(POR_QUE_NO), "por qué no"); existe(Object.keys(CAMPO_DE_OPCIONES), "opciones"); existe(ORDEN_POR_DEFECTO.map((o) => o.clave), "orden por defecto");
  for (const nuevas of Object.values(COLUMNAS_DE_ANTES)) existe(nuevas, "columnas de antes");
  assert.equal(new Set(VISIBLES_POR_DEFECTO).size, VISIBLES_POR_DEFECTO.length, "visibles repetidas");
  assert.equal(new Set(DIMENSIONES).size, DIMENSIONES.length, "dimensiones repetidas");
  /* Comprobante y Conciliado se ven de entrada; las demás de cobros (Cobrado, Cargó, Chequeo) se suman desde «Columnas». */
  for (const k of ["comprobante", "conciliado"] as const) assert.ok(VISIBLES_POR_DEFECTO.includes(k), k);
  for (const k of ["cobrado", "cargo", "chequeo", "producto"] as const) assert.ok(!VISIBLES_POR_DEFECTO.includes(k), k);
});

test("las columnas siempre devuelven valores sin cadenas vacías (lo vacío es «(Vacías)») para llamadas con todos sus datos presentes", () => {
  for (let semilla = 1; semilla <= 20; semilla++) {
    const { filas } = filasDeMundo(new Azar(semilla + 40), { sesiones: 100, ventas: 40, pagos: 80 });
    for (const f of filas) for (const c of COLUMNAS) for (const v of c.valores(f)) assert.ok(v !== "", conSemilla(semilla, `${c.clave} de ${f.id} devolvió un valor vacío`));
  }
});

test("corregir una celda sin cambiarla no escribe nada (el mismo valor, con espacios de más, o con las listas en otro orden de comas)", () => {
  for (let semilla = 1; semilla <= 30; semilla++) {
    const r = new Azar(semilla + 100);
    const { mundo, filas } = filasDeMundo(r, { sesiones: 80, ventas: 30, pagos: 40, raro: r.bool(0.4) });
    const ctx = { ajustes: mundo.ajustes, quien: "yo", cuando: new Date(AHORA).toISOString() };
    for (const f of filas) for (const c of Object.keys(EDITOR) as ClaveColumna[]) {
      const actual = valorEditable(f, c);
      assert.equal(escrituraDe(f, c, actual, ctx), null, conSemilla(semilla, `${c} de ${f.id}: «${actual}» se volvió a escribir`));
      assert.equal(escrituraDe(f, c, `  ${actual}  `, ctx), null, conSemilla(semilla, `${c} de ${f.id}: con espacios de más`));
    }
    /* Lo que no se edita no escribe, diga lo que diga el valor. */
    for (const f of filas.slice(0, 5)) for (const c of CLAVES.filter((k) => !EDITOR[k])) assert.equal(escrituraDe(f, c, "lo que sea", ctx), null, c);
  }
});

test("lo que se escribe: la persona, la llamada, el closer o el perfil, con lo que se tipeó y sin pisar datos con vacíos", () => {
  const { mundo, filas } = filasDeMundo(new Azar(5), { sesiones: 40, ventas: 10, pagos: 10 });
  const ctx = { ajustes: mundo.ajustes, quien: "yo", cuando: new Date(AHORA).toISOString() };
  const f = { ...filas[0], nombre: "Ana", email: "ana@x.com", telefono: "+54 9 11", closer: "Dante", notas: "", objecion: "", oferta: "", cierre: "", grabacion: "", tecnologias: [], formacion: [] };
  /* La persona: vaciar el nombre, el mail o el teléfono no los borra. */
  for (const c of ["nombre", "email", "telefono"] as const) {
    assert.equal(escrituraDe(f, c, "", ctx), null, `vaciar ${c}`);
    assert.equal(escrituraDe(f, c, "   ", ctx), null, `vaciar ${c} con espacios`);
    const w = escrituraDe(f, c, " Nuevo ", ctx);
    assert.deepEqual(w && w.tipo === "persona" ? w.cambios : null, { [c]: "Nuevo" });
    assert.equal(w && w.tipo === "persona" ? w.id : null, f.personaId);
  }
  /* El closer es pasar la llamada; vacío no la pasa a nadie. */
  assert.deepEqual(escrituraDe(f, "closer", "Valentín", ctx), { tipo: "closer", id: f.sesion.id, closer: "Valentín", detalle: "Ana: Closer → Valentín." });
  assert.equal(escrituraDe(f, "closer", "", ctx), null);
  /* Los estados: una opción que existe, o vacío. */
  const estado = opcionesDe(mundo.ajustes, "estadoLlamada")[0].nombre;
  const e1 = escrituraDe(f, "estadoLlamada", estado, ctx);
  assert.deepEqual(e1 && e1.tipo === "llamada" ? e1.cambios : null, { estadoLlamada: estado });
  assert.equal(escrituraDe(f, "estadoLlamada", "Un estado inventado", ctx), null);
  assert.equal(escrituraDe(f, "preCall", "otra cosa", ctx), null);
  const fcon = { ...f, sesion: { ...f.sesion, estadoLlamada: estado } };
  const e2 = escrituraDe(fcon, "estadoLlamada", "", ctx);
  assert.deepEqual(e2 && e2.tipo === "llamada" ? e2.cambios : null, { estadoLlamada: "" }, "vaciar el estado cargado");
  /* La oferta: Sí / No / nada. */
  for (const [v, h] of [["Sí", true], ["No", false]] as const) {
    const w = escrituraDe(f, "oferta", v, ctx);
    assert.deepEqual(w && w.tipo === "llamada" ? w.cambios : null, { hizoOferta: h });
  }
  /* El cierre estimado: un día. */
  const c1 = escrituraDe(f, "cierre", "2026-10-31", ctx);
  assert.deepEqual(c1 && c1.tipo === "llamada" ? c1.cambios : null, { cierreEstimado: "2026-10-31" });
  /* Las listas se escriben con comas, punto y coma o renglones y se guardan una por renglón. */
  const l = escrituraDe(f, "tecnologias", " React ,Node;  Go\n\nPython,, ", ctx);
  assert.deepEqual(l && l.tipo === "perfil" ? [l.campo, l.valor] : null, ["tecnologias", "React\nNode\nGo\nPython"]);
  assert.equal(valorParaGuardar("formacion", "a, b;c\nd"), "a\nb\nc\nd");
  assert.equal(valorParaGuardar("ingles", "  Básico  "), "Básico");
  const p = escrituraDe(f, "pais", "Chile", ctx);
  assert.deepEqual(p && p.tipo === "perfil" ? [p.campo, p.valor] : null, ["pais", "Chile"]);
  /* El detalle de lo escrito no se desborda con un valor largo. */
  const largo = escrituraDe(f, "notas", "x".repeat(500), ctx);
  assert.ok(largo && largo.detalle.length < 140, `detalle de ${largo?.detalle.length}`);
});

test("el perfil de una persona se arma para cualquier mezcla de llamadas, contactos y leads (datos raros incluidos) sin romper", () => {
  for (let semilla = 1; semilla <= 40; semilla++) {
    const r = new Azar(semilla + 600);
    const m = mundoAzar(r, { sesiones: 50, ventas: 10, pagos: 10, raro: true });
    const filas = filasTabla(m, AHORA);
    const porPersona = new Map<string, string[]>();
    for (const f of filas) porPersona.set(f.personaId, [...(porPersona.get(f.personaId) ?? []), f.id]);
    for (const [persona, ids] of porPersona) {
      const suyas = filasDePersona(filas, ids);
      assert.equal(suyas.length, ids.length, conSemilla(semilla, persona));
      const c = m.contactos.find((x) => x.id === persona), l = m.leads.find((x) => x.id === persona);
      const datos = perfilDe(suyas, c, l);
      assert.equal(datos.length, 8, conSemilla(semilla, persona));
      for (const d of datos) assert.ok(typeof d.valor === "string" && typeof d.titulo === "string", conSemilla(semilla, `${persona} ${d.clave}`));
    }
    assert.equal(perfilDe([], null, null).length, 8);
    assert.ok(perfilDe([], null, null).every((d) => d.valor === ""));
  }
});

test("las llamadas de una persona salen de la más nueva a la más vieja", () => {
  const { filas } = filasDeMundo(new Azar(8), { sesiones: 60 });
  const ids = filas.map((f) => f.id);
  const suyas = filasDePersona(filas, ids);
  for (let i = 1; i < suyas.length; i++) assert.ok(suyas[i - 1].llamada.localeCompare(suyas[i].llamada) >= 0);
  assert.equal(filasDePersona(filas, []).length, 0);
});
