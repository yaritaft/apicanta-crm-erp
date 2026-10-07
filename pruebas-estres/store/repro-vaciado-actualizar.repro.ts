/* Repro mínimo para refutar (o confirmar) el hallazgo: vaciar un campo opcional con `undefined` (acciones.actualizar,
   guardarGastoRecurrente) no llega a la base.

   Cada prueba AFIRMA LO QUE PASA HOY (pasa = el bug existe). Se corre con:
     node --import ./pruebas/registrar.mjs --test pruebas/stress/repro-vaciado-actualizar.repro.ts

   Qué se mira, para cada camino de pantalla:
   1. Que los campos estaban en la base antes (control).
   2. Qué ve la pantalla (memoria) tras vaciarlos: vacíos.
   3. Qué viaja por HTTP (el cliente de verdad, @supabase/supabase-js, contra la nube falsa): un upsert merge-duplicates cuyo
      ?columns= y cuyo cuerpo NO nombran los campos vaciados, y ningún UPDATE aparte.
   4. Qué queda en la base y qué ve una pantalla recargada: los valores viejos.
   5. Los controles: con `null` en vez de `undefined` (como hace carga-gasto.ts `vaciar`) el mismo camino sí vacía.
   6. Contra Postgres de verdad (PGlite) si está: se corren los mismos pedidos con el SQL que arma PostgREST para un upsert
      merge-duplicates con ?columns=, y se ve lo mismo. */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { BaseFalsa, instalar, type Fila, type Peticion } from "./_nube";
import { conDemo, estadoDe, recargado, yEsperar } from "./_escenas";
import type { E } from "./_acciones";
import { calcularLiquidacion, periodoDe } from "@/lib/honorarios";
import { concepto, esquema } from "../estado-liquidacion";

const base = new BaseFalsa();
instalar(base);

const por = <T extends { id: string }>(xs: T[], id: string) => xs.find((x) => x.id === id) as T;
const claves = (f: Fila, ks: string[]) => Object.fromEntries(ks.map((k) => [k, f[k] ?? null]));
/** Los upserts a una tabla que mencionan a una fila, en orden. */
const upsertsDe = (tabla: string, id: string): Peticion[] => base.peticiones("upsert", tabla).filter((p) => p.filas!.some((f) => f.id === id));
const sinNada = (p: Peticion, ks: string[]) => {
  for (const k of ks) {
    assert.ok(!p.columnas!.includes(k), `${k} viaja en ?columns=`);
    assert.ok(!(k in p.filas![0]), `${k} viaja en el cuerpo`);
  }
};

/* ============ (a) Ventas → Editar venta: lo que arma FormularioVenta.guardar() (líneas 77-91) ============ */
const CINCO_VENTA = ["productoId", "webinarId", "embudoId", "closerId", "directorId"];

/* Lo que la persona deja en el formulario: vendedor, director y webinar en «Sin asignar» / «Sin atribuir» (los tres desplegables
   que tienen esa opción). El servicio y la estrategia no tienen opción vacía en la pantalla, pero el camino es el mismo. */
function cambiosDeFormularioVenta(v: E, vaciar: string[]) {
  const f = {
    productoId: vaciar.includes("productoId") ? "" : v.productoId ?? "", embudoId: vaciar.includes("embudoId") ? "" : v.embudoId ?? "",
    closerId: vaciar.includes("closerId") ? "" : v.closerId ?? "", directorId: vaciar.includes("directorId") ? "" : v.directorId ?? "",
    webinarId: vaciar.includes("webinarId") ? "" : v.webinarId ?? "", proyecto: "",
  };
  const sinComision = false;
  /* === copiado de FormularioVenta.guardar() === */
  const webinarId = f.webinarId || undefined; // (webinarDeProyecto("") no ata nada)
  const datos = {
    contactoId: v.contactoId, contactoNombre: v.contactoNombre,
    productoId: f.productoId || undefined, webinarId: webinarId || undefined,
    embudoId: f.embudoId || undefined, precioAcordado: v.precioAcordado,
    moneda: v.moneda, closerId: f.closerId || undefined,
    directorId: sinComision ? undefined : (f.directorId || undefined),
    excluidoMarketing: v.excluidoMarketing,
    estado: v.estado, fecha: v.fecha, notas: v.notas ?? "",
    creadoEn: new Date().toISOString(), extra: {},
    proyecto: f.proyecto, setterId: v.setterId ?? "",
    referidorNombre: (v.referidorNombre ?? "").trim(), referidorTelefono: (v.referidorTelefono ?? "").trim(),
  };
  const { creadoEn: _creado, extra: _extra, ...cambios } = datos;
  return cambios;
}

