import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NAV, NAV_CLOSER, TODOS_LOS_ITEMS, inicioPara, navPara, type ItemNav } from "@/components/shell/nav";
import {
  ACCESO_DUENO, AREAS, AREAS_DE_SECCION, EDITAN, LEEN, TIPOS_POR_DEFECTO, areaDeRuta, esCuentaDeCloser, nivelDeRuta, nivelEn, puedeCargarDevolucion,
  puedeDarDeBaja, puedeEditar, puedeLeer, resumenDeTipo, tipoLimpio, veSeccion, type MiAcceso,
} from "@/lib/permisos";
import type { AreaId, AreasDeTipo, TipoCuenta } from "@/lib/types";
import { porSemillas, type Azar } from "./azar";

/* ==================================================================
   Propiedad 4: el menú de cada tipo de cuenta (lib/permisos.ts y
   components/shell/nav.ts) sólo contiene rutas que sus áreas permiten, y
   el inicio es una ruta de su menú.

   Se prueba con los 7 tipos de la app (y el dueño) y con 3000 tipos al
   azar: áreas con «ver», «editar» o nada, con y sin «sólo lo suyo».
   ================================================================== */

const acceso = (t: Pick<TipoCuenta, "id" | "nombre" | "areas" | "soloLoSuyo">): MiAcceso =>
  ({ tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo });

const hrefs = (a: MiAcceso | null) => navPara(a).flatMap((g) => g.items.map((i) => i.href));
const IDS_AREA = AREAS.map((a) => a.id);

/* Lo que pide cada item del menú del closer: verlo, o editarlo si guarda algo (cargar una venta, cerrar el día). */
const nivelMinimo = (i: ItemNav) => (i.edita ? 2 : 1);
/* El menú que le toca (la regla de los arreglos del estrés): el del closer si es de «sólo lo suyo» y le queda alguna de sus
   entradas; si no (un «sólo lo suyo» sin CRM ni Ventas), el de siempre. */
const menuQueLeToca = (a: MiAcceso) => (esCuentaDeCloser(a) && NAV_CLOSER.flatMap((g) => g.items).some((i) => nivelDeRuta(a, i.href) >= nivelMinimo(i)) ? NAV_CLOSER : NAV);

function tipoAlAzar(r: Azar, i: number): TipoCuenta {
  const areas: AreasDeTipo = {};
  const densidad = r.elige([0.1, 0.3, 0.6, 0.9]);
  for (const id of IDS_AREA) if (r.si(densidad)) areas[id] = r.elige(["ver", "editar"] as const);
  return { id: `custom${i}`, nombre: `Tipo ${i}`, descripcion: "", areas, soloLoSuyo: r.si(0.35), orden: 10 + i };
}

/* ---------- Los tipos de la app, a mano ---------- */

const MENU_ESPERADO: Record<string, { menu: string[]; inicio: string }> = {
  dueno: {
    menu: ["/panel", "/leads", "/crm", "/agenda", "/ventas", "/clientes", "/webinars", "/formularios", "/marketing", "/alumnos", "/alumnos?seccion=pipeline", "/reportes",
      "/alumnos?seccion=hoy", "/alumnos?seccion=seguimiento", "/finanzas", "/finanzas/caja", "/conciliacion", "/equipo", "/ajustes"],
    inicio: "/panel",
  },
  equipo: {
    menu: ["/panel", "/leads", "/crm", "/agenda", "/ventas", "/clientes", "/webinars", "/formularios", "/marketing", "/alumnos", "/alumnos?seccion=pipeline", "/reportes",
      "/alumnos?seccion=hoy", "/alumnos?seccion=seguimiento", "/finanzas", "/finanzas/caja", "/conciliacion", "/ajustes"],
    inicio: "/panel",
  },
  director: { menu: ["/panel", "/leads", "/crm", "/agenda", "/ventas", "/clientes", "/webinars", "/formularios"], inicio: "/panel" },
  closer: { menu: ["/mis-llamadas", "/cerrar-el-dia", "/cargar-venta"], inicio: "/mis-llamadas" },
  setter: { menu: ["/leads", "/crm", "/agenda"], inicio: "/leads" },
  admin: { menu: ["/panel", "/ventas", "/clientes", "/finanzas", "/finanzas/caja", "/conciliacion"], inicio: "/panel" },
  marketing: { menu: ["/panel", "/leads", "/webinars", "/formularios", "/marketing"], inicio: "/panel" },
  customer_success: {
    menu: ["/clientes", "/alumnos", "/alumnos?seccion=pipeline", "/reportes", "/alumnos?seccion=hoy", "/alumnos?seccion=seguimiento"],
    inicio: "/alumnos?seccion=hoy",
  },
};

