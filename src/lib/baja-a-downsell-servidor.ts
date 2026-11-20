import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { accesosDe, cambiarFicha, marcarEnLaFicha, quitarAccesos, type Acceso } from "./accesos-servidor";
import { PRODUCTOS_WISBOO } from "./accesos-alumnos";
import { finDelPrograma, listasCs, programasYDuracion, seguimientoCompleto } from "./clientes-cs";
import { programasGuardados } from "./contratos-servidor";
import { diaDeNegocio } from "./dia-negocio";
import { programaDeProducto, programaPorId, type PlataformaDeAcceso, type Programa } from "./programas";
import { configSeguimiento, hoyDelNegocio } from "./seguimiento";
import type { Cuota, Pago, Producto, SeguimientoAlumno, Venta } from "./types";
import {
  CLAVE_DE_BAJA, MOTIVO_DE_BAJA, downsellsPosibles, marcaDeBaja, notasDeNoSeCobra, planDeBaja, problemaDeBaja,
  type AccesoDeBaja, type MarcaDeBaja, type OpcionDeDownsell, type PlanDeBaja,
} from "./baja-a-downsell";

/* ==================================================================
   Pasar a Downsell por falta de pago, en la base (la regla: lib/baja-a-downsell.ts).
   `resumenDeBaja` arma lo que va a pasar con cada downsell posible (el asistente lo muestra antes de confirmar) y `pasarADownsell` lo
   hace: la venta, sus cuotas, la ficha y los accesos, con un aviso a Finanzas y al closer. Lo llama api/alumnos/downsell.
   `avisarFinesDeBaja` (la pasada de cada hora) avisa a Customer Success el día que termina el programa de alguien cuyos accesos no
   eran de la app y hay que sacarle el contenido a mano.
   ================================================================== */

export interface RecursoDeBaja { plataforma: PlataformaDeAcceso; nombre: string; venceEn?: string }

export interface PlanVisible {
  noSeCobran: { numero: number; esReserva: boolean; monto: number }[];
  saldadas: { numero: number; esReserva: boolean; monto: number }[];
  seSacan: RecursoDeBaja[];
  quedan: RecursoDeBaja[];
  /* Lo que no dio la app y hay que hacer a mano: sacarle ya (`hoy`) y sacarle el día del fin (`alFin`). */
  aMano: { hoy: RecursoDeBaja[]; alFin: RecursoDeBaja[] };
  programasFicha: string[];
  pagoMenos: number;
}

export interface ResumenDeBaja {
  alumno: { id: string; nombre: string };
  problema: string | null;
  moneda: string;
  cobrado: number;
  precioAnterior: number;
  desde: { programa: string; producto: string };
  inicio: string;
  fin: string | null;
  opciones: OpcionDeDownsell[];
  planes: Record<string, PlanVisible>;
}

