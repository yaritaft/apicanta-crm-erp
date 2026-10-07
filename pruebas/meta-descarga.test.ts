import test from "node:test";
import assert from "node:assert/strict";
import {
  cabecerasDeDescarga, extensionDe, medioParaDescargar, nombreDeArchivo, nombreSeguro, traerArchivo,
} from "@/lib/meta-descarga";

/* Un Meta de mentira: contesta lo que contestaría la API de Graph y los servidores de archivos (fbcdn). */
const GRAPH = "https://graph.facebook.test/v25.0";
const VIDEO = "https://video.fbcdn.net/v/t42/anuncio.mp4?oh=firma";
const PORTADA = "https://scontent.fbcdn.net/v/t15/portada.jpg";
const IMAGEN = "https://scontent.fbcdn.net/v/t45/imagen.png";

type Ruta = (url: URL) => Response | undefined;
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

function metaDeMentira(rutas: Record<string, Response | (() => Response)>, llamadas: string[] = []): typeof fetch {
  return (async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada));
    llamadas.push(`${url.origin}${url.pathname}`);
    const clave = `${url.origin}${url.pathname}`;
    const r = rutas[clave];
    if (!r) return new Response("no existe", { status: 404 });
    return typeof r === "function" ? r() : r.clone();
  }) as typeof fetch;
}

/* El anuncio 111: un video (999) vertical de 720x1280. */
const anuncioConVideo = {
  [`${GRAPH}/111`]: json({ account_id: "55", creative: { object_type: "VIDEO", video_id: "999", body: "Texto" } }),
  [`${GRAPH}/999`]: json({ source: VIDEO, picture: PORTADA, format: [{ width: 720, height: 1280, picture: PORTADA }] }),
};

test("pide el anuncio a Meta de nuevo y da el link del video, con su forma", async () => {
  const r = await medioParaDescargar(GRAPH, "tok", "111", { indice: 0, tipo: "video" }, metaDeMentira(anuncioConVideo));
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.medio.tipo, "video");
    assert.equal(r.medio.src, VIDEO);
    assert.equal(r.medio.alto, 1280);
  }
});

test("un archivo que ya no está en el anuncio, o que cambió de tipo, se dice y no se baja otro", async () => {
  const meta = metaDeMentira(anuncioConVideo);
  const fuera = await medioParaDescargar(GRAPH, "tok", "111", { indice: 3, tipo: "video" }, meta);
  assert.deepEqual(fuera, { ok: false, status: 404, error: "Ese archivo ya no está en el anuncio (puede haber cambiado en Meta). Abrí el detalle de nuevo." });
  const cambio = await medioParaDescargar(GRAPH, "tok", "111", { indice: 0, tipo: "imagen" }, meta);
  assert.equal(cambio.ok, false);
  if (!cambio.ok) assert.equal(cambio.status, 404);
});

test("si Meta no entrega el archivo del video, sólo se baja la portada, y se avisa", async () => {
  /* Meta contesta el video sin `source`: sólo trae la portada. */
  const sinSource = metaDeMentira({ ...anuncioConVideo, [`${GRAPH}/999`]: json({ picture: PORTADA, format: [{ width: 720, height: 1280, picture: PORTADA }] }) });
  const pidiendoVideo = await medioParaDescargar(GRAPH, "tok", "111", { indice: 0, tipo: "imagen" }, sinSource);
  assert.equal(pidiendoVideo.ok, false);
  if (!pidiendoVideo.ok) {
    assert.equal(pidiendoVideo.status, 422);
    assert.match(pidiendoVideo.error, /Meta no entregó el archivo del video/);
    assert.match(pidiendoVideo.error, /Administrador de anuncios/);
  }
  const portada = await medioParaDescargar(GRAPH, "tok", "111", { indice: 0, tipo: "imagen", portada: true }, sinSource);
  assert.equal(portada.ok, true);
  if (portada.ok) { assert.equal(portada.medio.sinArchivo, true); assert.equal(portada.medio.src, PORTADA); }
});

