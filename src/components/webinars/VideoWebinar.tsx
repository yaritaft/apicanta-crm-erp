"use client";

import React, { useState } from "react";
import {
  ExternalLink, Eye, Link2, MessageCircle, RefreshCw, ThumbsUp, Trash2, Youtube,
} from "lucide-react";
import { Avatar, Badge, Button, Card, Input } from "@/components/ui/ui";
import { num, relativo } from "@/lib/format";
import {
  duracionLegible, embebidoDe, idDeYoutube, partirConLinks, videoDe, type DatosYoutube,
} from "@/lib/youtube";
import type { Webinar } from "@/lib/types";
import { diaCorto, diaYHora } from "./fechas";
import { guardarWebinar } from "./guardar";
import { useYoutube } from "./useYoutube";

/* ==================================================================
   El video del webinar: el vivo o la grabación, embebido, con lo que
   dice YouTube de él abajo.

   El embebido no depende de nada: con el link alcanza. Los números
   (vistas, likes, comentarios, suscriptores) vienen de /api/youtube, que
   necesita la clave de YouTube; sin ella se ve igual el video, el título
   y el canal, y se avisa qué falta.
   ================================================================== */

export function VideoWebinar({ w, className }: { w: Webinar; className?: string }) {
  const [cambiando, setCambiando] = useState(false);

  /* Si nunca se cargó el link pero el del replay es de YouTube, se usa ése:
     muchos webinars viejos lo tienen ahí. Un "" guardado es "sin video"
     a propósito (se quitó), y ahí no se busca nada. */
  const propio = idDeYoutube(w.youtubeUrl);
  const delReplay = w.youtubeUrl == null ? idDeYoutube(w.enlaceReplay) : null;
  const id = propio ?? delReplay;

  if (!id || cambiando) {
    return (
      <Card className={className}>
        <PegarLink
          w={w}
          inicial={w.youtubeUrl ?? ""}
          onListo={() => setCambiando(false)}
          onCancelar={cambiando ? () => setCambiando(false) : undefined}
        />
      </Card>
    );
  }

  return (
    <Card className={`wb-video${className ? ` ${className}` : ""}`}>
      <Reproductor id={id} titulo={w.titulo} />
      <InfoVideo
        id={id}
        delReplay={Boolean(delReplay)}
        onCambiar={() => setCambiando(true)}
        onQuitar={() => guardarWebinar(w, { youtubeUrl: "" }, `Se sacó el video de YouTube de «${w.titulo}».`)}
      />
    </Card>
  );
}

function Reproductor({ id, titulo }: { id: string; titulo: string }) {
  return (
    <div className="wb-video__marco">
      <iframe
        src={embebidoDe(id)}
        title={`Video de YouTube de «${titulo}»`}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        /* Sin referrer YouTube se niega a reproducir el embebido. */
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  );
}

