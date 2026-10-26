import { nube } from "./supabase";

/* ==================================================================
   «Pedir acceso» desde la app (Juan Cruz, 26/10): Santiago y Agustín le
   escribieron por WhatsApp para pedir el CRM y poder cambiar datos de
   leads. La pantalla sin permiso decía «pediselo a los dueños» y no daba
   cómo. Ahora el pedido sale de ahí mismo y le llega a cada dueño en la
   campanita (supabase/pedir-acceso.sql: la función de la base arma los
   avisos; el navegador no puede escribirlos a mano).
   ================================================================== */

export interface PedidoDeAcceso {
  /** Cómo se llama lo que pide, para el aviso: «CRM», «las ventas». */
  pantalla: string;
  /** La ruta o la tabla de la que viene: con ella un mismo pedido del día no se repite. */
  ruta: string;
  /** «ver» si no la tiene; «editar» si la tiene sólo para mirar o la base le rechazó un cambio. */
  quiere: "ver" | "editar";
  mensaje?: string;
}

export type ResultadoPedido = { ok: true; avisados: number } | { ok: false; error: string };

export function traducirPedido(m: string): string {
  if (/no est[aá] entre los accesos/i.test(m)) return "Tu correo no está entre los accesos a la app: pedile a un dueño que te dé de alta.";
  if (/Entr[aá] con tu cuenta/i.test(m)) return "Tu sesión venció: volvé a entrar y probá de nuevo.";
  if (/pedir_acceso/i.test(m) && /(not find|does not exist|schema cache)/i.test(m)) return "Todavía no está listo en la base. Avisale a un dueño por WhatsApp.";
  return "No se pudo mandar el pedido. Probá de nuevo o avisale a un dueño.";
}

/** Le avisa a los dueños. Sin base (la app local, sin login) no hay a quién: se da por hecho, como el resto de la app local. */
export async function pedirAcceso(p: PedidoDeAcceso): Promise<ResultadoPedido> {
  if (!nube) return { ok: true, avisados: 0 };
  const r = await nube.rpc("pedir_acceso", {
    p_pantalla: p.pantalla, p_ruta: p.ruta, p_quiere: p.quiere, p_mensaje: p.mensaje?.trim() || null,
  });
  if (r.error) return { ok: false, error: traducirPedido(r.error.message) };
  return { ok: true, avisados: typeof r.data === "number" ? r.data : 0 };
}
