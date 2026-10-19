import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aplanarArbol, clasificar, relacionConLaReferencia, rutaIgnorada } from "../scripts/deploy/arbol.mjs";
import { commitFrenteALaReferencia, estadoDeLaCopia, ignoradasPorGit, sha1DeObjetos, sha1DelRepo } from "../scripts/deploy/git.mjs";
import { compararConProduccion, textoDelInforme } from "../scripts/deploy/informe.mjs";

/* ==================================================================
   La guardia de publicación (scripts/verificar-deploy.mjs).

   El 19/10/2026 un deploy hecho desde una copia vieja dejó producción sin
   tres commits que ya estaban publicados. La guardia compara, archivo por
   archivo, lo que hay en producción con un commit, y la carpeta que se va a
   publicar con origin/main. Acá se prueba con repos de git de verdad (un
   «origin» y una copia, en una carpeta temporal) y con árboles de Vercel
   inventados: no toca la red ni la cuenta de nadie.
   ================================================================== */

const sha = (x: string | Buffer) => createHash("sha1").update(x).digest("hex");

/* ---------- el árbol de Vercel ---------- */

const arbolDeVercel = (extra: unknown[] = []) => ({
  result: [
    {
      name: "src", type: "directory", children: [
        { name: "package.json", type: "file", uid: sha("{}") },
        { name: ".gitignore", type: "file", uid: sha("node_modules") },
        { name: "src", type: "directory", children: [
          { name: "app", type: "directory", children: [
            { name: "(app)", type: "directory", children: [{ name: "[id]", type: "directory", children: [{ name: "page.tsx", type: "file", uid: sha("pagina").toUpperCase() }] }] },
          ] },
        ] },
        ...extra,
      ],
    },
    { name: "out", type: "directory", children: [{ name: "index", type: "lambda", uid: "no-es-un-sha1-nuestro" }] },
  ],
});

test("aplanarArbol: sólo los archivos de la raíz «src», con la ruta completa y el sha1 en minúsculas", () => {
  const a = aplanarArbol(arbolDeVercel());
  assert.deepEqual([...a.keys()].sort(), [".gitignore", "package.json", "src/app/(app)/[id]/page.tsx"]);
  assert.equal(a.get("src/app/(app)/[id]/page.tsx"), sha("pagina"));
  assert.ok(![...a.keys()].some((k) => k.startsWith("out/")), "lo que genera el build no es código");
});

test("aplanarArbol: acepta la lista pelada, y sin raíz «src» usa lo que haya", () => {
  assert.equal(aplanarArbol(arbolDeVercel().result).size, 3);
  const sinRaiz = aplanarArbol({ result: [{ name: "a.txt", type: "file", uid: sha("a") }] });
  assert.deepEqual([...sinRaiz.keys()], ["a.txt"]);
  assert.equal(aplanarArbol(null).size, 0);
  assert.equal(aplanarArbol({ result: [{ name: "src", type: "directory" }] }).size, 0);
});

test("rutaIgnorada: lo que la CLI no sube y lo que genera el build no cuenta", () => {
  for (const r of [".gitignore", "supabase/.gitignore", "node_modules/x/index.js", ".next/cache/a", ".vercel/project.json", "docs/.DS_Store"]) assert.ok(rutaIgnorada(r), r);
  for (const r of ["src/lib/store.ts", "package.json", "docs/gitignore.md", "src/.env.example"]) assert.ok(!rutaIgnorada(r), r);
});

test("clasificar: iguales, distintos, sólo en producción y sólo en el repo (sin contar lo ignorado)", () => {
  const prod = new Map([["a", "1"], ["b", "2"], ["c", "3"], [".gitignore", "9"], ["node_modules/x", "8"]]);
  const repo = new Map([["a", "1"], ["b", "OTRO"], ["d", "4"], ["supabase/.gitignore", "7"]]);
  assert.deepEqual(clasificar(prod, repo), { iguales: ["a"], distintos: ["b"], soloProduccion: ["c"], soloRepo: ["d"] });
});

