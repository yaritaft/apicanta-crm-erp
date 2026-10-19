/* Estrés del almacén: nada se deja de lado sin decir por qué (revisión con Aldana, 19/10).

   Invariantes (con semilla), después de miles de clics al azar sobre cobros y reembolsos de pasarela:
   - un cobro «sin venta» (ignorado) siempre tiene su motivo escrito; uno pendiente o conciliado nunca arrastra un motivo viejo;
   - un reembolso descartado siempre tiene su motivo; uno que espera o está confirmado no lleva motivo ni marca de cobro descartado;
   - descartar un reembolso «con su cobro» deja a los dos con motivo, y deshacerlo no toca un cobro que ya no está como se lo dejó;
   - un cobro ya conciliado a una venta nunca se descarta por ese camino: su reembolso se decide con «Confirmar». */
import test from "node:test";
import assert from "node:assert/strict";
import { instalarNavegador } from "./_navegador";
import { storeNuevo } from "./_fresco";
import { azar } from "./_aleatorio";
import type { E } from "./_acciones";

instalarNavegador();
const MOTIVOS = ["", "  ", "Se reembolsó", "No se cobró: falló el intento", "x"];

test("cobros y reembolsos: ningún estado de descarte queda sin motivo ni con un motivo de más", async () => {
  const S = await storeNuevo();
  await S.acciones.vaciarTodo();
  const a = azar(1910);
  const base = JSON.parse(S.acciones.exportar()) as E;
  const N = 24;
  const movimientos = Array.from({ length: N }, (_, i) => ({
    id: `mov_whop_pay_${i}`, proveedor: "whop", referencia: `pay_${i}`, monto: 100 + i, moneda: "USD", fee: 0, neto: 100 + i,
    fecha: `2026-10-${String(1 + (i % 25)).padStart(2, "0")}T15:00:00.000Z`, estado: i % 6 === 0 ? "conciliado" : "pendiente",
    ...(i % 6 === 0 ? { pagoId: `pago_${i}`, ventaId: `ven_${i}` } : {}), clienteNombre: `Cliente ${i}`, creadoEn: "2026-10-01T15:00:00.000Z", origen: "api",
  }));
  assert.equal(S.acciones.importar(JSON.stringify({ ...base, movimientos })), true);
  const r = S.acciones.importarReembolsos(
    Array.from({ length: N }, (_, i) => ({ proveedor: "whop", referencia: `reembolso:pay_${i}`, referenciasCobro: [`pay_${i}`], monto: 100 + i, moneda: "USD", fecha: `2026-10-${String(2 + (i % 25)).padStart(2, "0")}T15:00:00.000Z` })),
  );
  const idsR = r!.nuevas.map((n: { id: string }) => n.id);
  assert.equal(idsR.length, N);

  let descartes = 0, deshacer = 0;
  for (let paso = 0; paso < 1500; paso++) {
    const i = a.entero(0, N - 1);
    const idM = `mov_whop_pay_${i}`;
    const idR = idsR[i];
    const antes = JSON.parse(S.acciones.exportar()) as E;
    const m0 = antes.movimientos.find((m: E) => m.id === idM);
    const d0 = antes.devoluciones.find((d: E) => d.id === idR);
    switch (a.entero(0, 6)) {
      case 0: {
        const motivo = a.pick(MOTIVOS);
        const ok = S.acciones.marcarMovimiento(idM, "ignorado", motivo);
        if (!motivo.trim()) assert.equal(ok, false, `paso ${paso}: sin motivo no se ignora`);
        break;
      }
      case 1: S.acciones.marcarMovimiento(idM, "ignorado"); break;       // sin motivo: nunca
      case 2: S.acciones.marcarMovimiento(idM, "pendiente"); break;
      case 3: S.acciones.cambiarMotivoDeMovimiento(idM, a.pick(MOTIVOS)); break;
      case 4: S.acciones.ignorarDevolucion(idR, a.pick(MOTIVOS)); break;
      case 5: {
        const ok = S.acciones.descartarReembolsoConSuCobro(idR);
        if (m0?.estado === "conciliado") assert.equal(ok, false, `paso ${paso}: un cobro conciliado no se descarta`);
        if (ok) descartes++;
        break;
      }
      default: if (S.acciones.volverAProponerDevolucion(idR)) deshacer++;
    }
    void d0;
    /* Los invariantes, tras cada clic. */
    const e = JSON.parse(S.acciones.exportar()) as E;
    for (const m of e.movimientos as E[]) {
      if (m.estado === "ignorado") assert.ok(String(m.motivo ?? "").trim(), `paso ${paso}: ${m.id} está sin venta y no dice por qué`);
      else assert.equal(m.motivo, undefined, `paso ${paso}: ${m.id} (${m.estado}) arrastra un motivo viejo`);
    }
    for (const d of e.devoluciones as E[]) {
      const motivo = d.extra?.motivoDescarte;
      if (d.estado === "ignorada") assert.ok(typeof motivo === "string" && motivo.trim(), `paso ${paso}: ${d.id} está descartada y no dice por qué`);
      else {
        assert.equal(motivo, undefined, `paso ${paso}: ${d.id} (${d.estado}) arrastra un motivo viejo`);
        assert.equal(d.extra?.cobroDescartado, undefined, `paso ${paso}: ${d.id} (${d.estado}) arrastra un cobro descartado`);
      }
      /* Si se descartó con su cobro, el vínculo apunta a un cobro que existe (si alguien lo devolvió a pendientes aparte, el vínculo queda como historia). */
      const cobro = d.extra?.cobroDescartado as string | undefined;
      if (cobro) assert.ok((e.movimientos as E[]).some((x) => x.id === cobro), `paso ${paso}: ${d.id} apunta a un cobro que no existe`);
    }
    /* Un cobro conciliado sigue conciliado pase lo que pase. */
    for (let k = 0; k < N; k += 6) assert.equal((e.movimientos as E[]).find((m) => m.id === `mov_whop_pay_${k}`)?.estado, "conciliado", `paso ${paso}: el cobro conciliado ${k} se movió`);
  }
  assert.ok(descartes > 20 && deshacer > 20, `la prueba casi no descartó (${descartes}) ni deshizo (${deshacer}) con su cobro: no estresa nada`);
});
