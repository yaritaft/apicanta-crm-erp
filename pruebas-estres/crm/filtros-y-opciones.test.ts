import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNA, COLUMNAS, hayFiltro, opcionesDeColumna, pasaFiltros, seVe, textoDeColumna, textoDeFiltro, VACIAS,
  type ClaveColumna, type FilaTabla, type FiltroColumna, type FiltrosTabla,
} from "@/lib/crm-tabla";
import { Azar, conSemilla, diaAR3, filasDeMundo } from "./gen";

/* ==================================================================
   Frente 3: filtros por columna y las cuentas del menú de cada título.

   - Las cuentas de opcionesDeColumna suman exactamente las filas que pasan
     los DEMÁS filtros (como en Excel: el filtro de la propia columna no
     recorta su lista).
   - Filtrar por un valor deja justo las filas que lo tienen (solo / sin),
     y «contiene», «no contiene», «desde» y «hasta» hacen lo que dicen.
   ================================================================== */

const CLAVES = COLUMNAS.map((c) => c.clave);
const ES_DIA = /^\d{4}-\d{2}-\d{2}$/;
/* Un sinTildes escrito aparte (marcas Unicode fuera, minúscula): el oráculo de «contiene». */
const plano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

const valoresDe = (f: FilaTabla, c: ClaveColumna) => COLUMNA[c].valores(f);
const distintos = (filas: FilaTabla[], c: ClaveColumna) => [...new Set(filas.flatMap((f) => valoresDe(f, c)))];

function filtrosAzar(r: Azar, filas: FilaTabla[], max = 3): FiltrosTabla {
  const out: FiltrosTabla = {};
  for (const k of r.algunos(CLAVES, 1, max)) {
    const col = COLUMNA[k];
    const fc: FiltroColumna = { modo: r.pick(["solo", "sin"] as const), valores: r.algunos(distintos(filas, k), 0, 3) };
    if (r.bool(0.1)) fc.valores.push("__no_existe__");
    const muestra = textoDeColumna(r.pick(filas), col);
    if (muestra && r.bool(0.35)) {
      const i = r.int(muestra.length);
      fc.contiene = muestra.slice(i, i + r.entre(1, 5));
      if (r.bool(0.3)) fc.contiene = fc.contiene.toUpperCase();
    }
    if (muestra && r.bool(0.15)) fc.noContiene = muestra.slice(0, r.entre(1, 3));
    if (col.fecha && r.bool(0.5)) {
      const dias = distintos(filas, k).filter((d) => ES_DIA.test(d)).sort();
      if (dias.length) { fc.desde = r.pick(dias); if (r.bool(0.7)) fc.hasta = r.pick(dias); }
    }
    out[k] = fc;
  }
  return out;
}

const sin = (filtros: FiltrosTabla, c: ClaveColumna): FiltrosTabla => { const { [c]: _quitado, ...resto } = filtros; void _quitado; return resto; };

/* ---------- Las cuentas del menú ---------- */

test("opcionesDeColumna: cada valor cuenta las filas que pasan los demás filtros, y la suma es exacta (una vez por fila y valor)", () => {
  for (let semilla = 1; semilla <= 40; semilla++) {
    const r = new Azar(semilla);
    const { filas } = filasDeMundo(r, { sesiones: 160 });
    const filtros = filtrosAzar(r, filas);
    for (const c of CLAVES) {
      const ops = opcionesDeColumna(filas, filtros, c);
      const pasan = filas.filter((f) => pasaFiltros(f, filtros, c));
      /* Lo que dice la definición, contado a mano. */
      const esperado = new Map<string, number>();
      for (const f of pasan) for (const v of new Set(valoresDe(f, c))) esperado.set(v, (esperado.get(v) ?? 0) + 1);
      const reales = new Map(ops.filter((o) => o.cuenta > 0).map((o) => [o.valor, o.cuenta]));
      assert.deepEqual(reales, esperado, conSemilla(semilla, `columna ${c}`));
      /* Lo elegido sigue en la lista aunque no quede ninguna fila: con cuenta 0, y sólo eso. */
      const ceros = ops.filter((o) => o.cuenta === 0).map((o) => o.valor).sort();
      const elegidosSinFilas = (filtros[c]?.valores ?? []).filter((v) => !esperado.has(v));
      assert.deepEqual(ceros, [...new Set(elegidosSinFilas)].sort(), conSemilla(semilla, `ceros de ${c}`));
      /* Sin repetidos. */
      assert.equal(new Set(ops.map((o) => o.valor)).size, ops.length, conSemilla(semilla, `repetidos en ${c}`));
      /* La suma: una columna de un valor por fila suma exactamente las filas que pasan los otros filtros. */
      const suma = ops.reduce((s, o) => s + o.cuenta, 0);
      const unico = pasan.every((f) => new Set(valoresDe(f, c)).size === 1);
      if (unico) assert.equal(suma, pasan.length, conSemilla(semilla, `la suma de ${c} no da las filas`));
      assert.equal(suma, pasan.reduce((s, f) => s + new Set(valoresDe(f, c)).size, 0), conSemilla(semilla, `la suma de ${c} no da los valores de cada fila`));
      /* El filtro de la propia columna no recorta su lista. */
      const sinPropio = opcionesDeColumna(filas, sin(filtros, c), c).filter((o) => o.cuenta > 0);
      assert.deepEqual(new Map(sinPropio.map((o) => [o.valor, o.cuenta])), reales, conSemilla(semilla, `el filtro de ${c} recortó su propia lista`));
    }
  }
});

