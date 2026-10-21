import test from "node:test";
import assert from "node:assert/strict";
import {
  ADJUNTOS_POR_MENSAJE, duracionLegible, normalizarPicos, PICOS, problemaDeAdjunto, tipoDeArchivo,
} from "@/lib/adjuntos-chat";
import { acciones } from "@/lib/store";
import type { Adjunto, EstadoApp } from "@/lib/types";

/* El chat del equipo de la ficha, con fotos, videos, notas de voz y archivos (20/10, como en Blue OS). */

test("cada archivo se reconoce por su tipo: foto, video, audio o archivo suelto", () => {
  assert.equal(tipoDeArchivo("image/png"), "imagen");
  assert.equal(tipoDeArchivo("", "captura.HEIC"), "imagen", "el .heic del iPhone muchas veces llega sin tipo");
  assert.equal(tipoDeArchivo("video/mp4"), "video");
  assert.equal(tipoDeArchivo("audio/webm;codecs=opus"), "audio");
  assert.equal(tipoDeArchivo("application/pdf", "contrato.pdf"), "archivo");
  assert.equal(tipoDeArchivo("", "INSTALL.md"), "archivo", "un archivo sin tipo igual se manda");
});

test("lo que no se puede mandar se dice con el nombre del archivo y el tope", () => {
  const mb = 1024 * 1024;
  assert.equal(problemaDeAdjunto({ name: "foto.jpg", size: 2 * mb }, true), null);
  assert.match(problemaDeAdjunto({ name: "video.mov", size: 4 * mb }, true) ?? "", /«video\.mov» pesa 4,0 MB: el máximo es 3,0 MB en la app local/);
  assert.equal(problemaDeAdjunto({ name: "video.mov", size: 40 * mb }, false), null, "en la nube entran hasta 50 MB");
  assert.match(problemaDeAdjunto({ name: "enorme.zip", size: 60 * mb }, false) ?? "", /máximo es 50,0 MB\.$/);
  assert.match(problemaDeAdjunto({ name: "vacio.txt", size: 0 }, false) ?? "", /«vacio\.txt» está vacío/);
  assert.equal(ADJUNTOS_POR_MENSAJE, 10);
});

test("la onda de una nota de voz queda en 40 valores de 0 a 1, con el más alto en 1 y sin barras invisibles", () => {
  const corta = normalizarPicos([0.1, 0.2, 0.4]);
  assert.equal(corta.length, PICOS, "se estira a 40");
  assert.equal(Math.max(...corta), 1);
  const larga = normalizarPicos(Array.from({ length: 600 }, (_, i) => (i % 10) / 10));
  assert.equal(larga.length, PICOS, "se resume a 40");
  assert.ok(larga.every((x) => x >= 0.06 && x <= 1), "hasta el silencio se ve como una barrita");
  assert.deepEqual(normalizarPicos([]), []);
  assert.ok(normalizarPicos([0, 0, 0]).every((x) => x === 0.06), "todo silencio: barritas mínimas, sin dividir por cero");
});

test("la duración se lee como en WhatsApp", () => {
  assert.equal(duracionLegible(0), "0:00");
  assert.equal(duracionLegible(7.4), "0:07");
  assert.equal(duracionLegible(83), "1:23");
  assert.equal(duracionLegible(3600), "60:00");
  assert.equal(duracionLegible(undefined), "");
  assert.equal(duracionLegible(Number.NaN), "");
});

const comentariosDe = (contactoId: string) =>
  ((JSON.parse(acciones.exportar()) as EstadoApp).comentarios ?? []).filter((c) => c.contactoId === contactoId);

test("un mensaje puede ser sólo una nota de voz o una foto; vacío del todo, no se manda", () => {
  const nota: Adjunto = {
    id: "a1", tipo: "audio", nombre: "nota-de-voz.webm", mime: "audio/webm", bytes: 12000, ruta: "data:audio/webm;base64,AAAA",
    duracion: 7, picos: normalizarPicos([0.2, 0.5, 0.9]), notaDeVoz: true,
  };
  acciones.comentar("c_chat_1", "   ", "Lili", "lili@x.com", [nota]);
  const [m] = comentariosDe("c_chat_1");
  assert.equal(m.texto, "", "el texto queda vacío, no con espacios");
  assert.equal(m.adjuntos?.length, 1);
  assert.equal(m.adjuntos?.[0].notaDeVoz, true);
  assert.equal(m.adjuntos?.[0].duracion, 7);

  acciones.comentar("c_chat_2", "   ", "Lili", "lili@x.com", []);
  acciones.comentar("c_chat_2", "", "Lili");
  assert.equal(comentariosDe("c_chat_2").length, 0, "sin texto ni archivos no se guarda nada");

  acciones.comentar("c_chat_3", "Mirá el contrato", "Yari", undefined, [{ ...nota, id: "a2", tipo: "archivo", nombre: "contrato.pdf", mime: "application/pdf", notaDeVoz: undefined }]);
  const [conTexto] = comentariosDe("c_chat_3");
  assert.equal(conTexto.texto, "Mirá el contrato");
  assert.equal(conTexto.adjuntos?.[0].nombre, "contrato.pdf");

  acciones.comentar("c_chat_4", "Sólo texto", "Yari");
  assert.equal(comentariosDe("c_chat_4")[0].adjuntos, undefined, "un mensaje sin archivos no lleva la lista vacía");
});

test("una respuesta en hilo guarda a qué mensaje responde; un mensaje de la conversación, no", () => {
  acciones.comentar("c_chat_5", "¿Le mandaron el contrato?", "Yari");
  const [original] = comentariosDe("c_chat_5");
  assert.equal(original.respondeA, undefined);
  acciones.comentar("c_chat_5", "Sí, ayer.", "Lili", "lili@x.com", [], original.id);
  const [, respuesta] = comentariosDe("c_chat_5");
  assert.equal(respuesta.respondeA, original.id);
  assert.equal(respuesta.texto, "Sí, ayer.");
});
