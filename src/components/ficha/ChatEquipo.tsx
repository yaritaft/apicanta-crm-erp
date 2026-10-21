"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowUp, Download, FileText, Loader2, Maximize2, MessageSquare, MessageSquareReply, Mic, Minimize2, Paperclip, Pause, Play, Trash2, X,
} from "lucide-react";
import { Avatar, Empty } from "@/components/ui/ui";
import { useToast } from "@/components/ui/Toast";
import { acciones } from "@/lib/store";
import { fechaHora, relativo } from "@/lib/format";
import { useUsuarioActual } from "@/lib/usuario";
import {
  ADJUNTOS_POR_MENSAJE, descartarAdjunto, duracionLegible, normalizarPicos, problemaDeAdjunto, subirAdjunto, tamanioLegible, tipoDeArchivo, urlDeAdjunto,
} from "@/lib/adjuntos-chat";
import type { Adjunto, Comentario } from "@/lib/types";
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
       el hilo se abre al costado o, si no entra, encima de la conversación;
     · el chat se agranda a casi toda la pantalla y vuelve con Esc.

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

function Imagen({ a }: { a: Adjunto }) {
  const url = useUrl(a);
  const proporcion = a.ancho && a.alto ? `${a.ancho} / ${a.alto}` : "4 / 3";
  return (
    <a className="chatx-imagen" href={url ?? undefined} target="_blank" rel="noopener noreferrer" title={`Abrir ${a.nombre}`} style={{ aspectRatio: proporcion }}
      onClick={(ev) => { if (!url) ev.preventDefault(); }}>
      {url ? <img src={url} alt={a.nombre} loading="lazy" /> : <Loader2 size={18} className="chatx-gira" aria-hidden />}
    </a>
  );
}

function Video({ a }: { a: Adjunto }) {
  const url = useUrl(a);
  return url
    ? <video className="chatx-video" src={url} controls preload="metadata" />
    : <div className="chatx-video chatx-video--cargando"><Loader2 size={18} className="chatx-gira" aria-hidden /></div>;
}

