import test from "node:test";
import assert from "node:assert/strict";
import {
  camposDelReporte, formularioDe, FORMULARIO_BIZ, FORMULARIO_IT, FORMULARIOS, problemaDeRespuesta, respuestasLegibles,
  validarRespuestas,
} from "@/lib/reporte-formularios";

/* ==================================================================
   Los formularios del reporte semanal por programa: que Hackear Biz tenga las
   doce preguntas del Google Form, a quién le toca cada uno, qué se acepta como
   respuesta y cómo se leen después en la ficha del cliente.
   ================================================================== */

test("Hackear Biz tiene las doce preguntas del formulario de seguimiento, en su orden", () => {
  const p = FORMULARIO_BIZ.preguntas;
  assert.equal(p.length, 12);
  assert.deepEqual(p.map((x) => x.id), [
    "trabajo", "accion", "marca", "publicaciones", "conversaciones", "ventas", "logro", "bloqueo", "compromiso", "objetivo", "ayuda", "clase",
  ]);
  assert.match(p[0].titulo, /¿En qué trabajaste esta semana dentro de Hackear Biz\?/);
  assert.deepEqual(p[3].opciones, ["Ninguna.", "Entre 1 y 2.", "Entre 3 y 5.", "Más de 5."]);
  assert.equal(p[8].tipo, "escala");
  assert.deepEqual([p[8].min, p[8].max], [1, 10]);
  assert.equal(p[11].tipo, "si-no");
  assert.ok(p.every((x) => x.requerida), "en el Google Form todas son obligatorias");
});

test("cada formulario tiene claves únicas y las preguntas de opciones traen sus opciones", () => {
  for (const f of Object.values(FORMULARIOS)) {
    const ids = f.preguntas.map((x) => x.id);
    assert.equal(new Set(ids).size, ids.length, f.id);
    for (const q of f.preguntas) {
      assert.ok(q.titulo.trim(), `${f.id}/${q.id}`);
      if (q.tipo === "opciones" || q.tipo === "si-no") assert.ok((q.opciones ?? []).length >= 2, `${f.id}/${q.id}`);
      if (q.tipo === "numero" || q.tipo === "escala") assert.ok(q.max !== undefined && q.max > (q.min ?? 0), `${f.id}/${q.id}`);
    }
    assert.equal(FORMULARIOS[f.id], f);
  }
});

test("a cada alumno le toca el formulario de su programa; si no se sabe, se le pregunta", () => {
  assert.equal(formularioDe(["Hackear Biz"]), FORMULARIO_BIZ);
  assert.equal(formularioDe(["Hackear IT"]), FORMULARIO_IT);
  assert.equal(formularioDe(["hackear biz"]), FORMULARIO_BIZ);
  /* «Mentoría» es Hackear IT, como en Customer Success. */
  assert.equal(formularioDe(["Mentoría"]), FORMULARIO_IT);
  assert.equal(formularioDe(["Mentoría Hackear IT 6 meses"]), FORMULARIO_IT);
  /* Cursa los dos, ninguno de los dos o no hay dato: hay que preguntarle. */
  assert.equal(formularioDe(["Hackear IT", "Hackear Biz"]), null);
  assert.equal(formularioDe(["Principals"]), null);
  assert.equal(formularioDe(["Principal Mastermind"]), null);
  assert.equal(formularioDe([]), null);
  assert.equal(formularioDe(null), null);
  assert.equal(formularioDe([undefined, ""]), null);
  /* «it» dentro de otra palabra no cuenta. */
  assert.equal(formularioDe(["Digital"]), null);
});

const BIZ = {
  trabajo: "Armé mi oferta", accion: "Publiqué un caso", marca: "Subí 200 seguidores", publicaciones: "Entre 1 y 2.",
  conversaciones: "8", ventas: "1 por 500", logro: "Primera venta", bloqueo: "El precio", compromiso: 7,
  objetivo: "Diez conversaciones", ayuda: "Mi guion", clase: "No",
};

test("las respuestas buenas pasan tal cual y las malas dicen cuál falló", () => {
  const ok = validarRespuestas(FORMULARIO_BIZ, BIZ);
  assert.deepEqual(ok, { ok: true, valor: BIZ });
  const falta = validarRespuestas(FORMULARIO_BIZ, { ...BIZ, objetivo: undefined });
  assert.deepEqual(falta, { ok: false, error: "Falta responder esta pregunta.", campo: "objetivo" });
  const redondeo = validarRespuestas(FORMULARIO_BIZ, { ...BIZ, compromiso: 9.6 });
  assert.equal(redondeo.ok && redondeo.valor.compromiso, 10, "9,6 se redondea a 10");
  assert.equal(validarRespuestas(FORMULARIO_BIZ, { ...BIZ, compromiso: 10.4 }).ok, false, "pasarse de la escala no se arregla redondeando");
  assert.equal(validarRespuestas(FORMULARIO_BIZ, null).ok, false);
});

