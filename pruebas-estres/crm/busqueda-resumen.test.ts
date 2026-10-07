import test from "node:test";
import assert from "node:assert/strict";
import {
  adDe, anguloDe, COLUMNA, coincideBusqueda, DIMENSIONES, opcionesDeColumna, paisDeTelefono, PAISES, porDimension, resumenDe, VACIAS, viaDe,
  type FilaTabla,
} from "@/lib/crm-tabla";
import { CANCELADA, CON_CIERRE, NO_SE_PRESENTO, POR_VENIR, REPROGRAMO, SIN_CARGAR, SIN_CIERRE } from "@/lib/estados";
import { construirSemilla } from "@/lib/seed";
import { filasTabla } from "@/lib/crm-tabla";
import type { Sesion } from "@/lib/types";
import { Azar, conSemilla, filasDeMundo, textoAzar } from "./gen";

/* ==================================================================
   Lo que rodea a la tabla: la búsqueda de la lupa, el resumen del
   informe (resumenDe / porDimension; en esta versión la función se llama
   resumenDe), y las ayudas que arman los valores de las columnas (el
   ángulo del ad, el país del teléfono, la vía y el ad de cada agenda).
   ================================================================== */

const plano = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/* ---------- La búsqueda ---------- */

test("coincideBusqueda: una búsqueda vacía o de espacios deja pasar todo; si no, es «está en el nombre, mail, teléfono, closer o notas» sin tildes ni mayúsculas", () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = new Azar(semilla);
    const { filas } = filasDeMundo(r, { sesiones: 80 });
    for (const q of ["", " ", "   ", "\t", "\n"]) assert.ok(filas.every((f) => coincideBusqueda(f, q)), conSemilla(semilla, JSON.stringify(q)));
    const f0 = r.pick(filas);
    const campo = r.pick([f0.nombre, f0.email, f0.telefono, f0.closer, f0.notas].filter(Boolean));
    const i = r.int(Math.max(1, campo.length - 1));
    const consultas = [campo.slice(i, i + r.entre(1, 6)), textoAzar(r, 4), r.pick(["(", "[", "*", "+", ".", "\\", "?", "^", "$", "|", "a|b", "(?:x)", "[a-"]), `  ${campo.slice(0, 3)}  `];
    for (const q of consultas) {
      const nq = plano(q.trim());
      for (const f of filas) {
        const esperado = !nq || [f.nombre, f.email, f.telefono, f.closer, f.notas].some((x) => plano(x ?? "").includes(nq));
        assert.equal(coincideBusqueda(f, q), esperado, conSemilla(semilla, `q=${JSON.stringify(q)} fila ${f.id}`));
      }
    }
    /* Mayúsculas y tildes no cambian nada. */
    const q = f0.nombre.slice(0, 4);
    if (q.trim()) for (const f of filas) assert.equal(coincideBusqueda(f, q.toUpperCase()), coincideBusqueda(f, plano(q)), conSemilla(semilla, "mayúsculas/tildes"));
    /* Escribir una letra más sólo saca llamadas. */
    const a = new Set(filas.filter((f) => coincideBusqueda(f, q)));
    for (const f of filas) if (coincideBusqueda(f, `${q}x`)) assert.ok(a.has(f), conSemilla(semilla, "una letra más agregó una llamada"));
  }
});

test("coincideBusqueda no se cae con campos vacíos o ausentes y trata los signos de regex como texto", () => {
  const { filas } = filasDeMundo(new Azar(3), { sesiones: 5 });
  const f = { ...filas[0], nombre: "Ana (López) [1]", email: undefined as unknown as string, telefono: "+54 9 11 5555-1234", closer: "", notas: "100% seguro. a+b*c" };
  for (const q of ["(lópez)", "[1]", "100%", "a+b*c", "seguro.", "+54 9", "5555-1234", "ana (", "López"]) assert.ok(coincideBusqueda(f, q), q);
  for (const q of [".*", "a.b", "^ana", "ana$", "\\d", "[0-9]", "(a|b)"]) assert.equal(coincideBusqueda(f, q), false, q);
});

