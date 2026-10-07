import test from "node:test";
import assert from "node:assert/strict";
import {
  DIAS_DE_ANTES, avisoDeCuenta, evaluarClosers, resumenDelDia, seParecen, type AccesoDeCuenta,
} from "@/lib/cuenta-closer";
import { anfitrionesPorMiembro } from "@/lib/pasar-llamadas";
import { TIPOS_POR_DEFECTO } from "@/lib/permisos";
import { miembroDeCloser } from "@/lib/crm";
import { CANCELADA, CON_CIERRE, SIN_CARGAR } from "@/lib/estados";
import type { MiembroEquipo, Sesion, TipoCuenta } from "@/lib/types";
import { miembro, porSemillas, sumarDias, type Azar } from "./azar";

/* ==================================================================
   La cuenta del closer a prueba de tontos (lib/cuenta-closer.ts): quién va
   a ver sus llamadas y por qué no, con equipos, accesos y llamadas al azar,
   contra un oráculo escrito aparte de la regla «correo en Equipo + anfitrión
   de Calendly con su nombre + un acceso de sólo lo suyo».
   ================================================================== */

const AHORA = Date.parse("2026-10-08T14:00:00.000Z");
const DIA = 86_400_000;

const NOMBRES = ["Mariano", "Dante Barbieri", "Valentín Abadía", "Lucía Pérez", "Ana María", "Juan Cruz", "Santiago Burghiani", "Yari Taft", "Eduardo Viejo", "Nico"];
const HOSTS = ["Mariano Arias", "mariano", "Dante Barbieri", "Dante", "Valentin Abadia", "V. Abadia", "Lucia Perez", "Ana Maria Gomez", "Juan Cruz Lopez", "Juan", "Externo Uno", "Otro Externo", "Eduardo Viejo", "  "];
const ROLES = ["closer", "director", "admin", "dueno", "equipo", "setter", "no_existe"] as const;

function mundo(r: Azar) {
  const equipo: MiembroEquipo[] = [];
  for (const n of r.mezclar(NOMBRES)) {
    if (r.si(0.3)) continue;
    equipo.push(miembro(`m${equipo.length}`, n, r.elige(["closer", "closer", "closer", "director", "ceo", "setter"] as const), {
      activo: r.si(0.85), ...(r.si(0.7) ? { email: r.elige([`${n.split(" ")[0].toLowerCase()}@a.com`, `  ${n.split(" ")[0].toUpperCase()}@A.com `]) } : {}),
    }));
  }
  const sesiones = Array.from({ length: r.entre(0, 25) }, () => ({
    anfitrion: r.elige(HOSTS), inicia: new Date(AHORA + r.entre(-120, 30) * DIA).toISOString(),
  })) as Pick<Sesion, "anfitrion" | "inicia">[];
  const accesos: AccesoDeCuenta[] | null = r.si(0.2) ? null : Array.from({ length: r.entre(0, 8) }, () => {
    const n = r.elige(NOMBRES);
    return { email: r.elige([`${n.split(" ")[0].toLowerCase()}@a.com`, `${n.split(" ")[0].toUpperCase()}@a.com`, "otro@a.com"]), nombre: n, rol: r.elige(ROLES) };
  });
  return { equipo, sesiones, accesos };
}

const correo = (m: MiembroEquipo) => m.email?.trim().toLowerCase() ?? "";
const tipo = (id: string): TipoCuenta | undefined => TIPOS_POR_DEFECTO.find((t) => t.id === id);
const soloLoSuyo = (rol: string) => rol !== "dueno" && Boolean(tipo(rol)?.soloLoSuyo);

