import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alumnoConLaCompra, renuevaElPrograma, tomaElServicio } from "@/lib/alumnos";
import { contratoDeEstaCompra, contratoDeOtraCompra, type Contrato } from "@/lib/contratos";
import { darAccesos, idDeAcceso, marcasDeLaFicha } from "@/lib/accesos-servidor";
import { PROGRAMAS_POR_DEFECTO, type Programa } from "@/lib/programas";
import { baseEnMemoria, conServiciosFalsos, type Fila } from "./ayudas-accesos";
import type { Alumno, EstadoApp, Venta } from "@/lib/types";

/* Lanzamiento interno (Manuel, 20/11): los de Downsell pasan a Hackear AI pagando la diferencia y los de Hackear AI renuevan y entran a
   Principals. «¿Cómo se hace el envío de todos los accesos?». Juan Cruz: «cargás la nueva venta y se generan los accesos que faltan».
   No pasaba así:
   1. El asistente dejaba elegido «Ya se le mandó» porque la persona tenía firmado el contrato del Downsell: no salía el del programa
      y, sin contrato, no se daban los accesos.
   2. La venta nueva no le cambiaba nada al alumno (seguía «Downsell», con la venta vieja en Pagos) y, si la cargaba un closer que no lo
      ve, nacía OTRO alumno con la venta nueva (Josue Alvarado, Upgrade AI del 04/11): el contrato y los accesos iban a la copia. */

const productos = [
  { id: "prod_downsell", nombre: "Downsell", tipo: "downsell" },
  { id: "prod_hackear_ai", nombre: "Hackear AI", tipo: "principal" },
  { id: "prod_upgrade_mentoria", nombre: "Upgrade a mentoría", tipo: "upsell" },
  { id: "prod_principals", nombre: "Principals", tipo: "principal" },
  { id: "prod_extension_mid", nombre: "Extensión mentoría MID (+2 meses)", tipo: "upsell" },
  { id: "prod_hackear_ia_mid", nombre: "Hackear IA MID", tipo: "downsell" },
  { id: "prod_cena", nombre: "Cena", tipo: "evento" },
] as EstadoApp["productos"];

const ventaDownsell = { id: "ven_ds", contactoId: "lead_1", contactoNombre: "Ana Prueba", estado: "activa", productoId: "prod_downsell", fecha: "2026-09-10T15:00:00.000Z", moneda: "USD", precioAcordado: 497 } as Venta;
const compra = (productoId: string, extra: Partial<Venta> = {}): Venta =>
  ({ id: "ven_nueva", contactoId: "lead_1", contactoNombre: "Ana Prueba", estado: "activa", productoId, fecha: "2026-11-24T15:00:00.000Z", moneda: "USD", precioAcordado: 1500, ...extra }) as Venta;

const alumno: Alumno = {
  id: "alu_1", nombre: "Ana Prueba", email: "ana@x.com", cohorte: "", plan: "Downsell", cuotaMensual: 0, moneda: "USD", estado: "activo",
  inicio: "2026-09-10T15:00:00.000Z", progreso: 0, leadId: "lead_1", creadoEn: "2026-09-10T15:00:00.000Z", extra: {}, ventaId: "ven_ds",
};

const estado = (a: Partial<Alumno> = {}, ventas: Venta[] = [ventaDownsell]): EstadoApp => ({
  productos, ventas, leads: [{ id: "lead_1", nombre: "Ana Prueba", email: "ana@x.com" }], contactos: [], seguimientos: [],
  alumnos: [{ ...alumno, ...a }], ajustes: { programas: PROGRAMAS_POR_DEFECTO },
} as unknown as EstadoApp);

/* ---------- el alumno: el mismo, con el servicio nuevo ---------- */

test("Downsell → Hackear AI: el mismo alumno pasa a esa venta y a ese plan, su programa arranca con la compra y la venta vieja queda anotada", () => {
  const a = alumnoConLaCompra(estado(), compra("prod_hackear_ai"));
  assert.ok(a);
  assert.equal(a.id, "alu_1", "el mismo, nunca otro");
  assert.equal(a.ventaId, "ven_nueva", "Pagos, el closer y el plan de Servicio salen de la venta nueva");
  assert.equal(a.plan, "Hackear AI");
  assert.equal(a.inicio, "2026-11-24T15:00:00.000Z");
  assert.deepEqual(a.extra.ventasAnteriores, ["ven_ds"]);
  /* Con «Upgrade a mentoría» (upsell) es lo mismo. */
  assert.equal(alumnoConLaCompra(estado(), compra("prod_upgrade_mentoria"))?.plan, "Upgrade a mentoría");
});

