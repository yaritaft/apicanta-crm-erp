import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { esSesionUnoAUno } from "@/lib/bonos";
import { sesionesUnoAUnoQueVienen } from "@/lib/mi-panel";
import { testimonioDeLaLlamada } from "@/lib/clientes-cs";
import { hojaDelAviso } from "@/lib/avisos";
import type { Alumno, EstadoApp, SeguimientoAlumno, Sesion } from "@/lib/types";

/* Lili (04/11): la sesión 1 a 1 de Calendly en la ficha y en el panel del mentor; los avisos de las llamadas cerradas; el
   testimonio de ESA llamada al cerrarla. Lo de la base está en pruebas/sesiones-1a1-y-avisos-sql.test.ts. */

test("1 a 1: el evento de Yari y sus variantes, no las llamadas de venta ni un «11 a 12»", () => {
  for (const tipo of ["Sesión 1 a 1", "Sesion 1:1", "sesion-1-a-1", "Mentoría uno a uno", "1 a 1 con Nahue"]) assert.equal(esSesionUnoAUno({ tipo }), true, tipo);
  for (const tipo of ["Llamada de Asesoramiento - VSL - Team", "Testimonio", "Clase 11 a 12", "60 Minute Meeting", ""]) assert.equal(esSesionUnoAUno({ tipo }), false, tipo);
  assert.equal(esSesionUnoAUno({ tipo: "Reunión", titulo: "Sesión 1 a 1" }), true, "también por el título");
  // El SQL usa el mismo criterio.
  const sql = readFileSync(new URL("../supabase/sesiones-1a1-y-avisos-de-resell.sql", import.meta.url), "utf8");
  assert.ok(sql.includes(String.raw`((^|[^0-9])1\s*(a|:|-a-|-)\s*1([^0-9]|$)|uno a uno)`));
});

const ses = (id: string, inicia: string, x: Partial<Sesion> = {}): Sesion =>
  ({ id, titulo: "Sesión 1 a 1", tipo: "Sesión 1 a 1", inicia, duracionMin: 60, estado: "agendada", origen: "calendly", creadoEn: inicia, anfitrion: "Yari Taft", ...x }) as Sesion;
const alumno = (id: string, email: string, estado = "activo"): Alumno => ({ id, nombre: id, email, estado }) as Alumno;

test("Mi panel de Yari: sus 1 a 1 de hoy en adelante, con el alumno y qué número de su contrato es", () => {
  const ahora = Date.parse("2026-11-05T15:00:00Z");
  const e = {
    equipo: [{ id: "eq_yari", nombre: "Yari", rol: "ceo", activo: true }, { id: "eq_socio", nombre: "Nahuel Abadía", rol: "socio", activo: true }],
    alumnos: [alumno("Baliño", "mariano.a.balino@gmail.com"), alumno("Baliño viejo", "MARIANO.A.BALINO@gmail.com", "egresado")],
    seguimientos: [{ alumnoId: "Baliño", sesionesMentor: 2, sesionesUnoAUno: [
      { id: "a", fecha: "2026-10-01", con: "Yari", notas: "", grabacion: "", creadoEn: "", creadoPor: "" },
      { id: "l", fecha: "2026-10-02", con: "Lili", notas: "", grabacion: "", creadoEn: "", creadoPor: "" },
      { id: "c", fecha: "2026-11-16", con: "Yari", notas: "", grabacion: "", creadoEn: "", creadoPor: "", sesionId: "cal_balino" },
    ] } as unknown as SeguimientoAlumno],
    sesiones: [
      ses("cal_balino", "2026-11-16T18:00:00Z", { email: " Mariano.A.Balino@gmail.com" }),
      ses("cal_hoy_temprano", "2026-11-05T11:00:00Z", { invitado: "Ianco", email: "nadie@x.com" }),
      ses("cal_ayer", "2026-11-04T18:00:00Z"),
      ses("cal_cancelada", "2026-11-20T18:00:00Z", { estado: "cancelada" }),
      ses("cal_nahuel", "2026-12-02T18:00:00Z", { anfitrion: "Nahuel Abadía" }),
      ses("cal_venta", "2026-11-10T18:00:00Z", { tipo: "Llamada de Asesoramiento - VSL - Team", titulo: "x" }),
    ],
  } as unknown as Pick<EstadoApp, "sesiones" | "equipo" | "alumnos" | "seguimientos">;
  const r = sesionesUnoAUnoQueVienen(e, { nombre: "Yari" }, ahora);
  assert.deepEqual(r.map((x) => [x.sesion.id, x.alumno?.id ?? null, x.numero, x.incluidas]), [
    ["cal_hoy_temprano", null, 1, null],
    ["cal_balino", "Baliño", 2, 2],
  ], "la de hoy a la mañana sigue; la de ayer, la cancelada, la de Nahuel y la de venta no; la de Lili no cuenta");
  assert.deepEqual(sesionesUnoAUnoQueVienen(e, { nombre: "Nahuel Abadía" }, ahora).map((x) => x.sesion.id), ["cal_nahuel"]);
});

test("al cerrar la llamada, el testimonio de ese día (Jean Camacho tenía dos creados en el mismo momento)", () => {
  const t = (id: string, fechaGrabacion: string | null, creadoEn = "2026-10-19T22:56:36.425Z") => ({ id, alumnoId: "alu_jean", fechaGrabacion, creadoEn });
  const lista = [t("tes_1", null), t("tes_2", "2026-10-14"), { ...t("tes_otro", "2026-10-14"), alumnoId: "otro" }];
  assert.equal(testimonioDeLaLlamada(lista, "alu_jean", "2026-10-14")?.id, "tes_2");
  assert.equal(testimonioDeLaLlamada([t("v", null, "2026-09-01"), t("n", null, "2026-10-01")], "alu_jean", "2026-10-14")?.id, "n", "sin uno de ese día, el más nuevo");
  assert.equal(testimonioDeLaLlamada(lista, "nadie", "2026-10-14"), undefined);
});

test("cada aviso abre la ficha en su solapa", () => {
  assert.deepEqual(["sesion-1a1", "resell-cerrado", "resell-outboarding", "outboarding", "contrato", "mencion"].map(hojaDelAviso),
    ["bonos", "testimonio", "accesos", "accesos", "contrato", undefined]);
});
