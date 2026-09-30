"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useSesion } from "./auth";
import { ACCESO_DUENO, TIPOS_POR_DEFECTO, type MiAcceso } from "./permisos";
import type { RolEquipo, TipoCuenta } from "./types";
import { useSelector } from "./store";
import { hayNube, nube } from "./supabase";

/* ==================================================================
   Quién ve qué.

   Cada persona que entra tiene un tipo de cuenta (`usuarios_permitidos.rol`
   es el id de un `tipos_cuenta`): Dueño, Todo menos honorarios, Director
   comercial, Closer, Setter, Administración, Marketing, o los que agreguen
   los dueños. La pantalla le pregunta a la base con `mi_acceso()`, que lee
   lo MISMO que las políticas de RLS: una sola regla, no dos que se puedan
   desalinear. Esconder el menú es comodidad; lo que protege es la base.

   Sin nube la app corre local, sin login: quien la usa es el dueño, salvo
   que se elija «Ver como…» (sólo en local, para probar cada tipo). Ahí se
   ven el menú y los permisos de ese tipo, pero no se recorta lo suyo: eso
   lo hace la base, y en local no hay base.
   ================================================================== */

export type NivelAcceso = string;

/* Una sola pregunta por usuario y por carga de la página. */
const pedidos = new Map<string, Promise<MiAcceso | null>>();

function acceso(json: unknown): MiAcceso | null {
  const x = json as Partial<MiAcceso> | null;
  if (!x || typeof x.tipo !== "string") return null;
  return {
    tipo: x.tipo, nombre: String(x.nombre ?? x.tipo),
    areas: (x.areas && typeof x.areas === "object" ? x.areas : {}) as MiAcceso["areas"],
    soloLoSuyo: Boolean(x.soloLoSuyo), miembroId: typeof x.miembroId === "string" ? x.miembroId : undefined,
  };
}

function pedirAcceso(email: string): Promise<MiAcceso | null> {
  const ya = pedidos.get(email);
  if (ya) return ya;
  const p = (async () => {
    if (!nube) return ACCESO_DUENO;
    const r = await nube.rpc("mi_acceso");
    if (!r.error) return acceso(r.data);
    /* Una base sin supabase/tipos-cuenta.sql: los dos niveles de antes. */
    const n = await nube.rpc("nivel_acceso");
    if (n.error) return null;
    if (n.data === "dueno") return ACCESO_DUENO;
    if (n.data === "equipo") return { ...ACCESO_DUENO, tipo: "equipo", nombre: "Todo menos honorarios" };
    return null;
  })();
  pedidos.set(email, p);
  p.catch(() => pedidos.delete(email));
  return p;
}

/* ---------- «Ver como…», sólo en la app local ---------- */

const CLAVE_VER_COMO = "apicanta:ver-como";
let verComo: string | null | undefined;
const oyentesVerComo = new Set<() => void>();

function leerVerComo(): string | null {
  if (hayNube) return null;
  if (verComo === undefined) {
    try { verComo = typeof window === "undefined" ? null : window.localStorage.getItem(CLAVE_VER_COMO); } catch { verComo = null; }
  }
  return verComo ?? null;
}

export function elegirVerComo(tipo: string | null) {
  if (hayNube) return;
  verComo = tipo;
  try {
    if (tipo) window.localStorage.setItem(CLAVE_VER_COMO, tipo);
    else window.localStorage.removeItem(CLAVE_VER_COMO);
  } catch { /* modo privado */ }
  oyentesVerComo.forEach((f) => f());
}

export function useVerComo(): string | null {
  return useSyncExternalStore(
    (f) => { oyentesVerComo.add(f); return () => { oyentesVerComo.delete(f); }; },
    leerVerComo, () => null,
  );
}

/** Quién está usando la app y qué puede: su tipo, sus áreas y si ve sólo lo suyo. */
export function useAcceso(): { acceso: MiAcceso | null; esDueno: boolean; cargando: boolean } {
  const sesion = useSesion();
  const email = sesion.email?.toLowerCase() ?? null;
  const [estado, setEstado] = useState<{ email: string | null; acceso: MiAcceso | null }>({ email: null, acceso: null });
  const tipos = useSelector((e) => e.tiposCuenta);
  const como = useVerComo();

  useEffect(() => {
    if (!hayNube || !email) return;
    let vivo = true;
    pedirAcceso(email).then(
      (a) => { if (vivo) setEstado({ email, acceso: a }); },
      () => { if (vivo) setEstado({ email, acceso: null }); },
    );
    return () => { vivo = false; };
  }, [email]);

  const local = useMemo<MiAcceso>(() => {
    const t = como ? tipos.find((x) => x.id === como) : undefined;
    if (!t || t.id === "dueno") return ACCESO_DUENO;
    return { tipo: t.id, nombre: t.nombre, areas: t.areas, soloLoSuyo: t.soloLoSuyo };
  }, [como, tipos]);

  if (!hayNube) return { acceso: local, esDueno: local.tipo === "dueno", cargando: false };
  const alDia = estado.email === email;
  const a = alDia ? estado.acceso : null;
  return { acceso: a, esDueno: a?.tipo === "dueno", cargando: sesion.cargando || (Boolean(email) && !alDia) };
}

/** Los tipos de cuenta, en su orden. Sin la tabla, los de siempre. */
export function useTiposCuenta(): TipoCuenta[] {
  const tipos = useSelector((e) => e.tiposCuenta);
  return useMemo(
    () => [...(tipos?.length ? tipos : TIPOS_POR_DEFECTO)].sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es")),
    [tipos],
  );
}

/** El tipo que corresponde a su rol en las ventas, para proponerlo al dar
    acceso. Nunca Dueño: eso se elige a mano. */
export function tipoSugerido(rol: RolEquipo | undefined): string {
  switch (rol) {
    case "closer": return "closer";
    case "setter": return "setter";
    case "director": return "director";
    case "growth": return "marketing";
    default: return "equipo";
  }
}

/* Lo de siempre: si es dueño. */
export function useNivelAcceso(): { nivel: NivelAcceso | null; esDueno: boolean; cargando: boolean } {
  const { acceso: a, esDueno, cargando } = useAcceso();
  return { nivel: a?.tipo ?? null, esDueno, cargando };
}

/* ---------- La lista de accesos ---------- */

export interface Acceso {
  email: string;
  nombre: string;
  /* El id del tipo de cuenta. */
  rol: string;
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
      rol: String(x.rol ?? "equipo"),
      creadoEn: String(x.creadoEn ?? ""),
    })));
  }, []);

  useEffect(() => { if (activo) void recargar(); }, [recargar, activo]);

  /* Dar acceso o cambiar el nivel. La base sólo se lo deja hacer a un dueño. */
  const guardar = useCallback(async (a: { email: string; nombre: string; rol: string }): Promise<string | null> => {
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
export async function generarClave(a: { email: string; nombre: string; rol: string }): Promise<{ clave?: string; error?: string }> {
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
