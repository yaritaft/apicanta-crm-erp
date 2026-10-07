import test from "node:test";
import assert from "node:assert/strict";
import { calcularLiquidacion, liquidacionVacia } from "@/lib/honorarios";
import { evaluarPasos, resultadoDelDesglose } from "@/lib/desglose";
import type {
  AlcanceVentas, BaseMedicion, ConceptoPago, EntradaLiquidacion, EstadoApp, MiembroEquipo, Pago, Venta,
} from "@/lib/types";
import { concepto, esquema, miembro, pago, sesion, venta } from "./estado-liquidacion";

/* ==================================================================
   Escenarios al azar (siempre los mismos: el generador parte de una semilla)
   para comprobar la regla de fondo del desglose: en TODOS los renglones, de
   cualquier tipo y con cualquier combinación de filtros, la cuenta escrita
   cierra exactamente con el monto del renglón.

   Los números se arman para estresar el redondeo: cobros con centavos,
   comisiones del procesador sin redondear y un % con decimales.
   ================================================================== */

/* Un generador chico y reproducible (mulberry32). */
function azar(semilla: number) {
  let a = semilla >>> 0;
  const siguiente = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    n: siguiente,
    entre: (min: number, max: number) => min + Math.floor(siguiente() * (max - min + 1)),
    elige: <T,>(xs: readonly T[]): T => xs[Math.floor(siguiente() * xs.length)],
    si: (p = 0.5) => siguiente() < p,
    plata: (min: number, max: number) => Math.round((min + siguiente() * (max - min)) * 100) / 100,
  };
}

const MES = "2026-09";
const fechaDe = (d: number) => `${MES}-${String(d).padStart(2, "0")}T15:00:00.000Z`;

function escenario(semilla: number): { e: EstadoApp; entradas: Record<string, EntradaLiquidacion> } {
  const r = azar(semilla);
  const equipo: MiembroEquipo[] = [
    miembro("yari", "Yari", "ceo", 0, { sinComision: true }),
    miembro("c1", "Closer Uno", "closer", r.elige([0.1, 0.125, 0.15, 0.0725])),
    miembro("c2", "Closer Dos", "closer", r.elige([0.1, 0.12, 0.2])),
    miembro("dir", "Director", "director", 0.05),
    miembro("set", "Setter", "setter", 0.05),
    miembro("gro", "Growth", "growth", 0.1),
    miembro("o1", "Otro Uno", "otro"),
    miembro("o2", "Otro Dos", "otro", 0, { activo: r.si(0.8) }),
  ];
  const ids = equipo.map((m) => m.id);
  const productos = [{ id: "pa", nombre: "Mentoría" }, { id: "pb", nombre: "Downsell" }, { id: "pc", nombre: "Evento" }];
  const procesadores = [{ id: "s", nombre: "Stripe" }, { id: "h", nombre: "Hotmart" }, { id: "f", nombre: "Financiera" }];

  const ventas: Venta[] = [];
  const cuotas: { id: string; ventaId: string; numero: number; monto: number; estado: string; esReserva: boolean; closerId?: string }[] = [];
  const pagos: Pago[] = [];
  const nVentas = r.entre(4, 30);
  for (let i = 0; i < nVentas; i++) {
    const closer = r.elige(["yari", "c1", "c1", "c2", "c2", undefined]);
    ventas.push(venta({
      id: `v${i}`, contactoNombre: `Cliente ${i}`, precioAcordado: r.plata(300, 6000),
      fecha: fechaDe(r.entre(1, 28)), productoId: r.elige(["pa", "pb", "pc"]),
      ...(closer ? { closerId: closer } : {}),
      ...(r.si(0.6) ? { directorId: "dir" } : {}), ...(r.si(0.5) ? { setterId: "set" } : {}),
      excluidoMarketing: r.si(0.2), estado: r.si(0.1) ? "cancelada" : "activa",
    }));
    const nCuotas = r.entre(1, 3);
    for (let k = 0; k < nCuotas; k++) {
      cuotas.push({ id: `c${i}_${k}`, ventaId: `v${i}`, numero: k + 1, monto: 100, estado: "pagada", esReserva: false,
        ...(r.si(0.1) ? { closerId: r.elige(["c1", "c2"]) } : {}) });
      if (r.si(0.85)) {
        const monto = r.plata(50, 3000);
        /* La comisión del procesador, sin redondear: ahí se juega el centavo. */
        const fee = monto * r.elige([0.029, 0.045, 0.06, 0.1]);
        const dia = r.si(0.9) ? r.entre(1, 30) : r.entre(1, 3);
        pagos.push({ ...pago(`p${i}_${k}`, `c${i}_${k}`, monto, fee, fechaDe(dia), r.elige(["s", "h", "f"])), feeMonto: fee });
      }
    }
  }
  const gastos = Array.from({ length: r.entre(0, 8) }, (_, i) => ({
    id: `g${i}`, categoria: r.elige(["Facturas Stripe", "Meta Ads", "Software", "Setters"]), grupo: r.elige(["directo", "operativo"]),
    concepto: "Gasto", monto: r.plata(20, 4000), moneda: "USD", fecha: fechaDe(r.entre(1, 28)), recurrente: false, creadoEn: fechaDe(1), extra: {},
  }));
  const sesiones = Array.from({ length: r.entre(0, 40) }, (_, i) =>
    sesion(`s${i}`, r.elige(["Resell", "organico", "Webinar"]), r.elige(["agendada", "hecha", "cancelada"]), fechaDe(r.entre(1, 30))));

  const bases: BaseMedicion[] = ["cash", "cash-neto", "facturado", "profit", "ventas", "llamadas", "llamadas-hechas", "manual"];
  const alcances: AlcanceVentas[] = ["todas", "closer", "setter", "director"];
  const entradas: Record<string, EntradaLiquidacion> = {};
  const honorarios = equipo.map((m) => {
    const cs: ConceptoPago[] = [];
    const n = r.entre(0, 4);
    for (let i = 0; i < n; i++) {
      const id = `k${i}`;
      const tipo = r.elige(["fijo", "bono", "porcentaje", "porcentaje", "tramo", "unidad"] as const);
      const vigencia = r.si(0.3) ? { desde: `${MES}-${String(r.entre(1, 20)).padStart(2, "0")}` } : r.si(0.2) ? { hasta: `${MES}-${String(r.entre(5, 28)).padStart(2, "0")}` } : {};
      const filtros = {
        alcance: r.elige(alcances), base: r.elige(bases),
        ...(r.si(0.3) ? { productoIds: [r.elige(["pa", "pb", "pc"])] } : {}),
        ...(r.si(0.3) ? { sinExcluidasMarketing: true } : {}), ...(r.si(0.3) ? { sinVentasSinComision: true } : {}),
        ...(r.si(0.3) ? { utmSource: r.elige(["Resell", "Webinar"]) } : {}),
      };
      if (tipo === "fijo") cs.push(concepto({ id, tipo, nombre: "Fijo", monto: r.plata(100, 3000), ...vigencia }));
      else if (tipo === "bono") cs.push(concepto({ id, tipo, nombre: "Bono", monto: r.plata(50, 800), ...(r.si(0.5) ? { condicion: "Cumplir" } : {}) }));
      else if (tipo === "porcentaje") cs.push(concepto({ id, tipo, nombre: "Comisión", tasa: r.elige([0.05, 0.0725, 0.1, 0.125, 0.15, 0]), ...filtros, ...vigencia }));
      else if (tipo === "tramo") cs.push(concepto({ id, tipo, nombre: "Tramo", monto: r.plata(20, 600), cada: r.elige([3, 5, 15, 1000, 2500, 7500]), ...filtros, ...vigencia }));
      else cs.push(concepto({ id, tipo, nombre: "Pieza", monto: r.plata(5, 200), unidad: "reel", ...(r.si(0.2) ? { moneda: "ARS" as const } : {}) }));
      /* Lo que se carga a mano al liquidar. */
      const clave = `${m.id}:${id}`;
      if (tipo === "unidad" && r.si(0.7)) entradas[clave] = { cantidad: r.entre(0, 40) };
      else if (tipo === "bono" && r.si(0.3)) entradas[clave] = { cumplido: false };
      else if ((tipo === "porcentaje" || tipo === "tramo") && r.si(0.1)) entradas[clave] = { cantidad: r.entre(0, 100000) };
      if (r.si(0.1)) entradas[clave] = { ...entradas[clave], monto: r.plata(-100, 2000), nota: "A mano" };
    }
    return esquema(m.id, cs);
  });
  void ids;
  const e = {
    ajustes: { monedaBase: "USD", tipoCambio: r.si(0.8) ? 1500 : 0 }, equipo, honorarios, productos, procesadores,
    ventas, cuotas, pagos, gastos, sesiones, liquidaciones: [],
  } as unknown as EstadoApp;
  return { e, entradas };
}

