import test from "node:test";
import assert from "node:assert/strict";
import { esLlamadaDeResell, idResell, registrarResell, type AgendaDeResell, type BaseDeResells } from "@/lib/resells";

/* Una base de mentira con lo que hace Postgres con un upsert de una fila: si existe, cambia sólo las columnas que se mandan;
   si no, la crea con los valores por defecto de la tabla. */
function baseDeMentira(opciones: { falla?: string } = {}) {
  const filas = new Map<string, Record<string, unknown>>();
  const defectos = { estado: "", cashCollect: null, casoDeExito: false, notas: "", cancelada: false, origen: "manual", actualizadoPor: "" };
  const ok = { error: null };
  const db: BaseDeResells = {
    from: () => ({
      select: () => ({ eq: (c, v) => ({ limit: async (n) => {
        if (opciones.falla) return { data: null, error: { message: opciones.falla } };
        return { data: [...filas.values()].filter((f) => f[c] === v).slice(0, n), error: null };
      } }) }),
      upsert: async (fila) => {
        if (opciones.falla) return { error: { message: opciones.falla } };
        const id = String(fila.id);
        filas.set(id, filas.has(id) ? { ...filas.get(id), ...fila } : { ...defectos, ...fila });
        return ok;
      },
      update: (cambios) => ({ eq: async (c, v) => {
        for (const [id, f] of filas) if (f[c] === v) filas.set(id, { ...f, ...cambios });
        return ok;
      } }),
      delete: () => ({ eq: async (c, v) => {
        for (const [id, f] of filas) if (f[c] === v) filas.delete(id);
        return ok;
      } }),
    }),
  };
  return { db, filas };
}

const AGENDA: AgendaDeResell = {
  sesionId: "ses_1", fechaHora: "2026-10-07T18:30:00.000Z", nombre: "Ana López", email: "ana@mail.com", telefono: "+54 9 11 5555 1111",
  closer: "Mariano", cancelada: false, ahora: "2026-10-07T12:00:00.000Z",
};

