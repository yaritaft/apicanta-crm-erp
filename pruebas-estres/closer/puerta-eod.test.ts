import test from "node:test";
import assert from "node:assert/strict";
import { OPCIONES_POR_DEFECTO, esCompra, opcionesDe } from "@/lib/crm";
import { preguntaDe } from "@/lib/estados";
import {
  atajosDeCierre, cambiosDelEod, closersConLlamadas, faltaEnRespuesta, llamadasDelDia, objecionSugerida, objecionesDe, respuestaDe,
  type RespuestaEod,
} from "@/lib/eod";
import type { Ajustes, OpcionCrm, Sesion } from "@/lib/types";
import { clonar, enAR, llamada, porSemillas, sumarDias, type Azar } from "./azar";

/* ==================================================================
   Propiedad 6: la puerta del cierre del día (lib/eod.ts) no deja pasar una
   compra sin venta ni salida, ni al revés (no frena lo que no es una compra,
   ni una compra que ya tiene su venta o su aviso «la carga otra persona»).

   Con listas de estados armadas al azar (con y sin ocultos, con compras
   propias) y respuestas al azar, y con una simulación del cierre de un día
   (elegir, avisar, cambiar de idea, guardar de nuevo) contra la llamada.
   ================================================================== */

const POR_DEFECTO = OPCIONES_POR_DEFECTO.estadoLlamada;
const aj = (ops: OpcionCrm[]) => ({ monedaBase: "USD", tipoCambio: 1, crm: { opciones: { estadoLlamada: ops } } }) as Ajustes;

function listaAlAzar(r: Azar): OpcionCrm[] {
  const lista: OpcionCrm[] = clonar(POR_DEFECTO);
  if (r.si(0.4)) lista.push({ nombre: "Compra VIP", color: "verde3", llamada: "hecha", oportunidad: r.elige(["compra-full", "compra-cuotas", "reserva", "downsell"] as const) });
  if (r.si(0.3)) lista.push({ nombre: "Seguimiento VIP", color: "amarillo2", llamada: "hecha" });
  if (r.si(0.2)) lista.push({ nombre: "Perdida VIP", color: "rojo2", oportunidad: "perdida" });
  return r.mezclar(lista).map((o) => (r.si(0.3) ? { ...o, oculta: true } : o));
}

function respuestaAlAzar(r: Azar, ops: OpcionCrm[]): RespuestaEod {
  const x: RespuestaEod = {};
  if (r.si(0.9)) x.estadoLlamada = r.elige([...ops.map((o) => o.nombre), "Estado que no existe"]);
  if (r.si(0.3)) x.estadoPreCall = r.elige(["Reagendar", "Confirmado", "Sin Respuesta", "reprogramar", "reagendada"]);
  if (r.si(0.5)) x.objecion = r.elige(["Plata", "Tiempo", "Otro"]);
  if (r.si(0.5)) x.hizoOferta = r.si();
  if (r.si(0.5)) x.cierreEstimado = "2026-10-30";
  if (r.si(0.5)) x.ventaPorOtro = r.si(0.7);
  if (r.si(0.1)) x.nota = r.elige(["Llamó después", "  ", ""]);
  return x;
}

const MSJ_PUERTA = "Cargá la venta o avisá que la carga otra persona";
const PUERTAS = [undefined, { tieneVenta: false }, { tieneVenta: true }] as const;

test("la puerta: una compra sin venta ni aviso no pasa; con la venta o el aviso sí; lo que no es una compra no cambia (600 semillas × 30 respuestas)", () => {
  let bloqueadas = 0, pasanPorVenta = 0, pasanPorAviso = 0, noCompras = 0;
  porSemillas(600, 1, (r) => {
    const ops = listaAlAzar(r);
    for (let k = 0; k < 30; k++) {
      const resp = respuestaAlAzar(r, ops);
      const opcion = ops.find((o) => o.nombre === resp.estadoLlamada);
      const sinPuerta = faltaEnRespuesta(resp, ops);
      for (const puerta of PUERTAS) {
        const falta = faltaEnRespuesta(resp, ops, puerta);
        if (opcion && esCompra(opcion)) {
          assert.equal(preguntaDe(opcion), "venta");
          /* Sin puerta, una compra no pide nada más (como antes). */
          assert.equal(sinPuerta, null);
          if (!puerta) { assert.equal(falta, null); continue; }
          if (!puerta.tieneVenta && !resp.ventaPorOtro) { bloqueadas++; assert.equal(falta, MSJ_PUERTA, "una compra sin venta ni salida no puede pasar"); }
          else {
            assert.equal(falta, null, "con la venta cargada o con el aviso, la puerta no frena");
            if (puerta.tieneVenta) pasanPorVenta++; else pasanPorAviso++;
          }
        } else {
          noCompras++;
          assert.equal(falta, sinPuerta, "la puerta es sólo de las compras");
          assert.notEqual(falta, MSJ_PUERTA);
        }
      }
    }
  });
  assert.ok(bloqueadas > 1500 && pasanPorVenta > 1500 && pasanPorAviso > 500 && noCompras > 10_000, `${bloqueadas} ${pasanPorVenta} ${pasanPorAviso} ${noCompras}`);
});