test("el menú y el inicio de cada tipo de la app son los que dicen sus descripciones", () => {
  for (const t of TIPOS_POR_DEFECTO) {
    const a = t.id === "dueno" ? ACCESO_DUENO : acceso(t);
    const esperado = MENU_ESPERADO[t.id];
    assert.ok(esperado, `falta el esperado de ${t.id}`);
    assert.deepEqual(hrefs(a), esperado.menu, `menú de ${t.id}`);
    assert.equal(inicioPara(a), esperado.inicio, `inicio de ${t.id}`);
  }
  assert.deepEqual(TIPOS_POR_DEFECTO.map((t) => t.id).sort(), Object.keys(MENU_ESPERADO).sort(), "hay un tipo nuevo sin esperado");
});

test("sólo el closer usa el menú mínimo; ni el dueño con «sólo lo suyo» ni los demás tipos", () => {
  for (const t of TIPOS_POR_DEFECTO) {
    const a = t.id === "dueno" ? ACCESO_DUENO : acceso(t);
    assert.equal(esCuentaDeCloser(a), t.id === "closer", t.id);
  }
  assert.equal(esCuentaDeCloser({ ...ACCESO_DUENO, soloLoSuyo: true }), false);
  assert.equal(esCuentaDeCloser(null), false);
  assert.equal(esCuentaDeCloser(undefined), false);
});

/* ---------- Propiedades, con tipos al azar ---------- */

test("3000 tipos al azar: cada item del menú es una ruta que sus áreas ven, de un menú conocido, sin repetir", () => {
  const conocidos = new Set(TODOS_LOS_ITEMS.map((i) => i.href));
  let conMenu = 0, deCloser = 0;
  porSemillas(3000, 1, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    const menu = hrefs(a);
    assert.equal(new Set(menu).size, menu.length, "sin repetidos");
    const lista = menuQueLeToca(a);
    const permitidos = new Set(lista.flatMap((g) => g.items.map((i) => i.href)));
    for (const h of menu) {
      assert.ok(conocidos.has(h) && permitidos.has(h), `${h} no es de su menú`);
      const area = areaDeRuta(h);
      assert.ok(area !== null && area !== "equipo", `${h}: sin área (o sólo de dueños) en el menú de un tipo que no es dueño`);
      assert.ok(nivelDeRuta(a, h) >= 1, `${h}: no la ve`);
      assert.ok(nivelEn(a, area as AreaId) >= 1);
    }
    /* Y al revés: lo que su menú muestra es TODO lo que puede usar (en el menú que le toca): lo que ve y, si guarda algo, lo que edita. */
    for (const i of lista.flatMap((g) => g.items)) assert.equal(menu.includes(i.href), nivelDeRuta(a, i.href) >= nivelMinimo(i), `${i.href}`);
    /* Los grupos vacíos no se muestran. */
    for (const g of navPara(a)) assert.ok(g.items.length > 0);
    if (menu.length) conMenu++;
    if (esCuentaDeCloser(a)) deCloser++;
  });
  assert.ok(conMenu > 2000 && deCloser > 500, `con menú ${conMenu}, de closer ${deCloser}`);
});

