import test from "node:test";
import assert from "node:assert/strict";
import {
  CANCELADA, CON_CIERRE, NO_SE_PRESENTO, POR_VENIR, REPROGRAMO, SIN_CARGAR, SIN_CIERRE, desenlaceDe, esReagendar, estadoDe, estadoDeAgenda,
  estadoVisible, ofrecidas, opcionDeCompraPara, preguntaDe, queMueve, revisarOcultar,
} from "@/lib/estados";
import { esCompra, OPCIONES_POR_DEFECTO, opcionesDe } from "@/lib/crm";
import { filasTabla, resumenDe } from "@/lib/crm-tabla";
import { cambiosDelEod, faltaEnRespuesta, respuestaDe } from "@/lib/eod";
import { eventosDeLlamada, etapaTrasEventos } from "@/lib/etapas-auto";
import type { Ajustes, EstadoApp, OpcionCrm, Sesion, Venta } from "@/lib/types";
import { TIPO_VENTA, clonar, enAR, llamada, porSemillas, sumarDias, type Azar } from "./azar";

/* ==================================================================
   Propiedad 5: ocultar estados de llamada nunca cambia el resultado
   (desenlace) de una llamada que ya lo tiene (lib/estados.ts).

   «Oculto» sólo quita el estado de la lista que se ofrece al cargar: no se
   borra, y la llamada que ya lo tiene lo sigue mostrando, con el mismo
   color, el mismo desenlace y lo mismo que mueve en la Agenda y el lead.
   También se prueba que revisarOcultar frena lo que rompería el cierre del
   día, aun ocultando uno tras otro.
   ================================================================== */

const POR_DEFECTO = OPCIONES_POR_DEFECTO.estadoLlamada;
const PRE_CALL = OPCIONES_POR_DEFECTO.estadoPreCall;

/* Una lista de opciones con algunas ocultas (y a veces con opciones propias). */
function opcionesAlAzar(r: Azar, densidad: number): OpcionCrm[] {
  const lista: OpcionCrm[] = clonar(POR_DEFECTO);
  if (r.si(0.3)) lista.push({ nombre: "Compra Propia", color: "verde3", llamada: "hecha", oportunidad: r.elige(["compra-full", "compra-cuotas", "reserva", "downsell"] as const) });
  if (r.si(0.2)) lista.push({ nombre: "Se perdió", color: "rojo3", oportunidad: "perdida" });
  return r.mezclar(lista).map((o) => (r.si(densidad) ? { ...o, oculta: true } : o));
}

const sinOcultas = (ops: OpcionCrm[]): OpcionCrm[] => ops.map(({ oculta: _o, ...o }) => o);

const ESTADOS_AGENDA = ["agendada", "hecha", "no-show", "cancelada"] as const;

function sesionAlAzar(r: Azar, id: string, ops: OpcionCrm[]): Sesion {
  const dia = sumarDias("2026-09-01", r.entre(0, 40));
  const extra: Partial<Sesion> = { estado: r.elige(ESTADOS_AGENDA), tipo: TIPO_VENTA };
  if (r.si(0.65)) extra.estadoLlamada = r.elige(ops).nombre;
  if (r.si(0.15)) extra.estadoPreCall = r.elige(["Reagendar", "Confirmado", "Sin Respuesta", "reprogramar"]);
  if (r.si(0.1)) extra.resultado = r.elige(["compro", "no-compro", "no-vino", "reprogramo"] as const);
  if (extra.estado === "cancelada" && r.si(0.5)) extra.canceladaEn = enAR(dia, 8);
  return llamada(id, r.elige(["Mariano Arias", "Dante Barbieri"]), enAR(dia, r.elige([10, 16])), extra);
}

function estadoCompleto(r: Azar, ops: OpcionCrm[], n: number): EstadoApp {
  const sesiones = Array.from({ length: n }, (_, i) => sesionAlAzar(r, `s${i}`, ops));
  const ventas: Venta[] = [];
  for (const s of sesiones) {
    if (r.si(0.2)) ventas.push({ id: `v_${s.id}`, sesionId: s.id, contactoNombre: s.invitado, precioAcordado: 100, moneda: "USD", fecha: s.inicia, excluidoMarketing: false, estado: r.elige(["activa", "cancelada", "reembolsada"] as const), creadoEn: s.inicia, extra: {} } as Venta);
  }
  return {
    sesiones, ventas, contactos: [], leads: [], webinars: [], productos: [],
    ajustes: { monedaBase: "USD", tipoCambio: 1, crm: { opciones: { estadoLlamada: ops } } } as Ajustes,
  } as unknown as EstadoApp;
}

const AHORA = Date.parse("2026-10-07T15:00:00Z");