test("relacionConLaReferencia", () => {
  assert.equal(relacionConLaReferencia(0, 0), "igual");
  assert.equal(relacionConLaReferencia(2, 0), "atrasada");
  assert.equal(relacionConLaReferencia(0, 3), "adelantada");
  assert.equal(relacionConLaReferencia(1, 1), "divergente");
});

/* ---------- un origin y una copia de verdad ---------- */

const ID = ["-c", "user.name=Prueba", "-c", "user.email=prueba@example.com", "-c", "commit.gpgsign=false"];
function g(dir: string, ...args: string[]): string {
  return execFileSync("git", ["-C", dir, ...ID, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

interface Mundo { raiz: string; origin: string; copia: string; limpiar: () => void }

/* origin (bare) + una copia con tres commits en main: v1, v2, v3 de a.txt. Devuelve los commits. */
function mundo(): Mundo & { c1: string; c2: string; c3: string } {
  const raiz = mkdtempSync(join(tmpdir(), "guardia-"));
  const origin = join(raiz, "origin.git");
  const copia = join(raiz, "copia");
  execFileSync("git", ["init", "--bare", "-b", "main", origin], { stdio: "ignore" });
  execFileSync("git", ["clone", "-q", origin, copia], { stdio: "ignore" });
  g(copia, "checkout", "-q", "-B", "main");
  mkdirSync(join(copia, "src/app/(app)/[id]"), { recursive: true });
  writeFileSync(join(copia, ".gitignore"), "ignorado.log\n");
  writeFileSync(join(copia, "b.txt"), "b\n");
  writeFileSync(join(copia, "src/app/(app)/[id]/página.tsx"), "página\n");
  writeFileSync(join(copia, "a.txt"), "a v1\n");
  g(copia, "add", "."); g(copia, "commit", "-q", "-m", "v1");
  const c1 = g(copia, "rev-parse", "HEAD").trim();
  writeFileSync(join(copia, "a.txt"), "a v2\n");
  g(copia, "commit", "-q", "-am", "v2: cambia a");
  const c2 = g(copia, "rev-parse", "HEAD").trim();
  writeFileSync(join(copia, "a.txt"), "a v3\n");
  g(copia, "commit", "-q", "-am", "v3: cambia a otra vez");
  const c3 = g(copia, "rev-parse", "HEAD").trim();
  g(copia, "push", "-q", "origin", "main");
  g(copia, "fetch", "-q", "origin");
  return { raiz, origin, copia, c1, c2, c3, limpiar: () => rmSync(raiz, { recursive: true, force: true }) };
}

/* Lo que habría en producción: el contenido de cada archivo de un commit, como Map ruta → sha1. */
const enProduccion = (m: Mundo, ref: string, cambios: Record<string, string | null> = {}) => {
  const p = sha1DelRepo(m.copia, ref) as Map<string, string>;
  for (const [ruta, contenido] of Object.entries(cambios)) { if (contenido === null) p.delete(ruta); else p.set(ruta, sha(contenido)); }
  return p;
};

test("sha1DelRepo: el sha1 del contenido crudo, también con binarios y nombres con paréntesis, corchetes y tildes", () => {
  const m = mundo();
  try {
    const binario = Buffer.from([0, 1, 2, 10, 13, 255, 10, 10, 0]);
    writeFileSync(join(m.copia, "bin.dat"), binario);
    g(m.copia, "add", "bin.dat"); g(m.copia, "commit", "-q", "-m", "binario");
    const r = sha1DelRepo(m.copia, "HEAD") as Map<string, string>;
    assert.equal(r.get("bin.dat"), sha(binario));
    assert.equal(r.get("a.txt"), sha("a v3\n"));
    assert.equal(r.get("src/app/(app)/[id]/página.tsx"), sha("página\n"));
    assert.deepEqual(sha1DeObjetos(m.copia, ["HEAD:a.txt", "HEAD:no-existe.txt", `${m.c1}:a.txt`]), [sha("a v3\n"), null, sha("a v1\n")]);
    assert.deepEqual(sha1DeObjetos(m.copia, []), []);
  } finally { m.limpiar(); }
});

test("producción idéntica al commit: no hay nada que objetar", () => {
  const m = mundo();
  try {
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3) });
    assert.equal(inf.ok, true);
    assert.equal(inf.identica, true);
    assert.deepEqual([inf.masViejos, inf.seperderia, inf.soloRepo, inf.commitsFaltantes], [[], [], [], []]);
    assert.match(textoDelInforme(inf, "origin/main").join("\n"), /producción es idéntica a origin\/main/);
  } finally { m.limpiar(); }
});