test("3000 tipos al azar: con un menú que no está vacío, el inicio es una ruta de ese menú", () => {
  let vacios = 0;
  porSemillas(3000, 10_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    const menu = hrefs(a);
    if (menu.length === 0) { vacios++; return; }
    const inicio = inicioPara(a);
    assert.ok(menu.includes(inicio), `inicio ${inicio} no está en el menú [${menu.join(", ")}] de ${JSON.stringify(t.areas)} soloLoSuyo=${t.soloLoSuyo}`);
    assert.ok(nivelDeRuta(a, inicio) >= 1);
  });
  assert.ok(vacios > 100, `tipos sin menú: ${vacios}`);
});

/* BUG: un tipo de «sólo lo suyo» sin CRM ni Ventas (por ejemplo Customer Success con la casilla marcada) usa el menú
   mínimo del closer, que se queda vacío, y su inicio no está en el menú: cae en /panel (que no ve) o, si ve Alumnos, en
   /alumnos?seccion=hoy. «Ir a mi inicio» lo devuelve a una pantalla que dice «no es de tu tipo de cuenta» o lo deja sin
   forma de moverse. El README dice que una cuenta de sólo lo suyo ve tres entradas, pero no que pueda quedarse sin ninguna. */
test("BUG: el inicio de un tipo de «sólo lo suyo» sin CRM ni Ventas es una ruta de su menú", () => {
  const casos: AreasDeTipo[] = [{ alumnos: "editar" }, { alumnos: "ver", clientes: "ver" }, { leads: "editar" }, { finanzas: "editar" }];
  for (const areas of casos) {
    const a = acceso({ id: "c", nombre: "c", areas, soloLoSuyo: true });
    const menu = hrefs(a);
    assert.ok(menu.includes(inicioPara(a)), `${JSON.stringify(areas)}: menú [${menu.join(", ")}], inicio ${inicioPara(a)}`);
  }
});

/* BUG: el README dice «Si un tipo no edita Ventas, "Cargar venta" no aparece solo». navPara filtra con nivel > 0, así que
   un tipo de sólo lo suyo que SÓLO VE Ventas tiene «Cargar venta» en el menú: abre el asistente y la base rechaza la venta
   al guardar. Lo mismo pasa con «Cerrar el día» y un CRM que sólo se ve. */
test("BUG: «Cargar venta» (y «Cerrar el día») sólo aparecen en el menú del closer si su tipo edita Ventas (CRM)", () => {
  const soloVe = acceso({ id: "c", nombre: "c", areas: { crm: "editar", ventas: "ver" }, soloLoSuyo: true });
  assert.ok(!hrefs(soloVe).includes("/cargar-venta"), "Cargar venta con Ventas sólo para mirar");
  const crmVe = acceso({ id: "c", nombre: "c", areas: { crm: "ver", ventas: "editar" }, soloLoSuyo: true });
  assert.ok(!hrefs(crmVe).includes("/cerrar-el-dia"), "Cerrar el día con el CRM sólo para mirar");
});

test("tipo vacío o sin menú: no hay menú y el inicio cae en /panel, que tampoco ve (se avisa en pantalla: «Esta pantalla no es de tu tipo de cuenta»)", () => {
  const a = acceso({ id: "v", nombre: "v", areas: {}, soloLoSuyo: false });
  assert.deepEqual(hrefs(a), []);
  assert.equal(inicioPara(a), "/panel");
  assert.equal(nivelDeRuta(a, "/panel"), 0);
});

