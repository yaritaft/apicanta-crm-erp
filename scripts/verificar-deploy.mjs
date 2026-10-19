#!/usr/bin/env node
/* ==================================================================
   Guardia de publicación del ERP.

   Por qué existe: el 19/10/2026 un deploy hecho desde una copia vieja
   dejó producción sin tres commits que ya estaban publicados, y nadie se
   enteró hasta comparar los archivos uno por uno. Este script hace esa
   comparación antes y después de publicar.

     node scripts/verificar-deploy.mjs antes    [--dir <carpeta>]
     vercel deploy --prod --yes --cwd <carpeta>
     node scripts/verificar-deploy.mjs despues  [--dir <carpeta>] [--texto "algo del cambio"]...

     node scripts/verificar-deploy.mjs comparar   (sólo mira: producción contra origin/main)

   antes     Falla (código 1) si la carpeta no es exactamente origin/main
             (otro commit, commits sin pushear, archivos sin commitear) o si
             producción tiene algo que origin/main no tiene y se perdería.
   despues   Espera a que producción esté lista, comprueba que sea el commit
             publicado y que sus archivos sean idénticos, y busca los textos
             que se pasen con --texto en los bundles públicos.
   comparar  Informe de producción contra origin/main, sin exigir nada de la carpeta.

   Opciones: --dir (por defecto, la carpeta actual) · --ref (origin/main) ·
             --dominio (apicanta-erp.vercel.app) · --ruta (/ajustes, para --texto) ·
             --deploy (dpl_… : con `comparar`, investiga ese deployment en vez del de producción) ·
             --sin-fetch (no actualiza origin; sólo para pruebas).
   Códigos de salida: 0 bien · 1 hay que frenar · 2 no se pudo verificar.
   Sin dependencias: sólo node, git y la CLI de Vercel logueada en la cuenta correcta.
   ================================================================== */

import { resolve } from "node:path";
import { aplanarArbol } from "./deploy/arbol.mjs";
import { commitFrenteALaReferencia, corto, estadoDeLaCopia, git, resolver } from "./deploy/git.mjs";
import { compararConProduccion, textoDelInforme } from "./deploy/informe.mjs";
import { arbolDelDeploy, buscarEnBundles, deployDelDominio, DOMINIO, esperarProduccionLista, proyectoDe } from "./deploy/vercel.mjs";

function leerArgumentos(argv) {
  const [comando, ...resto] = argv;
  const o = { comando, dir: process.cwd(), ref: "origin/main", dominio: DOMINIO, ruta: "/ajustes", textos: [], fetch: true };
  for (let i = 0; i < resto.length; i += 1) {
    const a = resto[i];
    if (a === "--dir") o.dir = resolve(resto[++i]);
    else if (a === "--ref") o.ref = resto[++i];
    else if (a === "--dominio") o.dominio = resto[++i];
    else if (a === "--deploy") o.deploy = resto[++i];
    else if (a === "--ruta") o.ruta = resto[++i];
    else if (a === "--texto") o.textos.push(resto[++i]);
    else if (a === "--sin-fetch") o.fetch = false;
    else throw new Error(`No entiendo «${a}». Mirá el encabezado de scripts/verificar-deploy.mjs.`);
  }
  return o;
}

const decir = (...l) => console.log(...l);
const hora = (ms) => new Date(ms).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

function actualizarOrigin(o) {
  if (!o.fetch) return;
  const [remoto, rama] = o.ref.includes("/") ? o.ref.split("/") : ["origin", o.ref];
  git(o.dir, ["fetch", "--quiet", remoto, rama]);
}

function produccionAhora(o, proyecto) {
  /* --deploy mira otro deployment (dpl_… o su URL): sirve para investigar uno viejo. */
  const servido = deployDelDominio(o.deploy || o.dominio, proyecto.orgId);
  return { servido, arbol: aplanarArbol(arbolDelDeploy(servido.id, proyecto.orgId)) };
}

function cabecera(servido, ref, refSha, dir) {
  decir(`  Producción  ${servido.id} · ${servido.estado} · ${servido.creado ? hora(servido.creado) : "?"} · commit ${servido.commit ? servido.commit.slice(0, 7) : "?"} «${(servido.mensaje || "").slice(0, 70)}»`);
  decir(`  Referencia  ${ref} = ${corto(dir, refSha)}`);
  const frente = commitFrenteALaReferencia(dir, servido.commit, refSha);
  if (frente === "fuera-de-la-historia") decir(`  ⚠ el commit publicado (${servido.commit.slice(0, 7)}) NO es parte de la historia de ${ref}: se publicó algo que no se pusheó, o se rebaseó después.`);
  if (frente === "ausente") decir(`  ⚠ este repo no conoce el commit publicado (${servido.commit.slice(0, 7)}): se publicó desde un commit que nunca se pusheó.`);
}

/* ---------- comparar ---------- */

function comparar(o) {
  actualizarOrigin(o);
  const proyecto = proyectoDe(o.dir);
  const refSha = resolver(o.dir, o.ref);
  const { servido, arbol } = produccionAhora(o, proyecto);
  decir("Producción contra", o.ref);
  cabecera(servido, o.ref, refSha, o.dir);
  const inf = compararConProduccion({ dir: o.dir, ref: refSha, produccion: arbol });
  textoDelInforme(inf, o.ref).forEach((l) => decir(l));
  return { inf, servido, refSha };
}

/* ---------- antes ---------- */

