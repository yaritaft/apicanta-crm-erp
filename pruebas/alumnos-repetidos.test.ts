import test from "node:test";
import assert from "node:assert/strict";
import { alumnosRepetidos, repetidosDe } from "@/lib/alumnos-repetidos";
import { corregirPersonaEnLaBase, MailRepetido } from "@/lib/personas-servidor";
import { acciones, fijarAcceso } from "@/lib/store";
import type { Alumno, Contacto, EstadoApp, Lead, SeguimientoAlumno } from "@/lib/types";

/* Lili (23/10): Mariano cargó la venta de Saul Rivas Martínez como «Edgar» (otro nombre, otro mail, el mismo teléfono) y
   quedaron dos alumnos: Saul con todo lo de Servicio y sin venta, Edgar con la venta y vacío. Lo mismo con Luis Espitia
   (el mismo mail) y Aristóteles Quintanar. Y el teléfono de Alan Rios que Lili corregía no se guardaba en ningún lado. */

const alumno = (id: string, nombre: string, extra: Partial<Alumno> = {}): Alumno =>
  ({ id, nombre, email: "", estado: "activo", inicio: "2026-10-01", ...extra }) as Alumno;
const lead = (id: string, nombre: string, telefono: string, contactoId?: string): Lead =>
  ({ id, nombre, telefono, contactoId }) as Lead;
const contacto = (id: string, nombre: string, telefono: string): Contacto =>
  ({ id, nombre, email: "", telefono, creadoEn: "2026-09-01T00:00:00Z", extra: {} });
const seg = (alumnoId: string, telefono: string) => ({ id: `seg_${alumnoId}`, alumnoId, telefono }) as SeguimientoAlumno;

const base = (cambios: Partial<EstadoApp> = {}) => ({
  alumnos: [
    alumno("alu_saul", "Saul Rivas Martinez", { email: "saul.rims@gmail.com" }),
    alumno("alu_edgar", "Edgar Zun", { email: "edgarzunpat@gmail.com", ventaId: "ven_1", leadId: "lea_edgar" }),
  ],
  seguimientos: [seg("alu_saul", "+52 1 55 3012 4567")],
  leads: [lead("lea_edgar", "Edgar Zun", "52 55 3012 4567", "con_edgar")],
  contactos: [contacto("con_edgar", "Edgar Zun", "52 55 3012 4567")],
  ...cambios,
}) as Pick<EstadoApp, "alumnos" | "seguimientos" | "leads" | "contactos">;

test("el mismo teléfono con otro nombre: uno con venta y el otro sin, se muestran juntos", () => {
  const pares = alumnosRepetidos(base());
  assert.equal(pares.length, 1);
  assert.deepEqual([pares[0].conVenta.id, pares[0].sinVenta.id, pares[0].por], ["alu_edgar", "alu_saul", "telefono"]);
  assert.equal(repetidosDe(base(), "alu_saul").length, 1, "aparece en las dos fichas");
});

test("el mismo mail también (Luis Espitia), aunque no haya teléfono", () => {
  const e = base({
    alumnos: [
      alumno("alu_cs_pncall", "Luis Eduardo Espitia Lopez", { email: "Luis.Eduardo.Espitia.Lopez@gmail.com " }),
      alumno("alu_luis", "Luis Espitia", { email: "luis.eduardo.espitia.lopez@gmail.com", ventaId: "ven_2" }),
    ],
    seguimientos: [], leads: [], contactos: [],
  });
  const [p] = alumnosRepetidos(e);
  assert.deepEqual([p.conVenta.id, p.sinVenta.id, p.por], ["alu_luis", "alu_cs_pncall", "email"]);
});

test("no se proponen: los dos con venta, el de baja, la misma persona del CRM y los que alguien dijo que no son", () => {
  const e = base();
  const dosVentas = { ...e, alumnos: e.alumnos.map((a) => (a.id === "alu_saul" ? { ...a, ventaId: "ven_9" } : a)) };
  assert.equal(alumnosRepetidos(dosVentas).length, 0, "dos ventas son dos servicios (un resell)");
  const deBaja = { ...e, alumnos: e.alumnos.map((a) => (a.id === "alu_saul" ? { ...a, estado: "baja" as const } : a)) };
  assert.equal(alumnosRepetidos(deBaja).length, 0);
  /* Los dos cuelgan del mismo contacto: eso ya lo une la base sola (alumnos-sin-duplicar.sql). */
  const mismaPersona = { ...e, alumnos: e.alumnos.map((a) => (a.id === "alu_saul" ? { ...a, leadId: "lea_edgar" } : a)) };
  assert.equal(alumnosRepetidos(mismaPersona).length, 0);
  /* Alan Rios y Brayner Cárdenas: «no son la misma persona». */
  const noSon = { ...e, alumnos: e.alumnos.map((a) => (a.id === "alu_saul" ? { ...a, extra: { noEsElMismoAlumno: ["alu_edgar"] } } : a)) };
  assert.equal(alumnosRepetidos(noSon).length, 0);
  /* Un número corto no alcanza para decir nada. */
  const corto = base({ seguimientos: [seg("alu_saul", "4567")], leads: [lead("lea_edgar", "Edgar Zun", "4567", "con_edgar")], contactos: [] });
  assert.equal(alumnosRepetidos(corto).length, 0);
});

/* ---------- La unión sin nube (store.ts → unificarAlumnosLocal): lo mismo que supabase/unificar-alumnos.sql ---------- */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
fijarAcceso(null);

