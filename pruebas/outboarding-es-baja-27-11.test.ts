import test, { after } from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { estadoPorFollowUp, situacionDelAlumno, SITUACION_ALUMNO } from "@/lib/situacion-alumno";
import { escrituraCliente, filasClientes, listasCs } from "@/lib/clientes-cs";
import { construirSemilla } from "@/lib/seed";
import { cargarPglite, ESQUEMA_MINIMO, sqlDe, type Pg } from "./sql/arnes-pg";
import type { Alumno, EstadoApp, SeguimientoAlumno, Venta } from "@/lib/types";

/* ==================================================================
   Liliana, 27/11 (a la tarde): «En Alumnos, en el filtro Egresados, hay muchos alumnos que son outboarding, que están dados de baja.
   Que todos los que sean outboarding estén como baja. Y los que me queden como egresados sin follow up, los veo uno a uno».

   Eran 83: la importación del Airtable del 19/10 los marcó «egresado» por la fecha de egreso vencida sin mirar el Follow Up, y la regla
   dejaba que lo marcado a mano le ganara al Outboarding. Ahora Outboarding es baja en la regla, en el campo (la app y la base lo
   acompañan) y en la importación. Los nombres son inventados (el repo es público).
   ================================================================== */

const HOY = "2026-11-27";

test("la regla: Outboarding es baja aunque el estado diga egresado o pausado", () => {
  assert.equal(situacionDelAlumno({ estado: "graduado", followUp: "OUTBOARDING" }), "baja", "el caso de Lili");
  assert.equal(situacionDelAlumno({ estado: "graduado", followUp: "Outboarding" }), "baja");
  assert.equal(situacionDelAlumno({ estado: "egresado" as never, followUp: "Outbording" }), "baja", "como se escribía a veces en el Airtable");
  assert.equal(situacionDelAlumno({ estado: "pausado", followUp: "OUTBOARDING" }), "baja");
  /* Los egresados sin Outboarding siguen siendo egresados: ésos los revisa Lili uno por uno. */
  assert.equal(situacionDelAlumno({ estado: "graduado", followUp: "" }), "graduado");
  assert.equal(situacionDelAlumno({ estado: "graduado" }), "graduado");
  assert.equal(situacionDelAlumno({ estado: "graduado", followUp: "CASO DE EXITO" }), "graduado");
  /* «No renueva» no es Outboarding: todavía cursa. */
  assert.equal(situacionDelAlumno({ estado: "activo", followUp: "No renueva" }), "activo");
  assert.match(SITUACION_ALUMNO.graduado.ayuda, /Outboarding/);
});

test("el campo acompaña al Follow Up: a Outboarding queda en baja; al salir, vuelve a activo (salvo que la baja sea de la venta)", () => {
  assert.equal(estadoPorFollowUp({ estado: "activo", antes: "Módulo 3", despues: "OUTBOARDING" }), "baja");
  assert.equal(estadoPorFollowUp({ estado: "graduado", antes: "", despues: "Outboarding" }), "baja");
  assert.equal(estadoPorFollowUp({ estado: "graduado", antes: "OUTBOARDING", despues: "OUTBOARDING" }), "baja", "ya estaba en Outboarding y el campo había quedado mal");
  assert.equal(estadoPorFollowUp({ estado: "baja", antes: "", despues: "OUTBOARDING" }), null, "ya está en baja: no cambia nada");
  assert.equal(estadoPorFollowUp({ estado: "baja", antes: "OUTBOARDING", despues: "Módulo 3" }), "activo");
  assert.equal(estadoPorFollowUp({ estado: "baja", antes: "OUTBOARDING", despues: "Módulo 3", ventaDeBaja: true }), null, "venta reembolsada: sigue de baja");
  assert.equal(estadoPorFollowUp({ estado: "baja", antes: "Módulo 2", despues: "Módulo 3" }), null, "una baja a mano no se toca");
  assert.equal(estadoPorFollowUp({ estado: "graduado", antes: "Módulo 2", despues: "Módulo 3" }), null);
});

