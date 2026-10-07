/* Una copia nueva del store para cada caso (no es una prueba).

   El store guarda su estado en variables del módulo (la memoria, la cola de escritura, lo
   que ya se cargó). Para repetir un caso desde cero sin levantar otro proceso, se importa
   el módulo con un sufijo (`@/lib/store?fresco=3`): node lo trata como otro módulo y lo evalúa de
   nuevo. Todo lo demás (supabase.ts, seed.ts, los lib/) se comparte: sin estado. */
import { registerHooks } from "node:module";

let listo = false;
function instalarHooks() {
  if (listo) return;
  listo = true;
  registerHooks({
    resolve(especificador, contexto, siguiente) {
      const m = /^(@\/lib\/store)\?(fresco=\d+)$/.exec(especificador);
      if (!m) return siguiente(especificador, contexto);
      const r = siguiente(m[1], contexto);
      return { ...r, url: `${r.url}?${m[2]}`, shortCircuit: true };
    },
    load(url, contexto, siguiente) {
      if (!/\?fresco=\d+$/.test(url)) return siguiente(url, contexto);
      const limpia = url.replace(/\?fresco=\d+$/, "");
      const r = siguiente(limpia, contexto);
      return { ...r, shortCircuit: true };
    },
  });
}

let n = 0;
export type Store = typeof import("@/lib/store");

/** Un store recién evaluado: memoria, cola y carga en blanco. */
export async function storeNuevo(): Promise<Store> {
  instalarHooks();
  return (await import(`@/lib/store?fresco=${++n}`)) as Store;
}
