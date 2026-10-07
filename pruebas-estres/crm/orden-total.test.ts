import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMNA, COLUMNAS, ORDEN_COMPROBANTE, ORDEN_CONCILIADO, ORDEN_POR_DEFECTO, ordenarFilas, valoresComprobante, valoresConciliado, VACIAS,
  COMPROBANTE_FALTA, COMPROBANTE_SI, CONCILIADO_A_MANO, CONCILIADO_NO, CONCILIADO_SI, SIN_COBROS, SIN_VENTA,
  type ClaveColumna, type FilaTabla, type OrdenColumna,
} from "@/lib/crm-tabla";
import { opcionesDe } from "@/lib/crm";
import { filasTabla } from "@/lib/crm-tabla";
import { construirSemilla } from "@/lib/seed";
import type { Sesion, Venta } from "@/lib/types";
import { POR_VENIR, SIN_CARGAR } from "@/lib/estados";
import type { CobrosDeVenta } from "@/lib/control-cobros";
import { Azar, conSemilla, diaAR3, filasDeMundo } from "./gen";

/* ==================================================================
   Frente 2: ordenarFilas es un orden total (preorden) estable y
   determinista, igual con una columna o con varias, y no explota con
   valores vacíos ni null.

   Se verifica sin reescribir el comparador: «a va estrictamente antes que b»
   se deduce de ordenar el par en los dos sentidos ([a,b] y [b,a]). Una
   salida ordenada tiene que respetar esa relación en todos sus pares, y los
   empates (ninguno va antes) tienen que quedar en el orden de entrada.
   ================================================================== */

type Lista = Partial<Record<ClaveColumna, string[]>>;
const CLAVES = COLUMNAS.map((c) => c.clave);

const antes = (a: FilaTabla, b: FilaTabla, os: OrdenColumna[], lv: Lista) =>
  ordenarFilas([a, b], os, lv)[0] === a && ordenarFilas([b, a], os, lv)[0] === a;

/* Las opciones de los estados, como las arma la pantalla (CrmTabla: ordenValores). */
function listas(e: { ajustes: Parameters<typeof opcionesDe>[0] }): Lista {
  return {
    estadoLlamada: [...opcionesDe(e.ajustes, "estadoLlamada").map((o) => o.nombre), SIN_CARGAR, POR_VENIR],
    estadoPreCall: opcionesDe(e.ajustes, "estadoPreCall").map((o) => o.nombre),
    preCall: opcionesDe(e.ajustes, "preCall").map((o) => o.nombre),
    comprobante: ORDEN_COMPROBANTE,
    conciliado: ORDEN_CONCILIADO,
  };
}

/* ---------- Filas sintéticas con muchos empates y muchos vacíos ---------- */

const pool = <T,>(...xs: T[]) => xs;
const LLAMADAS = pool("2026-10-01T15:00:00.000Z", "2026-10-01T15:00:00.000Z", "2026-10-02T02:59:59.000Z", "2026-10-02T03:00:00.000Z", "2026-09-30T23:30:00.000Z", "2026-10-09T12:00:00.000Z");
const NOMBRES = pool("", "Ana", "ana", "Álvaro", "alvaro", "Ñandú", "Nora", "Oscar", "Zoe", "Cuota 2", "Cuota 10", "Cuota 1", "  ", "(Vacías)", "1", "10", "9");
const COBROS: (CobrosDeVenta | null)[] = [
  null,
  { total: 0, conPrueba: 0, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 0 },
  { total: 2, conPrueba: 1, sinComprobante: 1, conciliados: 0, sinConciliar: 1, aMano: 1 },
  { total: 1, conPrueba: 1, sinComprobante: 0, conciliados: 1, sinConciliar: 0, aMano: 0 },
  { total: 1, conPrueba: 1, sinComprobante: 0, conciliados: 0, sinConciliar: 0, aMano: 1 },
  { total: 3, conPrueba: 3, sinComprobante: 0, conciliados: 1, sinConciliar: 0, aMano: 2 },
];