test("sin estado de llamada: sólo «Reagendar» deja pasar, y una compra no se disfraza con un Pre-Call", () => {
  porSemillas(200, 1000, (r) => {
    const ops = listaAlAzar(r);
    for (const pre of [undefined, "", "Confirmado", "Sin Respuesta", "Reagendar", "reagendar", "REAGENDAR", "Reprogramar", "A reagendar"]) {
      for (const puerta of PUERTAS) {
        const f = faltaEnRespuesta({ estadoPreCall: pre, ventaPorOtro: r.si() }, ops, puerta);
        const reagenda = /reagend|reprogram/.test((pre ?? "").toLowerCase());
        assert.equal(f, reagenda ? null : "Elegí cómo terminó la llamada", `${pre}`);
      }
    }
    /* Una compra con Pre-Call «Reagendar» sigue siendo una compra: pide la venta. */
    const compra = ops.find((o) => esCompra(o))!;
    assert.equal(faltaEnRespuesta({ estadoLlamada: compra.nombre, estadoPreCall: "Reagendar" }, ops, { tieneVenta: false }), MSJ_PUERTA);
    assert.equal(faltaEnRespuesta(undefined, ops, { tieneVenta: true }), "Elegí cómo terminó la llamada");
  });
});

test("la puerta no depende de qué estados están ocultos: una compra oculta que la llamada ya tiene sigue pidiendo su venta (300 semillas)", () => {
  porSemillas(300, 2000, (r) => {
    const ops = listaAlAzar(r);
    const todasOcultas = ops.map((o) => ({ ...o, oculta: true }));
    const todasVisibles = ops.map(({ oculta: _o, ...o }) => o);
    for (const o of ops) {
      const resp = { estadoLlamada: o.nombre, objecion: "Plata", hizoOferta: true, cierreEstimado: "2026-10-30" };
      for (const puerta of PUERTAS) assert.equal(faltaEnRespuesta(resp, todasOcultas, puerta), faltaEnRespuesta(resp, todasVisibles, puerta), o.nombre);
    }
  });
});

/* ---------- Guardar la respuesta en la llamada ---------- */

const CUANDO = "2026-10-07T20:00:00.000Z";
const aplicar = (s: Sesion, c: Partial<Sesion>): Sesion => {
  const out: Record<string, unknown> = { ...s };
  for (const [k, v] of Object.entries(c)) { if (v === undefined) delete out[k]; else out[k] = v; }
  return out as unknown as Sesion;
};

test("guardar una compra con «la carga otra persona» deja anotado quién y cuándo, no se pisa al volver a guardar, y se borra si la llamada deja de ser una compra o el closer se arrepiente (400 semillas)", () => {
  porSemillas(400, 3000, (r) => {
    const ops = listaAlAzar(r);
    const a = aj(ops);
    const compras = ops.filter((o) => esCompra(o)), noCompras = ops.filter((o) => !esCompra(o));
    let s = llamada("x", "Mariano Arias", enAR("2026-10-07", 15));
    /* 1. Elige una compra y avisa. */
    const c1 = r.elige(compras).nombre;
    s = aplicar(s, cambiosDelEod({ estadoLlamada: c1, ventaPorOtro: true }, s, a, "Dante", CUANDO));
    assert.deepEqual(s.ventaPorOtro, { por: "Dante", en: CUANDO });
    assert.equal(s.hizoOferta, true, "una compra es una oferta hecha");
    assert.equal(faltaEnRespuesta(respuestaDe(s), ops, { tieneVenta: false }), null, "lo guardado alcanza para pasar la puerta");
    /* 2. Guarda de nuevo, más tarde y por otro: la salida original queda. */
    const s2 = aplicar(s, cambiosDelEod({ ...respuestaDe(s)!, nota: "ok" }, s, a, "Santi", "2026-10-08T10:00:00.000Z"));
    assert.deepEqual(s2.ventaPorOtro, { por: "Dante", en: CUANDO }, "no se pisa");
    /* 3. Otra compra distinta: sigue anotada. */
    const c3 = r.elige(compras).nombre;
    const s3 = aplicar(s2, cambiosDelEod({ ...respuestaDe(s2)!, estadoLlamada: c3 }, s2, a, "Santi", "2026-10-08T11:00:00.000Z"));
    assert.deepEqual(s3.ventaPorOtro, { por: "Dante", en: CUANDO });
    /* 4a. Se arrepiente: «Mejor la cargo yo». */
    const s4 = aplicar(s3, cambiosDelEod({ ...respuestaDe(s3)!, ventaPorOtro: false }, s3, a, "Dante", "2026-10-08T12:00:00.000Z"));
    assert.equal(s4.ventaPorOtro, undefined);
    assert.equal(faltaEnRespuesta(respuestaDe(s4), ops, { tieneVenta: false }), MSJ_PUERTA, "sin la salida, vuelve a pedir la venta");
    /* 4b. O la llamada deja de ser una compra. */
    const nc = r.elige(noCompras).nombre;
    const s5 = aplicar(s3, cambiosDelEod({ ...respuestaDe(s3)!, estadoLlamada: nc, objecion: "Plata", hizoOferta: false, cierreEstimado: "2026-10-30" }, s3, a, "Dante", "2026-10-08T12:00:00.000Z"));
    assert.equal(s5.ventaPorOtro, undefined, "la salida se borra con la compra");
    assert.equal(s5.estadoLlamada, nc);
    /* 5. Un aviso en una llamada que no es una compra no queda anotado. */
    const s6 = aplicar(llamada("y", "Mariano Arias", enAR("2026-10-07", 15)), cambiosDelEod({ estadoLlamada: nc, ventaPorOtro: true, objecion: "Plata", hizoOferta: true, cierreEstimado: "2026-10-30" }, llamada("y", "Mariano Arias", enAR("2026-10-07", 15)), a, "Dante", CUANDO));
    assert.equal(s6.ventaPorOtro, undefined);
  });
});

