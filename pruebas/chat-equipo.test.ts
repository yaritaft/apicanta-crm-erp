import test from "node:test";
import assert from "node:assert/strict";
import {
  candidatosDeMencion, claveDe, entregaDe, lecturaAlLeer, mencionEnCurso, partesConMenciones, participantes, ponerMencion, recibidosAlLlegar,
  resumenDeMensaje,
} from "@/lib/chat-equipo";
import { acciones } from "@/lib/store";
import type { Adjunto, ChatLectura, Comentario, EstadoApp } from "@/lib/types";

/* El chat del equipo como WhatsApp (20/10): citar al responder y los tildes de cada mensaje propio. */

const F = "con_1";
const msj = (id: string, autor: string, email: string | undefined, hora: string, extra: Partial<Comentario> = {}): Comentario => ({
  id, contactoId: F, autor, ...(email ? { autorEmail: email } : {}), texto: `mensaje ${id}`, creadoEn: `2026-10-20T${hora}:00.000Z`, ...extra,
});
const lectura = (quien: string, nombre: string, leido?: string, recibido?: string): ChatLectura => ({
  id: `${F}:${quien}`, contactoId: F, quien, nombre,
  ...(leido ? { leidoHasta: `2026-10-20T${leido}:00.000Z` } : {}),
  ...(recibido ? { recibidoHasta: `2026-10-20T${recibido}:00.000Z` } : {}),
});

test("cada uno se reconoce por su mail (o, sin nube, por su nombre), sin importar mayúsculas", () => {
  assert.equal(claveDe("Lili@Apicanta.com", "Liliana"), "lili@apicanta.com");
  assert.equal(claveDe(null, " Yari Taft "), "yari taft");
});

test("la cita dice qué era el mensaje en un renglón: el texto, o qué archivo era", () => {
  assert.equal(resumenDeMensaje({ texto: "\n  Le escribí por WhatsApp\nquedó en mandar el CV" }), "Le escribí por WhatsApp");
  const a = (x: Partial<Adjunto>): Adjunto => ({ id: "a", tipo: "archivo", nombre: "contrato.pdf", mime: "", bytes: 1, ruta: "", ...x });
  assert.equal(resumenDeMensaje({ texto: "", adjuntos: [a({ tipo: "audio", notaDeVoz: true, duracion: 7 })] }), "🎤 Nota de voz 0:07");
  assert.equal(resumenDeMensaje({ texto: "", adjuntos: [a({ tipo: "imagen" }), a({ tipo: "imagen" })] }), "📷 2 fotos");
  assert.equal(resumenDeMensaje({ texto: "", adjuntos: [a({ tipo: "imagen" }), a({})] }), "📷 Foto y 1 más");
  assert.equal(resumenDeMensaje({ texto: "", adjuntos: [a({})] }), "📄 contrato.pdf");
});

test("los del chat son quienes escribieron, reaccionaron o lo abrieron; a quien sólo le llegó no se lo espera", () => {
  const cs = [msj("1", "Yari", "yari@x.com", "10:00", { reacciones: [{ emoji: "👍", quien: "Aldana", email: "aldana@x.com" }] })];
  const gente = participantes(cs, [lectura("lili@x.com", "Lili", "10:05"), lectura("closer@x.com", "Closer", undefined, "10:05")]);
  assert.deepEqual([...gente.keys()].sort(), ["aldana@x.com", "lili@x.com", "yari@x.com"]);
});

