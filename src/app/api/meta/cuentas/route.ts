import { NextResponse } from "next/server";
import { COOKIE_TOKEN, metaConfigurado, tokenDeLaPeticion, tokenDeSistema, traerCuentas } from "@/lib/meta";

export async function GET(req: Request) {
  if (!metaConfigurado()) return NextResponse.json({ conectado: false, motivo: "sin-configurar" });

  const token = tokenDeLaPeticion(req);
  if (!token) return NextResponse.json({ conectado: false, motivo: "sin-sesion" });

  try {
    return NextResponse.json({
      conectado: true,
      cuentas: await traerCuentas(token),
      /* Con token de sistema no hay nada que desconectar: no es una sesión. */
      porSistema: Boolean(tokenDeSistema()),
    });
  } catch (e) {
    return NextResponse.json({
      conectado: false, motivo: "error",
      detalle: e instanceof Error ? e.message : "",
    });
  }
}

export async function DELETE() {
  if (tokenDeSistema()) {
    return NextResponse.json(
      { error: "La conexión se configura con una variable del proyecto, no desde acá." },
      { status: 400 },
    );
  }
  const res = NextResponse.json({ conectado: false });
  res.cookies.delete(COOKIE_TOKEN);
  return res;
}