/* ---------- La app: cambiar el Follow Up en una pestaña cambia el estado ahí mismo ---------- */
fijarAcceso(null);
const exportado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const alumnoDe = (id: string) => exportado().alumnos.find((a) => a.id === id)!;

test("guardar el Follow Up en Outboarding deja al alumno en baja y lo anota; Deshacer lo vuelve como estaba", () => {
  const a = exportado().alumnos.find((x) => x.estado === "graduado") ?? exportado().alumnos[0];
  acciones.actualizar<Alumno>("alumnos", a.id, { estado: "graduado" }, a.nombre, "Prueba.");
  const antes = acciones.guardarSeguimiento(a.id, (s) => ({ ...s, followUp: "OUTBOARDING" }), () => "Follow-up: OUTBOARDING.");
  assert.equal(alumnoDe(a.id).estado, "baja");
  assert.match(exportado().actividad[0].detalle, /Queda como baja: su Follow Up dice Outboarding/);
  /* Otro cambio de la ficha con el Follow Up igual: no repite nada. */
  acciones.guardarSeguimiento(a.id, (s) => ({ ...s, notas: "llamar" }), () => "Notas.");
  assert.doesNotMatch(exportado().actividad[0].detalle, /Queda como baja/);
  /* Deshacer: sale de Outboarding y vuelve a activo. */
  acciones.restaurarSeguimiento(antes!, "Se deshizo.");
  assert.equal(alumnoDe(a.id).estado, "activo");
  assert.match(exportado().actividad[0].detalle, /Vuelve a estar activo/);
});

test("con la venta reembolsada, sacarlo de Outboarding no lo vuelve activo", () => {
  const e = exportado();
  const v = e.ventas.find((x) => e.alumnos.some((a) => a.ventaId === x.id))!;
  const a = e.alumnos.find((x) => x.ventaId === v.id)!;
  acciones.guardarSeguimiento(a.id, (s) => ({ ...s, followUp: "OUTBOARDING" }), () => "Follow-up.");
  assert.equal(alumnoDe(a.id).estado, "baja");
  acciones.actualizar<Venta>("ventas", v.id, { estado: "reembolsada" } as Partial<Venta>, "Venta", "Prueba.");
  acciones.guardarSeguimiento(a.id, (s) => ({ ...s, followUp: "Módulo 4" }), () => "Follow-up.");
  assert.equal(alumnoDe(a.id).estado, "baja");
});

/* ---------- Clientes: no se puede elegir otro estado mientras diga Outboarding ---------- */
test("en Clientes, con Outboarding no se elige Egresado ni Activo: se dice que hay que cambiar el Follow Up", () => {
  const base = construirSemilla();
  const al = (id: string, estado: Alumno["estado"]) => ({ id, nombre: `Alumno ${id}`, email: `${id}@mail.com`, estado, inicio: "2026-06-01T12:00:00.000Z",
    cohorte: "", plan: "Hackear IT", progreso: 0, cuotaMensual: 0, extra: {} } as Alumno);
  const e: EstadoApp = {
    ...base,
    alumnos: [al("egr", "graduado"), al("egrSinFu", "graduado")],
    seguimientos: [{ alumnoId: "egr", followUp: "OUTBOARDING" } as SeguimientoAlumno],
  };
  const filas = filasClientes(e, HOY);
  const listas = listasCs(e.ajustes.seguimiento);
  const egr = filas.find((f) => f.id === "egr")!;
  assert.equal(egr.estadoAlumno, "Baja", "en la columna figura Baja, no Egresado");
  for (const elegido of ["Egresado", "Activo", "Pausado"]) {
    const r = escrituraCliente(egr, "estadoAlumno", elegido, listas);
    assert.equal(r.tipo, "no", elegido);
    assert.match((r as { motivo: string }).motivo, /Follow Up dice «OUTBOARDING».*cambiá primero el Follow Up/);
  }
  assert.equal(escrituraCliente(egr, "estadoAlumno", "Baja", listas).tipo, "alumno", "Baja sí se puede");
  /* El egresado sin Follow Up se sigue pudiendo cerrar como quiera Lili. */
  const sinFu = filas.find((f) => f.id === "egrSinFu")!;
  assert.equal(sinFu.estadoAlumno, "Egresado");
  assert.deepEqual((escrituraCliente(sinFu, "estadoAlumno", "Activo", listas) as { cambios: unknown }).cambios, { estado: "activo" });
  assert.deepEqual((escrituraCliente(sinFu, "estadoAlumno", "Baja", listas) as { cambios: unknown }).cambios, { estado: "baja" });
});