test("3000 tipos al azar: dar más áreas nunca saca un item del menú (en el mismo menú)", () => {
  porSemillas(3000, 20_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const mas: AreasDeTipo = { ...t.areas };
    const id = r.elige(IDS_AREA);
    mas[id] = r.elige(["ver", "editar"] as const);
    if (t.areas[id] === "editar") mas[id] = "editar";
    const a = acceso(t), b = acceso({ ...t, areas: mas });
    assert.equal(esCuentaDeCloser(a), esCuentaDeCloser(b));
    /* Un «sólo lo suyo» sin CRM ni Ventas que gana una de las dos pasa del menú de siempre al del closer: ahí no se compara. */
    if (menuQueLeToca(a) !== menuQueLeToca(b)) return;
    const antes = new Set(hrefs(a)), despues = new Set(hrefs(b));
    for (const h of antes) assert.ok(despues.has(h), `${h} desapareció al dar ${id}`);
  });
});

test("3000 tipos al azar: quien edita una tabla también la lee (salvo los alumnos que nacen de una venta, que es a propósito)", () => {
  porSemillas(3000, 30_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    for (const tabla of new Set([...Object.keys(EDITAN), "devoluciones"])) {
      if (!puedeEditar(a, tabla)) continue;
      if (tabla === "alumnos" && nivelEn(a, "ventas") === 2) continue;
      assert.ok(puedeLeer(a, tabla), `${tabla}: edita pero no lee (${JSON.stringify(t.areas)} soloLoSuyo=${t.soloLoSuyo})`);
    }
  });
});

test("3000 tipos al azar: leer una tabla es ver al menos una de las áreas que la leen, y nunca más", () => {
  porSemillas(3000, 40_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    for (const [tabla, areas] of Object.entries(LEEN)) {
      assert.equal(puedeLeer(a, tabla), areas.some((x) => nivelEn(a, x) >= 1), tabla);
    }
    /* Lo que no está en LEEN lo lee cualquiera con una sesión; sin acceso, nada. */
    assert.equal(puedeLeer(null, "ventas"), false);
    assert.equal(puedeLeer(a, "tabla_que_no_existe"), true);
  });
});

test("el dueño ve todo el menú y su inicio es el Dashboard; sin acceso (todavía cargando) no hay menú", () => {
  assert.deepEqual(navPara(ACCESO_DUENO).flatMap((g) => g.items.map((i) => i.href)), NAV.flatMap((g) => g.items.map((i) => i.href)));
  assert.equal(inicioPara(ACCESO_DUENO), "/panel");
  assert.deepEqual(navPara(null), []);
  assert.equal(inicioPara(null), "/panel");
  /* Un tipo «dueno» con las áreas vacías sigue viendo todo: el dueño es fijo. */
  assert.equal(hrefs({ ...ACCESO_DUENO, areas: {} }).length, NAV.flatMap((g) => g.items).length);
});

test("tipoLimpio sólo deja áreas conocidas con ver/editar, y el menú no cambia por limpiar", () => {
  porSemillas(500, 50_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const sucio = { ...t, areas: { ...t.areas, inventada: "editar", otra: "nada" } as unknown as AreasDeTipo };
    const limpio = tipoLimpio(sucio);
    assert.deepEqual(Object.keys(limpio.areas).sort(), Object.keys(t.areas).sort());
    assert.deepEqual(hrefs(acceso(limpio)), hrefs(acceso(t)));
  });
});

test("ninguna pantalla de la app queda sin área: una ruta sin dueño en RUTAS la vería cualquiera, hasta un tipo que no ve nada", () => {
  const raiz = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src", "app", "(app)");
  const carpetas = readdirSync(raiz, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(carpetas.length >= 15, `se esperaban las pantallas de la app, hay ${carpetas.length}`);
  const sinNada = acceso({ id: "vacio", nombre: "Vacío", areas: {}, soloLoSuyo: false });
  for (const c of carpetas) {
    const ruta = `/${c}`;
    assert.notEqual(areaDeRuta(ruta), null, `${ruta} no tiene área en lib/permisos.ts (RUTAS)`);
    assert.equal(nivelDeRuta(sinNada, ruta), 0, `${ruta}: un tipo sin áreas la ve`);
    assert.equal(nivelDeRuta(ACCESO_DUENO, ruta), 2, ruta);
    /* Y sus subrutas, con ? o con /. */
    assert.equal(areaDeRuta(`${ruta}/algo`), areaDeRuta(ruta));
    assert.equal(areaDeRuta(`${ruta}?x=1`), areaDeRuta(ruta));
  }
  /* Todo lo que está en el menú tiene área. */
  for (const i of TODOS_LOS_ITEMS) assert.notEqual(areaDeRuta(i.href), null, i.href);
});

test("Equipo y honorarios son sólo del dueño: ningún tipo, ni el que lo edita todo, ve /equipo", () => {
  porSemillas(500, 60_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    for (const area of IDS_AREA) t.areas[area] = r.elige(["ver", "editar"] as const);
    assert.equal(nivelDeRuta(acceso(t), "/equipo"), 0);
    assert.ok(!hrefs(acceso(t)).includes("/equipo"));
  });
  assert.equal(nivelDeRuta(ACCESO_DUENO, "/equipo"), 2);
});

