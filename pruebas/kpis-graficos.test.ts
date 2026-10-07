import test from "node:test";
import assert from "node:assert/strict";
import { construirSemilla } from "@/lib/seed";
import {
  catalogo, conFiltro, conPrevios, Contexto, cortesPorDia, cortesPorMes, cuotasExigibles, valorEn, webinarsParaFiltro,
  type Corte, type FiltroKpi,
} from "@/lib/kpis";
import {
  conMovimiento, DIMENSIONES, desglosePor, medidasDe, METRICAS, moraCategoria, moraDe, ordenar, ordenDeDimension, paisesDelMapa,
  pagosDeCategoria, pesoDe, piezasDeDesglose, piezasDeMora, piezasDeSerie, piezasDeTasa, piezasDeTicket, queSeVe, recortar, serieTemporal, tasaCobro,
  textoDePais, valorDe, ventasDeCategoria, ZONAS_MAPA, type Categoria, type DimensionId,
} from "@/lib/kpis-graficos";
import { OTRO_PAIS, SIN_PAIS } from "@/lib/paises";
import type { Contacto, EstadoApp } from "@/lib/types";

/* Los gráficos no calculan nada nuevo: reparten los totales de la tabla.
   Estas pruebas verifican que la suma de las categorías (el «Sin dato»
   incluido) da EXACTAMENTE la celda de la tabla, con cada filtro. */

const e = construirSemilla();
const defs = catalogo(e);
const porId = new Map(defs.map((d) => [d.id, d]));

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const hoy = new Date();
const HASTA = iso(hoy);
const total = (desde: string, hasta: string, filtro?: FiltroKpi): Corte =>
  ({ clave: "total", titulo: "Total", desde, hasta, foto: true, total: true, ...(filtro ? { filtro } : {}) });

/* Todo el semillero, y recortes: el mes, la última semana, un día, un embudo y un webinar. */
const hace = (dias: number) => iso(new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - dias));
const webinar = webinarsParaFiltro(e).find((w) => e.ventas.some((v) => v.webinarId === w.id))!;
const CORTES: [string, Corte][] = [
  ["todo", total("2000-01-01", HASTA)],
  ["el mes", total(`${HASTA.slice(0, 8)}01`, HASTA)],
  ["una semana", total(hace(6), HASTA)],
  ["un día", total(hace(20), hace(20))],
  ["un embudo", total("2000-01-01", HASTA, { embudoId: "emb_webinar" })],
  ["otro embudo", total("2000-01-01", HASTA, { embudoId: "emb_vsl_martin" })],
  ["un webinar", total("2000-01-01", HASTA, { webinarId: webinar.id })],
];

