import test from "node:test";
import assert from "node:assert/strict";
import { acciones, fijarAcceso, type CambiosLlamada } from "@/lib/store";
import { NAV_CLOSER, inicioPara, navPara } from "@/components/shell/nav";
import { OPCIONES_POR_DEFECTO, miembroDeCloser } from "@/lib/crm";
import { estadoDeAgenda } from "@/lib/estados";
import { atrasoDe, pideCierre } from "@/lib/cierre-del-dia";
import { cambiosDelEod } from "@/lib/eod";
import { calcularPyL, comisionesDelMes } from "@/lib/finanzas";
import { armarEstadoResultados, esBloque, type NodoPyL } from "@/lib/estadoResultados";
import { rangoDePeriodo } from "@/lib/periodos";
import { TIPOS_POR_DEFECTO, type MiAcceso } from "@/lib/permisos";
import type { Ajustes, AreasDeTipo, EstadoApp, EstadoSesion, MiembroEquipo, Sesion } from "@/lib/types";
import { PERIODO, dia, estadoDePrueba } from "./estado-liquidacion";

/* ==================================================================
   Arreglos del estrés del closer (menú, cierre del día, nombres y estado de
   resultados). Cada prueba cuenta lo que pasaba y falla con el código de
   antes; lo que ya andaba (los tipos de fábrica, un equipo sin nombres que
   se pisan, una nota nueva) sigue dando lo mismo.
   ================================================================== */

const OPCIONES = OPCIONES_POR_DEFECTO.estadoLlamada;
const HOY = "2026-09-30";

/* ---------- 1. La agenda al vaciar el Estado de Llamada ---------- */

const AGENDAS: EstadoSesion[] = ["agendada", "hecha", "no-show", "cancelada"];
/* Uno de cada clase de estado (que da por hecha, que no vino, cancelada o que no toca la agenda); la matriz de abajo prueba los 15. */
const MUESTRA = ["Compra Full", "Seguimiento Nutrición", "Inasistió", "Dejó de Contestar", "Canceló (auto)", "Lead descartado"];

const estado = () => JSON.parse(acciones.exportar()) as EstadoApp;
const sesionDe = (id: string) => estado().sesiones.find((s) => s.id === id) as Sesion;
const sinUndefined = (s: Sesion) => JSON.parse(JSON.stringify(s));
const esDeVenta = (s: Sesion) => /asesoramiento/i.test(s.tipo);

/* Carga o vacía el Estado de Llamada, sin más. */
const poner = (id: string, valor: string) => acciones.editarLlamadas([{ id, cambios: { estadoLlamada: valor }, detalle: `Estado de Llamada → ${valor || "vacío"}` }]);

/* Lo que hace la pastilla de estado (components/estados/EstadoLlamada.tsx): cambia y deja cómo deshacer. */
function cambiar(id: string, valor: string, s: Sesion = sesionDe(id)) {
  const previo: CambiosLlamada = { estadoLlamada: s.estadoLlamada ?? "", estadoLlamadaEn: s.estadoLlamadaEn, estado: s.estado, resultado: s.resultado };
  const { etapas } = acciones.editarLlamadas([{ id, cambios: { estadoLlamada: valor }, detalle: `Estado de Llamada → ${valor || "vacío"}` }]);
  return () => { acciones.editarLlamadas([{ id, cambios: previo, detalle: "Deshacer" }], etapas); };
}

/* Una agenda marcada por Calendly o por el equipo, sin pasar por el Estado de Llamada. */
const marcarAgenda = (id: string, agenda: EstadoSesion) => acciones.editarLlamadas([{ id, cambios: { estado: agenda }, detalle: `La agenda queda ${agenda}` }]);

/* Una llamada de venta agendada y sin estado cargado, de la semilla de ejemplo: todas las pruebas usan la misma (cada una
   fija la agenda que necesita al empezar y la deja sin estado al terminar). */
let elegida: string | undefined;
function llamadaDePrueba(): Sesion {
  elegida ??= estado().sesiones.find((x) => esDeVenta(x) && x.estado === "agendada" && !x.estadoLlamada && !x.canceladaEn)?.id;
  assert.ok(elegida, "la semilla trae una llamada de venta agendada y sin estado");
  return sesionDe(elegida);
}

