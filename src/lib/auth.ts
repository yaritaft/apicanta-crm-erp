"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { hayNube, nube } from "./supabase";

export interface Sesion {
  cargando: boolean;
  session: Session | null;
  email: string | null;
  /* true cuando no hay nube: la app corre local y no pide login. */
  sinAuth: boolean;
}

export function useSesion(): Sesion {
  const [estado, setEstado] = useState<Sesion>({
    cargando: hayNube, session: null, email: null, sinAuth: !hayNube,
  });

  useEffect(() => {
    if (!nube) { setEstado({ cargando: false, session: null, email: null, sinAuth: true }); return; }

    let vivo = true;
    nube.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setEstado({
        cargando: false, session: data.session,
        email: data.session?.user?.email ?? null, sinAuth: false,
      });
    });

    const { data: sub } = nube.auth.onAuthStateChange((_evento, session) => {
      setEstado({
        cargando: false, session,
        email: session?.user?.email ?? null, sinAuth: false,
      });
    });

    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, []);

  return estado;
}

export function useSalir() {
  return useCallback(async () => {
    if (!nube) return;
    await nube.auth.signOut();
    /* Recarga limpia: el store vuelve a arrancar sin datos de la sesion anterior. */
    if (typeof window !== "undefined") window.location.href = "/";
  }, []);
}

export async function enviarMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!nube) return { ok: false, error: "No hay base configurada." };
  const { error } = await nube.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: {
      emailRedirectTo: typeof window !== "undefined" ? window.location.origin : undefined,
      /* Nadie se crea cuenta solo: los usuarios los damos de alta nosotros. */
      shouldCreateUser: true,
    },
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