test("opcionesDeColumna: el orden de la lista (vacías al final, fechas de la más nueva a la más vieja, opciones en su orden, el resto alfabético con números)", () => {
  const collator = new Intl.Collator("es", { numeric: true });
  for (let semilla = 1; semilla <= 25; semilla++) {
    const r = new Azar(semilla + 100);
    const { filas } = filasDeMundo(r, { sesiones: 140 });
    for (const c of CLAVES) {
      const col = COLUMNA[c];
      const orden = r.bool(0.3) ? r.shuffle(distintos(filas, c)).slice(0, 3) : undefined;
      const ops = opcionesDeColumna(filas, {}, c, orden).map((o) => o.valor);
      const iv = ops.indexOf(VACIAS);
      if (iv >= 0) assert.equal(iv, ops.length - 1, conSemilla(semilla, `${c}: (Vacías) no quedó al final`));
      const resto = ops.filter((v) => v !== VACIAS);
      const posicion = (v: string) => { const i = orden?.indexOf(v) ?? -1; return i < 0 ? 999 : i; };
      for (let i = 1; i < resto.length; i++) {
        const a = resto[i - 1], b = resto[i];
        const ctx = conSemilla(semilla, `${c}: ${a} / ${b}`);
        if (orden && posicion(a) !== posicion(b)) assert.ok(posicion(a) < posicion(b), ctx);
        else if (col.fecha) assert.ok(a.localeCompare(b) >= 0, ctx);
        else assert.ok(collator.compare(a, b) <= 0, ctx);
      }
    }
  }
});

/* ---------- Filtrar por un valor ---------- */

test("filtrar por un valor de la lista deja justo las filas que lo tienen, y la cuenta del menú es la de la tabla (solo)", () => {
  for (let semilla = 1; semilla <= 30; semilla++) {
    const r = new Azar(semilla + 200);
    const { filas } = filasDeMundo(r, { sesiones: 150 });
    const filtros = filtrosAzar(r, filas);
    for (const c of r.algunos(CLAVES, 6, 12)) {
      const ops = opcionesDeColumna(filas, filtros, c);
      for (const { valor, cuenta } of r.algunos(ops, 1, 6)) {
        const nuevo: FiltrosTabla = { ...filtros, [c]: { modo: "solo", valores: [valor] } };
        const quedan = filas.filter((f) => pasaFiltros(f, nuevo));
        assert.equal(quedan.length, cuenta, conSemilla(semilla, `${c} = ${valor}: la tabla queda con ${quedan.length} y el menú dice ${cuenta}`));
        for (const f of quedan) assert.ok(valoresDe(f, c).includes(valor), conSemilla(semilla, `${f.id} no tiene ${valor} en ${c}`));
      }
    }
  }
});

test("filtrar «sin» un valor deja las filas que tienen algún otro valor (en una columna de un valor por fila: todas menos las que lo tienen)", () => {
  for (let semilla = 1; semilla <= 30; semilla++) {
    const r = new Azar(semilla + 300);
    const { filas } = filasDeMundo(r, { sesiones: 150 });
    const filtros = filtrosAzar(r, filas, 2);
    for (const c of r.algunos(CLAVES, 6, 12)) {
      const ops = opcionesDeColumna(filas, filtros, c);
      const pasan = filas.filter((f) => pasaFiltros(f, filtros, c));
      for (const { valor, cuenta } of r.algunos(ops, 1, 5)) {
        const nuevo: FiltrosTabla = { ...filtros, [c]: { modo: "sin", valores: [valor] } };
        const quedan = filas.filter((f) => pasaFiltros(f, nuevo));
        const esperadas = pasan.filter((f) => valoresDe(f, c).some((v) => v !== valor));
        assert.deepEqual(quedan.map((f) => f.id), esperadas.map((f) => f.id), conSemilla(semilla, `${c} sin ${valor}`));
        if (pasan.every((f) => valoresDe(f, c).length === 1)) assert.equal(quedan.length, pasan.length - cuenta, conSemilla(semilla, `${c} sin ${valor}: cuentas`));
      }
    }
  }
});