test("Hackear AI → renovación con Principals: pasa a Principals y su programa arranca con la renovación", () => {
  const e = estado({ plan: "Hackear AI", ventaId: "ven_ai" }, [{ ...ventaDownsell, id: "ven_ai", productoId: "prod_hackear_ai", precioAcordado: 3000 }]);
  const a = alumnoConLaCompra(e, compra("prod_principals"));
  assert.equal(a?.ventaId, "ven_nueva");
  assert.equal(a?.plan, "Principals");
  assert.equal(a?.inicio, "2026-11-24T15:00:00.000Z");
  assert.deepEqual(a?.extra.ventasAnteriores, ["ven_ai"]);
});

test("lo que no toma el servicio no le cambia nada: un evento, la extensión del MID, una venta cancelada o una cargada tarde", () => {
  assert.equal(alumnoConLaCompra(estado(), compra("prod_cena")), null, "una cena");
  assert.equal(alumnoConLaCompra(estado(), compra("prod_hackear_ai", { estado: "cancelada" })), null, "cancelada");
  assert.equal(alumnoConLaCompra(estado(), compra("prod_hackear_ai", { fecha: "2026-08-01T15:00:00.000Z" })), null, "más vieja que la que tiene");
  /* La extensión (2 meses más de mentoría del MID): suma tiempo a lo que cursa; no es otro programa ni mueve el inicio (hasta hoy lo movía). */
  const mid = estado({ plan: "Hackear IA MID", ventaId: "ven_mid" }, [{ ...ventaDownsell, id: "ven_mid", productoId: "prod_hackear_ia_mid" }]);
  assert.equal(tomaElServicio(mid, compra("prod_extension_mid"), "ven_mid"), false);
  assert.equal(renuevaElPrograma(mid, compra("prod_extension_mid")), false);
  assert.equal(alumnoConLaCompra(mid, compra("prod_extension_mid")), null);
});

test("quien estaba de baja o egresado y vuelve a comprar un programa vuelve a activo", () => {
  assert.equal(alumnoConLaCompra(estado({ estado: "baja" }), compra("prod_hackear_ai"))?.estado, "activo");
  assert.equal(alumnoConLaCompra(estado({ estado: "graduado" }), compra("prod_hackear_ai"))?.estado, "activo");
  assert.equal(alumnoConLaCompra(estado({ estado: "pausado" }), compra("prod_hackear_ai"))?.estado, "pausado", "una pausa la maneja Servicio");
});

test("la primera compra no pasa por acá (nace el alumno con ella) y una venta que ya es suya no cambia nada", () => {
  assert.equal(alumnoConLaCompra(estado({ ventaId: undefined }), compra("prod_hackear_ai")), null);
  assert.equal(alumnoConLaCompra(estado(), { ...ventaDownsell }), null);
});

/* ---------- el contrato: sale el del programa nuevo ---------- */

const contrato = (x: Partial<Contrato>): Contrato => ({
  id: "ctr", ventaId: null, sesionId: null, leadId: "lead_1", alumnoId: null, programa: "downsell", plantillaId: "", plantillaNombre: "", documentoId: null,
  modo: "produccion", estado: "firmado", destinatario: {}, datos: {}, enlace: null, enlaceVence: null, pdfPath: null, enviadoEn: null, vistoEn: null,
  firmadoEn: null, rechazadoEn: null, anuladoEn: null, accesosEn: null, origen: "app", error: null, creadoEn: "2026-09-11T15:00:00.000Z", creadoPor: "",
  actualizadoEn: "", sincronizadoEn: null, ...x,
});
const ahora = new Date("2026-11-24T18:00:00.000Z");