test("producción con una versión vieja de un archivo: se dice cuál y qué commits le faltan, y se puede publicar", () => {
  const m = mundo();
  try {
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "a.txt": "a v1\n" }) });
    assert.equal(inf.ok, true, "publicar el commit actualiza lo que está viejo");
    assert.equal(inf.identica, false);
    assert.equal(inf.masViejos.length, 1);
    assert.equal(inf.masViejos[0].ruta, "a.txt");
    assert.deepEqual(inf.masViejos[0].faltan.map((l: string) => l.split(" ").slice(1).join(" ")), ["v3: cambia a otra vez", "v2: cambia a"]);
    assert.deepEqual(inf.commitsFaltantes.map((l: string) => l.split(" ")[1]), ["v3:", "v2:"]);
    const texto = textoDelInforme(inf, "origin/main").join("\n");
    assert.match(texto, /más viejos que origin\/main/);
    assert.match(texto, /v2: cambia a/);
  } finally { m.limpiar(); }
});

test("producción con la versión del medio: sólo falta lo que vino después", () => {
  const m = mundo();
  try {
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "a.txt": "a v2\n" }) });
    assert.deepEqual(inf.commitsFaltantes.map((l: string) => l.split(" ")[1]), ["v3:"]);
  } finally { m.limpiar(); }
});

test("producción con trabajo sin commitear: se perdería, y frena", () => {
  const m = mundo();
  try {
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "a.txt": "a editado a mano y nunca commiteado\n" }) });
    assert.equal(inf.ok, false);
    assert.equal(inf.seperderia.length, 1);
    assert.equal(inf.seperderia[0].ruta, "a.txt");
    assert.match(inf.seperderia[0].motivo, /sin commitear/);
    assert.match(textoDelInforme(inf, "origin/main").join("\n"), /se perderían al publicar/);
  } finally { m.limpiar(); }
});

test("producción con una versión de una rama sin mergear: se perdería, y dice de qué rama es", () => {
  const m = mundo();
  try {
    g(m.copia, "checkout", "-q", "-b", "lote-sin-mergear", m.c1);
    writeFileSync(join(m.copia, "a.txt"), "a de otra rama\n");
    g(m.copia, "commit", "-q", "-am", "cambio en una rama aparte");
    g(m.copia, "checkout", "-q", "main");
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "a.txt": "a de otra rama\n" }) });
    assert.equal(inf.ok, false);
    assert.match(inf.seperderia[0].motivo, /que no está en/);
    assert.match(inf.seperderia[0].motivo, /lote-sin-mergear/);
  } finally { m.limpiar(); }
});

test("un archivo que sólo está en producción se perdería; uno que sólo está en el repo se agrega", () => {
  const m = mundo();
  try {
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "z-solo-produccion.txt": "z\n", "b.txt": null }) });
    assert.equal(inf.ok, false);
    assert.deepEqual(inf.seperderia.map((x: { ruta: string }) => x.ruta), ["z-solo-produccion.txt"]);
    assert.deepEqual(inf.soloRepo, ["b.txt"]);
  } finally { m.limpiar(); }
});

