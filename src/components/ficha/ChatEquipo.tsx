"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowUp, Check, ChevronLeft, ChevronRight, Download, FileText, Loader2, MessageSquare, MessageSquareReply, Mic, Paperclip, Pause, Play, Reply, Smile, Trash2, X,
} from "lucide-react";
import { Avatar, Empty } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones, escrituraPendiente, useEstado, useSync } from "@/lib/store";
import { fechaHora, relativo } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import {
  ADJUNTOS_POR_MENSAJE, descartarAdjunto, duracionLegible, normalizarPicos, problemaDeAdjunto, subirAdjunto, tamanioLegible, tipoDeArchivo, urlDeAdjunto,
} from "@/lib/adjuntos-chat";
import {
  candidatosDeMencion, claveDe, contextoDeEntrega, entregaCon, mencionEnCurso, partesConMenciones, ponerMencion, resumenDeMensaje, type DetalleEntrega,
} from "@/lib/chat-equipo";
import { fotoDe, mapaDeFotos } from "@/lib/fotos-perfil";
import type { Adjunto, ChatLectura, Comentario } from "@/lib/types";
import "./chat.css";

/* ==================================================================
   El chat del equipo en la ficha de cada persona, como el de Blue OS:
   además del texto se manda una foto, un video, una nota de voz o
   cualquier archivo.

     · el clip adjunta (o se pegan capturas con Cmd+V, o se sueltan archivos
       encima del chat): quedan como fichitas adentro de la caja y se mandan
       junto con el texto;
     · el micrófono graba una nota de voz: la caja se vuelve «todo audio»,
       con la onda en vivo, el tiempo, pausa y el tachito; la flecha la manda;
     · Enter manda y Shift+Enter baja de renglón. La caja crece con el texto.

     · cada mensaje se responde EN HILO (como Blue OS y Slack): debajo del
       original queda «N respuestas» con las caras de quienes contestaron;
       el hilo se abre encima de la conversación o, si el chat se estiró con
       el divisor de la ficha, al costado; Esc lo cierra;
     · «Responder» cita el mensaje como en WhatsApp: arriba de la respuesta
       va un recuadro con él, y tocarlo lleva hasta el original;
     · los mensajes propios llevan los tildes de WhatsApp (lib/chat-equipo.ts):
       reloj si no salió, ✓ enviado, ✓✓ les llegó a todos, ✓✓ azul lo leyeron;
     · una nota de voz grabada con texto o archivos ya cargados se suma al
       mensaje (sale todo junto); con la caja vacía, sale sola al toque.
     · En cada mensaje, las fotos y los archivos van arriba y el texto al final.

   Lo que el equipo anota acá lo ve cualquiera que abra la ficha. Los
   archivos van a un bucket privado (lib/adjuntos-chat.ts).
   ================================================================== */

/* ---------- Los archivos de un mensaje ---------- */

function useUrl(a: Adjunto): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    urlDeAdjunto(a).then((u) => { if (vivo) setUrl(u); }, () => undefined);
    return () => { vivo = false; };
  }, [a]);
  return url;
}

function Imagen({ a, onAbrir }: { a: Adjunto; onAbrir: () => void }) {
  const url = useUrl(a);
  const proporcion = a.ancho && a.alto ? `${a.ancho} / ${a.alto}` : "4 / 3";
  return (
    <button type="button" className="chatx-imagen" onClick={onAbrir} disabled={!url} title={`Ver ${a.nombre}`} aria-label={`Ver ${a.nombre}`} style={{ aspectRatio: proporcion }}>
      {url ? <img src={url} alt={a.nombre} loading="lazy" /> : <Loader2 size={18} className="chatx-gira" aria-hidden />}
    </button>
  );
}

/* Baja un archivo con su nombre. Con la URL firmada de la nube (otro dominio) el `download` del link no
   se respeta: se trae como blob y se guarda desde acá; si eso falla, se abre para guardarlo a mano. */
async function bajarArchivo(url: string, nombre: string) {
  try {
    const blob = await (await fetch(url)).blob();
    const local = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = local; link.download = nombre; link.rel = "noopener";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(local), 4000);
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

/* El visor de fotos AHÍ MISMO, sin otra pestaña (como MediaLightbox de Blue OS y WhatsApp): fondo oscuro,
   flechas entre las fotos del mensaje, «2 de 3», bajarla, y se cierra con Esc, la X o tocando afuera.
   Va a document.body (portal) para quedar encima de la ficha. Su Esc es SÓLO suyo: se escucha en `window`
   en captura (antes que el hilo y la ficha) y no sigue de largo, así no cierra la ficha entera. */
function VisorImagenes({ lista, inicio, onCerrar }: { lista: Adjunto[]; inicio: number; onCerrar: () => void }) {
  const [i, setI] = useState(inicio);
  const a = lista[i];
  const url = useUrl(a);
  const [bajando, setBajando] = useState(false);
  const cerrarRef = useRef<HTMLButtonElement>(null);
  const empezoEnElFondo = useRef(false);
  const hay = lista.length;
  const anterior = useCallback(() => setI((x) => (x - 1 + hay) % hay), [hay]);
  const siguiente = useCallback(() => setI((x) => (x + 1) % hay), [hay]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopImmediatePropagation(); onCerrar(); }
      else if (ev.key === "ArrowLeft" && hay > 1) { ev.preventDefault(); ev.stopImmediatePropagation(); anterior(); }
      else if (ev.key === "ArrowRight" && hay > 1) { ev.preventDefault(); ev.stopImmediatePropagation(); siguiente(); }
    };
    window.addEventListener("keydown", onKey, true);
    const antes = document.activeElement as HTMLElement | null;
    cerrarRef.current?.focus();
    return () => { window.removeEventListener("keydown", onKey, true); antes?.focus?.(); };
  }, [onCerrar, anterior, siguiente, hay]);

  return createPortal(
    <div className="chatx-visor" role="dialog" aria-modal="true" aria-label={`Foto: ${a.nombre}`} data-flotante-abierto
      onMouseDown={(ev) => { empezoEnElFondo.current = ev.target === ev.currentTarget; }}
      onClick={(ev) => { if (empezoEnElFondo.current && ev.target === ev.currentTarget) onCerrar(); }}>
      <div className="chatx-visor__arriba">
        <span className="chatx-visor__nombre">{hay > 1 && <b className="t-num">{i + 1} de {hay}</b>}<span className="truncate">{a.nombre}</span></span>
        <button type="button" className="chatx-visor__boton" disabled={!url || bajando} aria-label="Descargar" title="Descargar"
          onClick={async () => { if (!url) return; setBajando(true); await bajarArchivo(url, a.nombre); setBajando(false); }}>
          {bajando ? <Loader2 size={17} className="chatx-gira" /> : <Download size={17} />}
        </button>
        <button ref={cerrarRef} type="button" className="chatx-visor__boton" onClick={onCerrar} aria-label="Cerrar" title="Cerrar (Esc)"><X size={18} /></button>
      </div>
      {hay > 1 && <button type="button" className="chatx-visor__flecha chatx-visor__flecha--izq" onClick={anterior} aria-label="Foto anterior" title="Anterior (←)"><ChevronLeft size={22} /></button>}
      {url ? <img key={a.id} className="chatx-visor__img" src={url} alt={a.nombre} /> : <Loader2 size={26} className="chatx-gira chatx-visor__cargando" aria-hidden />}
      {hay > 1 && <button type="button" className="chatx-visor__flecha chatx-visor__flecha--der" onClick={siguiente} aria-label="Foto siguiente" title="Siguiente (→)"><ChevronRight size={22} /></button>}
    </div>,
    document.body,
  );
}