const S1 = await conDemo(base);
const e1 = estadoDe(S1);
const venta = e1.ventas.find((v: E) => v.webinarId && v.closerId && v.directorId && v.productoId && v.embudoId) as E;
const antesVenta = { ...base.tabla("ventas").get(venta.id)! };
const vaciadosVenta = ["webinarId", "closerId", "directorId"]; // lo que se puede vaciar desde la pantalla
const pedidosAntes = base.peticiones("upsert", "ventas").length;
await yEsperar(S1, () => S1.acciones.actualizar("ventas", venta.id, cambiosDeFormularioVenta(venta, vaciadosVenta) as never, venta.contactoNombre));
const pedidoVenta = base.peticiones("upsert", "ventas").slice(pedidosAntes).filter((p) => p.filas!.length === 1 && p.filas![0].id === venta.id);
const tras1 = { ...base.tabla("ventas").get(venta.id)! };
const mem1 = por<E>(estadoDe(S1).ventas, venta.id);

test("(a) control: la base tenía vendedor, director y webinar de la venta", () => {
  for (const k of vaciadosVenta) assert.ok(antesVenta[k], `${k} vacío antes`);
  console.log("# base antes:", JSON.stringify(claves(antesVenta, CINCO_VENTA)));
});

test("(a) en pantalla (memoria) la venta queda sin vendedor, sin director y sin webinar", () => {
  for (const k of vaciadosVenta) assert.equal(mem1[k], undefined, `${k} sigue en memoria: ${mem1[k]}`);
});

test("(a) por HTTP: UN upsert merge-duplicates que NO nombra webinarId, closerId ni directorId (ni en ?columns= ni en el cuerpo)", () => {
  assert.equal(pedidoVenta.length, 1, "se esperaba un solo upsert de la venta");
  const p = pedidoVenta[0];
  console.log("# Prefer:", p.prefer, "\n# columns:", JSON.stringify(p.columnas), "\n# cuerpo[0] claves:", Object.keys(p.filas![0]).join(","));
  assert.match(p.prefer ?? "", /resolution=merge-duplicates/);
  sinNada(p, vaciadosVenta);
  /* y ningún UPDATE aparte que los ponga en null */
  const updates = base.peticiones("update", "ventas").filter((u) => u.n > p.n - 1 && u.ids?.includes(venta.id));
  assert.deepEqual(updates, []);
});

test("(a) BUG: en la base la venta conserva vendedor, director y webinar", () => {
  console.log("# base después:", JSON.stringify(claves(tras1, CINCO_VENTA)));
  for (const k of vaciadosVenta) assert.equal(tras1[k], antesVenta[k], `${k} cambió en la base`);
});

test("(a) BUG: al recargar vuelven los tres (la pantalla recargada no es la que se guardó)", async () => {
  const r = por<E>((await recargado()).ventas, venta.id);
  for (const k of vaciadosVenta) {
    assert.equal(mem1[k], undefined);
    assert.equal(r[k], antesVenta[k], `${k} al recargar: ${r[k]}`);
  }
});

