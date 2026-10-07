import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { nubeServidor } from "@/lib/servidor";
import { claveEmail, completar } from "@/lib/contactos";
import { webinarDeUtm } from "@/lib/calendly";
import { diaArgentina } from "@/lib/reporteFinanciera";
import { enviarEventosUnaVez, fbcDeFbclid } from "@/lib/meta-capi";
import { eventosDeRegistro } from "@/lib/capi-registro";
import { nombreSinFormula } from "@/lib/whatsapp";
import { adIdDeUtm, filaParaBase, fusionarRegistro, idRegistro, nuevoRegistro, type RegistroForm } from "@/lib/registros-webinar";
import type { Contacto } from "@/lib/types";

/* ==================================================================
   El formulario de la landing del webinar.

   "Ese formulario lo quiero guardar en Supabase" (Yari). La landing le
   manda acá cada registro (un fetch o un <form> común) y queda:

   - El contacto, un PRE-LEAD: se registró pero todavía no agendó. No se
     le abre una oportunidad (para Yari un lead es quien agenda); la
     pantalla del webinar lo muestra como pre-lead y, cuando agende en
     Calendly, es la misma persona (el mismo mail).
   - Su registro en extra.registrosWebinar (uno por webinar), con los
     UTMs, la página y lo que haya contestado. Con eso se sabe de qué
     anuncio vino (utm_content) antes de que agende.
   - Su fila en la tabla propia `registros_webinar` (supabase/registros-webinar.sql):
     la fecha del webinar, los UTMs, el anuncio, las respuestas y las marcas
     del equipo (unido / no unido / contactado) de la pantalla Formularios.
     Si la tabla todavía no existe, se sigue como siempre sin ella.
   - "Formularios" del webinar, contado solo (sin pisar lo cargado a mano).
   - Los eventos a Meta por la Conversions API, si está configurada: Lead y, si
     califica, RegistroCalificado (lib/capi-registro.ts).

   El webinar: el que diga el campo `webinar` (su id o su fecha), el de
   los UTMs del estándar (webinar_aaaammdd) o, si no, el próximo vivo.

   Es público (lo llama la landing): se cuida con un campo trampa para
   bots (`sitio`, que la persona no ve), un límite por IP y, si se define
   REGISTRO_ORIGENES, sólo acepta esos dominios. Ver docs/registro-webinar.md.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const origenes = () => (process.env.REGISTRO_ORIGENES ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function cors(origen: string | null): Record<string, string> {
  const lista = origenes();
  const permitido = lista.length === 0 ? "*" : origen && lista.includes(origen) ? origen : lista[0];
  return {
    "Access-Control-Allow-Origin": permitido,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

/* Hasta 10 registros por minuto por IP en cada instancia: frena a un bot
   sin molestar a una oficina que comparte la conexión. */
const intentos = new Map<string, number[]>();
function demasiados(ip: string): boolean {
  const ahora = Date.now();
  const xs = (intentos.get(ip) ?? []).filter((t) => ahora - t < 60_000);
  xs.push(ahora);
  intentos.set(ip, xs);
  if (intentos.size > 5000) intentos.clear();
  return xs.length > 10;
}

const CAMPOS_NOMBRE = ["nombre", "name", "full_name", "nombre_completo", "fullname"];
const CAMPOS_TELEFONO = ["telefono", "phone", "whatsapp", "celular", "tel"];
const CAMPOS_PAIS = ["pais", "country"];
const CONOCIDOS = new Set([
  ...CAMPOS_NOMBRE, ...CAMPOS_TELEFONO, ...CAMPOS_PAIS, "email", "correo", "webinar", "sitio", "website",
  "url", "pagina", "redirect", "fbclid", "_fbp", "fbp", "_fbc", "fbc", "evento_id", "event_id",
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
]);

const primero = (d: Record<string, string>, ks: string[]) => ks.map((k) => d[k]?.trim()).find(Boolean);
const limpio = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
const exacto = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface RegistroWebinar {
  id: string;
  webinarId?: string;
  creado: string;
  pagina?: string;
  utm?: Record<string, string>;
  respuestas: { pregunta: string; respuesta: string }[];
}

async function leerCuerpo(req: Request): Promise<Record<string, string>> {
  const tipo = req.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k.toLowerCase(), typeof v === "string" ? v : v === null || v === undefined ? "" : JSON.stringify(v)]));
  }
  const f = await req.formData().catch(() => null);
  if (!f) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of f.entries()) if (typeof v === "string") out[k.toLowerCase()] = v;
  return out;
}

