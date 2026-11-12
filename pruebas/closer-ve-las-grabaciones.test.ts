/* Las grabaciones de Fathom y las capturas de la pre-call se abren con la llamada (supabase/closer-ve-las-grabaciones.sql), con el RLS
   REAL en un Postgres en memoria (PGlite). Si PGlite no está en el disco, se saltean (ver pruebas/sql/arnes-pg.ts).

   Lo que pasó (13/11: Dante, closer, le pidió a Santiago ver las llamadas de los demás —sobre todo de los closers que ya no están— para
   retomar leads viejos mirando «la grabación del Fathom»): el permiso «ve los leads de todos» abría la llamada pero no su grabación, y la
   transcripción llegaba vacía. Lo que se cuida:
     1. un closer común sigue viendo sólo las grabaciones y capturas de SUS llamadas;
     2. con el permiso ve las grabaciones y las capturas de las llamadas de todos, incluidas las de un closer que ya no está en el equipo;
     3. sus ventas y cobros siguen siendo sólo los suyos (abrir la llamada no abre la plata);
     4. el delta arregla una base con las políticas viejas (la de producción hasta el 13/11), y correrlo de nuevo no cambia nada;
     5. los archivos de supabase/ que crean esas tablas (fathom.sql, precall-capturas.sql) ya traen la regla, para que volver a correrlos
        no la deshaga. Se corre sobre la base nueva y sobre una con las políticas viejas + el delta. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cargarPglite, montarBanco, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";

const Pg_ = await cargarPglite();
const saltear = Pg_ ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";

/* La función de permisos de las capturas tal como estaba en producción antes del arreglo (solo_lo_suyo() a secas). */
const PRECALL_VIEJA = `
  create or replace function public.precall_puede(p_sesion text, p_escribir boolean) returns boolean language sql stable security definer set search_path = public as $b$
    select coalesce(public.ve('sesiones') and (
        not public.solo_lo_suyo() or p_sesion = any((select public.mis_sesiones())::text[])
        or exists (select 1 from public.sesiones s where s.id = p_sesion and s."setterId" is not null and s."setterId" = public.mi_miembro_id())
      ) and (not p_escribir or public.edita('sesiones')), false);
  $b$;`;

/* Deja la base como estaba en producción antes del arreglo: grabaciones con solo_lo_suyo() a secas y la lista de tablas abiertas sin ellas. */
async function volverALasViejas(b: Banco): Promise<void> {
  await b.ejecutar(`
    create or replace function public.solo_lo_suyo_en(tabla text) returns boolean language sql stable security definer set search_path = public as $$
      select public.solo_lo_suyo() and not (tabla in ('leads', 'contactos', 'sesiones', 'comentarios', 'chat_lecturas') and public.ve_todos_los_leads());
    $$;
    alter policy ver_grabaciones on public.grabaciones using ((select public.ve('sesiones')) and ((select not public.solo_lo_suyo()) or "sesionId" = any((select public.mis_sesiones())::text[])));
    ${PRECALL_VIEJA}`);
}

