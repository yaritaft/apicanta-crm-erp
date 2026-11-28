import test from "node:test";
import assert from "node:assert/strict";
import {
  CIERRE_DEL_DIA, claveEod, cuentaDelDia, preguntasConTareas, preguntasDelDia, problemaDeRespuesta, respuestasDelDia, sigueFaltandoEnLaApp,
  tareasDelDia, type PreguntaDia, type Respuesta,
} from "@/lib/eod-finanzas";
import { llamadasEnDevolucionSinCargar, ventasDelPedido, type PedidoDeVentas } from "@/lib/devoluciones";
import type { Chequeos } from "@/lib/finanzas-pasos";
import { construirSemilla } from "@/lib/seed";
import type { Contacto, EstadoApp, Lead, Sesion, Venta } from "@/lib/types";

/* El End of Day de Finanzas en una sola pantalla (Aldana, 27/11: «las pantallas tardan en pasar… ¿tipo checklist?»). */

const AHORA = Date.parse("2026-10-16T15:00:00.000Z");      // viernes 16 de octubre de 2026
const vacio = (): EstadoApp => ({
  ...(construirSemilla() as EstadoApp),
  ventas: [], cuotas: [], pagos: [], movimientos: [], gastos: [], gastosRecurrentes: [], traspasos: [], arqueos: [], liquidaciones: [], sesiones: [], devoluciones: [],
});
const o = { ahora: AHORA, esDueno: true };
const en = (dia: string, hora = "20:00") => `${dia}T${hora}:00.000Z`;
const resp = (dia: string, tarea: string, estado: string, nota?: string) => ({ [claveEod(dia, tarea)]: { por: "Aldana", en: en(dia), estado, ...(nota ? { nota } : {}) } });
const cierre = (dia: string, nota?: string) => ({ [claveEod(dia, CIERRE_DEL_DIA)]: { por: "Aldana", en: en(dia, "23:00"), estado: "cerrado", ...(nota ? { nota } : {}) } });
const simple = (ps: PreguntaDia[]) => ps.map((p) => ({ id: p.id, cadencia: p.cadencia, desde: p.desde, notaAntes: p.notaAntes, faltan: p.paso.faltan }));

test("las tareas calculadas una vez dan las mismas preguntas que antes, con cualquier cosa contestada", () => {
  const e = vacio();
  const casos: Chequeos[] = [
    {},
    { ...resp("2026-10-14", "d-slack", "no-llegue", "esperaba a Ventas"), ...resp("2026-10-14", "d-tareas", "hecho") },
    { ...resp("2026-10-15", "d-slack", "hecho"), ...cierre("2026-10-15") },
    Object.assign({}, ...["s-weekly", "s-informe"].map((t) => resp("2026-10-09", t, t === "s-informe" ? "no-llegue" : "hecho", "falta la caja"))),
  ];
  for (const dia of ["2026-10-12", "2026-10-15", "2026-10-16", "2026-10-18", "2026-10-19"]) {
    const tareas = tareasDelDia(e, dia, o);
    for (const c of casos) assert.deepEqual(simple(preguntasConTareas(tareas, dia, c)), simple(preguntasDelDia(e, dia, c, o)), `${dia} ${Object.keys(c).join(",")}`);
  }
});

test("armar las preguntas no toca las tareas guardadas: lo que quedó pendiente de un caso no aparece en el otro", () => {
  const e = vacio();
  const tareas = tareasDelDia(e, "2026-10-15", o);
  const conPendiente = preguntasConTareas(tareas, "2026-10-15", resp("2026-10-14", "d-slack", "no-llegue", "esperaba a Ventas"));
  assert.equal(conPendiente.find((p) => p.id === "d-slack")!.desde, "2026-10-14");
  assert.equal(tareas.diarias.find((p) => p.id === "d-slack")!.desde, undefined, "la tarea guardada sigue limpia");
  assert.equal(preguntasConTareas(tareas, "2026-10-15", {}).find((p) => p.id === "d-slack")!.desde, undefined);
});

test("una respuesta cuenta cuando tiene opción, y «No llegué» además el motivo", () => {
  assert.equal(problemaDeRespuesta(undefined), "Elegí una opción");
  assert.equal(problemaDeRespuesta({}), "Elegí una opción");
  assert.equal(problemaDeRespuesta({ estado: "hecho" }), null);
  assert.equal(problemaDeRespuesta({ estado: "no-hacia-falta" }), null);
  assert.equal(problemaDeRespuesta({ estado: "no-llegue" }), "Contá por qué no llegaste y para cuándo");
  assert.equal(problemaDeRespuesta({ estado: "no-llegue", nota: "   " }), "Contá por qué no llegaste y para cuándo");
  assert.equal(problemaDeRespuesta({ estado: "no-llegue", nota: "mañana a primera hora" }), null);
});

