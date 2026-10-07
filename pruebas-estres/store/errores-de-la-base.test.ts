/* Estrés del almacén, frente 4: cómo distingue el store los errores de la base.

   tablaFaltante() decide si una tabla opcional «todavía no existe» (y entonces se saltea). Un error de PostgREST por una COLUMNA que falta
   (PGRST204: «Could not find the 'x' column of 'y' in the schema cache») o de Postgres (42703: «column "x" of relation "y" does not exist»)
   tiene que tratarse distinto: la tabla está, falta una columna, y lo que corresponde es guardar el resto de la fila (columnaFaltante en store.ts).
   Pruebas puras de la función y, contra la nube falsa, lo que pasa con una tabla opcional a la que le falta una columna. */
import test from "node:test";
import assert from "node:assert/strict";
import { BaseFalsa, esperarCola, instalar } from "./_nube";
import { conDemo, estadoDe, yEsperar } from "./_escenas";
import { tablaFaltante, TABLAS_OPCIONALES } from "@/lib/supabase";
import type { E } from "./_acciones";

const base = new BaseFalsa();
instalar(base);

test("tablaFaltante: la tabla que no está en el esquema, sí", () => {
  assert.equal(tablaFaltante({ code: "PGRST205", message: "Could not find the table 'public.devoluciones' in the schema cache" }), true);
  assert.equal(tablaFaltante({ code: "42P01", message: 'relation "public.devoluciones" does not exist' }), true);
  assert.equal(tablaFaltante({ message: "Could not find the table 'public.arqueos' in the schema cache" }), true);
  assert.equal(tablaFaltante(null), false);
});

test("tablaFaltante: los errores que no son de tabla, no", () => {
  for (const e of [
    { code: "42501", message: 'new row violates row-level security policy for table "pagos"' },
    { code: "23503", message: "insert or update on table violates foreign key constraint" },
    { code: "23505", message: "duplicate key value violates unique constraint" },
    { code: "22P02", message: 'invalid input syntax for type integer: "2.5"' },
    { code: "XX000", message: "se cayó" },
    { message: "TypeError: fetch failed" },
  ]) assert.equal(tablaFaltante(e), false, JSON.stringify(e));
});

test("tablaFaltante: una COLUMNA que falta no es una tabla que falta", { todo: true }, () => {
  /* BUG: tablaFaltante() cierra con /schema cache|does not exist/i, que también calza con el mensaje de PGRST204
     («Could not find the 'x' column of 'y' in the schema cache») y con el de 42703 («column "x" … does not exist»). */
  assert.equal(tablaFaltante({ code: "PGRST204", message: "Could not find the 'referencia' column of 'devoluciones' in the schema cache" }), false);
  assert.equal(tablaFaltante({ code: "42703", message: 'column "referencia" of relation "devoluciones" does not exist' }), false);
});

test("una columna que falta en una tabla OPCIONAL que sí existe: se guarda el resto de la fila (como en una tabla obligatoria)", { todo: true }, async () => {
  /* BUG: en drenar() el chequeo de «tabla opcional que falta» va antes que el de «columna que falta»: como tablaFaltante() también calza con PGRST204,
     toda la operación se descarta (la fila no se guarda), la tabla queda marcada como «sin crear» (la pantalla dice «corré supabase/devoluciones.sql»,
     que ya está corrido) y el estado de sincronización dice «listo». Afecta a las 17 tablas de TABLAS_OPCIONALES: contactos, movimientos, devoluciones,
     gastos_recurrentes, seguimiento_alumnos, testimonios… en la ventana entre desplegar una versión con una columna nueva y correr su ALTER. */
  const S = await conDemo(base);
  const venta = estadoDe(S).ventas.find((v: E) => v.estado === "activa");
  assert.ok(TABLAS_OPCIONALES.has("devoluciones"));
  base.columnasFaltantes.set("devoluciones", new Set(["referencia"]));
  const aviso = console.warn;
  console.warn = () => {};
  try {
    await yEsperar(S, () => { S.acciones.registrarDevolucion({ ventaId: venta.id, monto: 10, fecha: "2026-10-05T12:00:00.000Z", referencia: "stripe:re_1", proveedor: "stripe" } as never); });
  } finally { console.warn = aviso; }
  assert.ok(!S.tablaSinCrear("devoluciones"), "la tabla existe: no tendría que quedar marcada como sin crear");
  assert.equal(base.tabla("devoluciones").size, 1, "la devolución se perdió en silencio (el estado de sincronización dice «listo»)");
});

test("lo mismo con una tabla obligatoria: la fila se guarda sin la columna (regresión de lo que sí anda)", async () => {
  const S = await conDemo(base);
  const venta = estadoDe(S).ventas[0];
  base.columnasFaltantes.set("ventas", new Set(["ingresoComunidad"]));
  const aviso = console.warn;
  console.warn = () => {};
  try { await yEsperar(S, () => S.acciones.actualizar("ventas", venta.id, { ingresoComunidad: "Si", notas: "se guarda" } as never, "x")); }
  finally { console.warn = aviso; }
  assert.equal(base.tabla("ventas").get(venta.id)!.notas, "se guarda");
  assert.equal(S.estadoSync(), "listo");
  await esperarCola(S.estadoSync);
});
