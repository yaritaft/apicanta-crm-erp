/* Intento de REFUTAR el hallazgo «un closer se queda con la venta de otro con una cuota "heredada" propia».
   Se arma a mano (sin pasar por sql-escalamientos.test.ts) y se imprime cada paso. Sólo PGlite en memoria. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import {
  ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, altaDePersonas, armarBanco, cargarPglite, sqlDe, type Banco,
} from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco";

const SEMBRAR = `
  insert into public.contactos (id, nombre) values ('ctD', 'Cliente de Dante'), ('ctO', 'Cliente de Otro');
  insert into public.leads (id, responsable, "contactoId", nombre) values ('leadD', 'Dante Closer', 'ctD', 'D'), ('leadO', 'Otro Closer', 'ctO', 'O');
  insert into public.sesiones (id, anfitrion, "leadId", "contactoId") values ('sD', 'Dante Closer', 'leadD', 'ctD'), ('sO', 'Otro Closer', 'leadO', 'ctO');
  insert into public.ventas (id, "closerId", "contactoId", "sesionId", monto) values ('vD', 'm_dante', 'leadD', 'sD', 1000), ('vO', 'm_otro', 'leadO', 'sO', 5000);
  insert into public.cuotas (id, "ventaId") values ('cD', 'vD'), ('cO', 'vO');
  insert into public.pagos (id, "cuotaId", monto, comprobante) values ('pD', 'cD', 1000, '{"ruta":"d"}'), ('pO', 'cO', 5000, '{"ruta":"secreto-de-otro"}');
  insert into public.devoluciones (id, "ventaId", monto) values ('dO', 'vO', 200);`;

/** Un banco armado a mano: esquema mínimo + tipos-cuenta.sql (opcionalmente parchado en memoria) + los demás archivos, sin tocar el disco. */
async function banco(archivos: string[], parche?: (sql: string) => string): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  const base = sqlDe("tipos-cuenta.sql");
  const final = parche ? parche(base) : base;
  if (parche) assert.notEqual(final, base, "el parche no cambió nada");
  await db.exec(final);
  await db.exec(PERMISOS_DE_ENSAYO);
  for (const a of archivos) await db.exec(sqlDe(a));
  await db.exec(PERMISOS_DE_ENSAYO);
  await altaDePersonas(db);
  const b = armarBanco(db);
  await b.ejecutar(SEMBRAR);
  return b;
}

const n = async (b: Banco, email: string, tabla: string, donde: string): Promise<number> => {
  const r = await b.intentar<{ n: number }>(email, `select count(*)::int n from public.${tabla} where ${donde}`);
  assert.ok(r.ok);
  return r.ok ? r.rows[0].n : -1;
};
const vista = async (b: Banco, email: string) => ({
  ventaO: await n(b, email, "ventas", "id = 'vO'"),
  cuotaO: await n(b, email, "cuotas", "id = 'cO'"),
  pagoO: await n(b, email, "pagos", "id = 'pO'"),
  devO: await n(b, email, "devoluciones", "id = 'dO'"),
});

