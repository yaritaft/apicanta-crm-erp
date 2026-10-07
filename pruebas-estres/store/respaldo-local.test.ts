/* Estrés del almacén, frente 3: exportar un respaldo y volver a importarlo es la identidad (sin nube).

   - La demo: exportar → importar → exportar es un punto fijo.
   - Estados al azar con datos raros (acentos, comillas, emoji, textos largos, decimales, ceros, negativos, números enormes):
     lo que se importa es lo que se exporta, colección por colección. La única diferencia permitida es la que el código dice
     a propósito: un respaldo viejo trae leads sin contacto, y importar les crea el suyo (asignarContactos).
   - Respaldos de versiones anteriores (faltan colecciones): se completan y todas las listas son listas.
   - Un respaldo roto no toca nada.
   - Lo que se guarda en el navegador se lee igual al volver a abrir. */
import test from "node:test";
import assert from "node:assert/strict";
import { instalarNavegador } from "./_navegador";
import { storeNuevo } from "./_fresco";
import { azar, porJson } from "./_aleatorio";
import { estadoAzar } from "./_estado-azar";
import type { E } from "./_acciones";

const almacen = instalarNavegador();
const CLAVE = "apicanta.erp.v1";
/* Las colecciones que el estado siempre tiene como lista (las que types.ts no marca opcionales). */
const LISTAS = ["etapas", "etapasServicio", "tiposCuenta", "leads", "sesiones", "webinars", "alumnos", "reportes", "contactos", "campanias", "campaigns", "adsets", "ads",
  "adInsights", "metas", "campos", "actividad", "productos", "procesadores", "embudos", "equipo", "ventas", "cuotas", "pagos", "gastos", "movimientos", "comentarios",
  "honorarios", "liquidaciones", "arqueos", "traspasos", "devoluciones"];

const estadoDe = (S: Awaited<ReturnType<typeof storeNuevo>>): E => JSON.parse(S.acciones.exportar());

test("la demo: exportar → importar → exportar es un punto fijo, y sólo la primera vez se asignan contactos a los leads", async () => {
  almacen.clear();
  const S = await storeNuevo();
  const e0 = estadoDe(S);
  assert.equal(e0.contactos.length, 0, "la demo arranca con leads sin contacto");
  assert.ok(S.acciones.importar(JSON.stringify(e0)));
  const e1 = estadoDe(S);
  assert.equal(e1.contactos.length, e1.leads.length, "a cada lead sin contacto se le crea el suyo");
  for (const k of Object.keys(e0).filter((x) => !["leads", "contactos"].includes(x))) assert.deepEqual(e1[k], e0[k], `importar cambió ${k}`);
  assert.ok(S.acciones.importar(JSON.stringify(e1)));
  assert.deepEqual(estadoDe(S), e1, "el segundo viaje no cambia nada");
});

for (const semilla of [1, 2, 3, 4, 5, 6]) {
  test(`un estado al azar con datos raros (semilla ${semilla}): lo que se importa es lo que se exporta`, async () => {
    almacen.clear();
    const S = await storeNuevo();
    const respaldo = estadoAzar(semilla, estadoDe(S));
    assert.ok(S.acciones.importar(JSON.stringify(respaldo)), `semilla ${semilla}: importar rechazó el respaldo`);
    const e1 = estadoDe(S);
    for (const k of Object.keys(respaldo).filter((x) => !["leads", "contactos"].includes(x))) {
      assert.deepEqual(e1[k], respaldo[k], `semilla ${semilla}: ${k} cambió al importar`);
    }
    /* Los leads sólo ganan el contactoId que les faltaba (y los contactos, los que se crearon). */
    const leadsSinContacto = (respaldo.leads as E[]).filter((l) => !l.contactoId || !(respaldo.contactos as E[]).some((c) => c.id === l.contactoId)).length;
    assert.ok(e1.contactos.length >= (respaldo.contactos as E[]).length);
    assert.ok(e1.contactos.length <= (respaldo.contactos as E[]).length + leadsSinContacto, `semilla ${semilla}: se crearon más contactos que leads sin contacto`);
    for (const l of e1.leads as E[]) assert.ok((e1.contactos as E[]).some((c) => c.id === l.contactoId), `semilla ${semilla}: el lead ${l.id} quedó sin contacto`);
    /* Punto fijo: volver a importar lo exportado no cambia nada. */
    assert.ok(S.acciones.importar(JSON.stringify(e1)));
    assert.deepEqual(estadoDe(S), e1, `semilla ${semilla}: el segundo viaje cambió algo`);
  });
}

