import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { avisarSiLaPlantillaNoLleva } from "@/lib/contratos-servidor";
import { rotuloEvento, variablesQueFaltan, VARIABLES_CLAVE, type Contrato } from "@/lib/contratos";

/* ==================================================================
   Una plantilla de PandaDoc sin [Venta.Modalidad] (Manu, 26/10: el Downsell
   tenía «Un pago único de 500 USD» escrito a mano) deja el contrato con
   ese texto aunque el closer cargue otro monto. La app lo detecta: en
   Ajustes (variablesQueFaltan) y al armar cada contrato (aviso al closer
   y a los dueños, sin frenar el contrato).
   ================================================================== */

const COMPLETA = {
  tokens: VARIABLES_CLAVE.map((v) => ({ name: v.nombre })).concat([{ name: "Contrato.Inicio" }]),
  fields: [{ name: "Signature", type: "signature" }],
};
/* Como la plantilla del Downsell el 26/10 por la API. */
const DOWNSELL = {
  tokens: ["Cliente.Documento", "Cliente.Domicilio", "Cliente.Nombre", "Contrato.Fecha", "Contrato.Inicio"].map((name) => ({ name })),
  fields: [{ name: "Signature", type: "signature" }],
};

test("variablesQueFaltan: la plantilla completa no falta nada y la del Downsell no tiene el monto", () => {
  assert.deepEqual(variablesQueFaltan(COMPLETA), []);
  assert.deepEqual(variablesQueFaltan(DOWNSELL), ["Venta.Modalidad"]);
});

test("variablesQueFaltan: un campo con merge field también cuenta, y una plantilla que no se pudo leer no dice nada", () => {
  const conCampo = { tokens: DOWNSELL.tokens, fields: [{ name: "Monto", type: "text", merge_field: "Venta.Modalidad" }] };
  assert.deepEqual(variablesQueFaltan(conCampo), []);
  assert.deepEqual(variablesQueFaltan(undefined), []);
  assert.deepEqual(variablesQueFaltan({}), []);
  assert.deepEqual(variablesQueFaltan(null), []);
});

test("variablesQueFaltan: sólo mira los nombres que se le piden", () => {
  assert.deepEqual(variablesQueFaltan({ tokens: [] }, ["Venta.Modalidad"]), ["Venta.Modalidad"]);
  assert.deepEqual(variablesQueFaltan({ tokens: [{ name: "Venta.Modalidad" }] }, ["Venta.Modalidad"]), []);
});

test("el historial dice qué pasó con la plantilla", () => {
  assert.equal(rotuloEvento({ evento: "plantilla", detalle: { faltan: ["Venta.Modalidad"] } }), "La plantilla no lleva lo que se cargó");
});

/* Una base mínima: anota lo que se inserta y devuelve dueños, el closer y su mail. */
function base() {
  const insertados: { tabla: string; filas: Record<string, unknown>[] }[] = [];
  const tablas: Record<string, unknown[]> = {
    usuarios_permitidos: [{ email: "Yari@apicanta.com", rol: "dueno" }, { email: "juan@apicanta.com", rol: "dueno" }],
    ventas: [{ id: "v1", closerId: "eq_mariano" }],
    equipo: [{ id: "eq_mariano", email: "mariano@apicanta.com" }],
  };
  const db = {
    from(tabla: string) {
      let filtro: [string, unknown] | null = null;
      let alta: Record<string, unknown>[] | null = null;
      const q = {
        select() { return q; },
        eq(c: string, v: unknown) { filtro = [c, v]; return q; },
        maybeSingle() { return Promise.resolve({ data: ((tablas[tabla] ?? []) as Record<string, unknown>[]).find((f) => !filtro || f[filtro[0]] === filtro[1]) ?? null, error: null }); },
        insert(v: Record<string, unknown> | Record<string, unknown>[]) { insertados.push({ tabla, filas: Array.isArray(v) ? v : [v] }); return Promise.resolve({ error: null }); },
        upsert(v: Record<string, unknown>[]) { alta = v; insertados.push({ tabla, filas: v }); return Promise.resolve({ error: null }); },
        then(listo: (r: { data: unknown[]; error: null }) => unknown) {
          void alta;
          return Promise.resolve({ data: ((tablas[tabla] ?? []) as Record<string, unknown>[]).filter((f) => !filtro || f[filtro[0]] === filtro[1]), error: null }).then(listo);
        },
      };
      return q;
    },
  } as unknown as SupabaseClient;
  return { db, insertados };
}