test("(a) consecuencia: la venta recargada vuelve a contar para el vendedor y el director que se le habían sacado", async () => {
  const r = await recargado();
  const deCloser = (e: E, id: string) => e.ventas.filter((v: E) => v.closerId === id).length;
  const deDirector = (e: E, id: string) => e.ventas.filter((v: E) => v.directorId === id).length;
  const enPantalla = estadoDe(S1);
  console.log("# ventas del vendedor: pantalla", deCloser(enPantalla, venta.closerId), "vs recargada", deCloser(r, venta.closerId), "| del director:", deDirector(enPantalla, venta.directorId), "vs", deDirector(r, venta.directorId));
  assert.equal(deCloser(r, venta.closerId), deCloser(enPantalla, venta.closerId) + 1);
  assert.equal(deDirector(r, venta.directorId), deDirector(enPantalla, venta.directorId) + 1);
});

/* ============ (a) plata: lo que cobra el vendedor y el director de esa venta (lib/honorarios.ts cuenta() usa v.closerId / v.directorId) ============ */
test("(a) plata: la comisión del vendedor y del director se descuenta en pantalla y vuelve entera al recargar", async () => {
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  const conPagos = (v: E) => e0.cuotas.some((c: E) => c.ventaId === v.id && e0.pagos.some((p: E) => p.cuotaId === c.id));
  const v = e0.ventas.find((x: E) => x.closerId && x.directorId && x.estado === "activa" && conPagos(x)) as E;
  const cuotas = new Set(e0.cuotas.filter((c: E) => c.ventaId === v.id).map((c: E) => c.id));
  const pago = e0.pagos.find((p: E) => cuotas.has(p.cuotaId)) as E;
  const periodo = periodoDe(new Date(pago.fecha));
  await yEsperar(S, () => S.acciones.guardarEsquema(esquema(v.closerId, [concepto({ id: "cc", tipo: "porcentaje", nombre: "Comisión", tasa: 0.1, base: "cash", alcance: "closer" })]) as never, "yo"));
  await yEsperar(S, () => S.acciones.guardarEsquema(esquema(v.directorId, [concepto({ id: "cd", tipo: "porcentaje", nombre: "Comisión", tasa: 0.05, base: "cash", alcance: "director" })]) as never, "yo"));
  const total = (r: ReturnType<typeof calcularLiquidacion>, id: string) => r.personas.find((x) => x.miembroId === id)?.total ?? 0;
  const antes = calcularLiquidacion(estadoDe(S) as never, periodo);
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { closerId: undefined, directorId: undefined } as never, v.contactoNombre));
  const enPantalla = calcularLiquidacion(estadoDe(S) as never, periodo);
  const recargada = calcularLiquidacion((await recargado()) as never, periodo);
  const f = (n: number) => Math.round(n * 100) / 100;
  console.log(`# periodo ${periodo}, cobro de la venta ${pago.monto} ${pago.moneda}`,
    `\n# vendedor ${v.closerId}: antes ${f(total(antes, v.closerId))} · pantalla ${f(total(enPantalla, v.closerId))} · recargada ${f(total(recargada, v.closerId))}`,
    `\n# director ${v.directorId}: antes ${f(total(antes, v.directorId))} · pantalla ${f(total(enPantalla, v.directorId))} · recargada ${f(total(recargada, v.directorId))}`);
  assert.ok(total(enPantalla, v.closerId) < total(antes, v.closerId), "en pantalla el vendedor ya no cobra por esa venta");
  assert.ok(total(enPantalla, v.directorId) < total(antes, v.directorId), "en pantalla el director ya no cobra por esa venta");
  assert.equal(f(total(recargada, v.closerId)), f(total(antes, v.closerId)), "recargada: el vendedor vuelve a cobrar por la venta");
  assert.equal(f(total(recargada, v.directorId)), f(total(antes, v.directorId)), "recargada: el director vuelve a cobrar por la venta");
});

