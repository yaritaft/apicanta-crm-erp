import test from "node:test";
import assert from "node:assert/strict";
import { vistaPreviaDeLink } from "@/lib/comprobante-vista";

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