test("los tildes: reloj en la cola, uno si nadie más está, dos grises si les llegó a todos, azules si lo leyeron todos", () => {
  const m1 = msj("1", "Yari", "yari@x.com", "10:00");
  const m2 = msj("2", "Yari", "yari@x.com", "10:10");
  const m3 = msj("3", "Yari", "yari@x.com", "10:20");
  const cs = [m1, m2, m3];
  assert.equal(entregaDe(m1, cs, [], { pendiente: true, error: false }).estado, "enviando");
  assert.equal(entregaDe(m1, cs, [], { pendiente: true, error: true }).estado, "sin-enviar", "sin conexión: no se mandó y se reintenta");
  assert.equal(entregaDe(m1, cs, []).estado, "enviado", "sola en el chat: un tilde");

  const ls = [lectura("lili@x.com", "Lili", "10:10", "10:20"), lectura("aldana@x.com", "Aldana", "10:20", "10:20")];
  assert.equal(entregaDe(m1, cs, ls).estado, "leido");
  assert.equal(entregaDe(m2, cs, ls).estado, "leido", "leyó justo hasta ese");
  const d3 = entregaDe(m3, cs, ls);
  assert.equal(d3.estado, "recibido");
  assert.deepEqual(d3, { estado: "recibido", leyeron: ["Aldana"], recibieron: ["Lili"], faltan: [] });

  const sinLlegar = entregaDe(m3, cs, [lectura("lili@x.com", "Lili", "10:10", "10:10"), lectura("aldana@x.com", "Aldana", "10:20")]);
  assert.equal(sinLlegar.estado, "enviado", "a Lili todavía no le llegó");
  assert.deepEqual(sinLlegar.faltan, ["Lili"]);
});

test("escribir después en esa ficha, o reaccionar al mensaje, cuenta como leído", () => {
  const m1 = msj("1", "Yari", "yari@x.com", "10:00");
  const respuesta = msj("2", "Lili", "lili@x.com", "10:05");
  assert.equal(entregaDe(m1, [m1, respuesta], []).estado, "leido");
  const conReaccion = { ...m1, reacciones: [{ emoji: "❤️", quien: "Aldana", email: "aldana@x.com" }] };
  assert.equal(entregaDe(conReaccion, [conReaccion], []).estado, "leido");
});

test("al abrir el chat queda leído hasta el último mensaje de OTRO; lo mío no cuenta y no se escribe dos veces", () => {
  const cs = [msj("1", "Yari", "yari@x.com", "10:00"), msj("2", "Lili", "lili@x.com", "10:30")];
  const fila = lecturaAlLeer(F, cs, [], "yari@x.com", "Yari");
  assert.deepEqual(fila, { id: `${F}:yari@x.com`, contactoId: F, quien: "yari@x.com", nombre: "Yari", recibidoHasta: cs[1].creadoEn, leidoHasta: cs[1].creadoEn });
  assert.equal(lecturaAlLeer(F, cs, [fila as ChatLectura], "yari@x.com", "Yari"), null, "ya estaba leído");
  assert.equal(lecturaAlLeer(F, [cs[0]], [], "yari@x.com", "Yari"), null, "sólo hay mensajes míos");
});

test("lo que llega a la app queda «recibido» sólo en los chats de los que es parte", () => {
  const otra = "con_2";
  const cs = [
    msj("1", "Lili", "lili@x.com", "10:00"), msj("2", "Yari", "yari@x.com", "10:05"), msj("3", "Lili", "lili@x.com", "10:30"),
    { ...msj("4", "Lili", "lili@x.com", "11:00"), contactoId: otra },
  ];
  const filas = recibidosAlLlegar(cs, [], "yari@x.com", "Yari");
  assert.equal(filas.length, 1, "en con_2 Yari nunca escribió ni lo abrió: no se la espera");
  assert.equal(filas[0].recibidoHasta, cs[2].creadoEn);
  assert.equal(filas[0].leidoHasta, undefined, "que le llegó no es que lo leyó");
  assert.deepEqual(recibidosAlLlegar(cs, filas, "yari@x.com", "Yari"), [], "no se escribe dos veces");
});

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;

test("responder citando guarda el mensaje citado; marcar leído y recibido quedan en el estado", () => {
  acciones.comentar("c_cita_1", "¿Le mandaron el contrato?", "Lili", "lili@x.com");
  const [original] = estado().comentarios.filter((c) => c.contactoId === "c_cita_1");
  acciones.comentar("c_cita_1", "Sí, ayer", "Yari", "yari@x.com", [], undefined, original.id);
  const [, respuesta] = estado().comentarios.filter((c) => c.contactoId === "c_cita_1");
  assert.equal(respuesta.citaA, original.id);
  assert.equal(respuesta.respondeA, undefined, "citar no es responder en hilo");

  acciones.marcarLeido("c_cita_1", "yari@x.com", "Yari");
  const mia = (estado().chatLecturas ?? []).find((l) => l.id === "c_cita_1:yari@x.com");
  assert.equal(mia?.leidoHasta, original.creadoEn);

  acciones.marcarRecibidos("lili@x.com", "Lili");
  const deLili = (estado().chatLecturas ?? []).find((l) => l.id === "c_cita_1:lili@x.com");
  assert.equal(deLili?.recibidoHasta, respuesta.creadoEn);
  assert.equal(deLili?.leidoHasta, undefined);
});

