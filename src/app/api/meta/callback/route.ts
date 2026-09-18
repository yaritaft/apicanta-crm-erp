import { NextResponse } from "next/server";
import { COOKIE_ESTADO, COOKIE_TOKEN, GRAPH, metaConfigurado, urlRedireccion } from "@/lib/meta";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origen = url.origin;
  const volver = (estado: string) => NextResponse.redirect(`${origen}/marketing?meta=${estado}`);

  if (!metaConfigurado()) return volver("sin-configurar");

  const error = url.searchParams.get("error");
  if (error) return volver("cancelado");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const esperado = req.headers.get("cookie")?.match(new RegExp(`${COOKIE_ESTADO}=([^;]+)`))?.[1];

  if (!code) return volver("sin-codigo");
  if (!state || state !== esperado) return volver("state-invalido");

  try {
    /* 1) El código por un token corto */
    const t = new URL(`${GRAPH}/oauth/access_token`);
    t.searchParams.set("client_id", process.env.META_APP_ID as string);
    t.searchParams.set("client_secret", process.env.META_APP_SECRET as string);
    t.searchParams.set("redirect_uri", urlRedireccion(origen));
    t.searchParams.set("code", code);

    const r1 = await fetch(t, { cache: "no-store" });
    if (!r1.ok) return volver("error-token");
    const { access_token: corto } = (await r1.json()) as { access_token: string };

    /* 2) El token corto por uno largo, que dura ~60 días */
    const l = new URL(`${GRAPH}/oauth/access_token`);
    l.searchParams.set("grant_type", "fb_exchange_token");
    l.searchParams.set("client_id", process.env.META_APP_ID as string);
    l.searchParams.set("client_secret", process.env.META_APP_SECRET as string);
    l.searchParams.set("fb_exchange_token", corto);

    const r2 = await fetch(l, { cache: "no-store" });
    const largo = r2.ok
      ? ((await r2.json()) as { access_token: string; expires_in?: number })
      : { access_token: corto, expires_in: 3600 };

    const res = volver("ok");
    res.cookies.set(COOKIE_TOKEN, largo.access_token, {
      httpOnly: true, secure: true, sameSite: "lax", path: "/",
      maxAge: largo.expires_in ?? 60 * 60 * 24 * 55,
    });
    res.cookies.delete(COOKIE_ESTADO);
    return res;
  } catch {
    return volver("error");
  }
}