test("200 semillas × varias listas: ocultar estados no cambia ni el desenlace ni nada de lo que muestra cada llamada (filas del CRM, Informe, estado visible)", () => {
  let filasVistas = 0, conOcultas = 0;
  porSemillas(200, 1, (r) => {
    const ops = opcionesAlAzar(r, 0);
    const e = estadoCompleto(r, ops, r.entre(5, 40));
    const base = filasTabla(e, AHORA);
    const baseResumen = resumenDe(base);
    const baseVisible = e.sesiones.map((s) => estadoVisible(e, s, AHORA));
    for (const densidad of [0.2, 0.5, 0.9, 1]) {
      const ocultas = opcionesAlAzar(r, densidad).map((o) => o);
      /* Mismas opciones que `ops`, con otro conjunto oculto. */
      const conLasMismas = ops.map((o) => (r.si(densidad) ? { ...o, oculta: true } : o));
      const e2 = { ...e, ajustes: { ...e.ajustes, crm: { opciones: { estadoLlamada: conLasMismas } } } } as EstadoApp;
      if (conLasMismas.some((o) => o.oculta)) conOcultas++;
      const filas = filasTabla(e2, AHORA);
      assert.equal(filas.length, base.length);
      filas.forEach((f, i) => {
        filasVistas++;
        assert.equal(f.resultado, base[i].resultado, `desenlace de ${f.id}`);
        assert.equal(f.estadoLlamada, base[i].estadoLlamada);
        assert.equal(f.estadoAuto, base[i].estadoAuto);
        assert.equal(f.aviso, base[i].aviso);
      });
      assert.deepEqual(resumenDe(filas), baseResumen);
      /* La opción que trae el estado visible es la misma, con su marca de oculta si la tiene: lo demás no cambia. */
      const sinMarca = (v: ReturnType<typeof estadoVisible>) => ({ ...v, opcion: v.opcion ? (({ oculta: _o, ...o }) => o)(v.opcion) : undefined });
      e2.sesiones.forEach((s, i) => assert.deepEqual(sinMarca(estadoVisible(e2, s, AHORA)), sinMarca(baseVisible[i]), `estadoVisible de ${s.id}`));
      void ocultas;
    }
  });
  assert.ok(filasVistas > 10_000 && conOcultas > 500, `filas ${filasVistas}, con ocultas ${conOcultas}`);
});

test("200 semillas: lo que mueve el estado en la Agenda y en la etapa del lead, y lo que pregunta el cierre del día, son los mismos con o sin ocultar", () => {
  porSemillas(200, 1000, (r) => {
    const ops = opcionesAlAzar(r, 0);
    const ocultos = ops.map((o) => (r.si(0.5) ? { ...o, oculta: true } : o));
    const etapas = [
      { id: "et_sesion", nombre: "Sesión agendada", orden: 2 }, { id: "et_propuesta", nombre: "Propuesta", orden: 3 },
      { id: "et_ganada", nombre: "Inscripto", orden: 4, esGanada: true }, { id: "et_perdida", nombre: "Perdido", orden: 5, esPerdida: true },
    ] as Parameters<typeof etapaTrasEventos>[2];
    for (let k = 0; k < 20; k++) {
      const s = sesionAlAzar(r, "x", ops);
      const nuevo = r.elige([...ops.map((o) => o.nombre), "", undefined]);
      assert.equal(estadoDeAgenda(s, nuevo, ocultos), estadoDeAgenda(s, nuevo, ops));
      const despues = { estado: s.estado, estadoLlamada: nuevo || undefined };
      assert.deepEqual(eventosDeLlamada(s, despues, ocultos), eventosDeLlamada(s, despues, ops));
      const ev = eventosDeLlamada(s, despues, ocultos);
      const desde = r.elige(etapas).id;
      assert.equal(etapaTrasEventos(desde, eventosDeLlamada(s, despues, ops), etapas), etapaTrasEventos(desde, ev, etapas));
      const respuesta = { estadoLlamada: nuevo, objecion: "Plata", hizoOferta: true, cierreEstimado: "2026-10-30" };
      for (const puerta of [undefined, { tieneVenta: false }, { tieneVenta: true }]) {
        assert.equal(faltaEnRespuesta(respuesta, ocultos, puerta), faltaEnRespuesta(respuesta, ops, puerta));
      }
      assert.deepEqual(
        cambiosDelEod(respuesta, s, { monedaBase: "USD", tipoCambio: 1, crm: { opciones: { estadoLlamada: ocultos } } } as Ajustes, "q", "2026-10-07T12:00:00Z"),
        cambiosDelEod(respuesta, s, { monedaBase: "USD", tipoCambio: 1, crm: { opciones: { estadoLlamada: ops } } } as Ajustes, "q", "2026-10-07T12:00:00Z"),
      );
      for (const o of ops) assert.equal(preguntaDe(ocultos.find((x) => x.nombre === o.nombre)), preguntaDe(o));
      for (const o of ops) assert.deepEqual(queMueve(ocultos.find((x) => x.nombre === o.nombre)!, "estadoLlamada"), queMueve(o, "estadoLlamada"));
    }
  });
});

