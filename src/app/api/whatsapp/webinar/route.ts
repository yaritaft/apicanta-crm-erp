import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import {
  datosDeWebinar, ErrorSinTablas, leerAccion, leerJson, repositorio, respuestaDeError, SIN_BASE, tokenDelLector,
} from "@/lib/whatsapp-servidor";

/* ==================================================================
   El grupo de WhatsApp de un webinar, para su ficha y para Formularios.

   GET ?id=<webinar>: los grupos atados a ese webinar, quién está adentro de
   alguno (las claves de los teléfonos) y quién salió. La pantalla lo cruza con
   la gente que se registró.

   POST { accion }:
   - «atar» { grupoId, webinarId }: el grupo es de ese webinar (puede haber
     varios grupos de un mismo webinar).
   - «soltar» { grupoId }: el grupo deja de ser de su webinar.

   Ver: quien ve los Webinars y no está limitado a lo suyo. Atar y soltar grupos: quien los edita. (Las
   marcas «Contactado» y «Unido» las lleva Formularios, en registros_webinar.)
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { headers: { "Cache-Control": "no-store" } };

export async function GET(peticion: Request) {
  const donde = repositorio();
  /* Quien ve sólo lo suyo no: esto sale de tablas que se leen con la clave de servicio (sin RLS) y trae los teléfonos de todos.
     Y en la nube nunca «la app local, sin login»: si la clave de servicio está pero falta el equipo, no se lee nada. */
  const noPuede = await exigirArea(peticion, ["webinars"], 1, { sinSoloLoSuyo: true, cerrado: donde?.modo === "nube" });
  if (noPuede) return noPuede;
  const id = new URL(peticion.url).searchParams.get("id")?.trim() ?? "";
  if (!/^[\w.:@+-]{1,160}$/.test(id)) return NextResponse.json({ error: "Falta el webinar (?id=…)." }, { status: 400 });

  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    return NextResponse.json(await datosDeWebinar(donde.repo, donde.modo, id), SIN_CACHE);
  } catch (e) {
    if (e instanceof ErrorSinTablas) {
      return NextResponse.json({
        configurado: Boolean(tokenDelLector()), tablas: false, modo: donde.modo, lector: null, grupos: [], dentro: [], salieron: {},
        generado: new Date().toISOString(),
      }, SIN_CACHE);
    }
    return respuestaDeError(e, "whatsapp/webinar");
  }
}

export async function POST(peticion: Request) {
  /* El permiso antes de leer el cuerpo: sin sesión no se le carga nada a la memoria. */
  const donde = repositorio();
  const noPuede = await exigirArea(peticion, ["webinars"], 2, { cerrado: donde?.modo === "nube" });
  if (noPuede) return noPuede;

  const leido = await leerJson(peticion, 10_000);
  if (!leido.ok) return NextResponse.json({ error: leido.error }, { status: leido.status });
  const a = leerAccion(leido.json);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: 400 });

  if (!donde) return NextResponse.json({ error: SIN_BASE }, { status: 503 });
  try {
    const x = a.accion;
    const r = await donde.repo.atarGrupo(x.grupoId, x.accion === "atar" ? x.webinarId : null);
    if (r === "sin-grupo") return NextResponse.json({ error: "Ese grupo no está entre los que detectó el lector." }, { status: 404 });
    if (r === "sin-webinar") return NextResponse.json({ error: "Ese webinar no existe." }, { status: 404 });
    return NextResponse.json({ ok: true }, SIN_CACHE);
  } catch (e) {
    if (e instanceof ErrorSinTablas) return NextResponse.json({ error: e.message, tablas: false }, { status: 503 });
    return respuestaDeError(e, "whatsapp/webinar");
  }
}
