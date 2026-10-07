import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNAS, coincideBusqueda, DIMENSIONES, filasTabla, opcionesDeColumna, ordenarFilas, ORDEN_POR_DEFECTO, pasaFiltros, porDimension, resumenDe,
  type FiltrosTabla,
} from "@/lib/crm-tabla";
import { filasCrm } from "@/lib/crm";
import { AHORA, Azar, mundoAzar } from "./gen";

/* ==================================================================
   Frente 6: rendimiento con el tamaño que puede tener la base.
   5.000 llamadas, 3.000 ventas y 10.000 pagos arman las filas de la
   tabla, se filtran y se ordenan en tiempos razonables; y filasCrm sigue
   recordando las filas que no cambiaron.

   Los topes son holgados (5 a 10 veces lo medido en una máquina común) para
   que no dependan de cuánta carga tenga la computadora: lo que buscan es un
   salto de órdenes de magnitud (algo cuadrático), no unos milisegundos.
   Los números medidos se imprimen como diagnóstico.
   ================================================================== */

const medir = <T,>(f: () => T): { r: T; ms: number } => { const a = performance.now(); const r = f(); return { r, ms: performance.now() - a }; };
const mejorDe = (n: number, f: () => unknown) => Math.min(...Array.from({ length: n }, () => medir(f).ms));

function mundoGrande(llamadas: number, ventas: number, pagos: number, semilla = 1) {
  const m = mundoAzar(new Azar(semilla), { sesiones: llamadas, contactos: Math.round(llamadas * 0.7), ventas, pagos });
  /* Todas de venta: cada llamada es una fila de la tabla. */
  for (const s of m.sesiones) s.tipo = "Asesoramiento Hackear IT";
  return m;
}

const MUCHOS_FILTROS: FiltrosTabla = {
  closer: { modo: "sin", valores: ["Dante Barbieri"] },
  pais: { modo: "solo", valores: ["Argentina", "México", "Colombia"], contiene: "a" },
  comprobante: { modo: "sin", valores: ["Sin venta"] },
  llamada: { modo: "solo", valores: [], desde: "2026-08-01" },
};