function InfoVideo({ id, delReplay, onCambiar, onQuitar }: {
  id: string; delReplay: boolean; onCambiar: () => void; onQuitar: () => void;
}) {
  const yt = useYoutube(id);

  const acciones = (
    <div className="row-wrap wb-video__acciones">
      <a href={videoDe(id)} target="_blank" rel="noopener noreferrer" className="hk-btn hk-btn--secondary hk-btn--sm">
        <ExternalLink size={15} />Abrir en YouTube
      </a>
      <Button sm variante="ghost" icono={<Link2 size={15} />} onClick={onCambiar}>
        {delReplay ? "Usar otro link" : "Cambiar link"}
      </Button>
      {yt.estado === "listo" && (
        <Button sm variante="ghost" icono={<RefreshCw size={15} />} onClick={yt.recargar} title="Volver a preguntarle a YouTube">
          Actualizar
        </Button>
      )}
      {!delReplay && (
        <Button sm variante="ghost" icono={<Trash2 size={15} />} onClick={onQuitar}>Quitar</Button>
      )}
    </div>
  );

  if (yt.estado === "cargando" || yt.estado === "sin-video") {
    return (
      <div className="wb-video__info" aria-busy="true" aria-label="Trayendo los datos del video">
        <div className="skeleton" style={{ height: 22, width: "70%" }} />
        <div className="skeleton" style={{ height: 14, width: "40%" }} />
        <div className="wb-cifras">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton" style={{ height: 58 }} />)}
        </div>
      </div>
    );
  }

  if (yt.estado === "error") {
    return (
      <div className="wb-video__info">
        <p className="t-body" style={{ color: yt.noExiste ? "var(--warning)" : "var(--ink-muted)" }}>{yt.error}</p>
        <div className="row-wrap">
          {!yt.noExiste && <Button sm variante="secondary" icono={<RefreshCw size={15} />} onClick={yt.recargar}>Reintentar</Button>}
        </div>
        {acciones}
      </div>
    );
  }

  const d = yt.datos;
  return (
    <div className="wb-video__info">
      <div className="stack-2">
        <div className="row-wrap" style={{ alignItems: "flex-start" }}>
          <h2 className="t-h3 wb-video__titulo">{d.titulo || "Video sin título"}</h2>
          <EstadoVivo d={d} />
        </div>
        <p className="t-sm t-subtle t-num">
          {cuando(d)}
          {d.duracionSeg ? ` · ${duracionLegible(d.duracionSeg)}` : ""}
          {delReplay ? " · es el link del replay" : ""}
        </p>
      </div>

      {d.completo ? (
        <div className="wb-cifras">
          <Cifra icono={<Eye size={15} />} etiqueta="Vistas" valor={d.vistas} />
          <Cifra icono={<ThumbsUp size={15} />} etiqueta="Me gusta" valor={d.likes} siFalta="Ocultos" />
          <Cifra icono={<MessageCircle size={15} />} etiqueta="Comentarios" valor={d.comentarios} siFalta="Cerrados" />
          {d.vivo?.estado === "en-vivo" && d.vivo.espectadores !== undefined && (
            <Cifra icono={<Youtube size={15} />} etiqueta="Mirando ahora" valor={d.vivo.espectadores} />
          )}
        </div>
      ) : null}

      {d.aviso && (
        <p className="wb-aviso t-sm">
          <Youtube size={16} aria-hidden />
          <span>{d.aviso}</span>
        </p>
      )}

      <Canal d={d} />

      {d.descripcion && <Descripcion texto={d.descripcion} />}

      {acciones}
    </div>
  );
}

function cuando(d: DatosYoutube): string {
  const v = d.vivo;
  if (v?.estado === "en-vivo") return v.inicio ? `En vivo desde las ${diaYHora(v.inicio).split(" · ")[1]} hs` : "En vivo ahora";
  if (v?.estado === "programado" && v.programado) return `Programado para el ${diaYHora(v.programado)} hs`;
  if (v?.inicio) return `Transmitido el ${diaYHora(v.inicio)} hs`;
  if (d.publicado) return `Publicado el ${diaCorto(d.publicado)} · ${relativo(d.publicado)}`;
  return "YouTube no dice la fecha";
}

function EstadoVivo({ d }: { d: DatosYoutube }) {
  if (d.vivo?.estado === "en-vivo") return <Badge variante="danger">En vivo</Badge>;
  if (d.vivo?.estado === "programado") return <Badge variante="accent">Programado</Badge>;
  return null;
}

function Cifra({ icono, etiqueta, valor, siFalta = "—" }: {
  icono: React.ReactNode; etiqueta: string; valor?: number; siFalta?: string;
}) {
  return (
    <div className="wb-cifra">
      <span className="wb-cifra__etiqueta">{icono}{etiqueta}</span>
      <span className={`wb-cifra__valor t-num${valor === undefined ? " t-subtle" : ""}`}>
        {valor === undefined ? siFalta : num(valor)}
      </span>
    </div>
  );
}

