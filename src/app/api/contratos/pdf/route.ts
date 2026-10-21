import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { contratoPorId } from "@/lib/contratos-servidor";
import { pdfDocumento } from "@/lib/pandadoc-servidor";

/* GET ?id=: un link de 10 minutos al PDF del contrato (el firmado, guardado en el bucket privado; si todavía
   no se guardó, se baja de PandaDoc). Sólo para quien ve ese contrato (se lee con SU sesión). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ventas", "alumnos"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const id = new URL(peticion.url).searchParams.get("id") ?? "";
  const db = nubeServidor();
  const mia = baseDelPedido(peticion);
  if (!db || !mia || !id) return NextResponse.json({ error: "Falta qué contrato." }, { status: 400 });
  const ve = await mia.from("contratos").select("id").eq("id", id).maybeSingle();
  if (!ve.data) return NextResponse.json({ error: "No encuentro ese contrato (o tu cuenta no lo ve)." }, { status: 404 });
  const c = await contratoPorId(db, id);
  if (!c) return NextResponse.json({ error: "No encuentro ese contrato." }, { status: 404 });
  let ruta = c.pdfPath;
  if (!ruta) {
    if (!c.documentoId) return NextResponse.json({ error: "Este contrato no tiene documento." }, { status: 409 });
    try {
      const pdf = await pdfDocumento(c.modo, c.documentoId, c.estado === "firmado");
      ruta = `${c.id}${c.estado === "firmado" ? "" : "-borrador"}.pdf`;
      await db.storage.from("contratos").upload(ruta, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
      if (c.estado === "firmado") await db.from("contratos").update({ pdfPath: ruta }).eq("id", c.id);
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo bajar el PDF." }, { status: 502 });
    }
  }
  const s = await db.storage.from("contratos").createSignedUrl(ruta, 600);
  if (!s.data?.signedUrl) return NextResponse.json({ error: "No se pudo abrir el PDF." }, { status: 500 });
  return NextResponse.json({ url: s.data.signedUrl }, { headers: { "Cache-Control": "no-store" } });
}