/* Lo que lee cada pantalla del menú para dibujarse (de lo que cada una pide al estado): si el menú la ofrece, la base
   tiene que dejarle leer todo eso. */
const LEE_LA_PANTALLA: Record<string, string[]> = {
  "/leads": ["leads", "contactos", "comentarios"],
  "/crm": ["sesiones", "contactos", "leads", "comentarios"],
  "/mis-llamadas": ["sesiones", "contactos", "leads"],
  "/cerrar-el-dia": ["sesiones", "contactos", "leads"],
  "/agenda": ["sesiones", "contactos", "leads"],
  "/ventas": ["ventas", "cuotas", "pagos", "contactos", "devoluciones"],
  "/cargar-venta": ["ventas", "cuotas", "pagos", "contactos", "leads"],
  "/clientes": ["contactos", "ventas", "cuotas", "pagos", "comentarios"],
  "/webinars": ["webinars", "sesiones"],
  "/formularios": ["webinars"],
  "/marketing": ["campanias", "ad_insights"],
  "/alumnos": ["alumnos", "reportes", "seguimiento_alumnos", "testimonios"],
  "/reportes": ["alumnos", "reportes"],
  "/finanzas": ["gastos", "ventas", "cuotas", "pagos", "movimientos"],
  "/finanzas/caja": ["arqueos", "movimientos", "traspasos"],
  "/conciliacion": ["movimientos", "ventas", "cuotas", "pagos", "transacciones"],
};

test("3000 tipos al azar: si el menú ofrece una pantalla, la base deja leer todo lo que esa pantalla pide", () => {
  /* El mapa de arriba lista sólo lo que cada pantalla necesita para dibujarse; la columna de ventas del CRM, por ejemplo,
     no entra porque el setter la ve vacía a propósito («sin montos de venta»). */
  const faltan = new Map<string, number>();
  porSemillas(3000, 70_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    for (const h of hrefs(a)) {
      const ruta = h.split("?")[0];
      for (const tabla of LEE_LA_PANTALLA[ruta] ?? []) {
        if (!puedeLeer(a, tabla)) faltan.set(`${ruta} → ${tabla}`, (faltan.get(`${ruta} → ${tabla}`) ?? 0) + 1);
      }
    }
  });
  assert.deepEqual([...faltan.entries()], [], "pantallas del menú que piden tablas que la base le niega");
});

/* ---------- Lo que dice cada tipo, en una línea, y lo que puede hacer con las ventas ---------- */

