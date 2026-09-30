"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSesion } from "./auth";
import { nube } from "./supabase";

/* ==================================================================
   Las preferencias de cada usuario: cómo le gusta ver la app, no datos
   del negocio. Hoy, qué métricas del Dashboard se ven y en qué orden
   ("que yo, como usuario, pueda dejar guardado que se oculten algunas
   filas", Yari 29/09).

   Van a la tabla `preferencias` (supabase/preferencias.sql), una fila por
   usuario y clave: lo que alguien oculta en su compu lo ve oculto también
   en otra. El navegador guarda una copia por usuario para arrancar sin
   esperar a la base; sin nube, o si la tabla todavía no existe, es lo
   único que hay.
   ================================================================== */

const enNavegador = (clave: string, uid: string | null) => `apicanta:pref:${clave}:${uid ?? "local"}`;

function leerLocal(k: string): unknown {
  try { return JSON.parse(localStorage.getItem(k) ?? "null"); } catch { return null; }
}

function escribirLocal(k: string, v: unknown) {
  try {
    if (v === null) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch { /* modo privado */ }
}

/* Si la tabla no está (el SQL todavía no se corrió), no se insiste en
   esta visita: queda sólo en el navegador. */
let sinTabla = false;
const faltaTabla = (error: { code?: string } | null) => error?.code === "PGRST205" || error?.code === "42P01";

function subir(uid: string, clave: string, valor: unknown) {
  if (!nube || sinTabla) return;
  void nube.from("preferencias")
    .upsert({ userId: uid, clave, valor, actualizadoEn: new Date().toISOString() }, { onConflict: "userId,clave" })
    .then(({ error }) => { if (faltaTabla(error)) sinTabla = true; });
}

function sacar(uid: string, clave: string) {
  if (!nube || sinTabla) return;
  void nube.from("preferencias").delete().eq("userId", uid).eq("clave", clave)
    .then(({ error }) => { if (faltaTabla(error)) sinTabla = true; });
}

/** Una preferencia del usuario que está usando la app. `validar` tiene que
    ser una función fija (de módulo): devuelve el valor si tiene la forma
    esperada, o null. `claveVieja` es dónde se guardaba antes sólo en el
    navegador: se adopta una vez y pasa a ser del usuario. */
export function usePreferencia<T>(clave: string, validar: (x: unknown) => T | null, claveVieja?: string) {
  const { session, cargando } = useSesion();
  const uid = session?.user?.id ?? null;
  const [valor, setValor] = useState<T | null>(null);
  /* Lo que se toca en esta visita no lo pisa lo que llega después de la base. */
  const tocado = useRef(false);
  const espera = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (cargando) return;
    tocado.current = false;
    let local = validar(leerLocal(enNavegador(clave, uid)));
    if (local === null && claveVieja) {
      local = validar(leerLocal(claveVieja));
      if (local !== null) {
        escribirLocal(enNavegador(clave, uid), local);
        escribirLocal(claveVieja, null);
      }
    }
    setValor(local);
    if (!nube || !uid || sinTabla) return;
    let vivo = true;
    void nube.from("preferencias").select("valor").eq("userId", uid).eq("clave", clave).maybeSingle()
      .then(({ data, error }) => {
        if (!vivo || tocado.current) return;
        if (error) { if (faltaTabla(error)) sinTabla = true; return; }
        const deLaBase = data ? validar(data.valor) : null;
        if (deLaBase !== null) {
          setValor(deLaBase);
          escribirLocal(enNavegador(clave, uid), deLaBase);
        } else if (local !== null) {
          /* Primera vez con la base: lo de este navegador pasa a ser del usuario. */
          subir(uid, clave, local);
        }
      });
    return () => { vivo = false; };
  }, [clave, claveVieja, uid, cargando, validar]);

  const guardar = useCallback((v: T) => {
    tocado.current = true;
    setValor(v);
    escribirLocal(enNavegador(clave, uid), v);
    if (!uid) return;
    /* Arrastrando una fila se guarda muchas veces seguidas: a la base va
       la última. Si se cambia de pantalla antes, igual sale. */
    window.clearTimeout(espera.current);
    espera.current = window.setTimeout(() => subir(uid, clave, v), 600);
  }, [clave, uid]);

  const borrar = useCallback(() => {
    tocado.current = true;
    setValor(null);
    escribirLocal(enNavegador(clave, uid), null);
    window.clearTimeout(espera.current);
    if (uid) sacar(uid, clave);
  }, [clave, uid]);

  return { valor, guardar, borrar };
}
