import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import { hayServidor } from "@/lib/servidor";
import { analyticsConfigurado, crearEstado, PERMISOS, urlRedireccion } from "@/lib/youtube-analytics";

/* Arranca la conexión con YouTube Analytics: devuelve la URL de Google a
   la que la pantalla manda a quien tenga acceso al canal. Es un POST con
   la sesión, y no un link directo, para que sólo el equipo pueda iniciar
   la conexión (el state sale firmado de acá). */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para conectar YouTube." }, { status: 401 });
  }
  if (!analyticsConfigurado()) {
    return NextResponse.json({ error: "Falta configurar GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET en el proyecto." }, { status: 503 });
  }
  if (!hayServidor) {
    return NextResponse.json({ error: "Falta SUPABASE_SERVICE_ROLE_KEY: no hay dónde guardar el permiso." }, { status: 503 });
  }
  const cuerpo = (await peticion.json().catch(() => ({}))) as { volver?: string; quien?: string };
  const origen = new URL(peticion.url).origin;
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", process.env.GOOGLE_CLIENT_ID as string);
  u.searchParams.set("redirect_uri", urlRedireccion(origen));
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", PERMISOS);
  /* offline + consent: sin esto Google no devuelve el refresh token la
     segunda vez que alguien conecta. */
  u.searchParams.set("access_type", "offline");
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("include_granted_scopes", "true");
  u.searchParams.set("state", crearEstado(cuerpo.volver ?? "/webinars", cuerpo.quien?.slice(0, 120)));
  return NextResponse.json({ url: u.toString() });
}
