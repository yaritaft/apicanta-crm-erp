import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, exigirArea } from "@/lib/permisos-servidor";

/* ==================================================================
   POST { quedaId, otroId, corregirPersona }: une dos alumnos que son la misma persona (lib/alumnos-repetidos.ts). Queda
   el que ya estaba con lo de Servicio; se lleva la venta del otro y, con corregirPersona, la persona de esa venta toma su
   nombre y su mail (el closer los cargó mal). Todo en una transacción de la base (supabase/unificar-alumnos.sql).
   Lo hace quien edita Alumnos, sobre dos alumnos que ve.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos"], 2, { cerrado: true, sinSoloLoSuyo: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { quedaId?: unknown; otroId?: unknown; corregirPersona?: unknown };
  const quedaId = typeof b.quedaId === "string" ? b.quedaId : "";
  const otroId = typeof b.otroId === "string" ? b.otroId : "";
  if (!quedaId || !otroId || quedaId === otroId) return NextResponse.json({ error: "Faltan los dos alumnos." }, { status: 400 });
  const ve = await mia.from("alumnos").select("id").in("id", [quedaId, otroId]);
  if ((ve.data ?? []).length !== 2) return NextResponse.json({ error: "No encuentro esos alumnos (o tu cuenta no los ve)." }, { status: 404 });
  const r = await db.rpc("unificar_alumnos", { p_queda: quedaId, p_otro: otroId, p_corregir_persona: b.corregirPersona === true, p_quien: correoDelPedido(peticion) });
  if (r.error) return NextResponse.json({ error: r.error.message.replace(/^.*?: /, "") }, { status: 400 });
  return NextResponse.json({ ok: true, ...(r.data as Record<string, unknown>) });
}
