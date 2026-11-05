import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNA, COLUMNAS, EDITOR, escrituraDe, esColumna, esColumnaPropia, filasTabla, filtrosDeURL, ordenarFilas, ordenesDeURL, pasaFiltros,
  registrarCamposPropios, textoDeCampoPropio, valorEditable, VACIAS, type ClaveColumna, type FilaTabla,
} from "@/lib/crm-tabla";
import { crmDeDescarga, filasDeDescargaDelCrm, tablaDeDescarga } from "@/lib/agendas-descarga";
import { acciones } from "@/lib/store";
import type { CampoPersonalizado, EstadoApp } from "@/lib/types";

/* ==================================================================
   Campos propios de las llamadas como columnas del CRM (06/11).
   Ajustes → Campos propios → Sesiones guarda un dato más en `sesion.extra`;
   la tabla de /crm lo muestra como columna, filtrable, ordenable y editable,
   y sale en el CSV, sin tocar código. Daniel pidió «Estado follow-up» y el
   equipo no tenía cómo sumarlo solo.
   ================================================================== */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const AHORA = Date.parse("2026-11-06T15:00:00-03:00");
const campo = (c: Partial<CampoPersonalizado> & Pick<CampoPersonalizado, "clave" | "tipo">): CampoPersonalizado =>
  ({ id: `c_${c.clave}`, entidad: "sesion", nombre: c.clave, requerido: false, ...c });

const SEGUIMIENTO = campo({ clave: "seguimiento", nombre: "Seguimiento del setter", tipo: "seleccion", opciones: ["Escribí", "Respondió", "No contesta"] });
const INTENTOS = campo({ clave: "intentos", nombre: "Intentos", tipo: "numero" });
const CONFIRMADO = campo({ clave: "confirmado", nombre: "Confirmado", tipo: "booleano" });
const PROXIMO = campo({ clave: "proximo", nombre: "Próximo contacto", tipo: "fecha" });
const NOTA = campo({ clave: "nota_larga", nombre: "Nota larga", tipo: "texto-largo" });

afterEach(() => { registrarCamposPropios([]); });

const ctx = (e: EstadoApp) => ({ ajustes: e.ajustes, quien: "Daniel", cuando: "2026-11-06T18:00:00.000Z" });
const algunaFila = (e: EstadoApp) => filasTabla(e, AHORA).find((f) => f.sesion.origen === "calendly")!;
const conExtra = (f: FilaTabla, extra: Record<string, unknown>): FilaTabla => ({ ...f, sesion: { ...f.sesion, extra: { ...(f.sesion.extra ?? {}), ...extra } } });

test("registrar un campo de Sesiones suma su columna; un campo de otra ficha, no; y sacarlo la saca", () => {
  const antes = COLUMNAS.length;
  registrarCamposPropios([SEGUIMIENTO, campo({ clave: "x", tipo: "texto", entidad: "lead" }), campo({ clave: "y", tipo: "texto", entidad: "alumno" })]);
  assert.equal(COLUMNAS.length, antes + 1);
  const col = COLUMNA["extra:seguimiento"];
  assert.equal(col.titulo, "Seguimiento del setter");
  assert.equal(col.grupo, "Campos propios");
  assert.equal(EDITOR["extra:seguimiento"], "opciones");
  assert.ok(esColumna("extra:seguimiento") && esColumnaPropia("extra:seguimiento"));
  assert.equal(esColumna("extra:x"), false, "el de leads no es columna del CRM");
  registrarCamposPropios([]);
  assert.equal(COLUMNAS.length, antes);
  assert.equal(esColumna("extra:seguimiento"), false);
  assert.equal(EDITOR["extra:seguimiento"], undefined);
});

test("registrar dos veces lo mismo no repite columnas, y la firma sólo cambia cuando cambian los campos", () => {
  const a = registrarCamposPropios([SEGUIMIENTO]);
  const n = COLUMNAS.length;
  assert.equal(registrarCamposPropios([SEGUIMIENTO]), a);
  assert.equal(COLUMNAS.length, n);
  assert.notEqual(registrarCamposPropios([SEGUIMIENTO, INTENTOS]), a);
  assert.equal(COLUMNAS.length, n + 1);
  /* Renombrar el campo cambia el título de la columna. */
  registrarCamposPropios([{ ...SEGUIMIENTO, nombre: "Follow" }]);
  assert.equal(COLUMNA["extra:seguimiento"].titulo, "Follow");
});

