/* Estrés del almacén, frente 4: cargarDeLaNube con una base que no está completa o que es grande.

   - Cada tabla opcional que falta (TABLAS_OPCIONALES, tablaFaltante) se saltea: la app carga, marca la tabla como «sin crear»
     y la colección queda vacía (o con los valores de siempre); todas las demás se cargan enteras. También con todas faltando a la vez.
   - Una tabla obligatoria que falla corta la carga con un error claro y no pisa la memoria.
   - La paginación de 1000 en 1000 (PostgREST corta en silencio): 999, 1000, 1001, 2000 y 2500 filas llegan enteras.
   - Los dueños ven honorarios y liquidaciones; los demás reciben vacío (RLS) sin error.
   - Lo que falla: lo que se cargó sólo en este navegador de una tabla que no existe en la base no sobrevive a la recarga. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarHasta, instalar } from "./_nube";
import { instalarNavegador } from "./_navegador";
import { conDemo, estadoDe } from "./_escenas";
void conDemo;
import { storeNuevo } from "./_fresco";
import { claveDe } from "./_modelo";
import { TABLAS, TABLAS_OPCIONALES } from "@/lib/supabase";
import { TIPOS_POR_DEFECTO } from "@/lib/permisos";
import type { E } from "./_acciones";

const almacen = instalarNavegador();
const base = new BaseFalsa();
instalar(base);

/* La demo se siembra una sola vez; cada prueba vuelve a esa foto (sembrar cuesta casi medio segundo). */
const S0 = await conDemo(base);
const FOTO = base.foto();
const demo = () => { base.restaurar(FOTO); almacen.clear(); };

/* Con la tabla ausente, lo que la app deja en esa colección (no siempre vacío: hay catálogos de siempre). */
const SI_FALTA: Record<string, (e: E) => void> = {
  etapas_servicio: (e) => assert.ok(e.etapasServicio.length > 0, "etapas_servicio vacía: el pipeline de alumnos usa las etapas de siempre"),
  tipos_cuenta: (e) => assert.deepEqual(e.tiposCuenta.map((t: E) => t.id), TIPOS_POR_DEFECTO.map((t) => t.id), "tipos_cuenta vacía: los tipos de siempre"),
};

for (const tabla of [...TABLAS_OPCIONALES].sort()) {
  test(`la tabla opcional «${tabla}» no existe en la base: la app carga igual y el resto llega entero`, async () => {
    demo();
    base.existentes = new Set(base.tablas.keys());
    base.existentes.delete(tabla);
    const R = await storeNuevo();
    await R.cargarDeLaNube();
    assert.equal(R.estadoSync(), "listo", R.errorSync());
    assert.ok(R.tablaSinCrear(tabla), "no quedó marcada como sin crear");
    const e = estadoDe(R);
    const clave = claveDe(tabla);
    if (SI_FALTA[tabla]) SI_FALTA[tabla](e);
    else assert.deepEqual(e[clave] ?? [], [], `${clave} tendría que quedar vacía`);
    /* Todas las demás colecciones cargadas se parecen a las de la base: mismo largo (sin contar la actividad, que se recorta). */
    for (const t of TABLAS.filter((x) => x !== tabla && x !== "actividad" && !TABLAS_OPCIONALES.has(x))) {
      assert.equal((e[claveDe(t)] ?? []).length, base.tabla(t).size, `${t}: se cargó incompleta`);
    }
  });
}

test("todas las tablas opcionales faltan a la vez (una base de la primera versión del modelo)", async () => {
  demo();
  base.existentes = new Set([...base.tablas.keys()].filter((t) => !TABLAS_OPCIONALES.has(t)));
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.equal(R.estadoSync(), "listo", R.errorSync());
  const e = estadoDe(R);
  for (const t of TABLAS_OPCIONALES) assert.ok(R.tablaSinCrear(t), `${t} no quedó marcada`);
  for (const t of TABLAS.filter((x) => !TABLAS_OPCIONALES.has(x) && x !== "actividad")) assert.equal(e[claveDe(t)].length, base.tabla(t).size, `${t} incompleta`);
  for (const k of ["devoluciones", "arqueos", "traspasos", "comentarios", "contactos", "seguimientos", "testimonios", "gastosRecurrentes", "honorarios", "liquidaciones", "movimientos"]) {
    assert.ok(Array.isArray(e[k]), `${k} no es una lista`);
  }
});

