/* Estrés del almacén, frente 1 (LEEN / EDITAN): propiedades de src/lib/permisos.ts con tipos de cuenta al azar.

   - Monotonía: darle a un tipo más nivel en un área (de nada a ver, de ver a editar) nunca le saca un permiso (con «sólo lo suyo» igual).
   - Quien edita una tabla puede leerla (salvo el servicio que nace de una venta, que lo crea quien edita Ventas sin ver Alumnos: dicho en permisos.ts).
   - Los valores que no son exactamente «ver» o «editar» no dan nada; las áreas que no existen tampoco.
   - El dueño puede todo; el menú sólo ofrece lo que la ruta deja abrir, y el inicio de cada tipo es una pantalla que ve.
   - tipoLimpio es idempotente y resumenDeTipo nunca falla ni queda vacío. */
import test from "node:test";
import assert from "node:assert/strict";
import { ACCESO_DUENO, AREAS, EDITAN, LEEN, areaDeRuta, nivelDeAreas, nivelDeRuta, nivelEn, puedeCargarDevolucion, puedeDarDeBaja, puedeEditar, puedeLeer, resumenDeTipo, tipoLimpio, type MiAcceso } from "@/lib/permisos";
import { NAV, NAV_CLOSER, inicioPara, navPara } from "@/components/shell/nav";
import { azar, type Azar } from "./_aleatorio";
import type { AreasDeTipo, TipoCuenta } from "@/lib/types";

const TABLAS = [...new Set([...Object.keys(LEEN), ...Object.keys(EDITAN), "actividad", "preferencias", "equipo", "tipos_cuenta", "alumnos", "devoluciones"])];
const NIVEL = { ver: 1, editar: 2 } as const;

function tipoAzar(a: Azar, id = "x"): MiAcceso {
  const areas: AreasDeTipo = {};
  for (const ar of AREAS) { const n = a.pick([undefined, undefined, "ver", "editar"] as const); if (n) areas[ar.id] = n; }
  return { tipo: id, nombre: id, areas, soloLoSuyo: a.prob(0.25) };
}
function conMas(a: Azar, base: MiAcceso): MiAcceso {
  const areas: AreasDeTipo = { ...base.areas };
  for (const ar of AREAS) if (a.prob(0.4)) { const actual = areas[ar.id]; areas[ar.id] = actual === "editar" ? "editar" : actual === "ver" ? "editar" : a.pick(["ver", "editar"] as const); }
  return { ...base, areas };
}

test("monotonía: más nivel en un área nunca le saca un permiso (200 tipos al azar)", () => {
  const a = azar(1234);
  for (let i = 0; i < 200; i++) {
    const chico = tipoAzar(a, `t${i}`), grande = conMas(a, chico);
    for (const t of TABLAS) {
      if (puedeLeer(chico, t)) assert.ok(puedeLeer(grande, t), `leer ${t}: ${JSON.stringify(chico.areas)} → ${JSON.stringify(grande.areas)}`);
      if (puedeEditar(chico, t)) assert.ok(puedeEditar(grande, t), `editar ${t}: ${JSON.stringify(chico.areas)} → ${JSON.stringify(grande.areas)}`);
    }
    for (const ar of AREAS) assert.ok(nivelEn(grande, ar.id) >= nivelEn(chico, ar.id), `nivel ${ar.id}`);
    for (const r of ["/panel", "/leads", "/crm", "/ventas", "/clientes", "/webinars", "/formularios", "/marketing", "/alumnos", "/finanzas", "/ajustes", "/finanzas/caja", "/conciliacion"]) {
      assert.ok(nivelDeRuta(grande, r) >= nivelDeRuta(chico, r), `ruta ${r}`);
    }
    if (puedeCargarDevolucion(chico)) assert.ok(puedeCargarDevolucion(grande));
    if (puedeDarDeBaja(chico)) assert.ok(puedeDarDeBaja(grande));
  }
});

test("quien edita una tabla puede leerla (salvo alumnos, que lo crea quien edita Ventas)", () => {
  const a = azar(99);
  const fallas: string[] = [];
  for (let i = 0; i < 300; i++) {
    const t = tipoAzar(a, `t${i}`);
    for (const tabla of TABLAS) {
      if (tabla === "alumnos") continue;   // permisos.ts: «puedeEditar(alumnos)» también lo da Ventas editable
      if (puedeEditar(t, tabla) && !puedeLeer(t, tabla)) fallas.push(`${JSON.stringify(t.areas)} soloLoSuyo=${t.soloLoSuyo}: edita ${tabla} pero no la lee`);
    }
  }
  assert.deepEqual([...new Set(fallas)].slice(0, 10), []);
});