test("una llamada que cancelo Calendly sigue cancelada si se le carga un estado cualquiera y se lo vacía", () => {
  fijarAcceso(null);
  const e = estado();
  const c = e.sesiones.find((x) => x.estado === "cancelada" && x.canceladaEn && !x.estadoLlamada && esDeVenta(x));
  assert.ok(c, "la semilla trae una llamada cancelada por Calendly");
  const antes = sinUndefined(c);
  for (const nombre of MUESTRA) {
    poner(c.id, nombre);
    assert.equal(sesionDe(c.id).estadoLlamada, nombre);
    poner(c.id, "");
    const despues = sesionDe(c.id);
    assert.equal(despues.estado, "cancelada", `${nombre}: la llamada que canceló el invitado quedó «${despues.estado}»`);
    assert.equal(despues.extra?.agendaAntes, undefined, "la marca se borra al vaciar");
    /* Tampoco pasa a pedir cierre ni a quedar «tarde» por una carga que se vació. */
    assert.equal(pideCierre(despues, HOY), false);
    assert.equal(atrasoDe(despues, "2026-09-10", HOY), null);
  }
  /* Lo único que quedó de tanto cargar y vaciar es la marca de la primera vez: hay historia. */
  const { estadoLlamadaEn, ...resto } = sinUndefined(sesionDe(c.id));
  assert.ok(estadoLlamadaEn);
  assert.deepEqual(resto, antes);
});

test("una llamada que Calendly dio por no-show sigue en no-show si se le carga un estado y se lo vacía", () => {
  fijarAcceso(null);
  const n = estado().sesiones.find((x) => x.estado === "no-show" && !x.estadoLlamada && !x.estadoLlamadaEn && esDeVenta(x));
  assert.ok(n, "la semilla trae una llamada en no-show");
  for (const nombre of MUESTRA) {
    poner(n.id, nombre);
    poner(n.id, "");
    const despues = sesionDe(n.id);
    assert.equal(despues.estado, "no-show", `${nombre}: quedó «${despues.estado}»`);
    assert.equal(pideCierre(despues, HOY), false, "un no-show de Calendly sin estado no pide cierre");
  }
});

test("una llamada que el equipo marcó hecha a mano sigue hecha si se le carga un estado (también uno que ya la da por hecha) y se lo vacía", () => {
  fijarAcceso(null);
  const h = llamadaDePrueba();
  marcarAgenda(h.id, "hecha");
  for (const nombre of MUESTRA) {
    poner(h.id, nombre);
    poner(h.id, "");
    assert.equal(sesionDe(h.id).estado, "hecha", `${nombre}: quedó «${sesionDe(h.id).estado}»`);
  }
});

test("lo que ya andaba sigue igual: en una agenda sin marcar, cargar y vaciar cualquier estado la deja agendada (y mientras está cargado, la agenda dice lo que dice el estado)", () => {
  fijarAcceso(null);
  const a = llamadaDePrueba();
  marcarAgenda(a.id, "agendada");
  for (const o of OPCIONES) {
    poner(a.id, o.nombre);
    const dice = o.llamada ?? (o.auto === "cancelada" ? "cancelada" : "agendada");
    assert.equal(sesionDe(a.id).estado, dice, `${o.nombre}: con el estado cargado`);
    poner(a.id, "");
    assert.equal(sesionDe(a.id).estado, "agendada", `${o.nombre}: vaciado`);
  }
});

test("las 4 agendas por los 15 estados: cargar y vaciar deja la agenda como estaba y la llamada sin marca", () => {
  fijarAcceso(null);
  const e = estado();
  const cancelada = e.sesiones.find((x) => x.estado === "cancelada" && x.canceladaEn && !x.estadoLlamada && esDeVenta(x))!;
  const noShow = e.sesiones.find((x) => x.estado === "no-show" && !x.estadoLlamada && esDeVenta(x))!;
  const propia = llamadaDePrueba();
  const casos: [EstadoSesion, string][] = [["cancelada", cancelada.id], ["no-show", noShow.id], ["hecha", propia.id], ["agendada", propia.id]];
  assert.deepEqual(casos.map((c) => c[0]).sort(), [...AGENDAS].sort());
  let n = 0;
  for (const [agenda, id] of casos) {
    if (agenda === "hecha" || agenda === "agendada") marcarAgenda(id, agenda);
    const antes = sesionDe(id);
    assert.equal(antes.estado, agenda);
    const extraAntes = JSON.stringify(antes.extra ?? {});
    for (const o of OPCIONES) {
      poner(id, o.nombre);
      poner(id, "");
      const s = sesionDe(id);
      assert.equal(s.estado, agenda, `${agenda} → ${o.nombre} → vacío dejó «${s.estado}»`);
      assert.equal(JSON.stringify(s.extra ?? {}), extraAntes, `${agenda} → ${o.nombre}: quedó la marca`);
      n++;
    }
  }
  assert.equal(n, 4 * OPCIONES.length);
});

