import test from "node:test";
import assert from "node:assert/strict";
import {
  accesosDelPrograma, accesosSinExplicacion, conCodigoDelAlumno, explicacionDe, guiaDeBienvenida, htmlDeBienvenida, modeloDeBienvenida, textoDeBienvenida,
  type ConfigBienvenida,
} from "@/lib/bienvenida-alumno";
import { armarBienvenida, type AccesoParaBienvenida } from "@/lib/contratos";
import { WISBOO, type Programa } from "@/lib/programas";
import { modulosDelSimulacro, problemaDeInscripcion, textoPreparado, TIPOS_PEDIDOS } from "@/lib/simulacros";

/* Lili, 20/11: un alumno nuevo no entendía qué había en cada plataforma. Pidió que «Tus accesos» diga qué hay en Wisboo, en cada grupo
   de Telegram y en Zoom; que el paso 7 diga qué hay en Bonos; que la clase de los martes aclare que se puede ir de oyente y qué módulos
   pide cada simulacro; y que todo se adapte a lo que contrató cada uno. La raíz: el mail eran textos fijos, sueltos de lo que la app le
   da. Ahora sale de los accesos de su programa (los mismos con los que se le dan). */

/* Los programas tal como están en producción (Ajustes → Programas, 20/11). */
const GENERAL = "-1004341505711", CONTENIDO = "-1004393795361", NOVEDADES = "-1004338558206", BOLSA = "-1004492115716", GRUPO_IA = "-1003990857017";
const JUEVES = "84681899646", MIERCOLES = "84967094264", MARTES = "83449857065";
const base = { productos: [], plantillaId: "x", plantillaNombre: "x", bonos: [], activo: true };
const P: Record<string, Programa> = {
  "hackear-ai": { ...base, id: "hackear-ai", nombre: "Hackear AI", wisboo: [WISBOO.hackearIt, WISBOO.hackearAi, WISBOO.bonos], telegram: [GENERAL, CONTENIDO, NOVEDADES, BOLSA, GRUPO_IA], zoom: [JUEVES, MIERCOLES, MARTES] },
  downsell: { ...base, id: "downsell", nombre: "Downsell", wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [], zoom: [] },
  "downsell-plus": { ...base, id: "downsell-plus", nombre: "Downsell Plus+", wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [BOLSA], zoom: [], vencen: {} },
  "hackear-ia-mid": {
    ...base, id: "hackear-ia-mid", nombre: "Hackear IA MID", wisboo: [WISBOO.hackearIt, WISBOO.hackearAi], telegram: [GENERAL, CONTENIDO, NOVEDADES, GRUPO_IA], zoom: [JUEVES, MIERCOLES, MARTES],
    vencen: Object.fromEntries([...[GENERAL, CONTENIDO, NOVEDADES, GRUPO_IA].map((id) => `telegram:${id}`), ...[JUEVES, MIERCOLES, MARTES].map((id) => `zoom:${id}`)].map((k) => [k, 1])),
  },
  "hackear-biz": { ...base, id: "hackear-biz", nombre: "Hackear Biz", wisboo: [WISBOO.hackearBiz], telegram: ["-1004439139014"], zoom: ["83219238566"] },
};

const CONFIG: ConfigBienvenida = {
  soporte: { nombre: "Liliana", whatsapp: "+54 9 11 5555-0001" }, auditoriaCv: { nombre: "Aldana", whatsapp: "+54 9 11 5555-0002" },
  salasZoom: { martes: { link: "https://zoom.us/j/1", id: "1", clave: "a" }, miercoles: { link: "https://zoom.us/j/2" }, jueves: { link: "https://zoom.us/j/3" } },
};
const PAGINA = "https://apicanta-erp.vercel.app/bienvenida/abc123";
const mail = (programa: string, extra: { codigo?: string } = {}) => {
  let g = guiaDeBienvenida({ programa, perfil: "Full Stack", config: CONFIG, delPrograma: P[programa] })!;
  if (extra.codigo) g = conCodigoDelAlumno(g, "https://app.x", extra.codigo);
  return textoDeBienvenida(g, PAGINA).texto;
};
/* El bloque «Tus accesos», hasta el paso a paso. */
const accesos = (t: string) => t.slice(t.indexOf("🔑 Tus accesos"), t.indexOf("📍 1."));

