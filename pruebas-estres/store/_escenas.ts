/* Armar escenas contra la base falsa (no es una prueba). Se importa DESPUÉS de ./_nube. */
import { esperarCola, type BaseFalsa } from "./_nube";
import { storeNuevo, type Store } from "./_fresco";
import type { E } from "./_acciones";

/** Un store con la demo sembrada en la nube (la base se vacía antes). */
export async function conDemo(base: BaseFalsa): Promise<Store> {
  base.vaciar();
  const S = await storeNuevo();
  await S.acciones.reiniciarDemo();
  return S;
}

/** El estado de un store, como lo vería otra pantalla (JSON). */
export const estadoDe = (S: Store): E => JSON.parse(S.acciones.exportar());

/** Lo que se vería al recargar la página: un store nuevo que carga todo de la base. */
export async function recargado(): Promise<E> {
  const S2 = await storeNuevo();
  await S2.cargarDeLaNube();
  if (S2.estadoSync() === "error") throw new Error(`la recarga falló: ${S2.errorSync()}`);
  return estadoDe(S2);
}

/** Corre algo y espera a que la cola termine (o falle). */
export async function yEsperar(S: Store, f: () => void): Promise<void> {
  f();
  await esperarCola(S.estadoSync);
}