async function montar(Pg: NonNullable<typeof Pg_>, viejas: boolean): Promise<Banco> {
  const b = await montarBanco(Pg, ["solo-lo-suyo-seguro.sql", "closer-ve-todos-los-leads.sql"]);
  /* Las fases que el esquema mínimo no trae: el setter de la llamada y el rol del miembro (las usa precall_puede). */
  await b.ejecutar(`alter table public.sesiones add column if not exists "setterId" text; alter table public.equipo add column if not exists rol text;`);
  await b.ejecutar(sqlDe("fathom.sql"));
  /* La función con la regla nueva, como la deja precall-capturas.sql en una base nueva. */
  await b.ejecutar(`
    create or replace function public.precall_puede(p_sesion text, p_escribir boolean) returns boolean language sql stable security definer set search_path = public as $b$
      select coalesce(public.ve('sesiones') and (
          not public.solo_lo_suyo_en('precall_capturas') or p_sesion = any((select public.mis_sesiones())::text[])
          or exists (select 1 from public.sesiones s where s.id = p_sesion and s."setterId" is not null and s."setterId" = public.mi_miembro_id())
        ) and (not p_escribir or public.edita('sesiones')), false);
    $b$;`);
  await b.ejecutar(`
    create table public.precall_capturas (id text primary key, "sesionId" text not null, nombre text);
    alter table public.precall_capturas enable row level security;
    create policy precall_ver on public.precall_capturas for select to authenticated using ((select public.precall_puede("sesionId", false)));`);
  await b.ejecutar(PERMISOS_DE_ENSAYO);
  if (viejas) {
    await volverALasViejas(b);
    await b.ejecutar(sqlDe("closer-ve-las-grabaciones.sql"));
  }
  await b.ejecutar(`
    insert into public.equipo (id, nombre, email, activo) values
      ('m_dante', 'Dante Closer', 'dante@x.com', true), ('m_otro', 'Otro Closer', 'otro@x.com', true),
      ('m_ex', 'Valentín Que Ya No Está', null, false), ('m_mari', 'Mariano Todos', 'mari@x.com', true), ('m_santi', 'Santi Director', 'santi@x.com', true);
    insert into public.usuarios_permitidos (email, rol) values
      ('yari@x.com', 'dueno'), ('santi@x.com', 'director'), ('dante@x.com', 'closer'), ('otro@x.com', 'closer'), ('mari@x.com', 'closer_ve_leads');
    insert into public.contactos (id, nombre) values ('ctD', 'Cliente de Dante'), ('ctX', 'Cliente de Valentín');
    insert into public.leads (id, responsable, "contactoId", nombre) values ('leadD', 'Dante Closer', 'ctD', 'Cliente de Dante'), ('leadX', 'Valentín Que Ya No Está', 'ctX', 'Cliente de Valentín');
    insert into public.sesiones (id, anfitrion, "leadId", "contactoId") values ('sD', 'Dante Closer', 'leadD', 'ctD'), ('sX', 'Valentín Que Ya No Está', 'leadX', 'ctX');
    insert into public.grabaciones (id, "recordingId", "sesionId", titulo, resumen) values ('gD', 'r1', 'sD', 'Llamada de Dante', 'resumen D'), ('gX', 'r2', 'sX', 'Llamada de Valentín', 'resumen X');
    insert into public.precall_capturas (id, "sesionId", nombre) values ('pD', 'sD', 'chat D'), ('pX', 'sX', 'chat X');
    insert into public.ventas (id, "closerId", "contactoId", "sesionId", monto) values ('vD', 'm_dante', 'leadD', 'sD', 1000), ('vX', 'm_ex', 'leadX', 'sX', 5000);`);
  return b;
}

const ids = async (b: Banco, email: string, tabla: string): Promise<string[]> => {
  const r = await b.intentar<{ id: string }>(email, `select id from public.${tabla} order by id`);
  assert.ok(r.ok, r.ok ? "" : r.mensaje);
  return r.ok ? r.rows.map((x) => x.id) : [];
};