test("las claves que tocarían el prototipo no se ofrecen, ni se pisa nada al leer o guardar", () => {
  const n = COLUMNAS.length;
  registrarCamposPropios([campo({ clave: "__proto__", tipo: "texto" }), campo({ clave: "constructor", tipo: "texto" }), campo({ clave: "prototype", tipo: "texto" })]);
  assert.equal(COLUMNAS.length, n);
  assert.equal(textoDeCampoPropio({ clave: "constructor", tipo: "texto" }, {}), "", "no lee las propiedades heredadas");
  assert.equal(textoDeCampoPropio({ clave: "toString", tipo: "texto" }, { a: 1 }), "");
  assert.equal(({} as Record<string, unknown>).seguimiento, undefined);
});

test("cada tipo se lee como texto: sí/no, número, día, opción; lo que no es de ese tipo queda vacío", () => {
  assert.equal(textoDeCampoPropio(CONFIRMADO, { confirmado: true }), "Sí");
  assert.equal(textoDeCampoPropio(CONFIRMADO, { confirmado: false }), "No");
  assert.equal(textoDeCampoPropio(CONFIRMADO, {}), "");
  assert.equal(textoDeCampoPropio(INTENTOS, { intentos: 3 }), "3");
  assert.equal(textoDeCampoPropio(INTENTOS, { intentos: "tres" }), "");
  assert.equal(textoDeCampoPropio(INTENTOS, { intentos: 0 }), "0", "el cero es un dato");
  assert.equal(textoDeCampoPropio(PROXIMO, { proximo: "2026-11-10" }), "2026-11-10");
  assert.equal(textoDeCampoPropio(PROXIMO, { proximo: "mañana" }), "");
  assert.equal(textoDeCampoPropio(SEGUIMIENTO, { seguimiento: " Respondió " }), "Respondió");
  assert.equal(textoDeCampoPropio(SEGUIMIENTO, { seguimiento: { raro: 1 } }), "");
  assert.equal(textoDeCampoPropio(SEGUIMIENTO, undefined), "");
});

test("la columna se filtra por sus valores, por la URL y con «(Vacías)» para lo que nadie cargó", () => {
  registrarCamposPropios([SEGUIMIENTO]);
  const e = estado();
  const filas = filasTabla(e, AHORA);
  const [a, b, ...resto] = filas;
  const cargadas = [conExtra(a, { seguimiento: "Respondió" }), conExtra(b, { seguimiento: "Escribí" }), ...resto];
  assert.deepEqual(COLUMNA["extra:seguimiento"].valores(cargadas[0]), ["Respondió"]);
  assert.deepEqual(COLUMNA["extra:seguimiento"].valores(cargadas[2]), [VACIAS]);
  const filtros = filtrosDeURL(new URLSearchParams("solo-extra:seguimiento=Respondió"));
  assert.deepEqual(cargadas.filter((f) => pasaFiltros(f, filtros)).map((f) => f.id), [a.id]);
  /* Un filtro de una columna que ya no existe se ignora, no rompe. */
  registrarCamposPropios([]);
  assert.deepEqual(Object.keys(filtrosDeURL(new URLSearchParams("solo-extra:seguimiento=Respondió"))), []);
});

test("se ordena por la columna propia: los números como números y lo vacío al final", () => {
  registrarCamposPropios([INTENTOS]);
  const filas = filasTabla(estado(), AHORA).slice(0, 4);
  const con = [conExtra(filas[0], { intentos: 10 }), conExtra(filas[1], { intentos: 2 }), conExtra(filas[2], { intentos: 33 }), filas[3]];
  const asc = ordenarFilas(con, ordenesDeURL("extra:intentos")).map((f) => f.id);
  assert.deepEqual(asc, [con[1].id, con[0].id, con[2].id, con[3].id], "2, 10, 33 y lo vacío al final");
  const desc = ordenarFilas(con, ordenesDeURL("-extra:intentos")).map((f) => f.id);
  assert.deepEqual(desc, [con[2].id, con[0].id, con[1].id, con[3].id], "33, 10, 2 y lo vacío igual al final");
});