test("5.000 llamadas, 3.000 ventas y 10.000 pagos: armar filas, filtrar y ordenar como lo hace la pantalla", (t: TestContext) => {
  const m = mundoGrande(5000, 3000, 10000);
  assert.equal(m.sesiones.length, 5000); assert.equal(m.ventas.length, 3000); assert.equal(m.pagos.length, 10000);

  /* filasCrm en frío y en caliente, antes de filasTabla (que lo usa). */
  const frio = medir(() => filasCrm(m));
  const caliente = mejorDe(3, () => filasCrm(m));
  const filasCrm2 = filasCrm(m);
  assert.equal(filasCrm2.length, frio.r.length);
  /* Las agendas que se reprogramaron no son una fila: quedan unas 4.500 de las 5.000. */
  assert.ok(frio.r.length > 4000 && frio.r.length <= 5000, `filas: ${frio.r.length}`);
  assert.ok(filasCrm2.every((f, i) => f === frio.r[i]), "la segunda vez rearmó filas que no cambiaron (perdió la memoria)");
  assert.ok(caliente < frio.ms, `filasCrm en caliente (${caliente.toFixed(0)} ms) no es más rápido que en frío (${frio.ms.toFixed(0)} ms)`);

  const armar = medir(() => filasTabla(m, AHORA));
  const filas = armar.r;
  assert.equal(filas.length, frio.r.length);
  assert.ok(armar.ms < 3000, `filasTabla: ${armar.ms.toFixed(0)} ms`);

  const busqueda = medir(() => filas.filter((f) => coincideBusqueda(f, "garcía")));
  const filtrado = medir(() => filas.filter((f) => pasaFiltros(f, MUCHOS_FILTROS)));
  const orden3 = medir(() => ordenarFilas(filtrado.r, [{ clave: "closer", desc: false }, { clave: "nombre", desc: true }, ...ORDEN_POR_DEFECTO], {}));
  const ordenLlamada = medir(() => ordenarFilas(filas, ORDEN_POR_DEFECTO, {}));
  const ordenNombre = medir(() => ordenarFilas(filas, [{ clave: "nombre", desc: false }, ...ORDEN_POR_DEFECTO], {}));
  const pantalla = medir(() => ordenarFilas(filas.filter((f) => coincideBusqueda(f, "a") && pasaFiltros(f, MUCHOS_FILTROS)), [{ clave: "comprobante", desc: false }, ...ORDEN_POR_DEFECTO], {}));
  const menus = medir(() => COLUMNAS.map((c) => opcionesDeColumna(filas, MUCHOS_FILTROS, c.clave)));
  const menusLimpios = medir(() => COLUMNAS.map((c) => opcionesDeColumna(filas, {}, c.clave)));
  const resumen = medir(() => resumenDe(filas));
  const dimensiones = medir(() => DIMENSIONES.map((d) => porDimension(filas, d)));

  t.diagnostic(
    `5.000 llamadas / 3.000 ventas / 10.000 pagos → filasCrm frío ${frio.ms.toFixed(0)} ms, caliente ${caliente.toFixed(0)} ms; filasTabla ${armar.ms.toFixed(0)} ms; `
    + `buscar ${busqueda.ms.toFixed(1)} ms; filtrar ${filtrado.ms.toFixed(1)} ms; ordenar por llamada ${ordenLlamada.ms.toFixed(0)} ms, por nombre ${ordenNombre.ms.toFixed(0)} ms, `
    + `3 criterios ${orden3.ms.toFixed(0)} ms; buscar+filtrar+ordenar ${pantalla.ms.toFixed(0)} ms; menús de las 31 columnas ${menus.ms.toFixed(0)} ms (sin filtros ${menusLimpios.ms.toFixed(0)} ms); `
    + `resumen ${resumen.ms.toFixed(1)} ms; ${DIMENSIONES.length} dimensiones ${dimensiones.ms.toFixed(0)} ms`,
  );
  assert.ok(busqueda.ms < 1000, `búsqueda: ${busqueda.ms.toFixed(0)} ms`);
  assert.ok(filtrado.ms < 1000, `filtrar: ${filtrado.ms.toFixed(0)} ms`);
  assert.ok(ordenLlamada.ms < 3000, `ordenar por llamada: ${ordenLlamada.ms.toFixed(0)} ms`);
  assert.ok(ordenNombre.ms < 3000, `ordenar por nombre: ${ordenNombre.ms.toFixed(0)} ms`);
  assert.ok(orden3.ms < 3000, `ordenar por tres criterios: ${orden3.ms.toFixed(0)} ms`);
  assert.ok(pantalla.ms < 3000, `buscar + filtrar + ordenar: ${pantalla.ms.toFixed(0)} ms`);
  assert.ok(menus.ms < 5000, `menús: ${menus.ms.toFixed(0)} ms`);
  assert.ok(menusLimpios.ms < 5000, `menús sin filtros: ${menusLimpios.ms.toFixed(0)} ms`);
  assert.ok(dimensiones.ms < 3000, `dimensiones: ${dimensiones.ms.toFixed(0)} ms`);
});

test("filasCrm recuerda las filas que no cambiaron: cambiar una agenda rearma sólo esa; cambiar la configuración rearma todas", () => {
  const m = mundoGrande(3000, 1800, 0);
  const antes = filasCrm(m);
  assert.ok(antes.length > 2400 && antes.length <= 3000, `filas: ${antes.length}`);
  /* El store reemplaza la agenda que cambia (nunca la edita en el lugar). Una que sea fila (no una reprogramada). */
  const enFila = new Set(antes.map((f) => f.id));
  const i = m.sesiones.findIndex((s, k) => k > 1000 && enFila.has(s.id));
  const nueva = { ...m.sesiones[i], notas: "otra nota" };
  const m2 = { ...m, sesiones: m.sesiones.map((s, k) => (k === i ? nueva : s)) };
  const despues = filasCrm(m2);
  const cambiadas = despues.filter((f, k) => f !== antes[k]);
  assert.equal(cambiadas.length, 1, `se rearmaron ${cambiadas.length} filas por cambiar una agenda`);
  assert.equal(cambiadas[0].id, nueva.id);
  assert.equal(cambiadas[0].notas, "otra nota");
  /* Un contacto que cambia rearma las agendas de esa persona y sólo ésas. */
  const c = m.contactos[5];
  const m3 = { ...m, contactos: m.contactos.map((x) => (x === c ? { ...x, nombre: "Otro nombre" } : x)) };
  const rearmadas3 = filasCrm(m3).filter((f, k) => f !== antes[k]);
  const deLaPersona = antes.filter((f) => (f.sesion.contactoId ?? "") === c.id || (f.sesion.leadId ?? "") === c.id).length;
  assert.ok(rearmadas3.length <= deLaPersona + 1, `se rearmaron ${rearmadas3.length} filas (la persona tiene ${deLaPersona})`);
  /* La configuración (ajustes) entera es otra: todo se rearma. */
  const m4 = { ...m, ajustes: { ...m.ajustes } };
  const rearmadas4 = filasCrm(m4).filter((f, k) => f !== antes[k]);
  assert.equal(rearmadas4.length, antes.length, "con otros ajustes tienen que rearmarse todas");
});

