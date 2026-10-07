import test from "node:test";
import assert from "node:assert/strict";
import { GRAPH } from "@/lib/meta";
import { responderDescarga } from "@/lib/meta-descarga";

/* Lo que contesta /api/meta/descargar (sin el permiso, que es de la ruta), con un Meta de mentira: el archivo, las
   cabeceras de la descarga y los errores. */
const AD = "120210000000111";
const VIDEO = "https://video.fbcdn.net/v/t42/anuncio.mp4?oh=firma";
const PORTADA = "https://scontent.fbcdn.net/v/t15/portada.jpg";

const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });

async function conMeta(rutas: Record<string, () => Response>, pedido: string) {
  const meta = (async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada));
    const r = rutas[`${url.origin}${url.pathname}`];
    return r ? r() : new Response("no existe", { status: 404 });
  }) as typeof fetch;
  process.env.META_SYSTEM_TOKEN = "token-de-prueba";
  try {
    return await responderDescarga(new Request(`http://localhost:3010/api/meta/descargar?${pedido}`), meta);
  } finally {
    delete process.env.META_SYSTEM_TOKEN;
  }
}

const anuncio = (extra: Record<string, () => Response> = {}) => ({
  [`${GRAPH}/${AD}`]: () => json({ account_id: "55", creative: { video_id: "999" } }),
  [`${GRAPH}/999`]: () => json({ source: VIDEO, picture: PORTADA, format: [{ width: 720, height: 1280 }] }),
  [VIDEO.split("?")[0]]: () => new Response("BYTES-DEL-VIDEO", { status: 200, headers: { "content-type": "video/mp4", "content-length": "15" } }),
  ...extra,
});

test("el video llega como una descarga, con su nombre y su tipo", async () => {
  const r = await conMeta(anuncio(), `ad=${AD}&medio=0&tipo=video&de=1&nombre=` + encodeURIComponent("MERCADO SATURADO.mp4 - Copia 2"));
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("content-type"), "video/mp4");
  assert.equal(r.headers.get("content-disposition"), `attachment; filename="MERCADO SATURADO - Copia 2.mp4"; filename*=UTF-8''MERCADO%20SATURADO%20-%20Copia%202.mp4`);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.equal(await r.text(), "BYTES-DEL-VIDEO");
});

test("sin Meta configurado, sin token, o con un pedido mal hecho, contesta con un mensaje", async () => {
  const sinMeta = await responderDescarga(new Request(`http://localhost:3010/api/meta/descargar?ad=${AD}&medio=0`));
  assert.equal(sinMeta.status, 503);
  assert.deepEqual(await sinMeta.json(), { error: "Meta no está configurado." });

  const malAnuncio = await conMeta(anuncio(), "ad=abc&medio=0");
  assert.equal(malAnuncio.status, 400);
  assert.deepEqual(await malAnuncio.json(), { error: "Falta el anuncio." });

  const malMedio = await conMeta(anuncio(), `ad=${AD}&medio=-1`);
  assert.equal(malMedio.status, 400);
  assert.deepEqual(await malMedio.json(), { error: "Falta saber qué archivo bajar." });
});

test("si Meta no entrega el archivo, el navegador recibe un mensaje claro y no un archivo roto", async () => {
  const r = await conMeta(anuncio({ [VIDEO.split("?")[0]]: () => new Response("expiró", { status: 403 }) }), `ad=${AD}&medio=0&tipo=video`);
  assert.equal(r.status, 502);
  const j = (await r.json()) as { error: string };
  assert.match(j.error, /Meta no entregó el archivo \(contestó 403\)/);
  assert.equal(r.headers.get("content-disposition"), null, "no es una descarga");
});

test("un video del que Meta sólo dio la portada: el video no se baja, la portada sí", async () => {
  const sinSource = { [`${GRAPH}/999`]: () => json({ picture: PORTADA, format: [{ width: 720, height: 1280, picture: PORTADA }] }), [PORTADA.split("?")[0]]: () => new Response("JPG", { status: 200, headers: { "content-type": "image/jpeg" } }) };
  const video = await conMeta(anuncio(sinSource), `ad=${AD}&medio=0&tipo=imagen&nombre=Anuncio`);
  assert.equal(video.status, 422);
  assert.match(((await video.json()) as { error: string }).error, /sólo se puede bajar su portada/);

  const portada = await conMeta(anuncio(sinSource), `ad=${AD}&medio=0&tipo=imagen&portada=1&nombre=Anuncio`);
  assert.equal(portada.status, 200);
  assert.match(portada.headers.get("content-disposition") ?? "", /filename="Anuncio . portada\.jpg"/);
  assert.equal(await portada.text(), "JPG");
});
