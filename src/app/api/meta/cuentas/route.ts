import { NextResponse } from "next/server";
import { COOKIE_TOKEN, metaConfigurado, traerCuentas } from "@/lib/meta";

export async function GET(req: Request) {
  if (!metaConfigurado()) return NextResponse.json({ conectado: false, motivo: "sin-configurar" });

  const token = req.headers.get("cookie")?.match(new RegExp(`${COOKIE_TOKEN}=([^;]+)`))?.[1];
  if (!token) return NextResponse.json({ conectado: false, motivo: "sin-sesion" });

  try {
    return NextResponse.json({ conectado: true, cuentas: await traerCuentas(token) });
  } catch (e) {
    return NextResponse.json(
      { conectado: false, motivo: "error", detalle: e instanceof Error ? e.message : "" },
      { status: 200 },
    );
  }
}

export async function DELETE() {
  const res = NextResponse.json({ conectado: false });
  res.cookies.delete(COOKIE_TOKEN);
  return res;
}