test("lo que .gitignore ignora y la CLI subió igual (next-env.d.ts, tsbuildinfo) no es trabajo que se pierda", () => {
  const m = mundo();
  try {
    const inf = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "ignorado.log": "lo generó una herramienta local\n" }) });
    assert.equal(inf.ok, true);
    assert.equal(inf.identica, true);
    assert.deepEqual(inf.generados, ["ignorado.log"]);
    assert.match(textoDelInforme(inf, "origin/main").join("\n"), /\.gitignore ignora subieron igual.*ignorado\.log/);
    /* Otro archivo de más, que git no ignora, sigue frenando. */
    const peor = compararConProduccion({ dir: m.copia, ref: m.c3, produccion: enProduccion(m, m.c3, { "ignorado.log": "x\n", "trabajo.txt": "sin commitear\n" }) });
    assert.equal(peor.ok, false);
    assert.deepEqual(peor.seperderia.map((x: { ruta: string }) => x.ruta), ["trabajo.txt"]);
  } finally { m.limpiar(); }
});

test("ignoradasPorGit: devuelve sólo las rutas que .gitignore ignora, y vacío si no hay ninguna", () => {
  const m = mundo();
  try {
    /* Un patrón sin barra («ignorado.log») ignora ese nombre a cualquier profundidad. */
    assert.deepEqual([...ignoradasPorGit(m.copia, ["ignorado.log", "a.txt", "src/ignorado.log", "src/otro.log"])].sort(), ["ignorado.log", "src/ignorado.log"]);
    assert.deepEqual([...ignoradasPorGit(m.copia, ["a.txt", "b.txt"])], []);
    assert.deepEqual([...ignoradasPorGit(m.copia, [])], []);
  } finally { m.limpiar(); }
});

test("el escenario del 19/10: producción con los archivos de antes de tres commits; salen los tres y no frena", () => {
  const m = mundo();
  try {
    /* Tres commits más sobre v3, cada uno toca un archivo distinto. */
    const toque = (archivo: string, texto: string, mensaje: string) => { writeFileSync(join(m.copia, archivo), texto); g(m.copia, "add", archivo); g(m.copia, "commit", "-q", "-m", mensaje); };
    const antes = g(m.copia, "rev-parse", "HEAD").trim();
    toque("b.txt", "b con deshacer\n", "Reembolsos: se puede deshacer");
    toque("a.txt", "a con link de drive\n", "Importador: link de Drive");
    toque("src/app/(app)/[id]/página.tsx", "página sin identificar\n", "Reembolsos «sin identificar»");
    const inf = compararConProduccion({ dir: m.copia, ref: "HEAD", produccion: enProduccion(m, antes) });
    assert.equal(inf.ok, true);
    assert.equal(inf.masViejos.length, 3);
    assert.deepEqual(inf.commitsFaltantes.map((l: string) => l.split(" ").slice(1).join(" ")).sort(), [
      "Importador: link de Drive", "Reembolsos «sin identificar»", "Reembolsos: se puede deshacer",
    ]);
  } finally { m.limpiar(); }
});

/* ---------- la carpeta que se va a publicar ---------- */

test("estadoDeLaCopia: igual a origin/main y limpia", () => {
  const m = mundo();
  try {
    const e = estadoDeLaCopia(m.copia, "origin/main");
    assert.equal(e.relacion, "igual");
    assert.equal(e.head, m.c3);
    assert.deepEqual([e.atras, e.adelante, e.sucios], [[], [], []]);
  } finally { m.limpiar(); }
});

test("estadoDeLaCopia: con commits sin pushear está adelantada", () => {
  const m = mundo();
  try {
    writeFileSync(join(m.copia, "nuevo.txt"), "x\n"); g(m.copia, "add", "nuevo.txt"); g(m.copia, "commit", "-q", "-m", "sin pushear");
    const e = estadoDeLaCopia(m.copia, "origin/main");
    assert.equal(e.relacion, "adelantada");
    assert.equal(e.adelante.length, 1);
    assert.match(e.adelante[0], /sin pushear/);
  } finally { m.limpiar(); }
});

