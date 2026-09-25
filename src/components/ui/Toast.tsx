"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Check, AlertCircle, Info } from "lucide-react";

type Tono = "ok" | "err" | "info";
/* Un botón en el aviso ("Cargar la venta"): el aviso dura más y se va al
   usarlo. */
export interface AccionAviso { texto: string; onClick: () => void }
interface Aviso { id: number; texto: string; tono: Tono; accion?: AccionAviso }

const Ctx = createContext<(texto: string, tono?: Tono, accion?: AccionAviso) => void>(() => {});

export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const sacar = useCallback((id: number) => setAvisos((a) => a.filter((x) => x.id !== id)), []);

  const push = useCallback((texto: string, tono: Tono = "ok", accion?: AccionAviso) => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tono, accion }]);
    window.setTimeout(() => sacar(id), accion ? 9000 : 3600);
  }, [sacar]);

  const valor = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={valor}>
      {children}
      <div className="toast-wrap" aria-live="polite">
        {avisos.map((a) => (
          <div key={a.id} className={`toast toast--${a.tono}`}>
            {a.tono === "ok" ? <Check size={18} color="var(--success)" />
              : a.tono === "err" ? <AlertCircle size={18} color="var(--danger)" />
              : <Info size={18} color="var(--brand)" />}
            <span>{a.texto}</span>
            {a.accion && (
              <button type="button" className="toast__accion" onClick={() => { a.accion!.onClick(); sacar(a.id); }}>
                {a.accion.texto}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
