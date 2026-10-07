import test from "node:test";
import assert from "node:assert/strict";
import {
  MENSAJE_PROVEEDOR, borradorInicial, cambiosAlRepetir, datosDelGasto, detalleDeMiembro, equipoDeGasto,
  esCategoriaDeEquipo, esProveedorNuevo, esProveedorValido, filtrarProveedores, modoDeCarga, mostrarGrilla,
  opcionesProveedor, pasosDeCarga, problemaDelPaso, problemasDelGasto, resolverProveedor, tipoCambioDeAjustes,
  type BorradorGasto,
} from "@/lib/carga-gasto";
import { GRUPOS_GASTO, gastosParecidos, sugerirCategoria } from "@/lib/gastos";
import { calcularPyL } from "@/lib/finanzas";
import { RENGLON_DE_GRUPO, armarEstadoResultados, esBloque, type NodoPyL } from "@/lib/estadoResultados";
import { estadoVacio } from "@/lib/seed";
import type { EstadoApp, Gasto, MiembroEquipo } from "@/lib/types";

/* ---------- Armado ---------- */

const miembro = (m: Partial<MiembroEquipo> & { id: string; nombre: string }): MiembroEquipo => ({
  rol: "otro", comisionRate: 0, activo: true, sinComision: false, ...m,
});

const gasto = (g: Partial<Gasto> & { id: string }): Gasto => ({
  categoria: "Software", grupo: "operativo", concepto: "Gasto", monto: 100, moneda: "USD",
  fecha: "2026-09-01T12:00:00.000Z", recurrente: false, creadoEn: "2026-09-01T12:00:00.000Z", extra: {}, ...g,
});

const AJUSTES = { monedaBase: "USD" as const, tipoCambio: 1450 };

/* Un borrador completo, para ir sacándole lo que falta. */
const completo = (c: Partial<BorradorGasto> = {}): BorradorGasto => ({
  ...borradorInicial(AJUSTES, null, new Date(2026, 9, 7)),
  concepto: "Contador de septiembre", categoria: "Contador", proveedor: "Estudio Ríos", monto: "95", ...c,
});

const EQUIPO = [
  miembro({ id: "eq_zoe", nombre: "Zoe Álvarez", puesto: "Editora de video" }),
  miembro({ id: "eq_bruno", nombre: "Bruno Díaz", rol: "closer" }),
  miembro({ id: "eq_carla", nombre: "Carla Gómez", puesto: "COO", activo: false }),
  miembro({ id: "eq_ana", nombre: "Ana Paz" }),
];

const GASTOS = [
  gasto({ id: "g1", proveedor: "Meta", categoria: "Meta Ads", fecha: "2026-07-01T12:00:00.000Z" }),
  gasto({ id: "g2", proveedor: "Meta", categoria: "Meta Ads", fecha: "2026-08-01T12:00:00.000Z" }),
  gasto({ id: "g3", proveedor: "Zoom", categoria: "Software", fecha: "2026-08-15T12:00:00.000Z" }),
  gasto({ id: "g4", proveedor: "Bruno Díaz", categoria: "Equipo / Salarios", grupo: "operativo", fecha: "2026-09-01T12:00:00.000Z" }),
  gasto({ id: "g5", categoria: "Contador" }),
];

const estado = (gastos: Gasto[] = GASTOS, equipo: MiembroEquipo[] = EQUIPO) =>
  ({ ajustes: AJUSTES, gastos, equipo }) as unknown as EstadoApp;

const nombres = (xs: { nombre: string }[]) => xs.map((o) => o.nombre);

/* ---------- Qué pasos tiene cada camino ---------- */

test("un gasto nuevo pregunta de a una cosa, y a quién se le pagó es una de ellas", () => {
  assert.deepEqual(
    pasosDeCarga("nuevo").map((p) => p.id),
    ["concepto", "categoria", "proveedor", "monto", "fecha", "revisar"],
  );
});

test("al repetir un gasto se saltan la categoría, el proveedor, el monto y la fecha: todo se revisa en un solo paso", () => {
  const pasos = pasosDeCarga("repetir");
  assert.deepEqual(pasos.map((p) => p.id), ["concepto", "revisar"]);
  assert.equal(pasos[1].titulo, "Revisá y cargá");
});

