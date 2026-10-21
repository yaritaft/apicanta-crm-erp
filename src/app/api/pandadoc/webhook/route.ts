import { NextResponse, after } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { leerAvisos, type ModoContrato } from "@/lib/contratos";
import { firmaPandadocValida } from "@/lib/pandadoc-servidor";
import { contratoDeAfuera, contratoPorDocumento, contratoPorId, sincronizar } from "@/lib/contratos-servidor";

/* ==================================================================
   POST /api/pandadoc/webhook — el aviso de PandaDoc cuando a un contrato
   le pasa algo (se mandó, lo abrió, lo firmó, lo rechazó, se anuló).

   - La firma (HMAC-SHA256 del cuerpo CRUDO, en ?signature=) se verifica
     ANTES de leer nada, con la clave de cada suscripción (producción y
     prueba): sin ella cualquiera podría mandar «este contrato se firmó» y
     darle accesos a quien no firmó. La clave que valida dice el modo.
   - Cada aviso se procesa una vez (X-PandaDoc-Webhook-Event-Id).
   - No se le cree al aviso: se le vuelve a preguntar el estado al
     documento (llegan desordenados o repetidos). El trabajo pesado (el PDF,
     los accesos) va después de contestar, en `after()`: PandaDoc espera
     respuesta en 20 s. Si algo falla, la pasada de cada hora lo retoma.
   - Un documento que no salió de la app (Lili lo mandó a mano) se anota si
     es de la plantilla de un programa.
   GET: «¿estás listo?» (sólo ok y si hay una suscripción conectada).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function claves(db: NonNullable<ReturnType<typeof nubeServidor>>): Promise<{ modo: ModoContrato; clave: string }[]> {
  const r = await db.from("pandadoc_conexion").select("modo, clave");
  return ((r.data ?? []) as { modo: ModoContrato; clave: string | null }[])
    .filter((x) => x.clave).map((x) => ({ modo: x.modo, clave: x.clave! }));
}

/* «¿Estás listo?», como los demás webhooks: sólo ok y si hay alguna suscripción con su clave. */
export async function GET() {
  const db = nubeServidor();
  const listo = db ? (await claves(db).catch(() => [])).length > 0 : false;
  return NextResponse.json({ ok: true, listo });
}

export async function POST(peticion: Request) {
  const crudo = await peticion.text();
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false }, { status: 503 });
  const firma = new URL(peticion.url).searchParams.get("signature");
  const ks = await claves(db);
  const valida = ks.find((k) => firmaPandadocValida(crudo, firma, [k.clave]));
  if (!valida) return NextResponse.json({ ok: false, motivo: "firma inválida" }, { status: 403 });

  let cuerpo: unknown;
  try { cuerpo = JSON.parse(crudo); } catch { return NextResponse.json({ ok: false, motivo: "cuerpo ilegible" }, { status: 400 }); }
  const avisos = leerAvisos(cuerpo);

  /* Una vez por aviso. Si el id no viene, se arma con el documento y su estado. */
  const idEvento = peticion.headers.get("x-pandadoc-webhook-event-id")
    ?? `${avisos.map((a) => `${a.documentoId}:${a.evento}:${a.estado}`).join("|")}`;
  const ya = await db.from("pandadoc_avisos").insert({ id: idEvento.slice(0, 300), documento: avisos[0]?.documentoId ?? null, estado: avisos[0]?.estado ?? null });
  if (ya.error && ya.error.code === "23505") return NextResponse.json({ ok: true, repetido: true });

  after(async () => {
    for (const a of avisos) {
      try {
        let c = await contratoPorDocumento(db, a.documentoId);
        if (!c && a.metadata.apicanta_contrato) c = await contratoPorId(db, a.metadata.apicanta_contrato);
        if (!c) c = await contratoDeAfuera(db, a.documentoId, valida.modo);
        if (!c) continue;
        if (!c.documentoId) await db.from("contratos").update({ documentoId: a.documentoId }).eq("id", c.id);
        await sincronizar(db, { ...c, documentoId: c.documentoId ?? a.documentoId }, "pandadoc");
      } catch (e) {
        console.error("[pandadoc] aviso", a.documentoId, a.evento, e instanceof Error ? e.message : String(e));
      }
    }
  });
  return NextResponse.json({ ok: true, avisos: avisos.length });
}
