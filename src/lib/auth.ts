"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { hayNube, nube } from "./supabase";
import { olvidarCopiaLocal } from "./store";
import { anotarDestino, olvidarVistas } from "./recordarVistas";

export interface Sesion {
  cargando: boolean;
  session: Session | null;
  email: string | null;
  /* true cuando no hay nube: la app corre local y no pide login. */
  sinAuth: boolean;
}

/* La última sesión conocida. Cada componente que pregunta arrancaba «cargando, sin mail» aunque la sesión ya estuviera: el chat de la ficha,
   recién abierto, se creía «Yari Taft» (el responsable) un instante y anotaba el leído con ese nombre; la base lo rechaza (quien = tu mail) y
   salía «Tu tipo de cuenta no puede cambiar esto» (24/11). El que se monta después arranca con la que ya se sabe. En la primera carga no hay
   ninguna todavía: igual que el servidor, así no cambia lo que se hidrata. */
let conocida: Sesion | null = null;
const anotar = (s: Sesion): Sesion => { conocida = s; return s; };

export function useSesion(): Sesion {
  const [estado, setEstado] = useState<Sesion>(() => conocida ?? {
    cargando: hayNube, session: null, email: null, sinAuth: !hayNube,
  });

  useEffect(() => {
    if (!nube) { setEstado(anotar({ cargando: false, session: null, email: null, sinAuth: true })); return; }

    let vivo = true;
    nube.auth.getSession().then(({ data }) => {
      if (!vivo) return;
      setEstado(anotar({
        cargando: false, session: data.session,
        email: data.session?.user?.email ?? null, sinAuth: false,
      }));
    });

    const { data: sub } = nube.auth.onAuthStateChange((_evento, session) => {
      setEstado(anotar({
        cargando: false, session,
        email: session?.user?.email ?? null, sinAuth: false,
      }));
    });

    return () => { vivo = false; sub.subscription.unsubscribe(); };
  }, []);

  return estado;
}

export function useSalir() {
  return useCallback(async () => {
    if (!nube) return;
    /* La copia del navegador se va antes que la sesión: lo que vio este
       usuario no queda para el que entre después. */
    olvidarCopiaLocal();
    olvidarVistas();
    await nube.auth.signOut();
    /* Recarga limpia: el store vuelve a arrancar sin datos de la sesion anterior. */
    if (typeof window !== "undefined") window.location.href = "/";
  }, []);
}

export async function enviarMagicLink(email: string): Promise<{ ok: boolean; error?: string }> {
  if (!nube) return { ok: false, error: "No hay base configurada." };
  anotarDestino();
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