export async function POST(req: Request) {
  const h = cors(req.headers.get("origin"));
  const lista = origenes();
  const origen = req.headers.get("origin");
  if (lista.length && origen && !lista.includes(origen)) {
    return NextResponse.json({ ok: false, error: "Origen no permitido." }, { status: 403, headers: h });
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "";
  if (ip && demasiados(ip)) return NextResponse.json({ ok: false, error: "Demasiados intentos." }, { status: 429, headers: h });

  const d = await leerCuerpo(req);
  const redirect = d.redirect?.trim();
  const responder = (cuerpo: Record<string, unknown>, status = 200) =>
    redirect && /^https:\/\//.test(redirect) && status < 400
      ? NextResponse.redirect(redirect, { status: 303, headers: h })
      : NextResponse.json(cuerpo, { status, headers: h });

  /* El campo trampa: una persona no lo ve ni lo llena. Al bot se le dice
     que salió bien, así no insiste. */
  if ((d.sitio ?? d.website ?? "").trim()) return responder({ ok: true });

  const email = claveEmail(d.email ?? d.correo);
  /* Un email real no pasa de 254 caracteres; sin este tope, la expresión de abajo con miles de puntos tarda segundos (la
     ruta es pública y corre antes de tocar la base). */
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return NextResponse.json({ ok: false, error: "Falta un email válido." }, { status: 400, headers: h });
  }
  const db = nubeServidor();
  if (!db) return NextResponse.json({ ok: false, error: "Falta configurar la base (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503, headers: h });

  const cuando = new Date().toISOString();
  /* El nombre lo escribe cualquiera en la landing y después se copia a planillas (Formularios → «Con nombres»): sin = + - @ al principio. */
  const nombre = nombreSinFormula(primero(d, CAMPOS_NOMBRE));
  const telefono = primero(d, CAMPOS_TELEFONO);
  const pais = primero(d, CAMPOS_PAIS);
  const utm = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]
    .filter((k) => d[k]?.trim()).map((k) => [k, d[k].trim()])) as Record<string, string>;
  const respuestas = Object.entries(d)
    .filter(([k, v]) => !CONOCIDOS.has(k) && v.trim())
    .map(([pregunta, respuesta]) => ({ pregunta, respuesta: respuesta.trim().slice(0, 500) }))
    .slice(0, 20);

  try {
    /* ---------- El webinar ---------- */
    const w = await db.from("webinars").select("id,fecha,estado,formularios,extra");
    if (w.error) throw new Error(w.error.message);
    const webinars = (w.data ?? []) as { id: string; fecha: string; estado: string; formularios: number; extra?: Record<string, unknown> | null }[];
    const pedido = d.webinar?.trim();
    const webinarId =
      (pedido && (webinars.find((x) => x.id === pedido)?.id ?? webinars.find((x) => diaArgentina(x.fecha) === pedido.slice(0, 10))?.id))
      || webinarDeUtm(utm, webinars, cuando)
      /* El próximo vivo (o el de hoy, hasta 6 horas después de empezar). */
      || webinars.filter((x) => x.estado !== "borrador" && new Date(x.fecha).getTime() > Date.now() - 6 * 3600000)
        .sort((a, b) => +new Date(a.fecha) - +new Date(b.fecha))[0]?.id;

    /* ---------- El contacto: el mismo email es la misma persona ---------- */
    const busqueda = await db.from("contactos").select("*").ilike("email", exacto(email)).limit(1);
    if (busqueda.error) throw new Error(busqueda.error.message);
    const previo = (busqueda.data?.[0] ?? null) as Contacto | null;
    const registroId = `reg_${createHash("sha256").update(`${email}|${webinarId ?? "sin"}`).digest("hex").slice(0, 16)}`;
    const registro: RegistroWebinar = {
      id: registroId, webinarId, creado: cuando,
      pagina: (d.url ?? d.pagina ?? req.headers.get("referer") ?? "").slice(0, 500) || undefined,
      utm: Object.keys(utm).length ? utm : undefined, respuestas,
    };
    const ya = Array.isArray(previo?.extra?.registrosWebinar) ? (previo!.extra.registrosWebinar as RegistroWebinar[]) : [];
    const nuevoEnEsteWebinar = !ya.some((r) => r.webinarId === webinarId);
    const contacto: Contacto = previo
      ? {
          ...previo,
          nombre: previo.nombre || nombre || email,
          telefono: completar(previo.telefono, telefono),
          pais: completar(previo.pais, pais),
          origenWebinarId: completar(previo.origenWebinarId, webinarId),
          origenCanal: completar(previo.origenCanal, webinarId ? "webinar" : undefined),
          utm: completar(previo.utm, Object.keys(utm).length ? utm : undefined),
          extra: { ...(previo.extra ?? {}), registrosWebinar: [...ya.filter((r) => r.webinarId !== webinarId), { ...registro, creado: ya.find((r) => r.webinarId === webinarId)?.creado ?? cuando }] },
        }
      : {
          id: `con_web_${createHash("sha256").update(email).digest("hex").slice(0, 16)}`,
          nombre: nombre || email, email, telefono, pais,
          origenCanal: webinarId ? "webinar" : "otro", origenWebinarId: webinarId,
          utm: Object.keys(utm).length ? utm : undefined,
          creadoEn: cuando, extra: { registrosWebinar: [registro] },
        };
    const rc = await db.from("contactos").upsert(limpio(contacto), { defaultToNull: false });
    if (rc.error) throw new Error(rc.error.message);

    /* ---------- La fila en la tabla de registros ----------
       Va aparte y no tumba el registro: si la tabla no existe todavía (o falla),
       la persona igual quedó como pre-lead y se sigue como antes. */
    let registroFilaId: string | undefined;
    try {
      const fecha = webinarId ? diaArgentina(webinars.find((x) => x.id === webinarId)?.fecha ?? "") || undefined : undefined;
      /* El anuncio: el id de Meta que viene en utm_content, o el anuncio con ese nombre. */
      let adId = adIdDeUtm(utm);
      const contenido = utm.utm_content?.trim();
      if (!adId && contenido && contenido.length < 200) {
        const a = await db.from("ads").select("id,metaId,nombre").eq("nombre", contenido).limit(1);
        if (!a.error && a.data?.[0]) adId = (a.data[0] as { id: string }).id;
      }
      const id = idRegistro(email, fecha);
      const nuevo = nuevoRegistro({
        id, email, webinarId, fechaWebinar: fecha, nombre, telefono, pais,
        utm: Object.keys(utm).length ? utm : undefined, adId, pagina: registro.pagina, respuestas,
        fbp: d._fbp ?? d.fbp, fbc: d._fbc ?? d.fbc ?? fbcDeFbclid(d.fbclid),
        ip: ip || undefined, userAgent: req.headers.get("user-agent")?.slice(0, 300) || undefined,
        eventoId: d.event_id?.trim() || d.evento_id?.trim() || registroId,
        origen: "landing", registradoEn: cuando,
      }, cuando);
      /* Si ya se había anotado a este webinar, se completa lo que faltaba y las
         marcas del equipo (unido, contactado) no se tocan. */
      const antes = await db.from("registros_webinar").select("*").eq("id", id).maybeSingle();
      if (antes.error && !/registros_webinar|schema cache|does not exist/i.test(antes.error.message)) throw new Error(antes.error.message);
      if (!antes.error) {
        const fila = antes.data ? fusionarRegistro(antes.data as RegistroForm, nuevo) : nuevo;
        const rr = await db.from("registros_webinar").upsert(filaParaBase(fila), { defaultToNull: false });
        if (rr.error) throw new Error(rr.error.message);
        registroFilaId = id;
      }
    } catch (e) {
      console.error("[webinar/registro] tabla registros_webinar:", e instanceof Error ? e.message : e);
    }

    /* ---------- "Formularios" del webinar, contado solo ---------- */
    if (webinarId && nuevoEnEsteWebinar) {
      const [a, b] = await Promise.all([
        db.from("contactos").select("id", { count: "exact", head: true }).contains("extra", { registrosWebinar: [{ webinarId }] }),
        db.from("contactos").select("id", { count: "exact", head: true }).contains("extra", { formulariosMeta: [{ webinarId }] })
          .not("extra", "cs", JSON.stringify({ registrosWebinar: [{ webinarId }] })),
      ]);
      const n = (a.count ?? 0) + (b.count ?? 0);
      const fila = webinars.find((x) => x.id === webinarId);
      const extra = { ...(fila?.extra ?? {}) };
      const auto = typeof extra.formulariosAuto === "number" ? extra.formulariosAuto : undefined;
      const aMano = fila && fila.formularios !== 0 && fila.formularios !== auto;
      if (fila && !aMano && n > 0 && n !== fila.formularios) {
        extra.formulariosAuto = n;
        await db.from("webinars").update({ formularios: n, extra }).eq("id", webinarId);
      }
    }

    /* ---------- Los eventos a Meta: Lead y, si califica, RegistroCalificado (lib/capi-registro.ts) ---------- */
    const capi = await enviarEventosUnaVez(db, eventosDeRegistro({
      registroId, idLead: d.event_id?.trim() || d.evento_id?.trim(), cuando, pagina: registro.pagina,
      webinarId, utm: registro.utm, respuestas,
      persona: {
        email, telefono, nombre, pais, externalId: contacto.id, ip: ip || undefined,
        userAgent: req.headers.get("user-agent") ?? undefined,
        fbp: d._fbp ?? d.fbp, fbc: d._fbc ?? d.fbc ?? fbcDeFbclid(d.fbclid),
      },
    }));
    if (capi.error) console.error("[webinar/registro] Conversions API:", capi.error);

    return responder({ ok: true, contactoId: contacto.id, webinarId: webinarId ?? null, nuevo: !previo, registroId: registroFilaId ?? null });
  } catch (e) {
    console.error("[webinar/registro]", e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: "No se pudo guardar el registro." }, { status: 500, headers: h });
  }
}