test("al editar se abre directo la revisión", () => {
  const pasos = pasosDeCarga("editar");
  assert.deepEqual(pasos.map((p) => p.id), ["revisar"]);
  assert.equal(pasos[0].titulo, "Revisá y guardá");
});

test("en todos los caminos el último paso es la revisión, y ningún paso se repite", () => {
  for (const modo of ["nuevo", "repetir", "editar"] as const) {
    const ids = pasosDeCarga(modo).map((p) => p.id);
    assert.equal(ids[ids.length - 1], "revisar", modo);
    assert.equal(new Set(ids).size, ids.length, modo);
  }
});

test("el camino lo decide si se edita y si se eligió un gasto parecido", () => {
  assert.equal(modoDeCarga({ editando: false }), "nuevo");
  assert.equal(modoDeCarga({ editando: false, copiadoDe: "g1" }), "repetir");
  assert.equal(modoDeCarga({ editando: true }), "editar");
  /* Editar manda sobre todo lo demás. */
  assert.equal(modoDeCarga({ editando: true, copiadoDe: "g1" }), "editar");
});

test("la grilla de categorías aparece sólo si no hay una o si se pide cambiarla", () => {
  assert.equal(mostrarGrilla("", false), true, "sin sugerencia ni elegida");
  assert.equal(mostrarGrilla("   ", false), true);
  assert.equal(mostrarGrilla("Equipo / Salarios", false), false, "con una, se muestra la tarjeta");
  assert.equal(mostrarGrilla("Equipo / Salarios", true), true, "«Cambiar categoría»");
});

test("cada bloque dice en qué renglón del estado de resultados cae", () => {
  assert.deepEqual(GRUPOS_GASTO.map((g) => g.grupo), ["directo", "operativo", "dueno", "retiro"]);
  for (const g of GRUPOS_GASTO) {
    assert.ok(g.renglon.length > 20 && g.renglon.length < 120, `${g.grupo}: una línea corta`);
    assert.ok(g.tipo.length > 0);
  }
  const por = Object.fromEntries(GRUPOS_GASTO.map((g) => [g.grupo, g]));
  assert.match(por.directo.renglon, /«Otros costos directos»/);
  assert.match(por.operativo.renglon, /«Gastos operativos»/);
  assert.match(por.dueno.renglon, /«Honorarios del CEO»/);
  assert.match(por.retiro.renglon, /no resta del profit/);
  assert.equal(por.operativo.tipo, "gasto operativo", "«Va en: Equipo / Salarios · gasto operativo»");
});

test("las líneas de cada bloque nombran los renglones que de verdad tiene el estado de resultados", () => {
  /* Si alguien renombra un renglón del estado, la línea que se lee al elegir categoría tiene que acompañarlo. */
  const mes = { clave: "2026-10", etiqueta: "octubre 2026", desde: new Date(2026, 9, 1), hasta: new Date(2026, 9, 31, 23, 59, 59) };
  const fecha = new Date(2026, 9, 15, 12).toISOString();
  const e = {
    ...estadoVacio(),
    gastos: (["directo", "operativo", "dueno"] as const).map((grupo, i) => gasto({ id: `g${i}`, grupo, categoria: "X", monto: 100, fecha })),
  };
  const arbol = armarEstadoResultados(e, mes, calcularPyL(e, mes), (n) => String(n), (id) => `#${id}`);
  const renglones = arbol.filter((x): x is NodoPyL => !esBloque(x));
  for (const g of GRUPOS_GASTO) {
    const id = RENGLON_DE_GRUPO[g.grupo];
    if (!id) { assert.match(g.renglon, /^No cae en el estado de resultados/, `${g.grupo} no tiene renglón`); continue; }
    const nodo = renglones.find((n) => n.id === id);
    assert.ok(nodo, `${g.grupo}: el estado de resultados tiene el renglón ${id}`);
    assert.ok(g.renglon.includes(`«${nodo.titulo}»`), `${g.grupo}: la línea nombra «${nodo.titulo}»`);
  }
});

/* ---------- Lo que falta para cargarlo ---------- */

