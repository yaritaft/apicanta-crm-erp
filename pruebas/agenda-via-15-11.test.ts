import test from "node:test";
import assert from "node:assert/strict";
import { embudoDe, viaDeLink } from "@/lib/agendas-webinar";
import { viaDe } from "@/lib/crm-tabla";
import { eventoDeUtm, leerUtm } from "@/lib/utm-estandar";

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

/* Manuel (17/11), con el filtro ya publicado: «¿acá debería estar para filtrar las clases cero?». Sólo aparecían
   Webinar y Q&A: las agendas de clase cero de producción no traen clase0_webinar_… sino el link de antes, con
   utm_source=Webinar, la fecha del webinar en el medium y el evento en el utm_content. Estos son los valores reales
   de producción (37 Clase_0, 10 NahuelHistoria, 6 Q_and_A, 181 EnVivo, 46 PostWebinar). */
const viejo = (utm_content: string, utm_medium = "13-04") => ({ utm_source: "Webinar", utm_medium, utm_content });

test("los links de antes de la clase cero y de la charla de Nahuel (el evento va en el content) tienen su vía", () => {
  assert.equal(viaDeLink(viejo("Clase_0")), "clase0");
  assert.equal(viaDeLink(viejo("Q_and_A")), "qa");
  assert.equal(viaDeLink(viejo("NahuelHistoria")), "qa");
  assert.equal(viaDeLink(viejo("EnVivo")), "webinar");
  assert.equal(viaDeLink(viejo("PostWebinar")), "webinar");
  /* Sin evento en el content (sólo la fecha en el medium o en el content), sigue siendo el webinar. */
  assert.equal(viaDeLink({ utm_source: "Webinar", utm_medium: "09-09", utm_content: "09-09" }), "webinar");
  assert.equal(viaDeLink({ utm_source: "Webinar", utm_content: "13-04" }), "webinar");
});

test("la clase cero vieja se reconoce con mayúsculas, espacios o guiones distintos", () => {
  for (const c of ["Clase_0", "clase 0", "CLASE-0", "clase0", "Clase_Cero", "clase cero"]) assert.equal(viaDeLink(viejo(c)), "clase0", c);
  for (const c of ["QA", "Q&A", "q_and_a", "Q y A", "nahuel historia", "NahuelHistoria"]) assert.equal(viaDeLink(viejo(c)), "qa", c);
  /* No toma por clase cero lo que sólo se le parece. */
  for (const c of ["Clase_01", "Claseo", "Clase_0_extra", "Historia"]) assert.equal(viaDeLink(viejo(c)), "webinar", c);
});

test("el content «Clase_0» sólo cuenta en el link viejo: en otras fuentes no es una vía", () => {
  assert.equal(viaDeLink({ utm_source: "calendly", utm_medium: "bio", utm_content: "Clase_0" }), null);
  assert.equal(viaDeLink({ utm_source: "whatsapp", utm_medium: "email", utm_content: "clase0" }), null);
});

test("leerUtm no se movió: los links viejos siguen siendo «webinar» para los lanzamientos y el reporte", () => {
  assert.equal(leerUtm(viejo("Clase_0")).funnel, "webinar");
  assert.equal(leerUtm(viejo("Q_and_A")).funnel, "webinar");
  assert.equal(eventoDeUtm(leerUtm(viejo("Clase_0"))), "clase0");
  assert.equal(eventoDeUtm(leerUtm({ utm_source: "calendly", utm_medium: "bio", utm_campaign: "vsl" })), undefined);
});

test("la columna «Embudo» de la Agenda y la «Vía» del CRM dicen lo mismo que el filtro", () => {
  assert.equal(embudoDe({ utm: viejo("Clase_0") }).texto, "Clase cero del webinar 13-04");
  assert.equal(embudoDe({ utm: viejo("NahuelHistoria") }).texto, "Q&A del webinar 13-04");
  assert.equal(embudoDe({ utm: viejo("EnVivo") }).texto, "Webinar 13-04");
  assert.equal(embudoDe({ utm: viejo("EnVivo") }).link, "EnVivo");
  const f = { funnel: "Webinar" };
  assert.equal(viaDe({ utm: viejo("Clase_0") }, f), "Clase cero");
  assert.equal(viaDe({ utm: viejo("Q_and_A") }, f), "Q&A");
  assert.equal(viaDe({ utm: viejo("EnVivo") }, f), "Webinar · vivo");
  assert.equal(viaDe({ utm: viejo("PostWebinar") }, f), "Webinar · después");
});