function Video({ a }: { a: Adjunto }) {
  const url = useUrl(a);
  return url
    ? <video className="chatx-video" src={url} controls preload="metadata" />
    : <div className="chatx-video chatx-video--cargando"><Loader2 size={18} className="chatx-gira" aria-hidden /></div>;
}

/* Una nota de voz (o un audio adjuntado), como la de Blue OS (components/chat/AudioMessage) y WhatsApp: el botón
   redondo, la onda (un clic salta a ese punto), el tiempo que corre, la velocidad 1×/1,5×/2× mientras suena y bajarlo.
   La onda usa los picos reales medidos al grabar; si no los hay, una onda estable sacada del nombre (no al azar:
   parpadearía en cada render). */
const BARRAS_AUDIO = 34;
const VELOCIDADES = [1, 1.5, 2] as const;

function ondaDe(a: Adjunto): number[] {
  if (a.picos?.length) {
    return Array.from({ length: BARRAS_AUDIO }, (_, i) => a.picos?.[Math.floor((i * (a.picos?.length ?? 1)) / BARRAS_AUDIO)] ?? 0.2);
  }
  let h = 0;
  for (const ch of a.nombre + a.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return Array.from({ length: BARRAS_AUDIO }, (_, i) => {
    h = (h * 1103515245 + 12345) >>> 0;
    const centro = 1 - Math.abs(i - BARRAS_AUDIO / 2) / (BARRAS_AUDIO / 2);
    return Math.max(0.12, Math.min(1, 0.25 + centro * 0.45 + ((h % 100) / 100) * 0.35));
  });
}

function NotaDeVoz({ a }: { a: Adjunto }) {
  const url = useUrl(a);
  const audio = useRef<HTMLAudioElement | null>(null);
  const cuadro = useRef<number | null>(null);
  const [sonando, setSonando] = useState(false);
  const [va, setVa] = useState(0);
  const [dura, setDura] = useState(a.duracion ?? 0);
  const [vel, setVel] = useState(0);
  const onda = useMemo(() => ondaDe(a), [a]);

  /* El avance con requestAnimationFrame: más parejo que `timeupdate`, que llega 4 veces por segundo. */
  useEffect(() => {
    if (!sonando) return;
    const paso = () => { if (audio.current) setVa(audio.current.currentTime); cuadro.current = requestAnimationFrame(paso); };
    cuadro.current = requestAnimationFrame(paso);
    return () => { if (cuadro.current) cancelAnimationFrame(cuadro.current); };
  }, [sonando]);

  const total = dura > 0 && Number.isFinite(dura) ? dura : (a.duracion ?? 0);
  const avance = total > 0 ? Math.min(1, va / total) : 0;

  const alternar = () => {
    const el = audio.current;
    if (!el) return;
    if (!el.paused) { el.pause(); return; }
    /* play() devuelve una promesa: si el audio se va de pantalla mientras arranca, el navegador la rechaza (AbortError). No es un error. */
    el.play().catch((err: unknown) => {
      const n = err instanceof DOMException ? err.name : "";
      if (n !== "AbortError" && n !== "NotAllowedError") throw err;
    });
  };
  const saltar = (ev: React.MouseEvent<HTMLButtonElement>) => {
    const el = audio.current;
    if (!el || !total || ev.detail === 0) return;
    const r = ev.currentTarget.getBoundingClientRect();
    el.currentTime = Math.max(0, Math.min(total, ((ev.clientX - r.left) / r.width) * total));
    setVa(el.currentTime);
  };
  const cambiarVelocidad = () => {
    const sig = (vel + 1) % VELOCIDADES.length;
    setVel(sig);
    if (audio.current) audio.current.playbackRate = VELOCIDADES[sig];
  };
  const bajar = () => {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url; link.download = a.nombre; link.rel = "noopener";
    document.body.appendChild(link); link.click(); link.remove();
  };

  return (
    <div className="chatx-audio">
      {url && (
        <audio
          ref={audio} src={url} preload="metadata"
          onLoadedMetadata={(ev) => { const d = ev.currentTarget.duration; if (Number.isFinite(d) && d > 0) setDura(d); }}
          onPlay={() => setSonando(true)} onPause={() => setSonando(false)} onEnded={() => { setSonando(false); setVa(0); }}
        />
      )}
      <button type="button" className="chatx-audio__play" onClick={alternar} disabled={!url} aria-label={sonando ? "Pausar" : "Escuchar"}>
        {!url ? <Loader2 size={15} className="chatx-gira" /> : sonando ? <Pause size={15} fill="currentColor" strokeWidth={0} /> : <Play size={15} fill="currentColor" strokeWidth={0} style={{ marginLeft: 2 }} />}
      </button>
      <button type="button" className="chatx-onda" onClick={saltar} aria-label="Saltar a un punto del audio">
        {onda.map((h, i) => (
          <span key={i} className={i / BARRAS_AUDIO <= avance && (sonando || va > 0) ? "chatx-onda__barra chatx-onda__barra--hecha" : "chatx-onda__barra"} style={{ height: `${Math.round(h * 100)}%` }} />
        ))}
      </button>
      <span className="chatx-audio__t">{total > 0 || va > 0 ? duracionLegible(sonando || va > 0 ? va : total) : ""}</span>
      {(sonando || va > 0) && (
        <button type="button" className="chatx-audio__vel" onClick={cambiarVelocidad} aria-label="Cambiar la velocidad">{String(VELOCIDADES[vel]).replace(".", ",")}×</button>
      )}
      <button type="button" className="chatx-audio__bajar" onClick={bajar} disabled={!url} aria-label="Descargar el audio" title="Descargar"><Download size={15} /></button>
    </div>
  );
}

function Archivo({ a }: { a: Adjunto }) {
  const toast = useToast();
  async function abrir() {
    const ventana = window.open("about:blank", "_blank");
    try {
      const url = await urlDeAdjunto(a);
      if (ventana) { ventana.opener = null; ventana.location.href = url; } else window.location.assign(url);
    } catch (err) {
      ventana?.close();
      toast(err instanceof Error ? err.message : "No se pudo abrir el archivo.", "err");
    }
  }
  return (
    <button type="button" className="chatx-archivo" onClick={abrir} title={`Abrir ${a.nombre}`}>
      <span className="chatx-archivo__ico"><FileText size={18} /></span>
      <span className="chatx-archivo__txt"><span className="truncate">{a.nombre}</span><small>{tamanioLegible(a.bytes)}</small></span>
      <Download size={15} className="chatx-archivo__baja" aria-hidden />
    </button>
  );
}

function Adjuntos({ lista }: { lista: Adjunto[] }) {
  const imagenes = lista.filter((a) => a.tipo === "imagen");
  const resto = lista.filter((a) => a.tipo !== "imagen");
  const [viendo, setViendo] = useState<number | null>(null);
  const cerrar = useCallback(() => setViendo(null), []);
  return (
    <div className="chatx-adjuntos">
      {imagenes.length > 0 && (
        <div className={`chatx-galeria${imagenes.length > 1 ? " chatx-galeria--varias" : ""}`}>
          {imagenes.map((a, i) => <Imagen key={a.id} a={a} onAbrir={() => setViendo(i)} />)}
        </div>
      )}
      {resto.map((a) => a.tipo === "video" ? <Video key={a.id} a={a} /> : a.tipo === "audio" ? <NotaDeVoz key={a.id} a={a} /> : <Archivo key={a.id} a={a} />)}
      {viendo !== null && <VisorImagenes lista={imagenes} inicio={viendo} onCerrar={cerrar} />}
    </div>
  );
}

/* ---------- La grabadora de notas de voz ---------- */

type EstadoGrabadora = "nada" | "pidiendo" | "grabando" | "pausada";

function elegirMime(): string {
  for (const m of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

/* El error real del micrófono, dicho de forma que se pueda hacer algo. */
function motivoMicrofono(err: { name?: string; message?: string }): string {
  switch (err?.name) {
    case "NotAllowedError": case "PermissionDeniedError":
      return "El navegador tiene bloqueado el micrófono para esta página: tocá el ícono a la izquierda de la dirección → Micrófono → Permitir, y probá de nuevo.";
    case "NotFoundError": case "DevicesNotFoundError":
      return "No encontré ningún micrófono conectado.";
    case "NotReadableError": case "TrackStartError":
      return "El micrófono lo está usando otra app (Zoom, Meet, Loom…) u otra pestaña. Cerrala y probá de nuevo.";
    case "SecurityError":
      return "El navegador bloqueó el micrófono por seguridad en esta página.";
    default:
      return `No pude abrir el micrófono${err?.message ? `: ${err.message}` : "."}`;
  }
}

function useGrabadora(onError: (msg: string) => void) {
  const [estado, setEstado] = useState<EstadoGrabadora>("nada");
  const [segundos, setSegundos] = useState(0);
  const [barras, setBarras] = useState<number[]>([]);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const partes = useRef<Blob[]>([]);
  const niveles = useRef<number[]>([]);
  const reloj = useRef<number | null>(null);
  const ctx = useRef<AudioContext | null>(null);
  const analizador = useRef<AnalyserNode | null>(null);
  const tiempo = useRef({ inicio: 0, pausado: 0, pausaDesde: 0 });

  const limpiar = useCallback(() => {
    if (reloj.current) window.clearInterval(reloj.current);
    reloj.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    analizador.current = null;
    if (ctx.current) { void ctx.current.close(); ctx.current = null; }
  }, []);

  useEffect(() => () => {
    if (rec.current && rec.current.state !== "inactive") { rec.current.onstop = null; rec.current.stop(); }
    limpiar();
  }, [limpiar]);

  const muestrear = () => {
    const an = analizador.current;
    if (an && tiempo.current.pausaDesde === 0) {
      const buf = new Uint8Array(an.fftSize);
      an.getByteTimeDomainData(buf);
      let pico = 0;
      for (let i = 0; i < buf.length; i++) pico = Math.max(pico, Math.abs(buf[i] - 128));
      const nivel = Math.min(1, Math.max(0.06, (pico / 128) * 1.8));
      niveles.current.push(nivel);
      setBarras((b) => [...b.slice(-79), nivel]);
      const t = tiempo.current;
      setSegundos((Date.now() - t.inicio - t.pausado) / 1000);
    }
  };

  async function empezar() {
    if (estado !== "nada") return;
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      onError("Este navegador no puede grabar audio.");
      return;
    }
    setEstado("pidiendo");
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const mime = elegirMime();
      const r = new MediaRecorder(s, mime ? { mimeType: mime } : undefined);
      partes.current = [];
      niveles.current = [];
      r.ondataavailable = (ev) => { if (ev.data.size) partes.current.push(ev.data); };
      rec.current = r;
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AC) {
        ctx.current = new AC();
        const fuente = ctx.current.createMediaStreamSource(s);
        analizador.current = ctx.current.createAnalyser();
        analizador.current.fftSize = 1024;
        fuente.connect(analizador.current);
      }
      tiempo.current = { inicio: Date.now(), pausado: 0, pausaDesde: 0 };
      setSegundos(0);
      setBarras([]);
      r.start(250);
      reloj.current = window.setInterval(muestrear, 100);
      setEstado("grabando");
    } catch (err) {
      limpiar();
      setEstado("nada");
      onError(motivoMicrofono(err as { name?: string; message?: string }));
    }
  }

  function pausar() {
    const r = rec.current;
    if (!r) return;
    if (r.state === "recording") { r.pause(); tiempo.current.pausaDesde = Date.now(); setEstado("pausada"); }
    else if (r.state === "paused") { tiempo.current.pausado += Date.now() - tiempo.current.pausaDesde; tiempo.current.pausaDesde = 0; r.resume(); setEstado("grabando"); }
  }

  function cancelar() {
    const r = rec.current;
    if (r && r.state !== "inactive") { r.onstop = null; r.stop(); }
    rec.current = null;
    limpiar();
    setEstado("nada");
  }

  /** Para y devuelve el audio grabado, o null si no se grabó nada. */
  function terminar(): Promise<{ archivo: File; duracion: number; picos: number[] } | null> {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    const t = tiempo.current;
    const duracion = (Date.now() - t.inicio - t.pausado - (t.pausaDesde ? Date.now() - t.pausaDesde : 0)) / 1000;
    return new Promise((ok) => {
      r.onstop = () => {
        const tipo = r.mimeType || "audio/webm";
        const blob = new Blob(partes.current, { type: tipo });
        const ext = tipo.includes("mp4") ? "m4a" : tipo.includes("ogg") ? "ogg" : "webm";
        const ahora = new Date();
        const nombre = `nota-de-voz-${ahora.toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${ext}`;
        limpiar();
        rec.current = null;
        setEstado("nada");
        ok(blob.size ? { archivo: new File([blob], nombre, { type: tipo }), duracion, picos: normalizarPicos(niveles.current) } : null);
      };
      r.stop();
    });
  }

  return { estado, segundos, barras, empezar, pausar, cancelar, terminar };
}

