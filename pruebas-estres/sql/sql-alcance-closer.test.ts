/* Estrés de «sólo lo suyo» (supabase/tipos-cuenta.sql): qué filas ve cada persona de las tablas con alcance (llamadas, ventas, cuotas,
   cobros, leads, personas, chat, alumnos y actividad) con datos al azar, contra un modelo escrito aparte con lo que dice el encabezado
   del SQL y el README, en un Postgres en memoria (PGlite).

   «Sólo lo suyo» (el closer): sus llamadas (el anfitrión de Calendly es él, por su nombre en Equipo), sus ventas (de closer o de setter, y las
   que tienen cuotas que heredó) con sus cuotas y cobros, y la gente de esas llamadas y ventas (y lo que creó él). Quien no es «sólo lo suyo»
   ve todo lo que su tipo de cuenta lee (LEEN de src/lib/permisos.ts). El nombre del anfitrión se resuelve con miembroDeCloser() de la app.

   Necesita PGlite (ver pg-arnes.ts); sin él, se saltea. */
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { miembroDeCloser } from "@/lib/crm";
import { puedeLeer, puedeEditar, nivelEn, type MiAcceso } from "@/lib/permisos";
import { Azar, cargarPglite, lit, montarBanco, personasPorDefecto, type Banco, type PersonaConAcceso } from "./pg-arnes";

const Pg = await cargarPglite();
const saltear = Pg ? false : "PGlite no está en el disco (ver pruebas/stress/pg-arnes.ts)";

let compartido: Promise<Banco> | null = null;
const banco = (): Promise<Banco> => (compartido ??= montarBanco(Pg!, { archivos: ["devoluciones.sql", "customer-success.sql"], veces: 1 }));
after(async () => { if (compartido) await (await compartido).db.close(); });

type Fila = Record<string, string | null>;
interface Datos {
  equipo: { id: string; nombre: string; email: string | null; activo: boolean }[];
  sesiones: Fila[]; leads: Fila[]; contactos: Fila[]; comentarios: Fila[]; ventas: Fila[]; cuotas: Fila[]; pagos: Fila[]; alumnos: Fila[]; actividad: Fila[];
}

/* Nombres sin ñ ni ç (la base tiene un bug con ésas: ver sql-nombres-closer.test.ts). */
/* Gente de Equipo sin acceso a la app (sólo figuran como anfitriones o responsables) y el nombre de los que sí entran. */
const SIN_ACCESO = ["Valentin Abadia", "Lucia Gomez", "Martin Perez", "Noelia"];
const NOMBRE_DE: Record<string, string> = { m_dante: "Dante Closer", m_otro: "Otro Closer", m_x1: "Equis Uno", m_x2: "Equis Dos", m_x3: "Equis Tres" };
const HOSTS = [...SIN_ACCESO, ...Object.values(NOMBRE_DE), "Dante", "OTRO CLOSER", "Valentín Abadía", "Equis Uno Perez", "equis dos", "Alguien Que No Es Del Equipo", "Lucia Gomez Extra"];

function generar(az: Azar, personas: PersonaConAcceso[]): Datos {
  const miembros = personas.filter((p) => p.miembroId);
  const equipo = [
    ...SIN_ACCESO.map((nombre, i) => ({ id: `n${i}`, nombre, email: null as string | null, activo: true })),
    ...miembros.map((p) => ({ id: p.miembroId!, nombre: NOMBRE_DE[p.miembroId!] ?? p.miembroId!, email: p.email, activo: true })),
  ];
  const id = (p: string, n: number) => `${p}${n}`;
  const alguien = () => az.elegir(equipo).id;
  const maybe = <T,>(x: T): T | null => (az.bool(0.85) ? x : null);
  const contactos = Array.from({ length: 10 }, (_, i): Fila => ({ id: id("ct", i), creadoPor: az.bool(0.2) ? az.elegir(miembros).email : "" }));
  const leads = Array.from({ length: 10 }, (_, i): Fila => ({ id: id("l", i), contactoId: maybe(az.elegir(contactos).id), responsable: maybe(az.elegir(HOSTS)), creadoPor: az.bool(0.2) ? az.elegir(miembros).email : "" }));
  const sesiones = Array.from({ length: 12 }, (_, i): Fila => ({ id: id("s", i), anfitrion: az.elegir(HOSTS), leadId: maybe(az.elegir(leads).id), contactoId: maybe(az.elegir(contactos).id) }));
  const ventas = Array.from({ length: 12 }, (_, i): Fila => ({ id: id("v", i), closerId: alguien(), setterId: az.bool(0.3) ? alguien() : null, contactoId: maybe(az.elegir(leads).id) }));
  const cuotas = Array.from({ length: 16 }, (_, i): Fila => ({ id: id("c", i), ventaId: az.elegir(ventas).id, closerId: az.bool(0.25) ? alguien() : null }));
  const pagos = Array.from({ length: 16 }, (_, i): Fila => ({ id: id("p", i), cuotaId: az.elegir(cuotas).id }));
  const comentarios = Array.from({ length: 12 }, (_, i): Fila => ({ id: id("cm", i), contactoId: az.elegir(contactos).id }));
  const alumnos = Array.from({ length: 8 }, (_, i): Fila => ({ id: id("a", i), ventaId: az.bool(0.8) ? az.elegir(ventas).id : null }));
  const ENTIDADES = ["lead", "contacto", "sesion", "transaccion", "alumno", "webinar", "campania", "meta", "config", "otra"];
  const actividad = Array.from({ length: 30 }, (_, i): Fila => {
    const entidad = az.elegir(ENTIDADES);
    const entidadId = entidad === "lead" ? az.elegir(leads).id : entidad === "contacto" ? az.elegir(contactos).id : entidad === "sesion" ? az.elegir(sesiones).id
      : entidad === "transaccion" ? (az.bool(0.7) ? az.elegir(ventas).id : "gasto-" + i) : id("x", i);
    return { id: id("ac", i), entidad, entidadId, creadoPor: az.bool(0.15) ? az.elegir(miembros).email : "" };
  });
  return { equipo, sesiones, leads, contactos, comentarios, ventas, cuotas, pagos, alumnos, actividad };
}