test("una llamada es de resell por el nombre del evento o por el utm_source", () => {
  assert.equal(esLlamadaDeResell({ tipo: "Llamada de Auditoría" }), true, "el evento de Lili en producción");
  assert.equal(esLlamadaDeResell({ tipo: "Resell Mentoría 1:1" }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento", utm: { utm_source: "Resell" } }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento", utm: { source: "resell-ig" } }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento", titulo: "Llamada con Ana", utm: { utm_source: "meta" } }), false);
  assert.equal(esLlamadaDeResell({ tipo: "Asesoramiento" }), false);
  assert.equal(esLlamadaDeResell({}), false);
  assert.equal(idResell("ses_9"), "rs_ses_9");
});

test("una agenda nueva crea su fila, sin estado ni cash: eso lo carga Customer Success", async () => {
  const { db, filas } = baseDeMentira();
  const r = await registrarResell(db, AGENDA);
  assert.deepEqual(r, { hecho: true });
  const fila = filas.get("rs_ses_1")!;
  assert.deepEqual(
    [fila.sesionId, fila.fechaHora, fila.nombre, fila.email, fila.telefono, fila.closer, fila.cancelada, fila.origen, fila.estado, fila.cashCollect, fila.casoDeExito, fila.notas],
    ["ses_1", "2026-10-07T18:30:00.000Z", "Ana López", "ana@mail.com", "+54 9 11 5555 1111", "Mariano", false, "calendly", "", null, false, ""],
  );
});

test("volver a traer la agenda (o que el alumno la mueva) cambia la hora y no pisa lo que cargó Customer Success", async () => {
  const { db, filas } = baseDeMentira();
  await registrarResell(db, AGENDA);
  filas.set("rs_ses_1", { ...filas.get("rs_ses_1"), estado: "Renueva", cashCollect: 1200, casoDeExito: true, notas: "Renovó por 6 meses", actualizadoPor: "Lili" });
  await registrarResell(db, { ...AGENDA, fechaHora: "2026-10-08T19:00:00.000Z", closer: "Dante", ahora: "2026-10-07T13:00:00.000Z" });
  const f = filas.get("rs_ses_1")!;
  assert.deepEqual([f.fechaHora, f.closer], ["2026-10-08T19:00:00.000Z", "Dante"], "lo de Calendly se actualiza");
  assert.deepEqual([f.estado, f.cashCollect, f.casoDeExito, f.notas, f.actualizadoPor], ["Renueva", 1200, true, "Renovó por 6 meses", "Lili"], "lo de Customer Success, intacto");
  assert.equal(filas.size, 1);
});

test("una cancelación marca la agenda que ya existe, y no crea una de algo que nunca se vio activo", async () => {
  const { db, filas } = baseDeMentira();
  assert.deepEqual(await registrarResell(db, { ...AGENDA, cancelada: true }), { hecho: true });
  assert.equal(filas.size, 0, "una cancelada que nunca vimos no deja fila");
  await registrarResell(db, AGENDA);
  await registrarResell(db, { ...AGENDA, cancelada: true });
  assert.equal(filas.get("rs_ses_1")!.cancelada, true);
  /* Y si la reactivan (agenda de nuevo), vuelve. */
  await registrarResell(db, AGENDA);
  assert.equal(filas.get("rs_ses_1")!.cancelada, false);
});

test("una reprogramación hereda lo cargado en la anterior y la anterior se borra: queda una sola fila por cita", async () => {
  const { db, filas } = baseDeMentira();
  await registrarResell(db, AGENDA);
  filas.set("rs_ses_1", { ...filas.get("rs_ses_1"), estado: "Lo piensa", cashCollect: 300, casoDeExito: true, notas: "Quiere pensarlo" });

  const nueva: AgendaDeResell = { ...AGENDA, sesionId: "ses_2", fechaHora: "2026-10-14T18:30:00.000Z", reprogramadaDe: "ses_1" };
  await registrarResell(db, nueva);
  assert.equal(filas.has("rs_ses_1"), false, "la anterior ya no está");
  const f = filas.get("rs_ses_2")!;
  assert.deepEqual([f.fechaHora, f.estado, f.cashCollect, f.casoDeExito, f.notas], ["2026-10-14T18:30:00.000Z", "Lo piensa", 300, true, "Quiere pensarlo"]);

  /* Llega tarde la cancelación de la vieja: no la resucita. */
  await registrarResell(db, { ...AGENDA, cancelada: true });
  assert.deepEqual([...filas.keys()], ["rs_ses_2"]);

  /* Si la nueva se vuelve a traer, no se vuelve a heredar ni se pisa lo que se cargó después. */
  filas.set("rs_ses_2", { ...f, estado: "Renueva" });
  await registrarResell(db, nueva);
  assert.equal(filas.get("rs_ses_2")!.estado, "Renueva");
});

test("una reprogramación de algo que nunca se vio guarda la nueva sola", async () => {
  const { db, filas } = baseDeMentira();
  await registrarResell(db, { ...AGENDA, sesionId: "ses_9", reprogramadaDe: "ses_8" });
  assert.deepEqual([...filas.keys()], ["rs_ses_9"]);
  assert.equal(filas.get("rs_ses_9")!.estado, "");
});

test("si la tabla no existe o la base falla, la entrada de la agenda sigue: no se tira nada", async () => {
  const { db } = baseDeMentira({ falla: 'relation "public.resells" does not exist' });
  const r = await registrarResell(db, AGENDA);
  assert.equal(r.hecho, false);
  assert.match(r.motivo ?? "", /resells/);
  /* Aun una base que se cae con una excepción. */
  const rota: BaseDeResells = { from: () => { throw new Error("sin conexión"); } };
  assert.deepEqual(await registrarResell(rota, AGENDA), { hecho: false, motivo: "sin conexión" });
});
