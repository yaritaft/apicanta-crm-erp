import test from "node:test";
import assert from "node:assert/strict";
import { azar, congelar, donde, instante, MESES_MUNDO, mundo } from "../plata/plata-mundo";
import { avanceDeFinanzas, claveChequeo, diasDelRango, pasosDeFinanzas, periodoActual, type Chequeos } from "@/lib/finanzas-pasos";
import { pasosDelMes } from "@/lib/cierre-mes";
import { controlDeCobro, pasaControl } from "@/lib/control-cobros";
import { propuestasPendientes } from "@/lib/reembolsos";
import { mesesCerrados } from "@/lib/mes-cerrado";
import { diaDeNegocio, mesDeNegocio } from "@/lib/dia-negocio";
import { esIncobrable } from "@/lib/cuota-incobrable";
import type { Cuota, EstadoApp, Movimiento, Traspaso } from "@/lib/types";

/* ==================================================================
   Frente «Finanzas en pasos» · los pasos del mes, el día y la semana con datos al azar.

   Propiedades (cada mensaje dice la semilla para repetirlo):
   F1  ningún instante, rango ni mes rompe nada: hoy, la semana, cada mes y «de tal día a tal día» (incluso al revés,
       de un solo día o con fechas que no existen) arman sus pasos sin tirar, y sin tocar el estado (congelado).
   F2  la lista del mes es siempre la misma, en el mismo orden, y termina en «Cerrar»; los pasos sólo de dueños son
       la liquidación, el pago y el cierre.
   F3  un paso que se calcula está pendiente si y sólo si le falta algo; «listo» nunca tiene faltantes; lo que
       se lista nunca pasa de 40 y «faltan» nunca es menos que lo listado; el progreso nunca se pasa de su total.
   F4  los pasos que juntan varios (ventas completas, atar cobros, validar cobros) cuentan cada renglón una sola vez
       y coinciden con una cuenta hecha aparte sobre el estado.
   F5  el primer paso pendiente es el siguiente, y sólo uno.
   F6  tildar un paso a mano lo da por hecho (y suma uno al avance), destildar lo devuelve; «Cerrar» sólo se
       habilita con todo hecho y es «listo» exactamente cuando la liquidación del mes está cerrada.
   F7  el mes de hoy es el de Argentina, a cualquier hora (a las 22 de acá ya es mañana en UTC).
   ================================================================== */

const SEMILLAS = 150;
const IDS_MES = [
  "ventas-completas", "cobros-atar", "cobros-validar", "cuotas-mes", "pases", "arqueo", "gastos",
  "liq-revisar", "liq-pagar", "m-profit", "m-reporte", "m-kpis-ceo", "m-software", "m-manual-ventas", "cerrar",
];
const SOLO_DUENOS = ["liq-revisar", "liq-pagar", "cerrar"];
const TIPOS_MOV = ["stripe", "whop", "hotmart", "mercury", "dlocal"];

/* Un mundo con lo que Finanzas mira y el mundo de la plata todavía no trae: cobros de pasarela sin atar, cuotas sin cobrar
   (algunas dadas por incobrables) y movimientos entre cuentas esperando una decisión. */
function mundoDeFinanzas(semilla: number): { e: EstadoApp; ahora: number } {
  const { e } = mundo(semilla, { devoluciones: 6, gastos: 25, pesos: true, huerfanos: semilla % 7 === 0 });
  const r = azar(semilla * 31 + 7);
  const movimientos: Movimiento[] = Array.from({ length: r.entre(0, 30) }, (_, i) => ({
    id: `mov_${semilla}_${i}`, proveedor: r.elige(TIPOS_MOV), referencia: `ref${i}`, monto: r.plata(50, 3000), moneda: "USD", fee: 0, neto: 0,
    fecha: instante(r, { meses: MESES_MUNDO, bordes: 0.3 }), estado: r.si(0.6) ? "pendiente" : "conciliado", clienteNombre: r.si(0.8) ? `Cliente ${i}` : "",
  } as Movimiento));
  /* Cuotas sin cobrar en cualquier mes: pendientes, incobrables (canceladas con su motivo) o ya cobradas a medias. */
  const activas = e.ventas.filter((v) => v.estado === "activa");
  const cuotasNuevas: Cuota[] = [];
  for (const v of activas) {
    if (!r.si(0.5)) continue;
    for (let k = 0; k < r.entre(1, 3); k++) {
      const tipo = r.elige(["pendiente", "pendiente", "incobrable", "pagada"] as const);
      cuotasNuevas.push({
        id: `cx_${semilla}_${v.id}_${k}`, ventaId: v.id, numero: 90 + k, monto: r.plata(100, 1500), vence: instante(r, { meses: MESES_MUNDO, bordes: 0.3 }),
        estado: tipo === "pagada" ? "pagada" : tipo === "incobrable" ? "cancelada" : "pendiente", esReserva: false,
        ...(tipo === "incobrable" ? { notas: "Incobrable: no contesta" } : {}),
      });
    }
  }
  const traspasos: Traspaso[] = Array.from({ length: r.entre(0, 8) }, (_, i) => ({
    id: `tr_${semilla}_${i}`, fecha: instante(r, { meses: MESES_MUNDO, bordes: 0.2 }), origenId: "proc_stripe", destinoId: "proc_mercury",
    montoSale: r.plata(100, 2000), monedaSale: "USD", montoLlega: r.plata(100, 2000), monedaLlega: "USD",
    estado: r.elige(["propuesto", "confirmado", "ignorado"] as const), salidaRef: r.si(0.6) ? `stripe:po_${i}` : undefined, llegadaRef: r.si(0.4) ? `mercury:${i}` : undefined,
    contraparte: "STRIPE", origen: "api", creadoEn: "2026-10-01T12:00:00.000Z",
  } as Traspaso));
  const ahora = Date.parse(instante(r, { meses: MESES_MUNDO, bordes: 0.4 }));
  return {
    e: congelar({ ...e, cuotas: [...e.cuotas, ...cuotasNuevas], movimientos: [...e.movimientos, ...movimientos], traspasos, gastosRecurrentes: e.gastosRecurrentes ?? [] }) as EstadoApp,
    ahora,
  };
}

