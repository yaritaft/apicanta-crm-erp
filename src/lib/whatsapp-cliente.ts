"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { cabeceras } from "@/components/webinars/useYoutube";
import { esSinAcceso, estadoDelLector, proximaPregunta, QR_VIGENTE_SEG, sinCodigoVencido, type RespuestaEstado, type RespuestaWebinar } from "./whatsapp";

/* ==================================================================
   WhatsApp de lectura, del lado de la pantalla.

   Todo pasa por /api/whatsapp/* (con la sesión de quien mira): la pantalla
   no lee las tablas directo. Dos cosas:

   - `useLector`: cómo está el lector y qué grupos detectó. Se comparte entre
     todas las pantallas que lo piden (el aviso de Webinars y del Dashboard,
     Ajustes, la ficha de un webinar): una sola consulta por minuto, y sólo
     mientras alguien lo está mirando.
   - `useGrupoDeWebinar`: los grupos atados a un webinar y quién está adentro.
     Se vuelve a pedir cada tanto mientras la ficha está abierta.
   ================================================================== */

export class ErrorWhatsapp extends Error {
  constructor(mensaje: string, public estado: number) { super(mensaje); }
}

async function pedir<T>(ruta: string, cuerpo?: object): Promise<T> {
  let r: Response;
  try {
    r = await fetch(ruta, {
      method: cuerpo ? "POST" : "GET", cache: "no-store",
      headers: { ...(await cabeceras()), ...(cuerpo ? { "Content-Type": "application/json" } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
  } catch {
    throw new ErrorWhatsapp("No hay conexión con la app.", 0);
  }
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new ErrorWhatsapp(typeof j.error === "string" ? j.error : `Error ${r.status}`, r.status);
  return j as T;
}

/* ---------- El lector, compartido ---------- */

export interface VistaLector {
  cargando: boolean;
  datos: RespuestaEstado | null;
  error: string | null;
  /** Su tipo de cuenta no ve los Webinars (o no inició sesión): no se vuelve a preguntar. */
  sinAcceso: boolean;
}

const INICIAL: VistaLector = { cargando: true, datos: null, error: null, sinAcceso: false };
let vista: VistaLector = INICIAL;
const oyentes = new Set<() => void>();
let reloj: ReturnType<typeof setTimeout> | undefined;
let enCurso: Promise<void> | null = null;

/* Con un lector funcionando se mira cada minuto; sin ninguno (no se configuró,
   o falta algo), cada cinco: sólo por si alguien lo configura mientras tanto. */
const CADA_MS = 60_000;
const CADA_SIN_LECTOR_MS = 5 * 60_000;

function poner(v: VistaLector) {
  vista = v;
  oyentes.forEach((f) => f());
}

export function recargarLector(): Promise<void> {
  if (enCurso) return enCurso;
  enCurso = (async () => {
    try {
      const datos = await pedir<RespuestaEstado>("/api/whatsapp/estado");
      poner({ cargando: false, datos, error: null, sinAcceso: false });
    } catch (e) {
      const err = e as ErrorWhatsapp;
      poner({ cargando: false, datos: vista.datos, error: err.message, sinAcceso: esSinAcceso(err.estado) });
    } finally {
      enCurso = null;
    }
  })();
  return enCurso;
}

function programar() {
  clearTimeout(reloj);
  if (oyentes.size === 0 || vista.sinAcceso) return;
  reloj = setTimeout(async () => {
    if (typeof document === "undefined" || !document.hidden) await recargarLector();
    programar();
  }, vista.datos?.lector ? CADA_MS : CADA_SIN_LECTOR_MS);
}

const alVolver = () => { if (!document.hidden && oyentes.size > 0 && !vista.sinAcceso) void recargarLector(); };

function suscribir(f: () => void) {
  oyentes.add(f);
  if (oyentes.size === 1) {
    document.addEventListener("visibilitychange", alVolver);
    void recargarLector().then(programar);
  }
  return () => {
    oyentes.delete(f);
    if (oyentes.size === 0) {
      clearTimeout(reloj);
      document.removeEventListener("visibilitychange", alVolver);
    }
  };
}

/** Cómo está el lector y qué grupos detectó. `activo` en falso (quien no ve los
    Webinars) no pregunta nada. */
export function useLector(activo = true): VistaLector & { recargar: () => Promise<void> } {
  const v = useSyncExternalStore(activo ? suscribir : sinSuscribir, () => vista, () => INICIAL);
  return { ...(activo ? v : { ...INICIAL, cargando: false }), recargar: recargarLector };
}
const sinSuscribir = () => () => {};

/* ---------- El lector en vivo, para vincular el número ---------- */

/** Para Ajustes → WhatsApp: cómo está el lector y, si quien mira puede verlo (es dueño o edita Ajustes) y el
    lector lo está esperando, el código QR para vincular el número. Se vuelve a preguntar cada 3 o 4 segundos
    mientras no está conectado (el código cambia cada ~20) y cada 20 conectado, y sólo mientras la pantalla está
    abierta; tras un 401 o 403 deja de insistir (un botón vuelve a preguntar). El código es una credencial: no se
    guarda en ningún lado, vive en este estado, y vence acá también: sin una respuesta buena en un minuto se saca. */
export function useLectorEnVivo(activo = true) {
  const [datos, setDatos] = useState<RespuestaEstado | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [cargando, setCargando] = useState(true);
  const pidiendo = useRef(false);
  const ultimo = useRef<RespuestaEstado | null>(null);
  const sinAccesoRef = useRef(false);
  const recibidoEn = useRef(0);
  const venceElCodigo = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const reprogramar = useRef<() => void>(() => {});

  const recargar = useCallback(async () => {
    if (pidiendo.current) return;
    pidiendo.current = true;
    try {
      const d = await pedir<RespuestaEstado>("/api/whatsapp/estado?qr=1");
      ultimo.current = d;
      recibidoEn.current = Date.now();
      setDatos(d);
      setError(null);
      sinAccesoRef.current = false;
      setSinAcceso(false);
      /* Si no llega otra respuesta buena en un minuto, el código se saca solo (un poco después, para no quedar antes de la hora). */
      clearTimeout(venceElCodigo.current);
      if (d.qr) venceElCodigo.current = setTimeout(() => setDatos((x) => sinCodigoVencido(x, recibidoEn.current, Date.now())), QR_VIGENTE_SEG * 1000 + 100);
    } catch (e) {
      const err = e as ErrorWhatsapp;
      setError(err.message);
      sinAccesoRef.current = esSinAcceso(err.estado);
      setSinAcceso(sinAccesoRef.current);
      /* Sin acceso (la sesión venció o le sacaron el permiso) no queda nada de lo último que se vio, código incluido. */
      if (sinAccesoRef.current) {
        clearTimeout(venceElCodigo.current);
        ultimo.current = null;
        setDatos(null);
      }
    } finally {
      pidiendo.current = false;
      setCargando(false);
    }
  }, []);

  /** Volver a preguntar a mano; si estaba quieto por un 401 o 403, vuelve a mirar solo si ahora anda. */
  const recargarYSeguir = useCallback(async () => {
    await recargar();
    reprogramar.current();
  }, [recargar]);

  useEffect(() => {
    if (!activo) return;
    let vivo = true;
    let reloj: ReturnType<typeof setTimeout> | undefined;
    const programar = () => {
      clearTimeout(reloj);
      /* Sin acceso no se insiste: ni cada minuto ni cada 3,5 segundos. */
      const conectado = estadoDelLector(ultimo.current?.lector, Date.now()).tipo === "conectado";
      const espera = proximaPregunta(sinAccesoRef.current, conectado);
      if (!vivo || espera === null) return;
      reloj = setTimeout(() => void ciclo(), espera);
    };
    const ciclo = async () => {
      if (!document.hidden) await recargar();
      programar();
    };
    reprogramar.current = programar;
    const alVolver = () => { if (!document.hidden && !sinAccesoRef.current) void recargar(); };
    document.addEventListener("visibilitychange", alVolver);
    void ciclo();
    return () => { vivo = false; clearTimeout(reloj); clearTimeout(venceElCodigo.current); reprogramar.current = () => {}; document.removeEventListener("visibilitychange", alVolver); };
  }, [activo, recargar]);

  return { datos, error, sinAcceso, cargando, recargar: recargarYSeguir };
}

/** La hora de ahora, que se refresca sola: para que «hace 14 minutos» siga contando. */
export function useAhora(cadaMs = 30_000): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), cadaMs);
    return () => clearInterval(t);
  }, [cadaMs]);
  return ahora;
}