test("deshacer la carga deja la llamada exactamente como estaba; deshacer el vaciado la deja como estaba antes de vaciar, con lo que hace falta para volver a vaciarla bien", () => {
  fijarAcceso(null);
  const e = estado();
  const noShow = e.sesiones.find((x) => x.estado === "no-show" && !x.estadoLlamada && esDeVenta(x))!;
  const propia = llamadaDePrueba();
  for (const [id, agenda, valor] of [[noShow.id, "no-show", "Inasistió"], [propia.id, "hecha", "Seguimiento Nutrición"], [propia.id, "agendada", "Compra Full"], [propia.id, "agendada", "Lead descartado"]] as const) {
    marcarAgenda(id, agenda);
    const original = sinUndefined(sesionDe(id));
    const deshacerCarga = cambiar(id, valor);
    deshacerCarga();
    assert.deepEqual(sinUndefined(sesionDe(id)), original, `${valor}: deshacer la carga`);
    /* De nuevo: se carga, se vacía y se deshace el vaciado. */
    cambiar(id, valor);
    const cargada = sinUndefined(sesionDe(id));
    const deshacerVaciado = cambiar(id, "");
    deshacerVaciado();
    assert.deepEqual(sinUndefined(sesionDe(id)), cargada, `${valor}: deshacer el vaciado`);
    cambiar(id, "");
    assert.equal(sesionDe(id).estado, original.estado, `${valor}: vaciar después de deshacer el vaciado`);
  }
});

test("lo que alguien movió a mano después de cargar el estado no se toca al vaciarlo, y tampoco lo que Calendly canceló después", () => {
  fijarAcceso(null);
  const a = llamadaDePrueba();
  marcarAgenda(a.id, "agendada");
  cambiar(a.id, "Compra Full");
  assert.equal(sesionDe(a.id).estado, "hecha");
  marcarAgenda(a.id, "no-show");
  cambiar(a.id, "");
  assert.equal(sesionDe(a.id).estado, "no-show", "el equipo la había pasado a «no vino»");
  const b = llamadaDePrueba();
  marcarAgenda(b.id, "agendada");
  cambiar(b.id, "Seguimiento Nutrición");
  marcarAgenda(b.id, "cancelada"); // lo que hace calendly-sync cuando el invitado cancela
  cambiar(b.id, "");
  assert.equal(sesionDe(b.id).estado, "cancelada");
});

test("cambiar de un estado a otro no corre cómo estaba la agenda, salvo que entre uno y otro alguien la haya movido: entonces vuelve a lo que ese alguien dejó", () => {
  fijarAcceso(null);
  /* Sin nadie en el medio, vaciar el último vuelve a como estaba antes de todos (como siempre). */
  for (const cadena of [["Compra Full", "Seguimiento Nutrición"], ["Compra Full", "Inasistió"], ["Compra Full", "Lead descartado", "Seguimiento Nutrición"], ["Lead descartado", "Compra Cuotas", "Dejó de Contestar"]]) {
    const a = llamadaDePrueba();
    marcarAgenda(a.id, "agendada");
    for (const valor of cadena) cambiar(a.id, valor);
    cambiar(a.id, "");
    assert.equal(sesionDe(a.id).estado, "agendada", cadena.join(" → "));
    assert.equal(sesionDe(a.id).extra?.agendaAntes, undefined);
  }
  /* Calendly la da por no-show después de cargar «Compra Full», y el closer lo corrige a «Inasistió»: vaciarlo la deja en no-show, no agendada. */
  const b = llamadaDePrueba();
  marcarAgenda(b.id, "agendada");
  cambiar(b.id, "Compra Full");
  marcarAgenda(b.id, "no-show");
  cambiar(b.id, "Inasistió");
  assert.equal(sesionDe(b.id).estado, "no-show");
  cambiar(b.id, "");
  assert.equal(sesionDe(b.id).estado, "no-show", "lo que dio Calendly no es de ningún estado");
  assert.equal(pideCierre(sesionDe(b.id), HOY), false, "un no-show de Calendly sin estado no pide cierre");
  /* Lo mismo si Calendly la da por no-show entre dos estados que la dan por hecha: el segundo la pisa, y vaciarlo vuelve a lo de Calendly. */
  const c = llamadaDePrueba();
  marcarAgenda(c.id, "agendada");
  cambiar(c.id, "Compra Full");
  marcarAgenda(c.id, "no-show");
  cambiar(c.id, "Seguimiento Nutrición");
  cambiar(c.id, "");
  assert.equal(sesionDe(c.id).estado, "no-show");
});

test("una marca que quedó sin estado (otra pantalla, un deshacer a medias) no engaña al estado que se cargue después", () => {
  fijarAcceso(null);
  const a = llamadaDePrueba();
  marcarAgenda(a.id, "agendada");
  acciones.editarLlamadas([{ id: a.id, cambios: { extra: { ...a.extra, agendaAntes: "no-show" } }, detalle: "Una marca de más" }]);
  assert.equal(sesionDe(a.id).extra.agendaAntes, "no-show");
  poner(a.id, "Compra Full");
  assert.equal(sesionDe(a.id).extra.agendaAntes, "agendada", "la agenda de ahora, no la que había quedado");
  poner(a.id, "");
  assert.equal(sesionDe(a.id).estado, "agendada");
  assert.equal(sesionDe(a.id).extra.agendaAntes, undefined);
});

