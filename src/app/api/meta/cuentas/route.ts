import { NextResponse } from "next/server";
import { COOKIE_TOKEN, metaConfigurado, tokenDeLaPeticion, tokenDeSistema, traerCuentas, type CuentaMeta } from "@/lib/meta";

/* Lee variables de entorno en cada pedido: nunca cachear. */
export const dynamic = "force-dynamic";

/* Meta limita cuántas veces se le puede preguntar por una cuenta. La lista
   de cuentas casi nunca cambia, así que la guardamos un rato: abrir
   Marketing diez veces no tiene por qué gastar diez llamadas. */
const VIGENCIA_MS = 10 * 60 * 1000;
let cache: { cuentas: CuentaMeta[]; hasta: number } | null = null;

const esLimite = (m: string) => /too many calls|rate limit|#17|#4\b/i.test(m);

export async function GET(req: Request) {
  if (!metaConfigurado()) return NextResponse.json({ conectado: false, motivo: "sin-configurar" });

  const token = tokenDeLaPeticion(req);
  if (!token) {
    return NextResponse.json({
      conectado: false, motivo: "sin-sesion",
      hayTokenDeSistema: Boolean(tokenDeSistema()),
    });
  }

  if (cache && cache.hasta > Date.now()) {
    return NextResponse.json({
      conectado: true, cuentas: cache.cuentas,
      porSistema: Boolean(tokenDeSistema()), deCache: true,
    });
  }

  try {
    const cuentas = await traerCuentas(token);
    cache = { cuentas, hasta: Date.now() + VIGENCIA_MS };
    return NextResponse.json({ conectado: true, cuentas, porSistema: Boolean(tokenDeSistema()) });
  } catch (e) {
    const detalle = e instanceof Error ? e.message : "";
    /* Si Meta nos frenó por límite, la conexión sigue estando bien:
       devolvemos lo último que sabíamos en vez de decir "sin conectar". */
    if (esLimite(detalle)) {
      return NextResponse.json({
        conectado: Boolean(cache), cuentas: cache?.cuentas ?? [],
        porSistema: Boolean(tokenDeSistema()),
        motivo: "limite", detalle,
      });
    }
    return NextResponse.json({ conectado: false, motivo: "error", detalle });
  }
}

export async function DELETE() {
  if (tokenDeSistema()) {
    return NextResponse.json(
      { error: "La conexión se configura con una variable del proyecto, no desde acá." },
      { status: 400 },
    );
  }
  cache = null;
  const res = NextResponse.json({ conectado: false });
  res.cookies.delete(COOKIE_TOKEN);
  return res;
}