test("lo contestado de un día es sólo de ese día y sin el cierre", () => {
  const c: Chequeos = {
    ...resp("2026-10-15", "d-banco", "hecho"), ...resp("2026-10-15", "d-slack", "no-llegue", "esperaba a Ventas"), ...cierre("2026-10-15", "todo bien"),
    ...resp("2026-10-14", "d-banco", "no-hacia-falta"), "mes|2026-10|m-software": { por: "Aldana", en: en("2026-10-15") },
  };
  assert.deepEqual(respuestasDelDia(c, "2026-10-15"), {
    "d-banco": { estado: "hecho", nota: undefined },
    "d-slack": { estado: "no-llegue", nota: "esperaba a Ventas" },
  });
  assert.deepEqual(respuestasDelDia(c, "2026-10-16"), {});
});

test("la cuenta del día: cuántas van, de qué manera y cuáles faltan, en el orden de la lista", () => {
  const ps = preguntasDelDia(vacio(), "2026-10-15", {}, o);
  const r: Record<string, Respuesta> = {
    "d-banco": { estado: "hecho" },
    "d-ingresos": { estado: "no-llegue", nota: "esperando a Mariano" },
    "d-cuotas": { estado: "no-llegue" },               // sin el motivo: falta
    "d-tareas": { estado: "no-hacia-falta" },
  };
  const c = cuentaDelDia(ps, r);
  assert.equal(c.total, 10);
  assert.equal(c.contestadas, 3);
  assert.equal(c.hechas, 1);
  assert.equal(c.noLlegue, 1, "el «No llegué» sin motivo no cuenta como contestado");
  assert.equal(c.noHaciaFalta, 1);
  assert.deepEqual(c.faltan.map((p) => p.id), ["d-cuotas", "d-proveedores", "d-slack", "d-financiera", "d-caja", "d-pasarelas", "d-reembolsos"]);
  const todo = Object.fromEntries(ps.map((p) => [p.id, { estado: "hecho" } as Respuesta]));
  assert.deepEqual(cuentaDelDia(ps, todo).faltan, []);
  assert.equal(cuentaDelDia([], {}).total, 0);
});

test("«Hecho» donde la app todavía ve pendientes se avisa sólo en las tareas que se calculan", () => {
  const ps = preguntasDelDia(vacio(), "2026-10-15", {}, o);
  const banco = { ...ps.find((p) => p.id === "d-banco")!, paso: { ...ps.find((p) => p.id === "d-banco")!.paso, faltan: 3 } };
  const slack = { ...ps.find((p) => p.id === "d-slack")!, paso: { ...ps.find((p) => p.id === "d-slack")!.paso, faltan: 3 } };
  assert.equal(sigueFaltandoEnLaApp(banco, { estado: "hecho" }), true);
  assert.equal(sigueFaltandoEnLaApp(banco, { estado: "no-llegue", nota: "x" }), false);
  assert.equal(sigueFaltandoEnLaApp({ ...banco, paso: { ...banco.paso, faltan: 0 } }, { estado: "hecho" }), false);
  assert.equal(sigueFaltandoEnLaApp(slack, { estado: "hecho" }), false, "una tarea manual no tiene nada que ver la app");
});

/* ---------- La raíz de la lentitud: las llamadas en «Devolución» ----------
   Cada venta buscaba su contacto recorriendo todos los contactos y leads, por cada llamada en «Devolución»: con los datos reales del 27/11
   (996 ventas, 7600 personas, 24 llamadas) eran ~530 ms en cada cambio de la app. Ahora se arma el índice una vez. La regla es la misma:
   se compara contra la versión de antes, copiada acá tal cual. */

