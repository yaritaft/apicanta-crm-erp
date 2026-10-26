import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { nombreDeCorreo, quienFirma } from "@/lib/control-cobros";
import { acciones } from "@/lib/store";
import type { EstadoApp } from "@/lib/types";

/* 25/10: la actividad firmaba todo con el «Responsable» de Ajustes. En producción eso es «Yari Taft», y lo que hacían
   Lili, Mariano, Valentín, Dante, Aldana o Manu (1.292 filas en una semana) decía que lo había hecho Yari. */
const equipo = [
  { nombre: "Liliana Riveros", email: "liliana@apicanta.com" },
  { nombre: "Manuel Pérez", email: "Manuel@Apicanta.com " },
  { nombre: "Yari", email: "yari.taft@gmail.com" },
];

test("firma quien entró: su nombre en Equipo, aunque el Responsable sea otro", () => {
  assert.equal(quienFirma(equipo, "liliana@apicanta.com", null, "Yari Taft"), "Liliana Riveros");
  assert.equal(quienFirma(equipo, "manuel@apicanta.com", null, "Yari Taft"), "Manuel Pérez", "el correo de Equipo con mayúsculas y espacios también");
});

test("un dueño que no está en Equipo firma con su nombre en Accesos; si no tiene, con lo de antes de la arroba", () => {
  assert.equal(quienFirma(equipo, "ceo@tumetamorfosis.com", "Juan Cruz", "Yari Taft"), "Juan Cruz");
  assert.equal(quienFirma(equipo, "test@apicanta.com", "", "Yari Taft"), "Test");
  assert.equal(quienFirma(equipo, "juan.cruz@x.com", null, "Yari Taft"), "Juan Cruz");
  assert.equal(nombreDeCorreo("valentin_abadia@apicanta.com"), "Valentin Abadia");
});

test("sin sesión (app sin nube, servidor) firma el Responsable, como antes", () => {
  assert.equal(quienFirma(equipo, null, null, "Yari Taft"), "Yari Taft");
  assert.equal(quienFirma(equipo, null, null, ""), "Apicanta");
  const e0 = JSON.parse(acciones.exportar()) as EstadoApp;
  const c = e0.cuotas.find((x) => x.estado === "pendiente" && x.monto > 10 && !e0.pagos.some((p) => p.cuotaId === x.id))!;
  assert.ok(acciones.corregirCuota(c.id, { monto: Math.round((c.monto - 1) * 100) / 100 }, "prueba de quién firma"));
  const e = JSON.parse(acciones.exportar()) as EstadoApp;
  assert.equal(e.actividad[0].actor, e.ajustes.responsable || "Apicanta");
});

test("el store firma la actividad y lo que guarda quién lo cambió con la misma regla, no con el Responsable", () => {
  const src = readFileSync("src/lib/store.ts", "utf8");
  assert.match(src, /actor: firma\(e\)/);
  assert.doesNotMatch(src, /actor: e\.ajustes\.responsable/);
  assert.doesNotMatch(src, /miembroId\)\?\.nombre \?\? e\.ajustes\.responsable/, "seguimiento, resells y CVs tampoco caen en el Responsable");
});
