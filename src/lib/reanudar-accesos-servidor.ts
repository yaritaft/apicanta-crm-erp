import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { darAccesos, type ResultadoAccesos } from "./accesos-servidor";
import { mensajeDeVuelta } from "./accesos-alumnos";
import { finDelPrograma, listasCs, seguimientoCompleto } from "./clientes-cs";
import { diaDeNegocio } from "./dia-negocio";
import { money } from "./format";
import { mailsDeServicio } from "./outboarding-servidor";
import { programaDeProducto, type Programa } from "./programas";
import { esOutboarding } from "./outboarding";
import { estaAfuera, followUpAlVolver, pedidoDeReanudar, problemaParaReanudar, queCuota } from "./reanudar-accesos";
import { configSeguimiento, hoyDelNegocio } from "./seguimiento";
import type { Cuota, SeguimientoAlumno, Venta } from "./types";

/* ==================================================================
   Reanudar los accesos, del lado del servidor (la regla: lib/reanudar-accesos.ts; Liliana, 27/11).

   · `reanudarAlumno`: lo que hace «Reanudar accesos» en la ficha (api/accesos-alumnos, accion "reanudar"). Vuelve a activo con el
     Follow Up elegido (la base pasa el estado a activo sola: supabase/outboarding-es-baja-27-11.sql), saca la marca de «Pido la baja
     por falta de pago» de sus cuotas (si no, la pasada de bajas lo volvería a poner en la lista de Lili), le da los accesos de su
     programa por la app (lo que ya tiene no se repite; lo que le sacó la app vuelve) y arma el mensaje para mandarle. No toca fechas.
   · `pasarReanudaciones`: en la pasada de cada hora (api/cron/contratos, a las :25), a quien pagó estando afuera le avisa a Customer
     Success. Un aviso por pago y por persona: la pasada siguiente no lo repite.
   ================================================================== */

type Dar = typeof darAccesos;

export class ErrorReanudar extends Error {}

interface AlumnoFila { id: string; nombre: string | null; email: string | null; estado: string | null; inicio: string | null; plan: string | null; ventaId: string | null; leadId: string | null }
type VentaFila = Pick<Venta, "id" | "estado" | "contactoId" | "contactoNombre" | "productoId" | "moneda" | "closerId">;
type CuotaFila = Pick<Cuota, "id" | "ventaId" | "numero" | "monto" | "vence" | "estado" | "esReserva" | "seguimientoCobro">;
interface PagoFila { id: string; cuotaId: string; monto: number; creadoEn: string | null; fecha: string | null }

const COLS_ALUMNO = 'id, nombre, email, estado, inicio, plan, "ventaId", "leadId"';
const COLS_VENTA = 'id, estado, "contactoId", "contactoNombre", "productoId", moneda, "closerId"';
const COLS_CUOTA = 'id, "ventaId", numero, monto, vence, estado, "esReserva", "seguimientoCobro"';
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const ddmmaaaa = (dia: string) => `${ddmm(dia)}/${dia.slice(0, 4)}`;
const pila = (nombre: string) => nombre.trim().split(/\s+/)[0] || nombre;

/** La configuración del seguimiento y los nombres de los productos: con eso se calcula el fin del programa como en Clientes. */
async function contexto(db: SupabaseClient) {
  const aj = await db.from("ajustes").select("seguimiento").eq("id", 1).maybeSingle();
  const cfg = configSeguimiento((aj.data as { seguimiento?: unknown } | null)?.seguimiento as Parameters<typeof configSeguimiento>[0]);
  const prods = await db.from("productos").select("id, nombre");
  const nombreDeProducto = new Map(((prods.data ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre] as const));
  return { cfg, listas: listasCs(cfg), nombreDeProducto };
}

