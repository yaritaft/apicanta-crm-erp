/* «Ve los leads de todos» (supabase/tipos-cuenta.sql → solo_lo_suyo_en(), supabase/closer-ve-todos-los-leads.sql), con el RLS y los triggers
   REALES en un Postgres en memoria (PGlite). Si PGlite no está en el disco, se saltean (ver pruebas/sql/arnes-pg.ts).

   Lo que se cuida (26/10: Santiago le reagenda leads de otros closers a Mariano y Mariano no los veía):
     1. un closer común sigue viendo sólo lo suyo (nada cambió para nadie hasta que un dueño lo prende);
     2. con el permiso, ve y edita los leads, las personas, las llamadas, el chat y la actividad de TODOS...
     3. ...pero sus ventas, cuotas, cobros y devoluciones siguen siendo sólo las suyas, y no se puede fabricar acceso a la venta de otro;
     4. el permiso no hace nada en un tipo sin «sólo lo suyo», ni en el de Dueño; apagarlo vuelve a lo suyo;
     5. una base que ya tenía las políticas viejas (con solo_lo_suyo() a secas) queda igual de bien después de correr el archivo del delta,
        y correrlo de nuevo no cambia nada;
     6. ninguna política de esas tablas queda con solo_lo_suyo() a secas.
   Se corre dos veces: sobre la base nueva (tipos-cuenta.sql ya lo trae) y sobre una base con las políticas viejas + el delta. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, montarBanco, sqlDe, type Banco } from "./sql/arnes-pg";

const Pg_ = await cargarPglite();
const saltear = Pg_ ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";

const TABLAS = ["leads", "contactos", "sesiones", "comentarios", "chat_lecturas"];

/** Deja las políticas como estaban antes del permiso: solo_lo_suyo() a secas (lo que tiene producción hoy). */
async function volverALasViejas(b: Banco): Promise<void> {
  await b.ejecutar(`
    do $$ declare r record; q text; w text; begin
      for r in select p.polname, c.relname, pg_get_expr(p.polqual, p.polrelid) qual, pg_get_expr(p.polwithcheck, p.polrelid) chk
               from pg_policy p join pg_class c on c.oid = p.polrelid
               where c.relnamespace = 'public'::regnamespace and c.relname in ('leads','contactos','sesiones','comentarios','chat_lecturas') loop
        q := regexp_replace(r.qual, 'solo_lo_suyo_en\\(''[a-z_]+''::text\\)', 'solo_lo_suyo()', 'g');
        w := regexp_replace(r.chk, 'solo_lo_suyo_en\\(''[a-z_]+''::text\\)', 'solo_lo_suyo()', 'g');
        if q is not null and w is not null then execute format('alter policy %I on public.%I using (%s) with check (%s)', r.polname, r.relname, q, w);
        elsif q is not null then execute format('alter policy %I on public.%I using (%s)', r.polname, r.relname, q);
        else execute format('alter policy %I on public.%I with check (%s)', r.polname, r.relname, w); end if;
      end loop;
    end $$;
    drop policy ver_actividad on public.actividad;
    create policy ver_actividad on public.actividad for select to authenticated using (
      (select public.es_dueno())
      or case entidad
        when 'lead' then (select public.ve('leads')) and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_leads())::text[]))
        when 'sesion' then (select public.ve('sesiones')) and ((select not public.solo_lo_suyo()) or "entidadId" = any((select public.mis_sesiones())::text[]))
        else false end);`);
}

async function montar(Pg: NonNullable<typeof Pg_>, viejas: boolean): Promise<Banco> {
  const b = await montarBanco(Pg, ["solo-lo-suyo-seguro.sql"]);
  if (viejas) await volverALasViejas(b);
  await b.ejecutar(sqlDe("closer-ve-todos-los-leads.sql"));
  await b.ejecutar(`
    insert into public.equipo (id, nombre, email) values
      ('m_dante', 'Dante Closer', 'dante@x.com'), ('m_otro', 'Otro Closer', 'otro@x.com'), ('m_mari', 'Mariano Todos', 'mari@x.com'),
      ('m_santi', 'Santi Director', 'santi@x.com');
    insert into public.usuarios_permitidos (email, rol) values
      ('yari@x.com', 'dueno'), ('santi@x.com', 'director'), ('dante@x.com', 'closer'), ('otro@x.com', 'closer'),
      ('mari@x.com', 'closer_ve_leads');
    insert into public.contactos (id, nombre) values ('ctD', 'Cliente de Dante'), ('ctO', 'Cliente de Otro');
    insert into public.leads (id, responsable, "contactoId", nombre) values ('leadD', 'Dante Closer', 'ctD', 'Cliente de Dante'), ('leadO', 'Otro Closer', 'ctO', 'Cliente de Otro');
    insert into public.comentarios (id, "contactoId", texto) values ('cmD', 'ctD', 'hola'), ('cmO', 'ctO', 'dato de otro');
    insert into public.sesiones (id, anfitrion, "leadId", "contactoId") values ('sD', 'Dante Closer', 'leadD', 'ctD'), ('sO', 'Otro Closer', 'leadO', 'ctO');
    insert into public.actividad (id, entidad, "entidadId") values ('aLeadO', 'lead', 'leadO'), ('aSesO', 'sesion', 'sO'), ('aVentaO', 'transaccion', 'vO');
    insert into public.ventas (id, "closerId", "contactoId", "sesionId", monto) values ('vD', 'm_dante', 'leadD', 'sD', 1000), ('vO', 'm_otro', 'leadO', 'sO', 5000);
    insert into public.cuotas (id, "ventaId") values ('cD', 'vD'), ('cO', 'vO');
    insert into public.pagos (id, "cuotaId", monto, comprobante) values ('pD', 'cD', 1000, '{"ruta":"d"}'), ('pO', 'cO', 5000, '{"ruta":"secreto-de-otro"}');`);
  return b;
}

