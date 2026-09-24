"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, Pencil, Trash2, Video } from "lucide-react";
import { Button, Card, Empty, Input, Select } from "@/components/ui/ui";
import { Confirmar } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { VideoWebinar } from "@/components/webinars/VideoWebinar";
import {
  moverMetrica, TarjetaCaptacion, TarjetaEmbudo, TarjetaInversion, TarjetaLlamadas, TarjetaResultado,
} from "@/components/webinars/FichaNumeros";
import { TarjetaCambios, TarjetaNotas } from "@/components/webinars/FichaNotas";
import { PersonasWebinar } from "@/components/webinars/PersonasWebinar";
import { AgendasWebinar } from "@/components/webinars/AgendasWebinar";
import { useWebinarsAlDia } from "@/components/webinars/useVivo";
import {
  BannerVivo, ChatDelVivo, FilaVideo, SoloEnVivo, TarjetaVivo, VivoProvider,
} from "@/components/webinars/VivoWebinar";
import { guardarWebinar } from "@/components/webinars/guardar";
import { CLAVE_LISTA, ESTADO_WEBINAR, ESTADOS } from "@/components/webinars/estado";
import {
  diaYHora, fechaCompleta, hoyArgentina, isoDesdeArgentina, partesArgentina,
} from "@/components/webinars/fechas";
import { acciones, useEstado, useSync } from "@/lib/store";
import { metricasDeWebinar } from "@/lib/webinar";
import { videoDelWebinar } from "@/lib/youtube";
import type { EstadoWebinar, Webinar } from "@/lib/types";

/* ==================================================================
   La ficha de un webinar, en pantalla completa.

   A la izquierda el video (el vivo o la grabación, con lo que dice
   YouTube) y a la derecha todos los números del lanzamiento, que se
   cargan ahí mismo. Arriba, el video: a su lado el chat mientras está en
   el aire (y el resultado cuando no); abajo, a todo lo ancho, el vivo
   minuto a minuto. Después el resto de los números, el chat y los
   comentarios cuando terminó, y la gente que trajo. En el celular va todo
   en una columna.
   ================================================================== */

