import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, crearZip } from "@/lib/zip";
import { armarPaquete, documentoDeLlamada, nombreSeguro, resumenDeDescarga, textoDeTranscripcion, tieneLinkDeFathom, type GrabacionDeTranscripcion, type LlamadaParaTranscribir } from "@/lib/transcripciones";

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
  assert.deepEqual([p.total, p.conTranscripcion, p.linkSinTranscripcion, p.sinLink], [4, 2, 1, 1]);
  const nombres = p.archivos.map((a) => a.nombre);
  /* Dos llamadas el mismo día de la misma persona no se pisan. */
  assert.deepEqual(nombres, ["indice.csv", "todas-juntas.md", "llamadas/2026-10-22_ana-perez.md", "llamadas/2026-10-22_ana-perez-2.md"]);
  const juntas = String(p.archivos[1].contenido);
  assert.ok(juntas.indexOf("Uno") < juntas.indexOf("Dos") && juntas.includes("\n---\n"));
  const indice = String(p.archivos[0].contenido);
  assert.match(indice, /Tiene el link de Fathom, pero la app todavía no pudo traer su transcripción/);
  assert.match(indice, /No tiene link de Fathom/);
  assert.ok(indice.startsWith("﻿"));
  assert.equal(resumenDeDescarga(p), "Se bajaron 2 transcripciones de 4 llamadas; 1 no tiene link de Fathom y 1 tiene el link pero su transcripción todavía no llegó (están en indice.csv).");
});

test("el link de Fathom: sólo el compartido cuenta", () => {
  assert.equal(tieneLinkDeFathom("https://fathom.video/share/abc"), true);
  assert.equal(tieneLinkDeFathom("https://drive.google.com/file/x"), false);
  assert.equal(tieneLinkDeFathom(undefined), false);
});
