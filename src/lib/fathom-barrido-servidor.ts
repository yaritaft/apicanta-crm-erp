import type { SupabaseClient } from "@supabase/supabase-js";
import { BARRIDO_VACIO, decidirBarrido, type EstadoBarrido } from "./fathom-barrido";
import { equipoDeLaPasada, escribirPasada, leerPasada, PRIMERA_PASADA, seguir } from "./fathom-equipos";
import { equiposDeVentasDeFathom, EsperarAFathom, guardarGrabacion, POR_QUIEN, reunionesDesde } from "./fathom-servidor";
import { idDeShare } from "./fathom";
import { avisosDeConexion, avisosDeGrabacionesPrivadas, barridoParado, esErrorDeClave, queNoLlegan } from "./fathom-alertas";
import { diaDeNegocio } from "./dia-negocio";
import { createHash } from "node:crypto";

/* El barrido de Fathom por los links, del lado del servidor (lib/fathom-barrido
   explica el porqué). Lo llama el cron (api/cron/fathom) y el botón de Ajustes
   (api/fathom, accion «links»). El avance se guarda en `fathom_barrido`
   (supabase/fathom-links.sql) para seguir en la próxima vuelta. */

interface LlamadaConLink { id: string; grabacion: string; inicia: string; anfitrion?: string | null }

/** Las llamadas con el link de Fathom pegado, sus ids de link y cuáles ya tienen su transcripción guardada. */
export async function llamadasConLink(db: SupabaseClient): Promise<{ todas: LlamadaConLink[]; pendientes: LlamadaConLink[]; error?: string }> {
  const todas: LlamadaConLink[] = [];
  for (let desde = 0; ; desde += 1000) {
    const r = await db.from("sesiones").select("id, grabacion, inicia, anfitrion").ilike("grabacion", "%fathom.video/share/%")
      .order("inicia", { ascending: true }).range(desde, desde + 999);
    if (r.error) return { todas: [], pendientes: [], error: r.error.message };
    const filas = (r.data ?? []) as LlamadaConLink[];
    todas.push(...filas.filter((f) => idDeShare(f.grabacion)));
    if (filas.length < 1000) break;
  }
  const listas = new Set<string>();
  for (let i = 0; i < todas.length; i += 60) {
    const r = await db.from("grabaciones").select("sesionId").in("sesionId", todas.slice(i, i + 60).map((x) => x.id)).not("transcripcion", "is", null);
    if (r.error) return { todas, pendientes: todas, error: r.error.message };
    for (const g of (r.data ?? []) as { sesionId: string }[]) listas.add(g.sesionId);
  }
  return { todas, pendientes: todas.filter((x) => !listas.has(x.id)) };
}

/** Después de la pasada por todo lo que la clave ve: cada equipo de ventas de Fathom y, aparte, lo que grabó cada
    closer por su correo de Equipo. Sin ese pedido por persona, Fathom no devuelve las llamadas de quien está fuera de
    la organización (varios closers graban con otra cuenta), aunque las haya compartido. */
async function pasadasExtra(db: SupabaseClient): Promise<string[]> {
  const equipos = await equiposDeVentasDeFathom();
  const r = await db.from("equipo").select("email, rol");
  const correos = [...new Set(((r.data ?? []) as { email?: string | null; rol?: string | null }[])
    .filter((m) => m.rol === "closer" && /@/.test(m.email ?? "")).map((m) => (m.email ?? "").trim().toLowerCase()))];
  return [...equipos, ...correos.map((c) => `${POR_QUIEN}${c}`)];
}

async function leerEstado(db: SupabaseClient): Promise<EstadoBarrido> {
  const r = await db.from("fathom_barrido").select("cursor, desde, tipo, ultimoFresco, ultimoCompleto").eq("id", 1).maybeSingle();
  return r.error || !r.data ? BARRIDO_VACIO : { ...BARRIDO_VACIO, ...(r.data as Partial<EstadoBarrido>) };
}

async function guardarEstado(db: SupabaseClient, e: EstadoBarrido) {
  const r = await db.from("fathom_barrido").upsert({ id: 1, ...e, actualizadoEn: new Date().toISOString() }, { onConflict: "id" });
  return r.error?.message;
}

