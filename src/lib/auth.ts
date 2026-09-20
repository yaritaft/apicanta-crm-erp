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

/* Supabase contesta en ingles y con mensajes que no dicen que hacer.
   Los dos primeros son los unicos que ve alguien del equipo en la practica. */
function enCastellano(mensaje: string): string {
  const m = mensaje.toLowerCase();
  if (m.includes("invalid login credentials")) return "Correo o clave incorrectos.";
  if (m.includes("email not confirmed")) return "El usuario existe pero falta confirmarlo desde Supabase.";
  if (m.includes("rate limit") || m.includes("too many")) return "Demasiados intentos seguidos. Esperá un minuto.";
  return mensaje;
}

/* Entrada con clave: no depende del correo, asi que no la afecta ni el limite
   de envios de Supabase ni a donde apunte el enlace del magic link. */
export async function entrarConClave(email: string, clave: string): Promise<{ ok: boolean; error?: string }> {
  if (!nube) return { ok: false, error: "No hay base configurada." };
  const { error } = await nube.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password: clave,
  });
  if (error) return { ok: false, error: enCastellano(error.message) };
  return { ok: true };
}
