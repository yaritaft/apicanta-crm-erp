import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import { mailsDeServicio } from "./outboarding-servidor";
import { esVentaDeBaja, sinAccesosPorLaBaja } from "./contratos-de-baja";
import type { Contrato } from "./contratos";

/* ==================================================================
   Al firmar un contrato (y en «Dar los accesos»): si su venta ya está cancelada o reembolsada y la persona no tiene otra
   venta activa, no se dan accesos ni sale la bienvenida, y Customer Success se entera (Liliana, 27/11; la regla:
   lib/contratos-de-baja.ts). Aparte de contratos-de-baja-servidor.ts para que contratos-servidor.ts lo use sin ida y vuelta.
   ================================================================== */

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** ¿Tiene la persona otra venta activa? Si la tiene, su servicio pasó a esa venta (lib/store.ts → efectoDeBaja). */
export async function tieneOtraVentaActiva(db: SupabaseClient, venta: { id: string; contactoId: string | null }): Promise<boolean> {
  if (!venta.contactoId) return false;
  const r = await db.from("ventas").select("id").eq("contactoId", venta.contactoId).eq("estado", "activa").neq("id", venta.id).limit(1);
  if (r.error) throw new Error(`ventas: ${r.error.message}`);
  return (r.data ?? []).length > 0;
}

/** Si la venta del contrato está cancelada o reembolsada (y la persona no tiene otra activa), por qué no se dan sus accesos. null si se pueden. */
export async function bajaQueFrena(db: SupabaseClient, c: Pick<Contrato, "ventaId">, alumnoId: string | null): Promise<string | null> {
  try {
    let ventaId = c.ventaId ?? null;
    if (!ventaId && alumnoId) ventaId = ((await db.from("alumnos").select("ventaId").eq("id", alumnoId).maybeSingle()).data as { ventaId?: string | null } | null)?.ventaId ?? null;
    if (!ventaId) return null;
    const venta = (await db.from("ventas").select('id, estado, "contactoId"').eq("id", ventaId).maybeSingle()).data as { id: string; estado: string; contactoId: string | null } | null;
    if (!venta || !esVentaDeBaja(venta.estado)) return null;
    return sinAccesosPorLaBaja(venta, await tieneOtraVentaActiva(db, venta));
  } catch (e) {
    /* Si no se pudo mirar, no se frena: es lo que pasaba antes y la pasada de cada hora vuelve a mirar la baja. */
    console.error("[baja de venta] no se pudo mirar la venta del contrato", mensajeDe(e));
    return null;
  }
}

/** Firmó el contrato de una venta que ya estaba de baja: no se le dio nada; Customer Success se entera (una vez por contrato). */
export async function avisarFirmaDeBaja(db: SupabaseClient, c: Pick<Contrato, "id" | "leadId" | "alumnoId" | "destinatario" | "plantillaNombre">, motivo: string): Promise<void> {
  try {
    const nombre = c.destinatario?.nombre?.trim() || "Alguien";
    const filas = (await mailsDeServicio(db)).map((para) => ({
      id: `av_firmabaja_${c.id}_${createHash("sha1").update(para).digest("hex").slice(0, 10)}`,
      para, tipo: "outboarding",
      titulo: `${nombre} firmó un contrato de una venta dada de baja`,
      cuerpo: `Firmó ${c.plantillaNombre || "su contrato"}, pero su venta ya estaba dada de baja: no le dimos accesos ni le mandamos la bienvenida. ${motivo.replace(/^La venta está [a-z]+: no se dan los accesos\. /, "")}`.trim(),
      de: "Apicanta", contactoId: c.leadId ?? c.alumnoId ?? null, persona: nombre,
    }));
    if (filas.length) await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
  } catch (e) {
    console.error("[baja de venta] no se pudo avisar la firma", c.id, mensajeDe(e));
  }
}
