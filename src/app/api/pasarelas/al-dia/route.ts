import { NextResponse } from "next/server";
import { exigirArea } from "@/lib/permisos-servidor";
import { hayServidor, nubeServidor } from "@/lib/servidor";
import { leerEstado, traerCobrosAhora } from "@/lib/cobros-al-dia-servidor";
import { PASARELAS_A_PEDIDO, SEGUNDOS_ENTRE_PEDIDOS } from "@/lib/pasarelas-estado";
import { hayClaves } from "@/lib/pasarelas-api";
import type { ProveedorPasarela } from "@/lib/types";

/* ==================================================================
   «Buscar pagos nuevos» del selector de pagos: le pregunta ahora a esa
   pasarela por los cobros de los últimos 3 días y guarda los nuevos (sin
   pisar lo conciliado). Después la pantalla vuelve a traer los cobros de
   la base y el que acaba de entrar ya se puede elegir.

   Lo puede pedir quien carga ventas o ve Finanzas (el closer incluido:
   carga la venta con este selector). Contesta sólo cifras y fechas, nunca
   datos de clientes: los cobros los lee cada uno de la base, con su
   permiso. Si recién se revisó (hace menos de 20 segundos), contesta con
   esa revisión en vez de volver a pegarle a la pasarela.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(peticion: Request) {
  const sinPermiso = await exigirArea(peticion, ["ventas", "finanzas"], 2, { cerrado: true });
  if (sinPermiso) return sinPermiso;
  const cuerpo = ((await peticion.json().catch(() => null)) ?? {}) as { proveedor?: unknown };
  const proveedor = (typeof cuerpo === "object" && typeof cuerpo.proveedor === "string" ? cuerpo.proveedor : "") as ProveedorPasarela;
  if (!PASARELAS_A_PEDIDO.includes(proveedor)) {
    return NextResponse.json({ error: "Esa pasarela no se puede revisar desde acá." }, { status: 400 });
  }
  if (!hayClaves(proveedor)) {
    return NextResponse.json({ error: "Esa pasarela no está conectada: faltan sus claves." }, { status: 409 });
  }
  const db = nubeServidor();
  if (!hayServidor || !db) return NextResponse.json({ error: "Sin base." }, { status: 503 });

  const previo = await leerEstado(db, proveedor);
  const t = Date.parse(previo?.revisadoEn ?? "");
  if (previo && !previo.error && Number.isFinite(t) && Date.now() - t < SEGUNDOS_ENTRE_PEDIDOS * 1000) {
    return NextResponse.json({ ok: true, nuevos: 0, reciente: true, estado: previo }, { headers: { "Cache-Control": "no-store" } });
  }
  const [r] = await traerCobrosAhora([proveedor], { dias: 3, fuente: "pantalla" });
  return NextResponse.json(
    { ok: r?.ok ?? false, nuevos: r?.nuevos ?? 0, error: r?.error, estado: r?.estado ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