test("unir: queda el de Servicio con la venta del otro, el nombre más completo y su seguimiento combinado", () => {
  const e = estado();
  const conLead = e.leads.find((l) => e.alumnos.some((a) => a.leadId === l.id)) ?? e.leads[0];
  const queda = alumno("alu_prueba_queda", "Guillermo Basoco", { email: "", pais: "México" });
  const otro = alumno("alu_prueba_otro", "Guillermo Sánchez Basoco", { email: "blemished_lotus@hotmail.com", ventaId: "ven_prueba", leadId: conLead.id, extra: { ventaPendiente: { desde: "2026-10-20" } } });
  acciones.importarClientesCs({
    alumnos: [queda, otro],
    seguimientos: [
      { ...seg("alu_prueba_queda", ""), notas: "lo de Lili" } as SeguimientoAlumno,
      { ...seg("alu_prueba_otro", "+52 55 1111 2222"), notas: "" } as SeguimientoAlumno,
    ],
    testimonios: [], resells: [], reportes: [], detalle: "Prueba.",
  });
  acciones.unificarAlumnosLocal("alu_prueba_queda", "alu_prueba_otro", false);
  const d = estado();
  assert.equal(d.alumnos.some((a) => a.id === "alu_prueba_otro"), false, "el otro se borra");
  const q = d.alumnos.find((a) => a.id === "alu_prueba_queda")!;
  assert.deepEqual([q.ventaId, q.leadId, q.nombre, q.email, q.pais], ["ven_prueba", conLead.id, "Guillermo Sánchez Basoco", "blemished_lotus@hotmail.com", "México"]);
  assert.equal((q.extra ?? {}).ventaPendiente, undefined, "ya tiene su venta: no la espera más");
  assert.equal(((q.extra ?? {}).alumnosUnificados as unknown[]).length, 1, "queda la copia del otro");
  const s = (d.seguimientos ?? []).filter((x) => x.alumnoId === "alu_prueba_queda");
  assert.equal(s.length, 1);
  assert.deepEqual([s[0].id, s[0].notas, s[0].telefono], ["seg_alu_prueba_queda", "lo de Lili", "+52 55 1111 2222"], "lo vacío se completa con lo del otro");
  assert.equal((d.seguimientos ?? []).some((x) => x.alumnoId === "alu_prueba_otro"), false);
});

/* ---------- El teléfono de Alan Rios: la corrección de Servicio la escribe el servidor ---------- */

type Fila = Record<string, unknown>;
function baseFalsa(tablas: Record<string, Fila[]>, choca = false) {
  const actualizar = (t: string, cambios: Fila, cumple: (f: Fila) => boolean) => {
    const filas = (tablas[t] ??= []).filter(cumple);
    for (const f of filas) Object.assign(f, cambios);
    return { data: filas.map((f) => ({ id: f.id, nombre: f.nombre })), error: null };
  };
  return {
    from: (t: string) => ({
      update: (cambios: Fila) => ({
        eq: (c: string, v: unknown) => ({
          select: async () => (choca && t === "contactos" && cambios.email
            ? { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } }
            : actualizar(t, cambios, (f) => f[c] === v)),
        }),
        or: (filtro: string) => ({
          select: async () => {
            const [, id] = /contactoId\.eq\.([^,]+)/.exec(filtro)!;
            return actualizar(t, cambios, (f) => f.contactoId === id || f.id === id);
          },
        }),
        in: (c: string, v: unknown[]) => ({ select: async () => actualizar(t, cambios, (f) => v.includes(f[c])) }),
      }),
      insert: async (fila: Fila) => { (tablas[t] ??= []).push(fila); return { error: null }; },
    }),
  } as unknown as Parameters<typeof corregirPersonaEnLaBase>[0];
}

test("corregir el teléfono desde Servicio lo escribe en la persona y en sus oportunidades, con su constancia", async () => {
  const tablas: Record<string, Fila[]> = {
    contactos: [{ id: "con_alan", nombre: "Alan Rios", telefono: "57 300 0000000" }],
    leads: [{ id: "lea_1", contactoId: "con_alan", telefono: "57 300 0000000" }, { id: "lea_2", contactoId: "con_otro", telefono: "1" }],
    sesiones: [], ventas: [], alumnos: [], actividad: [],
  };
  const r = await corregirPersonaEnLaBase(baseFalsa(tablas), "con_alan", { telefono: " +57 311 222 3344 " }, "Lili");
  assert.equal(tablas.contactos[0].telefono, "+57 311 222 3344");
  assert.equal(tablas.leads[0].telefono, "+57 311 222 3344");
  assert.equal(tablas.leads[1].telefono, "1", "la oportunidad de otra persona no se toca");
  assert.equal(r.registros, 2);
  assert.match(String(tablas.actividad[0].detalle), /teléfono \(\+57 311 222 3344\).*desde Servicio/);
  assert.equal(tablas.actividad[0].actor, "Lili");
});

test("un mail que ya es de otra persona no se pisa: se pide unificar", async () => {
  const tablas: Record<string, Fila[]> = { contactos: [{ id: "con_alan", nombre: "Alan Rios" }], leads: [], actividad: [] };
  await assert.rejects(corregirPersonaEnLaBase(baseFalsa(tablas, true), "con_alan", { email: "otro@x.com" }, "Lili"), MailRepetido);
  assert.equal(tablas.actividad.length, 0);
});