for (const [nombre, archivos] of [
  ["tipos-cuenta + devoluciones (la receta del hallazgo)", ["devoluciones.sql"]],
  ["todo lo que el arnés sabe montar (devoluciones, customer-success, cierre-del-dia, control-cruzado)", ["devoluciones.sql", "customer-success.sql", "cierre-del-dia.sql", "control-cruzado.sql"]],
] as const) {
  test(`REPRO V1: ${nombre}`, { skip: saltear }, async () => {
    const b = await banco([...archivos]);
    try {
      const antes = await vista(b, "dante@x.com");
      console.log("  antes del insert, Dante ve de la venta de Otro:", JSON.stringify(antes));
      assert.deepEqual(antes, { ventaO: 0, cuotaO: 0, pagoO: 0, devO: 0 }, "sin trucos no ve nada de Otro");
      const mis0 = await b.intentar<{ v: string[] }>("dante@x.com", `select public.mis_ventas() v`);
      console.log("  mis_ventas() de Dante antes:", JSON.stringify(mis0.ok ? mis0.rows[0].v : mis0));

      // El paso del hallazgo: una cuota «heredada» (closerId = yo) sobre la venta de Otro.
      const ins = await b.intentar("dante@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`);
      console.log("  insert de la cuota «heredada» por Dante:", JSON.stringify(ins));
      assert.ok(ins.ok && ins.n === 1, "la base tendría que rechazarlo (si lo acepta, el hallazgo se confirma)");

      const despues = await b.intentar<{ v: string[] }>("dante@x.com", `select public.mis_ventas() v`);
      console.log("  mis_ventas() de Dante después:", JSON.stringify(despues.ok ? despues.rows[0].v : despues));
      const v = await vista(b, "dante@x.com");
      console.log("  después del insert, Dante ve de la venta de Otro:", JSON.stringify(v));
      assert.deepEqual(v, { ventaO: 1, cuotaO: 1, pagoO: 1, devO: 1 }, "ve la venta, la cuota, el cobro y la devolución de Otro");

      // El comprobante (dato sensible) también.
      const comp = await b.intentar<{ comprobante: { ruta: string } }>("dante@x.com", `select comprobante from public.pagos where id = 'pO'`);
      console.log("  comprobante del cobro de Otro leído por Dante:", JSON.stringify(comp.ok ? comp.rows : comp));
      assert.ok(comp.ok && comp.rows[0].comprobante.ruta === "secreto-de-otro");

      // Y lo escribe: le saca el closer a Otro.
      const rob = await b.intentar("dante@x.com", `update public.ventas set "closerId" = 'm_dante' where id = 'vO'`);
      console.log("  update ventas.closerId por Dante:", JSON.stringify(rob));
      assert.ok(rob.ok && rob.n === 1);
      const [fila] = await b.servicio<{ closerId: string }>(`select "closerId" from public.ventas where id = 'vO'`);
      console.log("  ventas.closerId de vO ahora (clave de servicio):", fila.closerId);
      assert.equal(fila.closerId, "m_dante");

      // Y podría borrarla.
      const del = await b.intentar("dante@x.com", `delete from public.ventas where id = 'vO'`);
      console.log("  delete de la venta de Otro por Dante:", JSON.stringify(del));
      assert.ok(del.ok && del.n === 1);
    } finally { await b.db.close(); }
  });
}

test("REPRO V2: mover una cuota propia a la venta de otro", { skip: saltear }, async () => {
  const b = await banco(["devoluciones.sql"]);
  try {
    const mov = await b.intentar("dante@x.com", `update public.cuotas set "ventaId" = 'vO', "closerId" = 'm_dante' where id = 'cD'`);
    console.log("  update de cD por Dante:", JSON.stringify(mov));
    assert.ok(mov.ok && mov.n === 1);
    const v = await vista(b, "dante@x.com");
    console.log("  Dante ve de la venta de Otro:", JSON.stringify(v));
    assert.equal(v.ventaO, 1);
    assert.equal(v.pagoO, 1);
    assert.equal(v.devO, 1);
  } finally { await b.db.close(); }
});

test("CONTROL: otro tipo sin «Ventas editable» (setter) no puede el mismo insert", { skip: saltear }, async () => {
  const b = await banco(["devoluciones.sql"]);
  try {
    const r = await b.intentar("seti@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`);
    console.log("  insert de la cuota por un setter:", JSON.stringify(r));
    assert.ok(!r.ok && r.codigo === "42501");
  } finally { await b.db.close(); }
});

test("CONTROL de causa: con el WITH CHECK de las cuotas atado a mis_ventas() (sin «closerId = yo»), el ataque falla y lo legítimo sigue andando", { skip: saltear }, async () => {
  const cuotasViejo = `('cuotas',      '("closerId" = (select public.mi_miembro_id()) or "ventaId" = any((select public.mis_ventas())::text[]))',
                    '("closerId" = (select public.mi_miembro_id()) or "ventaId" = any((select public.mis_ventas())::text[]))'),`;
  const cuotasNuevo = `('cuotas',      '("closerId" = (select public.mi_miembro_id()) or "ventaId" = any((select public.mis_ventas())::text[]))',
                    '("ventaId" = any((select public.mis_ventas())::text[]))'),`;
  const b = await banco(["devoluciones.sql"], (sql) => sql.replace(cuotasViejo, cuotasNuevo));
  try {
    const ins = await b.intentar("dante@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_dante')`);
    console.log("  [parchado] insert del ataque V1:", JSON.stringify(ins));
    assert.ok(!ins.ok && ins.codigo === "42501");
    const mov = await b.intentar("dante@x.com", `update public.cuotas set "ventaId" = 'vO', "closerId" = 'm_dante' where id = 'cD'`);
    console.log("  [parchado] update del ataque V2:", JSON.stringify(mov));
    assert.ok(!mov.ok && mov.codigo === "42501");
    assert.deepEqual(await vista(b, "dante@x.com"), { ventaO: 0, cuotaO: 0, pagoO: 0, devO: 0 });
    // Lo legítimo: cargar una cuota nueva en una venta propia.
    const ok = await b.intentar("dante@x.com", `insert into public.cuotas (id, "ventaId") values ('cD2', 'vD')`);
    console.log("  [parchado] cuota nueva en una venta propia:", JSON.stringify(ok));
    assert.ok(ok.ok && ok.n === 1);
    // Y el dueño sigue pudiendo pasar una cuota (la herencia de verdad).
    const her = await b.intentar("yari@x.com", `update public.cuotas set "closerId" = 'm_dante' where id = 'cO'`);
    console.log("  [parchado] el dueño pasa la cuota cO a Dante:", JSON.stringify(her));
    assert.ok(her.ok && her.n === 1);
    const v = await vista(b, "dante@x.com");
    console.log("  [parchado] tras la herencia legítima Dante ve:", JSON.stringify(v));
    assert.equal(v.ventaO, 1);
  } finally { await b.db.close(); }
});

after(() => undefined);