/* ============ (b) Alumnos → Editar → «Sin venta enlazada»: alumnos/page.tsx guardar() y FichaPersona.guardarEdicion() ============ */
test("(b) Alumno → «Sin venta enlazada»: memoria sin venta, HTTP sin ventaId, base y recarga con la venta", async () => {
  const S = await conDemo(base);
  const alumno = estadoDe(S).alumnos.find((a: E) => a.ventaId) as E;
  /* el formulario: setForm({...form, ventaId: ev.target.value || undefined}); guardar(): const { id, ...cambios } = form; actualizar(..., { ...cambios, nombre }) */
  const form = { ...alumno, ventaId: "" || undefined };
  const { id, ...cambios } = form;
  const desde = base.peticiones("upsert", "alumnos").length;
  await yEsperar(S, () => S.acciones.actualizar("alumnos", id, { ...cambios, nombre: alumno.nombre } as never, alumno.nombre));
  const p = base.peticiones("upsert", "alumnos").slice(desde).find((x) => x.filas!.length === 1 && x.filas![0].id === id)!;
  console.log("# alumno: memoria →", por<E>(estadoDe(S).alumnos, id).ventaId, "| ?columns= incluye ventaId:", p.columnas!.includes("ventaId"), "| base →", base.tabla("alumnos").get(id)!.ventaId);
  assert.equal(por<E>(estadoDe(S).alumnos, id).ventaId, undefined);
  sinNada(p, ["ventaId"]);
  assert.equal(base.tabla("alumnos").get(id)!.ventaId, alumno.ventaId);
  assert.equal(por<E>((await recargado()).alumnos, id).ventaId, alumno.ventaId);
});

/* ============ (c) Ficha → Ingreso a la comunidad → «Sin definir» (FichaPersona.tsx:538) ============ */
test("(c) Ingreso a la comunidad → «Sin definir»: memoria vacía, HTTP sin el campo, base y recarga con el viejo", async () => {
  const S = await conDemo(base);
  const v = estadoDe(S).ventas[0] as E;
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { ingresoComunidad: "Si" } as never, v.contactoNombre));
  assert.equal(base.tabla("ventas").get(v.id)!.ingresoComunidad, "Si");
  const desde = base.peticiones("upsert", "ventas").length;
  const valor = "" as string; // el desplegable en «Sin definir»
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { ingresoComunidad: valor || undefined } as never, v.contactoNombre));
  const p = base.peticiones("upsert", "ventas").slice(desde).find((x) => x.filas![0].id === v.id)!;
  console.log("# ingresoComunidad: memoria →", por<E>(estadoDe(S).ventas, v.id).ingresoComunidad, "| ?columns= lo incluye:", p.columnas!.includes("ingresoComunidad"), "| base →", base.tabla("ventas").get(v.id)!.ingresoComunidad);
  assert.equal(por<E>(estadoDe(S).ventas, v.id).ingresoComunidad, undefined);
  sinNada(p, ["ingresoComunidad"]);
  assert.equal(base.tabla("ventas").get(v.id)!.ingresoComunidad, "Si");
  assert.equal(por<E>((await recargado()).ventas, v.id).ingresoComunidad, "Si");
});

