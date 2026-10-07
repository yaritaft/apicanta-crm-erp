/* Estrés del almacén, frente 1 y 3 contra la nube: sembrar, restaurar un respaldo y volver a cargar.

   Propiedades (con semilla; si algo falla, el mensaje dice cuál):
   - sembrar la demo en la nube y volver a cargarla de ahí es la identidad (cada tabla de TABLAS se siembra y se carga);
   - restaurar un respaldo (exportar → importar) deja en la base EXACTAMENTE lo del respaldo, y recargar da lo mismo,
     para estados al azar con datos raros;
   - restaurar sobre una base con otros datos no deja restos (vaciarNube vacía todo lo que la siembra vuelve a escribir);
   - lo que queda a medio hacer cuando la base rechaza algo en el medio. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, esperarHasta, instalar } from "./_nube";
import { conDemo, estadoDe, recargado } from "./_escenas";
import { storeNuevo } from "./_fresco";
import { compararTodo, canonico, claveDe, describir } from "./_modelo";
import { estadoAzar } from "./_estado-azar";
import { valorPorDefecto } from "./_sql";
import { TABLAS } from "@/lib/supabase";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

/* Lo que el respaldo y la siembra cubren: todo menos Meta (se trae sincronizando) y los tipos de cuenta (los crea el SQL). */
const SEMBRADAS = TABLAS.filter((t) => !["campaigns", "adsets", "ads", "ad_insights", "tipos_cuenta"].includes(t));

/** Compara memoria contra lo recargado, tabla por tabla (como conjuntos de filas por id; el orden lo decide la base).
 *  Un campo que la memoria no tiene y que la base devuelve con el valor por defecto de su columna es lo mismo. */
function diferenciasDeRecarga(memoria: E, recarga: E): string[] {
  const salida: string[] = [];
  for (const tabla of SEMBRADAS) {
    const k = claveDe(tabla);
    const m = new Map<string, Record<string, unknown>>(((memoria[k] ?? []) as { id: string }[]).map((f) => [String(f.id), (canonico(f) ?? {}) as Record<string, unknown>]));
    const r = new Map<string, Record<string, unknown>>(((recarga[k] ?? []) as { id: string }[]).map((f) => [String(f.id), (canonico(f) ?? {}) as Record<string, unknown>]));
    for (const [id, a] of m) {
      const b = r.get(id);
      if (!b) { salida.push(`${tabla}[${id}]: se perdió al recargar`); continue; }
      for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
        if (JSON.stringify(a[c]) === JSON.stringify(b[c])) continue;
        if (a[c] === undefined && esDefault(tabla, c, b[c])) continue;
        salida.push(`${tabla}[${id}].${c}: ${JSON.stringify(a[c])?.slice(0, 50)} → ${JSON.stringify(b[c])?.slice(0, 50)} al recargar`);
      }
    }
    if (tabla !== "actividad") for (const id of r.keys()) if (!m.has(id)) salida.push(`${tabla}[${id}]: apareció al recargar`);
  }
  const a = (canonico(memoria.ajustes) ?? {}) as Record<string, unknown>, b = (canonico(recarga.ajustes) ?? {}) as Record<string, unknown>;
  for (const c of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (JSON.stringify(a[c]) !== JSON.stringify(b[c]) && !(a[c] === undefined && esDefault("ajustes", c, b[c]))) salida.push(`ajustes.${c}: cambió al recargar`);
  }
  /* Y ninguna colección puede llegar sin ser lista. */
  for (const tabla of TABLAS) if (!Array.isArray(recarga[claveDe(tabla)])) salida.push(`${claveDe(tabla)} no es una lista al recargar`);
  return salida;
}

function esDefault(tabla: string, columna: string, valor: unknown): boolean {
  const col = base.esquema.tablas.get(tabla)?.columnas.get(columna);
  if (!col) return false;
  const d = valorPorDefecto(col);
  return d !== undefined && JSON.stringify(canonico(d)) === JSON.stringify(valor);
}

test("sembrar la demo en la nube y volver a cargarla es la identidad, tabla por tabla", async () => {
  const S = await conDemo(base);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.deepEqual(diferenciasDeRecarga(estadoDe(S), await recargado()), []);
  /* Cada tabla sembrada tiene filas en la base (si no, el chequeo de arriba no probaría nada). */
  const vacias = SEMBRADAS.filter((t) => base.tabla(t).size === 0);
  assert.deepEqual(vacias.sort(), ["arqueos", "campos", "comentarios", "devoluciones", "gastos_recurrentes", "honorarios", "liquidaciones", "seguimiento_alumnos", "testimonios", "traspasos"].sort(),
    "la demo no tiene datos de estas tablas: se prueban con el estado al azar de abajo");
});

