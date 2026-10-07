import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { baseDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { equipoDeLaPasada, escribirPasada, leerPasada, seguir } from "@/lib/fathom-equipos";
import { candidatasPara, desdeParaImportar, leerReunion, ventanaDeBusqueda } from "@/lib/fathom";
import { miembroDeCloser } from "@/lib/crm";
import {
  atarGrabacion, borrarWebhook, crearWebhook, diagnosticarFathom, equiposDeVentasDeFathom, EsperarAFathom, guardarGrabacion,
  hayApiFathom, reunionesDe, reunionesDesde,
} from "@/lib/fathom-servidor";

/* ==================================================================
   Fathom, desde Ajustes → Integraciones.

   GET: cómo está (si hay clave, si el webhook está conectado, cuántas
   grabaciones se guardaron atadas a su llamada y desde cuándo hay
   llamadas de Calendly para atarlas).
   POST { accion }:
   - "conectar": crea el webhook en Fathom apuntando a /api/fathom/webhook
     y guarda su secreto en `fathom_conexion` (no pasa por el navegador).
   - "importar": trae una página de reuniones (y `cursor` para la
     siguiente) desde el día antes de la primera llamada de Calendly; se
     guardan sólo las que tienen su llamada, el resto se descarta. Pasa
     primero por todo lo que la clave ve y después, una vez por cada equipo
     de ventas de Fathom, por las llamadas de ese equipo (`teams[]`, las
     «Team Calls»; lib/fathom-equipos): el cursor que vuelve es opaco y
     recuerda en cuál va. Si Fathom pide esperar, contesta `esperar`
     (segundos) y la pantalla vuelve a pedir la misma página después.
   - "diagnosticar" (sólo dueños): le pregunta a Fathom qué reuniones ve la
     clave, de qué equipos y de quién, y lo cruza con Calendly para decir
     cuál de las causas parece ser (lib/fathom-diagnostico). Sólo lee.
   - "desconectar": borra el webhook de Fathom.
   Lo ve quien ve los Ajustes; lo cambia quien los edita.

   Y dos del cierre del día, para quien edita el CRM, sobre una llamada
   que esa persona ve (el closer, las suyas):
   - "buscar": las grabaciones de Fathom del closer de la llamada, cerca
     de ese día, para elegir la que no se ató sola. Sólo quien la atendió
     o un dueño: entre las de un closer puede haber reuniones que no son
     de ventas, y sus títulos no son para todo el equipo.
   - "atar": guarda la elegida atada a esa llamada, con su resumen y su
     transcripción.
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
  const [c, total, atadas, ultima, primera] = await Promise.all([
    db.from("fathom_conexion").select("url, paraElEquipo, conectadoEn, conectadoPor").eq("id", 1).maybeSingle(),
    db.from("grabaciones").select("id", { count: "exact", head: true }),
    db.from("grabaciones").select("id", { count: "exact", head: true }).not("sesionId", "is", null),
    db.from("grabaciones").select("creadoEn").order("creadoEn", { ascending: false }).limit(1).maybeSingle(),
    primeraLlamada(db),
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
    desde: desdeParaImportar(null, primera, Date.now()),
  }, { headers: { "Cache-Control": "no-store" } });
}

/** Cuándo es la primera llamada de Calendly (con correo) que hay en la app. */
async function primeraLlamada(db: NonNullable<ReturnType<typeof nubeServidor>>): Promise<string | null> {
  const r = await db.from("sesiones").select("inicia").not("email", "is", null).order("inicia", { ascending: true }).limit(1).maybeSingle();
  return (r.data as { inicia?: string } | null)?.inicia ?? null;
}

/** null si quien pide es dueño (o la app corre local, sin login). El
    diagnóstico muestra quién grabó cada reunión: es de los dueños. */
async function exigirDueno(peticion: Request): Promise<NextResponse | null> {
  if (!hayEquipoConfigurado()) return null;
  const mia = baseDelPedido(peticion);
  if (!mia) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  const yo = (await mia.rpc("mi_acceso")).data as { tipo?: string } | null;
  if (yo?.tipo !== "dueno") return NextResponse.json({ error: "El diagnóstico de Fathom es de los dueños." }, { status: 403 });
  return null;
}

export async function POST(peticion: Request) {
  const b = (await peticion.json().catch(() => ({}))) as { accion?: string; desde?: string; cursor?: string; sesionId?: string; recordingId?: string };
  const deUnaLlamada = b.accion === "buscar" || b.accion === "atar";
  const noPuede = await exigirArea(peticion, deUnaLlamada ? ["crm"] : ["ajustes"], 2);
  if (noPuede) return noPuede;
  if (b.accion === "diagnosticar") {
    const noEsDueno = await exigirDueno(peticion);
    if (noEsDueno) return noEsDueno;
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Sin base configurada." }, { status: 503 });
  if (!hayApiFathom()) return NextResponse.json({ error: "Falta FATHOM_API_KEY en Vercel." }, { status: 503 });

  try {
    if (deUnaLlamada) {
      /* La llamada, leída con la sesión de quien pide: si no la ve, no la toca. */
      const mia = baseDelPedido(peticion);
      if (!mia) return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
      const suya = await mia.from("sesiones").select("id, inicia, anfitrion").eq("id", b.sesionId ?? "").maybeSingle();
      const s = suya.data as { id: string; inicia: string; anfitrion?: string | null } | null;
      if (!s) return NextResponse.json({ error: "No encontramos esa llamada." }, { status: 404 });
      const eq = await db.from("equipo").select("id, nombre, email");
      const closer = miembroDeCloser(s.anfitrion ?? "", (eq.data ?? []) as { id: string; nombre: string; email?: string | null }[]);
      const yo = (await mia.rpc("mi_acceso")).data as { tipo?: string; miembroId?: string | null } | null;
      if (yo?.tipo !== "dueno" && (!closer || yo?.miembroId !== closer.id)) {
        return NextResponse.json({ error: `Las grabaciones de ${s.anfitrion || "esa llamada"} las busca quien la atendió o un dueño.` }, { status: 403 });
      }
      const correo = closer?.email?.trim().toLowerCase();
      if (!correo) {
        return NextResponse.json({ error: `Falta el mail de ${s.anfitrion || "quien atendió la llamada"} en Equipo: con eso se buscan sus grabaciones en Fathom.` }, { status: 422 });
      }
      const ventana = ventanaDeBusqueda(s.inicia);
      if (!ventana) return NextResponse.json({ error: "La llamada no tiene fecha." }, { status: 422 });

      let items: unknown[];
      try {
        items = await reunionesDe(correo, ventana.desde, ventana.hasta, b.accion === "atar");
      } catch (err) {
        if (err instanceof EsperarAFathom) return NextResponse.json({ ok: true, esperar: err.segundos });
        throw err;
      }

      if (b.accion === "buscar") {
        const candidatas = candidatasPara(items, s.inicia);
        const ya = candidatas.length
          ? await db.from("grabaciones").select("recordingId, sesionId").in("recordingId", candidatas.map((c) => c.recordingId))
          : null;
        const deOtra = new Set(((ya?.data ?? []) as { recordingId: string; sesionId: string | null }[])
          .filter((x) => x.sesionId && x.sesionId !== s.id).map((x) => x.recordingId));
        return NextResponse.json({ ok: true, candidatas: candidatas.map((c) => ({ ...c, otraLlamada: deOtra.has(c.recordingId) })) });
      }

      const elegida = items.find((x) => leerReunion(x)?.recordingId === String(b.recordingId ?? ""));
      if (!elegida) return NextResponse.json({ error: "Esa grabación ya no está entre las de ese closer en Fathom." }, { status: 404 });
      const r = await atarGrabacion(db, elegida, s.id);
      if (!r.ok) return NextResponse.json({ error: `No se pudo guardar la grabación: ${r.error}` }, { status: 500 });
      return NextResponse.json({ ok: true, shareUrl: r.shareUrl });
    }

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

    if (b.accion === "diagnosticar") {
      return NextResponse.json({ ok: true, diagnostico: await diagnosticarFathom(db), cuando: new Date().toISOString() });
    }

    if (b.accion === "importar") {
      const desde = desdeParaImportar(b.desde, await primeraLlamada(db), Date.now());
      if (!desde) return NextResponse.json({ ok: true, sinLlamadas: true, siguiente: null });
      /* La pasada: primero todo lo que la clave ve; después, cada equipo de ventas de Fathom. */
      const pasada = leerPasada(b.cursor);
      const equipo = equipoDeLaPasada(pasada);
      let pagina;
      try {
        pagina = await reunionesDesde(desde, pasada.c, equipo);
      } catch (err) {
        if (err instanceof EsperarAFathom) return NextResponse.json({ ok: true, esperar: err.segundos });
        throw err;
      }
      /* Las vueltas por equipo repiten lo que ya trajo la general: la pantalla
         cuenta por recording_id (`idsAtadas`, `idsDescartadas`), no por página. */
      const idsAtadas: string[] = [], idsDescartadas: string[] = [];
      let nuevas = 0;
      for (const item of pagina.items) {
        const r = await guardarGrabacion(db, item);
        /* Sin recording_id no hay nada que guardar; un error de la base, sí se avisa. */
        if (!r.ok && !r.error?.includes("recording_id")) throw new Error(`No se pudo guardar una grabación: ${r.error}`);
        const id = leerReunion(item)?.recordingId;
        if (!id) continue;
        if (r.guardada) { idsAtadas.push(id); if (!r.yaEstaba) nuevas++; } else idsDescartadas.push(id);
      }
      const sigue = await seguir(pasada, pagina.siguiente, equiposDeVentasDeFathom);
      return NextResponse.json({ ok: true, idsAtadas, idsDescartadas, nuevas, siguiente: sigue ? escribirPasada(sigue) : null, desde, equipo });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "No se pudo hablar con Fathom." }, { status: 502 });
  }
  return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
}