/* ---------- La caja para escribir ---------- */

interface Pendiente {
  clave: string; archivo: File; vista?: string; estado: "subiendo" | "listo" | "error"; adjunto?: Adjunto; error?: string;
  /* Lo que ya se sabe del archivo (una nota de voz: su duración y su onda). */
  extra?: Partial<Adjunto>;
}

type Puerta = { agregar: (f: File[]) => void; enfocar: () => void };

function Caja({ contactoId, puerta, respondeA, enfocar, cita, onSacarCita }: {
  contactoId: string; puerta: React.MutableRefObject<Puerta | null>;
  /* En un hilo: el mensaje al que se responde. */
  respondeA?: string;
  /* Pone el cursor en la caja al aparecer (al abrir un hilo). */
  enfocar?: boolean;
  /* El mensaje que se está citando («Responder»), si hay uno. */
  cita?: Comentario | null;
  onSacarCita?: () => void;
}) {
  const yo = useUsuarioActual();
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [mandandoNota, setMandandoNota] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const elegir = useRef<HTMLInputElement>(null);
  /* La mención que se está escribiendo («@li…») y cuál de las opciones está marcada. */
  const nombres = useContext(NombresCtx);
  const [mencion, setMencion] = useState<{ desde: number; busca: string; cursor: number; marcada: number } | null>(null);
  const opcionesMencion = useMemo(() => (mencion ? candidatosDeMencion(nombres, mencion.busca) : []), [mencion, nombres]);
  const mirarMencion = (el: HTMLTextAreaElement) => {
    const m = mencionEnCurso(el.value, el.selectionStart ?? el.value.length);
    setMencion(m ? { ...m, cursor: el.selectionStart ?? el.value.length, marcada: 0 } : null);
  };
  const elegirMencion = (nombre: string) => {
    if (!mencion) return;
    const r = ponerMencion(texto, mencion.desde, mencion.cursor, nombre);
    setTexto(r.texto);
    setMencion(null);
    requestAnimationFrame(() => { const el = area.current; if (el) { el.focus(); el.setSelectionRange(r.cursor, r.cursor); } });
  };
  const grabadora = useGrabadora((msg) => toast(msg, "err"));

  /* La caja crece con el texto, hasta 8 renglones. */
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 8 * 21 + 16)}px`;
  }, [texto]);

  /* Al irse de la ficha con archivos sin mandar, se borran del bucket. */
  const pendientesRef = useRef(pendientes);
  useEffect(() => { pendientesRef.current = pendientes; }, [pendientes]);
  useEffect(() => () => {
    for (const p of pendientesRef.current) {
      if (p.vista) URL.revokeObjectURL(p.vista);
      if (p.adjunto) void descartarAdjunto(p.adjunto);
    }
  }, []);

  /* Un archivo a la lista de lo que sale con el mensaje: se sube ya, mientras se escribe. */
  const sumar = useCallback((archivo: File, extra?: Partial<Adjunto>) => {
    const clave = crypto.randomUUID();
    const vista = tipoDeArchivo(archivo.type, archivo.name) === "imagen" ? URL.createObjectURL(archivo) : undefined;
    setPendientes((xs) => [...xs, { clave, archivo, vista, estado: "subiendo", extra }]);
    subirAdjunto(archivo, contactoId, extra).then(
      (adjunto) => setPendientes((xs) => xs.map((p) => (p.clave === clave ? { ...p, estado: "listo", adjunto } : p))),
      (err: Error) => setPendientes((xs) => xs.map((p) => (p.clave === clave ? { ...p, estado: "error", error: err.message } : p))),
    );
  }, [contactoId]);

  /** La puerta única de un archivo: el clip, pegar o soltar. */
  const agregar = useCallback((archivos: File[]) => {
    const lugar = ADJUNTOS_POR_MENSAJE - pendientesRef.current.length;
    if (archivos.length > lugar) toast(`Entran hasta ${ADJUNTOS_POR_MENSAJE} archivos por mensaje.`, "err");
    for (const archivo of archivos.slice(0, Math.max(0, lugar))) {
      const problema = problemaDeAdjunto(archivo);
      if (problema) { toast(problema, "err"); continue; }
      sumar(archivo);
    }
  }, [sumar, toast]);

  /* Lo que se suelta encima de los mensajes entra por la misma puerta; «Responder» pone el cursor acá. */
  useEffect(() => {
    puerta.current = { agregar, enfocar: () => area.current?.focus() };
    return () => { puerta.current = null; };
  }, [puerta, agregar]);

  function sacar(p: Pendiente) {
    if (p.vista) URL.revokeObjectURL(p.vista);
    if (p.adjunto) void descartarAdjunto(p.adjunto);
    setPendientes((xs) => xs.filter((x) => x.clave !== p.clave));
  }

  const subiendo = pendientes.some((p) => p.estado === "subiendo");
  const listos = pendientes.filter((p) => p.estado === "listo" && p.adjunto).map((p) => p.adjunto as Adjunto);
  const puedeMandar = !subiendo && (texto.trim().length > 0 || listos.length > 0);

  function mandar() {
    if (!puedeMandar) return;
    acciones.comentar(contactoId, texto, yo.nombre, yo.email ?? undefined, listos, respondeA, cita?.id);
    for (const p of pendientes) if (p.vista) URL.revokeObjectURL(p.vista);
    setTexto("");
    setPendientes([]);
    onSacarCita?.();
    area.current?.focus();
  }

  /* Si ya hay texto o archivos en la caja, la nota de voz se SUMA al mensaje (sale todo junto, con el texto al final);
     con la caja vacía, sale sola al toque, como en WhatsApp. */
  const sumaAlMensaje = texto.trim().length > 0 || pendientes.length > 0;

  async function terminarNota() {
    setMandandoNota(true);
    try {
      const nota = await grabadora.terminar();
      if (!nota) { toast("No se grabó nada.", "err"); return; }
      const extra: Partial<Adjunto> = { duracion: nota.duracion, picos: nota.picos, notaDeVoz: true };
      if (sumaAlMensaje) {
        if (pendientesRef.current.length >= ADJUNTOS_POR_MENSAJE) { toast(`Entran hasta ${ADJUNTOS_POR_MENSAJE} archivos por mensaje.`, "err"); return; }
        sumar(nota.archivo, extra);
        window.setTimeout(() => area.current?.focus(), 0);
        return;
      }
      const adjunto = await subirAdjunto(nota.archivo, contactoId, extra);
      acciones.comentar(contactoId, "", yo.nombre, yo.email ?? undefined, [adjunto], respondeA, cita?.id);
      onSacarCita?.();
    } catch (err) {
      toast(err instanceof Error ? err.message : "No se pudo mandar la nota de voz.", "err");
    } finally {
      setMandandoNota(false);
    }
  }

  /* ---------- grabando: la caja es «todo audio» ---------- */
  if (grabadora.estado !== "nada" || mandandoNota) {
    const pidiendo = grabadora.estado === "pidiendo";
    return (
      <div className="chatx-caja chatx-caja--grabando" aria-live="polite">
        <button type="button" className="chatx-boton" onClick={grabadora.cancelar} disabled={mandandoNota} aria-label="Descartar la nota de voz" title="Descartar"><Trash2 size={17} /></button>
        {!pidiendo && (
          <button type="button" className="chatx-boton" onClick={grabadora.pausar} disabled={mandandoNota} aria-label={grabadora.estado === "pausada" ? "Seguir grabando" : "Pausar"}>
            {grabadora.estado === "pausada" ? <Mic size={17} /> : <Pause size={17} />}
          </button>
        )}
        <div className="chatx-vivo">
          {pidiendo ? <span className="chatx-vivo__txt">Pidiendo permiso para el micrófono…</span> : (
            <>
              <span className={`chatx-rec${grabadora.estado === "pausada" ? " chatx-rec--pausa" : ""}`} aria-hidden />
              <div className="chatx-vivo__onda">{grabadora.barras.map((b, i) => <span key={i} style={{ height: `${Math.round(b * 100)}%` }} />)}</div>
              <span className="chatx-vivo__t">{duracionLegible(grabadora.segundos)}</span>
            </>
          )}
        </div>
        <button type="button" className="chatx-enviar" onClick={terminarNota} disabled={pidiendo || mandandoNota}
          aria-label={sumaAlMensaje ? "Sumar la nota de voz al mensaje" : "Mandar la nota de voz"}
          title={sumaAlMensaje ? "Sumarla al mensaje (sale con lo que ya escribiste)" : "Mandar"}>
          {mandandoNota ? <Loader2 size={17} className="chatx-gira" /> : sumaAlMensaje ? <Check size={18} /> : <ArrowUp size={18} />}
        </button>
      </div>
    );
  }

  return (
    <div className="chatx-caja">
      {cita && (
        <div className="chatx-cita chatx-cita--caja">
          <span className="chatx-cita__txt">
            <span className="chatx-cita__autor">Respondiendo a {cita.autor}</span>
            <span className="chatx-cita__resumen">{resumenDeMensaje(cita)}</span>
          </span>
          <button type="button" className="chatx-cita__x" onClick={() => { onSacarCita?.(); area.current?.focus(); }} aria-label="No citar ese mensaje" title="No citar (Esc)"><X size={14} /></button>
        </div>
      )}
      {pendientes.length > 0 && (
        <div className="chatx-fichitas">
          {pendientes.map((p) => (
            <div key={p.clave} className={`chatx-fichita${p.estado === "error" ? " chatx-fichita--error" : ""}`} title={p.error ?? p.archivo.name}>
              {p.vista ? <img src={p.vista} alt="" /> : <span className="chatx-fichita__ico">{p.extra?.notaDeVoz ? <Mic size={16} /> : <FileText size={16} />}</span>}
              <span className="chatx-fichita__txt"><span className="truncate">{p.extra?.notaDeVoz ? "Nota de voz" : p.archivo.name}</span>
                <small>{p.estado === "subiendo" ? "Subiendo…" : p.estado === "error" ? "No se pudo subir" : p.extra?.notaDeVoz ? duracionLegible(p.extra.duracion) : tamanioLegible(p.archivo.size)}</small></span>
              {p.estado === "subiendo" && <Loader2 size={14} className="chatx-gira" aria-hidden />}
              <button type="button" className="chatx-fichita__x" onClick={() => sacar(p)} aria-label={`Sacar ${p.archivo.name}`}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={area} value={texto} rows={1} autoFocus={enfocar} aria-label={respondeA ? "Respuesta en el hilo" : "Mensaje para el equipo"}
        placeholder={respondeA ? "Responder en el hilo…" : `Escribí al equipo, ${yo.nombre.split(" ")[0]}…`}
        onChange={(ev) => { setTexto(ev.target.value); mirarMencion(ev.target); }}
        onClick={(ev) => mirarMencion(ev.currentTarget)}
        onBlur={() => window.setTimeout(() => setMencion(null), 150)}
        onKeyDown={(ev) => {
          /* Con el menú de @ abierto, las flechas eligen, Enter o Tab ponen el nombre y Esc lo cierra (sin cerrar la ficha). */
          if (mencion && opcionesMencion.length) {
            if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
              ev.preventDefault();
              const n = opcionesMencion.length;
              setMencion({ ...mencion, marcada: (mencion.marcada + (ev.key === "ArrowDown" ? 1 : n - 1)) % n });
              return;
            }
            if ((ev.key === "Enter" && !ev.shiftKey) || ev.key === "Tab") { ev.preventDefault(); elegirMencion(opcionesMencion[mencion.marcada] ?? opcionesMencion[0]); return; }
            if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); setMencion(null); return; }
          }
          if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); mandar(); }
        }}
        onPaste={(ev) => {
          const archivos = Array.from(ev.clipboardData.files);
          if (archivos.length) { ev.preventDefault(); agregar(archivos); }
        }}
      />
      {mencion && opcionesMencion.length > 0 && (
        <div className="chatx-menciones" role="listbox" aria-label="Mencionar a alguien del equipo">
          {opcionesMencion.map((n, i) => (
            <button key={n} type="button" role="option" aria-selected={i === mencion.marcada} className="chatx-menciones__op"
              onMouseDown={(ev) => { ev.preventDefault(); elegirMencion(n); }}>
              <Avatar nombre={n} size={22} /><span className="truncate">{n}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chatx-barra">
        <button type="button" className="chatx-boton" onClick={() => elegir.current?.click()} aria-label="Adjuntar fotos, videos o archivos" title="Adjuntar (también podés pegar o soltar)"><Paperclip size={17} /></button>
        <button type="button" className="chatx-boton" onClick={grabadora.empezar} aria-label="Grabar una nota de voz"
          title={sumaAlMensaje ? "Grabar una nota de voz (se suma a este mensaje)" : "Grabar una nota de voz"}><Mic size={17} /></button>
        <input ref={elegir} type="file" multiple hidden onChange={(ev) => { agregar(Array.from(ev.target.files ?? [])); ev.target.value = ""; }} />
        <span className="chatx-ayuda">Enter manda · Shift+Enter, otro renglón · @ para mencionar</span>
        <button type="button" className="chatx-enviar" onClick={mandar} disabled={!puedeMandar} aria-label="Mandar" title={subiendo ? "Esperá a que terminen de subir los archivos" : "Mandar"}>
          {subiendo ? <Loader2 size={17} className="chatx-gira" /> : <ArrowUp size={18} />}
        </button>
      </div>
    </div>
  );
}

/* ---------- La tabla de emojis (como «Más reacciones» de Blue OS) ---------- */

const REACCIONES_RAPIDAS = ["👍", "✅", "❤️"];
const CLAVE_RECIENTES = "apicanta:emojis-recientes";
function leerRecientes(): string[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(CLAVE_RECIENTES) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 24) : [];
  } catch { return []; }
}
function anotarReciente(e: string) {
  try { window.localStorage.setItem(CLAVE_RECIENTES, JSON.stringify([e, ...leerRecientes().filter((x) => x !== e)].slice(0, 24))); } catch { /* sin almacenamiento */ }
}

type Grupos = { rot: string; lista: { e: string; palabras: string }[] }[];

/* Flota sobre todo (portal), al lado del botón que la abrió. La tabla (80 KB) se carga recién al abrirla. */
function ElegirEmoji({ ancla, onElegir, onCerrar }: { ancla: DOMRect; onElegir: (e: string) => void; onCerrar: () => void }) {
  const [q, setQ] = useState("");
  const [buscar, setBuscar] = useState<((q: string) => Grupos) | null>(null);
  const [recientes] = useState(leerRecientes);
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => { let vivo = true; void import("@/lib/emojis").then((m) => { if (vivo) setBuscar(() => m.buscarEmojis); }); return () => { vivo = false; }; }, []);
  useEffect(() => {
    const fuera = (ev: PointerEvent) => { if (caja.current && !caja.current.contains(ev.target as Node)) onCerrar(); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopImmediatePropagation(); onCerrar(); } };
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", fuera, true); document.removeEventListener("keydown", esc, true); };
  }, [onCerrar]);
  const grupos = useMemo((): Grupos => {
    if (!buscar) return [];
    const g = buscar(q);
    return !q.trim() && recientes.length ? [{ rot: "Recientes", lista: recientes.map((e) => ({ e, palabras: "" })) }, ...g] : g;
  }, [buscar, q, recientes]);
  const elegir = (e: string) => { anotarReciente(e); onElegir(e); };
  /* Siempre entera en la pantalla, con aire: abajo del botón si entra, si no arriba, y si no entra en ninguno, lo más arriba posible.
     En el celular, angosta como la pantalla. */
  const ANCHO = Math.min(320, window.innerWidth - 16), ALTO = Math.min(360, window.innerHeight - 24);
  const izquierda = Math.max(8, Math.min(window.innerWidth - ANCHO - 8, ancla.right - ANCHO));
  const arriba = ancla.bottom + 8 + ALTO <= window.innerHeight - 12 ? ancla.bottom + 6
    : ancla.top - ALTO - 6 >= 12 ? ancla.top - ALTO - 6 : Math.max(12, window.innerHeight - ALTO - 12);
  return createPortal(
    <div ref={caja} className="chatx-emojis" role="dialog" aria-label="Reaccionar con un emoji" style={{ left: izquierda, top: arriba, width: ANCHO, height: ALTO }}>
      <input
        className="chatx-emojis__buscar" type="search" value={q} autoFocus placeholder="Buscar emoji…" aria-label="Buscar emoji"
        onChange={(ev) => setQ(ev.target.value)}
        onKeyDown={(ev) => { const p = grupos[0]?.lista[0]?.e; if (ev.key === "Enter" && p) { ev.preventDefault(); elegir(p); } }}
      />
      <div className="chatx-emojis__zona">
        {!buscar ? <div className="chatx-emojis__nada"><Loader2 size={16} className="chatx-gira" /></div>
          : grupos.length === 0 ? <div className="chatx-emojis__nada">No hay emojis con «{q.trim()}».</div>
          : grupos.map((g) => (
            <div key={g.rot} role="group" aria-label={g.rot}>
              <div className="chatx-emojis__grupo">{g.rot}</div>
              <div className="chatx-emojis__grilla">
                {g.lista.map(({ e, palabras }) => (
                  <button key={`${g.rot}-${e}`} type="button" onClick={() => elegir(e)} aria-label={palabras ? `${e} ${palabras.split(" ")[0]}` : e} title={palabras.split(" ").slice(0, 3).join(" ")}>{e}</button>
                ))}
              </div>
            </div>
          ))}
      </div>
    </div>,
    document.body,
  );
}

/* ---------- Las fichitas de reacción debajo del mensaje ---------- */

function Reacciones({ c, yoEmail, yoNombre, onReaccionar }: { c: Comentario; yoEmail?: string; yoNombre: string; onReaccionar: (e: string) => void }) {
  const porEmoji = new Map<string, { quienes: string[]; mia: boolean }>();
  for (const r of c.reacciones ?? []) {
    const x = porEmoji.get(r.emoji) ?? { quienes: [], mia: false };
    const esMia = yoEmail ? r.email === yoEmail : !r.email && r.quien === yoNombre;
    x.quienes.push(esMia ? "vos" : r.quien);
    if (esMia) x.mia = true;
    porEmoji.set(r.emoji, x);
  }
  if (porEmoji.size === 0) return null;
  const lista = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs.at(-1)}`);
  return (
    <div className="chatx-reacciones">
      {[...porEmoji].map(([emoji, x]) => {
        const nombres = [...x.quienes.filter((q) => q !== "vos"), ...x.quienes.filter((q) => q === "vos")];
        const tip = `${lista(nombres)} ${nombres.length === 1 && nombres[0] === "vos" ? "reaccionaste" : nombres.length === 1 ? "reaccionó" : "reaccionaron"} con ${emoji}`;
        return (
          <button key={emoji} type="button" className={`chatx-reaccion${x.mia ? " chatx-reaccion--mia" : ""}`} onClick={() => onReaccionar(emoji)} title={tip}
            aria-label={`${tip}. ${x.mia ? "Sacar tu reacción" : "Sumarte"}`}>
            <span>{emoji}</span><span className="chatx-reaccion__n">{x.quienes.length}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ¿El mensaje es sólo uno a tres emojis? (va grande). Cuenta por grafema: 👍🏽 y 👨‍👩‍👧 son uno solo. */
const SOLO_EMOJI = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Emoji_Component}|\u200d|\ufe0f)+$/u;
function soloEmojis(texto: string): boolean {
  const t = texto.replace(/\s+/g, "");
  if (!t || t.length > 40 || !SOLO_EMOJI.test(t) || /^[\d#*]+$/.test(t)) return false;
  const n = typeof Intl !== "undefined" && "Segmenter" in Intl ? [...new Intl.Segmenter("es", { granularity: "grapheme" }).segment(t)].length : t.length;
  return n <= 3;
}

/* La foto de perfil de cada uno (lib/fotos-perfil.ts): la arma ChatEquipo una vez y la usan los mensajes, las caras de un hilo y quién leyó. */
/* Los nombres del equipo, para mencionar con «@» y resaltar las menciones (reunión del 21/10). */
const NombresCtx = createContext<string[]>([]);

/** El texto de un mensaje con las menciones a gente del equipo resaltadas. */
function TextoConMenciones({ texto }: { texto: string }) {
  const nombres = useContext(NombresCtx);
  const partes = useMemo(() => partesConMenciones(texto, nombres), [texto, nombres]);
  return <>{partes.map((p, i) => (p.mencion ? <span key={i} className="chatx-mencion" title={p.mencion}>{p.texto}</span> : <React.Fragment key={i}>{p.texto}</React.Fragment>))}</>;
}

const FotosCtx = createContext<(email: string | null | undefined, nombre: string) => string | undefined>(() => undefined);

/* ---------- La cita y los tildes ---------- */

/* Lleva hasta un mensaje ya dibujado en la misma lista y lo prende un momento (como Blue OS, destellarMensaje). */
function irAlMensaje(desde: HTMLElement, id: string) {
  const lista = desde.closest(".chatx-lista") ?? document;
  const destino = lista.querySelector<HTMLElement>(`[data-mensaje="${CSS.escape(id)}"]`);
  if (!destino) return;
  destino.scrollIntoView({ block: "center", behavior: "smooth" });
  destino.classList.remove("chatx-msj--destello");
  void destino.offsetWidth; // si se toca dos veces seguidas, el destello vuelve a empezar
  destino.classList.add("chatx-msj--destello");
  window.setTimeout(() => destino.classList.remove("chatx-msj--destello"), 1800);
}

/* El recuadro de arriba de una respuesta: de quién y qué decía el mensaje citado. Tocarlo lleva hasta él. */
function Cita({ original }: { original: Comentario | null }) {
  if (!original) {
    return <div className="chatx-cita chatx-cita--borrada"><span className="chatx-cita__txt"><span className="chatx-cita__resumen">Mensaje borrado</span></span></div>;
  }
  return (
    <button type="button" className="chatx-cita" onClick={(ev) => irAlMensaje(ev.currentTarget, original.id)} title="Ir al mensaje citado" aria-label={`Ir al mensaje citado de ${original.autor}`}>
      <span className="chatx-cita__txt">
        <span className="chatx-cita__autor">{original.autor}</span>
        <span className="chatx-cita__resumen">{resumenDeMensaje(original)}</span>
      </span>
    </button>
  );
}

/* Los tildes de WhatsApp (el dibujo de Blue OS, components/chat/BurbujaMensaje → Tildes y Reloj). */
function DibujoTildes({ estado }: { estado: DetalleEntrega["estado"] }) {
  if (estado === "enviando" || estado === "sin-enviar") {
    return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" strokeLinecap="round" /></svg>;
  }
  return (
    <svg width="17" height="12" viewBox="0 0 18 12" fill="none" aria-hidden>
      <path d="M1 6.2 4.2 9.4 10.6 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {estado !== "enviado" && <path d="M6.6 6.2 9.8 9.4 16.2 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

const QUE_DICE: Record<DetalleEntrega["estado"], string> = {
  "enviando": "Enviando…",
  "sin-enviar": "Todavía no se mandó: se reintenta solo al volver la conexión",
  "enviado": "Enviado",
  "recibido": "Les llegó a todos",
  "leido": "Lo leyeron todos",
};

/* Tocar los tildes muestra quién lo leyó, a quién le llegó y a quién todavía no (el «Info del mensaje» de WhatsApp). */
function Tildes({ d }: { d: DetalleEntrega }) {
  const foto = useContext(FotosCtx);
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!abierto) return;
    const fuera = (ev: PointerEvent) => { if (caja.current && !caja.current.contains(ev.target as Node)) setAbierto(false); };
    const esc = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.stopImmediatePropagation(); setAbierto(false); } };
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", fuera, true); document.removeEventListener("keydown", esc, true); };
  }, [abierto]);
  const enCola = d.estado === "enviando" || d.estado === "sin-enviar";
  const grupos = [
    { rot: "Lo leyeron", gente: d.leyeron, cls: "chatx-info__leido" },
    { rot: "Les llegó, sin leer", gente: d.recibieron, cls: "" },
    { rot: "Todavía no les llegó", gente: d.faltan, cls: "" },
  ].filter((g) => g.gente.length > 0);
  return (
    <span ref={caja} className="chatx-estado">
      <button type="button" className={`chatx-tildes chatx-tildes--${d.estado}`} onClick={() => !enCola && setAbierto((x) => !x)}
        aria-label={QUE_DICE[d.estado]} title={QUE_DICE[d.estado]} aria-expanded={enCola ? undefined : abierto}>
        <DibujoTildes estado={d.estado} />
      </button>
      {abierto && (
        <span className="chatx-info" role="dialog" aria-label="Quién lo vio">
          <span className="chatx-info__tit">{QUE_DICE[d.estado]}</span>
          {grupos.length === 0
            ? <span className="chatx-info__nada">Todavía nadie más abrió este chat. Cuando alguien lo abra, acá vas a ver si lo leyó.</span>
            : grupos.map((g) => (
              <span key={g.rot} className="chatx-info__grupo">
                <span className={`chatx-info__rot ${g.cls}`}>{g.rot}</span>
                {g.gente.map((n) => <span key={n} className="chatx-info__quien"><Avatar nombre={n} size={20} foto={foto(undefined, n)} />{n}</span>)}
              </span>
            ))}
        </span>
      )}
    </span>
  );
}

/* ---------- Un mensaje (como la burbuja del chat del equipo de Blue OS) ---------- */

function Mensaje({ c, esMio, respuestas, enHilo, seguido, onAbrirHilo, original, onCitar, entrega }: {
  c: Comentario; esMio: boolean; respuestas: Comentario[]; enHilo: boolean;
  /* Seguido de otro de la misma persona (menos de 2 minutos): va pegado, sin foto ni nombre. */
  seguido?: boolean;
  onAbrirHilo?: () => void;
  /* El mensaje que cita: undefined si no cita ninguno, null si el citado se borró. */
  original?: Comentario | null;
  onCitar?: () => void;
  /* Los tildes, sólo en los míos. */
  entrega?: DetalleEntrega;
}) {
  const yo = useUsuarioActual();
  const foto = useContext(FotosCtx);
  const [emojis, setEmojis] = useState<DOMRect | null>(null);
  const quienes = [...new Map(respuestas.map((r) => [r.autor, r] as const)).values()].slice(-3);
  const ultima = respuestas.at(-1);
  /* Un mensaje con respuestas no se borra: dejaría el hilo sin su original. */
  const puedeBorrar = esMio && respuestas.length === 0;
  const reaccionar = (emoji: string) => acciones.reaccionar(c.id, emoji, yo.nombre, yo.email ?? undefined);
  return (
    /* tabIndex -1: en el celular, tocar el mensaje le da el foco y así aparece su barra (no hay «pasar el mouse»). */
    <article tabIndex={-1} data-mensaje={c.id} className={`chatx-msj${seguido ? " chatx-msj--seguido" : ""}${emojis ? " chatx-msj--menu" : ""}${entrega ? " chatx-msj--con-tildes" : ""}`}>
      <div className="chatx-msj__foto">{!seguido && <Avatar nombre={c.autor} size={32} foto={foto(c.autorEmail, c.autor)} />}</div>
      <div className="chatx-msj__cuerpo">
        {!seguido ? (
          <div className="chatx-msj__cabeza">
            <span className="chatx-msj__autor">{c.autor}</span>
            <span className="chatx-msj__hora" title={fechaHora(c.creadoEn)}>{relativo(c.creadoEn)}</span>
          </div>
        ) : <span className="chatx-msj__hora chatx-msj__hora--al-lado" title={fechaHora(c.creadoEn)}>{fechaHora(c.creadoEn).slice(-5)}</span>}
        {original !== undefined && <Cita original={original} />}
        {/* Las fotos y los archivos arriba y el texto siempre al final, como en WhatsApp (pedido de Juan Cruz, 20/10). */}
        {c.adjuntos?.length ? <Adjuntos lista={c.adjuntos} /> : null}
        {c.texto && <p className={`chatx-msj__texto${soloEmojis(c.texto) ? " chatx-msj__texto--emoji" : ""}`}><TextoConMenciones texto={c.texto} /></p>}
        {entrega && <Tildes d={entrega} />}
        <Reacciones c={c} yoEmail={yo.email ?? undefined} yoNombre={yo.nombre} onReaccionar={reaccionar} />
        {!enHilo && respuestas.length > 0 && (
          <div className="chatx-hilo-pie">
            <span className="chatx-hilo-pie__curva" aria-hidden />
            <button type="button" onClick={onAbrirHilo} title="Ver el hilo">
              <span className="chatx-hilo-pie__caras">{quienes.map((r) => <Avatar key={r.autor} nombre={r.autor} size={22} foto={foto(r.autorEmail, r.autor)} />)}</span>
              <span className="chatx-hilo-pie__n">{respuestas.length} {respuestas.length === 1 ? "respuesta" : "respuestas"}</span>
              {ultima && <span className="chatx-hilo-pie__cuando">Última respuesta {relativo(ultima.creadoEn)}</span>}
            </button>
          </div>
        )}
      </div>
      <div className="chatx-barra-msj" role="toolbar" aria-label="Acciones del mensaje">
        {REACCIONES_RAPIDAS.map((e) => (
          <button key={e} type="button" className="chatx-barra-msj__emoji" onClick={() => reaccionar(e)} aria-label={`Reaccionar con ${e}`} data-tip={`Reaccionar con ${e}`}>{e}</button>
        ))}
        <button type="button" onClick={(ev) => { const r = ev.currentTarget.getBoundingClientRect(); setEmojis((x) => (x ? null : r)); }} aria-label="Más reacciones" data-tip="Más reacciones" aria-expanded={Boolean(emojis)}>
          <Smile size={17} />
        </button>
        <span className="chatx-barra-msj__div" aria-hidden />
        {onCitar && (
          <button type="button" onClick={onCitar} aria-label="Responder citando este mensaje" data-tip="Responder"><Reply size={17} /></button>
        )}
        {!enHilo && onAbrirHilo && (
          <button type="button" onClick={onAbrirHilo} aria-label="Responder en hilo" data-tip="Responder en hilo"><MessageSquareReply size={17} /></button>
        )}
        {puedeBorrar && (
          <button type="button" onClick={() => acciones.borrarComentario(c.id)} aria-label="Borrar mi mensaje" data-tip="Borrar"><Trash2 size={16} /></button>
        )}
      </div>
      {emojis && <ElegirEmoji ancla={emojis} onElegir={(e) => { reaccionar(e); setEmojis(null); }} onCerrar={() => setEmojis(null)} />}
    </article>
  );
}

/* Mensajes seguidos de la misma persona (menos de 2 minutos y sin hilo en el de arriba) van pegados, como en Blue OS. */
const DOS_MINUTOS = 2 * 60 * 1000;
function esSeguido(anterior: Comentario | undefined, c: Comentario, conHilo: boolean): boolean {
  return Boolean(anterior && !conHilo && anterior.autor === c.autor && +new Date(c.creadoEn) - +new Date(anterior.creadoEn) < DOS_MINUTOS);
}

/* ---------- El chat ---------- */

export function ChatEquipo({ contactoId, comentarios: llegados, titulo = "Chat del equipo" }: { contactoId: string; comentarios: Comentario[]; titulo?: string }) {
  const yo = useUsuarioActual();
  const quien = claveDe(yo.email, yo.nombre);
  const estado = useEstado();
  const fotos = useMemo(() => mapaDeFotos(estado.fotosPerfil, estado.equipo), [estado.fotosPerfil, estado.equipo]);
  const buscarFoto = useCallback((email: string | null | undefined, nombre: string) => fotoDe(fotos, email, nombre), [fotos]);
  const nombresEquipo = useMemo(() => [...new Set(estado.equipo.filter((m) => m.activo !== false && m.nombre?.trim()).map((m) => m.nombre.trim()))]
    .sort((a, b) => a.localeCompare(b, "es")), [estado.equipo]);
  /* Re-dibuja cuando la cola termina de mandar: así el reloj pasa a tilde. */
  const sync = useSync();
  const fin = useRef<HTMLDivElement>(null);
  const finHilo = useRef<HTMLDivElement>(null);
  const caja = useRef<Puerta | null>(null);
  const cajaHilo = useRef<Puerta | null>(null);
  const [soltando, setSoltando] = useState(false);
  const [hilo, setHilo] = useState<string | null>(null);
  /* El mensaje que se está citando con «Responder», en la conversación y en el hilo. */
  const [citaId, setCitaId] = useState<string | null>(null);
  const [citaHiloId, setCitaHiloId] = useState<string | null>(null);

  /* En orden de llegada: lo que entra en vivo puede venir desordenado. */
  const comentarios = useMemo(() => [...llegados].sort((a, b) => +new Date(a.creadoEn) - +new Date(b.creadoEn)), [llegados]);
  const porId = useMemo(() => new Map(comentarios.map((c) => [c.id, c] as const)), [comentarios]);
  const lecturas = useMemo((): ChatLectura[] => (estado.chatLecturas ?? []).filter((l) => l.contactoId === contactoId), [estado.chatLecturas, contactoId]);

  /* La conversación son los mensajes de arriba; las respuestas cuelgan de su original. Una respuesta cuyo original
     ya no está se muestra en la conversación, para no perderla. */
  const { raices, respuestasDe } = useMemo(() => {
    const de = new Map<string, Comentario[]>();
    const raices: Comentario[] = [];
    for (const c of comentarios) {
      if (c.respondeA && porId.has(c.respondeA)) { const xs = de.get(c.respondeA); if (xs) xs.push(c); else de.set(c.respondeA, [c]); }
      else raices.push(c);
    }
    return { raices, respuestasDe: de };
  }, [comentarios, porId]);
  const original = hilo ? porId.get(hilo) : undefined;
  const delHilo = hilo ? respuestasDe.get(hilo) ?? [] : [];
  const cita = citaId ? porId.get(citaId) ?? null : null;
  const citaHilo = citaHiloId ? porId.get(citaHiloId) ?? null : null;

  /* Al abrir y con cada mensaje nuevo, lo último a la vista. */
  useEffect(() => { fin.current?.scrollIntoView({ block: "nearest" }); }, [raices.length]);
  useEffect(() => { finHilo.current?.scrollIntoView({ block: "nearest" }); }, [delHilo.length, hilo]);
  /* Si borran el original, el hilo se cierra solo. Al cambiar de hilo, la cita del anterior no sigue. */
  useEffect(() => { if (hilo && !original) setHilo(null); }, [hilo, original]);
  useEffect(() => { setCitaHiloId(null); }, [hilo]);

  /* Con el chat a la vista, lo que escribieron los demás queda LEÍDO (sus tildes se ponen azules).
     Si la pestaña está escondida, recién cuando se vuelve a ella. */
  useEffect(() => {
    const leer = () => { if (document.visibilityState === "visible") acciones.marcarLeido(contactoId, quien, yo.nombre); };
    leer();
    document.addEventListener("visibilitychange", leer);
    return () => document.removeEventListener("visibilitychange", leer);
  }, [contactoId, quien, yo.nombre, comentarios]);

  /* Esc: primero deja de citar, después cierra el hilo. Va antes que el Esc de la ficha (que la cerraría entera). */
  useEffect(() => {
    if (!hilo && !citaId) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      ev.stopImmediatePropagation();
      if (hilo && citaHiloId) setCitaHiloId(null);
      else if (hilo) setHilo(null);
      else setCitaId(null);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hilo, citaId, citaHiloId]);

  const esMio = (c: Comentario) => (yo.email ? c.autorEmail === yo.email : c.autor === yo.nombre);
  const ctxEntrega = useMemo(() => contextoDeEntrega(comentarios, lecturas), [comentarios, lecturas]);
  const entrega = (c: Comentario): DetalleEntrega | undefined => (esMio(c)
    ? entregaCon(c, ctxEntrega, { pendiente: escrituraPendiente("comentarios", c.id), error: sync.estado === "error" })
    : undefined);
  /* undefined: no cita nada · null: el citado se borró. */
  const citadoDe = (c: Comentario) => (c.citaA ? porId.get(c.citaA) ?? null : undefined);
  const citar = (c: Comentario, enHilo: boolean) => {
    if (enHilo) { setCitaHiloId(c.id); cajaHilo.current?.enfocar(); }
    else { setCitaId(c.id); caja.current?.enfocar(); }
  };

  return (
    <NombresCtx.Provider value={nombresEquipo}>
    <FotosCtx.Provider value={buscarFoto}>
      <div
        className={`chat${hilo ? " chat--con-hilo" : ""}${soltando ? " chat--soltando" : ""}`}
        onDragOver={(ev) => { if (Array.from(ev.dataTransfer.types).includes("Files")) { ev.preventDefault(); setSoltando(true); } }}
        onDragLeave={(ev) => { if (ev.currentTarget === ev.target) setSoltando(false); }}
        onDrop={(ev) => {
          if (!ev.dataTransfer.files.length) return;
          ev.preventDefault();
          setSoltando(false);
          (hilo ? cajaHilo : caja).current?.agregar(Array.from(ev.dataTransfer.files));
        }}
      >
        <div className="chatx-cabeza">
          <span className="chatx-cabeza__tit">{titulo}{raices.length > 0 && <span className="t-subtle t-num"> · {comentarios.length}</span>}</span>
        </div>

        <div className="chatx-cuerpo">
          <section className="chatx-conversacion" aria-label="Conversación">
            {/* Los mensajes scrollean adentro, como en cualquier chat: la caja para escribir queda abajo. */}
            <div className="chat__lista lista-scroll chatx-lista" role="log" aria-label="Mensajes del equipo">
              {raices.length === 0 ? (
                <Empty
                  icono={<MessageSquare size={22} />}
                  titulo="Todavía nadie escribió"
                  texto="Lo que el equipo anote acá lo ve cualquiera que abra esta ficha: cómo fue la llamada, qué pidió, por qué se atrasó. También se pueden mandar fotos, audios y archivos, y responder en hilo."
                />
              ) : raices.map((c, i) => (
                <Mensaje key={c.id} c={c} esMio={esMio(c)} respuestas={respuestasDe.get(c.id) ?? []} enHilo={false} onAbrirHilo={() => setHilo(c.id)}
                  seguido={esSeguido(raices[i - 1], c, (respuestasDe.get(raices[i - 1]?.id ?? "")?.length ?? 0) > 0)}
                  original={citadoDe(c)} onCitar={() => citar(c, false)} entrega={entrega(c)} />
              ))}
              <div ref={fin} />
            </div>
            <Caja contactoId={contactoId} puerta={caja} cita={cita} onSacarCita={() => setCitaId(null)} />
          </section>

          {original && (
            <section className="chatx-hilo" aria-label="Hilo">
              <div className="chatx-hilo__cabeza">
                <button type="button" className="chatx-boton chatx-hilo__volver" onClick={() => setHilo(null)} aria-label="Volver a la conversación" title="Volver"><ArrowLeft size={16} /></button>
                <span className="chatx-cabeza__tit">Hilo{delHilo.length > 0 && <span className="t-subtle t-num"> · {delHilo.length} {delHilo.length === 1 ? "respuesta" : "respuestas"}</span>}</span>
                <button type="button" className="chatx-boton chatx-hilo__cerrar" onClick={() => setHilo(null)} aria-label="Cerrar el hilo" title="Cerrar"><X size={16} /></button>
              </div>
              <div className="chat__lista lista-scroll chatx-lista chatx-hilo__lista" role="log" aria-label="Respuestas del hilo">
                <Mensaje c={original} esMio={esMio(original)} respuestas={delHilo} enHilo original={citadoDe(original)} onCitar={() => citar(original, true)} entrega={entrega(original)} />
                <div className="chatx-hilo__separador"><span>{delHilo.length ? `${delHilo.length} ${delHilo.length === 1 ? "respuesta" : "respuestas"}` : "Todavía nadie respondió"}</span></div>
                {delHilo.map((r, i) => (
                  <Mensaje key={r.id} c={r} esMio={esMio(r)} respuestas={[]} enHilo seguido={i > 0 && esSeguido(delHilo[i - 1], r, false)}
                    original={citadoDe(r)} onCitar={() => citar(r, true)} entrega={entrega(r)} />
                ))}
                <div ref={finHilo} />
              </div>
              <Caja key={original.id} contactoId={contactoId} puerta={cajaHilo} respondeA={original.id} enfocar cita={citaHilo} onSacarCita={() => setCitaHiloId(null)} />
            </section>
          )}
        </div>

        {soltando && <div className="chatx-soltar" aria-hidden><Paperclip size={20} />Soltá para adjuntar</div>}
      </div>
    </FotosCtx.Provider>
    </NombresCtx.Provider>
  );
}
