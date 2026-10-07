import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/* ==================================================================
   Los arreglos chicos del SQL que salieron del estrés (07/10), controlados
   como texto: no hace falta una base para ver que la cadena del translate()
   tiene el mismo largo, que honorarios.sql no vuelve a pisar los tipos de
   cuenta y que un cobro no se ata a un movimiento inventado.
   ================================================================== */

const sql = (ruta: string) => readFileSync(new URL(`../supabase/${ruta}`, import.meta.url), "utf8");

test("nombre_corto(): las dos cadenas del translate() tienen el mismo largo (la «ñ» no sale «u»)", () => {
  for (const archivo of ["tipos-cuenta.sql", "nombre-corto.sql"]) {
    const t = sql(archivo);
    const m = /translate\(coalesce\(t, ''\),\s*'([^']+)',\s*'([^']+)'\)/.exec(t);
    assert.ok(m, `${archivo}: no encontré el translate`);
    assert.equal([...m![1]].length, [...m![2]].length, `${archivo}: ${[...m![1]].length} contra ${[...m![2]].length}`);
    assert.equal([...m![1]].length, 48);
  }
});

test("honorarios.sql no vuelve a pasar a todos a «equipo» ni a poner el CHECK viejo si ya existen los tipos de cuenta", () => {
  const t = sql("honorarios.sql");
  assert.match(t, /to_regclass\('public\.tipos_cuenta'\) is null/);
  const sinComentarios = t.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  for (const peligro of [/update public\.usuarios_permitidos set rol = 'equipo'/, /add constraint usuarios_permitidos_rol_ck/]) {
    const i = sinComentarios.search(peligro);
    assert.ok(i >= 0, String(peligro));
    const antes = sinComentarios.slice(Math.max(0, i - 200), i);
    assert.match(antes, /to_regclass\('public\.tipos_cuenta'\) is null/, `${peligro} tiene que estar condicionado`);
  }
});

test("control-cruzado.sql: quien no es director ni finanzas no ata ni desata un cobro a un movimiento", () => {
  const t = sql("control-cruzado.sql");
  assert.match(t, /new\."movimientoId" := null;/);
  assert.match(t, /new\."movimientoId" := old\."movimientoId";/);
});