const fila = (id: string, c: Contexto) => {
  const v = valorEn(porId.get(id)!, c);
  assert.ok(v !== null, `${id}: sin valor`);
  return v!;
};
const casi = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} ≠ ${b}`);

test("el semillero tiene con qué probar", () => {
  assert.ok(e.ventas.length > 100 && e.pagos.length > 100, "pocas ventas");
  assert.ok(valorEn(porId.get("v_fact")!, new Contexto(e, CORTES[0][1]))! > 0);
});

test("la suma de las categorías da la celda de la tabla, en cada dimensión y con cada filtro", () => {
  for (const [que, corte] of CORTES) {
    const c = new Contexto(e, corte);
    for (const dim of DIMENSIONES) {
      const d = desglosePor(c, dim.id);
      const sub = `${dim.id} · ${que}`;
      casi(d.categorias.reduce((a, x) => a + x.unidades, 0), fila("v_n", c), `Unidades (${sub})`);
      casi(d.categorias.reduce((a, x) => a + x.revenue, 0), fila("v_fact", c), `Revenue (${sub})`);
      casi(d.categorias.reduce((a, x) => a + x.cc, 0), fila("c_cc", c), `CC (${sub})`);
      casi(d.categorias.reduce((a, x) => a + x.vencidas, 0), fila("c_vencidas", c), `Cuotas vencidas (${sub})`);
      casi(d.categorias.reduce((a, x) => a + x.saldoVencido, 0), fila("c_vencido", c), `Vencido (${sub})`);
      casi(d.categorias.reduce((a, x) => a + x.exigibles, 0), cuotasExigibles(c).length, `Cuotas que ya vencieron (${sub})`);
      /* El total que dice el desglose es la suma de sus categorías. */
      casi(d.total.revenue, c.facturado(), `total Revenue (${sub})`);
      casi(d.total.cc, c.cobrado(), `total CC (${sub})`);
      assert.equal(d.total.unidades, c.ventasContables().length, `total Unidades (${sub})`);
    }
  }
});

test("las medidas de cada corte son las filas de la tabla: Revenue, CC, ventas, tasa de cobro y ticket", () => {
  for (const [que, corte] of CORTES) {
    const c = new Contexto(e, corte);
    const m = medidasDe(c);
    casi(m.revenue, fila("v_fact", c), `Revenue (${que})`);
    casi(m.cc, fila("c_cc", c), `CC (${que})`);
    assert.equal(m.ventas, fila("v_n", c), `Ventas (${que})`);
    const tasa = valorEn(porId.get("c_tasa")!, c);
    if (tasa === null) assert.equal(m.tasaCobro, null); else casi(m.tasaCobro!, tasa, `Tasa de cobro (${que})`);
    const ticket = valorEn(porId.get("v_ticket")!, c);
    if (ticket === null) { assert.equal(m.ticketRev, null); assert.equal(m.ticketCC, null); } else {
      casi(m.ticketRev!, ticket, `Ticket sobre Revenue (${que})`);
      /* El ticket sobre CC es la misma cuenta con lo cobrado. */
      casi(m.ticketCC!, m.cc / m.ventas, `Ticket sobre CC (${que})`);
    }
    const mora = moraDe(c);
    casi(mora.pct, fila("c_mora", c), `Tasa de mora (${que})`);
    casi(mora.saldo, fila("c_vencido", c), `Vencido (${que})`);
    assert.equal(mora.vencidas, fila("c_vencidas", c));
  }
});

test("plan de pago: las cuatro categorías son las filas «En 1 pago» a «En 4 cuotas o más»", () => {
  for (const [que, corte] of CORTES) {
    const c = new Contexto(e, corte);
    const d = desglosePor(c, "plan");
    const unidades = (k: string) => d.categorias.find((x) => x.clave === k)?.unidades ?? 0;
    assert.equal(unidades("1"), fila("v_1", c), `1 pago (${que})`);
    assert.equal(unidades("2"), fila("v_2", c), `2 cuotas (${que})`);
    assert.equal(unidades("3"), fila("v_3", c), `3 cuotas (${que})`);
    assert.equal(unidades("4+"), fila("v_4", c), `4 o más (${que})`);
    /* Lo que no está en ninguna de las cuatro (ventas sin cuotas) va aparte, sin perderse. */
    assert.equal(unidades("1") + unidades("2") + unidades("3") + unidades("4+") + unidades("0") + unidades(SIN_PAIS), fila("v_n", c));
  }
});

test("estrategia y servicio: cada barra es el nombre de su embudo o producto", () => {
  const c = new Contexto(e, CORTES[0][1]);
  const porEstrategia = desglosePor(c, "estrategia");
  for (const emb of e.embudos) {
    const cat = porEstrategia.categorias.find((x) => x.clave === `e:${emb.id}`);
    const ventas = c.ventas().filter((v) => v.embudoId === emb.id);
    casi(cat?.revenue ?? 0, ventas.reduce((a, v) => a + v.precioAcordado, 0), `Revenue de ${emb.nombre}`);
    if (cat) assert.equal(cat.nombre, emb.nombre);
  }
  const porServicio = desglosePor(c, "servicio");
  for (const p of e.productos) {
    const cat = porServicio.categorias.find((x) => x.clave === `s:${p.id}`);
    casi(cat?.revenue ?? 0, c.ventas().filter((v) => v.productoId === p.id).reduce((a, v) => a + v.precioAcordado, 0), `Revenue de ${p.nombre}`);
  }
});

/* ---------- Lo que no se puede ubicar no se pierde ---------- */

function conCambios(cambios: (e: EstadoApp) => Partial<EstadoApp>): EstadoApp {
  return { ...e, ...cambios(e) };
}

test("un cobro que no encuentra su venta, o una venta sin dato, cae en «Sin dato» y el total no cambia", () => {
  const pago = e.pagos[0];
  const raro = conCambios((x) => ({
    pagos: [...x.pagos, { ...pago, id: "pag_huerfano", cuotaId: "cuota_que_no_existe", monto: 321.5 }],
    ventas: x.ventas.map((v, i) => (i === 0 ? { ...v, embudoId: undefined, productoId: undefined, proyecto: undefined, contactoId: undefined } : v)),
  }));
  const corte = total("2000-01-01", "2999-12-31");
  const c = new Contexto(raro, corte);
  casi(c.cobrado(), new Contexto(e, corte).cobrado() + 321.5, "el cobro huérfano suma al CC de la tabla");
  for (const dim of DIMENSIONES) {
    const d = desglosePor(c, dim.id);
    casi(d.categorias.reduce((a, x) => a + x.cc, 0), c.cobrado(), `CC (${dim.id})`);
    casi(d.categorias.reduce((a, x) => a + x.revenue, 0), c.facturado(), `Revenue (${dim.id})`);
    const sin = d.categorias.find((x) => x.clave === SIN_PAIS);
    assert.ok(sin, `${dim.id}: falta «Sin dato»`);
    assert.ok(sin!.sinDato);
    assert.ok(sin!.cc >= 321.5, `${dim.id}: el cobro huérfano no está en «Sin dato»`);
  }
  assert.equal(desglosePor(c, "estrategia").categorias.find((x) => x.clave === SIN_PAIS)?.nombre, "Sin dato");
  assert.equal(desglosePor(c, "pais").categorias.find((x) => x.clave === SIN_PAIS)?.nombre, "Sin país");
});

test("país: «México», «Mexico» y «MX» son la misma barra; el contacto manda sobre el lead y el alumno", () => {
  const ventas = e.ventas.filter((v) => v.estado === "activa").slice(0, 6);
  const contacto = (id: string, pais?: string): Contacto => ({ id, nombre: id, email: `${id}@x.com`, pais, creadoEn: ventas[0].fecha, extra: {} });
  const lead = e.leads[0], lead2 = e.leads[1];
  const raro = conCambios((x) => ({
    contactos: [contacto("c1", "México"), contacto("c2", "Mexico"), contacto("c3", "MX"), contacto("c4", "Latam"), contacto("c5", undefined)],
    leads: x.leads.map((l) => (l.id === lead.id ? { ...l, contactoId: "c5", pais: "Chile" } : l.id === lead2.id ? { ...l, pais: "Perú" } : l)),
    ventas: x.ventas.map((v) => {
      const i = ventas.findIndex((y) => y.id === v.id);
      if (i < 0) return v;
      /* Directo a un contacto; a un lead (que apunta a un contacto sin país: vale el del lead); a un lead suelto. */
      if (i < 4) return { ...v, contactoId: `c${i + 1}` };
      return i === 4 ? { ...v, contactoId: lead.id } : { ...v, contactoId: lead2.id };
    }),
  }));
  const c = new Contexto(raro, total("2000-01-01", "2999-12-31"));
  const claves = ventas.map((v) => ({ v, texto: textoDePais(c, raro.ventas.find((y) => y.id === v.id)!) }));
  assert.deepEqual(claves.slice(0, 4).map((x) => x.texto), ["México", "Mexico", "MX", "Latam"]);
  assert.equal(claves[4].texto, "Chile", "el contacto sin país deja el del lead");
  assert.equal(claves[5].texto, "Perú");

  const d = desglosePor(c, "pais");
  const mx = d.categorias.find((x) => x.clave === "MX")!;
  assert.equal(mx.nombre, "México");
  const ventasMx = c.ventas().filter((v) => ["c1", "c2", "c3"].includes(v.contactoId ?? ""));
  assert.ok(ventasMx.length >= 1);
  assert.ok(mx.revenue >= ventasMx.reduce((a, v) => a + v.precioAcordado, 0) - 0.005, "las tres escrituras suman en México");
  /* Lo que se escribió pero no se reconoce queda a la vista, con lo que decía. */
  const otro = d.categorias.find((x) => x.clave === OTRO_PAIS)!;
  assert.ok(otro && otro.sinDato && otro.nombre === "Sin identificar");
  assert.ok(otro.crudos?.includes("Latam"), "sin identificar muestra lo que decía");
  casi(d.categorias.reduce((a, x) => a + x.revenue, 0), c.facturado(), "Revenue por país");
});

/* ---------- En el tiempo ---------- */

test("la serie por mes y por día: cada punto es la celda de su columna y los meses suman el total", () => {
  const filtros: (FiltroKpi | undefined)[] = [undefined, { embudoId: "emb_webinar" }, { webinarId: webinar.id }];
  for (const filtro of filtros) {
    const meses = conFiltro(cortesPorMes(HASTA), filtro ?? {});
    const dias = conFiltro(cortesPorDia(hace(29), HASTA, "últimos 30 días"), filtro ?? {});
    for (const cortes of [meses, dias]) {
      const serie = serieTemporal(e, cortes);
      assert.equal(serie.length, cortes.length - 1, "la serie no lleva la columna de Total");
      for (const p of serie) {
        const c = new Contexto(e, p.corte);
        casi(p.medidas.revenue, fila("v_fact", c), `Revenue ${p.corte.titulo}`);
        casi(p.medidas.cc, fila("c_cc", c), `CC ${p.corte.titulo}`);
        assert.equal(p.medidas.ventas, fila("v_n", c));
      }
      /* Las columnas parten el período sin pisarse: sumadas dan el Total. */
      const t = new Contexto(e, cortes[cortes.length - 1]);
      casi(serie.reduce((a, p) => a + p.medidas.revenue, 0), t.facturado(), "los puntos suman el Revenue del Total");
      casi(serie.reduce((a, p) => a + p.medidas.cc, 0), t.cobrado(), "los puntos suman el CC del Total");
    }
  }
});

test("«Comparar períodos»: cada punto trae lo mismo del paso anterior, como la tabla", () => {
  const cortes = conPrevios(cortesPorMes(HASTA));
  const serie = serieTemporal(e, cortes);
  for (const p of serie) {
    assert.ok(p.previo, `${p.corte.titulo} sin previo`);
    const c = new Contexto(e, p.corte.previo!);
    casi(p.previo!.revenue, fila("v_fact", c), `Revenue previo de ${p.corte.titulo}`);
    casi(p.previo!.cc, fila("c_cc", c), `CC previo de ${p.corte.titulo}`);
  }
  assert.ok(serieTemporal(e, cortesPorMes(HASTA)).every((p) => !p.previo), "sin comparar no hay previo");
});

test("la tasa de cobro y el ticket de un punto sin ventas ni Revenue no inventan un número", () => {
  const vacio = serieTemporal(e, [{ clave: "x", titulo: "x", desde: "2000-01-01", hasta: "2000-01-02", foto: false }])[0].medidas;
  assert.equal(vacio.revenue, 0);
  assert.equal(vacio.tasaCobro, null);
  assert.equal(vacio.ticketRev, null);
  assert.equal(vacio.ticketCC, null);
});

/* ---------- Lo que se ve y cómo se ordena ---------- */

test("cada tipo de cuenta ve los gráficos de las secciones que ve en la tabla", () => {
  const todo = queSeVe(true, true);
  assert.ok(todo.revenue && todo.cc && todo.tasaCobro && todo.mora && todo.ticketRev && todo.ticketCC && todo.unidades && !todo.ninguno);
  const soloVentas = queSeVe(true, false);
  assert.ok(soloVentas.revenue && soloVentas.unidades && soloVentas.ticketRev);
  assert.ok(!soloVentas.cc && !soloVentas.tasaCobro && !soloVentas.mora && !soloVentas.ticketCC);
  const soloCobranza = queSeVe(false, true);
  assert.ok(soloCobranza.cc && soloCobranza.tasaCobro && soloCobranza.mora);
  assert.ok(!soloCobranza.revenue && !soloCobranza.unidades && !soloCobranza.ticketRev && !soloCobranza.ticketCC);
  assert.ok(queSeVe(false, false).ninguno);
});

const cat = (nombre: string, x: Partial<Categoria> = {}): Categoria =>
  ({ clave: nombre, nombre, sinDato: false, unidades: 0, revenue: 0, cc: 0, exigibles: 0, vencidas: 0, saldoVencido: 0, ...x });

test("ordenar: de mayor a menor por la métrica, y a igual valor por nombre", () => {
  const xs = [cat("B", { revenue: 10, cc: 5 }), cat("A", { revenue: 10, cc: 9 }), cat("C", { revenue: 30, cc: 1 })];
  assert.deepEqual(ordenar(xs, "revenue").map((x) => x.nombre), ["C", "A", "B"]);
  assert.deepEqual(ordenar(xs, "cc").map((x) => x.nombre), ["A", "B", "C"]);
});

test("el plan de pago se lee en su orden: 1 pago, 2, 3, 4 o más, sin cuotas", () => {
  const c = new Contexto(e, CORTES[0][1]);
  const d = desglosePor(c, "plan");
  const orden = ordenDeDimension(d, "cc").map((x) => x.clave);
  const esperado = ["1", "2", "3", "4+", "0", SIN_PAIS].filter((k) => orden.includes(k));
  assert.deepEqual(orden, esperado);
  /* Las demás dimensiones van por valor. */
  const p = desglosePor(c, "estrategia");
  const porRevenue = ordenDeDimension(p, "revenue").map((x) => x.revenue);
  assert.deepEqual(porRevenue, [...porRevenue].sort((a, b) => b - a));
});

test("recortar: muestra las primeras y el «Sin dato» aunque quede más abajo", () => {
  const xs = ordenar([
    ...Array.from({ length: 12 }, (_, i) => cat(`P${i}`, { revenue: 1000 - i * 10 })),
    cat("Sin dato", { revenue: 5, sinDato: true }),
  ], "revenue");
  const r = recortar(xs, 5);
  assert.equal(r.visibles.length, 5);
  assert.ok(r.visibles.some((x) => x.sinDato), "el Sin dato se ve");
  assert.equal(r.visibles.length + r.resto.length, xs.length, "no se pierde ninguna");
  assert.deepEqual(r.visibles.slice(0, 4).map((x) => x.nombre), ["P0", "P1", "P2", "P3"]);
  assert.deepEqual(recortar(xs.slice(0, 3), 5), { visibles: xs.slice(0, 3), resto: [] });
});

test("conMovimiento: las categorías en cero no dibujan nada, salvo el «Sin dato» con plata", () => {
  const xs = [cat("A", { revenue: 10 }), cat("B", { cc: 3 }), cat("Sin dato", { sinDato: true, cc: 7 }), cat("Sin país", { sinDato: true })];
  assert.deepEqual(conMovimiento(xs, "revenue").map((x) => x.nombre), ["A", "Sin dato"]);
  assert.deepEqual(conMovimiento(xs, "cc").map((x) => x.nombre), ["B", "Sin dato"]);
  assert.deepEqual(conMovimiento(xs, "unidades").map((x) => x.nombre), ["Sin dato"]);
});

test("tasa de cobro, mora y peso: sin base no hay porcentaje", () => {
  assert.equal(tasaCobro({ revenue: 0, cc: 50 }), null);
  assert.equal(tasaCobro({ revenue: 200, cc: 50 }), 25);
  assert.equal(moraCategoria({ exigibles: 0, vencidas: 0 }), null);
  assert.equal(moraCategoria({ exigibles: 40, vencidas: 6 }), 15);
  assert.equal(pesoDe(25, 100), 25);
  assert.equal(pesoDe(5, 0), null);
  assert.equal(valorDe({ unidades: 1, revenue: 2, cc: 3 }, "cc"), 3);
});

/* ---------- Mapa ---------- */

test("el mapa: los países con lugar van al mapa y los demás quedan en la lista, con su peso", () => {
  const c = new Contexto(e, CORTES[0][1]);
  const d = desglosePor(c, "pais");
  const { enMapa, sinUbicar } = paisesDelMapa(d);
  assert.ok(enMapa.every((x) => x.iso.length === 2 && Number.isFinite(x.lat) && Number.isFinite(x.lon)));
  assert.ok(sinUbicar.every((x) => x.clave === SIN_PAIS || x.clave === OTRO_PAIS));
  assert.equal(enMapa.length + sinUbicar.length, d.categorias.length);
  /* Los pesos de todos, «Sin país» incluido, suman 100. */
  const peso = [...enMapa, ...sinUbicar].reduce((a, x) => a + (pesoDe(x.revenue, d.total.revenue) ?? 0), 0);
  casi(peso, 100, "pesos del Revenue");
  /* La semilla sólo trae siete países de Latinoamérica y muchas ventas sin persona: se ve el «Sin país». */
  assert.ok(sinUbicar.some((x) => x.clave === SIN_PAIS && x.revenue > 0), "falta «Sin país»");
  for (const z of ZONAS_MAPA) assert.ok(z.caja[0] < z.caja[2] && z.caja[1] < z.caja[3], `zona ${z.id}`);
});

/* ---------- Cómo se calcula ---------- */

test("«Con tus números» de un desglose suma las categorías y da el total", () => {
  const c = new Contexto(e, CORTES[0][1]);
  for (const dim of DIMENSIONES) {
    const d = desglosePor(c, dim.id);
    for (const m of METRICAS) {
      const piezas = piezasDeDesglose(d, m.id, "Total");
      const resultado = piezas[piezas.length - 1];
      assert.equal(resultado.signo, "=");
      casi(piezas.slice(0, -1).reduce((a, p) => a + (p.valor ?? 0), 0), resultado.valor!, `${dim.id} · ${m.titulo}`);
    }
  }
});

test("«Con tus números» del ticket, la tasa y la mora cierran con el valor que se dibuja", () => {
  const c = new Contexto(e, CORTES[0][1]);
  const m = medidasDe(c);
  const cuenta = (piezas: ReturnType<typeof piezasDeTicket>, f: (a: number, b: number) => number) => {
    casi(f(piezas[0].valor!, piezas[1].valor!), piezas[2].valor!, piezas[2].concepto);
  };
  cuenta(piezasDeTicket(m, "revenue"), (a, b) => a / b);
  cuenta(piezasDeTicket(m, "cc"), (a, b) => a / b);
  cuenta(piezasDeTasa(m), (a, b) => (a / b) * 100);
  cuenta(piezasDeMora(moraDe(c)), (a, b) => (a / b) * 100);
});

test("la mora por categoría suma las cuotas de la mora total", () => {
  const c = new Contexto(e, CORTES[0][1]);
  const mora = moraDe(c);
  for (const dim of (["plan", "pais", "estrategia", "servicio", "proyecto"] as DimensionId[])) {
    const d = desglosePor(c, dim);
    assert.equal(d.categorias.reduce((a, x) => a + x.vencidas, 0), mora.vencidas, dim);
    assert.equal(d.categorias.reduce((a, x) => a + x.exigibles, 0), mora.exigibles, dim);
    for (const x of d.categorias) assert.ok(x.vencidas <= x.exigibles, `${dim} · ${x.nombre}: más vencidas que exigibles`);
  }
});

test("el detalle de una categoría abre las mismas ventas y cobros que suman su barra", () => {
  for (const [que, corte] of CORTES) {
    const c = new Contexto(e, corte);
    for (const dim of DIMENSIONES) {
      const d = desglosePor(c, dim.id);
      let ventas = 0, ventasContables = 0;
      for (const cat of d.categorias) {
        const rev = ventasDeCategoria(c, dim.id, cat.clave, "revenue");
        const uni = ventasDeCategoria(c, dim.id, cat.clave, "unidades");
        const pagos = pagosDeCategoria(c, dim.id, cat.clave);
        casi(rev.reduce((a, v) => a + v.precioAcordado, 0), cat.revenue, `Revenue de ${cat.nombre} (${dim.id} · ${que})`);
        assert.equal(uni.length, cat.unidades, `Unidades de ${cat.nombre} (${dim.id} · ${que})`);
        casi(pagos.reduce((a, p) => a + p.monto, 0), cat.cc, `CC de ${cat.nombre} (${dim.id} · ${que})`);
        ventas += rev.length; ventasContables += uni.length;
      }
      /* Entre todas las categorías, ni una venta de más ni de menos. */
      assert.equal(ventas, c.ventas().length);
      assert.equal(ventasContables, c.ventasContables().length);
    }
  }
});

test("con una sola área a la vista, las piezas de la serie no muestran la otra", () => {
  const m = medidasDe(new Contexto(e, CORTES[0][1]));
  assert.deepEqual(piezasDeSerie(m, { revenue: true, cc: false }).map((p) => p.concepto), ["Revenue"]);
  assert.deepEqual(piezasDeSerie(m, { revenue: false, cc: true }).map((p) => p.concepto), ["Cash Collected (CC)"]);
  assert.equal(piezasDeSerie(m, { revenue: true, cc: true }).length, 3);
});