for (const semilla of [101, 202, 303, 404]) {
  test(`restaurar un respaldo al azar (semilla ${semilla}): la base queda con lo del respaldo y recargar da lo mismo`, async () => {
    const S = await conDemo(base);
    const respaldo = estadoAzar(semilla, estadoDe(S));
    /* Con otros datos en la base: no tiene que quedar ninguno (la base de la demo está sembrada). */
    assert.ok(S.acciones.importar(JSON.stringify(respaldo)), "importar rechazó el respaldo");
    await esperarCola(S.estadoSync);
    /* importar() sigue en segundo plano (vaciarNube + sembrarNube): se espera a que la base quede quieta. */
    await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
    assert.equal(S.estadoSync(), "listo", `semilla ${semilla}: ${S.errorSync()}`);
    const memoria = estadoDe(S);
    const dif = compararTodo(base, memoria, SEMBRADAS).map(describir);
    assert.deepEqual(dif, [], `semilla ${semilla}: lo que quedó en la base no es lo del respaldo`);
    assert.deepEqual(diferenciasDeRecarga(memoria, await recargado()), [], `semilla ${semilla}`);
  });
}

test("vaciar todo deja las tablas de catálogo y vacías las demás, y se puede volver a cargar", async () => {
  const S = await conDemo(base);
  await S.acciones.vaciarTodo();
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  const memoria = estadoDe(S);
  assert.deepEqual(compararTodo(base, memoria, SEMBRADAS).map(describir), []);
  for (const t of ["ventas", "cuotas", "pagos", "leads", "contactos", "sesiones", "alumnos", "gastos", "movimientos", "devoluciones"]) {
    assert.equal(base.tabla(t).size, 0, `${t} no quedó vacía`);
  }
  assert.ok(base.tabla("etapas").size > 0 && base.tabla("productos").size > 0 && base.tabla("equipo").size > 0, "los catálogos quedan");
  assert.deepEqual(diferenciasDeRecarga(memoria, await recargado()), []);
});

test("completar una base ya cargada (cargarDeLaNube) sólo rellena catálogos vacíos y no toca lo transaccional", async () => {
  const S = await conDemo(base);
  /* Una versión anterior del modelo: la tabla de etapas del servicio nació después y está vacía. */
  base.tabla("etapas_servicio").clear();
  const ventasAntes = base.tabla("ventas").size;
  base.tabla("ventas").clear();   // una base «de verdad» sin ventas todavía: no se le inventan
  void ventasAntes;
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.equal(R.estadoSync(), "listo", R.errorSync());
  assert.ok(base.tabla("etapas_servicio").size > 0, "el catálogo vacío se completó");
  assert.equal(base.tabla("ventas").size, 0, "lo transaccional no se completa con la demo");
  assert.ok(estadoDe(R).etapasServicio.length > 0);
  void S;
});

test("una base nueva (sin etapas) se siembra con lo que haya en el navegador", async () => {
  base.vaciar();
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.equal(R.estadoSync(), "listo", R.errorSync());
  assert.ok(base.tabla("etapas").size > 0 && base.tabla("ajustes").size === 1, "se sembró lo básico");
  assert.deepEqual(diferenciasDeRecarga(estadoDe(R), await recargado()), []);
});

test("sin permiso de entrada (puede_entrar = false) no se siembra nada ni se pisa la base", async () => {
  base.vaciar();
  base.puedeEntrar = false;
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.equal(R.estadoSync(), "error");
  assert.match(R.errorSync(), /no tiene acceso/i);
  assert.equal(base.peticiones("upsert").length, 0, "no escribió nada");
  base.puedeEntrar = true;
});

test("un usuario que no es dueño no siembra una base vacía (una tabla vacía puede ser algo que no le toca ver)", async () => {
  base.vaciar();
  base.esDueno = false;
  const R = await storeNuevo();
  await R.cargarDeLaNube();
  assert.equal(base.peticiones("upsert").length, 0, "no escribió nada");
  base.esDueno = true;
});

/* ---------- Lo que falla ---------- */

