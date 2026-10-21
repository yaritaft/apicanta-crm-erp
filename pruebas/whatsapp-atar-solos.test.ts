import test from "node:test";
import assert from "node:assert/strict";
import { gruposParaAtarSolos } from "@/lib/whatsapp";
import { atarGruposSolos, leerAccion, RepoMemoria } from "@/lib/whatsapp-servidor";
import { atarSolosAlCrear, ErrorWhatsapp } from "@/lib/whatsapp-cliente";

/* Los grupos de WhatsApp se atan solos a su webinar (21/10): el nombre trae la fecha completa («Taller Online 21/10/26 #1») y eso alcanza.
   Sólo lo seguro: con año, un único webinar ese día, y nunca se pisa lo atado a mano. */

/* Los vivos son a las 19 de Argentina = 22:00 UTC. */
const W = (id: string, fecha: string) => ({ id, titulo: `Taller ${id}`, fecha });
const w2110 = W("w2110", "2026-10-21T22:00:00.000Z");
const g = (id: string, nombre: string, webinarId: string | null = null) => ({ id, nombre, webinarId });
const ids = (r: { grupoId: string; webinarId: string }[]) => r.map((x) => `${x.grupoId}→${x.webinarId}`);

test("un grupo que dice la fecha completa se ata al webinar de ese día, y todos los #1, #2… del mismo taller van al mismo", () => {
  const r = gruposParaAtarSolos([g("a", "Taller Online 21/10/26 #1"), g("b", "Taller Online 21/10/26 #2"), g("c", "Taller online 21/10/2026")], [w2110]);
  assert.deepEqual(ids(r), ["a→w2110", "b→w2110", "c→w2110"]);
  assert.match(r[0].motivo, /21\/10\/2026/);
});

test("cuenta el día de Argentina: un vivo de las 22:30 sigue siendo de ese día aunque en UTC ya sea el siguiente", () => {
  const tarde = W("t", "2026-10-22T01:30:00.000Z"); /* 21/10 a las 22:30 en Argentina */
  assert.deepEqual(ids(gruposParaAtarSolos([g("a", "Taller Online 21/10/26 #1")], [tarde])), ["a→t"]);
});

test("también se entienden las otras formas de escribir la fecha, siempre que traigan el año", () => {
  const junio = W("j", "2026-06-10T22:00:00.000Z");
  assert.deepEqual(ids(gruposParaAtarSolos([g("a", "Taller Online 10-06-26 #1"), g("b", "Taller 10 de junio de 2026"), g("c", "Taller 2026-06-10")], [junio])), ["a→j", "b→j", "c→j"]);
});

test("sin año no se adivina: «11/12» o «21 Agosto» pueden ser de otro año, y eso lo confirma una persona", () => {
  const dic = W("d", "2026-12-11T22:00:00.000Z");
  assert.deepEqual(gruposParaAtarSolos([g("a", "Taller Online 11/12 19 HS (ARG)"), g("b", "Taller Online 21 Agosto"), g("c", "Taller Online 11 diciembre")], [dic]), []);
});

test("con otro año no se ata, y sin ninguna fecha tampoco", () => {
  assert.deepEqual(gruposParaAtarSolos([g("a", "Taller online 21/10/25"), g("b", "Yari Taft - taller online #1"), g("c", "")], [w2110]), []);
});

test("si hay dos webinars el mismo día no se ata a ninguno (no se sabe cuál es)", () => {
  assert.deepEqual(gruposParaAtarSolos([g("a", "Taller Online 21/10/26 #1")], [w2110, W("otro", "2026-10-21T15:00:00.000Z")]), []);
});

test("un nombre con dos fechas de webinars distintos no se ata; con dos fechas del mismo sí", () => {
  const w2210 = W("w2210", "2026-10-22T22:00:00.000Z");
  assert.deepEqual(gruposParaAtarSolos([g("a", "Taller 21/10/26 y 22/10/26")], [w2110, w2210]), []);
  assert.deepEqual(ids(gruposParaAtarSolos([g("a", "Taller 21/10/26 (21-10-2026)")], [w2110, w2210])), ["a→w2110"]);
});

test("lo que ya está atado (a mano, aunque sea a otro webinar) no se toca", () => {
  const otro = W("otro", "2026-11-04T22:00:00.000Z");
  assert.deepEqual(gruposParaAtarSolos([g("a", "Taller Online 21/10/26 #1", "otro")], [w2110, otro]), []);
});