async function cargar(b: Banco, d: Datos): Promise<void> {
  await b.ejecutar(`truncate public.equipo, public.actividad, public.alumnos, public.pagos, public.cuotas, public.ventas, public.comentarios, public.sesiones, public.leads, public.contactos cascade`);
  const insertar = async (tabla: string, filas: Fila[]) => {
    if (!filas.length) return;
    const cols = Object.keys(filas[0]);
    await b.ejecutar(`insert into public.${tabla} (${cols.map((c) => `"${c}"`).join(",")}) values ${filas.map((f) => `(${cols.map((c) => lit(f[c])).join(",")})`).join(",")}`);
  };
  await b.ejecutar(`insert into public.equipo (id, nombre, email, activo) values ${d.equipo.map((m) => `(${lit(m.id)}, ${lit(m.nombre)}, ${lit(m.email)}, ${m.activo})`).join(",")}`);
  await insertar("contactos", d.contactos); await insertar("leads", d.leads); await insertar("sesiones", d.sesiones);
  await insertar("ventas", d.ventas); await insertar("cuotas", d.cuotas); await insertar("pagos", d.pagos);
  await insertar("comentarios", d.comentarios); await insertar("alumnos", d.alumnos); await insertar("actividad", d.actividad);
}

/* ---------- el modelo ---------- */

function modelo(d: Datos, p: PersonaConAcceso): Record<string, Set<string>> {
  const a: MiAcceso = p.acceso;
  const solo = a.soloLoSuyo && a.tipo !== "dueno";
  const yo = d.equipo.find((m) => m.email && m.email.toLowerCase() === p.email)?.id;
  const soy = (nombre: string | null) => Boolean(yo && nombre && miembroDeCloser(nombre, d.equipo)?.id === yo);
  const misSesiones = new Set(d.sesiones.filter((s) => soy(s.anfitrion)).map((s) => s.id!));
  const misVentas = new Set(d.ventas.filter((v) => v.closerId === yo || v.setterId === yo || d.cuotas.some((c) => c.ventaId === v.id && c.closerId === yo)).map((v) => v.id!));
  const misCuotas = new Set(d.cuotas.filter((c) => c.closerId === yo || misVentas.has(c.ventaId!)).map((c) => c.id!));
  const sesMias = d.sesiones.filter((s) => misSesiones.has(s.id!));
  const misLeads = new Set(d.leads.filter((l) => soy(l.responsable) || sesMias.some((s) => s.leadId === l.id) || sesMias.some((s) => s.contactoId && s.contactoId === l.contactoId)
    || d.ventas.some((v) => misVentas.has(v.id!) && v.contactoId === l.id) || (l.creadoPor && l.creadoPor === p.email)).map((l) => l.id!));
  const misContactos = new Set([
    ...sesMias.map((s) => s.contactoId).filter((x): x is string => Boolean(x)),
    ...d.leads.filter((l) => misLeads.has(l.id!)).map((l) => l.contactoId).filter((x): x is string => Boolean(x)),
    ...d.contactos.filter((c) => c.creadoPor && c.creadoPor === p.email).map((c) => c.id!),
  ]);
  const todo = (filas: Fila[]) => new Set(filas.map((f) => f.id!));
  const cuando = (ok: boolean, filas: Fila[], f: (x: Fila) => boolean) => (!ok ? new Set<string>() : solo ? new Set(filas.filter(f).map((x) => x.id!)) : todo(filas));
  const veAlumnos = puedeLeer(a, "alumnos");
  const editaVentas = puedeEditar(a, "ventas");
  const ventasQueVe = puedeLeer(a, "ventas");
  const esDueno = a.tipo === "dueno";
  const veActividad = (x: Fila): boolean => {
    if (esDueno || (x.creadoPor && x.creadoPor === p.email)) return true;
    switch (x.entidad) {
      case "lead": return puedeLeer(a, "leads") && (!solo || misLeads.has(x.entidadId!));
      case "contacto": return puedeLeer(a, "contactos") && (!solo || misContactos.has(x.entidadId!));
      case "sesion": return puedeLeer(a, "sesiones") && (!solo || misSesiones.has(x.entidadId!));
      case "transaccion": return puedeLeer(a, "movimientos") || (ventasQueVe && d.ventas.some((v) => v.id === x.entidadId) && (!solo || misVentas.has(x.entidadId!)));
      case "alumno": return puedeLeer(a, "alumnos");
      case "webinar": return true;
      case "campania": case "meta": return a.areas.marketing !== undefined || a.areas.webinars !== undefined || a.areas.finanzas !== undefined;
      case "config": return nivelEn(a, "ajustes") >= 1;
      default: return false;
    }
  };
  return {
    sesiones: cuando(puedeLeer(a, "sesiones"), d.sesiones, (s) => misSesiones.has(s.id!)),
    ventas: cuando(ventasQueVe, d.ventas, (v) => misVentas.has(v.id!) || v.closerId === yo || v.setterId === yo),
    cuotas: cuando(puedeLeer(a, "cuotas"), d.cuotas, (c) => c.closerId === yo || misVentas.has(c.ventaId!)),
    pagos: cuando(puedeLeer(a, "pagos"), d.pagos, (x) => misCuotas.has(x.cuotaId!)),
    leads: cuando(puedeLeer(a, "leads"), d.leads, (l) => misLeads.has(l.id!) || Boolean(l.creadoPor && l.creadoPor === p.email)),
    contactos: cuando(puedeLeer(a, "contactos"), d.contactos, (c) => misContactos.has(c.id!) || Boolean(c.creadoPor && c.creadoPor === p.email)),
    comentarios: cuando(puedeLeer(a, "comentarios"), d.comentarios, (c) => misContactos.has(c.contactoId!)),
    alumnos: new Set(d.alumnos.filter((x) => veAlumnos || (editaVentas && x.ventaId && (!solo || misVentas.has(x.ventaId)))).map((x) => x.id!)),
    actividad: new Set(d.actividad.filter(veActividad).map((x) => x.id!)),
  };
}

