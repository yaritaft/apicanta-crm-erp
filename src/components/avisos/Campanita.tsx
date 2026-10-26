"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck, X } from "lucide-react";
import { Avatar, IconButton } from "@/components/ui/ui";
import { useAbrirFicha } from "@/components/ficha/abrir";
import { nube } from "@/lib/supabase";
import { useSesion } from "@/lib/auth";
import { useEstado } from "@/lib/store";
import { personaDe } from "@/lib/persona";
import { fotoDe, mapaDeFotos } from "@/lib/fotos-perfil";
import { alCambiarAvisos, dondeEs, hace, marcarEnLista, sinLeer, sumarAviso, type Aviso } from "@/lib/avisos";
import { leerAvisos, marcarLeidos, marcarTodosLeidos } from "./avisos-nube";
import "./avisos.css";

/* ==================================================================
   La campanita de arriba, como la de Blue OS (Juan Cruz, 23/10): el
   número de avisos sin leer, la lista al tocarla y, cuando llega uno
   nuevo, un cartel abajo a la derecha que se cierra solo a los 5
   segundos (se queda mientras el mouse está encima). Tocar un aviso lo
   marca leído y abre la ficha con su chat; leer el chat de esa ficha
   también lo apaga (ChatEquipo).

   Lee de la base con la sesión del navegador (la RLS deja ver sólo los
   propios) y se entera sola por Realtime; al volver a la pestaña vuelve
   a leer por si se cortó.
   ================================================================== */

const SEGUNDOS_EMERGENTE = 5;

function Emergente({ aviso, onAbrir, onCerrar }: { aviso: Aviso; onAbrir: () => void; onCerrar: () => void }) {
  const [pausado, setPausado] = useState(false);
  useEffect(() => {
    if (pausado) return;
    const t = window.setTimeout(onCerrar, SEGUNDOS_EMERGENTE * 1000);
    return () => window.clearTimeout(t);
  }, [aviso.id, pausado, onCerrar]);
  return (
    <div className="avisos-emergente" role="status" aria-live="polite"
      onMouseEnter={() => setPausado(true)} onMouseLeave={() => setPausado(false)}
      onFocusCapture={() => setPausado(true)} onBlurCapture={() => setPausado(false)}>
      <span className="avisos-emergente__punto" aria-hidden />
      <span className="avisos-emergente__txt">
        <strong>{aviso.titulo}</strong>
        <span className="t-sm t-subtle">{dondeEs(aviso)}</span>
        {aviso.cuerpo && <span className="avisos-emergente__cuerpo">{aviso.cuerpo}</span>}
        <button type="button" className="avisos-emergente__abrir" onClick={onAbrir}>Abrir</button>
      </span>
      <button type="button" className="avisos-emergente__cerrar" onClick={onCerrar} aria-label="Cerrar el aviso"><X size={14} /></button>
    </div>
  );
}

