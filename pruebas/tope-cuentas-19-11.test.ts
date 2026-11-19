import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AVISAR_DESDE, TOPE_DE_FINANCIERA, topeDeCuentas } from "@/lib/tope-cuentas";
import { construirSemilla } from "@/lib/seed";
import type { EstadoApp, Gasto, Pago, Procesador } from "@/lib/types";

/* Aldana, 19/11: «que nunca haya más de 50.000 dólares en total entre Financiera ARS, Financiera USD y dLocal; que se me marque en rojo o me llegue una
   notificación cuando eso esté excediendo el máximo, así lo tengo en cuenta para avisar y hacer un retiro». La cuenta es la de la pantalla de Saldos
   (lo del último arqueo más lo que se movió desde entonces, los pesos al tipo de cambio de Ajustes). */

const proc = (id: string, nombre: string, extra: Partial<Procesador> = {}): Procesador => ({ id, nombre, feeRate: 0, activo: true, automatico: false, ...extra });
const ARQUEO = "2026-11-01T15:00:00.000Z";
const AHORA = "2026-11-19T18:00:00.000Z";
const dia = (d: number, h = 15) => `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const pago = (id: string, procesadorId: string, monto: number, fecha: string, extra: Partial<Pago> = {}): Pago => ({
  id, cuotaId: `cuota_${id}`, procesadorId, monto, moneda: "USD", feeRate: 0, feeMonto: 0, fecha, creadoEn: fecha, ...extra,
});
const gasto = (id: string, monto: number, fecha: string, cuenta: string): Gasto => ({
  id, categoria: "Software", grupo: "operativo", concepto: id, monto, moneda: "USD", fecha, recurrente: false, creadoEn: fecha, extra: { cuenta },
});

/* El arqueo del 1/11: Financiera ARS 30.000.000 pesos (a 1.500, US$ 20.000), Financiera USD 18.000 y dLocal 6.000 (US$ 44.000 entre las tres) y otras cuentas
   que no cuentan para el tope (Mercury 90.000). */
function estado(cambios: Partial<EstadoApp> = {}, tipoCambio = 1500): EstadoApp {
  const s = construirSemilla() as EstadoApp;
  return {
    ...s,
    procesadores: [
      proc("proc_financiera_ars", "Financiera ARS Juan", { moneda: "ARS" }), proc("proc_financiera_usd", "Financiera USD Juan"),
      proc("proc_dlocal", "Dlocal", { automatico: true, proveedor: "dlocal" }), proc("proc_mercury", "ACH-WIRE Mercury", { automatico: true }),
    ],
    ventas: [], cuotas: [], movimientos: [], devoluciones: [], pagos: [], gastos: [], traspasos: [],
    ajustes: { ...s.ajustes, monedaBase: "USD", tipoCambio },
    arqueos: [{
      id: "a1", fecha: ARQUEO, total: 134000, tipoCambio: 1500, creadoEn: ARQUEO,
      saldos: [
        { procesadorId: "proc_financiera_ars", monto: 30_000_000, moneda: "ARS", montoBase: 20000 },
        { procesadorId: "proc_financiera_usd", monto: 18000, moneda: "USD", montoBase: 18000 },
        { procesadorId: "proc_dlocal", monto: 6000, moneda: "USD", montoBase: 6000 },
        { procesadorId: "proc_mercury", monto: 90000, moneda: "USD", montoBase: 90000 },
      ],
    }],
    ...cambios,
  } as unknown as EstadoApp;
}

test("el tope es de US$ 50.000 entre Financiera ARS, Financiera USD y dLocal", () => {
  assert.equal(TOPE_DE_FINANCIERA.limite, 50000);
  assert.deepEqual([...TOPE_DE_FINANCIERA.cuentaIds].sort(), ["proc_dlocal", "proc_financiera_ars", "proc_financiera_usd"]);
});

test("con US$ 44.000 entre las tres (los pesos al cambio de Ajustes) no pasa nada, y Mercury no cuenta", () => {
  const t = topeDeCuentas(estado(), AHORA);
  assert.equal(t.total, 44000);
  assert.equal(t.excede, false);
  assert.equal(t.seAcerca, false);
  assert.equal(t.falta, 6000);
  assert.deepEqual(t.cuentas.map((c) => [c.cuentaId, c.saldoBase]), [["proc_financiera_ars", 20000], ["proc_financiera_usd", 18000], ["proc_dlocal", 6000]]);
  assert.equal(Math.round(t.proporcion * 100), 88);
});

test("desde el 90% se acerca (ámbar); pasando de 50.000 se pasa (rojo) y dice por cuánto", () => {
  const cerca = topeDeCuentas(estado({ pagos: [pago("d1", "proc_dlocal", 1500, dia(10))] }), AHORA);
  assert.equal(cerca.total, 45500);
  assert.equal(cerca.seAcerca, true);
  assert.equal(cerca.excede, false);
  assert.equal(AVISAR_DESDE, 0.9);

  const pasa = topeDeCuentas(estado({ pagos: [pago("d1", "proc_dlocal", 6000, dia(10)), pago("d2", "proc_dlocal", 2000, dia(12))] }), AHORA);
  assert.equal(pasa.total, 52000);
  assert.equal(pasa.excede, true);
  assert.equal(pasa.exceso, 2000);
  assert.equal(pasa.seAcerca, false);
  assert.equal(pasa.falta, 0);
});

test("justo en el tope no se pasa; un dólar más, sí", () => {
  assert.equal(topeDeCuentas(estado({ pagos: [pago("d1", "proc_dlocal", 6000, dia(10))] }), AHORA).excede, false);
  const uno = topeDeCuentas(estado({ pagos: [pago("d1", "proc_dlocal", 6001, dia(10))] }), AHORA);
  assert.equal(uno.excede, true);
  assert.equal(uno.exceso, 1);
});

test("el retiro baja el total: un gasto o un pase desde la Financiera lo saca del tope", () => {
  const e = estado({ pagos: [pago("d1", "proc_dlocal", 9000, dia(10))], gastos: [gasto("retiro", 4000, dia(15), "Financiera USD Juan")] });
  const t = topeDeCuentas(e, AHORA);
  assert.equal(t.total, 49000);
  assert.equal(t.excede, false);
});

test("lo que entra en pesos a la Financiera ARS cuenta al tipo de cambio, no peso por dólar", () => {
  const e = estado({ pagos: [pago("p1", "proc_financiera_ars", 4000, dia(10), { tipoCambio: 1500, montoArs: 6_000_000 })] });
  assert.equal(topeDeCuentas(e, AHORA).total, 48000);
});

test("sin tipo de cambio no se puede sumar la Financiera ARS: no se afirma nada (ni rojo)", () => {
  const e = estado({ pagos: [pago("d1", "proc_dlocal", 30000, dia(10))] }, 0);
  const t = topeDeCuentas(e, AHORA);
  assert.equal(t.faltaCambio, true);
  assert.equal(t.excede, false, "sin poder sumar los pesos, no se asegura que se pasó");
  assert.equal(t.seAcerca, false);
});

test("una cuenta que no estaba en el último arqueo se avisa como parcial", () => {
  const s = estado();
  const a = (s.arqueos ?? [])[0];
  const e = { ...s, arqueos: [{ ...a, saldos: a.saldos.filter((x) => x.procesadorId !== "proc_dlocal") }], pagos: [pago("d1", "proc_dlocal", 500, dia(10))] } as EstadoApp;
  const t = topeDeCuentas(e, AHORA);
  assert.deepEqual(t.parciales, ["Dlocal"]);
  assert.equal(t.total, 38500);
});

test("sin arqueo ni cuentas no rompe: total 0 y sin cuentas que mostrar", () => {
  const t = topeDeCuentas({ ...estado(), procesadores: [], arqueos: [] } as unknown as EstadoApp, AHORA);
  assert.equal(t.total, 0);
  assert.equal(t.excede, false);
  assert.deepEqual(t.cuentas, []);
});

/* ---------- La pantalla, el aviso y la base ---------- */

const leer = (ruta: string) => readFileSync(new URL(ruta, import.meta.url), "utf8");

test("el rojo se ve en Finanzas (sólo si hay algo) y en Saldos (siempre)", () => {
  const a = leer("../src/components/finanzas/AlertaTope.tsx");
  assert.match(a, /Financiera y dLocal pasaron el tope: /);
  assert.match(a, /Financiera y dLocal se acercan al tope: /);
  assert.match(a, /className=\{`alarma\$\{rojo \? "" : " alarma--atencion"\}`\}/);
  assert.match(a, /hay que avisar y hacer un retiro/);
  assert.match(leer("../src/components/finanzas/vistas/SaldosVista.tsx"), /<AlertaTope e=\{e\} siempre conLink=\{false\} \/>/);
  assert.match(leer("../src/components/cierre/FinanzasHub.tsx"), /<AlertaTope e=\{e\} \/>/);
});

test("el aviso a la campanita sale de quien ve Finanzas con los datos traídos, una vez por día y total", () => {
  const h = leer("../src/components/avisos/useAvisoDeTope.ts");
  assert.match(h, /nube\.rpc\("avisar_tope_de_cuentas", \{ p_total: total, p_limite: limite \}\)/);
  assert.match(h, /tope\?\.excede \? Math\.round\(tope\.total\) : 0/);
  assert.match(h, /apicanta:tope-avisado:/);
  assert.match(leer("../src/components/shell/Shell.tsx"), /useAvisoDeTope\(estado, datosListos && nivelEn\(acceso, "finanzas"\) >= 1\)/);
});

test("la función de la base es sólo para quien ve Finanzas, no acepta texto libre y escribe un aviso por persona y día", () => {
  const sql = leer("../supabase/aviso-tope-cuentas.sql");
  assert.match(sql, /create or replace function public\.avisar_tope_de_cuentas\(p_total numeric, p_limite numeric\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /nivel_area\('finanzas'\), 0\) >= 1/);
  assert.match(sql, /'av_tope_' \|\| dia \|\| '_' \|\| substr\(md5\(lower\(u\.email\)\), 1, 10\)/);
  assert.match(sql, /on conflict \(id\) do nothing/);
  assert.match(sql, /revoke all on function public\.avisar_tope_de_cuentas\(numeric, numeric\) from public, anon;/);
  assert.match(sql, /grant execute on function public\.avisar_tope_de_cuentas\(numeric, numeric\) to authenticated;/);
  assert.ok(!/p_texto|p_detalle/.test(sql), "no hay un parámetro de texto");
});
