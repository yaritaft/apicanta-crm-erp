import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarUtm, CASOS, FUENTES, fuenteDeUtm } from "@/lib/utm-estandar";
import { embudoDe } from "@/lib/agendas-webinar";
import { COLUMNA, COLUMNAS_SUMADAS, VISIBLES_POR_DEFECTO } from "@/lib/crm-tabla";
import { origenDe, origenDeUtm } from "@/lib/utms";
import { estrategiaDeLaVenta } from "@/lib/estrategia-de-venta";
import type { EstadoApp } from "@/lib/types";

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

/* Lo definido con Yari: la estrategia sale del link de quien compró, el último antes de la venta. */
const conEmbudos = (extra: Partial<EstadoApp> = {}) => ({
  embudos: [{ id: "yt", nombre: "VSL YOUTUBE" }, { id: "web", nombre: "Webinar", esWebinar: true }, { id: "land", nombre: "VSL Landing" }],
  webinars: [], equipo: [], leads: [], contactos: [], sesiones: [], ajustes: {}, ...extra,
}) as unknown as EstadoApp;
const AHORA = "2026-10-27T12:00:00.000Z";

test("los links de YouTube escritos a mano van a VSL YOUTUBE, igual que el estándar", () => {
  const e = conEmbudos();
  for (const utm of [{ source: "YT", medium: "Bio" }, { source: "YouTube", medium: "17SEP" }, { source: "Landing-Organic", medium: "YT" }, { source: "youtube", medium: "organic", campaign: "vsl-yt" }]) {
    assert.equal(origenDe(e, utm, AHORA)?.embudoId, "yt", JSON.stringify(utm));
  }
});

test("lo que no es YouTube no cambia: la landing de Instagram no dice estrategia, y una campaña de webinar sigue siendo webinar", () => {
  const e = conEmbudos();
  assert.equal(origenDe(e, { source: "Landing-Organic", medium: "IG" }, AHORA), null);
  assert.equal(origenDe(e, { source: "youtube", campaign: "webinar_20261021", content: "vivo" }, AHORA)?.embudoId, "web");
});

test("una regla de Ajustes manda sobre la lectura de YouTube", () => {
  const e = conEmbudos({ ajustes: { reglasUtm: [{ id: "r", source: "Landing-Organic", medium: "YT", embudoId: "land", creadoEn: AHORA }] } } as never);
  assert.equal(origenDe(e, { source: "Landing-Organic", medium: "YT" }, AHORA)?.embudoId, "land");
});

test("cuenta el último link antes de la venta: fue a un webinar y después agendó por YouTube", () => {
  const sesion = (id: string, creadoEn: string, utm: Record<string, string>) => ({ id, contactoId: "c", creadoEn, utm });
  const e = conEmbudos({
    contactos: [{ id: "c", creadoEn: "2026-10-01T00:00:00.000Z" }],
    sesiones: [
      sesion("web", "2026-10-16T12:00:00.000Z", { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20261021" }),
      sesion("yt", "2026-10-26T12:00:00.000Z", { utm_source: "Landing-Organic", utm_medium: "YT" }),
    ],
  } as never);
  assert.equal(origenDeUtm(e, "c", AHORA)?.embudoId, "yt");
  /* El closer no la cambia a mano: manda el link. */
  assert.equal(estrategiaDeLaVenta(e, "c", AHORA, "web"), "yt");
  /* Una venta anterior al link de YouTube sigue siendo del webinar. */
  assert.equal(origenDeUtm(e, "c", "2026-10-20T12:00:00.000Z")?.embudoId, "web");
});
