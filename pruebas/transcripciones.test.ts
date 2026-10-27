import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, crearZip } from "@/lib/zip";
import { armarPaquete, documentoDeLlamada, leemeDeDescarga, nombreSeguro, resumenDeDescarga, textoDeTranscripcion, tieneLinkDeFathom, type GrabacionDeTranscripcion, type LlamadaParaTranscribir } from "@/lib/transcripciones";

/* Bajar las transcripciones de Fathom de todo un webinar juntas, para llevarlas a Claude (Santi, 26/10). */

const llamada = (p: Partial<LlamadaParaTranscribir> & { sesionId: string }): LlamadaParaTranscribir => ({
  nombre: "Ana Pérez", inicia: "2026-10-22T15:00:00.000Z", closer: "Mariano", estado: "Compra Full", link: "https://fathom.video/share/abc", ...p,
});
const grabacion = (sesionId: string, frases: [string, string, string][]): GrabacionDeTranscripcion => ({
  sesionId, titulo: "Llamada", shareUrl: `https://fathom.video/share/${sesionId}`, grabadaDesde: "2026-10-22T15:00:00.000Z", grabadaHasta: "2026-10-22T15:48:00.000Z",
  grabadoPorNombre: "Mariano", resumen: "## Resumen\n- Compró", transcripcion: frases.map(([quien, t, texto]) => ({ quien, t, texto })),
});

test("el zip se abre con unzip, con el contenido (con tildes) intacto (comprimido y sin comprimir)", async () => {
  const grande = "línea de prueba con ñ y tildes áéíóú\n".repeat(2000);
  const zip = await crearZip([
    { nombre: "llamadas/2026-10-22_ana-perez.md", contenido: grande },
    { nombre: "vacio.txt", contenido: "" },
    { nombre: "chico.txt", contenido: "a" },
  ]);
  const dir = mkdtempSync(join(tmpdir(), "zip-"));
  writeFileSync(join(dir, "t.zip"), zip);
  assert.match(execFileSync("unzip", ["-t", join(dir, "t.zip")]).toString(), /No errors detected/);
  execFileSync("unzip", ["-qq", "-o", join(dir, "t.zip"), "-d", join(dir, "afuera")]);
  assert.equal(readFileSync(join(dir, "afuera", "llamadas", "2026-10-22_ana-perez.md"), "utf8"), grande);
  assert.equal(readFileSync(join(dir, "afuera", "chico.txt"), "utf8"), "a");
  assert.ok(zip.length < grande.length / 5, "el texto repetido se comprime");
});

test("el CRC-32 es el estándar", () => {
  assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
});

test("la transcripción junta lo que dice seguido cada persona", () => {
  assert.equal(textoDeTranscripcion([
    { quien: "Mariano", t: "00:00:01", texto: "Hola Ana." },
    { quien: "Mariano", t: "00:00:04", texto: "¿Cómo estás?" },
    { quien: "Ana", t: "00:00:07", texto: "Bien." },
    { quien: "", t: "00:00:09", texto: "Eco" },
  ]), "[00:00:01] Mariano: Hola Ana. ¿Cómo estás?\n[00:00:07] Ana: Bien.\n[00:00:09] —: Eco");
});

test("un nombre de archivo seguro: sin tildes, sin símbolos", () => {
  assert.equal(nombreSeguro("José Ñandú / López"), "jose-nandu-lopez");
  assert.equal(nombreSeguro("???"), "sin-nombre");
});