test("una llamada con el estado cargado de antes de la marca se comporta como siempre al vaciarla: agendada, salvo lo que Calendly canceló (canceladaEn)", () => {
  fijarAcceso(null);
  const legada = estado().sesiones.find((s) => s.estado === "hecha" && !s.extra?.agendaAntes && esDeVenta(s)
    && OPCIONES.some((o) => o.nombre === s.estadoLlamada && o.llamada === "hecha"));
  assert.ok(legada, "la semilla trae llamadas hechas con estado, sin la marca");
  cambiar(legada.id, "");
  assert.equal(sesionDe(legada.id).estado, "agendada");
  /* Lo mismo en la función pura, con y sin canceladaEn. */
  const vaciar = (s: Partial<Sesion>) => estadoDeAgenda({ estado: "agendada", ...s } as Sesion, "", OPCIONES);
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full" }), "agendada");
  assert.equal(vaciar({ estado: "no-show", estadoLlamada: "Inasistió" }), "agendada");
  assert.equal(vaciar({ estado: "cancelada", estadoLlamada: "Canceló (auto)" }), "agendada", "una cancelación marcada a mano sí se deshace");
  assert.equal(vaciar({ estado: "cancelada", estadoLlamada: "Canceló (auto)", canceladaEn: "2026-09-09T12:00:00.000Z" }), undefined, "lo que canceló Calendly sigue cancelado");
  assert.equal(vaciar({ estado: "no-show", estadoLlamada: "Inasistió", canceladaEn: "2026-09-09T12:00:00.000Z" }), "cancelada", "cancelada por Calendly y después «no vino» por un estado");
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full", canceladaEn: "2026-09-09T12:00:00.000Z" }), "cancelada");
  /* Si la agenda ya no dice lo que decía el estado, o no hay estado, no se toca nada. */
  assert.equal(vaciar({ estado: "no-show", estadoLlamada: "Compra Full" }), undefined);
  assert.equal(vaciar({ estado: "hecha" }), undefined);
});

test("con la marca de cómo estaba la agenda, vaciar el estado vuelve a eso; una marca que no es una agenda no cuenta", () => {
  const vaciar = (s: Partial<Sesion>) => estadoDeAgenda({ estado: "agendada", ...s } as Sesion, "", OPCIONES);
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Seguimiento Nutrición", extra: { agendaAntes: "hecha" } }), undefined, "ya estaba hecha a mano");
  assert.equal(vaciar({ estado: "no-show", estadoLlamada: "Inasistió", extra: { agendaAntes: "no-show" } }), undefined, "ya la había dado Calendly por no-show");
  assert.equal(vaciar({ estado: "no-show", estadoLlamada: "Inasistió", extra: { agendaAntes: "cancelada" } }), "cancelada");
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full", extra: { agendaAntes: "agendada" } }), "agendada");
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full", extra: { agendaAntes: "no-show" } }), "no-show");
  /* La marca vale más que canceladaEn. */
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full", canceladaEn: "2026-09-09T12:00:00.000Z", extra: { agendaAntes: "hecha" } }), undefined);
  /* Una marca rota se ignora: se hace lo de siempre. */
  for (const rota of ["otra cosa", 3, null, {}, ["hecha"]]) {
    assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full", extra: { agendaAntes: rota } }), "agendada", JSON.stringify(rota));
  }
  assert.equal(vaciar({ estado: "hecha", estadoLlamada: "Compra Full", extra: undefined }), "agendada");
  assert.equal(estadoDeAgenda({ estado: "hecha", estadoLlamada: "Compra Full", extra: null }, "", OPCIONES), "agendada");
});

test("una llamada cancelada o en no-show sin estado no queda «tarde» por la marca de una carga que se vació; la que no vino y tiene su venta, sí cuenta cuándo se cargó la venta", () => {
  const marca = "2026-09-11T15:00:00.000Z";
  for (const agenda of ["cancelada", "no-show"] as const) assert.equal(atrasoDe({ estado: agenda, estadoLlamada: undefined, estadoLlamadaEn: marca }, "2026-09-10", HOY), null, agenda);
  /* Lo demás, igual que antes. */
  assert.equal(atrasoDe({ estado: "hecha", estadoLlamada: undefined, estadoLlamadaEn: marca }, "2026-09-10", HOY), "tarde");
  assert.equal(atrasoDe({ estado: "no-show", estadoLlamada: "Dejó de Contestar", estadoLlamadaEn: marca }, "2026-09-10", HOY), "tarde", "si el closer la cargó tarde, cuenta");
  assert.equal(atrasoDe({ estadoLlamada: undefined, estadoLlamadaEn: marca }, "2026-09-10", HOY), "tarde");
  assert.equal(atrasoDe({ estado: "no-show", estadoLlamada: undefined }, "2026-09-10", HOY, "2026-09-12T15:00:00.000Z"), "tarde", "sin marca: cuenta cuándo se cargó la venta");
});

