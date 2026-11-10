import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { armarBanco, cargarPglite, ESQUEMA_MINIMO, PERMISOS_DE_ENSAYO, sqlDe, type Banco } from "./sql/arnes-pg";
import {
  AREAS, TIPOS_POR_DEFECTO, areasConExtra, extraLimpio, extraQueSuma, nivelDeRuta, puedeEditar, puedeLeer, resumenDeExtra, type MiAcceso,
} from "@/lib/permisos";
import type { AreasDeTipo } from "@/lib/types";

/* 10/11: Manuel quiso que Santiago (Director comercial) viera Finanzas. Lo único que había era cambiarle el tipo de cuenta, y con eso
   perdía lo de director. Ahora cada persona lleva áreas de más sobre su tipo (supabase/permisos-por-persona.sql), que sólo suman. */

const director = TIPOS_POR_DEFECTO.find((t) => t.id === "director")!;
const como = (extra: AreasDeTipo): MiAcceso => ({
  tipo: director.id, nombre: director.nombre, areas: areasConExtra(director.areas, extra), areasExtra: extra, soloLoSuyo: false,
});

test("el director con Finanzas de más ve Finanzas y sigue siendo director", () => {
  const antes = como({});
  assert.equal(nivelDeRuta(antes, "/finanzas"), 0, "sin nada de más, no entra a Finanzas");
  const santi = como({ finanzas: "ver" });
  assert.equal(santi.tipo, "director");
  assert.equal(nivelDeRuta(santi, "/finanzas"), 1, "entra a Finanzas para mirar");
  assert.equal(nivelDeRuta(santi, "/conciliacion"), 1);
  assert.equal(puedeLeer(santi, "gastos") && puedeLeer(santi, "movimientos"), true);
  assert.equal(puedeEditar(santi, "gastos"), false, "mirar no es cargar gastos");
  for (const ruta of ["/crm", "/leads", "/ventas"]) assert.equal(nivelDeRuta(santi, ruta), 2, `${ruta} sigue entero`);
  assert.equal(puedeEditar(santi, "leads") && puedeEditar(santi, "sesiones") && puedeEditar(santi, "ventas"), true);
  assert.equal(nivelDeRuta(santi, "/equipo"), 0, "y no gana Equipo y honorarios");
});

test("lo de más sólo suma: nunca baja lo que da el tipo y descarta lo que no entiende", () => {
  assert.deepEqual(areasConExtra(director.areas, { ventas: "ver", crm: "ver" }), director.areas, "«ver» no le saca el «editar» del tipo");
  assert.equal(areasConExtra(director.areas, { webinars: "editar" }).webinars, "editar", "sube de ver a editar");
  assert.deepEqual(extraLimpio({ finanzas: "ver", cualquiera: "editar", ventas: "todo", alumnos: 2 }), { finanzas: "ver" });
  assert.deepEqual(extraLimpio(null), {});
  assert.deepEqual(extraLimpio("finanzas"), {});
  assert.deepEqual(extraQueSuma(director, { finanzas: "ver", ventas: "ver", panel: "ver", webinars: "editar" }), { finanzas: "ver", webinars: "editar" },
    "lo que el tipo ya da no se muestra como de más");
  assert.deepEqual(extraQueSuma(TIPOS_POR_DEFECTO.find((t) => t.id === "dueno"), { finanzas: "ver" }), {}, "a un dueño no le suma nada");
  /* Clientes cuelga de Ventas: al director no le suma «ver Clientes». */
  assert.deepEqual(extraQueSuma(director, { clientes: "ver" }), {});
  assert.equal(resumenDeExtra({ finanzas: "ver" }), "Ve Finanzas");
  assert.equal(resumenDeExtra({ finanzas: "ver", alumnos: "editar" }), "Edita Alumnos; ve Finanzas");
  assert.equal(resumenDeExtra({}), "");
});

test("la pantalla lo ofrece en Accesos y el aviso de un pedido ya no manda a cambiar el tipo", () => {
  const pantalla = readFileSync(new URL("../src/components/equipo/Accesos.tsx", import.meta.url), "utf8");
  assert.match(pantalla, /titulo: "Permisos de más"/);
  assert.match(pantalla, /accesos\.guardarExtra\(f\.email, extra\)/);
  const acceso = readFileSync(new URL("../src/lib/acceso.ts", import.meta.url), "utf8");
  assert.match(acceso, /\.update\(\{ areasExtra: extraLimpio\(areasExtra\) \}\)/, "guardar lo de más no toca el tipo");
  assert.doesNotMatch(acceso.match(/const guardar = useCallback[\s\S]*?\}, \[recargar\]\);/)![0], /areasExtra/, "y cambiar el tipo no pisa lo de más");
  const pedido = readFileSync(new URL("../supabase/pedir-acceso.sql", import.meta.url), "utf8");
  assert.match(pedido, /sin cambiarle el tipo: Equipo → Accesos → «Permisos de más»/);
  assert.doesNotMatch(pedido, /\(cambiarle el tipo\)/);
});