export default function WebinarFicha() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id ?? ""));
  const e = useEstado();
  const sync = useSync();
  const router = useRouter();
  const toast = useToast();
  const [borrar, setBorrar] = useState(false);
  const [borrado, setBorrado] = useState(false);

  /* Volver a la lista como estaba: con su período y sus filtros. */
  const [volver, setVolver] = useState("/webinars");
  useEffect(() => {
    try {
      const v = sessionStorage.getItem(CLAVE_LISTA);
      if (v && v.startsWith("/webinars")) setVolver(v);
    } catch { /* modo privado */ }
  }, []);

  const w = e.webinars.find((x) => x.id === id);
  /* Las llamadas, los asistentes y el estado que completa el cron, al día. */
  useWebinarsAlDia(w ? [w.id] : []);
  const m = useMemo(() => (w ? metricasDeWebinar(e, w) : null), [e, w]);
  const videoId = w ? videoDelWebinar(w) : null;

  /* Flechas arriba y abajo entre los números de la ficha, como en la planilla. */
  function navegar(ev: React.KeyboardEvent) {
    if (ev.key !== "ArrowDown" && ev.key !== "ArrowUp") return;
    const el = ev.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") return;
    const pos = el.getAttribute("data-celda");
    if (!pos?.startsWith("m:")) return;
    ev.preventDefault();
    moverMetrica(pos.slice(2), ev.key === "ArrowDown" ? "abajo" : "arriba");
  }

  if (borrado) return null;

  if (!w || !m) {
    /* Con la nube, lo primero que hay en memoria es lo del navegador: un
       webinar recién creado en otra máquina aparece cuando termina de cargar. */
    if (sync.estado === "cargando") return <Esqueleto />;
    return (
      <div className="stack-5">
        <Link href={volver} className="wb-volver"><ArrowLeft size={15} />Webinars</Link>
        <Card>
          <Empty
            icono={<Video size={22} />}
            titulo="No encontré este webinar"
            texto="Puede que lo hayan borrado o que el link esté incompleto."
            accion={<Link href={volver}><Button variante="secondary">Ver todos los webinars</Button></Link>}
          />
        </Card>
      </div>
    );
  }

  const contenido = (
    <div className="stack-5" onKeyDown={navegar}>
      <Link href={volver} className="wb-volver"><ArrowLeft size={15} />Webinars</Link>

      <div className="page-head wb-cabeza">
        <div className="page-head__text">
          <TituloEditable w={w} />
          <FechaEditable w={w} />
        </div>
        <div className="page-head__actions">
          <div style={{ width: 168 }}>
            <Select
              value={w.estado} aria-label="Estado del webinar"
              onChange={(ev) => {
                const nuevo = ev.target.value as EstadoWebinar;
                if (nuevo === w.estado) return;
                guardarWebinar(w, { estado: nuevo }, `«${w.titulo}» pasó a ${ESTADO_WEBINAR[nuevo].texto.toLowerCase()}.`);
                toast(`Quedó como ${ESTADO_WEBINAR[nuevo].texto.toLowerCase()}.`);
              }}
              opciones={ESTADOS.map((k) => ({ valor: k, texto: ESTADO_WEBINAR[k].texto }))}
            />
          </div>
          <Button variante="ghost" icono={<Trash2 size={16} />} onClick={() => setBorrar(true)}>Eliminar</Button>
        </div>
      </div>

      {videoId && <BannerVivo w={w} />}

      {/* Arriba: el video y, a su lado, el chat en vivo (cortado a la altura
          del video) o, si no está en el aire, el resultado. Abajo, a todo lo
          ancho, el vivo minuto a minuto. */}
      <FilaVideo
        videoId={videoId}
        video={<VideoWebinar w={w} />}
        chat={videoId ? <ChatDelVivo w={w} videoId={videoId} lugar="columna" /> : null}
        sinVivo={<TarjetaResultado m={m} />}
      />
      {videoId && <TarjetaVivo w={w} videoId={videoId} />}

      <div className="wb-detalle">
        <div className="wb-col">
          <TarjetaEmbudo w={w} m={m} className="wb-o6" />
          <TarjetaNotas w={w} className="wb-o7" />
          <TarjetaCambios w={w} className="wb-o8" />
        </div>
        <div className="wb-col">
          {/* En vivo, el resultado deja su lugar de arriba al chat y baja acá. */}
          <SoloEnVivo><TarjetaResultado m={m} className="wb-o2" /></SoloEnVivo>
          <AgendasWebinar w={w} className="wb-o2" />
          <TarjetaInversion w={w} m={m} className="wb-o3" />
          <TarjetaCaptacion w={w} m={m} className="wb-o4" />
          <TarjetaLlamadas w={w} m={m} className="wb-o5" />
        </div>
      </div>

      {videoId && <ChatDelVivo w={w} videoId={videoId} lugar="abajo" />}

      <PersonasWebinar w={w} />

      <Confirmar
        abierto={borrar} onCerrar={() => setBorrar(false)}
        titulo="¿Eliminar este webinar?"
        texto={`Se borra «${w.titulo}» y sus números. Las ventas que trajo quedan, pero pierden la atribución.`}
        onConfirmar={() => {
          setBorrado(true);
          acciones.eliminar("webinars", w.id, w.titulo);
          toast("Webinar eliminado.");
          router.push(volver);
        }}
      />
    </div>
  );

  /* Con video, todo va adentro de VivoProvider: la barra "En vivo" de
     arriba y las tarjetas del vivo de abajo comparten lo que se pide. */
  return videoId ? <VivoProvider w={w} videoId={videoId}>{contenido}</VivoProvider> : contenido;
}

/* ---------- El título, editable en el lugar ---------- */