test("sólo se acepta lo permitido en cada tipo de pregunta", () => {
  assert.equal(validarRespuestas(FORMULARIO_BIZ, { ...BIZ, publicaciones: ["Ninguna."] }).ok, false);
  assert.equal(validarRespuestas(FORMULARIO_BIZ, { ...BIZ, clase: "si" }).ok, false, "tiene que ser «Sí» o «No», tal cual");
  assert.equal(validarRespuestas(FORMULARIO_BIZ, { ...BIZ, trabajo: { a: 1 } }).ok, false);
  assert.equal(validarRespuestas(FORMULARIO_IT, { horas: "12,5", entrevistas: 0, postulaciones: "3" }).ok, true);
  const mal = validarRespuestas(FORMULARIO_IT, { horas: 500, entrevistas: 0, postulaciones: 3 });
  assert.equal(mal.ok, false);
  if (!mal.ok) assert.equal(mal.campo, "horas");
});

test("la pantalla no deja seguir con una respuesta vacía o fuera de rango, pero sí saltea lo opcional", () => {
  const trabajo = FORMULARIO_BIZ.preguntas[0];
  assert.equal(problemaDeRespuesta(trabajo, undefined), "Falta responder esta pregunta.");
  assert.equal(problemaDeRespuesta(trabajo, "   "), "Falta responder esta pregunta.");
  assert.equal(problemaDeRespuesta(trabajo, "algo"), null);
  const compromiso = FORMULARIO_BIZ.preguntas[8];
  assert.equal(problemaDeRespuesta(compromiso, 8), null);
  assert.match(problemaDeRespuesta(compromiso, 11) ?? "", /entre 1 y 10/);
  const publicaciones = FORMULARIO_BIZ.preguntas[3];
  assert.equal(problemaDeRespuesta(publicaciones, "Más de 5."), null);
  assert.equal(problemaDeRespuesta(publicaciones, "Mucho"), "Elegí una de las opciones.");
  const bloqueoIt = FORMULARIO_IT.preguntas.find((x) => x.id === "bloqueo")!;
  assert.equal(problemaDeRespuesta(bloqueoIt, ""), null);
});

test("además de las respuestas, el reporte alimenta lo de siempre: el bloqueo y las cifras de Hackear IT", () => {
  const biz = camposDelReporte(FORMULARIO_BIZ, BIZ);
  assert.equal(biz.programa, "Hackear Biz");
  assert.equal(biz.formulario, "hackear-biz");
  assert.equal(biz.bloqueo, "El precio");
  assert.equal(biz.horas, undefined);
  const it = camposDelReporte(FORMULARIO_IT, { horas: 10, entrevistas: 2, postulaciones: 5 });
  assert.deepEqual([it.horas, it.entrevistas, it.postulaciones, it.bloqueo], [10, 2, 5, undefined]);
});

test("en la ficha cada respuesta se lee con su pregunta, en el orden del formulario", () => {
  const l = respuestasLegibles("hackear-biz", BIZ);
  assert.equal(l.length, 12);
  assert.deepEqual(l.slice(0, 2).map((x) => x.id), ["trabajo", "accion"]);
  assert.equal(l.find((x) => x.id === "compromiso")?.respuesta, "7");
  assert.equal(l.find((x) => x.id === "compromiso")?.etiqueta, "Compromiso (1 a 10)");
  /* Lo que no se contestó no aparece. */
  assert.equal(respuestasLegibles("hackear-it", { horas: 4, bloqueo: "" }).length, 1);
  /* Si el formulario cambia o ya no existe, la respuesta guardada se ve igual, con su clave. */
  const vieja = respuestasLegibles("hackear-biz", { trabajo: "x", preguntaQueYaNoEsta: "algo viejo" });
  assert.deepEqual(vieja.map((x) => x.id), ["trabajo", "preguntaQueYaNoEsta"]);
  assert.equal(respuestasLegibles("formulario-borrado", { a: "1" })[0].etiqueta, "a");
  assert.deepEqual(respuestasLegibles("hackear-biz", undefined), []);
});
