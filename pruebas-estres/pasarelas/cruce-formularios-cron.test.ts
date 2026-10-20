import test from "node:test";
import assert from "node:assert/strict";
import { instalarFetchFalso, URL_NUBE } from "./nube-falsa";
import { filaParaBase, nuevoRegistro } from "@/lib/registros-webinar";

/* ==================================================================
   ESTRÉS · el cruce automático de Formularios (cron cada media hora),
   contra una nube de mentira en memoria: une solo los registros con quienes
   agendaron o compraron, le pasa al contacto el anuncio y el webinar, no
   toca lo ya unido, no se rompe con más de mil contactos y no se repite.
   ================================================================== */

process.env.SUPABASE_URL = URL_NUBE;
process.env.SUPABASE_SERVICE_ROLE_KEY = "svc-cruce-formularios-falsa-0007";
process.env.CRON_SECRET = "secreto-de-prueba-del-cron-0007";

const nube = instalarFetchFalso();
const { GET } = await import("@/app/api/cron/cruce-formularios/route");
test.after(() => nube.restaurar());

const llamar = (auth?: string) => GET(new Request("http://localhost/api/cron/cruce-formularios", { headers: auth ? { authorization: auth } : {} }));
const reg = (email: string, extra: Record<string, unknown> = {}) => filaParaBase(nuevoRegistro({ email, origen: "excel", registradoEn: "2026-09-01T12:00:00.000Z", ...extra } as never));

function sembrar() {
  nube.nube.vaciar();
  nube.nube.filas("contactos").push(
    { id: "c1", nombre: "Ana Pérez", email: "ana@mail.com", telefono: "+54 9 11 5555 1111", pais: "Argentina", extra: {} },
    { id: "c2", nombre: "Beto Gómez", email: "beto@mail.com", extra: {} },
  );
  /* Más de mil contactos sin agenda ni compra: la lectura tiene que pasar de página. */
  for (let i = 0; i < 1150; i++) nube.nube.filas("contactos").push({ id: `pre_${i}`, nombre: `Pre Lead ${i}`, email: `pre${i}@mail.com`, extra: {} });
  nube.nube.filas("sesiones").push({ id: "s1", contactoId: "c1", email: "ana@mail.com", invitado: "Ana Pérez", inicia: "2026-10-10T15:00:00.000Z", estado: "programada" });
  nube.nube.filas("leads").push({ id: "l2", contactoId: "c2", nombre: "Beto Gómez", email: "beto@mail.com", telefono: "+54 9 351 444 2222", pais: "Argentina" });
  nube.nube.filas("ventas").push({ id: "v2", contactoId: "l2", contactoNombre: "Beto Gómez", fecha: "2026-10-12T15:00:00.000Z" });
  nube.nube.filas("ads").push({ id: "ad_1", metaId: "1", nombre: "Anuncio 1" });
  nube.nube.filas("webinars").push({ id: "w1", fecha: "2026-09-02T22:00:00.000Z", estado: "finalizado", formularios: 0, extra: {} });
  nube.nube.filas("registros_webinar").push(
    reg("ana@mail.com", { id: "reg_a", adId: "ad_1", webinarId: "w1", fechaWebinar: "2026-09-02" }),
    reg("pre5@mail.com", { id: "reg_pre", nombre: "Pre Lead 5" }),
    reg("beto@mail.com", { id: "reg_b", adId: "ad_9", webinarId: "w1", fechaWebinar: "2026-09-02" }),
    reg("otro@mail.com", { id: "reg_tel", telefono: "+54 9 11 5555 1111", nombre: "Ana P" }),
    reg("manual@mail.com", { id: "reg_manual", contactoId: "c1", cruce: "manual" }),
  );
}

test("sin el secreto, o con uno equivocado, no hace nada", async () => {
  sembrar();
  assert.equal((await llamar()).status, 401);
  assert.equal((await llamar("Bearer equivocado")).status, 401);
  assert.ok(nube.nube.filas("registros_webinar").every((r) => !r.cruce || r.id === "reg_manual"));
});

test("une solo lo seguro, completa al contacto (anuncio y webinar que existen) y deja lo demás como estaba", async () => {
  sembrar();
  const res = await llamar(`Bearer ${process.env.CRON_SECRET}`);
  assert.equal(res.status, 200);
  const j = (await res.json()) as Record<string, number | string[]>;
  assert.equal(j.unidos, 3, "reg_a (mail, agenda), reg_b (mail, compra) y reg_tel (teléfono)");
  assert.deepEqual(j.errores, []);
  const f = (id: string) => nube.nube.filas("registros_webinar").find((r) => r.id === id)!;
  assert.deepEqual([f("reg_a").contactoId, f("reg_a").cruce], ["c1", "mail"]);
  assert.deepEqual([f("reg_b").contactoId, f("reg_b").cruce], ["c2", "mail"]);
  assert.deepEqual([f("reg_tel").contactoId, f("reg_tel").cruce], ["c1", "telefono"]);
  assert.ok(f("reg_a").cruceEn, "queda la fecha del cruce");
  assert.equal(f("reg_pre").contactoId ?? null, null, "un pre-lead sin agenda ni compra no se une");
  assert.deepEqual([f("reg_manual").contactoId, f("reg_manual").cruce], ["c1", "manual"], "lo unido a mano no se toca");
  const c = (id: string) => nube.nube.filas("contactos").find((x) => x.id === id)!;
  assert.deepEqual([c("c1").origenAdId, c("c1").origenWebinarId], ["ad_1", "w1"], "Ana hereda el anuncio y el webinar de su formulario");
  assert.deepEqual([c("c2").origenAdId ?? null, c("c2").origenWebinarId], [null, "w1"], "un anuncio que la app no tiene (clave foránea) no se hereda; el webinar sí");
});

test("correrlo de nuevo no repite nada", async () => {
  sembrar();
  const auth = `Bearer ${process.env.CRON_SECRET}`;
  await llamar(auth);
  const j2 = (await (await llamar(auth)).json()) as Record<string, number>;
  assert.equal(j2.unidos, 0);
  assert.equal(j2.contactosCompletados, 0);
});
