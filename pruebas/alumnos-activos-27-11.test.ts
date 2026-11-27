import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { construirSemilla } from "@/lib/seed";
import { alumnosActivos, cuentaPorSituacion, indiceDeSituaciones, SITUACION_ALUMNO, situacionDelAlumno, terminoElServicio } from "@/lib/situacion-alumno";
import { terminoElServicio as terminoDesdeSeguimiento, situacionDe } from "@/lib/seguimiento";
import { escrituraCliente, filasClientes, listasCs, resumenClientes } from "@/lib/clientes-cs";
import { panelDeServicio } from "@/lib/panel-servicio";
import { valorMetrica, alumnosActivos as activosDeMetricas } from "@/lib/metricas";
import { catalogo, Contexto, valorEn, type Corte } from "@/lib/kpis";
import type { Alumno, Cuota, EstadoApp, SeguimientoAlumno, Venta } from "@/lib/types";

/* ==================================================================
   Liliana, 27/11: «En ALUMNOS, con el filtro ACTIVOS, me figura un total de 701. No es real: adentro aparecen alumnos con
   estado outboarding (que serían las bajas) y reservas (que todavía no deberían contabilizarse ni como activos ni como bajas)».

   Una sola regla (lib/situacion-alumno.ts) y todas las pantallas que dicen «activos» la usan: la lista de Alumnos, el número del
   menú, el Dashboard, Clientes y el panel de Servicio. Los nombres son inventados (el repo es público).
   ================================================================== */

const HOY = "2026-11-27";

const alumno = (id: string, extra: Partial<Alumno> = {}): Alumno => ({
  id, nombre: `Alumno ${id}`, email: `${id}@mail.com`, estado: "activo", inicio: "2026-11-01T12:00:00.000Z", cohorte: "", plan: "Hackear AI",
  progreso: 0, cuotaMensual: 0, extra: {}, ...extra,
} as Alumno);
const venta = (id: string, estado: string): Venta => ({ id, estado, fecha: "2026-11-01T12:00:00.000Z", precioAcordado: 3000, moneda: "USD" } as unknown as Venta);
const cuota = (id: string, ventaId: string, c: Partial<Cuota>): Cuota => ({ id, ventaId, numero: 1, monto: 100, vence: "2026-11-01", estado: "pendiente", esReserva: false, ...c } as Cuota);
const seg = (alumnoId: string, followUp: string) => ({ alumnoId, followUp } as SeguimientoAlumno);

/* Uno de cada caso que había adentro de los 701. */
function estado(): EstadoApp {
  const base = construirSemilla();
  return {
    ...base,
    alumnos: [
      alumno("cursa", { ventaId: "v_cursa" }),
      alumno("cursa2"),
      alumno("outb", { ventaId: "v_outb" }),
      alumno("resPago", { ventaId: "v_res" }),
      alumno("resFu"),
      alumno("reemb", { ventaId: "v_reemb" }),
      alumno("resCancelada", { ventaId: "v_rescan" }),
      alumno("egresado", { estado: "graduado" }),
      alumno("baja", { estado: "baja" }),
      alumno("pausa", { estado: "pausado" }),
    ],
    seguimientos: [
      seg("cursa", "Módulo 2"),
      seg("outb", "OUTBOARDING"),
      seg("resFu", "RESERVA"),
      seg("reemb", "Devolución"),
      seg("egresado", "OUTBOARDING"),
    ],
    ventas: [venta("v_cursa", "activa"), venta("v_outb", "activa"), venta("v_res", "activa"), venta("v_reemb", "reembolsada"), venta("v_rescan", "cancelada")],
    cuotas: [
      cuota("c1", "v_cursa", { estado: "pagada" }),
      /* Sólo pagó la reserva y le falta el resto. */
      cuota("c2", "v_res", { estado: "pagada", esReserva: true }),
      cuota("c3", "v_res", { numero: 2, monto: 2900 }),
      /* La reserva de una venta que el closer dio de baja porque no se concretó. */
      cuota("c4", "v_rescan", { estado: "pagada", esReserva: true }),
      cuota("c5", "v_rescan", { numero: 2, monto: 2900 }),
    ],
    reportes: [], sesiones: [], testimonios: [], resells: [], revisionesCv: [],
  } as unknown as EstadoApp;
}

