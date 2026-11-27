import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { quitarAccesos } from "./accesos-servidor";
import { anular, evento, programasGuardados } from "./contratos-servidor";
import { ErrorPandadoc } from "./pandadoc-servidor";
import { mailsDeServicio } from "./outboarding-servidor";
import { programaPorId } from "./programas";
import {
  avisoDeLaBaja, avisoParaQuienDioDeBaja, CLAVE_SALIDA_POR_BAJA, contratoAnulable, DESDE_BAJAS_AUTOMATICAS, esVentaDeBaja, motivoDeLaBaja,
  nuncaSalio, type SalidaPorBaja,
} from "./contratos-de-baja";
import type { Contrato } from "./contratos";
import { tieneOtraVentaActiva } from "./ventas-de-baja-servidor";

/* ==================================================================
   La baja de una venta del lado del servidor (la regla y por qué: lib/contratos-de-baja.ts; Liliana, 27/11).

   salidaPorBaja: para una venta cancelada o reembolsada sin otra venta activa de la misma persona, anula en PandaDoc los
   contratos que no firmó, le saca los accesos que dio la app (una vez) y le avisa a Customer Success. La llaman
   /api/contratos/baja (apenas se da de baja, desde la pantalla) y la pasada de cada hora (api/cron/contratos).

   Lo que se mira al firmar (bajaQueFrena) está en lib/ventas-de-baja-servidor.ts: lo usa contratos-servidor.ts.
   ================================================================== */

type Anular = typeof anular;
type Quitar = typeof quitarAccesos;

const VIGENTES = ["pendiente", "dado", "entro"];
const PLATAFORMAS = [["wisboo", "Wisboo"], ["telegram", "Telegram"], ["zoom", "Zoom"]] as const;
const nombreDe = (p: string) => PLATAFORMAS.find(([id]) => id === p)?.[1] ?? p;
const ahoraIso = () => new Date().toISOString();
const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface VentaFila { id: string; estado: string; contactoId: string | null; contactoNombre: string | null; extra: Record<string, unknown> | null }
interface AlumnoFila { id: string; nombre: string | null; ventaId: string | null; leadId: string | null }

export interface ResultadoBaja {
  ventaId: string;
  /* La persona tiene otra venta activa: su servicio sigue con esa y no se tocó nada. */
  otraVentaActiva: boolean;
  anulados: string[];
  noAnulados: { id: string; error: string }[];
  quitados: number;
  fallaron: number;
  /* Si a Customer Success le llegó el aviso. */
  avisado: boolean;
  /* Lo que se le cuenta a quien la dio de baja (null: no había nada que hacer). */
  aviso: { texto: string; error: boolean } | null;
}

/** El alumno de la venta: el que la tiene enlazada o el que salió del mismo lead (como lib/alumnos.ts → alumnoDeVenta). */
async function alumnoDeLaVenta(db: SupabaseClient, venta: Pick<VentaFila, "id" | "contactoId">): Promise<AlumnoFila | null> {
  const porVenta = await db.from("alumnos").select('id, nombre, "ventaId", "leadId"').eq("ventaId", venta.id).limit(1);
  if (porVenta.error) throw new Error(`alumnos: ${porVenta.error.message}`);
  const directo = ((porVenta.data ?? []) as AlumnoFila[])[0];
  if (directo || !venta.contactoId) return directo ?? null;
  const porLead = await db.from("alumnos").select('id, nombre, "ventaId", "leadId"').eq("leadId", venta.contactoId).limit(1);
  if (porLead.error) throw new Error(`alumnos: ${porLead.error.message}`);
  return ((porLead.data ?? []) as AlumnoFila[])[0] ?? null;
}

/** Los contratos que todavía se pueden firmar de esa venta (y si no firmó ninguno). También los que no se ataron a ninguna venta (mandados a mano desde
    PandaDoc) pero son de esa persona y salieron antes de la baja: uno posterior puede ser de una compra nueva que todavía no se cargó. */
async function contratosDeLaVenta(db: SupabaseClient, venta: VentaFila, alumno: AlumnoFila | null): Promise<{ abiertos: Contrato[]; sinFirmar: boolean }> {
  const r = await db.from("contratos").select("*").eq("ventaId", venta.id);
  if (r.error) throw new Error(`contratos: ${r.error.message}`);
  const propios = (r.data ?? []) as Contrato[];
  /* Tenía contrato y no firmó ninguno: por la app no pudo recibir accesos. */
  const sinFirmar = propios.length > 0 && !propios.some((c) => c.estado === "firmado");
  const baja = typeof venta.extra?.bajaEn === "string" ? venta.extra.bajaEn : null;
  const sueltos: Contrato[] = [];
  const ids = [alumno?.id && `alumnoId.eq.${alumno.id}`, venta.contactoId && `leadId.eq.${venta.contactoId}`].filter(Boolean).join(",");
  if (baja && ids) {
    const s = await db.from("contratos").select("*").is("ventaId", null).or(ids);
    if (s.error) throw new Error(`contratos: ${s.error.message}`);
    sueltos.push(...((s.data ?? []) as Contrato[]).filter((c) => c.creadoEn <= baja));
  }
  const abiertos = [...propios, ...sueltos.filter((c) => !propios.some((p) => p.id === c.id))].filter((c) => contratoAnulable(c.estado));
  return { abiertos, sinFirmar };
}

