"use client";

import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Check, AlertCircle, Info } from "lucide-react";

type Tono = "ok" | "err" | "info";
interface Aviso { id: number; texto: string; tono: Tono }

const Ctx = createContext<(texto: string, tono?: Tono) => void>(() => {});

export function useToast() { return useContext(Ctx); }

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  const push = useCallback((texto: string, tono: Tono = "ok") => {
    const id = Date.now() + Math.random();
    setAvisos((a) => [...a, { id, texto, tono }]);
    window.setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 3600);
  }, []);

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
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