/* ---------- 2. El menú del closer ---------- */

const acceso = (areas: AreasDeTipo, soloLoSuyo: boolean): MiAcceso => ({ tipo: "x", nombre: "x", areas, soloLoSuyo });
const rutas = (a: MiAcceso) => navPara(a).flatMap((g) => g.items.map((i) => i.href));

test("«Cargar venta» y «Cerrar el día» sólo están en el menú del closer si su tipo edita Ventas y el CRM; «Mis llamadas», con verlo alcanza", () => {
  assert.deepEqual(rutas(acceso({ crm: "editar", ventas: "editar" }, true)), ["/mis-llamadas", "/cerrar-el-dia", "/cargar-venta"]);
  assert.deepEqual(rutas(acceso({ crm: "editar", ventas: "ver" }, true)), ["/mis-llamadas", "/cerrar-el-dia"], "con Ventas sólo para mirar, la base rechazaría la venta");
  assert.deepEqual(rutas(acceso({ crm: "ver", ventas: "editar" }, true)), ["/mis-llamadas", "/cargar-venta"], "con el CRM sólo para mirar, la base rechazaría el cierre");
  assert.deepEqual(rutas(acceso({ crm: "ver", ventas: "ver" }, true)), ["/mis-llamadas"]);
  assert.deepEqual(rutas(acceso({ crm: "ver" }, true)), ["/mis-llamadas"]);
  assert.deepEqual(rutas(acceso({ crm: "editar" }, true)), ["/mis-llamadas", "/cerrar-el-dia"]);
  assert.deepEqual(rutas(acceso({ ventas: "editar" }, true)), ["/cargar-venta"], "sin el CRM no hay «Mis llamadas», pero hay con qué cargar una venta");
  /* Las dos acciones son las únicas que piden editar. */
  assert.deepEqual(NAV_CLOSER.flatMap((g) => g.items).filter((i) => i.edita).map((i) => i.href), ["/cerrar-el-dia", "/cargar-venta"]);
  /* El inicio del closer sigue siendo «Mis llamadas». */
  assert.equal(inicioPara(acceso({ crm: "ver" }, true)), "/mis-llamadas");
});

test("un tipo de «sólo lo suyo» sin CRM ni Ventas no se queda sin menú: usa el de siempre y su inicio es una pantalla de ese menú", () => {
  const casos: [string, AreasDeTipo, string][] = [
    ["Alumnos", { alumnos: "editar" }, "/alumnos?seccion=hoy"],
    ["Alumnos y Clientes para ver", { alumnos: "ver", clientes: "ver" }, "/alumnos?seccion=hoy"],
    ["Leads", { leads: "editar" }, "/leads"],
    ["Finanzas", { finanzas: "editar" }, "/finanzas"],
    ["Marketing", { panel: "ver", webinars: "editar", marketing: "editar" }, "/panel"],
  ];
  for (const [nombre, areas, inicio] of casos) {
    const a = acceso(areas, true);
    const menu = rutas(a);
    assert.ok(menu.length > 0, `${nombre}: menú vacío`);
    assert.equal(inicioPara(a), inicio, nombre);
    assert.ok(menu.includes(inicioPara(a)), `${nombre}: el inicio ${inicioPara(a)} no está en [${menu.join(", ")}]`);
    /* El mismo menú que si no tuviera la casilla de «sólo lo suyo». */
    assert.deepEqual(menu, rutas(acceso(areas, false)), nombre);
    assert.ok(!menu.some((h) => ["/mis-llamadas", "/cerrar-el-dia", "/cargar-venta"].includes(h)), `${nombre}: tiene entradas de closer`);
  }
});

test("el inicio de cualquier tipo que ve algo es una pantalla de su menú, con y sin «sólo lo suyo» (todas las combinaciones de 7 áreas)", () => {
  const AREAS_VISTAS = ["panel", "leads", "crm", "ventas", "alumnos", "finanzas", "clientes"] as const;
  const NIVELES = [undefined, "ver", "editar"] as const;
  let tipos = 0, conMenu = 0;
  for (let n = 0; n < 3 ** AREAS_VISTAS.length; n++) {
    const areas: AreasDeTipo = {};
    AREAS_VISTAS.forEach((id, i) => { const v = NIVELES[Math.floor(n / 3 ** i) % 3]; if (v) areas[id] = v; });
    for (const soloLoSuyo of [false, true]) {
      tipos++;
      const a = acceso(areas, soloLoSuyo);
      const menu = rutas(a);
      if (menu.length === 0) { assert.equal(inicioPara(a), "/panel", "sin menú, el Dashboard"); continue; }
      conMenu++;
      assert.ok(menu.includes(inicioPara(a)), `${JSON.stringify(areas)} soloLoSuyo=${soloLoSuyo}: inicio ${inicioPara(a)}, menú [${menu.join(", ")}]`);
    }
  }
  assert.equal(tipos, 2 * 3 ** 7);
  assert.ok(conMenu > tipos / 2);
});