const CONTRATO: Pick<Contrato, "id" | "creadoPor" | "ventaId" | "leadId" | "modo" | "datos" | "destinatario" | "programa"> = {
  id: "ctr_1", creadoPor: "mariano@apicanta.com", ventaId: "v1", leadId: "l1", modo: "produccion", programa: "downsell",
  destinatario: { nombre: "Fulano de Tal", email: "f@x.com", telefono: "" },
  datos: {
    nombre: "Fulano de Tal", email: "f@x.com", telefono: "", documento: "123", domicilio: "Calle 1", pais: "AR",
    modalidad: "Un pago único de 350 USD", sesiones: null, bonos: [], fecha: "2026-10-26",
  },
};

test("una plantilla sin [Venta.Modalidad] avisa al historial, al closer, a quien lo mandó y a los dueños (una vez cada uno)", async () => {
  const { db, insertados } = base();
  const faltan = await avisarSiLaPlantillaNoLleva(db, CONTRATO, "Contrato de acceso al contenido grabado", DOWNSELL);
  assert.deepEqual(faltan, ["Venta.Modalidad"]);
  const ev = insertados.find((i) => i.tabla === "contrato_eventos")!;
  assert.equal(ev.filas[0].evento, "plantilla");
  assert.deepEqual((ev.filas[0].detalle as { faltan: string[] }).faltan, ["Venta.Modalidad"]);
  const avisos = insertados.find((i) => i.tabla === "avisos")!.filas;
  assert.deepEqual(avisos.map((a) => a.para).sort(), ["juan@apicanta.com", "mariano@apicanta.com", "yari@apicanta.com"]);
  assert.equal(new Set(avisos.map((a) => a.id)).size, 3);
  assert.match(String(avisos[0].cuerpo), /\[Venta\.Modalidad\]/);
  assert.match(String(avisos[0].cuerpo), /350 USD/);
});

test("una plantilla completa, una que no se pudo leer o un contrato de prueba no avisan de nada", async () => {
  for (const [plantilla, modo] of [[COMPLETA, "produccion"], [undefined, "produccion"]] as const) {
    const { db, insertados } = base();
    assert.deepEqual(await avisarSiLaPlantillaNoLleva(db, { ...CONTRATO, modo }, "X", plantilla), []);
    assert.equal(insertados.length, 0);
  }
  /* En prueba queda en el historial pero no suena la campanita de nadie. */
  const { db, insertados } = base();
  assert.deepEqual(await avisarSiLaPlantillaNoLleva(db, { ...CONTRATO, modo: "prueba" }, "X", DOWNSELL), ["Venta.Modalidad"]);
  assert.equal(insertados.some((i) => i.tabla === "avisos"), false);
});

test("sólo avisa de lo que el closer cargó: sin monto cargado, la plantilla sin [Venta.Modalidad] no es un problema", async () => {
  const { db, insertados } = base();
  const r = await avisarSiLaPlantillaNoLleva(db, { ...CONTRATO, datos: { ...CONTRATO.datos, modalidad: "" } }, "X", DOWNSELL);
  assert.deepEqual(r, []);
  assert.equal(insertados.length, 0);
});

test("si la base falla, no rompe el contrato", async () => {
  const roto = { from() { throw new Error("sin base"); } } as unknown as SupabaseClient;
  assert.deepEqual(await avisarSiLaPlantillaNoLleva(roto, CONTRATO, "X", DOWNSELL), []);
});
