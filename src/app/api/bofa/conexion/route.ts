import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { hayServidor } from "@/lib/servidor";
import { cambiarAutoCarga, conexion, desconectar, entornoDePlaid, ErrorDePlaid, plaidConfigurado, sinElPermiso } from "@/lib/plaid-servidor";

/* ==================================================================
   La conexión con Bank of America (Plaid): cómo está, apagar o prender la carga automática, desconectar.

     GET     → { configurado, entorno, hayBase, conexion: { institucion, cuentas, autoCargar, … } | null }   (nunca el permiso del banco)
     PATCH   { autoCargar: boolean }
     DELETE  → le avisa a Plaid y borra el permiso

   Ver el estado lo ve quien ve Finanzas; cambiar algo, quien puede editarlo. Detalle: lib/plaid-servidor.ts.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIN_CACHE = { "Cache-Control": "no-store" };
const fallo = (err: unknown, texto: string) =>
  NextResponse.json({ error: err instanceof Error ? err.message : texto }, { status: err instanceof ErrorDePlaid && err.status === 503 ? 503 : 502, headers: SIN_CACHE });

export async function GET(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 1, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const c = await conexion();
  return NextResponse.json(
    { configurado: plaidConfigurado(), entorno: entornoDePlaid(), hayBase: hayServidor, conexion: c ? sinElPermiso(c) : null },
    { headers: SIN_CACHE },
  );
}

export async function PATCH(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  const cuerpo = (await req.json().catch(() => ({}))) as { autoCargar?: unknown };
  if (typeof cuerpo.autoCargar !== "boolean") return NextResponse.json({ error: "Falta decir si se carga solo o no." }, { status: 400, headers: SIN_CACHE });
  try {
    await cambiarAutoCarga(cuerpo.autoCargar);
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (err) {
    return fallo(err, "No pude guardar el cambio.");
  }
}

export async function DELETE(req: Request) {
  const noPuede = await exigirArea(req, ["finanzas"], 2, { sinSoloLoSuyo: true, cerrado: true });
  if (noPuede) return noPuede;
  try {
    await desconectar();
    return NextResponse.json({ ok: true }, { headers: SIN_CACHE });
  } catch (err) {
    return fallo(err, "No pude desconectar el banco.");
  }
}
