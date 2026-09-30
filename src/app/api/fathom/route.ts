import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { exigirArea } from "@/lib/permisos-servidor";
import { borrarWebhook, crearWebhook, guardarGrabacion, hayApiFathom, reunionesDesde } from "@/lib/fathom-servidor";

/* ==================================================================
   Fathom, desde Ajustes → Integraciones.

   GET: cómo está (si hay clave, si el webhook está conectado, cuántas
   grabaciones llegaron y cuántas se ataron a su llamada).
   POST { accion }:
   - "conectar": crea el webhook en Fathom apuntando a /api/fathom/webhook
     y guarda su secreto en `fathom_conexion` (no pasa por el navegador).
   - "importar": trae una página de reuniones desde `desde` (y `cursor`
     para la siguiente); la pantalla sigue pidiendo hasta que no haya más.
   - "desconectar": borra el webhook de Fathom.
   Lo ve quien ve los Ajustes; lo cambia quien los edita.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/* Sólo para anotar quién conectó: el pedido ya pasó por la base con esa sesión. */
function correoDe(peticion: Request): string | null {
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  try {
    const cuerpo = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string };
    return cuerpo.email ?? null;
  } catch { return null; }
}

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 1);
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ clave: hayApiFathom(), conectado: false, grabaciones: 0, atadas: 0 });
  const [c, total, atadas, ultima] = await Promise.all([
    db.from("fathom_conexion").select("url, paraElEquipo, conectadoEn, conectadoPor").eq("id", 1).maybeSingle(),
    db.from("grabaciones").select("id", { count: "exact", head: true }),
    db.from("grabaciones").select("id", { count: "exact", head: true }).not("sesionId", "is", null),
    db.from("grabaciones").select("creadoEn").order("creadoEn", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const faltaTabla = [c, total].some((r) => r.error && /grabaciones|fathom_conexion|PGRST205|42P01/.test(`${r.error.code} ${r.error.message}`));
  const con = c.data as { url?: string; paraElEquipo?: boolean; conectadoEn?: string; conectadoPor?: string } | null;
  return NextResponse.json({
    clave: hayApiFathom(),
    tablas: !faltaTabla,
    conectado: Boolean(con) || Boolean(process.env.FATHOM_WEBHOOK_SECRET),
    aMano: !con && Boolean(process.env.FATHOM_WEBHOOK_SECRET),
    paraElEquipo: con?.paraElEquipo ?? false,
    conectadoEn: con?.conectadoEn ?? null,
    conectadoPor: con?.conectadoPor ?? null,
    grabaciones: total.count ?? 0,
    atadas: atadas.count ?? 0,
    ultima: (ultima.data as { creadoEn?: string } | null)?.creadoEn ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 2);
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  if (!hayApiFathom()) return NextResponse.json({ error: "Falta FATHOM_API_KEY en Vercel." }, { status: 503 });
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; desde?: string; cursor?: string };

  try {
    if (b.accion === "conectar") {
      const ya = await db.from("fathom_conexion").select("id").eq("id", 1).maybeSingle();
      if (ya.data) return NextResponse.json({ ok: true, yaEstaba: true });
      const destino = `${new URL(peticion.url).origin}/api/fathom/webhook`;
      const w = await crearWebhook(destino);
      const r = await db.from("fathom_conexion").upsert({
        id: 1, webhookId: w.id, secreto: w.secreto, url: destino, paraElEquipo: w.paraElEquipo,
        conectadoEn: new Date().toISOString(), conectadoPor: correoDe(peticion),
      });
      if (r.error) {
        /* Sin dónde guardar el secreto el webhook no sirve: se borra en Fathom. */
        await borrarWebhook(w.id).catch(() => undefined);
        return NextResponse.json({ error: `No se pudo guardar la conexión: ${r.error.message}` }, { status: 500 });
      }
      return NextResponse.json({ ok: true, paraElEquipo: w.paraElEquipo });
    }

    if (b.accion === "desconectar") {
      const c = await db.from("fathom_conexion").select("webhookId").eq("id", 1).maybeSingle();
      const id = (c.data as { webhookId?: string } | null)?.webhookId;
      if (id) await borrarWebhook(id);
      await db.from("fathom_conexion").delete().eq("id", 1);
      return NextResponse.json({ ok: true });
    }

    if (b.accion === "importar") {
      const desde = b.desde && !Number.isNaN(Date.parse(b.desde)) ? new Date(b.desde).toISOString()
        : new Date(Date.now() - 90 * 86_400_000).toISOString();
      const pagina = await reunionesDesde(desde, b.cursor ?? null);
      let guardadas = 0, atadas = 0;
      for (const item of pagina.items) {
        const r = await guardarGrabacion(db, item);
        if (r.ok) guardadas++;
        if (r.sesionId) atadas++;
      }
      return NextResponse.json({ ok: true, guardadas, atadas, siguiente: pagina.siguiente });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo hablar con Fathom." }, { status: 502 });
  }
  return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
}
