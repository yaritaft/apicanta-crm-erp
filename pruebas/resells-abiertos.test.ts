import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fijarAcceso } from "@/lib/store";
import { construirSemilla } from "@/lib/seed";
import { esDeTestimonio, faltaDeLaLlamada, resellAbierto, resellNormal } from "@/lib/clientes-cs";
import { esLlamadaDeTestimonio } from "@/lib/resells";
import { llamadasParaCerrar, miPanelDe, rangoDelPanel, VEN_LAS_DE_YARI } from "@/lib/mi-panel";
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

test("al closer le aparecen en su panel las llamadas abiertas (las suyas, la más vieja primero)", () => {
  const { e, closer } = estadoCon([
    { nombre: "Ana Seguimiento", fechaHora: dias(3), estado: "Seguimiento" },
    { nombre: "Beto Sin Estado", fechaHora: dias(1), estado: "" },
    { nombre: "Cata Resuelta", fechaHora: dias(5), estado: "No quiere renovar, Outbording" },
    { nombre: "Dani Futura", fechaHora: dias(-2), estado: "" },
    { nombre: "Eli Cancelada", fechaHora: dias(2), estado: "", cancelada: true },
    { nombre: "Fede De Otro", fechaHora: dias(2), estado: "", closer: "Otro Closer Que No Existe" },
  ]);
  const panel = miPanelDe(e, closer, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA);
  assert.deepEqual(panel.llamadasParaCerrar.map((f) => f.resell.nombre), ["Ana Seguimiento", "Beto Sin Estado"]);
  assert.equal(panel.avisos.some((a) => a.clave === "resells"), false, "ya no es un aviso suelto: tiene su tarjeta con «Cerrar»");
  const comoSetter = miPanelDe(e, { ...closer, rol: "setter" }, rangoDelPanel("2026-10-01", "2026-10-31", "octubre"), AHORA);
  assert.deepEqual(comoSetter.llamadasParaCerrar, [], "el setter no toma estas llamadas");
});

test("lo que el closer ve para cerrar es exactamente lo que Lili ve «sin cierre»", () => {
  const { e, closer } = estadoCon([
    { nombre: "Ana Seguimiento", fechaHora: dias(3), estado: "Seguimiento" },
    { nombre: "Beto Sin Estado", fechaHora: dias(1), estado: "" },
    { nombre: "Cata Resuelta", fechaHora: dias(5), estado: "Outbording" },
  ]);
  const lili = panelDeServicio(e, "2026-10-24", new Date(AHORA)).secciones.find((s) => s.id === "resells")!;
  const delCloser = llamadasParaCerrar(e, closer, AHORA);
  assert.deepEqual(lili.items.map((i) => i.nombre).sort(), ["Ana Seguimiento", "Beto Sin Estado"]);
  assert.deepEqual(delCloser.map((f) => f.resell.nombre).sort(), lili.items.map((i) => i.nombre).sort());
});

/* Lili (24/10): los testimonios se agendan por Calendly (Mariano los de menos de 5K, Yari los de más) y después de la llamada
   «le queda en el panel pendiente hasta que lo completen»: si grabó, el link, el pitch y si compró. Las de Yari también las ve
   Manu; el director comercial ve todas. */

test("una llamada de testimonio queda abierta hasta que dice si grabó y el link, y si compró; «Se reagenda» la cierra", () => {
  const t = (x: Partial<Resell>) => ({ fechaHora: dias(2), estado: "", casoDeExito: true, ...x });
  assert.deepEqual(faltaDeLaLlamada(t({})), ["si grabó el testimonio", "si compró (el resell)"]);
  assert.deepEqual(faltaDeLaLlamada(t({ testimonio: "Grabó" })), ["el link de la grabación", "si compró (el resell)"]);
  assert.deepEqual(faltaDeLaLlamada(t({ testimonio: "Grabó", linkTestimonio: "https://drive.google.com/x", estado: "Seguimiento" })),
    ["en qué terminó el resell (está en «Seguimiento»)"]);
  assert.equal(resellAbierto(t({ testimonio: "Grabó", linkTestimonio: "https://drive.google.com/x", estado: "Alumno vigente" }), AHORA), false, "completa");
  assert.equal(resellAbierto(t({ testimonio: "No quiso grabar", estado: "No quiere renovar, Outbording" }), AHORA), false);
  assert.equal(resellAbierto(t({ testimonio: "Se reagenda" }), AHORA), false, "la nueva agenda entra sola por Calendly");
  assert.equal(esDeTestimonio(t({ fechaHora: "2026-09-10T15:00:00.000Z" })), false, "los casos de éxito viejos (antes de octubre) no piden testimonio");
  assert.deepEqual(faltaDeLaLlamada(t({ fechaHora: "2026-09-10T15:00:00.000Z" })), ["si compró (el resell)"]);
});

test("las llamadas de Yari las ve también Manu, y el director comercial ve las de todos", () => {
  const { e, closer } = estadoCon([]);
  const manu = { ...closer, id: VEN_LAS_DE_YARI[0], nombre: "Manuel Pérez", rol: "otro" as const };
  const director = e.equipo.find((m) => m.rol === "director")!;
  const yari = e.equipo.find((m) => m.id === "eq_yari")!;
  const conLlamadas: EstadoApp = {
    ...e, equipo: [...e.equipo, manu],
    resells: [
      resellNormal({ id: "rs_y", nombre: "Testimonio De Yari", closer: `${yari.nombre} Taft`, fechaHora: dias(2), casoDeExito: true }),
      resellNormal({ id: "rs_c", nombre: "Resell Del Closer", closer: closer.nombre, fechaHora: dias(1) }),
    ],
  };
  const de = (m: EstadoApp["equipo"][number]) => llamadasParaCerrar(conLlamadas, m, AHORA).map((f) => f.resell.nombre);
  assert.deepEqual(de(yari), ["Testimonio De Yari"], "Calendly la trae como «Yari Taft»: igual es suya");
  assert.deepEqual(de(manu), ["Testimonio De Yari"]);
  assert.deepEqual(de(closer), ["Resell Del Closer"]);
  assert.deepEqual(de(director), ["Testimonio De Yari", "Resell Del Closer"]);
});

test("el «Testimonio» de Yari y el «Próximos pasos» de Mariano son llamadas de testimonio; las de venta no", () => {
  assert.equal(esLlamadaDeTestimonio({ tipo: "Testimonio", titulo: "" }), true);
  assert.equal(esLlamadaDeTestimonio({ tipo: "Llamada de Asesoramiento - Próximos pasos", titulo: "" }), true);
  assert.equal(esLlamadaDeTestimonio({ tipo: "Llamada de Asesoramiento - Webinar - Team", titulo: "" }), false);
});

test("la solapa Resell, su contador y el cierre del día usan la misma regla (nada de «sin estado» suelto)", () => {
  for (const archivo of ["src/components/cs/ResellsCs.tsx", "src/components/crm-tabla/CrmConResells.tsx", "src/components/crm-tabla/Eod.tsx", "src/lib/panel-servicio.ts"]) {
    const s = readFileSync(archivo, "utf8");
    assert.match(s, /resellAbierto\(/, archivo);
    assert.doesNotMatch(s, /!f\.resell\.estado && !f\.resell\.cancelada/, archivo);
  }
});
