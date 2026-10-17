import test from "node:test";
import assert from "node:assert/strict";
import { NAV, inicioPara, navPara } from "@/components/shell/nav";
import { ACCESO_DUENO, TIPOS_POR_DEFECTO, areaDeRuta, nivelDeRuta, type MiAcceso } from "@/lib/permisos";

/* Administración tiene tres entradas de Finanzas: los pasos, el End of Day y el P&L. Todas son del área «finanzas»:
   quien ve Finanzas las ve, y a quien no la ve no se las muestra ni le deja entrar por el link. */

const acceso = (t: { id: string; nombre: string; areas: MiAcceso["areas"]; soloLoSuyo: boolean }): MiAcceso => ({ tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo });
const FINANZAS = ["/finanzas", "/finanzas/end-of-day", "/finanzas/resultados"];
const hrefs = (a: MiAcceso) => navPara(a).flatMap((g) => g.items.map((i) => i.href));

test("las tres entradas de Finanzas están en Administración, en ese orden, junto a Equipo y Ajustes", () => {
  const admin = NAV.find((g) => g.titulo === "Administración")!;
  assert.deepEqual(admin.items.map((i) => i.href), [...FINANZAS, "/equipo", "/ajustes"]);
  assert.deepEqual(admin.items.slice(0, 3).map((i) => i.texto), ["Finanzas", "End of Day", "P&L"]);
});

test("cada tipo de cuenta ve las tres o ninguna, según su nivel en Finanzas, y entra por link igual que por el menú", () => {
  for (const t of [...TIPOS_POR_DEFECTO, { id: "ver-finanzas", nombre: "Mira Finanzas", areas: { finanzas: "ver" as const }, soloLoSuyo: false }]) {
    const a = t.id === "dueno" ? ACCESO_DUENO : acceso(t as never);
    const nivel = nivelDeRuta(a, "/finanzas");
    for (const ruta of [...FINANZAS, "/finanzas/caja", "/finanzas/detalle", "/finanzas/cierre", "/conciliacion"]) {
      assert.equal(areaDeRuta(ruta), "finanzas", `${ruta} es del área de Finanzas`);
      assert.equal(nivelDeRuta(a, ruta), nivel, `${t.id}: ${ruta} tiene el mismo nivel que /finanzas`);
    }
    const menu = hrefs(a);
    for (const ruta of FINANZAS) assert.equal(menu.includes(ruta), nivel >= 1, `${t.id}: ${ruta} en el menú ⇔ ve Finanzas`);
    /* Caja y Conciliación ya no son del menú: se llega por los pasos (y por su link). */
    assert.ok(!menu.includes("/finanzas/caja") && !menu.includes("/conciliacion"), t.id);
  }
});

test("el inicio de una cuenta que sólo ve Finanzas es una pantalla de su menú", () => {
  const a = acceso({ id: "fin", nombre: "Finanzas", areas: { finanzas: "editar" }, soloLoSuyo: true });
  assert.ok(hrefs(a).includes(inicioPara(a)), `inicio ${inicioPara(a)} fuera de [${hrefs(a).join(", ")}]`);
  assert.equal(inicioPara(a), "/finanzas");
});
