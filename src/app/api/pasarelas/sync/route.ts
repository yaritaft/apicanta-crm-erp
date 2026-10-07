import { NextResponse } from "next/server";
import { nivelDelPedido } from "@/lib/permisos-servidor";
import { descartarAnuladosMercury, guardarMovimientos, guardarPuntas, guardarReembolsos, hayServidor, referenciasCompletas } from "@/lib/servidor";
import { resumenVacio } from "@/lib/mercury";
import { hayClaves, listar, procesadorDe, PROVEEDORES, retirosDeStripe, type MovimientoApi } from "@/lib/pasarelas-api";
import type { ReembolsoCrudo } from "@/lib/reembolsos";
import type { Punta } from "@/lib/traspasos";
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

   De paso junta lo que NO es un cobro pero pasó por las cuentas: la plata
   que se movió entre cuentas propias (el depósito de Stripe en Mercury, un
   retiro de Stripe). Son las puntas de los movimientos entre cuentas de la
   Caja (lib/traspasos.ts): viajan en la respuesta y, al guardar, se atan
   entre sí y con los que ya estaban cargados.

   También junta lo que las pasarelas dicen que DEVOLVIERON a un cliente
   (Stripe, Hotmart, Whop): no son cobros, son las devoluciones que informa la
   pasarela (lib/reembolsos.ts). Viajan en la respuesta y, al guardar, se atan
   a la devolución que alguien ya cargó o quedan como propuesta para confirmar
   (nunca restan plata solas).

   Con ?solo=pases se pregunta sólo eso: a las cuentas que ven pasar plata
   entre cuentas (Mercury, los retiros de Stripe), sin traer los cobros.
   Es lo que usa «Buscar en las cuentas» de la Caja, con ?guardar=1: guarda
   el servidor, que parte de lo que hay en la base ahora y no de lo que
   cargó hace un rato el navegador de quien pide (`pasesGuardados`).
   ================================================================== */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* Quien pide desde la pantalla de Conciliación manda su sesión de
   Supabase. Se le pregunta a la base qué nivel tiene en Finanzas, con la
   MISMA función que usan las políticas de RLS (lib/permisos-servidor):
   una sola regla para decidir quién ve la plata, no dos que se puedan
   desalinear. Ver, Finanzas; guardar, Finanzas editable. */