test("lo que llega en vivo entra en orden, se suma a lo que estaba y saca lo borrado", () => {
  acciones.comentar("c_vivo_1", "primero", "Lili", "lili@x.com");
  const [primero] = estado().comentarios.filter((c) => c.contactoId === "c_vivo_1");
  const viejo: Comentario = { id: "com_vivo_viejo", contactoId: "c_vivo_1", autor: "Aldana", texto: "de antes", creadoEn: "2020-01-01T00:00:00.000Z" };
  acciones.recibirComentarios([viejo, { ...primero, reacciones: [{ emoji: "👍", quien: "Aldana" }] }]);
  const ahora = estado().comentarios.filter((c) => c.contactoId === "c_vivo_1");
  assert.deepEqual(ahora.map((c) => c.id), ["com_vivo_viejo", primero.id], "en orden de fecha, aunque llegue después");
  assert.equal(ahora[1].reacciones?.length, 1);
  acciones.recibirComentarios([], ["com_vivo_viejo"]);
  assert.deepEqual(estado().comentarios.filter((c) => c.contactoId === "c_vivo_1").map((c) => c.id), [primero.id]);
});

/* ---------- Menciones (reunión del 21/10) ---------- */

test("menciones: se detecta la que se está escribiendo y se cambia por el nombre completo", () => {
  assert.deepEqual(mencionEnCurso("hola @li", 8), { desde: 5, busca: "li" });
  assert.deepEqual(mencionEnCurso("@", 1), { desde: 0, busca: "" });
  assert.equal(mencionEnCurso("mail@empresa.com", 16), null, "un mail no es una mención");
  assert.equal(mencionEnCurso("hola @lili y", 12), null, "ya pasó el espacio");
  const r = ponerMencion("hola @li ¿viste?", 5, 8, "Liliana Riveros");
  assert.deepEqual(r, { texto: "hola @Liliana Riveros  ¿viste?", cursor: 22 });
});

test("menciones: se ofrecen los del equipo, primero los que empiezan con lo escrito (sin importar tildes)", () => {
  const equipo = ["Aldana Ytzcovich", "Liliana Riveros", "Yari Taft", "Mariano Arias", "Valentín Abadía"];
  assert.deepEqual(candidatosDeMencion(equipo, "li"), ["Liliana Riveros"]);
  assert.deepEqual(candidatosDeMencion(equipo, "a").slice(0, 3), ["Aldana Ytzcovich", "Mariano Arias", "Valentín Abadía"]);
  assert.deepEqual(candidatosDeMencion(equipo, "valen"), ["Valentín Abadía"]);
  assert.equal(candidatosDeMencion(equipo, "").length, 5);
});

test("menciones: al mostrar el mensaje se marcan sólo los nombres del equipo, el más largo gana", () => {
  const p = partesConMenciones("Hola @Liliana Riveros, ¿lo ves con @yari taft? Mandalo a juan@mail.com", ["Liliana Riveros", "Yari Taft", "Yari"]);
  assert.deepEqual(p.filter((x) => x.mencion).map((x) => x.mencion), ["Liliana Riveros", "Yari Taft"]);
  assert.equal(p.map((x) => x.texto).join(""), "Hola @Liliana Riveros, ¿lo ves con @yari taft? Mandalo a juan@mail.com", "no se pierde ni se cambia nada del texto");
  assert.deepEqual(partesConMenciones("sin arroba", ["Yari"]), [{ texto: "sin arroba" }]);
  assert.deepEqual(partesConMenciones("@Pedro no es del equipo", ["Yari"]), [{ texto: "@Pedro no es del equipo" }]);
});
