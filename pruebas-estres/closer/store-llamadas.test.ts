import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso, type CambiosLlamada } from "@/lib/store";
import { OPCIONES_POR_DEFECTO, esCompra } from "@/lib/crm";
import { estadoDeAgenda } from "@/lib/estados";
import { atrasoDe, pideCierre } from "@/lib/cierre-del-dia";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { EstadoApp, Sesion } from "@/lib/types";
import { porSemillas, type Azar } from "./azar";

/* ==================================================================
   El store de verdad (sin nube, con la semilla de ejemplo): lo que pasa con
   la marca de «la primera vez que se cargó» cuando se cambia, se vacía y se
   deshace el Estado de Llamada, y lo que pasa con la agenda al vaciar.
   Es el cimiento de los strikes: si la marca se corre, se pierde o se
   inventa, el cierre del día cuenta mal.

   Estas pruebas comparten el estado del store dentro de este archivo (node
   corre cada archivo en su proceso). Todo se compara contra lo que el mismo
   store dejó antes, así no dependen del día en que se corren.
   ================================================================== */

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const sesionDe = (id: string) => estado().sesiones.find((s) => s.id === id) as Sesion;
const OPCIONES = OPCIONES_POR_DEFECTO.estadoLlamada.map((o) => o.nombre);
const PRECALL = OPCIONES_POR_DEFECTO.estadoPreCall.map((o) => o.nombre);
const esDeVenta = (s: Sesion) => /asesoramiento/i.test(s.tipo);

/* Lo que hace la pastilla de estado (components/estados/EstadoLlamada.tsx): cambia y deja cómo deshacerlo. */
function cambiar(s: Sesion, campo: "estadoLlamada" | "estadoPreCall", valor: string) {
  const antes = s[campo] ?? "";
  const marca = campo === "estadoLlamada" ? "estadoLlamadaEn" : "estadoPreCallEn";
  const previo: CambiosLlamada = {
    [campo]: antes, [marca]: s[marca],
    ...(campo === "estadoLlamada" ? { estado: s.estado, resultado: s.resultado } : {}),
  };
  const { etapas } = acciones.editarLlamadas([{ id: s.id, cambios: { [campo]: valor }, detalle: `${campo} → ${valor}` }]);
  return () => { acciones.editarLlamadas([{ id: s.id, cambios: previo, detalle: "deshacer" }], etapas); };
}

test("la marca de la primera vez: se pone al pasar de vacío a cargado, no se corre al cambiar ni se borra al vaciar (30 semillas × sesiones al azar)", () => {
  fijarAcceso(null);
  const pool = estado().sesiones.filter((s) => esDeVenta(s));
  assert.ok(pool.length >= 40, `sesiones de venta: ${pool.length}`);
  let marcasNuevas = 0, vaciados = 0, cambiosSinMarca = 0;
  porSemillas(30, 1, (r: Azar) => {
    const s0 = r.elige(pool);
    const empezo = Date.now();
    const campos = ["estadoLlamada", "estadoPreCall"] as const;
    const marcaDe = { estadoLlamada: "estadoLlamadaEn", estadoPreCall: "estadoPreCallEn" } as const;
    /* Lo que dice la regla: la marca existe si ya estaba o si el campo pasó de vacío a cargado sin tenerla; después es esa y no cambia. */
    const modelo: Record<string, string | undefined> = { estadoLlamada: sesionDe(s0.id).estadoLlamadaEn, estadoPreCall: sesionDe(s0.id).estadoPreCallEn };
    for (let paso = 0; paso < r.entre(2, 7); paso++) {
      const campo = r.elige(campos);
      const valor = r.elige(["", "", ...(campo === "estadoLlamada" ? OPCIONES : PRECALL)]);
      const s = sesionDe(s0.id);
      if ((s[campo] ?? "") === valor) continue;
      const eraVacio = !s[campo];
      cambiar(s, campo, valor);
      if (!valor) vaciados++;
      if (valor && eraVacio && !modelo[campo]) { modelo[campo] = "NUEVA"; marcasNuevas++; }
      else if (valor && !eraVacio && !modelo[campo]) cambiosSinMarca++;
      for (const c of campos) {
        const ahora = sesionDe(s0.id)[marcaDe[c]];
        assert.equal(Boolean(ahora), Boolean(modelo[c]), `${c}: la marca ${ahora ? "existe" : "no existe"} y el modelo dice ${modelo[c] ? "sí" : "no"}`);
        if (modelo[c] === "NUEVA") { assert.ok(Date.parse(ahora!) >= empezo - 5, "la marca es de ahora, no de otro día"); modelo[c] = ahora; }
        else if (modelo[c]) assert.equal(ahora, modelo[c], `${c}: la marca se corrió`);
      }
    }
  });
  assert.ok(marcasNuevas > 8 && vaciados > 8 && cambiosSinMarca >= 0, `marcas nuevas ${marcasNuevas}, vaciados ${vaciados}`);
});