/* ============ (d) Finanzas → Gastos fijos → corregir y vaciar (GastosFijos.tsx FormGastoFijo.guardar) ============ */
test("(d) Gasto fijo: vaciar proveedor, cuenta y notas: memoria vacía, HTTP sin los campos, base y recarga con los viejos", async () => {
  const S = await conDemo(base);
  const cuenta = estadoDe(S).procesadores[0].id;
  const armar = (proveedor: string, cuentaId: string, notas: string) => ({
    id: "rec_repro", concepto: "Fathom", categoria: "Software", grupo: "operativo",
    proveedor: proveedor.trim() || undefined, monto: 40, moneda: "USD", diaDelMes: 5,
    cuentaId: cuentaId || undefined, webinarId: undefined, notas: notas.trim() || undefined,
    activo: true, desde: "2026-10", salteados: [], creadoEn: "2026-10-01T00:00:00.000Z",
  });
  await yEsperar(S, () => S.acciones.guardarGastoRecurrente(armar("Fathom Inc", cuenta, "se paga con la tarjeta") as never));
  assert.equal(base.tabla("gastos_recurrentes").get("rec_repro")!.proveedor, "Fathom Inc");
  const desde = base.peticiones("upsert", "gastos_recurrentes").length;
  await yEsperar(S, () => S.acciones.guardarGastoRecurrente(armar("", "", "  ") as never));
  const p = base.peticiones("upsert", "gastos_recurrentes").slice(desde)[0];
  const mem = por<E>(estadoDe(S).gastosRecurrentes, "rec_repro");
  const fila = base.tabla("gastos_recurrentes").get("rec_repro")!;
  console.log("# gasto fijo: memoria →", JSON.stringify({ p: mem.proveedor, c: mem.cuentaId, n: mem.notas }), "| base →", JSON.stringify({ p: fila.proveedor, c: fila.cuentaId, n: fila.notas }));
  assert.deepEqual({ p: mem.proveedor, c: mem.cuentaId, n: mem.notas }, { p: undefined, c: undefined, n: undefined });
  sinNada(p, ["proveedor", "cuentaId", "notas"]);
  assert.deepEqual({ p: fila.proveedor, c: fila.cuentaId, n: fila.notas }, { p: "Fathom Inc", c: cuenta, n: "se paga con la tarjeta" });
  const r = por<E>((await recargado()).gastosRecurrentes, "rec_repro");
  assert.deepEqual({ p: r.proveedor, c: r.cuentaId, n: r.notas }, { p: "Fathom Inc", c: cuenta, n: "se paga con la tarjeta" });
});

/* ============ Controles: con null el MISMO camino sí vacía (el arreglo posible) ============ */
test("control: actualizar() con null en vez de undefined (venta, alumno, ingreso) vacía la base y la recarga", async () => {
  const S = await conDemo(base);
  const e0 = estadoDe(S);
  const v = e0.ventas.find((x: E) => x.webinarId && x.closerId && x.directorId) as E;
  const alumno = e0.alumnos.find((a: E) => a.ventaId) as E;
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { ingresoComunidad: "Si" } as never, v.contactoNombre));
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { webinarId: null, closerId: null, directorId: null, ingresoComunidad: null } as never, v.contactoNombre));
  await yEsperar(S, () => S.acciones.actualizar("alumnos", alumno.id, { ventaId: null } as never, alumno.nombre));
  const r = await recargado();
  const rv = por<E>(r.ventas, v.id);
  assert.deepEqual({ w: rv.webinarId ?? null, c: rv.closerId ?? null, d: rv.directorId ?? null, i: rv.ingresoComunidad ?? null }, { w: null, c: null, d: null, i: null });
  assert.equal(por<E>(r.alumnos, alumno.id).ventaId ?? null, null);
});

test("control: guardarGastoRecurrente() con null vacía la base y la recarga", async () => {
  const S = await conDemo(base);
  const cuenta = estadoDe(S).procesadores[0].id;
  const t = { id: "rec_nulo", concepto: "Fathom", categoria: "Software", grupo: "operativo", proveedor: "Fathom Inc", monto: 40, moneda: "USD", diaDelMes: 5, cuentaId: cuenta, notas: "x", activo: true, desde: "2026-10", salteados: [], creadoEn: "2026-10-01T00:00:00.000Z" };
  await yEsperar(S, () => S.acciones.guardarGastoRecurrente(t as never));
  await yEsperar(S, () => S.acciones.guardarGastoRecurrente({ ...t, proveedor: null, cuentaId: null, notas: null } as never));
  const r = por<E>((await recargado()).gastosRecurrentes, "rec_nulo");
  assert.deepEqual({ p: r.proveedor ?? null, c: r.cuentaId ?? null, n: r.notas ?? null }, { p: null, c: null, n: null });
});

