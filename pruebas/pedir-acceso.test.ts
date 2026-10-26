import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";
import { TIPOS_POR_DEFECTO, nivelDeRuta, puedeEditar, type MiAcceso } from "@/lib/permisos";
import { dondeEs } from "@/lib/avisos";
import { traducirPedido } from "@/lib/pedir-acceso";

/* 26/10: Santiago y Agustín le pidieron por WhatsApp a Juan Cruz el CRM y poder cambiar datos de leads. La pantalla
   sin permiso decía «pediselo a los dueños» y no daba cómo. Ahora «Pedir acceso» le deja un aviso en la campanita a
   cada dueño (supabase/pedir-acceso.sql), y Marketing ve el CRM (supabase/marketing-ve-crm.sql). */

const porDefecto = (id: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("Marketing ve el CRM y no lo edita; el director y el closer siguen igual", () => {
  const marketing = porDefecto("marketing");
  assert.equal(nivelDeRuta(marketing, "/crm"), 1, "Agustín abre el CRM");
  assert.equal(puedeEditar(marketing, "sesiones"), false, "pero no cambia las llamadas");
  assert.equal(puedeEditar(marketing, "contactos"), false, "ni los datos de la persona");
  assert.equal(puedeEditar(marketing, "leads"), false);
  assert.equal(nivelDeRuta(marketing, "/finanzas"), 0, "y no gana Finanzas");
  const director = porDefecto("director");
  assert.equal(puedeEditar(director, "leads") && puedeEditar(director, "sesiones") && puedeEditar(director, "contactos"), true, "el director edita leads, llamadas y personas");
});

test("la siembra de la base dice lo mismo que los tipos por defecto, y el parche no pisa lo que un dueño cambió", () => {
  const siembra = readFileSync(new URL("../supabase/tipos-cuenta.sql", import.meta.url), "utf8");
  assert.match(siembra, /'\{"panel":"ver","leads":"ver","crm":"ver","webinars":"editar","marketing":"editar"\}'/);
  const parche = readFileSync(new URL("../supabase/marketing-ve-crm.sql", import.meta.url), "utf8");
  assert.match(parche, /not \(areas \? 'crm'\)/, "si el tipo ya tiene una decisión sobre el CRM, no se toca");
});

test("el aviso de un pedido de acceso se lee como tal y los errores se dicen en castellano", () => {
  assert.match(dondeEs({ persona: null, tipo: "acceso" }), /Pedido de acceso/);
  assert.match(traducirPedido("Tu correo no está entre los accesos a la app: pedíselo"), /pedile a un dueño/);
  assert.match(traducirPedido("Could not find the function public.pedir_acceso in the schema cache"), /WhatsApp/);
  assert.match(traducirPedido("algo raro"), /No se pudo mandar/);
});

/* ---- la función de la base, con la RLS de verdad ---- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
let compartido: Promise<Banco> | null = null;
const abiertos: Banco[] = [];
async function nuevoBanco(): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(sqlDe("avisos.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(sqlDe("pedir-acceso.sql"));
  const b = armarBanco(db);
  abiertos.push(b);
  const permisos = sqlDe("avisos.sql").match(/revoke all on public\.avisos[\s\S]*?grant update \("leidoEn"\) on public\.avisos to authenticated;/)![0];
  await b.ejecutar(`
    ${permisos}
    grant execute on function public.pedir_acceso(text, text, text, text) to authenticated;
    insert into public.usuarios_permitidos (email, nombre, rol) values
      ('yari@apicanta.com', 'Yari Taft', 'dueno'), ('ceo@x.com', 'Juan Cruz', 'dueno'),
      ('agustin@apicanta.com', 'Agustín Sica', 'marketing'), ('santiago@apicanta.com', '', 'director');
    insert into public.equipo (id, nombre, email) values ('eq_director', 'Santiago Burghiani', 'santiago@apicanta.com');
  `);
  return b;
}
const banco = () => (compartido ??= nuevoBanco());
after(async () => { for (const b of abiertos) await b.db.close(); });

test("pedir acceso le deja un aviso a cada dueño, con quién es, su cuenta y lo que dice", { skip: saltear }, async () => {
  const b = await banco();
  const r = await b.intentar<{ pedir_acceso: number }>("agustin@apicanta.com",
    `select public.pedir_acceso('CRM', '/crm', 'ver', 'Para cruzar la calidad de los leads con las llamadas')`);
  assert.ok(r.ok && r.rows[0].pedir_acceso === 2, "avisó a los dos dueños");
  const avisos = await b.servicio<{ para: string; tipo: string; titulo: string; cuerpo: string; deEmail: string }>(
    `select para, tipo, titulo, cuerpo, "deEmail" from public.avisos where tipo = 'acceso' order by para`);
  assert.deepEqual(avisos.map((a) => a.para), ["ceo@x.com", "yari@apicanta.com"]);
  assert.equal(avisos[0].titulo, "Agustín Sica pidió acceso a CRM");
  assert.match(avisos[0].cuerpo, /«Marketing»/);
  assert.match(avisos[0].cuerpo, /Para cruzar la calidad/);
  assert.match(avisos[0].cuerpo, /Equipo → Accesos/);
  assert.equal(avisos[0].deEmail, "agustin@apicanta.com");
});

test("un dueño lo ve en su campanita y nadie más; el pedido de «editar» dice otra cosa y usa el nombre de Equipo si no hay en Accesos", { skip: saltear }, async () => {
  const b = await banco();
  const r = await b.intentar<{ pedir_acceso: number }>("santiago@apicanta.com", `select public.pedir_acceso('CRM', '/crm', 'editar')`);
  assert.ok(r.ok && r.rows[0].pedir_acceso === 2);
  const deYari = await b.intentar<{ titulo: string }>("yari@apicanta.com", `select titulo from public.avisos where tipo = 'acceso' order by titulo`);
  assert.ok(deYari.ok);
  assert.deepEqual(deYari.rows.map((x) => x.titulo), ["Agustín Sica pidió acceso a CRM", "Santiago Burghiani pidió poder editar CRM"]);
  const deAgustin = await b.intentar("agustin@apicanta.com", `select id from public.avisos where tipo = 'acceso'`);
  assert.ok(deAgustin.ok && deAgustin.rows.length === 0, "Agustín no ve los avisos de los dueños");
});

test("apretar dos veces el mismo día no repite el aviso; otra pantalla sí es otro pedido", { skip: saltear }, async () => {
  const b = await banco();
  await b.intentar("agustin@apicanta.com", `select public.pedir_acceso('CRM', '/crm', 'ver')`);
  await b.intentar("agustin@apicanta.com", `select public.pedir_acceso('CRM', '/crm', 'ver')`);
  const n = async () => (await b.servicio<{ n: string }>(`select count(*)::text n from public.avisos where tipo = 'acceso' and "deEmail" = 'agustin@apicanta.com'`))[0].n;
  assert.equal(await n(), "2", "uno por dueño, no cuatro");
  await b.intentar("agustin@apicanta.com", `select public.pedir_acceso('Finanzas', '/finanzas', 'ver')`);
  assert.equal(await n(), "4");
});

test("un dueño no se pide nada; quien no está en Accesos o no entró, no puede", { skip: saltear }, async () => {
  const b = await banco();
  const dueno = await b.intentar<{ pedir_acceso: number }>("yari@apicanta.com", `select public.pedir_acceso('Finanzas', '/finanzas', 'ver')`);
  assert.ok(dueno.ok && dueno.rows[0].pedir_acceso === 0);
  const ajeno = await b.intentar("intruso@x.com", `select public.pedir_acceso('Finanzas', '/finanzas', 'ver')`);
  assert.equal(ajeno.ok, false);
  const sinSesion = await b.intentar(null, `select public.pedir_acceso('Finanzas', '/finanzas', 'ver')`);
  assert.equal(sinSesion.ok, false);
});

test("sigue sin poderse escribir un aviso a mano: la función es la única puerta", { skip: saltear }, async () => {
  const b = await banco();
  const inventa = await b.intentar("agustin@apicanta.com", `insert into public.avisos (id, para, tipo, titulo) values ('x', 'yari@apicanta.com', 'acceso', 'soy yo')`);
  assert.equal(inventa.ok, false);
});
