import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sinMailDeSesion } from "@/lib/store";
import { claveDe, lecturaAlLeer } from "@/lib/chat-equipo";

/* 24/11: abrir la ficha de Brando (con un mensaje de Liliana en el chat) daba «Tu tipo de cuenta no puede cambiar esto». El chat recién
   montado no sabía todavía quién había entrado (la sesión se pedía de nuevo en cada componente) y anotaba el leído como «yari taft», el
   nombre del responsable; la base sólo deja anotarlo a nombre del mail de la sesión. */

test("mientras carga la sesión, la clave es el nombre del responsable: con base, eso no se anota", () => {
  assert.equal(claveDe(null, "Yari Taft"), "yari taft");
  assert.equal(sinMailDeSesion(claveDe(null, "Yari Taft"), true), true);
  assert.equal(sinMailDeSesion(claveDe("test@apicanta.com", "Yari Taft"), true), false);
  assert.equal(sinMailDeSesion("yari taft", false), false, "la app local (sin base) sigue con el nombre");
});

test("el leído que sí se anota lleva el mail de la sesión", () => {
  const c = { id: "c1", contactoId: "con_1", texto: "Inactivo en reporte semanal viejo", autor: "Liliana Riveros", autorEmail: "liliana@apicanta.com", creadoEn: "2026-11-23T22:23:28.190Z" };
  const fila = lecturaAlLeer("con_1", [c as never], [], claveDe("test@apicanta.com", "Yari Taft"), "Yari Taft");
  assert.equal(fila?.quien, "test@apicanta.com");
  assert.equal(fila?.id, "con_1:test@apicanta.com");
});

test("los dos que anotan en chat_lecturas esperan el mail, y la sesión ya conocida no se vuelve a esperar", () => {
  const store = readFileSync(new URL("../src/lib/store.ts", import.meta.url), "utf8");
  assert.match(store, /marcarLeido\(contactoId: ID, quien: string, nombre: string\): void \{\n    if \(sinMailDeSesion\(quien\)\) return;/);
  assert.match(store, /marcarRecibidos\(quien: string, nombre: string\): void \{\n    if \(sinMailDeSesion\(quien\)\) return;/);
  const auth = readFileSync(new URL("../src/lib/auth.ts", import.meta.url), "utf8");
  assert.match(auth, /useState<Sesion>\(\(\) => conocida \?\?/);
});