/* Las que ven la plata moverse entre cuentas propias. */
const VEN_PASES: ProveedorPasarela[] = ["mercury", "stripe"];

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
  const conCredencial = esCron || !secreto || url.searchParams.get("token") === secreto;
  const nivel = conCredencial ? 2 : (await nivelDelPedido(peticion, ["finanzas"])) ?? -1;
  if (nivel < 0) {
    return NextResponse.json({ error: "Hace falta iniciar sesión para ver los cobros." }, { status: 401 });
  }
  if (nivel < 1) {
    return NextResponse.json({ error: "Tu tipo de cuenta no ve los cobros de las pasarelas." }, { status: 403 });
  }
  const soloPases = url.searchParams.get("solo") === "pases";
  const quiereGuardar = esCron || url.searchParams.get("guardar") === "1";
  if (quiereGuardar && nivel < 2) {
    return NextResponse.json({
      error: soloPases ? "Tu tipo de cuenta no puede guardar movimientos entre cuentas." : "Tu tipo de cuenta no puede guardar cobros.",
    }, { status: 403 });
  }

  const movimientos: MovimientoApi[] = [];
  const puntas: Punta[] = [];
  const reembolsos: ReembolsoCrudo[] = [];
  /* Lo que Mercury trae y no es un cobro: pending, internos y anulados (lib/mercury.ts). */
  const mercury = resumenVacio();
  const conectadas: ProveedorPasarela[] = [];
  const errores: { proveedor: string; mensaje: string }[] = [];

  /* Whop manda quién pagó y la comisión en el detalle de cada pago, un
     pedido por cobro: se pide sólo para los que en la base están incompletos. */
  const completosWhop = !soloPases && hayClaves("whop") ? await referenciasCompletas("whop") : null;

  await Promise.all(PROVEEDORES.map(async (proveedor) => {
    if (!hayClaves(proveedor)) return;
    if (soloPases && !VEN_PASES.includes(proveedor)) return;
    conectadas.push(proveedor);
    const avisos: string[] = [];
    /* Los cobros de Stripe no dicen nada de los pases: sólo sus retiros. */
    if (!soloPases || proveedor !== "stripe") {
      try {
        const cobros = await listar(proveedor, desde, hasta, {
          avisos, puntas, mercury, reembolsos: soloPases ? undefined : reembolsos,
          necesitaDetalle: proveedor === "whop" && completosWhop ? (m) => !completosWhop.has(m.referencia) : undefined,
        });
        if (!soloPases) movimientos.push(...cobros);
      } catch (err) {
        errores.push({ proveedor, mensaje: err instanceof Error ? err.message : "Error desconocido." });
      }
    }
    /* Los retiros de Stripe al banco, aparte: si la clave no los deja ver,
       los cobros entran igual. Sólo cuando se van a usar (el cron y la
       Caja): quien sincroniza cobros desde Conciliación no tiene por qué
       esperar otro pedido ni ver un aviso de algo que no pidió. */
    if (proveedor === "stripe" && (soloPases || quiereGuardar)) {
      try {
        puntas.push(...await retirosDeStripe(desde));
      } catch (err) {
        avisos.push(`No se pudieron ver los retiros al banco: ${err instanceof Error ? err.message : "error desconocido"}`);
      }
    }
    for (const mensaje of avisos) errores.push({ proveedor, mensaje });
  }));

  movimientos.sort((a, b) => +new Date(b.fecha) - +new Date(a.fecha));

  let guardados = 0;
  let completados = 0;
  if (quiereGuardar && hayServidor && !soloPases) {
    const r = await guardarMovimientos(movimientos.map((m) => ({
      ...m, procesadorId: procesadorDe(m.proveedor), origen: "api",
    })));
    guardados = r.guardados;
    completados = r.completados;
    if (r.error) errores.push({ proveedor: "supabase", mensaje: r.error });
  }

  /* Lo que Mercury anuló y ya había entrado a la bandeja sin conciliar: se
     descarta solo. Sin guardar, lo hace la pantalla con `mercury.anulados`. */
  let anuladosDescartados = 0;
  if (quiereGuardar && hayServidor && !soloPases && mercury.anulados.length > 0) {
    const r = await descartarAnuladosMercury(mercury.anulados);
    anuladosDescartados = r.descartados;
    if (r.error) errores.push({ proveedor: "supabase", mensaje: r.error });
  }

  /* Lo que devolvieron las pasarelas: se guarda con el mismo permiso. Sin la
     tabla de devoluciones todavía, no es un error: queda sólo en la respuesta
     y lo guarda la pantalla. */
  let reembolsosGuardados = false;
  if (quiereGuardar && hayServidor && !soloPases && reembolsos.length) {
    const r = await guardarReembolsos(reembolsos);
    reembolsosGuardados = !r.error && !r.sinTabla;
    if (r.error) errores.push({ proveedor: "supabase", mensaje: r.error });
  }

  /* Los movimientos entre cuentas: se guardan con el mismo permiso. Sin su
     tabla todavía, no es un error: quedan sólo en la respuesta. */
  let pases = { nuevos: 0, conciliados: 0 };
  /* Si quedaron guardados acá: si no (falta la tabla, o el servidor no tiene
     cómo escribir), los ata y los guarda la pantalla con `puntas`. */
  let pasesGuardados = false;
  if (quiereGuardar && hayServidor) {
    const r = await guardarPuntas(puntas);
    pases = { nuevos: r.nuevos, conciliados: r.conciliados };
    pasesGuardados = !r.error && !r.sinTabla;
    if (r.error) errores.push({ proveedor: "supabase", mensaje: r.error });
  }

  return NextResponse.json({
    conectadas,
    errores,
    guardados,
    completados,
    pases,
    pasesGuardados,
    reembolsos,
    reembolsosGuardados,
    mercury,
    anuladosDescartados,
    desde: desde.toISOString(),
    movimientos,
    puntas,
  });
}