test("el contrato firmado del Downsell NO cuenta como «ya se le mandó» al cargar Hackear AI: sale el del programa", () => {
  const ds = contrato({ id: "ctr_ds", ventaId: "ven_ds", programa: "downsell" });
  assert.equal(contratoDeEstaCompra([ds], "hackear-ai", { ahora }), null);
  assert.equal(contratoDeOtraCompra([ds], "hackear-ai", { ahora })?.id, "ctr_ds", "se le cuenta al closer que tiene el del Downsell");
  /* Aunque sea de hace unos días (pasa al programa en la misma semana): es de otro programa. */
  assert.equal(contratoDeEstaCompra([{ ...ds, creadoEn: "2026-11-20T15:00:00.000Z" }], "hackear-ai", { ahora }), null);
  /* El de Hackear AI de hace meses tampoco cuenta para la renovación: es de otra compra. */
  const ai = contrato({ id: "ctr_ai", ventaId: "ven_ai", programa: "hackear-ai", creadoEn: "2026-03-01T15:00:00.000Z" });
  assert.equal(contratoDeEstaCompra([ai], "hackear-ai", { ahora }), null);
});

test("sí cuenta el de esta compra: del mismo programa sin venta todavía (Lili lo mandó antes), de estas semanas, o atado a la venta que se completa", () => {
  const deLili = contrato({ id: "ctr_lili", programa: "hackear-ai", estado: "enviado", creadoEn: "2026-11-23T15:00:00.000Z" });
  assert.equal(contratoDeEstaCompra([deLili], "hackear-ai", { ahora })?.id, "ctr_lili");
  assert.equal(contratoDeEstaCompra([{ ...deLili, ventaId: "ven_x" }], "hackear-ai", { ahora })?.id, "ctr_lili", "de estas semanas");
  assert.equal(contratoDeEstaCompra([{ ...deLili, estado: "anulado" }], "hackear-ai", { ahora }), null, "uno anulado no");
  const viejo = contrato({ id: "ctr_prog", ventaId: "ven_reserva", programa: "hackear-ai", creadoEn: "2026-08-01T15:00:00.000Z" });
  assert.equal(contratoDeEstaCompra([viejo], "hackear-ai", { ahora, completando: true, ventaId: "ven_reserva" })?.id, "ctr_prog");
  const reserva = contrato({ id: "ctr_res", ventaId: "ven_reserva", programa: "hackear-ai", datos: { reserva: true }, creadoEn: "2026-11-20T15:00:00.000Z" });
  assert.equal(contratoDeEstaCompra([reserva], "hackear-ai", { ahora, completando: true, ventaId: "ven_reserva" }), null, "completando, el de la reserva no cuenta");
  assert.equal(contratoDeEstaCompra([reserva], "hackear-ai", { ahora })?.id, "ctr_res", "cargando la venta, sí (no se manda otro sin querer)");
});

/* ---------- los accesos: los que faltan, y lo que tenía pasa al programa ---------- */

const IT = "PRO-it", AI = "PRO-ai", BONOS = "PRO-bonos";
const GENERAL = "-100general", NOVEDADES = "-100novedades";
const COMPLETO: Programa = {
  id: "hackear-ai", nombre: "Hackear AI", productos: ["prod_hackear_ai"], plantillaId: "", plantillaNombre: "",
  /* Zoom va igual que Telegram (los servicios falsos de la prueba no lo simulan). */
  wisboo: [IT, AI, BONOS], telegram: [GENERAL, NOVEDADES], zoom: [], bonos: [], activo: true,
};
const fila = (plataforma: string, recurso: string, estado: string, venceEn: string | null, programa: string): Fila => ({
  id: idDeAcceso("alu_1", plataforma as "wisboo", recurso), alumnoId: "alu_1", plataforma, recurso, recursoNombre: recurso, estado, programa, venceEn, externo: {}, error: null,
});
const persona = { nombre: "Ana Prueba", email: "ana@x.com" };

test("Downsell → Hackear AI al firmar: se le dan Bonos y los grupos; Wisboo no se repite y pasa a ser de Hackear AI", async () => {
  const { db, tablas } = baseEnMemoria({ accesos_alumno: [fila("wisboo", IT, "dado", null, "downsell"), fila("wisboo", AI, "dado", null, "downsell")] });
  assert.equal(marcasDeLaFicha(tablas.accesos_alumno as never).acceso, "Downsell");
  const r = await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_ai", persona, programa: COMPLETO, origen: "automatico", quien: "t" }));
  assert.equal(r.fallaron, 0);
  assert.equal(r.yaEstaban, 2, "los dos cursos de Wisboo ya los tenía");
  assert.equal(r.dados, 3, "Bonos, General y Novedades");
  for (const f of tablas.accesos_alumno) assert.equal(f.programa, "hackear-ai", `${f.recurso} es de Hackear AI`);
  assert.equal(marcasDeLaFicha(tablas.accesos_alumno as never).acceso, "Completos");
});

