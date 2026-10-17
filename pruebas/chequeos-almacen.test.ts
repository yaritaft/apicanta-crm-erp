import test from "node:test";
import assert from "node:assert/strict";
import { PAGINA, crearAlmacen, type ClienteChequeos, type Consulta, type Disco, type ErrorDb } from "@/lib/chequeos-almacen";
import type { Chequeos } from "@/lib/finanzas-pasos";

/* El almacén de lo que se tilda en Finanzas, con una base de mentira: lo que se guarda se ve al instante y se confirma;
   lo que la base rechaza se desanota y se avisa; sin la tabla queda en el navegador; y las respuestas viejas no pisan lo nuevo. */

type Fila = { clave: string; por: string | null; en: string; nota: string | null; estado: string | null };
interface Opciones { fallaUpsert?: ErrorDb; fallaDelete?: ErrorDb; fallaSelect?: ErrorDb; sinColumnaEstado?: boolean; retardoSelect?: number }

function baseFalsa(filasIniciales: Fila[] = [], o: Opciones = {}) {
  const tabla = new Map(filasIniciales.map((f) => [f.clave, f] as const));
  const llamadas = { select: 0, upsert: 0, delete: 0 };
  const cliente: ClienteChequeos = {
    from: () => ({
      select(columnas: string): Consulta {
        llamadas.select++;
        const filtros: ((f: Fila) => boolean)[] = [];
        const consulta: Consulta = {
          gte(col, v) { filtros.push((f) => String((f as unknown as Record<string, unknown>)[col]) >= v); return consulta; },
          like(col, patron) { const re = new RegExp("^" + patron.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === "%" ? "%" : "\\" + c)).replace(/%/g, ".*") + "$"); filtros.push((f) => re.test(String((f as unknown as Record<string, unknown>)[col]))); return consulta; },
          order() { return consulta; },
          async range(desde, hasta) {
            /* Lo que la base tenía AL SALIR el pedido: si tarda en contestar, la respuesta ya puede estar vieja. */
            const todas = [...tabla.values()].filter((f) => filtros.every((x) => x(f))).sort((a, b) => a.clave.localeCompare(b.clave));
            const respuesta = todas.slice(desde, hasta + 1).map((f) => (o.sinColumnaEstado ? { ...f, estado: undefined } : f));
            if (o.retardoSelect) await new Promise((r) => setTimeout(r, o.retardoSelect));
            if (o.fallaSelect) return { data: null, error: o.fallaSelect };
            if (o.sinColumnaEstado && columnas.includes("estado")) return { data: null, error: { code: "42703", message: "no existe la columna estado" } };
            return { data: respuesta, error: null };
          },
        };
        return consulta;
      },
      async upsert(fila) {
        llamadas.upsert++;
        if (o.fallaUpsert) return { error: o.fallaUpsert };
        if (o.sinColumnaEstado && "estado" in fila) return { error: { code: "42703", message: "no existe la columna estado" } };
        tabla.set(String(fila.clave), { clave: String(fila.clave), por: (fila.por as string) ?? null, en: String(fila.en), nota: (fila.nota as string) ?? null, estado: (fila.estado as string) ?? null });
        return { error: null };
      },
      delete: () => ({
        async eq(_c, valor) { llamadas.delete++; if (o.fallaDelete) return { error: o.fallaDelete }; tabla.delete(valor); return { error: null }; },
      }),
    }),
  };
  return { cliente, tabla, llamadas };
}

function discoFalso(inicial: Chequeos = {}) {
  let guardado: Chequeos = { ...inicial };
  const disco: Disco = { leer: () => ({ ...guardado }), escribir: (c) => { guardado = { ...c }; } };
  return { disco, ver: () => guardado };
}

const ahora = () => Date.parse("2026-10-17T15:00:00Z");
const fila = (clave: string, en = "2026-10-16T20:00:00Z", estado: string | null = "hecho"): Fila => ({ clave, por: "Aldana", en, nota: null, estado });
const c = (extra: Record<string, unknown> = {}) => ({ por: "Yari", en: "2026-10-17T14:00:00.000Z", ...extra });

