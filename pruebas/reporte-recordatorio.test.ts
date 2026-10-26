import test from "node:test";
import assert from "node:assert/strict";
import { formularioDeAtajo, formularioQueSeLePide, linkDelPrograma } from "@/lib/reporte-formularios";
import { recordarReportes } from "@/lib/reporte-recordatorio";

/* Lili (26/10): «Manu pidió que se automatice el formulario semanal de los alumnos de Hackear Biz». El formulario estaba en la
   app desde el 09/10 pero seguía saliendo el Google Form: no había un link del programa para el grupo ni nada que se lo mandara
   a cada uno. Ahora /reporte?p=biz entra directo y los lunes a las 10 le llega a cada alumno de Biz su link personal. */

test("el link de cada programa y su atajo", () => {
  assert.equal(linkDelPrograma("https://apicanta-erp.vercel.app/", "hackear-biz"), "https://apicanta-erp.vercel.app/reporte?p=biz");
  assert.equal(formularioDeAtajo("biz"), "hackear-biz");
  assert.equal(formularioDeAtajo(" IT "), "hackear-it");
  assert.equal(formularioDeAtajo("otro"), null);
  assert.equal(formularioDeAtajo(null), null);
});

test("a quién se le pide el formulario: activo, todavía cursa y con programa", () => {
  assert.equal(formularioQueSeLePide({ estado: "activo" }, { programas: ["Hackear Biz"] }), "hackear-biz");
  assert.equal(formularioQueSeLePide({ estado: "activo", plan: "Hackear Biz - 6 meses" }, undefined), "hackear-biz", "sin ficha: el plan");
  assert.equal(formularioQueSeLePide({ estado: "activo", plan: "Mentoría" }, { programas: [] }), "hackear-it");
  assert.equal(formularioQueSeLePide({ estado: "activo" }, { programas: ["Hackear Biz"], followUp: "OUTBOARDING" }), null, "terminó");
  assert.equal(formularioQueSeLePide({ estado: "activo" }, { programas: ["Hackear Biz"], followUp: "Caso de éxito" }), null);
  assert.equal(formularioQueSeLePide({ estado: "egresado" }, { programas: ["Hackear Biz"] }), null);
  assert.equal(formularioQueSeLePide({ estado: "activo" }, { programas: ["Hackear Biz", "Hackear IT"] }), null, "los dos: se le pregunta");
});

/* Una base de mentira que filtra en memoria y anota lo que se escribe. */
function base(tablas: Record<string, Record<string, unknown>[]>) {
  const escritos: { tabla: string; op: string; datos: unknown }[] = [];
  return {
    escritos,
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])];
      let cambio: Record<string, unknown> | null = null;
      const q = {
        select: () => q,
        in: (c: string, v: unknown[]) => { filas = filas.filter((f) => v.includes(f[c])); return q; },
        eq: (c: string, v: unknown) => {
          filas = filas.filter((f) => f[c] === v);
          if (cambio) { escritos.push({ tabla, op: "update", datos: { ...cambio, donde: v } }); }
          return q;
        },
        gte: (c: string, v: string) => { filas = filas.filter((f) => String(f[c]) >= v); return q; },
        or: () => q,
        maybeSingle: () => Promise.resolve({ data: filas[0] ?? null, error: null }),
        upsert: (datos: unknown) => { escritos.push({ tabla, op: "upsert", datos }); return Promise.resolve({ error: null }); },
        update: (c: Record<string, unknown>) => { cambio = c; return q; },
        then: (ok: (r: unknown) => unknown, mal?: (e: unknown) => unknown) => Promise.resolve({ data: filas, error: null }).then(ok, mal),
      };
      return q;
    },
  };
}

const LUNES = new Date("2026-11-02T13:00:00.000Z");