/** Anula uno: en PandaDoc y en la app. Si PandaDoc no lo deja y nunca le llegó al alumno (o PandaDoc ya no lo tiene), alcanza con la app. */
async function anularUno(db: SupabaseClient, c: Contrato, motivo: string, quien: string, anularFn: Anular): Promise<string | null> {
  try {
    await anularFn(db, c, motivo, quien);
    return null;
  } catch (e) {
    const yaNoEsta = e instanceof ErrorPandadoc && e.status === 404;
    if (!yaNoEsta && !nuncaSalio(c.estado)) return mensajeDe(e);
    const up = await db.from("contratos").update({ estado: "anulado", anuladoEn: ahoraIso(), enlace: null, actualizadoEn: ahoraIso() }).eq("id", c.id);
    if (up.error) return up.error.message;
    await evento(db, c.id, "anulado", quien, "app", { motivo, nota: yaNoEsta ? "PandaDoc ya no lo tenía." : "No había salido de PandaDoc." });
    return null;
  }
}

/* Lo hecho queda en la venta (se relee justo antes: otro proceso pudo tocar su `extra`). */
async function anotarEnLaVenta(db: SupabaseClient, ventaId: string, salida: SalidaPorBaja): Promise<void> {
  const r = await db.from("ventas").select("extra").eq("id", ventaId).maybeSingle();
  const extra = ((r.data as { extra?: Record<string, unknown> } | null)?.extra ?? {}) as Record<string, unknown>;
  const up = await db.from("ventas").update({ extra: { ...extra, [CLAVE_SALIDA_POR_BAJA]: salida } }).eq("id", ventaId);
  if (up.error) throw new Error(`no se anotó en la venta: ${up.error.message}`);
}