/* ---------- La base: el disparador y la corrección de los que ya estaban ---------- */
const Pglite = await cargarPglite();
const saltear = Pglite ? false : "PGlite no está en el disco (ver pruebas/sql/arnes-pg.ts)";
const abiertos: Pg[] = [];
after(async () => { for (const db of abiertos) await db.close(); });

async function banco(): Promise<Pg> {
  const db = new Pglite!();
  abiertos.push(db);
  await db.exec(ESQUEMA_MINIMO);
  await db.exec("create role anon");
  await db.exec(`
    alter table public.alumnos add column nombre text, add column estado text default 'activo';
    alter table public.actividad add column accion text, add column actor text, add column titulo text, add column fecha timestamptz, add column detalle text;
    create table public.seguimiento_alumnos (id text primary key, "alumnoId" text unique, "followUp" text not null default '', "cicloDeVenta" text);
    insert into public.ventas (id, estado) values ('v_ok', 'activa'), ('v_reemb', 'reembolsada');
    insert into public.alumnos (id, nombre, estado, "ventaId") values
      ('a_egr', 'Egresado Outb', 'graduado', 'v_ok'),
      ('a_act', 'Activo Outb', 'activo', null),
      ('a_ya', 'Ya Baja', 'baja', null),
      ('a_egr2', 'Egresado Sin Fu', 'graduado', null),
      ('a_cursa', 'Cursa', 'activo', 'v_ok'),
      ('a_reemb', 'Reembolsado', 'baja', 'v_reemb');
    insert into public.seguimiento_alumnos (id, "alumnoId", "followUp") values
      ('s1', 'a_egr', 'OUTBOARDING'), ('s2', 'a_act', 'Outboarding'), ('s3', 'a_ya', 'OUTBOARDING'), ('s4', 'a_egr2', ''), ('s5', 'a_cursa', 'Módulo 2'),
      ('s6', 'a_reemb', 'OUTBOARDING');
  `);
  return db;
}
const estados = async (db: Pg) => Object.fromEntries((await db.query<{ id: string; estado: string }>("select id, estado from alumnos order by id")).rows.map((r) => [r.id, r.estado]));

test("SQL: los que ya estaban en Outboarding pasan a baja, con respaldo y una línea en la actividad; correrlo otra vez no cambia nada", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(sqlDe("outboarding-es-baja-27-11.sql"));
  assert.deepEqual(await estados(db), { a_act: "baja", a_cursa: "activo", a_egr: "baja", a_egr2: "graduado", a_reemb: "baja", a_ya: "baja" });
  const resp = await db.query<{ id: string; estado: string }>("select id, estado from respaldo.alumnos_outboarding_2711 order by id");
  assert.deepEqual(resp.rows.map((x) => [x.id, x.estado]), [["a_act", "activo"], ["a_egr", "graduado"]], "el respaldo guarda cómo estaban");
  const act = await db.query<{ detalle: string }>("select detalle from actividad where id = 'act_outboarding_baja_2711'");
  assert.match(act.rows[0].detalle, /^2 alumnos .* \(1 figuraban egresados, 1 activos, 0 otros\)/);
  await db.exec(sqlDe("outboarding-es-baja-27-11.sql"));
  assert.equal((await db.query("select * from actividad")).rows.length, 1, "no se anota dos veces");
  assert.deepEqual(await estados(db), { a_act: "baja", a_cursa: "activo", a_egr: "baja", a_egr2: "graduado", a_reemb: "baja", a_ya: "baja" });
});

