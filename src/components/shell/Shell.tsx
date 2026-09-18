"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Moon, Search, Sun, X, Plus } from "lucide-react";
import { NAV } from "./nav";
import { useEstado, useTema } from "@/lib/store";
import { Avatar, Button, IconButton } from "@/components/ui/ui";
import { Paleta } from "./Paleta";
import { Tour } from "./Tour";
import { CrearRapido } from "./CrearRapido";

export function Shell({ children }: { children: React.ReactNode }) {
  const ruta = usePathname();
  const estado = useEstado();
  const [tema, setTema] = useTema();
  const [menu, setMenu] = useState(false);
  const [paleta, setPaleta] = useState(false);
  const [crear, setCrear] = useState(false);

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
          <div className="row-3">
            <Avatar nombre={estado.ajustes.responsable || "Apicanta"} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="t-strong truncate" style={{ fontSize: 14 }}>{estado.ajustes.responsable || "Apicanta"}</div>
              <div className="t-sm t-subtle truncate">{estado.ajustes.negocio}</div>
            </div>
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
            <Button sm variante="primary" icono={<Plus size={16} />} onClick={() => setCrear(true)}>
              Crear
            </Button>
          </div>
        </header>

        <main className="app-content">{children}</main>
      </div>

      <Paleta abierto={paleta} onCerrar={() => setPaleta(false)} />
      <CrearRapido abierto={crear} onCerrar={() => setCrear(false)} />
      <Tour />
    </div>
  );
}