test("sin nube: lo que se tilda se ve al instante, queda en el navegador y se puede deshacer", async () => {
  const { disco, ver } = discoFalso();
  const a = crearAlmacen(null, disco, ahora);
  await a.iniciar();
  let avisos = 0;
  a.suscribir(() => avisos++);
  await a.marcar("eod|2026-10-17|d-slack", c({ estado: "hecho" }));
  assert.equal(a.obtener().chequeos["eod|2026-10-17|d-slack"].estado, "hecho");
  assert.ok(ver()["eod|2026-10-17|d-slack"], "queda en el navegador");
  assert.ok(avisos >= 1, "avisa a quien mira");
  assert.equal(a.obtener().cargando, false);
  /* Otra copia que arranca después lo encuentra. */
  const b = crearAlmacen(null, disco, ahora);
  await b.iniciar();
  assert.ok(b.obtener().chequeos["eod|2026-10-17|d-slack"]);
  await a.desmarcar("eod|2026-10-17|d-slack");
  assert.deepEqual(a.obtener().chequeos, {});
  assert.deepEqual(ver(), {});
  /* Otra pestaña cambió el navegador: se entera. */
  const otra = discoFalso({ "mes|2026-10|m-profit": c() });
  const e = crearAlmacen(null, otra.disco, ahora);
  await e.iniciar();
  otra.disco.escribir({ "mes|2026-10|m-profit": c(), "mes|2026-10|m-reporte": c() });
  e.alCambiarElDisco();
  assert.equal(Object.keys(e.obtener().chequeos).length, 2);
});

test("con la base: tilda al instante, se confirma, y lo que otro tildó llega al pedir", async () => {
  const { cliente, tabla } = baseFalsa([fila("eod|2026-10-16|d-banco")]);
  const { disco, ver } = discoFalso();
  const a = crearAlmacen(cliente, disco, ahora);
  assert.equal(a.obtener().cargando, true, "al arrancar todavía no sabe nada");
  await a.iniciar();
  assert.equal(a.obtener().cargando, false);
  assert.ok(a.obtener().chequeos["eod|2026-10-16|d-banco"], "trae lo que ya había");
  const guardando = a.marcar("eod|2026-10-17|d-slack", c({ estado: "no-llegue", nota: "esperaba a Ventas" }));
  assert.equal(a.obtener().chequeos["eod|2026-10-17|d-slack"].estado, "no-llegue", "se ve antes de que la base conteste");
  await guardando;
  assert.equal(tabla.get("eod|2026-10-17|d-slack")?.nota, "esperaba a Ventas");
  assert.equal(a.obtener().chequeos["eod|2026-10-17|d-slack"].nota, "esperaba a Ventas");
  assert.deepEqual(ver(), {}, "con la tabla no se usa el navegador");
  tabla.set("eod|2026-10-17|d-caja", fila("eod|2026-10-17|d-caja"));            // lo tildó otra persona
  await a.traer();
  assert.ok(a.obtener().chequeos["eod|2026-10-17|d-caja"]);
  await a.desmarcar("eod|2026-10-17|d-slack");
  assert.equal(tabla.has("eod|2026-10-17|d-slack"), false);
  assert.equal(a.obtener().chequeos["eod|2026-10-17|d-slack"], undefined);
});

test("la base rechaza el cambio (sin permiso para editar Finanzas): se desanota, se avisa, y no queda en ningún lado", async () => {
  const { cliente, tabla } = baseFalsa([], { fallaUpsert: { code: "42501", message: "new row violates row-level security policy" } });
  const { disco, ver } = discoFalso();
  const a = crearAlmacen(cliente, disco, ahora);
  await a.iniciar();
  const p = a.marcar("eod|2026-10-17|d-slack", c({ estado: "hecho" }));
  assert.ok(a.obtener().chequeos["eod|2026-10-17|d-slack"], "mientras espera, se ve");
  await p;
  assert.equal(a.obtener().chequeos["eod|2026-10-17|d-slack"], undefined, "rechazado: no queda tildado");
  assert.match(a.obtener().error ?? "", /no puede editar Finanzas/);
  assert.equal(tabla.size, 0);
  assert.deepEqual(ver(), {});
  a.limpiarError();
  assert.equal(a.obtener().error, null);
  /* Un error de otra clase dice qué pasó. */
  const b = baseFalsa([fila("mes|2026-10|m-profit")], { fallaDelete: { code: "08006", message: "connection failure" } });
  const x = crearAlmacen(b.cliente, discoFalso().disco, ahora);
  await x.iniciar();
  await x.desmarcar("mes|2026-10|m-profit");
  assert.ok(x.obtener().chequeos["mes|2026-10|m-profit"], "no se pudo borrar: sigue tildado");
  assert.match(x.obtener().error ?? "", /connection failure/);
});