test("los tipos de fábrica siguen con su menú de siempre", () => {
  const menus: Record<string, string[]> = {
    closer: ["/mis-llamadas", "/cerrar-el-dia", "/cargar-venta"],
    setter: ["/leads", "/crm", "/agenda"],
    director: ["/panel", "/leads", "/crm", "/agenda", "/ventas", "/clientes", "/webinars", "/formularios"],
    admin: ["/panel", "/ventas", "/clientes", "/finanzas", "/finanzas/caja", "/conciliacion"],
    marketing: ["/panel", "/leads", "/webinars", "/formularios", "/marketing"],
    customer_success: ["/clientes", "/alumnos", "/alumnos?seccion=pipeline", "/reportes", "/alumnos?seccion=hoy", "/alumnos?seccion=clientes"],
  };
  const inicios: Record<string, string> = { closer: "/mis-llamadas", setter: "/leads", director: "/panel", admin: "/panel", marketing: "/panel", customer_success: "/alumnos?seccion=hoy" };
  for (const [id, esperado] of Object.entries(menus)) {
    const t = TIPOS_POR_DEFECTO.find((x) => x.id === id)!;
    const a = acceso(t.areas, t.soloLoSuyo);
    assert.deepEqual(rutas(a), esperado, id);
    assert.equal(inicioPara(a), inicios[id], id);
  }
});

/* ---------- 3. La nota del cierre del día ---------- */

const ajustes = { crm: undefined } as unknown as Ajustes;
const EOD = { estadoLlamada: "Seguimiento Nutrición", objecion: "Plata", hizoOferta: true, cierreEstimado: "2026-10-30" };
const nota = (notas: string | undefined, texto: string) => cambiosDelEod({ ...EOD, nota: texto }, { notas, estadoLlamada: undefined, estadoPreCall: undefined, ventaPorOtro: undefined }, ajustes, "Dante", "2026-10-07T20:00:00.000Z").notas;

test("una nota corta no se pierde porque otra palabra o frase de las notas la contiene", () => {
  assert.equal(nota("Quiere pagar en cuotas de seis meses", "cuotas"), "Quiere pagar en cuotas de seis meses\ncuotas");
  assert.equal(nota("Dijo que está ok con el precio", "ok"), "Dijo que está ok con el precio\nok");
  assert.equal(nota("Habló de la Plata del cliente\nVuelve el jueves", "Plata"), "Habló de la Plata del cliente\nVuelve el jueves\nPlata");
  assert.equal(nota("Llamó dos veces", "Llamó"), "Llamó dos veces\nLlamó");
  assert.equal(nota(undefined, "cuotas"), "cuotas");
  assert.equal(nota("   ", "cuotas"), "cuotas");
});

test("la misma nota no se duplica, aunque cambien los espacios, esté entre otras o venga con varios renglones", () => {
  assert.equal(nota("No contestó el celular", "No contestó el celular"), undefined);
  assert.equal(nota("No contestó el celular", "  No contestó el celular \n"), undefined);
  assert.equal(nota("Llamó\ncuotas\nOtro dato", "cuotas"), undefined, "ya es uno de los renglones");
  assert.equal(nota("Llamó\r\ncuotas\r\nOtro dato", "cuotas"), undefined, "con renglones de Windows");
  assert.equal(nota("Primero\nQuiere cuotas\nPero no ahora\nÚltimo", "Quiere cuotas\nPero no ahora"), undefined, "una nota de varios renglones, entera y seguida");
  assert.equal(nota("Primero\nQuiere cuotas", "Quiere cuotas\nPero no ahora"), "Primero\nQuiere cuotas\nQuiere cuotas\nPero no ahora", "si falta un renglón, es otra nota");
  assert.equal(nota("Quiere cuotas\nÚltimo\nPero no ahora", "Quiere cuotas\nPero no ahora"), "Quiere cuotas\nÚltimo\nPero no ahora\nQuiere cuotas\nPero no ahora", "los renglones no están seguidos");
});

test("una nota nueva se agrega al final, como siempre, y sin nota no se toca nada", () => {
  assert.equal(nota("No contestó el celular", "Escribió después"), "No contestó el celular\nEscribió después");
  assert.equal(nota("  No contestó el celular  \n", "Escribió después"), "No contestó el celular\nEscribió después");
  assert.equal(nota("No contestó", "   "), undefined);
  assert.equal(nota("No contestó", ""), undefined);
});