const sinTildes = (s: string | undefined) => (s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
function ventasDelPedidoDeAntes(e: Pick<EstadoApp, "ventas" | "sesiones" | "leads" | "contactos">, p: PedidoDeVentas): Venta[] {
  if (p.ventaId) { const v = e.ventas.find((x) => x.id === p.ventaId); return v ? [v] : []; }
  const sesion = p.sesionId ? e.sesiones.find((s) => s.id === p.sesionId) : undefined;
  const ids = new Set<string>([p.personaId, sesion?.leadId].filter((x): x is string => Boolean(x)));
  const emails = new Set<string>();
  const nombres = new Set<string>();
  if (sesion?.email) emails.add(sinTildes(sesion.email));
  if (sesion?.invitado) nombres.add(sinTildes(sesion.invitado));
  if (p.email) emails.add(sinTildes(p.email));
  if (p.nombre) nombres.add(sinTildes(p.nombre));
  for (const id of [...ids]) {
    const c = (e.contactos ?? []).find((x) => x.id === id) ?? (e.leads ?? []).find((x) => x.id === id);
    if (!c) continue;
    if ((c as { contactoId?: string }).contactoId) ids.add((c as { contactoId?: string }).contactoId as string);
    if (c.email) emails.add(sinTildes(c.email));
    if (c.nombre) nombres.add(sinTildes(c.nombre));
  }
  if (ids.size === 0 && emails.size === 0 && nombres.size === 0) return [];
  const delContacto = (v: Venta) => {
    const c = v.contactoId ? (e.contactos ?? []).find((x) => x.id === v.contactoId) ?? (e.leads ?? []).find((x) => x.id === v.contactoId) : undefined;
    return c?.email ? sinTildes(c.email) : "";
  };
  return e.ventas
    .filter((v) => (v.contactoId && ids.has(v.contactoId)) || (delContacto(v) && emails.has(delContacto(v))) || nombres.has(sinTildes(v.contactoNombre)))
    .sort((a, b) => Date.parse(b.fecha) - Date.parse(a.fecha));
}

/* Un mundo al azar con nombres y mails que se repiten a propósito (con tildes, mayúsculas y espacios de más), ids compartidos entre contactos
   y leads, leads atados a contactos y ventas sin contacto. */
function mundo(semilla: number, n = { ventas: 60, contactos: 40, leads: 40, sesiones: 30 }) {
  let x = semilla;
  const azar = () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; };
  const de = <T,>(xs: T[]) => xs[Math.floor(azar() * xs.length)];
  const NOMBRES = ["Sebastián Vega", "sebastian vega", "Ana  Pérez", "ana perez", "Luis Gómez", "María José", "Pedro", "", "José Luis"];
  const MAILS = ["seba@x.com", "SEBA@x.com ", "ana@y.com", "luis@z.com", "", "maria@w.com", "pedro@v.com"];
  const contactos = Array.from({ length: n.contactos }, (_, i) => ({ id: `per_${i}`, nombre: de(NOMBRES), email: de(MAILS) })) as unknown as Contacto[];
  const leads = Array.from({ length: n.leads }, (_, i) => ({
    id: azar() < 0.2 ? `per_${i}` : `lead_${i}`, nombre: de(NOMBRES), email: de(MAILS), ...(azar() < 0.4 ? { contactoId: `per_${Math.floor(azar() * n.contactos)}` } : {}),
  })) as unknown as Lead[];
  const ids = [...contactos.map((c) => c.id), ...leads.map((l) => l.id), "nadie", undefined];
  const ventas = Array.from({ length: n.ventas }, (_, i) => ({
    id: `ven_${i}`, contactoId: de(ids), contactoNombre: de(NOMBRES), fecha: new Date(Date.UTC(2026, 0, 1) + Math.floor(azar() * 300) * 86400000).toISOString(),
    estado: de(["activa", "reembolsada", "cancelada"]), precio: 100,
  })) as unknown as Venta[];
  const sesiones = Array.from({ length: n.sesiones }, (_, i) => ({
    id: `ses_${i}`, leadId: de(ids), email: de(MAILS), invitado: de(NOMBRES), inicia: new Date(Date.UTC(2026, 5, 1) + i * 3600000).toISOString(), estadoLlamada: de(["Devolución", "Compra Full", undefined]),
  })) as unknown as Sesion[];
  return { ventas, contactos, leads, sesiones, azar, de, ids };
}

test("las ventas de un pedido salen iguales que antes, en 200 mundos al azar", () => {
  for (let s = 1; s <= 200; s++) {
    const m = mundo(s);
    const e = { ventas: m.ventas, contactos: m.contactos, leads: m.leads, sesiones: m.sesiones };
    for (let k = 0; k < 8; k++) {
      const pedido: PedidoDeVentas = {
        ...(m.azar() < 0.5 ? { sesionId: m.de(m.sesiones).id } : {}),
        ...(m.azar() < 0.3 ? { personaId: m.de(m.ids) } : {}),
        ...(m.azar() < 0.3 ? { email: m.de(["seba@x.com", "ana@y.com", ""]) } : {}),
        ...(m.azar() < 0.3 ? { nombre: m.de(["Sebastián Vega", "Pedro", ""]) } : {}),
        ...(m.azar() < 0.05 ? { ventaId: m.de(m.ventas).id } : {}),
      };
      assert.deepEqual(ventasDelPedido(e, pedido).map((v) => v.id), ventasDelPedidoDeAntes(e, pedido).map((v) => v.id), `mundo ${s}, pedido ${JSON.stringify(pedido)}`);
    }
  }
});

test("las llamadas en «Devolución» sin cargar se calculan rápido con el tamaño real de la base", () => {
  const m = mundo(7, { ventas: 1000, contactos: 4800, leads: 2800, sesiones: 0 });
  const sesiones = Array.from({ length: 30 }, (_, i) => ({
    id: `ses_${i}`, leadId: `lead_${i * 7}`, email: `nadie${i}@q.com`, invitado: `Persona ${i}`, inicia: new Date(Date.UTC(2026, 9, 1) + i * 3600000).toISOString(), estadoLlamada: "Devolución",
  })) as unknown as Sesion[];
  const e = { ...vacio(), ventas: m.ventas, contactos: m.contactos, leads: m.leads, sesiones };
  const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
  llamadasEnDevolucionSinCargar(e);
  const antes = cpu();
  for (let i = 0; i < 5; i++) llamadasEnDevolucionSinCargar(e);
  const porVez = (cpu() - antes) / 5;
  /* Antes eran ~500 ms en esta máquina; el tope es holgado para que no falle con la máquina ocupada. */
  assert.ok(porVez < 60, `tardó ${porVez.toFixed(1)} ms de CPU por vez`);
  assert.equal(llamadasEnDevolucionSinCargar(e).length, 30);
});