export async function salidaPorBaja(
  db: SupabaseClient, ventaId: string, opciones: { quien: string; anularFn?: Anular; quitarFn?: Quitar } ,
): Promise<ResultadoBaja | null> {
  const anularFn = opciones.anularFn ?? anular;
  const quitarFn = opciones.quitarFn ?? quitarAccesos;
  const v = await db.from("ventas").select('id, estado, "contactoId", "contactoNombre", extra').eq("id", ventaId).maybeSingle();
  if (v.error) throw new Error(`ventas: ${v.error.message}`);
  const venta = v.data as VentaFila | null;
  if (!venta || !esVentaDeBaja(venta.estado)) return null;
  const salida: ResultadoBaja = { ventaId, otraVentaActiva: false, anulados: [], noAnulados: [], quitados: 0, fallaron: 0, avisado: false, aviso: null };
  if (await tieneOtraVentaActiva(db, venta)) return { ...salida, otraVentaActiva: true };

  const motivo = motivoDeLaBaja(venta.estado);
  const alumno = await alumnoDeLaVenta(db, venta);
  const { programas } = await programasGuardados(db);
  const programaDe = (c: Contrato) => programaPorId(programas, c.programa)?.nombre ?? c.plantillaNombre ?? c.programa;

  /* 1. Los contratos sin firmar: anulados (cada vez que pasa, por si salió uno después). */
  const anuladosProgramas: string[] = [];
  const noAnuladosProgramas: string[] = [];
  const { abiertos, sinFirmar } = await contratosDeLaVenta(db, venta, alumno);
  for (const c of abiertos) {
    const error = await anularUno(db, c, motivo, opciones.quien, anularFn);
    if (error) { salida.noAnulados.push({ id: c.id, error }); noAnuladosProgramas.push(programaDe(c)); }
    else { salida.anulados.push(c.id); anuladosProgramas.push(programaDe(c)); }
  }

  /* 2. Los accesos de la app: una sola vez por baja. */
  const previa = venta.extra?.[CLAVE_SALIDA_POR_BAJA] as SalidaPorBaja | undefined;
  let accesos: Parameters<typeof avisoDeLaBaja>[0]["accesos"] = null;
  const nombre = alumno?.nombre || venta.contactoNombre || "la persona";
  if (!previa && alumno) {
    const acc = await db.from("accesos_alumno").select("id").eq("alumnoId", alumno.id).in("estado", VIGENTES);
    if (acc.error) throw new Error(`accesos_alumno: ${acc.error.message}`);
    const teniaDeLaApp = (acc.data ?? []).length > 0;
    let plataformas: string[] = [], aMano: string[] = [], fallaron: string[] = [];
    if (teniaDeLaApp) {
      const r = await quitarFn(db, { alumnoId: alumno.id, quien: `${motivo} (${opciones.quien})` });
      salida.quitados = r.quitados;
      salida.fallaron = r.fallaron;
      const deLaApp = new Set(r.accesos.map((x) => x.plataforma));
      plataformas = [...new Set(r.accesos.filter((x) => !x.error && x.estado === "quitado").map((x) => nombreDe(x.plataforma)))];
      aMano = PLATAFORMAS.filter(([id]) => !deLaApp.has(id)).map(([, n]) => n);
      fallaron = r.accesos.filter((x) => x.error).map((x) => x.recursoNombre || x.recurso);
    }
    accesos = { quitados: salida.quitados, plataformas, aMano, fallaron, teniaDeLaApp };
    await anotarEnLaVenta(db, venta.id, { en: ahoraIso(), estado: venta.estado, quitados: plataformas, aMano, fallaron, contratos: anuladosProgramas });
  } else if (!previa) {
    await anotarEnLaVenta(db, venta.id, { en: ahoraIso(), estado: venta.estado, quitados: [], aMano: [], fallaron: [], contratos: anuladosProgramas });
  }

  /* 3. El aviso a Customer Success y la historia de la venta. */
  const aviso = avisoDeLaBaja({ nombre, estado: venta.estado, anulados: anuladosProgramas, noAnulados: noAnuladosProgramas, accesos, sinFirmar });
  if (aviso) {
    salida.avisado = await avisar(db, { ventaId: venta.id, contactoId: alumno?.leadId ?? venta.contactoId ?? alumno?.id ?? null, nombre, ...aviso });
    const hecho = [
      anuladosProgramas.length ? `se anuló su contrato sin firmar (${anuladosProgramas.join(", ")})` : "",
      salida.quitados ? `se ${salida.quitados === 1 ? "sacó 1 acceso" : `sacaron ${salida.quitados} accesos`} de la app` : "",
    ].filter(Boolean);
    if (hecho.length) {
      await db.from("actividad").insert({
        id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`, accion: "actualizo", actor: "Baja automática",
        entidad: "transaccion", entidadId: venta.id, titulo: nombre, fecha: ahoraIso(), detalle: `${motivo}: ${hecho.join(" y ")}.`,
      });
    }
  }
  salida.aviso = avisoParaQuienDioDeBaja({ anulados: salida.anulados.length, noAnulados: salida.noAnulados.length, quitados: salida.quitados, fallaron: salida.fallaron, avisado: salida.avisado });
  return salida;
}

/* A Customer Success: uno por cosa contada (si la pasada vuelve a correr con lo mismo, no se repite). */
async function avisar(db: SupabaseClient, a: { ventaId: string; contactoId: string | null; nombre: string; titulo: string; cuerpo: string }): Promise<boolean> {
  try {
    const filas = (await mailsDeServicio(db)).map((para) => ({
      id: `av_bajaventa_${a.ventaId}_${createHash("sha1").update(`${para}|${a.titulo}|${a.cuerpo}`).digest("hex").slice(0, 12)}`,
      para, tipo: "outboarding", titulo: a.titulo, cuerpo: a.cuerpo, de: "Apicanta", contactoId: a.contactoId, persona: a.nombre || null,
    }));
    if (!filas.length) return false;
    const r = await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
    if (r.error) throw new Error(r.error.message);
    return true;
  } catch (e) {
    console.error("[baja de venta] no se pudo avisar", a.ventaId, mensajeDe(e));
    return false;
  }
}

/** La pasada de cada hora: las ventas dadas de baja desde el arranque (y del último mes) que todavía tengan algo que hacer. */
export async function pasarBajasDeVentas(db: SupabaseClient, ahora = new Date(), deps: { anularFn?: Anular; quitarFn?: Quitar } = {}): Promise<{ revisadas: number; hechas: ResultadoBaja[] }> {
  const mes = new Date(ahora.getTime() - 31 * 24 * 3600 * 1000).toISOString();
  const desde = mes > DESDE_BAJAS_AUTOMATICAS ? mes : DESDE_BAJAS_AUTOMATICAS;
  const r = await db.from("ventas").select("id").in("estado", ["cancelada", "reembolsada"]).gte("extra->>bajaEn", desde);
  if (r.error) throw new Error(`ventas: ${r.error.message}`);
  const ids = ((r.data ?? []) as { id: string }[]).map((x) => x.id);
  const hechas: ResultadoBaja[] = [];
  for (const id of ids) {
    try {
      const x = await salidaPorBaja(db, id, { quien: "pasada de cada hora", ...deps });
      if (x && (x.anulados.length || x.noAnulados.length || x.quitados || x.fallaron || x.avisado)) hechas.push(x);
    } catch (e) {
      console.error("[baja de venta]", id, mensajeDe(e));
    }
  }
  return { revisadas: ids.length, hechas };
}
