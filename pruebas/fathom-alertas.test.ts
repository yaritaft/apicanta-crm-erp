import test from "node:test";
import assert from "node:assert/strict";
import { avisosDeConexion, avisosDeGrabacionesPrivadas, barridoParado, HORAS_PARA_AVISAR, porCloser, queNoLlegan } from "@/lib/fathom-alertas";

/* Que no vuelva a pasar en silencio (26/10): una grabación en privado o un barrido parado se lo dicen a quien puede arreglarlo. */

const AHORA = Date.parse("2026-10-27T15:00:00.000Z");
const hace = (h: number) => new Date(AHORA - h * 3600_000).toISOString();
const hash = (s: string) => `h_${s}`;

test("sólo cuentan las que llevan más de 36 horas: Fathom tarda y el closer pega el link al día siguiente", () => {
  const p = [{ id: "a", inicia: hace(10) }, { id: "b", inicia: hace(HORAS_PARA_AVISAR) }, { id: "c", inicia: hace(100) }, { id: "d", inicia: "no es fecha" }];
  assert.deepEqual(queNoLlegan(p, AHORA).map((x) => x.id), ["b", "c"]);
});

test("por closer, la más vieja primero y el que más tiene arriba", () => {
  const g = porCloser([
    { id: "1", inicia: hace(50), anfitrion: "Dante Barbieri" }, { id: "2", inicia: hace(90), anfitrion: "Mariano Arias" },
    { id: "3", inicia: hace(70), anfitrion: "Mariano Arias" }, { id: "4", inicia: hace(60), anfitrion: null },
  ]);
  assert.deepEqual(g.map((x) => [x.closer, x.llamadas.map((l) => l.id)]), [["Mariano Arias", ["2", "3"]], ["Dante Barbieri", ["1"]], ["Sin closer", ["4"]]]);
});

test("el aviso del closer lleva su mail de Equipo (sin importar tildes ni mayúsculas), qué hacer y la fecha de la más vieja", () => {
  const f = avisosDeGrabacionesPrivadas(
    [{ id: "1", inicia: "2026-09-24T14:00:00.000Z", anfitrion: "Valentín Abadía" }, { id: "2", inicia: "2026-10-10T14:00:00.000Z", anfitrion: "Valentin Abadia" }],
    { closers: [{ nombre: "Valentin Abadía", email: " Vale@X.com " }, { nombre: "Dante Barbieri", email: "dante@x.com" }], supervisores: ["yari@x.com"] },
    "20261027", "20261026", hash);
  const closer = f.find((x) => x.para === "vale@x.com")!;
  assert.equal(closer.id, "av_fathom_closer_20261027_h_vale@x.com");
  assert.match(closer.titulo, /^2 grabaciones/);
  assert.match(closer.cuerpo, /del 24\/09/);
  assert.match(closer.cuerpo, /Visible to Sales Only/);
  assert.equal(f.find((x) => x.para === "dante@x.com"), undefined, "a quien no tiene llamadas, nada");
  const sup = f.find((x) => x.para === "yari@x.com")!;
  assert.equal(sup.id, "av_fathom_resumen_20261026_h_yari@x.com", "el resumen es por semana");
  assert.match(sup.cuerpo, /Valentín Abadía 2/);
});

test("un closer sin mail en Equipo no recibe aviso, pero los supervisores sí lo saben", () => {
  const f = avisosDeGrabacionesPrivadas([{ id: "1", inicia: hace(80), anfitrion: "Martín" }], { closers: [{ nombre: "Martín", email: "" }], supervisores: ["yari@x.com", "YARI@x.com", "sin-mail"] }, "20261027", "20261026", hash);
  assert.deepEqual(f.map((x) => x.para), ["yari@x.com"]);
  assert.deepEqual(avisosDeGrabacionesPrivadas([], { closers: [], supervisores: ["yari@x.com"] }, "d", "s", hash), []);
});

test("los avisos de conexión van a los dueños, uno por motivo y por día", () => {
  const e = avisosDeConexion({ tipo: "error", mensaje: "Fathom no aceptó la clave (FATHOM_API_KEY)." }, ["yari@x.com", "yari@x.com"], "20261027", hash);
  assert.equal(e.length, 1);
  assert.equal(e[0].id, "av_fathom_error_20261027_h_yari@x.com");
  assert.match(e[0].cuerpo, /no aceptó la clave/);
  const p = avisosDeConexion({ tipo: "parado", desde: "2026-10-20T10:00:00.000Z" }, ["yari@x.com"], "20261027", hash);
  assert.match(p[0].cuerpo, /el 20\/10/);
});

test("un barrido completo parado: hay llamadas esperando y el último completo es de hace más de 72 horas", () => {
  assert.equal(barridoParado(hace(24), 5, AHORA), false);
  assert.equal(barridoParado(hace(80), 5, AHORA), true);
  assert.equal(barridoParado(null, 5, AHORA), false, "recién instalado: el primer barrido completo todavía no terminó");
  assert.equal(barridoParado(hace(500), 0, AHORA), false, "sin llamadas esperando no hay nada parado");
});

test("el resumen para los supervisores nombra a los 10 con más llamadas y dice cuántos más hay", () => {
  const pend = Array.from({ length: 15 }, (_, i) => Array.from({ length: i + 1 }, (_, j) => ({ id: `${i}_${j}`, inicia: hace(100), anfitrion: `Closer ${i}` }))).flat();
  const f = avisosDeGrabacionesPrivadas(pend, { closers: [], supervisores: ["yari@x.com"] }, "d", "s", hash);
  assert.equal(f.length, 1);
  assert.match(f[0].cuerpo, /Closer 14 15 · Closer 13 14/);
  assert.match(f[0].cuerpo, /y 5 más/);
  assert.doesNotMatch(f[0].cuerpo, /Closer 0 1/);
});