/** El fin de su programa: la misma cuenta que «Fecha de egreso» (lib/clientes-cs.ts → finDelPrograma), con su demora y sus pausas. */
function finDe(ctx: Awaited<ReturnType<typeof contexto>>, a: AlumnoFila, seg: SeguimientoAlumno | null, venta: VentaFila | null): string | null {
  if (!seg) return null;
  const producto = (venta?.productoId ? ctx.nombreDeProducto.get(venta.productoId) : undefined) ?? "";
  return finDelPrograma(diaDeNegocio(a.inicio) || "", seguimientoCompleto(seg, ctx.cfg), producto || a.plan || "", ctx.listas.programas);
}

/** La venta del servicio: la enlazada o, si no tiene, la activa más nueva de su lead (como lib/alumnos.ts → alumnoDeVenta). */
async function ventaDelAlumno(db: SupabaseClient, a: AlumnoFila): Promise<VentaFila | null> {
  if (a.ventaId) {
    const r = await db.from("ventas").select(COLS_VENTA).eq("id", a.ventaId).maybeSingle();
    if (r.data) return r.data as VentaFila;
  }
  if (!a.leadId) return null;
  const r = await db.from("ventas").select(`${COLS_VENTA}, fecha`).eq("contactoId", a.leadId);
  const ventas = ((r.data ?? []) as (VentaFila & { fecha?: string })[]).sort((x, y) => (y.fecha ?? "").localeCompare(x.fecha ?? ""));
  return ventas.find((v) => v.estado === "activa") ?? ventas[0] ?? null;
}

export interface ResultadoReanudar {
  followUp: string;
  /* El fin de su programa, que no cambia. */
  fin: string | null;
  /* Las cuotas a las que se les sacó la marca de «Pido la baja». */
  marcasSacadas: number;
  /* Lo que dio la app (si se pidió) y el programa. */
  accesos: ResultadoAccesos | null;
  programa: string | null;
  /* El mensaje para mandarle por WhatsApp. */
  mensaje: string;
}

