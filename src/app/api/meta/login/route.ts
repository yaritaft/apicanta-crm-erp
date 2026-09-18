import { NextResponse } from "next/server";
import { COOKIE_ESTADO, DIALOGO, PERMISOS, metaConfigurado, urlRedireccion } from "@/lib/meta";

export async function GET(req: Request) {
  if (!metaConfigurado()) {
    return NextResponse.json(
      { error: "Falta configurar META_APP_ID y META_APP_SECRET en el proyecto." },
      { status: 503 },
    );
  }

  const origen = new URL(req.url).origin;
  /* El state evita que alguien dispare el callback desde afuera. */
  const estado = crypto.randomUUID();

  const u = new URL(DIALOGO);
  u.searchParams.set("client_id", process.env.META_APP_ID as string);
  u.searchParams.set("redirect_uri", urlRedireccion(origen));
  u.searchParams.set("state", estado);
  u.searchParams.set("response_type", "code");

  /* Facebook Login for Business: los permisos y los activos los define la
     configuracion, no un scope suelto. Si no hay config, caemos al flujo
     clasico con scope. */
  if (process.env.META_CONFIG_ID) {
    u.searchParams.set("config_id", process.env.META_CONFIG_ID);
    u.searchParams.set("override_default_response_type", "true");
  } else {
    u.searchParams.set("scope", PERMISOS);
  }

  const res = NextResponse.redirect(u.toString());
  res.cookies.set(COOKIE_ESTADO, estado, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600,
  });
  return res;
}