test("editar en la celda guarda en extra, con el tipo del campo, sin tocar lo demás de extra", () => {
  registrarCamposPropios([SEGUIMIENTO, INTENTOS, CONFIRMADO, PROXIMO, NOTA]);
  const e = estado();
  const base = conExtra(algunaFila(e), { guardado: "otro dato", seguimiento: "Escribí" });
  const w = (clave: ClaveColumna, valor: string, f = base) => escrituraDe(f, clave, valor, ctx(e));
  const extraDe = (x: ReturnType<typeof w>) => { assert.ok(x && x.tipo === "llamada"); return x.cambios.extra as Record<string, unknown>; };

  assert.deepEqual(extraDe(w("extra:seguimiento", "Respondió")), { guardado: "otro dato", seguimiento: "Respondió" });
  assert.equal(w("extra:seguimiento", "algo inventado"), null, "una opción que no está en la lista no entra");
  assert.equal(w("extra:seguimiento", "Escribí"), null, "igual a lo que había: nada que guardar");
  assert.deepEqual(extraDe(w("extra:seguimiento", "")), { guardado: "otro dato" }, "vaciar saca la clave y deja el resto");
  assert.equal(extraDe(w("extra:intentos", "4"))["intentos"], 4);
  assert.equal(extraDe(w("extra:intentos", "2,5"))["intentos"], 2.5);
  assert.equal(w("extra:intentos", "muchos"), null);
  assert.equal(extraDe(w("extra:confirmado", "Sí"))["confirmado"], true);
  assert.equal(extraDe(w("extra:confirmado", "No"))["confirmado"], false);
  assert.equal(w("extra:confirmado", "quizás"), null);
  assert.equal(extraDe(w("extra:proximo", "2026-11-10"))["proximo"], "2026-11-10");
  assert.equal(w("extra:proximo", "10/11"), null);
  assert.match((w("extra:seguimiento", "Respondió") as { detalle: string }).detalle, /Seguimiento del setter → Respondió/);
  assert.equal(valorEditable(base, "extra:seguimiento"), "Escribí");
});

test("por el store de verdad: se guarda en la llamada, no toca los otros datos y sobrevive vaciar uno", () => {
  registrarCamposPropios([SEGUIMIENTO]);
  const e = estado();
  const f = algunaFila(e);
  const extraAntes = estado().sesiones.find((s) => s.id === f.sesion.id)!.extra ?? {};
  const x = escrituraDe(f, "extra:seguimiento", "No contesta", ctx(e));
  assert.ok(x && x.tipo === "llamada");
  acciones.editarLlamadas([{ id: x.id, cambios: x.cambios, detalle: x.detalle }]);
  const despues = estado().sesiones.find((s) => s.id === f.sesion.id)!;
  assert.deepEqual(despues.extra, { ...extraAntes, seguimiento: "No contesta" });
  assert.equal(despues.estadoLlamada, f.sesion.estadoLlamada);
  const fila = filasTabla(estado(), AHORA).find((r) => r.sesion.id === f.sesion.id)!;
  assert.deepEqual(COLUMNA["extra:seguimiento"].valores(fila), ["No contesta"]);
  /* Vaciarlo. */
  const v = escrituraDe(fila, "extra:seguimiento", "", ctx(estado()));
  assert.ok(v && v.tipo === "llamada");
  acciones.editarLlamadas([{ id: v.id, cambios: v.cambios, detalle: v.detalle }]);
  assert.deepEqual(estado().sesiones.find((s) => s.id === f.sesion.id)!.extra, extraAntes);
});

test("el CSV del CRM trae las columnas propias, con lo que cargó cada llamada", () => {
  const e0 = estado();
  const f = algunaFila(e0);
  const e = { ...e0, campos: [SEGUIMIENTO], sesiones: e0.sesiones.map((s) => (s.id === f.sesion.id ? { ...s, extra: { ...(s.extra ?? {}), seguimiento: "Respondió" } } : s)) };
  const crm = crmDeDescarga(e, { ventas: true, cobros: true }, AHORA);
  assert.ok(crm.columnas.some((c) => c.clave === "extra:seguimiento"));
  const { tabla } = tablaDeDescarga(filasDeDescargaDelCrm(e, [f]), [], crm);
  const cabecera = tabla[0];
  const i = cabecera.indexOf("Seguimiento del setter");
  assert.ok(i >= 0, `falta la columna: ${cabecera.join(" | ")}`);
  assert.ok(tabla.slice(1).some((fila) => fila[i] === "Respondió"));
});