function antes(o) {
  actualizarOrigin(o);
  const bloqueos = [];
  decir(`Antes de publicar · carpeta ${o.dir}`);
  const copia = estadoDeLaCopia(o.dir, o.ref);
  decir(`  Carpeta     HEAD = ${corto(o.dir, copia.head)} · ${o.ref} = ${corto(o.dir, copia.refSha)}`);

  if (copia.relacion === "igual") decir(`  ✔ la carpeta es exactamente ${o.ref}`);
  if (copia.relacion === "atrasada" || copia.relacion === "divergente") {
    bloqueos.push(`a la carpeta le faltan ${copia.atras.length} commit(s) de ${o.ref}: publicarla pisaría lo que ya está en main`);
    decir(`  ✖ le faltan commits de ${o.ref}:`);
    copia.atras.slice(0, 8).forEach((l) => decir(`      · ${l}`));
  }
  if (copia.relacion === "adelantada" || copia.relacion === "divergente") {
    bloqueos.push(`la carpeta tiene ${copia.adelante.length} commit(s) que no están en ${o.ref}: pusheálos antes de publicar`);
    decir(`  ✖ tiene commits que ${o.ref} no tiene (sin pushear):`);
    copia.adelante.slice(0, 8).forEach((l) => decir(`      · ${l}`));
  }
  if (copia.sucios.length) {
    bloqueos.push(`${copia.sucios.length} archivo(s) sin commitear: la CLI los subiría tal cual`);
    decir("  ✖ archivos sin commitear (se publicarían igual):");
    copia.sucios.slice(0, 12).forEach((l) => decir(`      · ${l}`));
  } else decir("  ✔ sin archivos sin commitear");

  const proyecto = proyectoDe(o.dir);
  decir(`  ✔ apunta al proyecto ${proyecto.projectId}`);

  decir("");
  const { inf, servido } = comparar({ ...o, fetch: false });
  if (!inf.ok) bloqueos.push(`producción tiene ${inf.seperderia.length} archivo(s) que ${o.ref} no tiene y se perderían`);

  decir("");
  if (bloqueos.length) {
    decir("✖ NO publiques todavía:");
    bloqueos.forEach((b) => decir(`   - ${b}`));
    decir("  Arreglá eso (copia limpia de origin/main, commits pusheados) y volvé a correr este comando.");
    return 1;
  }
  decir(`✔ Se puede publicar. Siguiente paso:\n    vercel deploy --prod --yes --cwd ${o.dir}\n  y después:\n    node scripts/verificar-deploy.mjs despues --dir ${o.dir} --texto "<algo del cambio>"`);
  void servido;
  return 0;
}

/* ---------- despues ---------- */

async function despues(o) {
  actualizarOrigin(o);
  const proyecto = proyectoDe(o.dir);
  const publicado = resolver(o.dir, "HEAD");
  decir(`Después de publicar · esperado: commit ${corto(o.dir, publicado)} de ${o.dir}`);

  const espera = await esperarProduccionLista({ projectId: proyecto.projectId, teamId: proyecto.orgId, dominio: o.dominio, aviso: (t) => decir(`  ${t}`) });
  if (!espera.ok) { decir(`✖ ${espera.motivo}.`); return 1; }
  const servido = espera.servido;
  const fallos = [];
  decir(`  ✔ ${o.dominio} sirve ${servido.id} (READY)`);

  if (servido.commit === publicado) decir(`  ✔ es el commit publicado (${corto(o.dir, publicado)})`);
  else {
    fallos.push(`producción sirve el commit ${servido.commit ? servido.commit.slice(0, 7) : "desconocido"} y publicaste ${corto(o.dir, publicado)}: otra sesión publicó después, o este deploy no salió`);
    decir(`  ✖ ${fallos[fallos.length - 1]}`);
  }

  const arbol = aplanarArbol(arbolDelDeploy(servido.id, proyecto.orgId));
  const inf = compararConProduccion({ dir: o.dir, ref: publicado, produccion: arbol });
  textoDelInforme(inf, corto(o.dir, publicado)).forEach((l) => decir(l));
  if (!inf.identica) fallos.push("los archivos de producción no son idénticos al commit publicado");

  if (o.textos.length) {
    const { archivos, hallado } = await buscarEnBundles({ dominio: o.dominio, ruta: o.ruta, textos: o.textos });
    decir(`  Bundles de ${o.ruta}: ${archivos} archivos`);
    for (const [texto, archivo] of hallado) {
      if (archivo) decir(`  ✔ «${texto}» está en ${archivo}`);
      else { decir(`  ✖ «${texto}» NO aparece en los bundles (¿la ruta es la que lo carga? --ruta)`); fallos.push(`falta «${texto}»`); }
    }
  }

  decir("");
  if (fallos.length) { decir("✖ La publicación no quedó como se esperaba:"); fallos.forEach((f) => decir(`   - ${f}`)); return 1; }
  decir("✔ Producción quedó como el commit publicado.");
  return 0;
}

/* ---------- main ---------- */

async function main() {
  const o = leerArgumentos(process.argv.slice(2));
  if (o.comando === "comparar") { const { inf } = comparar(o); return inf.ok ? 0 : 1; }
  if (o.comando === "antes") return antes(o);
  if (o.comando === "despues") return despues(o);
  console.error("Uso: node scripts/verificar-deploy.mjs <antes|despues|comparar> [--dir <carpeta>] [--texto <texto>]…\nMás en el encabezado del archivo.");
  return 2;
}

main().then((c) => process.exit(c), (e) => { console.error(`✖ No pude verificar: ${e.message}`); process.exit(2); });