/** Cómo van los links: para la pantalla de Ajustes. */
export async function estadoDeLinks(db: SupabaseClient) {
  const [l, e] = await Promise.all([llamadasConLink(db), leerEstado(db)]);
  /* Las que faltan, por closer: es a quien hay que pedirle que comparta sus grabaciones con el equipo en Fathom. */
  const porCloser = new Map<string, number>();
  for (const p of l.pendientes) porCloser.set(p.anfitrion?.trim() || "Sin closer", (porCloser.get(p.anfitrion?.trim() || "Sin closer") ?? 0) + 1);
  return {
    conLink: l.todas.length, conTranscripcion: l.todas.length - l.pendientes.length, pendientes: l.pendientes.length,
    enCurso: Boolean(e.cursor), ultimoCompleto: e.ultimoCompleto, error: l.error,
    faltanPorCloser: [...porCloser].map(([closer, n]) => ({ closer, n })).sort((a, b) => b.n - a.n),
  };
}

export interface ResultadoBarrido {
  ok: boolean;
  /* en-curso: queda por recorrer; terminado: llegó al final; esperar: Fathom pidió una pausa; nada: no tocaba. */
  estado: "en-curso" | "terminado" | "esperar" | "nada";
  esperar?: number; motivo?: string; error?: string;
  /* Si el barrido que terminó (o siguió) era de lo fresco o de todo lo pendiente. */
  tipo?: "fresco" | "completo" | null;
  paginas: number; vistas: number; nuevas: number; porLink: number; pendientes: number;
}

/** Sigue (o empieza, si toca) el barrido de Fathom por los links, hasta `reloj`
    (un momento en ms) o `maxPaginas`; guarda dónde quedó. */
export async function barrerLinks(db: SupabaseClient, op: { reloj: number; maxPaginas: number; forzar?: boolean }): Promise<ResultadoBarrido> {
  const r: ResultadoBarrido = { ok: true, estado: "nada", paginas: 0, vistas: 0, nuevas: 0, porLink: 0, pendientes: 0 };
  const ahora = Date.now();
  const [l, antes] = await Promise.all([llamadasConLink(db), leerEstado(db)]);
  if (l.error) return { ...r, ok: false, error: l.error };
  r.pendientes = l.pendientes.length;

  const d = decidirBarrido(antes, l.pendientes, ahora, op.forzar);
  if (d.accion === "nada") return { ...r, motivo: d.motivo };

  let e: EstadoBarrido = d.accion === "seguir" ? antes
    : { ...antes, cursor: escribirPasada(PRIMERA_PASADA), desde: d.desde, tipo: d.tipo };
  r.tipo = e.tipo;
  let pasada = leerPasada(e.cursor);
  r.estado = "en-curso";

  /* Una página que ya se pidió en esta vuelta (un cursor que da vueltas): se da por terminada esa pasada, no se gira para siempre. */
  const vistos = new Set<string>();
  while (r.paginas < op.maxPaginas && Date.now() < op.reloj) {
    vistos.add(`${pasada.i}|${pasada.c ?? ""}`);
    let pagina;
    try { pagina = await reunionesDesde(e.desde ?? new Date(ahora - 365 * 86_400_000).toISOString(), pasada.c, equipoDeLaPasada(pasada)); }
    catch (err) {
      if (err instanceof EsperarAFathom) { r.estado = "esperar"; r.esperar = err.segundos; break; }
      const error = err instanceof Error ? err.message : "No se pudo hablar con Fathom.";
      await guardarEstado(db, { ...e, cursor: escribirPasada(pasada) });
      return { ...r, ok: false, estado: "en-curso", error };
    }
    r.paginas++;
    for (const item of pagina.items) {
      const g = await guardarGrabacion(db, item);
      r.vistas++;
      if (!g.ok) { if (g.error?.includes("recording_id")) continue; await guardarEstado(db, { ...e, cursor: escribirPasada(pasada) }); return { ...r, ok: false, error: `No se pudo guardar una grabación: ${g.error}` }; }
      if (g.guardada && !g.yaEstaba) r.nuevas++;
      if (g.guardada && g.por === "link") r.porLink++;
    }
    const siguiente = pagina.siguiente && !vistos.has(`${pasada.i}|${pagina.siguiente}`) ? pagina.siguiente : null;
    if (pagina.siguiente && !siguiente) console.error("[fathom] el cursor volvió a una página ya pedida: se da por terminada esa pasada.");
    const sigue = await seguir(pasada, siguiente, () => pasadasExtra(db));
    if (!sigue) { r.estado = "terminado"; break; }
    pasada = sigue;
  }

  const hoy = new Date().toISOString();
  if (r.estado === "terminado") {
    e = { cursor: null, desde: null, tipo: null,
      ultimoFresco: hoy, ultimoCompleto: e.tipo === "completo" ? hoy : e.ultimoCompleto };
  } else {
    e = { ...e, cursor: escribirPasada(pasada) };
  }
  const error = await guardarEstado(db, e);
  if (error) return { ...r, ok: false, error: `No se pudo guardar el avance del barrido: ${error}` };
  return r;
}