test("200 escenarios al azar: en todos los renglones la cuenta cierra exactamente con el monto", () => {
  let renglones = 0, conLista = 0, corregidos = 0, conAjuste = 0, conPerdida = 0;
  for (let semilla = 1; semilla <= 200; semilla++) {
    const { e, entradas } = escenario(semilla);
    const liq = { ...liquidacionVacia(MES, "2026-10-01T12:00:00.000Z"), entradas };
    const res = calcularLiquidacion(e, MES, liq);
    /* Y la foto viaja bien por JSON. */
    const foto = JSON.parse(JSON.stringify(res)) as typeof res;
    for (const p of foto.personas) {
      for (const l of p.lineas) {
        const donde = `semilla ${semilla} · ${p.nombre} · «${l.nombre}»`;
        assert.ok(l.desglose, donde);
        const d = l.desglose;
        assert.deepEqual(evaluarPasos(d.pasos).fallas, [], donde);
        const cierra = d.correccion ? d.correccion.cuentaDaba : l.monto;
        assert.equal(resultadoDelDesglose(d), cierra, donde);
        if (d.correccion) { corregidos++; assert.ok(l.corregido, donde); }
        if (d.lista) { conLista++; assert.ok(d.lista.items.length <= 10 && d.lista.total >= d.lista.items.length, donde); }
        if (d.pasos.some((x) => x.texto.startsWith("Ajuste de centavos"))) conAjuste++;
        if (d.avisos?.includes("El mes dio pérdida: no hay profit para repartir.")) conPerdida++;
        for (const x of d.pasos) assert.ok(Number.isFinite(x.valor), donde);
        /* El profit de cualquier renglón del profit es el de la liquidación. */
        const profit = d.pasos.find((x) => x.texto === "Profit del mes");
        if (profit && !d.avisos?.some((a) => a.includes("se cargó a mano"))) assert.equal(profit.valor, foto.profit, donde);
        renglones++;
      }
    }
  }
  /* Que el azar haya tocado de todo: si esto falla, el generador dejó de estresar algo. */
  assert.ok(renglones > 500, `renglones: ${renglones}`);
  assert.ok(conLista > 50, `con lista: ${conLista}`);
  assert.ok(corregidos > 10, `corregidos: ${corregidos}`);
  console.log(`  (renglones ${renglones}, con lista ${conLista}, corregidos ${corregidos}, con ajuste de centavos ${conAjuste}, con pérdida ${conPerdida})`);
});