test("control: un valor NUEVO (no un vaciado) sí llega con el mismo camino", async () => {
  const S = await conDemo(base);
  const v = estadoDe(S).ventas.find((x: E) => x.closerId) as E;
  const otro = estadoDe(S).equipo.find((m: E) => m.rol === "closer" && m.id !== v.closerId) as E;
  await yEsperar(S, () => S.acciones.actualizar("ventas", v.id, { closerId: otro.id } as never, v.contactoNombre));
  assert.equal(por<E>((await recargado()).ventas, v.id).closerId, otro.id);
});

/* ============ Postgres de verdad (PGlite): el mismo pedido, el SQL que arma PostgREST ============ */
const DIR = process.env.PGLITE_DIR ?? "/Users/mariaelazaro/Menlab/menlab-app/node_modules/@electric-sql/pglite";
const hayPglite = existsSync(resolve(DIR, "dist/index.js"));

test("Postgres de verdad: los pedidos de la venta (upsert merge-duplicates con ?columns=) dejan webinar, vendedor y director", { skip: !hayPglite && "PGlite no está" }, async () => {
  const { PGlite } = await import(pathToFileURL(resolve(DIR, "dist/index.js")).href);
  const db = new PGlite();
  /* La tabla ventas de la base real no está en el repo: sus claves foráneas son las del modelo (ver el mapa de FKs de _nube.ts);
     acá sólo importan las columnas nullable de atribución y las FKs. */
  await db.exec(`
    create table public.webinars (id text primary key);
    create table public.equipo (id text primary key);
    create table public.productos (id text primary key);
    create table public.embudos (id text primary key);
    create table public.ventas (
      id text primary key, "contactoNombre" text not null, "productoId" text references public.productos(id),
      "webinarId" text references public.webinars(id), "embudoId" text references public.embudos(id),
      "closerId" text references public.equipo(id), "directorId" text references public.equipo(id), notas text);
  `);
  for (const t of ["webinars", "equipo", "productos", "embudos"]) {
    for (const f of base.filas(t)) await db.query(`insert into public.${t}(id) values ($1) on conflict do nothing`, [f.id]);
  }
  /* lo que PostgREST arma para POST ?columns=… con Prefer: resolution=merge-duplicates (la clave primaria es id) */
  const upsert = async (columnas: string[], filas: Fila[]) => {
    const l = columnas.map((c) => `"${c}"`).join(", ");
    const set = columnas.filter((c) => c !== "id").map((c) => `"${c}" = EXCLUDED."${c}"`).join(", ");
    await db.query(
      `INSERT INTO public.ventas (${l}) SELECT ${l} FROM json_populate_recordset(null::public.ventas, $1::json) ON CONFLICT ("id") DO UPDATE SET ${set}`,
      [JSON.stringify(filas)],
    );
  };
  const limpio = (f: Fila) => Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== undefined && ["id", "contactoNombre", "productoId", "webinarId", "embudoId", "closerId", "directorId", "notas"].includes(k)));
  /* punto de partida: la fila como estaba en la base falsa antes de editar */
  await upsert(Object.keys(limpio(antesVenta)), [limpio(antesVenta)]);
  /* el pedido que mandó el store al editar (sólo las columnas de arriba) */
  const p = pedidoVenta[0];
  await upsert(p.columnas!.filter((c) => Object.keys(limpio(antesVenta)).includes(c)), [limpio(p.filas![0])]);
  const { rows } = await db.query(`select "productoId", "webinarId", "embudoId", "closerId", "directorId" from public.ventas where id = $1`, [venta.id]);
  console.log("# Postgres (PGlite) tras el pedido de editar:", JSON.stringify(rows[0]));
  assert.deepEqual(rows[0], claves(antesVenta, CINCO_VENTA));
  /* y con un UPDATE con null (el arreglo posible) sí se vacían */
  await db.query(`update public.ventas set "webinarId"=null, "closerId"=null, "directorId"=null where id = $1`, [venta.id]);
  assert.deepEqual((await db.query(`select "webinarId", "closerId", "directorId" from public.ventas where id = $1`, [venta.id])).rows[0], { webinarId: null, closerId: null, directorId: null });
  await db.close();
});
