import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { corregirPersonaEnLaBase, MailRepetido } from "@/lib/personas-servidor";

/* ==================================================================
   POST { contactoId, cambios: { nombre?, email?, telefono? } }: corrige el dato de la persona en el contacto, sus
   oportunidades, sus llamadas, sus ventas y su servicio (lib/personas-servidor.ts). Para quien edita Alumnos, Ventas, el
   CRM o Leads y ve a esa persona: la cuenta de Servicio no edita contactos y su corrección no llegaba a ningún lado.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["alumnos", "ventas", "crm", "leads"], 2, { cerrado: true, sinSoloLoSuyo: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { contactoId?: unknown; cambios?: Record<string, unknown> };
  const contactoId = typeof b.contactoId === "string" ? b.contactoId : "";
  const texto = (k: string) => (typeof b.cambios?.[k] === "string" ? String(b.cambios[k]).slice(0, 200) : undefined);
  const cambios = { nombre: texto("nombre"), email: texto("email"), telefono: texto("telefono") };
  if (!contactoId) return NextResponse.json({ error: "Falta la persona." }, { status: 400 });
  const ve = await mia.from("contactos").select("id").eq("id", contactoId).maybeSingle();
  if (!ve.data) return NextResponse.json({ error: "No encuentro a esa persona (o tu cuenta no la ve)." }, { status: 404 });
  try {
    return NextResponse.json({ ok: true, ...(await corregirPersonaEnLaBase(db, contactoId, cambios, correoDelPedido(peticion))) });
  } catch (e) {
    if (e instanceof MailRepetido) return NextResponse.json({ error: e.message }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo." }, { status: 500 });
  }
}