const diaDe = (ahora: number) => diaDeNegocio(new Date(ahora).toISOString());
const sumar = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

test("F1 · hoy, la semana, cada mes y cualquier rango arman sus pasos sin tirar y sin tocar el estado", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const { e, ahora } = mundoDeFinanzas(semilla);
    const r = azar(semilla * 17 + 3);
    const dia = diaDe(ahora);
    const donde1 = (...x: (string | number)[]) => donde(semilla, ...x);
    for (const esDueno of [true, false]) {
      const o = { ahora, esDueno, chequeos: {} };
      assert.doesNotThrow(() => pasosDeFinanzas(e, "dia", dia, o), donde1("día", dia));
      assert.doesNotThrow(() => pasosDeFinanzas(e, "semana", periodoActual("semana", ahora), o), donde1("semana"));
      for (const mes of MESES_MUNDO) assert.doesNotThrow(() => pasosDeFinanzas(e, "mes", mes, o), donde1("mes", mes));
      /* Rangos: normales, de un día, al revés, larguísimos y con fechas que no existen. */
      const desde = sumar(dia, -r.entre(0, 200)), hasta = sumar(dia, r.entre(-30, 60));
      for (const p of [`${desde}_${hasta}`, `${dia}_${dia}`, `${hasta}_${desde}`, "2026-02-30_2026-02-31", "x_y", "_", "2020-01-01_2030-12-31"]) {
        assert.doesNotThrow(() => pasosDeFinanzas(e, "rango", p, o), donde1("rango", p));
      }
    }
  }
});

test("F2 y F3 · el mes tiene siempre los mismos pasos y cada paso es coherente consigo mismo", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const { e, ahora } = mundoDeFinanzas(semilla);
    for (const mes of MESES_MUNDO) {
      for (const esDueno of [true, false]) {
        const pasos = pasosDeFinanzas(e, "mes", mes, { ahora, esDueno, chequeos: {} });
        const donde1 = donde(semilla, mes, esDueno ? "dueño" : "equipo");
        assert.deepEqual(pasos.map((p) => p.id), IDS_MES, donde1);
        assert.deepEqual(pasos.filter((p) => p.soloDuenos).map((p) => p.id), SOLO_DUENOS, donde1);
        for (const p of pasos) {
          const cual = `${donde1} · ${p.id}`;
          assert.ok(p.faltan >= 0 && Number.isFinite(p.faltan), cual);
          assert.ok(p.items.length <= 40, `${cual}: lista de más`);
          assert.ok(p.faltan >= p.items.length, `${cual}: faltan ${p.faltan} < ${p.items.length} renglones`);
          if (p.progreso) assert.ok(p.progreso.hecho >= 0 && p.progreso.hecho <= p.progreso.total, `${cual}: progreso ${p.progreso.hecho}/${p.progreso.total}`);
          if (p.estado === "listo") assert.equal(p.faltan, 0, `${cual}: listo con faltantes`);
          if ((p.tipo ?? "auto") === "auto" && p.estado !== "bloqueado" && p.id !== "cerrar") {
            assert.equal(p.estado === "pendiente", p.faltan > 0, `${cual}: estado ${p.estado} con ${p.faltan} faltantes`);
          }
          assert.ok(p.detalle.trim().length > 0, `${cual}: sin texto`);
          assert.ok(!/undefined|NaN|\[object/.test(p.detalle), `${cual}: texto roto «${p.detalle}»`);
          for (const it of p.items) assert.ok(!/undefined|NaN/.test(`${it.titulo} ${it.sub ?? ""}`), `${cual}: renglón roto «${it.titulo}»`);
        }
        /* Para quien no es dueño, lo de los dueños no cuenta para el avance. */
        const a = avanceDeFinanzas(pasos, esDueno);
        assert.equal(a.total, esDueno ? IDS_MES.length : IDS_MES.length - SOLO_DUENOS.length, donde1);
        assert.ok(a.listos <= a.total, donde1);
      }
    }
  }
});