export function Campanita() {
  const { email } = useSesion();
  const e = useEstado();
  const abrirFicha = useAbrirFicha();
  const router = useRouter();
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [emergente, setEmergente] = useState<Aviso | null>(null);
  const [ahora, setAhora] = useState(() => Date.now());
  const caja = useRef<HTMLDivElement>(null);
  const fotos = useMemo(() => mapaDeFotos(e.fotosPerfil, e.equipo), [e.fotosPerfil, e.equipo]);

  const releer = useCallback(() => { void leerAvisos().then((l) => { if (l) setAvisos(l); }); }, []);

  useEffect(() => {
    if (!nube || !email) return;
    const db = nube;
    let vivo = true;
    releer();
    const canal = db.channel(`avisos:${Math.random().toString(36).slice(2, 8)}`);
    canal.on("postgres_changes" as never, { event: "*", schema: "public", table: "avisos", filter: `para=eq.${email.toLowerCase()}` },
      (p: { eventType: string; new?: Aviso }) => {
        const nuevo = p.new;
        if (!vivo || !nuevo?.id) return;
        setAvisos((l) => sumarAviso(l, nuevo));
        /* Sólo lo que llega en vivo salta: lo que ya estaba sin leer al entrar es viejo y está en la campanita. */
        if (p.eventType === "INSERT" && !nuevo.leidoEn) setEmergente(nuevo);
      });
    canal.subscribe((s) => { if (vivo && s === "SUBSCRIBED") releer(); });
    const alVolver = () => { if (document.visibilityState === "visible") { releer(); setAhora(Date.now()); } };
    document.addEventListener("visibilitychange", alVolver);
    const sinOir = alCambiarAvisos(releer);
    const reloj = window.setInterval(() => setAhora(Date.now()), 60_000);
    return () => {
      vivo = false;
      void db.removeChannel(canal);
      document.removeEventListener("visibilitychange", alVolver);
      sinOir();
      window.clearInterval(reloj);
    };
  }, [email, releer]);

  /* Fuera de la lista o Escape la cierran. */
  useEffect(() => {
    if (!abierta) return;
    const fuera = (ev: MouseEvent) => { if (caja.current && !caja.current.contains(ev.target as Node)) setAbierta(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") setAbierta(false); };
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fuera); document.removeEventListener("keydown", esc); };
  }, [abierta]);

  const abrir = (a: Aviso) => {
    setAbierta(false);
    setEmergente(null);
    if (!a.leidoEn) {
      setAvisos((l) => marcarEnLista(l, (x) => x.id === a.id, new Date().toISOString()));
      void marcarLeidos([a.id]);
    }
    /* Un pedido de acceso se resuelve en Equipo: ahí se le cambia el tipo o lo que ve el tipo. */
    if (a.tipo === "acceso") { router.push("/equipo?seccion=accesos"); return; }
    if (!a.contactoId) return;
    /* Si la persona es alumna, en Servicio; si no, en Ventas. El chat está en las dos. */
    const p = personaDe(e, a.contactoId);
    /* Un contrato que no salió o se firmó, o el roadmap para mandar por WhatsApp: la solapa Contrato del servicio, si ya hay
       servicio (si no, la venta lo muestra). */
    const aContrato = (a.tipo === "contrato" || a.tipo === "roadmap") && p?.alumnos.length;
    abrirFicha(a.contactoId, p?.alumnos.length ? "servicio" : "ventas", aContrato ? { hoja: "contrato" } : undefined);
  };
  const todos = () => {
    setAvisos((l) => marcarEnLista(l, () => true, new Date().toISOString()));
    void marcarTodosLeidos();
  };
  const cerrarEmergente = useCallback(() => setEmergente(null), []);

  if (!nube || !email) return null;
  const n = sinLeer(avisos);

  return (
    <div className="avisos" ref={caja}>
      <IconButton etiqueta={n ? `Avisos: ${n} sin leer` : "Avisos"} aria-expanded={abierta} aria-haspopup="dialog"
        className="avisos__boton" onClick={() => { setAbierta((x) => !x); setAhora(Date.now()); }}>
        <Bell size={18} />
        {n > 0 && <span className="avisos__numero">{n > 99 ? "99+" : n}</span>}
      </IconButton>
      {abierta && (
        <div className="avisos__panel" role="dialog" aria-label="Avisos">
          <div className="avisos__cab">
            <span className="t-strong">Avisos</span>
            {n > 0 && (
              <button type="button" className="avisos__todos" onClick={todos}><CheckCheck size={14} aria-hidden />Marcar todo como leído</button>
            )}
          </div>
          {avisos.length === 0 ? (
            <div className="avisos__vacio">
              <span className="t-strong">No tenés avisos</span>
              <span className="t-sm t-subtle">Cuando alguien te mencione con @ en el chat de una ficha, te aparece acá.</span>
            </div>
          ) : (
            <ul className="avisos__lista">
              {avisos.map((a) => (
                <li key={a.id}>
                  <button type="button" className={`avisos__item${a.leidoEn ? "" : " avisos__item--nuevo"}`} onClick={() => abrir(a)}>
                    <Avatar nombre={a.de || "?"} size={32} foto={fotoDe(fotos, a.deEmail, a.de ?? "")} />
                    <span className="avisos__txt">
                      <span className="avisos__tit">{a.titulo}</span>
                      <span className="avisos__donde">{dondeEs(a)}</span>
                      {a.cuerpo && <span className="avisos__cuerpo">{a.cuerpo}</span>}
                    </span>
                    <span className="avisos__cuando">{hace(a.creadoEn, ahora)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {/* Al body: el encabezado tiene backdrop-filter y un «fixed» adentro quedaría atado a él, no a la pantalla. */}
      {emergente && createPortal(<Emergente aviso={emergente} onAbrir={() => abrir(emergente)} onCerrar={cerrarEmergente} />, document.body)}
    </div>
  );
}
