import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fijarAcceso } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { resellAbierto, resellNormal } from "@/lib/clientes-cs";
import { miPanelDe, rangoDelPanel } from "@/lib/mi-panel";
import { panelDeServicio } from "@/lib/panel-servicio";
import type { EstadoApp, Resell } from "@/lib/types";

/* Lili (24/10): «los resells que se agendan y queda pendiente el resultado de la llamada, ¿le aparece al closer en su panel?».
   No le aparecía en ningún lado (Mi panel y el cierre del día dejan afuera las llamadas de resell), y además el closer contaba
   «por cargar» sólo los que no tenían NINGÚN estado mientras Lili veía abiertos los que no tenían un resultado que los cierre:
   un resell en «Seguimiento» estaba cargado para él y abierto para ella. Ahora es una sola regla para los dos. */

const AHORA = Date.parse("2026-10-24T15:00:00.000Z");
const dias = (n: number) => new Date(AHORA - n * 86_400_000).toISOString();

test("un resell está abierto si la llamada ya pasó, no se canceló y no tiene un resultado que lo cierre", () => {
  const r = (fechaHora: string, estado: string, cancelada = false) => ({ fechaHora, estado, cancelada });
  assert.equal(resellAbierto(r(dias(2), ""), AHORA), true, "sin estado");
  assert.equal(resellAbierto(r(dias(2), "Seguimiento"), AHORA), true, "en seguimiento todavía no terminó");
  assert.equal(resellAbierto(r(dias(2), "2da Agenda, Seguimiento"), AHORA), true);
  assert.equal(resellAbierto(r(dias(2), "No quiere renovar, Outbording"), AHORA), false, "resuelto");
  assert.equal(resellAbierto(r(dias(2), "2da Agenda,Upgrade a Hackear IA"), AHORA), false, "con un resultado alcanza");
  assert.equal(resellAbierto(r(dias(-1), ""), AHORA), false, "todavía no pasó");
  assert.equal(resellAbierto(r(dias(2), "", true), AHORA), false, "cancelada");
});

function estadoCon(resells: Partial<Resell>[]): { e: EstadoApp; closer: EstadoApp["equipo"][number] } {
  fijarAcceso(null);
  const base = construirSemilla() as EstadoApp;
  const closer = base.equipo.find((m) => m.rol === "closer" && m.activo)!;
  const e: EstadoApp = { ...base, resells: resells.map((r, i) => resellNormal({ id: `rs_${i}`, closer: closer.nombre, ...r })) };
  return { e, closer };
}

test("al closer le aparecen en su panel los resells abiertos (con los nombres), y en rojo si alguno pasó la semana", () => {
  const { e, closer } = estadoCon([
    { nombre: "Ana Seguimiento", fechaHora: dias(3), estado: "Seguimiento" },
    { nombre: "Beto Sin Estado", fechaHora: dias(1), estado: "" },
    { nombre: "Cata Resuelta", fechaHora: dias(5), estado: "No quiere renovar, Outbording" },
    { nombre: "Dani Futura", fechaHora: dias(-2), estado: "" },
    { nombre: "Eli Cancelada", fechaHora: dias(2), estado: "", cancelada: true },
    { nombre: "Fede De Otro", fechaHora: dias(2), estado: "", closer: "Otro Closer Que No Existe" },
  ]);
  const panel = miPanelDe(e, closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA);
  const aviso = panel.avisos.find((a) => a.clave === "resells");
  assert.ok(aviso, "está en «Pendientes»");
  assert.equal(aviso!.resaltado, "2 resells sin cerrar");
  assert.match(aviso!.texto, /Ana Seguimiento, Beto Sin Estado/);
  assert.doesNotMatch(aviso!.texto, /Cata|Dani|Eli|Fede/);
  assert.equal(aviso!.tono, "warning", "ninguno pasó la semana");
  assert.equal(aviso!.accion?.ir, "resells");

  const viejo = estadoCon([{ nombre: "Gabi Vieja", fechaHora: dias(9), estado: "Seguimiento" }]);
  const enRojo = miPanelDe(viejo.e, viejo.closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA).avisos.find((a) => a.clave === "resells");
  assert.equal(enRojo?.tono, "danger");
  assert.equal(enRojo?.resaltado, "1 resell sin cerrar");

  const nada = estadoCon([{ nombre: "Cata Resuelta", fechaHora: dias(5), estado: "Outbording" }]);
  assert.equal(miPanelDe(nada.e, nada.closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA).avisos.some((a) => a.clave === "resells"), false);
});

test("lo que el closer ve para cerrar es exactamente lo que Lili ve «sin cierre»", () => {
  const { e, closer } = estadoCon([
    { nombre: "Ana Seguimiento", fechaHora: dias(3), estado: "Seguimiento" },
    { nombre: "Beto Sin Estado", fechaHora: dias(1), estado: "" },
    { nombre: "Cata Resuelta", fechaHora: dias(5), estado: "Outbording" },
  ]);
  const lili = panelDeServicio(e, "2026-10-24", new Date(AHORA)).secciones.find((s) => s.id === "resells")!;
  const delCloser = miPanelDe(e, closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA).avisos.find((a) => a.clave === "resells")!;
  assert.deepEqual(lili.items.map((i) => i.nombre).sort(), ["Ana Seguimiento", "Beto Sin Estado"]);
  assert.equal(delCloser.resaltado, `${lili.items.length} resells sin cerrar`);
});

test("la solapa Resell, su contador y el cierre del día usan la misma regla (nada de «sin estado» suelto)", () => {
  for (const archivo of ["src/components/cs/ResellsCs.tsx", "src/components/crm-tabla/CrmConResells.tsx", "src/components/crm-tabla/Eod.tsx", "src/lib/panel-servicio.ts"]) {
    const s = readFileSync(archivo, "utf8");
    assert.match(s, /resellAbierto\(/, archivo);
    assert.doesNotMatch(s, /!f\.resell\.estado && !f\.resell\.cancelada/, archivo);
  }
});