for (const viejas of [false, true]) {
  const como = viejas ? "con las políticas de antes + el delta" : "con fathom.sql y tipos-cuenta.sql nuevos";
  let compartido: Promise<Banco> | null = null;
  const banco = (): Promise<Banco> => (compartido ??= montar(Pg_!, viejas));
  after(async () => { if (compartido) await (await compartido).db.close(); });

  test(`${como}: un closer común sigue viendo sólo las grabaciones y capturas de sus llamadas`, { skip: saltear }, async () => {
    const b = await banco();
    assert.deepEqual(await ids(b, "dante@x.com", "grabaciones"), ["gD"]);
    assert.deepEqual(await ids(b, "dante@x.com", "precall_capturas"), ["pD"]);
    assert.deepEqual(await ids(b, "otro@x.com", "grabaciones"), []);
    assert.deepEqual(await ids(b, "otro@x.com", "precall_capturas"), []);
  });

  test(`${como}: con «ve los leads de todos» ve las grabaciones y capturas de todas las llamadas, también las de un closer que ya no está`, { skip: saltear }, async () => {
    const b = await banco();
    assert.deepEqual(await ids(b, "mari@x.com", "grabaciones"), ["gD", "gX"]);
    assert.deepEqual(await ids(b, "mari@x.com", "precall_capturas"), ["pD", "pX"]);
    const lee = await b.intentar<{ resumen: string }>("mari@x.com", `select resumen from public.grabaciones where id = 'gX'`);
    assert.ok(lee.ok && lee.rows[0]?.resumen === "resumen X", "lee el resumen de la llamada del closer que ya no está");
    /* Atar a mano una grabación a otra llamada es lo que ya podía hacer sobre las llamadas de todos. */
    const ata = await b.intentar("mari@x.com", `update public.grabaciones set "emparejadaPor" = 'a-mano' where id = 'gX'`);
    assert.ok(ata.ok && ata.n === 1);
    await b.ejecutar(`update public.grabaciones set "emparejadaPor" = null where id = 'gX'`);
  });

  test(`${como}: abrir la llamada no abre la plata, y quien no tiene el permiso no gana nada`, { skip: saltear }, async () => {
    const b = await banco();
    assert.deepEqual(await ids(b, "mari@x.com", "ventas"), [], "las ventas de otros siguen cerradas");
    assert.deepEqual(await ids(b, "dante@x.com", "ventas"), ["vD"]);
    assert.deepEqual(await ids(b, "santi@x.com", "grabaciones"), ["gD", "gX"], "el director sigue viendo todo");
    assert.deepEqual(await ids(b, "yari@x.com", "grabaciones"), ["gD", "gX"]);
  });

  test(`${como}: pasar a Dante al tipo con todos los leads le abre las grabaciones; apagarlo lo vuelve a lo suyo`, { skip: saltear }, async () => {
    const b = await banco();
    await b.ejecutar(`update public.usuarios_permitidos set rol = 'closer_ve_leads' where email = 'dante@x.com'`);
    assert.deepEqual(await ids(b, "dante@x.com", "grabaciones"), ["gD", "gX"]);
    assert.deepEqual(await ids(b, "dante@x.com", "ventas"), ["vD"], "sigue con sólo sus ventas");
    await b.ejecutar(`update public.tipos_cuenta set "veTodosLosLeads" = false where id = 'closer_ve_leads'`);
    assert.deepEqual(await ids(b, "dante@x.com", "grabaciones"), ["gD"], "apagado, vuelve a lo suyo");
    await b.ejecutar(`update public.tipos_cuenta set "veTodosLosLeads" = true where id = 'closer_ve_leads'; update public.usuarios_permitidos set rol = 'closer' where email = 'dante@x.com'`);
  });

  test(`${como}: correr el delta de nuevo no cambia nada y no queda ninguna política de las grabaciones con solo_lo_suyo() a secas`, { skip: saltear }, async () => {
    const b = await banco();
    const foto = () => b.servicio<{ n: string; q: string }>(`
      select polname || ' ' || polrelid::regclass::text as n, coalesce(pg_get_expr(polqual, polrelid), '') || '|' || coalesce(pg_get_expr(polwithcheck, polrelid), '') q from pg_policy order by 1`);
    const antes = await foto();
    await b.ejecutar(sqlDe("closer-ve-las-grabaciones.sql"));
    assert.deepEqual(await foto(), antes);
    const sueltas = await b.servicio<{ polname: string }>(`
      select polname from pg_policy where polrelid = 'public.grabaciones'::regclass
        and (pg_get_expr(polqual, polrelid) like '%solo_lo_suyo()%' or pg_get_expr(polwithcheck, polrelid) like '%solo_lo_suyo()%')`);
    assert.deepEqual(sueltas, []);
    const fn = await b.servicio<{ n: number }>(`select count(*)::int n from pg_proc where proname = 'precall_puede' and prosrc like '%solo_lo_suyo()%'`);
    assert.equal(fn[0].n, 0, "precall_puede ya no usa solo_lo_suyo() a secas");
    assert.deepEqual(await ids(b, "mari@x.com", "grabaciones"), ["gD", "gX"]);
  });
}

/* El archivo viejo del permiso (closer-ve-todos-los-leads.sql) redefine solo_lo_suyo_en(): si alguien lo vuelve a correr, no puede
   sacar a las grabaciones de la lista. */
test("volver a correr closer-ve-todos-los-leads.sql no vuelve a cerrar las grabaciones", { skip: saltear }, async () => {
  const b = await montar(Pg_!, false);
  try {
    await b.ejecutar(sqlDe("closer-ve-todos-los-leads.sql"));
    await b.ejecutar(sqlDe("solo-lo-suyo-seguro.sql"));
    assert.deepEqual(await ids(b, "mari@x.com", "grabaciones"), ["gD", "gX"]);
    assert.deepEqual(await ids(b, "mari@x.com", "precall_capturas"), ["pD", "pX"]);
  } finally { await b.db.close(); }
});