/** Atar un grupo a un webinar (o soltarlo, con `null`) desde cualquier pantalla. */
export async function atarGrupoAWebinar(grupoId: string, webinarId: string | null): Promise<void> {
  await pedir("/api/whatsapp/webinar", webinarId ? { accion: "atar", grupoId, webinarId } : { accion: "soltar", grupoId });
  await recargarLector();
}

/* ---------- Los grupos de un webinar ---------- */

const CADA_GRUPO_MS = 45_000;

/** Los grupos atados a un webinar y quién está adentro de alguno. Sin webinar
    (`null`: una fecha del Excel que no es de ningún webinar de la app) no
    pregunta nada. */
export function useGrupoDeWebinar(webinarId: string | null) {
  const [datos, setDatos] = useState<RespuestaWebinar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sinAcceso, setSinAcceso] = useState(false);
  const [cargando, setCargando] = useState(Boolean(webinarId));
  /* Lo que llega de un webinar anterior (cambió el link) no se muestra en éste. */
  const vigente = useRef(webinarId);
  vigente.current = webinarId;

  const recargar = useCallback(async () => {
    if (!webinarId) return;
    try {
      const d = await pedir<RespuestaWebinar>(`/api/whatsapp/webinar?id=${encodeURIComponent(webinarId)}`);
      if (vigente.current !== webinarId) return;
      setDatos(d);
      setError(null);
      setSinAcceso(false);
    } catch (e) {
      if (vigente.current !== webinarId) return;
      const err = e as ErrorWhatsapp;
      setError(err.message);
      setSinAcceso(esSinAcceso(err.estado));
    } finally {
      if (vigente.current === webinarId) setCargando(false);
    }
  }, [webinarId]);

  /* Sin acceso no se insiste. */
  const sinAccesoRef = useRef(false);
  sinAccesoRef.current = sinAcceso;

  useEffect(() => {
    setDatos(null);
    setError(null);
    setCargando(Boolean(webinarId));
    if (!webinarId) return;
    void recargar();
    const t = setInterval(() => { if (!document.hidden && !sinAccesoRef.current) void recargar(); }, CADA_GRUPO_MS);
    return () => clearInterval(t);
  }, [recargar, webinarId]);

  /** Este grupo es de este webinar. */
  const atar = useCallback(async (grupoId: string) => {
    if (!webinarId) return;
    await pedir("/api/whatsapp/webinar", { accion: "atar", grupoId, webinarId });
    await Promise.all([recargar(), recargarLector()]);
  }, [recargar, webinarId]);

  /** Este grupo deja de ser de ningún webinar. */
  const soltar = useCallback(async (grupoId: string) => {
    await pedir("/api/whatsapp/webinar", { accion: "soltar", grupoId });
    await Promise.all([recargar(), recargarLector()]);
  }, [recargar]);

  return { datos, error, sinAcceso, cargando, recargar, atar, soltar };
}
