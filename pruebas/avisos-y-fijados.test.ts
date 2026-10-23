import test from "node:test";
import assert from "node:assert/strict";
import { alCambiarAvisos, avisarCambioDeAvisos, dondeEs, hace, marcarEnLista, sinLeer, sumarAviso, type Aviso } from "@/lib/avisos";
import { textoDeNota, TIPOS_DE_NOTA } from "@/lib/nota-de-charla";
import { partesConMenciones } from "@/lib/chat-equipo";
import { etapaDelFollowUp, FIJADOS_POR_DEFECTO, mismoFollowUp, renglonesCartera, validarFijados, type FilaCartera } from "@/lib/panel-servicio";
import { LISTAS_POR_DEFECTO } from "@/lib/clientes-cs";

/* Lili (23/10): dejar documentada la charla del seguimiento y avisarle a alguien del equipo (la campanita, como en Blue
   OS); «Agendar para resell» en el Follow Up; y fijar en su panel los Follow Ups que sigue de cerca. */

const aviso = (id: string, creadoEn: string, leidoEn: string | null = null): Aviso => ({
  id, para: "yari@apicanta.com", tipo: "mencion", titulo: "Liliana Riveros te mencionó", cuerpo: "📞 Agradecimiento", de: "Liliana Riveros",
  deEmail: "liliana@apicanta.com", contactoId: "con_saul", persona: "Saul Rivas Martinez", comentarioId: `com_${id}`, leidoEn, creadoEn,
});

test("la nota de la charla: qué fue, lo que hablaron y las menciones al final, que son las que lee la base", () => {
  assert.deepEqual([...TIPOS_DE_NOTA], ["Charla", "Queja", "Sugerencia", "Agradecimiento", "Otro"]);
  const t = textoDeNota("Agradecimiento", "  le encantó la clase de entrevistas ", ["Yari", "Aldana Ytzcovich", "Yari"]);
  assert.equal(t, "📞 Agradecimiento de seguimiento: le encantó la clase de entrevistas\n@Yari @Aldana Ytzcovich");
  /* El chat las resalta igual que las que se escriben con «@». */
  const marcadas = partesConMenciones(t, ["Yari", "Aldana Ytzcovich", "Liliana Riveros"]).filter((p) => p.mencion).map((p) => p.mencion);
  assert.deepEqual(marcadas, ["Yari", "Aldana Ytzcovich"]);
  assert.equal(textoDeNota("Queja", "", []), "📞 Queja de seguimiento", "sólo con una foto también vale");
});

test("la campanita: cuántos sin leer, el más nuevo arriba sin repetir, y marcar leído", () => {
  const l = [aviso("a", "2026-10-23T18:00:00Z"), aviso("b", "2026-10-23T17:00:00Z", "2026-10-23T17:05:00Z")];
  assert.equal(sinLeer(l), 1);
  const con = sumarAviso(l, aviso("c", "2026-10-23T19:00:00Z"));
  assert.deepEqual(con.map((a) => a.id), ["c", "a", "b"]);
  assert.deepEqual(sumarAviso(con, { ...aviso("a", "2026-10-23T18:00:00Z"), leidoEn: "2026-10-23T19:01:00Z" }).map((a) => a.id), ["c", "a", "b"], "el mismo aviso no se repite");
  const leidos = marcarEnLista(con, (a) => a.id === "c", "2026-10-23T19:02:00Z");
  assert.equal(sinLeer(leidos), 1);
  assert.equal(leidos.find((a) => a.id === "b")!.leidoEn, "2026-10-23T17:05:00Z", "lo ya leído no se toca");
  assert.equal(dondeEs(aviso("x", "2026-10-23T19:00:00Z")), "En la ficha de Saul Rivas Martinez");
  const ahora = Date.parse("2026-10-23T19:00:00Z");
  assert.deepEqual([hace("2026-10-23T18:59:40Z", ahora), hace("2026-10-23T18:45:00Z", ahora), hace("2026-10-23T15:00:00Z", ahora), hace("2026-10-22T10:00:00Z", ahora), hace("2026-10-19T10:00:00Z", ahora)],
    ["recién", "hace 15 min", "hace 4 h", "ayer", "hace 4 días"]);
});

test("leer el chat de una ficha avisa a la campanita para que vuelva a leer", () => {
  let veces = 0;
  const sacar = alCambiarAvisos(() => { veces += 1; });
  avisarCambioDeAvisos();
  sacar();
  avisarCambioDeAvisos();
  assert.equal(veces, 1);
});

test("«Agendar para resell» está en el Follow Up y cae en la etapa Renovación", () => {
  assert.ok(LISTAS_POR_DEFECTO.followUps.includes("Agendar para resell"));
  assert.equal(etapaDelFollowUp("Agendar para resell"), "renovacion");
});

test("fijar Follow Ups: de entrada «No contesta» y «Agendar para resell», sin mayúsculas ni tildes, y filtra la cartera", () => {
  assert.deepEqual(FIJADOS_POR_DEFECTO, ["No contesta", "Agendar para resell"]);
  assert.ok(mismoFollowUp("NO CONTESTA", " No contesta"));
  assert.ok(!mismoFollowUp("", ""), "vacío no es un Follow Up");
  assert.deepEqual(validarFijados(["No contesta", "no contesta", " ", 3, "Agendar para resell"]), ["No contesta", "Agendar para resell"]);
  assert.equal(validarFijados("No contesta"), null);
  const fila = (id: string, followUp: string) => ({ id, nombre: id, programa: "Hackear AI", followUp, etapa: etapaDelFollowUp(followUp) }) as unknown as FilaCartera;
  const cartera = [fila("a", "No contesta"), fila("b", "Agendar para resell"), fila("c", "Módulo 3"), fila("d", "no contesta")];
  assert.deepEqual(renglonesCartera(cartera, undefined, undefined, "No contesta").map((r) => r.id), ["a", "d"]);
  assert.deepEqual(renglonesCartera(cartera, undefined, "renovacion").map((r) => r.id), ["b"], "las etapas siguen como antes");
  assert.equal(renglonesCartera(cartera).length, 4);
});
