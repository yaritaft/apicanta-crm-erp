/* ==================================================================
   La guardia de publicación: lo que se le pregunta a git.
   Sin dependencias: sólo el `git` de la máquina.
   ================================================================== */

import { execFileSync } from "node:child_process";
import { relacionConLaReferencia, sha1 } from "./arbol.mjs";

export function git(dir, args, { buffer = false, input } = {}) {
  try {
    return execFileSync("git", ["-C", dir, ...args], {
      encoding: buffer ? undefined : "utf8", maxBuffer: 1 << 30, input: input === undefined ? undefined : Buffer.from(input), stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (e) {
    const detalle = e && e.stderr ? String(e.stderr).trim() : String(e);
    throw new Error(`git ${args.join(" ")}: ${detalle}`);
  }
}

/* El sha1 del contenido crudo de cada objeto «ref:ruta», en el mismo orden; null si no existe. */
export function sha1DeObjetos(dir, objetos) {
  if (objetos.length === 0) return [];
  const salida = git(dir, ["cat-file", "--batch"], { buffer: true, input: `${objetos.join("\n")}\n` });
  const resultado = [];
  let i = 0;
  for (let n = 0; n < objetos.length; n += 1) {
    const fin = salida.indexOf(10, i);
    const cabecera = salida.toString("utf8", i, fin);
    if (cabecera.endsWith(" missing")) { resultado.push(null); i = fin + 1; continue; }
    const tamano = Number(cabecera.split(" ")[2]);
    resultado.push(sha1(salida.subarray(fin + 1, fin + 1 + tamano)));
    i = fin + 1 + tamano + 1;
  }
  return resultado;
}

/* Todos los archivos de `ref` con su sha1: ruta → sha1. */
export function sha1DelRepo(dir, ref) {
  const rutas = git(dir, ["ls-tree", "-r", "-z", "--name-only", ref]).split("\0").filter(Boolean);
  const shas = sha1DeObjetos(dir, rutas.map((r) => `${ref}:${r}`));
  return new Map(rutas.map((r, i) => [r, shas[i]]).filter(([, s]) => s));
}

export const resolver = (dir, ref) => git(dir, ["rev-parse", "--verify", `${ref}^{commit}`]).trim();
export const corto = (dir, sha) => git(dir, ["rev-parse", "--short", sha]).trim();

const lineas = (texto) => texto.split("\n").map((l) => l.trim()).filter(Boolean);

/**
 * El estado de la carpeta que se va a publicar frente a la referencia:
 * en qué commit está, cuántos le faltan o le sobran y qué archivos tiene sin commitear
 * (los modificados y los nuevos que no están en .gitignore: la CLI los subiría).
 */
export function estadoDeLaCopia(dir, ref) {
  const head = resolver(dir, "HEAD");
  const atras = lineas(git(dir, ["log", "--format=%h %s", `HEAD..${ref}`]));
  const adelante = lineas(git(dir, ["log", "--format=%h %s", `${ref}..HEAD`]));
  const sucios = lineas(git(dir, ["status", "--porcelain", "--untracked-files=all"]));
  return {
    head, refSha: resolver(dir, ref), atras, adelante, sucios,
    relacion: relacionConLaReferencia(atras.length, adelante.length),
  };
}

/** Si `sha` (el sha1 crudo de `ruta`) es una versión de ese archivo en la historia de `ref`: el commit y cuántos cambios le siguieron. */
export function versionEnLaHistoria(dir, ref, ruta, sha, limite = 400) {
  const commits = lineas(git(dir, ["log", "--format=%H", "-n", String(limite), ref, "--", ruta]));
  const shas = sha1DeObjetos(dir, commits.map((c) => `${c}:${ruta}`));
  const i = shas.findIndex((s) => s === sha);
  return i < 0 ? null : { commit: commits[i] };
}

/** Los commits que tocaron `ruta` después de `desde` y llegan a `ref`: lo que a producción le falta de ese archivo. */
export function commitsPosteriores(dir, desde, ref, ruta) {
  return lineas(git(dir, ["log", "--format=%h %s", `${desde}..${ref}`, "--", ruta]));
}

/** Si esa versión existe en otra rama (local o remota) que no es `ref`: el commit y las ramas. */
export function versionEnOtraRama(dir, ruta, sha, limite = 400) {
  const commits = lineas(git(dir, ["log", "--all", "--format=%H", "-n", String(limite), "--", ruta]));
  const shas = sha1DeObjetos(dir, commits.map((c) => `${c}:${ruta}`));
  const i = shas.findIndex((s) => s === sha);
  if (i < 0) return null;
  const ramas = lineas(git(dir, ["branch", "-a", "--contains", commits[i]])).map((r) => r.replace(/^\* /, ""));
  return { commit: commits[i], ramas };
}

/** Qué pasa con el commit que se publicó: es parte de la historia de `ref`, no lo es (se publicó algo que no se pusheó o se rebaseó) o este repo no lo conoce. */
export function commitFrenteALaReferencia(dir, sha, ref) {
  if (!sha) return "desconocido";
  try { git(dir, ["cat-file", "-e", `${sha}^{commit}`]); } catch { return "ausente"; }
  try { git(dir, ["merge-base", "--is-ancestor", sha, ref]); return "en-la-historia"; } catch { return "fuera-de-la-historia"; }
}
