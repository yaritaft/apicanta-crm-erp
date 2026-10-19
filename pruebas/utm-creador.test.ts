import test from "node:test";
import assert from "node:assert/strict";
import {
  armarPaqueteWebinar, armarUtm, CASOS, diaDelWebinar, leerUtm, linkConUtm, MOMENTOS_EVENTO, PAQUETE_WEBINAR, problemasDeUtm,
  textoDelPaquete, type IdCaso, type Utm,
} from "@/lib/utm-estandar";

/* ==================================================================
   El creador de UTMs y la app que lee sus links tienen que decir lo mismo.

   Un link que el creador arma se lee, tal cual, con leerUtm: de qué
   funnel es, de qué webinar y en qué momento. Si alguien toca uno de los
   dos lados y el otro queda atrás, estas pruebas fallan antes de que el
   equipo mande un link que la app no entiende (o entiende de otro modo).

   Nació de un pedido del equipo (19/10): armar de una vez los links de un
   webinar (en vivo, post webinar, charla de Nahuel y Q&A, clase cero) desde
   su Calendly, sin saber de casos ni de momentos.
   ================================================================== */

const CALENDLY = "https://calendly.com/lanzamiento-yari-taft/llamada-de-asesoramiento-webinar";

/* Los parámetros de un link, como los vería quien lo abre. */
function utmDeLink(link: string): Utm {
  const url = new URL(link);
  return Object.fromEntries(url.searchParams.entries()) as Utm;
}

test("el paquete trae los cuatro lugares donde se agenda, con los nombres del equipo", () => {
  const g = armarPaqueteWebinar(CALENDLY, { fecha: "2026-10-21", fuenteEvento: "whatsapp" });
  assert.deepEqual(g.map((x) => x.titulo), [
    "Webinar · agenda en vivo",
    "Webinar · agenda post webinar",
    "Charla Nahuel y Q&A · agendar en esta transmisión",
    "Clase cero · agendar en esta transmisión",
  ]);
  /* El de después del webinar lleva dos: la grabación y los mails y mensajes. */
  assert.deepEqual(g.map((x) => x.links.length), [1, 2, 1, 1]);
});

test("cada link del paquete usa el Calendly pedido y es distinto de los demás", () => {
  const links = armarPaqueteWebinar(CALENDLY, { fecha: "2026-10-21" }).flatMap((g) => g.links.map((l) => l.link));
  assert.equal(links.length, 5);
  assert.equal(new Set(links).size, 5);
  for (const l of links) assert.ok(l.startsWith(`${CALENDLY}?utm_source=`), l);
});

test("las campañas del paquete: webinar, webinar, qa_webinar y clase0_webinar, todas con la fecha del webinar", () => {
  const g = armarPaqueteWebinar(CALENDLY, { fecha: "2026-10-21" });
  const campanas = g.map((x) => x.links.map((l) => utmDeLink(l.link).utm_campaign));
  assert.deepEqual(campanas, [
    ["webinar_20261021"],
    ["webinar_20261021", "webinar_20261021"],
    ["qa_webinar_20261021"],
    ["clase0_webinar_20261021"],
  ]);
  const momentos = g.map((x) => x.links.map((l) => utmDeLink(l.link).utm_content));
  assert.deepEqual(momentos, [["vivo"], ["replay", "seguimiento"], ["vivo"], ["vivo"]]);
});

test("lo que el creador arma, la app lo lee: funnel, webinar y momento", () => {
  const g = armarPaqueteWebinar(CALENDLY, { fecha: "2026-10-21", fuenteEvento: "whatsapp" });
  const esperado: Record<string, { funnel: string; momento: "vivo" | "despues" }[]> = {
    "webinar-vivo": [{ funnel: "webinar", momento: "vivo" }],
    "webinar-post": [{ funnel: "webinar", momento: "despues" }, { funnel: "webinar", momento: "despues" }],
    "qa-vivo": [{ funnel: "qa", momento: "vivo" }],
    "clase0-vivo": [{ funnel: "clase0", momento: "vivo" }],
  };
  for (const grupo of g) {
    grupo.links.forEach((l, i) => {
      const leida = leerUtm(utmDeLink(l.link));
      assert.equal(leida.formato, "estandar", l.link);
      assert.equal(leida.funnel, esperado[grupo.id][i].funnel, l.link);
      assert.equal(leida.momento, esperado[grupo.id][i].momento, l.link);
      /* Los cuatro son del mismo webinar, incluida la clase cero y el Q&A. */
      assert.equal(leida.fechaWebinar, "2026-10-21", l.link);
      assert.equal(diaDelWebinar(leida, []), "2026-10-21", l.link);
      assert.deepEqual(problemasDeUtm(l.utm), [], l.link);
    });
  }
});

