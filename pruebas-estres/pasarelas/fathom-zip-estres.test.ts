import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Azar, propiedad } from "./azar";
import { armarPaquete, type GrabacionDeTranscripcion, type LlamadaParaTranscribir } from "@/lib/transcripciones";
import { crearZip } from "@/lib/zip";

/* ==================================================================
   ESTRÉS · el zip de transcripciones (lib/transcripciones + lib/zip):
   2.400 llamadas, la mayoría con transcripciones de cientos de frases y
   unas pocas gigantes, nombres con símbolos, emojis, texto de derecha a
   izquierda, rutas con «../», fórmulas de Excel y 50 llamadas de la misma
   persona el mismo día. El zip tiene que abrirse con unzip, sin nombres
   peligrosos ni repetidos, y el índice tiene que decir todas las llamadas.
   ================================================================== */

const NOMBRES = ["Ana Pérez", "José Ñandú", "../../etc/passwd", "=HYPERLINK(\"http://x\",\"a\")", "+54 9 11 1234", "-cmd|' /C calc'!A0", "@SUM(1)", "😀 Emoji Man", "\u202eevil\u202c.md",
  "a".repeat(400), "", " ", "\u0000nul", "CON", "C:\\Windows\\System32", "/absoluta/ruta", "Nombre, con \"comillas\"\nsalto", "日本語の名前", "Ünïcödé Çafé"];
const QUIENES = ["Mariano Arias", "", "😀", "\u202eRTL", "x".repeat(300), "Ana\nPérez"];

function frases(az: Azar, n: number) {
  return Array.from({ length: n }, (_, i) => ({
    quien: az.pick(QUIENES), t: `00:${String(Math.floor(i / 60) % 60).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}`,
    texto: az.pick(["Hola, ¿cómo estás?", "Sí, claro.", "No sé si me da el tiempo, tengo que consultarlo con mi pareja.", "x".repeat(az.int(1, 2000)), "línea\ncon\nsaltos", "---", "## Título falso", "[link](https://fathom.video/share/x?t=1)"]),
  }));
}

function mundo(az: Azar, total: number, conTrans: number) {
  const llamadas: LlamadaParaTranscribir[] = [];
  const gs = new Map<string, GrabacionDeTranscripcion[]>();
  for (let i = 0; i < total; i++) {
    const id = `cal_${i}`;
    /* 50 de la misma persona el mismo día: los nombres de archivo no pueden pisarse. */
    const repetida = i < 50;
    llamadas.push({
      sesionId: id, nombre: repetida ? "Ana Pérez" : az.pick(NOMBRES), closer: az.pick(["Mariano Arias", "Dante Barbieri", undefined]),
      inicia: repetida ? "2026-10-22T15:00:00.000Z" : new Date(Date.parse("2026-04-01T12:00:00Z") + az.int(0, 200) * 86_400_000).toISOString(),
      estado: az.pick(["Compra Full", "Seguimiento", undefined]), resultado: az.pick(["Con cierre", "Sin cierre", "No se presentó", undefined]),
      link: az.bool(0.8) ? `https://fathom.video/share/${az.alfanum(24)}` : null,
    });
    if (i < conTrans) {
      const gigante = i % 500 === 7;
      gs.set(id, [{
        sesionId: id, titulo: "t", shareUrl: `https://fathom.video/share/${id}`, grabadaDesde: "2026-10-22T15:00:00Z", grabadaHasta: "2026-10-22T15:50:00Z", grabadoPorNombre: "M",
        resumen: az.bool(0.9) ? "## Resumen\n" + "- [**Punto:** algo](https://fathom.video/share/x?tab=summary&timestamp=1.0)\n".repeat(az.int(1, 30)) : null,
        transcripcion: frases(az, gigante ? 40_000 : az.int(50, 900)),
      }]);
    }
  }
  return { llamadas: az.mezclar(llamadas), gs };
}