function filaSintetica(r: Azar, base: FilaTabla, i: number): FilaTabla {
  const llamada = r.pick(LLAMADAS);
  const agendo = r.pick(LLAMADAS);
  const unos = <T,>(xs: T[]) => r.pick(xs);
  return {
    ...base, id: `s${i}`,
    llamada, dia: diaAR3(Date.parse(llamada)), agendo,
    nombre: unos(NOMBRES), closer: unos(["", "Dante", "dante", "Valentín"]),
    estadoPreCall: unos(["", "Confirmado", "Reagendar", "Sin Respuesta", "Otro"]),
    estadoLlamada: unos(["", "Compra Full", "Inasistió", "Reserva", "Estado fantasma", "Compra Cuotas"]),
    aviso: unos(["", SIN_CARGAR, POR_VENIR]),
    preCall: unos(["", "1° Llamada", "COMPLETAR", "raro"]),
    objecion: unos(["", "Precio", "Tiempo", "precio"]), oferta: unos(["", "Sí", "No"]), cierre: unos(["", "2026-10-05", "2026-10-31", "2026-09-01"]),
    via: unos(["", "Webinar · vivo", "VSL", "Setter"]), ad: unos(["", "ad1", "Ad2", "ad10", "ad9"]), angulo: unos(["", "a", "b"]), campania: unos(["", "c1", "c2"]),
    pais: unos(["", "Argentina", "México", "Brasil", "España"]), edad: unos(["", "18", "9", "25", "100"]),
    tecnologias: unos([[], ["React"], ["Node", "React"], ["React", "Node"], ["Java"]]),
    formacion: unos([[], ["Terciaria"], ["Universitaria"], ["Terciaria", "Curso"]]),
    ingles: unos(["", "Básico", "Avanzado"]), experiencia: unos(["", "1 año", "10 años", "2 años"]), ingreso: unos(["", "500", "1000"]), inversion: unos(["", "690", "2000"]),
    calificada: unos(["Sí", "No"]), grabacion: unos(["", "https://x"]), venta: unos(["", "Mentoría · US$ 2.400", "Downsell · US$ 500", "Mentoría · US$ 10.000"]),
    cobros: unos(COBROS), email: unos(["", "a@x.com", "B@x.com"]), telefono: unos(["", "+54 9 11", "+1 809"]), notas: unos(["", "algo", "Algo más"]),
  };
}

function sinteticas(r: Azar, n: number): FilaTabla[] {
  const { filas } = filasDeMundo(new Azar(1), { sesiones: 5 });
  const base = filas[0];
  return Array.from({ length: n }, (_, i) => filaSintetica(r, base, i));
}

function ordenAzar(r: Azar, max = 3): OrdenColumna[] {
  return r.algunos(CLAVES, 1, max).map((clave) => ({ clave, desc: r.bool() }));
}

/* ---------- Propiedades ---------- */

test("es una permutación de la entrada, no la modifica, y es determinista e idempotente", () => {
  const { mundo } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const lv = listas(mundo);
  for (let semilla = 1; semilla <= 150; semilla++) {
    const r = new Azar(semilla);
    const filas = sinteticas(r, r.entre(0, 40));
    const copia = [...filas];
    const os = ordenAzar(r, 4);
    const usarLista = r.bool();
    const res = ordenarFilas(filas, os, usarLista ? lv : {});
    assert.deepEqual(filas, copia, conSemilla(semilla, "modificó la entrada"));
    assert.equal(res.length, filas.length, conSemilla(semilla, "cambió la cantidad"));
    assert.deepEqual([...res].sort((a, b) => a.id.localeCompare(b.id)), [...filas].sort((a, b) => a.id.localeCompare(b.id)), conSemilla(semilla, "no es una permutación"));
    const otra = ordenarFilas(filas, os, usarLista ? lv : {});
    assert.deepEqual(otra.map((f) => f.id), res.map((f) => f.id), conSemilla(semilla, "no es determinista"));
    assert.deepEqual(ordenarFilas(res, os, usarLista ? lv : {}).map((f) => f.id), res.map((f) => f.id), conSemilla(semilla, "no es idempotente"));
  }
});

test("la salida respeta la relación «va antes» en todos sus pares y los empates quedan en el orden de entrada (estable)", () => {
  const { mundo } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const lv = listas(mundo);
  for (let semilla = 1; semilla <= 120; semilla++) {
    const r = new Azar(semilla + 1000);
    const filas = sinteticas(r, 22);
    const os = ordenAzar(r, 4);
    const lista = r.bool() ? lv : {};
    const res = ordenarFilas(filas, os, lista);
    const entrada = new Map(filas.map((f, i) => [f, i]));
    for (let i = 0; i < res.length; i++) {
      for (let j = i + 1; j < res.length; j++) {
        const a = res[i], b = res[j];
        const ab = antes(a, b, os, lista), ba = antes(b, a, os, lista);
        const ctx = conSemilla(semilla, `orden ${JSON.stringify(os)} filas ${a.id} y ${b.id}`);
        assert.ok(!ba, `${ctx}: ${b.id} va estrictamente antes que ${a.id} pero salió después`);
        assert.ok(!(ab && ba), ctx);
        if (!ab) assert.ok(entrada.get(a)! < entrada.get(b)!, `${ctx}: empate fuera del orden de entrada`);
      }
    }
  }
});