/** «Reanudar accesos»: vuelve al programa con las mismas fechas. Tira ErrorReanudar si no se puede (ya está activo, su programa terminó). */
export async function reanudarAlumno(db: SupabaseClient, a: {
  alumnoId: string; quien: string; quienNombre: string; followUp?: string | null; darAccesos: boolean; programas: Programa[]; ahora?: Date;
}, dar: Dar = darAccesos): Promise<ResultadoReanudar> {
  const ahora = a.ahora ?? new Date();
  const hoy = hoyDelNegocio(ahora);
  const al = (await db.from("alumnos").select(COLS_ALUMNO).eq("id", a.alumnoId).maybeSingle()).data as AlumnoFila | null;
  if (!al) throw new ErrorReanudar("No encuentro ese alumno.");
  const seg = (await db.from("seguimiento_alumnos").select("*").eq("alumnoId", al.id).maybeSingle()).data as SeguimientoAlumno | null;
  const venta = await ventaDelAlumno(db, al);
  const ctx = await contexto(db);
  const fin = finDe(ctx, al, seg, venta);
  const problema = problemaParaReanudar({ followUp: seg?.followUp, estadoAlumno: al.estado, venta, fin, hoy });
  if (problema) throw new ErrorReanudar(problema);
  const nombre = al.nombre || venta?.contactoNombre || "el alumno";

  /* 1. Vuelve a activo. El Follow Up primero: la base pasa el estado a activo cuando sale de Outboarding, y no deja escribir otro
     estado mientras diga Outboarding. Después el estado, por si estaba de baja con otro Follow Up. */
  const followUp = followUpAlVolver(a.followUp, ctx.listas.followUps);
  const cambioSeg = { followUp, actualizadoEn: ahora.toISOString(), actualizadoPor: a.quienNombre };
  if (seg) {
    const r = await db.from("seguimiento_alumnos").update(cambioSeg).eq("alumnoId", al.id);
    if (r.error) throw new Error(`No se pudo cambiar el Follow Up: ${r.error.message}`);
  } else {
    const r = await db.from("seguimiento_alumnos").insert({ id: `seg_${al.id}`, alumnoId: al.id, ...cambioSeg });
    if (r.error) throw new Error(`No se pudo crear la ficha: ${r.error.message}`);
  }
  if (al.estado === "baja") {
    const r = await db.from("alumnos").update({ estado: "activo" }).eq("id", al.id);
    if (r.error) throw new Error(`No se pudo pasar a activo: ${r.error.message}`);
  }

  /* 2. La marca de «Pido la baja por falta de pago» de sus cuotas: ya no la pide (y el aviso sin leer de esa baja se borra solo). */
  let marcasSacadas = 0;
  if (venta) {
    const cs = await db.from("cuotas").select(COLS_CUOTA).eq("ventaId", venta.id);
    for (const c of ((cs.data ?? []) as CuotaFila[]).filter((x) => x.seguimientoCobro?.estado === "baja")) {
      const r = await db.from("cuotas").update({
        seguimientoCobro: { estado: "contactado", por: a.quienNombre, en: ahora.toISOString(), nota: `Volvió al programa: ${a.quienNombre} le reanudó los accesos el ${ddmm(hoy)}.` },
      }).eq("id", c.id);
      if (!r.error) marcasSacadas++;
    }
  }

  /* 3. Los accesos de su programa por la app. Lo que ya tiene no se repite; lo que le sacó la app (o el outboarding) vuelve. */
  const programa = venta ? programaDeProducto(a.programas, venta.productoId) : null;
  let accesos: ResultadoAccesos | null = null;
  if (a.darAccesos && programa) {
    if (!al.email?.trim()) throw new ErrorReanudar(`Ya volvió a activo, pero no tiene mail: Wisboo y Zoom lo necesitan para darle los accesos.`);
    const tel = seg?.telefono || (al.leadId ? ((await db.from("leads").select("telefono").eq("id", al.leadId).maybeSingle()).data as { telefono?: string } | null)?.telefono : "") || "";
    accesos = await dar(db, { alumnoId: al.id, programa, origen: "manual", quien: a.quien, persona: { nombre, email: al.email, telefono: tel } });
  }
  const mensaje = mensajeDeVuelta(nombre, programa?.nombre ?? "tu programa", accesos?.links ?? []);

  /* 4. Queda en su historia, y se avisa a quien tiene que saberlo. */
  const partes = [
    `Reanudó sus accesos: vuelve a activo con el Follow Up «${followUp}».`,
    accesos ? `Accesos de ${programa?.nombre}: ${accesos.dados} dados${accesos.yaEstaban ? `, ${accesos.yaEstaban} ya los tenía` : ""}${accesos.fallaron ? `, ${accesos.fallaron} con error` : ""}.` : "",
    marcasSacadas ? `Se sacó la marca de «Pido la baja» de ${marcasSacadas === 1 ? "1 cuota" : `${marcasSacadas} cuotas`}.` : "",
    `Las fechas no se corren${fin ? `: su programa termina el ${ddmmaaaa(fin)}` : ""}.`,
  ];
  await db.from("actividad").insert({
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, accion: "actualizo", actor: a.quienNombre,
    entidad: "alumno", entidadId: al.id, titulo: nombre, fecha: ahora.toISOString(), detalle: partes.filter(Boolean).join(" "),
  });
  await avisarQueVolvio(db, { al, venta, nombre, quien: a.quien, quienNombre: a.quienNombre, dia: hoy, conAccesos: Boolean(accesos) });
  return { followUp, fin, marcasSacadas, accesos, programa: programa?.nombre ?? null, mensaje };
}

/* Los avisos de «volvió»: a Customer Success (menos a quien lo hizo: si no fue Lili, ella le manda el mensaje) y al closer de la venta.
   Los avisos de «pagó estando afuera» de este alumno quedan leídos: ya se resolvió. */