test("sin proveedor no se puede cargar", () => {
  const b = completo({ proveedor: "" });
  assert.equal(problemasDelGasto(b, "USD").proveedor, MENSAJE_PROVEEDOR);
  assert.equal(problemaDelPaso("revisar", b, "USD"), MENSAJE_PROVEEDOR);
  assert.equal(problemaDelPaso("proveedor", b, "USD"), MENSAJE_PROVEEDOR);
  /* Los demás pasos no se frenan por eso. */
  for (const paso of ["concepto", "categoria", "monto", "fecha"] as const) assert.equal(problemaDelPaso(paso, b, "USD"), null, paso);
});

test("el mensaje dice qué hacer: elegir o escribir", () => {
  assert.match(MENSAJE_PROVEEDOR, /Elegí/);
  assert.match(MENSAJE_PROVEEDOR, /escribí/);
});

test("un proveedor en blanco o de una sola letra no vale", () => {
  for (const mal of ["", "   ", "a", " a "]) {
    assert.equal(esProveedorValido(mal), false, JSON.stringify(mal));
    assert.ok(problemasDelGasto(completo({ proveedor: mal }), "USD").proveedor, JSON.stringify(mal));
  }
  for (const bien of ["Zoom", "Al", " Ana Paz "]) {
    assert.equal(esProveedorValido(bien), true, bien);
    assert.equal(problemasDelGasto(completo({ proveedor: bien }), "USD").proveedor, undefined, bien);
  }
});

test("con todo completo no falta nada", () => {
  const b = completo();
  assert.deepEqual(problemasDelGasto(b, "USD"), {});
  assert.equal(problemaDelPaso("revisar", b, "USD"), null);
});

test("cada paso frena sólo por lo suyo", () => {
  const vacio = borradorInicial(AJUSTES, null, new Date(2026, 9, 7));
  assert.equal(problemaDelPaso("concepto", vacio, "USD"), "Contá qué pagaste");
  assert.equal(problemaDelPaso("categoria", vacio, "USD"), "Elegí una categoría");
  assert.equal(problemaDelPaso("proveedor", vacio, "USD"), MENSAJE_PROVEEDOR);
  assert.equal(problemaDelPaso("monto", vacio, "USD"), "Escribí cuánto fue");
  assert.equal(problemaDelPaso("fecha", vacio, "USD"), null, "la fecha arranca en hoy");
  assert.equal(problemaDelPaso("fecha", { ...vacio, fecha: "no es una fecha" }, "USD"), "Elegí la fecha");
});

test("un gasto en pesos pide el tipo de cambio", () => {
  const b = completo({ moneda: "ARS", monto: "145.000", tipoCambio: "" });
  assert.equal(problemasDelGasto(b, "USD").tipoCambio, "Escribí el tipo de cambio");
  assert.equal(problemaDelPaso("monto", b, "USD"), "Escribí el tipo de cambio");
  assert.equal(problemaDelPaso("monto", { ...b, tipoCambio: "1.450" }, "USD"), null);
  /* En dólares no hace falta. */
  assert.equal(problemasDelGasto(completo({ tipoCambio: "" }), "USD").tipoCambio, undefined);
});

test("en la revisión, lo primero que falta es lo que se nombra, en el orden de la pantalla", () => {
  const todoMal = completo({ concepto: "", categoria: "", proveedor: "", monto: "" });
  assert.equal(problemaDelPaso("revisar", todoMal, "USD"), "Contá qué pagaste");
  assert.equal(problemaDelPaso("revisar", { ...todoMal, concepto: "Zoom" }, "USD"), "Elegí una categoría");
  assert.equal(problemaDelPaso("revisar", { ...todoMal, concepto: "Zoom", categoria: "Software" }, "USD"), "Escribí cuánto fue");
  assert.equal(problemaDelPaso("revisar", { ...todoMal, concepto: "Zoom", categoria: "Software", monto: "50" }, "USD"), MENSAJE_PROVEEDOR);
});

/* ---------- A quién se le pagó: la lista ---------- */