test("cambiar un estado y deshacer deja la llamada tal cual estaba: estados, marca, agenda y etapa del lead (60 semillas)", () => {
  fijarAcceso(null);
  const pool = estado().sesiones.filter((s) => esDeVenta(s));
  const usadas = new Set<string>();
  let conLead = 0;
  porSemillas(60, 1000, (r) => {
    const s0 = r.elige(pool.filter((p) => !usadas.has(p.id)));
    usadas.add(s0.id);
    const antes = estado();
    const sa = antes.sesiones.find((s) => s.id === s0.id)!;
    const campo = r.elige(["estadoLlamada", "estadoLlamada", "estadoPreCall"] as const);
    const valor = r.elige(campo === "estadoLlamada" ? OPCIONES : PRECALL);
    if ((sa[campo] ?? "") === valor) return;
    const deshacer = cambiar(sa, campo, valor);
    deshacer();
    const despues = estado();
    const sd = despues.sesiones.find((s) => s.id === s0.id)!;
    /* La llamada: igual en todo lo que importa (undefined y ausente son lo mismo). */
    const norm = (s: Sesion) => JSON.parse(JSON.stringify(s));
    assert.deepEqual(norm(sd), norm(sa));
    /* El lead: la misma etapa. */
    const lead = antes.leads.find((l) => l.id === (sa.leadId ?? sa.contactoId));
    if (lead) {
      conLead++;
      assert.equal(despues.leads.find((l) => l.id === lead.id)?.etapaId, lead.etapaId, "la etapa del lead");
    }
  });
  assert.ok(conLead > 20, `con lead ${conLead}`);
});

/* BUG: vaciar el Estado de Llamada devuelve la agenda a «agendada» aunque el estado no fuera lo que la marcó: una llamada que
   Calendly canceló (canceladaEn) o dio por no-show, o que el equipo marcó «hecha» en la Agenda, queda «agendada» después de
   cargar un estado y vaciarlo. El comentario de estadoDeAgenda dice «si era ese estado el que la había marcado (lo que
   canceló Calendly sigue cancelado)», pero sólo cuida el caso en que el estado elegido era el automático «Canceló». Con el
   interruptor prendido, la llamada que no pedía cierre pasa a pedirlo y, con la marca de cuándo se cargó, queda «tarde»: un
   strike que el closer no se ganó. */
test("BUG: cargar un estado en una llamada cancelada por Calendly y vaciarlo la deja cancelada", () => {
  fijarAcceso(null);
  const e = estado();
  const s = e.sesiones.find((x) => x.estado === "cancelada" && x.canceladaEn && !x.estadoLlamada && esDeVenta(x))!;
  assert.ok(s, "la semilla trae una llamada cancelada");
  cambiar(s, "estadoLlamada", "Inasistió");
  cambiar(sesionDe(s.id), "estadoLlamada", "");
  assert.equal(sesionDe(s.id).estado, "cancelada", `quedó «${sesionDe(s.id).estado}»: una llamada que canceló el invitado reaparece como agendada`);
});

test("BUG: cargar un estado en una llamada que Calendly dio por no-show y vaciarlo la deja en no-show", () => {
  fijarAcceso(null);
  const e = estado();
  const s = e.sesiones.find((x) => x.estado === "no-show" && !x.estadoLlamada && esDeVenta(x))!;
  assert.ok(s, "la semilla trae una llamada en no-show");
  cambiar(s, "estadoLlamada", "Inasistió");
  cambiar(sesionDe(s.id), "estadoLlamada", "");
  assert.equal(sesionDe(s.id).estado, "no-show");
});

test("BUG: el strike que nace de eso: la llamada que no pedía cierre pasa a pedirlo y queda «tarde» por una carga que se vació", () => {
  /* Lo que hace el store paso a paso (con estadoDeAgenda y la marca de la primera carga), con las fechas escritas a mano. */
  const opciones = OPCIONES_POR_DEFECTO.estadoLlamada;
  const dia = "2026-09-10";
  const original = { estado: "cancelada" as const, canceladaEn: "2026-09-09T12:00:00.000Z", estadoLlamada: undefined as string | undefined, estadoLlamadaEn: undefined as string | undefined, estadoPreCall: undefined, resultado: undefined, inicia: `${dia}T18:00:00.000Z` };
  assert.equal(pideCierre(original, "2026-09-30"), false, "una llamada que canceló el invitado no pide cierre");
  /* Al otro día el closer carga «Inasistió». */
  const cargada = { ...original, estadoLlamada: "Inasistió", estadoLlamadaEn: "2026-09-11T15:00:00.000Z", estado: estadoDeAgenda(original, "Inasistió", opciones) ?? original.estado };
  /* Y la vacía: la marca de la primera carga queda (hay historia). */
  const vaciada = { ...cargada, estadoLlamada: undefined, estado: estadoDeAgenda(cargada, "", opciones) ?? cargada.estado };
  assert.equal(vaciada.estado, "cancelada", `la agenda quedó «${vaciada.estado}»`);
  assert.equal(pideCierre(vaciada, "2026-09-30"), false, "no debería pedir cierre: no se hizo, la canceló el invitado");
  assert.equal(atrasoDe(vaciada, diaDeNegocio(vaciada.inicia), "2026-09-30"), null, "ni quedar tarde");
});