test("estadoDeLaCopia: si alguien pusheó después, está atrasada (el caso de la copia vieja)", () => {
  const m = mundo();
  try {
    const otra = join(m.raiz, "otra-sesion");
    execFileSync("git", ["clone", "-q", m.origin, otra], { stdio: "ignore" });
    writeFileSync(join(otra, "b.txt"), "b de otra sesión\n");
    g(otra, "commit", "-q", "-am", "lo que pusheó otra sesión"); g(otra, "push", "-q", "origin", "main");
    g(m.copia, "fetch", "-q", "origin");
    const e = estadoDeLaCopia(m.copia, "origin/main");
    assert.equal(e.relacion, "atrasada");
    assert.match(e.atras[0], /lo que pusheó otra sesión/);
  } finally { m.limpiar(); }
});

test("estadoDeLaCopia: commits propios y ajenos a la vez es divergente", () => {
  const m = mundo();
  try {
    const otra = join(m.raiz, "otra-sesion");
    execFileSync("git", ["clone", "-q", m.origin, otra], { stdio: "ignore" });
    writeFileSync(join(otra, "b.txt"), "b ajeno\n"); g(otra, "commit", "-q", "-am", "ajeno"); g(otra, "push", "-q", "origin", "main");
    writeFileSync(join(m.copia, "c.txt"), "c propio\n"); g(m.copia, "add", "c.txt"); g(m.copia, "commit", "-q", "-m", "propio");
    g(m.copia, "fetch", "-q", "origin");
    assert.equal(estadoDeLaCopia(m.copia, "origin/main").relacion, "divergente");
  } finally { m.limpiar(); }
});

test("estadoDeLaCopia: archivos modificados o nuevos sin commitear se ven; lo que está en .gitignore no", () => {
  const m = mundo();
  try {
    writeFileSync(join(m.copia, "b.txt"), "b editado\n");
    writeFileSync(join(m.copia, "suelto.txt"), "no está en git\n");
    mkdirSync(join(m.copia, "carpeta"), { recursive: true });
    writeFileSync(join(m.copia, "carpeta/otro.txt"), "tampoco\n");
    writeFileSync(join(m.copia, "ignorado.log"), "esto sí se ignora\n");
    const e = estadoDeLaCopia(m.copia, "origin/main");
    assert.equal(e.relacion, "igual");
    assert.deepEqual(e.sucios.map((l: string) => l.replace(/^\S+\s+/, "")).sort(), ["b.txt", "carpeta/otro.txt", "suelto.txt"]);
  } finally { m.limpiar(); }
});

test("commitFrenteALaReferencia: en la historia, fuera de ella (se rebaseó o nunca se pusheó) o desconocido", () => {
  const m = mundo();
  try {
    assert.equal(commitFrenteALaReferencia(m.copia, m.c2, "origin/main"), "en-la-historia");
    g(m.copia, "checkout", "-q", "-b", "lateral", m.c1);
    writeFileSync(join(m.copia, "l.txt"), "l\n"); g(m.copia, "add", "l.txt"); g(m.copia, "commit", "-q", "-m", "lateral");
    const lateral = g(m.copia, "rev-parse", "HEAD").trim();
    g(m.copia, "checkout", "-q", "main");
    assert.equal(commitFrenteALaReferencia(m.copia, lateral, "origin/main"), "fuera-de-la-historia");
    assert.equal(commitFrenteALaReferencia(m.copia, "0123456789abcdef0123456789abcdef01234567", "origin/main"), "ausente");
    assert.equal(commitFrenteALaReferencia(m.copia, undefined, "origin/main"), "desconocido");
  } finally { m.limpiar(); }
});
