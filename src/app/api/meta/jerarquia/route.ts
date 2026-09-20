import { NextResponse } from "next/server";
import {
  metaConfigurado, tokenDeLaPeticion, traerInsightsDiarios, traerJerarquia,
} from "@/lib/meta";

/* Lee variables de entorno en cada pedido: nunca cachear. */
export const dynamic = "force-dynamic";

/* Con 4.522 anuncios y un rango largo, esto no entra en los 10s por defecto.
   Meta pagina de a 500 y cada vuelta es un viaje de red. */
export const maxDuration = 300;

/* La jerarquía completa: campaigns → adsets → ads, y los insights por anuncio
   y por día del rango pedido.

   Igual que /sync, no escribe en la base: devuelve el dato normalizado y el
   cliente lo guarda con su propia sesión, así todo queda auditado a nombre de
   quien apretó el botón. */
export async function POST(req: Request) {
  if (!metaConfigurado()) {
    return NextResponse.json({ error: "Meta no está configurado." }, { status: 503 });
  }

  const token = tokenDeLaPeticion(req);
  if (!token) {
    return NextResponse.json(
      { error: "No hay conexión con Meta. Configurá el token o conectá la cuenta." },
      { status: 401 },
    );
  }

  const { cuentaId, desde, hasta } = (await req.json()) as
    { cuentaId?: string; desde?: string; hasta?: string };

  if (!cuentaId) {
    return NextResponse.json({ error: "Falta elegir la cuenta publicitaria." }, { status: 400 });
  }
  /* El rango es obligatorio acá, al revés que en /sync. Un default silencioso
     traería un mes cualquiera y el número no coincidiría con lo que dice la
     pantalla — peor que pedirlo. */
  if (!desde || !hasta) {
    return NextResponse.json({ error: "Falta el rango de fechas." }, { status: 400 });
  }

  try {
    /* La estructura y los números, en paralelo: no dependen entre sí. Los
       insights vienen por `ad_id` de Meta, que es la misma clave que trae la
       jerarquía, así que el cliente los cruza sin pedir nada más. */
    const [jerarquia, insights] = await Promise.all([
      traerJerarquia(token, cuentaId),
      traerInsightsDiarios(token, cuentaId, desde, hasta),
    ]);

    return NextResponse.json({ ...jerarquia, insights, desde, hasta });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "No se pudo leer Meta." },
      { status: 502 },
    );
  }
}
