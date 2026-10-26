import test from "node:test";
import assert from "node:assert/strict";
import { armarBienvenida, problemaDeDatos, type DatosContrato } from "@/lib/contratos";
import { conCodigoDelAlumno, guiaDeBienvenida, htmlDeBienvenida, modeloDeBienvenida, perfilDeStack, perfilEfectivo, textoDeBienvenida, type ConfigBienvenida } from "@/lib/bienvenida-alumno";

/* Los links y los teléfonos de verdad viven en Ajustes (el repositorio es público): acá, inventados. */
const CONFIG: ConfigBienvenida = {
  roadmaps: { "Full Stack": "https://ejemplo.com/full", "AI Engineer": "https://ejemplo.com/ai", "Data Engineer": "https://ejemplo.com/data", "Mobile Developer": "https://ejemplo.com/mobile" },
  soporte: { nombre: "Liliana", whatsapp: "+54 9 11 5555-0001" },
  auditoriaCv: { nombre: "Aldana", whatsapp: "+54 9 11 5555-0002" },
};
const ROADMAPS = CONFIG.roadmaps as Record<string, string>;

/* Lili (22/10): al firmar, el alumno recibe el roadmap de su perfil (lo carga el closer), el paso a paso de lo que compró,
   el formulario de los lunes y el WhatsApp de soporte. Tres textos: programa completo, Downsell y Reserva. */

test("el modelo sale del contrato: la reserva manda, después el programa; Hackear Biz todavía no tiene", () => {
  assert.equal(modeloDeBienvenida({ programa: "hackear-ai" }), "completo");
  assert.equal(modeloDeBienvenida({ programa: "downsell" }), "downsell");
  assert.equal(modeloDeBienvenida({ programa: "hackear-ai", reserva: true }), "reserva");
  assert.equal(modeloDeBienvenida({ programa: "hackear-biz" }), null);
});

test("el roadmap según el perfil; el formulario semanal sólo en el programa completo", () => {
  const g = guiaDeBienvenida({ programa: "hackear-ai", perfil: "Data Engineer", formulario: "https://app/reporte?c=x", config: CONFIG })!;
  assert.equal(g.roadmap, ROADMAPS["Data Engineer"]);
  assert.equal(g.formulario, "https://app/reporte?c=x");
  const d = guiaDeBienvenida({ programa: "downsell", perfil: "Full Stack", formulario: "https://app/reporte?c=x", config: CONFIG })!;
  assert.equal(d.formulario, null, "el Downsell no tiene seguimiento semanal");
  assert.equal(guiaDeBienvenida({ programa: "hackear-ai", perfil: "Otro", config: CONFIG })?.roadmap, null);
});

test("el texto lleva el roadmap, el formulario de los lunes y el WhatsApp de soporte", () => {
  const completo = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", perfil: "AI Engineer", formulario: "https://app/reporte?c=abc", config: CONFIG })!);
  assert.equal(completo.asunto, "¡Bienvenido/a a la mentoría! 🚀");
  assert.ok(completo.texto.includes(ROADMAPS["AI Engineer"]));
  assert.ok(completo.texto.includes("https://app/reporte?c=abc"));
  assert.match(completo.texto, /todos los lunes/);
  assert.ok(completo.texto.includes("+54 9 11 5555-0001"), "el WhatsApp de soporte");
  assert.ok(completo.texto.includes("+54 9 11 5555-0002"), "el de Aldana, para la auditoría del CV");
  const reserva = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", reserva: true, perfil: "Mobile Developer", config: CONFIG })!);
  assert.match(reserva.asunto, /Felicitaciones/);
  assert.ok(reserva.texto.includes(ROADMAPS["Mobile Developer"]));
  assert.ok(!/formulario/i.test(reserva.texto));
  const html = htmlDeBienvenida("Hola <b>\nhttps://x.com/a?b=1&c=2");
  assert.ok(html.includes("&lt;b&gt;"), "el texto se escapa");
  assert.ok(html.includes('<a href="https://x.com/a?b=1&amp;c=2">'), "los links se pueden tocar");
});

test("sin la configuración en Ajustes no se inventa nada: sin roadmap ni WhatsApp", () => {
  const g = guiaDeBienvenida({ programa: "hackear-ai", perfil: "Full Stack" })!;
  assert.equal(g.roadmap, null);
  assert.equal(g.soporte, null);
  const { texto } = textoDeBienvenida(g);
  assert.match(texto, /te lo pasa el equipo de soporte/);
  assert.ok(!/undefined|null/.test(texto));
});

test("el closer tiene que cargar el perfil en los programas con bienvenida", () => {
  const datos: Partial<DatosContrato> = { nombre: "Ana Pérez", email: "ana@mail.com", documento: "1", domicilio: "Calle 1" };
  assert.match(problemaDeDatos(datos, "produccion", undefined, "hackear-ai") ?? "", /perfil del alumno/);
  assert.equal(problemaDeDatos({ ...datos, perfil: "Full Stack" }, "produccion", undefined, "hackear-ai"), null);
  assert.equal(problemaDeDatos(datos, "produccion", undefined, "hackear-biz"), null, "Hackear Biz todavía no tiene bienvenida");
  assert.equal(problemaDeDatos(datos, "produccion"), null, "sin programa no se pide (lo de antes sigue igual)");
});

