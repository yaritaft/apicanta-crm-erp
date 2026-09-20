/* Sincronización de Meta del lado del SERVIDOR.

   Este archivo nunca puede importarse desde un componente de cliente: usa la
   clave de servicio de Supabase, que saltea RLS. Si llegara al bundle,
   cualquiera con el navegador abierto tendría acceso total a la base.

   Por qué hace falta la clave de servicio: nuestras políticas son
   `puede_entrar()`, que mira `auth.jwt() ->> 'email'`. Un cron no tiene JWT,
   así que la función devuelve false y todas sus escrituras se rechazan. Y en
   lectura eso ni siquiera da error — devuelve cero filas. Sin esto, el cron
   correría cada 15 minutos "exitosamente" sin guardar nada. */

import { createClient } from "@supabase/supabase-js";
import {
  idAd, idAdset, idCampaign, idInsight,
  traerInsightsDiarios, traerJerarquia,
} from "./meta";

function clienteServidor() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const clave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !clave) return null;
  return createClient(url, clave, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/* PostgREST se atraganta con un upsert de miles de filas de una. */
async function upsertEnLotes(
  db: NonNullable<ReturnType<typeof clienteServidor>>,
  tabla: string, filas: Record<string, unknown>[], tamano = 500,
) {
  for (let i = 0; i < filas.length; i += tamano) {
    const lote = filas.slice(i, i + tamano).map((o) =>
      Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)),
    );
    const r = await db.from(tabla).upsert(lote as never[], { defaultToNull: false });
    if (r.error) throw new Error(`${tabla}: ${r.error.message}`);
  }
}

export interface ResultadoSync {
  cuentaId: string;
  campaigns: number;
  adsets: number;
  ads: number;
  dias: number;
  desde: string;
  hasta: string;
}

/* Trae de Meta y guarda.

   `conJerarquia` separa las dos cadencias. La estructura son 2.751 anuncios y
   se lleva casi todo el tiempo de la llamada, pero no cambia cada cuarto de
   hora: se refresca una vez por día. Los insights sí van seguido, y sobre una
   ventana corta.

   Devuelve cuánto entró de cada cosa, para que quede en los logs del cron y se
   pueda ver si un día dejó de traer sin que nadie se entere. */
export async function sincronizarMeta(
  token: string, cuentaId: string, desde: string, hasta: string,
  { conJerarquia = true }: { conJerarquia?: boolean } = {},
): Promise<ResultadoSync> {
  const db = clienteServidor();
  if (!db) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el servidor.");

  const t = new Date().toISOString();
  let campaigns = 0, adsets = 0, ads = 0;

  /* Los anuncios conocidos: sin esto no se puede saber si un insight apunta a
     un anuncio que existe. Cuando no se refresca la jerarquía, se leen de la
     base en vez de pedírselos de nuevo a Meta. */
  let idsDeAnuncios: Set<string>;

  if (conJerarquia) {
    const j = await traerJerarquia(token, cuentaId);

    await upsertEnLotes(db, "campaigns", j.campaigns.map((c) => ({
      id: idCampaign(c.id), metaId: c.id, nombre: c.nombre, objetivo: c.objetivo,
      estado: c.estado, cuentaId, desde: c.desde, hasta: c.hasta, creadoEn: t, extra: {},
    })));
    await upsertEnLotes(db, "adsets", j.adsets.map((a) => ({
      id: idAdset(a.id), metaId: a.id, campaignId: idCampaign(a.campaignId),
      nombre: a.nombre, estado: a.estado, desde: a.desde, hasta: a.hasta, creadoEn: t, extra: {},
    })));
    await upsertEnLotes(db, "ads", j.ads.map((a) => ({
      id: idAd(a.id), metaId: a.id, adsetId: idAdset(a.adsetId),
      campaignId: idCampaign(a.campaignId), nombre: a.nombre, estado: a.estado,
      creadoEn: t, extra: {},
    })));

    campaigns = j.campaigns.length; adsets = j.adsets.length; ads = j.ads.length;
    idsDeAnuncios = new Set(j.ads.map((a) => idAd(a.id)));
  } else {
    const r = await db.from("ads").select("id");
    if (r.error) throw new Error(`ads: ${r.error.message}`);
    idsDeAnuncios = new Set((r.data ?? []).map((a) => a.id as string));
  }

  const insights = await traerInsightsDiarios(token, cuentaId, desde, hasta);

  /* Un insight de un anuncio que no está en la base rompería la FK y frenaría
     el lote entero, perdiendo también los buenos. Pasa cuando Meta devuelve
     gasto de un anuncio creado después del último refresco de la jerarquía:
     lo recupera el sync completo del día siguiente. */
  const filas = insights
    .filter((i) => idsDeAnuncios.has(idAd(i.adId)))
    .map((i) => ({
      id: idInsight(i.adId, i.dia), adId: idAd(i.adId), dia: i.dia,
      inversion: i.inversion, impresiones: i.impresiones, clicks: i.clicks, leads: i.leads,
      alcance: i.alcance, frecuencia: i.frecuencia,
      ctr: i.ctr, cpm: i.cpm, cpc: i.cpc,
      clicksEnlace: i.clicksEnlace, ctrEnlace: i.ctrEnlace,
      costoPorClickEnlace: i.costoPorClickEnlace,
      acciones: i.acciones, tipoDeLead: i.tipoDeLead, creadoEn: t,
    }));

  await upsertEnLotes(db, "ad_insights", filas);

  return { cuentaId, campaigns, adsets, ads, dias: filas.length, desde, hasta };
}

/* El día de hoy en el calendario del negocio. El cron corre en UTC, y a las
   21hs de Argentina allá ya es mañana: sin esto la ventana "últimos 3 días"
   se correría un día y el gasto de hoy no entraría nunca. */
export function hoyEnArgentina(): Date {
  const s = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function ventana(dias: number): { desde: string; hasta: string } {
  const hoy = hoyEnArgentina();
  const desde = new Date(hoy);
  desde.setUTCDate(hoy.getUTCDate() - (dias - 1));
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  return { desde: iso(desde), hasta: iso(hoy) };
}