test("el tiempo crece como el tamaño, no como su cuadrado: 12.000 llamadas no cuestan más de ~8 veces lo que 3.000", (t: TestContext) => {
  const chico = mundoGrande(3000, 1800, 3500, 2);
  const grande = mundoGrande(12000, 7200, 14000, 2);
  const a = medir(() => filasTabla(chico, AHORA)), b = medir(() => filasTabla(grande, AHORA));
  const oa = medir(() => ordenarFilas(a.r, [{ clave: "closer", desc: false }, ...ORDEN_POR_DEFECTO], {}));
  const ob = medir(() => ordenarFilas(b.r, [{ clave: "closer", desc: false }, ...ORDEN_POR_DEFECTO], {}));
  const pa = medir(() => DIMENSIONES.map((d) => porDimension(a.r, d)));
  const pb = medir(() => DIMENSIONES.map((d) => porDimension(b.r, d)));
  const ma = medir(() => COLUMNAS.map((c) => opcionesDeColumna(a.r, MUCHOS_FILTROS, c.clave)));
  const mb = medir(() => COLUMNAS.map((c) => opcionesDeColumna(b.r, MUCHOS_FILTROS, c.clave)));
  t.diagnostic(
    `3.000 → 12.000 llamadas: filasTabla ${a.ms.toFixed(0)} → ${b.ms.toFixed(0)} ms (x${(b.ms / a.ms).toFixed(1)}); ordenar ${oa.ms.toFixed(0)} → ${ob.ms.toFixed(0)} ms (x${(ob.ms / oa.ms).toFixed(1)}); `
    + `dimensiones ${pa.ms.toFixed(0)} → ${pb.ms.toFixed(0)} ms (x${(pb.ms / pa.ms).toFixed(1)}); menús ${ma.ms.toFixed(0)} → ${mb.ms.toFixed(0)} ms (x${(mb.ms / ma.ms).toFixed(1)})`,
  );
  /* Cuatro veces más filas: ~4x si es lineal (algo más con n·log n); 16x si es cuadrático. */
  assert.ok(b.ms / a.ms < 8, `filasTabla escala mal: x${(b.ms / a.ms).toFixed(1)}`);
  assert.ok(ob.ms / oa.ms < 9, `ordenar escala mal: x${(ob.ms / oa.ms).toFixed(1)}`);
  /* porDimension tiene su propio hallazgo (abajo): acá sólo se informa. */
  assert.ok(mb.ms / ma.ms < 9, `opcionesDeColumna escala mal: x${(mb.ms / ma.ms).toFixed(1)}`);
});

test("BUG (eficiencia): porDimension copia la lista del grupo por cada fila: con un valor que domina, 3 veces más filas cuestan mucho más de 3 veces", (t: TestContext) => {
  /* `grupos.set(v, [...(grupos.get(v) ?? []), f])` es O(n²) en el tamaño del grupo más grande. Un closer que atiende casi todas las
     llamadas (o «Sí/No» en Calificada) hace que el análisis del Resumen se vuelva lento con muchas llamadas en el período. */
  const m = mundoGrande(12000, 100, 0, 3);
  for (const s of m.sesiones) { s.reprogramadaDe = undefined; s.anfitrion = "Dante"; }
  const filas = filasTabla(m, AHORA);
  assert.ok(filas.length > 10000);
  const a = mejorDe(3, () => porDimension(filas.slice(0, 4000), "closer"));
  const b = mejorDe(3, () => porDimension(filas.slice(0, 12000), "closer"));
  t.diagnostic(`porDimension, un solo closer: 4.000 filas ${a.toFixed(1)} ms, 12.000 filas ${b.toFixed(0)} ms (x${(b / a).toFixed(1)}; lineal sería x3, cuadrático x9)`);
  assert.ok(b / a < 4.5, `porDimension crece como el cuadrado: x${(b / a).toFixed(1)} al triplicar las filas`);
});
