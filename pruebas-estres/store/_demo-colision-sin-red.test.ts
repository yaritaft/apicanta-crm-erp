/* Demostración (no es parte de la suite): si DOS ids salen iguales dentro de una tanda, nada en el store lo detecta ni lo repara.
   Se fuerza la colisión con Date.now() y Math.random() congelados en las DOS primeras llamadas a nuevoId, para ver qué pasa DESPUÉS de una colisión
   en un CSV de sólo 2 filas (lo que en la vida real pasa por azar, con probabilidad que crece con el cuadrado del tamaño de la tanda). */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { storeNuevo } from "./_fresco";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

/** Hace que las dos primeras llamadas a nuevoId() den el mismo id (reloj y azar congelados), y después vuelve a lo normal. */
function conPrimerasDosColisionando<T>(f: () => T): T {
  const ahora = Date.now, azar = Math.random;
  let llamadas = 0;
  Date.now = () => (llamadas < 2 ? 1_790_000_000_000 : ahora());
  Math.random = () => { const v = llamadas < 2 ? 0.123456789 : azar(); llamadas++; return v; };
  /* nuevoId llama a Date.now() y después a Math.random(): contamos en Math.random para que las dos primeras (y sólo ellas) salgan fijas */
  try { return f(); } finally { Date.now = ahora; Math.random = azar; }
}

test("importarLeads: dos leads con el mismo id quedan atados al mismo contacto y se pisan en la base", { todo: true }, async () => {
  base.vaciar();
  const S = await storeNuevo();
  await S.acciones.vaciarTodo();
  const etapaId = JSON.parse(S.acciones.exportar()).etapas[0].id;
  const fila = (nombre: string, email: string) => ({ nombre, email, fuente: "CSV", etapaId, monto: 0, moneda: "USD", responsable: "x", etiquetas: [], creadoEn: "2026-10-01T00:00:00.000Z", actualizadoEn: "2026-10-01T00:00:00.000Z", extra: {} });
  conPrimerasDosColisionando(() => S.acciones.importarLeads([fila("Ana Ruiz", "ana@ejemplo.test"), fila("Beto Paz", "beto@ejemplo.test")] as never));
  await esperarCola(S.estadoSync);
  const mem = JSON.parse(S.acciones.exportar());
  const leads = mem.leads as E[];
  console.log("en memoria:", leads.map((l) => `${l.nombre} <${l.email}> id=${l.id} contactoId=${l.contactoId}`));
  console.log("contactos :", (mem.contactos as E[]).map((c) => `${c.nombre} <${c.email}> id=${c.id}`));
  console.log("en la base: leads =", base.filas("leads").map((l) => `${l.nombre} id=${l.id}`), " cola:", S.estadoSync(), S.errorSync());
  assert.equal(new Set(leads.map((l) => l.id)).size, 2, "los dos leads deberían tener ids distintos");
});

test("importarMovimientos: dos cobros con el mismo id traban la cola de escritura", { todo: true }, async () => {
  base.vaciar();
  const S = await storeNuevo();
  await S.acciones.vaciarTodo();
  const fila = (i: number) => ({ proveedor: "stripe", referencia: `pi_${i}`, monto: 10 + i, moneda: "USD", fee: 1, neto: 9 + i, fecha: "2026-10-01T00:00:00.000Z" });
  conPrimerasDosColisionando(() => S.acciones.importarMovimientos([fila(1), fila(2)] as never, "csv"));
  await esperarCola(S.estadoSync);
  const ids = (JSON.parse(S.acciones.exportar()).movimientos as E[]).map((m) => m.id);
  console.log("en memoria:", ids, " en la base:", base.filas("movimientos").length, " cola:", S.estadoSync(), S.errorSync());
  /* Y lo que se haga DESPUÉS en la misma sesión tampoco llega: la operación que falla queda a la cabeza de la cola. */
  S.acciones.ajustesSilencioso({ responsable: "Zeta" });
  await esperarCola(S.estadoSync);
  const enLaBase = base.filas("ajustes").map((a) => a.responsable);
  console.log("después de otro cambio (responsable=Zeta):", S.estadoSync(), S.errorSync(), " ajustes en la base:", enLaBase);
  assert.ok(enLaBase.includes("Zeta"), "el cambio hecho después del import debería haber llegado a la base");
});
