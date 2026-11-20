import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { pasarADownsell, resumenDeBaja } from "@/lib/baja-a-downsell-servidor";

/* ==================================================================
   Pasar a Downsell por falta de pago (lib/baja-a-downsell.ts; Lili, 20/11).
   POST { alumnoId, ensayo: true }: lo que va a pasar con cada downsell posible, sin tocar nada (el asistente lo muestra antes de confirmar).
   POST { alumnoId, programaId, motivo }: lo hace — la venta, sus cuotas, la ficha y los accesos — y avisa a Finanzas y al closer.
   Lo hace quien edita Alumnos (Customer Success, Finanzas, dueños) sobre un servicio que ve (se lee con SU sesión); la venta la
   escribe el servidor, porque Customer Success no edita ventas.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos"], 2, { cerrado: true, sinSoloLoSuyo: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { alumnoId?: unknown; ensayo?: unknown; programaId?: unknown; motivo?: unknown };
  const alumnoId = typeof b.alumnoId === "string" ? b.alumnoId : "";
  if (!alumnoId) return NextResponse.json({ error: "Falta el alumno." }, { status: 400 });
  const ve = await mia.from("alumnos").select("id").eq("id", alumnoId).maybeSingle();
  if (!ve.data) return NextResponse.json({ error: "No encuentro ese servicio (o tu cuenta no lo ve)." }, { status: 404 });
  try {
    if (b.ensayo === true) return NextResponse.json(await resumenDeBaja(db, alumnoId));
    const r = await pasarADownsell(db, {
      alumnoId, programaId: typeof b.programaId === "string" ? b.programaId : "", motivo: typeof b.motivo === "string" ? b.motivo : "",
      quien: correoDelPedido(peticion),
    });
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 400 });
  }
}
