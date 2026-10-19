import test from "node:test";
import assert from "node:assert/strict";
import { vistaPreviaDeLink } from "@/lib/comprobante-vista";
import { comprobanteDeCobro } from "@/lib/control-cobros";
import type { Pago } from "@/lib/types";

const ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

test("un archivo de Drive, en cualquiera de sus formas de link, abre el visor de Drive", () => {
  const esperado = { tipo: "marco", origen: "drive", src: `https://drive.google.com/file/d/${ID}/preview` };
  assert.deepEqual(vistaPreviaDeLink(`https://drive.google.com/file/d/${ID}/view?usp=sharing`), esperado);
  assert.deepEqual(vistaPreviaDeLink(`https://drive.google.com/file/d/${ID}/edit`), esperado);
  assert.deepEqual(vistaPreviaDeLink(`https://drive.google.com/file/u/0/d/${ID}/view`), esperado);
  assert.deepEqual(vistaPreviaDeLink(`https://drive.google.com/open?id=${ID}`), esperado);
  assert.deepEqual(vistaPreviaDeLink(`https://drive.google.com/uc?export=download&id=${ID}`), esperado);
});

test("una imagen suelta se muestra; un PDF suelto va en un marco", () => {
  assert.deepEqual(vistaPreviaDeLink("https://ejemplo.com/pagos/transferencia.PNG"), { tipo: "imagen", src: "https://ejemplo.com/pagos/transferencia.PNG" });
  assert.deepEqual(vistaPreviaDeLink("https://ejemplo.com/a/b.jpeg?x=1"), { tipo: "imagen", src: "https://ejemplo.com/a/b.jpeg?x=1" });
  assert.deepEqual(vistaPreviaDeLink("https://ejemplo.com/recibo.pdf"), { tipo: "marco", origen: "pdf", src: "https://ejemplo.com/recibo.pdf" });
});

test("lo que no se sabe mostrar queda como link para abrir", () => {
  assert.deepEqual(vistaPreviaDeLink("https://drive.google.com/drive/folders/abc123"), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink("https://drive.google.com/open?id=corto"), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink("https://fathom.video/calls/865683119"), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink("transferencia del 3/9"), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink(undefined), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink(""), { tipo: "enlace" });
});

test("nunca embebe algo que no sea https", () => {
  assert.deepEqual(vistaPreviaDeLink(`http://drive.google.com/file/d/${ID}/view`), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink("javascript:alert(1)//.png"), { tipo: "enlace" });
  assert.deepEqual(vistaPreviaDeLink("data:image/png;base64,AAAA"), { tipo: "enlace" });
  /* Un host que sólo se parece a Drive no cuenta. */
  assert.deepEqual(vistaPreviaDeLink(`https://drive.google.com.evil.com/file/d/${ID}/view`), { tipo: "enlace" });
});

test("un cobro con «nombre del archivo + link de Drive» (como quedaron los de octubre) se ve adentro con el link", () => {
  const link = "https://drive.google.com/open?id=1GQ2G8cB1p62FL_CHidjKbzIZdnH-Ik4r";
  const pago = { comprobanteLink: `Captura de pantalla 2026-10-08 a la(s) 2.18.29 p. m. - Mariano Arias.png ${link}` } as Pago;
  const prueba = comprobanteDeCobro(pago);
  assert.equal(prueba.tipo, "link");
  assert.equal(prueba.tipo === "link" ? prueba.url : "", link);
  assert.deepEqual(vistaPreviaDeLink(prueba.tipo === "link" ? prueba.url : ""), { tipo: "marco", origen: "drive", src: "https://drive.google.com/file/d/1GQ2G8cB1p62FL_CHidjKbzIZdnH-Ik4r/preview" });
  /* Sin link, sigue siendo sólo el nombre: nada que abrir. */
  const solo = comprobanteDeCobro({ comprobanteLink: "foto.png" } as Pago);
  assert.equal(solo.tipo === "link" ? solo.url : "x", undefined);
});
