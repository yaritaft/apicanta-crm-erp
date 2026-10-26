import test from "node:test";
import assert from "node:assert/strict";
import { diaDelOutboarding, esOutboarding, tocaOutboarding } from "@/lib/outboarding";
import { pasarOutboardings } from "@/lib/outboarding-servidor";

/* Lili (26/10): «¿cómo se hace el outboarding automático, que le quite el acceso a Wisboo, Zoom y Telegram?». En Outboarding,
   la app le saca sola los accesos que dio el día después de que termina su programa (o ya, si terminó). «No renueva» se toca
   hasta 30 días antes del fin: nadie pierde días que pagó. */

test("el Follow Up de outboarding, como venía del Airtable; «Caso de éxito» no", () => {
  for (const f of ["OUTBOARDING", "Outboarding", "outbording", " Outboarding (no renovó)"]) assert.equal(esOutboarding(f), true, f);
  for (const f of ["Caso de éxito", "Módulo 3", "", null, undefined, "No outboarding"]) assert.equal(esOutboarding(f), false, String(f));
});

test("el día: el siguiente al fin del programa; si ya terminó o no se sabe, hoy", () => {
  assert.equal(diaDelOutboarding("2026-11-15", "2026-10-26"), "2026-11-16", "termina el 15: el 16 se le saca");
  assert.equal(diaDelOutboarding("2026-10-26", "2026-10-26"), "2026-10-27", "termina hoy: tiene todo el día");
  assert.equal(diaDelOutboarding("2026-10-01", "2026-10-26"), "2026-10-26", "ya terminó: hoy");
  assert.equal(diaDelOutboarding(null, "2026-10-26"), "2026-10-26", "sin fin: hoy");
  assert.equal(tocaOutboarding("OUTBOARDING", "2026-10-25", "2026-10-26"), true);
  assert.equal(tocaOutboarding("OUTBOARDING", "2026-10-26", "2026-10-26"), false);
  assert.equal(tocaOutboarding("Módulo 3", "2026-10-01", "2026-10-26"), false, "sin outboarding nunca");
});

/* Una base de mentira: filtra en memoria lo que pide la pasada y anota lo que escribe. */
function base(tablas: Record<string, Record<string, unknown>[]>) {
  const escritos: { tabla: string; filas: unknown }[] = [];
  return {
    escritos,
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      const q = {
        select: () => q,
        in: (c: string, v: unknown[]) => { filas = filas.filter((f) => v.includes(f[c])); return q; },
        eq: (c: string, v: unknown) => { filas = filas.filter((f) => f[c] === v); return q; },
        or: () => q,
        maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
        upsert: (f: unknown) => { escritos.push({ tabla, filas: f }); return Promise.resolve({ error: null }); },
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok, mal),
      };
      return q;
    },
  };
}

const seg = (alumnoId: string, followUp: string, extra: Record<string, unknown> = {}) =>
  ({ id: `seg_${alumnoId}`, alumnoId, followUp, programas: [], duracionMeses: null, fechaEgreso: null, pausas: [], ...extra });

test("la pasada: saca los accesos sólo a quien está en outboarding y ya terminó, y le avisa a Customer Success", async () => {
  const db = base({
    accesos_alumno: [
      { alumnoId: "alu_termino", estado: "dado" }, { alumnoId: "alu_termino", estado: "entro" },
      { alumnoId: "alu_falta", estado: "dado" }, { alumnoId: "alu_hoy", estado: "dado" }, { alumnoId: "alu_cursa", estado: "dado" },
      { alumnoId: "alu_ya_sin", estado: "quitado" },
    ],
    seguimiento_alumnos: [
      /* Arrancó el 01/07 con 3 meses: terminó el 01/10. */
      seg("alu_termino", "OUTBOARDING", { duracionMeses: 3 }),
      /* «No renueva» antes de tiempo: termina el 01/12. */
      seg("alu_falta", "Outboarding", { duracionMeses: 3 }),
      /* El egreso escrito a mano es hoy: tiene todo el día. */
      seg("alu_hoy", "OUTBOARDING", { fechaEgreso: "2026-10-26" }),
      seg("alu_cursa", "Módulo 3", { duracionMeses: 3 }),
      seg("alu_ya_sin", "OUTBOARDING", { duracionMeses: 3 }),
    ],
    ajustes: [{ id: 1, seguimiento: {} }],
    alumnos: [
      { id: "alu_termino", nombre: "Ana Terminó", inicio: "2026-07-01", plan: "", ventaId: null, leadId: "lea_ana" },
      { id: "alu_falta", nombre: "Beto Falta", inicio: "2026-09-01", plan: "", ventaId: null, leadId: null },
      { id: "alu_hoy", nombre: "Caro Hoy", inicio: "2026-07-26", plan: "", ventaId: null, leadId: null },
      { id: "alu_cursa", nombre: "Dani Cursa", inicio: "2026-07-01", plan: "", ventaId: null, leadId: null },
    ],
    productos: [],
    equipo: [{ email: "liliana@apicanta.com", activo: true }, { email: "otro@apicanta.com", activo: false }],
  });
  const llamados: string[] = [];
  const quitar = (async (_db: unknown, a: { alumnoId: string; quien: string }) => {
    llamados.push(`${a.alumnoId}:${a.quien}`);
    return { quitados: 2, fallaron: 1, accesos: [{ error: "No se sabe su usuario de Telegram: sacalo a mano del grupo.", recursoNombre: "General", recurso: "-100" }] };
  }) as unknown as Parameters<typeof pasarOutboardings>[2];

  const r = await pasarOutboardings(db as never, new Date("2026-10-26T15:00:00.000Z"), quitar);
  assert.deepEqual(llamados, ["alu_termino:Outboarding automático"]);
  assert.equal(r.conAccesos, 4, "el que ya no tiene nada de la app ni se mira");
  assert.equal(r.esperan, 2, "el que termina en diciembre y el que termina hoy");
  assert.deepEqual(r.hechos, [{ alumnoId: "alu_termino", quitados: 2, fallaron: 1 }]);

  const avisos = db.escritos.filter((x) => x.tabla === "avisos").flatMap((x) => x.filas as Record<string, unknown>[]);
  assert.equal(avisos.length, 1, "a quien está activo en Customer Success");
  assert.equal(avisos[0].para, "liliana@apicanta.com");
  assert.equal(avisos[0].tipo, "outboarding");
  assert.equal(avisos[0].contactoId, "lea_ana", "abre su ficha");
  assert.equal(avisos[0].titulo, "Outboarding de Ana Terminó: falta sacar algo a mano");
  assert.match(String(avisos[0].cuerpo), /terminó el 01\/10: se le sacaron 2 accesos/);
  assert.match(String(avisos[0].cuerpo), /No se pudo sacar: General\. Hacelo a mano/);
});

test("sin nadie con accesos de la app, no lee nada más", async () => {
  const db = base({ accesos_alumno: [] });
  const r = await pasarOutboardings(db as never, new Date("2026-10-26T15:00:00.000Z"), (async () => { throw new Error("no"); }) as never);
  assert.deepEqual(r, { conAccesos: 0, esperan: 0, hechos: [] });
});
