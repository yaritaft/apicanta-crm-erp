import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { quitarAccesos } from "./accesos-servidor";
import { finDelPrograma, listasCs, seguimientoCompleto } from "./clientes-cs";
import { diaDeNegocio } from "./dia-negocio";
import { configSeguimiento, hoyDelNegocio } from "./seguimiento";
import { esOutboarding, tocaOutboarding } from "./outboarding";
import type { SeguimientoAlumno } from "./types";

/* ==================================================================
   La pasada del outboarding automático (lib/outboarding.ts): a quien está en
   Outboarding y ya terminó su programa se le sacan los accesos que dio la app
   (quitarAccesos, lo mismo que «Quitar todo» en la ficha), y Customer Success
   recibe un aviso en la campanita con lo que se sacó y lo que no se pudo.

   Sólo mira a los alumnos que todavía tienen algún acceso de la app: los de
   antes (los grupos y cursos que se daban a mano) no están en accesos_alumno
   y se siguen sacando a mano. La corre api/cron/contratos (a las :25).
   ================================================================== */

type Quitar = typeof quitarAccesos;

export interface PasadaOutboarding {
  /* Alumnos con algún acceso de la app vigente. */
  conAccesos: number;
  /* En outboarding, esperando el fin de su programa. */
  esperan: number;
  /* A los que se les sacó (aunque algo haya fallado). */
  hechos: { alumnoId: string; quitados: number; fallaron: number }[];
}

const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

export async function pasarOutboardings(db: SupabaseClient, ahora = new Date(), quitar: Quitar = quitarAccesos): Promise<PasadaOutboarding> {
  const hoy = hoyDelNegocio(ahora);
  const salida: PasadaOutboarding = { conAccesos: 0, esperan: 0, hechos: [] };
  const acc = await db.from("accesos_alumno").select("alumnoId").in("estado", ["pendiente", "dado", "entro"]);
  if (acc.error) throw new Error(`accesos_alumno: ${acc.error.message}`);
  const ids = [...new Set(((acc.data ?? []) as { alumnoId: string }[]).map((x) => x.alumnoId).filter(Boolean))];
  salida.conAccesos = ids.length;
  if (!ids.length) return salida;

  const segs = await db.from("seguimiento_alumnos").select("*").in("alumnoId", ids);
  if (segs.error) throw new Error(`seguimiento_alumnos: ${segs.error.message}`);
  const enOutboarding = ((segs.data ?? []) as SeguimientoAlumno[]).filter((s) => esOutboarding(s.followUp));
  if (!enOutboarding.length) return salida;

  const aj = await db.from("ajustes").select("seguimiento").eq("id", 1).maybeSingle();
  const ajSeg = (aj.data as { seguimiento?: unknown } | null)?.seguimiento as Parameters<typeof configSeguimiento>[0];
  const cfg = configSeguimiento(ajSeg);
  const lista = listasCs(cfg).programas;
  const al = await db.from("alumnos").select("id, nombre, inicio, plan, ventaId, leadId").in("id", enOutboarding.map((s) => s.alumnoId));
  const alumnos = new Map(((al.data ?? []) as { id: string; nombre: string; inicio: string | null; plan: string | null; ventaId: string | null; leadId: string | null }[]).map((a) => [a.id, a] as const));
  const ventaIds = [...alumnos.values()].map((a) => a.ventaId).filter((x): x is string => Boolean(x));
  const ventas = ventaIds.length ? await db.from("ventas").select("id, productoId").in("id", ventaIds) : { data: [] };
  const productoDeVenta = new Map(((ventas.data ?? []) as { id: string; productoId: string | null }[]).map((v) => [v.id, v.productoId] as const));
  const prods = await db.from("productos").select("id, nombre");
  const nombreDeProducto = new Map(((prods.data ?? []) as { id: string; nombre: string }[]).map((p) => [p.id, p.nombre] as const));

  for (const s0 of enOutboarding) {
    const a = alumnos.get(s0.alumnoId);
    if (!a) continue;
    const seg = seguimientoCompleto(s0, cfg);
    const producto = (a.ventaId ? nombreDeProducto.get(productoDeVenta.get(a.ventaId) ?? "") : undefined) ?? "";
    const fin = finDelPrograma(diaDeNegocio(a.inicio) || "", seg, producto || a.plan || "", lista);
    if (!tocaOutboarding(seg.followUp, fin, hoy)) { salida.esperan++; continue; }
    try {
      const r = await quitar(db, { alumnoId: a.id, quien: "Outboarding automático" });
      salida.hechos.push({ alumnoId: a.id, quitados: r.quitados, fallaron: r.fallaron });
      if (r.quitados + r.fallaron > 0) await avisarAServicio(db, a, fin, r.quitados, r.accesos.filter((x) => x.error).map((x) => x.recursoNombre || x.recurso), seg.otrosMails);
    } catch (e) {
      console.error("[outboarding]", a.id, e instanceof Error ? e.message : String(e));
    }
  }
  return salida;
}

/* El aviso a Customer Success (como el del roadmap, lib/contratos-servidor.ts): uno por alumno y por día. */
async function avisarAServicio(
  db: SupabaseClient, a: { id: string; nombre: string; leadId: string | null }, fin: string | null, quitados: number, fallaron: string[], otrosMails: readonly string[] = [],
): Promise<void> {
  try {
    const r = await db.from("equipo").select("email").eq("activo", true)
      .or("puesto.ilike.%customer success%,puesto.ilike.%servicio%,puesto.ilike.%csm%");
    const dia = hoyDelNegocio();
    const partes = [
      `Está en Outboarding${fin ? ` y su programa terminó el ${ddmm(fin)}` : ""}: se le ${quitados === 1 ? "sacó 1 acceso" : `sacaron ${quitados} accesos`} (Wisboo, Telegram y Zoom).`,
      fallaron.length ? `No se pudo sacar: ${fallaron.join(", ")}. Hacelo a mano desde su ficha → Servicio → Accesos.` : "",
      /* Lili, 28/10: los viejos entran a Wisboo con un mail y a Zoom con otro. */
      otrosMails.length ? `Además de su mail principal usa ${otrosMails.join(", ")}: revisá que no le quede acceso con ninguno.` : "",
    ];
    const filas = ((r.data ?? []) as { email: string | null }[]).filter((x) => x.email?.trim()).map((x) => ({
      id: `av_outboarding_${a.id}_${dia}_${createHash("sha1").update(x.email!.trim().toLowerCase()).digest("hex").slice(0, 10)}`,
      para: x.email!.trim().toLowerCase(), tipo: "outboarding",
      titulo: fallaron.length ? `Outboarding de ${a.nombre}: falta sacar algo a mano` : `Le sacamos los accesos a ${a.nombre}`,
      cuerpo: partes.filter(Boolean).join(" "), de: "Apicanta", contactoId: a.leadId ?? a.id, persona: a.nombre || null,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (err) { console.error("[outboarding] no se pudo avisar", err instanceof Error ? err.message : String(err)); }
}