test("una imagen se baja del archivo de la cuenta; un carrusel se pide por su lugar", async () => {
  const carrusel = metaDeMentira({
    [`${GRAPH}/222`]: json({
      account_id: "55",
      creative: { object_story_spec: { link_data: { child_attachments: [{ image_hash: "h1", picture: PORTADA }, { video_id: "999", picture: PORTADA }] } } },
    }),
    [`${GRAPH}/act_55/adimages`]: json({ data: [{ hash: "h1", url: IMAGEN, width: 1080, height: 1080 }] }),
    [`${GRAPH}/999`]: json({ source: VIDEO, picture: PORTADA }),
  });
  const primera = await medioParaDescargar(GRAPH, "tok", "222", { indice: 0, tipo: "imagen" }, carrusel);
  assert.equal(primera.ok && primera.medio.src, IMAGEN);
  const segunda = await medioParaDescargar(GRAPH, "tok", "222", { indice: 1, tipo: "video" }, carrusel);
  assert.equal(segunda.ok && segunda.medio.src, VIDEO);
});

test("si Meta no deja leer el anuncio (token vencido), se dice con qué arreglarlo", async () => {
  const vencido = metaDeMentira({ [`${GRAPH}/111`]: json({ error: { message: "Error validating access token", code: 190 } }, 401) });
  const r = await medioParaDescargar(GRAPH, "tok", "111", { indice: 0 }, vencido);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 502);
    assert.match(r.error, /Meta no dejó leer este anuncio \(Error validating access token\)/);
    assert.match(r.error, /conexión con Meta/);
  }
  const caido = metaDeMentira({ [`${GRAPH}/111`]: json({}, 500) });
  const otro = await medioParaDescargar(GRAPH, "tok", "111", { indice: 0 }, caido);
  assert.equal(otro.ok === false && otro.error, "No se pudo leer el anuncio en Meta. Probá de nuevo en un rato.");
});

/* ---------- Bajar el archivo ---------- */

test("baja el archivo de Meta y lo pasa tal cual", async () => {
  const meta = metaDeMentira({ [VIDEO.split("?")[0]]: new Response("BYTES-DEL-VIDEO", { status: 200, headers: { "content-type": "video/mp4", "content-length": "15" } }) });
  const r = await traerArchivo(VIDEO, meta);
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(await r.respuesta.text(), "BYTES-DEL-VIDEO");
    assert.equal(r.respuesta.headers.get("content-type"), "video/mp4");
  }
});

test("si Meta contesta con un error o sin archivo, se dice qué hacer", async () => {
  const vencido = metaDeMentira({ [VIDEO.split("?")[0]]: new Response("expiró", { status: 403 }) });
  const r = await traerArchivo(VIDEO, vencido);
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.status, 502);
    assert.match(r.error, /Meta no entregó el archivo \(contestó 403\)/);
    assert.match(r.error, /Administrador de anuncios de Meta/);
  }
  const sinRed = (async () => { throw new Error("red caída"); }) as typeof fetch;
  const caido = await traerArchivo(VIDEO, sinRed);
  assert.equal(caido.ok === false && caido.error, "No se pudo hablar con Meta para bajar el archivo. Probá de nuevo en un rato.");
});

test("un archivo enorme no se baja por acá", async () => {
  const grande = metaDeMentira({ [VIDEO.split("?")[0]]: new Response("x", { status: 200, headers: { "content-length": String(500 * 1024 * 1024) } }) });
  const r = await traerArchivo(VIDEO, grande);
  assert.equal(r.ok === false && r.status, 413);
});

