import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { armarBienvenida, esCodigoBienvenida, type AccesoParaBienvenida, type Contrato } from "@/lib/contratos";
import { programasGuardados, sincronizar } from "@/lib/contratos-servidor";
import { linkMagicoWisboo } from "@/lib/accesos-servidor";
import { programaPorId } from "@/lib/programas";

/* ==================================================================
   GET /api/bienvenida/<código> — lo que ve el alumno apenas firma (PandaDoc lo manda a /bienvenida/<código>).
   Pública: lo único que la abre es el código, largo y al azar. Devuelve sólo su nombre de pila, el programa y sus
   links (Telegram de un solo uso, entrar a Wisboo, Zoom): nunca su mail, documento ni nada del contrato.
   Si la firma todavía no llegó por el aviso, se le pregunta a PandaDoc acá mismo (como mucho cada 5 segundos), y al
   firmar se dan los accesos: así el alumno no espera al aviso. La página vuelve a preguntar sola mientras tanto.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const ESPERA_ENTRE_CONSULTAS_MS = 5_000;
const sinCache = { "Cache-Control": "no-store" };

export async function GET(_peticion: Request, ctx: { params: Promise<{ token?: string }> }) {
  const { token } = await ctx.params;
  if (!esCodigoBienvenida(token)) return NextResponse.json({ error: "No encontramos esta página." }, { status: 404, headers: sinCache });
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "No disponible." }, { status: 503, headers: sinCache });

  let c = (await db.from("contratos").select("*").eq("bienvenida", token).maybeSingle()).data as Contrato | null;
  if (!c) return NextResponse.json({ error: "No encontramos esta página." }, { status: 404, headers: sinCache });

  /* Recién firmó y el aviso todavía no llegó (o los accesos se están dando): se le pregunta a PandaDoc. */
  const viejo = !c.sincronizadoEn || Date.now() - new Date(c.sincronizadoEn).getTime() > ESPERA_ENTRE_CONSULTAS_MS;
  if ((c.estado !== "firmado" || !c.accesosEn) && c.documentoId && viejo && c.estado !== "anulado") {
    try { c = await sincronizar(db, c, "sincronizacion"); }
    catch (e) { console.error("[bienvenida] no se pudo consultar a PandaDoc", c.id, e instanceof Error ? e.message : String(e)); }
  }

  const { programas, config } = await programasGuardados(db);
  const accesosAutomaticos = config.estado === "encendido" || (config.estado === "prueba" && c.modo === "prueba");
  const programa = programaPorId(programas, c.programa)?.nombre ?? c.plantillaNombre;
  let accesos: AccesoParaBienvenida[] = [];
  let linkWisboo: string | null = null;
  if (c.estado === "firmado" && c.accesosEn && c.alumnoId) {
    const r = await db.from("accesos_alumno").select("plataforma, estado, recursoNombre, externo").eq("alumnoId", c.alumnoId);
    accesos = (r.data ?? []) as AccesoParaBienvenida[];
    /* El link para entrar a Wisboo se pide en el momento (vence): uno por visita. */
    const usuario = accesos.find((x) => x.plataforma === "wisboo" && x.estado === "dado" && typeof x.externo.usuarioId === "string");
    if (usuario) linkWisboo = (await linkMagicoWisboo(String(usuario.externo.usuarioId)))?.link ?? null;
  }
  return NextResponse.json(armarBienvenida({ contrato: c, programa, accesos, linkWisboo, accesosAutomaticos }), { headers: sinCache });
}