test("«contiene» y «no contiene» parten las filas en dos (sin tildes ni mayúsculas) y se pueden pedir los dos a la vez sin que quede ninguna", () => {
  for (let semilla = 1; semilla <= 30; semilla++) {
    const r = new Azar(semilla + 400);
    const { filas } = filasDeMundo(r, { sesiones: 140 });
    for (const c of r.algunos(CLAVES, 6, 10)) {
      const col = COLUMNA[c];
      const muestra = textoDeColumna(r.pick(filas), col);
      const q = muestra ? muestra.slice(r.int(muestra.length), r.int(muestra.length) + r.entre(1, 4)) || "a" : "a";
      const con = filas.filter((f) => pasaFiltros(f, { [c]: { modo: "solo", valores: [], contiene: q } }));
      const nocon = filas.filter((f) => pasaFiltros(f, { [c]: { modo: "solo", valores: [], noContiene: q } }));
      const ambos = filas.filter((f) => pasaFiltros(f, { [c]: { modo: "solo", valores: [], contiene: q, noContiene: q } }));
      assert.equal(con.length + nocon.length, filas.length, conSemilla(semilla, `${c} q=${JSON.stringify(q)}: no se parten`));
      assert.equal(new Set([...con, ...nocon]).size, filas.length, conSemilla(semilla, `${c}: se pisan`));
      assert.equal(ambos.length, 0, conSemilla(semilla, `${c}: contiene y no contiene lo mismo dejó filas`));
      /* La definición: el texto de la celda, sin tildes y en minúscula. */
      const nq = plano(q);
      assert.deepEqual(con.map((f) => f.id), filas.filter((f) => plano(textoDeColumna(f, col)).includes(nq)).map((f) => f.id), conSemilla(semilla, `${c} contiene ${JSON.stringify(q)}`));
    }
  }
});

test("«contiene» ignora tildes y mayúsculas en las dos puntas, como la búsqueda de arriba", () => {
  const { filas } = filasDeMundo(new Azar(5), { sesiones: 10 });
  const f = { ...filas[0], nombre: "Álvaro Ñandú" };
  for (const q of ["alvaro", "ALVARO", "álvaro", "ÁLVARO", "nandu", "ñandú", "ÑANDÚ", "o n"]) {
    assert.ok(pasaFiltros(f, { nombre: { modo: "solo", valores: [], contiene: q } }), q);
  }
  assert.ok(!pasaFiltros(f, { nombre: { modo: "solo", valores: [], contiene: "alvaros" } }));
  assert.ok(!pasaFiltros(f, { nombre: { modo: "solo", valores: [], noContiene: "ÁLVARO" } }));
});

test("«desde» y «hasta» en las columnas de fecha: de un día a otro, inclusive, y lo que no tiene fecha no entra en ningún período", () => {
  for (let semilla = 1; semilla <= 30; semilla++) {
    const r = new Azar(semilla + 500);
    const { filas } = filasDeMundo(r, { sesiones: 150 });
    const dias = {
      llamada: (f: FilaTabla) => diaAR3(Date.parse(f.llamada)),
      agendo: (f: FilaTabla) => diaAR3(Date.parse(f.agendo)),
      cierre: (f: FilaTabla) => f.cierre,
    } as const;
    for (const c of ["llamada", "agendo", "cierre"] as const) {
      const todos = [...new Set(filas.map(dias[c]).filter((d) => ES_DIA.test(d)))].sort();
      if (todos.length < 2) continue;
      for (let k = 0; k < 6; k++) {
        const a = r.pick(todos), b = r.pick(todos);
        const [desde, hasta] = a <= b ? [a, b] : [b, a];
        for (const fc of [{ desde, hasta }, { desde }, { hasta }]) {
          const quedan = filas.filter((f) => pasaFiltros(f, { [c]: { modo: "solo", valores: [], ...fc } })).map((f) => f.id);
          const esperadas = filas.filter((f) => { const d = dias[c](f); return ES_DIA.test(d) && (!fc.desde || d >= fc.desde) && (!("hasta" in fc) || !fc.hasta || d <= fc.hasta); }).map((f) => f.id);
          assert.deepEqual(quedan, esperadas, conSemilla(semilla, `${c} ${JSON.stringify(fc)}`));
        }
      }
      /* Un período al revés (desde después de hasta) no deja nada, sin fallar. */
      const [p, q] = [todos[todos.length - 1], todos[0]];
      assert.equal(filas.filter((f) => pasaFiltros(f, { [c]: { modo: "solo", valores: [], desde: p, hasta: q } })).length, p > q ? 0 : filas.filter((f) => dias[c](f) === p).length);
    }
  }
});