/* ---------- Cargar la venta toca la llamada ---------- */

const acceso = (tipo: string): MiAcceso => {
  const t = TIPOS_POR_DEFECTO.find((x) => x.id === tipo)!;
  return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
};

test("cargar la venta de una llamada: queda atada por sesionId, la llamada toma el estado de compra con su marca (si quien carga edita llamadas), y su lead pasa a ganado", () => {
  fijarAcceso(null);
  const e0 = estado();
  const s = e0.sesiones.find((x) => esDeVenta(x) && !x.estadoLlamada && x.estado !== "cancelada" && e0.leads.some((l) => l.id === x.leadId))!;
  assert.ok(s, "la semilla trae una llamada de venta sin estado y con su lead");
  const lead = e0.leads.find((l) => l.id === s.leadId)!;
  const id = acciones.registrarVenta({
    sesionId: s.id,
    venta: { id: "v_prueba_1", contactoId: s.leadId, contactoNombre: s.invitado, productoId: e0.productos[0].id, precioAcordado: 3000, moneda: "USD", excluidoMarketing: false, estado: "activa", fecha: "2026-10-01T12:00:00.000Z", creadoEn: "2026-10-01T12:00:00.000Z", extra: {} },
    cuotas: [{ id: "c_prueba_1", ventaId: "v_prueba_1", numero: 1, monto: 1500, estado: "pendiente", esReserva: false }, { id: "c_prueba_2", ventaId: "v_prueba_1", numero: 2, monto: 1500, estado: "pendiente", esReserva: false }],
    cobros: [],
  });
  assert.equal(id, "v_prueba_1");
  const e1 = estado();
  assert.equal(e1.ventas.find((v) => v.id === id)?.sesionId, s.id, "la venta dice de qué llamada salió");
  const despues = e1.sesiones.find((x) => x.id === s.id)!;
  const op = OPCIONES_POR_DEFECTO.estadoLlamada.find((o) => o.nombre === despues.estadoLlamada);
  assert.ok(esCompra(op), `la llamada quedó en «${despues.estadoLlamada}»`);
  assert.equal(despues.estadoLlamada, "Compra Cuotas", "dos cuotas: en cuotas");
  assert.ok(despues.estadoLlamadaEn, "con la marca de cuándo");
  assert.equal(despues.estado, "hecha", "una compra da la llamada por hecha");
  const ganada = e1.etapas.find((x) => x.esGanada)!;
  assert.equal(e1.leads.find((l) => l.id === lead.id)?.etapaId, ganada.id, "el lead pasa a ganado");
});

test("quien carga la venta desde Administración (no edita llamadas) no toca la llamada: sin estado ni marca, y la venta queda atada igual", () => {
  fijarAcceso(acceso("admin"));
  const e0 = estado();
  const s = e0.sesiones.find((x) => esDeVenta(x) && !x.estadoLlamada && !x.estadoLlamadaEn && x.estado !== "cancelada" && x.id !== "x")!;
  const id = acciones.registrarVenta({
    sesionId: s.id,
    venta: { id: "v_prueba_2", contactoId: s.leadId, contactoNombre: s.invitado, productoId: e0.productos[0].id, precioAcordado: 3000, moneda: "USD", excluidoMarketing: false, estado: "activa", fecha: "2026-10-01T12:00:00.000Z", creadoEn: "2026-10-03T12:00:00.000Z", extra: {} },
    cuotas: [{ id: "c_prueba_3", ventaId: "v_prueba_2", numero: 1, monto: 3000, estado: "pendiente", esReserva: false }],
    cobros: [],
  });
  const e1 = estado();
  assert.equal(e1.ventas.find((v) => v.id === id)?.sesionId, s.id);
  const despues = e1.sesiones.find((x) => x.id === s.id)!;
  assert.equal(despues.estadoLlamada, undefined, "Administración no edita llamadas");
  assert.equal(despues.estadoLlamadaEn, undefined);
  /* Y los strikes cuentan cuándo se cargó la venta (creadoEn), no «sin cargar». */
  assert.equal(atrasoDe(despues, diaDeNegocio(despues.inicia), "2099-01-01", "2026-10-03T12:00:00.000Z"), diaDeNegocio("2026-10-03T12:00:00.000Z") > diaDeNegocio(despues.inicia) ? "tarde" : null);
  fijarAcceso(null);
});