test("el documento de una llamada trae quién, cuándo, cómo terminó, el resumen y la transcripción; sin teléfono ni mail", () => {
  const doc = documentoDeLlamada(llamada({ sesionId: "s1" }), [grabacion("s1", [["Mariano", "00:00:01", "Hola"]])]);
  assert.match(doc, /^# Llamada con Ana Pérez/);
  assert.match(doc, /- Fecha: 2026-10-22/);
  assert.match(doc, /- Closer: Mariano/);
  assert.match(doc, /- Estado de la llamada: Compra Full/);
  assert.match(doc, /- Duración: 48 min/);
  assert.match(doc, /- Grabación: https:\/\/fathom\.video\/share\/s1/);
  assert.match(doc, /## Resumen de Fathom\n\n## Resumen\n- Compró/);
  assert.match(doc, /## Transcripción\n\n\[00:00:01\] Mariano: Hola/);
  assert.doesNotMatch(doc, /@|\+54/);
  /* Los links al minuto del resumen no van: queda el texto. */
  const conLinks = documentoDeLlamada(llamada({ sesionId: "s1" }), [{ ...grabacion("s1", [["M", "00:00:01", "Hola"]]), resumen: "- [**Meta:** conseguir trabajo](https://fathom.video/share/x?tab=summary&timestamp=163.0)" }]);
  assert.match(conLinks, /- \*\*Meta:\*\* conseguir trabajo\n/);
  assert.doesNotMatch(conLinks, /timestamp=/);
});

test("el paquete: las que tienen transcripción van en un archivo cada una y en todas-juntas; el índice dice por qué faltan las otras", () => {
  const llamadas = [
    llamada({ sesionId: "s1", nombre: "Ana Pérez" }),
    llamada({ sesionId: "s2", nombre: "Ana Pérez", inicia: "2026-10-22T18:00:00.000Z" }),
    llamada({ sesionId: "s3", nombre: "Beto", link: "https://fathom.video/share/zzz", inicia: "2026-10-21T10:00:00.000Z" }),
    llamada({ sesionId: "s4", nombre: "Cata", link: null, inicia: "2026-10-23T10:00:00.000Z" }),
  ];
  const gs = new Map([["s1", [grabacion("s1", [["M", "00:00:01", "Uno"]])]], ["s2", [grabacion("s2", [["M", "00:00:01", "Dos"]])]]]);
  const p = armarPaquete(llamadas, gs);
  assert.deepEqual([p.total, p.conTranscripcion, p.linkSinTranscripcion, p.sinLink, p.noSeHicieron, p.sinLinkHechas], [4, 2, 1, 1, 0, 1]);
  const nombres = p.archivos.map((a) => a.nombre);
  /* Dos llamadas el mismo día de la misma persona no se pisan. */
  assert.deepEqual(nombres, ["LEEME.md", "indice.csv", "resumenes.md", "todas-juntas.md", "llamadas/2026-10-22_ana-perez.md", "llamadas/2026-10-22_ana-perez-2.md"]);
  const juntas = String(p.archivos[3].contenido);
  assert.ok(juntas.indexOf("Uno") < juntas.indexOf("Dos") && juntas.includes("\n---\n"));
  const indice = String(p.archivos[1].contenido);
  assert.match(indice, /Tiene el link de Fathom, pero la app todavía no pudo traer su transcripción/);
  assert.match(indice, /La llamada se hizo pero el closer no pegó el link de Fathom/);
  assert.ok(indice.startsWith("﻿"));
  assert.equal(resumenDeDescarga(p), "Se bajaron 2 transcripciones de 4 llamadas; 1 se hizo pero no tiene link de Fathom · 1 tiene el link pero está privada en Fathom (el motivo de cada una está en indice.csv).");
});

test("el link de Fathom: sólo el compartido cuenta", () => {
  assert.equal(tieneLinkDeFathom("https://fathom.video/share/abc"), true);
  assert.equal(tieneLinkDeFathom("https://drive.google.com/file/x"), false);
  assert.equal(tieneLinkDeFathom(undefined), false);
});

test("el resultado de cada llamada (compró o no) va en el documento, el índice y el LEEME, y el resumen en su archivo liviano", () => {
  const llamadas = [
    llamada({ sesionId: "s1", nombre: "Ana", resultado: "Con cierre" }),
    llamada({ sesionId: "s2", nombre: "Beto", resultado: "Sin cierre", inicia: "2026-10-25T15:00:00.000Z" }),
    llamada({ sesionId: "s3", nombre: "Cata", resultado: "No se presentó", link: null, inicia: "2026-10-26T15:00:00.000Z" }),
  ];
  const gs = new Map([["s1", [grabacion("s1", [["M", "00:00:01", "Uno"]])]], ["s2", [grabacion("s2", [["M", "00:00:01", "Dos"]])]]]);
  const p = armarPaquete(llamadas, gs);
  assert.equal(p.compraron, 1);
  assert.deepEqual([p.desde, p.hasta], ["2026-10-22", "2026-10-25"]);
  const texto = (n: string) => String(p.archivos.find((a) => a.nombre === n)!.contenido);
  assert.match(texto("llamadas/2026-10-22_ana.md"), /- Resultado: Compró/);
  assert.match(texto("llamadas/2026-10-25_beto.md"), /- Resultado: No compró/);
  assert.match(texto("indice.csv"), /"Resultado"/);
  assert.match(texto("indice.csv"), /"No se presentó"/);
  assert.match(texto("resumenes.md"), /## 2026-10-22 · Ana · Mariano · Compró\n\n## Resumen\n- Compró/);
  assert.match(texto("LEEME.md"), /2 transcripciones de 3 llamadas, del 2026-10-22 al 2026-10-25\. 1 terminaron en compra/);
  assert.match(texto("LEEME.md"), /Claude Code o Cowork/);
  assert.match(leemeDeDescarga({ conTranscripcion: 0, total: 0, compraron: 0, noSeHicieron: 0, sinLinkHechas: 0, linkSinTranscripcion: 0 }), /0 transcripciones de 0 llamadas\./);
});

test("el índice distingue las llamadas que no se hicieron (canceladas, no show, reprogramadas) de las que se hicieron y no tienen link", () => {
  const sin = (id: string, resultado?: string) => llamada({ sesionId: id, nombre: id, link: null, resultado, inicia: `2026-10-2${id.length}T10:00:00.000Z` });
  const p = armarPaquete([sin("a", "Cancelada"), sin("bb", "No se presentó"), sin("ccc", "Reprogramó"), sin("dddd", "Sin cargar"), sin("eeeee", "Con cierre"), sin("ffffff", undefined)], new Map());
  assert.deepEqual([p.total, p.sinLink, p.noSeHicieron, p.sinLinkHechas], [6, 6, 3, 3]);
  const indice = String(p.archivos.find((a) => a.nombre === "indice.csv")!.contenido);
  assert.match(indice, /La llamada se canceló: no hay grabación/);
  assert.match(indice, /La persona no se presentó: no hay grabación/);
  assert.match(indice, /Se reprogramó/);
  assert.match(indice, /Nadie cargó cómo terminó la llamada y no tiene link de Fathom/);
  assert.equal((indice.match(/La llamada se hizo pero el closer no pegó el link de Fathom/g) ?? []).length, 2);
  assert.match(resumenDeDescarga(p), /3 no se hicieron \(canceladas, no se presentaron o reprogramadas\) · 3 se hicieron pero no tienen link de Fathom/);
  assert.match(String(p.archivos[0].contenido), /3 no se hicieron .* 3 se hicieron pero el closer no pegó el link/);
});