/* El CSV del índice, leído de vuelta (comillas dobles y saltos de línea dentro de una celda). */
function leerCsv(t: string): string[][] {
  const filas: string[][] = []; let fila: string[] = [], celda = "", dentro = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (dentro) { if (c === '"' && t[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') dentro = false; else celda += c; }
    else if (c === '"') dentro = true;
    else if (c === ",") { fila.push(celda); celda = ""; }
    else if (c === "\r") { /* \r\n */ }
    else if (c === "\n") { fila.push(celda); filas.push(fila); fila = []; celda = ""; }
    else celda += c;
  }
  if (celda || fila.length) { fila.push(celda); filas.push(fila); }
  return filas;
}

test("2.400 llamadas (1.500 con transcripción, 5 gigantes): el zip se abre, sin nombres peligrosos ni repetidos, y el índice las dice todas", async () => {
  const az = new Azar(20261027);
  const { llamadas, gs } = mundo(az, 2400, 1500);
  const t0 = Date.now();
  const p = armarPaquete(llamadas, gs);
  const zip = await crearZip(p.archivos);
  const ms = Date.now() - t0;
  console.log(`  [estrés] ${p.archivos.length} archivos, ${(p.archivos.reduce((n, a) => n + (typeof a.contenido === "string" ? a.contenido.length : a.contenido.length), 0) / 1e6).toFixed(1)} M caracteres → zip de ${(zip.length / 1e6).toFixed(1)} MB en ${ms} ms`);
  assert.ok(ms < 90_000, `tardó ${ms} ms`);

  assert.equal(p.total, 2400);
  assert.equal(p.conTranscripcion, 1500);
  assert.equal(p.conTranscripcion + p.sinLink + p.linkSinTranscripcion, 2400);

  const nombres = p.archivos.map((a) => a.nombre);
  assert.equal(new Set(nombres).size, nombres.length, "ningún nombre repetido");
  assert.equal(nombres.length, 4 + 1500);
  for (const n of nombres) {
    assert.ok(!n.includes("..") && !n.startsWith("/") && !n.includes("\\") && !n.includes("\u0000") && !/[\u202a-\u202e]/.test(n), `nombre peligroso: ${JSON.stringify(n)}`);
    assert.ok(/^(LEEME\.md|indice\.csv|resumenes\.md|todas-juntas\.md|llamadas\/\d{4}-\d{2}-\d{2}_[a-z0-9-]{1,80}\.md)$/.test(n), `nombre raro: ${JSON.stringify(n)}`);
  }
  /* Las 50 de Ana el mismo día están todas. */
  assert.equal(nombres.filter((n) => n.startsWith("llamadas/2026-10-22_ana-perez")).length, 50);

  const dir = mkdtempSync(join(tmpdir(), "zip-estres-"));
  writeFileSync(join(dir, "t.zip"), zip);
  assert.match(execFileSync("unzip", ["-t", join(dir, "t.zip")], { maxBuffer: 1 << 28 }).toString(), /No errors detected/);
  const listado = execFileSync("unzip", ["-Z1", join(dir, "t.zip")], { maxBuffer: 1 << 28 }).toString().split("\n").filter(Boolean);
  assert.deepEqual(listado.sort(), [...nombres].sort());

  const indice = leerCsv(String(p.archivos.find((a) => a.nombre === "indice.csv")!.contenido).replace(/^\uFEFF/, ""));
  assert.equal(indice.length, 2401, "una fila por llamada más la cabecera");
  assert.ok(indice.every((f) => f.length === 9), "todas las filas tienen sus 9 columnas aunque el nombre traiga comillas o saltos de línea");
  assert.equal(indice.filter((f, i) => i > 0 && f[6] === "Sí").length, 1500);
  /* Una celda que empieza con = + - @ no se ejecuta como fórmula en Excel. */
  assert.ok(indice.slice(1).every((f) => !/^[=+\-@]/.test(f[1]) || /^'/.test(f[1]) || /^\+\d[\d\s]*$/.test(f[1])), "sin fórmulas sueltas");
  assert.ok(process.memoryUsage().heapUsed < 3e9, "memoria razonable");
});

test("al azar: llamadas sin nada, con todo vacío o con texto gigante nunca rompen el armado", propiedad("zip al azar", 25, async (az) => {
  const total = az.int(0, 60);
  const { llamadas, gs } = mundo(az, total, az.int(0, total));
  /* Basura en las grabaciones: sin frases, resumen vacío, grabaciones repetidas de la misma llamada. */
  for (const [id, lista] of gs) if (az.bool(0.2)) gs.set(id, [...lista, { ...lista[0], transcripcion: az.bool() ? [] : null, resumen: "" }]);
  const p = armarPaquete(llamadas, gs);
  assert.equal(p.total, total);
  assert.ok(p.conTranscripcion <= total && p.conTranscripcion >= 0);
  const zip = await crearZip(p.archivos);
  assert.ok(zip.length > 22, "al menos el cierre del zip");
  assert.equal(new Set(p.archivos.map((a) => a.nombre)).size, p.archivos.length);
}));

test("las alertas con 20.000 llamadas esperando y 300 closers: rápido, un aviso por closer y ninguno repetido", async () => {
  const { avisosDeGrabacionesPrivadas, queNoLlegan } = await import("@/lib/fathom-alertas");
  const az = new Azar(31);
  const closers = Array.from({ length: 300 }, (_, i) => ({ nombre: `Closer Número${i}`, email: `c${i}@x.com` }));
  const pend = Array.from({ length: 20_000 }, (_, i) => ({ id: `cal_${i}`, inicia: new Date(Date.now() - az.int(1, 4000) * 3600_000).toISOString(), anfitrion: az.pick(closers).nombre }));
  const t0 = Date.now();
  const sin = queNoLlegan(pend, Date.now());
  const filas = avisosDeGrabacionesPrivadas(sin, { closers, supervisores: ["yari@x.com", "santi@x.com"] }, "20261027", "20261026", (s) => s);
  assert.ok(Date.now() - t0 < 2000, "tardó de más");
  assert.equal(new Set(filas.map((f) => f.id)).size, filas.length, "ids únicos");
  assert.equal(filas.filter((f) => f.id.startsWith("av_fathom_closer_")).length, new Set(sin.map((p) => p.anfitrion)).size);
  assert.equal(filas.filter((f) => f.id.startsWith("av_fathom_resumen_")).length, 2);
  assert.ok(filas.every((f) => f.cuerpo.length < 5000), "los avisos no crecen con la cantidad de llamadas");
});