test("F4 · los pasos que juntan varios cuentan cada renglón una vez y coinciden con una cuenta aparte", (t) => {
  /* Que la prueba mire algo: cuántas veces cada paso tuvo cosas pendientes (si fuera siempre cero, no probaría nada). */
  const conFalta: Record<string, number> = {};
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const { e, ahora } = mundoDeFinanzas(semilla);
    for (const mes of MESES_MUNDO) {
      const [a, m] = mes.split("-").map(Number);
      const desde = `${mes}-01`, hasta = `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, "0")}`;
      const dentro = (iso: string) => { const d = diaDeNegocio(iso); return d >= desde && d <= hasta; };
      const pasos = pasosDeFinanzas(e, "mes", mes, { ahora, esDueno: true, chequeos: {} });
      const por = new Map(pasos.map((p) => [p.id, p] as const));
      for (const p of pasos) if (p.faltan > 0) conFalta[p.id] = (conFalta[p.id] ?? 0) + 1;
      const cual = donde(semilla, mes);

      /* Ventas completas: las del mes sin embudo o sin ningún cobro, cada una una vez. */
      const ventasDelMes = e.ventas.filter((v) => v.estado !== "cancelada" && dentro(v.fecha));
      const conPago = new Set(e.cuotas.filter((c) => e.pagos.some((p) => p.cuotaId === c.id)).map((c) => c.ventaId));
      const faltan = new Set(ventasDelMes.filter((v) => !v.embudoId || (!conPago.has(v.id) && v.estado === "activa")).map((v) => v.id));
      const vc = por.get("ventas-completas")!;
      if (faltan.size <= 40) assert.equal(vc.faltan, faltan.size, `${cual}: ventas completas`);
      else assert.ok(vc.faltan >= 40, cual);
      assert.equal(new Set(vc.items.map((i) => i.clave)).size, vc.items.length, `${cual}: renglones repetidos en ventas completas`);

      /* Atar cobros y reembolsos: los cobros de pasarela sin atar y los reembolsos sin devolución, sólo los del mes (lo de otros meses va en su mes). */
      const sinAtar = e.movimientos.filter((x) => x.estado === "pendiente" && dentro(x.fecha)).length;
      const esperado = sinAtar + propuestasPendientes(e, { desde, hasta }).length;
      assert.equal(por.get("cobros-atar")!.faltan, esperado, `${cual}: atar cobros`);

      /* Validar cobros: pendientes de validar, rechazados y sin comprobante, sin repetir. */
      const delMes = e.pagos.filter((p) => dentro(p.fecha));
      const aValidar = delMes.filter((p) => (!p.movimientoId && controlDeCobro(p).estado === "pendiente") || controlDeCobro(p).estado === "rechazado" || pasaControl(p, e.procesadores, "sin-comprobante"));
      const vv = por.get("cobros-validar")!;
      if (aValidar.length <= 40) assert.equal(vv.faltan, aValidar.length, `${cual}: validar cobros`);
      else assert.ok(vv.faltan >= 40, cual);
      assert.equal(new Set(vv.items.map((i) => i.clave)).size, vv.items.length, `${cual}: renglones repetidos en validar cobros`);

      /* Cuotas del mes: las que vencen en el mes y siguen sin cobrar ni darse por incobrables (si el mes terminó, todas; si sigue, las vencidas). */
      const hoyDia = diaDe(ahora);
      const ventasPorId = new Map(e.ventas.map((v) => [v.id, v] as const));
      const pagadoPor = new Map<string, number>();
      for (const p of e.pagos) pagadoPor.set(p.cuotaId, (pagadoPor.get(p.cuotaId) ?? 0) + p.monto);
      const delMesCuotas = e.cuotas.filter((c) => c.estado !== "cancelada" || esIncobrable(c)).filter((c) => { const v = ventasPorId.get(c.ventaId); return v && v.estado !== "cancelada" && c.vence && dentro(c.vence); });
      const sinResolver = delMesCuotas.filter((c) => !(esIncobrable(c) || c.monto - (pagadoPor.get(c.id) ?? 0) <= 0.01) && (hasta < hoyDia || diaDeNegocio(c.vence!) < hoyDia));
      const cm = por.get("cuotas-mes")!;
      if (sinResolver.length <= 40) assert.equal(cm.faltan, sinResolver.length, `${cual}: cuotas del mes`);
      assert.equal(cm.progreso?.total, delMesCuotas.length, `${cual}: total de cuotas del mes`);

      /* Los pasos de siempre de cierre-mes no dejan de existir: «cerrar» arma lo mismo con o sin el recorte. */
      assert.ok(pasosDelMes(e, mes, { ahora, esDueno: true }).some((p) => p.id === "ventas-embudo"), cual);
    }
  }
  t.diagnostic(`pasos con faltantes en ${SEMILLAS * MESES_MUNDO.length} meses al azar: ${JSON.stringify(conFalta)}`);
  for (const id of ["ventas-completas", "cobros-atar", "cobros-validar", "cuotas-mes", "pases", "gastos"]) assert.ok((conFalta[id] ?? 0) > 50, `la prueba casi no ve «${id}» con pendientes: no estresa nada`);
});

