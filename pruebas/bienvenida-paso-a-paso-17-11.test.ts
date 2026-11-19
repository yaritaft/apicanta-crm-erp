import test from "node:test";
import assert from "node:assert/strict";
import { guiaDeBienvenida, textoDeBienvenida } from "@/lib/bienvenida-alumno";
import { leerMailEnResend } from "@/lib/reporte-servidor";

/* Lili, 17/11: el paso a paso del mail de bienvenida tenía errores (el punto 1 decía Hackear IA en vez de Hackear IT, el 2 y el 3 repetían
   lo de Python y FastAPI, y el 3 no decía dónde está el THC), y los días de las salas de Zoom tenían que estar detallados. */

const downsell = () => textoDeBienvenida(guiaDeBienvenida({ programa: "downsell", perfil: "Full Stack" })!).texto;
const completo = () => textoDeBienvenida(guiaDeBienvenida({ programa: "hackear-ai", perfil: "Full Stack", config: { auditoriaCv: { whatsapp: "+54 9 11 1" } } })!).texto;

test("Downsell: el paso a paso es el que corrigió Lili, de 1 a 6, con el aviso final", () => {
  const t = downsell();
  assert.match(t, /1\. Comenzá en Wisboo – Hackear IT\n• Introducción, Módulo 0 y Módulo 1\./);
  assert.doesNotMatch(t, /Comenzá en Wisboo – Hackear IA/);
  assert.match(t, /2\. Realizá tu roadmap para alinearte con el mercado\nUna vez definido tu roadmap, tenés dos caminos:/);
  assert.match(t, /dirigite a Hackear IA – Módulo 0 para aprender ambas tecnologías\. Una vez completado, volvé a Hackear IT/);
  assert.match(t, /3\. Completá el Módulo 8 y el Take Home Challenge \(Hackear IT\)\n• Mirá todo el Módulo 8 y luego realizá el THC sin IA\./);
  assert.match(t, /drive «herramientas»[^\n]*grupo de novedades en Telegram[^\n]*el de Full Stack y el de Data Engineer/);
  assert.match(t, /4\. Continuá del Módulo 2 al 5 \(Hackear IT\)\n/);
  assert.match(t, /5\. Del Módulo 6 al 12 \(Hackear IT\)\n• Preparación para las entrevistas técnicas\./);
  assert.match(t, /6\. Incorporá el contenido de IA \(corresponde a ambos programas\)[\s\S]*módulo de IA de Hackear IT y el contenido de Hackear IA/);
  assert.match(t, /No sirve estudiar IA ahora simplemente porque aparece en algunas búsquedas\./);
  /* Lo de Python no se repite en el punto 3 ni al final: sólo se dice en el punto 2. */
  assert.equal((t.match(/Python/g) ?? []).length, 1);
  assert.doesNotMatch(t, /7\. Aprovechá los bonos/);
});

test("Programa completo: el punto 2 y el 3 también, sin repetir Python, y conserva lo suyo (auditoría de CV, bonos)", () => {
  const t = completo();
  assert.match(t, /2\. Realizá tu roadmap para alinearte con el mercado\nUna vez definido tu roadmap, tenés dos caminos:/);
  assert.match(t, /dirigite a Hackear AI – Módulo 0/);
  assert.match(t, /3\. Completá el Módulo 8 y el Take Home Challenge \(Hackear IT\)/);
  assert.match(t, /4\. Avanzá del Módulo 2 al 5 \(Hackear IT\)/);
  assert.match(t, /5\. Del Módulo 6 al 12 \(Hackear IT\)/);
  assert.equal((t.match(/Python/g) ?? []).length, 1);
  assert.match(t, /Contacto de Aldana: \+54 9 11 1/);
  assert.match(t, /6\. Incorporá el contenido de IA \(corresponde a ambos programas\)\n• Una vez que llegues a la etapa de entrevistas técnicas, incorporá el módulo de IA de Hackear IT y el contenido de Hackear AI/);
  assert.match(t, /7\. Aprovechá los bonos disponibles/);
  assert.match(t, /No sirve estudiar IA ahora simplemente porque aparece en algunas búsquedas\./);
  assert.doesNotMatch(t, /no intentes estudiar todo al mismo tiempo/);
});

test("el mail del programa completo detalla los días y la hora de las salas de Zoom", () => {
  const t = completo();
  assert.match(t, /Son tres días por semana, todos a las 18:00 \(hora de Argentina\):/);
  assert.match(t, /• Martes 18:00: simulacros de entrevistas y tema nuevo\./);
  assert.match(t, /• Miércoles 18:00: consultas exclusivas de IA\./);
  assert.match(t, /• Jueves 18:00: seguimiento y consultas en general\./);
});

/* ---------- Ver el mail tal como salió ---------- */

const cfg = { clave: "k", desde: "x@y.z" } as Parameters<typeof leerMailEnResend>[0];
const respuesta = (cuerpo: unknown, status = 200) => (async () => new Response(JSON.stringify(cuerpo), { status })) as unknown as typeof fetch;

test("lee de Resend el asunto, el texto, a quién y cuándo salió", async () => {
  const r = await leerMailEnResend(cfg, "m1", respuesta({ subject: "¡Bienvenido/a!", text: "Hola\n1. Paso", to: ["a@x.com"], created_at: "2026-11-14T22:36:10Z", last_event: "delivered" }));
  assert.deepEqual(r, { ok: true, mail: { asunto: "¡Bienvenido/a!", texto: "Hola\n1. Paso", para: "a@x.com", cuando: "2026-11-14T22:36:10Z", estado: "delivered" } });
});

test("si Resend sólo guarda el HTML, se pasa a texto; si no tiene nada o falla, lo dice", async () => {
  const h = await leerMailEnResend(cfg, "m1", respuesta({ subject: "s", html: "<div><p>Hola &amp; chau<br>otra línea</p><p>Fin</p></div>", to: "b@x.com" }));
  assert.equal(h.ok && h.mail.texto, "Hola & chau\notra línea\n\nFin");
  const vacio = await leerMailEnResend(cfg, "m1", respuesta({ subject: "s" }));
  assert.equal(vacio.ok, false);
  const error = await leerMailEnResend(cfg, "m1", respuesta({ message: "Not found" }, 404));
  assert.deepEqual(error, { ok: false, error: "Not found" });
});
