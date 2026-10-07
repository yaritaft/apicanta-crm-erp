import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import {
  correoDe, datosDeWebinar, ErrorSinTablas, leerAccion, leerJson, repositorio, respuestaDeError, SIN_BASE, tokenDelLector,
} from "@/lib/whatsapp-servidor";

/* ==================================================================
   El grupo de WhatsApp de un webinar, para su ficha.

   GET ?id=<webinar>: los grupos atados a ese webinar, quién está adentro de
   alguno (las claves de los teléfonos), quién salió y las marcas de
   «Contactado». La pantalla lo cruza con la gente del webinar.

   POST { accion }:
   - «atar» { grupoId, webinarId }: el grupo es de ese webinar (puede haber
     varios grupos de un mismo webinar).
   - «soltar» { grupoId }: el grupo deja de ser de su webinar.
   - «contactado» { webinarId, personaId, contactado }: marcar o sacar la
     marca de que alguien del equipo ya le escribió. Queda quién y cuándo.

   Ver, marcar «contactado»: quien ve los Webinars. Atar y soltar grupos:
   quien los edita.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { headers: { "Cache-Control": "no-store" } };

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["webinars"], 1);
  if (noPuede) return noPuede;
  const id = new URL(peticion.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[\w.:@+-]{1,160}$/.test(id)) return NextResponse.json({ error: "Falta el webinar (?id=…)." }, { status: 400 });

  const donde = repositorio();
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    return NextResponse.json(await datosDeWebinar(donde.repo, donde.modo, id), SIN_CACHE);
  } catch (e) {
    if (e instanceof ErrorSinTablas) {
      return NextResponse.json({
        configurado: Boolean(tokenDelLector()), tablas: false, modo: donde.modo, lector: null, grupos: [], dentro: [], salieron: {}, contactados: {},
        generado: new Date().toISOString(),
      }, SIN_CACHE);
    }
    return respuestaDeError(e, "whatsapp/webinar");
  }
}

export async function POST(peticion: Request) {
  const leido = await leerJson(peticion, 10_000);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });
  const a = leerAccion(leido.json);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 });

  const noPuede = await exigirArea(peticion, ["webinars"], a.accion.accion === "contactado" ? 1 : 2);
  if (noPuede) return noPuede;

  const donde = repositorio();
  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  const { repo, modo } = donde;
  try {
    const x = a.accion;
    if (x.accion === "atar" || x.accion === "soltar") {
      const r = await repo.atarGrupo(x.grupoId, x.accion === "atar" ? x.webinarId : null);
      if (r === "sin-grupo") return NextResponse.json({ error: "Ese grupo no está entre los que detectó el lector." }, { status: 404 });
      if (r === "sin-webinar") return NextResponse.json({ error: "Ese webinar no existe." }, { status: 404 });
      return NextResponse.json({ ok: true }, SIN_CACHE);
    }
    if (!x.contactado) {
      await repo.borrarMarca(x.webinarId, x.personaId);
      return NextResponse.json({ ok: true, marca: null }, SIN_CACHE);
    }
    /* Quién: el correo de la sesión. Sin sesión (la app local), lo que diga la pantalla. */
    const marca = {
      webinarId: x.webinarId, personaId: x.personaId,
      por: correoDe(peticion) ?? (modo === "prueba-local" ? x.por ?? null : null),
      en: new Date().toISOString(),
    };
    await repo.guardarMarca(marca);
    return NextResponse.json({ ok: true, marca: { por: marca.por, en: marca.en } }, SIN_CACHE);
  } catch (e) {
    if (e instanceof ErrorSinTablas) return NextResponse.json({ error: e.message, tablas: false }, { status: 503 });
    return respuestaDeError(e, "whatsapp/webinar");
  }
}