test("SQL: desde ahora, pasar a Outboarding deja en baja, sacarlo lo vuelve activo y nadie le escribe otro estado mientras siga", { skip: saltear }, async () => {
  const db = await banco();
  await db.exec(sqlDe("outboarding-es-baja-27-11.sql"));
  /* Lili lo pasa a Outboarding desde cualquier pantalla (o una importación). */
  await db.exec(`update seguimiento_alumnos set "followUp" = 'OUTBOARDING' where "alumnoId" = 'a_cursa'`);
  assert.equal((await estados(db)).a_cursa, "baja");
  /* Una pestaña vieja guarda la fila entera con el estado de antes, o una compra lo reactiva: sigue en baja. */
  await db.exec(`update alumnos set estado = 'activo', nombre = 'Cursa' where id = 'a_cursa'`);
  await db.exec(`update alumnos set estado = 'graduado' where id = 'a_egr'`);
  assert.equal((await estados(db)).a_cursa, "baja");
  assert.equal((await estados(db)).a_egr, "baja");
  /* Lo saca de Outboarding: vuelve a activo; y ahí sí se le puede poner otro estado. */
  await db.exec(`update seguimiento_alumnos set "followUp" = 'Módulo 3' where "alumnoId" = 'a_cursa'`);
  assert.equal((await estados(db)).a_cursa, "activo");
  await db.exec(`update alumnos set estado = 'graduado' where id = 'a_cursa'`);
  assert.equal((await estados(db)).a_cursa, "graduado");
  /* La baja de la venta no la deshace el Follow Up. */
  await db.exec(`update seguimiento_alumnos set "followUp" = 'Devolución' where "alumnoId" = 'a_reemb'`);
  assert.equal((await estados(db)).a_reemb, "baja");
  /* Un alumno nuevo con su ficha en Outboarding (importación): nace activo y queda en baja al cargarse la ficha. */
  await db.exec(`insert into alumnos (id, nombre, estado) values ('a_nuevo', 'Nuevo', 'graduado');
    insert into seguimiento_alumnos (id, "alumnoId", "followUp") values ('s7', 'a_nuevo', 'Outbording')`);
  assert.equal((await estados(db)).a_nuevo, "baja");
  /* Un cambio que no es del Follow Up no toca el estado. */
  await db.exec(`update seguimiento_alumnos set "followUp" = 'Módulo 4' where "alumnoId" = 'a_egr2'`);
  assert.equal((await estados(db)).a_egr2, "graduado", "un egresado sin Outboarding sigue egresado");
});

/* ---------- La importación del Airtable: Outboarding entra como baja, no como egresado ---------- */
test("importar Clientes: quien viene en Outboarding con el egreso vencido entra como baja; sin Outboarding, egresado como antes", async () => {
  const { planificarImportacionCs, tablaDeHoja } = await import("@/lib/importar-cs");
  const { leerCSV } = await import("@/lib/pasarelas");
  const cols = "N.º de alumno,Nombre y apellido,Fecha de inicio,Fecha de egreso,Mail,Follow-up";
  const csv = [cols, "1,Uno Salió,01/03/2025,01/09/2025,uno@mail.com,OUTBOARDING", "2,Dos Egresó,01/03/2025,01/09/2025,dos@mail.com,", "3,Tres Cursa,01/10/2026,,tres@mail.com,Outboarding"].join("\n");
  const t = tablaDeHoja("Clientes", leerCSV(csv))!;
  const e = { ajustes: {}, alumnos: [], leads: [], contactos: [], ventas: [], cuotas: [], productos: [], equipo: [], etapasServicio: [{ id: "e1", nombre: "Onboarding", orden: 1 }],
    reportes: [], sesiones: [], seguimientos: [], testimonios: [], resells: [] } as unknown as EstadoApp;
  const p = planificarImportacionCs(e, [t], { modo: "completar", crearFaltantes: true, hoy: HOY, ahora: `${HOY}T12:00:00.000Z`, quien: "Importación" });
  const de = (n: string) => p.alumnos.find((a) => a.nombre === n)?.estado;
  assert.deepEqual([de("Uno Salió"), de("Dos Egresó"), de("Tres Cursa")], ["baja", "graduado", "baja"]);
});