test("«por dónde se manda» cambia sólo la fuente, en todos los links", () => {
  for (const fuente of ["email", "whatsapp"] as const) {
    const links = armarPaqueteWebinar(CALENDLY, { fecha: "2026-10-21", fuenteEvento: fuente }).flatMap((g) => g.links);
    for (const l of links) assert.equal(utmDeLink(l.link).utm_source, fuente);
  }
});

test("la fecha del webinar es la de Argentina, venga como día o como instante", () => {
  /* 22:00 UTC del 21 son las 19:00 en Argentina: sigue siendo el 21. Y la 01:00 UTC del 22 (22:00 del 21 allá) también. */
  for (const fecha of ["2026-10-21", "2026-10-21T22:00:00Z", "2026-10-22T01:00:00Z"]) {
    const l = armarPaqueteWebinar(CALENDLY, { fecha })[0].links[0];
    assert.equal(utmDeLink(l.link).utm_campaign, "webinar_20261021", fecha);
  }
});

test("un destino con parámetros o ancla los conserva y no repite UTMs viejas", () => {
  const l = armarPaqueteWebinar("https://calendly.com/x/y?name=Ana&utm_source=viejo#form", { fecha: "2026-10-21" })[0].links[0];
  assert.ok(l.link.endsWith("#form"), l.link);
  const url = new URL(l.link);
  assert.equal(url.searchParams.get("name"), "Ana");
  assert.equal(url.searchParams.getAll("utm_source").length, 1);
  assert.equal(url.searchParams.get("utm_source"), "email");
});

test("sin destino salen sólo los UTMs, para pegar al final del link", () => {
  const l = armarPaqueteWebinar("  ", { fecha: "2026-10-21" })[0].links[0];
  assert.ok(l.link.startsWith("?utm_source="), l.link);
});

test("el texto para copiar trae el título de cada link y debajo el link", () => {
  const g = armarPaqueteWebinar(CALENDLY, { fecha: "2026-10-21" });
  const texto = textoDelPaquete(g);
  const bloques = texto.split("\n\n");
  assert.equal(bloques.length, 5);
  for (const b of bloques) {
    const [titulo, link, ...resto] = b.split("\n");
    assert.equal(resto.length, 0);
    assert.ok(titulo.length > 0 && link.startsWith(CALENDLY), b);
  }
  assert.ok(texto.includes("Webinar · agenda post webinar — En la grabación (replay)\n"));
  assert.ok(texto.includes("Charla Nahuel y Q&A · agendar en esta transmisión\n"));
});

test("el paquete se arma con casos que existen en el estándar", () => {
  for (const g of PAQUETE_WEBINAR) {
    assert.ok(CASOS.some((c) => c.id === g.caso), g.id);
    for (const v of g.variantes) assert.ok((MOMENTOS_EVENTO as readonly string[]).includes(v.momento), `${g.id}:${v.momento}`);
  }
});

/* ---------- Todos los casos, uno por uno ---------- */

const VALORES = {
  fecha: "2026-10-21", fuenteEvento: "email" as const, video: "como-conseguir-trabajo-remoto",
  setter: "Daniel", referidor: "Ana Pérez", lugarVsl: "bio" as const, canalSetter: "dm" as const,
};

test("todo link de todo caso del creador sigue el estándar: la app no encuentra nada que objetar", () => {
  for (const c of CASOS) {
    if (c.id === "meta-vsl") continue; // lleva las llaves de Meta, que las completa Meta
    const momentos = c.funnel === "webinar" || c.funnel === "clase0" || c.funnel === "qa" ? MOMENTOS_EVENTO : [undefined];
    for (const momento of momentos) {
      const utm = armarUtm(c.id as IdCaso, { ...VALORES, momento });
      assert.deepEqual(problemasDeUtm(utm), [], `${c.id}/${momento}`);
      const leida = leerUtm(utm);
      assert.equal(leida.formato, "estandar", `${c.id}/${momento}`);
      assert.equal(leida.funnel, c.funnel, `${c.id}/${momento}`);
    }
  }
});

test("los eventos dicen su webinar: webinar_, qa_webinar_ y clase0_webinar_ con la misma fecha", () => {
  for (const id of ["webinar", "qa", "clase0"] as const) {
    const leida = leerUtm(armarUtm(id, { fecha: "2026-10-21", momento: "vivo" }));
    assert.equal(leida.fechaWebinar, "2026-10-21", id);
  }
});

test("linkConUtm con un destino cualquiera siempre termina en un link que la app lee", () => {
  for (const destino of [CALENDLY, `${CALENDLY}/`, "https://apicantait.com/webinar", "https://apicantait.com/webinar?ref=1", ""]) {
    const link = linkConUtm(destino, armarUtm("webinar", { fecha: "2026-10-21", momento: "vivo" }));
    const leida = leerUtm(utmDeLink(link.startsWith("?") ? `https://x.test/${link}` : link));
    assert.equal(leida.funnel, "webinar", link);
    assert.equal(leida.fechaWebinar, "2026-10-21", link);
  }
});