/* El desenlace, según lo que dice el comentario de lib/estados.ts, escrito aparte. */
function desenlaceEsperado(s: Pick<Sesion, "estado" | "estadoPreCall" | "resultado">, cargada: OpcionCrm | undefined, venta: boolean, paso: boolean): string {
  const compra = (o?: OpcionCrm) => o?.oportunidad === "compra-full" || o?.oportunidad === "compra-cuotas" || o?.oportunidad === "reserva" || o?.oportunidad === "downsell";
  if (venta || compra(cargada)) return CON_CIERRE;
  if (s.estado === "cancelada") return CANCELADA;
  if (s.estado === "no-show" || cargada?.llamada === "no-show") return NO_SE_PRESENTO;
  if (cargada && (cargada.llamada === "hecha" || cargada.oportunidad === "perdida" || cargada.oportunidad === "devolucion")) return SIN_CIERRE;
  if (s.resultado) return ({ compro: CON_CIERRE, "no-compro": SIN_CIERRE, "no-vino": NO_SE_PRESENTO, reprogramo: REPROGRAMO })[s.resultado];
  if (/reagend|reprogram/.test((s.estadoPreCall ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase())) return REPROGRAMO;
  return paso ? SIN_CARGAR : POR_VENIR;
}

test("el desenlace de una llamada sale del orden de siempre (venta, cancelada, no vino, hecha/perdida, resultado viejo, reagendar, sin cargar) con cualquier conjunto de estados ocultos (500 semillas)", () => {
  porSemillas(500, 2000, (r) => {
    const ops = opcionesAlAzar(r, r.elige([0, 0.3, 0.7, 1]));
    for (let k = 0; k < 20; k++) {
      const s = sesionAlAzar(r, "x", ops);
      const venta = r.si(0.2), paso = r.si(0.7);
      const cargada = s.estadoLlamada ? ops.find((o) => o.nombre === s.estadoLlamada) : undefined;
      assert.equal(desenlaceDe(s, cargada, { venta, paso }), desenlaceEsperado(s, cargada, venta, paso));
      /* Y el estado visible dice lo mismo que el desenlace. */
      const v = estadoDe(s, { opciones: ops, venta, ahora: paso ? Date.parse(s.inicia) + 1 : Date.parse(s.inicia) - 1 });
      assert.equal(v.desenlace, desenlaceEsperado(s, cargada, venta, paso));
      assert.equal(v.sinCargar, v.desenlace === SIN_CARGAR);
      /* Con estado cargado se lee el estado, con su color; sin él, el aviso o nada. */
      if (s.estadoLlamada) { assert.equal(v.texto, s.estadoLlamada); assert.equal(v.vacio, false); assert.equal(v.color, cargada?.color ?? "gris1"); }
      else if (!v.vacio) assert.ok(v.auto);
    }
  });
});

test("ofrecidas: lo oculto se saca, salvo la opción que la llamada ya tiene; nunca se agrega nada ni se cambia el orden (400 semillas)", () => {
  porSemillas(400, 3000, (r) => {
    const ops = opcionesAlAzar(r, r.elige([0, 0.2, 0.6, 1]));
    const actual = r.elige([undefined, "", "Nombre inexistente", ...ops.map((o) => o.nombre)]);
    const of = ofrecidas(ops, actual);
    assert.deepEqual(of, ops.filter((o) => !o.oculta || o.nombre === actual));
    const nombres = ops.map((o) => o.nombre);
    assert.deepEqual(of.map((o) => o.nombre), nombres.filter((n) => of.some((x) => x.nombre === n)), "mismo orden");
    if (actual && nombres.includes(actual)) assert.ok(of.some((o) => o.nombre === actual), "la que ya tiene se sigue viendo");
    assert.equal(ofrecidas(sinOcultas(ops)).length, ops.length);
  });
});

test("el estado de compra de una venta: siempre uno de compra si hay alguno, a la vista si hay alguno a la vista, y el de su tipo si ese está a la vista (500 semillas)", () => {
  const TIPOS = ["compra-full", "compra-cuotas", "reserva", "downsell"] as const;
  porSemillas(500, 4000, (r) => {
    const ops = opcionesAlAzar(r, r.elige([0, 0.3, 0.6, 0.9, 1]));
    for (const tipo of TIPOS) {
      const o = opcionDeCompraPara(ops, tipo);
      const compras = ops.filter((x) => esCompra(x));
      assert.equal(o !== undefined, compras.length > 0, "hay estado de compra si y sólo si hay alguno");
      if (!o) continue;
      assert.ok(esCompra(o) && ops.some((x) => x.nombre === o.nombre));
      const visibles = compras.filter((x) => !x.oculta);
      if (visibles.length) {
        assert.ok(!o.oculta, "prefiere los que están a la vista");
        const propio = visibles.find((x) => x.oportunidad === tipo);
        if (propio) assert.equal(o.nombre, propio.nombre, "el de su tipo");
      } else assert.equal(o.oculta, true);
    }
  });
});

/* Ocultar de a uno, sólo lo que revisarOcultar deja: el cierre del día no se puede quedar sin lo que necesita. */
test("ocultar uno tras otro lo que revisarOcultar permite nunca deja al cierre del día sin un estado de compra, uno de seguimiento ni «Reagendar» a la vista (300 semillas)", () => {
  let bloqueos = 0, ocultados = 0;
  porSemillas(300, 5000, (r) => {
    let ajustes = { crm: { opciones: { estadoLlamada: clonar(POR_DEFECTO), estadoPreCall: clonar(PRE_CALL) } } } as Pick<Ajustes, "crm">;
    for (let paso = 0; paso < 60; paso++) {
      const campo = r.elige(["estadoLlamada", "estadoLlamada", "estadoPreCall"] as const);
      const lista = opcionesDe(ajustes, campo);
      const o = r.elige(lista);
      const rev = revisarOcultar(ajustes, campo, o.nombre, r.entre(0, 5));
      assert.ok(Array.isArray(rev.mueve) && Array.isArray(rev.avisos));
      if (rev.bloquea) { bloqueos++; assert.ok(rev.bloquea.length > 10); continue; }
      ocultados++;
      ajustes = { crm: { opciones: { ...ajustes.crm!.opciones, [campo]: lista.map((x) => (x.nombre === o.nombre ? { ...x, oculta: true } : x)) } } } as Pick<Ajustes, "crm">;
      const ll = opcionesDe(ajustes, "estadoLlamada"), pre = opcionesDe(ajustes, "estadoPreCall");
      assert.ok(ll.some((x) => !x.oculta && esCompra(x)), "sin estado de compra a la vista no se puede cargar la venta");
      assert.ok(ll.some((x) => !x.oculta && preguntaDe(x) === "seguimiento"), "sin estado de seguimiento a la vista no se puede dejar una llamada en seguimiento");
      assert.ok(pre.some((x) => !x.oculta && esReagendar(x.nombre)), "sin «Reagendar» a la vista no se puede dejar que pidió otra fecha");
    }
  });
  assert.ok(bloqueos > 100 && ocultados > 1000, `bloqueos ${bloqueos}, ocultados ${ocultados}`);
});

test("revisarOcultar de un estado que no existe no bloquea ni avisa; lo que bloquea nunca depende de cuántas llamadas lo tienen", () => {
  const a = { crm: undefined } as Pick<Ajustes, "crm">;
  assert.deepEqual(revisarOcultar(a, "estadoLlamada", "No existe", 3), { mueve: [], bloquea: null, avisos: [], usos: 3 });
  porSemillas(100, 6000, (r) => {
    const ops = opcionesAlAzar(r, 0.5);
    const aj = { crm: { opciones: { estadoLlamada: ops } } } as Pick<Ajustes, "crm">;
    const o = r.elige(ops);
    const x = revisarOcultar(aj, "estadoLlamada", o.nombre, 0), y = revisarOcultar(aj, "estadoLlamada", o.nombre, 50);
    assert.equal(x.bloquea, y.bloquea);
    assert.equal(y.usos, 50);
    assert.equal(y.avisos.length, x.avisos.length + 1);
  });
});

test("el estado de una llamada cargado en la ficha se ve igual en todos lados: estadoVisible de una llamada sin fila (no es de venta) sólo dice si se hizo", () => {
  const e = { sesiones: [], contactos: [], leads: [], webinars: [], productos: [], ventas: [], ajustes: { monedaBase: "USD", tipoCambio: 1 } as Ajustes } as unknown as EstadoApp;
  const s = llamada("t1", "Mariano Arias", enAR("2026-09-10", 12), { tipo: "Sesión 1 a 1 - Testimonio", estado: "hecha" });
  const v = estadoVisible({ ...e, sesiones: [s] } as EstadoApp, s, AHORA);
  assert.equal(v.deVenta, false);
  assert.equal(v.texto, "Hecha");
  assert.equal(respuestaDe(s), undefined);
});