/* ---------- Propiedades generales de pasaFiltros ---------- */

test("pasaFiltros: sumar un filtro nunca agrega filas, no importa el orden de las claves, y `salvo` es lo mismo que no tener ese filtro", () => {
  for (let semilla = 1; semilla <= 40; semilla++) {
    const r = new Azar(semilla + 600);
    const { filas } = filasDeMundo(r, { sesiones: 120 });
    const filtros = filtrosAzar(r, filas, 4);
    const claves = Object.keys(filtros) as ClaveColumna[];
    const invertidos = Object.fromEntries([...claves].reverse().map((k) => [k, filtros[k]])) as FiltrosTabla;
    /* Un filtro de otra columna que no estaba. */
    const libres = CLAVES.filter((k) => !(k in filtros));
    const otra = r.pick(libres);
    const extra: FiltrosTabla = { [otra]: filtrosAzar(r, filas, 1)[otra] ?? { modo: "solo", valores: r.algunos(distintos(filas, otra), 1, 2) } };
    for (const f of filas) {
      const base = pasaFiltros(f, filtros);
      assert.equal(pasaFiltros(f, invertidos), base, conSemilla(semilla, "el orden de las claves cambia el resultado"));
      if (pasaFiltros(f, { ...filtros, ...extra })) assert.ok(base, conSemilla(semilla, `${f.id} pasa con más filtros y no con menos`));
      for (const c of claves) assert.equal(pasaFiltros(f, filtros, c), pasaFiltros(f, sin(filtros, c)), conSemilla(semilla, `salvo ${c}`));
    }
  }
});

test("un filtro sin nada que recortar (lista vacía, textos vacíos, sin fechas) no recorta: ninguna fila queda afuera", () => {
  const { filas } = filasDeMundo(new Azar(3), { sesiones: 80 });
  const inactivos: FiltroColumna[] = [
    { modo: "solo", valores: [] }, { modo: "sin", valores: [] }, { modo: "solo", valores: [], contiene: "", noContiene: "", desde: "", hasta: "" },
  ];
  for (const c of CLAVES) for (const fc of inactivos) {
    assert.equal(hayFiltro(fc), false);
    assert.ok(filas.every((f) => pasaFiltros(f, { [c]: fc })), c);
  }
  assert.ok(filas.every((f) => pasaFiltros(f, {})));
  assert.equal(hayFiltro(undefined), false);
  assert.equal(hayFiltro(null), false);
  /* Una clave que no es una columna se ignora. */
  assert.ok(filas.every((f) => pasaFiltros(f, { inventada: { modo: "solo", valores: ["x"] } } as unknown as FiltrosTabla)));
});

test("seVe y la pastilla de cada filtro: sin excepciones y coherentes con pasaFiltros en columnas de un solo valor", () => {
  const { filas } = filasDeMundo(new Azar(9), { sesiones: 100 });
  for (const c of ["closer", "pais", "estadoLlamada", "via", "ad", "venta", "comprobante", "conciliado", "calificada"] as const) {
    for (const modo of ["solo", "sin"] as const) {
      const valores = distintos(filas, c).slice(0, 3);
      const fc: FiltroColumna = { modo, valores };
      for (const f of filas) assert.equal(pasaFiltros(f, { [c]: fc }), seVe(valoresDe(f, c)[0], fc), `${c} ${modo}`);
      assert.ok(textoDeFiltro(fc).length > 0);
    }
  }
  assert.equal(seVe("x", undefined), true);
  assert.equal(seVe("x", { modo: "solo", valores: [] }), true);
});

test("los valores con trampas (barra, coma, %, =, tildes, emoji, «(Vacías)») filtran por igualdad exacta: no se confunden con otros", () => {
  const { filas } = filasDeMundo(new Azar(2), { sesiones: 30 });
  const base = filas[0];
  const nombres = ["a|b", "a,b", "100%", "a=b&c", "Árbol", "árbol", "ARBOL", "😀", "(Vacías)", "a b", "a  b"];
  const rows = nombres.map((nombre, i) => ({ ...base, id: `t${i}`, nombre }));
  for (const n of nombres) {
    const quedan = rows.filter((f) => pasaFiltros(f, { nombre: { modo: "solo", valores: [n] } })).map((f) => f.nombre);
    assert.deepEqual(quedan, [n]);
    const sinEste = rows.filter((f) => pasaFiltros(f, { nombre: { modo: "sin", valores: [n] } })).map((f) => f.nombre);
    assert.equal(sinEste.length, nombres.length - 1);
  }
  /* El menú tampoco los junta. */
  const ops = opcionesDeColumna(rows, {}, "nombre");
  assert.equal(ops.length, nombres.length);
  assert.ok(ops.every((o) => o.cuenta === 1));
});