test("una tabla obligatoria que falta corta la carga con un error que la nombra y no pisa lo que ya había en memoria", async () => {
  demo();
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  const antes = estadoDe(R).ventas.length;
  assert.ok(antes > 0);
  base.existentes = new Set([...base.tablas.keys()].filter((t) => t !== "ventas"));
  R.reiniciarCarga();
  await R.cargarDeLaNube();
  assert.equal(R.estadoSync(), "error");
  assert.match(R.errorSync(), /ventas/);
  assert.equal(estadoDe(R).ventas.length, antes, "la memoria queda como estaba");
});

test("una falla en la segunda página de una tabla grande corta la carga entera (no queda una tabla a medias)", async () => {
  demo();
  const filas = Array.from({ length: 1500 }, (_x, i) => ({ id: `pag_x${i}`, cuotaId: "cuo_0001", monto: 1, moneda: "USD", feeRate: 0, feeMonto: 0, fecha: "2026-10-01T00:00:00.000Z", creadoEn: "2026-10-01T00:00:00.000Z" }));
  base.poner("pagos", filas);
  /* (500 y no 503: el cliente de supabase reintenta los GET que dan 503 o 520, con esperas de 1, 2 y 4 segundos.) */
  base.falla = (p) => (p.tipo === "select" && p.tabla === "pagos" && /offset=1000/.test(p.url) ? { status: 500, body: { code: "XX000", message: "cortó" } } : null);
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.equal(R.estadoSync(), "error");
  assert.match(R.errorSync(), /pagos: cortó/);
  assert.notEqual(estadoDe(R).pagos.length, 1000, "no se queda con la primera página como si fuera todo");
});

for (const n of [999, 1000, 1001, 2000, 2500]) {
  test(`una tabla con ${n} filas se carga entera (PostgREST corta en 1000 y no avisa)`, async () => {
    demo();
    base.tabla("reportes").clear();
    base.poner("reportes", Array.from({ length: n }, (_x, i) => ({ id: `rep_g${i}`, alumnoId: "alu_0001", semanaDel: "2026-10-05T00:00:00.000Z", estado: "completado" })));
    base.log = [];
    const R = await storeNuevo();
    await R.cargarDeLaNube();
    assert.equal(R.estadoSync(), "listo", R.errorSync());
    assert.equal(estadoDe(R).reportes.length, n);
    const pedidos = base.peticiones("select", "reportes").length;
    assert.equal(pedidos, Math.floor(n / 1000) + 1, "una página más cuando la última viene incompleta (o vacía)");
  });
}

test("los dueños cargan honorarios y liquidaciones; el resto recibe vacío sin error (RLS)", async () => {
  demo();
  const S1 = await storeNuevo();
  await S1.cargarDeLaNube();
  const m = estadoDe(S1).equipo[0];
  S1.acciones.guardarEsquema({ id: `hon_${m.id}`, miembroId: m.id, conceptos: [], categoriaGasto: "Equipo", actualizadoEn: "" } as never, "yo");
  S1.acciones.agregarExtraLiquidacion("2026-10", { id: "ext_1", miembroId: m.id, concepto: "x", monto: 1, moneda: "USD" });
  await esperarHasta(() => S1.estadoSync() !== "guardando", 15000);
  const dueno = await storeNuevo();
  await dueno.cargarDeLaNube();
  assert.equal(estadoDe(dueno).honorarios.length, 1);
  assert.equal(estadoDe(dueno).liquidaciones.length, 1);
  /* Para quien no es dueño la base devuelve esas tablas vacías. */
  const copia = new Map([...base.tabla("honorarios")]);
  const copiaL = new Map([...base.tabla("liquidaciones")]);
  base.tabla("honorarios").clear(); base.tabla("liquidaciones").clear();
  base.esDueno = false;
  base.log = [];
  const otro = await storeNuevo();
  await otro.cargarDeLaNube();
  assert.equal(otro.estadoSync(), "listo", otro.errorSync());
  assert.deepEqual([estadoDe(otro).honorarios, estadoDe(otro).liquidaciones], [[], []]);
  assert.equal(base.peticiones("upsert").length, 0, "un no-dueño con la base cargada no escribe nada al abrir");
  void copia; void copiaL;
});