test("los tres SQL que definen mi_acceso() dicen lo mismo", () => {
  const cuerpo = (archivo: string, fn: string) => {
    const s = sqlDe(archivo);
    const i = s.indexOf(`create or replace function public.${fn}(`);
    assert.ok(i >= 0, `${archivo} define ${fn}`);
    return s.slice(i, s.indexOf("$$;", i));
  };
  for (const fn of ["mi_acceso", "nivel_area", "ve", "edita", "areas_con_extra"]) {
    assert.equal(cuerpo("tipos-cuenta.sql", fn), cuerpo("permisos-por-persona.sql", fn), fn);
  }
  for (const fn of ["mi_acceso", "areas_con_extra"]) {
    assert.equal(cuerpo("closer-ve-todos-los-leads.sql", fn), cuerpo("permisos-por-persona.sql", fn), `closer-ve-todos-los-leads: ${fn}`);
  }
});

/* ---- la base, con la RLS de verdad ---- */

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Banco[] = [];
after(async () => { for (const b of abiertos) await b.db.close(); });

/* Las políticas de escritura de usuarios_permitidos de producción (las pone honorarios.sql; la de lectura, tipos-cuenta.sql): sólo un dueño. */
const POLITICAS_DE_ACCESOS = `
  alter table public.usuarios_permitidos enable row level security;
  create policy duenos_agregan_accesos on public.usuarios_permitidos for insert with check (public.es_dueno());
  create policy duenos_editan_accesos on public.usuarios_permitidos for update using (public.es_dueno()) with check (public.es_dueno());
`;
const PERSONAS = `
  insert into public.usuarios_permitidos (email, nombre, rol) values
    ('manuel@apicanta.com', 'Manuel Pérez', 'dueno'), ('santiago@apicanta.com', 'Santiago Burghiani', 'director'),
    ('mariano@apicanta.com', 'Mariano Arias', 'closer');
  insert into public.gastos (id) values ('gas_1');
  insert into public.leads (id, nombre) values ('lead_1', 'Ana');
`;

/** `conParche`: la base como estaba en producción el 10/11 (las funciones viejas, sin la columna) y encima el archivo nuevo, dos veces. */
async function nuevoBanco(conParche: boolean): Promise<Banco> {
  const db = new Pg!();
  await db.exec(ESQUEMA_MINIMO);
  let base = sqlDe("tipos-cuenta.sql");
  if (conParche) {
    base = base
      .replace(/alter table public\.usuarios_permitidos add column if not exists "areasExtra"[^;]*;/, "")
      .replace(/do \$\$ begin\s+if not exists \(select 1 from pg_constraint where conname = 'usuarios_permitidos_extra_ck'\)[\s\S]*?end \$\$;/, "")
      .replaceAll(`public.areas_con_extra(t.areas, u."areasExtra")`, "t.areas")
      .replace(`'areasExtra', u."areasExtra",`, "")
      .replace("grant execute on function public.areas_con_extra(jsonb, jsonb) to authenticated;", "");
    assert.doesNotMatch(base.replace(/create or replace function public\.areas_con_extra[\s\S]*?\$\$;/, ""), /areasExtra|areas_con_extra/, "la base de antes no sabe de lo de más");
  }
  await db.exec(base);
  await db.exec(PERMISOS_DE_ENSAYO);
  if (conParche) {
    await db.exec(sqlDe("permisos-por-persona.sql"));
    await db.exec(sqlDe("permisos-por-persona.sql"));
  }
  await db.exec(POLITICAS_DE_ACCESOS);
  await db.exec(PERMISOS_DE_ENSAYO);
  const b = armarBanco(db);
  abiertos.push(b);
  await b.ejecutar(PERSONAS);
  return b;
}