test("lo que ve cada tipo de cuenta de las tablas con «sólo lo suyo» es lo que dice el modelo, con datos al azar", { skip: saltear }, async () => {
  const b = await banco();
  /* Las personas de fábrica y tres tipos «sólo lo suyo» con otras combinaciones de áreas, cada una con su lugar en Equipo. */
  const extra: PersonaConAcceso[] = [];
  const extras: [string, MiAcceso["areas"]][] = [
    ["x1", { crm: "editar", ventas: "ver", leads: "ver" }], ["x2", { finanzas: "editar", alumnos: "ver" }], ["x3", { ventas: "editar", clientes: "ver", marketing: "ver" }],
  ];
  for (const [nombre, areas] of extras) {
    const email = `${nombre}@x.com`, tipo = `solo_${nombre}`, miembroId = `m_${nombre}`;
    await b.servicio(`insert into public.tipos_cuenta (id, nombre, areas, "soloLoSuyo") values (${lit(tipo)}, ${lit(tipo)}, ${lit(areas)}, true)`);
    await b.servicio(`insert into public.usuarios_permitidos (email, rol) values (${lit(email)}, ${lit(tipo)})`);
    extra.push({ email, tipo, miembroId, acceso: { tipo, nombre: tipo, areas, soloLoSuyo: true, miembroId } });
  }
  const personas = [...personasPorDefecto(), ...extra];
  /* Los de fábrica ya están dados de alta en la base por montarBanco(); los extra, recién. */
  let comparadas = 0, conAlgo = 0;
  for (const semilla of [11, 22, 33]) {
    const az = new Azar(semilla);
    const datos = generar(az, personas);
    await cargar(b, datos);
    for (const p of personas) {
      const esperado = modelo(datos, p);
      for (const [tabla, ids] of Object.entries(esperado)) {
        const r = await b.intentar<{ id: string }>(p.email, `select id from public.${tabla} order by id`);
        assert.ok(r.ok, `${tabla} como ${p.tipo}: ${r.ok ? "" : r.mensaje}`);
        const real = new Set(r.ok ? r.rows.map((x) => x.id) : []);
        const sobran = [...real].filter((x) => !ids.has(x)), faltan = [...ids].filter((x) => !real.has(x));
        assert.deepEqual({ sobran, faltan }, { sobran: [], faltan: [] }, `semilla ${semilla}: ${tabla} que ve ${p.tipo} (${JSON.stringify(p.acceso.areas)}, soloLoSuyo=${p.acceso.soloLoSuyo}, miembro ${p.miembroId})`);
        comparadas++; if (ids.size) conAlgo++;
      }
    }
  }
  assert.ok(comparadas >= 300 && conAlgo >= 100, `se probó poco: ${comparadas} comparaciones, ${conAlgo} con filas`);
});
