import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { contratoDeLlamada, contratosAMostrar, mensajeDeAccesosPorWhatsapp, quePasoConElContrato, type Contrato } from "@/lib/contratos";
import { avisarDelContrato } from "@/lib/contratos-servidor";
import { ACCESO_DUENO, TIPOS_POR_DEFECTO, veElServicio, type MiAcceso } from "@/lib/permisos";

/* ==================================================================
   26/10 (Mariano): «creo que le puse enviar contrato, pero me dice que no llegó nada. ¿Cómo me doy cuenta si lo hice bien, o si
   llegó?». El contrato de Jacob no había salido (PandaDoc en su tope) y el closer no tenía dónde verlo. Ahora:
   - la ficha dice el estado de cada contrato en palabras y deja de mostrar los intentos viejos que ya tienen reemplazo;
   - la campanita le avisa a quien lo mandó y al closer de la venta cuando NO salió y cuando se firmó;
   - el closer ve el servicio de SUS alumnos, y sólo si la persona compró.
   ================================================================== */

const base: Contrato = {
  id: "c1", ventaId: "v1", sesionId: "s1", leadId: "l1", alumnoId: null, programa: "downsell", plantillaId: "p", plantillaNombre: "Downsell",
  documentoId: "doc1", modo: "produccion", estado: "enviado", destinatario: { nombre: "Jacob", email: "jacob@x.com" }, datos: {},
  enlace: null, enlaceVence: null, pdfPath: null, enviadoEn: "2026-10-25T20:00:00Z", vistoEn: null, firmadoEn: null, rechazadoEn: null,
  anuladoEn: null, accesosEn: null, origen: "app", error: null, creadoEn: "2026-10-25T20:00:00Z", creadoPor: "mariano@apicanta.com",
  actualizadoEn: "2026-10-25T20:00:00Z", sincronizadoEn: null,
};
const c = (o: Partial<Contrato>): Contrato => ({ ...base, ...o });

test("lo que le pasó al contrato, en palabras: el que no salió dice que no le llegó nada", () => {
  const texto = quePasoConElContrato(c({ estado: "error", error: "PandaDoc llegó al límite" }));
  assert.match(texto, /jacob@x\.com no recibió nada/);
  assert.match(quePasoConElContrato(c({ estado: "enviado" })), /Le llegó a jacob@x\.com/);
  assert.match(quePasoConElContrato(c({ estado: "enviado" })), /Todavía no lo abrió/);
  assert.match(quePasoConElContrato(c({ estado: "visto", vistoEn: new Date().toISOString() })), /Lo abrió.*Falta que firme/);
  assert.match(quePasoConElContrato(c({ estado: "firmado", firmadoEn: "2026-10-26T14:00:00Z" })), /Firmó el/);
});

test("un intento que no salió y ya tiene otro más nuevo no se muestra; si no hay reemplazo, sí", () => {
  const e1 = c({ id: "e1", estado: "error", creadoEn: "2026-10-24T22:37:00Z" });
  const e2 = c({ id: "e2", estado: "error", creadoEn: "2026-10-24T22:39:00Z" });
  /* El que mandó Lili a mano desde PandaDoc: sin venta, atado por la persona. */
  const aMano = c({ id: "m1", estado: "enviado", ventaId: null, origen: "pandadoc", creadoEn: "2026-10-24T23:31:00Z" });
  assert.deepEqual(contratosAMostrar([aMano, e2, e1]).map((x) => x.id), ["m1"]);
  assert.deepEqual(contratosAMostrar([e2, e1]).map((x) => x.id), ["e2", "e1"], "sin reemplazo se ven los dos intentos");
  const otraPersona = c({ id: "o1", estado: "firmado", ventaId: "v9", leadId: "l9", creadoEn: "2026-10-26T10:00:00Z" });
  assert.deepEqual(contratosAMostrar([otraPersona, e1]).map((x) => x.id), ["o1", "e1"], "el contrato de otra persona no tapa el que no salió");
  /* Un anulado con otro después es historia. */
  const anulado = c({ id: "a1", estado: "anulado", creadoEn: "2026-10-20T10:00:00Z" });
  assert.deepEqual(contratosAMostrar([aMano, anulado]).map((x) => x.id), ["m1"]);
  assert.equal(contratosAMostrar([c({ id: "1" }), c({ id: "2", creadoEn: "2026-10-26T00:00:00Z" }), c({ id: "3", creadoEn: "2026-10-27T00:00:00Z" }), c({ id: "4", creadoEn: "2026-10-28T00:00:00Z" })]).length, 3, "hasta tres");
});

