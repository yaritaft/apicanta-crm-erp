import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { clavePandadoc, detallePlantilla } from "@/lib/pandadoc-servidor";
import { variablesQueFaltan } from "@/lib/contratos";

/* ==================================================================
   GET ?ids=a,b,c: de cada plantilla de PandaDoc, qué variables clave NO tiene ([Venta.Modalidad], el nombre, el documento…).
   Lo usa Ajustes → Programas para avisar, al elegir la plantilla, que el monto que carga el closer no va a salir en el contrato
   (el Downsell lo tenía escrito a mano: «Un pago único de 500 USD», 26/10). Sólo lee. { revisadas: { [id]: string[] | null } }:
   null = no se pudo leer esa plantilla (no se avisa de lo que no se sabe).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(peticion: Request) {
  const noPuede = await exigirArea(peticion, ["ajustes"], 1, { cerrado: true });
  if (noPuede) return noPuede;
  const clave = clavePandadoc();
  if (!clave) return NextResponse.json({ revisadas: {}, modo: null }, { headers: { "Cache-Control": "no-store" } });
  const ids = [...new Set((new URL(peticion.url).searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9]{10,40}$/.test(x)))].slice(0, 20);
  const revisadas: Record<string, string[] | null> = {};
  await Promise.all(ids.map(async (id) => {
    revisadas[id] = await detallePlantilla(clave.modo, id).then((d) => variablesQueFaltan(d)).catch(() => null);
  }));
  return NextResponse.json({ revisadas, modo: clave.modo }, { headers: { "Cache-Control": "no-store" } });
}