test("MID → Hackear AI: la mentoría que se le cortaba al mes queda sin corte y pasa al programa", async () => {
  const corte = new Date(Date.now() + 10 * 86400000).toISOString();
  const { db, tablas } = baseEnMemoria({ accesos_alumno: [fila("telegram", GENERAL, "entro", corte, "hackear-ia-mid"), fila("wisboo", IT, "dado", null, "hackear-ia-mid")] });
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "ctr_ai", persona, programa: COMPLETO, origen: "automatico", quien: "t" }));
  const general = tablas.accesos_alumno.find((f) => f.recurso === GENERAL)!;
  assert.equal(general.venceEn, null);
  assert.equal(general.estado, "entro", "sigue adentro del grupo");
  assert.equal(general.programa, "hackear-ai");
});

test("lo de otro programa completo (Hackear Biz) o de una extensión (downsell a downsell) no cambia de programa", async () => {
  const BIZ = "PRO-biz";
  const { db, tablas } = baseEnMemoria({ accesos_alumno: [fila("wisboo", BIZ, "dado", null, "hackear-biz")] });
  await conServiciosFalsos(() => darAccesos(db, { alumnoId: "alu_1", contratoId: "c", persona, programa: { ...COMPLETO, wisboo: [BIZ, IT] }, origen: "automatico", quien: "t" }));
  assert.equal(tablas.accesos_alumno.find((f) => f.recurso === BIZ)!.programa, "hackear-biz");
  const ext: Programa = { ...COMPLETO, id: "hackear-ia-mid-extension", wisboo: [], telegram: [GENERAL], zoom: [], sumaTiempo: true };
  const b = baseEnMemoria({ accesos_alumno: [fila("telegram", GENERAL, "entro", null, "hackear-ia-mid")] });
  await conServiciosFalsos(() => darAccesos(b.db, { alumnoId: "alu_1", contratoId: "c", persona, programa: ext, origen: "automatico", quien: "t" }));
  assert.equal(b.tablas.accesos_alumno[0].programa, "hackear-ia-mid");
});

/* ---------- la base hace lo mismo para quien no ve al alumno ---------- */

const sql = readFileSync(new URL("../supabase/compra-nueva-mismo-alumno-20-11.sql", import.meta.url), "utf8");

test("la base: una venta nueva pasa al alumno de esa persona, después del aviso a Servicio, y nunca nace otro alumno", () => {
  assert.match(sql, /create trigger ventas_pasan_al_alumno after insert on public\.ventas/);
  /* Los disparadores AFTER corren por orden alfabético: el aviso tiene que ver que ya era alumno (con la venta vieja). */
  assert.ok("ventas_avisan_a_servicio" < "ventas_pasan_al_alumno");
  const sinDuplicar = sql.slice(sql.indexOf("create or replace function public.alumno_sin_duplicar"), sql.indexOf("drop trigger if exists alumno_sin_duplicar"));
  assert.doesNotMatch(sinDuplicar, /a\."ventaId" is null or a\."ventaId" = new\."ventaId"/, "ya no busca sólo alumnos sin venta");
  assert.match(sinDuplicar, /perform public\.compra_al_alumno\(ya\.id, new\."ventaId"\);\s*return null;/, "con otra compra: va al que está y no nace otro");
  /* La misma regla que la app: programa (principal, upsell o downsell) que no sea extensión. */
  assert.match(sql, /p\.tipo in \('principal', 'upsell', 'downsell'\)/);
  assert.match(sql, /sumaTiempo/);
  assert.match(sql, /v_tipo in \('principal', 'upsell'\)/, "renueva el inicio sólo principal o upsell, como renuevaElPrograma");
  /* Nunca frena una venta: los errores van a un aviso en el log. */
  assert.match(sql.slice(sql.indexOf("function public.venta_nueva_al_alumno")), /exception when others then/);
});
