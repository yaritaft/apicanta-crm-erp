import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNA, COLUMNAS, filasTabla, filtroAURL, filtrosDeURL, hayFiltro, MAX_ORDENES, ORDEN_POR_DEFECTO, ordenarFilas, ordenesAURL, ordenesDeURL, pasaFiltros,
  textoDeColumna, VACIAS,
  type ClaveColumna, type FiltroColumna, type FiltrosTabla, type OrdenColumna,
} from "@/lib/crm-tabla";
import { construirSemilla } from "@/lib/seed";
import { Azar, conSemilla, filasDeMundo, valorAzar } from "./gen";

/* ==================================================================
   Frente 1: ida y vuelta de filtros y orden por la URL.

   La pantalla escribe el filtro de una columna con `escribir(filtroAURL(...))`
   (useEscribirURL: `q.set(k, v)` o `q.delete(k)` sobre un URLSearchParams y
   `router.replace(?${q.toString()})`) y lo lee de vuelta con
   `filtrosDeURL(new URLSearchParams(params.toString()))`. Acá se hace
   exactamente ese camino, con la serialización real, para valores con
   espacios, comas, barras verticales, tildes, %, & y =.
   ================================================================== */

const CLAVES = COLUMNAS.map((c) => c.clave);
const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;

/** Lo que hace useEscribirURL con los cambios que devuelve `filtroAURL`/`ordenesAURL`. */
function escribir(params: URLSearchParams, cambios: Record<string, string | null>): URLSearchParams {
  const q = new URLSearchParams(params);
  for (const [k, v] of Object.entries(cambios)) { if (v) q.set(k, v); else q.delete(k); }
  /* Como el router: el texto de la URL y de vuelta a parámetros. */
  return new URLSearchParams(q.toString());
}