test("pide por páginas: más de mil respuestas llegan todas, y los pasos del mes viejos también", async () => {
  const filas: Fila[] = [];
  for (let d = 0; d < 80; d++) for (let t = 0; t < 19; t++) filas.push(fila(`eod|${new Date(Date.parse("2026-07-30T12:00:00Z") + d * 86400000).toISOString().slice(0, 10)}|t${t}`, new Date(Date.parse("2026-07-30T12:00:00Z") + d * 86400000).toISOString()));
  assert.ok(filas.length > PAGINA, "el caso tiene que pasar de una página");
  filas.push(fila("mes|2025-03|m-reporte", "2025-04-01T12:00:00Z"));            // un mes de hace más de 120 días
  filas.push(fila("eod|2025-03-01|d-slack", "2025-03-01T12:00:00Z"));          // un cierre del día de hace más de 120 días: no hace falta
  const { cliente, llamadas } = baseFalsa(filas);
  const a = crearAlmacen(cliente, discoFalso().disco, ahora);
  await a.iniciar();
  const claves = Object.keys(a.obtener().chequeos);
  assert.equal(claves.filter((k) => k.startsWith("eod|2026")).length, 80 * 19, "no se pierde ninguna por el tope de la base");
  assert.ok(claves.includes("mes|2025-03|m-reporte"), "un paso del mes viejo sigue tildado");
  assert.ok(!claves.includes("eod|2025-03-01|d-slack"));
  assert.ok(llamadas.select >= 3);
});

test("a la base le falta la columna «estado»: se reintenta sin ella y lo tildado queda guardado", async () => {
  const { cliente, tabla } = baseFalsa([], { sinColumnaEstado: true });
  const a = crearAlmacen(cliente, discoFalso().disco, ahora);
  await a.iniciar();
  await a.marcar("mes|2026-10|m-software", c());
  assert.ok(tabla.has("mes|2026-10|m-software"));
  assert.ok(a.obtener().chequeos["mes|2026-10|m-software"]);
  assert.equal(a.obtener().error, null);
});

test("a la base le falta la tabla: se sigue en el navegador, sin avisar de error", async () => {
  const { cliente } = baseFalsa([], { fallaSelect: { code: "PGRST205", message: "tabla no encontrada" } });
  const { disco, ver } = discoFalso({ "mes|2026-10|m-profit": c() });
  const a = crearAlmacen(cliente, disco, ahora);
  await a.iniciar();
  assert.ok(a.obtener().chequeos["mes|2026-10|m-profit"], "lo que había en el navegador sigue");
  assert.equal(a.obtener().cargando, false);
  await a.marcar("eod|2026-10-17|d-slack", c({ estado: "hecho" }));
  assert.ok(ver()["eod|2026-10-17|d-slack"]);
  assert.equal(a.obtener().error, null);
});

test("una respuesta lenta que ya está vieja no pisa lo que se tildó mientras tanto", async () => {
  const { cliente, tabla } = baseFalsa([fila("eod|2026-10-16|d-banco")], { retardoSelect: 30 });
  const a = crearAlmacen(cliente, discoFalso().disco, ahora);
  const cargando = a.iniciar();                                        // el pedido sale con la base de antes…
  await new Promise((r) => setTimeout(r, 5));
  await a.marcar("eod|2026-10-17|d-slack", c({ estado: "hecho" }));    // …y se tilda antes de que conteste
  await cargando;
  assert.ok(a.obtener().chequeos["eod|2026-10-17|d-slack"], "lo recién tildado no desaparece");
  assert.ok(a.obtener().chequeos["eod|2026-10-16|d-banco"]);
  assert.ok(tabla.has("eod|2026-10-17|d-slack"));
});

test("dos pantallas que arrancan a la vez comparten el mismo pedido", async () => {
  const { cliente, llamadas } = baseFalsa([fila("eod|2026-10-16|d-banco")]);
  const a = crearAlmacen(cliente, discoFalso().disco, ahora);
  await Promise.all([a.iniciar(), a.iniciar(), a.iniciar()]);
  assert.equal(llamadas.select, 2, "una ronda (el día y los pasos del mes), no tres");
});