/* Escrita contra la versión anterior del lote de WhatsApp (tablas sin whatsapp_qr ni la columna «estado», con whatsapp_contactados, estados del lector sin «esperando-qr» y leerJson por caracteres): hay que actualizarla al esquema nuevo. */
test("el dueño puede todo, y «sin acceso» (null) no puede nada", { todo: true }, () => {
  for (const t of TABLAS) { assert.ok(puedeLeer(ACCESO_DUENO, t) && puedeEditar(ACCESO_DUENO, t), t); assert.ok(!puedeLeer(null, t) && !puedeEditar(null, t), t); }
  assert.ok(puedeCargarDevolucion(ACCESO_DUENO) && puedeDarDeBaja(ACCESO_DUENO));
  assert.ok(!puedeCargarDevolucion(null) && !puedeDarDeBaja(null));
});

test("valores raros en las áreas no dan nada: sólo «ver» y «editar», escritos exactos", () => {
  for (const raro of ["EDITAR", "Editar", " editar", "edit", "true", "2", "", "ver ", "VER", "write", null, 1, 2, true, {}, []]) {
    const a: MiAcceso = { tipo: "x", nombre: "x", areas: Object.fromEntries(AREAS.map((ar) => [ar.id, raro])) as unknown as AreasDeTipo, soloLoSuyo: false };
    for (const ar of AREAS) assert.equal(nivelEn(a, ar.id), 0, `${JSON.stringify(raro)} en ${ar.id}`);
    for (const t of TABLAS) if (t in EDITAN || t in LEEN) assert.ok(!puedeEditar(a, t), `${JSON.stringify(raro)} edita ${t}`);
  }
  /* y un área que no existe no abre nada */
  const fantasma: MiAcceso = { tipo: "x", nombre: "x", areas: { inventada: "editar" } as unknown as AreasDeTipo, soloLoSuyo: false };
  for (const t of TABLAS) if (t in EDITAN) assert.ok(!puedeEditar(fantasma, t), t);
  assert.equal(nivelDeAreas(undefined, "ventas"), 0);
  assert.equal(nivelDeAreas({}, "clientes"), 0);
});

test("el menú sólo ofrece lo que la ruta deja abrir, todo item tiene su área, y el inicio es una pantalla que se ve", () => {
  const a = azar(5);
  for (const item of [...NAV, ...NAV_CLOSER].flatMap((g) => g.items)) assert.notEqual(areaDeRuta(item.href), null, `${item.href} no tiene área: se vería para todos`);
  for (let i = 0; i < 250; i++) {
    const t = tipoAzar(a, `t${i}`);
    const items = navPara(t).flatMap((g) => g.items);
    for (const it of items) assert.ok(nivelDeRuta(t, it.href) > 0, `${JSON.stringify(t.areas)}: el menú ofrece ${it.href} y la ruta no la deja abrir`);
    const inicio = inicioPara(t);
    if (items.length > 0) assert.ok(nivelDeRuta(t, inicio.split("?")[0]) > 0 || inicio === "/panel", `${JSON.stringify(t.areas)}: el inicio ${inicio} no se puede ver`);
  }
});

test("tipoLimpio es idempotente, saca lo que no es ver/editar y resumenDeTipo siempre dice algo", () => {
  const a = azar(8);
  for (let i = 0; i < 200; i++) {
    const t = tipoAzar(a, `t${i}`);
    const sucio: TipoCuenta = { id: t.tipo, nombre: a.pick(["", "  ", " Tipo "]), descripcion: " d ", orden: 1, soloLoSuyo: t.soloLoSuyo, areas: { ...t.areas, ...(a.prob(0.5) ? { basura: "editar", ventas: "otro" } : {}) } as unknown as AreasDeTipo };
    const limpio = tipoLimpio(sucio);
    assert.deepEqual(tipoLimpio(limpio), limpio);
    assert.ok(limpio.nombre.length > 0);
    for (const [k, v] of Object.entries(limpio.areas)) assert.ok(AREAS.some((x) => x.id === k) && (v === "ver" || v === "editar"), `${k}=${v}`);
    const r = resumenDeTipo(limpio);
    assert.ok(typeof r === "string" && r.length > 0 && !/undefined|NaN|\[object/.test(r), r);
  }
  /* el dueño: siempre «todo» */
  assert.match(resumenDeTipo({ id: "dueno", areas: {}, soloLoSuyo: false }), /Todo/);
});

test("devoluciones: carga quien edita Finanzas o quien edita Ventas sin «sólo lo suyo»; el closer sólo las ve", () => {
  const a = azar(21);
  for (let i = 0; i < 300; i++) {
    const t = tipoAzar(a, `t${i}`);
    const esperado = nivelEn(t, "finanzas") === 2 || (nivelEn(t, "ventas") === 2 && !t.soloLoSuyo);
    assert.equal(puedeCargarDevolucion(t), esperado);
    assert.equal(puedeEditar(t, "devoluciones"), esperado);
    assert.equal(puedeDarDeBaja(t), nivelEn(t, "ventas") === 2 && !t.soloLoSuyo);
  }
});