/* ---------- que no pase en silencio (lib/fathom-alertas) ---------- */

const hash = (s: string) => createHash("sha1").update(s).digest("hex").slice(0, 10);
/* La semana, para no repetirle el resumen a los supervisores todos los días: el lunes de esa semana. */
const lunesDe = (dia: string) => {
  const d = new Date(`${dia}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10).replace(/-/g, "");
};

/** Lo que mira el cron después de cada vuelta y le dice a quien puede arreglarlo, por la campanita: una conexión que falla, un barrido
    parado, y —cuando terminó un barrido completo— las grabaciones con link que siguen sin verse (privadas en Fathom). Sin repetir: cada aviso
    tiene su id por día (o por semana, el resumen de supervisores) y el que ya existe no se pisa. Nunca rompe el cron. */
export async function avisarDeFathom(db: SupabaseClient, r: ResultadoBarrido, ahora = Date.now()): Promise<number> {
  try {
    const dia = diaDeNegocio(new Date(ahora).toISOString()).replace(/-/g, "");
    const [duenos, director, equipo] = await Promise.all([
      db.from("usuarios_permitidos").select("email").eq("rol", "dueno"),
      db.from("usuarios_permitidos").select("email").eq("rol", "director"),
      db.from("equipo").select("nombre, email, rol"),
    ]);
    const mails = (x: { data: unknown }) => ((x.data ?? []) as { email?: string | null }[]).map((m) => m.email ?? "").filter(Boolean);
    const dueñosMails = mails(duenos);
    let filas: ReturnType<typeof avisosDeConexion> = [];

    /* Sólo la clave que Fathom no acepta: un 502 o un 429 pasajeros se arreglan solos (y si no, avisa el barrido parado a los 3 días). */
    if (!r.ok && r.error && esErrorDeClave(r.error)) filas.push(...avisosDeConexion({ tipo: "error", mensaje: r.error }, dueñosMails, dia, hash));

    const [l, estado] = await Promise.all([llamadasConLink(db), leerEstado(db)]);
    if (!l.error) {
      if (barridoParado(estado.ultimoCompleto, l.pendientes.length, ahora)) {
        filas.push(...avisosDeConexion({ tipo: "parado", desde: estado.ultimoCompleto }, dueñosMails, dia, hash));
      }
      /* Sólo tras un barrido COMPLETO: ahí «no apareció» quiere decir que Fathom no deja verla. */
      if (r.estado === "terminado" && r.tipo === "completo") {
        const sin = queNoLlegan(l.pendientes.map((p) => ({ id: p.id, inicia: p.inicia, anfitrion: p.anfitrion })), ahora);
        filas.push(...avisosDeGrabacionesPrivadas(
          sin, { closers: ((equipo.data ?? []) as { nombre: string; email?: string | null; rol?: string }[]).filter((m) => m.rol === "closer"), supervisores: [...dueñosMails, ...mails(director)] },
          dia, lunesDe(`${dia.slice(0, 4)}-${dia.slice(4, 6)}-${dia.slice(6, 8)}`), hash,
        ));
      }
    }
    if (filas.length === 0) return 0;
    const g = await db.from("avisos").upsert(filas, { onConflict: "id", ignoreDuplicates: true });
    if (g.error) console.error("[fathom] no se pudieron guardar los avisos:", g.error.message);
    return filas.length;
  } catch (err) {
    console.error("[fathom] no se pudo avisar:", err instanceof Error ? err.message : String(err));
    return 0;
  }
}
