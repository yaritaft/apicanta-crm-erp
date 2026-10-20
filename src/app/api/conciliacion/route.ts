import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { nubeServidor } from "@/lib/servidor";
import { buscar, candidatos, contactosConFormulario, estadoDelCruce, noEs, unir } from "@/lib/conciliacion-servidor";
import type { MetodoCruce } from "@/lib/registros-webinar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* ==================================================================
   Conciliación del origen: lo que necesita la pantalla «Pendientes de
   conciliar» (Marketing y Finanzas) de la tabla de formularios, sin darle a
   quien concilia acceso a las decenas de miles de filas.

   Una sola ruta con una acción en el cuerpo:
     · unidos      — de estos contactos, cuáles ya tienen un formulario unido
     · candidatos  — los formularios sin unir que se parecen a estas personas
     · buscar      — la búsqueda a mano (mail, teléfono o nombre)
     · estado      — cuándo corrió el cruce automático y qué hizo
     · unir        — unir un formulario con un contacto            (pide editar)
     · noes        — «no es esta persona», no se vuelve a proponer  (pide editar)

   Se contesta a quien tenga Finanzas, Marketing o Webinars (el mayor nivel
   de los tres) y no sea de los que ven «sólo lo suyo» (el closer). Ver
   lib/permisos-servidor.ts: la misma función de nivel que usan las políticas.
   ================================================================== */

const MAX_LISTA = 800;
const CRUCES = new Set<MetodoCruce>(["mail", "telefono", "nombre", "manual"]);

const textos = (x: unknown, tope = MAX_LISTA): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200).slice(0, tope) : [];
const texto = (x: unknown): string => (typeof x === "string" ? x.trim().slice(0, 200) : "");

export async function POST(peticion: Request) {
  const cuerpo = (await peticion.json().catch(() => null)) as Record<string, unknown> | null;
  const accion = texto(cuerpo?.accion);
  const escribe = accion === "unir" || accion === "noes";

  const noPuede = await exigirArea(peticion, ["finanzas", "marketing", "webinars"], escribe ? 2 : 1, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const db = nubeServidor();
  if (!db) return NextResponse.json({ error: "Falta configurar la base en el servidor (SUPABASE_SERVICE_ROLE_KEY)." }, { status: 503 });
  const c = cuerpo ?? {};

  try {
    switch (accion) {
      case "unidos":
        return NextResponse.json({ unidos: await contactosConFormulario(db, textos(c.contactoIds)) });
      case "candidatos":
        return NextResponse.json({ registros: await candidatos(db, { emails: textos(c.emails), telefonos: textos(c.telefonos), nombres: textos(c.nombres) }) });
      case "buscar":
        return NextResponse.json({ registros: await buscar(db, texto(c.q)) });
      case "estado":
        return NextResponse.json(await estadoDelCruce(db));
      case "unir": {
        const registroId = texto(c.registroId), contactoId = texto(c.contactoId), cruce = texto(c.cruce) as MetodoCruce;
        if (!registroId || !contactoId || !CRUCES.has(cruce)) return NextResponse.json({ error: "Faltan datos para unir." }, { status: 400 });
        const r = await unir(db, registroId, contactoId, cruce);
        return NextResponse.json(r.ok ? { registro: r.registro } : { error: r.error }, { status: r.ok ? 200 : 409 });
      }
      case "noes": {
        const registroId = texto(c.registroId), personaId = texto(c.personaId);
        if (!registroId || !personaId) return NextResponse.json({ error: "Faltan datos." }, { status: 400 });
        const r = await noEs(db, registroId, personaId);
        return NextResponse.json(r.ok ? { ok: true } : { error: r.error }, { status: r.ok ? 200 : 409 });
      }
      default:
        return NextResponse.json({ error: "Acción desconocida." }, { status: 400 });
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : "No se pudo consultar la base.";
    console.error("[api/conciliacion]", accion, error);
    return NextResponse.json({ error }, { status: 502 });
  }
}
