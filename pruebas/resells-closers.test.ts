import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esLlamadaDeResell } from "@/lib/resells";
import { entraEnTabla, TABLAS_POR_DEFECTO } from "@/lib/crm";
import { alternarEstadoResell, estadosDeResell, LISTAS_POR_DEFECTO } from "@/lib/clientes-cs";
import { llamadasDelDia } from "@/lib/eod";

/* Mariano (19/10): las llamadas de resell se veían como un lead de venta, sin sus opciones. */

test("«Próximos pasos» (el evento con el que se habla con alumnos) es de resell, igual que auditoría y el utm Resell", () => {
  assert.equal(esLlamadaDeResell({ tipo: "Llamada de Asesoramiento - Próximos pasos" }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Llamada de Auditoría" }), true);
  assert.equal(esLlamadaDeResell({ tipo: "Llamada de Asesoramiento - Webinar - Team", utm: { utm_source: "Resell" } }), true);
  for (const t of ["Llamada de Asesoramiento - Webinar - Team", "Llamada de Asesoramiento - VSL - Team", "Llamada de Asesoramiento - Setter", "Charla Comercial"]) {
    assert.equal(esLlamadaDeResell({ tipo: t, utm: { utm_source: "Webinar" } }), false, t);
  }
});

test("la tabla del CRM las separa igual: «Próximos pasos» entra en Agendas Resells y no en Booking Calls", () => {
  const [booking, resells] = TABLAS_POR_DEFECTO;
  const proximos = { tipo: "Llamada de Asesoramiento - Próximos pasos" };
  assert.equal(entraEnTabla(proximos, resells), true);
  assert.equal(entraEnTabla(proximos, booking), false);
  assert.equal(entraEnTabla({ tipo: "Llamada de Asesoramiento - Webinar - Team" }, booking), true);
  assert.equal(entraEnTabla({ tipo: "Llamada de Auditoría" }, resells), true);
});

test("los estados de resell son los del Airtable y se eligen varios a la vez", () => {
  assert.deepEqual(LISTAS_POR_DEFECTO.estadosResell, ["2da Agenda", "Upgrade a Hackear IA", "No quiere renovar", "Outbording", "Seguimiento", "Garantía Extendida", "Alumno vigente"]);
  assert.deepEqual(estadosDeResell("No quiere renovar,Outbording"), ["No quiere renovar", "Outbording"], "como los exporta el Airtable");
  assert.deepEqual(estadosDeResell(" a , ,b,a"), ["a", "b"]);
  assert.equal(alternarEstadoResell("", "Outbording"), "Outbording");
  assert.equal(alternarEstadoResell("Outbording", "No quiere renovar"), "Outbording, No quiere renovar");
  assert.equal(alternarEstadoResell("Outbording, No quiere renovar", "Outbording"), "No quiere renovar", "tocar uno elegido lo saca");
  assert.equal(alternarEstadoResell("Outbording, Seguimiento", "Vaciar"), "");
});

test("el cierre del día no pide las llamadas de resell", () => {
  const e = {
    equipo: [], sesiones: [
      { id: "a", tipo: "Llamada de Asesoramiento - Webinar - Team", anfitrion: "Mariano Arias", inicia: "2026-10-19T15:00:00.000Z", estado: "agendada" },
      { id: "b", tipo: "Llamada de Asesoramiento - Próximos pasos", anfitrion: "Mariano Arias", inicia: "2026-10-19T16:00:00.000Z", estado: "agendada" },
      { id: "c", tipo: "Llamada de Auditoría", anfitrion: "Mariano Arias", inicia: "2026-10-19T17:00:00.000Z", estado: "agendada" },
    ],
  };
  assert.deepEqual(llamadasDelDia(e as never, "Mariano Arias", "2026-10-19").map((s) => s.id), ["a"]);
});

test("el selector de fechas dice el día de la semana cuando es un solo día", () => {
  const src = readFileSync("src/components/ui/DateRangePicker.tsx", "utf8");
  assert.match(src, /r\.desde === r\.hasta \? conDiaDeSemana\(r\.desde\)/);
  assert.match(src, /const DIAS_CORTOS = \["dom", "lun", "mar", "mié", "jue", "vie", "sáb"\]/);
});

test("la pantalla tiene los dos grupos y los dos usan el mismo componente", () => {
  const grupos = readFileSync("src/components/crm-tabla/CrmConResells.tsx", "utf8");
  assert.match(grupos, /<ResellsCs \/>/);
  assert.match(grupos, /<CrmTabla misLlamadas=\{misLlamadas\} \/>/);
  assert.match(readFileSync("src/app/(app)/crm/page.tsx", "utf8"), /CrmConResells/);
  assert.match(readFileSync("src/app/(app)/mis-llamadas/page.tsx", "utf8"), /CrmConResells misLlamadas/);
  assert.match(readFileSync("src/components/crm-tabla/CrmTabla.tsx", "utf8"), /!esLlamadaDeResell\(f\.sesion\)/);
});
