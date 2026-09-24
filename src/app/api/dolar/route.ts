import { NextResponse } from "next/server";
import { esDelEquipo, hayEquipoConfigurado } from "@/lib/equipo-servidor";
import type { CotizacionBlue } from "@/lib/dolar";

/* ==================================================================
   El dólar blue, venta, para el tipo de cambio de un cobro en pesos.

   Si el cobro es de hoy, el de DolarHoy en el momento: se lee de su
   página (no tiene API), y si la página cambió o no contesta, de
   DolarApi, que publica el mismo número. Si el cobro es de otro día, el
   cierre de ese día de ArgentinaDatos; un sábado, domingo o feriado no
   cotiza, así que se toma el último día hábil anterior.

   Queda en cache: el de hoy cinco minutos, uno histórico un día. El
   closer puede cambiarlo en el cobro, y el cobro guarda los dos.
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CINCO_MIN = 5 * 60 * 1000;
const UN_DIA = 24 * 60 * 60 * 1000;
const cache = new Map<string, { hasta: number; cotizacion: CotizacionBlue }>();

/* "$1.560" o "$1.560,50" → 1560 / 1560.5 */
function pesos(texto: string): number {
  const limpio = texto.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  return Number(limpio);
}

/* Hoy en Argentina, YYYY-MM-DD. */
function hoyArgentina(): string {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
}

async function pedir(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; Apicanta ERP)" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
}

async function deDolarHoy(): Promise<CotizacionBlue | null> {
  const r = await pedir("https://dolarhoy.com/");
  if (!r.ok) return null;
  const html = await r.text();
  /* El recuadro "Dólar blue" de la portada: Compra, Venta y cuándo se
     actualizó. Se busca por el link a su página, que es lo más estable. */
  const i = html.indexOf('href="/cotizaciondolarblue"');
  if (i < 0) return null;
  const bloque = html.slice(i, i + 2500);
  const venta = bloque.match(/class="venta"[\s\S]*?class="val">\s*([^<]+)</);
  const compra = bloque.match(/class="compra"[\s\S]*?class="val">\s*([^<]+)</);
  const cuando = bloque.match(/Actualizado por última vez:\s*([^<]+)</);
  const v = venta ? pesos(venta[1]) : NaN;
  if (!(v > 0)) return null;
  return {
    venta: v, compra: compra ? pesos(compra[1]) : undefined,
    fecha: hoyArgentina(), fuente: "DolarHoy", actualizado: cuando?.[1].trim(),
  };
}

async function deDolarApi(): Promise<CotizacionBlue | null> {
  const r = await pedir("https://dolarapi.com/v1/dolares/blue");
  if (!r.ok) return null;
  const j = await r.json() as { venta?: number; compra?: number; fechaActualizacion?: string };
  if (!(Number(j.venta) > 0)) return null;
  return {
    venta: Number(j.venta), compra: Number(j.compra) || undefined,
    fecha: hoyArgentina(), fuente: "DolarApi", actualizado: j.fechaActualizacion,
  };
}

async function deArgentinaDatos(dia: string): Promise<CotizacionBlue | null> {
  const d = new Date(`${dia}T12:00:00Z`);
  for (let atras = 0; atras < 7; atras++) {
    const f = new Date(d.getTime() - atras * UN_DIA).toISOString().slice(0, 10);
    const r = await pedir(`https://api.argentinadatos.com/v1/cotizaciones/dolares/blue/${f.replaceAll("-", "/")}`);
    if (r.status === 404) continue;
    if (!r.ok) return null;
    const j = await r.json() as { venta?: number; compra?: number; fecha?: string };
    if (Number(j.venta) > 0) {
      return {
        venta: Number(j.venta), compra: Number(j.compra) || undefined,
        fecha: j.fecha ?? f, fuente: "ArgentinaDatos", actualizado: `cierre del ${f.split("-").reverse().join("/")}`,
      };
    }
  }
  return null;
}

export async function GET(peticion: Request) {
  if (hayEquipoConfigurado() && !(await esDelEquipo(peticion))) {
    return NextResponse.json({ error: "Hace falta iniciar sesión." }, { status: 401 });
  }
  const pedido = new URL(peticion.url).searchParams.get("fecha");
  const hoy = hoyArgentina();
  const dia = pedido && /^\d{4}-\d{2}-\d{2}$/.test(pedido) && pedido < hoy ? pedido : hoy;

  const guardado = cache.get(dia);
  if (guardado && guardado.hasta > Date.now()) return NextResponse.json(guardado.cotizacion);

  let cotizacion: CotizacionBlue | null = null;
  try {
    cotizacion = dia === hoy
      ? (await deDolarHoy().catch(() => null)) ?? (await deDolarApi())
      : await deArgentinaDatos(dia);
  } catch {
    cotizacion = null;
  }
  if (!cotizacion) {
    return NextResponse.json({ error: "No pude traer el dólar blue. Cargá el tipo de cambio a mano." }, { status: 502 });
  }
  cache.set(dia, { hasta: Date.now() + (dia === hoy ? CINCO_MIN : UN_DIA), cotizacion });
  return NextResponse.json(cotizacion);
}