test("guardar dos veces lo mismo no cambia nada más que cuándo y quién (400 semillas)", () => {
  porSemillas(400, 4000, (r) => {
    const ops = listaAlAzar(r);
    const a = aj(ops);
    let s = llamada("x", "Mariano Arias", enAR("2026-10-07", 15), r.si(0.3) ? { notas: "Nota previa" } : {});
    const resp = respuestaAlAzar(r, ops);
    s = aplicar(s, cambiosDelEod(resp, s, a, "Dante", CUANDO));
    const otra = aplicar(s, cambiosDelEod(resp, s, a, "Santi", "2026-10-08T00:00:00.000Z"));
    const { eodEn: _e1, eodPor: _p1, ...x } = s; const { eodEn: _e2, eodPor: _p2, ...y } = otra;
    void _e1; void _p1; void _e2; void _p2;
    assert.deepEqual(y, x);
  });
});

/* BUG: cambiosDelEod no agrega la nota del cierre si ya está «incluida» como texto en las notas de la llamada (includes sobre
   todo el texto): una nota corta como «cuotas» o «ok» se pierde en silencio si el texto anterior la contiene dentro de otra
   palabra o frase. Quería evitar duplicar al guardar dos veces, pero compara con includes y no por renglón. */
test("BUG: la nota del cierre del día no se pierde porque otra palabra de las notas anteriores la contiene", () => {
  const a = aj(POR_DEFECTO);
  const s = llamada("x", "Mariano Arias", enAR("2026-10-07", 15), { notas: "Quiere pagar en cuotas de seis meses" });
  const c = cambiosDelEod({ estadoLlamada: "Seguimiento Nutrición", objecion: "Plata", hizoOferta: true, cierreEstimado: "2026-10-30", nota: "cuotas" }, s, a, "Dante", CUANDO);
  assert.ok((c.notas ?? s.notas)!.split("\n").includes("cuotas"), `la nota «cuotas» no quedó guardada: ${JSON.stringify(c.notas)}`);
});

test("la misma nota dos veces seguidas no se duplica (el motivo del includes)", () => {
  const a = aj(POR_DEFECTO);
  let s = llamada("x", "Mariano Arias", enAR("2026-10-07", 15));
  const r: RespuestaEod = { estadoLlamada: "Inasistió", nota: "No contestó el celular" };
  s = aplicar(s, cambiosDelEod(r, s, a, "Dante", CUANDO));
  s = aplicar(s, cambiosDelEod(r, s, a, "Dante", CUANDO));
  assert.equal(s.notas, "No contestó el celular");
  s = aplicar(s, cambiosDelEod({ ...r, nota: "Escribió después" }, s, a, "Dante", CUANDO));
  assert.equal(s.notas, "No contestó el celular\nEscribió después");
});

/* ---------- Lo demás del cierre del día ---------- */

