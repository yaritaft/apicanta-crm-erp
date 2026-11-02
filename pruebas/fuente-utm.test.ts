import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarUtm, CASOS, FUENTES, fuenteDeUtm } from "@/lib/utm-estandar";
import { embudoDe } from "@/lib/agendas-webinar";
import { COLUMNA, COLUMNAS_SUMADAS, VISIBLES_POR_DEFECTO } from "@/lib/crm-tabla";

/* Santi, 02/11: «necesitaría ver sólo las llamadas de YouTube». El filtro de canal juntaba todo el VSL y YouTube
   llegaba escrito de tres formas. Estos son los valores que hay en producción: si alguien cambia el traductor y
   uno deja de leerse igual, salta acá. */

const de = (utm_source?: string, utm_medium?: string, utm_campaign?: string) =>
  fuenteDeUtm({ utm_source, utm_medium, utm_campaign })?.valor;

test("YouTube es una sola fuente, se escriba como se escriba", () => {
  assert.equal(de("YT", "Bio"), "youtube");
  assert.equal(de("YouTube", "17SEP"), "youtube");
  assert.equal(de("YouTube", "4AGO"), "youtube");
  assert.equal(de("youtube", "organic", "vsl-yt"), "youtube");
  assert.equal(de("Landing-Organic", "YT"), "youtube");
  /* El estándar lo dice en la campaña, aunque la fuente venga mal. */
  assert.equal(de("algo-raro", "organic", "vsl-yt"), "youtube");
});

test("la landing no es una fuente: la dice el medium", () => {
  assert.equal(de("Landing-Organic", "IG"), "instagram");
  assert.equal(de("Landing-Organic"), "landing");
  assert.equal(de("Landing", "ORG"), "landing");
  assert.equal(de("Landing"), "landing");
});

test("los demás valores de producción", () => {
  assert.equal(de("facebook", "ppc"), "meta");
  assert.equal(de("meta", "paid"), "meta");
  assert.equal(de("instagram", "paid"), "meta");
  assert.equal(de("instagram", "organic"), "instagram");
  assert.equal(de("tiktok", "paid"), "tiktok");
  assert.equal(de("whatsapp", "email"), "whatsapp");
  assert.equal(de("email", "email"), "email");
  assert.equal(de("Webinar", "23-09"), "webinar");
  assert.equal(de("setter-ia", "IG"), "setter-ia");
  assert.equal(de("Setter", "IG"), "setter");
  assert.equal(de("Resell"), "resell");
  assert.equal(de("direct", "none"), "directo");
});

test("un link sin nada no tiene fuente; una fecha en el medium tampoco es una", () => {
  assert.equal(fuenteDeUtm(null), null);
  assert.equal(fuenteDeUtm({}), null);
  assert.equal(fuenteDeUtm({ utm_medium: "23-09" }), null);
});

test("una fuente nueva no se pierde: sale con su nombre y avisa que no se conoce", () => {
  assert.deepEqual(fuenteDeUtm({ utm_source: "OP Lanza Neptuno" }), { valor: "op-lanza-neptuno", texto: "OP Lanza Neptuno", conocida: false });
  assert.equal(fuenteDeUtm({ utm_source: "chatgpt.com" })?.conocida, false);
  /* Escrita distinta, es la misma opción del filtro. */
  assert.equal(de("Chat GPT"), de("chat-gpt"));
});

test("todo lo del diccionario del estándar y todo link que arma el creador se reconoce", () => {
  for (const f of FUENTES) assert.equal(fuenteDeUtm({ utm_source: f })?.conocida, true, f);
  for (const c of CASOS) assert.equal(fuenteDeUtm(armarUtm(c.id))?.conocida, true, c.id);
});

test("la etiqueta de la agenda dice la fuente con el mismo nombre que el filtro", () => {
  const texto = (canal: string | null, utm: Record<string, string> | null) => embudoDe({ canal, utm }).texto;
  assert.equal(texto("vsl", { utm_source: "YT", utm_medium: "Bio" }), "VSL · YouTube");
  assert.equal(texto("vsl", { utm_source: "YouTube", utm_medium: "17SEP" }), "VSL · YouTube");
  assert.equal(texto("vsl", { utm_source: "Landing-Organic", utm_medium: "YT" }), "VSL · YouTube");
  assert.equal(texto("vsl", { utm_source: "Landing-Organic", utm_medium: "IG" }), "VSL · Instagram");
  assert.equal(texto("vsl", { utm_source: "facebook", utm_medium: "ppc" }), "VSL · Meta");
  assert.equal(texto("vsl", null), "VSL");
  assert.equal(texto("setter", { utm_source: "Setter", utm_medium: "IG" }), "Setter");
  assert.equal(texto("setter", { utm_source: "setter-ia", utm_medium: "IG" }), "Setter IA");
  assert.equal(texto(null, { utm_source: "OP Lanza Neptuno" }), "OP Lanza Neptuno");
  assert.equal(texto(null, null), "Sin UTMs");
});

test("la Agenda filtra y la tabla del CRM muestra con el mismo traductor", () => {
  const agenda = readFileSync("src/app/(app)/agenda/page.tsx", "utf8");
  assert.match(agenda, /fuente: \(s\) => fuenteDeUtm\(s\.utm\)\?\.valor \?\? SIN/);
  assert.match(agenda, /etiqueta="Filtrar por fuente"/);
  assert.ok(COLUMNA.fuente, "la columna Fuente del CRM (y de la descarga)");
  assert.ok(VISIBLES_POR_DEFECTO.includes("fuente"));
  assert.ok(COLUMNAS_SUMADAS.some((x) => x.claves.includes("fuente")), "quien ya tenía sus columnas guardadas también la recibe");
  /* Nadie vuelve a leer el utm_source crudo para decir de dónde vino. */
  assert.doesNotMatch(agenda, /utm_source/);
});