for (const conParche of [false, true]) {
  const donde = conParche ? "base de antes + permisos-por-persona.sql" : "base nueva (tipos-cuenta.sql)";
  let compartido: Promise<Banco> | null = null;
  const banco = () => (compartido ??= nuevoBanco(conParche));
  const puede = async (b: Banco, email: string, sql: string) => {
    const r = await b.intentar<{ x: unknown }>(email, `select ${sql} as x`);
    assert.ok(r.ok, r.ok ? "" : r.mensaje);
    return r.rows[0].x;
  };

  test(`${donde}: sin nada de más, el director no ve Finanzas y nadie cambia`, { skip: saltear }, async () => {
    const b = await banco();
    assert.equal(await puede(b, "santiago@apicanta.com", "public.ve('gastos')"), false);
    assert.equal(await puede(b, "santiago@apicanta.com", "public.nivel_area('finanzas')"), 0);
    assert.equal(await puede(b, "santiago@apicanta.com", "public.edita('leads')"), true);
    const gastos = await b.intentar("santiago@apicanta.com", "select id from public.gastos");
    assert.ok(gastos.ok && gastos.rows.length === 0, "la tabla le llega vacía");
    assert.equal(await puede(b, "manuel@apicanta.com", "public.edita('gastos')"), true);
    assert.deepEqual(await puede(b, "mariano@apicanta.com", "public.mi_acceso() -> 'areas'"), { crm: "editar", ventas: "editar" });
  });

  test(`${donde}: un dueño le suma Finanzas a Santiago y sigue siendo director`, { skip: saltear }, async () => {
    const b = await banco();
    const cambio = await b.intentar("manuel@apicanta.com", `update public.usuarios_permitidos set "areasExtra" = '{"finanzas":"ver"}' where email = 'santiago@apicanta.com'`);
    assert.ok(cambio.ok && cambio.n === 1);
    const yo = await puede(b, "santiago@apicanta.com", "public.mi_acceso()") as MiAcceso;
    assert.equal(yo.tipo, "director");
    assert.deepEqual(yo.areasExtra, { finanzas: "ver" });
    assert.deepEqual(yo.areas, { ...director.areas, finanzas: "ver" });
    assert.equal(await puede(b, "santiago@apicanta.com", "public.nivel_area('finanzas')"), 1);
    const gastos = await b.intentar("santiago@apicanta.com", "select id from public.gastos");
    assert.ok(gastos.ok && gastos.rows.length === 1, "ahora ve los gastos");
    assert.equal(await puede(b, "santiago@apicanta.com", "public.edita('gastos')"), false, "pero no los carga");
    const escribe = await b.intentar("santiago@apicanta.com", "insert into public.gastos (id) values ('gas_santi')");
    assert.equal(escribe.ok, false, "la base no le deja cargar un gasto");
    assert.equal(await puede(b, "santiago@apicanta.com", "public.edita('leads')"), true, "lo de director, intacto");
    const lead = await b.intentar("santiago@apicanta.com", "update public.leads set nombre = 'Ana María' where id = 'lead_1'");
    assert.ok(lead.ok && lead.n === 1);
    assert.equal(await puede(b, "mariano@apicanta.com", "public.ve('gastos')"), false, "y nadie más gana nada");
  });

  test(`${donde}: nadie se suma permisos a sí mismo, y cambiarle el tipo no borra lo de más`, { skip: saltear }, async () => {
    const b = await banco();
    const solo = await b.intentar("santiago@apicanta.com", `update public.usuarios_permitidos set "areasExtra" = '{"finanzas":"editar","ajustes":"editar"}' where email = 'santiago@apicanta.com'`);
    assert.ok(!solo.ok || solo.n === 0, "RLS no lo deja");
    const roto = await b.intentar("manuel@apicanta.com", `update public.usuarios_permitidos set "areasExtra" = '"finanzas"' where email = 'santiago@apicanta.com'`);
    assert.equal(roto.ok, false, "sólo se guarda un objeto");
    await b.intentar("manuel@apicanta.com", `update public.usuarios_permitidos set "areasExtra" = '{"finanzas":"ver","ventas":"ver"}' where email = 'santiago@apicanta.com'`);
    assert.equal(await puede(b, "santiago@apicanta.com", "public.edita('ventas')"), true, "«ver» de más no le baja el «editar» del tipo");
    await b.intentar("manuel@apicanta.com", `update public.usuarios_permitidos set rol = 'setter' where email = 'santiago@apicanta.com'`);
    assert.deepEqual(await puede(b, "santiago@apicanta.com", "public.mi_acceso() -> 'areas'"), { leads: "editar", crm: "ver", finanzas: "ver", ventas: "ver" });
    await b.intentar("manuel@apicanta.com", `update public.usuarios_permitidos set rol = 'director', "areasExtra" = '{}' where email = 'santiago@apicanta.com'`);
    assert.equal(await puede(b, "santiago@apicanta.com", "public.ve('gastos')"), false, "y al sacárselo, deja de ver");
  });

  test(`${donde}: la base y la pantalla suman igual, área por área`, { skip: saltear }, async () => {
    const b = await banco();
    const niveles = [undefined, "ver", "editar"] as const;
    for (const a of AREAS.slice(0, 4)) {
      for (const base of niveles) for (const extra of niveles) {
        const t: AreasDeTipo = base ? { [a.id]: base } : {};
        const x: AreasDeTipo = extra ? { [a.id]: extra } : {};
        const [fila] = await b.servicio<{ r: AreasDeTipo }>(`select public.areas_con_extra('${JSON.stringify(t)}', '${JSON.stringify(x)}') as r`);
        assert.deepEqual(fila.r, areasConExtra(t, x), `${a.id}: ${base ?? "—"} + ${extra ?? "—"}`);
      }
    }
    const [raro] = await b.servicio<{ r: AreasDeTipo }>(`select public.areas_con_extra('{"crm":"editar","x":"nada"}', 'null') as r`);
    assert.deepEqual(raro.r, { crm: "editar" });
  });
}
