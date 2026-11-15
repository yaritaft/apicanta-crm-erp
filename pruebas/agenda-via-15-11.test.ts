import test from "node:test";
import assert from "node:assert/strict";
import { viaDeLink } from "@/lib/agendas-webinar";

/* Manuel (15/11): «las llamadas de la clase cero y la clase de Nahu, ¿hay forma de verlas filtradas?».
   El filtro de Webinar de la Agenda las junta con las del vivo; el de Vía las separa por el link con el que agendó. */

const camp = (utm_campaign: string, extra: Record<string, string> = {}) => ({ utm_source: "calendly", utm_medium: "bio", utm_campaign, ...extra });

test("el link dice por qué vía agendó: webinar, clase cero o Q&A (la charla de Nahuel)", () => {
  assert.equal(viaDeLink(camp("webinar_20260924", { utm_content: "vivo" })), "webinar");
  assert.equal(viaDeLink(camp("webinar_20260924", { utm_content: "replay" })), "webinar");
  assert.equal(viaDeLink(camp("clase0_webinar_20260924", { utm_content: "vivo" })), "clase0");
  assert.equal(viaDeLink(camp("qa_webinar_20260924", { utm_content: "seguimiento" })), "qa");
});

test("los links de antes también: la clase cero con su fecha y el webinar con la fuente Webinar", () => {
  assert.equal(viaDeLink(camp("clase0_20260929")), "clase0");
  assert.equal(viaDeLink(camp("qa_20260929")), "qa");
  assert.equal(viaDeLink({ utm_source: "Webinar", utm_medium: "23-09", utm_content: "EnVivo" }), "webinar");
});

test("mayúsculas y utm_ de más o de menos no cambian la vía", () => {
  assert.equal(viaDeLink({ source: "calendly", medium: "bio", campaign: "Clase0_Webinar_20260924" }), "clase0");
  assert.equal(viaDeLink({ UTM_SOURCE: "calendly", UTM_CAMPAIGN: "QA_webinar_20260924" }), "qa");
});

test("lo que no viene de un link del lanzamiento no tiene vía", () => {
  assert.equal(viaDeLink(camp("vsl")), null);
  assert.equal(viaDeLink(camp("vsl-yt")), null);
  assert.equal(viaDeLink(camp("setter_ia")), null);
  assert.equal(viaDeLink({ utm_source: "direct", utm_medium: "none" }), null);
  assert.equal(viaDeLink({}), null);
  assert.equal(viaDeLink(null), null);
  assert.equal(viaDeLink(undefined), null);
});
