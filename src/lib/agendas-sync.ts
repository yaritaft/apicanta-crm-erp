import { nubeServidor } from "./servidor";
import { resumirAgendas, type SesionCalendly } from "./agendas-webinar";
import { videoDelWebinar } from "./youtube";

/* ==================================================================
   Completar solas "Llamadas en vivo", "Llamadas después" y "Canceladas"
   de cada webinar con las agendas de Calendly (lib/agendas-webinar.ts).

   Lo corre /api/cron/youtube cada minuto. Sólo toca webinars desde que
   entró la primera agenda de Calendly: los anteriores se cargaron a mano
   y un 0 calculado pisaría esos números. Sólo escribe si cambió algo, y
   cada cambio queda en la actividad.
   ================================================================== */

const DIA = 86_400_000;
type Db = NonNullable<ReturnType<typeof nubeServidor>>;

interface FilaWebinar {
  id: string; titulo: string; fecha: string; duracionMin: number;
  youtubeUrl?: string | null; enlaceReplay?: string | null;
  llamadasVivo: number; llamadasPosterior: number; llamadasCanceladas: number;
}

export async function sesionesCalendly(db: Db, desde: string): Promise<SesionCalendly[]> {
  const out: SesionCalendly[] = [];
  for (let a = 0; a < 5000; a += 1000) {
    const r = await db.from("sesiones")
      .select("id, invitado, creadoEn, inicia, estado, canal, anfitrion, utm")
      .not("calendlyInvitadoUri", "is", null)
      .gte("creadoEn", desde)
      .order("creadoEn")
      .range(a, a + 999);
    if (r.error) throw new Error(`sesiones: ${r.error.message}`);
    out.push(...((r.data ?? []) as SesionCalendly[]));
    if ((r.data ?? []).length < 1000) break;
  }
  return out;
}

export async function completarLlamadas(): Promise<{ actualizados: number; errores: string[] }> {
  const res = { actualizados: 0, errores: [] as string[] };
  const db = nubeServidor();
  if (!db) return res;

  const primera = await db.from("sesiones").select("creadoEn")
    .not("calendlyInvitadoUri", "is", null).order("creadoEn").limit(1).maybeSingle();
  if (primera.error || !primera.data) return res;
  const desde = new Date(Math.max(+new Date(primera.data.creadoEn as string) - DIA, Date.now() - 60 * DIA)).toISOString();

  const rw = await db.from("webinars")
    .select("id, titulo, fecha, duracionMin, youtubeUrl, enlaceReplay, llamadasVivo, llamadasPosterior, llamadasCanceladas")
    .gte("fecha", desde).lte("fecha", new Date(Date.now() + DIA).toISOString());
  if (rw.error) { res.errores.push(`webinars: ${rw.error.message}`); return res; }
  const webinars = (rw.data ?? []) as FilaWebinar[];
  if (webinars.length === 0) return res;

  const sesiones = await sesionesCalendly(db, new Date(Math.min(...webinars.map((w) => +new Date(w.fecha))) - 2 * DIA).toISOString());
  const videos = webinars.map((w) => videoDelWebinar(w)).filter((v): v is string => Boolean(v));
  const re = videos.length
    ? await db.from("yt_estado").select("videoId, inicio, fin").in("videoId", videos)
    : { data: [], error: null };
  const vivos = new Map(((re.data ?? []) as { videoId: string; inicio: string | null; fin: string | null }[]).map((e) => [e.videoId, e]));

  for (const w of webinars) {
    const v = videoDelWebinar(w);
    const r = resumirAgendas(sesiones, w, v ? vivos.get(v) ?? {} : {});
    const cambios: Partial<FilaWebinar> = {};
    if (r.vivo !== w.llamadasVivo) cambios.llamadasVivo = r.vivo;
    if (r.despues !== w.llamadasPosterior) cambios.llamadasPosterior = r.despues;
    if (r.canceladas !== w.llamadasCanceladas) cambios.llamadasCanceladas = r.canceladas;
    if (Object.keys(cambios).length === 0) continue;

    const u = await db.from("webinars").update(cambios).eq("id", w.id);
    if (u.error) { res.errores.push(`webinar ${w.id}: ${u.error.message}`); continue; }
    res.actualizados++;
    const partes = [
      cambios.llamadasVivo !== undefined && `en el vivo ${w.llamadasVivo} → ${r.vivo}`,
      cambios.llamadasPosterior !== undefined && `después ${w.llamadasPosterior} → ${r.despues}`,
      cambios.llamadasCanceladas !== undefined && `canceladas ${w.llamadasCanceladas} → ${r.canceladas}`,
    ].filter(Boolean).join(", ");
    await db.from("actividad").insert({
      id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
      accion: "actualizo", actor: "Calendly", entidad: "webinar", entidadId: w.id, titulo: w.titulo,
      fecha: new Date().toISOString(), detalle: `Agendas de «${w.titulo}» desde Calendly: ${partes}.`,
    });
  }
  return res;
}