/* BUG: sembrarNube() no tolera PGRST204 (drenar() sí) y vaciarNube() ya borró todo (el detalle está dentro de la prueba) */
test("restaurar con una columna que la base todavía no tiene no deja la base vaciada a la mitad", { todo: true }, async () => {
  /* BUG: la cola (drenar) saca la columna que falta y sigue, y su comentario lo justifica con «la ventana entre que se despliega un
     modelo nuevo y se corre su ALTER». Pero «Volver a los datos de ejemplo», «Vaciar todo» y «Restaurar desde archivo» hacen
     vaciarNube() y después sembrarNube(), que sólo tolera tabla opcional que falta y tabla de dueños sin permiso: ante una columna
     que falta (PGRST204) lanza y deja lo que sigue SIN sembrar, con lo anterior ya borrado. */
  const S = await conDemo(base);
  const antes = { pagos: base.tabla("pagos").size, ventas: base.tabla("ventas").size };
  assert.ok(antes.pagos > 0 && antes.ventas > 0);
  /* Un respaldo con un cobro ya chequeado (control cruzado) restaurado en una base a la que todavía no le corrieron control-cruzado.sql. */
  const respaldo = estadoDe(S);
  respaldo.pagos[0].chequeoDirector = "chequeado";
  base.columnasFaltantes.set("pagos", new Set(["chequeoDirector"]));
  S.acciones.importar(JSON.stringify(respaldo));
  await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
  const hoy = { pagos: base.tabla("pagos").size, ventas: base.tabla("ventas").size };
  /* O quedó completa o quedó como estaba: lo que no puede pasar es una base vaciada a medias. */
  const completa = hoy.pagos === antes.pagos && hoy.ventas === antes.ventas;
  assert.ok(completa, `la base quedó a medias: pagos ${hoy.pagos} (antes ${antes.pagos}), ventas ${hoy.ventas} (antes ${antes.ventas}); estado «${S.estadoSync()}: ${S.errorSync()}»`);
});

/* BUG: vaciarNube() borra webinars y sesiones, y las tablas del servidor que cuelgan de ellos con ON DELETE CASCADE / SET NULL pierden su dato (el detalle está dentro de la prueba). */
test("restaurar un respaldo (o «Volver a los datos de ejemplo») no se lleva por delante lo que el servidor guarda colgado de webinars y sesiones", { todo: true }, async () => {
  /* BUG: vaciarNube() borra todos los webinars y todas las sesiones y los vuelve a sembrar con los mismos ids. Pero tres tablas que escribe el servidor
     (no están en el respaldo) apuntan a ellos con clave foránea:
       · whatsapp_contactados.webinarId → webinars  ON DELETE CASCADE   (las marcas «Contactado» se borran),
       · whatsapp_grupos.webinarId      → webinars  ON DELETE SET NULL  (se pierde a qué webinar corresponde cada grupo),
       · grabaciones.sesionId           → sesiones  ON DELETE SET NULL  (Fathom: la grabación deja de estar atada a su llamada).
     Al volver a sembrar, esas filas no se recuperan porque el respaldo no las lleva. */
  const S = await conDemo(base);
  const e = estadoDe(S);
  const webinar = e.webinars[0].id, sesion = e.sesiones[0].id;
  base.poner("whatsapp_grupos", [{ id: "g1", nombre: "Grupo 1", webinarId: webinar }]);
  base.poner("whatsapp_contactados", [{ id: "w:p", webinarId: webinar, personaId: "p1", por: "yari@ejemplo.test" }]);
  base.poner("grabaciones", [{ id: "gr1", fuente: "fathom", recordingId: "r1", sesionId: sesion, titulo: "Llamada" }]);
  S.acciones.importar(S.acciones.exportar());
  await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
  assert.equal(S.estadoSync(), "listo", S.errorSync());
  assert.equal(base.tabla("whatsapp_grupos").get("g1")?.webinarId, webinar, "el grupo perdió su webinar");
  assert.equal(base.tabla("whatsapp_contactados").size, 1, "las marcas «Contactado» se borraron en cascada");
  assert.equal(base.tabla("grabaciones").get("gr1")?.sesionId, sesion, "la grabación perdió su llamada");
});

