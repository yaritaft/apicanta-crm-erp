"use client";

import { useCallback, useEffect, useState } from "react";
import { useSesion } from "./auth";
import { hayNube, nube } from "./supabase";

/* ==================================================================
   Quién ve qué.

   Dos niveles, en `usuarios_permitidos.rol`: 'dueno' ve todo, incluido
   Equipo y honorarios; 'equipo' ve todo lo demás. La pantalla le pregunta
   a la base con `nivel_acceso()`, la MISMA función que usan las políticas
   de RLS de honorarios y liquidaciones: una sola regla, no dos que se
   puedan desalinear. Esconder el menú es comodidad; lo que protege los
   sueldos es la base.

   Sin nube la app corre local, sin login: quien la usa es el dueño.
   ================================================================== */

export type NivelAcceso = "dueno" | "equipo";

export const NIVELES: { valor: NivelAcceso; texto: string; sub: string }[] = [
  { valor: "equipo", texto: "Equipo", sub: "Ve toda la app menos Equipo y honorarios." },
  { valor: "dueno", texto: "Dueño", sub: "Ve todo, incluido lo que cobra cada uno, y da accesos." },
];

/* Una sola pregunta por usuario y por carga de la página. */
const pedidos = new Map<string, Promise<NivelAcceso | null>>();

function pedirNivel(email: string): Promise<NivelAcceso | null> {
  const ya = pedidos.get(email);
  if (ya) return ya;
  const p = (async () => {
    if (!nube) return "dueno" as const;
    const r = await nube.rpc("nivel_acceso");
    /* Sin la función (el SQL no corrió) nadie es dueño: la sección no
       aparece, que es lo seguro. */
    if (r.error) return null;
    return r.data === "dueno" || r.data === "equipo" ? r.data : null;
  })();
  pedidos.set(email, p);
  p.catch(() => pedidos.delete(email));
  return p;
}

export function useNivelAcceso(): { nivel: NivelAcceso | null; esDueno: boolean; cargando: boolean } {
  const sesion = useSesion();
  const email = sesion.email?.toLowerCase() ?? null;
  const [estado, setEstado] = useState<{ email: string | null; nivel: NivelAcceso | null }>({ email: null, nivel: null });

  useEffect(() => {
    if (!hayNube || !email) return;
    let vivo = true;
    pedirNivel(email).then(
      (nivel) => { if (vivo) setEstado({ email, nivel }); },
      () => { if (vivo) setEstado({ email, nivel: null }); },
    );
    return () => { vivo = false; };
  }, [email]);

  if (!hayNube) return { nivel: "dueno", esDueno: true, cargando: false };
  const alDia = estado.email === email;
  const nivel = alDia ? estado.nivel : null;
  return { nivel, esDueno: nivel === "dueno", cargando: sesion.cargando || (Boolean(email) && !alDia) };
}

/* ---------- La lista de accesos ---------- */

export interface Acceso {
  email: string;
  nombre: string;
  rol: NivelAcceso;
  creadoEn: string;
}

const normalEmail = (s: string) => s.trim().toLowerCase();
export const emailValido = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());

/* La lista vive en la base y no en el store: la escriben sólo los dueños y
   se lee acá, cuando se abre la sección. */
export function useAccesos(activo = true) {
  const [lista, setLista] = useState<Acceso[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const recargar = useCallback(async () => {
    if (!nube) { setLista([]); return; }
    const r = await nube.from("usuarios_permitidos").select("*").order("creadoEn", { ascending: true });
    if (r.error) { setError(r.error.message); return; }
    setError(null);
    setLista((r.data ?? []).map((x) => ({
      email: normalEmail(String(x.email ?? "")),
      nombre: String(x.nombre ?? ""),
      rol: x.rol === "dueno" ? "dueno" : "equipo",
      creadoEn: String(x.creadoEn ?? ""),
    })));
  }, []);

  useEffect(() => { if (activo) void recargar(); }, [recargar, activo]);

  /* Dar acceso o cambiar el nivel. La base sólo se lo deja hacer a un dueño. */
  const guardar = useCallback(async (a: { email: string; nombre: string; rol: NivelAcceso }): Promise<string | null> => {
    if (!nube) return "Sin base configurada: la app corre en este navegador y no pide login.";
    const r = await nube.from("usuarios_permitidos").upsert(
      { email: normalEmail(a.email), nombre: a.nombre.trim(), rol: a.rol },
      { onConflict: "email" },
    );
    if (r.error) return traducir(r.error.message);
    await recargar();
    return null;
  }, [recargar]);

  const quitar = useCallback(async (email: string): Promise<string | null> => {
    if (!nube) return "Sin base configurada.";
    const r = await nube.from("usuarios_permitidos").delete().eq("email", normalEmail(email));
    if (r.error) return traducir(r.error.message);
    await recargar();
    return null;
  }, [recargar]);

  return { lista, error, recargar, guardar, quitar };
}

function traducir(m: string): string {
  if (/al menos un due/i.test(m)) return "Tiene que quedar al menos un dueño con acceso.";
  if (/row-level security|permission denied/i.test(m)) return "Sólo un dueño puede dar o quitar accesos.";
  return m;
}

/* Una clave nueva para entrar con correo y clave. La arma el servidor (con
   la clave de servicio de Supabase, que nunca llega al navegador) y se
   muestra una sola vez: no queda guardada en ningún lado de la app. */
export async function generarClave(a: { email: string; nombre: string; rol: NivelAcceso }): Promise<{ clave?: string; error?: string }> {
  if (!nube) return { error: "Sin base configurada: la app corre en este navegador y no pide login." };
  const { data } = await nube.auth.getSession();
  const jwt = data.session?.access_token;
  if (!jwt) return { error: "Tu sesión venció: volvé a entrar." };
  try {
    const r = await fetch("/api/accesos", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
      body: JSON.stringify({ email: normalEmail(a.email), nombre: a.nombre.trim(), rol: a.rol }),
    });
    const j = (await r.json().catch(() => ({}))) as { clave?: string; error?: string };
    if (!r.ok || !j.clave) return { error: j.error ?? "No se pudo generar la clave." };
    return { clave: j.clave };
  } catch {
    return { error: "No hay conexión con el servidor." };
  }
}