function Canal({ d }: { d: DatosYoutube }) {
  const c = d.canal;
  if (!c.nombre) return null;
  const subs = c.suscriptoresOcultos
    ? "El canal oculta sus suscriptores"
    : c.suscriptores !== undefined
      ? `${num(c.suscriptores)} suscriptores`
      : d.completo ? "Sin dato de suscriptores" : null;
  const contenido = (
    <>
      {c.avatar
        /* eslint-disable-next-line @next/next/no-img-element -- avatar público de YouTube */
        ? <img src={c.avatar} alt="" width={36} height={36} className="wb-canal__avatar" referrerPolicy="no-referrer" />
        : <Avatar nombre={c.nombre} size={36} />}
      <span style={{ minWidth: 0 }}>
        <span className="t-strong truncate" style={{ display: "block" }}>{c.nombre}</span>
        {subs && <span className="t-sm t-subtle t-num" style={{ display: "block" }}>{subs}</span>}
      </span>
    </>
  );
  return c.url
    ? <a href={c.url} target="_blank" rel="noopener noreferrer" className="wb-canal">{contenido}</a>
    : <div className="wb-canal">{contenido}</div>;
}

/* La descripción de un vivo suele ser larga (links, capítulos, redes):
   arranca corta y se abre a pedido. Los links se pueden tocar, pero sólo
   los http(s): el texto viene de afuera. */
function Descripcion({ texto }: { texto: string }) {
  const [abierta, setAbierta] = useState(false);
  const larga = texto.length > 280 || texto.split("\n").length > 5;
  return (
    <div className="stack-2">
      <p className={`wb-desc${larga && !abierta ? " wb-desc--corta" : ""}`}>
        {partirConLinks(texto).map((p, i) =>
          p.url
            ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer nofollow" className="link">{p.texto}</a>
            : <React.Fragment key={i}>{p.texto}</React.Fragment>,
        )}
      </p>
      {larga && (
        <button type="button" className="link t-sm" aria-expanded={abierta} onClick={() => setAbierta((v) => !v)}>
          {abierta ? "Mostrar menos" : "Mostrar la descripción completa"}
        </button>
      )}
    </div>
  );
}

/* ---------- Sin video: el lugar para pegar el link ---------- */

function PegarLink({ w, inicial, onListo, onCancelar }: {
  w: Webinar; inicial: string; onListo: () => void; onCancelar?: () => void;
}) {
  const [link, setLink] = useState(inicial);
  const [error, setError] = useState<string | null>(
    inicial && !idDeYoutube(inicial) ? "El link guardado no es de un video de YouTube." : null,
  );
  const id = idDeYoutube(link);

  function guardar() {
    const limpio = link.trim();
    if (!limpio) { setError("Pegá el link del video."); return; }
    if (!id) { setError("Ese link no es de un video de YouTube. Copialo desde «Compartir», abajo del video."); return; }
    if (limpio !== (w.youtubeUrl ?? "")) {
      guardarWebinar(w, { youtubeUrl: limpio }, `Se agregó el video de YouTube a «${w.titulo}».`);
    }
    onListo();
  }

  return (
    <form className="wb-pegar" onSubmit={(ev) => { ev.preventDefault(); guardar(); }} noValidate>
      <span className="wb-pegar__ico"><Youtube size={24} /></span>
      <div className="stack-2" style={{ alignItems: "center" }}>
        <h2 className="t-h3">Pegá el link del vivo o de la grabación</h2>
        <p className="t-sm t-muted" style={{ maxWidth: "46ch" }}>
          El video queda acá, con su título, la descripción, las vistas, los comentarios y los suscriptores del canal.
        </p>
      </div>
      <div className="wb-pegar__fila">
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            icono={<Link2 size={16} />} value={link} error={Boolean(error)} autoFocus={Boolean(onCancelar)}
            onChange={(ev) => { setLink(ev.target.value); setError(null); }}
            placeholder="https://youtube.com/live/…" inputMode="url" autoComplete="off"
            aria-label="Link de YouTube" aria-invalid={Boolean(error)}
          />
        </div>
        <Button type="submit" variante="primary">Guardar</Button>
        {onCancelar && <Button variante="ghost" onClick={onCancelar}>Cancelar</Button>}
      </div>
      <span className={`hk-help${error ? " hk-help--error" : ""}`} aria-live="polite">
        {error ?? (id ? "Es un link de YouTube: guardalo y aparece el video." : "Sirven los de youtube.com, youtu.be, /live/ y /shorts/.")}
      </span>
    </form>
  );
}