/* BUG: restaurar un respaldo con una tabla OPCIONAL a la que le falta una columna la deja vacía en silencio (el detalle está dentro de la prueba). */
test("restaurar un respaldo con una columna que falta en una tabla opcional que sí existe: no pierde esa tabla en silencio", { todo: true }, async () => {
  /* BUG: sembrarNube() saltea la tabla opcional cuando tablaFaltante(error) es true, y tablaFaltante() también calza con PGRST204 (columna que falta).
     Resultado: las devoluciones del respaldo no se restauran, no hay ningún error y el estado dice «listo». (Con una tabla obligatoria el mismo caso
     corta la siembra a la mitad: ver la prueba de pagos.chequeoDirector.) */
  const S = await conDemo(base);
  const venta = estadoDe(S).ventas.find((v: E) => v.estado === "activa");
  S.acciones.registrarDevolucion({ ventaId: venta.id, monto: 10, fecha: "2026-10-05T12:00:00.000Z", referencia: "stripe:re_1", proveedor: "stripe" } as never);
  await esperarCola(S.estadoSync);
  assert.equal(base.tabla("devoluciones").size, 1);
  base.columnasFaltantes.set("devoluciones", new Set(["referencia"]));
  S.acciones.importar(S.acciones.exportar());
  await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
  assert.equal(base.tabla("devoluciones").size, 1, `la devolución no se restauró; estado «${S.estadoSync()}» ${S.errorSync()}`);
});

/* BUG: eliminar() borra la fila en memoria y en la base, pero la base además BORRA EN CASCADA o DEJA EN NULL lo que la apuntaba
   (customer-success.sql: on delete cascade; contactos.sql / cuotas-closer.sql: on delete set null). El estado en memoria conserva esas
   referencias colgando. El respaldo que se baja en esa sesión las lleva, y al restaurarlo sembrarNube() choca con la clave foránea
   (23503), se corta a la mitad y deja la base ya vaciada. Al recargar la página la memoria vuelve a ser la de la base: sólo pasa en la
   sesión que borró (o con el archivo que se bajó en esa sesión). */
const COLGANTES: { padre: string; hijo: string; como: string; preparar: (S: Awaited<ReturnType<typeof conDemo>>, e: E) => void; idPadre: (e: E) => string }[] = [
  {
    padre: "webinars", hijo: "contactos.origenWebinarId", como: "borrar un webinar",
    preparar: () => {}, idPadre: (e) => e.contactos.find((c: E) => c.origenWebinarId).origenWebinarId,
  },
  {
    padre: "equipo", hijo: "cuotas.closerId", como: "borrar a alguien del equipo al que se le pasaron cuotas",
    preparar: (S, e) => { S.acciones.reasignarCuotas([e.cuotas[0].id], e.equipo.find((m: E) => m.rol === "closer").id, "x"); }, idPadre: (e) => e.cuotas.find((c: E) => c.closerId).closerId,
  },
  {
    padre: "alumnos", hijo: "seguimiento_alumnos.alumnoId", como: "borrar un alumno con seguimiento",
    preparar: (S, e) => { S.acciones.guardarSeguimiento(e.alumnos[0].id, (s) => ({ ...s, notas: "algo" }), () => "x"); }, idPadre: (e) => e.seguimientos[0].alumnoId,
  },
  {
    padre: "alumnos", hijo: "testimonios.alumnoId", como: "borrar un alumno con testimonios",
    preparar: (S, e) => { S.acciones.guardarTestimonio({ id: "tes_1", alumnoId: e.alumnos[0].id, estado: "pedido", link: "", fecha: null, notas: "", creadoEn: "2026-10-07T00:00:00.000Z" }); }, idPadre: (e) => e.testimonios[0].alumnoId,
  },
];
for (const c of COLGANTES) {
  /* BUG: eliminar() deja en memoria referencias que la base ya resolvió en cascada o con set null (el detalle está dentro de la prueba) */
  test(`${c.como}, bajar el respaldo y restaurarlo en la misma sesión: la siembra no se corta (${c.hijo})`, { todo: true }, async () => {
    const S = await conDemo(base);
    c.preparar(S, estadoDe(S));
    await esperarCola(S.estadoSync);
    S.acciones.eliminar(c.padre as never, c.idPadre(estadoDe(S)), "x");
    await esperarCola(S.estadoSync);
    const respaldo = S.acciones.exportar();
    const antes = base.tabla("pagos").size;
    S.acciones.importar(respaldo);
    await esperarHasta(() => S.estadoSync() !== "guardando", 15000);
    assert.equal(S.estadoSync(), "listo", S.errorSync());
    assert.ok(base.tabla("pagos").size > 0 && base.tabla("pagos").size <= antes, "la base quedó completa");
  });
}