test("con una categoría de sueldos va primero el equipo, con sus activos antes", () => {
  const o = opcionesProveedor(estado(), "Equipo / Salarios");
  assert.deepEqual(o.map((x) => x.grupo), ["equipo", "equipo", "equipo", "equipo", "usado", "usado"]);
  /* Bruno ya cobró en esta categoría: arriba. Después los activos, por nombre; el que ya no está, al final. */
  assert.deepEqual(nombres(o).slice(0, 4), ["Bruno Díaz", "Ana Paz", "Zoe Álvarez", "Carla Gómez"]);
  assert.equal(o[3].inactivo, true);
  assert.equal(o[2].inactivo, undefined);
});

test("con cualquier otra categoría van primero los proveedores, y los de esa categoría antes que el resto", () => {
  const software = opcionesProveedor(estado(), "Software");
  assert.deepEqual(software.map((x) => x.grupo), ["usado", "usado", "equipo", "equipo", "equipo", "equipo"]);
  assert.deepEqual(nombres(software).slice(0, 2), ["Zoom", "Meta"], "Zoom ya se usó en Software; Meta no");
  const meta = opcionesProveedor(estado(), "Meta Ads");
  assert.deepEqual(nombres(meta).slice(0, 2), ["Meta", "Zoom"]);
  assert.deepEqual(nombres(meta).slice(2), ["Ana Paz", "Bruno Díaz", "Zoe Álvarez", "Carla Gómez"], "el equipo después, activos primero");
});

test("las personas del equipo se ven con su nombre completo y su puesto o su rol", () => {
  const o = opcionesProveedor(estado(), "Equipo / Salarios");
  const por = Object.fromEntries(o.filter((x) => x.equipoId).map((x) => [x.equipoId, x]));
  assert.equal(por.eq_zoe.nombre, "Zoe Álvarez");
  assert.equal(por.eq_zoe.detalle, "Editora de video", "el puesto, si lo tiene");
  assert.equal(por.eq_bruno.detalle, "Closer", "si no, su rol en las ventas");
  assert.equal(por.eq_ana.detalle, "Equipo", "«No vende» no dice nada");
  assert.equal(por.eq_carla.detalle, "COO · ya no está");
});

test("los proveedores salen de los gastos ya cargados: uno por nombre, sin repetir a quien es del equipo", () => {
  const o = opcionesProveedor(estado(), "Software");
  const usados = o.filter((x) => x.grupo === "usado");
  assert.deepEqual(nombres(usados), ["Zoom", "Meta"]);
  assert.equal(usados.find((x) => x.nombre === "Meta")?.usos, 2);
  assert.equal(usados.find((x) => x.nombre === "Meta")?.detalle, "2 gastos · Meta Ads");
  assert.equal(usados.find((x) => x.nombre === "Zoom")?.detalle, "1 gasto · Software");
  assert.ok(!nombres(usados).includes("Bruno Díaz"), "ya está en el equipo");
  /* Un gasto sin proveedor no suma ninguno. */
  assert.ok(!nombres(o).includes(""));
});

test("«Meta», «meta » y «META» son el mismo proveedor y queda como se lo escribió más veces", () => {
  const gastos = [
    gasto({ id: "a", proveedor: "Meta", fecha: "2026-06-01T12:00:00.000Z" }),
    gasto({ id: "b", proveedor: "Meta", fecha: "2026-07-01T12:00:00.000Z" }),
    gasto({ id: "c", proveedor: "meta ", fecha: "2026-08-01T12:00:00.000Z" }),
    gasto({ id: "d", proveedor: "META", fecha: "2026-09-01T12:00:00.000Z" }),
  ];
  const o = opcionesProveedor(estado(gastos, []), "Software");
  assert.equal(o.length, 1);
  assert.equal(o[0].nombre, "Meta");
  assert.equal(o[0].usos, 4);
});

test("la lista de una categoría de dueño también empieza por el equipo", () => {
  assert.equal(opcionesProveedor(estado(), "Honorarios del CEO", "dueno")[0].grupo, "equipo");
  assert.equal(opcionesProveedor(estado(), "Alguna categoría nueva", "dueno")[0].grupo, "equipo");
});

test("sin equipo ni gastos la lista queda vacía: se escribe", () => {
  assert.deepEqual(opcionesProveedor(estado([], []), "Software"), []);
  assert.deepEqual(opcionesProveedor(estado([], []), ""), []);
});

