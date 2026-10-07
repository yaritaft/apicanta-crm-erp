/* Estrés del almacén: los ids que genera nuevoId() son únicos dentro de una tanda.

   nuevoId = prefijo + Date.now() en base 36 + 5 caracteres al azar (36^5 ≈ 60 millones). Dentro de un mismo milisegundo, 1000 ids tienen una
   chance de repetirse de 1000²/2/60M ≈ 0,8%, y un bucle rápido hace miles por milisegundo. Dos filas con el mismo id en un upsert hacen fallar
   el pedido entero en PostgREST («ON CONFLICT DO UPDATE command cannot affect row a second time»): el store ya lo tuvo en la actividad y lo arregló ahí
   (Tanda.base + un contador). Acá se prueba el resto de las cargas masivas, con el reloj y el azar controlados para que sea repetible:
   importarLeads (un CSV de miles de filas) e importarMovimientos (el CSV de una pasarela). */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { storeNuevo } from "./_fresco";
import { mulberry32 } from "./_aleatorio";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

/** Corre `f` con Date.now() que avanza 1 ms cada `porMs` llamadas y Math.random sembrado (un bucle rápido). */
function conRelojYAzarControlados<T>(semilla: number, porMs: number, f: () => T): T {
  const ahora = Date.now, azar = Math.random;
  const r = mulberry32(semilla);
  let llamadas = 0;
  const t0 = Date.parse("2026-10-07T15:00:00.000Z");
  Date.now = () => t0 + Math.floor(llamadas++ / porMs);
  Math.random = r;
  try { return f(); } finally { Date.now = ahora; Math.random = azar; }
}

const repetidos = (ids: string[]) => ids.length - new Set(ids).size;

/* BUG: nuevoId() no garantiza unicidad: la parte al azar es de 5 caracteres y no hay contador (ver abajo lo que provoca en las cargas masivas). */
test("nuevoId: 4000 ids seguidos (unos 2000 por milisegundo) no se repiten, para ninguna de 30 semillas", { todo: true }, () => {
  const conRepetidos: string[] = [];
  return (async () => {
    const S = await storeNuevo();
    for (let semilla = 1; semilla <= 30; semilla++) {
      const ids = conRelojYAzarControlados(semilla, 2000, () => Array.from({ length: 4000 }, () => S.nuevoId("lead")));
      const rep = repetidos(ids);
      if (rep) conRepetidos.push(`semilla ${semilla}: ${rep} repetido(s)`);
    }
    /* BUG: nuevoId() no garantiza unicidad: la parte al azar es de 5 caracteres y no hay contador. */
    assert.deepEqual(conRepetidos, []);
  })();
});

test("importarLeads con un CSV de miles de filas no repite ids ni traba la cola de escritura", { todo: true }, async () => {
  /* BUG: importarLeads() pone `id: nuevoId("lead")` a cada fila en un map(): con miles de filas dos comparten milisegundo y sufijo (el 10% de las
     tandas de 5000 filas medidas con el reloj real). En memoria quedan dos leads con el mismo id; en la base, el upsert de ese lote falla entero
     con 21000 y la cola queda trabada para siempre (todo lo que se cargue después no se guarda, y al recargar se pierde el CSV). */
  const hallazgos: string[] = [];
  for (let semilla = 1; semilla <= 25 && hallazgos.length === 0; semilla++) {
    base.vaciar();
    const S = await storeNuevo();
    await S.acciones.vaciarTodo();
    const etapaId = JSON.parse(S.acciones.exportar()).etapas[0].id;
    const filas = Array.from({ length: 5000 }, (_x, i) => ({ nombre: `P ${i}`, email: `p${i}@ejemplo.test`, fuente: "CSV", etapaId, monto: 0, moneda: "USD", responsable: "x", etiquetas: [], creadoEn: "2026-10-01T00:00:00.000Z", actualizadoEn: "2026-10-01T00:00:00.000Z", extra: {} }));
    conRelojYAzarControlados(semilla, 2000, () => S.acciones.importarLeads(filas as never));
    await esperarCola(S.estadoSync);
    const ids = (JSON.parse(S.acciones.exportar()).leads as E[]).map((l) => l.id);
    if (repetidos(ids) > 0) hallazgos.push(`semilla ${semilla}: ${repetidos(ids)} lead(s) con id repetido; cola: ${S.estadoSync()} ${S.errorSync()}`);
  }
  assert.deepEqual(hallazgos, []);
});

test("importarMovimientos con miles de cobros no repite ids", { todo: true }, async () => {
  /* BUG: igual que importarLeads, con `id: nuevoId("mov")` por fila. */
  const hallazgos: string[] = [];
  for (let semilla = 1; semilla <= 25 && hallazgos.length === 0; semilla++) {
    base.vaciar();
    const S = await storeNuevo();
    await S.acciones.vaciarTodo();
    const filas = Array.from({ length: 5000 }, (_x, i) => ({ proveedor: "stripe", referencia: `pi_${i}`, monto: 10 + i, moneda: "USD", fee: 1, neto: 9 + i, fecha: "2026-10-01T00:00:00.000Z" }));
    conRelojYAzarControlados(semilla, 2000, () => S.acciones.importarMovimientos(filas as never, "csv"));
    await esperarCola(S.estadoSync);
    const ids = (JSON.parse(S.acciones.exportar()).movimientos as E[]).map((m) => m.id);
    if (repetidos(ids) > 0) hallazgos.push(`semilla ${semilla}: ${repetidos(ids)} cobro(s) con id repetido; cola: ${S.estadoSync()} ${S.errorSync()}`);
  }
  assert.deepEqual(hallazgos, []);
});
