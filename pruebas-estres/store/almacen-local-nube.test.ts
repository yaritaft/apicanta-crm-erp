/* Estrés del almacén, frente 3: la copia que el navegador guarda cuando hay nube (apicanta.erp.nube.v1).

   Sirve para dibujar al instante al abrir mientras llega la base. Tiene que:
   - no llevar lo que sólo ven los dueños (honorarios, liquidaciones) ni los anuncios de Meta (pesan más de la mitad);
   - no pasarse del tope (si el estado no entra, mejor ninguna copia que una vieja);
   - no romper la app si el navegador no deja escribir (cuota llena, modo privado);
   - borrarse al salir y no volver a escribirse hasta recargar;
   - leerse completando lo que le falte (una copia de una versión anterior), sin tirar la app si está rota. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { instalarNavegador } from "./_navegador";
import { conDemo, estadoDe } from "./_escenas";
import { storeNuevo } from "./_fresco";
import type { E } from "./_acciones";

const almacen = instalarNavegador();
const base = new BaseFalsa();
instalar(base);
const CLAVE_NUBE = "apicanta.erp.nube.v1";
const CLAVE_VIEJA = "apicanta.erp.v1";

const S0 = await conDemo(base);
const FOTO = base.foto();
void S0;
const copia = (): E | null => { const t = almacen.datos.get(CLAVE_NUBE); return t ? JSON.parse(t) : null; };
const nuevo = async () => { base.restaurar(FOTO); almacen.clear(); const S = await storeNuevo(); await S.cargarDeLaNube(); return S; };

test("la copia local no lleva honorarios ni liquidaciones ni los anuncios de Meta (aunque estén en memoria)", async () => {
  const S = await nuevo();
  const m = estadoDe(S).equipo[0];
  S.acciones.guardarEsquema({ id: `hon_${m.id}`, miembroId: m.id, conceptos: [{ id: "c", tipo: "fijo", nombre: "Sueldo", moneda: "USD", monto: 5000 }], categoriaGasto: "Equipo", actualizadoEn: "" } as never, "yo");
  S.acciones.agregarExtraLiquidacion("2026-10", { id: "ext_1", miembroId: m.id, concepto: "Adelanto", monto: -100, moneda: "USD" });
  S.acciones.importarMeta({ campaigns: [{ id: "c1", nombre: "C", objetivo: "L", estado: "ACTIVE" }], adsets: [{ id: "s1", campaignId: "c1", nombre: "S", estado: "ACTIVE" }], ads: [{ id: "a1", adsetId: "s1", campaignId: "c1", nombre: "A", estado: "ACTIVE" }], insights: [{ adId: "a1", dia: "2026-10-01", inversion: 1, impresiones: 1, clicks: 1, leads: 1, alcance: 1, frecuencia: 1, ctr: 1, cpm: 1, cpc: 1, clicksEnlace: 1, ctrEnlace: 1, costoPorClickEnlace: 1, acciones: {} }] } as never);
  await esperarCola(S.estadoSync);
  assert.equal(estadoDe(S).honorarios.length, 1, "en memoria están");
  const c = copia()!;
  for (const k of ["honorarios", "liquidaciones", "campaigns", "adsets", "ads", "adInsights"]) assert.deepEqual(c[k], [], `la copia local lleva ${k}`);
  assert.ok(!almacen.datos.get(CLAVE_NUBE)!.includes("Sueldo"), "el sueldo quedó escrito en el navegador");
  assert.ok(!almacen.datos.has(CLAVE_VIEJA), "la clave de la copia de antes (sin nube) no se escribe");
});

test("lo demás de la copia coincide con lo que hay en memoria (nunca una copia atrasada de una acción)", async () => {
  const S = await nuevo();
  for (let i = 0; i < 6; i++) S.acciones.actualizar("leads", estadoDe(S).leads[i].id, { notas: `nota ${i} ñ` } as never, "x");
  S.acciones.altaDeLead({ nombre: "Nuevo", email: "nuevo@ejemplo.test", fuente: "Webinar", etapaId: estadoDe(S).etapas[0].id, monto: 1, moneda: "USD", responsable: "x", etiquetas: [], creadoEn: "2026-10-07T00:00:00.000Z", actualizadoEn: "2026-10-07T00:00:00.000Z", extra: {} } as never, "Nuevo");
  await esperarCola(S.estadoSync);
  const e = estadoDe(S), c = copia()!;
  for (const k of Object.keys(e).filter((x) => !["honorarios", "liquidaciones", "campaigns", "adsets", "ads", "adInsights"].includes(x))) assert.deepEqual(c[k], e[k], `la copia de ${k} no es la de memoria`);
});

test("un estado que no entra en el tope (4 MB) no deja ninguna copia: mejor sin copia que con una vieja", async () => {
  const S = await nuevo();
  assert.ok(copia(), "antes de pasarse hay copia");
  const l = estadoDe(S).leads[0];
  S.acciones.actualizar("leads", l.id, { notas: "x".repeat(4_200_000) } as never, "x");
  assert.equal(almacen.datos.get(CLAVE_NUBE), undefined, "quedó una copia vieja en el navegador");
  /* y al achicarse vuelve a haber copia */
  S.acciones.actualizar("leads", l.id, { notas: "chica" } as never, "x");
  assert.ok(copia());
  await esperarCola(S.estadoSync);
});

