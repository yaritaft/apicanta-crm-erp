import { NextResponse } from "next/server";
import { guardarMovimientos, hayServidor } from "@/lib/servidor";
import { hayClaves, listar, procesadorDe, PROVEEDORES, type MovimientoApi } from "@/lib/pasarelas-api";
import type { ProveedorPasarela } from "@/lib/types";

/* ==================================================================
   Traer los cobros de las pasarelas.

   Cada pasarela se conecta sola si están sus claves en el entorno; la
   que no las tenga se saltea sin romper nada, y el front sigue pudiendo
   importar el CSV a mano. Un proveedor que falla tampoco tumba a los
   demás: su error viaja en la respuesta y se muestra tal cual.

   Con ?guardar=1 además los escribe en la base. Es lo que llama el cron
   de Vercel como red de seguridad: si un webhook se perdió, en la
   próxima pasada el cobro entra igual.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Ventana por defecto: 60 días. Alcanza para las cuotas del mes y para
   las que se atrasaron, sin traer años de historia en cada click. */
function desdeHasta(url: URL) {
  const dias = Number(url.searchParams.get("dias") ?? 60);
  const hasta = new Date();
  const desde = new Date(hasta.getTime() - Math.min(Math.max(dias, 1), 365) * 86400000);
  return { desde, hasta };
}

export async function GET(peticion: Request) {
  const url = new URL(peticion.url);
  const { desde, hasta } = desdeHasta(url);

  /* El cron corre sin sesión: para que escriba hay que decirle el
     secreto. Sin eso, cualquiera podría llenar la base desde afuera. */
  const quiereGuardar = url.searchParams.get("guardar") === "1";
  const secreto = process.env.PASARELAS_WEBHOOK_TOKEN;
  const autorizado = !secreto
    || url.searchParams.get("token") === secreto
    || peticion.headers.get("authorization") === `Bearer ${process.env.CRON_SECRET ?? secreto}`;

  const movimientos: MovimientoApi[] = [];
  const conectadas: ProveedorPasarela[] = [];
  const errores: { proveedor: string; mensaje: string }[] = [];

  await Promise.all(PROVEEDORES.map(async (proveedor) => {
    if (!hayClaves(proveedor)) return;
    conectadas.push(proveedor);
    try {
      movimientos.push(...await listar(proveedor, desde, hasta));
    } catch (err) {
      errores.push({ proveedor, mensaje: err instanceof Error ? err.message : "Error desconocido." });
    }
  }));

  movimientos.sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));

  let guardados = 0;
  if (quiereGuardar && autorizado && hayServidor) {
    const r = await guardarMovimientos(movimientos.map((m) => ({
      ...m, procesadorId: procesadorDe(m.proveedor), origen: "api",
    })));
    guardados = r.guardados;
    if (r.error) errores.push({ proveedor: "supabase", mensaje: r.error });
  }

  return NextResponse.json({
    conectadas,
    errores,
    guardados,
    desde: desde.toISOString(),
    movimientos,
  });
}