/* ---------- El informe ---------- */

const contar = (filas: FilaTabla[], r: string) => filas.filter((f) => f.resultado === r).length;

test("resumenDe: cada llamada cae en un solo desenlace, las cuentas cierran entre sí y el porcentaje es el de los que se presentaron", () => {
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = new Azar(semilla + 100);
    const { filas } = filasDeMundo(r, { sesiones: r.entre(0, 120), ventas: 50, pagos: 0, raro: r.bool(0.3) });
    const x = resumenDe(filas);
    const ctx = (m: string) => conSemilla(semilla, m);
    assert.equal(x.llamadas, filas.length, ctx("llamadas"));
    assert.equal(x.cierres, contar(filas, CON_CIERRE), ctx("cierres"));
    assert.equal(x.sinCierre, contar(filas, SIN_CIERRE), ctx("sin cierre"));
    assert.equal(x.noVino, contar(filas, NO_SE_PRESENTO), ctx("no vino"));
    assert.equal(x.presentaron, x.cierres + x.sinCierre, ctx("presentaron = cierres + sin cierre"));
    assert.equal(x.pasaron, filas.filter((f) => (f.pasada || [CON_CIERRE, SIN_CIERRE, NO_SE_PRESENTO].includes(f.resultado)) && f.resultado !== CANCELADA && f.resultado !== POR_VENIR).length, ctx("pasaron"));
    assert.equal(x.sinCargar, filas.filter((f) => f.sinCargar).length, ctx("sin cargar"));
    /* Todo desenlace está en una cuenta: nada se pierde ni se cuenta dos veces. */
    assert.equal(
      x.cierres + x.sinCierre + x.noVino + contar(filas, CANCELADA) + contar(filas, REPROGRAMO) + contar(filas, SIN_CARGAR) + contar(filas, POR_VENIR), filas.length, ctx("partición de desenlaces"));
    assert.ok(x.cierres <= x.presentaron && x.presentaron <= x.pasaron && x.pasaron <= x.llamadas, ctx("orden de las cuentas"));
    assert.ok(x.sinCargar <= x.pasaron, ctx("sin cargar ≤ pasaron"));
    if (x.presentaron === 0) assert.equal(x.pctCierre, null, ctx("pct sin presentados"));
    else { assert.ok(x.pctCierre !== null && x.pctCierre >= 0 && x.pctCierre <= 100, ctx("pct fuera de rango")); assert.equal(x.pctCierre, (x.cierres / x.presentaron) * 100, ctx("pct")); }
    /* Las objeciones son las de las que no cerraron, y se ordenan de la más frecuente a la menos. */
    assert.equal(x.objeciones.reduce((s, o) => s + o.n, 0), x.sinCierre, ctx("objeciones suman las sin cierre"));
    for (let i = 1; i < x.objeciones.length; i++) {
      const a = x.objeciones[i - 1], b = x.objeciones[i];
      assert.ok(a.n > b.n || (a.n === b.n && a.objecion.localeCompare(b.objecion) <= 0), ctx(`orden de objeciones ${a.objecion} / ${b.objecion}`));
    }
    assert.equal(new Set(x.objeciones.map((o) => o.objecion)).size, x.objeciones.length, ctx("objeciones repetidas"));
    /* Es aditivo: partir las llamadas en dos y sumar da lo mismo, en cualquier orden. */
    const mitad = r.shuffle(filas);
    const a = resumenDe(mitad.slice(0, mitad.length >> 1)), b = resumenDe(mitad.slice(mitad.length >> 1));
    for (const k of ["llamadas", "pasaron", "presentaron", "cierres", "sinCierre", "noVino", "sinCargar"] as const) assert.equal(a[k] + b[k], x[k], ctx(`aditivo ${k}`));
  }
});