test("atajosDeCierre: el domingo de esta semana, el fin de este mes y 30 días más, para todos los días de dos años", () => {
  for (let i = 0; i < 800; i++) {
    const hoy = sumarDias("2025-12-01", i);
    const [semana, mes, masAdelante] = atajosDeCierre(hoy);
    const dow = new Date(`${hoy}T12:00:00Z`).getUTCDay();
    assert.equal(new Date(`${semana.valor}T12:00:00Z`).getUTCDay(), 0, `${hoy}: el atajo de la semana no es domingo`);
    assert.equal(semana.valor, sumarDias(hoy, (7 - dow) % 7), hoy);
    assert.ok(semana.valor >= hoy && semana.valor <= sumarDias(hoy, 6));
    assert.ok(mes.valor >= hoy && mes.valor.slice(0, 7) === hoy.slice(0, 7), `${hoy}: fin de mes ${mes.valor}`);
    assert.notEqual(sumarDias(mes.valor, 1).slice(0, 7), hoy.slice(0, 7), "es el último día del mes");
    assert.equal(masAdelante.valor, sumarDias(hoy, 30));
    assert.deepEqual([semana.texto, mes.texto, masAdelante.texto], ["Esta semana", "Este mes", "Más adelante"]);
  }
});

test("las llamadas del día de un closer: sin canceladas, del día de Argentina, ordenadas, y cada llamada con anfitrión es de un solo closer de la lista (300 semillas)", () => {
  const equipo = [
    { id: "m", nombre: "Mariano", rol: "closer", comisionRate: 0, activo: true, sinComision: false },
    { id: "d", nombre: "Dante Barbieri", rol: "closer", comisionRate: 0, activo: true, sinComision: false },
  ] as Parameters<typeof llamadasDelDia>[0]["equipo"];
  const HOSTS = ["Mariano Arias", "Mariano", "mariano arias", "Dante Barbieri", "Dante", "Externo Uno", "Otro Externo", undefined, "  "];
  porSemillas(300, 5000, (r) => {
    const sesiones: Sesion[] = Array.from({ length: r.entre(5, 40) }, (_, i) => {
      const dia = sumarDias("2026-10-01", r.entre(0, 6));
      return llamada(`s${i}`, r.elige(HOSTS), enAR(dia, r.elige([0, 9, 15, 23]), r.elige([0, 59])), r.si(0.15) ? { estado: "cancelada" } : {});
    });
    const e = { sesiones, equipo };
    const cierres = closersConLlamadas(e);
    for (let d = 0; d < 7; d++) {
      const dia = sumarDias("2026-10-01", d);
      const vistas = new Map<string, string[]>();
      for (const c of cierres) {
        const ls = llamadasDelDia(e, c, dia);
        assert.deepEqual(ls.map((x) => x.inicia), ls.map((x) => x.inicia).sort(), "ordenadas");
        for (const s of ls) {
          assert.notEqual(s.estado, "cancelada");
          assert.equal(new Date(Date.parse(s.inicia) - 3 * 3600_000).toISOString().slice(0, 10), dia);
          vistas.set(s.id, [...(vistas.get(s.id) ?? []), c]);
        }
      }
      for (const s of sesiones) {
        const esperado = s.estado !== "cancelada" && (s.anfitrion ?? "").trim() !== "" && new Date(Date.parse(s.inicia) - 3 * 3600_000).toISOString().slice(0, 10) === dia;
        assert.equal(vistas.has(s.id), esperado, `${s.id} (${s.anfitrion})`);
        assert.ok((vistas.get(s.id)?.length ?? 0) <= 1, `${s.id} aparece en el día de varios closers: ${vistas.get(s.id)}`);
      }
    }
  });
});

test("objeciones: las del equipo si cargó alguna, sin vacías; y la sugerida por «NO Calificado» es una de la lista", () => {
  assert.deepEqual(objecionesDe({ crm: undefined } as Ajustes), ["Plata", "Tiempo", "Lo tiene que consultar", "No ve el valor", "No califica", "Lo quiere pensar", "Otro"]);
  assert.deepEqual(objecionesDe({ crm: { objeciones: ["  ", ""] } } as Ajustes), objecionesDe({} as Ajustes));
  assert.deepEqual(objecionesDe({ crm: { objeciones: [" Plata ", "", "Tiempo"] } } as Ajustes), ["Plata", "Tiempo"]);
  const lista = objecionesDe({} as Ajustes);
  assert.equal(objecionSugerida(opcionesDe({ crm: undefined } as Ajustes, "estadoLlamada").find((o) => o.nombre === "NO Calificado"), lista), "No califica");
  assert.equal(objecionSugerida(opcionesDe({ crm: undefined } as Ajustes, "estadoLlamada").find((o) => o.nombre === "NO Calificado"), ["Plata"]), undefined);
  assert.equal(objecionSugerida(undefined, lista), undefined);
});