test("F5 y F6 · el siguiente es uno solo; tildar suma uno y destildar lo devuelve; cerrar es «listo» sólo con la liquidación cerrada", () => {
  for (let semilla = 1; semilla <= SEMILLAS; semilla++) {
    const { e, ahora } = mundoDeFinanzas(semilla);
    const r = azar(semilla * 13 + 1);
    const mes = r.elige(MESES_MUNDO);
    const sin = pasosDeFinanzas(e, "mes", mes, { ahora, esDueno: true, chequeos: {} });
    const cual = donde(semilla, mes);
    const siguientes = sin.filter((p) => p.siguiente);
    assert.ok(siguientes.length <= 1, `${cual}: más de un «siguiente»`);
    const primero = sin.find((p) => p.estado === "pendiente");
    assert.equal(siguientes[0]?.id, primero?.id, `${cual}: el siguiente no es el primer pendiente`);

    const manuales = sin.filter((p) => p.tipo === "manual" && p.estado === "pendiente");
    const base = avanceDeFinanzas(sin, true).listos;
    let chequeos: Chequeos = {};
    manuales.forEach((p, i) => {
      chequeos = { ...chequeos, [claveChequeo("mes", mes, p.id)]: { por: "Aldana", en: "2026-10-01T12:00:00.000Z" } };
      const con = pasosDeFinanzas(e, "mes", mes, { ahora, esDueno: true, chequeos });
      assert.equal(avanceDeFinanzas(con, true).listos, base + i + 1, `${cual}: tildar ${p.id} tiene que sumar exactamente uno`);
      assert.equal(con.find((x) => x.id === p.id)!.estado, "listo", cual);
      assert.equal(con.find((x) => x.id === p.id)!.chequeo?.por, "Aldana", cual);
    });
    const sinTildes = pasosDeFinanzas(e, "mes", mes, { ahora, esDueno: true, chequeos: {} });
    assert.deepEqual(sinTildes.map((p) => p.estado), sin.map((p) => p.estado), `${cual}: destildar tiene que dejar todo como estaba`);

    const cerrar = sin.find((p) => p.id === "cerrar")!;
    assert.equal(cerrar.estado === "listo", mesesCerrados(e).has(mes), `${cual}: cerrar listo ⇔ liquidación cerrada`);
    if (cerrar.estado === "pendiente") assert.ok(sin.filter((p) => p.id !== "cerrar" && !p.soloDuenos || p.id === "liq-revisar" || p.id === "liq-pagar").every((p) => p.estado !== "pendiente" || p.id.startsWith("liq")), `${cual}: se puede cerrar con pasos pendientes`);
  }
});

test("F7 · el mes de hoy es el de Argentina, a cualquier hora del día y en cualquier huso", () => {
  const r = azar(99);
  for (let i = 0; i < 2000; i++) {
    const ahora = Date.parse("2026-01-01T00:00:00Z") + Math.floor(r.n() * 365 * 86400000);
    const dia = diaDe(ahora);
    assert.equal(mesDeNegocio(ahora), dia.slice(0, 7), `ahora ${new Date(ahora).toISOString()}`);
    assert.equal(periodoActual("dia", ahora), dia);
    assert.equal(periodoActual("mes", ahora), dia.slice(0, 7));
  }
  /* Los bordes: fin de mes a las 23:30 de Argentina ya es el mes que sigue en UTC, y no cambia de mes de acá. */
  assert.equal(mesDeNegocio(Date.parse("2026-10-31T23:30:00-03:00")), "2026-10");
  assert.equal(mesDeNegocio(Date.parse("2026-11-01T00:00:00-03:00")), "2026-11");
  assert.equal(mesDeNegocio(Date.parse("2026-12-31T23:59:59.999-03:00")), "2026-12");
  assert.deepEqual(diasDelRango("2026-10-01_2026-10-15"), { desde: "2026-10-01", hasta: "2026-10-15" });
});