test("las colecciones salen ordenadas como las pantallas las esperan (actividad nueva primero, chat y arqueos de viejo a nuevo)", async () => {
  demo();
  base.poner("comentarios", [
    { id: "c3", contactoId: "x", autor: "a", texto: "3", creadoEn: "2026-10-03T00:00:00.000Z" },
    { id: "c1", contactoId: "x", autor: "a", texto: "1", creadoEn: "2026-10-01T00:00:00.000Z" },
    { id: "c2", contactoId: "x", autor: "a", texto: "2", creadoEn: "2026-10-02T00:00:00.000Z" },
  ]);
  base.poner("actividad", [
    { id: "a1", entidad: "config", entidadId: "x", titulo: "1", accion: "creo", detalle: "", actor: "x", fecha: "2020-01-01T00:00:00.000Z" },
    { id: "a9", entidad: "config", entidadId: "x", titulo: "9", accion: "creo", detalle: "", actor: "x", fecha: "2029-01-01T00:00:00.000Z" },
  ]);
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.deepEqual(estadoDe(R).comentarios.map((c: E) => c.id), ["c1", "c2", "c3"]);
  assert.equal(estadoDe(R).actividad[0].id, "a9");
});

test("dos cargas a la vez no duplican los pedidos; después de reiniciarCarga se vuelve a cargar", async () => {
  demo();
  base.log = [];
  const R = await storeNuevo();
  await Promise.all([R.cargarDeLaNube(), R.cargarDeLaNube(), R.cargarDeLaNube()]);
  const unaCarga = base.peticiones("select").length;
  assert.equal(base.peticiones("select", "etapas").length, 1, "una sola carga");
  R.reiniciarCarga();
  await R.cargarDeLaNube();
  assert.equal(base.peticiones("select").length, unaCarga * 2);
});

test("una escritura que la base rechaza por permisos vuelve a traer todo cuando la cola se vació, y la pantalla muestra lo que de verdad quedó", async () => {
  demo();
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  const venta = estadoDe(R).ventas[0];
  const closer = TIPOS_POR_DEFECTO.find((t) => t.id === "closer")!;
  /* No se le avisa al store quién es (decide la base): el UPDATE sale y la base lo rechaza con 42501. */
  base.puedeEscribir = (t) => t !== "ventas";
  R.acciones.actualizar("ventas", venta.id, { notas: "no tiene permiso" } as never, "x");
  assert.equal(estadoDe(R).ventas.find((v: E) => v.id === venta.id).notas, "no tiene permiso", "en memoria se ve al instante");
  const revertida = await esperarHasta(() => estadoDe(R).ventas.find((v: E) => v.id === venta.id).notas !== "no tiene permiso");
  assert.equal(R.estadoSync(), "listo", R.errorSync());
  assert.ok(revertida, "después de la recarga, la pantalla tendría que decir lo que quedó en la base");
  void closer;
});

test("la recarga que sigue a una escritura negada espera a que la cola esté vacía (no pisa con la base lo que todavía no le llegó)", async () => {
  demo();
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  const e = estadoDe(R);
  base.puedeEscribir = (t) => t !== "ventas";
  /* Una escritura buena que tarda y una negada: la recarga no puede llegar antes que la buena. */
  let soltar!: () => void;
  R.acciones.actualizar("ventas", e.ventas[0].id, { notas: "negada" } as never, "x");
  base.compuerta = new Promise<void>((r) => { soltar = r; });
  R.acciones.actualizar("leads", e.leads[0].id, { notas: "buena y lenta" } as never, "x");
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(estadoDe(R).leads.find((l: E) => l.id === e.leads[0].id).notas, "buena y lenta", "mientras la cola tiene algo, no se pisa la memoria");
  base.compuerta = null;
  soltar();
  await esperarHasta(() => base.tabla("leads").get(e.leads[0].id)?.notas === "buena y lenta");
  await new Promise((r) => setTimeout(r, 600));   // y que dé tiempo a la recarga que sigue (400 ms)
  assert.equal(base.tabla("leads").get(e.leads[0].id)!.notas, "buena y lenta");
  assert.equal(estadoDe(R).leads.find((l: E) => l.id === e.leads[0].id).notas, "buena y lenta");
});

/* ---------- Lo que falla ---------- */

