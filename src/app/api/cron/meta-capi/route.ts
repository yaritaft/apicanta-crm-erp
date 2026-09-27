import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { capiConfigurada, enviarEventosMeta, type EventoCapi } from "@/lib/meta-capi";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/* ==================================================================
   Meta Conversions API: las agendas y las ventas.

   Cada media hora le cuenta a Meta lo que pasó en las últimas 48 horas:
   cada agenda de Calendly (Schedule) y cada venta cargada (Purchase, con
   el valor acordado). El registro al webinar (Lead) lo manda al instante
   /api/webinar/registro. Lo ya mandado queda en `capi_enviados`, así una
   agenda o una venta se cuenta una sola vez aunque el cron corra de nuevo.

   Sin META_PIXEL_ID y un token no hace nada (ver lib/meta-capi.ts).
   ================================================================== */

const HORAS = 48;

export async function GET(req: Request) {
  const secreto = process.env.CRON_SECRET;
  if (!secreto || req.headers.get("authorization") !== `Bearer ${secreto}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (!capiConfigurada()) return NextResponse.json({ omitido: "Falta META_PIXEL_ID o el token de la Conversions API." });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY." }, { status: 503 });

  const desde = new Date(Date.now() - HORAS * 3600000).toISOString();
  const [s, v] = await Promise.all([
    db.from("sesiones").select("id,email,invitado,creadoEn,contactoId,origen,estado").eq("origen", "calendly").gte("creadoEn", desde),
    db.from("ventas").select("id,contactoId,contactoNombre,precioAcordado,moneda,creadoEn,fecha,estado").gte("creadoEn", desde),
  ]);
  if (s.error || v.error) return NextResponse.json({ error: s.error?.message ?? v.error?.message }, { status: 502 });

  const sesiones = (s.data ?? []) as { id: string; email?: string; invitado?: string; creadoEn: string; contactoId?: string; estado: string }[];
  const ventas = ((v.data ?? []) as { id: string; contactoId?: string; contactoNombre: string; precioAcordado: number; moneda: string; creadoEn: string; estado: string }[])
    .filter((x) => x.estado !== "cancelada");

  /* Los datos de la persona de cada venta: su lead (ventas.contactoId es un lead). */
  const idsLeads = [...new Set(ventas.map((x) => x.contactoId).filter(Boolean))] as string[];
  const leads = idsLeads.length
    ? ((await db.from("leads").select("id,email,telefono,nombre,contactoId").in("id", idsLeads)).data ?? []) as { id: string; email?: string; telefono?: string; nombre?: string; contactoId?: string }[]
    : [];
  const leadDe = new Map(leads.map((l) => [l.id, l] as const));

  const eventos: EventoCapi[] = [
    ...sesiones.map((x): EventoCapi => ({
      nombre: "Schedule", id: `sch_${x.id}`, cuando: x.creadoEn, origen: "website",
      persona: { email: x.email, nombre: x.invitado, externalId: x.contactoId },
    })),
    ...ventas.map((x): EventoCapi => {
      const l = x.contactoId ? leadDe.get(x.contactoId) : undefined;
      return {
        nombre: "Purchase", id: `pur_${x.id}`, cuando: x.creadoEn, origen: "system_generated",
        valor: Number(x.precioAcordado) || 0, moneda: x.moneda || "USD",
        persona: { email: l?.email, telefono: l?.telefono, nombre: l?.nombre ?? x.contactoNombre, externalId: l?.contactoId ?? x.contactoId },
      };
    }),
  ];
  if (eventos.length === 0) return NextResponse.json({ enviados: 0 });

  const ya = await db.from("capi_enviados").select("id").in("id", eventos.map((x) => x.id));
  if (ya.error) return NextResponse.json({ error: `capi_enviados: ${ya.error.message} (¿corrió supabase/capi-enviados.sql?)` }, { status: 502 });
  const enviados = new Set(((ya.data ?? []) as { id: string }[]).map((x) => x.id));
  const nuevos = eventos.filter((x) => !enviados.has(x.id));

  let total = 0;
  const errores: string[] = [];
  for (let i = 0; i < nuevos.length; i += 100) {
    const tanda = nuevos.slice(i, i + 100);
    const r = await enviarEventosMeta(tanda);
    if (r.error) { errores.push(r.error); continue; }
    total += r.enviados;
    const w = await db.from("capi_enviados").upsert(tanda.map((x) => ({ id: x.id, evento: x.nombre })));
    if (w.error) errores.push(`capi_enviados: ${w.error.message}`);
  }
  console.log("[cron/meta-capi]", JSON.stringify({ candidatos: eventos.length, nuevos: nuevos.length, enviados: total, errores }));
  return NextResponse.json({ enviados: total, nuevos: nuevos.length, errores }, { status: errores.length ? 207 : 200 });
}