test("el resultado no depende del orden de entrada: ordenar una copia mezclada da las mismas clases de empate en las mismas posiciones", () => {
  const { mundo } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const lv = listas(mundo);
  for (let semilla = 1; semilla <= 120; semilla++) {
    const r = new Azar(semilla + 2000);
    const filas = sinteticas(r, 25);
    const os = ordenAzar(r, 4);
    const lista = r.bool() ? lv : {};
    const a = ordenarFilas(filas, os, lista);
    const b = ordenarFilas(r.shuffle(filas), os, lista);
    for (let k = 0; k < a.length; k++) {
      assert.ok(a[k] === b[k] || (!antes(a[k], b[k], os, lista) && !antes(b[k], a[k], os, lista)),
        conSemilla(semilla, `posición ${k}: ${a[k].id} vs ${b[k].id} no empatan (orden ${JSON.stringify(os)})`));
    }
  }
});

/* Qué es «vacío» en cada columna, según lo que dice la propia tabla (VACIAS en el filtro, o sin texto). */
const vacio = (f: FilaTabla, c: ClaveColumna): boolean => {
  switch (c) {
    case "venta": return f.venta === "";
    case "tecnologias": return f.tecnologias.length === 0;
    case "formacion": return f.formacion.length === 0;
    case "comprobante": case "conciliado": case "llamada": case "agendo": case "calificada": case "grabacion": case "notas": return false;
    default: return COLUMNA[c].valores(f)[0] === VACIAS;
  }
};

test("lo vacío va siempre al final, se ordene para donde se ordene (con o sin la lista de opciones)", () => {
  const { mundo } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const lv = listas(mundo);
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = new Azar(semilla + 3000);
    const filas = sinteticas(r, 40);
    for (const c of CLAVES) for (const desc of [false, true]) for (const lista of [{}, lv]) {
      const res = ordenarFilas(filas, [{ clave: c, desc }], lista);
      const flags = res.map((f) => vacio(f, c));
      const primerVacio = flags.indexOf(true);
      if (primerVacio >= 0) assert.ok(flags.slice(primerVacio).every(Boolean), conSemilla(semilla, `${c} ${desc ? "desc" : "asc"}: hay un valor después de un vacío`));
    }
  }
});

test("al revés es al revés: el sentido «desc» no deja ningún par no vacío en el orden de «asc»", () => {
  const { mundo } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const lv = listas(mundo);
  for (let semilla = 1; semilla <= 40; semilla++) {
    const r = new Azar(semilla + 4000);
    const filas = sinteticas(r, 18);
    for (const c of CLAVES) for (const lista of [{}, lv]) {
      const asc: OrdenColumna[] = [{ clave: c, desc: false }];
      const desc = ordenarFilas(filas, [{ clave: c, desc: true }], lista).filter((f) => !vacio(f, c));
      for (let i = 0; i < desc.length; i++) for (let j = i + 1; j < desc.length; j++) {
        assert.ok(!antes(desc[i], desc[j], asc, lista), conSemilla(semilla, `${c}: en desc, ${desc[i].id} va antes que ${desc[j].id} pero en asc también`));
      }
    }
  }
});