function TituloEditable({ w }: { w: Webinar }) {
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(w.titulo);
  const cerrado = useRef(true);
  const botonRef = useRef<HTMLButtonElement>(null);

  function empezar() {
    setTexto(w.titulo);
    cerrado.current = false;
    setEditando(true);
  }

  function cerrar(guardar: boolean, volverAlBoton = false) {
    if (cerrado.current) return;
    cerrado.current = true;
    const t = texto.trim();
    /* Vacío no es un título: se queda el que estaba. */
    if (guardar && t && t !== w.titulo) guardarWebinar(w, { titulo: t }, `«${w.titulo}» ahora se llama «${t}».`);
    setEditando(false);
    if (volverAlBoton) requestAnimationFrame(() => botonRef.current?.focus());
  }

  if (editando) {
    return (
      <input
        className="wb-titulo-input" value={texto} autoFocus maxLength={160} aria-label="Título del webinar"
        onChange={(ev) => setTexto(ev.target.value)}
        onFocus={(ev) => ev.target.select()}
        onBlur={() => cerrar(true)}
        onKeyDown={(ev) => {
          if (ev.nativeEvent.isComposing) return;
          if (ev.key === "Enter") { ev.preventDefault(); cerrar(true, true); }
          if (ev.key === "Escape") { ev.preventDefault(); cerrar(false, true); }
        }}
      />
    );
  }

  return (
    <h1 className="t-h1 wb-titulo">
      <button ref={botonRef} type="button" className="wb-editable" onClick={empezar} title="Click para cambiar el título">
        <span>{w.titulo || "Sin título"}</span>
        <Pencil size={16} className="wb-editable__lapiz" aria-hidden />
      </button>
    </h1>
  );
}

/* ---------- La fecha y la hora, editables en el lugar ---------- */

function FechaEditable({ w }: { w: Webinar }) {
  const [editando, setEditando] = useState(false);
  const [dia, setDia] = useState("");
  const [hora, setHora] = useState("");
  const botonRef = useRef<HTMLButtonElement>(null);
  const nueva = isoDesdeArgentina(dia, hora);

  function empezar() {
    const p = partesArgentina(w.fecha);
    setDia(p.dia || hoyArgentina());
    setHora(p.hora || "19:00");
    setEditando(true);
  }

  function terminar(guardar: boolean) {
    if (guardar) {
      if (!nueva) return;
      if (+new Date(nueva) !== +new Date(w.fecha)) {
        guardarWebinar(w, { fecha: nueva }, `«${w.titulo}» pasó al ${diaYHora(nueva)} hs.`);
      }
    }
    setEditando(false);
    requestAnimationFrame(() => botonRef.current?.focus());
  }

  if (editando) {
    return (
      <div
        className="wb-fecha-edit"
        onKeyDown={(ev) => {
          /* Un calendario o un desplegable abierto adentro se maneja solo, y
             Enter sobre un botón hace lo de ese botón (Cancelar cancela). */
          if (ev.defaultPrevented || document.querySelector("[data-flotante-abierto]")) return;
          if ((ev.target as HTMLElement).tagName === "BUTTON") return;
          if (ev.key === "Enter") { ev.preventDefault(); terminar(true); }
          if (ev.key === "Escape") { ev.preventDefault(); terminar(false); }
        }}
      >
        <div style={{ width: 170 }}>
          <Input type="date" value={dia} onChange={(ev) => setDia(ev.target.value)} aria-label="Día del vivo" autoFocus />
        </div>
        <div style={{ width: 120 }}>
          <Input type="time" step={300} value={hora} onChange={(ev) => setHora(ev.target.value)} aria-label="Hora del vivo, en Argentina" />
        </div>
        <Button sm variante="primary" onClick={() => terminar(true)} disabled={!nueva}>Guardar</Button>
        <Button sm variante="ghost" onClick={() => terminar(false)}>Cancelar</Button>
      </div>
    );
  }

  return (
    <button ref={botonRef} type="button" className="wb-editable wb-fecha" onClick={empezar} title="Click para cambiar el día o la hora">
      <CalendarClock size={16} aria-hidden />
      <span>{fechaCompleta(w.fecha)}</span>
      <span className="t-subtle">· hora de Argentina</span>
      <Pencil size={13} className="wb-editable__lapiz" aria-hidden />
    </button>
  );
}

function Esqueleto() {
  return (
    <div className="stack-5" aria-busy="true" aria-label="Cargando el webinar">
      <div className="skeleton" style={{ height: 18, width: 110 }} />
      <div className="stack-2">
        <div className="skeleton" style={{ height: 36, width: "min(520px, 90%)" }} />
        <div className="skeleton" style={{ height: 20, width: 300 }} />
      </div>
      <div className="grid-2">
        <div className="skeleton" style={{ height: 420 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    </div>
  );
}
