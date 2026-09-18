import { NextResponse } from "next/server";
import { metaConfigurado, tokenDeLaPeticion, traerCampanias } from "@/lib/meta";

/* Devuelve las campañas ya normalizadas. No escribe en la base: el
   cliente las guarda con su propia sesión, así todo queda auditado
   a nombre de quien apretó el botón. */
export async function POST(req: Request) {
  if (!metaConfigurado()) return NextResponse.json({ error: "Meta no está configurado." }, { status: 503 });

  const token = tokenDeLaPeticion(req);
  if (!token) return NextResponse.json({ error: "No hay conexión con Meta. Configurá el token o conectá la cuenta." }, { status: 401 });

  const { cuentaId, desde, hasta } = (await req.json()) as { cuentaId?: string; desde?: string; hasta?: string };
  if (!cuentaId) return NextResponse.json({ error: "Falta elegir la cuenta publicitaria." }, { status: 400 });

  const hoy = new Date();
  const haceTresMeses = new Date(hoy); haceTresMeses.setMonth(hoy.getMonth() - 3);
  const dia = (d: Date) => d.toISOString().slice(0, 10);

  try {
    const campanias = await traerCampanias(token, cuentaId, desde ?? dia(haceTresMeses), hasta ?? dia(hoy));
    return NextResponse.json({ campanias });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "No se pudo leer Meta." }, { status: 502 });
  }
}
