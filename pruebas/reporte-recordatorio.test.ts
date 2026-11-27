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

test("a quién se le pide el formulario: activo de verdad, todavía cursa y con programa", () => {
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz"] }, "activo"), "hackear-biz");
  assert.equal(formularioQueSeLePide({ plan: "Hackear Biz - 6 meses" }, undefined, "activo"), "hackear-biz", "sin ficha: el plan");
  assert.equal(formularioQueSeLePide({ plan: "Mentoría" }, { programas: [] }, "activo"), "hackear-it");
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz"], followUp: "OUTBOARDING" }, "activo"), null, "terminó");
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz"], followUp: "Caso de éxito" }, "activo"), null);
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz"] }, "graduado"), null);
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz", "Hackear IT"] }, "activo"), null, "los dos: se le pregunta");
  /* Liliana, 27/11: ni a la reserva ni a quien pidió el reembolso (la situación sale de lib/situacion-alumno.ts). */
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz"] }, "reserva"), null);
  assert.equal(formularioQueSeLePide({}, { programas: ["Hackear Biz"] }, "baja"), null);
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

/* Liliana, 27/11: el campo dice «activo» también en las reservas y en quien pidió el reembolso. El lunes se mira la situación de verdad
   (lib/situacion-alumno.ts), con su venta y sus cuotas: a ellos no les llega el formulario. */
test("los lunes no le escribe a una reserva ni a quien pidió el reembolso: sólo al activo de verdad", async () => {
  const db = base({
    alumnos: [
      { id: "alu_ana", nombre: "Ana Cursa", email: "ana@x.com", plan: "", estado: "activo", ventaId: "v_ana" },
      { id: "alu_res", nombre: "Rita Reserva", email: "rita@x.com", plan: "", estado: "activo", ventaId: "v_res" },
      { id: "alu_rfu", nombre: "Raúl Reserva FU", email: "raul@x.com", plan: "", estado: "activo" },
      { id: "alu_dev", nombre: "Dora Devolución", email: "dora@x.com", plan: "", estado: "activo", ventaId: "v_dev" },
    ],
    seguimiento_alumnos: [
      { alumnoId: "alu_ana", programas: ["Hackear Biz"], followUp: "Módulo 2" },
      { alumnoId: "alu_res", programas: ["Hackear Biz"], followUp: "" },
      { alumnoId: "alu_rfu", programas: ["Hackear Biz"], followUp: "RESERVA" },
      { alumnoId: "alu_dev", programas: ["Hackear Biz"], followUp: "Devolución" },
    ],
    ventas: [{ id: "v_ana", estado: "activa" }, { id: "v_res", estado: "activa" }, { id: "v_dev", estado: "reembolsada" }],
    cuotas: [
      { ventaId: "v_ana", monto: 500, esReserva: false, estado: "pagada" },
      { ventaId: "v_res", monto: 100, esReserva: true, estado: "pagada" },
      { ventaId: "v_res", monto: 2900, esReserva: false, estado: "pendiente" },
      { ventaId: "v_dev", monto: 500, esReserva: false, estado: "pagada" },
    ],
    reportes: [],
    reporte_codigos: ["alu_ana", "alu_res", "alu_rfu", "alu_dev"].map((alumnoId, n) => ({ alumnoId, codigo: `${n + 1}${n + 1}${n + 1}${n + 1}${n + 1}${n + 1}${n + 1}${n + 1}-1111-4111-8111-111111111111` })),
    ajustes: [{ id: 1, bienvenida: {} }],
    equipo: [],
  });
  const mails: { para: string }[] = [];
  const enviar = (async (_cfg: unknown, m: { para: string }) => { mails.push(m); return { ok: true, id: `re_${mails.length}` }; }) as never;
  const r = await recordarReportes(db as never, "https://apicanta-erp.vercel.app", LUNES, enviar, { clave: "x", desde: "y" });
  assert.deepEqual(mails.map((m) => m.para), ["ana@x.com"], "ni Rita (sólo pagó la reserva), ni Raúl (Follow Up Reserva), ni Dora (reembolsada)");
  assert.equal(r.salteados.termino, 3, "los tres cuentan como que no cursan");
});