test("resumenDeTipo nombra exactamente las áreas que el tipo edita y las que sólo ve, y avisa de «sólo lo suyo» (2000 semillas)", () => {
  const NOMBRE = new Map(AREAS.map((a) => [a.id, a.nombre]));
  porSemillas(2000, 80_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const txt = resumenDeTipo(t);
    assert.equal(txt.includes("Sólo lo suyo."), t.soloLoSuyo && !txt.startsWith("No ve nada"), txt);
    const cuerpo = txt.replace(" Sólo lo suyo.", "");
    /* Las áreas de un nivel y otro, como las ve la app: «Clientes» sale de lo que da Ventas. */
    const edita = AREAS.filter((a) => nivelEn(acceso(t), a.id) === 2).map((a) => a.nombre);
    const ve = AREAS.filter((a) => nivelEn(acceso(t), a.id) === 1).map((a) => a.nombre);
    if (edita.length === 0 && ve.length === 0) { assert.equal(cuerpo, "No ve nada todavía."); return; }
    const [parteEdita, parteVe] = edita.length ? (() => { const m = cuerpo.match(/^Edita (.*?)(?:; ve (.*))?\.$/)!; return [m[1], m[2]]; })() : [undefined, cuerpo.match(/^Ve (.*)\.$/)![1]];
    const nombresEn = (texto?: string) => (texto === undefined ? [] : AREAS.map((a) => NOMBRE.get(a.id)!).filter((n) => texto.includes(n)));
    assert.deepEqual(nombresEn(parteEdita), edita, `edita: «${parteEdita}»`);
    assert.deepEqual(nombresEn(parteVe), ve, `ve: «${parteVe}»`);
    /* Nada que no esté. */
    for (const a of AREAS) if (nivelEn(acceso(t), a.id) === 0) assert.ok(!cuerpo.includes(a.nombre), `${a.nombre} aparece y no la ve`);
  });
  assert.equal(resumenDeTipo({ id: "dueno", areas: {}, soloLoSuyo: true }), "Todo, incluidos Equipo y honorarios.");
});

test("quién da de baja una venta o carga una devolución: nunca quien ve sólo lo suyo (salvo con Finanzas editable, para las devoluciones), y siempre quien edita Finanzas (1500 semillas)", () => {
  porSemillas(1500, 90_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    const ventas = nivelEn(a, "ventas"), fin = nivelEn(a, "finanzas");
    assert.equal(puedeDarDeBaja(a), ventas === 2 && !t.soloLoSuyo);
    assert.equal(puedeCargarDevolucion(a), fin === 2 || (ventas === 2 && !t.soloLoSuyo));
    assert.equal(puedeEditar(a, "devoluciones"), puedeCargarDevolucion(a));
    /* Dar de baja siempre pide poder editar ventas. */
    if (puedeDarDeBaja(a)) assert.ok(puedeEditar(a, "ventas"));
  });
  for (const t of TIPOS_POR_DEFECTO) {
    const a = t.id === "dueno" ? ACCESO_DUENO : acceso(t);
    assert.equal(puedeDarDeBaja(a), ["dueno", "equipo", "director", "admin"].includes(t.id), t.id);
    assert.equal(puedeCargarDevolucion(a), ["dueno", "equipo", "director", "admin"].includes(t.id), t.id);
  }
  assert.equal(puedeDarDeBaja(null), false);
  assert.equal(puedeCargarDevolucion(undefined), false);
});

test("las secciones del Dashboard que ve cada tipo salen de las áreas que ve (y del Dashboard): sin Dashboard no hay ninguna (1500 semillas)", () => {
  const SECCIONES = Object.keys(AREAS_DE_SECCION) as (keyof typeof AREAS_DE_SECCION)[];
  porSemillas(1500, 100_001, (r, s) => {
    const t = tipoAlAzar(r, s);
    const a = acceso(t);
    for (const sec of SECCIONES) {
      const esperado = nivelEn(a, "panel") >= 1 && AREAS_DE_SECCION[sec].some((x) => nivelEn(a, x) >= 1);
      assert.equal(veSeccion(a, sec), esperado, `${sec} para ${JSON.stringify(t.areas)}`);
    }
    if (nivelEn(a, "panel") === 0) assert.ok(SECCIONES.every((sec) => !veSeccion(a, sec)));
  });
  assert.ok(SECCIONES.every((sec) => veSeccion(ACCESO_DUENO, sec)));
  assert.ok(SECCIONES.every((sec) => !veSeccion(null, sec)));
});