interface Datos {
  alumno: { id: string; nombre: string; inicio: string | null; plan: string | null; ventaId: string | null; leadId: string | null };
  venta: Venta | null;
  cuotas: Cuota[];
  pagos: Pick<Pago, "cuotaId" | "monto">[];
  productos: Producto[];
  programas: Programa[];
  seg: SeguimientoAlumno;
  segExiste: boolean;
  accesos: Acceso[];
  origen: Programa | null;
  fin: string | null;
  duracion: number | null;
  cobrado: number;
  opciones: OpcionDeDownsell[];
  nombres: Map<string, string>;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const ddmmaaaa = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

async function leer(db: SupabaseClient, alumnoId: string): Promise<Datos> {
  const a = await db.from("alumnos").select('id, nombre, inicio, plan, "ventaId", "leadId"').eq("id", alumnoId).maybeSingle();
  if (a.error) throw new Error(`alumnos: ${a.error.message}`);
  if (!a.data) throw new Error("No encuentro ese alumno.");
  const alumno = a.data as Datos["alumno"];
  /* Los montos, como números: un numeric puede llegar como texto y «825» + «0» no es una suma. */
  const v0 = alumno.ventaId ? ((await db.from("ventas").select("*").eq("id", alumno.ventaId).maybeSingle()).data as Venta | null) : null;
  const venta = v0 ? { ...v0, precioAcordado: Number(v0.precioAcordado) || 0, extra: v0.extra ?? {} } : null;
  const cuotas = venta ? (((await db.from("cuotas").select("*").eq("ventaId", venta.id)).data ?? []) as Cuota[]).map((c) => ({ ...c, monto: Number(c.monto) || 0 })) : [];
  const pagos = cuotas.length ? (((await db.from("pagos").select('"cuotaId", monto').in("cuotaId", cuotas.map((c) => c.id))).data ?? []) as Pick<Pago, "cuotaId" | "monto">[]).map((p) => ({ ...p, monto: Number(p.monto) || 0 })) : [];
  const productos = ((await db.from("productos").select("*")).data ?? []) as Producto[];
  const { programas } = await programasGuardados(db);
  const aj = await db.from("ajustes").select("seguimiento").eq("id", 1).maybeSingle();
  const cfg = configSeguimiento((aj.data as { seguimiento?: unknown } | null)?.seguimiento as Parameters<typeof configSeguimiento>[0]);
  const s = await db.from("seguimiento_alumnos").select("*").eq("alumnoId", alumnoId).maybeSingle();
  const seg = seguimientoCompleto((s.data ?? { alumnoId }) as SeguimientoAlumno, cfg);
  const accesos = await accesosDe(db, alumnoId);
  const origen = venta ? programaDeProducto(programas, venta.productoId) : null;
  const producto = productos.find((p) => p.id === venta?.productoId)?.nombre ?? "";
  const lista = listasCs(cfg).programas;
  /* El fin y la duración de ANTES del cambio: son los que se conservan. */
  const fin = alumno.inicio ? finDelPrograma(diaDeNegocio(alumno.inicio), seg, producto || alumno.plan || "", lista) : null;
  const duracion = programasYDuracion(seg, producto || alumno.plan || "", lista).duracion;
  const cobrado = r2(pagos.reduce((t, p) => t + p.monto, 0));
  const opciones = downsellsPosibles(programas, productos, cobrado);
  return { alumno, venta, cuotas, pagos, productos, programas, seg, segExiste: Boolean(s.data), accesos, origen, fin, duracion, cobrado, opciones, nombres: await nombresDeRecursos(db) };
}

/** Los nombres legibles de grupos, reuniones y cursos: los grupos anotados y lo que ya se le dio a alguien con nombre. */
async function nombresDeRecursos(db: SupabaseClient): Promise<Map<string, string>> {
  const m = new Map<string, string>(PRODUCTOS_WISBOO.map((p) => [`wisboo:${p.id}`, p.nombre]));
  const g = await db.from("telegram_grupos").select('"chatId", titulo');
  for (const x of (g.data ?? []) as { chatId: string; titulo: string | null }[]) if (x.titulo) m.set(`telegram:${x.chatId}`, x.titulo);
  const z = await db.from("accesos_alumno").select('plataforma, recurso, "recursoNombre"').eq("plataforma", "zoom");
  for (const x of (z.data ?? []) as { plataforma: string; recurso: string; recursoNombre: string | null }[]) {
    if (x.recursoNombre && x.recursoNombre !== x.recurso) m.set(`zoom:${x.recurso}`, x.recursoNombre);
  }
  return m;
}

const recurso = (d: Datos, plataforma: PlataformaDeAcceso, id: string, venceEn?: string): RecursoDeBaja => ({
  plataforma, nombre: d.nombres.get(`${plataforma}:${id}`) ?? (plataforma === "zoom" ? `Reunión de Zoom ${id}` : plataforma === "telegram" ? `Grupo de Telegram ${id}` : id), ...(venceEn ? { venceEn } : {}),
});

function planPara(d: Datos, destino: Programa, precio: number): PlanDeBaja {
  return planDeBaja({
    venta: d.venta!, cuotas: d.cuotas, pagos: d.pagos, origen: d.origen!, destino, precioDestino: precio,
    productos: d.productos, accesos: d.accesos as AccesoDeBaja[], inicio: d.alumno.inicio!, fin: d.fin!, programasFicha: d.seg.programas,
  });
}

function planVisible(d: Datos, destino: Programa, p: PlanDeBaja): PlanVisible {
  const cuota = (c: Cuota) => ({ numero: c.numero, esReserva: c.esReserva, monto: c.monto });
  const deLaApp = (pl: PlataformaDeAcceso, id: string) => d.accesos.some((x) => x.plataforma === pl && x.recurso === id && x.estado !== "quitado" && x.estado !== "fallo");
  const origen = d.origen!;
  const delOrigen = [
    ...origen.wisboo.map((id) => ["wisboo", id] as const), ...origen.telegram.map((id) => ["telegram", id] as const), ...origen.zoom.map((id) => ["zoom", id] as const),
  ];
  const daDestino = (pl: PlataformaDeAcceso, id: string) => (pl === "wisboo" ? destino.wisboo : pl === "telegram" ? destino.telegram : destino.zoom).includes(id);
  return {
    noSeCobran: p.noSeCobran.map(cuota),
    saldadas: p.saldadas.map(cuota),
    seSacan: p.seSacan.map((x) => ({ plataforma: x.plataforma, nombre: x.recursoNombre || recurso(d, x.plataforma, x.recurso).nombre })),
    quedan: p.quedan.map((x) => ({ plataforma: x.acceso.plataforma, nombre: x.acceso.recursoNombre || recurso(d, x.acceso.plataforma, x.acceso.recurso).nombre, venceEn: x.venceEn })),
    aMano: {
      hoy: delOrigen.filter(([pl, id]) => !daDestino(pl, id) && !deLaApp(pl, id)).map(([pl, id]) => recurso(d, pl, id)),
      alFin: delOrigen.filter(([pl, id]) => daDestino(pl, id) && !deLaApp(pl, id)).map(([pl, id]) => recurso(d, pl, id, p.venceEn)),
    },
    programasFicha: p.programasFicha,
    pagoMenos: p.pagoMenos,
  };
}

function problemaDe(d: Datos): string | null {
  return problemaDeBaja({ venta: d.venta, origen: d.origen, cobrado: d.cobrado, fin: d.fin, opciones: d.opciones });
}

/** Lo que va a pasar con cada downsell posible, sin tocar nada. */
export async function resumenDeBaja(db: SupabaseClient, alumnoId: string): Promise<ResumenDeBaja> {
  const d = await leer(db, alumnoId);
  const problema = problemaDe(d);
  const planes: Record<string, PlanVisible> = {};
  if (!problema) {
    for (const o of d.opciones) {
      const destino = programaPorId(d.programas, o.programaId);
      if (destino) planes[o.programaId] = planVisible(d, destino, planPara(d, destino, o.precio));
    }
  }
  return {
    alumno: { id: d.alumno.id, nombre: d.alumno.nombre }, problema, moneda: d.venta?.moneda ?? "USD", cobrado: d.cobrado,
    precioAnterior: d.venta?.precioAcordado ?? 0,
    desde: { programa: d.origen?.nombre ?? "", producto: d.productos.find((p) => p.id === d.venta?.productoId)?.nombre ?? "" },
    inicio: diaDeNegocio(d.alumno.inicio), fin: d.fin, opciones: d.opciones, planes,
  };
}

export interface ResultadoDeBaja {
  detalle: string;
  quitados: number;
  /* Lo que la app no pudo sacar (Telegram sin su usuario, Zoom caído): queda para hacerlo a mano desde Accesos. */
  fallaron: string[];
  plan: PlanVisible;
  marca: MarcaDeBaja;
}

/** Pasa la venta al downsell elegido con todo lo que eso implica. `quitar` se cambia en las pruebas (no llama a Telegram ni a Zoom). */
export async function pasarADownsell(db: SupabaseClient, a: {
  alumnoId: string; programaId: string; motivo: string; quien: string; ahora?: Date; quitar?: typeof quitarAccesos;
}): Promise<ResultadoDeBaja> {
  const d = await leer(db, a.alumnoId);
  const problema = problemaDe(d);
  if (problema) throw new Error(problema);
  if (!a.motivo.trim()) throw new Error("Escribí por qué pasa a Downsell.");
  const opcion = d.opciones.find((o) => o.programaId === a.programaId);
  const destino = programaPorId(d.programas, a.programaId);
  if (!opcion || !destino) throw new Error("Elegí a qué downsell pasa.");
  const venta = d.venta!;
  const origen = d.origen!;
  const plan = planPara(d, destino, opcion.precio);
  const visible = planVisible(d, destino, plan);
  const ahora = (a.ahora ?? new Date()).toISOString();
  const dia = hoyDelNegocio(a.ahora);
  const productoAntes = d.productos.find((p) => p.id === venta.productoId)?.nombre ?? origen.nombre;

  const marca: MarcaDeBaja = {
    dia, quien: a.quien, motivo: a.motivo.trim(), desdeProductoId: venta.productoId ?? null, desdePrograma: origen.nombre,
    precioAnterior: venta.precioAcordado, programa: destino.nombre, fin: plan.fin, venceEn: plan.venceEn,
    ...(visible.aMano.alFin.length ? { aManoAlFin: visible.aMano.alFin.map((x) => x.nombre) } : {}),
  };

  /* 1. La venta: el downsell, lo que pagó y la marca. Se vuelve a mirar la marca justo antes: dos clics no la pasan dos veces. */
  const otra = (await db.from("ventas").select("extra").eq("id", venta.id).maybeSingle()).data as Pick<Venta, "extra"> | null;
  if (marcaDeBaja(otra)) throw new Error("Ya pasó a Downsell.");
  const v = await db.from("ventas").update({
    productoId: opcion.productoId, precioAcordado: plan.cobrado, extra: { ...(venta.extra ?? {}), [CLAVE_DE_BAJA]: marca },
  }).eq("id", venta.id);
  if (v.error) throw new Error(`No se pudo cambiar la venta: ${v.error.message}`);

  /* 2. Las cuotas: las que no pagó no se cobran (quedan a la vista como incobrables); la que pagó a medias queda en lo pagado. */
  for (const c of plan.noSeCobran) {
    const r = await db.from("cuotas").update({ estado: "cancelada", notas: notasDeNoSeCobra(c, a.motivo) }).eq("id", c.id);
    if (r.error) throw new Error(`No se pudo cambiar la cuota ${c.numero}: ${r.error.message}`);
  }
  for (const c of plan.saldadas) {
    const r = await db.from("cuotas").update({ monto: c.monto, estado: "pagada", notas: c.notas ?? null }).eq("id", c.id);
    if (r.error) throw new Error(`No se pudo cambiar la cuota ${c.numero}: ${r.error.message}`);
  }

  /* 3. El alumno y su ficha: el plan pasa al downsell; el inicio NO se toca y la duración queda fija (la del programa que pagó). */
  await db.from("alumnos").update({ plan: d.productos.find((p) => p.id === opcion.productoId)?.nombre ?? destino.nombre }).eq("id", d.alumno.id);
  await cambiarFicha(db, d.alumno.id, {
    programas: plan.programasFicha,
    ...(d.seg.duracionMeses === null && d.duracion !== null ? { duracionMeses: d.duracion } : {}),
  });

  /* 4. Los accesos: lo que conserva pasa al downsell con su corte; lo que no da, se saca ahora. */
  for (const q of plan.quedan) {
    await db.from("accesos_alumno").update({ programa: destino.id, venceEn: q.venceEn, actualizadoEn: ahora }).eq("id", q.acceso.id);
  }
  const quitar = a.quitar ?? quitarAccesos;
  let quitados = 0;
  const fallaron: string[] = [];
  if (plan.seSacan.length) {
    const r = await quitar(db, { alumnoId: d.alumno.id, ids: plan.seSacan.map((x) => x.id), quien: `${a.quien} (pasó a Downsell)` });
    quitados = r.quitados;
    fallaron.push(...r.accesos.filter((x) => x.error).map((x) => x.recursoNombre || x.recurso));
  } else {
    await marcarEnLaFicha(db, d.alumno.id);
  }

  const M = (n: number) => `${venta.moneda} ${n.toLocaleString("es-AR", { maximumFractionDigits: 2 })}`;
  const detalle = `${MOTIVO_DE_BAJA}: de ${productoAntes} (${M(venta.precioAcordado)}) a ${destino.nombre}, que vale lo que pagó (${M(plan.cobrado)}). `
    + (plan.noSeCobran.length ? `No se cobran: ${plan.noSeCobran.map((c) => (c.esReserva ? "la reserva" : `cuota ${c.numero}`)).join(", ")}. ` : "")
    + `Sigue hasta el ${ddmmaaaa(plan.fin)} (el inicio no cambia). Motivo: ${a.motivo.trim()}`;
  await db.from("actividad").insert({
    id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, accion: "actualizo", actor: a.quien,
    entidad: "transaccion", entidadId: venta.id, titulo: venta.contactoNombre || d.alumno.nombre, fecha: ahora, detalle,
  });
  await avisarDelCambio(db, { venta, alumno: d.alumno, detalle, quien: a.quien, dia, fallaron, aManoHoy: visible.aMano.hoy.map((x) => x.nombre) });
  return { detalle, quitados, fallaron, plan: visible, marca };
}

/** A Finanzas (la venta cambió de valor y hay cuotas que ya no se cobran) y al closer de la venta. Quien lo hizo no se avisa a sí mismo. */
async function avisarDelCambio(db: SupabaseClient, a: {
  venta: Venta; alumno: Datos["alumno"]; detalle: string; quien: string; dia: string; fallaron: string[]; aManoHoy: string[];
}): Promise<void> {
  try {
    const tipos = ((await db.from("tipos_cuenta").select("id, areas")).data ?? []) as { id: string; areas: Record<string, string> | null }[];
    const deFinanzas = tipos.filter((t) => t.areas?.finanzas === "editar" && t.id !== "dueno" && t.id !== "equipo").map((t) => t.id);
    const finanzas = deFinanzas.length ? (((await db.from("usuarios_permitidos").select("email").in("rol", deFinanzas)).data ?? []) as { email: string }[]).map((x) => x.email) : [];
    const closer = a.venta.closerId ? ((await db.from("equipo").select("email").eq("id", a.venta.closerId).maybeSingle()).data as { email: string | null } | null)?.email : null;
    const yo = a.quien.trim().toLowerCase();
    const para = [...new Set([...finanzas, ...(closer ? [closer] : [])].map((x) => x?.trim().toLowerCase()).filter((x): x is string => Boolean(x) && x !== yo))];
    const nombre = a.alumno.nombre || a.venta.contactoNombre || "Un alumno";
    const extra = [
      a.fallaron.length ? `No se pudo sacar: ${a.fallaron.join(", ")} (a mano desde su Servicio → Accesos).` : "",
      a.aManoHoy.length ? `Sus accesos no los había dado la app: falta sacarle a mano ${a.aManoHoy.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    const filas = para.map((email) => ({
      id: `av_baja_${a.venta.id}_${createHash("sha1").update(email).digest("hex").slice(0, 10)}`,
      para: email, tipo: "venta", titulo: `${nombre} pasó a Downsell por falta de pago`,
      cuerpo: [a.detalle, extra].filter(Boolean).join(" "), de: "Apicanta", contactoId: a.venta.contactoId ?? a.alumno.leadId ?? null, persona: nombre,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (e) { console.error("[downsell] no se pudo avisar", e instanceof Error ? e.message : String(e)); }
}

/** La pasada de cada hora: el día que termina el programa de alguien que pasó a Downsell y cuyo contenido no lo dio la app, Customer Success
 *  recibe el aviso de sacárselo a mano (lo que sí dio la app lo corta solo pasarCortes). Una vez por venta; sólo los que vencieron en la última semana. */
export async function avisarFinesDeBaja(db: SupabaseClient, ahora = new Date()): Promise<number> {
  const r = await db.from("ventas").select('id, "contactoId", "contactoNombre", extra').not(`extra->${CLAVE_DE_BAJA}`, "is", null);
  if (r.error) throw new Error(`ventas: ${r.error.message}`);
  const semana = new Date(ahora.getTime() - 7 * 86_400_000).toISOString();
  const vencidas = ((r.data ?? []) as Pick<Venta, "id" | "contactoId" | "contactoNombre" | "extra">[])
    .map((v) => ({ v, m: marcaDeBaja(v) }))
    .filter((x) => x.m && x.m.aManoAlFin?.length && x.m.venceEn <= ahora.toISOString() && x.m.venceEn > semana);
  if (!vencidas.length) return 0;
  const cs = ((await db.from("equipo").select("email").eq("activo", true)
    .or("puesto.ilike.%customer success%,puesto.ilike.%servicio%,puesto.ilike.%csm%")).data ?? []) as { email: string | null }[];
  const para = [...new Set(cs.map((x) => x.email?.trim().toLowerCase()).filter((x): x is string => Boolean(x)))];
  const filas = vencidas.flatMap(({ v, m }) => para.map((email) => ({
    id: `av_finbaja_${v.id}_${createHash("sha1").update(email).digest("hex").slice(0, 10)}`,
    para: email, tipo: "outboarding", titulo: `Terminó el Downsell de ${v.contactoNombre}: sacale el contenido`,
    cuerpo: `El ${ddmmaaaa(m!.fin)} terminó su programa (pasó a Downsell por falta de pago el ${ddmmaaaa(m!.dia)}). Esos accesos no los había dado la app: sacale a mano ${m!.aManoAlFin!.join(", ")}.`,
    de: "Apicanta", contactoId: v.contactoId ?? null, persona: v.contactoNombre,
  })));
  if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  return vencidas.length;
}
