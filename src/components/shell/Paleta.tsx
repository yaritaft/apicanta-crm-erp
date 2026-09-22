"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CornerDownLeft } from "lucide-react";
import { TODOS_LOS_ITEMS } from "./nav";
import { useEstado } from "@/lib/store";
import { fechaHora, money } from "@/lib/format";

interface Resultado {
  id: string; grupo: string; texto: string; sub?: string;
  icono: React.ReactNode; ir: string;
}

function normal(s: string) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function Paleta({ abierto, onCerrar }: { abierto: boolean; onCerrar: () => void }) {
  const router = useRouter();
  const e = useEstado();
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (abierto) { setQ(""); setActivo(0); window.setTimeout(() => input.current?.focus(), 40); }
  }, [abierto]);

  const resultados = useMemo<Resultado[]>(() => {
    const term = normal(q.trim());
    const out: Resultado[] = [];

    for (const i of TODOS_LOS_ITEMS) {
      if (!term || normal(i.texto).includes(term) || normal(i.ayuda).includes(term)) {
        const Ico = i.icono;
        out.push({ id: `nav${i.href}`, grupo: "Ir a", texto: i.texto, sub: i.ayuda, icono: <Ico size={18} />, ir: i.href });
      }
    }

    if (term.length >= 2) {
      for (const l of e.leads) {
        if (normal(l.nombre).includes(term) || normal(l.email).includes(term)) {
          out.push({ id: `l${l.id}`, grupo: "Leads", texto: l.nombre, sub: `${l.email} · ${money(l.monto, l.moneda)}`, icono: <span className="hk-avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{l.nombre.slice(0, 1)}</span>, ir: `/leads?ver=${l.id}` });
        }
      }
      for (const a of e.alumnos) {
        if (normal(a.nombre).includes(term) || normal(a.email).includes(term)) {
          out.push({ id: `a${a.id}`, grupo: "Alumnos", texto: a.nombre, sub: [a.plan, a.cohorte].filter(Boolean).join(" · "), icono: <span className="hk-avatar" style={{ width: 22, height: 22, fontSize: 10 }}>{a.nombre.slice(0, 1)}</span>, ir: `/alumnos?ver=${a.id}` });
        }
      }
      for (const w of e.webinars) {
        if (normal(w.titulo).includes(term)) {
          out.push({ id: `w${w.id}`, grupo: "Webinars", texto: w.titulo, sub: fechaHora(w.fecha), icono: <Search size={18} />, ir: `/webinars/${w.id}` });
        }
      }
      for (const s of e.sesiones) {
        if (normal(s.invitado).includes(term) || normal(s.titulo).includes(term)) {
          out.push({ id: `s${s.id}`, grupo: "Agenda", texto: `${s.titulo} — ${s.invitado}`, sub: fechaHora(s.inicia), icono: <Search size={18} />, ir: `/agenda?ver=${s.id}` });
        }
      }
    }
    return out.slice(0, 24);
  }, [q, e]);

  useEffect(() => { setActivo(0); }, [q]);

  if (!abierto) return null;

  function elegir(r?: Resultado) {
    const x = r ?? resultados[activo];
    if (!x) return;
    onCerrar();
    router.push(x.ir);
  }

  function onKey(ev: React.KeyboardEvent) {
    if (ev.key === "ArrowDown") { ev.preventDefault(); setActivo((a) => Math.min(a + 1, resultados.length - 1)); }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); setActivo((a) => Math.max(a - 1, 0)); }
    else if (ev.key === "Enter") { ev.preventDefault(); elegir(); }
    else if (ev.key === "Escape") { ev.preventDefault(); onCerrar(); }
  }

  let grupoActual = "";

  return (
    <div className="cmd-backdrop" onMouseDown={(ev) => { if (ev.target === ev.currentTarget) onCerrar(); }}>
      <div className="cmd" role="dialog" aria-modal="true" aria-label="Buscar">
        <div className="cmd__input">
          <Search size={20} color="var(--ink-subtle)" />
          <input
            ref={input} value={q} onChange={(ev) => setQ(ev.target.value)} onKeyDown={onKey}
            placeholder="Buscá una persona, un webinar o una sección…"
            aria-label="Buscar en Apicanta"
          />
          <kbd>esc</kbd>
        </div>
        <div className="cmd__list">
          {resultados.length === 0 && (
            <div style={{ padding: "24px 12px", textAlign: "center" }} className="t-sm t-subtle">
              No encontramos nada con «{q}».
            </div>
          )}
          {resultados.map((r, i) => {
            const cabecera = r.grupo !== grupoActual ? ((grupoActual = r.grupo), r.grupo) : null;
            return (
              <React.Fragment key={r.id}>
                {cabecera && <div className="cmd__group">{cabecera}</div>}
                <button
                  type="button" className="cmd__item" data-active={i === activo}
                  onMouseEnter={() => setActivo(i)} onClick={() => elegir(r)}
                >
                  {r.icono}
                  <span style={{ minWidth: 0, flex: 1 }}>
                    <span className="truncate" style={{ display: "block", color: "var(--ink)", fontWeight: 500 }}>{r.texto}</span>
                    {r.sub && <span className="truncate t-sm t-subtle" style={{ display: "block" }}>{r.sub}</span>}
                  </span>
                  {i === activo && <CornerDownLeft size={15} className="cmd__item-sub" />}
                </button>
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}
