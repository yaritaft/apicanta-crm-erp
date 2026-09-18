"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertCircle, Check, Cloud, HardDrive, LogOut, Menu, Moon, RefreshCw, Search, Sun, X } from "lucide-react";
import { NAV } from "./nav";
import { cargarDeLaNube, hayNube, reiniciarCarga, useEstado, useSync, useTema } from "@/lib/store";
import { useSalir, useSesion } from "@/lib/auth";
import { Avatar, Button, IconButton } from "@/components/ui/ui";
import { Paleta } from "./Paleta";
import { Tour } from "./Tour";

export function Shell({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const estado = useEstado();
  const [tema, setTema] = useTema();
  const sync = useSync();
  const sesion = useSesion();
  const salir = useSalir();
  const [menu, setMenu] = useState(false);
  const [paleta, setPaleta] = useState(false);

  useEffect(() => {
    /* Si cambia el usuario, los datos se vuelven a pedir con su sesion. */
    reiniciarCarga();
    void cargarDeLaNube();
  }, [sesion.email]);

  useEffect(() => { setMenu(false); }, [ruta]);

  useEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); setPaleta(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const contadores: Record<string, number> = {
    "/leads": estado.leads.length,
    "/alumnos": estado.alumnos.filter((a) => a.estado === "activo").length,
    "/agenda": estado.sesiones.filter((s) => s.estado === "agendada" && new Date(s.inicia) >= new Date()).length,
    "/webinars": estado.webinars.length,
  };

  const item = NAV.flatMap((g) => g.items).find((i) => ruta === i.href || ruta.startsWith(i.href + "/"));

  return (
    <div className="app-shell">
      {menu && (
        <div
          onClick={() => setMenu(false)}
          style={{ position: "fixed", inset: 0, zIndex: 35, background: "var(--overlay)" }}
        />
      )}

      <nav className="hk-sidebar" data-abierto={menu} aria-label="Navegación principal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <Link href="/panel" className="hk-sidebar__brand" style={{ padding: "8px 12px" }}>
            Apicanta<em>.</em>
          </Link>
          <IconButton etiqueta="Cerrar menú" onClick={() => setMenu(false)} className="sidebar-toggle">
            <X size={18} />
          </IconButton>
        </div>

        <div className="hk-sidebar__nav">
          {NAV.map((g) => (
            <div key={g.titulo}>
              <div className="hk-sidebar__group">{g.titulo}</div>
              <ul className="hk-nav">
                {g.items.map((i) => {
                  const activo = ruta === i.href || ruta.startsWith(i.href + "/");
                  const Ico = i.icono;
                  return (
                    <li key={i.href}>
                      <Link href={i.href} aria-current={activo ? "page" : undefined} title={i.ayuda}>
                        <Ico />
                        <span>{i.texto}</span>
                        {contadores[i.href] !== undefined && contadores[i.href] > 0 && (
                          <span className="hk-nav__count">{contadores[i.href]}</span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="hk-sidebar__footer">
          <EstadoDatos estado={sync.estado} error={sync.error} />
          <div className="row-3">
            <Avatar nombre={estado.ajustes.responsable || "Apicanta"} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="t-strong truncate" style={{ fontSize: 14 }}>{estado.ajustes.responsable || "Apicanta"}</div>
              <div className="t-sm t-subtle truncate">{sesion.email ?? estado.ajustes.negocio}</div>
            </div>
            {!sesion.sinAuth && (
              <IconButton etiqueta="Cerrar sesión" onClick={() => { void salir(); }}>
                <LogOut size={17} />
              </IconButton>
            )}
            <IconButton
              etiqueta={tema === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"}
              onClick={() => setTema(tema === "dark" ? "light" : "dark")}
            >
              {tema === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </IconButton>
          </div>
        </div>
      </nav>

      <div className="app-main">
        <header className="app-topbar">
          <IconButton etiqueta="Abrir menú" onClick={() => setMenu(true)} className="sidebar-toggle">
            <Menu size={20} />
          </IconButton>
          <div className="app-topbar__title">
            <span className="t-strong truncate" style={{ fontSize: 15 }}>{item?.texto ?? "Apicanta"}</span>
            <span className="t-sm t-subtle truncate">{item?.ayuda ?? ""}</span>
          </div>
          <div className="app-topbar__actions">
            <Button sm variante="secondary" icono={<Search size={16} />} onClick={() => setPaleta(true)}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Buscar
                <kbd>⌘K</kbd>
              </span>
            </Button>
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      <Paleta abierto={paleta} onCerrar={() => setPaleta(false)} />
      <Tour />
    </div>
  );
}

/* Dice de un vistazo donde estan los datos y si se guardaron. */
function EstadoDatos({ estado, error }: { estado: ReturnType<typeof useSync>["estado"]; error: string }) {
  const info = {
    local:     { ico: <HardDrive size={13} />, texto: "Guardado en este navegador", color: "var(--ink-subtle)" },
    cargando:  { ico: <RefreshCw size={13} />, texto: "Trayendo tus datos…",        color: "var(--ink-subtle)" },
    guardando: { ico: <RefreshCw size={13} />, texto: "Guardando…",                 color: "var(--brand)" },
    listo:     { ico: <Check size={13} />,     texto: "Todo guardado en la nube",   color: "var(--success)" },
    error:     { ico: <AlertCircle size={13} />, texto: "No se pudo guardar",       color: "var(--danger)" },
  }[estado];

  return (
    <div
      className="row"
      style={{ gap: 6, marginBottom: "var(--space-3)", color: info.color, fontSize: 12 }}
      title={error || (hayNube ? "Sincroniza con Supabase" : "Sin base configurada: los datos viven en este navegador")}
    >
      {info.ico}
      <span className="truncate">{info.texto}</span>
      {hayNube && estado !== "error" && <Cloud size={13} style={{ marginLeft: "auto", opacity: 0.6 }} />}
    </div>
  );
}