test("los lunes: a cada alumno de Biz que no lo completó le llega su link; a nadie más", async () => {
  const db = base({
    alumnos: [
      { id: "alu_ana", nombre: "Ana Biz", email: "ana@x.com", plan: "", estado: "activo" },
      { id: "alu_beto", nombre: "Beto Completó", email: "beto@x.com", plan: "", estado: "activo" },
      { id: "alu_caro", nombre: "Caro Avisada", email: "caro@x.com", plan: "", estado: "activo" },
      { id: "alu_dani", nombre: "Dani Sin Mail", email: "dani", plan: "", estado: "activo" },
      { id: "alu_eli", nombre: "Eli Terminó", email: "eli@x.com", plan: "", estado: "activo" },
      { id: "alu_fede", nombre: "Fede IT", email: "fede@x.com", plan: "Mentoría", estado: "activo" },
      { id: "alu_gabi", nombre: "Gabi Egresada", email: "gabi@x.com", plan: "Hackear Biz", estado: "egresado" },
    ],
    seguimiento_alumnos: [
      { alumnoId: "alu_ana", programas: ["Hackear Biz"], followUp: "Módulo 2" },
      { alumnoId: "alu_beto", programas: ["Hackear Biz"], followUp: "" },
      { alumnoId: "alu_caro", programas: ["Hackear Biz"], followUp: "" },
      { alumnoId: "alu_dani", programas: ["Hackear Biz"], followUp: "" },
      { alumnoId: "alu_eli", programas: ["Hackear Biz"], followUp: "OUTBOARDING" },
    ],
    /* Beto ya lo completó esta semana (la del lunes 02/11); el de la semana pasada no cuenta. */
    reportes: [
      { alumnoId: "alu_beto", estado: "completado", semanaDel: "2026-11-02T15:00:00.000Z" },
      { alumnoId: "alu_ana", estado: "completado", semanaDel: "2026-10-26T15:00:00.000Z" },
    ],
    reporte_codigos: [
      { alumnoId: "alu_ana", codigo: "11111111-1111-4111-8111-111111111111" },
      { alumnoId: "alu_caro", codigo: "22222222-2222-4222-8222-222222222222", ultimoAvisoEn: "2026-10-31T12:00:00.000Z" },
    ],
    ajustes: [{ id: 1, bienvenida: { responderA: "soporte@apicanta.com" } }],
    equipo: [{ email: "liliana@apicanta.com", activo: true }],
  });
  const mails: { para: string; asunto: string; texto: string; responderA?: string }[] = [];
  const enviar = (async (_cfg: unknown, m: { para: string; asunto: string; texto: string; responderA?: string }) => {
    mails.push(m);
    return { ok: true, id: `re_${mails.length}` };
  }) as never;

  const r = await recordarReportes(db as never, "https://apicanta-erp.vercel.app", LUNES, enviar, { clave: "x", desde: "y" });
  assert.deepEqual(mails.map((m) => m.para), ["ana@x.com"], "sólo Ana: Beto ya lo completó, Caro lo recibió hace 2 días");
  assert.equal(mails[0].asunto, "Tu formulario semanal de Hackear Biz");
  assert.match(mails[0].texto, /formulario de seguimiento de esta semana de Hackear Biz/);
  assert.match(mails[0].texto, /https:\/\/apicanta-erp\.vercel\.app\/reporte\?c=11111111-1111-4111-8111-111111111111/);
  assert.equal(mails[0].responderA, "soporte@apicanta.com", "si contesta, le llega a quien atiende");
  assert.deepEqual(r.salteados, { yaLoCompleto: 1, avisadoHace: 1, sinMail: 1, termino: 1 });
  assert.equal(r.mandados, 1);
  assert.deepEqual(r.porPrograma, { "hackear-biz": 1 });

  assert.ok(db.escritos.some((x) => x.tabla === "reporte_codigos" && x.op === "update"), "queda anotado cuándo le salió");
  const avisos = db.escritos.filter((x) => x.tabla === "avisos").flatMap((x) => x.datos as Record<string, unknown>[]);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].tipo, "reporte-semanal");
  assert.match(String(avisos[0].cuerpo), /a 1 alumno que todavía no lo completaron\. 1 ya lo habían completado\. 1 sin un mail válido/);
});

test("sin Resend no manda nada ni lee la base", async () => {
  const db = base({});
  const r = await recordarReportes(db as never, "https://x", LUNES, (async () => { throw new Error("no"); }) as never, null);
  assert.equal(r.habilitado, false);
  assert.equal(r.mandados, 0);
});