/* ---------- 4. Quién es cada anfitrión ---------- */

const m = (id: string, nombre: string, activo = true): MiembroEquipo => ({ id, nombre, rol: "closer", comisionRate: 0, activo, sinComision: false });

test("con más de una persona que encaja, la app elige la que elige la base: la activa y, a igual, la de menor id", () => {
  /* «Mariano» es el comienzo de los dos: gana el activo, aunque el otro esté primero. */
  const equipo = [m("b_viejo", "Mariano Gómez", false), m("a_nuevo", "Mariano Arias")];
  assert.equal(miembroDeCloser("Mariano", equipo)?.id, "a_nuevo");
  assert.equal(miembroDeCloser("Mariano", [...equipo].reverse())?.id, "a_nuevo");
  /* Dos activos con el mismo nombre: el de menor id, en cualquier orden del arreglo. */
  const repetido = [m("z", "Dante Barbieri"), m("a", "Dante Barbieri")];
  assert.equal(miembroDeCloser("Dante Barbieri", repetido)?.id, "a");
  assert.equal(miembroDeCloser("Dante Barbieri", [...repetido].reverse())?.id, "a");
  assert.equal(miembroDeCloser("Dante", [m("z", "Dante Barbieri"), m("a", "Dante Moreno")])?.id, "a");
  /* Un inactivo y un activo con el mismo nombre: el activo, aunque su id sea más grande. */
  assert.equal(miembroDeCloser("Dante Barbieri", [m("a", "Dante Barbieri", false), m("z", "Dante Barbieri")])?.id, "z");
  /* Dos inactivos: el de menor id. */
  assert.equal(miembroDeCloser("Ana", [m("y", "Ana Gómez", false), m("x", "Ana Pérez", false)])?.id, "x");
  /* El mismo nombre gana al que sólo empieza igual, aunque éste sea activo y de menor id. */
  assert.equal(miembroDeCloser("Mariano", [m("a", "Mariano Arias"), m("z", "Mariano", false)])?.id, "z");
});

test("un espacio al principio o al final del nombre no cambia a quién se refiere", () => {
  const equipo = [m("d", "Dante Barbieri"), m("m", " Mariano Arias")];
  for (const [anfitrion, id] of [[" Dante Barbieri", "d"], ["Dante Barbieri ", "d"], ["  dante   barbieri", "d"], ["Mariano Arias", "m"], [" mariano arias", "m"], ["\tMariano", "m"]] as const) {
    assert.equal(miembroDeCloser(anfitrion, equipo)?.id, id, `«${anfitrion}»`);
  }
  assert.equal(miembroDeCloser("   ", equipo), undefined);
  assert.equal(miembroDeCloser("", equipo), undefined);
  assert.equal(miembroDeCloser("Nadie Conocido", equipo), undefined);
});

test("lo que ya andaba sigue igual: sin nombres que se pisan, y con quien llama sin id ni activo", () => {
  const equipo = [m("yari", "Yari Taft"), m("dante", "Dante Barbieri"), m("val", "Valentín Abadía"), m("mari", "Mariano")];
  assert.equal(miembroDeCloser("Dante", equipo)?.id, "dante");
  assert.equal(miembroDeCloser("DANTE BARBIERI", equipo)?.id, "dante");
  assert.equal(miembroDeCloser("Valentin Abadia", equipo)?.id, "val");
  assert.equal(miembroDeCloser("Mariano Arias", equipo)?.id, "mari");
  assert.equal(miembroDeCloser("V. Abadia", equipo), undefined);
  /* Fathom y el diagnóstico llaman con sólo el nombre: manda el orden de siempre. */
  const soloNombres = [{ nombre: "Mariano Gómez" }, { nombre: "Mariano Arias" }];
  assert.equal(miembroDeCloser("Mariano", soloNombres), soloNombres[0]);
  assert.equal(miembroDeCloser("Mariano Arias", soloNombres), soloNombres[1]);
});

/* ---------- 5. El Estado de Resultados y el descuento por el cierre del día ---------- */

/* El septiembre de pruebas/estado-liquidacion.ts con la venta v1 de Mariano atada a una llamada del 3 que se cargó el 4: un día con
   strike. v2 (la del 8) se cerró a tiempo. */
