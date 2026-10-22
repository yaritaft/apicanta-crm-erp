import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { noSonLaMismaPersona, separarEnLaBase, unificarEnLaBase } from "@/lib/duplicados-servidor";

/* ==================================================================
   Dos fichas de la misma persona (lib/duplicados.ts).
   POST { accion, principalId, otroId }:
   - "unificar": todo lo de `otroId` pasa a `principalId` y su mail queda como otro mail;
   - "separar": deshace una unificación;
   - "no-son": mismo teléfono, otra gente; el par no se vuelve a proponer.
   Lo hace quien edita Alumnos, Ventas, el CRM o Leads (no el closer, que ve sólo lo suyo), sobre dos fichas que ve
   (se leen con SU sesión). Escribe la clave de servicio: la cuenta de servicio no edita oportunidades ni llamadas.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos", "ventas", "crm", "leads"], 2, { cerrado: true, sinSoloLoSuyo: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; principalId?: unknown; otroId?: unknown };
  const principalId = typeof b.principalId === "string" ? b.principalId : "";
  const otroId = typeof b.otroId === "string" ? b.otroId : "";
  if (!principalId || !otroId || principalId === otroId) return NextResponse.json({ error: "Faltan las dos fichas." }, { status: 400 });

  /* Las dos tienen que verse con la sesión de quien pide (al separar, la otra todavía no existe). */
  const ids = b.accion === "separar" ? [principalId] : [principalId, otroId];
  const ve = await mia.from("contactos").select("id").in("id", ids);
  if (ve.error) return NextResponse.json({ error: "No pude comprobar las fichas, probá de nuevo." }, { status: 503 });
  if ((ve.data ?? []).length !== ids.length) return NextResponse.json({ error: "No encuentro esas fichas (o tu cuenta no las ve)." }, { status: 404 });

  const quien = correoDelPedido(peticion);
  try {
    if (b.accion === "unificar") return NextResponse.json({ ok: true, plan: await unificarEnLaBase(db, principalId, otroId, quien) });
    if (b.accion === "separar") return NextResponse.json({ ok: true, plan: await separarEnLaBase(db, principalId, otroId, quien) });
    if (b.accion === "no-son") return NextResponse.json({ ok: true, contactos: await noSonLaMismaPersona(db, principalId, otroId, quien) });
    return NextResponse.json({ error: "No sé hacer eso." }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 500 });
  }
}
