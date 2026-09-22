import { createClient } from "@supabase/supabase-js";
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

/* Quien pide desde la pantalla de Conciliación manda su sesión de
   Supabase. Se le pregunta a la base si puede entrar, con la MISMA
   función que usan las políticas de RLS: una sola regla para decidir
   quién ve la plata, no dos que se puedan desalinear. */
async function esDelEquipo(peticion: Request): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonima = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const jwt = peticion.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!url || !anonima || !jwt) return false;

  const db = createClient(url, anonima, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const r = await db.rpc("puede_entrar");
  return !r.error && r.data === true;
}

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

  /* El cron corre sin sesión: se identifica con su propio secreto en la
     cabecera. Que escriba no depende de ningún parámetro en la URL — un
     query string que se pierda por el camino dejaría al cron corriendo
     de gusto, sin guardar nada y sin que nadie se entere. */
  const cronSecreto = process.env.CRON_SECRET;
  const esCron = Boolean(cronSecreto)
    && peticion.headers.get("authorization") === `Bearer ${cronSecreto}`;

  /* Esta ruta devuelve cobros con nombre, correo y monto de cada cliente:
     sin credencial no contesta nada. Pasa el cron, el token de las
     pasarelas, o una persona del equipo con su sesión. Sin secreto
     configurado (desarrollo local) queda abierta. */
  const secreto = process.env.PASARELAS_WEBHOOK_TOKEN;
  const autorizado = esCron
    || !secreto
    || url.searchParams.get("token") === secreto
    || await esDelEquipo(peticion);
  if (!autorizado) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para ver los cobros." }, { status: 401 });
  }
  const quiereGuardar = esCron || url.searchParams.get("guardar") === "1";

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
  if (quiereGuardar && hayServidor) {
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