test("la página de bienvenida muestra la guía recién firmado", () => {
  const guia = guiaDeBienvenida({ programa: "hackear-ai", perfil: "Full Stack", config: CONFIG });
  const base = { programa: "Hackear AI", accesos: [], linkWisboo: null, accesosAutomaticos: false, guia };
  assert.equal(armarBienvenida({ ...base, contrato: { estado: "enviado", accesosEn: null, destinatario: { nombre: "Ana" } } }).guia, null);
  assert.equal(armarBienvenida({ ...base, contrato: { estado: "firmado", accesosEn: null, destinatario: { nombre: "Ana" } } }).guia?.perfil, "Full Stack");
});

test("el mail de bienvenida lleva el link a su página con los accesos (los contratos hechos a mano no pasan por ahí al firmar)", () => {
  const pagina = "https://apicanta-erp.vercel.app/bienvenida/abc123";
  const downsell = textoDeBienvenida(guiaDeBienvenida({ programa: "downsell", config: CONFIG })!, pagina).texto;
  const completo = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", perfil: "AI Engineer", config: CONFIG })!, pagina).texto;
  const reserva = textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", reserva: true, config: CONFIG })!, pagina).texto;
  assert.ok(downsell.includes(`Tus accesos`) && downsell.includes(pagina));
  assert.ok(completo.includes(pagina));
  /* Va arriba, antes del paso a paso: es lo primero que tiene que hacer. */
  assert.ok(completo.indexOf(pagina) < completo.indexOf("1. Tu roadmap"));
  assert.equal(reserva.includes(pagina), false, "la reserva todavía no tiene accesos");
  /* Sin página (no hay código), el mail sale como antes. */
  assert.equal(textoDeBienvenida(guiaDeBienvenida({ programa: "downsell", config: CONFIG })!).texto.includes("Tus accesos"), false);
});

test("con su código: el formulario de los lunes y los simulacros con el código adentro, y el código a la vista (Juan Cruz, 24/10)", () => {
  const codigo = "3f2b8c1e-9d4a-4c6b-8e2f-1a2b3c4d5e6f";
  const g = conCodigoDelAlumno(guiaDeBienvenida({ programa: "hackear-ai", perfil: "AI Engineer", config: CONFIG })!, "https://app.x", codigo);
  assert.equal(g.formulario, `https://app.x/reporte?c=${codigo}`);
  assert.equal(g.simulacro, `https://app.x/simulacro?c=${codigo}`);
  const texto = textoDeBienvenida(g).texto;
  assert.ok(texto.includes(`https://app.x/reporte?c=${codigo}`), "el link del formulario");
  assert.ok(texto.includes(`https://app.x/simulacro?c=${codigo}`), "el link de los simulacros");
  assert.equal(g.consulta, `https://app.x/consulta?c=${codigo}`);
  assert.match(texto, new RegExp(`Jueves: consultas generales\\. Si no podés venir, dejá tu consulta acá[^\\n]*\\n👉 https://app\\.x/consulta\\?c=${codigo}`), "el de las consultas, en la línea del jueves");
  assert.ok(texto.includes(`Tu código personal: ${codigo}`), "el código a la vista");
  /* Sin código (todavía no se pudo crear): el texto de siempre, sin renglones vacíos. */
  const sin = textoDeBienvenida(conCodigoDelAlumno(guiaDeBienvenida({ programa: "hackear-ai", config: CONFIG })!, "https://app.x", null)).texto;
  assert.ok(!sin.includes("Tu código personal") && !sin.includes("/simulacro") && !sin.includes("/consulta"));
  /* El Downsell y la reserva no tienen seguimiento ni simulacros. */
  for (const otro of [{ programa: "downsell" }, { programa: "hackear-ai", reserva: true }]) {
    const t = textoDeBienvenida(conCodigoDelAlumno(guiaDeBienvenida({ ...otro, config: CONFIG })!, "https://app.x", codigo)).texto;
    assert.ok(!t.includes(codigo), JSON.stringify(otro));
  }
});

/* Lili (25/10): el closer a veces no carga el perfil y la bienvenida quedaba sin roadmap. El perfil es uno solo: el del
   contrato y el «Perfil» de Programa en la ficha. Lo que se completa en un lado se ve en el otro. */

test("el Stack de la ficha, escrito como sea, es un perfil de la bienvenida", () => {
  assert.equal(perfilDeStack("Full Stack"), "Full Stack");
  assert.equal(perfilDeStack("full stack"), "Full Stack");
  assert.equal(perfilDeStack("AI ENGINEER"), "AI Engineer");
  assert.equal(perfilDeStack("IA Engineer"), "AI Engineer");
  assert.equal(perfilDeStack(" Data  Engineer "), "Data Engineer");
  assert.equal(perfilDeStack("Mobile Developer"), "Mobile Developer");
  for (const sinRoadmap of ["Backend", "Frontend", "Tech lead", "NO CORRESPONDE", "", null, undefined]) assert.equal(perfilDeStack(sinRoadmap), null);
});

test("el perfil de la bienvenida: el del contrato y, si falta, el de la ficha", () => {
  assert.equal(perfilEfectivo("Data Engineer", "Full Stack"), "Data Engineer", "manda el que cargó el closer");
  assert.equal(perfilEfectivo(undefined, "AI ENGINEER"), "AI Engineer", "sin perfil en el contrato, el de Programa → Perfil");
  assert.equal(perfilEfectivo("Otro", "Mobile Developer"), "Mobile Developer", "uno inválido no cuenta");
  assert.equal(perfilEfectivo(undefined, "Backend"), null);
  const g = guiaDeBienvenida({ programa: "hackear-ai", perfil: perfilEfectivo(undefined, "full stack"), config: CONFIG })!;
  assert.equal(g.roadmap, ROADMAPS["Full Stack"], "con eso ya le llega su roadmap");
});
