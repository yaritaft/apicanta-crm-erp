import { nubeServidor } from "./servidor";
import type { AnalyticsVideo } from "./youtube";
import { videoDelWebinar } from "./youtube";
import { analyticsDeVideo, conexion } from "./youtube-analytics";

/* ==================================================================
   Completar solo "Asistieron al vivo" de cada webinar con video.

   YouTube no da personas únicas: da vistas. Las vistas del vivo son lo más
   parecido a los asistentes (quien se va y vuelve cuenta dos veces). De
   dónde sale, de mejor a peor:
   1. YouTube Analytics: las vistas en vivo (liveOrOnDemand = LIVE). Tardan
      dos o tres días, así que una vez por día se le vuelve a preguntar
      por los vivos de las últimas dos semanas.
   2. Lo que guardó el cron: las vistas del video en el último minuto en
      que estuvo en el aire.

   No pisa lo cargado a mano: sólo escribe si el campo está en 0 o si
   todavía tiene el último número que puso él (extra.asistentesAuto).

   De paso guarda las vistas de la grabación (extra.vistasGrabacion): las
   que vinieron después del vivo, para el embudo "con post vivo".

   Lo corre /api/cron/youtube cada minuto; casi siempre no hace nada.
   ================================================================== */

const DIA = 86_400_000;

interface FilaWebinar {
  id: string; titulo: string; fecha: string; asistentes: number;
  youtubeUrl?: string | null; enlaceReplay?: string | null; extra?: Record<string, unknown> | null;
}

const vistasEnVivo = (d?: AnalyticsVideo | null) => d?.vivoVsGrabacion?.find((f) => f.clave === "LIVE")?.valor;
const vistasGrabacion = (d?: AnalyticsVideo | null) => d?.vivoVsGrabacion?.find((f) => f.clave === "ON_DEMAND")?.valor;

export async function completarAsistentes(): Promise<{ actualizados: number; errores: string[] }> {
  const res = { actualizados: 0, errores: [] as string[] };
  const db = nubeServidor();
  if (!db) return res;

  const rw = await db.from("webinars")
    .select("id, titulo, fecha, asistentes, youtubeUrl, enlaceReplay, extra")
    .gte("fecha", new Date(Date.now() - 120 * DIA).toISOString())
    .lte("fecha", new Date().toISOString());
  if (rw.error) { res.errores.push(`webinars: ${rw.error.message}`); return res; }
  const webinars = ((rw.data ?? []) as FilaWebinar[])
    .map((w) => ({ w, v: videoDelWebinar(w) }))
    .filter((x): x is { w: FilaWebinar; v: string } => Boolean(x.v));
  if (webinars.length === 0) return res;
  const videos = webinars.map((x) => x.v);

  const [ra, re] = await Promise.all([
    db.from("yt_analytics").select("videoId, datos, traidoEn").in("videoId", videos),
    db.from("yt_estado").select("videoId, estado, fin").in("videoId", videos),
  ]);
  const analytics = new Map(((ra.data ?? []) as { videoId: string; datos: AnalyticsVideo; traidoEn: string }[]).map((x) => [x.videoId, x]));
  const estados = new Map(((re.data ?? []) as { videoId: string; estado: string | null; fin: string | null }[]).map((x) => [x.videoId, x]));

  /* Una vez por día, a lo sumo un video por vuelta: pedirle a Analytics lo
     del vivo de las últimas dos semanas que todavía no tiene vistas en vivo. */
  const c = await conexion();
  if (c) {
    const pendiente = webinars.find(({ w, v }) => {
      const a = analytics.get(v);
      const reciente = Date.now() - +new Date(w.fecha) < 14 * DIA && Date.now() - +new Date(w.fecha) > 6 * 3600_000;
      return reciente && (!a || (vistasEnVivo(a.datos) === undefined && Date.now() - +new Date(a.traidoEn) > DIA));
    });
    if (pendiente) {
      const desde = new Date(+new Date(pendiente.w.fecha) - DIA).toISOString().slice(0, 10);
      const d = await analyticsDeVideo(pendiente.v, desde);
      if (!("error" in d)) {
        await db.from("yt_analytics").upsert({ videoId: pendiente.v, datos: d, traidoEn: d.traidoEn });
        analytics.set(pendiente.v, { videoId: pendiente.v, datos: d, traidoEn: d.traidoEn });
      }
    }
  }

  for (const { w, v } of webinars) {
    const d = analytics.get(v)?.datos;
    let valor = vistasEnVivo(d);
    let grabacion = vistasGrabacion(d);
    let fuente = "analytics";
    const terminado = estados.get(v)?.estado === "terminado";
    if (valor === undefined || grabacion === undefined) {
      /* Sin Analytics, lo que guardó el cron. Sólo con el vivo terminado:
         durante, los números todavía crecen. Las vistas de la grabación son
         las de ahora menos las que tenía al cortar el vivo. */
      if (!terminado) continue;
      const [enVivo, ahora] = await Promise.all([
        db.from("yt_muestras").select("vistas").eq("videoId", v).eq("enVivo", true)
          .not("vistas", "is", null).order("minuto", { ascending: false }).limit(1).maybeSingle(),
        db.from("yt_muestras").select("vistas").eq("videoId", v).eq("enVivo", false)
          .not("vistas", "is", null).order("minuto", { ascending: false }).limit(1).maybeSingle(),
      ]);
      const alCortar = enVivo.data?.vistas as number | undefined;
      if (valor === undefined) { valor = alCortar; fuente = "vivo"; }
      if (grabacion === undefined && alCortar !== undefined) {
        const ult = ahora.data?.vistas as number | undefined;
        grabacion = ult !== undefined ? Math.max(0, ult - alCortar) : 0;
      }
    }

    const extra = { ...(w.extra ?? {}) };
    const cambios: Record<string, unknown> = {};
    const partes: string[] = [];

    const auto = typeof extra.asistentesAuto === "number" ? extra.asistentesAuto : undefined;
    const aMano = w.asistentes !== 0 && w.asistentes !== auto;
    if (valor !== undefined && valor !== w.asistentes && !aMano) {
      cambios.asistentes = valor;
      extra.asistentesAuto = valor;
      extra.asistentesFuente = fuente;
      partes.push(`asistieron al vivo ${w.asistentes} → ${valor} (${fuente === "analytics" ? "vistas en vivo según YouTube Analytics" : "vistas al terminar el vivo"})`);
    }
    if (grabacion !== undefined && grabacion !== extra.vistasGrabacion) {
      extra.vistasGrabacion = grabacion;
    }
    if (JSON.stringify(extra) === JSON.stringify(w.extra ?? {}) && !("asistentes" in cambios)) continue;
    cambios.extra = extra;

    const u = await db.from("webinars").update(cambios).eq("id", w.id);
    if (u.error) { res.errores.push(`webinar ${w.id}: ${u.error.message}`); continue; }
    res.actualizados++;
    if (partes.length) {
      await db.from("actividad").insert({
        id: `act_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        accion: "actualizo", actor: "YouTube", entidad: "webinar", entidadId: w.id, titulo: w.titulo,
        fecha: new Date().toISOString(), detalle: `«${w.titulo}»: ${partes.join(", ")}.`,
      });
    }
  }
  return res;
}