test("el closer ve el servicio de sus clientes (sólo si compró); el setter, el director y marketing no", () => {
  const de = (id: string): MiAcceso => {
    const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
    return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
  };
  assert.equal(veElServicio(de("closer"), true), true, "el closer con una persona que compró");
  assert.equal(veElServicio(de("closer"), false), false, "el closer con un lead que no compró");
  for (const id of ["setter", "director", "marketing", "admin"]) assert.equal(veElServicio(de(id), true), false, id);
  assert.equal(veElServicio(de("customer_success"), false), true, "Customer Success siempre");
  assert.equal(veElServicio(ACCESO_DUENO, false), true, "un dueño siempre");
  assert.equal(veElServicio(null, true), false);
});

/* ---------- la campanita ---------- */

type Fila = Record<string, unknown>;
function baseConAvisos(tablas: Record<string, Fila[]> = {}) {
  const avisos: Fila[] = [];
  const consulta = (tabla: string) => {
    let id: unknown;
    const q = {
      select() { return q; },
      eq(_c: string, v: unknown) { id = v; return q; },
      maybeSingle() { return Promise.resolve({ data: (tablas[tabla] ?? []).find((f) => f.id === id) ?? null, error: null }); },
      upsert(filas: Fila[]) { avisos.push(...filas); return Promise.resolve({ data: null, error: null }); },
    };
    return q;
  };
  return { db: { from: consulta } as unknown as SupabaseClient, avisos };
}

test("cuando el contrato NO sale, la campanita avisa a quien lo mandó y al closer de la venta, con el motivo y qué hacer", async () => {
  const { db, avisos } = baseConAvisos({ ventas: [{ id: "v1", closerId: "m_dante" }], equipo: [{ id: "m_dante", email: "Dante@apicanta.com" }] });
  await avisarDelContrato(db, base, "error", "PandaDoc llegó al límite de contratos");
  assert.deepEqual(avisos.map((a) => a.para).sort(), ["dante@apicanta.com", "mariano@apicanta.com"]);
  for (const a of avisos) {
    assert.match(String(a.titulo), /contrato de Jacob NO salió/);
    assert.match(String(a.cuerpo), /Volver a intentar/);
    assert.match(String(a.cuerpo), /PandaDoc llegó al límite/);
    assert.equal(a.tipo, "contrato");
    assert.equal(a.contactoId, "l1");
    assert.ok(String(a.id).startsWith("av_contrato_error_c1_"), "un aviso por contrato y persona: volver a intentar no lo repite");
  }
  assert.equal(new Set(avisos.map((a) => a.id)).size, 2);
});

test("si quien lo mandó es el mismo closer de la venta, un solo aviso; cuando se firma, también avisa", async () => {
  const { db, avisos } = baseConAvisos({ ventas: [{ id: "v1", closerId: "m_mari" }], equipo: [{ id: "m_mari", email: "mariano@apicanta.com" }] });
  await avisarDelContrato(db, base, "firmado");
  assert.equal(avisos.length, 1);
  assert.match(String(avisos[0].titulo), /Jacob firmó el contrato/);
});

test("los contratos de prueba y los mandados a mano desde PandaDoc (sin mail de quien lo mandó) no avisan", async () => {
  const { db, avisos } = baseConAvisos();
  await avisarDelContrato(db, { ...base, modo: "prueba" }, "error", "x");
  await avisarDelContrato(db, { ...base, creadoPor: "PandaDoc", ventaId: null }, "firmado");
  assert.equal(avisos.length, 0);
});