const ids = async (b: Banco, email: string, tabla: string): Promise<string[]> => {
  const r = await b.intentar<{ id: string }>(email, `select id from public.${tabla} order by id`);
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  return r.ok ? r.rows.map((x) => x.id) : [];
};

for (const viejas of [false, true]) {
  const como = viejas ? "con las políticas viejas + el delta" : "con tipos-cuenta.sql nuevo";
  let compartido: Promise<Banco> | null = null;
  const banco = (): Promise<Banco> => (compartido ??= montar(Pg_!, viejas));
  after(async () => { if (compartido) await (await compartido).db.close(); });

  test(`${como}: un closer común sigue viendo sólo lo suyo`, { skip: saltear }, async () => {
    const b = await banco();
    assert.deepEqual(await ids(b, "dante@x.com", "leads"), ["leadD"]);
    assert.deepEqual(await ids(b, "dante@x.com", "contactos"), ["ctD"]);
    assert.deepEqual(await ids(b, "dante@x.com", "sesiones"), ["sD"]);
    assert.deepEqual(await ids(b, "dante@x.com", "comentarios"), ["cmD"]);
    assert.deepEqual(await ids(b, "dante@x.com", "actividad"), []);
    const acc = await b.intentar<{ a: { veTodosLosLeads: boolean; soloLoSuyo: boolean } }>("dante@x.com", `select public.mi_acceso() a`);
    assert.ok(acc.ok && acc.rows[0].a.soloLoSuyo === true && acc.rows[0].a.veTodosLosLeads === false);
  });

  test(`${como}: con el permiso ve y edita los leads, personas, llamadas, chat y actividad de todos`, { skip: saltear }, async () => {
    const b = await banco();
    assert.deepEqual(await ids(b, "mari@x.com", "leads"), ["leadD", "leadO"]);
    assert.deepEqual(await ids(b, "mari@x.com", "contactos"), ["ctD", "ctO"]);
    assert.deepEqual(await ids(b, "mari@x.com", "sesiones"), ["sD", "sO"]);
    assert.deepEqual(await ids(b, "mari@x.com", "comentarios"), ["cmD", "cmO"]);
    assert.deepEqual(await ids(b, "mari@x.com", "actividad"), ["aLeadO", "aSesO"], "la actividad de lead y llamada sí; la de una venta ajena, no");
    const acc = await b.intentar<{ a: { veTodosLosLeads: boolean } }>("mari@x.com", `select public.mi_acceso() a`);
    assert.ok(acc.ok && acc.rows[0].a.veTodosLosLeads === true);

    const edita = await b.intentar("mari@x.com", `update public.leads set nombre = 'Reagendado' where id = 'leadO'`);
    assert.ok(edita.ok && edita.n === 1, "edita el lead de otro (lo está reagendando)");
    const llamada = await b.intentar("mari@x.com", `update public.sesiones set notas = 'reagendada' where id = 'sO'`);
    assert.ok(llamada.ok && llamada.n === 1);
    const nuevaLlamada = await b.intentar("mari@x.com", `insert into public.sesiones (id, anfitrion, "leadId", "contactoId") values ('sM', 'Mariano Todos', 'leadO', 'ctO')`);
    assert.ok(nuevaLlamada.ok, nuevaLlamada.ok ? "" : nuevaLlamada.mensaje);
    const chat = await b.intentar("mari@x.com", `insert into public.comentarios (id, "contactoId", texto) values ('cmM', 'ctO', 'lo retomo yo')`);
    assert.ok(chat.ok, chat.ok ? "" : chat.mensaje);
    await b.ejecutar(`delete from public.sesiones where id = 'sM'; delete from public.comentarios where id = 'cmM'; update public.leads set nombre = 'Cliente de Otro' where id = 'leadO'; update public.sesiones set notas = null where id = 'sO'`);
  });

  test(`${como}: sus ventas, cuotas, cobros y devoluciones siguen siendo sólo los suyos`, { skip: saltear }, async () => {
    const b = await banco();
    for (const t of ["ventas", "cuotas", "pagos"]) assert.deepEqual(await ids(b, "mari@x.com", t), [], `${t} de otros no se ven`);
    const robo = await b.intentar("mari@x.com", `update public.ventas set "closerId" = 'm_mari' where id = 'vO'`);
    assert.ok(robo.ok && robo.n === 0, "no le cambia el closer a la venta de otro");
    const cuota = await b.intentar("mari@x.com", `insert into public.cuotas (id, "ventaId", "closerId") values ('cx', 'vO', 'm_mari')`);
    assert.ok(!cuota.ok && cuota.codigo === "42501", `no se hereda una cuota de la venta de otro: ${JSON.stringify(cuota)}`);
    /* Lo legítimo: cerrar la venta de un lead que retomó (el lead de otro ya es visible para él). */
    const venta = await b.intentar("mari@x.com", `insert into public.ventas (id, "closerId", "contactoId", monto) values ('vM', 'm_mari', 'leadO', 700)`);
    assert.ok(venta.ok, venta.ok ? "" : venta.mensaje);
    assert.deepEqual(await ids(b, "mari@x.com", "ventas"), ["vM"], "ve la suya y nada de las de otros");
    assert.deepEqual(await ids(b, "dante@x.com", "ventas"), ["vD"]);
    await b.ejecutar(`delete from public.ventas where id = 'vM'`);
  });

  test(`${como}: el permiso no hace nada sin «sólo lo suyo» ni en Dueño, y apagarlo vuelve a lo suyo`, { skip: saltear }, async () => {
    const b = await banco();
    await b.ejecutar(`update public.tipos_cuenta set "veTodosLosLeads" = true where id in ('director', 'dueno')`);
    const dir = await b.intentar<{ a: { soloLoSuyo: boolean; veTodosLosLeads: boolean } }>("santi@x.com", `select public.mi_acceso() a`);
    assert.ok(dir.ok && dir.rows[0].a.soloLoSuyo === false && dir.rows[0].a.veTodosLosLeads === false);
    assert.deepEqual(await ids(b, "santi@x.com", "leads"), ["leadD", "leadO"], "el director sigue viendo todo");
    const dueno = await b.intentar<{ a: { veTodosLosLeads: boolean } }>("yari@x.com", `select public.mi_acceso() a`);
    assert.ok(dueno.ok && dueno.rows[0].a.veTodosLosLeads === false);
    await b.ejecutar(`update public.tipos_cuenta set "veTodosLosLeads" = false where id in ('director', 'dueno')`);

    await b.ejecutar(`update public.tipos_cuenta set "veTodosLosLeads" = false where id = 'closer_ve_leads'`);
    assert.deepEqual(await ids(b, "mari@x.com", "leads"), [], "apagado, vuelve a ver sólo lo suyo (no tiene leads propios)");
    await b.ejecutar(`update public.tipos_cuenta set "veTodosLosLeads" = true where id = 'closer_ve_leads'`);
    assert.deepEqual(await ids(b, "mari@x.com", "leads"), ["leadD", "leadO"]);
  });

  test(`${como}: correr el delta de nuevo no cambia nada y ninguna política queda con solo_lo_suyo() a secas`, { skip: saltear }, async () => {
    const b = await banco();
    const antes = await b.servicio<{ polname: string; q: string }>(`select polname || ' ' || polrelid::regclass::text as polname, coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') q from pg_policy order by 1`);
    await b.ejecutar(sqlDe("closer-ve-todos-los-leads.sql"));
    await b.ejecutar(sqlDe("solo-lo-suyo-seguro.sql"));
    const despues = await b.servicio<{ polname: string; q: string }>(`select polname || ' ' || polrelid::regclass::text as polname, coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') q from pg_policy order by 1`);
    assert.deepEqual(despues, antes);
    const sueltas = await b.servicio<{ t: string; p: string }>(`
      select c.relname t, p.polname p from pg_policy p join pg_class c on c.oid = p.polrelid
      where c.relnamespace = 'public'::regnamespace and c.relname in (${TABLAS.map((t) => `'${t}'`).join(", ")})
        and (pg_get_expr(p.polqual, p.polrelid) like '%solo_lo_suyo()%' or pg_get_expr(p.polwithcheck, p.polrelid) like '%solo_lo_suyo()%')`);
    assert.deepEqual(sueltas, []);
    assert.deepEqual(await ids(b, "mari@x.com", "leads"), ["leadD", "leadO"]);
  });
}
