import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso } from "@/lib/store";
import { OPCIONES_POR_DEFECTO } from "@/lib/crm";
import { estadoDeAgenda } from "@/lib/estados";
import { atrasoDe, pideCierre } from "@/lib/cierre-del-dia";
import { diaDeNegocio } from "@/lib/dia-negocio";
import type { EstadoApp, EstadoSesion, Sesion } from "@/lib/types";

/* Sondeo para refutar el posible bug de «vaciar el Estado de Llamada devuelve la agenda a agendada».
   No toca src/. Imprime lo que pasa; las pruebas sólo afirman lo que el sondeo necesita saber. */

const OPS = OPCIONES_POR_DEFECTO.estadoLlamada;
const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const sesionDe = (id: string) => estado().sesiones.find((s) => s.id === id) as Sesion;
const esDeVenta = (s: Sesion) => /asesoramiento/i.test(s.tipo);

/* Lo que hace la pastilla (components/estados/EstadoLlamada.tsx → useCambiarEstado): sólo manda {estadoLlamada: valor}. */
const cargar = (id: string, valor: string) =>
  acciones.editarLlamadas([{ id, cambios: { estadoLlamada: valor }, detalle: `estadoLlamada → ${valor || "vacío"}` }]);

test("1) mínimo con el store y la semilla: cal_demo_036", () => {
  fijarAcceso(null);
  const s0 = sesionDe("cal_demo_036");
  console.log("cal_demo_036 de la semilla:", JSON.stringify({ estado: s0?.estado, canceladaEn: s0?.canceladaEn, estadoLlamada: s0?.estadoLlamada, tipo: s0?.tipo, inicia: s0?.inicia, anfitrion: s0?.anfitrion }));
  assert.ok(s0, "existe en la semilla");
  cargar(s0.id, "Inasistió");
  const a = sesionDe(s0.id);
  console.log("tras cargar «Inasistió»:", JSON.stringify({ estado: a.estado, canceladaEn: a.canceladaEn, estadoLlamada: a.estadoLlamada, estadoLlamadaEn: a.estadoLlamadaEn }));
  cargar(s0.id, "");
  const b = sesionDe(s0.id);
  console.log("tras vaciar:", JSON.stringify({ estado: b.estado, canceladaEn: b.canceladaEn, estadoLlamada: b.estadoLlamada, estadoLlamadaEn: b.estadoLlamadaEn }));
  const hoy = diaDeNegocio(new Date().toISOString());
  console.log("pideCierre antes/después:", pideCierre(s0, hoy), pideCierre(b, hoy));
  console.log("atrasoDe antes/después:", atrasoDe(s0, diaDeNegocio(s0.inicia), hoy), atrasoDe(b, diaDeNegocio(b.inicia), hoy));
});

test("2) función pura", () => {
  const r = estadoDeAgenda({ estado: "no-show", estadoLlamada: "Inasistió", canceladaEn: undefined }, "", OPS);
  console.log("estadoDeAgenda({no-show, Inasistió}, '') =", r);
  const r2 = estadoDeAgenda({ estado: "no-show", estadoLlamada: "Inasistió", canceladaEn: "2026-10-03T12:00:00.000Z" }, "", OPS);
  console.log("estadoDeAgenda({no-show, Inasistió, canceladaEn}, '') =", r2);
  const r3 = estadoDeAgenda({ estado: "cancelada", estadoLlamada: "Canceló (auto)", canceladaEn: "2026-10-03T12:00:00.000Z" }, "", OPS);
  console.log("estadoDeAgenda({cancelada, Canceló (auto), canceladaEn}, '') =", r3, "(el caso que SÍ cuida)");
});