test("programa completo: «Tus accesos» dice qué hay en Wisboo, en cada grupo de Telegram y en Zoom, como lo escribió Lili", () => {
  const a = accesos(mail("hackear-ai"));
  assert.match(a, /• Wisboo: la plataforma donde encontrás todo el contenido grabado, organizado en:\n {3}1\. Hackear IT\n {3}2\. Hackear IA\n {3}3\. Bonos/);
  assert.match(a, /• Telegram: nuestro principal medio de comunicación\. Ahí vas a encontrar estos grupos:\n/);
  /* En el orden de Lili, aunque en Ajustes estén en otro. */
  assert.match(a, / {3}– General: comunidad con todos los alumnos\.\n {3}– Novedades: canal donde realizamos comunicados importantes\.\n {3}– Bolsa de trabajo: publicación de oportunidades laborales\.\n {3}– Contenido recomendado: compartimos recursos y contenido de interés\.\n {3}– Hackear IA: espacio exclusivo para consultas relacionadas con IA\./);
  assert.match(a, /• Zoom: la plataforma donde realizamos las 3 clases semanales de acompañamiento\. Te las contamos más abajo\./);
  assert.match(a, /Entrá acá para ingresar a Wisboo, sumarte a los grupos de Telegram y tener tus links de Zoom \(guardá este link\):\nhttps:\/\/apicanta-erp\.vercel\.app\/bienvenida\/abc123/);
});

test("programa completo: el paso 7 dice qué hay en Bonos", () => {
  assert.match(mail("hackear-ai"), /7\. Aprovechá los bonos disponibles\n• Tenés contenido extra para complementar tu formación: inversiones seguras, finanzas personales, crecimiento interno, fiscalidad y manejo de USD\.\n• Lo encontrás en Wisboo, en la sección «Bonos»\./);
});

test("la clase de los martes: puede ir de oyente, y cada simulacro pide sus módulos antes de anotarse", () => {
  const codigo = "3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f";
  const t = mail("hackear-ai", { codigo });
  assert.match(t, /• Martes 18:00: simulacros de entrevistas y tema nuevo\.\n👉 Sala: https:\/\/zoom\.us\/j\/1\nID: 1 · Clave: a\n\nPodés sumarte como oyente y participar de la clase\. Para hacer un simulacro, antes tenés que haber visto estos módulos:\n– Simulacro de entrevista de HR: el Módulo 5 de Hackear IT\.\n– Simulacro de entrevista técnica: los Módulos 7, 8 y 9 de Hackear IT\.\nUna vez que los completes, anotate acá para el simulacro que corresponda:\n👉 https:\/\/app\.x\/simulacro\?c=/);
  assert.match(t, /Así llegás preparado y aprovechás el espacio al máximo\./);
  /* Los tres días, en orden de la semana, y la ayuda queda en el punto 4. */
  assert.ok(t.indexOf("• Martes") < t.indexOf("• Miércoles") && t.indexOf("• Miércoles") < t.indexOf("• Jueves"));
  assert.match(t, /🤝 4\. ¿Necesitás ayuda durante el proceso\?/);
});

test("Downsell: no se le nombra Telegram, Zoom ni Bonos (no los tiene), y el THC se lo pide a soporte", () => {
  const t = mail("downsell");
  assert.match(accesos(t), /• Wisboo: [^\n]*\n {3}1\. Hackear IT\n {3}2\. Hackear IA\n\nEntrá acá para ingresar a Wisboo \(guardá este link\)/);
  assert.doesNotMatch(t, /Telegram/, "no tiene ningún grupo");
  assert.doesNotMatch(t, /Zoom|Martes 18:00/, "no tiene clases");
  assert.doesNotMatch(t, /Bonos|bonos/);
  assert.doesNotMatch(t, /grupo de novedades/, "no está en ese grupo: no se lo manda a buscar el THC ahí");
  assert.match(t, /• Hay dos THC, el de Full Stack y el de Data Engineer: pedile el tuyo al equipo de soporte por WhatsApp\./);
  assert.match(t, /🤝 2\. ¿Necesitás ayuda durante el proceso\?/);
});