test("qué categorías son de personas del equipo", () => {
  for (const c of ["Equipo / Salarios", "Honorarios del CEO", "Setters", "Edición de contenido", "Filmmaker", "Sueldos extra", "Nómina", "equipo"]) {
    assert.equal(esCategoriaDeEquipo(c), true, c);
  }
  for (const c of ["Software", "Meta Ads", "Viáticos equipo", "Consultoría", "Contador", "Retiro de beneficios", ""]) {
    assert.equal(esCategoriaDeEquipo(c), false, c);
  }
  assert.equal(esCategoriaDeEquipo("Algo del dueño", "dueno"), true);
  assert.equal(esCategoriaDeEquipo("Algo operativo", "operativo"), false);
});

test("lo que se lee debajo del nombre", () => {
  assert.equal(detalleDeMiembro({ puesto: "  COO ", rol: "closer", activo: true }), "COO");
  assert.equal(detalleDeMiembro({ rol: "director", activo: true }), "Director comercial");
  assert.equal(detalleDeMiembro({ rol: "growth", activo: true }), "Growth partner");
  assert.equal(detalleDeMiembro({ rol: "otro", activo: true }), "Equipo");
  assert.equal(detalleDeMiembro({ puesto: "", rol: "setter", activo: false }), "Setter · ya no está");
});

/* ---------- A quién se le pagó: buscar y escribir ---------- */

test("al escribir se filtra por cualquier palabra, sin tildes ni mayúsculas", () => {
  const o = opcionesProveedor(estado(), "Equipo / Salarios");
  assert.deepEqual(nombres(filtrarProveedores(o, "alvarez")), ["Zoe Álvarez"]);
  assert.deepEqual(nombres(filtrarProveedores(o, "ÁLVA")), ["Zoe Álvarez"]);
  assert.deepEqual(nombres(filtrarProveedores(o, "diaz")), ["Bruno Díaz"]);
  assert.deepEqual(nombres(filtrarProveedores(o, "paz ana")), ["Ana Paz"], "las palabras en cualquier orden");
  assert.deepEqual(nombres(filtrarProveedores(o, "zoe alv")), ["Zoe Álvarez"]);
  assert.deepEqual(filtrarProveedores(o, "xyz"), []);
  assert.deepEqual(filtrarProveedores(o, "  "), o, "sin nada escrito se ve todo");
});

test("a alguien del equipo también se lo encuentra por lo que hace", () => {
  const o = opcionesProveedor(estado(), "Equipo / Salarios");
  assert.deepEqual(nombres(filtrarProveedores(o, "editora")), ["Zoe Álvarez"]);
  assert.deepEqual(nombres(filtrarProveedores(o, "closer")), ["Bruno Díaz"]);
  assert.deepEqual(nombres(filtrarProveedores(o, "coo")), ["Carla Gómez"]);
  /* Pero no a un proveedor por «gastos» o por su categoría. */
  assert.deepEqual(filtrarProveedores(o, "gastos"), []);
});

test("al filtrar, los grupos siguen en su orden y lo que mejor calza va primero", () => {
  const o = opcionesProveedor(estado(), "Software");
  const z = filtrarProveedores(o, "zo");
  assert.deepEqual(nombres(z), ["Zoom", "Zoe Álvarez"], "primero los proveedores (así es el orden de esa lista)");
  const e = filtrarProveedores(opcionesProveedor(estado(), "Equipo / Salarios"), "zo");
  assert.deepEqual(nombres(e), ["Zoe Álvarez", "Zoom"], "con sueldos, primero el equipo");
  /* «ana» está al principio de «Ana Paz» y adentro de «Susana»: gana el que empieza. */
  const ana = filtrarProveedores([
    { nombre: "Susana Roca", grupo: "equipo", detalle: "Equipo" },
    { nombre: "Ana Paz", grupo: "equipo", detalle: "Equipo" },
  ], "ana");
  assert.deepEqual(nombres(ana), ["Ana Paz", "Susana Roca"]);
});