function septiembre(descuenta: boolean): EstadoApp {
  const base = estadoDePrueba();
  const llamada = (id: string, d: number, extra: Partial<Sesion>): Sesion => ({
    id, titulo: "t", tipo: "Llamada de Asesoramiento - Webinar - Team", invitado: id, inicia: dia(d, 15), duracionMin: 45, estado: "hecha",
    origen: "calendly", creadoEn: dia(d, 9), extra: {}, anfitrion: "Mariano Arias", ...extra,
  }) as Sesion;
  return {
    ...base,
    sesiones: [
      ...base.sesiones,
      llamada("cal_v1", 3, { estadoLlamada: "Compra Cuotas", estadoLlamadaEn: dia(4, 18) }),
      llamada("cal_v2", 8, { estadoLlamada: "Compra Downsell", estadoLlamadaEn: dia(8, 22) }),
    ],
    ventas: base.ventas.map((v) => ({ ...v, ...(v.id === "v1" ? { sesionId: "cal_v1" } : v.id === "v2" ? { sesionId: "cal_v2" } : {}) })),
    ajustes: { ...base.ajustes, crm: { cierreDelDia: { cuentaDesde: "2026-09-01", descuenta, descuentaDesde: "2026-09-01" } } },
  } as EstadoApp;
}

const M = (n: number, d = 0) => n.toFixed(d);
const hoja = (e: EstadoApp, ventaId: string): { nodo: NodoPyL; grupo: NodoPyL } => {
  const mes = rangoDePeriodo(PERIODO);
  const arbol = armarEstadoResultados(e, mes, calcularPyL(e, mes), M, () => "#").filter((x): x is NodoPyL => !esBloque(x));
  const closers = arbol.find((n) => n.id === "closers")!;
  for (const g of closers.hijos ?? []) for (const h of g.hijos ?? []) if (h.href === `/ventas?ver=${ventaId}`) return { nodo: h, grupo: g };
  throw new Error(`no hay una fila de comisión de closer de ${ventaId}`);
};

test("la fila de una comisión que se descontó por el cierre del día lo dice y da el número del descuento", () => {
  const e = septiembre(true);
  const mes = rangoDePeriodo(PERIODO);
  const c = comisionesDelMes(e, mes).find((x) => x.ventaId === "v1")!;
  assert.equal(c.comisionCloser, 0, "la comisión de v1 no se paga");
  assert.ok(Math.abs((c.descuentoCierre ?? 0) - 436.5) < 1e-9, "15% de 2.910 neto de procesador");
  const { nodo } = hoja(e, "v1");
  assert.equal(nodo.cc, -0);
  assert.match(nodo.sub ?? "", /^15% de 2910\.00 neto de procesador \(3000\.00 cobrado\) · Mentoría · no se paga: día sin cierre cargado ese mismo día \(−436\.50\)$/);
});

test("lo que no se descuenta queda como estaba: el interruptor apagado, una venta de un día con cierre y la suma de cada closer", () => {
  const apagado = septiembre(false);
  const prendido = septiembre(true);
  /* Apagado: ninguna fila habla del cierre del día y el texto es el de siempre. */
  const a = hoja(apagado, "v1").nodo;
  assert.equal(a.sub, "15% de 2910.00 neto de procesador (3000.00 cobrado) · Mentoría");
  assert.ok(Math.abs((a.cc ?? 0) + 436.5) < 1e-9);
  /* Prendido, la venta del día que se cerró a tiempo no cambia. */
  const v2a = hoja(apagado, "v2").nodo, v2b = hoja(prendido, "v2").nodo;
  assert.deepEqual(v2b, v2a);
  assert.doesNotMatch(v2b.sub ?? "", /cierre/);
  /* El total de cada closer y el de Comisiones de closers siguen dando lo mismo que Finanzas (no se tocó la cuenta). */
  const mes = rangoDePeriodo(PERIODO);
  for (const e of [apagado, prendido]) {
    const p = calcularPyL(e, mes);
    const arbol = armarEstadoResultados(e, mes, p, M, () => "#").filter((x): x is NodoPyL => !esBloque(x));
    const closers = arbol.find((n) => n.id === "closers")!;
    assert.equal(closers.cc, -p.comisionCloser);
    for (const g of closers.hijos ?? []) assert.ok(Math.abs((g.cc ?? 0) - (g.hijos ?? []).reduce((x, h) => x + (h.cc ?? 0), 0)) < 0.011, g.titulo);
  }
  assert.ok(Math.abs(calcularPyL(prendido, mes).comisionCloser - (calcularPyL(apagado, mes).comisionCloser - 436.5)) < 1e-9);
});

test("la venta de quien no comisiona (Yari) no lleva el aviso del cierre del día aunque su llamada sea de un día con strike", () => {
  const e = septiembre(true);
  const deYari = { ...e, ventas: e.ventas.map((v) => (v.id === "v3" ? { ...v, sesionId: "cal_v1" } : v)) } as EstadoApp;
  const { nodo } = hoja(deYari, "v3");
  assert.equal(nodo.sub, "4000.00 cobrado · sin comisión");
  assert.equal(nodo.cc, -0);
});
