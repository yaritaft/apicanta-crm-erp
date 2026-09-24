import { NextResponse } from "next/server";
import { firmaValida, tokenDeVerificacion } from "@/lib/meta-leads";
import { ingresarAvisosMeta, type AvisoLeadgen } from "@/lib/meta-leads-sync";

/* ==================================================================
   El webhook de los formularios de Meta.

   GET: Meta verifica la dirección cuando se activan los avisos (Ajustes →
   Integraciones): manda el token de verificación, que sale del App
   Secret, y hay que devolverle el desafío tal cual.

   POST: cada lead nuevo. Primero la firma (un HMAC del cuerpo con el App
   Secret): sin eso cualquiera podría meter leads. Después, por cada aviso
   se pide el lead a la API y se guarda (lib/meta-leads-sync.ts). Meta
   reintenta si no recibe un 200, así que un lead que falla una vez entra
   en el reintento; reingresar no duplica.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const q = new URL(peticion.url).searchParams;
  const esperado = tokenDeVerificacion();
  if (q.get("hub.mode") === "subscribe" && esperado && q.get("hub.verify_token") === esperado) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(peticion: Request) {
  const cuerpo = await peticion.text();
  if (!firmaValida(cuerpo, peticion.headers.get("x-hub-signature-256"))) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  let j: { object?: string; entry?: { changes?: { field?: string; value?: AvisoLeadgen }[] }[] };
  try { j = JSON.parse(cuerpo); } catch { return new NextResponse("Bad Request", { status: 400 }); }
  if (j.object !== "page") return NextResponse.json({ ok: true });

  const avisos = (j.entry ?? []).flatMap((e) => (e.changes ?? [])
    .filter((c) => c.field === "leadgen" && c.value)
    .map((c) => c.value!));
  if (avisos.length === 0) return NextResponse.json({ ok: true });

  const r = await ingresarAvisosMeta(avisos);
  if (r.errores.length) console.error("[meta/leads/webhook]", JSON.stringify(r.errores));
  /* Si no entró ninguno y hubo errores, 500: Meta reintenta más tarde. */
  const fallo = r.errores.length > 0 && r.inscripcionesNuevas === 0;
  return NextResponse.json({ ok: !fallo, nuevas: r.inscripcionesNuevas }, { status: fallo ? 500 : 200 });
}
