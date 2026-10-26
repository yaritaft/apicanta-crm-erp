import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCESO_DUENO, AREAS, TIPOS_POR_DEFECTO, nivelDeLiquidacion, nivelDeRuta, veLaLiquidacion, type MiAcceso,
} from "@/lib/permisos";
import { navPara } from "@/components/shell/nav";

/* ==================================================================
   Aldana (26/10): «hacer el cierre de comisiones de closers, Agus, Santi y Nahue hoy» sin depender de Juan Cruz. La liquidación es de los dueños; el
   permiso «Liquidación» (ver / editar) deja entrar a ella —y sólo a ella y a las comisiones— a quien no lo es.
   ================================================================== */

const tipo = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};
/* Aldana: Contenido y finanzas (el tipo vive en la base: finanzas y ventas, sin ajustes) y, con el permiso, «Liquidación». */
const CONTENIDO_FINANZAS = { alumnos: "editar", finanzas: "editar", leads: "ver", marketing: "editar", panel: "ver", ventas: "editar", webinars: "editar" } as const;
const aldana = (liquidacion?: "ver" | "editar"): MiAcceso => ({
  tipo: "contenido_finanzas", nombre: "Contenido y finanzas", soloLoSuyo: false, areas: { ...CONTENIDO_FINANZAS, ...(liquidacion ? { liquidacion } : {}) },
});

test("«Liquidación» es un área de los tipos de cuenta, y «Todo menos honorarios» no la trae", () => {
  assert.ok(AREAS.some((a) => a.id === "liquidacion" && a.nombre === "Liquidación"));
  assert.equal(TIPOS_POR_DEFECTO.find((t) => t.id === "equipo")!.areas.liquidacion, undefined);
  assert.equal(TIPOS_POR_DEFECTO.find((t) => t.id === "dueno")!.areas.liquidacion, "editar");
  for (const t of TIPOS_POR_DEFECTO.filter((x) => !["dueno"].includes(x.id))) assert.equal(t.areas.liquidacion, undefined, `${t.id} no la tiene de entrada`);
});

test("el nivel de la liquidación: los dueños siempre 2; el resto, el que diga su tipo; sin el permiso, 0", () => {
  assert.equal(nivelDeLiquidacion(ACCESO_DUENO), 2);
  assert.equal(nivelDeLiquidacion(aldana("editar")), 2);
  assert.equal(nivelDeLiquidacion(aldana("ver")), 1);
  assert.equal(nivelDeLiquidacion(aldana()), 0, "como está hoy: no entra");
  assert.equal(nivelDeLiquidacion(null), 0);
  for (const id of ["equipo", "admin", "closer", "director", "setter", "marketing", "customer_success"]) assert.equal(nivelDeLiquidacion(tipo(id)), 0, id);
  assert.equal(veLaLiquidacion(aldana("ver")), true);
  assert.equal(veLaLiquidacion(aldana()), false);
});

test("/equipo: entra quien tiene el permiso (ver = mirar, editar = usarla); «Todo menos honorarios» y Administración siguen afuera", () => {
  assert.equal(nivelDeRuta(ACCESO_DUENO, "/equipo"), 2);
  assert.equal(nivelDeRuta(aldana("editar"), "/equipo"), 2);
  assert.equal(nivelDeRuta(aldana("ver"), "/equipo"), 1);
  assert.equal(nivelDeRuta(aldana(), "/equipo"), 0);
  assert.equal(nivelDeRuta(tipo("equipo"), "/equipo"), 0);
  assert.equal(nivelDeRuta(tipo("admin"), "/equipo"), 0);
  /* Y el permiso no abre nada más: Ajustes sigue cerrado para ella. */
  assert.equal(nivelDeRuta(aldana("editar"), "/ajustes"), 0);
});

test("el menú: «Equipo y honorarios» aparece para quien tiene el permiso y no para quien no", () => {
  const items = (a: MiAcceso) => navPara(a).flatMap((g) => g.items.map((i) => i.href));
  assert.ok(items(aldana("editar")).includes("/equipo"));
  assert.ok(items(aldana("ver")).includes("/equipo"));
  assert.ok(!items(aldana()).includes("/equipo"));
  assert.ok(!items(tipo("equipo")).includes("/equipo"));
  assert.ok(items(ACCESO_DUENO).includes("/equipo"));
});