/* Una nota de voz (o un audio adjuntado): play, la onda que se pinta a medida que avanza y el tiempo. */
function NotaDeVoz({ a }: { a: Adjunto }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [sonando, setSonando] = useState(false);
  const [avance, setAvance] = useState(0);
  const [duracion, setDuracion] = useState(a.duracion ?? 0);
  const [cargando, setCargando] = useState(false);
  const toast = useToast();
  const picos = a.picos?.length ? a.picos : Array.from({ length: 32 }, (_, i) => 0.3 + 0.25 * Math.abs(Math.sin(i * 1.7)));

  useEffect(() => () => { audio.current?.pause(); }, []);

  async function alternar() {
    if (!audio.current) {
      setCargando(true);
      try {
        const el = new Audio(await urlDeAdjunto(a));
        el.ontimeupdate = () => setAvance(el.duration ? el.currentTime / el.duration : 0);
        el.onloadedmetadata = () => { if (Number.isFinite(el.duration)) setDuracion(el.duration); };
        el.onended = () => { setSonando(false); setAvance(0); };
        audio.current = el;
      } catch (err) {
        toast(err instanceof Error ? err.message : "No se pudo abrir el audio.", "err");
        setCargando(false);
        return;
      }
      setCargando(false);
    }
    const el = audio.current;
    if (el.paused) { await el.play().catch(() => undefined); setSonando(true); } else { el.pause(); setSonando(false); }
  }

  function saltar(ev: React.MouseEvent<HTMLDivElement>) {
    const el = audio.current;
    if (!el || !el.duration) return;
    const r = ev.currentTarget.getBoundingClientRect();
    el.currentTime = ((ev.clientX - r.left) / r.width) * el.duration;
  }

  return (
    <div className="chatx-audio">
      <button type="button" className="chatx-audio__play" onClick={alternar} aria-label={sonando ? "Pausar" : "Escuchar"}>
        {cargando ? <Loader2 size={16} className="chatx-gira" /> : sonando ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <div className="chatx-onda" onClick={saltar} role="presentation">
        {picos.map((p, i) => (
          <span key={i} className={i / picos.length < avance ? "chatx-onda__barra chatx-onda__barra--hecha" : "chatx-onda__barra"} style={{ height: `${Math.round(p * 100)}%` }} />
        ))}
      </div>
      <span className="chatx-audio__t">{duracionLegible(sonando || avance ? duracion * avance : duracion) || (a.notaDeVoz ? "Nota" : "Audio")}</span>
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
  return (
    <div className="chatx-adjuntos">
      {imagenes.length > 0 && (
        <div className={`chatx-galeria${imagenes.length > 1 ? " chatx-galeria--varias" : ""}`}>
          {imagenes.map((a) => <Imagen key={a.id} a={a} />)}
        </div>
      )}
      {resto.map((a) => a.tipo === "video" ? <Video key={a.id} a={a} /> : a.tipo === "audio" ? <NotaDeVoz key={a.id} a={a} /> : <Archivo key={a.id} a={a} />)}
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

interface Pendiente { clave: string; archivo: File; vista?: string; estado: "subiendo" | "listo" | "error"; adjunto?: Adjunto; error?: string }

type Puerta = { agregar: (f: File[]) => void };

function Caja({ contactoId, puerta, respondeA, enfocar }: {
  contactoId: string; puerta: React.MutableRefObject<Puerta | null>;
  /* En un hilo: el mensaje al que se responde. */
  respondeA?: string;
  /* Pone el cursor en la caja al aparecer (al abrir un hilo). */
  enfocar?: boolean;
}) {
  const yo = useUsuarioActual();
  const toast = useToast();
  const [texto, setTexto] = useState("");
  const [pendientes, setPendientes] = useState<Pendiente[]>([]);
  const [mandandoNota, setMandandoNota] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const elegir = useRef<HTMLInputElement>(null);
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

  /** La puerta única de un archivo: el clip, pegar o soltar. */
  const agregar = useCallback((archivos: File[]) => {
    const lugar = ADJUNTOS_POR_MENSAJE - pendientesRef.current.length;
    if (archivos.length > lugar) toast(`Entran hasta ${ADJUNTOS_POR_MENSAJE} archivos por mensaje.`, "err");
    for (const archivo of archivos.slice(0, Math.max(0, lugar))) {
      const problema = problemaDeAdjunto(archivo);
      if (problema) { toast(problema, "err"); continue; }
      const clave = crypto.randomUUID();
      const vista = tipoDeArchivo(archivo.type, archivo.name) === "imagen" ? URL.createObjectURL(archivo) : undefined;
      setPendientes((xs) => [...xs, { clave, archivo, vista, estado: "subiendo" }]);
      subirAdjunto(archivo, contactoId).then(
        (adjunto) => setPendientes((xs) => xs.map((p) => (p.clave === clave ? { ...p, estado: "listo", adjunto } : p))),
        (err: Error) => setPendientes((xs) => xs.map((p) => (p.clave === clave ? { ...p, estado: "error", error: err.message } : p))),
      );
    }
  }, [contactoId, toast]);

  /* Lo que se suelta encima de los mensajes entra por la misma puerta. */
  useEffect(() => {
    puerta.current = { agregar };
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
    acciones.comentar(contactoId, texto, yo.nombre, yo.email ?? undefined, listos, respondeA);
    for (const p of pendientes) if (p.vista) URL.revokeObjectURL(p.vista);
    setTexto("");
    setPendientes([]);
    area.current?.focus();
  }

  async function mandarNota() {
    setMandandoNota(true);
    try {
      const nota = await grabadora.terminar();
      if (!nota) { toast("No se grabó nada.", "err"); return; }
      const adjunto = await subirAdjunto(nota.archivo, contactoId, { duracion: nota.duracion, picos: nota.picos, notaDeVoz: true });
      acciones.comentar(contactoId, "", yo.nombre, yo.email ?? undefined, [adjunto], respondeA);
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
        <button type="button" className="chatx-enviar" onClick={mandarNota} disabled={pidiendo || mandandoNota} aria-label="Mandar la nota de voz" title="Mandar">
          {mandandoNota ? <Loader2 size={17} className="chatx-gira" /> : <ArrowUp size={18} />}
        </button>
      </div>
    );
  }

  return (
    <div className="chatx-caja">
      {pendientes.length > 0 && (
        <div className="chatx-fichitas">
          {pendientes.map((p) => (
            <div key={p.clave} className={`chatx-fichita${p.estado === "error" ? " chatx-fichita--error" : ""}`} title={p.error ?? p.archivo.name}>
              {p.vista ? <img src={p.vista} alt="" /> : <span className="chatx-fichita__ico"><FileText size={16} /></span>}
              <span className="chatx-fichita__txt"><span className="truncate">{p.archivo.name}</span>
                <small>{p.estado === "subiendo" ? "Subiendo…" : p.estado === "error" ? "No se pudo subir" : tamanioLegible(p.archivo.size)}</small></span>
              {p.estado === "subiendo" && <Loader2 size={14} className="chatx-gira" aria-hidden />}
              <button type="button" className="chatx-fichita__x" onClick={() => sacar(p)} aria-label={`Sacar ${p.archivo.name}`}><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={area} value={texto} rows={1} autoFocus={enfocar} aria-label={respondeA ? "Respuesta en el hilo" : "Mensaje para el equipo"}
        placeholder={respondeA ? "Responder en el hilo…" : `Escribí al equipo, ${yo.nombre.split(" ")[0]}…`}
        onChange={(ev) => setTexto(ev.target.value)}
        onKeyDown={(ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.nativeEvent.isComposing) { ev.preventDefault(); mandar(); } }}
        onPaste={(ev) => {
          const archivos = Array.from(ev.clipboardData.files);
          if (archivos.length) { ev.preventDefault(); agregar(archivos); }
        }}
      />
      <div className="chatx-barra">
        <button type="button" className="chatx-boton" onClick={() => elegir.current?.click()} aria-label="Adjuntar fotos, videos o archivos" title="Adjuntar (también podés pegar o soltar)"><Paperclip size={17} /></button>
        <button type="button" className="chatx-boton" onClick={grabadora.empezar} aria-label="Grabar una nota de voz" title="Grabar una nota de voz"><Mic size={17} /></button>
        <input ref={elegir} type="file" multiple hidden onChange={(ev) => { agregar(Array.from(ev.target.files ?? [])); ev.target.value = ""; }} />
        <span className="chatx-ayuda">Enter manda · Shift+Enter, otro renglón</span>
        <button type="button" className="chatx-enviar" onClick={mandar} disabled={!puedeMandar} aria-label="Mandar" title={subiendo ? "Esperá a que terminen de subir los archivos" : "Mandar"}>
          {subiendo ? <Loader2 size={17} className="chatx-gira" /> : <ArrowUp size={18} />}
        </button>
      </div>
    </div>
  );
}

/* ---------- Un mensaje ---------- */

function Mensaje({ c, esMio, respuestas, enHilo, onAbrirHilo }: {
  c: Comentario; esMio: boolean; respuestas: Comentario[]; enHilo: boolean; onAbrirHilo?: () => void;
}) {
  const quienes = [...new Map(respuestas.map((r) => [r.autor, r] as const)).values()].slice(-3);
  const ultima = respuestas.at(-1);
  /* Un mensaje con respuestas no se borra: dejaría el hilo sin su original. */
  const puedeBorrar = esMio && respuestas.length === 0;
  return (
    <div className="chat__msj chatx-msj">
      <Avatar nombre={c.autor} size={30} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="row" style={{ gap: 8 }}>
          <span className="t-sm t-strong">{c.autor}</span>
          <span className="t-sm t-subtle" title={fechaHora(c.creadoEn)}>{relativo(c.creadoEn)}</span>
        </div>
        {c.texto && <p className="chat__texto">{c.texto}</p>}
        {c.adjuntos?.length ? <Adjuntos lista={c.adjuntos} /> : null}
        {!enHilo && respuestas.length > 0 && (
          <button type="button" className="chatx-hilo-pie" onClick={onAbrirHilo} title="Ver el hilo">
            <span className="chatx-hilo-pie__caras">{quienes.map((r) => <Avatar key={r.autor} nombre={r.autor} size={20} />)}</span>
            <span className="chatx-hilo-pie__n">{respuestas.length} {respuestas.length === 1 ? "respuesta" : "respuestas"}</span>
            {ultima && <span className="chatx-hilo-pie__cuando">Última {relativo(ultima.creadoEn)}</span>}
          </button>
        )}
      </div>
      <div className="chatx-acciones" role="toolbar" aria-label="Acciones del mensaje">
        {!enHilo && onAbrirHilo && (
          <button type="button" onClick={onAbrirHilo} aria-label="Responder en hilo" title="Responder en hilo"><MessageSquareReply size={15} /></button>
        )}
        {puedeBorrar && (
          <button type="button" onClick={() => acciones.borrarComentario(c.id)} aria-label="Borrar mi mensaje" title="Borrar"><Trash2 size={14} /></button>
        )}
      </div>
    </div>
  );
}

/* ---------- El chat ---------- */

export function ChatEquipo({ contactoId, comentarios, titulo = "Chat del equipo" }: { contactoId: string; comentarios: Comentario[]; titulo?: string }) {
  const yo = useUsuarioActual();
  const fin = useRef<HTMLDivElement>(null);
  const finHilo = useRef<HTMLDivElement>(null);
  const caja = useRef<Puerta | null>(null);
  const cajaHilo = useRef<Puerta | null>(null);
  const [soltando, setSoltando] = useState(false);
  const [grande, setGrande] = useState(false);
  const [hilo, setHilo] = useState<string | null>(null);

  /* La conversación son los mensajes de arriba; las respuestas cuelgan de su original. Una respuesta cuyo original
     ya no está se muestra en la conversación, para no perderla. */
  const { raices, respuestasDe } = useMemo(() => {
    const ids = new Set(comentarios.map((c) => c.id));
    const de = new Map<string, Comentario[]>();
    const raices: Comentario[] = [];
    for (const c of comentarios) {
      if (c.respondeA && ids.has(c.respondeA)) de.set(c.respondeA, [...(de.get(c.respondeA) ?? []), c]);
      else raices.push(c);
    }
    return { raices, respuestasDe: de };
  }, [comentarios]);
  const original = hilo ? comentarios.find((c) => c.id === hilo) : undefined;
  const delHilo = hilo ? respuestasDe.get(hilo) ?? [] : [];

  /* Al abrir y con cada mensaje nuevo, lo último a la vista. */
  useEffect(() => { fin.current?.scrollIntoView({ block: "nearest" }); }, [raices.length]);
  useEffect(() => { finHilo.current?.scrollIntoView({ block: "nearest" }); }, [delHilo.length, hilo]);
  /* Si borran el original, el hilo se cierra solo. */
  useEffect(() => { if (hilo && !original) setHilo(null); }, [hilo, original]);

  /* Esc cierra primero el hilo y después lo agrandado. Va antes que el Esc de la ficha (que la cerraría entera). */
  useEffect(() => {
    if (!grande && !hilo) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || document.querySelector(".modal-backdrop")) return;
      ev.stopImmediatePropagation();
      if (hilo) setHilo(null);
      else setGrande(false);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [grande, hilo]);

  const esMio = (c: Comentario) => (yo.email ? c.autorEmail === yo.email : c.autor === yo.nombre);

  return (
    <>
      {grande && <div className="chatx-fondo" onClick={() => setGrande(false)} aria-hidden />}
      <div
        className={`chat${grande ? " chat--grande" : ""}${hilo ? " chat--con-hilo" : ""}${soltando ? " chat--soltando" : ""}`}
        role={grande ? "dialog" : undefined} aria-label={grande ? titulo : undefined}
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
          <button type="button" className="chatx-boton" onClick={() => setGrande((g) => !g)}
            aria-label={grande ? "Achicar el chat" : "Agrandar el chat"} title={grande ? "Achicar (Esc)" : "Agrandar el chat"}>
            {grande ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
        </div>

        <div className="chatx-cuerpo">
          <section className="chatx-conversacion" aria-label="Conversación">
            {/* Los mensajes scrollean adentro, como en cualquier chat: la caja para escribir queda abajo. */}
            <div className="chat__lista lista-scroll" role="log" aria-label="Mensajes del equipo">
              {raices.length === 0 ? (
                <Empty
                  icono={<MessageSquare size={22} />}
                  titulo="Todavía nadie escribió"
                  texto="Lo que el equipo anote acá lo ve cualquiera que abra esta ficha: cómo fue la llamada, qué pidió, por qué se atrasó. También se pueden mandar fotos, audios y archivos, y responder en hilo."
                />
              ) : raices.map((c) => (
                <Mensaje key={c.id} c={c} esMio={esMio(c)} respuestas={respuestasDe.get(c.id) ?? []} enHilo={false} onAbrirHilo={() => setHilo(c.id)} />
              ))}
              <div ref={fin} />
            </div>
            <Caja contactoId={contactoId} puerta={caja} />
          </section>

          {original && (
            <section className="chatx-hilo" aria-label="Hilo">
              <div className="chatx-hilo__cabeza">
                <button type="button" className="chatx-boton chatx-hilo__volver" onClick={() => setHilo(null)} aria-label="Volver a la conversación" title="Volver"><ArrowLeft size={16} /></button>
                <span className="chatx-cabeza__tit">Hilo{delHilo.length > 0 && <span className="t-subtle t-num"> · {delHilo.length} {delHilo.length === 1 ? "respuesta" : "respuestas"}</span>}</span>
                <button type="button" className="chatx-boton chatx-hilo__cerrar" onClick={() => setHilo(null)} aria-label="Cerrar el hilo" title="Cerrar"><X size={16} /></button>
              </div>
              <div className="chat__lista lista-scroll chatx-hilo__lista" role="log" aria-label="Respuestas del hilo">
                <Mensaje c={original} esMio={esMio(original)} respuestas={delHilo} enHilo />
                <div className="chatx-hilo__separador"><span>{delHilo.length ? `${delHilo.length} ${delHilo.length === 1 ? "respuesta" : "respuestas"}` : "Todavía nadie respondió"}</span></div>
                {delHilo.map((r) => <Mensaje key={r.id} c={r} esMio={esMio(r)} respuestas={[]} enHilo />)}
                <div ref={finHilo} />
              </div>
              <Caja key={original.id} contactoId={contactoId} puerta={cajaHilo} respondeA={original.id} enfocar />
            </section>
          )}
        </div>

        {soltando && <div className="chatx-soltar" aria-hidden><Paperclip size={20} />Soltá para adjuntar</div>}
      </div>
    </>
  );
}