test("lo que se escribe y no está en la lista se ofrece como proveedor nuevo", () => {
  const o = opcionesProveedor(estado(), "Software");
  assert.equal(esProveedorNuevo(o, "Zoom Inc"), true);
  assert.equal(esProveedorNuevo(o, "Zoom"), false);
  assert.equal(esProveedorNuevo(o, " zoom "), false, "es el mismo");
  assert.equal(esProveedorNuevo(o, "ZOE ALVAREZ"), false, "es alguien del equipo");
  assert.equal(esProveedorNuevo(o, "a"), false, "una letra no alcanza");
  assert.equal(esProveedorNuevo(o, ""), false);
});

test("lo escrito queda como figura en la lista, y de alguien del equipo se anota quién es", () => {
  const o = opcionesProveedor(estado(), "Equipo / Salarios");
  assert.deepEqual(resolverProveedor("zoe alvarez", o), { nombre: "Zoe Álvarez", equipoId: "eq_zoe" });
  assert.deepEqual(resolverProveedor("  BRUNO   díaz ", o), { nombre: "Bruno Díaz", equipoId: "eq_bruno" });
  assert.deepEqual(resolverProveedor("zoom", o), { nombre: "Zoom" }, "un proveedor ya usado no es del equipo");
  assert.deepEqual(resolverProveedor("  Estudio   Ríos ", o), { nombre: "Estudio Ríos" }, "uno nuevo queda como se escribió");
  assert.deepEqual(resolverProveedor("   ", o), { nombre: "" });
});

/* ---------- Repetir un gasto ---------- */

test("al repetir se copia lo que suele repetirse y no lo que es de esa vez", () => {
  const g = gasto({
    id: "g_viejo", concepto: "Contador de agosto", categoria: "Contador", monto: 95, proveedor: "Estudio Ríos",
    recurrente: true, webinarId: "w1", notas: "Con factura", fecha: "2026-08-01T12:00:00.000Z",
  });
  const c = cambiosAlRepetir(g, "1.450");
  assert.deepEqual(c, {
    concepto: "Contador de agosto", categoria: "Contador", grupo: "operativo", categoriaElegida: true, nueva: false,
    monto: "95", moneda: "USD", tipoCambio: "1.450", proveedor: "Estudio Ríos", recurrente: true, copiadoDe: "g_viejo",
  });
  assert.ok(!("fecha" in c) && !("webinarId" in c) && !("notas" in c), "la fecha, el webinar y las notas son de esa vez");
  assert.equal(modoDeCarga({ editando: false, copiadoDe: c.copiadoDe }), "repetir");
});

test("al repetir un gasto en pesos van los pesos, con el tipo de cambio de hoy y no el de ese día", () => {
  const g = gasto({
    id: "g_ars", monto: 100, extra: { montoOriginal: 145000, monedaOriginal: "ARS", tipoCambio: 1450 },
  });
  const c = cambiosAlRepetir(g, "1.580");
  assert.equal(c.monto, "145000");
  assert.equal(c.moneda, "ARS");
  assert.equal(c.tipoCambio, "1.580");
});

test("un gasto sin proveedor (los de la planilla) se repite y pide el proveedor en la revisión", () => {
  const g = gasto({ id: "g_pl", concepto: "Equipo / Salarios (No comercial)", categoria: "Equipo / Salarios", monto: 3357 });
  const b = { ...borradorInicial(AJUSTES, null, new Date(2026, 9, 7)), ...cambiosAlRepetir(g, "1.450") };
  assert.equal(b.proveedor, "");
  assert.equal(problemaDelPaso("revisar", b, "USD"), MENSAJE_PROVEEDOR);
  assert.equal(problemaDelPaso("revisar", { ...b, proveedor: "Zoe Álvarez" }, "USD"), null);
});