/* ---------- el buscador del CRM ---------- */

test("buscar a alguien mira todo el historial; sin búsqueda, sólo el período", async () => {
  const { llamadasQueSeVen } = await import("@/lib/crm-tabla");
  const fila = (id: string, dia: string, nombre: string) => ({ id, dia, nombre, email: `${id}@x.com`, telefono: "", closer: "Mariano", notas: "" }) as never;
  const todas = [fila("a", "2026-10-25", "Jacob Mendoza"), fila("b", "2026-09-02", "Jacob Perez"), fila("c", "2026-10-26", "Ana Gomez")];
  const rango = { desde: "2026-10-26", hasta: "2026-10-26" };
  assert.deepEqual(llamadasQueSeVen(todas, rango, "").map((f) => f.id), ["c"], "sin búsqueda, el período recorta");
  assert.deepEqual(llamadasQueSeVen(todas, rango, "jacob").map((f) => f.id), ["a", "b"], "con búsqueda, el período no cuenta");
  assert.deepEqual(llamadasQueSeVen(todas, rango, "  ").map((f) => f.id), ["c"], "espacios no son una búsqueda");
});

test("la llamada dice lo mismo que la ficha: si su intento no salió y después se mandó a mano, muestra el vigente (el de Jacob, 26/10)", () => {
  const malo = c({ id: "e", estado: "error", sesionId: "s1", creadoEn: "2026-10-25T22:43:00Z" });
  const aMano = c({ id: "m", estado: "visto", sesionId: null, ventaId: null, origen: "pandadoc", creadoEn: "2026-10-26T12:09:00Z" });
  const visibles = contratosAMostrar([malo, aMano]);
  assert.equal(contratoDeLlamada(visibles, { id: "s1", venta: "Downsell · US$ 500" })?.id, "m");
  assert.equal(contratoDeLlamada(visibles, { id: "s1", venta: "" }), undefined, "una llamada sin venta no muestra contrato");
  assert.equal(contratoDeLlamada([malo], { id: "s1", venta: "x" })?.id, "e", "sin reemplazo, el que no salió se ve como tal");
});

test("el mensaje de accesos para WhatsApp lleva el link de su página, su mail como usuario y el aviso del spam", () => {
  const m = mensajeDeAccesosPorWhatsapp("Jacob Mendoza Hernandez", "jacob@x.com", "https://apicanta-erp.vercel.app/bienvenida/abc");
  assert.match(m, /^Jacob, ya tenés tus accesos listos/);
  assert.match(m, /https:\/\/apicanta-erp\.vercel\.app\/bienvenida\/abc/);
  assert.match(m, /tu usuario es tu mail \(jacob@x\.com\)/);
  assert.match(m, /spam/);
  assert.match(mensajeDeAccesosPorWhatsapp("", "", "u"), /^Ya tenés tus accesos listos/);
});

test("un contrato firmado de la misma compra tapa al que no salió o se anuló, aunque sea más viejo", () => {
  const firmado = c({ id: "f", estado: "firmado", ventaId: "v1", creadoEn: "2026-10-22T09:13:00Z" });
  const anulado = c({ id: "a", estado: "anulado", ventaId: "v1", creadoEn: "2026-10-25T16:31:00Z" });
  const roto = c({ id: "e", estado: "error", ventaId: "v1", creadoEn: "2026-10-25T17:00:00Z" });
  assert.deepEqual(contratosAMostrar([anulado, roto, firmado]).map((x) => x.id), ["f"]);
  const otro = c({ id: "o", estado: "error", ventaId: "v9", leadId: "l9", creadoEn: "2026-10-25T17:00:00Z" });
  assert.deepEqual(contratosAMostrar([firmado, otro]).map((x) => x.id), ["o", "f"], "el de otra persona sigue a la vista");
});