test("la regla, caso por caso: lo marcado a mano manda; venta de baja y Outboarding son baja; la reserva no es activa ni baja", () => {
  assert.equal(situacionDelAlumno({ estado: "activo" }), "activo");
  assert.equal(situacionDelAlumno({ estado: "activo", followUp: "Módulo 3" }), "activo");
  assert.equal(situacionDelAlumno({ estado: "activo", followUp: "OUTBOARDING" }), "baja");
  assert.equal(situacionDelAlumno({ estado: "activo", followUp: "Outbording" }), "baja", "como lo escriben a veces en el Airtable");
  assert.equal(situacionDelAlumno({ estado: "activo", enReserva: true }), "reserva");
  assert.equal(situacionDelAlumno({ estado: "activo", ventaDeBaja: true }), "baja");
  assert.equal(situacionDelAlumno({ estado: "activo", enReserva: true, ventaDeBaja: true }), "baja", "la reserva cuya venta se canceló ya no está pendiente: es baja");
  assert.equal(situacionDelAlumno({ estado: "activo", followUp: "CASO DE EXITO" }), "activo", "caso de éxito puede seguir con el contrato vigente");
  assert.equal(situacionDelAlumno({ estado: "graduado", followUp: "Módulo 2" }), "graduado");
  assert.equal(situacionDelAlumno({ estado: "baja" }), "baja");
  assert.equal(situacionDelAlumno({ estado: "pausado", enReserva: true }), "pausado");
  /* Un estado escrito de otra forma nunca cuenta como activo. */
  assert.equal(situacionDelAlumno({ estado: "egresado" as never }), "graduado");
  assert.equal(situacionDelAlumno({ estado: "inactivo" as never }), "baja");
  assert.equal(situacionDelAlumno({ estado: "" as never }), "baja");
  /* El seguimiento usa la misma regla y la misma definición de Outboarding (no hay dos copias). */
  assert.equal(terminoDesdeSeguimiento, terminoElServicio);
  assert.equal(situacionDe("activo", false, 3, "Módulo 1", false, true), "fuera", "venta reembolsada: fuera del seguimiento");
  assert.equal(situacionDe("activo", false, 3, "Módulo 1", true, false), "reserva");
  assert.equal(situacionDe("activo", false, 3, "Módulo 1", false, false), "vencido");
});

test("con los datos de la base, cada alumno cae donde dice Lili", () => {
  const e = estado();
  const de = indiceDeSituaciones(e);
  const por = Object.fromEntries(e.alumnos.map((a) => [a.id, de(a)]));
  assert.deepEqual(por, {
    cursa: "activo", cursa2: "activo", outb: "baja", resPago: "reserva", resFu: "reserva", reemb: "baja", resCancelada: "baja",
    egresado: "graduado", baja: "baja", pausa: "pausado",
  });
  assert.deepEqual(cuentaPorSituacion(e), { activo: 2, reserva: 2, pausado: 1, graduado: 1, baja: 4 });
  assert.deepEqual(alumnosActivos(e).map((a) => a.id), ["cursa", "cursa2"]);
});

test("todas las pantallas que dicen «activos» dan el mismo número", () => {
  const e = estado();
  const activos = alumnosActivos(e).length;
  assert.equal(activos, 2);
  /* Dashboard (la métrica y el KPI «Alumnos activos»). */
  assert.equal(activosDeMetricas(e).length, activos);
  assert.equal(valorMetrica(e, "alumnos-activos", { desde: new Date("2026-11-01"), hasta: new Date("2026-11-30") } as never), activos);
  const corte: Corte = { clave: "total", titulo: "Total", desde: "2026-11-01", hasta: "2026-11-30", foto: true, total: true };
  const kpi = catalogo(e).find((d) => d.id === "s_activos")!;
  assert.equal(valorEn(kpi, new Contexto(e, corte)), activos);
  /* Clientes: el número del atajo y lo que trae el atajo (filtra la columna «Estado del alumno» por «Activo»). */
  const filas = filasClientes(e, HOY);
  assert.equal(resumenClientes(filas).activos, activos);
  assert.equal(filas.filter((f) => f.estadoAlumno === SITUACION_ALUMNO.activo.texto).length, activos);
  assert.equal(filas.find((f) => f.id === "outb")!.estadoAlumno, "Baja");
  assert.equal(filas.find((f) => f.id === "resPago")!.estadoAlumno, "Reserva");
  assert.equal(filas.find((f) => f.id === "reemb")!.estadoAlumno, "Baja");
  /* Panel de Servicio: en servicio quedan los activos y las reservas (reciben la bienvenida); los que cerraron se cuentan aparte. */
  const p = panelDeServicio(e, HOY, new Date(`${HOY}T15:00:00.000Z`), []);
  const enServicio = new Set(p.cartera.filter((c) => c.enServicio).map((c) => c.id));
  assert.deepEqual([...enServicio].sort(), ["cursa", "cursa2", "resFu", "resPago"]);
  assert.equal(p.enOutboarding, 3, "outb, reemb y resCancelada: el campo dice activo y ya cerraron");
});

