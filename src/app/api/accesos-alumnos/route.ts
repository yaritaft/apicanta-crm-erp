import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { darAccesos, mensajeDeBienvenida, quitarAccesos, type Plataforma } from "@/lib/accesos-servidor";
import { programasGuardados } from "@/lib/contratos-servidor";
import { programaPorId } from "@/lib/programas";

/* ==================================================================
   El onboarding y el outboarding a mano, desde el servicio del alumno
   (el Loom de Yari: «si falló algún onboarding automático, se lo podemos
   dar manual»; «el outboarding es fijate a qué tiene acceso y sacáselo»).
   POST { accion, alumnoId, … }:
   - "dar": { programa, solo? } da los accesos del programa (todos, o los de `solo`). Sirve para el upsell:
     se elige el programa nuevo y se suman sus accesos.
   - "quitar": { ids? } saca esos accesos (o todos). Siempre a mano.
   Lo hace quien edita Alumnos, sobre un servicio que ve (se lee con SU sesión).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos"], 2, { cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; alumnoId?: string; programa?: string; ids?: string[]; solo?: { plataforma: Plataforma; recurso: string }[] };
  const alumnoId = typeof b.alumnoId === "string" ? b.alumnoId : "";
  if (!alumnoId) return NextResponse.json({ error: "Falta el alumno." }, { status: 400 });
  const ve = await mia.from("alumnos").select("id").eq("id", alumnoId).maybeSingle();
  if (!ve.data) return NextResponse.json({ error: "No encuentro ese servicio (o tu cuenta no lo ve)." }, { status: 404 });
  const quien = correoDelPedido(peticion);

  try {
    if (b.accion === "quitar") {
      const r = await quitarAccesos(db, { alumnoId, ids: Array.isArray(b.ids) ? b.ids : undefined, quien });
      return NextResponse.json(r);
    }
    if (b.accion !== "dar") return NextResponse.json({ error: "No sé hacer eso." }, { status: 400 });
    const { programas } = await programasGuardados(db);
    const programa = programaPorId(programas, b.programa);
    if (!programa) return NextResponse.json({ error: "Elegí el programa." }, { status: 400 });
    const a = (await db.from("alumnos").select('id, nombre, email, "leadId"').eq("id", alumnoId).maybeSingle()).data as { nombre: string; email: string; leadId?: string } | null;
    if (!a?.email?.trim()) return NextResponse.json({ error: "El alumno no tiene mail: Wisboo y Zoom lo necesitan." }, { status: 400 });
    const seg = (await db.from("seguimiento_alumnos").select("telefono").eq("alumnoId", alumnoId).maybeSingle()).data as { telefono?: string } | null;
    const lead = a.leadId ? (await db.from("leads").select("telefono").eq("id", a.leadId).maybeSingle()).data as { telefono?: string } | null : null;
    const r = await darAccesos(db, {
      alumnoId, programa, origen: "manual", quien, solo: Array.isArray(b.solo) ? b.solo : undefined,
      persona: { nombre: a.nombre, email: a.email, telefono: seg?.telefono || lead?.telefono || "" },
    });
    return NextResponse.json({ ...r, mensaje: mensajeDeBienvenida(a.nombre, programa.nombre, r.links) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 500 });
  }
}