test("3) matriz: estado de agenda inicial × estado cargado → vaciar (por el store, con una llamada de venta sintética)", () => {
  fijarAcceso(null);
  const base = estado().sesiones.find((s) => esDeVenta(s) && !s.estadoLlamada && s.estado === "agendada")!;
  assert.ok(base);
  const inicial: { nombre: string; estado: EstadoSesion; canceladaEn?: string }[] = [
    { nombre: "agendada", estado: "agendada" },
    { nombre: "hecha (a mano / de antes)", estado: "hecha" },
    { nombre: "no-show (Calendly)", estado: "no-show" },
    { nombre: "cancelada (Calendly, con canceladaEn)", estado: "cancelada", canceladaEn: "2026-10-03T12:00:00.000Z" },
    { nombre: "cancelada (sin canceladaEn)", estado: "cancelada" },
  ];
  let n = 0;
  const filas: string[] = [];
  const perdidas: Record<string, string[]> = {};
  for (const ini of inicial) {
    for (const op of OPS) {
      const id = `sonda_${n++}`;
      acciones.crear<Sesion>("sesiones", {
        ...base, id, estado: ini.estado, canceladaEn: ini.canceladaEn, estadoLlamada: undefined, estadoLlamadaEn: undefined,
        inicia: "2026-10-01T18:00:00.000Z", motivoCancelacion: undefined, resultado: undefined, estadoPreCall: undefined,
      } as Sesion, id);
      cargar(id, op.nombre);
      const cargada = sesionDe(id);
      cargar(id, "");
      const vaciada = sesionDe(id);
      const igual = vaciada.estado === ini.estado;
      if (!igual) (perdidas[ini.nombre] ??= []).push(`${op.nombre}: ${ini.estado} → ${cargada.estado} → ${vaciada.estado}`);
      filas.push(`${ini.nombre.padEnd(40)} ${op.nombre.padEnd(22)} cargada=${cargada.estado.padEnd(9)} vaciada=${vaciada.estado.padEnd(9)} ${igual ? "ok" : "CAMBIÓ"}`);
    }
  }
  console.log(filas.join("\n"));
  for (const [k, v] of Object.entries(perdidas)) console.log(`\n[${k}] ${v.length} combinaciones donde cargar+vaciar no la deja como estaba:\n  ${v.join("\n  ")}`);
  const total = Object.values(perdidas).reduce((x, v) => x + v.length, 0);
  console.log("\nTOTAL que cambian:", total);
});

test("4) la cadena de strikes con el store: antes de tocar, después de cargar «Inasistió», después de vaciar", async () => {
  const { strikesDe, conStrike } = await import("@/lib/cierre-del-dia");
  fijarAcceso(null);
  const hoy = diaDeNegocio(new Date().toISOString());
  const conRegla = (e: EstadoApp): EstadoApp => ({ ...e, ajustes: { ...e.ajustes, crm: { ...(e.ajustes.crm ?? {}), cierreDelDia: { cuentaDesde: "2026-09-01", descuenta: true } } } }) as EstadoApp;
  const s0 = sesionDe("cal_demo_036");
  const closer = s0.anfitrion!;
  const dia = diaDeNegocio(s0.inicia);
  const verDia = (etiqueta: string) => {
    const e = conRegla(estado());
    const st = strikesDe(e, closer, hoy);
    const d = st.dias.find((x) => x.dia === dia);
    console.log(`${etiqueta}: día ${dia} de ${closer} →`, d ? JSON.stringify(d) : "sin strike", `| strikes totales del closer: ${st.total}`);
    return d;
  };
  // Reinicio de la llamada: ya la tocó el test 1 en este proceso; la dejamos cancelada otra vez como la trae Calendly.
  acciones.editarLlamadas([{ id: s0.id, cambios: { estadoLlamada: "", estado: "cancelada", estadoLlamadaEn: undefined }, detalle: "reiniciar" }]);
  console.log("reiniciada:", JSON.stringify({ estado: sesionDe(s0.id).estado, estadoLlamada: sesionDe(s0.id).estadoLlamada, estadoLlamadaEn: sesionDe(s0.id).estadoLlamadaEn }));
  const antes = verDia("0) cancelada por Calendly, intacta");
  cargar(s0.id, "Inasistió");
  verDia("1) con «Inasistió» cargado hoy (una carga tardía: cuenta por diseño)");
  cargar(s0.id, "");
  const despues = verDia("2) vaciada");
  console.log("conStrike antes/después:", antes ? conStrike(antes) : false, despues ? conStrike(despues) : false);
});
