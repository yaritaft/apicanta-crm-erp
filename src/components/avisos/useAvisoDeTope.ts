"use client";

import { useEffect, useMemo } from "react";
import { nube } from "@/lib/supabase";
import { diaDeNegocio } from "@/lib/dia-negocio";
import { topeDeCuentas } from "@/lib/tope-cuentas";
import type { EstadoApp } from "@/lib/types";

/* ==================================================================
   El aviso del tope de la Financiera en la campanita (Aldana, 19/11: «o que me llegue una notificación cuando eso esté excediendo el máximo»).

   La cuenta (lib/tope-cuentas.ts) es la de la pantalla de Saldos: vive en la app. Cuando alguien que ve Finanzas tiene la app abierta, con los datos
   ya traídos, y Financiera ARS + Financiera USD + dLocal pasan el tope, se llama a la función de la base `avisar_tope_de_cuentas`, que escribe UN aviso
   por persona de Finanzas y por día (supabase/aviso-tope-cuentas.sql). Acá se recuerda en el navegador qué total ya se avisó ese día, para no
   llamar en cada cambio de la pantalla.

   Lo que NO hace: avisar con la app cerrada. Mientras nadie la abre no hay quién calcule el saldo (la base no tiene esa cuenta); el rojo en Finanzas y
   en Saldos se ve apenas se entra.
   ================================================================== */

const clave = (dia: string) => `apicanta:tope-avisado:${dia}`;

export function useAvisoDeTope(e: EstadoApp, activo: boolean): void {
  /* Se recalcula cuando cambia algo que mueve el saldo, no con cada cambio de la pantalla. */
  const tope = useMemo(
    () => (activo ? topeDeCuentas(e, new Date().toISOString()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activo, e.pagos, e.gastos, e.traspasos, e.arqueos, e.procesadores, e.movimientos, e.devoluciones, e.ajustes],
  );
  const total = tope?.excede ? Math.round(tope.total) : 0;
  const limite = tope?.limite ?? 0;

  useEffect(() => {
    if (!nube || !total || !limite) return;
    const dia = diaDeNegocio(new Date().toISOString());
    try { if (localStorage.getItem(clave(dia)) === String(total)) return; } catch { /* sin almacenamiento: se avisa igual (la base no repite) */ }
    void nube.rpc("avisar_tope_de_cuentas", { p_total: total, p_limite: limite }).then((r) => {
      if (r.error) return;
      try { localStorage.setItem(clave(dia), String(total)); } catch { /* nada */ }
    });
  }, [total, limite]);
}
