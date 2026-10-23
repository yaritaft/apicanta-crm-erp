import test, { after } from "node:test";
import assert from "node:assert/strict";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";

/* supabase/avisos.sql en un Postgres en memoria (PGlite), con la RLS de verdad: una mención en el chat de una ficha le
   deja un aviso a esa persona del equipo (Lili, 23/10: «un agradecimiento a Yari, algo del CV a Aldi, un reclamo del
   sistema a Manu»), cada uno ve y marca leídos sólo los suyos, y borrar el mensaje borra su aviso. Si PGlite no está en
   el disco se saltea (ver pruebas/sql/arnes-pg.ts). */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";

let compartido: Promise<Banco> | null = null;
const abiertos: Banco[] = [];
async function nuevoBanco(): Promise<Banco> {
  /* Como montarBanco, más el rol «anon» que Supabase tiene y el arnés no (avisos.sql le saca los permisos). */
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(sqlDe("tipos-cuenta.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  await db.exec(sqlDe("avisos.sql"));
  await db.exec(PERMISOS_DE_ENSAYO);
  const b = armarBanco(db);
  abiertos.push(b);
  /* El arnés da todos los permisos a todas las tablas: se vuelven a poner los de avisos.sql. */
  const permisos = sqlDe("avisos.sql").match(/revoke all on public\.avisos[\s\S]*?grant update \("leidoEn"\) on public\.avisos to authenticated;/)![0];
  await b.ejecutar(`
    alter table public.comentarios add column autor text, add column "autorEmail" text;
    alter table public.alumnos add column nombre text;
    ${permisos}
    insert into public.equipo (id, nombre, email, activo) values
      ('eq_yari', 'Yari', 'yari.taft@gmail.com', true),
      ('eq_aldana', 'Aldana Ytzcovich', 'aldana@apicanta.com', true),
      ('eq_manu', 'Manuel Pérez', 'Manuel@apicanta.com', true),
      ('eq_lili', 'Liliana Riveros', 'liliana@apicanta.com', true),
      ('eq_ana', 'Ana', 'ana@apicanta.com', true),
      ('eq_viejo', 'Martín', 'martin@apicanta.com', false);
    insert into public.usuarios_permitidos (email, nombre, rol) values
      ('yari@apicanta.com', 'Yari Taft', 'dueno'), ('liliana@apicanta.com', 'Liliana Riveros', 'dueno'),
      ('aldana@apicanta.com', 'Aldana Ytzcovich', 'dueno');
    insert into public.contactos (id, nombre) values ('con_saul', 'Saul Rivas Martinez');
  `);
  return b;
}
const banco = () => (compartido ??= nuevoBanco());
after(async () => { for (const b of abiertos) await b.db.close(); });

const comentar = (b: Banco, id: string, texto: string, autorEmail = "liliana@apicanta.com") =>
  b.ejecutar(`insert into public.comentarios (id, "contactoId", texto, autor, "autorEmail")
    values ('${id}', 'con_saul', '${texto.replace(/'/g, "''")}', 'Liliana Riveros', '${autorEmail}')`);
const avisosDe = (b: Banco, id: string) =>
  b.servicio<{ para: string; titulo: string; persona: string }>(`select para, titulo, persona from public.avisos where "comentarioId" = '${id}' order by para`);

test("una mención le deja un aviso a esa persona, a su mail de Equipo y a su cuenta con el mismo nombre", { skip: saltear }, async () => {
  const b = await banco();
  await comentar(b, "com_1", "📞 Agradecimiento · le encantó la clase @Yari y @Aldana Ytzcovich ");
  const avisos = await avisosDe(b, "com_1");
  assert.deepEqual(avisos.map((a) => a.para), ["aldana@apicanta.com", "yari.taft@gmail.com", "yari@apicanta.com"]);
  assert.equal(avisos[0].titulo, "Liliana Riveros te mencionó");
  assert.equal(avisos[0].persona, "Saul Rivas Martinez", "dice de qué ficha es");
});

test("no se avisa a quien escribe, ni por un nombre que sigue de largo, ni a alguien inactivo; el mail va en minúsculas", { skip: saltear }, async () => {
  const b = await banco();
  await comentar(b, "com_2", "nota para mí @Liliana Riveros, para @Anabel y para @Martín; reclamo del sistema a @Manuel Pérez.");
  assert.deepEqual((await avisosDe(b, "com_2")).map((a) => a.para), ["manuel@apicanta.com"]);
  await comentar(b, "com_3", "sin menciones, sólo un mail: soporte@apicanta.com");
  assert.equal((await avisosDe(b, "com_3")).length, 0);
});

test("cada uno ve y marca leídos sólo los suyos; nadie los crea a mano", { skip: saltear }, async () => {
  const b = await banco();
  await comentar(b, "com_4", "@Aldana Ytzcovich revisá el CV");
  const deAldana = await b.intentar<{ id: string }>("aldana@apicanta.com", `select id from public.avisos where "comentarioId" = 'com_4'`);
  assert.ok(deAldana.ok && deAldana.rows.length === 1);
  const deLili = await b.intentar<{ id: string }>("liliana@apicanta.com", `select id from public.avisos where "comentarioId" = 'com_4'`);
  assert.ok(deLili.ok && deLili.rows.length === 0, "Lili no ve el aviso de Aldana");
  const marcaAjeno = await b.intentar("liliana@apicanta.com", `update public.avisos set "leidoEn" = now() where "comentarioId" = 'com_4'`);
  assert.ok(marcaAjeno.ok && marcaAjeno.n === 0);
  const marca = await b.intentar("aldana@apicanta.com", `update public.avisos set "leidoEn" = now() where "comentarioId" = 'com_4'`);
  assert.ok(marca.ok && marca.n === 1);
  const cambiaTexto = await b.intentar("aldana@apicanta.com", `update public.avisos set titulo = 'otro' where "comentarioId" = 'com_4'`);
  assert.equal(cambiaTexto.ok, false, "sólo se puede tocar «leído»");
  const inventa = await b.intentar("aldana@apicanta.com", `insert into public.avisos (id, para, titulo) values ('x', 'aldana@apicanta.com', 'hola')`);
  assert.equal(inventa.ok, false);
});

test("borrar el mensaje borra su aviso", { skip: saltear }, async () => {
  const b = await banco();
  await comentar(b, "com_5", "@Yari mirá esto");
  assert.equal((await avisosDe(b, "com_5")).length, 2);
  await b.ejecutar(`delete from public.comentarios where id = 'com_5'`);
  assert.equal((await avisosDe(b, "com_5")).length, 0);
});

test("se puede volver a correr", { skip: saltear }, async () => {
  const b = await banco();
  await b.ejecutar(sqlDe("avisos.sql"));
  await comentar(b, "com_6", "@Yari otra vez");
  assert.equal((await avisosDe(b, "com_6")).length, 2, "el disparador no quedó repetido");
});