test("Downsell Plus+: sólo el grupo de Bolsa de trabajo", () => {
  const a = accesos(mail("downsell-plus"));
  assert.match(a, /• Telegram: nuestro principal medio de comunicación\. Ahí vas a encontrar este grupo:\n {3}– Bolsa de trabajo: publicación de oportunidades laborales\./);
  assert.doesNotMatch(a, /General|Novedades|Contenido recomendado|– Hackear IA/);
  assert.match(a, /para ingresar a Wisboo y sumarte al grupo de Telegram \(guardá/);
  assert.doesNotMatch(mail("downsell-plus"), /Zoom/);
});

test("Hackear IA MID: ahora se le cuentan sus clases y sus grupos, y que son por el primer mes", () => {
  const t = mail("hackear-ia-mid");
  const a = accesos(t);
  assert.match(a, /• Telegram: nuestro principal medio de comunicación \(durante tu primer mes\)\. Ahí vas a encontrar estos grupos:/);
  assert.doesNotMatch(a, /Bolsa de trabajo/, "el MID no tiene ese grupo");
  assert.match(a, /• Zoom: la plataforma donde realizamos las 3 clases semanales de acompañamiento \(durante tu primer mes\)\./);
  assert.match(t, /🎥 2\. Aprovechá las salas de Zoom\nLas tenés durante tu primer mes\. Son tres días por semana, todos a las 18:00 \(hora de Argentina\):/);
  /* Sin link para anotarse (es del programa completo): se le dice que, completados los módulos, va a poder anotarse. */
  assert.match(t, /Una vez que los completes, vas a poder anotarte para el simulacro que corresponda\./);
  /* Las salas con clave son sólo del programa completo (Lili, 28/10): sus links personales están en su página. */
  assert.doesNotMatch(t, /zoom\.us\/j\//);
  assert.match(t, /Tus links personales para entrar a cada clase están en tu página de accesos/);
  assert.match(t, /grupo de novedades en Telegram/, "el MID sí está en Novedades");
  assert.doesNotMatch(t, /Bonos/);
  assert.match(t, /🤝 3\. ¿Necesitás ayuda durante el proceso\?/);
});

test("ningún programa nombra un grupo, curso o clase que no trae (recorre todos)", () => {
  const todos = [
    ...[GENERAL, CONTENIDO, NOVEDADES, BOLSA, GRUPO_IA].map((id) => ({ plataforma: "telegram" as const, id })),
    ...[WISBOO.hackearIt, WISBOO.hackearAi, WISBOO.bonos].map((id) => ({ plataforma: "wisboo" as const, id })),
  ];
  for (const p of Object.values(P)) {
    if (!modeloDeBienvenida({ programa: p.id })) continue;
    const a = accesos(mail(p.id));
    for (const x of todos) {
      const e = explicacionDe(x.plataforma, x.id)!;
      const renglon = x.plataforma === "telegram" ? `– ${e.nombre}: ` : `. ${e.nombre}\n`;
      const lo = (p[x.plataforma] as string[]).includes(x.id);
      assert.equal(`${a}\n`.includes(renglon), lo, `${p.nombre}: «${e.nombre}» ${lo ? "falta" : "no lo tiene y se nombra"}`);
    }
    assert.equal(/• Zoom:/.test(a), p.zoom.length > 0, `${p.nombre}: Zoom`);
    assert.equal(/• Telegram:/.test(a), p.telegram.length > 0, `${p.nombre}: Telegram`);
  }
});

test("un acceso nuevo sin explicación sale con su nombre y Ajustes lo marca; si Telegram le cambia el id, se reconoce por el nombre", () => {
  const conNuevo = { ...P["hackear-ai"], telegram: [...P["hackear-ai"].telegram, "-100999"] };
  const nombres = { "telegram:-100999": "Hackear AI - Avanzados" };
  const a = accesosDelPrograma(conNuevo, nombres)!;
  assert.deepEqual(a.grupos.at(-1), { recurso: "-100999", nombre: "Hackear AI - Avanzados", detalle: null, dia: null });
  assert.deepEqual(accesosSinExplicacion(conNuevo, nombres), ["Hackear AI - Avanzados"]);
  assert.deepEqual(accesosSinExplicacion(P["hackear-ai"]), [], "hoy todos los del programa completo tienen explicación");
  assert.deepEqual(accesosSinExplicacion(P["hackear-ia-mid"]), []);
  /* Sin nombre conocido no se inventa: no se nombra (está igual en su página de accesos). */
  assert.equal(accesosDelPrograma({ ...P.downsell, telegram: ["-100888"] })!.grupos.length, 0);
  /* Supergrupo con id nuevo: mismo nombre, misma explicación. */
  assert.equal(explicacionDe("telegram", "-1009999999", "Novedades - Mentoría")?.detalle, "canal donde realizamos comunicados importantes");
  assert.equal(explicacionDe("zoom", "1", "Reunion Seguimiento y Consultas Hackear IT - ZOOM")?.dia, "jueves");
  assert.equal(explicacionDe("zoom", "1", "Sesión de consultas IA (Hackear AI) - ZOOM")?.dia, "miercoles");
  assert.equal(explicacionDe("telegram", "1", "Hackear Biz - Espiritualidad"), null);
});

test("sin saber el programa, el mail sale como antes (las tres clases, bonos y el THC en Novedades), sin prometer accesos", () => {
  const t = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", perfil: "Full Stack", config: CONFIG })!, PAGINA).texto;
  assert.match(t, /🔑 Tus accesos\n\nEntrá acá para ver tus accesos \(guardá este link\):\nhttps:/);
  assert.match(t, /Son tres días por semana/);
  assert.match(t, /7\. Aprovechá los bonos disponibles/);
  assert.match(t, /grupo de novedades en Telegram/);
});

test("el HTML del mail conserva la sangría de las listas de adentro", () => {
  const html = htmlDeBienvenida("• Wisboo:\n   1. Hackear IT");
  assert.ok(html.includes("<br>&nbsp;&nbsp;&nbsp;1. Hackear IT"));
});

test("la página de bienvenida dice qué hay en cada grupo y qué día es cada clase, y nombra los cursos como el mail", () => {
  const ac = (plataforma: AccesoParaBienvenida["plataforma"], recurso: string, recursoNombre: string, externo: Record<string, unknown> = {}): AccesoParaBienvenida =>
    ({ plataforma, recurso, recursoNombre, estado: "dado", externo });
  const b = armarBienvenida({
    contrato: { estado: "firmado", accesosEn: "2026-11-20T12:00:00Z", destinatario: { nombre: "Ana" } }, programa: "Hackear AI", linkWisboo: "https://w", accesosAutomaticos: true,
    accesos: [
      ac("wisboo", WISBOO.bonos, "Bonos"), ac("wisboo", WISBOO.hackearAi, "Mentoría (Hackear AI)"), ac("wisboo", WISBOO.hackearIt, "Mentoría (Hackear IT)"),
      ac("telegram", BOLSA, "Bolsa de trabajo", { link: "https://t.me/+a" }),
      ac("zoom", JUEVES, "Reunion Seguimiento y Consultas Hackear IT - ZOOM", { joinUrl: "https://zoom.us/w/1" }), ac("zoom", MARTES, "Simulacros y Taller Tema Nuevo - ZOOM", { joinUrl: "https://zoom.us/w/2" }),
    ],
  });
  assert.deepEqual(b.wisboo, { url: "https://w", cursos: ["Hackear IT", "Hackear IA", "Bonos"], bonos: true });
  assert.equal(b.telegram[0].detalle, "Publicación de oportunidades laborales");
  assert.deepEqual(b.zoom.map((z) => z.detalle), ["Martes 18:00 (Argentina) · simulacros de entrevistas y tema nuevo", "Jueves 18:00 (Argentina) · seguimiento y consultas en general"]);
});

test("el formulario del simulacro pide los módulos de lo que eligió (HR: el 5; técnica: el 7, 8 y 9)", () => {
  assert.equal(modulosDelSimulacro("Recursos Humanos"), "el Módulo 5 de Hackear IT");
  for (const t of TIPOS_PEDIDOS.filter((x) => x !== "Recursos Humanos")) assert.equal(modulosDelSimulacro(t), "los Módulos 7, 8 y 9 de Hackear IT", t);
  assert.equal(textoPreparado("Algoritmia"), "Sí, ya vi los Módulos 7, 8 y 9 de Hackear IT y me preparé");
  assert.equal(problemaDeInscripcion({ stack: "React", tipoPedido: "Recursos Humanos", preparado: false }), "Para anotarte tenés que haber visto el Módulo 5 de Hackear IT y haberte preparado.");
});
