/* ==================================================================
   La parte pura de la guardia de publicación: sin red ni git, para poder
   probarla (pruebas/verificar-deploy.test.ts).

   Vercel guarda, de cada deployment hecho con la CLI, el árbol de archivos
   que se subió, y de cada archivo el sha1 de su contenido crudo (no el
   hash de blob de git). Con eso se compara lo que hay en producción contra
   un commit del repo, archivo por archivo.
   ================================================================== */

import { createHash } from "node:crypto";

export const sha1 = (contenido) => createHash("sha1").update(contenido).digest("hex");

/* Lo que no cuenta como diferencia: lo que la CLI de Vercel no sube de la carpeta
   (los .gitignore, node_modules) y lo que genera el build. */
const IGNORADOS = [/^node_modules\//, /^\.next\//, /^\.vercel\//, /(^|\/)\.gitignore$/, /(^|\/)\.DS_Store$/];
export const rutaIgnorada = (ruta) => IGNORADOS.some((r) => r.test(ruta));

/**
 * El árbol de `GET /v6/deployments/{id}/files` como un Map ruta → sha1, sólo de
 * los archivos del código. La API devuelve dos raíces: `src` (lo que se subió,
 * con el proyecto adentro) y `out` (lo que generó el build, con funciones lambda
 * que no tienen el sha1 de ningún archivo nuestro). Se usa la primera.
 */
export function aplanarArbol(respuesta) {
  const raices = Array.isArray(respuesta) ? respuesta : (respuesta && respuesta.result) || [];
  const fuente = raices.find((n) => n && n.type === "directory" && n.name === "src");
  const nodos = fuente ? fuente.children || [] : raices;
  const archivos = new Map();
  const recorrer = (lista, prefijo) => {
    for (const n of lista) {
      if (!n || typeof n !== "object") continue;
      const ruta = prefijo + n.name;
      if (n.type === "directory") recorrer(Array.isArray(n.children) ? n.children : [], `${ruta}/`);
      else if (n.type === "file" && typeof n.uid === "string") archivos.set(ruta, n.uid.toLowerCase());
    }
  };
  recorrer(nodos, "");
  return archivos;
}

/**
 * Compara producción contra el repo (los dos como Map ruta → sha1).
 *  - distintos: están en los dos con contenido distinto.
 *  - soloProduccion: producción tiene un archivo que el repo no.
 *  - soloRepo: el repo tiene un archivo que producción no (se agregaría).
 */
export function clasificar(produccion, repo) {
  const iguales = [];
  const distintos = [];
  const soloProduccion = [];
  const soloRepo = [];
  for (const [ruta, sha] of produccion) {
    if (rutaIgnorada(ruta)) continue;
    if (!repo.has(ruta)) soloProduccion.push(ruta);
    else if (repo.get(ruta) === sha) iguales.push(ruta);
    else distintos.push(ruta);
  }
  for (const ruta of repo.keys()) {
    if (!rutaIgnorada(ruta) && !produccion.has(ruta)) soloRepo.push(ruta);
  }
  for (const l of [iguales, distintos, soloProduccion, soloRepo]) l.sort();
  return { iguales, distintos, soloProduccion, soloRepo };
}

/**
 * Qué dice el estado de una copia de trabajo respecto de la referencia (origin/main):
 * igual, atrasada (le faltan commits), adelantada (tiene commits que no están en main)
 * o divergente (las dos cosas).
 */
export function relacionConLaReferencia(atras, adelante) {
  if (!atras && !adelante) return "igual";
  if (!adelante) return "atrasada";
  if (!atras) return "adelantada";
  return "divergente";
}