test("BUG: «Llamadas que pasaron» (resumenDe.pasaron) cuenta una llamada futura a la que el setter le puso «Reagendar»", () => {
  /* NumerosResumen.pasaron: «las que ya pasaron y no se cancelaron». El desenlace de una llamada con Pre-Call «Reagendar» es «Reprogramó»
     aunque todavía no haya llegado su fecha, y resumenDe sólo descarta CANCELADA y POR_VENIR. */
  const ahora = Date.parse("2026-10-07T15:00:00.000Z");
  const mk = (id: string, extra: Partial<Sesion>) => ({
    id, titulo: "A", invitado: id, inicia: "2026-10-09T15:00:00.000Z", duracionMin: 45, estado: "agendada", tipo: "Asesoramiento X", origen: "calendly",
    creadoEn: "2026-10-01T12:00:00.000Z", extra: {}, contactoId: id, ...extra,
  }) as Sesion;
  const e = {
    sesiones: [mk("futura", {}), mk("futura_reagendar", { estadoPreCall: "Reagendar" }), mk("pasada", { inicia: "2026-10-05T15:00:00.000Z" })],
    contactos: [], leads: [], ajustes: construirSemilla().ajustes, webinars: [], ventas: [], productos: [],
  };
  const filas = filasTabla(e as never, ahora);
  assert.equal(filas.filter((f) => Date.parse(f.llamada) <= ahora).length, 1);
  assert.equal(resumenDe(filas).pasaron, 1, "las dos futuras no deberían contar como «pasaron»");
});

test("porDimension: cada fila de cada columna es el resumen de las llamadas que tienen ese valor, y las cuentas son las del menú del filtro", () => {
  for (let semilla = 1; semilla <= 25; semilla++) {
    const r = new Azar(semilla + 300);
    const { filas } = filasDeMundo(r, { sesiones: 120, ventas: 50, pagos: 0 });
    for (const d of DIMENSIONES) {
      const grupos = porDimension(filas, d);
      const col = COLUMNA[d];
      const ctx = (m: string) => conSemilla(semilla, `${d}: ${m}`);
      assert.equal(new Set(grupos.map((g) => g.valor)).size, grupos.length, ctx("valores repetidos"));
      /* Mismos valores y mismas cuentas que el menú del filtro de esa columna. */
      const menu = new Map(opcionesDeColumna(filas, {}, d).map((o) => [o.valor, o.cuenta]));
      assert.deepEqual(new Map(grupos.map((g) => [g.valor, g.llamadas])), menu, ctx("cuentas ≠ menú del filtro"));
      for (const g of grupos) {
        const { valor, ...numeros } = g;
        assert.deepEqual(numeros, resumenDe(filas.filter((f) => col.valores(f).includes(valor))), ctx(`grupo ${valor}`));
      }
      /* Las vacías van al final; el resto, de las que más se presentaron a las que menos. */
      const iv = grupos.findIndex((g) => g.valor === VACIAS);
      if (iv >= 0) assert.equal(iv, grupos.length - 1, ctx("(Vacías) no quedó al final"));
      const resto = grupos.filter((g) => g.valor !== VACIAS);
      for (let i = 1; i < resto.length; i++) {
        const a = resto[i - 1], b = resto[i];
        assert.ok(a.presentaron > b.presentaron || (a.presentaron === b.presentaron && a.llamadas >= b.llamadas), ctx(`orden ${a.valor} / ${b.valor}`));
      }
      /* Una columna de un valor por llamada reparte todas las llamadas. */
      if (filas.every((f) => col.valores(f).length === 1)) assert.equal(grupos.reduce((s, g) => s + g.llamadas, 0), filas.length, ctx("no reparte todas"));
    }
  }
});

/* ---------- El ángulo del ad ---------- */