test("un respaldo de una versión anterior (le faltan colecciones y campos de ajustes) se completa: todas las listas son listas", async () => {
  const a = azar(77);
  for (let i = 0; i < 12; i++) {
    almacen.clear();
    const S = await storeNuevo();
    const respaldo = estadoAzar(100 + i, estadoDe(S)) as E;
    /* Se le sacan al azar colecciones nuevas y campos nuevos de los ajustes, como un respaldo de antes. */
    for (const k of a.mezclar(["devoluciones", "arqueos", "traspasos", "comentarios", "honorarios", "liquidaciones", "etapasServicio", "tiposCuenta", "contactos", "seguimientos", "testimonios", "gastosRecurrentes", "campaigns", "adsets", "ads", "adInsights"]).slice(0, a.entero(1, 8))) delete respaldo[k];
    for (const k of ["crm", "seguimiento", "reglasUtm", "proyectos", "comisionReferidor"]) if (a.prob(0.5)) delete respaldo.ajustes[k];
    assert.ok(S.acciones.importar(JSON.stringify(respaldo)), `caso ${i}`);
    const e = estadoDe(S);
    for (const k of LISTAS) assert.ok(Array.isArray(e[k]), `caso ${i}: ${k} no es una lista después de importar un respaldo viejo`);
    assert.ok(e.ajustes && typeof e.ajustes === "object");
    for (const k of ["negocio", "responsable", "monedaBase", "fuentes", "tiposSesion"]) assert.ok(k in e.ajustes, `caso ${i}: a los ajustes les falta ${k}`);
  }
});

test("un respaldo roto o con otra forma se rechaza y no toca el estado", async () => {
  almacen.clear();
  const S = await storeNuevo();
  const antes = S.acciones.exportar();
  for (const malo of ["", "no es json", "null", "[]", "42", "{}", '{"leads": "x"}', '{"leads": null}', '{"version": 1}', "{\"leads\": [}"]) {
    assert.equal(S.acciones.importar(malo), false, `aceptó «${malo}»`);
    assert.equal(S.acciones.exportar(), antes, `«${malo}» tocó el estado`);
  }
});

test("lo guardado en el navegador se lee igual al volver a abrir la app", async () => {
  almacen.clear();
  const S = await storeNuevo();
  const respaldo = estadoAzar(9, estadoDe(S));
  assert.ok(S.acciones.importar(JSON.stringify(respaldo)));
  S.acciones.crear("metas", { nombre: "Ñandú 'x' \"y\" 🚀", metrica: "ingresos", objetivo: 0.1 + 0.2, unidad: "cantidad", periodo: "2026-10", creadoEn: "2026-10-01" } as never, "m");
  const escrito = almacen.getItem(CLAVE);
  assert.ok(escrito, "no escribió nada en localStorage");
  const alReabrir = await storeNuevo();
  assert.deepEqual(estadoDe(alReabrir), estadoDe(S), "al reabrir se ve otra cosa de lo que había");
});

test("una copia local rota (JSON inválido) no tira la app: arranca con la demo", async () => {
  almacen.clear();
  almacen.datos.set(CLAVE, "{esto no es json");
  const S = await storeNuevo();
  const e = estadoDe(S);
  assert.ok(e.leads.length > 0 && Array.isArray(e.etapas) && e.etapas.length > 0);
});

test("una copia local vieja (sin colecciones nuevas, con etapas vacías) se completa con lo de siempre", async () => {
  almacen.clear();
  const S0 = await storeNuevo();
  const e = estadoDe(S0);
  const vieja = porJson(e);
  for (const k of ["devoluciones", "arqueos", "traspasos", "comentarios", "tiposCuenta", "etapasServicio"]) delete vieja[k];
  vieja.etapas = [];
  delete vieja.ajustes.crm;
  almacen.datos.set(CLAVE, JSON.stringify(vieja));
  const S = await storeNuevo();
  const n = estadoDe(S);
  for (const k of LISTAS) assert.ok(Array.isArray(n[k]), `${k} no es una lista al abrir una copia vieja`);
  assert.ok(n.etapas.length > 0, "sin etapas la app no puede dibujar el pipeline: se usan las de siempre");
});

test("un monto fraccionario, el cero, los negativos y los números enormes viajan sin cambiar (JSON no pierde nada de lo que la app escribe)", async () => {
  almacen.clear();
  const S = await storeNuevo();
  const montos = [0, 0.1 + 0.2, 99.995, 1e-7, 123456789.12, 9007199254740991, 1e21, -250.5, 2.675, 1 / 3];
  S.acciones.importar(JSON.stringify({ ...estadoDe(S), gastos: montos.map((m, i) => ({ id: `g${i}`, categoria: "x", grupo: "operativo", concepto: "c", monto: m, moneda: "USD", fecha: "2026-10-01T00:00:00.000Z", recurrente: false, creadoEn: "2026-10-01T00:00:00.000Z", extra: {} })) }));
  const e = estadoDe(S);
  assert.deepEqual(e.gastos.map((g: E) => g.monto), montos);
});