test("el caso de Angelo: escribe «Equipo / Salarios (No comercial)», elige el gasto parecido y queda en una pantalla", () => {
  const planilla = gasto({
    id: "gas_ef_202601_equipo", concepto: "Equipo / Salarios (No comercial)", categoria: "Equipo / Salarios",
    monto: 3357, fecha: "2026-01-01T12:00:00.000Z", recurrente: true,
  });
  const e = estado([planilla, ...GASTOS]);
  const escrito = "Equipo / Salarios (No comercial)";

  /* Al escribir se le ofrece el parecido y la categoría ya se sugiere. */
  assert.deepEqual(gastosParecidos(escrito, e).map((g) => g.id), ["gas_ef_202601_equipo"]);
  assert.equal(sugerirCategoria(escrito, e)?.categoria, "Equipo / Salarios");

  /* Elige el parecido: salta a la revisión, sin volver a preguntar la categoría ni el monto. */
  let b: BorradorGasto = { ...borradorInicial(e.ajustes, null, new Date(2026, 9, 7)), concepto: escrito };
  b = { ...b, ...cambiosAlRepetir(planilla, tipoCambioDeAjustes(e.ajustes)) };
  assert.deepEqual(pasosDeCarga(modoDeCarga({ editando: false, copiadoDe: b.copiadoDe })).map((p) => p.id), ["concepto", "revisar"]);
  assert.equal(b.categoria, "Equipo / Salarios");
  assert.equal(b.grupo, "operativo");
  assert.equal(b.monto, "3357");
  assert.equal(b.moneda, "USD");
  assert.equal(mostrarGrilla(b.categoria, false), false, "la categoría se ve como tarjeta, no como grilla de costos directos");

  /* Falta el proveedor, y como son sueldos la lista empieza por el equipo. */
  assert.equal(problemaDelPaso("revisar", b, "USD"), MENSAJE_PROVEEDOR);
  const opciones = opcionesProveedor(e, b.categoria, b.grupo);
  assert.equal(opciones[0].grupo, "equipo");

  /* Elige a alguien del equipo (aunque lo escriba a su manera) y se puede cargar. */
  b = { ...b, proveedor: "zoe alvarez" };
  assert.equal(problemaDelPaso("revisar", b, "USD"), null);
  const datos = datosDelGasto(b, { base: "USD", opciones, ahora: "2026-10-07T15:00:00.000Z" });
  assert.equal(datos.proveedor, "Zoe Álvarez");
  assert.equal(equipoDeGasto(datos), "eq_zoe");
  assert.equal(datos.categoria, "Equipo / Salarios");
  assert.equal(datos.monto, 3357);
  assert.equal(datos.recurrente, true);
});

/* ---------- Lo que se guarda ---------- */

test("un gasto nuevo en dólares se guarda como se cargó, con el proveedor", () => {
  const e = estado();
  const b = completo({ proveedor: "Estudio Ríos", monto: "1.234,50", notas: "  septiembre  " });
  const d = datosDelGasto(b, { base: "USD", opciones: opcionesProveedor(e, b.categoria), ahora: "2026-10-07T15:00:00.000Z" });
  assert.equal(d.concepto, "Contador de septiembre");
  assert.equal(d.categoria, "Contador");
  assert.equal(d.grupo, "operativo");
  assert.equal(d.monto, 1234.5);
  assert.equal(d.moneda, "USD");
  assert.equal(d.proveedor, "Estudio Ríos", "un proveedor nuevo queda como se escribió");
  assert.equal(d.notas, "septiembre");
  assert.equal(d.creadoEn, "2026-10-07T15:00:00.000Z");
  assert.deepEqual(d.extra, {}, "sin pesos, sin embudo y sin ser del equipo no hay nada más que anotar");
});

test("lo pagado a alguien del equipo deja anotado quién es, en extra: el proveedor sigue siendo el nombre", () => {
  const e = estado();
  const b = completo({ categoria: "Equipo / Salarios", proveedor: "Zoe Álvarez" });
  const d = datosDelGasto(b, { base: "USD", opciones: opcionesProveedor(e, b.categoria) });
  assert.equal(typeof d.proveedor, "string");
  assert.equal(d.proveedor, "Zoe Álvarez");
  assert.deepEqual(d.extra, { proveedorEquipoId: "eq_zoe" });
});

test("un gasto en pesos se guarda convertido, con lo que se pagó de verdad al lado", () => {
  const b = completo({ moneda: "ARS", monto: "145.000", tipoCambio: "1.450" });
  const d = datosDelGasto(b, { base: "USD", opciones: [] });
  assert.equal(d.monto, 100);
  assert.equal(d.moneda, "USD");
  assert.deepEqual(d.extra, { montoOriginal: 145000, monedaOriginal: "ARS", tipoCambio: 1450 });
});

test("el monto convertido se redondea a centavos", () => {
  const d = datosDelGasto(completo({ moneda: "ARS", monto: "100.000", tipoCambio: "1.580" }), { base: "USD", opciones: [] });
  assert.equal(d.monto, 63.29);
});

