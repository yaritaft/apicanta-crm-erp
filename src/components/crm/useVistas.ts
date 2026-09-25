"use client";

import { useCallback, useEffect, useState } from "react";
import type { ClaveCampo, Condicion, Orden, VistaCrm } from "@/lib/crm";
import type { CampoOpcionesCrm } from "@/lib/types";
import type { AltoFila } from "./Grilla";

/* ==================================================================
   Lo que cada persona cambia de una vista (qué columnas ve y en qué
   orden, los anchos, filtros, orden, agrupar, color y alto de fila) y
   las vistas que se crea. Vive en su navegador, como las columnas de
   Leads: es una preferencia de quien mira, no un dato del negocio. Si
   se guardara en la base, el setter moviendo una columna se la movería
   a todo el equipo.
   ================================================================== */

export interface AjusteVista {
  filtros?: Condicion[];
  conjuncion?: "y" | "o";
  orden?: Orden[];
  ocultos?: ClaveCampo[];
  columnas?: ClaveCampo[];
  anchos?: Record<string, number>;
  alto?: AltoFila;
  agrupar?: ClaveCampo | null;
  color?: CampoOpcionesCrm | null;
}

export type VistaPropia = VistaCrm & AjusteVista & { propia: true };

const leer = <T,>(clave: string, porDefecto: T): T => {
  try {
    const s = localStorage.getItem(clave);
    return s ? (JSON.parse(s) as T) : porDefecto;
  } catch { return porDefecto; }
};
const escribir = (clave: string, valor: unknown) => {
  try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* modo privado */ }
};

export function useVistasGuardadas(tabla: string) {
  const claveAjustes = `apicanta:crm:${tabla}:vistas`;
  const clavePropias = `apicanta:crm:${tabla}:propias`;
  const [ajustes, setAjustes] = useState<Record<string, AjusteVista>>({});
  const [propias, setPropias] = useState<VistaPropia[]>([]);
  const [listo, setListo] = useState(false);

  /* Después del montado: el servidor no tiene localStorage. */
  useEffect(() => {
    setAjustes(leer(claveAjustes, {}));
    setPropias(leer(clavePropias, []));
    setListo(true);
  }, [claveAjustes, clavePropias]);

  /* Una vista propia guarda sus cambios en ella misma; una de las armadas,
     aparte (y se puede restablecer). */
  const cambiar = useCallback((vistaId: string, parcial: AjusteVista, esPropia: boolean) => {
    if (esPropia) {
      setPropias((ps) => {
        const nuevas = ps.map((v) => (v.id === vistaId ? { ...v, ...parcial } : v));
        escribir(clavePropias, nuevas);
        return nuevas;
      });
      return;
    }
    setAjustes((a) => {
      const nuevo = { ...a, [vistaId]: { ...(a[vistaId] ?? {}), ...parcial } };
      escribir(claveAjustes, nuevo);
      return nuevo;
    });
  }, [claveAjustes, clavePropias]);

  const restablecer = useCallback((vistaId: string) => {
    setAjustes((a) => {
      const { [vistaId]: _fuera, ...resto } = a;
      void _fuera;
      escribir(claveAjustes, resto);
      return resto;
    });
  }, [claveAjustes]);

  const crear = useCallback((v: VistaPropia) => {
    setPropias((ps) => { const n = [...ps, v]; escribir(clavePropias, n); return n; });
  }, [clavePropias]);

  const renombrar = useCallback((id: string, nombre: string) => {
    setPropias((ps) => { const n = ps.map((v) => (v.id === id ? { ...v, nombre } : v)); escribir(clavePropias, n); return n; });
  }, [clavePropias]);

  const borrar = useCallback((id: string) => {
    setPropias((ps) => { const n = ps.filter((v) => v.id !== id); escribir(clavePropias, n); return n; });
    restablecer(id);
  }, [clavePropias, restablecer]);

  return { ajustes, propias, listo, cambiar, restablecer, crear, renombrar, borrar };
}

/* Lo que se recuerda aparte: la última vista de cada tabla, si la barra
   de vistas está abierta y qué secciones están plegadas. */
export function usePreferencia<T>(clave: string, porDefecto: T): [T, (v: T) => void] {
  const [valor, setValor] = useState<T>(porDefecto);
  useEffect(() => { setValor(leer(`apicanta:crm:${clave}`, porDefecto)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [clave]);
  const cambiar = useCallback((v: T) => { setValor(v); escribir(`apicanta:crm:${clave}`, v); }, [clave]);
  return [valor, cambiar];
}
