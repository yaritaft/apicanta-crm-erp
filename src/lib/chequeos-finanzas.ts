"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { nube } from "./supabase";
import { useUsuarioActual } from "./usuario";
import { crearAlmacen, type ClienteChequeos, type Disco } from "./chequeos-almacen";
import type { Chequeos } from "./finanzas-pasos";
import type { Chequeo } from "./cierre-mes";

/* ==================================================================
   Lo que se tilda en Finanzas (la weekly, revisar Slack, la auditoría de
   softwares y el cierre del día de Aldana): el gancho de React sobre el almacén
   común (lib/chequeos-almacen.ts, donde está toda la lógica y sus pruebas).
   ================================================================== */

const LOCAL = "apicanta:chequeos-finanzas";
const disco: Disco = {
  leer: (): Chequeos => { try { return JSON.parse(localStorage.getItem(LOCAL) ?? "{}") as Chequeos; } catch { return {}; } },
  escribir: (c) => { try { localStorage.setItem(LOCAL, JSON.stringify(c)); } catch { /* modo privado */ } },
};

/* Uno solo para toda la pantalla: el menú, los pasos y el End of Day ven lo mismo. */
const almacen = crearAlmacen(nube as unknown as ClienteChequeos | null, disco);

export function useChequeos(activo = true): {
  chequeos: Chequeos; cargando: boolean;
  marcar: (clave: string, nota?: string, estado?: string) => void; desmarcar: (clave: string) => void;
  /* Si la base rechazó el último cambio: el texto para avisar (y limpiarlo después). */
  error: string | null; limpiarError: () => void;
} {
  const yo = useUsuarioActual();
  const { chequeos, cargando, error } = useSyncExternalStore(almacen.suscribir, almacen.obtener, almacen.obtener);

  useEffect(() => {
    /* Una cuenta que no ve Finanzas (un closer) no pide nada: la base le devolvería vacío. */
    if (!activo) return;
    void almacen.iniciar();
    /* Lo que tildó otra persona aparece al volver a esta pestaña; y lo que tildó otra pestaña de este navegador (sin la tabla), al instante. */
    const alVolver = () => { if (document.visibilityState === "visible") void almacen.traer(); };
    const alCambiarElDisco = (ev: StorageEvent) => { if (ev.key === LOCAL) almacen.alCambiarElDisco(); };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("storage", alCambiarElDisco);
    return () => { document.removeEventListener("visibilitychange", alVolver); window.removeEventListener("storage", alCambiarElDisco); };
  }, [activo]);

  const marcar = useCallback((clave: string, nota?: string, estado?: string) => {
    const c: Chequeo = { por: yo.nombre, en: new Date().toISOString(), ...(nota ? { nota } : {}), ...(estado ? { estado } : {}) };
    void almacen.marcar(clave, c);
  }, [yo.nombre]);
  const desmarcar = useCallback((clave: string) => { void almacen.desmarcar(clave); }, []);
  const limpiarError = useCallback(() => almacen.limpiarError(), []);

  return { chequeos, cargando: activo ? cargando : false, marcar, desmarcar, error, limpiarError };
}