test("en Clientes, elegir «Activo» no guarda algo que no se va a ver: dice qué hay que cambiar", () => {
  const e = estado();
  const filas = filasClientes(e, HOY);
  const listas = listasCs(e.ajustes.seguimiento);
  const outb = escrituraCliente(filas.find((f) => f.id === "outb")!, "estadoAlumno", "Activo", listas);
  assert.equal(outb.tipo, "no");
  assert.match((outb as { motivo: string }).motivo, /Follow Up/);
  const reemb = escrituraCliente(filas.find((f) => f.id === "reemb")!, "estadoAlumno", "Activo", listas);
  assert.match((reemb as { motivo: string }).motivo, /reembolsada.*Finanzas/);
  const res = escrituraCliente(filas.find((f) => f.id === "resPago")!, "estadoAlumno", "Activo", listas);
  assert.match((res as { motivo: string }).motivo, /reserva/i);
  /* Dar de baja a mano, o volver a activo a quien se le había puesto «Baja» a mano, sigue escribiendo el campo. */
  assert.equal(escrituraCliente(filas.find((f) => f.id === "cursa")!, "estadoAlumno", "Baja", listas).tipo, "alumno");
  assert.deepEqual((escrituraCliente(filas.find((f) => f.id === "baja")!, "estadoAlumno", "Activo", listas) as { cambios: unknown }).cambios, { estado: "activo" });
  /* El egresado con el Follow Up en Outboarding seguiría contando como baja: también se le dice. */
  assert.equal(escrituraCliente(filas.find((f) => f.id === "egresado")!, "estadoAlumno", "Activo", listas).tipo, "no");
});

/* ---------- Que no vuelva a pasar ----------
   El error fue contar «activos» con el campo crudo (`alumnos.filter((a) => a.estado === "activo")`) en cada pantalla, cada una por su
   lado. Esta prueba frena si alguien vuelve a escribir esa cuenta: hay que usar `alumnosActivos()` o `indiceDeSituaciones()`. */
const PERMITIDOS: Record<string, string> = {
  /* Desempata entre dos alumnos con el mismo teléfono para atar la cuenta de Telegram: no es una cuenta. */
  "src/lib/telegram-identidades.ts": "desempate de Telegram",
  /* Recibe la situación ya calculada con la regla (SesionesZoomGeneral pasa `indiceDeSituaciones`): su `estado` no es el campo crudo. */
  "src/lib/zoom-asistencia.ts": "recibe la situación",
};
const CUENTA_CRUDA = /\.filter\(\s*\(?(\w+)\)?\s*=>\s*\1\.(alumno\.)?estado\s*===\s*["']activo["']\s*\)/;

function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
}

test("nadie vuelve a contar «activos» con el campo crudo: se usa la regla de lib/situacion-alumno.ts", () => {
  const raiz = join(import.meta.dirname, "..");
  const encontrados: string[] = [];
  for (const p of archivos(join(raiz, "src"))) {
    const rel = relative(raiz, p);
    if (PERMITIDOS[rel]) continue;
    readFileSync(p, "utf8").split("\n").forEach((linea, i) => { if (CUENTA_CRUDA.test(linea)) encontrados.push(`${rel}:${i + 1}`); });
  }
  assert.deepEqual(encontrados, [], `Cuentan «activos» con el campo crudo (usá alumnosActivos() o indiceDeSituaciones() de lib/situacion-alumno.ts): ${encontrados.join(", ")}`);
  /* La prueba de la prueba: la línea que tenía el menú antes del arreglo la habría frenado. */
  assert.ok(CUENTA_CRUDA.test(`"/alumnos": estado.alumnos.filter((a) => a.estado === "activo").length,`));
  assert.ok(CUENTA_CRUDA.test(`const activas = filas.filter((f) => f.alumno.estado === "activo");`));
});