test("sólo se baja de servidores de Meta, también al seguir una redirección", async () => {
  /* Un link que no es de Meta no se pide. */
  const llamadas: string[] = [];
  const nada = await traerArchivo("https://malo.example.com/video.mp4", metaDeMentira({}, llamadas));
  assert.equal(nada.ok, false);
  assert.deepEqual(llamadas, [], "ni siquiera se hizo el pedido");

  /* Una redirección a otro servidor de Meta se sigue; a uno de afuera, no. */
  const otro = "https://video-2.fbcdn.net/v/otro.mp4";
  const sigue = metaDeMentira({
    [VIDEO.split("?")[0]]: new Response(null, { status: 302, headers: { location: otro } }),
    [otro]: new Response("OK", { status: 200, headers: { "content-type": "video/mp4" } }),
  });
  const bien = await traerArchivo(VIDEO, sigue);
  assert.equal(bien.ok && (await bien.respuesta.text()), "OK");

  const afuera = metaDeMentira({ [VIDEO.split("?")[0]]: new Response(null, { status: 302, headers: { location: "https://malo.example.com/x.mp4" } }) });
  const mal = await traerArchivo(VIDEO, afuera);
  assert.equal(mal.ok, false);
});

/* ---------- Cómo se llama ---------- */

test("el nombre del archivo sale del anuncio, sin las extensiones de Meta ni caracteres que un sistema de archivos no acepta", () => {
  assert.equal(nombreSeguro("MERCADO SATURADO.mp4 - Copia 2"), "MERCADO SATURADO - Copia 2");
  assert.equal(nombreSeguro('a/b\\c:d*e?f"g<h>i|j'), "a b c d e f g h i j");
  assert.equal(nombreSeguro("  ..oculto..  "), "oculto");
  assert.equal(nombreSeguro(""), "anuncio");
  assert.equal(nombreSeguro(null), "anuncio");
  assert.equal(nombreSeguro("x".repeat(200)).length, 80);
});

test("un archivo, varios (carrusel o uno por lugar) y la portada de un video", () => {
  assert.equal(nombreDeArchivo("Anuncio 1.mp4", { extension: "mp4", indice: 0, total: 1 }), "Anuncio 1.mp4");
  assert.equal(nombreDeArchivo("Anuncio 1", { extension: "jpg", indice: 1, total: 3 }), "Anuncio 1 (2 de 3).jpg");
  assert.equal(nombreDeArchivo("Anuncio 1", { extension: "mp4", indice: 0, total: 2, etiqueta: "Historias y Reels" }), "Anuncio 1 · Historias y Reels.mp4");
  assert.equal(nombreDeArchivo("Anuncio 1", { extension: "jpg", indice: 0, total: 1, portada: true }), "Anuncio 1 · portada.jpg");
});

test("la extensión sale de lo que dice el servidor, y si no dice, del tipo de medio", () => {
  assert.equal(extensionDe("video/mp4", "video"), "mp4");
  assert.equal(extensionDe("image/png; charset=binary", "imagen"), "png");
  assert.equal(extensionDe("image/webp", "imagen"), "webp");
  assert.equal(extensionDe("application/octet-stream", "video"), "mp4");
  assert.equal(extensionDe(null, "imagen"), "jpg");
});

test("la descarga lleva su nombre, con tildes y sin ellas, y no repite el largo de un archivo comprimido", () => {
  const h = cabecerasDeDescarga("Nuevo año · Historias.mp4", "video/mp4", "100");
  assert.equal(h["Content-Type"], "video/mp4");
  assert.match(h["Content-Disposition"], /^attachment; filename="Nuevo ano _ Historias\.mp4"; filename\*=UTF-8''Nuevo%20a%C3%B1o%20%C2%B7%20Historias\.mp4$/);
  assert.equal(h["Content-Length"], "100");
  assert.equal(cabecerasDeDescarga("a.jpg", null, null)["Content-Type"], "application/octet-stream");
  assert.ok(!("Content-Length" in cabecerasDeDescarga("a.jpg", "image/jpeg", null)));
});
