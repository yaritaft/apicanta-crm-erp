import { NextResponse } from "next/server";
import { correoDelPedido, exigirArea } from "@/lib/permisos-servidor";
import { nubeServidor } from "@/lib/servidor";
import { avisarOrigen, buscar, candidatos, contactosConFormulario, estadoDelAvisoOrigen, estadoDelCruce, noEs, unir } from "@/lib/conciliacion-servidor";
import type { ResumenPendientes } from "@/lib/pendientes-conciliar";
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
     · aviso-origen   — a quién le llegaría el aviso y el último de ese mes
     · avisar-origen  — Finanzas le avisa al director               (pide editar)

   Se contesta a quien tenga Finanzas, Marketing, Webinars o Ventas (el mayor
   nivel de los cuatro) y no sea de los que ven «sólo lo suyo» (el closer): el
   director resuelve esto desde su panel (Aldana, 31/10). Ver
   lib/permisos-servidor.ts: la misma función de nivel que usan las políticas.
   ================================================================== */

const MAX_LISTA = 800;
const CRUCES = new Set<MetodoCruce>(["mail", "telefono", "nombre", "manual"]);

const textos = (x: unknown, tope = MAX_LISTA): string[] =>
  Array.isArray(x) ? x.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 200).slice(0, tope) : [];
const texto = (x: unknown): string => (typeof x === "string" ? x.trim().slice(0, 200) : "");
const esMes = (x: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(x);
const cantidad = (x: unknown) => { const n = Math.floor(Number(x)); return Number.isFinite(n) && n > 0 ? n : 0; };
const plata = (x: unknown) => { const n = Number(x); return Number.isFinite(n) && n > 0 ? n : 0; };
function resumenDe(x: unknown): ResumenPendientes {
  const r = (x ?? {}) as Record<string, unknown>;
  const m = (r.montos ?? {}) as Record<string, unknown>;
  const conVenta = cantidad(r.conVenta), soloAgenda = cantidad(r.soloAgenda);
  return { total: conVenta + soloAgenda, conVenta, soloAgenda, montos: { USD: plata(m.USD), ARS: plata(m.ARS) } };
}

export async function POST(peticion: Request) {
  const cuerpo = (await peticion.json().catch(() => null)) as Record<string, unknown> | null;
  const accion = texto(cuerpo?.accion);
  const escribe = accion === "unir" || accion === "noes" || accion === "avisar-origen";

  const noPuede = await exigirArea(peticion, ["finanzas", "marketing", "webinars", "ventas"], escribe ? 2 : 1, { sinSoloLoSuyo: true, cerrado: true });
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
      case "aviso-origen": {
        const mes = texto(c.mes);
        if (!esMes(mes)) return NextResponse.json({ error: "Falta el mes." }, { status: 400 });
        return NextResponse.json(await estadoDelAvisoOrigen(db, mes, correoDelPedido(peticion)));
      }
      case "avisar-origen": {
        const mes = texto(c.mes), resumen = resumenDe(c.resumen);
        if (!esMes(mes) || resumen.total === 0) return NextResponse.json({ error: "No hay nada para avisar de ese mes." }, { status: 400 });
        return NextResponse.json(await avisarOrigen(db, mes, resumen, correoDelPedido(peticion)));
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