function diaAzar(r: Azar) {
  const m = r.entre(1, 12), d = r.entre(1, 28);
  return `2026-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function filtroAzar(r: Azar, clave: ClaveColumna, conBarra: boolean): FiltroColumna {
  const fc: FiltroColumna = { modo: r.pick(["solo", "sin"] as const), valores: [] };
  for (let i = r.int(4); i > 0; i--) fc.valores.push(valorAzar(r, conBarra));
  if (r.bool(0.4)) fc.contiene = r.bool(0.15) ? "   " : `${r.bool(0.3) ? " " : ""}${valorAzar(r, false)}${r.bool(0.3) ? "  " : ""}`;
  if (r.bool(0.3)) fc.noContiene = `${r.bool(0.3) ? " " : ""}${valorAzar(r, false)}`;
  if (COLUMNA[clave].fecha) {
    if (r.bool(0.5)) fc.desde = diaAzar(r);
    if (r.bool(0.5)) fc.hasta = diaAzar(r);
  }
  return fc;
}

/** Lo que tiene que volver de la URL: los valores tal cual, el texto sin los espacios de los bordes, y sólo
    las fechas de las columnas de fecha; una lista vacía no recuerda su modo. */
function esperado(clave: ClaveColumna, fc: FiltroColumna): FiltroColumna | undefined {
  const out: FiltroColumna = { modo: "solo", valores: [] };
  if (fc.valores.length) { out.modo = fc.modo; out.valores = [...fc.valores]; }
  if (fc.contiene?.trim()) out.contiene = fc.contiene.trim();
  if (fc.noContiene?.trim()) out.noContiene = fc.noContiene.trim();
  if (COLUMNA[clave].fecha) {
    if (fc.desde && ES_DIA.test(fc.desde)) out.desde = fc.desde;
    if (fc.hasta && ES_DIA.test(fc.hasta)) out.hasta = fc.hasta;
  }
  return hayFiltro(out) ? out : undefined;
}

const RUIDO: [string, string][] = [
  ["q", "ana & luis = 100%"], ["pag", "3"], ["orden", "closer,-llamada"], ["seccion", "tabla"], ["pendientes", "1"],
  ["solo-noexiste", "x"], ["sin-", "x"], ["desde-pais", "2026-01-01"], ["hasta-nombre", "2026-02-02"], ["con-inventada", "x"],
  ["nocon-ad", ""], ["solo-edad", "|||"], ["desde-llamadaX", "2026-01-01"], ["SOLO-pais", "Chile"],
];

test("el filtro de cada columna vuelve igual de la URL real: espacios, comas, tildes, %, &, = y emoji (sin barras)", () => {
  const cobertura = { filtros: 0, solo: 0, sin: 0, contiene: 0, noContiene: 0, desde: 0, hasta: 0, conRuido: 0 };
  for (let semilla = 1; semilla <= 400; semilla++) {
    const r = new Azar(semilla);
    const elegidas = r.algunos(CLAVES, 1, 6);
    /* Ruido de otros parámetros (y de columnas que no se tocan), que no puede colarse como filtro. */
    let params = new URLSearchParams();
    for (const [k, v] of r.algunos(RUIDO, 0, 6)) {
      const colRuido = /^(?:solo|sin|con|nocon|desde|hasta)-(.+)$/.exec(k)?.[1];
      if (colRuido && elegidas.includes(colRuido as ClaveColumna)) continue;
      params.append(k, v);
    }
    const ruidoSolo = params.toString();
    if (ruidoSolo) cobertura.conRuido++;
    const quedan: FiltrosTabla = {};
    for (const k of elegidas) {
      const fc = filtroAzar(r, k, false);
      params = escribir(params, { ...filtroAURL(k, fc), pag: null });
      const e = esperado(k, fc);
      if (e) quedan[k] = e;
    }
    assert.deepEqual(filtrosDeURL(params), quedan, conSemilla(semilla, `URL: ${params.toString()}`));
    for (const fc of Object.values(quedan)) {
      cobertura.filtros++;
      if (fc.valores.length) cobertura[fc.modo]++;
      if (fc.contiene) cobertura.contiene++;
      if (fc.noContiene) cobertura.noContiene++;
      if (fc.desde) cobertura.desde++;
      if (fc.hasta) cobertura.hasta++;
    }
    /* Y al sacar cada filtro la URL vuelve a lo que era: no queda ninguna clave de filtro huérfana. */
    let limpia = params;
    for (const k of elegidas) limpia = escribir(limpia, filtroAURL(k, null));
    assert.deepEqual(filtrosDeURL(limpia), {}, conSemilla(semilla, "al limpiar quedó algún filtro"));
    assert.equal(new URLSearchParams(limpia.toString()).toString(), new URLSearchParams(ruidoSolo).toString().replace(/&?pag=3/, "").replace(/^&/, ""), conSemilla(semilla, "la URL no volvió a su estado"));
  }
  /* Que el generador cubra todos los casos: si no, la prueba no probaba nada. */
  for (const [k, n] of Object.entries(cobertura)) assert.ok(n >= 60, `cobertura de ${k}: ${n}`);
});

test("un filtro cambia sólo su columna: escribir una no toca los filtros de las demás", () => {
  const r = new Azar(7);
  let params = new URLSearchParams();
  const hechos: FiltrosTabla = {};
  for (const k of CLAVES) {
    const fc = filtroAzar(r, k, false);
    params = escribir(params, filtroAURL(k, fc));
    const e = esperado(k, fc);
    if (e) hechos[k] = e; else delete hechos[k];
    assert.deepEqual(filtrosDeURL(params), hechos, `después de ${k}`);
  }
  /* Cambiar el de una por otro distinto no mueve las demás. */
  const otra = r.pick(CLAVES);
  const nuevo: FiltroColumna = { modo: "solo", valores: ["Nuevo valor, con coma & %"] };
  params = escribir(params, filtroAURL(otra, nuevo));
  hechos[otra] = esperado(otra, nuevo)!;
  assert.deepEqual(filtrosDeURL(params), hechos);
});

test("ida y vuelta semántica: las filas que pasan son las mismas antes y después de pasar por la URL", () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = new Azar(semilla * 31);
    const { filas } = filasDeMundo(r, { sesiones: 80 });
    let params = new URLSearchParams();
    const originales: FiltrosTabla = {};
    for (const k of r.algunos(CLAVES, 1, 4)) {
      const col = COLUMNA[k];
      const muestra = r.pick(filas);
      const todos = [...new Set(filas.flatMap((f) => col.valores(f)))];
      const fc: FiltroColumna = { modo: r.pick(["solo", "sin"] as const), valores: r.algunos(todos, 0, 3) };
      const t = textoDeColumna(muestra, col).replace(VACIAS, "");
      if (t && r.bool(0.4)) fc.contiene = t.slice(r.int(t.length), r.entre(1, t.length + 1)).trim() || undefined;
      if (col.fecha && r.bool(0.5)) { fc.desde = col.valores(r.pick(filas))[0]; fc.hasta = col.valores(r.pick(filas))[0]; if (!ES_DIA.test(fc.desde)) delete fc.desde; if (!ES_DIA.test(fc.hasta)) delete fc.hasta; }
      params = escribir(params, filtroAURL(k, fc));
      originales[k] = fc;
    }
    const vueltos = filtrosDeURL(params);
    for (const f of filas) {
      assert.equal(pasaFiltros(f, vueltos), pasaFiltros(f, originales), conSemilla(semilla, `fila ${f.id}, URL ${params.toString()}`));
    }
  }
});

test("filtrosDeURL no tira excepción ni inventa filtros con claves basura (sin tocar el prototipo)", () => {
  const PROTO = new Set(Object.getOwnPropertyNames(Object.prototype));
  const prefijos = ["solo", "sin", "con", "nocon", "desde", "hasta", "x", ""];
  for (let semilla = 1; semilla <= 300; semilla++) {
    const r = new Azar(semilla + 9000);
    const params = new URLSearchParams();
    for (let i = r.int(10); i > 0; i--) {
      const col = r.bool(0.5) ? r.pick(CLAVES) : valorAzar(r, true);
      if (PROTO.has(col)) continue;
      params.append(`${r.pick(prefijos)}-${col}`, r.bool(0.1) ? "" : valorAzar(r, true));
    }
    const f = filtrosDeURL(params);
    for (const [k, fc] of Object.entries(f)) {
      assert.ok(CLAVES.includes(k as ClaveColumna), conSemilla(semilla, `clave ajena: ${k}`));
      assert.ok(hayFiltro(fc), conSemilla(semilla, `filtro vacío en ${k}`));
      assert.ok(Array.isArray(fc.valores), conSemilla(semilla, "valores no es lista"));
    }
  }
});

test("si la URL trae los dos (solo- y sin-) de una columna, queda uno solo y consistente", () => {
  const f = filtrosDeURL(new URLSearchParams("solo-pais=Chile&sin-pais=Perú"));
  assert.equal(f.pais?.modo, "sin");
  assert.deepEqual(f.pais?.valores, ["Perú"]);
});

/* ---------- El orden ---------- */

function ordenAzar(r: Azar, max = MAX_ORDENES): OrdenColumna[] {
  return r.algunos(CLAVES, 1, max).map((clave) => ({ clave, desc: r.bool() }));
}

test("el orden vuelve igual de la URL, con una columna o con varias (hasta el máximo)", () => {
  for (let semilla = 1; semilla <= 300; semilla++) {
    const r = new Azar(semilla);
    const os = ordenAzar(r);
    let params = new URLSearchParams([["q", "x y"], ["pag", "2"]]);
    params = escribir(params, { orden: ordenesAURL(os), pag: null });
    assert.deepEqual(ordenesDeURL(params.get("orden")), os, conSemilla(semilla, `URL ${params.toString()}`));
    const esDefault = os.length === 1 && os[0].clave === "llamada" && os[0].desc;
    assert.equal(ordenesAURL(os) === null, esDefault, conSemilla(semilla, "sólo el orden de siempre se omite"));
  }
});

test("el orden de siempre no se escribe, y sin orden en la URL vuelve a ser el de siempre", () => {
  assert.equal(ordenesAURL(ORDEN_POR_DEFECTO), null);
  assert.deepEqual(ordenesDeURL(null), ORDEN_POR_DEFECTO);
  assert.deepEqual(ordenesDeURL(undefined), ORDEN_POR_DEFECTO);
  assert.deepEqual(ordenesDeURL(""), ORDEN_POR_DEFECTO);
  /* Sin criterios no hay nada que escribir. */
  assert.equal(ordenesAURL([]), null);
  /* El mismo criterio pero hacia el otro lado sí se escribe. */
  assert.equal(ordenesAURL([{ clave: "llamada", desc: false }]), "llamada");
});

test("ordenesDeURL con basura: descarta lo que no es una columna, repetidos y lo que sobra del máximo", () => {
  const casos: [string, OrdenColumna[]][] = [
    [",", ORDEN_POR_DEFECTO], ["-", ORDEN_POR_DEFECTO], ["--llamada", ORDEN_POR_DEFECTO], ["LLAMADA", ORDEN_POR_DEFECTO], [" llamada", ORDEN_POR_DEFECTO],
    ["llamada,,closer", [{ clave: "llamada", desc: false }, { clave: "closer", desc: false }]],
    ["closer,-closer,llamada", [{ clave: "closer", desc: false }, { clave: "llamada", desc: false }]],
    ["nombre,closer,pais,ad,via", [{ clave: "nombre", desc: false }, { clave: "closer", desc: false }, { clave: "pais", desc: false }]],
    ["inventada,-pais", [{ clave: "pais", desc: true }]],
    ["pais%2Cad", ORDEN_POR_DEFECTO],
  ];
  for (const [entrada, salida] of casos) assert.deepEqual(ordenesDeURL(entrada), salida, entrada);
  assert.equal(MAX_ORDENES, 3);
});

test("ordenesDeURL con texto al azar: nunca vacío, sólo columnas conocidas y a lo sumo el máximo", () => {
  const PROTO = new Set(Object.getOwnPropertyNames(Object.prototype));
  for (let semilla = 1; semilla <= 300; semilla++) {
    const r = new Azar(semilla + 500);
    const partes: string[] = [];
    for (let i = r.int(6); i > 0; i--) partes.push(`${r.bool(0.4) ? "-" : ""}${r.bool(0.7) ? r.pick(CLAVES) : valorAzar(r, true).replaceAll(",", "")}`);
    const texto = partes.join(",");
    if (partes.some((p) => PROTO.has(p.replace(/^-/, "")))) continue;
    const os = ordenesDeURL(texto);
    assert.ok(os.length >= 1 && os.length <= MAX_ORDENES, conSemilla(semilla, texto));
    assert.equal(new Set(os.map((o) => o.clave)).size, os.length, conSemilla(semilla, "claves repetidas"));
    for (const o of os) assert.ok(CLAVES.includes(o.clave), conSemilla(semilla, `columna ajena ${o.clave}`));
  }
});

/* ==================================================================
   Los hallazgos. Cada uno se deja con { todo: true } para que no rompa la
   suite mientras el bug siga; cuando se arregle, el test pasa y se puede
   sacar la marca.
   ================================================================== */

test("BUG: un valor con barra vertical (ads y campañas de Meta: «VSL | Mercado saturado») no vuelve de la URL; la tabla queda vacía", () => {
  /* La lista de valores va unida con «|» (SEP) y se parte con «|»: un valor que lo trae se parte en dos y no coincide con ninguna fila. */
  const valor = "Prospecting | LAL 1% | USA";
  const params = escribir(new URLSearchParams(), filtroAURL("campania", { modo: "solo", valores: [valor] }));
  assert.deepEqual(filtrosDeURL(params).campania?.valores, [valor], `la URL ${params.toString()} no devuelve el valor elegido`);
});

test("BUG: la tabla del CRM con un ad que lleva «|» en el nombre queda sin filas al elegirlo en el filtro de la columna (semántico)", () => {
  const e = construirSemilla();
  const base = filasTabla(e)[0];
  const ad = "VSL | Mercado saturado";
  const filas = [{ ...base, id: "a", ad }, { ...base, id: "b", ad: "Otro" }];
  const original: FiltrosTabla = { ad: { modo: "solo", valores: [ad] } };
  const vuelto = filtrosDeURL(escribir(new URLSearchParams(), filtroAURL("ad", original.ad!)));
  assert.deepEqual(filas.filter((f) => pasaFiltros(f, vuelto)).map((f) => f.id), filas.filter((f) => pasaFiltros(f, original)).map((f) => f.id));
});

test("BUG: ?orden=constructor (o __proto__, toString…) pasa como columna válida y rompe el ordenamiento de la tabla", () => {
  /* `clave in COLUMNA` es true para los nombres que hereda todo objeto; COLUMNA["constructor"] es la función Object. */
  const e = construirSemilla();
  const filas = filasTabla(e);
  assert.ok(filas.length > 1);
  const rotos: string[] = [];
  for (const clave of ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "-constructor", "llamada,constructor"]) {
    const os = ordenesDeURL(clave);
    if (!os.every((o) => Object.hasOwn(COLUMNA, o.clave))) rotos.push(`ordenesDeURL("${clave}") = ${JSON.stringify(os)}`);
    try { ordenarFilas(filas, os, {}); } catch (x) { rotos.push(`ordenarFilas con ?orden=${clave}: ${(x as Error).message}`); }
  }
  assert.deepEqual(rotos, [], rotos.join("\n"));
});

test("BUG: ?solo-__proto__=a|b (o con-constructor=…) en la URL contamina Object.prototype / Object al leer los filtros", () => {
  /* `m[2] in COLUMNA` deja pasar «__proto__»; `out["__proto__"] ??= …` no asigna (ya hay prototipo) y
     Object.assign(de(clave), …) escribe `modo` y `valores` en Object.prototype. */
  const proto = Object.prototype as unknown as Record<string, unknown>;
  try {
    filtrosDeURL(new URLSearchParams("solo-__proto__=a|b"));
    assert.equal(proto.valores, undefined, "Object.prototype.valores quedó definido por una URL");
    assert.equal(proto.modo, undefined, "Object.prototype.modo quedó definido por una URL");
    filtrosDeURL(new URLSearchParams("con-constructor=zzz"));
    assert.equal((Object as unknown as Record<string, unknown>).contiene, undefined, "Object.contiene quedó definido por una URL");
  } finally {
    delete proto.valores; delete proto.modo;
    delete (Object as unknown as Record<string, unknown>).contiene;
  }
});