test("lo que se cargó sólo en este navegador de una tabla que la base todavía no tiene sigue ahí después de recargar", { todo: true }, async () => {
  /* BUG: los comentarios de supabase.ts (TABLAS_OPCIONALES), de los SQL (gastos-recurrentes.sql, customer-success.sql, arqueos.sql…) y
     del README dicen que, sin la tabla, lo que se carga «queda en este navegador». Pero cargarDeLaNube() reemplaza el estado entero:
     para una tabla que falta pone `porTabla.x ?? []` y guarda eso, también en la copia del navegador. La primera recarga borra lo que
     sólo vivía acá (arqueos, plantillas de gastos fijos, seguimiento, testimonios, devoluciones, traspasos, el chat de la ficha).
     Para las devoluciones la app avisa al cargarlas; para el resto no avisa nada. */
  demo();
  base.existentes = new Set([...base.tablas.keys()].filter((t) => t !== "arqueos" && t !== "gastos_recurrentes"));
  const A = await storeNuevo();
  await A.cargarDeLaNube();
  A.acciones.guardarArqueo({ id: "arq_local", fecha: "2026-10-05T12:00:00.000Z", saldos: [], total: 100, creadoEn: "2026-10-05T12:00:00.000Z" } as never);
  A.acciones.guardarGastoRecurrente({ id: "rec_local", concepto: "Local", categoria: "Software", grupo: "operativo", monto: 10, moneda: "USD", diaDelMes: 3, activo: true, desde: "2026-10", salteados: [], creadoEn: "2026-10-01T00:00:00.000Z" } as never);
  await esperarHasta(() => A.estadoSync() !== "guardando", 15000);
  assert.ok(A.tablaSinCrear("arqueos") && A.tablaSinCrear("gastos_recurrentes"));
  /* Se recarga la página: el store nuevo abre con la copia local y después trae la base. */
  const B = await storeNuevo();
  assert.deepEqual(estadoDe(B).arqueos.map((x: E) => x.id), ["arq_local"], "la copia local tiene el arqueo (se ve al abrir)");
  await B.cargarDeLaNube();
  assert.deepEqual(estadoDe(B).arqueos.map((x: E) => x.id), ["arq_local"], "después de traer la base, el arqueo local desapareció");
  assert.deepEqual(estadoDe(B).gastosRecurrentes.map((x: E) => x.id), ["rec_local"]);
});

test("volver a llamar a cargarDeLaNube() después de la primera carga trae lo que cambió en la base (como hace Ajustes → Formularios de Meta al traer inscripciones)", { todo: true }, async () => {
  /* BUG: components/ajustes/FormulariosMeta.tsx, después de que el servidor escribe las inscripciones nuevas, hace `await cargarDeLaNube()` y avisa
     «Entraron N inscripciones». Pero cargarDeLaNube() sale en la primera línea si `yaCargo` (la guarda que evita la doble carga de React),
     y sólo reiniciarCarga() la baja: el Shell y resincronizarAlVaciarse() llaman a las dos, FormulariosMeta sólo a una. Resultado: la llamada no hace
     nada y los leads nuevos no aparecen hasta que se recarga la página. */
  demo();
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  const antes = estadoDe(R).leads.length;
  /* El servidor (el webhook de Meta) escribe un lead y su contacto directo en la base. */
  base.poner("contactos", [{ id: "lead_meta_1", nombre: "Desde Meta", email: "meta@ejemplo.test", creadoEn: "2026-10-07T12:00:00.000Z", extra: {} }]);
  base.poner("leads", [{ id: "lead_meta_1", contactoId: "lead_meta_1", nombre: "Desde Meta", email: "meta@ejemplo.test", fuente: "Meta Ads", etapaId: estadoDe(R).etapas[0].id, monto: 0, moneda: "USD", responsable: "x", etiquetas: [], creadoEn: "2026-10-07T12:00:00.000Z", actualizadoEn: "2026-10-07T12:00:00.000Z", extra: {} }]);
  await R.cargarDeLaNube();
  assert.equal(estadoDe(R).leads.length, antes + 1, "el lead que entró por Meta no se ve después de «volver a cargar»");
});

test("un cambio hecho mientras todavía se está cargando la base no desaparece de la pantalla cuando termina la carga", { todo: true }, async () => {
  /* BUG: la mayoría de las pantallas no esperan a que termine la carga (sólo Equipo, Webinars y Mis llamadas miran el estado «cargando»).
     cargarDeLaNube() reemplaza la memoria entera con lo que leyó de la base, sin sumarle lo que se hizo mientras tanto: la escritura sale
     igual por la cola y llega a la base, pero la pantalla deja de mostrarlo hasta la próxima recarga. */
  demo();
  const R = await storeNuevo();
  let soltar!: () => void;
  base.compuerta = new Promise<void>((r) => { soltar = r; });
  const carga = R.cargarDeLaNube();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(R.estadoSync(), "cargando");
  const id = R.acciones.crear("metas", { nombre: "Hecha durante la carga", metrica: "ingresos", objetivo: 1, unidad: "cantidad", periodo: "2026-10", creadoEn: "2026-10-07T12:00:00.000Z" } as never, "m");
  base.compuerta = null;
  soltar();
  await carga;
  await esperarHasta(() => R.estadoSync() !== "guardando", 15000);
  assert.ok(base.tabla("metas").has(id), "la escritura sí llegó a la base");
  assert.ok(estadoDe(R).metas.some((m: E) => m.id === id), "pero ya no está en pantalla");
});