test("500 semillas: quién va a ver sus llamadas, contra el oráculo (correo, acceso y anfitrión de Calendly)", () => {
  let ok = 0, noVe = 0, sinAcceso = 0, conSugerido = 0, accesosHuerfanos = 0;
  porSemillas(500, 1, (r) => {
    const { equipo, sesiones, accesos } = mundo(r);
    const res = evaluarClosers({ equipo, sesiones }, accesos, TIPOS_POR_DEFECTO, AHORA);
    const activos = equipo.filter((m) => m.activo && m.rol === "closer");
    assert.deepEqual(res.closers.map((c) => c.miembro.id), activos.map((m) => m.id));
    const emailsDeAcceso = new Map((accesos ?? []).map((a) => [a.email.trim().toLowerCase(), a]));
    for (const c of res.closers) {
      const m = c.miembro;
      const acc = accesos === null ? undefined : correo(m) ? emailsDeAcceso.get(correo(m)) ?? null : null;
      assert.equal(c.acceso, acc);
      const suyos = sesiones.map((s) => s.anfitrion?.trim() ?? "").filter((h) => h && miembroDeCloser(h, equipo)?.id === m.id);
      assert.equal(c.anfitriones.reduce((a, x) => a + x.llamadas, 0), suyos.length, `llamadas de ${m.nombre}`);
      const veTodo = Boolean(acc) && !soloLoSuyo(acc!.rol);
      assert.equal(c.veTodo, veTodo);
      /* El oráculo: no ve nada si le falta el correo o las llamadas a su nombre (salvo que su acceso vea todo); no puede entrar si tiene correo y no hay acceso. */
      const faltaCorreo = !veTodo && !correo(m);
      const faltaAnfitrion = !veTodo && suyos.length === 0;
      const faltaAcceso = !veTodo && Boolean(correo(m)) && acc === null;
      const esperado = faltaCorreo || faltaAnfitrion ? "no-ve" : faltaAcceso ? "sin-acceso" : "ok";
      assert.equal(c.estado, esperado, `${m.nombre} (${m.email ?? "sin correo"})`);
      assert.deepEqual(c.problemas.map((p) => p.tipo).sort(), [faltaCorreo && "sin-correo", faltaAnfitrion && "sin-anfitrion", faltaAcceso && "sin-acceso"].filter(Boolean).sort());
      if (esperado === "ok") ok++; else if (esperado === "no-ve") noVe++; else sinAcceso++;
      const sug = c.problemas.find((p) => p.tipo === "sin-correo");
      if (sug && "sugerido" in sug && sug.sugerido) { conSugerido++; assert.ok(miembroDeCloser(sug.sugerido.nombre, [m]), "el sugerido se llama como él"); }
    }
    /* Los accesos de «sólo lo suyo» cuyo correo no está en Equipo. */
    const correos = new Set(equipo.map(correo).filter(Boolean));
    const huerfanos = (accesos ?? []).filter((a) => soloLoSuyo(a.rol) && !correos.has(a.email.trim().toLowerCase()));
    assert.deepEqual(res.accesosSinMiembro.map((x) => x.acceso), huerfanos);
    accesosHuerfanos += huerfanos.length;
    for (const x of res.accesosSinMiembro) {
      const sinCorreo = activos.filter((m) => !correo(m));
      assert.deepEqual([...x.candidatos].map((m) => m.id).sort(), sinCorreo.map((m) => m.id).sort());
      /* Los que se le parecen, primero. */
      const parecidos = x.candidatos.map((m) => seParecen(x.acceso.nombre, m.nombre));
      assert.deepEqual(parecidos, [...parecidos].sort((a, b) => Number(b) - Number(a)));
    }
    assert.equal(res.sinVer, res.closers.filter((c) => c.estado === "no-ve").length + res.accesosSinMiembro.length);
    /* Anfitriones sin dueño: con llamadas de los últimos 60 días en adelante y de nadie del equipo. */
    const cuenta = new Map<string, number>();
    for (const s of sesiones) { const h = s.anfitrion?.trim(); if (h && Date.parse(s.inicia) >= AHORA - 60 * DIA) cuenta.set(h, (cuenta.get(h) ?? 0) + 1); }
    const sueltos = [...cuenta].filter(([h]) => !miembroDeCloser(h, equipo));
    assert.deepEqual(res.anfitrionesSinDueno.map((x) => [x.nombre, x.llamadas]).sort(), sueltos.sort());
    for (const a of res.anfitrionesSinDueno) for (const c of a.candidatos) assert.ok(c.activo && c.rol === "closer" && seParecen(a.nombre, c.nombre));
    /* Y lo que cada closer sin anfitrión ve como candidato son los sueltos que se le parecen. */
    for (const c of res.closers) {
      const p = c.problemas.find((x) => x.tipo === "sin-anfitrion");
      if (p && p.tipo === "sin-anfitrion") assert.deepEqual(p.candidatos.map((x) => x.nombre).sort(), res.anfitrionesSinDueno.filter((a) => seParecen(a.nombre, c.miembro.nombre)).map((a) => a.nombre).sort());
    }
  });
  assert.ok(ok > 100 && noVe > 500 && sinAcceso > 50 && accesosHuerfanos > 50, `ok ${ok}, no ve ${noVe}, sin acceso ${sinAcceso}, huérfanos ${accesosHuerfanos}, sugeridos ${conSugerido}`);
});