test("atarGruposSolos: ata lo que corresponde, lo deja asentado y no repite ni pisa nada", async () => {
  const repo = new RepoMemoria();
  for (const [id, nombre] of [["a", "Taller Online 21/10/26 #1"], ["b", "Taller Online 21/10/26 #2"], ["c", "Taller Online 04/11/26 #1"], ["d", "Taller Online 14 Agosto #1"], ["e", "Taller Online 21/10/26 #3"]]) {
    await repo.guardarGrupo({ id, nombre, miembros: 10 });
  }
  await repo.atarGrupo("e", "manual"); /* alguien lo ató a mano a otro lado */
  const r1 = await atarGruposSolos(repo, [w2110]);
  assert.deepEqual(ids(r1.atados), ["a→w2110", "b→w2110"].sort((x, y) => ids(r1.atados).indexOf(x) - ids(r1.atados).indexOf(y)), "los dos grupos del 21/10");
  assert.equal(r1.atados.length, 2);
  assert.deepEqual(r1.fallidos, []);
  assert.deepEqual(r1.webinarsVistos, ["w2110"]);
  const estado = new Map((await repo.leerGrupos()).map((x) => [x.id, x.webinarId]));
  assert.deepEqual([estado.get("a"), estado.get("b"), estado.get("c"), estado.get("d"), estado.get("e")], ["w2110", "w2110", null, null, "manual"]);
  /* Otra vez: no hay nada más que atar. */
  const r2 = await atarGruposSolos(repo, [w2110]);
  assert.deepEqual(r2.atados, []);
  /* Cuando aparece el webinar del 04/11, el grupo que lo esperaba se ata solo. */
  const r3 = await atarGruposSolos(repo, [w2110, W("w0411", "2026-11-04T22:00:00.000Z")]);
  assert.deepEqual(ids(r3.atados), ["c→w0411"]);
});

test("atarGruposSolos: si alguien ató el grupo entre que se miró y que se escribe, no se pisa", async () => {
  const repo = new RepoMemoria();
  await repo.guardarGrupo({ id: "a", nombre: "Taller Online 21/10/26 #1" });
  const leerGrupos = repo.leerGrupos.bind(repo);
  repo.leerGrupos = async () => { const x = await leerGrupos(); await repo.atarGrupo("a", "manual"); return x.map((y) => ({ ...y, webinarId: null })); };
  const r = await atarGruposSolos(repo, [w2110]);
  assert.deepEqual(r.atados, []);
  assert.deepEqual(r.fallidos, [{ grupoId: "a", motivo: "ya tenía webinar" }]);
  assert.equal((await repo.leerGrupo("a"))?.webinarId, "manual");
});

test("la acción «atar-solos» del pedido es válida y no pide nada más", () => {
  assert.deepEqual(leerAccion({ accion: "atar-solos" }), { ok: true, accion: { accion: "atar-solos" } });
  assert.equal(leerAccion({ accion: "atar" }).ok, false);
});

/* ---------- Al crear un webinar ---------- */

const sinEsperar = { esperar: async () => {}, esperas: [1, 1, 1] };

test("al crear un webinar, espera a que esté en la base y devuelve sólo los grupos atados a ese webinar", async () => {
  let llamadas = 0;
  const esperas: number[] = [];
  const r = await atarSolosAlCrear("nuevo", {
    esperas: [10, 20, 30],
    esperar: async (ms) => { esperas.push(ms); },
    llamar: async () => {
      llamadas++;
      /* Las dos primeras veces el webinar todavía no se guardó; la tercera sí. */
      if (llamadas < 3) return { webinarsVistos: ["viejo"], atados: [] };
      return { webinarsVistos: ["viejo", "nuevo"], atados: [{ grupoId: "a", nombre: "x", webinarId: "nuevo", motivo: "" }, { grupoId: "b", nombre: "y", webinarId: "viejo", motivo: "" }] };
    },
  });
  assert.equal(llamadas, 3);
  assert.deepEqual(esperas, [10, 20]);
  assert.deepEqual(r?.map((a) => a.grupoId), ["a"]);
});

test("si el webinar nunca aparece, devuelve null después de los reintentos (queda el cron de todos los días)", async () => {
  let llamadas = 0;
  const r = await atarSolosAlCrear("nuevo", { ...sinEsperar, llamar: async () => { llamadas++; return { webinarsVistos: ["otro"], atados: [] }; } });
  assert.equal(r, null);
  assert.equal(llamadas, 4, "la primera y las tres esperas");
});

test("sin permiso o sin conexión no insiste: devuelve null al toque", async () => {
  for (const estado of [0, 401, 403, 500]) {
    let llamadas = 0;
    const r = await atarSolosAlCrear("nuevo", { ...sinEsperar, llamar: async () => { llamadas++; throw new ErrorWhatsapp("no", estado); } });
    assert.equal(r, null, `estado ${estado}`);
    assert.equal(llamadas, 1, `estado ${estado}`);
  }
});

test("un webinar sin ningún grupo con su fecha vuelve con la lista vacía (se creó bien, simplemente no había nada que atar)", async () => {
  const r = await atarSolosAlCrear("nuevo", { ...sinEsperar, llamar: async () => ({ webinarsVistos: ["nuevo"], atados: [] }) });
  assert.deepEqual(r, []);
});