test("contra oráculos independientes: fecha de llamada, fecha de agendado, texto (collator es), opciones y cobros", () => {
  const { mundo } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const lv = listas(mundo);
  const collator = new Intl.Collator("es", { numeric: true });
  const RANGO: Record<string, number> = {
    [COMPROBANTE_FALTA]: 0, [CONCILIADO_NO]: 0, [COMPROBANTE_SI]: 1, [CONCILIADO_SI]: 1, [CONCILIADO_A_MANO]: 2, [SIN_COBROS]: 3, [SIN_VENTA]: 4,
  };
  for (let semilla = 1; semilla <= 60; semilla++) {
    const r = new Azar(semilla + 5000);
    const filas = sinteticas(r, 35);
    for (const desc of [false, true]) {
      const signo = desc ? -1 : 1;
      const monotono = (res: FilaTabla[], clave: (f: FilaTabla) => number | string | null, cmp: (a: number | string, b: number | string) => number, que: string) => {
        const ks = res.map(clave).filter((x): x is number | string => x !== null);
        for (let i = 1; i < ks.length; i++) assert.ok(cmp(ks[i - 1], ks[i]) * signo <= 0, conSemilla(semilla, `${que} ${desc ? "desc" : "asc"}: ${ks[i - 1]} / ${ks[i]}`));
      };
      const num = (a: number | string, b: number | string) => Number(a) - Number(b);
      monotono(ordenarFilas(filas, [{ clave: "llamada", desc }], {}), (f) => Date.parse(f.llamada), num, "llamada");
      monotono(ordenarFilas(filas, [{ clave: "agendo", desc }], {}), (f) => Date.parse(f.agendo), num, "agendo");
      for (const c of ["nombre", "closer", "pais", "ad", "campania", "email", "telefono", "edad", "experiencia", "ingreso", "objecion"] as const) {
        monotono(ordenarFilas(filas, [{ clave: c, desc }], {}), (f) => { const v = COLUMNA[c].valores(f)[0]; return v === VACIAS ? null : v; },
          (a, b) => collator.compare(String(a), String(b)), c);
      }
      for (const [c, valores] of [["comprobante", valoresComprobante], ["conciliado", valoresConciliado]] as const) {
        for (const lista of [{}, lv]) {
          monotono(ordenarFilas(filas, [{ clave: c, desc }], lista), (f) => RANGO[valores(f.cobros)[0]], num, c);
        }
      }
      for (const c of ["estadoLlamada", "estadoPreCall", "preCall"] as const) {
        const orden = lv[c]!;
        monotono(ordenarFilas(filas, [{ clave: c, desc }], lv), (f) => {
          const v = COLUMNA[c].valores(f)[0];
          return v === VACIAS ? null : orden.indexOf(v) >= 0 ? orden.indexOf(v) : orden.length + (v === SIN_CARGAR ? 0 : 1);
        }, num, c);
      }
    }
  }
});

test("no explota con valores vacíos ni con filas que no traen nada (cobros null, listas vacías, textos vacíos) en ninguna columna", () => {
  const { mundo, filas } = filasDeMundo(new Azar(1), { sesiones: 5 });
  const lv = listas(mundo);
  const base = filas[0];
  const vacia = (i: number): FilaTabla => ({
    ...base, id: `v${i}`, nombre: "", closer: "", estadoPreCall: "", estadoLlamada: "", aviso: "", preCall: "", objecion: "", oferta: "", cierre: "", via: "", ad: "", angulo: "",
    campania: "", pais: "", edad: "", tecnologias: [], ingles: "", experiencia: "", formacion: [], ingreso: "", inversion: "", grabacion: "", venta: "", cobros: null,
    email: "", telefono: "", notas: "",
  });
  const todas = [vacia(1), base, vacia(2), { ...base, id: "x", nombre: "Ana", cobros: COBROS[2] }, vacia(3)];
  for (const c of CLAVES) for (const desc of [false, true]) for (const lista of [{}, lv]) {
    const res = ordenarFilas(todas, [{ clave: c, desc }], lista);
    assert.equal(res.length, todas.length, `${c}`);
  }
  /* Entradas degeneradas: sin filas, una sola fila, sin criterios. */
  assert.deepEqual(ordenarFilas([], [{ clave: "nombre", desc: false }]), []);
  assert.deepEqual(ordenarFilas([base], [{ clave: "nombre", desc: true }]), [base]);
  assert.deepEqual(ordenarFilas(todas, []).map((f) => f.id), todas.map((f) => f.id));
});

test("con las filas reales de un mundo con datos raros (null, fechas inválidas, ids repetidos), ninguna columna en ningún sentido explota ni pierde filas", () => {
  for (let semilla = 1; semilla <= 12; semilla++) {
    const r = new Azar(semilla + 6000);
    const { mundo, filas } = filasDeMundo(r, { sesiones: 70, raro: true });
    const lv = listas(mundo);
    for (const c of CLAVES) for (const desc of [false, true]) {
      const res = ordenarFilas(filas, [{ clave: c, desc }], lv);
      assert.equal(res.length, filas.length, conSemilla(semilla, c));
    }
    /* Lo que arma la pantalla: los criterios de la URL y, al final, el de siempre. */
    const os = ordenAzar(r, 3);
    const completos = os.some((o) => o.clave === "llamada") ? os : [...os, ...ORDEN_POR_DEFECTO];
    assert.equal(ordenarFilas(filas, completos, lv).length, filas.length, conSemilla(semilla, "criterios completos"));
  }
});

