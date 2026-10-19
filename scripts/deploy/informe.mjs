/* ==================================================================
   La guardia de publicación: el informe de producción contra un commit.

   Cada archivo de producción que no es igual al del commit se explica:
   - «más viejo»: producción tiene una versión que sí está en la historia
     del commit (le faltan cambios). Publicar el commit lo actualiza.
   - «se perdería»: producción tiene algo que NO está en la historia del
     commit (trabajo sin commitear, o de una rama sin mergear). Publicar el
     commit lo borraría. Es lo único que frena una publicación.
   ================================================================== */

import { clasificar } from "./arbol.mjs";
import { commitsPosteriores, corto, ignoradasPorGit, sha1DelRepo, versionEnLaHistoria, versionEnOtraRama } from "./git.mjs";

/**
 * @param {{dir: string, ref: string, produccion: Map<string,string>}} p
 *   `produccion`: ruta → sha1 de lo que hay publicado (aplanarArbol).
 */
export function compararConProduccion({ dir, ref, produccion }) {
  const repo = sha1DelRepo(dir, ref);
  const { iguales, distintos, soloProduccion, soloRepo } = clasificar(produccion, repo);

  const masViejos = [];
  const seperderia = [];
  for (const ruta of distintos) {
    const sha = produccion.get(ruta);
    const enLaHistoria = versionEnLaHistoria(dir, ref, ruta, sha);
    if (enLaHistoria) {
      masViejos.push({ ruta, version: corto(dir, enLaHistoria.commit), faltan: commitsPosteriores(dir, enLaHistoria.commit, ref, ruta) });
      continue;
    }
    const enOtraRama = versionEnOtraRama(dir, ruta, sha);
    seperderia.push(enOtraRama
      ? { ruta, motivo: `es de ${corto(dir, enOtraRama.commit)}, que no está en ${ref} (ramas: ${enOtraRama.ramas.slice(0, 3).join(", ")})` }
      : { ruta, motivo: "no está en ningún commit: es trabajo sin commitear" });
  }
  /* Lo que sólo está en producción pero `.gitignore` ignora (next-env.d.ts, tsconfig.tsbuildinfo… que genera un
     `tsc` o un `next build` local y la CLI sube igual) no es trabajo que se pierda: git nunca lo guarda. */
  const generados = ignoradasPorGit(dir, soloProduccion);
  for (const ruta of soloProduccion) {
    if (!generados.has(ruta)) seperderia.push({ ruta, motivo: `producción lo tiene y ${ref} no` });
  }

  /* Los commits que producción no tiene, sin repetir, de los archivos que difieren. */
  const faltantes = new Map();
  for (const v of masViejos) for (const l of v.faltan) faltantes.set(l.split(" ")[0], l);

  return {
    iguales: iguales.length, masViejos, seperderia, soloRepo, generados: [...generados].sort(),
    commitsFaltantes: [...faltantes.values()],
    ok: seperderia.length === 0,
    identica: masViejos.length === 0 && seperderia.length === 0,
  };
}

const lista = (items, tope = 12) => {
  const mostrar = items.slice(0, tope).map((x) => `      · ${x}`);
  if (items.length > tope) mostrar.push(`      · … y ${items.length - tope} más`);
  return mostrar;
};

/** El informe como líneas de texto, para la consola. */
export function textoDelInforme(inf, ref) {
  const salida = [`  ✔ ${inf.iguales} archivos iguales a ${ref}`];
  if (inf.identica) salida.push(`  ✔ producción es idéntica a ${ref}`);
  if (inf.masViejos.length) {
    salida.push(`  ⚠ ${inf.masViejos.length} archivo(s) de producción son más viejos que ${ref}: publicar ${ref} los actualiza.`);
    salida.push(...lista(inf.masViejos.map((v) => `${v.ruta}  (producción tiene la versión de ${v.version}; le faltan ${v.faltan.length} cambio(s))`), 6));
    salida.push(`    Commits que producción todavía no tiene (${inf.commitsFaltantes.length}):`);
    salida.push(...lista(inf.commitsFaltantes, 10));
  }
  if (inf.seperderia.length) {
    salida.push(`  ✖ ${inf.seperderia.length} archivo(s) de producción NO están en ${ref} y se perderían al publicar:`);
    salida.push(...lista(inf.seperderia.map((x) => `${x.ruta}  — ${x.motivo}`), 20));
  }
  if (inf.generados.length) salida.push(`  · ${inf.generados.length} archivo(s) que .gitignore ignora subieron igual (los genera una herramienta local, no se pierde nada): ${inf.generados.join(", ")}.`);
  if (inf.soloRepo.length) salida.push(`  · ${inf.soloRepo.length} archivo(s) de ${ref} que producción no tiene se agregarían${inf.soloRepo.length <= 6 ? `: ${inf.soloRepo.join(", ")}` : ""}.`);
  return salida;
}