test("anguloDe: las copias y el formato del archivo son el mismo ángulo (hasta cuatro copias seguidas)", () => {
  const casos: [string, string][] = [
    ["MERCADO SATURADO.mp4 - Copia 2", "MERCADO SATURADO"], ["MERCADO SATURADO.mp4", "MERCADO SATURADO"], ["Mercado Saturado - Copia", "Mercado Saturado"],
    ["Hook 3.jpg - Copia - Copia", "Hook 3"], ["x.MOV", "x"], ["x.jpeg", "x"], ["x.png - copia 12", "x"], ["  muchos    espacios  .mp4 ", "muchos espacios"],
    ["", ""], ["   ", ""], ["Testimonio Juan", "Testimonio Juan"], ["a - Copia - Copia - Copia - Copia", "a"],
  ];
  for (const [ad, esperado] of casos) assert.equal(anguloDe(ad), esperado, JSON.stringify(ad));
  /* Con cualquier cantidad (hasta 4) de copias y extensiones mezcladas, da el nombre solo; y es idempotente. */
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = new Azar(semilla + 500);
    const nombre = textoAzar(r, 10).replace(/[-.]/g, "x").trim() || "ad";
    let ad = nombre + r.pick(["", ".mp4", ".MOV", ".jpg"]);
    for (let i = r.int(4); i > 0; i--) ad += r.pick([" - Copia", " - copia 2", " -  COPIA 13", "- Copia"]);
    const a = anguloDe(ad);
    assert.equal(a, anguloDe(nombre), conSemilla(semilla, JSON.stringify(ad)));
    assert.equal(anguloDe(a), a, conSemilla(semilla, "no es idempotente"));
    assert.equal(a, a.trim());
    assert.ok(!/\s{2,}/.test(a));
  }
});

test("BUG: anguloDe sólo quita hasta cuatro copias: un ad duplicado cinco veces seguidas queda como otro ángulo", () => {
  /* El bucle `for (let i = 0; i < 4; i++)` corta a las cuatro pasadas: «X - Copia - Copia - Copia - Copia - Copia» deja «X - Copia». */
  assert.equal(anguloDe("MERCADO SATURADO.mp4 - Copia - Copia - Copia - Copia - Copia"), "MERCADO SATURADO");
  assert.equal(anguloDe("MERCADO SATURADO - Copia 5 - Copia 4 - Copia 3 - Copia 2 - Copia"), "MERCADO SATURADO");
});

/* ---------- País, vía y ad ---------- */

test("paisDeTelefono: el prefijo más largo gana; sin + ni 00 no se adivina; formato y espacios no cuentan", () => {
  const codigos: [string, string][] = [
    ["54", "Argentina"], ["55", "Brasil"], ["56", "Chile"], ["57", "Colombia"], ["58", "Venezuela"], ["51", "Perú"], ["52", "México"], ["53", "Cuba"],
    ["591", "Bolivia"], ["593", "Ecuador"], ["595", "Paraguay"], ["598", "Uruguay"], ["506", "Costa Rica"], ["507", "Panamá"], ["502", "Guatemala"],
    ["503", "El Salvador"], ["504", "Honduras"], ["505", "Nicaragua"], ["34", "España"], ["33", "Francia"], ["39", "Italia"], ["44", "Reino Unido"], ["49", "Alemania"],
    ["1415", "Estados Unidos"], ["1809", "República Dominicana"], ["1829", "República Dominicana"], ["1849", "República Dominicana"], ["1787", "Puerto Rico"], ["1939", "Puerto Rico"],
  ];
  for (const [codigo, pais] of codigos) {
    const resto = "5551234";
    for (const f of [`+${codigo}${resto}`, `+${codigo} ${resto}`, `+${codigo}-${resto.slice(0, 3)}-${resto.slice(3)}`, `+ ${codigo} (${resto.slice(0, 3)}) ${resto.slice(3)}`, `00${codigo}${resto}`, `  +${codigo}${resto}  `]) {
      assert.equal(paisDeTelefono(f), pais, f);
    }
    assert.equal(paisDeTelefono(`${codigo}${resto}`), "", `sin + ni 00: ${codigo}${resto}`);
  }
  for (const x of [null, undefined, "", "abc", "+", "00", "+99 123", "11 5555-1234", "+0 12", "++54"]) assert.doesNotThrow(() => paisDeTelefono(x as string));
  assert.equal(paisDeTelefono("+54 9 11 5555-1234"), "Argentina");
  for (let semilla = 1; semilla <= 200; semilla++) {
    const r = new Azar(semilla + 700);
    const p = paisDeTelefono(`${r.pick(["+", "00", "", "+ "])}${textoAzar(r, 14)}`);
    assert.ok(p === "" || PAISES.includes(p), conSemilla(semilla, p));
  }
});

