"use client";

import React from "react";
import { useSesion } from "@/lib/auth";
import { Login } from "./Login";

/* Decide que se ve: el login, la app, o nada mientras averigua si hay sesion.
   Sin Supabase configurado no hay puerta: la app corre local y entra directo. */
export function Puerta({ children }: { children: React.ReactNode }) {
  const sesion = useSesion();

  if (sesion.cargando) {
    return (
      <div className="login">
        <div className="login__caja" style={{ boxShadow: "none", background: "transparent", border: 0 }}>
          <div className="login__marca">Apicanta<em>.</em></div>
          <div className="skeleton" style={{ height: 10, width: 140, margin: "0 auto", borderRadius: 999 }} />
        </div>
      </div>
    );
  }

  if (!sesion.sinAuth && !sesion.session) return <Login />;

  return <>{children}</>;
}