async function avisarQueVolvio(db: SupabaseClient, x: { al: AlumnoFila; venta: VentaFila | null; nombre: string; quien: string; quienNombre: string; dia: string; conAccesos: boolean }): Promise<void> {
  try {
    const contactoId = x.al.leadId ?? x.al.id;
    if (x.venta) await db.from("avisos").update({ leidoEn: new Date().toISOString() }).like("id", `av_reanudar_${x.venta.id}_%`).is("leidoEn", null);
    const yo = x.quien.trim().toLowerCase();
    const servicio = (await mailsDeServicio(db)).filter((m) => m !== yo);
    const closer = x.venta?.closerId
      ? (((await db.from("equipo").select("email").eq("id", x.venta.closerId).maybeSingle()).data as { email?: string | null } | null)?.email ?? "").trim().toLowerCase()
      : "";
    const id = (para: string) => `av_volvio_${x.al.id}_${x.dia}_${createHash("sha1").update(para).digest("hex").slice(0, 10)}`;
    const filas = [
      ...servicio.map((para) => ({
        id: id(para), para, tipo: "reanudar", titulo: `${x.quienNombre} le reanudó los accesos a ${x.nombre}`,
        cuerpo: `Volvió a activo con las mismas fechas.${x.conAccesos ? " La app le dio los accesos de su programa:" : ""} mandale el mensaje (en su ficha → Accesos, «Copiar mensaje con links»).`,
        de: "Apicanta", contactoId, persona: x.nombre,
      })),
      ...(closer.includes("@") && closer !== yo && !servicio.includes(closer) ? [{
        id: id(closer), para: closer, tipo: "reanudar", titulo: `${x.nombre} volvió al programa`,
        cuerpo: `${x.quienNombre} le reanudó los accesos después de que pagó. Sus cuotas siguen como estaban.`, de: "Apicanta", contactoId, persona: x.nombre,
      }] : []),
    ];
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (e) { console.error("[reanudar] no se pudo avisar", e instanceof Error ? e.message : String(e)); }
}

/* ---------- La pasada de cada hora: pagó estando afuera ---------- */

export interface PasadaReanudar {
  /* Pagos de los últimos días mirados, y a cuántos alumnos se les avisó. */
  pagos: number;
  avisados: { alumnoId: string; pagoId: string }[];
}

/** Cuántos días para atrás mira los pagos cargados (con margen por si una pasada no corrió). */
const DIAS_DE_PAGOS = 3;

export async function pasarReanudaciones(db: SupabaseClient, ahora = new Date()): Promise<PasadaReanudar> {
  const salida: PasadaReanudar = { pagos: 0, avisados: [] };
  const desde = new Date(ahora.getTime() - DIAS_DE_PAGOS * 86_400_000).toISOString();
  const p = await db.from("pagos").select('id, "cuotaId", monto, "creadoEn", fecha').gte("creadoEn", desde);
  if (p.error) throw new Error(`pagos: ${p.error.message}`);
  const recientes = ((p.data ?? []) as PagoFila[]).filter((x) => (Number(x.monto) || 0) > 0);
  salida.pagos = recientes.length;
  if (!recientes.length) return salida;

  const c = await db.from("cuotas").select('id, "ventaId"').in("id", [...new Set(recientes.map((x) => x.cuotaId))]);
  if (c.error) throw new Error(`cuotas: ${c.error.message}`);
  const ventaIds = [...new Set(((c.data ?? []) as { ventaId: string }[]).map((x) => x.ventaId))];
  if (!ventaIds.length) return salida;
  const v = await db.from("ventas").select(COLS_VENTA).in("id", ventaIds);
  if (v.error) throw new Error(`ventas: ${v.error.message}`);
  const ventas = ((v.data ?? []) as VentaFila[]).filter((x) => x.estado === "activa");
  if (!ventas.length) return salida;

  /* El alumno de cada venta: el que la tiene enlazada o el que salió del mismo lead. */
  const leads = [...new Set(ventas.map((x) => x.contactoId).filter((x): x is string => Boolean(x)))];
  const porVenta = await db.from("alumnos").select(COLS_ALUMNO).in("ventaId", ventas.map((x) => x.id));
  const porLead = leads.length ? await db.from("alumnos").select(COLS_ALUMNO).in("leadId", leads) : { data: [], error: null };
  if (porVenta.error || porLead.error) throw new Error(`alumnos: ${(porVenta.error ?? porLead.error)!.message}`);
  const alumnos = [...((porVenta.data ?? []) as AlumnoFila[]), ...((porLead.data ?? []) as AlumnoFila[])];
  const pares = ventas.map((venta) => ({ venta, al: alumnos.find((a) => a.ventaId === venta.id) ?? (venta.contactoId ? alumnos.find((a) => a.leadId === venta.contactoId) : undefined) }))
    .filter((x): x is { venta: VentaFila; al: AlumnoFila } => Boolean(x.al));
  if (!pares.length) return salida;
  const segs = await db.from("seguimiento_alumnos").select("*").in("alumnoId", [...new Set(pares.map((x) => x.al.id))]);
  if (segs.error) throw new Error(`seguimiento_alumnos: ${segs.error.message}`);
  const segDe = new Map(((segs.data ?? []) as SeguimientoAlumno[]).map((s) => [s.alumnoId, s] as const));
  const afuera = pares.filter((x) => estaAfuera(segDe.get(x.al.id)?.followUp, x.al.estado));
  if (!afuera.length) return salida;

  const ctx = await contexto(db);
  const servicio = await mailsDeServicio(db);
  for (const { venta, al } of afuera) {
    try {
      const seg = segDe.get(al.id) ?? null;
      const cuotas = ((await db.from("cuotas").select(COLS_CUOTA).eq("ventaId", venta.id)).data ?? []) as CuotaFila[];
      const pagos = cuotas.length ? ((await db.from("pagos").select('id, "cuotaId", monto, "creadoEn", fecha').in("cuotaId", cuotas.map((q) => q.id))).data ?? []) as PagoFila[] : [];
      const pedido = pedidoDeReanudar({ followUp: seg?.followUp, estadoAlumno: al.estado, venta, cuotas, pagos, fin: finDe(ctx, al, seg, venta), ahora });
      /* Sólo por un pago de estos días: uno viejo ya avisó (o es de antes de que existiera esto). */
      if (!pedido || !recientes.some((x) => x.id === pedido.pago.id)) continue;
      const nombre = al.nombre || venta.contactoNombre || "El alumno";
      const donde = esOutboarding(seg?.followUp) ? "está en Outboarding" : "está de baja";
      const filas = servicio.map((para) => ({
        id: `av_reanudar_${venta.id}_${pedido.pago.id}_${createHash("sha1").update(para).digest("hex").slice(0, 10)}`,
        para, tipo: "reanudar", titulo: `${nombre} pagó y ${donde}`,
        cuerpo: `Se cargó ${queCuota(pedido.cuota)} (${money(Number(pedido.pago.monto) || 0, venta.moneda || "USD", 0)}, vencía el ${ddmm(pedido.vencia)}) y ya no debe nada vencido. `
          + `Si vuelve, en su ficha → Accesos tocá «Reanudar accesos»: vuelve a activo, le damos los accesos y te queda el mensaje para mandarle a ${pila(nombre)}. Las fechas no se corren.`,
        de: "Apicanta", contactoId: al.leadId ?? al.id, persona: nombre,
      }));
      if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
      salida.avisados.push({ alumnoId: al.id, pagoId: pedido.pago.id });
    } catch (e) {
      console.error("[reanudar] pasada", al.id, e instanceof Error ? e.message : String(e));
    }
  }
  return salida;
}