test("los anfitriones de cada uno cuentan cada llamada una sola vez y en el miembro que dice la regla (300 semillas)", () => {
  porSemillas(300, 1000, (r) => {
    const { equipo, sesiones } = mundo(r);
    const por = anfitrionesPorMiembro(sesiones, equipo);
    let total = 0;
    for (const [id, xs] of por) {
      assert.ok(equipo.some((m) => m.id === id));
      for (const x of xs) { total += x.llamadas; assert.equal(miembroDeCloser(x.nombre, equipo)?.id, id); assert.ok(x.llamadas > 0); }
      /* El más usado primero; a igual cantidad, el más corto. */
      for (let i = 1; i < xs.length; i++) assert.ok(xs[i - 1].llamadas > xs[i].llamadas || (xs[i - 1].llamadas === xs[i].llamadas && xs[i - 1].nombre.length <= xs[i].nombre.length));
    }
    const conDueno = sesiones.filter((s) => { const h = s.anfitrion?.trim(); return h && miembroDeCloser(h, equipo); }).length;
    assert.equal(total, conDueno);
  });
});

test("avisoDeCuenta: sólo habla cuando se sabe (hay datos, sesión y es de sólo lo suyo)", () => {
  for (const soloLoSuyo of [true, false]) for (const email of [null, "x@a.com"]) for (const cargado of [true, false]) for (const miembro of [undefined, { nombre: "Dante" }]) for (const llamadasVisibles of [0, 3]) {
    const a = avisoDeCuenta({ soloLoSuyo, email, miembro, llamadasVisibles, cargado });
    if (!soloLoSuyo || !email || !cargado) assert.equal(a, null);
    else if (!miembro) assert.deepEqual(a, { tipo: "sin-miembro", email });
    else assert.deepEqual(a, llamadasVisibles === 0 ? { tipo: "sin-llamadas", nombre: "Dante" } : null);
  }
});

test("resumenDelDia: las de hoy (sin canceladas), las de hoy sin cargar y las de los 14 días anteriores sin cargar, con sus bordes (300 semillas)", () => {
  porSemillas(300, 2000, (r) => {
    const hoy = sumarDias("2026-10-01", r.entre(0, 25));
    const filas = Array.from({ length: r.entre(0, 40) }, () => {
      const dia = sumarDias(hoy, r.entre(-20, 3));
      const resultado = r.elige([CANCELADA, CON_CIERRE, SIN_CARGAR, "Sin cierre", "Por venir"]);
      return { dia, resultado, sinCargar: resultado === SIN_CARGAR || r.si(0.1) };
    });
    const res = resumenDelDia(filas, hoy);
    const desde = sumarDias(hoy, -DIAS_DE_ANTES);
    assert.equal(res.hoy, filas.filter((f) => f.dia === hoy && f.resultado !== CANCELADA).length);
    assert.equal(res.sinCargarHoy, filas.filter((f) => f.dia === hoy && f.sinCargar).length);
    assert.equal(res.sinCargarAntes, filas.filter((f) => f.dia < hoy && f.dia >= desde && f.sinCargar).length);
    for (const v of Object.values(res)) assert.ok(Number.isInteger(v) && v >= 0);
  });
  assert.equal(DIAS_DE_ANTES, 14);
  /* El borde: hace 14 días entra; hace 15, no. */
  const hoy = "2026-10-20";
  const r = resumenDelDia([{ dia: "2026-10-06", resultado: SIN_CARGAR, sinCargar: true }, { dia: "2026-10-05", resultado: SIN_CARGAR, sinCargar: true }], hoy);
  assert.equal(r.sinCargarAntes, 1);
});

test("seParecen: simétrica y reflexiva, y no une nombres vacíos ni de una sola letra (400 semillas)", () => {
  porSemillas(400, 3000, (r) => {
    const a = r.elige([...NOMBRES, ...HOSTS, "", "A", "  ", "Á B"]), b = r.elige([...NOMBRES, ...HOSTS, "", "A", "  ", "B Á"]);
    assert.equal(seParecen(a, b), seParecen(b, a), `«${a}» y «${b}»`);
    /* Las palabras de una letra («V.») no cuentan: sin ninguna de dos letras no hay con qué parecerse. */
    if (a.normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^A-Za-z0-9]+/).some((w) => w.length > 1)) assert.equal(seParecen(a, a), true, a);
  });
  assert.equal(seParecen("", ""), false);
  assert.equal(seParecen("Dante Barbieri", "Dante"), true);
  assert.equal(seParecen("V. Abadia", "Valentín Abadía"), true);
  assert.equal(seParecen("Mariano Arias", "Dante Barbieri"), false);
});
