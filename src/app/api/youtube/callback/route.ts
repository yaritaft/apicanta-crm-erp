import { NextResponse } from "next/server";
import { nubeServidor } from "@/lib/servidor";
import { analyticsConfigurado, canalPropio, canjearCodigo, leerEstado } from "@/lib/youtube-analytics";

/* Vuelta de Google con el permiso del canal: se canjea por un refresh
   token y se guarda en yt_conexion (sólo la lee el servidor). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origen = url.origin;
  const estado = leerEstado(url.searchParams.get("state"));
  const volver = (resultado: string) => {
    const destino = new URL(estado?.volver ?? "/webinars", origen);
    destino.searchParams.set("youtube", resultado);
    return NextResponse.redirect(destino.toString());
  };

  if (!analyticsConfigurado()) return volver("sin-configurar");
  if (!estado) return volver("state-invalido");
  if (url.searchParams.get("error")) return volver("cancelado");
  const code = url.searchParams.get("code");
  if (!code) return volver("sin-codigo");

  const t = await canjearCodigo(code, origen);
  if (t.error || !t.acceso) return volver("error-token");
  /* Sin refresh token no sirve: el acceso dura una hora. Pasa si la cuenta
     ya había dado permiso y Google no lo repitió. */
  if (!t.refresh) return volver("sin-permiso-largo");

  const canal = await canalPropio(t.acceso);
  if (!canal.id) return volver("sin-canal");

  const db = nubeServidor();
  if (!db) return volver("sin-base");
  const r = await db.from("yt_conexion").upsert({
    id: "canal",
    refreshToken: t.refresh,
    canalId: canal.id,
    canalNombre: canal.nombre ?? null,
    conectadoPor: estado.quien ?? null,
    conectadoEn: new Date().toISOString(),
  });
  if (r.error) return volver("error-base");
  /* Lo que se trajo con el permiso anterior (quizás de otro canal) ya no vale. */
  await db.from("yt_analytics").delete().neq("videoId", "");
  return volver("conectado");
}