test("un gasto de un webinar y de un embudo los lleva", () => {
  const d = datosDelGasto(completo({ webinarId: "w1", embudoId: "emb_webinar" }), { base: "USD", opciones: [] });
  assert.equal(d.webinarId, "w1");
  assert.deepEqual(d.extra, { embudoId: "emb_webinar" });
});

test("al editar un gasto en pesos se vuelve a ver en pesos, con su tipo de cambio, y se guarda igual", () => {
  const previo = gasto({
    id: "g_ars", proveedor: "Contadora", monto: 100, webinarId: "w1",
    extra: { origen: "planilla-angelo", montoOriginal: 145000, monedaOriginal: "ARS", tipoCambio: 1450 },
  });
  const b = borradorInicial({ monedaBase: "USD", tipoCambio: 1600 }, previo);
  assert.equal(b.monto, "145000");
  assert.equal(b.moneda, "ARS");
  assert.equal(b.tipoCambio, "1450", "el de ese gasto, no el de Ajustes");
  assert.equal(b.proveedor, "Contadora");
  assert.equal(b.webinarId, "w1");
  assert.equal(b.categoriaElegida, true);
  assert.equal(problemaDelPaso("revisar", b, "USD"), null);

  const d = datosDelGasto(b, { base: "USD", previo, opciones: [] });
  assert.equal(d.monto, 100);
  assert.equal(d.creadoEn, previo.creadoEn);
  assert.deepEqual(d.extra, { origen: "planilla-angelo", montoOriginal: 145000, monedaOriginal: "ARS", tipoCambio: 1450 });
});

test("al editar, lo que se vació viaja como null para que la base lo borre, y el resto del extra se conserva", () => {
  const previo = gasto({
    id: "g_ed", proveedor: "Zoe Álvarez", webinarId: "w1", notas: "vieja",
    extra: { origen: "planilla-angelo", liquidacionId: "liq_2026-09", embudoId: "emb_x", proveedorEquipoId: "eq_zoe" },
  });
  const b = { ...borradorInicial(AJUSTES, previo), webinarId: "", notas: "", embudoId: "", proveedor: "Estudio Ríos" };
  const d = datosDelGasto(b, { base: "USD", previo, opciones: opcionesProveedor(estado(), "Software") });
  assert.equal(d.webinarId as unknown, null);
  assert.equal(d.notas as unknown, null);
  assert.equal(d.proveedor, "Estudio Ríos");
  /* Ya no es de Zoe ni de un embudo; lo que no maneja el asistente queda. */
  assert.deepEqual(d.extra, { origen: "planilla-angelo", liquidacionId: "liq_2026-09" });
  assert.equal(equipoDeGasto(d), undefined);
});

test("un gasto nuevo sin webinar ni notas no manda null: no hay nada que borrar", () => {
  const d = datosDelGasto(completo(), { base: "USD", opciones: [] });
  assert.equal(d.webinarId, undefined);
  assert.equal(d.notas, undefined);
});

test("el borrador de un gasto nuevo arranca vacío, en la moneda base y con el tipo de cambio de Ajustes", () => {
  const b = borradorInicial(AJUSTES, null, new Date(2026, 9, 7));
  assert.equal(b.concepto, "");
  assert.equal(b.categoria, "");
  assert.equal(b.proveedor, "");
  assert.equal(b.moneda, "USD");
  assert.equal(b.tipoCambio, "1450");
  assert.equal(b.categoriaElegida, false);
  assert.equal(b.fecha, new Date(2026, 9, 7, 12).toISOString(), "mediodía: la fecha no se corre de día con el huso");
  assert.equal(tipoCambioDeAjustes({ tipoCambio: 0 }), "");
});

test("a quién del equipo se le pagó se lee de extra", () => {
  assert.equal(equipoDeGasto({ extra: { proveedorEquipoId: "eq_zoe" } }), "eq_zoe");
  assert.equal(equipoDeGasto({ extra: {} }), undefined);
  assert.equal(equipoDeGasto({ extra: { proveedorEquipoId: 7 } }), undefined);
  assert.equal(equipoDeGasto({}), undefined);
});