test("si el navegador no deja escribir (cuota llena), la app sigue y no deja una copia a medias", async () => {
  const S = await nuevo();
  almacen.tope = 10;
  const l = estadoDe(S).leads[1];
  assert.doesNotThrow(() => S.acciones.actualizar("leads", l.id, { notas: "con la cuota llena" } as never, "x"));
  await esperarCola(S.estadoSync);
  assert.equal(estadoDe(S).leads.find((x: E) => x.id === l.id).notas, "con la cuota llena", "en memoria está");
  assert.equal(base.tabla("leads").get(l.id)!.notas, "con la cuota llena", "y en la base");
  assert.equal(almacen.datos.get(CLAVE_NUBE), undefined, "se borró la copia en vez de dejar una vieja");
  almacen.tope = null;
});

test("en modo privado (localStorage que lanza en todo) la app abre, guarda y carga igual", async () => {
  base.restaurar(FOTO);
  almacen.clear();
  almacen.roto = true;
  try {
    const S = await storeNuevo();
    await S.cargarDeLaNube();
    assert.equal(S.estadoSync(), "listo", S.errorSync());
    assert.doesNotThrow(() => S.acciones.actualizar("leads", estadoDe(S).leads[0].id, { notas: "privado" } as never, "x"));
    await esperarCola(S.estadoSync);
    assert.doesNotThrow(() => S.olvidarCopiaLocal());
    assert.equal(base.tabla("leads").get(estadoDe(S).leads[0].id)!.notas, "privado");
  } finally { almacen.roto = false; }
});

test("al salir se borra la copia y no se vuelve a escribir hasta recargar la página", async () => {
  const S = await nuevo();
  assert.ok(copia());
  S.olvidarCopiaLocal();
  assert.equal(copia(), null);
  S.acciones.actualizar("leads", estadoDe(S).leads[0].id, { notas: "otro usuario" } as never, "x");
  await esperarCola(S.estadoSync);
  assert.equal(copia(), null, "lo que vio esta sesión no tiene que quedar para el que entre después");
  /* recargar la página = un store nuevo: vuelve a escribir */
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  R.acciones.ajustesSilencioso({ tourVisto: true } as never);
  assert.ok(copia());
});

test("abrir con una copia de antes: se borra la clave vieja (sin nube), se completan las colecciones nuevas y los sueldos que traía se reescriben afuera", async () => {
  base.restaurar(FOTO);
  almacen.clear();
  const demo = estadoDe(S0);
  const vieja = JSON.parse(JSON.stringify(demo));
  for (const k of ["devoluciones", "arqueos", "traspasos", "comentarios", "tiposCuenta", "etapasServicio"]) delete vieja[k];
  vieja.honorarios = [{ id: "hon_x", miembroId: "eq_yari", conceptos: [{ id: "c", tipo: "fijo", nombre: "SUELDO SECRETO", moneda: "USD", monto: 9999 }], categoriaGasto: "x", actualizadoEn: "" }];
  vieja.liquidaciones = [{ id: "liq_2026-09", periodo: "2026-09", estado: "abierta", entradas: {}, extras: [], pagos: {}, gastoIds: [], creadoEn: "2026-09-01" }];
  almacen.datos.set(CLAVE_NUBE, JSON.stringify(vieja));
  almacen.datos.set(CLAVE_VIEJA, JSON.stringify(demo));
  const S = await storeNuevo();
  const e = estadoDe(S);
  assert.ok(!almacen.datos.has(CLAVE_VIEJA), "la copia vieja sin nube se borra: tenía la demo");
  for (const k of ["devoluciones", "arqueos", "traspasos", "comentarios"]) assert.ok(Array.isArray(e[k]), `${k} no es una lista`);
  assert.deepEqual([e.honorarios, e.liquidaciones], [[], []], "los sueldos de la copia vieja no se leen");
  assert.ok(!almacen.datos.get(CLAVE_NUBE)!.includes("SUELDO SECRETO"), "y se reescribe la copia sin ellos");
});

test("una copia rota (JSON inválido) no tira la app: abre vacía y carga la base", async () => {
  base.restaurar(FOTO);
  almacen.clear();
  almacen.datos.set(CLAVE_NUBE, "{no es json");
  const S = await storeNuevo();
  assert.equal(estadoDe(S).leads.length, 0, "con la nube arranca vacía: la demo se vería como si fueran personas del equipo");
  await S.cargarDeLaNube();
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.ok(estadoDe(S).leads.length > 0);
});

test("la copia con las etapas vacías no pisa las de siempre (sin etapas no se puede dibujar el pipeline)", async () => {
  base.restaurar(FOTO);
  almacen.clear();
  const demo = JSON.parse(JSON.stringify(estadoDe(S0)));
  demo.etapas = [];
  almacen.datos.set(CLAVE_NUBE, JSON.stringify(demo));
  const S = await storeNuevo();
  assert.ok(estadoDe(S).etapas.length > 0);
});