test("adDe: sólo la pauta de Meta trae ad y campaña (la de la agenda primero; si no, la de la persona)", () => {
  const meta = (extra: Record<string, string> = {}) => ({ utm_source: "meta", utm_medium: "paid", utm_content: "AD1", utm_campaign: "CAMP1", ...extra });
  for (const source of ["meta", "Meta", "facebook", "fb", "instagram", "ig", "IG"]) for (const medium of ["paid", "cpc", "ad", "ads", "pauta", "PAID"]) {
    assert.deepEqual(adDe({ utm: meta({ utm_source: source, utm_medium: medium }) }), { ad: "AD1", campania: "CAMP1" }, `${source} ${medium}`);
  }
  for (const source of ["email", "youtube", "direct", "setter", ""]) assert.deepEqual(adDe({ utm: meta({ utm_source: source }) }), { ad: "", campania: "" }, source);
  for (const medium of ["organic", "email", "referral", "", "paid_social"]) assert.deepEqual(adDe({ utm: meta({ utm_medium: medium }) }), { ad: "", campania: "" }, medium);
  assert.deepEqual(adDe({ utm: { source: "meta", medium: "cpc", content: "Viejo", campaign: "C" } }), { ad: "Viejo", campania: "C" }, "las llaves sin utm_");
  assert.deepEqual(adDe({ utm: undefined }, { utm: meta() }), { ad: "AD1", campania: "CAMP1" }, "la de la persona");
  assert.deepEqual(adDe({ utm: meta({ utm_content: "DE LA AGENDA" }) }, { utm: meta() }), { ad: "DE LA AGENDA", campania: "CAMP1" });
  assert.deepEqual(adDe({ utm: {} }, null), { ad: "", campania: "" });
  assert.deepEqual(adDe({ utm: null as never }, undefined), { ad: "", campania: "" });
});

test("viaDe: siempre dice algo (nunca vacía), y el estándar de UTMs se lee por evento y por momento", () => {
  const f = (funnel = "") => ({ funnel });
  assert.equal(viaDe({ utm: { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20260924", utm_content: "vivo" } }, f()), "Webinar · vivo");
  assert.equal(viaDe({ utm: { utm_source: "email", utm_medium: "email", utm_campaign: "webinar_20260924", utm_content: "replay" } }, f()), "Webinar · replay");
  assert.equal(viaDe({ utm: { utm_source: "email", utm_medium: "email", utm_campaign: "clase0_webinar_20260924", utm_content: "seguimiento" } }, f()), "Clase cero · seguimiento");
  assert.equal(viaDe({ utm: { utm_source: "direct", utm_medium: "none" } }, f()), "Directo");
  assert.equal(viaDe({ utm: undefined }, f()), "Sin UTMs");
  assert.equal(viaDe({ utm: {} }, f("Setter")), "Setter");
  for (let semilla = 1; semilla <= 120; semilla++) {
    const r = new Azar(semilla + 900);
    const utm: Record<string, string> = {};
    for (const k of r.algunos(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "source", "campaign"], 0, 5)) utm[k] = r.pick(["webinar_20260924", "vsl", "Webinar", "23-09", "direct", "none", "meta", "paid", "vivo", "", textoAzar(r, 8)]);
    const v = viaDe({ utm }, f(r.pick(["", "Setter", "VSL"])));
    assert.ok(typeof v === "string" && v.length > 0, conSemilla(semilla, JSON.stringify(utm)));
  }
});
