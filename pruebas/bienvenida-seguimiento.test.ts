import test from "node:test";
import assert from "node:assert/strict";
import { estadoDelMail, seguimientoDeBienvenida } from "@/lib/bienvenida-alumno";
import { rotuloEvento } from "@/lib/contratos";

/* Lili, 17/11: «una opción para reenviar el mail de bienvenida, para el caso que el alumno lo pierda, y saber que el alumno lo vio
   (como el seguimiento que hacemos en el contrato)». */

test("cuenta los mails que salieron (el primero y los reenvíos) y se queda con el último", () => {
  const s = seguimientoDeBienvenida([
    { evento: "firmado", cuando: "2026-11-14T22:36:00Z" },
    { evento: "bienvenida", detalle: { enviado: true }, cuando: "2026-11-14T22:36:10Z" },
    { evento: "bienvenida", detalle: { enviado: false, error: "x" }, cuando: "2026-11-15T10:00:00Z" },
    { evento: "bienvenida", detalle: { enviado: true, reenvio: true }, cuando: "2026-11-17T09:00:00Z" },
  ]);
  assert.equal(s.envios, 2, "el que no salió no cuenta");
  assert.equal(s.ultimoEnvio, "2026-11-17T09:00:00Z");
  assert.equal(s.vistas, 0);
  assert.equal(s.primeraVista, null);
});

test("si abrió su página, dice cuándo la abrió por primera vez y cuándo volvió", () => {
  const s = seguimientoDeBienvenida([
    { evento: "bienvenida-vista", cuando: "2026-11-17T12:00:00Z" },
    { evento: "bienvenida-vista", cuando: "2026-11-14T22:40:00Z" },
  ]);
  assert.equal(s.vistas, 2);
  assert.equal(s.primeraVista, "2026-11-14T22:40:00Z");
  assert.equal(s.ultimaVista, "2026-11-17T12:00:00Z");
});

test("lo que dice el servicio de mails se traduce a palabras de Servicio, y lo desconocido no inventa nada", () => {
  assert.deepEqual(estadoDelMail("delivered"), { texto: "Le llegó a su casilla", tono: "ok" });
  assert.equal(estadoDelMail("bounced")?.tono, "malo");
  assert.equal(estadoDelMail("complained")?.tono, "malo");
  assert.equal(estadoDelMail("opened")?.tono, "ok");
  assert.equal(estadoDelMail(null), null);
  assert.equal(estadoDelMail("algo_nuevo"), null);
});

test("el historial del contrato rotula el mail de bienvenida y la vista de su página", () => {
  assert.equal(rotuloEvento({ evento: "bienvenida", detalle: { enviado: true } }), "Se le mandó el mail de bienvenida");
  assert.equal(rotuloEvento({ evento: "bienvenida", detalle: { enviado: true, reenvio: true } }), "Se le reenvió el mail de bienvenida");
  assert.equal(rotuloEvento({ evento: "bienvenida", detalle: { enviado: false, reenvio: true } }), "No salió el mail de bienvenida");
  assert.equal(rotuloEvento({ evento: "bienvenida-vista", detalle: {} }), "Abrió su página de bienvenida");
});