test("a igual valor, la llamada más nueva primero: el desempate de siempre que agrega la pantalla", () => {
  const r = new Azar(11);
  const filas = sinteticas(r, 50);
  const res = ordenarFilas(filas, [{ clave: "closer", desc: false }, ...ORDEN_POR_DEFECTO], {});
  for (let i = 1; i < res.length; i++) {
    const a = res[i - 1], b = res[i];
    const ca = COLUMNA.closer.valores(a)[0], cb = COLUMNA.closer.valores(b)[0];
    if (ca === cb) assert.ok(Date.parse(a.llamada) >= Date.parse(b.llamada), `${a.id} / ${b.id}`);
  }
});

test("el collator es: las tildes no desordenan, la ñ va entre la n y la o, y los números ordenan como números", () => {
  const { filas } = filasDeMundo(new Azar(1), { sesiones: 3 });
  const base = filas[0];
  const con = (nombres: string[]) => nombres.map((nombre, i) => ({ ...base, id: `n${i}`, nombre }));
  const res = ordenarFilas(con(["Zeta", "Álvaro", "Ñandú", "Oscar", "alma", "Beto", "Nora"]), [{ clave: "nombre", desc: false }], {}).map((f) => f.nombre);
  assert.deepEqual(res, ["alma", "Álvaro", "Beto", "Nora", "Ñandú", "Oscar", "Zeta"]);
  const nums = ordenarFilas(con(["Cuota 10", "Cuota 2", "Cuota 1", "", "Cuota 9"]), [{ clave: "nombre", desc: false }], {}).map((f) => f.nombre);
  assert.deepEqual(nums, ["Cuota 1", "Cuota 2", "Cuota 9", "Cuota 10", ""]);
  const numsDesc = ordenarFilas(con(["Cuota 10", "Cuota 2", "", "Cuota 1"]), [{ clave: "nombre", desc: true }], {}).map((f) => f.nombre);
  assert.deepEqual(numsDesc, ["Cuota 10", "Cuota 2", "Cuota 1", ""]);
});

test("BUG: ordenar por «Venta» no ordena por monto: «US$ 690» queda después de «US$ 1.200» y «US$ 2.400» (el collator numérico lee «1.200» como 1 y 200)", { todo: true }, () => {
  /* La columna ordena por el texto de la venta («Mentoría · US$ 1.200»). Con el punto de los miles, `numeric: true` compara 1 contra 690. */
  const semilla = construirSemilla();
  const montos = [690, 1200, 2400, 12000, 999, 1000];
  const sesiones = montos.map((_, i) => ({
    id: `s${i}`, titulo: "Asesoramiento", invitado: `P${i}`, inicia: "2026-10-01T15:00:00.000Z", duracionMin: 45, estado: "agendada", tipo: "Asesoramiento Hackear IT",
    origen: "calendly", creadoEn: "2026-09-25T12:00:00.000Z", extra: {}, contactoId: `c${i}`,
  })) as unknown as Sesion[];
  const ventas = montos.map((m, i) => ({
    id: `v${i}`, contactoId: `c${i}`, contactoNombre: "x", productoId: "prod", precioAcordado: m, moneda: "USD", excluidoMarketing: false, estado: "activa",
    fecha: "2026-10-02T15:00:00.000Z", creadoEn: "2026-10-02T15:00:00.000Z", extra: {}, sesionId: `s${i}`,
  })) as unknown as Venta[];
  const filas = filasTabla({ sesiones, contactos: [], leads: [], ajustes: semilla.ajustes, webinars: [], ventas, productos: [{ id: "prod", nombre: "Mentoría" }] as never }, Date.parse("2026-10-07T15:00:00Z"));
  const res = ordenarFilas(filas, [{ clave: "venta", desc: false }], {}).map((f) => f.venta);
  assert.deepEqual(res.map((t) => Number(t.replace(/\D/g, ""))), [...montos].sort((a, b) => a - b), `salió: ${res.join(" | ")}`);
});
