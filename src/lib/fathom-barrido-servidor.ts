import type { SupabaseClient } from "@supabase/supabase-js";
import { BARRIDO_VACIO, decidirBarrido, type EstadoBarrido } from "./fathom-barrido";
import { equipoDeLaPasada, escribirPasada, leerPasada, PRIMERA_PASADA, seguir } from "./fathom-equipos";
import { equiposDeVentasDeFathom, EsperarAFathom, guardarGrabacion, POR_QUIEN, reunionesDesde } from "./fathom-servidor";
import { idDeShare } from "./fathom";

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
  let pasada = leerPasada(e.cursor);
  r.estado = "en-curso";

  while (r.paginas < op.maxPaginas && Date.now() < op.reloj) {
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
    const sigue = await seguir(pasada, pagina.siguiente, () => pasadasExtra(db));
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
